import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useMemo } from 'react';
import { useProviderStore } from '@/store/providers';
import { useVaultStore } from '@/store/vault';
import { useWatchlistStore } from '@/store/watchlists';
import {
  CANDLE_PROVIDER_ORDER,
  OVERVIEW_PROVIDER_ORDER,
  resolveAnalyticsProvider,
  resolveByCapability,
  resolveChainProvider,
  resolveMarketProvider,
  resolveNewsProvider,
} from './context';
import { withDemoFallback, type FallbackReason } from './fallback';
import {
  demoActivity,
  demoAssetOverview,
  demoCandleSeries,
  demoMarkets,
  demoNews,
  demoSparkline,
  demoTokenSummaries,
  demoWallet,
} from '@/lib/demo';
import { COIN_IDS, SOL_MINT } from '@/lib/constants';
import type {
  ActivityRecord,
  AssetOverview,
  CandleInterval,
  CandleSeries,
  Market,
  NewsItem,
  TokenMarketSummary,
  TokenSecurity,
  WalletSnapshot,
} from '@/types/models';
import type { MintAccountInfo as MintInfo } from '@/providers/types';

/**
 * TanStack Query hooks.
 *
 * Every hook:
 *  • resolves the active provider + context (including abort signals),
 *  • applies a conservative cache TTL appropriate to the provider's limits,
 *  • falls back to clearly-labelled deterministic demo data ONLY when the user
 *    has opted into demo mode or the provider genuinely cannot serve the data,
 *  • surfaces real provider errors rather than hiding them.
 */

/** Public tiers are slow; poll gently unless the user changes the interval. */
function pollIntervalMs(alertsPollSec: number): number {
  const base = Math.max(15, alertsPollSec) * 1000;
  return Math.min(base, 120_000);
}

// ── Assets (SOL overview) ───────────────────────────────────────────────────

export interface AssetResult {
  overview: AssetOverview;
  fallback: FallbackReason | null;
  source: string;
}

export function useAssetOverview(assetId = 'solana'): UseQueryResult<AssetResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const vaultEpoch = Object.keys(useVaultStore((s) => s.session)).length;

  return useQuery<AssetResult, Error>({
    queryKey: ['asset-overview', assetId, forceDemo, vaultEpoch],
    staleTime: 60_000,
    refetchInterval: pollIntervalMs(pollSec),
    retry: 1,
    queryFn: async ({ signal }) => {
      // Whole-coin aggregates live on a different provider than DEX pool data.
      const resolved = resolveByCapability('getAssetOverview', OVERVIEW_PROVIDER_ORDER);
      const coinId = COIN_IDS[assetId] ?? assetId;

      if (!resolved || !resolved.provider.getAssetOverview) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: resolved?.provider.label ?? 'No provider',
            providerId: resolved?.provider.id ?? 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoAssetOverview('SOL'),
        );
        return { overview: value as AssetOverview, fallback, source: 'Synthetic' };
      }

      const fn = resolved.provider.getAssetOverview.bind(resolved.provider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: resolved.provider.requiresKey,
          hasKey: Boolean(resolved.context.apiKey),
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        async () => {
          const r = await fn({ ...resolved.context, signal }, coinId);
          if (!r) throw new Error(`${resolved!.provider.label} returned no data for ${coinId}.`);
          return r;
        },
        () => demoAssetOverview(assetId.toUpperCase().slice(0, 6)),
      );
      const overview = value as AssetOverview;
      return { overview, fallback, source: overview.provenance.source };
    },
  });
}

// ── Candles ─────────────────────────────────────────────────────────────────

export interface CandleResult {
  series: CandleSeries;
  fallback: FallbackReason | null;
  /** Which provider actually served the chart. */
  source: string;
}

