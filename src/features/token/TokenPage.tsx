import * as React from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  Bell,
  ExternalLink,
  Info,
  ShieldAlert,
  Star,
} from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/input';
import { DemoBanner, EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { CandleChart, ChartLegend } from '@/components/charts/candle-chart';
import { AddressLink, TokenCell } from '@/components/tables/cells';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import {
  changeToneClass,
  formatAge,
  formatCompactNumber,
  formatDateTime,
  formatPct,
  formatPrice,
  formatUsdCompact,
  NA,
} from '@/lib/format';
import { useCandles, useMintAccount, useTokenMarkets, useTokenSecurity, useWalletActivity, topMarket } from '@/data/queries';
import { describeFallback } from '@/data/fallback';
import { useWatchlistStore } from '@/store/watchlists';
import { useVaultStore } from '@/store/vault';
import { explorerUrl, isSolanaAddress } from '@/lib/solana';
import type { CandleInterval, Market } from '@/types/models';
import { AlertDialog } from '@/features/watchlist/AlertDialog';

/**
 * Token research view.
 *
 * The mint address is the canonical identifier. Symbols are display-only
 * because they collide and are trivially spoofable on Solana.
 */

const INTERVALS: CandleInterval[] = ['5m', '15m', '1h', '4h', '1d', '1w'];

export function TokenPage() {
  const { mint = '' } = useParams();
  const navigate = useNavigate();
  const [interval, setInterval] = React.useState<CandleInterval>('1h');
  const [hover, setHover] = React.useState<null | { time: number; open: number; high: number; low: number; close: number }>(null);
  const [alertOpen, setAlertOpen] = React.useState(false);

  const valid = isSolanaAddress(mint);
  const markets = useTokenMarkets(valid ? mint : null);
  const top = topMarket(markets.data?.markets);
  const candles = useCandles(top?.pairAddress ?? null, interval);
  const mintAcct = useMintAccount(valid ? mint : null);

  const watched = useWatchlistStore((s) => s.lists.some((l) => l.items.some((i) => i.mint === mint)));
  const toggleToken = useWatchlistStore((s) => s.toggleToken);
  const hasBirdeye = useVaultStore((s) => Boolean(s.session['birdeye']));

  if (!valid) {
    return (
      <Panel className="m-3 rounded-none border">
        <EmptyState
          title="Not a valid Solana mint address"
          description={
            <>
              Iceberg Terminal keys every token by its mint. Pass a 32–44 character base58 address, e.g.{' '}
              <span className="font-mono text-cyan">So11111111111111111111111111111111111111112</span>.
            </>
          }
          action={
            <Button size="sm" onClick={() => navigate('/screener')}>
              Open screener
            </Button>
          }
        />
      </Panel>
    );
  }

  const fallback = markets.data?.fallback ?? candles.data?.fallback ?? null;
  const summary = summarise(top);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-auto">
      {fallback ? <DemoBanner reason={describeFallback(fallback)} /> : null}

      <div className="flex flex-wrap items-center gap-2 border-b border-edge bg-surface-1 px-3 py-2">
        <Button size="sm" variant="ghost" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft size={12} />
        </Button>
        <TokenCell mint={mint} symbol={top?.base.symbol ?? null} name={top?.base.name ?? null} logoUri={top?.imageUrl} />
        <AddressLink value={mint} kind="token" truncate={false} className="text-[11px]" />
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant={watched ? 'bull' : 'outline'} onClick={() => toggleToken(mint, top?.base.symbol)}>
            <Star size={11} /> {watched ? 'Watching' : 'Watch'}
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAlertOpen(true)}>
            <Bell size={11} /> Alert
          </Button>
          <Button size="sm" variant="ghost" onClick={() => window.open(explorerUrl('token', mint), '_blank', 'noopener,noreferrer')}>
            <ExternalLink size={11} /> Explorer
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-px border-b border-edge bg-edge sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Price" value={formatPrice(summary.priceUsd)} sub={summary.change24h != null ? <span className={changeToneClass(summary.change24h)}>{formatPct(summary.change24h)} 24h</span> : null} />
        <Metric label="Liquidity" value={formatUsdCompact(summary.liquidity)} sub={top?.dex ? `${top.dex} · ${top.chain}` : null} />
        <Metric label="Volume 24h" value={formatUsdCompact(summary.volume24h)} sub={summary.volume6h != null ? `6h ${formatUsdCompact(summary.volume6h)}` : null} />
        <Metric label="Mcap / FDV" value={formatUsdCompact(summary.marketCap)} sub={summary.fdv != null ? `FDV ${formatUsdCompact(summary.fdv)}` : null} />
        <Metric label="Txns 24h" value={formatCompactNumber(summary.txns24h)} sub={summary.buysSells} />
        <Metric label="Pool age" value={summary.createdAt ? formatAge(summary.createdAt) : NA} sub={top?.pairAddress ? <AddressLink value={top.pairAddress} kind="address" /> : null} />
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px bg-edge xl:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel className="h-[24rem] shrink-0 xl:h-[30rem]">
            <PanelHeader
              title="Price & volume"
              subtitle={`· ${top ? `${top.base.symbol ?? '—'}/${top.quote.symbol ?? '—'}` : 'no market'}`}
              actions={
                <>
                  <Select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value as CandleInterval)}
                    className="h-6 w-16"
                    aria-label="Timeframe"
                  >
                    {INTERVALS.map((i) => (
                      <option key={i} value={i}>
                        {i}
                      </option>
                    ))}
                  </Select>
                  <UpdatedAt timestamp={candles.dataUpdatedAt} isFetching={candles.isFetching} />
                </>
              }
            />
            <PanelBody className="relative p-0">
              {!top ? (
                markets.isLoading ? (
                  <LoadingState label="Loading markets" />
                ) : markets.isError ? (
                  <ErrorState error={markets.error} onRetry={() => void markets.refetch()} />
                ) : (
                  <EmptyState
                    title="No tradable market found for this mint"
                    description="The market-data provider returned zero pools for this address. The mint may have no indexed liquidity, or may not be a token mint."
                  />
                )
              ) : candles.isLoading ? (
                <LoadingState label="Loading candles" />
              ) : candles.isError ? (
                <ErrorState error={candles.error} onRetry={() => void candles.refetch()} />
              ) : (
                <>
                  <ChartLegend point={hover} last={candles.data?.series.candles.at(-1)} />
                  <CandleChart candles={candles.data?.series.candles ?? []} onCrosshair={setHover} />
                  <div className="pointer-events-none absolute right-2 top-1">
                    {candles.data ? <ProvenanceBadge origin={candles.data.series.provenance.origin} source={candles.data.source} /> : null}
                  </div>
                </>
              )}
            </PanelBody>
          </Panel>

          <PoolTable markets={markets.data?.markets ?? []} mint={mint} />
        </div>

        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <MetadataPanel mint={mint} mintAccount={mintAcct.data ?? null} />
          <SecurityPanel mint={mint} hasBirdeye={hasBirdeye} />
          <ActivityPanel mint={mint} />
        </div>
      </div>

      <AlertDialog open={alertOpen} onOpenChange={setAlertOpen} target={mint} symbol={top?.base.symbol ?? null} />
    </div>
  );
}

