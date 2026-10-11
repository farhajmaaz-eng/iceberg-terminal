import * as React from 'react';
import { Filter, Info, RotateCw, Star, X } from 'lucide-react';
import { Badge, ProvenanceBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { DemoBanner, EmptyState, ErrorState, LoadingState, UpdatedAt } from '@/components/ui/states';
import { SparklineCell } from '@/components/charts/sparkline-cell';
import { SortHeader, TokenCell } from '@/components/tables/cells';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { formatAge, formatCompactNumber, formatPrice, formatUsdCompact, NA } from '@/lib/format';
import { useDiscoverTokens } from '@/data/queries';
import { describeFallback } from '@/data/fallback';
import { useWatchlistStore } from '@/store/watchlists';
import { useProviderStore } from '@/store/providers';
import type { TokenMarketSummary } from '@/types/models';

/**
 * Token screener.
 *
 * Coverage limitation is stated in-app: DexScreener's public discovery
 * endpoints return a bounded, provider-curated slice of new/boosted/profiled
 * tokens (30 per request) — not the full Solana token universe. Filtering is
 * therefore LOCAL over that retrieved slice unless a provider offers
 * server-side filtering, and the UI says so.
 */

type Segment = 'trending' | 'new' | 'boosted' | 'profiled';
type SortKey = 'liquidityUsd' | 'volume24h' | 'change24h' | 'marketCap' | 'txns24h' | 'createdAt';

interface Filters {
  minLiquidity: number | null;
  minVolume: number | null;
  minMarketCap: number | null;
  maxChange: number | null;
  minChange: number | null;
  maxAgeHours: number | null;
}

const EMPTY: Filters = {
  minLiquidity: null,
  minVolume: null,
  minMarketCap: null,
  maxChange: null,
  minChange: null,
  maxAgeHours: null,
};

const NUMERIC_FIELDS: (keyof Filters)[] = ['minLiquidity', 'minVolume', 'minMarketCap', 'maxChange', 'minChange'];

export function ScreenerPage() {
  const [segment, setSegment] = React.useState<Segment>('trending');
  const [filters, setFilters] = React.useState<Filters>(EMPTY);
  const [sortKey, setSortKey] = React.useState<SortKey>('liquidityUsd');
  const [dir, setDir] = React.useState<'asc' | 'desc'>('desc');

  const query = useDiscoverTokens(segment, 30);
  const toggleToken = useWatchlistStore((s) => s.toggleToken);
  const forceDemo = useProviderStore((s) => s.forceDemo);

  const tokens = React.useMemo(() => query.data?.tokens ?? [], [query.data]);

  const filtered = React.useMemo(() => applyFilters(tokens, filters), [tokens, filters]);
  const sorted = React.useMemo(() => {
    return [...filtered].sort((a, b) => {
      const av = valueFor(a, sortKey);
      const bv = valueFor(b, sortKey);
      // nulls always sort last, regardless of direction — a missing value is
      // not a zero and must never masquerade as the smallest number.
      if (av === null && bv === null) return 0;
      if (av === null) return 1;
      if (bv === null) return -1;
      return dir === 'asc' ? av - bv : bv - av;
    });
  }, [filtered, sortKey, dir]);

  const onSort = (field: SortKey) => {
    if (field === sortKey) setDir(dir === 'asc' ? 'desc' : 'asc');
    else {
      setSortKey(field);
      setDir(field === 'createdAt' ? 'desc' : 'desc');
    }
  };

  const activeFilterCount = Object.values(filters).filter((v) => v !== null).length;
  const coverageNote =
    segment === 'trending'
      ? 'GeckoTerminal trending pools (last 24h), top 30.'
      : segment === 'new'
        ? 'GeckoTerminal new pools, top 30.'
        : `DexScreener ${segment} tokens, top 30.`;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {forceDemo || query.data?.fallback ? (
        <DemoBanner reason={describeFallback(query.data?.fallback)} />
      ) : null}

      <div className="border-b border-edge bg-surface-1 px-3 py-2">
        <div className="flex flex-wrap items-end gap-3">
          <div className="flex items-end gap-2">
            <Label hint="Provider discovery segment">
              Segment
              <Select
                value={segment}
                onChange={(e) => setSegment(e.target.value as Segment)}
                className="w-36"
                aria-label="Screener segment"
              >
                <option value="trending">Trending pools</option>
                <option value="new">New pools</option>
                <option value="boosted">Boosted tokens</option>
                <option value="profiled">Profiled tokens</option>
              </Select>
            </Label>
          </div>

          <FilterField
            label="Min liquidity"
            suffix="USD"
            value={filters.minLiquidity}
            onChange={(v) => setFilters((f) => ({ ...f, minLiquidity: v }))}
          />
          <FilterField
            label="Min volume 24h"
            suffix="USD"
            value={filters.minVolume}
            onChange={(v) => setFilters((f) => ({ ...f, minVolume: v }))}
          />
          <FilterField
            label="Min mcap"
            suffix="USD"
            value={filters.minMarketCap}
            onChange={(v) => setFilters((f) => ({ ...f, minMarketCap: v }))}
          />
          <FilterField
            label="24h ≥ %"
            suffix="%"
            value={filters.minChange}
            onChange={(v) => setFilters((f) => ({ ...f, minChange: v }))}
          />
          <FilterField
            label="24h ≤ %"
            suffix="%"
            value={filters.maxChange}
            onChange={(v) => setFilters((f) => ({ ...f, maxChange: v }))}
          />
          <Label hint="Pool age in hours">
            Max age (h)
            <Input
              type="number"
              min={0}
              className="w-20"
              value={filters.maxAgeHours ?? ''}
              onChange={(e) =>
                setFilters((f) => ({ ...f, maxAgeHours: e.target.value === '' ? null : Number(e.target.value) }))
              }
            />
          </Label>

          <div className="ml-auto flex items-center gap-2">
            {activeFilterCount > 0 ? (
              <Button size="sm" variant="ghost" onClick={() => setFilters(EMPTY)}>
                <X size={11} /> Clear ({activeFilterCount})
              </Button>
            ) : null}
            <Button size="sm" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              <RotateCw size={11} className={query.isFetching ? 'animate-spin' : ''} /> Refresh
            </Button>
          </div>
        </div>
      </div>

      <Panel className="min-h-0 flex-1 rounded-none border-0">
        <PanelHeader
          title="Token screener"
          icon={<Filter size={12} />}
          subtitle={`· ${sorted.length} of ${tokens.length} shown`}
          actions={
            <>
              {query.data ? <ProvenanceBadge origin={query.data.tokens[0]?.provenance.origin ?? 'live'} source={query.data.source} /> : null}
              <UpdatedAt timestamp={query.dataUpdatedAt} isFetching={query.isFetching} />
            </>
          }
        />
        <PanelBody>
          {query.isLoading ? (
            <LoadingState label="Retrieving tokens" />
          ) : query.isError ? (
            <ErrorState error={query.error} onRetry={() => void query.refetch()} />
          ) : sorted.length === 0 ? (
            <EmptyState
              title={tokens.length === 0 ? 'Provider returned no tokens' : 'No tokens match these filters'}
              description={
                tokens.length === 0 ? (
                  <>The provider returned an empty list for the “{segment}” segment.</>
                ) : (
                  <>
                    {tokens.length} tokens were retrieved. Relax the filters to see them.
                  </>
                )
              }
              icon={<Filter size={16} />}
              action={
                activeFilterCount > 0 ? (
                  <Button size="sm" onClick={() => setFilters(EMPTY)}>
                    Clear filters
                  </Button>
                ) : null
              }
            />
          ) : (
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col" className="sticky left-0 z-10 bg-surface-2">Token</th>
                  <th scope="col" className="text-right">Price</th>
                  <SortHeader label="24h" field="change24h" active={sortKey} dir={dir} onSort={onSort} />
                  <SortHeader label="Liquidity" field="liquidityUsd" active={sortKey} dir={dir} onSort={onSort} />
                  <SortHeader label="Volume 24h" field="volume24h" active={sortKey} dir={dir} onSort={onSort} />
                  <SortHeader label="Mcap / FDV" field="marketCap" active={sortKey} dir={dir} onSort={onSort} />
                  <SortHeader label="Txns 24h" field="txns24h" active={sortKey} dir={dir} onSort={onSort} />
                  <SortHeader label="Age" field="createdAt" active={sortKey} dir={dir} onSort={onSort} />
                  <th scope="col" className="text-right">7d</th>
                  <th scope="col" className="w-8" />
                </tr>
              </thead>
              <tbody>
                {sorted.map((t) => (
                  <tr key={t.address}>
                    <td className="sticky left-0 z-[5] bg-surface-1">
                      <TokenCell
                        mint={t.address}
                        symbol={t.symbol}
                        name={t.quoteSymbol ? `${t.quoteSymbol} · ${t.topDex ?? '—'}` : t.topDex}
                        logoUri={t.logoUri}
                      />
                    </td>
                    <td className="text-right">
                      <span className="tnum text-slate-200">{formatPrice(t.priceUsd)}</span>
                    </td>
                    <td className="text-right">
                      <span
                        className={cn(
                          'tnum font-medium',
                          t.change24h === null ? 'text-dim' : t.change24h > 0 ? 'text-bull' : t.change24h < 0 ? 'text-bear' : 'text-dim',
                        )}
                      >
                        {t.change24h === null ? NA : `${t.change24h > 0 ? '+' : ''}${t.change24h.toFixed(2)}%`}
                      </span>
                    </td>
                    <td className="text-right">
                      <span className="tnum text-slate-300">{formatUsdCompact(t.liquidityUsd)}</span>
                    </td>
                    <td className="text-right">
                      <span className="tnum text-slate-300">{formatUsdCompact(t.volume24h)}</span>
                    </td>
                    <td className="text-right">
                      <span className="tnum text-slate-400">{formatUsdCompact(t.marketCap ?? t.fdv)}</span>
                    </td>
                    <td className="text-right">
                      <span className="tnum text-dim">{formatCompactNumber(t.txns24h)}</span>
                    </td>
                    <td className="text-right">
                      <span className="tnum text-dim">{t.createdAt ? formatAge(t.createdAt) : NA}</span>
                    </td>
                    <td className="text-right">
                      <SparklineCell data={null} width={60} height={16} />
                    </td>
                    <td className="text-right">
                      <Button size="icon-sm" variant="ghost" onClick={() => toggleToken(t.address, t.symbol)} aria-label={`Watch ${t.symbol ?? ''}`}>
                        <Star size={11} />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </PanelBody>
      </Panel>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-edge bg-surface-1 px-3 py-1.5 text-[10px] leading-relaxed text-dim">
        <span className="flex items-center gap-1">
          <Info size={10} /> Coverage: {coverageNote}
        </span>
        <span>
          Filtering is applied <strong className="text-slate-400">locally</strong> to the retrieved slice; these
          providers do not expose a server-side filter for this dataset.
        </span>
        <span>
          Fields shown as <span className="font-mono">{NA}</span> were not reported by the provider — they are not
          zeros. Holder counts and insider metrics are not published by these providers and are therefore never shown.
        </span>
      </div>
    </div>
  );
}

function valueFor(t: TokenMarketSummary, key: SortKey): number | null {
  switch (key) {
    case 'liquidityUsd':
      return t.liquidityUsd;
    case 'volume24h':
      return t.volume24h;
    case 'change24h':
      return t.change24h;
    case 'marketCap':
      return t.marketCap ?? t.fdv;
    case 'txns24h':
      return t.txns24h;
    case 'createdAt':
      return t.createdAt;
    default:
      return null;
  }
}

export function applyFilters(tokens: TokenMarketSummary[], f: Filters): TokenMarketSummary[] {
  return tokens.filter((t) => {
    if (f.minLiquidity !== null && (t.liquidityUsd === null || t.liquidityUsd < f.minLiquidity)) return false;
    if (f.minVolume !== null && (t.volume24h === null || t.volume24h < f.minVolume)) return false;
    if (f.minMarketCap !== null) {
      const cap = t.marketCap ?? t.fdv;
      if (cap === null || cap < f.minMarketCap) return false;
    }
    if (f.minChange !== null && (t.change24h === null || t.change24h < f.minChange)) return false;
    if (f.maxChange !== null && (t.change24h === null || t.change24h > f.maxChange)) return false;
    if (f.maxAgeHours !== null) {
      if (t.createdAt === null) return false;
      const ageHours = (Date.now() - t.createdAt) / 3_600_000;
      if (ageHours > f.maxAgeHours) return false;
    }
    return true;
  });
}

function FilterField({
  label,
  suffix,
  value,
  onChange,
}: {
  label: string;
  suffix: string;
  value: number | null;
  onChange: (v: number | null) => void;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>
          <Label hint={`${suffix} — optional`}>{label}</Label>
          <Input
            type="number"
            inputMode="decimal"
            className="w-24"
            value={value ?? ''}
            onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
            aria-label={label}
          />
        </div>
      </TooltipTrigger>
      <TooltipContent>Filters apply locally to the retrieved result set.</TooltipContent>
    </Tooltip>
  );
}

export const _screenerInternals = { NUMERIC_FIELDS, Badge };