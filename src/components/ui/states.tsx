import * as React from 'react';
import { AlertTriangle, Inbox, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { Button } from './button';
import { cn } from '@/lib/utils';
import { appErrorMessage } from '@/data/fallback';

/** Full-panel loading state. */
export function LoadingState({ label = 'Loading', className }: { label?: string; className?: string }) {
  return (
    <div className={cn('flex h-full min-h-[80px] items-center justify-center gap-2 p-4 text-dim', className)}>
      <Loader2 size={14} className="animate-spin" />
      <span className="font-mono text-xs">{label}…</span>
    </div>
  );
}

/** Empty state with an explicit, honest explanation. */
export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex h-full flex-col items-center justify-center gap-2 p-6 text-center', className)}>
      <div className="text-dim">{icon ?? <Inbox size={18} />}</div>
      <div className="text-xs font-medium text-slate-300">{title}</div>
      {description ? <div className="max-w-md text-2xs leading-relaxed text-dim">{description}</div> : null}
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}

/**
 * Error state.
 *
 * Renders the real provider error (never a fabricated success) plus the
 * remediation hint from the error taxonomy, and an explicit retry action.
 */
export function ErrorState({
  error,
  onRetry,
  className,
  compact,
}: {
  error: unknown;
  onRetry?: () => void;
  className?: string;
  compact?: boolean;
}) {
  const { message, hint } = appErrorMessage(error);
  const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;

  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center gap-1.5 text-center',
        compact ? 'p-3' : 'p-6',
        className,
      )}
      role="alert"
    >
      <div className="flex items-center gap-1.5 text-bear">
        {isOffline ? <WifiOff size={14} /> : <AlertTriangle size={14} />}
        <span className="font-mono text-xs font-semibold uppercase tracking-wider">Data unavailable</span>
      </div>
      <div className="max-w-lg text-2xs leading-relaxed text-slate-400">{message}</div>
      {hint ? <div className="max-w-lg text-2xs leading-relaxed text-dim">{hint}</div> : null}
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={onRetry} className="mt-1">
          <RefreshCw size={11} /> Retry
        </Button>
      ) : null}
    </div>
  );
}

/**
 * The single source of truth for the "this is synthetic data" banner.
 *
 * Iceberg Terminal refuses to show a demo number without this marker being
 * visible on the same surface.
 */
export function DemoBanner({ reason, className }: { reason?: string | null; className?: string }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 border-b border-fuchsia-500/30 bg-fuchsia-500/10 px-3 py-1.5',
        className,
      )}
      role="status"
    >
      <span className="rounded-sm border border-fuchsia-500/60 bg-fuchsia-500/20 px-1.5 py-px font-mono text-[10px] font-bold uppercase tracking-widest text-fuchsia-300">
        Demo data
      </span>
      <span className="text-2xs text-fuchsia-200/80">
        Deterministic synthetic samples — <strong className="font-semibold">not live market prices</strong>.
        {reason ? ` ${reason}` : ''} Configure a data provider in{' '}
        <span className="font-mono">Settings › Providers</span> for live data.
      </span>
    </div>
  );
}

/** Inline "last updated / stale" indicator used on every data panel. */
export function UpdatedAt({
  timestamp,
  isFetching,
  isStale,
  className,
}: {
  timestamp?: number | null;
  isFetching?: boolean;
  isStale?: boolean;
  className?: string;
}) {
  const [, forceTick] = React.useReducer((x: number) => x + 1, 0);
  React.useEffect(() => {
    const t = setInterval(forceTick, 5_000);
    return () => clearInterval(t);
  }, []);

  if (!timestamp) return null;
  const ageSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  const age = ageSec < 60 ? `${ageSec}s` : ageSec < 3600 ? `${Math.floor(ageSec / 60)}m` : `${Math.floor(ageSec / 3600)}h`;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[10px] text-dim',
        (isStale || ageSec > 120) && 'text-amber',
        className,
      )}
      title={`Last updated ${new Date(timestamp).toLocaleString()}`}
    >
      {isFetching ? <Loader2 size={9} className="animate-spin" /> : null}
      {isFetching ? 'syncing' : `updated ${age} ago`}
    </span>
  );
}