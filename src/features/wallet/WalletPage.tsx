import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, Info, Wallet as WalletIcon } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Textarea } from '@/components/ui/input';
import { DemoBanner, EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { AddressLink, TokenCell } from '@/components/tables/cells';
import { formatCompactNumber, formatLamports, formatPct, formatPrice, formatUsdCompact, NA } from '@/lib/format';
import { explorerUrl, isSolanaAddress } from '@/lib/solana';
import { useWalletActivity, useWalletSnapshot } from '@/data/queries';
import { useWalletStore } from '@/store/wallets';
import { useProviderStore } from '@/store/providers';
import { ActivityTable } from '@/features/activity/ActivityTable';

/**
 * Wallet intelligence — read-only.
 *
 * Explicit limitations are surfaced in the UI rather than hidden:
 *  • Portfolio value is a mark-to-market estimate from current prices.
 *  • Historical balances, realized/unrealized PnL and cost basis are NOT
 *    computed, because the read-only endpoints used here cannot supply them.
 *  • No seed phrase or private key is ever requested.
 */

export function WalletPage() {
  const { address = '' } = useParams();
  const navigate = useNavigate();
  const valid = isSolanaAddress(address);

  const snapshot = useWalletSnapshot(valid ? address : null);
  const activity = useWalletActivity(valid ? [address] : [], 20);
  const wallets = useWalletStore((s) => s.wallets);
  const addWallet = useWalletStore((s) => s.addWallet);
  const updateWallet = useWalletStore((s) => s.updateWallet);
  const forceDemo = useProviderStore((s) => s.forceDemo);

  const known = wallets.find((w) => w.address === address);

  if (!valid) {
    return (
      <Panel className="m-3 rounded-none border">
        <EmptyState
          title="Not a valid Solana address"
          description="Pass a 32–44 character base58 public address."
          action={<Button size="sm" onClick={() => navigate('/watchlist')}>Open watchlist</Button>}
        />
      </Panel>
    );
  }

  const data = snapshot.data;
  const holdings = data?.holdings ?? [];

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {forceDemo || data?.provenance.origin === 'demo' ? (
        <DemoBanner reason="The chain provider is unavailable or demo mode is on, so these values are synthetic." />
      ) : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-1 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={12} />
        </Button>
        <WalletIcon size={13} className="text-dim" />
        <span className="truncate text-sm font-medium text-slate-100">{known?.label ?? 'Public wallet'}</span>
        <AddressLink value={address} truncate={false} className="text-[11px]" />
        <div className="ml-auto flex items-center gap-1.5">
          {!known ? (
            <Button size="sm" variant="outline" onClick={() => addWallet(address)}>
              Add to watchlist
            </Button>
          ) : null}
          <Button size="sm" variant="ghost" onClick={() => window.open(explorerUrl('address', address), '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={11} /> Explorer
          </Button>
          {data ? <ProvenanceBadge origin={data.provenance.origin} source={data.provenance.source} /> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-edge bg-edge lg:grid-cols-4">
        <Tile label="SOL balance" value={data?.balance.sol != null ? `${formatCompactNumber(data.balance.sol)}` : '—'} sub={data?.balance.lamports != null ? formatLamports(data.balance.lamports) : null} updated={snapshot.dataUpdatedAt} fetching={snapshot.isFetching} />
        <Tile
          label="Est. portfolio value"
          value={formatUsdCompact(data?.totalValueUsd ?? null)}
          sub={
            !data
              ? null
              : !data.holdingsAvailable
                ? 'SOL position only — token balances unread'
                : data.pricedHoldingCount === 0 && data.unpricedHoldingCount === 0
                  ? 'SOL position only — no SPL balances'
                  : `${data.pricedHoldingCount} priced · ${data.unpricedHoldingCount} unpriced`
          }
          updated={snapshot.dataUpdatedAt}
          fetching={snapshot.isFetching}
        />
        <Tile label="Token accounts" value={data ? (data.holdingsAvailable ? String(holdings.length) : '—') : '—'} sub={data && !data.holdingsAvailable ? 'RPC did not return token accounts' : 'non-zero SPL balances'} updated={snapshot.dataUpdatedAt} fetching={snapshot.isFetching} />
        <Tile label="Context slot" value={data?.balance.slot != null ? String(data.balance.slot) : NA} sub="latest observed slot" updated={snapshot.dataUpdatedAt} fetching={snapshot.isFetching} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-edge xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel className="min-h-[14rem] flex-1">
            <PanelHeader title="Token holdings" subtitle="· SPL balances" actions={<UpdatedAt timestamp={snapshot.dataUpdatedAt} isFetching={snapshot.isFetching} />} />
            <PanelBody>
              {snapshot.isLoading ? (
                <LoadingState label="Reading wallet" />
              ) : snapshot.isError ? (
                <ErrorState error={snapshot.error} onRetry={() => void snapshot.refetch()} />
              ) : data && !data.holdingsAvailable ? (
                <EmptyState
                  title="Token accounts unavailable"
                  description={
                    <>
                      Your RPC node did not return SPL token accounts for this address — public endpoints frequently block
                      <span className="font-mono"> getTokenAccountsByOwner</span>. This is an <em>unread</em> state, not an
                      empty wallet: the balance below is still live. Add a Helius or Alchemy key in{' '}
                      <Link to="/settings" className="link">
                        Settings › Providers
                      </Link>{' '}
                      to read holdings.
                      {data.holdingsError ? <span className="mt-1 block font-mono text-[10px]">{data.holdingsError}</span> : null}
                    </>
                  }
                  icon={<WalletIcon size={14} />}
                />
              ) : holdings.length === 0 ? (
                <EmptyState
                  title="No non-zero SPL token balances"
                  description="Your RPC node returned no funded SPL accounts for this address."
                  icon={<WalletIcon size={14} />}
                />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Token</th>
                      <th scope="col" className="text-right">Amount</th>
                      <th scope="col" className="text-right">Price</th>
                      <th scope="col" className="text-right">Value</th>
                      <th scope="col">Mint</th>
                    </tr>
                  </thead>
                  <tbody>
                    {holdings.map((h) => (
                      <tr key={h.mint}>
                        <td>
                          <TokenCell mint={h.mint} symbol={h.symbol} size="sm" />
                        </td>
                        <td className="text-right">
                          <span className="tnum text-slate-200">{formatCompactNumber(h.uiAmount)}</span>
                        </td>
                        <td className="text-right">
                          <span className="tnum text-slate-300">
                            {h.priceUsd === null ? <span className="text-dim" title="No pricing provider covers this mint">unpriced</span> : formatPrice(h.priceUsd)}
                          </span>
                        </td>
                        <td className="text-right">
                          <span className="tnum text-slate-200">{formatUsdCompact(h.valueUsd)}</span>
                        </td>
                        <td>
                          <AddressLink value={h.mint} kind="token" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </PanelBody>
          </Panel>

          <Panel className="min-h-[14rem]">
            <PanelHeader
              title="Transaction history"
              subtitle="· signatures from RPC"
              actions={<UpdatedAt timestamp={activity.dataUpdatedAt} isFetching={activity.isFetching} />}
            />
            <PanelBody>
              <ActivityTable records={activity.data?.records ?? []} isLoading={activity.isLoading} isError={activity.isError} onRetry={() => void activity.refetch()} />
            </PanelBody>
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel>
            <PanelHeader title="Local notes" subtitle="· stored in this browser only" />
            <PanelBody className="p-2">
              <Textarea
                value={known?.note ?? ''}
                placeholder="Track this wallet because…"
                rows={6}
                onChange={(e) => {
                  if (known) updateWallet(address, { note: e.target.value });
                }}
                disabled={!known}
              />
              {!known ? (
                <p className="mt-1.5 text-[10px] text-dim">Add the wallet to your watchlist to attach notes and labels.</p>
              ) : null}
            </PanelBody>
          </Panel>

          <LimitationsPanel unpriced={data?.unpricedHoldingCount ?? 0} />
        </div>
      </div>
    </div>
  );
}

function Tile({
  label,
  value,
  sub,
  updated,
  fetching,
}: {
  label: string;
  value: string;
  sub?: React.ReactNode;
  updated?: number;
  fetching?: boolean;
}) {
  return (
    <div className="bg-surface-1 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-2xs font-semibold uppercase tracking-wider text-dim">{label}</span>
        <UpdatedAt timestamp={updated} isFetching={fetching} />
      </div>
      <div className="tnum mt-0.5 truncate text-lg leading-tight text-slate-100">{value}</div>
      {sub ? <div className="mt-0.5 truncate font-mono text-[10px] text-dim">{sub}</div> : null}
    </div>
  );
}

/** Honest, first-class limitations panel. */
function LimitationsPanel({ unpriced }: { unpriced: number }) {
  return (
    <Panel className="flex-1">
      <PanelHeader title="What this view does not show" icon={<Info size={12} />} />
      <PanelBody className="space-y-2 p-2.5 text-[11px] leading-relaxed text-slate-400">
        <p>
          <strong className="text-slate-200">Portfolio value is an estimate.</strong> It multiplies current token
          balances by the latest price each configured provider reports. It is not a realised figure and does not
          account for historical prices.
        </p>
        <p>
          <strong className="text-slate-200">No PnL or cost basis.</strong> Realized PnL, unrealized PnL and cost
          basis require a complete historical price series aligned to every transfer. The read-only RPC endpoints used
          here cannot supply that reliably, so Iceberg does not estimate it. Any tool showing these numbers to you is
          modelling them.
        </p>
        <p>
          <strong className="text-slate-200">No historical balances.</strong> Only the current state at the last
          observed slot is shown.
        </p>
        {unpriced > 0 ? (
          <p>
            <strong className="text-amber">{unpriced} holding(s) could not be priced.</strong> No configured market-data
            provider quotes those mints, so they are shown as “unpriced” rather than valued at zero.
          </p>
        ) : null}
        <p className="border-t border-edge pt-2 text-[10px] text-dim">
          <Badge tone="info">Read-only</Badge>{' '}
          Iceberg Terminal has no wallet connection, no signing and no swap functionality, and will never ask for a seed
          phrase or private key.
        </p>
      </PanelBody>
    </Panel>
  );
}

export { formatPct };