export function useCandles(
  marketId: string | null,
  interval: CandleInterval,
): UseQueryResult<CandleResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const enabled = Boolean(marketId);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);

  return useQuery<CandleResult, Error>({
    queryKey: ['candles', marketId, interval, forceDemo],
    enabled: enabled,
    staleTime: 45_000,
    refetchInterval: pollIntervalMs(pollSec),
    retry: 1,
    queryFn: async ({ signal }) => {
      const market = marketId!;
      // OHLCV is only published by candle-capable providers, so selection is
      // driven by capability rather than by the user's market-data preference.
      const resolved = resolveByCapability('getCandles', CANDLE_PROVIDER_ORDER);
      const candleProvider = resolved?.provider ?? null;

      if (!candleProvider?.getCandles) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: 'No provider',
            providerId: 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoCandleSeries(market, interval),
        );
        return { series: value as CandleSeries, fallback, source: 'Synthetic' };
      }

      const fn = candleProvider.getCandles.bind(candleProvider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: false,
          requiresKey: candleProvider.requiresKey,
          hasKey: Boolean(resolvedKey(candleProvider.id)),
          providerLabel: candleProvider.label,
          providerId: candleProvider.id,
        },
        () => fn({ ...resolved!.context, signal }, { market, interval, limit: 400 }),
        () => demoCandleSeries(market, interval),
      );
      const series = value as CandleSeries;
      return { series, fallback, source: series.provenance.source };
    },
  });
}

function resolvedKey(providerId: string): string | undefined {
  return useVaultStore.getState().getKey(providerId);
}

// ── Spot prices ─────────────────────────────────────────────────────────────

export interface SpotResult {
  prices: Record<string, number | null>;
  change24h: Record<string, number | null>;
  liquidityUsd: Record<string, number | null>;
  fallback: FallbackReason | null;
  source: string;
}

export function useSpotPrices(mints: string[]): UseQueryResult<SpotResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const key = useMemo(() => [...new Set(mints.filter(Boolean))].sort().join(','), [mints]);
  const enabled = key.length > 0;

  return useQuery<SpotResult, Error>({
    queryKey: ['spot-prices', key, forceDemo],
    enabled,
    staleTime: 30_000,
    refetchInterval: pollIntervalMs(pollSec),
    retry: 1,
    queryFn: async ({ signal }) => {
      const list = key.split(',').filter(Boolean);
      const resolved = resolveMarketProvider();

      if (!resolved) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: 'No provider',
            providerId: 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => {
            const summaries = demoTokenSummaries(list.length || 1);
            const prices: Record<string, number | null> = {};
            const change24h: Record<string, number | null> = {};
            const liquidityUsd: Record<string, number | null> = {};
            list.forEach((mint, i) => {
              prices[mint] = summaries[i]?.priceUsd ?? null;
              change24h[mint] = summaries[i]?.change24h ?? null;
              liquidityUsd[mint] = summaries[i]?.liquidityUsd ?? null;
            });
            return { prices, change24h, liquidityUsd };
          },
        );
        return { ...(value as Omit<SpotResult, 'fallback' | 'source'>), fallback, source: 'Synthetic' };
      }

      const fn = resolved.provider.getSpotPrices.bind(resolved.provider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: resolved.provider.requiresKey,
          hasKey: Boolean(resolved.context.apiKey),
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        () => fn({ ...resolved.context, signal }, list),
        () => {
          const summaries = demoTokenSummaries(Math.max(list.length, 1));
          const prices: Record<string, number | null> = {};
          const change24h: Record<string, number | null> = {};
          const liquidityUsd: Record<string, number | null> = {};
          list.forEach((mint, i) => {
            prices[mint] = summaries[i % summaries.length]?.priceUsd ?? null;
            change24h[mint] = summaries[i % summaries.length]?.change24h ?? null;
            liquidityUsd[mint] = summaries[i % summaries.length]?.liquidityUsd ?? null;
          });
          return { prices, change24h, liquidityUsd, provenance: { origin: 'demo' as const, source: 'Synthetic', fetchedAt: Date.now() } };
        },
      );
      const res = value as Awaited<ReturnType<typeof fn>>;
      return {
        prices: res.prices,
        change24h: res.change24h,
        liquidityUsd: res.liquidityUsd,
        fallback,
        source: res.provenance.source,
      };
    },
  });
}

// ── Token research ──────────────────────────────────────────────────────────

export interface TokenResult {
  markets: Market[];
  fallback: FallbackReason | null;
  source: string;
}

