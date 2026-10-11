import * as React from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { AddressLink } from '@/components/tables/cells';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { formatAmount, formatDateTime, formatLamports, formatPct, truncateAddress } from '@/lib/format';
import { cn } from '@/lib/utils';
import { DemoBanner, EmptyState, ErrorState, LoadingState } from '@/components/ui/states';
import type { ActivityKind, ActivityRecord, TxStatus } from '@/types/models';

/**
 * On-chain activity table.
 *
 * Classification is deliberately conservative. A record is only labelled
 * `transfer`, `swap`, `mint`, `burn` or `close-account` when the parsed
 * transaction genuinely encodes that instruction. Nothing is ever labelled a
 * buy, a sell, an accumulation, or a liquidity add/remove, because proving
 * that requires pre/post balances across both legs of a route that
 * aggregators routinely make ambiguous.
 */

const KIND_LABEL: Record<ActivityKind, string> = {
  transfer: 'Transfer',
  swap: 'Swap',
  'liquidity-add': 'Liquidity add',
  'liquidity-remove': 'Liquidity remove',
  mint: 'Mint',
  burn: 'Burn',
  'close-account': 'Close account',
  fee: 'Fee',
  unknown: 'Unclassified',
};

const STATUS_TONE: Record<TxStatus, 'bull' | 'bear' | 'neutral'> = {
  success: 'bull',
  failed: 'bear',
  unknown: 'neutral',
};

export function ActivityTable({
  records,
  isLoading,
  isError,
  onRetry,
  showAccount = true,
  emptyHint,
}: {
  records: ActivityRecord[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
  showAccount?: boolean;
  emptyHint?: React.ReactNode;
}) {
  if (isLoading) return <LoadingState label="Loading transactions" />;
  if (isError) return <ErrorState error={isError} onRetry={onRetry} compact />;
  if (records.length === 0) {
    return (
      <EmptyState
        title="No transactions returned"
        description={emptyHint ?? 'Your RPC node returned no signatures for this address in the requested window.'}
      />
    );
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Time</th>
          <th scope="col">Signature</th>
          {showAccount ? <th scope="col">Account</th> : null}
          <th scope="col">Type</th>
          <th scope="col" className="text-right">SOL Δ</th>
          <th scope="col">Token amounts (observed balance deltas)</th>
          <th scope="col" className="text-right">Fee</th>
          <th scope="col">Status</th>
        </tr>
      </thead>
      <tbody>
        {records.map((r) => (
          <tr key={r.signature}>
            <td className="text-[10px] text-dim">{formatDateTime(r.blockTime)}</td>
            <td>
              <Link to={`/tx/${r.signature}`} className="block max-w-[16rem] overflow-hidden" title={r.signature}>
                <AddressLink value={r.signature} kind="tx" />
              </Link>
            </td>
            {showAccount ? (
              <td>
                {r.account ? <AddressLink value={r.account} /> : <span className="text-dim">{NA_TEXT}</span>}
              </td>
            ) : null}
            <td>
              <Badge tone={r.kind === 'unknown' ? 'neutral' : 'info'}>{KIND_LABEL[r.kind]}</Badge>
            </td>
            <td className="text-right">
              <span className={cn('tnum', deltaTone(r.solDelta))}>
                {r.solDelta === null ? '—' : `${r.solDelta > 0 ? '+' : ''}${formatAmount(r.solDelta, 6)}`}
              </span>
            </td>
            <td className="max-w-[22rem]">
              {r.tokenAmounts.length === 0 ? (
                <span className="text-[10px] text-dim">
                  {r.kind === 'unknown' ? 'requires transaction detail' : 'no balance delta reported'}
                </span>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {r.tokenAmounts.slice(0, 3).map((a, i) => (
                    <Tooltip key={`${a.mint}-${i}`}>
                      <TooltipTrigger asChild>
                        <span
                          className={cn(
                            'tnum max-w-[13rem] truncate rounded-sm border border-edge bg-surface-2 px-1 font-mono text-[10px]',
                            deltaTone(a.uiAmount),
                          )}
                        >
                          {a.symbol ?? truncateAddress(a.mint, 3)} {a.uiAmount > 0 ? '+' : ''}
                          {formatAmount(a.uiAmount)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent>
                        Observed balance change of {formatAmount(a.uiAmount)} for mint {a.mint}. Units are reported by the
                        node without decimals metadata for this leg.
                      </TooltipContent>
                    </Tooltip>
                  ))}
                  {r.tokenAmounts.length > 3 ? <span className="text-[10px] text-dim">+{r.tokenAmounts.length - 3}</span> : null}
                </div>
              )}
            </td>
            <td className="text-right">
              <span className="tnum text-[10px] text-dim">{r.feeSol !== null ? formatLamports(r.feeLamports).replace(' SOL', '') : '—'}</span>
            </td>
            <td>
              <Badge tone={STATUS_TONE[r.status]}>{r.status}</Badge>
              {r.computeUnits != null ? (
                <span className="ml-1 font-mono text-[9px] text-dim">{formatPct((r.computeUnits / 1_400_000) * 100, 0)} CU</span>
              ) : null}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const NA_TEXT = '—';

function deltaTone(v: number | null): string {
  if (v === null) return 'text-dim';
  if (v > 0) return 'text-bull';
  if (v < 0) return 'text-bear';
  return 'text-dim';
}

export function ActivityFeed({
  records,
  isLoading,
  isError,
  onRetry,
}: {
  records: ActivityRecord[];
  isLoading: boolean;
  isError: boolean;
  onRetry?: () => void;
}) {
  const demo = records[0]?.provenance.origin === 'demo';
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {demo ? (
        <DemoBanner reason="The chain provider is unavailable, so these are deterministic synthetic records." />
      ) : null}
      <ActivityTable records={records} isLoading={isLoading} isError={isError} onRetry={onRetry} />
    </div>
  );
}