import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileSearch } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { AddressLink } from '@/components/tables/cells';
import { useTransaction } from '@/data/queries';
import { useWalletActivity } from '@/data/queries';
import { classifyIdentifier } from '@/lib/solana';
import { formatAmount, formatDateTime, formatLamports } from '@/lib/format';
import { explorerUrl } from '@/lib/solana';

export function TxPage() {
  const { signature = '' } = useParams();
  const navigate = useNavigate();
  const valid = classifyIdentifier(signature) === 'signature';
  const tx = useTransaction(valid ? signature : null);
  const activity = useWalletActivity(valid ? [signature] : [], 1);

  if (!valid) {
    return (
      <Panel className="m-3 rounded-none border">
        <EmptyState
          title="Not a transaction signature"
          description="Signatures are 64-byte base58 values, typically 87–88 characters."
          action={<Button size="sm" onClick={() => navigate('/activity')}>Back to activity</Button>}
        />
      </Panel>
    );
  }

  const record = tx.data ?? activity.data?.records[0] ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-1 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={12} />
        </Button>
        <FileSearch size={13} className="text-dim" />
        <AddressLink value={signature} kind="tx" truncate={false} className="text-[11px]" />
        <div className="ml-auto flex items-center gap-1.5">
          {record ? <ProvenanceBadge origin={record.provenance.origin} source={record.provenance.source} /> : null}
          <UpdatedAt timestamp={tx.dataUpdatedAt} isFetching={tx.isFetching} />
          <Button size="sm" variant="ghost" onClick={() => window.open(explorerUrl('tx', signature), '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={11} /> Explorer
          </Button>
        </div>
      </div>

      <Panel className="m-3 rounded-none border">
        <PanelHeader title="Transaction detail" subtitle="· read-only inspection" />
        <PanelBody>
          {tx.isLoading && !record ? (
            <LoadingState label="Fetching transaction" />
          ) : tx.isError && !record ? (
            <ErrorState error={tx.error} onRetry={() => void tx.refetch()} />
          ) : !record ? (
            <EmptyState
              title="Transaction detail unavailable"
              description="Your RPC node did not return a parsed transaction for this signature. It may be too old, pruned, or the node may not support the requested commitment."
            />
          ) : (
            <div className="space-y-3 p-3">
              <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
                <Field label="Signature">
                  <AddressLink value={record.signature} kind="tx" truncate={false} />
                </Field>
                <Field label="Status">
                  <Badge tone={record.status === 'success' ? 'bull' : 'bear'}>{record.status}</Badge>
                </Field>
                <Field label="Block time">{formatDateTime(record.blockTime)}</Field>
                <Field label="Slot">{record.slot ?? '—'}</Field>
                <Field label="Type">{record.kind}</Field>
                <Field label="Fee">{record.feeLamports !== null ? formatLamports(record.feeLamports) : '—'}</Field>
                <Field label="Compute units">
                  {record.computeUnits != null ? record.computeUnits.toLocaleString('en-US') : '—'}
                </Field>
                <Field label="Signer SOL delta (net of fee)">
                  <span className={record.solDelta != null && record.solDelta >= 0 ? 'text-bull' : 'text-bear'}>
                    {record.solDelta !== null ? `${record.solDelta > 0 ? '+' : ''}${formatAmount(record.solDelta, 6)}` : '—'}
                  </span>
                </Field>
                <Field label="Error">{record.err ?? 'none'}</Field>
              </dl>

              <div>
                <h4 className="panel-title mb-1">Observed token balance deltas</h4>
                {record.tokenAmounts.length === 0 ? (
                  <p className="text-[11px] text-dim">
                    The node did not report token balance changes for this transaction.
                  </p>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th scope="col">Mint</th>
                        <th scope="col" className="text-right">Δ amount</th>
                        <th scope="col" className="text-right">Decimals (reported)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {record.tokenAmounts.map((a, i) => (
                        <tr key={`${a.mint}-${i}`}>
                          <td>
                            <AddressLink value={a.mint} kind="token" truncate={false} />
                          </td>
                          <td className="text-right">
                            <span className={a.uiAmount > 0 ? 'text-bull' : a.uiAmount < 0 ? 'text-bear' : 'text-dim'}>
                              {a.uiAmount > 0 ? '+' : ''}
                              {formatAmount(a.uiAmount, 9)}
                            </span>
                          </td>
                          <td className="text-right">
                            <span className="tnum text-dim">{a.decimals}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              <p className="border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
                Iceberg reports only what the RPC encoded. It does not infer whether a swap was a buy or a sell, does not
                attribute intent, and does not compute a counterparty identity. For full decoded instruction-level detail,
                use a block explorer.
              </p>

              <p className="text-[10px]">
                <Link to="/activity" className="link">
                  ← back to the activity feed
                </Link>
              </p>
            </div>
          )}
        </PanelBody>
      </Panel>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-2xs uppercase tracking-wider text-dim">{label}</dt>
      <dd className="mt-0.5 text-[11px] text-slate-300">{children}</dd>
    </div>
  );
}