export function useTokenMarkets(mint: string | null): UseQueryResult<TokenResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const enabled = Boolean(mint);

  return useQuery<TokenResult, Error>({
    queryKey: ['token-markets', mint, forceDemo],
    enabled,
    staleTime: 30_000,
    refetchInterval: pollIntervalMs(pollSec),
    retry: 1,
    queryFn: async ({ signal }) => {
      const address = mint!;
      const resolved = resolveMarketProvider();

      if (!resolved || !resolved.provider.getTokenMarkets) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: resolved?.provider.label ?? 'No provider',
            providerId: resolved?.provider.id ?? 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoMarkets(12),
        );
        return { markets: value as Market[], fallback, source: 'Synthetic' };
      }

      const fn = resolved.provider.getTokenMarkets.bind(resolved.provider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: resolved.provider.requiresKey,
          hasKey: Boolean(resolved.context.apiKey),
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        () => fn({ ...resolved.context, signal }, address),
        () => demoMarkets(12),
      );
      const markets = value as Market[];
      return {
        markets,
        fallback,
        source: markets[0]?.provenance.source ?? resolved.provider.label,
      };
    },
  });
}

/** The deepest pool is the canonical reference market for charts + metrics. */
export function topMarket(markets: Market[] | undefined): Market | null {
  if (!markets || markets.length === 0) return null;
  return [...markets].sort((a, b) => (b.liquidity?.usd ?? -1) - (a.liquidity?.usd ?? -1))[0] ?? null;
}

// ── Screener / discovery / search ───────────────────────────────────────────

export interface ScreenerResult {
  tokens: TokenMarketSummary[];
  fallback: FallbackReason | null;
  source: string;
}

export type DiscoverySegment = 'boosted' | 'profiled' | 'trending' | 'new';

/**
 * Which provider serves which discovery segment.
 *
 * DexScreener exposes curated "boosted"/"profiled" token lists; GeckoTerminal
 * exposes chain-wide "trending"/"new" pools. Asking the wrong provider for a
 * segment would silently return a different dataset, so the segment decides.
 */
const SEGMENT_PROVIDERS: Record<DiscoverySegment, string[]> = {
  trending: ['geckoterminal', 'dexscreener'],
  new: ['geckoterminal', 'dexscreener'],
  boosted: ['dexscreener', 'geckoterminal'],
  profiled: ['dexscreener', 'geckoterminal'],
};

export function useDiscoverTokens(
  segment: DiscoverySegment,
  limit = 30,
): UseQueryResult<ScreenerResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);

  return useQuery<ScreenerResult, Error>({
    queryKey: ['discover', segment, limit, forceDemo],
    staleTime: 90_000,
    refetchInterval: Math.max(pollIntervalMs(pollSec), 90_000),
    retry: 1,
    queryFn: async ({ signal }) => {
      const resolved = resolveByCapability('discoverTokens', SEGMENT_PROVIDERS[segment]);

      if (!resolved || !resolved.provider.discoverTokens) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: resolved?.provider.label ?? 'No provider',
            providerId: resolved?.provider.id ?? 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoTokenSummaries(limit),
        );
        return { tokens: value as TokenMarketSummary[], fallback, source: 'Synthetic' };
      }

      const fn = resolved.provider.discoverTokens.bind(resolved.provider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: resolved.provider.requiresKey,
          hasKey: Boolean(resolved.context.apiKey),
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        () => fn({ ...resolved.context, signal }, { segment, limit }),
        () => demoTokenSummaries(limit),
      );
      const tokens = value as TokenMarketSummary[];
      return { tokens, fallback, source: tokens[0]?.provenance.source ?? resolved.provider.label };
    },
  });
}

export function useTokenSearch(query: string): UseQueryResult<ScreenerResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const trimmed = query.trim();
  const enabled = trimmed.length >= 2;

  return useQuery<ScreenerResult, Error>({
    queryKey: ['token-search', trimmed, forceDemo],
    enabled,
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const resolved = resolveMarketProvider();
      if (!resolved || !resolved.provider.searchTokens) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: resolved?.provider.label ?? 'No provider',
            providerId: resolved?.provider.id ?? 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoTokenSummaries(12).filter((t) => t.symbol?.toLowerCase().includes(trimmed.toLowerCase())),
        );
        return { tokens: value as TokenMarketSummary[], fallback, source: 'Synthetic' };
      }

      const fn = resolved.provider.searchTokens.bind(resolved.provider);
      const { value, fallback } = await withDemoFallback(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: resolved.provider.requiresKey,
          hasKey: Boolean(resolved.context.apiKey),
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        () => fn({ ...resolved.context, signal }, trimmed),
        () =>
          demoTokenSummaries(12).filter((t) =>
            `${t.symbol ?? ''} ${t.name ?? ''} ${t.address}`.toLowerCase().includes(trimmed.toLowerCase()),
          ),
      );
      const tokens = value as TokenMarketSummary[];
      return { tokens, fallback, source: tokens[0]?.provenance.source ?? resolved.provider.label };
    },
  });
}