function summarise(top: Market | null) {
  if (!top) {
    return {
      priceUsd: null,
      change24h: null,
      liquidity: null,
      volume24h: null,
      volume6h: null,
      marketCap: null,
      fdv: null,
      txns24h: null,
      buysSells: null,
      createdAt: null,
    };
  }
  const buys = top.txns?.h24?.buys ?? null;
  const sells = top.txns?.h24?.sells ?? null;
  return {
    priceUsd: top.priceUsd,
    change24h: top.priceChange?.h24 ?? null,
    liquidity: top.liquidity?.usd ?? null,
    volume24h: top.volume?.h24 ?? null,
    volume6h: top.volume?.h6 ?? null,
    marketCap: top.marketCap,
    fdv: top.fdv,
    txns24h: buys !== null || sells !== null ? (buys ?? 0) + (sells ?? 0) : null,
    buysSells: buys !== null || sells !== null ? `${formatCompactNumber(buys)} buy / ${formatCompactNumber(sells)} sell` : null,
    createdAt: top.pairCreatedAt,
  };
}

function Metric({ label, value, sub }: { label: string; value: React.ReactNode; sub?: React.ReactNode }) {
  return (
    <div className="bg-surface-1 px-3 py-2">
      <div className="text-2xs font-semibold uppercase tracking-wider text-dim">{label}</div>
      <div className="tnum mt-0.5 truncate text-sm text-slate-100">{value}</div>
      {sub ? <div className="mt-0.5 truncate font-mono text-[10px] text-dim">{sub}</div> : null}
    </div>
  );
}

