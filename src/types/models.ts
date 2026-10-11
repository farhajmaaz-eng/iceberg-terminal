/**
 * Canonical internal data models.
 *
 * Every provider response is normalized into these shapes so that no
 * component ever depends on a provider-specific payload. `null` means
 * "not reported by the provider" and MUST be rendered differently from 0.
 */

/** Where a given value came from. Drives the provenance badge in the UI. */
export type DataOrigin = 'live' | 'demo' | 'cached';

export interface Provenance {
  origin: DataOrigin;
  /** Human readable provider label, e.g. "DexScreener". */
  source: string;
  /** Provider capability / endpoint id, e.g. "dexscreener.token-pairs". */
  sourceId?: string;
  /** Epoch ms when the underlying provider last reported this data. */
  fetchedAt?: number;
  /** True when provider data is older than the cache TTL we consider fresh. */
  stale?: boolean;
}

export type ChainId = 'solana' | 'ethereum' | 'bsc' | 'base' | 'arbitrum' | 'other';

export interface TokenRef {
  /** Canonical identifier — mint address. Never the symbol. */
  address: string;
  symbol?: string | null;
  name?: string | null;
  chain?: ChainId | null;
  logoUri?: string | null;
}

export interface PricePoint {
  /** Epoch ms. */
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** Base-asset volume for the interval, if reported. */
  volume?: number | null;
}

export type CandleInterval = '1m' | '5m' | '15m' | '1h' | '4h' | '1d' | '1w';

export interface CandleSeries {
  /** Normalized market identifier, e.g. "SOL-USDC" or a pool address. */
  marketId: string;
  interval: CandleInterval;
  candles: PricePoint[];
  provenance: Provenance;
}

export interface LiquidityInfo {
  usd: number | null;
  base: number | null;
  quote: number | null;
}

export interface TxnsWindow {
  buys: number | null;
  sells: number | null;
}

export interface TxnsSummary {
  m5: TxnsWindow | null;
  h1: TxnsWindow | null;
  h6: TxnsWindow | null;
  h24: TxnsWindow | null;
}

export interface VolumeSummary {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
}

export interface ChangeSummary {
  m5: number | null;
  h1: number | null;
  h6: number | null;
  h24: number | null;
}

/** A single tradable market (pool) on a DEX. */
export interface Market {
  id: string;
  chain: ChainId;
  dex: string | null;
  pairAddress: string;
  url: string | null;
  base: TokenRef;
  quote: TokenRef;
  priceUsd: number | null;
  priceNative: number | null;
  priceChange: ChangeSummary | null;
  volume: VolumeSummary | null;
  liquidity: LiquidityInfo | null;
  marketCap: number | null;
  fdv: number | null;
  txns: TxnsSummary | null;
  pairCreatedAt: number | null;
  labels?: string[] | null;
  imageUrl?: string | null;
  provenance: Provenance;
}

export interface TokenMarketSummary {
  address: string;
  chain: ChainId;
  symbol: string | null;
  name: string | null;
  logoUri: string | null;
  priceUsd: number | null;
  priceNative: number | null;
  marketCap: number | null;
  fdv: number | null;
  liquidityUsd: number | null;
  volume24h: number | null;
  volume6h: number | null;
  volume1h: number | null;
  change5m: number | null;
  change1h: number | null;
  change6h: number | null;
  change24h: number | null;
  buys24h: number | null;
  sells24h: number | null;
  txns24h: number | null;
  /** Epoch ms of pool creation — used for "token age". */
  createdAt: number | null;
  topMarketId: string | null;
  topDex: string | null;
  description: string | null;
  website: string | null;
  socials: { type: string; url: string }[];
  /** Quote asset of the canonical reference market, when the provider reports it. */
  quoteSymbol?: string | null;
  quoteAddress?: string | null;
  provenance: Provenance;
}

/** CoinGecko/Jupiter-style aggregate coin metrics (e.g. SOL itself). */
export interface AssetOverview {
  id: string;
  symbol: string;
  name: string;
  priceUsd: number | null;
  change24h: number | null;
  change7d: number | null;
  volume24h: number | null;
  marketCap: number | null;
  fdv: number | null;
  circulatingSupply: number | null;
  totalSupply: number | null;
  ath: number | null;
  athChangePercent: number | null;
  atl: number | null;
  rank: number | null;
  sparkline7d: number[] | null;
  homepage: string | null;
  updatedAt: number | null;
  provenance: Provenance;
}