// ── Chain ───────────────────────────────────────────────────────────────────

export function useWalletHoldings(address: string | null): UseQueryResult<RawWallet, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const enabled = Boolean(address);

  return useQuery<RawWallet, Error>({
    queryKey: ['wallet-holdings', address, forceDemo],
    enabled,
    staleTime: 20_000,
    refetchInterval: Math.max(30_000, pollIntervalMs(pollSec)),
    retry: 1,
    queryFn: async ({ signal }) => {
      const addr = address!;
      const resolved = resolveChainProvider();
      if (!resolved) return demoWallet(addr);

      const { value } = await withDemoFallback<RawWallet, RawWallet>(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: false,
          hasKey: true,
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        async () => {
          const ctx = { ...resolved.context, signal };

          // Balance and token accounts are fetched independently: public RPC
          // endpoints frequently block getTokenAccountsByOwner. Losing the whole
          // snapshot (and falsely reporting "0 holdings") because one
          // sub-call was blocked would be a data-integrity failure, so a
          // failure here is recorded and surfaced instead.
          const [balanceResult, holdingsResult] = await Promise.allSettled([
            resolved.provider.getBalance(ctx, addr),
            resolved.provider.getTokenAccounts ? resolved.provider.getTokenAccounts(ctx, addr) : Promise.resolve([]),
          ]);

          if (balanceResult.status === 'rejected' && holdingsResult.status === 'rejected') {
            throw balanceResult.reason;
          }

          const balance =
            balanceResult.status === 'fulfilled'
              ? balanceResult.value
              : {
                  address: addr,
                  sol: null,
                  lamports: null,
                  slot: null,
                  provenance: { origin: 'live' as const, source: resolved.provider.label, fetchedAt: Date.now() },
                };

          const holdings = holdingsResult.status === 'fulfilled' ? holdingsResult.value : [];

          return {
            address: addr,
            balance,
            holdings,
            holdingsAvailable: holdingsResult.status === 'fulfilled',
            holdingsError:
              holdingsResult.status === 'rejected'
                ? holdingsResult.reason instanceof Error
                  ? holdingsResult.reason.message
                  : 'Token accounts unavailable'
                : null,
            holdingsPricedAt: null,
            totalValueUsd: null,
            pricedHoldingCount: 0,
            unpricedHoldingCount: holdings.length,
            provenance: balance.provenance,
          } satisfies RawWallet;
        },
        () => demoWallet(addr),
      );
      return value as RawWallet;
    },
  });
}

/** Raw (unpriced) wallet read from the chain. */
export interface RawWallet {
  address: string;
  balance: WalletSnapshot['balance'];
  holdings: WalletSnapshot['holdings'];
  /** False when the RPC refused or failed the token-account query. */
  holdingsAvailable: boolean;
  /** Human-readable reason when holdings could not be read. */
  holdingsError: string | null;
  holdingsPricedAt: number | null;
  totalValueUsd: number | null;
  pricedHoldingCount: number;
  unpricedHoldingCount: number;
  provenance: WalletSnapshot['provenance'];
}

const STABLE_PRICE: Record<string, number> = { EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: 1 };

/**
 * Wallet snapshot with market prices applied.
 *
 * IMPORTANT LIMITATION (surfaced in the UI): portfolio value is a mark-to-market
 * estimate from current prices only. Historical balances, realized/unrealized
 * PnL and cost basis are NOT computed — that data is not available from the
 * read-only RPC endpoints used here, and Iceberg never fabricates it.
 */
