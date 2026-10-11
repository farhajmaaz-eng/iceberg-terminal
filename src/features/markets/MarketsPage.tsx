import * as React from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Flame, Info, Plus, Star } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Select } from '@/components/ui/input';
import { DemoBanner, EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { SparklineCell } from '@/components/charts/sparkline-cell';
import { CandleChart, ChartLegend } from '@/components/charts/candle-chart';
import { ChangeCell, PriceCell, SortHeader, TokenCell } from '@/components/tables/cells';
import { cn } from '@/lib/utils';
import {
  changeToneClass,
  compact,
  formatAge,
  formatCompactNumber,
  formatPct,
  formatPrice,
  formatUsdCompact,
} from '@/lib/format';
import { SOL_MINT, USDC_MINT, USDT_MINT } from '@/lib/constants';
import { useAssetOverview, useCandles, useDiscoverTokens, useTokenMarkets, useWatchlistRows } from '@/data/queries';
import { describeFallback } from '@/data/fallback';
import { useWatchlistStore } from '@/store/watchlists';
import { useProviderStore } from '@/store/providers';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import type { CandleInterval, TokenMarketSummary } from '@/types/models';
import { openPalette } from '@/features/command/command-palette';

const INTERVALS: { value: CandleInterval; label: string }[] = [
  { value: '1m', label: '1m' },
  { value: '5m', label: '5m' },
  { value: '15m', label: '15m' },
  { value: '1h', label: '1H' },
  { value: '4h', label: '4H' },
  { value: '1d', label: '1D' },
  { value: '1w', label: '1W' },
];

/**
 * Reference SOL/USDC pool.
 *
 * Resolved at runtime from the deepest SOL pool quoted in a stablecoin so the
 * chart tracks the venue with real depth rather than a hard-coded address that
 * could go stale. Falls back to the long-lived Orca SOL/USDC pool if the
 * lookup fails, and to deterministic demo candles if both fail.
 */
export function useSolUsdcPool(): string | null {
  const markets = useTokenMarkets(SOL_MINT);
  return React.useMemo(() => {
    const pools = markets.data?.markets ?? [];
    if (pools.length === 0) return null;
    const stableQuote = pools.filter(
      (m) => m.quote.address === USDC_MINT || m.quote.address === USDT_MINT,
    );
    const pool = (stableQuote.length ? stableQuote : pools).sort(
      (a, b) => (b.liquidity?.usd ?? -1) - (a.liquidity?.usd ?? -1),
    )[0];
    return pool?.pairAddress ?? null;
  }, [markets.data]);
}

export function MarketsPage() {
  const [interval, setInterval] = React.useState<CandleInterval>('1h');
  const [hover, setHover] = React.useState<null | { time: number; open: number; high: number; low: number; close: number }>(null);

  const solPool = useSolUsdcPool();
  const overview = useAssetOverview('solana');
  const candles = useCandles(solPool, interval);
  const movers = useDiscoverTokens('trending', 24);
  const watchlist = useWatchlistStore((s) => s.lists);
  const activeListId = useWatchlistStore((s) => s.activeListId);
  const activeList = watchlist.find((l) => l.id === activeListId) ?? watchlist[0];
  const toggleToken = useWatchlistStore((s) => s.toggleToken);
  const forceDemo = useProviderStore((s) => s.forceDemo);

  const symbols = React.useMemo(() => {
    const map: Record<string, string | null> = {};
    for (const list of watchlist) for (const i of list.items) map[i.mint] = i.symbol ?? null;
    return map;
  }, [watchlist]);

  const mints = activeList?.items.map((i) => i.mint) ?? [];
  const rows = useWatchlistRows(mints, symbols);

  const o = overview.data?.overview;
  const anyDemo = forceDemo || Boolean(overview.data?.fallback) || Boolean(candles.data?.fallback);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {anyDemo ? <DemoBanner reason={describeFallback(overview.data?.fallback ?? candles.data?.fallback)} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-px overflow-auto bg-edge xl:grid-cols-[minmax(0,1fr)_minmax(0,420px)] xl:overflow-hidden">
        {/* ── Left: SOL overview + chart ─────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel className="h-[24rem] shrink-0 xl:h-auto xl:min-h-0 xl:flex-1">
            <PanelHeader
              title="SOL / USDC"
              icon={<SparklineIcon />}
              subtitle={`· ${candles.data?.source ?? 'OHLCV'}`}
              actions={
                <>
                  <UpdatedAt
                    timestamp={candles.dataUpdatedAt}
                    isFetching={candles.isFetching}
                    isStale={overview.isError && !overview.isLoading}
                  />
                  <Select
                    value={interval}
                    onChange={(e) => setInterval(e.target.value as CandleInterval)}
                    className="h-6 w-16"
                    aria-label="Chart timeframe"
                  >
                    {INTERVALS.map((i) => (
                      <option key={i.value} value={i.value}>
                        {i.label}
                      </option>
                    ))}
                  </Select>
                </>
              }
            />
            <PanelBody className="relative p-0">
              {candles.isLoading ? (
                <LoadingState label="Loading candles" />
              ) : candles.isError ? (
                <ErrorState error={candles.error} onRetry={() => void candles.refetch()} />
              ) : (
                <>
                  <ChartLegend point={hover} last={candles.data?.series.candles.at(-1)} />
                  <CandleChart
                    candles={candles.data?.series.candles ?? []}
                    onCrosshair={(p) => setHover(p)}
                    label="SOL/USDC candlestick chart with volume histogram"
                  />
                  <div className="pointer-events-none absolute bottom-1 right-2 flex items-center gap-2">
                    {candles.data ? (
                      <ProvenanceBadge
                        origin={candles.data.series.provenance.origin}
                        source={candles.data.source}
                        stale={overview.isError}
                      />
                    ) : null}
                  </div>
                </>
              )}
            </PanelBody>
          </Panel>

          <div className="grid grid-cols-1 gap-px bg-edge sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="SOL price"
              value={overview.isLoading ? '…' : formatPrice(o?.priceUsd ?? null)}
              sub={
                overview.isError ? (
                  <span className="text-bear">unavailable — {overview.error.message}</span>
                ) : o?.change24h != null ? (
                  <span className={changeToneClass(o.change24h)}>{formatPct(o.change24h)} 24h</span>
                ) : (
                  '24h change not reported'
                )
              }
              updated={overview.dataUpdatedAt}
              fetching={overview.isFetching}
            />
            <StatTile
              label="24h volume"
              value={formatUsdCompact(o?.volume24h ?? null)}
              sub={overview.isError ? <span className="text-bear">unavailable</span> : 'CoinGecko aggregate across venues'}
              updated={overview.dataUpdatedAt}
              fetching={overview.isFetching}
            />
            <StatTile
              label="Market cap"
              value={formatUsdCompact(o?.marketCap ?? null)}
              sub={
                overview.isError ? (
                  <span className="text-bear">unavailable</span>
                ) : o?.circulatingSupply != null ? (
                  `${compact(o.circulatingSupply)} SOL circulating`
                ) : (
                  'supply not reported'
                )
              }
              updated={overview.dataUpdatedAt}
              fetching={overview.isFetching}
            />
            <StatTile
              label="ATH / rank"
              value={o?.ath != null ? `${formatPrice(o.ath)}` : '—'}
              sub={
                overview.isError ? (
                  <span className="text-bear">unavailable</span>
                ) : o?.athChangePercent != null ? (
                  `${formatPct(o.athChangePercent)} from ATH · rank #${o.rank ?? '—'}`
                ) : (
                  'ATH not reported'
                )
              }
              updated={overview.dataUpdatedAt}
              fetching={overview.isFetching}
            />
          </div>

          <Panel className="min-h-[16rem] shrink-0 xl:flex-1">
            <PanelHeader
              title="Trending pools · Solana"
              icon={<Flame size={12} />}
              subtitle="· last 24h"
              actions={<UpdatedAt timestamp={movers.dataUpdatedAt} isFetching={movers.isFetching} />}
            />
            <PanelBody>
              {movers.isLoading ? (
                <LoadingState label="Loading trending pools" />
              ) : movers.isError ? (
                <ErrorState error={movers.error} onRetry={() => void movers.refetch()} compact />
              ) : (
                <MoversTable tokens={movers.data?.tokens ?? []} onToggle={toggleToken} />
              )}
            </PanelBody>
          </Panel>
        </div>

        {/* ── Right: watchlist rail ──────────────────────────────────── */}
        <div className="flex min-h-0 flex-col gap-px bg-edge">
          <Panel className="min-h-[12rem] shrink-0 xl:min-h-0 xl:flex-1">
            <PanelHeader
              title={`Watchlist · ${activeList?.name ?? '—'}`}
              icon={<Star size={12} />}
              actions={
                <>
                  <UpdatedAt timestamp={overview.dataUpdatedAt} isFetching={overview.isFetching} />
                  <Button size="sm" variant="ghost" onClick={() => openPalette('search', '')} aria-label="Search tokens">
                    <Plus size={11} /> Add
                  </Button>
                </>
              }
            />
            <PanelBody>
              {rows.length === 0 ? (
                <EmptyState
                  title="No tokens in this watchlist"
                  description={
                    <>
                      Press <span className="kbd">⌘K</span> and run <span className="font-mono text-cyan">WATCH &lt;mint&gt;</span>,
                      or use the Add button above.
                    </>
                  }
                  icon={<Star size={16} />}
                />
              ) : (
                <table className="data-table">
                  <thead>
                    <tr>
                      <th scope="col">Asset</th>
                      <SortHeader label="Price" field="price" active={null} dir="desc" onSort={() => {}} />
                      <SortHeader label="24h" field="change" active={null} dir="desc" onSort={() => {}} />
                      <th scope="col" className="text-right">
                        7d
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.mint}>
                        <td>
                          <TokenCell mint={r.mint} symbol={r.symbol} size="sm" />
                        </td>
                        <td className="text-right">
                          <PriceCell value={r.priceUsd} />
                        </td>
                        <td className="text-right">
                          <ChangeCell value={r.change24h} />
                        </td>
                        <td className="text-right">
                          <SparklineCell data={r.sparkline} width={64} height={18} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </PanelBody>
          </Panel>

          <LiquidityFlowPanel />
        </div>
      </div>
    </div>
  );
}

function SparklineIcon() {
  return <Info size={12} />;
}

function StatTile({
  label,
  value,
  sub,
  updated,
  fetching,
}: {
  label: string;
  value: string;
  sub: React.ReactNode;
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
      <div className="mt-0.5 truncate font-mono text-[10px] text-dim">{sub}</div>
    </div>
  );
}

function MoversTable({
  tokens,
  onToggle,
}: {
  tokens: TokenMarketSummary[];
  onToggle: (mint: string, symbol?: string | null) => boolean;
}) {
  const [sortKey, setSortKey] = React.useState<'volume24h' | 'change24h' | 'liquidityUsd'>('volume24h');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');

  const onSort = (field: 'volume24h' | 'change24h' | 'liquidityUsd') => {
    if (field === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(field);
      setDir('desc');
    }
  };

  const sorted = React.useMemo(() => {
    return [...tokens].sort((a, b) => {
      const av = a[sortKey] ?? -Infinity;
      const bv = b[sortKey] ?? -Infinity;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }, [tokens, sortKey, dir]);

  if (tokens.length === 0) {
    return <EmptyState title="No pools returned" description="The provider returned an empty result set for this segment." />;
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th scope="col">Market</th>
          <SortHeader label="Price" field="price" active={null} dir="desc" onSort={() => {}} />
          <SortHeader label="Change" field={sortKey === 'change24h' ? 'change24h' : 'price'} active={sortKey === 'change24h' ? 'change24h' : null} dir={dir} onSort={() => onSort('change24h')} />
          <SortHeader label="Liquidity" field={sortKey === 'liquidityUsd' ? 'liquidityUsd' : 'price'} active={sortKey === 'liquidityUsd' ? 'liquidityUsd' : null} dir={dir} onSort={() => onSort('liquidityUsd')} />
          <SortHeader label="Volume 24h" field={sortKey === 'volume24h' ? 'volume24h' : 'price'} active={sortKey === 'volume24h' ? 'volume24h' : null} dir={dir} onSort={() => onSort('volume24h')} />
          <th scope="col" className="text-right">
            Txns
          </th>
          <th scope="col" className="w-8" />
        </tr>
      </thead>
      <tbody>
        {sorted.map((t) => (
          <tr key={t.address}>
            <td>
              <TokenCell
                mint={t.address}
                symbol={t.symbol}
                name={t.quoteSymbol ? `${t.quoteSymbol} · ${t.topDex ?? 'DEX'}` : t.topDex}
                size="sm"
              />
            </td>
            <td className="text-right">
              <PriceCell value={t.priceUsd} />
            </td>
            <td className="text-right">
              <ChangeCell value={t.change24h} />
            </td>
            <td className="text-right">
              <span className="tnum text-slate-300">{formatUsdCompact(t.liquidityUsd)}</span>
            </td>
            <td className="text-right">
              <span className="tnum text-slate-300">{formatUsdCompact(t.volume24h)}</span>
            </td>
            <td className="text-right">
              <span className="tnum text-dim">{formatCompactNumber(t.txns24h)}</span>
            </td>
            <td className="text-right">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    onClick={() => onToggle(t.address, t.symbol)}
                    aria-label={`Watch ${t.symbol ?? t.address}`}
                  >
                    <Star size={11} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Toggle watchlist</TooltipContent>
              </Tooltip>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/**
 * Liquidity / flow panel on the markets rail.
 *
 * Every number here is an OBSERVED value from the provider with the
 * calculation stated in the tooltip. Nothing is predictive.
 */
function LiquidityFlowPanel() {
  const movers = useDiscoverTokens('trending', 24);

  const stats = React.useMemo(() => {
    const tokens = movers.data?.tokens ?? [];
    const totalLiq = tokens.reduce((acc, t) => acc + (t.liquidityUsd ?? 0), 0);
    const totalVol = tokens.reduce((acc, t) => acc + (t.volume24h ?? 0), 0);
    const liqValues = tokens.map((t) => t.liquidityUsd).filter((v): v is number => v !== null);
    const volToLiq = totalLiq > 0 ? totalVol / totalLiq : null;
    const volToLiqs = tokens
      .filter((t) => t.liquidityUsd && t.liquidityUsd > 0 && t.volume24h)
      .map((t) => (t.volume24h ?? 0) / (t.liquidityUsd ?? 1));
    const medianTurnover = volToLiqs.length ? [...volToLiqs].sort((a, b) => a - b)[Math.floor(volToLiqs.length / 2)]! : null;
    const freshest = tokens.reduce<(TokenMarketSummary | null)>((best, t) => {
      if (t.createdAt === null) return best;
      if (!best || best.createdAt === null) return t;
      return t.createdAt > best.createdAt ? t : best;
    }, null);
    return {
      totalLiq,
      totalVol,
      volToLiq,
      medianTurnover,
      medianLiq: liqValues.length ? [...liqValues].sort((a, b) => a - b)[Math.floor(liqValues.length / 2)]! : null,
      freshest,
      deepest: [...tokens].sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0))[0] ?? null,
    };
  }, [movers.data]);

  return (
    <Panel className="max-h-[22rem]">
      <PanelHeader title="Liquidity & flow" subtitle="· observed" actions={<UpdatedAt timestamp={movers.dataUpdatedAt} isFetching={movers.isFetching} />} />
      <PanelBody className="p-2">
        {movers.isLoading ? (
          <LoadingState label="Computing flows" />
        ) : movers.isError ? (
          <ErrorState error={movers.error} onRetry={() => void movers.refetch()} compact />
        ) : (
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Metric
              label="Aggregate liquidity"
              value={formatUsdCompact(stats.totalLiq || null)}
              hint="Sum of pool reserve value in USD across the pools in this list."
            />
            <Metric label="Aggregate volume 24h" value={formatUsdCompact(stats.totalVol || null)} hint="Sum of 24h USD volume for the same pools." />
            <Metric
              label="Volume / liquidity"
              value={stats.volToLiq != null ? `${stats.volToLiq.toFixed(2)}×` : '—'}
              hint="Aggregate 24h volume divided by aggregate liquidity. A turnover ratio, not a forecast."
            />
            <Metric
              label="Median pool liquidity"
              value={formatUsdCompact(stats.medianLiq ?? null)}
              hint="Median USD liquidity across the listed pools."
            />
            <Metric
              label="Newest pool"
              value={stats.freshest ? formatAge(stats.freshest.createdAt) : '—'}
              hint="Age of the most recently created pool in this list, per provider data."
            />
            <Metric
              label="Deepest pool"
              value={
                stats.deepest?.symbol ? (
                  <Link to={`/token/${stats.deepest.address}`} className="link">
                    {stats.deepest.symbol} <ArrowUpRight size={9} className="inline" />
                  </Link>
                ) : (
                  '—'
                )
              }
              hint="Pool with the highest reported liquidity."
            />
          </dl>
        )}
        <p className="mt-2 border-t border-edge pt-2 text-[10px] leading-relaxed text-dim">
          These are <strong className="text-slate-400">observed</strong> provider values with the arithmetic stated above.
          Iceberg does not derive predictive signals from them, and no alert implies a future price.
        </p>
      </PanelBody>
    </Panel>
  );
}

function Metric({ label, value, hint }: { label: string; value: React.ReactNode; hint: string }) {
  return (
    <div className={cn('min-w-0')}>
      <dt className="flex items-center gap-1 text-2xs uppercase tracking-wider text-dim">
        {label}
        <Tooltip>
          <TooltipTrigger asChild>
            <Info size={9} className="cursor-help text-dim" />
          </TooltipTrigger>
          <TooltipContent>{hint}</TooltipContent>
        </Tooltip>
      </dt>
      <dd className="tnum mt-0.5 truncate text-xs text-slate-200">{value}</dd>
    </div>
  );
}

export { SOL_MINT, USDC_MINT, Badge };