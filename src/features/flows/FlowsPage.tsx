import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Info, Waves } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { DemoBanner, EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { MiniBar } from '@/components/charts/sparkline';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { formatAge, formatCompactNumber, formatPct, formatPrice, formatUsdCompact, NA } from '@/lib/format';
import { useDiscoverTokens } from '@/data/queries';
import { describeFallback } from '@/data/fallback';
import { useWatchlistStore } from '@/store/watchlists';
import type { TokenMarketSummary } from '@/types/models';

/**
 * Liquidity & market flows.
 *
 * Every panel states the arithmetic it uses. Observed facts (provider values)
 * are separated from computed ratios (clearly labelled as such). Nothing here
 * is presented as a prediction, and no alert or pattern implies a future
 * price.
 */

export function FlowsPage() {
  const trending = useDiscoverTokens('trending', 30);
  const fresh = useDiscoverTokens('new', 30);
  const watchlist = useWatchlistStore((s) => s.lists);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {trending.data?.fallback ? <DemoBanner reason={describeFallback(trending.data.fallback)} /> : null}

      <div className="grid grid-cols-1 gap-px bg-edge lg:grid-cols-2">
        <FlowSignals tokens={trending.data?.tokens ?? []} isLoading={trending.isLoading} isError={trending.isError} onRetry={() => void trending.refetch()} updatedAt={trending.dataUpdatedAt} />
        <VolumeChanges tokens={trending.data?.tokens ?? []} isLoading={trending.isLoading} />
      </div>

      <div className="grid grid-cols-1 gap-px bg-edge lg:grid-cols-2">
        <NewPoolsPanel tokens={fresh.data?.tokens ?? []} isLoading={fresh.isLoading} isError={fresh.isError} onRetry={() => void fresh.refetch()} updatedAt={fresh.dataUpdatedAt} source={fresh.data?.source ?? null} />
        <DexComparison tokens={trending.data?.tokens ?? []} isLoading={trending.isLoading} />
      </div>

      <Panel className="min-h-[12rem]">
        <PanelHeader title="Watched-token events" subtitle="· movement on tokens you track" />
        <PanelBody>
          {watchlist.every((l) => l.items.length === 0) ? (
            <EmptyState title="No watched tokens" description="Add tokens to a watchlist to monitor their flows here." />
          ) : (
            <WatchedEvents />
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

function FlowSignals({
  tokens,
  isLoading,
  isError,
  onRetry,
  updatedAt,
}: {
  tokens: TokenMarketSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  updatedAt: number;
}) {
  const stats = computeStats(tokens);

  if (isLoading) return <Panel className="min-h-[18rem]"><PanelHeader title="Market signals" icon={<Waves size={12} />} /><PanelBody><LoadingState label="Computing" /></PanelBody></Panel>;
  if (isError) return <Panel className="min-h-[18rem]"><PanelHeader title="Market signals" icon={<Waves size={12} />} /><PanelBody><ErrorState error="Provider unavailable" onRetry={onRetry} /></PanelBody></Panel>;

  return (
    <Panel>
      <PanelHeader
        title="Market signals"
        icon={<Waves size={12} />}
        subtitle="· computed ratios over observed values"
        actions={<UpdatedAt timestamp={updatedAt} />}
      />
      <PanelBody className="p-2.5">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            label="Volume / liquidity"
            value={stats.poolTurnover != null ? `${stats.poolTurnover.toFixed(2)}×` : NA}
            hint="Aggregate 24h volume ÷ aggregate liquidity across these pools. A turnover measure."
            tone="cyan"
          />
          <Stat
            label="Median turnover"
            value={stats.medianTurnover != null ? `${stats.medianTurnover.toFixed(2)}×` : NA}
            hint="Median of each pool's own volume ÷ liquidity."
            tone="cyan"
          />
          <Stat
            label="Large movers (>50% 24h)"
            value={String(stats.movers)}
            hint="Count of pools with |24h change| ≥ 50%. An observation about dispersion, not a forecast."
            tone={stats.movers > 8 ? 'amber' : 'neutral'}
          />
          <Stat
            label="Newest pool age"
            value={stats.newestAge ?? NA}
            hint="Age of the most recently created pool in this set."
            tone="neutral"
          />
        </div>

        <div className="mt-3">
          <h4 className="panel-title mb-1">Highest turnover pools</h4>
          {stats.topTurnover.length === 0 ? (
            <EmptyState title="No turnover data" description="These providers did not report both volume and liquidity for any listed pool." />
          ) : (
            <ul className="divide-y divide-edge/60">
              {stats.topTurnover.map((t) => (
                <li key={t.address} className="flex items-center gap-2 py-1 text-[11px]">
                  <Link to={`/token/${t.address}`} className="w-20 shrink-0 truncate font-medium text-slate-200 hover:text-cyan">
                    {t.symbol ?? '—'}
                  </Link>
                  <span className="w-16 shrink-0 font-mono text-[10px] text-dim">{t.topDex ?? '—'}</span>
                  <MiniBar value={t.turnover} max={stats.maxTurnover} tone={t.turnover > 5 ? 'amber' : 'cyan'} className="flex-1" />
                  <span className="tnum w-14 shrink-0 text-right text-slate-300">{t.turnover.toFixed(2)}×</span>
                  <span className={cn('tnum w-14 shrink-0 text-right', t.change24h != null && t.change24h >= 0 ? 'text-bull' : 'text-bear')}>
                    {formatPct(t.change24h)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Disclaimer />
      </PanelBody>
    </Panel>
  );
}

function VolumeChanges({ tokens, isLoading }: { tokens: TokenMarketSummary[]; isLoading: boolean }) {
  if (isLoading) return <Panel className="min-h-[18rem]"><PanelHeader title="Volume vs liquidity" /><PanelBody><LoadingState /></PanelBody></Panel>;

  const rows = tokens
    .filter((t) => t.volume24h !== null)
    .sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
    .slice(0, 14);
  const max = rows[0]?.volume24h ?? 1;

  return (
    <Panel>
      <PanelHeader title="Volume distribution" subtitle="· 24h USD volume, provider-reported" />
      <PanelBody>
        {rows.length === 0 ? (
          <EmptyState title="No volume data reported" />
        ) : (
          <ul className="divide-y divide-edge/60">
            {rows.map((t) => (
              <li key={t.address} className="flex items-center gap-2 py-1 text-[11px]">
                <Link to={`/token/${t.address}`} className="w-20 shrink-0 truncate font-medium text-slate-200 hover:text-cyan">
                  {t.symbol ?? '—'}
                </Link>
                <MiniBar value={t.volume24h} max={max} className="flex-1" />
                <span className="tnum w-20 shrink-0 text-right text-slate-300">{formatUsdCompact(t.volume24h)}</span>
                <span className="tnum w-20 shrink-0 text-right text-dim">{formatUsdCompact(t.liquidityUsd)}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex justify-end gap-4 border-t border-edge pt-1.5 text-[9px] uppercase tracking-wider text-dim">
          <span>24h volume</span>
          <span>liquidity</span>
        </div>
      </PanelBody>
    </Panel>
  );
}

function NewPoolsPanel({
  tokens,
  isLoading,
  isError,
  onRetry,
  updatedAt,
  source,
}: {
  tokens: TokenMarketSummary[];
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  updatedAt: number;
  source: string | null;
}) {
  if (isLoading) return <Panel className="min-h-[18rem]"><PanelHeader title="New pool discovery" /><PanelBody><LoadingState /></PanelBody></Panel>;
  if (isError) return <Panel className="min-h-[18rem]"><PanelHeader title="New pool discovery" /><PanelBody><ErrorState error="Provider unavailable" onRetry={onRetry} /></PanelBody></Panel>;

  return (
    <Panel>
      <PanelHeader
        title="New pool discovery"
        subtitle={`· ${tokens.length} pools`}
        actions={
          <>
            {source ? <ProvenanceBadge origin={tokens[0]?.provenance.origin ?? 'live'} source={source} /> : null}
            <UpdatedAt timestamp={updatedAt} />
          </>
        }
      />
      <PanelBody>
        {tokens.length === 0 ? (
          <EmptyState title="No new pools returned" description="The provider returned an empty new-pool list." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Pool</th>
                <th scope="col" className="text-right">Price</th>
                <th scope="col" className="text-right">Liquidity</th>
                <th scope="col" className="text-right">Volume</th>
                <th scope="col" className="text-right">Age</th>
                <th scope="col" className="w-8" />
              </tr>
            </thead>
            <tbody>
              {tokens.slice(0, 16).map((t) => (
                <tr key={t.address}>
                  <td>
                    <Link to={`/token/${t.address}`} className="truncate font-medium text-slate-200 hover:text-cyan">
                      {t.symbol ?? '—'}
                    </Link>
                    <span className="ml-1 font-mono text-[10px] text-dim">{t.quoteSymbol ?? ''}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatPrice(t.priceUsd)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatUsdCompact(t.liquidityUsd)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatUsdCompact(t.volume24h)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-dim">{t.createdAt ? formatAge(t.createdAt) : NA}</span>
                  </td>
                  <td className="text-right">
                    <a
                      href={`https://dexscreener.com/solana/${(t.quoteAddress ?? '').toLowerCase()}`}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      aria-label="Open on DexScreener"
                    >
                      <ArrowUpRight size={11} className="text-dim hover:text-cyan" />
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Disclaimer />
      </PanelBody>
    </Panel>
  );
}

function DexComparison({ tokens, isLoading }: { tokens: TokenMarketSummary[]; isLoading: boolean }) {
  const byDex = React.useMemo(() => {
    const map = new Map<string, { count: number; volume: number; liquidity: number }>();
    for (const t of tokens) {
      const dex = t.topDex ?? 'unattributed';
      const entry = map.get(dex) ?? { count: 0, volume: 0, liquidity: 0 };
      entry.count++;
      entry.volume += t.volume24h ?? 0;
      entry.liquidity += t.liquidityUsd ?? 0;
      map.set(dex, entry);
    }
    return [...map.entries()].sort((a, b) => b[1].volume - a[1].volume);
  }, [tokens]);

  const total = byDex.reduce((acc, [, v]) => acc + v.volume, 0);

  if (isLoading) {
    return (
      <Panel className="min-h-[18rem]">
        <PanelHeader title="DEX comparison" />
        <PanelBody>
          <LoadingState />
        </PanelBody>
      </Panel>
    );
  }

  return (
    <Panel>
      <PanelHeader title="DEX comparison" subtitle="· volume share within this list" />
      <PanelBody>
        {byDex.length === 0 ? (
          <EmptyState title="No DEX attribution reported" description="These providers do not report a venue per pool for this segment." />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th scope="col">Venue</th>
                <th scope="col" className="text-right">Pools</th>
                <th scope="col" className="text-right">Volume 24h</th>
                <th scope="col" className="text-right">Share</th>
                <th scope="col" className="text-right">Liquidity</th>
              </tr>
            </thead>
            <tbody>
              {byDex.map(([dex, v]) => (
                <tr key={dex}>
                  <td className="text-slate-300">{dex}</td>
                  <td className="text-right">
                    <span className="tnum text-dim">{v.count}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-200">{formatUsdCompact(v.volume)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{total > 0 ? `${((v.volume / total) * 100).toFixed(1)}%` : NA}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatUsdCompact(v.liquidity)}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <Disclaimer />
      </PanelBody>
    </Panel>
  );
}

function WatchedEvents() {
  const lists = useWatchlistStore((s) => s.lists);
  const mints = lists.flatMap((l) => l.items.map((i) => i.mint));
  const trending = useDiscoverTokens('trending', 30);
  const tokens = trending.data?.tokens ?? [];
  const matched = tokens.filter((t) => mints.includes(t.address));

  if (matched.length === 0) {
    return (
      <EmptyState
        title="No watched tokens in the current flow list"
        description="Watched tokens surface here when they appear in the provider's trending/new segments."
      />
    );
  }

  return (
    <ul className="divide-y divide-edge/60">
      {matched.map((t) => (
        <li key={t.address} className="flex items-center gap-2 py-1.5 text-[11px]">
          <Badge tone="info">seen in trending</Badge>
          <Link to={`/token/${t.address}`} className="font-medium text-slate-200 hover:text-cyan">
            {t.symbol ?? t.address}
          </Link>
          <span className="tnum ml-auto text-slate-300">{formatPrice(t.priceUsd)}</span>
          <span className={cn('tnum w-16 text-right', t.change24h != null && t.change24h >= 0 ? 'text-bull' : 'text-bear')}>
            {formatPct(t.change24h)}
          </span>
          <span className="tnum w-16 text-right text-dim">{formatCompactNumber(t.txns24h)} txns</span>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint: string;
  tone: 'cyan' | 'amber' | 'neutral';
}) {
  return (
    <div className="border border-edge bg-surface-2/50 p-2">
      <div className="flex items-center gap-1 text-2xs uppercase tracking-wider text-dim">
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info size={9} className="cursor-help" />
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </div>
      <div className={cn('tnum mt-1 text-lg', tone === 'amber' ? 'text-amber' : tone === 'cyan' ? 'text-cyan' : 'text-slate-100')}>
        {value}
      </div>
    </div>
  );
}

function Disclaimer() {
  return (
    <p className="mt-2 flex items-start gap-1.5 border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
      <Info size={11} className="mt-px shrink-0" />
      <span>
        Values above are <strong className="text-slate-400">observed</strong> provider figures; ratios marked as
        computed are simple arithmetic over those figures. Iceberg does not claim any of them predicts a future price,
        and no alert in this app should be read as a forecast.
      </span>
    </p>
  );
}

export function computeStats(tokens: TokenMarketSummary[]) {
  let totalVolume = 0;
  let totalLiquidity = 0;
  let movers = 0;
  const turnovers: { address: string; symbol: string | null; turnover: number; change24h: number | null; topDex: string | null }[] = [];

  for (const t of tokens) {
    totalVolume += t.volume24h ?? 0;
    totalLiquidity += t.liquidityUsd ?? 0;
    if (t.change24h !== null && Math.abs(t.change24h) >= 50) movers++;
    if (t.volume24h !== null && t.liquidityUsd !== null && t.liquidityUsd > 0) {
      turnovers.push({
        address: t.address,
        symbol: t.symbol,
        turnover: t.volume24h / t.liquidityUsd,
        change24h: t.change24h,
        topDex: t.topDex,
      });
    }
  }

  const sortedTurnovers = turnovers.map((t) => t.turnover).sort((a, b) => a - b);
  const newest = tokens.reduce<number | null>((acc, t) => {
    if (t.createdAt === null) return acc;
    return acc === null ? t.createdAt : Math.max(acc, t.createdAt);
  }, null);

  return {
    poolTurnover: totalLiquidity > 0 ? totalVolume / totalLiquidity : null,
    medianTurnover: sortedTurnovers.length ? sortedTurnovers[Math.floor(sortedTurnovers.length / 2)]! : null,
    movers,
    newestAge: newest ? formatAge(newest) : null,
    topTurnover: turnovers.sort((a, b) => b.turnover - a.turnover).slice(0, 8),
    maxTurnover: turnovers.length ? Math.max(...turnovers.map((t) => t.turnover)) : null,
  };
}