import { birdeyeProvider } from './analytics/birdeye';
import { coingeckoProvider } from './market/coingecko';
import { dexscreenerProvider } from './market/dexscreener';
import { geckoTerminalProvider } from './market/geckoterminal';
import { cryptoPanicProvider } from './news/cryptopanic';
import { solanaRpcProvider } from './chain/solanaRpc';
import type {
  AnalyticsProvider,
  ChainDataProvider,
  MarketDataProvider,
  NewsProvider,
  ProviderId,
} from './types';

/**
 * Provider registry.
 *
 * Adding a provider = implement the interface + append one line here. The UI
 * iterates this list, so settings screens, capability badges and data-source
 * attribution all update automatically.
 */

export const MARKET_PROVIDERS: MarketDataProvider[] = [dexscreenerProvider, geckoTerminalProvider, coingeckoProvider];
export const CHAIN_PROVIDERS: ChainDataProvider[] = [solanaRpcProvider];
export const ANALYTICS_PROVIDERS: AnalyticsProvider[] = [birdeyeProvider];
export const NEWS_PROVIDERS: NewsProvider[] = [cryptoPanicProvider];

export const ALL_PROVIDERS = [
  ...MARKET_PROVIDERS,
  ...CHAIN_PROVIDERS,
  ...ANALYTICS_PROVIDERS,
  ...NEWS_PROVIDERS,
];

export function getMarketProvider(id: ProviderId): MarketDataProvider | undefined {
  return MARKET_PROVIDERS.find((p) => p.id === id);
}
export function getChainProvider(id: ProviderId): ChainDataProvider | undefined {
  return CHAIN_PROVIDERS.find((p) => p.id === id);
}
export function getAnalyticsProvider(id: ProviderId): AnalyticsProvider | undefined {
  return ANALYTICS_PROVIDERS.find((p) => p.id === id);
}
export function getNewsProvider(id: ProviderId): NewsProvider | undefined {
  return NEWS_PROVIDERS.find((p) => p.id === id);
}
export function getProvider(id: ProviderId) {
  return ALL_PROVIDERS.find((p) => p.id === id);
}

export const DEFAULT_MARKET_PROVIDER: ProviderId = 'dexscreener';
export const DEFAULT_CHAIN_PROVIDER: ProviderId = 'solana-rpc';

export type { ProviderId };
export * from './types';