export function useWalletSnapshot(address: string | null): UseQueryResult<WalletSnapshot | null, Error> {
  const raw = useWalletHoldings(address);
  const mints = useMemo(
    () => (raw.data?.holdings ?? []).map((h) => h.mint).filter(Boolean),
    [raw.data?.holdings],
  );
  const spot = useSpotPrices(mints);
  const solSpot = useSpotPrices([SOL_MINT]);

  return useQuery<WalletSnapshot | null, Error>({
    queryKey: ['wallet-snapshot', address, raw.dataUpdatedAt, spot.dataUpdatedAt, solSpot.dataUpdatedAt],
    enabled: Boolean(address),
    staleTime: 20_000,
    retry: 0,
    queryFn: () => {
      const data = raw.data;
      if (!data) return null;

      const priceFor = (mint: string): number | null => {
        if (STABLE_PRICE[mint] !== undefined) return STABLE_PRICE[mint]!;
        const p = spot.data?.prices[mint];
        return p === undefined ? null : p;
      };

      const holdings = data.holdings
        .map((h) => {
          const priceUsd = priceFor(h.mint);
          return {
            ...h,
            priceUsd,
            valueUsd: priceUsd !== null ? priceUsd * h.uiAmount : null,
          };
        })
        .sort((a, b) => (b.valueUsd ?? -1) - (a.valueUsd ?? -1));

      const priced = holdings.filter((h) => h.priceUsd !== null);
      const holdingsValue = priced.reduce((acc, h) => acc + (h.valueUsd ?? 0), 0);
      const solPrice = solSpot.data?.prices[SOL_MINT] ?? null;
      const solValue = solPrice !== null && data.balance.sol !== null ? solPrice * data.balance.sol : null;

      return {
        ...data,
        holdings,
        holdingsPricedAt: priced.length ? Date.now() : null,
        totalValueUsd: priced.length || solValue !== null ? holdingsValue + (solValue ?? 0) : null,
        pricedHoldingCount: priced.length,
        unpricedHoldingCount: holdings.length - priced.length,
      } satisfies WalletSnapshot;
    },
  });
}

export interface ActivityResult {
  records: ActivityRecord[];
  fallback: FallbackReason | null;
  source: string;
}

export function useWalletActivity(
  addresses: string[],
  limit = 25,
): UseQueryResult<ActivityResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const pollSec = useProviderStore((s) => s.alerts.pollIntervalSec);
  const key = useMemo(() => [...new Set(addresses.filter(Boolean))].sort().join(','), [addresses]);
  const enabled = key.length > 0;

  return useQuery<ActivityResult, Error>({
    queryKey: ['wallet-activity', key, limit, forceDemo],
    enabled,
    staleTime: 15_000,
    refetchInterval: Math.max(20_000, pollIntervalMs(pollSec)),
    retry: 1,
    queryFn: async ({ signal }) => {
      const list = key.split(',').filter(Boolean);
      const resolved = resolveChainProvider();

      if (!resolved || !resolved.provider.getSignatures) {
        const { value, fallback } = await withDemoFallback(
          {
            forceDemo,
            disabled: false,
            requiresKey: false,
            hasKey: false,
            providerLabel: resolved?.provider.label ?? 'No provider',
            providerId: resolved?.provider.id ?? 'none',
            capabilityMissing: true,
          },
          async () => null as never,
          () => demoActivity(list[0] ?? 'feed', limit),
        );
        return { records: value as ActivityRecord[], fallback, source: 'Synthetic' };
      }

      const { value } = await withDemoFallback<ActivityRecord[], ActivityRecord[]>(
        {
          forceDemo,
          disabled: resolved.disabled,
          requiresKey: false,
          hasKey: true,
          providerLabel: resolved.provider.label,
          providerId: resolved.provider.id,
        },
        async () => {
          const out: ActivityRecord[] = [];
          for (const addr of list) {
            const ctx = { ...resolved.context, signal };
            const sigs = await resolved.provider.getSignatures!(ctx, addr, { limit });
            out.push(...sigs);
          }
          return out.sort((a, b) => (b.blockTime ?? 0) - (a.blockTime ?? 0)).slice(0, limit * 2);
        },
        () => demoActivity(list[0] ?? 'feed', limit),
      );
      const records = value as ActivityRecord[];
      return { records, fallback: null, source: records[0]?.provenance.source ?? resolved.provider.label };
    },
  });
}

export function useMintAccount(mint: string | null): UseQueryResult<MintInfo | null, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const enabled = Boolean(mint);

  return useQuery<MintInfo | null, Error>({
    queryKey: ['mint-account', mint, forceDemo],
    enabled,
    staleTime: 5 * 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const addr = mint!;
      const resolved = resolveChainProvider();
      if (!resolved || !resolved.provider.getMintAccount) return null;
      if (forceDemo || resolved.disabled) return null;
      return resolved.provider.getMintAccount({ ...resolved.context, signal }, addr);
    },
  });
}

