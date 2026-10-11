import { request } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { n, plausibleNonNegative, plausiblePrice, toEpochMs } from '@/lib/validate';
import type {
  AssetOverview,
  CandleInterval,
  CandleSeries,
  PricePoint,
  Provenance,
  TokenMarketSummary,
} from '@/types/models';
import type {
  CandleRequest,
  DiscoveryRequest,
  MarketDataProvider,
  ProviderId,
  RequestContext,
  SpotPriceResult,
} from '../types';
import { asArray, asRecord, str } from '@/lib/validate';

/**
 * GeckoTerminal — free public onchain market data for Solana (CoinGecko).
 *
 * Docs:  https://www.geckoterminal.com/dex-api
 * Base:  https://api.geckoterminal.com/api/v2
 * Auth:  none (free tier). The free tier is aggressively rate limited, so a
 *        conservative local token bucket (4 req burst / 24 per min) is applied
 *        on top of the network-level limits.
 * CORS:  Access-Control-Allow-Origin: *
 *
 * Iceberg Terminal's primary source for OHLCV candles, pool discovery and
 * onchain token metrics.
 */

const BASE = 'https://api.geckoterminal.com/api/v2';
const SOURCE = 'GeckoTerminal';
const NETWORK = 'solana';
const MAX_POINTS = 1000;

export interface IntervalSpec {
  timeframe: 'minute' | 'hour' | 'day';
  aggregate: number;
}

/** Map our canonical intervals onto GT's timeframe + aggregate model. */
export function mapInterval(interval: CandleInterval): IntervalSpec {
  switch (interval) {
    case '1m':
      return { timeframe: 'minute', aggregate: 1 };
    case '5m':
      return { timeframe: 'minute', aggregate: 5 };
    case '15m':
      return { timeframe: 'minute', aggregate: 15 };
    case '1h':
      return { timeframe: 'hour', aggregate: 1 };
    case '4h':
      return { timeframe: 'hour', aggregate: 4 };
    case '1w':
      return { timeframe: 'day', aggregate: 7 };
    case '1d':
    default:
      return { timeframe: 'day', aggregate: 1 };
  }
}

/** GT ids are `network_address`; we only ever want the address. */
export function stripNetworkPrefix(id: string): string {
  const idx = id.indexOf('_');
  return idx === -1 ? id : id.slice(idx + 1);
}

const CAPS = {
  publicAccess: true,
  requiresApiKey: false,
  browserDirect: true,
  spotPrice: true,
  candles: true,
  volume: true,
  liquidity: true,
  marketCap: true,
  holderCount: false,
  tokenSecurity: false,
  tokenSearch: true,
  newTokenDiscovery: true,
  walletBalances: false,
  walletTokenAccounts: false,
  transactionHistory: false,
  transactionStreaming: false,
  news: false,
} as const;

function prov(sourceId: string): Provenance {
  return { origin: 'live', source: SOURCE, sourceId, fetchedAt: Date.now(), stale: false };
}

async function getJson<T>(path: string, ctx: RequestContext): Promise<T> {
  return request<T>(`${BASE}${path}`, {
    providerId: 'geckoterminal',
    signal: ctx.signal,
    // Free tier is roughly 30 calls/min; stay well under it.
    bucket: 'geckoterminal@24',
    timeoutMs: 12_000,
    attempts: 3,
    accept: 'application/json',
  });
}

function firstNum(rec: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const v = n(rec[k]);
    if (v !== null) return v;
  }
  return null;
}

/**
 * Normalize a GT pool object into a TokenMarketSummary.
 * Every field is nullable — GT omits fields rather than zeroing them.
 */
