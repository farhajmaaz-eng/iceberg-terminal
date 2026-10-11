import type {
  ActivityRecord,
  AssetOverview,
  CandleInterval,
  CandleSeries,
  ConnectionTestResult,
  Market,
  NewsItem,
  Provenance,
  ProviderCapabilities,
  ProviderCategory,
  ProviderStatus,
  TokenHolding,
  TokenMarketSummary,
  TokenSecurity,
  WalletBalance,
} from '@/types/models';

/**
 * Provider abstraction.
 *
 * A provider is a thin, capability-declared adapter around a data source.
 * Adding a new source means implementing this interface and registering it —
 * no UI changes required, because the UI only ever sees the normalized
 * models in `src/types/models.ts`.
 */

export type ProviderId = string;

export interface ProviderSetting {
  enabled: boolean;
  /** Never persisted in plaintext; stored via the local vault. */
  apiKey?: string;
  /** Provider-specific options (endpoints, region, etc.). */
  options?: Record<string, string>;
}

export interface RequestContext {
  /** Aborts in-flight work when a query is cancelled or unmounted. */
  signal?: AbortSignal;
  /** Provider-specific overrides merged over stored settings. */
  options?: Record<string, string>;
  apiKey?: string;
}

export interface MarketDataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly category: ProviderCategory;
  readonly docsUrl: string;
  readonly attribution: string;
  readonly capabilities: ProviderCapabilities;
  /** Whether the user must supply a credential before use. */
  readonly requiresKey: boolean;

  status(settings: ProviderSetting | undefined): ProviderStatus;
  testConnection(ctx: RequestContext): Promise<ConnectionTestResult>;

  getSpotPrices(ctx: RequestContext, mints: string[]): Promise<SpotPriceResult>;
  getCandles?(ctx: RequestContext, req: CandleRequest): Promise<CandleSeries>;
  getAssetOverview?(ctx: RequestContext, assetId: string): Promise<AssetOverview | null>;
  searchTokens?(ctx: RequestContext, query: string): Promise<TokenMarketSummary[]>;
  getTokenMarkets?(ctx: RequestContext, mint: string): Promise<Market[]>;
  discoverTokens?(ctx: RequestContext, req: DiscoveryRequest): Promise<TokenMarketSummary[]>;
}

export interface ChainDataProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly category: ProviderCategory;
  readonly docsUrl: string;
  readonly attribution: string;
  readonly capabilities: ProviderCapabilities;
  readonly requiresKey: boolean;

  status(settings: ProviderSetting | undefined): ProviderStatus;
  testConnection(ctx: RequestContext): Promise<ConnectionTestResult>;

  getBalance(ctx: RequestContext, address: string): Promise<WalletBalance>;
  getTokenAccounts?(ctx: RequestContext, address: string): Promise<TokenHolding[]>;
  getSignatures?(
    ctx: RequestContext,
    address: string,
    opts?: { limit?: number; before?: string; until?: string },
  ): Promise<ActivityRecord[]>;
  getTransaction?(ctx: RequestContext, signature: string): Promise<ActivityRecord | null>;
  /** On-chain mint account facts (authorities, decimals, supply). */
  getMintAccount?(ctx: RequestContext, mint: string): Promise<MintAccountInfo>;
}

export interface MintAccountInfo {
  address: string;
  decimals: number | null;
  supply: number | null;
  mintAuthority: string | null;
  freezeAuthority: string | null;
  programOwner: string | null;
  isInitialized: boolean | null;
}

export interface AnalyticsProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly category: ProviderCategory;
  readonly docsUrl: string;
  readonly attribution: string;
  readonly capabilities: ProviderCapabilities;
  readonly requiresKey: boolean;

  status(settings: ProviderSetting | undefined): ProviderStatus;
  testConnection(ctx: RequestContext): Promise<ConnectionTestResult>;

  getTokenSecurity?(ctx: RequestContext, mint: string): Promise<TokenSecurity>;
  getHolderCount?(ctx: RequestContext, mint: string): Promise<number | null>;
  getTokenOverview?(ctx: RequestContext, mint: string): Promise<TokenOverviewResult | null>;
  getRecentTrades?(ctx: RequestContext, mint: string, limit?: number): Promise<RecentTrade[]>;
}

export interface TokenOverviewResult {
  priceUsd: number | null;
  marketCap: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  holders: number | null;
  provenance: Provenance;
}

export interface RecentTrade {
  signature: string | null;
  blockTime: number | null;
  /** Only present when the provider explicitly reports a direction. */
  side: 'buy' | 'sell' | null;
  priceUsd: number | null;
  volumeUsd: number | null;
  makerAddress: string | null;
  provenance: Provenance;
}

export interface NewsProvider {
  readonly id: ProviderId;
  readonly label: string;
  readonly category: ProviderCategory;
  readonly docsUrl: string;
  readonly attribution: string;
  readonly capabilities: ProviderCapabilities;
  readonly requiresKey: boolean;

  status(settings: ProviderSetting | undefined): ProviderStatus;
  testConnection(ctx: RequestContext): Promise<ConnectionTestResult>;

  getNews(
    ctx: RequestContext,
    opts?: { search?: string; currencies?: string[]; limit?: number },
  ): Promise<NewsItem[]>;
}

export type AnyProvider = MarketDataProvider | ChainDataProvider | AnalyticsProvider | NewsProvider;

export interface SpotPriceResult {
  /** mint/coin id -> USD price. Missing ids are simply absent. */
  prices: Record<string, number | null>;
  liquidityUsd: Record<string, number | null>;
  change24h: Record<string, number | null>;
  provenance: Provenance;
}

export interface CandleRequest {
  /** Provider-native market identifier (pool address or "SOL-USDC"). */
  market: string;
  interval: CandleInterval;
  limit?: number;
}

export interface DiscoveryRequest {
  /** Provider-native page/section selector. */
  segment?: 'trending' | 'boosted' | 'profiled' | 'new';
  limit?: number;
  chain?: string;
}