export function useTransaction(signature: string | null): UseQueryResult<ActivityRecord | null, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const enabled = Boolean(signature);

  return useQuery<ActivityRecord | null, Error>({
    queryKey: ['transaction', signature, forceDemo],
    enabled,
    staleTime: 60_000,
    retry: 1,
    queryFn: async ({ signal }) => {
      const sig = signature!;
      const resolved = resolveChainProvider();
      if (!resolved || !resolved.provider.getTransaction) {
        return demoActivity(sig, 1)[0] ?? null;
      }
      if (forceDemo || resolved.disabled) return demoActivity(sig, 1)[0] ?? null;
      return resolved.provider.getTransaction({ ...resolved.context, signal }, sig);
    },
  });
}

// ── Analytics (BYOK) ────────────────────────────────────────────────────────

export interface SecurityResult {
  security: TokenSecurity | null;
  /** true when no analytics provider is configured. */
  unconfigured: boolean;
}

export function useTokenSecurity(mint: string | null): UseQueryResult<SecurityResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const enabled = Boolean(mint);
  const hasKey = useVaultStore((s) => (mint ? Boolean(s.session['birdeye']) : false));

  return useQuery<SecurityResult, Error>({
    queryKey: ['token-security', mint, forceDemo, hasKey],
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async ({ signal }) => {
      const addr = mint!;
      const resolved = resolveAnalyticsProvider();
      if (!resolved || !resolved.provider.getTokenSecurity) return { security: null, unconfigured: true };
      if (forceDemo || resolved.disabled || !hasKey) return { security: null, unconfigured: true };
      const security = await resolved.provider.getTokenSecurity({ ...resolved.context, signal }, addr);
      return { security, unconfigured: false };
    },
  });
}

// ── News (BYOK) ─────────────────────────────────────────────────────────────

export interface NewsResult {
  items: NewsItem[];
  unconfigured: boolean;
  source: string | null;
}

export function useNews(search: string, limit = 40): UseQueryResult<NewsResult, Error> {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const hasKey = useVaultStore((s) => Boolean(s.session['cryptopanic']));

  return useQuery<NewsResult, Error>({
    queryKey: ['news', search, limit, forceDemo, hasKey],
    staleTime: 5 * 60_000,
    retry: 0,
    queryFn: async ({ signal }) => {
      const resolved = resolveNewsProvider();
      if (!resolved || forceDemo || resolved.disabled || !hasKey || !resolved.context.apiKey) {
        return { items: demoNews(limit), unconfigured: true, source: null };
      }
      const items = await resolved.provider.getNews({ ...resolved.context, signal }, {
        search: search.trim() || undefined,
        limit,
        currencies: ['SOL', 'BTC', 'ETH'],
      });
      return { items, unconfigured: false, source: resolved.provider.label };
    },
  });
}

// ── Watchlist spot + sparklines ─────────────────────────────────────────────

export interface WatchRow {
  mint: string;
  symbol: string | null;
  priceUsd: number | null;
  change24h: number | null;
  liquidityUsd: number | null;
  sparkline: number[] | null;
}

/**
 * Watchlist rows enriched with live prices.
 *
 * A token added by mint address (e.g. via `WATCH <mint>`) carries no cached
 * symbol. The symbol is resolved from the token's own market summary when a
 * provider publishes one, so the row is identifiable without a manual lookup.
 * The mint always remains the canonical key.
 */
export function useWatchlistRows(mints: string[], symbols: Record<string, string | null>): WatchRow[] {
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const spot = useSpotPrices(mints);

  const firstUnknown = useMemo(
    () => mints.find((m) => !symbols[m]) ?? null,
    [mints, symbols],
  );
  const markets = useTokenMarkets(firstUnknown);

  const resolved = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of markets.data?.markets ?? []) {
      if (m.base.symbol) map[m.base.address] = m.base.symbol;
    }
    return map;
  }, [markets.data]);

  const rows = useMemo<WatchRow[]>(() => {
    return mints.map((mint) => ({
      mint,
      symbol: symbols[mint] ?? resolved[mint] ?? null,
      priceUsd: spot.data?.prices[mint] ?? null,
      change24h: spot.data?.change24h[mint] ?? null,
      liquidityUsd: spot.data?.liquidityUsd[mint] ?? null,
      sparkline: forceDemo ? demoSparkline(`spark:${mint}`, 36, spot.data?.prices[mint] ?? 1) : null,
    }));
  }, [mints, symbols, resolved, spot.data, forceDemo]);

  return rows;
}

export { useWatchlistStore };
export const _demoMintHint = SOL_MINT;