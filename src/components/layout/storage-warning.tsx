import * as React from 'react';
import { Database, X } from 'lucide-react';
import {
  clearStorageProblems,
  describeStorageProblem,
  getStorageHealth,
  subscribeStorageHealth,
  type StorageHealth,
} from '@/lib/storage-health';

/**
 * Persistent banner shown whenever local storage is failing.
 *
 * Without this, a blocked or full database looks exactly like an empty
 * watchlist — the user would think their data had been deleted, and would keep
 * making edits that are never persisted. This is the "storage failure is not
 * empty data" promise made visible.
 */
export function StorageWarning() {
  const [health, setHealth] = React.useState<StorageHealth>(() => getStorageHealth());
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => subscribeStorageHealth(setHealth), []);

  // A newly reported problem must be visible again even after a dismissal.
  React.useEffect(() => {
    setDismissed(false);
  }, [health.problems.length]);

  if (health.available || dismissed || health.problems.length === 0) return null;

  const primary = health.problems[0]!;

  return (
    <div
      className="flex items-start gap-2 border-b border-amber/40 bg-amber/10 px-3 py-2 text-[11px] leading-relaxed text-amber"
      role="alert"
    >
      <Database size={13} className="mt-px shrink-0" />
      <div className="min-w-0 flex-1">
        <div className="font-medium">
          Local storage {primary.kind === 'quota' ? 'is full' : 'is unavailable'} — changes may not be saved.
        </div>
        <div className="text-amber/80">
          {describeStorageProblem(primary)} Your data is <strong>not</strong> gone: Iceberg simply cannot read or write
          the local database right now. Watchlists, notes and alerts are kept in memory for this tab only.
          {health.problems.length > 1 ? ` (${health.problems.length} problems recorded)` : ''}
        </div>
        {health.problems.some((p) => p.message) ? (
          <div className="mt-0.5 truncate font-mono text-[10px] text-amber/70" title={primary.message}>
            {primary.message}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss storage warning"
        className="shrink-0 rounded-sm p-0.5 text-amber/70 hover:bg-amber/20 hover:text-amber"
      >
        <X size={12} />
      </button>
    </div>
  );
}

/** Imperative helper used by feature code that knows a write failed. */
export function notifyStorageFailure(error: unknown): void {
  import('@/lib/storage-health').then(({ reportStorageProblem }) => {
    reportStorageProblem({
      kind: 'write',
      message: error instanceof Error ? error.message : String(error),
    });
  });
}

export { clearStorageProblems };