function PoolTable({ markets, mint }: { markets: Market[]; mint: string }) {
  if (markets.length === 0) return null;
  return (
    <Panel className="min-h-[12rem] flex-1">
      <PanelHeader title="Pools & DEXs" subtitle={`· ${markets.length} markets`} />
      <PanelBody>
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">DEX</th>
              <th scope="col">Pair</th>
              <th scope="col" className="text-right">Price</th>
              <th scope="col" className="text-right">Liquidity</th>
              <th scope="col" className="text-right">Volume 24h</th>
              <th scope="col" className="text-right">Txns 24h</th>
            </tr>
          </thead>
          <tbody>
            {markets.map((m) => {
              const b = m.txns?.h24?.buys ?? 0;
              const s = m.txns?.h24?.sells ?? 0;
              return (
                <tr key={m.id}>
                  <td className="text-slate-300">{m.dex ?? NA}</td>
                  <td>
                    <span className="font-mono text-[10px] text-slate-400">
                      {m.base.symbol ?? '—'}/{m.quote.symbol ?? '—'}
                      {m.base.address === mint ? (
                        <Badge tone="info" className="ml-1.5">
                          BASE
                        </Badge>
                      ) : (
                        <Badge className="ml-1.5">QUOTE</Badge>
                      )}
                    </span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-200">{formatPrice(m.priceUsd)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatUsdCompact(m.liquidity?.usd ?? null)}</span>
                  </td>
                  <td className="text-right">
                    <span className="tnum text-slate-300">{formatUsdCompact(m.volume?.h24 ?? null)}</span>
                  </td>
                  <td className="text-right">
                    <span className={cn('tnum text-[10px]')}>
                      <span className="text-bull">{formatCompactNumber(b)}</span>
                      <span className="text-dim"> / </span>
                      <span className="text-bear">{formatCompactNumber(s)}</span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </PanelBody>
    </Panel>
  );
}

function MetadataPanel({
  mint,
  mintAccount,
}: {
  mint: string;
  mintAccount: { decimals: number | null; supply: number | null; mintAuthority: string | null; freezeAuthority: string | null; programOwner: string | null } | null;
}) {
  return (
    <Panel>
      <PanelHeader title="Token metadata" subtitle="· on-chain" />
      <PanelBody className="p-2">
        <dl className="space-y-1.5">
          <Row label="Mint address">
            <AddressLink value={mint} kind="token" truncate={false} />
          </Row>
          <Row label="Decimals">{mintAccount?.decimals ?? NA}</Row>
          <Row label="Supply">{mintAccount?.supply != null ? formatCompactNumber(mintAccount.supply) : NA}</Row>
          <Row label="Program owner">
            {mintAccount?.programOwner ? <AddressLink value={mintAccount.programOwner} /> : <span className="text-dim">{NA} — RPC lookup failed</span>}
          </Row>
        </dl>
        <p className="mt-2 border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
          Read directly from the Solana cluster via your configured RPC. A missing value means the RPC did not return
          that field — it is not a zero.
        </p>
      </PanelBody>
    </Panel>
  );
}

/**
 * Risk panel.
 *
 * Two independent sources, both labelled:
 *  • RPC mint-account facts (authorities) — always observed, never inferred.
 *  • Birdeye provider signals — only present when the user configured a key.
 * No composite "safety score" is invented.
 */
function SecurityPanel({ mint, hasBirdeye }: { mint: string; hasBirdeye: boolean }) {
  const security = useTokenSecurity(mint);
  const mintAcct = useMintAccount(mint);
  const data = security.data?.security;

  return (
    <Panel>
      <PanelHeader
        title="Risk indicators"
        icon={<ShieldAlert size={12} />}
        subtitle="· observed facts only"
      />
      <PanelBody className="p-2">
        <dl className="space-y-1.5">
          <Row label="Mint authority">
            <AuthorityPill value={mintAcct.data?.mintAuthority ?? null} inverted />
          </Row>
          <Row label="Freeze authority">
            <AuthorityPill value={mintAcct.data?.freezeAuthority ?? null} inverted />
          </Row>
          <Row label="Birdeye score">{data?.overallScore != null ? `${data.overallScore}/100` : <span className="text-dim">not available</span>}</Row>
        </dl>

        {data?.riskSignals.length ? (
          <ul className="mt-2 space-y-1 border-t border-edge pt-2">
            {data.riskSignals.map((s, i) => (
              <li key={`${s.label}-${i}`} className="flex items-start gap-1.5 text-[10px]">
                <Badge tone={s.severity === 'risk' ? 'bear' : s.severity === 'warn' ? 'warn' : 'neutral'}>{s.severity}</Badge>
                <span className="min-w-0 flex-1">
                  <span className="text-slate-400">{s.label}: </span>
                  <span className="break-all font-mono text-slate-300">{s.value}</span>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-2 border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
            {!hasBirdeye ? (
              <>
                No analytics provider configured. Add a Birdeye key in{' '}
                <Link to="/settings" className="link">
                  Settings › Providers
                </Link>{' '}
                for provider-computed security signals and holder data.
              </>
            ) : security.isLoading ? (
              'Loading Birdeye signals…'
            ) : security.isError ? (
              'Birdeye request failed — see the token provider settings.'
            ) : (
              'Birdeye returned no risk signals for this mint.'
            )}
          </div>
        )}
      </PanelBody>
    </Panel>
  );
}

function AuthorityPill({ value, inverted }: { value: string | null; inverted?: boolean }) {
  if (value === null) return <span className="text-dim">{NA} — RPC lookup failed</span>;
  const active = value !== '';
  const label = active ? 'ACTIVE' : 'REVOKED';
  const tone = inverted ? (active ? 'bear' : 'bull') : active ? 'bull' : 'neutral';
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <Badge tone={tone}>{label}</Badge>
        </span>
      </TooltipTrigger>
      <TooltipContent>
        {active ? 'An authority is still assigned and can perform this action.' : 'The authority has been set to null on chain.'}
      </TooltipContent>
    </Tooltip>
  );
}

function ActivityPanel({ mint }: { mint: string }) {
  const activity = useWalletActivity([mint], 10);
  return (
    <Panel className="min-h-[12rem] flex-1">
      <PanelHeader
        title="Recent transactions"
        subtitle="· signature-level"
        actions={<UpdatedAt timestamp={activity.dataUpdatedAt} isFetching={activity.isFetching} />}
      />
      <PanelBody>
        {activity.isLoading ? (
          <LoadingState label="Loading signatures" />
        ) : activity.isError ? (
          <ErrorState error={activity.error} onRetry={() => void activity.refetch()} compact />
        ) : (activity.data?.records.length ?? 0) === 0 ? (
          <EmptyState
            title="No recent signatures"
            description="Your RPC node returned no recent transactions involving this mint. Increase the window or use a dedicated RPC."
            icon={<Info size={14} />}
          />
        ) : (
          <ul className="divide-y divide-edge/60">
            {activity.data!.records.slice(0, 10).map((r) => (
              <li key={r.signature} className="flex items-center gap-2 px-2 py-1.5">
                <Link to={`/tx/${r.signature}`} className="min-w-0 flex-1 overflow-hidden">
                  <AddressLink value={r.signature} kind="tx" />
                </Link>
                <span className="shrink-0 text-[10px] text-dim">{formatDateTime(r.blockTime)}</span>
                <Badge tone={r.status === 'success' ? 'bull' : 'bear'}>{r.status}</Badge>
              </li>
            ))}
          </ul>
        )}
      </PanelBody>
    </Panel>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-2xs uppercase tracking-wider text-dim">{label}</dt>
      <dd className="min-w-0 truncate text-right text-[11px] text-slate-300">{children}</dd>
    </div>
  );
}

export { NA as _NA };