export function mapPoolSummary(raw: unknown): TokenMarketSummary | null {
  const wrapper = asRecord(raw);
  const attrs = asRecord(wrapper?.attributes);
  if (!attrs) return null;

  const poolAddress = str(attrs.address);
  const name = str(attrs.name);
  if (!poolAddress || !name) return null;

  const rel = asRecord(wrapper?.relationships);
  const baseTokenId = str(asRecord(asRecord(rel?.base_token)?.data)?.id);
  const quoteTokenId = str(asRecord(asRecord(rel?.quote_token)?.data)?.id);
  const dexId = str(asRecord(asRecord(rel?.dex)?.data)?.id);

  const [baseSym, quoteSym] = name.split('/');
  const baseAddress = baseTokenId ? stripNetworkPrefix(baseTokenId) : '';
  const quoteAddress = quoteTokenId ? stripNetworkPrefix(quoteTokenId) : '';

  const priceChange = asRecord(attrs.price_change_percentage) ?? {};
  const volume = asRecord(attrs.volume_usd) ?? {};
  const txns = asRecord(attrs.transactions) ?? {};

  const buysSells = (win: string): { buys: number | null; sells: number | null } | null => {
    const rec = asRecord(txns[win]);
    if (!rec) return null;
    const b = n(rec.buys);
    const s = n(rec.sells);
    return b === null && s === null ? null : { buys: b, sells: s };
  };

  const b24 = buysSells('h24');

  return {
    address: baseAddress,
    chain: 'solana',
    symbol: baseSym?.trim() || null,
    name: null,
    logoUri: null,
    priceUsd: plausiblePrice(n(attrs.base_token_price_usd)),
    priceNative: plausiblePrice(n(attrs.base_token_price_quote_token)),
    marketCap: plausibleNonNegative(n(attrs.market_cap_usd)),
    fdv: plausibleNonNegative(n(attrs.fdv_usd)),
    liquidityUsd: plausibleNonNegative(n(attrs.reserve_in_usd)),
    volume24h: firstNum(volume, ['h24', 'm24']),
    volume6h: firstNum(volume, ['h6']),
    volume1h: firstNum(volume, ['h1']),
    change5m: firstNum(priceChange, ['m5']),
    change1h: firstNum(priceChange, ['h1']),
    change6h: firstNum(priceChange, ['h6']),
    change24h: firstNum(priceChange, ['h24']),
    buys24h: b24?.buys ?? null,
    sells24h: b24?.sells ?? null,
    txns24h: b24 && (b24.buys !== null || b24.sells !== null) ? (b24.buys ?? 0) + (b24.sells ?? 0) : null,
    createdAt: toEpochMs(attrs.pool_created_at),
    topMarketId: `solana:${poolAddress}`,
    topDex: dexId,
    description: null,
    website: null,
    socials: [],
    quoteSymbol: quoteSym?.trim() || null,
    quoteAddress,
    provenance: prov('geckoterminal.pools'),
  };
}

/** Map the `/tokens/{address}` payload into a summary (has name/symbol). */
export function mapTokenSummary(raw: unknown): TokenMarketSummary | null {
  const attrs = asRecord(asRecord(raw)?.attributes);
  if (!attrs) return null;
  const address = str(attrs.address);
  if (!address) return null;

  const rel = asRecord(asRecord(raw)?.relationships);
  const topPoolId = str(asRecord(asRecord(rel?.top_pools)?.data)?.id);
  const poolAddress = topPoolId ? stripNetworkPrefix(topPoolId) : null;

  return {
    address,
    chain: 'solana',
    symbol: str(attrs.symbol),
    name: str(attrs.name),
    logoUri: str(attrs.image_url),
    priceUsd: plausiblePrice(n(attrs.price_usd)),
    priceNative: null,
    marketCap: plausibleNonNegative(n(attrs.market_cap_usd)),
    fdv: plausibleNonNegative(n(attrs.fdv_usd)),
    liquidityUsd: plausibleNonNegative(n(attrs.total_reserve_in_usd)),
    volume24h: firstNum(asRecord(attrs.volume_usd) ?? {}, ['h24', 'm24']),
    volume6h: null,
    volume1h: null,
    change5m: null,
    change1h: null,
    change6h: null,
    change24h: null,
    buys24h: null,
    sells24h: null,
    txns24h: null,
    createdAt: null,
    topMarketId: poolAddress ? `solana:${poolAddress}` : null,
    topDex: null,
    description: null,
    website: null,
    socials: [],
    provenance: prov('geckoterminal.tokens'),
  };
}

