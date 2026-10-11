import {
  MARKET_PROVIDERS,
  getAnalyticsProvider,
  getChainProvider,
  getMarketProvider,
  getNewsProvider,
} from '@/providers';
import { resolveRpcUrl, type RpcFlavour } from '@/providers/chain/solanaRpc';
import type {
  AnalyticsProvider,
  ChainDataProvider,
  MarketDataProvider,
  NewsProvider,
  ProviderId,
  RequestContext,
} from '@/providers/types';
import { useProviderStore } from '@/store/providers';
import { useVaultStore } from '@/store/vault';

/**
 * Resolves the active provider + a ready-to-use RequestContext from the
 * current settings. Every query hook funnels through here so that:
 *
 *  • the selected provider is honoured everywhere,
 *  • credentials come from the in-memory vault only,
 *  • demo mode is respected centrally,
 *  • no component ever touches a provider object directly.
 */

export interface ResolvedProvider<T> {
  provider: T;
  context: RequestContext;
  /** true when the app is globally forced into demo mode. */
  forceDemo: boolean;
  /** true when the provider is switched off by the user. */
  disabled: boolean;
}

function baseOptions(id: string): Record<string, string> {
  return useProviderStore.getState().configs[id]?.options ?? {};
}

function isEnabled(id: string): boolean {
  return useProviderStore.getState().configs[id]?.enabled !== false;
}

export function buildRpcContext(): RequestContext {
  const store = useProviderStore.getState();
  const flavour = (store.configs['solana-rpc']?.options?.flavour ?? 'public') as RpcFlavour;
  const apiKey = useVaultStore.getState().getKey('solana-rpc');
  const customUrl = store.configs['solana-rpc']?.options?.url;
  let rpcUrl: string;
  try {
    rpcUrl = resolveRpcUrl(flavour, apiKey, customUrl);
  } catch {
    rpcUrl = resolveRpcUrl('public', undefined, undefined);
  }
  return { signal: undefined, options: { rpcUrl, flavour }, apiKey };
}

export function resolveMarketProvider(): ResolvedProvider<MarketDataProvider> | null {
  const { selectedMarket, forceDemo } = useProviderStore.getState();
  const provider = getMarketProvider(selectedMarket);
  if (!provider) return null;
  const apiKey = useVaultStore.getState().getKey(provider.id);
  return {
    provider,
    context: { options: baseOptions(provider.id), apiKey },
    forceDemo,
    disabled: !isEnabled(provider.id),
  };
}

export function resolveChainProvider(): ResolvedProvider<ChainDataProvider> | null {
  const { selectedChain, forceDemo } = useProviderStore.getState();
  const provider = getChainProvider(selectedChain);
  if (!provider) return null;
  return {
    provider,
    context: buildRpcContext(),
    forceDemo,
    disabled: !isEnabled(provider.id),
  };
}

export function resolveAnalyticsProvider(id?: ProviderId | null): ResolvedProvider<AnalyticsProvider> | null {
  const { selectedAnalytics, forceDemo } = useProviderStore.getState();
  const providerId = id ?? selectedAnalytics;
  if (!providerId) return null;
  const provider = getAnalyticsProvider(providerId);
  if (!provider) return null;
  const apiKey = useVaultStore.getState().getKey(provider.id);
  return {
    provider,
    context: { options: baseOptions(provider.id), apiKey },
    forceDemo,
    disabled: !isEnabled(provider.id),
  };
}

export function resolveNewsProvider(): ResolvedProvider<NewsProvider> | null {
  const { selectedNews, forceDemo } = useProviderStore.getState();
  if (!selectedNews) return null;
  const provider = getNewsProvider(selectedNews);
  if (!provider) return null;
  const apiKey = useVaultStore.getState().getKey(provider.id);
  return {
    provider,
    context: { options: baseOptions(provider.id), apiKey },
    forceDemo,
    disabled: !isEnabled(provider.id),
  };
}

/** True when at least one market provider can serve keyless public data. */
export function hasPublicMarketData(): boolean {
  return useProviderStore.getState().configs['dexscreener']?.enabled !== false;
}

/**
 * Resolve the first enabled market provider that actually implements a given
 * capability, honouring a preference order.
 *
 * Capabilities are not evenly distributed across providers: DexScreener has
 * the best pool/token coverage but no OHLCV, GeckoTerminal publishes candles
 * but not whole-coin aggregates, and CoinGecko has the aggregates only. The UI
 * asks for a *capability*, not for "the market provider", so selection happens
 * here rather than hard-coding an assumption in each query.
 */
export function resolveByCapability<K extends 'getCandles' | 'getAssetOverview' | 'searchTokens' | 'discoverTokens'>(
  capability: K,
  preferredOrder: string[],
): ResolvedProvider<MarketDataProvider> | null {
  const store = useProviderStore.getState();

  const ordered = [
    ...preferredOrder.map((id) => getMarketProvider(id)),
    ...MARKET_PROVIDERS,
  ].filter((p): p is MarketDataProvider => Boolean(p));

  for (const provider of ordered) {
    if (typeof provider[capability] !== 'function') continue;
    if (!isEnabled(provider.id)) continue;
    return {
      provider,
      context: { options: baseOptions(provider.id), apiKey: useVaultStore.getState().getKey(provider.id) },
      forceDemo: store.forceDemo,
      disabled: false,
    };
  }
  return null;
}

/** Candle-capable providers, most reliable first. */
export const CANDLE_PROVIDER_ORDER = ['geckoterminal', 'coingecko'];

/** Whole-coin aggregate providers, most reliable first. */
export const OVERVIEW_PROVIDER_ORDER = ['coingecko', 'geckoterminal'];