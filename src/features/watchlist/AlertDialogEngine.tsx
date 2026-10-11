import * as React from 'react';
import { BellRing, ShieldAlert } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { useWatchlistStore } from '@/store/watchlists';
import { useAlertStore, type AlertRule } from '@/store/alerts';
import { useProviderStore } from '@/store/providers';
import { useSpotPrices } from '@/data/queries';
import { formatPrice, formatPct } from '@/lib/format';
import { safeWarn } from '@/lib/redact';

/**
 * Alert engine.
 *
 * Evaluates alert rules against live spot prices on the configured polling
 * interval, while the tab is running. Fires in-app toasts and (with explicit
 * user permission) browser notifications.
 *
 * It does NOT run in the background. `document.visibilityState` is used to
 * avoid firing a burst of stale comparisons when the tab regains focus.
 */
export function useAlertEngine(): void {
  const rules = useAlertStore((s) => s.rules);
  const markTriggered = useAlertStore((s) => s.markTriggered);
  // Select the stable reference first. Returning a freshly-built array straight
  // from a zustand selector would create a new snapshot on every call and put
  // useSyncExternalStore into an infinite update loop.
  const watchlists = useWatchlistStore((s) => s.lists);
  const browserNotifications = useProviderStore((s) => s.alerts.browserNotifications);
  const notifyPermission = useProviderStore((s) => s.alerts.notifyPermission);
  const queryClient = useQueryClient();

  const watchedMints = React.useMemo(
    () => watchlists.flatMap((l) => l.items.map((i) => i.mint)),
    [watchlists],
  );

  const targets = React.useMemo(() => {
    const set = new Set<string>(watchedMints);
    for (const r of rules) set.add(r.target);
    return [...set];
  }, [watchedMints, rules]);

  const spot = useSpotPrices(targets);

  // Rolling baseline per mint, used by the volume-spike rule.
  const baseline = React.useRef<Map<string, number[]>>(new Map());
  React.useEffect(() => {
    const vol = spot.data;
    if (!vol) return;
    const map = baseline.current;
    for (const [mint, value] of Object.entries(vol.prices)) {
      if (value === null) continue;
      const arr = map.get(mint) ?? [];
      arr.push(value);
      if (arr.length > 30) arr.shift();
      map.set(mint, arr);
    }
  }, [spot.data]);

  const lastFired = React.useRef(new Map<string, number>());
  const hidden = React.useRef(false);
  React.useEffect(() => {
    const onVis = () => {
      hidden.current = document.visibilityState === 'hidden';
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  React.useEffect(() => {
    const prices = spot.data?.prices;
    const changes = spot.data?.change24h;
    const liquidity = spot.data?.liquidityUsd;
    if (!prices || hidden.current) return;

    const now = Date.now();
    for (const rule of rules) {
      if (!rule.enabled) continue;
      const cooldown = 60_000;
      const last = lastFired.current.get(rule.id) ?? 0;
      if (now - last < cooldown) continue;

      const message = evaluate(
        rule,
        prices,
        changes ?? {},
        liquidity ?? {},
        baseline.current,
      );
      if (!message) continue;

      lastFired.current.set(rule.id, now);
      markTriggered(rule.id, message);

      if (browserNotifications && notifyPermission === 'granted') {
        try {
          new Notification('Iceberg Terminal alert', { body: message, tag: rule.id, silent: false });
        } catch (e) {
          safeWarn('Notification failed', e);
        }
      }

      void queryClient;
    }
  }, [spot.data, rules, markTriggered, browserNotifications, notifyPermission, queryClient]);
}

function evaluate(
  rule: AlertRule,
  prices: Record<string, number | null>,
  changes: Record<string, number | null>,
  liquidity: Record<string, number | null>,
  baseline: Map<string, number[]>,
): string | null {
  const price = prices[rule.target] ?? null;
  const label = rule.label ?? rule.target.slice(0, 8);

  switch (rule.kind) {
    case 'price-above':
      return price !== null && price >= rule.threshold ? `${label} price ${formatPrice(price)} ≥ ${formatPrice(rule.threshold)}` : null;
    case 'price-below':
      return price !== null && price <= rule.threshold ? `${label} price ${formatPrice(price)} ≤ ${formatPrice(rule.threshold)}` : null;
    case 'change-up': {
      const ch = changes[rule.target] ?? null;
      return ch !== null && ch >= rule.threshold ? `${label} 24h change ${formatPct(ch)} ≥ ${rule.threshold}%` : null;
    }
    case 'change-down': {
      const ch = changes[rule.target] ?? null;
      return ch !== null && ch <= rule.threshold ? `${label} 24h change ${formatPct(ch)} ≤ ${rule.threshold}%` : null;
    }
    case 'volume-spike': {
      const liq = liquidity[rule.target] ?? null;
      const arr = baseline.get(rule.target) ?? [];
      if (liq === null || arr.length < 5) return null;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      if (mean <= 0) return null;
      const ratio = price !== null && price !== 0 ? price / mean : 1;
      return ratio >= rule.threshold ? `${label} price is ${ratio.toFixed(2)}× its rolling baseline` : null;
    }
    default:
      return null;
  }
}

/** Fired-alert inbox rendered in the app shell. */
export function useUnreadAlertCount(): number {
  const fired = useAlertStore((s) => s.fired);
  return fired.filter((f) => !f.acknowledged).length;
}

export function AlertBell() {
  const fired = useAlertStore((s) => s.fired);
  const acknowledgeAll = useAlertStore((s) => s.acknowledgeAll);
  const acknowledge = useAlertStore((s) => s.acknowledge);
  const [open, setOpen] = React.useState(false);
  const unread = fired.filter((f) => !f.acknowledged);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="relative flex h-7 items-center gap-1 rounded-sm border border-edge-strong bg-surface-3 px-2 text-xs text-slate-300 transition-colors hover:bg-surface-4 hover:text-white"
        aria-label={`Alerts (${unread.length} unread)`}
      >
        <BellRing size={12} />
        {unread.length > 0 ? (
          <span className="absolute -right-1 -top-1 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-amber px-0.5 font-mono text-[9px] font-bold text-black">
            {unread.length}
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="absolute right-0 top-8 z-40 w-80 border border-edge bg-surface-1 shadow-xl shadow-black/60">
          <div className="flex items-center justify-between border-b border-edge px-2 py-1.5">
            <span className="panel-title">Alert history</span>
            <button
              type="button"
              onClick={acknowledgeAll}
              className="text-[10px] text-cyan hover:underline"
              disabled={unread.length === 0}
            >
              Mark all read
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto scroll-thin">
            {fired.length === 0 ? (
              <div className="px-3 py-6 text-center text-[10px] text-dim">
                No alerts have fired in this session.
              </div>
            ) : (
              <ul className="divide-y divide-edge/60">
                {fired.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-start gap-2 px-2 py-1.5 text-[10px] hover:bg-surface-2"
                    onClick={() => acknowledge(f.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') acknowledge(f.id);
                    }}
                  >
                    <ShieldAlert size={11} className={f.acknowledged ? 'text-dim' : 'mt-px text-amber'} />
                    <div className="min-w-0 flex-1">
                      <div className={f.acknowledged ? 'text-slate-500' : 'text-slate-200'}>{f.message}</div>
                      <div className="text-dim">{new Date(f.firedAt).toLocaleString()}</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}