export const geckoTerminalProvider: MarketDataProvider = {
  id: 'geckoterminal' as ProviderId,
  label: SOURCE,
  category: 'market',
  docsUrl: 'https://www.geckoterminal.com/dex-api',
  attribution: 'Onchain market data by GeckoTerminal (CoinGecko)',
  capabilities: CAPS,
  requiresKey: false,

  status(settings) {
    if (settings?.enabled === false) return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    return {
      state: 'ready',
      detail: 'Free public API, no key. Heavily rate limited — cached client-side and polled conservatively.',
    };
  },

  async testConnection(ctx) {
    const started = Date.now();
    try {
      const data = await getJson<unknown>(`/networks/${NETWORK}`, ctx);
      const ok = asArray(asRecord(data)?.data).length > 0;
      return {
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? 'Reachable. Solana network metadata returned.' : 'Unexpected payload shape.',
        warnings: ['Free tier is rate limited; keep refresh intervals generous.'],
        checkedAt: Date.now(),
      };
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('unknown', 'Connection test failed', { cause: e });
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err.message,
        warnings: err.hint ? [err.hint] : [],
        checkedAt: Date.now(),
      };
    }
  },

  async getCandles(ctx, req: CandleRequest): Promise<CandleSeries> {
    const { timeframe, aggregate } = mapInterval(req.interval);
    const pool = stripNetworkPrefix(req.market);
    const limit = Math.min(req.limit ?? 300, MAX_POINTS);

    const path = `/networks/${NETWORK}/pools/${pool}/ohlcv/${timeframe}?aggregate=${aggregate}&limit=${limit}`;
    const data = await getJson<unknown>(path, ctx);

    const rows = asArray(asRecord(asRecord(asRecord(data)?.data)?.attributes)?.ohlcv_list);
    const candles: PricePoint[] = rows
      .map((row): PricePoint | null => {
        const arr = asArray(row);
        const ts = n(arr[0]);
        const open = plausiblePrice(n(arr[1]));
        const high = plausiblePrice(n(arr[2]));
        const low = plausiblePrice(n(arr[3]));
        const close = plausiblePrice(n(arr[4]));
        if (ts === null || open === null || high === null || low === null || close === null) return null;
        return { time: ts * 1000, open, high, low, close, volume: plausibleNonNegative(n(arr[5])) };
      })
      .filter((c): c is PricePoint => c !== null)
      .sort((a, b) => a.time - b.time)
      .slice(-MAX_POINTS);

    if (candles.length === 0) {
      throw new AppError('not_found', 'No candle data available for this market on GeckoTerminal.', {
        providerId: 'geckoterminal',
      });
    }

    return { marketId: req.market, interval: req.interval, candles, provenance: prov('geckoterminal.ohlcv') };
  },

  async getSpotPrices(ctx, mints): Promise<SpotPriceResult> {
    const prices: Record<string, number | null> = {};
    const liquidityUsd: Record<string, number | null> = {};
    const change24h: Record<string, number | null> = {};
    const unique = [...new Set(mints)].filter(Boolean);
    for (const m of unique) {
      prices[m] = null;
      liquidityUsd[m] = null;
      change24h[m] = null;
    }
    if (unique.length === 0) {
      return { prices, liquidityUsd, change24h, provenance: prov('geckoterminal.tokens') };
    }

    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

    await Promise.all(
      chunks.map(async (chunk) => {
        const data = await getJson<unknown>(`/networks/${NETWORK}/tokens/multi/${chunk.join(',')}`, ctx);
        for (const item of asArray(asRecord(data)?.data)) {
          const summary = mapTokenSummary(item);
          if (!summary) continue;
          prices[summary.address] = summary.priceUsd;
          liquidityUsd[summary.address] = summary.liquidityUsd;
          change24h[summary.address] = null;
        }
      }),
    );

    return { prices, liquidityUsd, change24h, provenance: prov('geckoterminal.tokens') };
  },

  async searchTokens(ctx, query) {
    const q = query.trim();
    if (!q) return [];
    const data = await getJson<unknown>(`/search/pools?query=${encodeURIComponent(q)}&page=1`, ctx);
    return asArray(asRecord(data)?.data)
      .map(mapPoolSummary)
      .filter((s): s is TokenMarketSummary => s !== null)
      .slice(0, 25);
  },

  async discoverTokens(ctx, req: DiscoveryRequest) {
    const path =
      req.segment === 'new'
        ? `/networks/${NETWORK}/new_pools?page=1`
        : `/networks/${NETWORK}/trending_pools?page=1&duration=24h`;
    const data = await getJson<unknown>(path, ctx);
    return asArray(asRecord(data)?.data)
      .map(mapPoolSummary)
      .filter((s): s is TokenMarketSummary => s !== null)
      .slice(0, Math.min(req.limit ?? 30, 30));
  },

  /** Whole-coin metrics are out of scope for GT (onchain only). */
  async getAssetOverview(): Promise<AssetOverview | null> {
    return null;
  },
};
/** Exported for unit tests of the normalization layer. */
export const _gtInternals = { mapPoolSummary, mapTokenSummary, mapInterval, stripNetworkPrefix };