export interface TokenSecurity {
  /** True when the mint account has a non-null mint authority. */
  mintAuthority: boolean | null;
  /** True when the mint account has a non-null freeze authority. */
  freezeAuthority: boolean | null;
  decimals: number | null;
  supply: number | null;
  topHolders: { address: string; amount: number | null; pct: number | null }[] | null;
  /** Provider-computed risk score. Only present when a provider supplies it. */
  overallScore: number | null;
  /** Raw, provider-labelled risk facts. Never invented locally. */
  riskSignals: { label: string; value: string; severity: 'info' | 'warn' | 'risk' }[];
  provenance: Provenance;
}

// ── On-chain ────────────────────────────────────────────────────────────────

export type ActivityKind =
  | 'unknown'
  | 'transfer'
  | 'swap'
  | 'liquidity-add'
  | 'liquidity-remove'
  | 'mint'
  | 'burn'
  | 'close-account'
  | 'fee';

export type TxStatus = 'success' | 'failed' | 'unknown';

export interface TokenAmount {
  mint: string;
  symbol: string | null;
  amount: number;
  decimals: number;
  uiAmount: number;
}

export interface ActivityRecord {
  signature: string;
  slot: number | null;
  /** Epoch ms, null when the RPC did not report blockTime. */
  blockTime: number | null;
  status: TxStatus;
  /** Only set when the parsed transaction genuinely encodes it. */
  kind: ActivityKind;
  /** Fee payer / account the record was fetched for. */
  account: string | null;
  feeLamports: number | null;
  feeSol: number | null;
  /** Token legs observed in pre/post balances. Empty when unavailable. */
  tokenAmounts: TokenAmount[];
  solDelta: number | null;
  /** Counters observed in logs (compute units consumed). */
  computeUnits: number | null;
  err: string | null;
  provenance: Provenance;
}

export interface WalletBalance {
  address: string;
  sol: number | null;
  lamports: number | null;
  slot: number | null;
  provenance: Provenance;
}

export interface TokenHolding {
  mint: string;
  symbol: string | null;
  amount: number;
  decimals: number;
  uiAmount: number;
  /** null when no pricing provider covers the mint. */
  priceUsd: number | null;
  valueUsd: number | null;
  provenance: Provenance;
}

export interface WalletSnapshot {
  address: string;
  balance: WalletBalance;
  holdings: TokenHolding[];
  /** False when the RPC refused or failed the token-account query. */
  holdingsAvailable: boolean;
  /** Human-readable reason when holdings could not be read. */
  holdingsError: string | null;
  holdingsPricedAt: number | null;
  totalValueUsd: number | null;
  pricedHoldingCount: number;
  unpricedHoldingCount: number;
  provenance: Provenance;
}

// ── News ────────────────────────────────────────────────────────────────────

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string | null;
  /** Epoch ms. */
  publishedAt: number | null;
  author: string | null;
  /** Tokens / protocols the provider tagged the story with. */
  tags: string[];
  /** Plain-text description. Never rendered as HTML. */
  summary: string | null;
  kind: 'news' | 'analysis' | 'discussion' | null;
  provenance: Provenance;
}

// ── Provider plumbing ───────────────────────────────────────────────────────

export type ProviderCategory = 'market' | 'chain' | 'analytics' | 'news';

export interface ProviderCapabilities {
  /** No credentials required; works out of the box. */
  publicAccess: boolean;
  requiresApiKey: boolean;
  /** Provider can be reached directly from a browser (CORS). */
  browserDirect: boolean;
  spotPrice: boolean;
  candles: boolean;
  volume: boolean;
  liquidity: boolean;
  marketCap: boolean;
  holderCount: boolean;
  tokenSecurity: boolean;
  tokenSearch: boolean;
  newTokenDiscovery: boolean;
  walletBalances: boolean;
  walletTokenAccounts: boolean;
  transactionHistory: boolean;
  transactionStreaming: boolean;
  news: boolean;
}

export type ProviderStatus =
  | { state: 'unconfigured'; detail: string }
  | { state: 'disabled'; detail: string }
  | { state: 'ready'; detail: string }
  | { state: 'error'; detail: string };

export interface ConnectionTestResult {
  ok: boolean;
  /** Round-trip time in ms. */
  latencyMs: number | null;
  detail: string;
  /** Non-fatal issues, e.g. rate-limit headers. */
  warnings: string[];
  checkedAt: number;
}