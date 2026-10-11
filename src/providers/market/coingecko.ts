import { request } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { COIN_IDS, SOL_MINT } from '@/lib/constants';
import { asArray, asRecord, n, plausibleNonNegative, plausiblePrice, str } from '@/lib/validate';
import type { AssetOverview, PricePoint, Provenance } from '@/types/models';
import type { MarketDataProvider, ProviderId, RequestContext } from '../types';

/**
 * CoinGecko public API — whole-coin aggregates (SOL market cap, circulating
 * supply, ATH/ATL, 7-day sparkline) that onchain-only providers cannot supply.
 *
 * Docs:  https://docs.coingecko.com/reference/introduction
 * Base:  https://api.coingecko.com/api/v3
 * Auth:  the public (demo) tier works without a key but is rate limited
 *        (~5-15 calls/min). An optional Pro API key raises the ceiling.
 * CORS:  Access-Control-Allow-Origin: *
 *
 * NOTE: free-tier keys are optional. When VITE env keys are intentionally
 * omitted, requests simply use the anonymous tier. Secrets are never read
 * from import.meta.env — see docs/SECURITY notes; BYOK keys come from the
 * local vault only.
 */

const BASE = 'https://api.coingecko.com/api/v3';
const SOURCE = 'CoinGecko';

const CAPS = {
  publicAccess: true,
  requiresApiKey: false,
  browserDirect: true,
  spotPrice: true,
  candles: false,
  volume: true,
  liquidity: false,
  marketCap: true,
  holderCount: false,
  tokenSecurity: false,
  tokenSearch: false,
  newTokenDiscovery: false,
  walletBalances: false,
  walletTokenAccounts: false,
  transactionHistory: false,
  transactionStreaming: false,
  news: false,
} as const;

function prov(sourceId: string): Provenance {
  return { origin: 'live', source: SOURCE, sourceId, fetchedAt: Date.now(), stale: false };
}

async function getJson<T>(path: string, ctx: RequestContext, key?: string): Promise<T> {
  const headers: Record<string, string> = key ? { 'x-cg-pro-api-key': key } : {};
  return request<T>(`${BASE}${path}`, {
    providerId: 'coingecko',
    signal: ctx.signal,
    // Public demo tier is very tight — stay conservative.
    bucket: key ? 'coingecko@30' : 'coingecko@10',
    headers,
    timeoutMs: 12_000,
    attempts: 2,
    accept: 'application/json',
  });
}

/** Map a mint address to a CoinGecko coin id using the local table. */
export function coinIdFor(input: string): string | null {
  const key = input.trim();
  if (COIN_IDS[key.toLowerCase()]) return COIN_IDS[key.toLowerCase()];
  if (COIN_IDS[key]) return COIN_IDS[key];
  return null;
}

export function mapAssetOverview(raw: unknown): AssetOverview | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const md = asRecord(rec.market_data);
  if (!md) return null;

  const sparkline = asArray(asRecord(md.sparkline_in_7d)?.price)
    .map((v) => n(v))
    .filter((v): v is number => v !== null);

  const links = asRecord(rec.links);
  const homepage = asArray(links?.homepage).find((h) => typeof h === 'string' && h.length > 0) ?? null;

  return {
    id: str(rec.id) ?? 'unknown',
    symbol: (str(rec.symbol) ?? '').toUpperCase(),
    name: str(rec.name) ?? 'Unknown',
    priceUsd: plausiblePrice(n(asRecord(md.current_price)?.usd)),
    change24h: n(md.price_change_percentage_24h),
    change7d: n(md.price_change_percentage_7d),
    volume24h: plausibleNonNegative(n(asRecord(md.total_volume)?.usd)),
    marketCap: plausibleNonNegative(n(asRecord(md.market_cap)?.usd)),
    fdv: plausibleNonNegative(n(asRecord(md.fully_diluted_valuation)?.usd)),
    circulatingSupply: plausibleNonNegative(n(asRecord(md.circulating_supply))),
    totalSupply: plausibleNonNegative(n(asRecord(md.total_supply))),
    ath: plausiblePrice(n(asRecord(md.ath)?.usd)),
    athChangePercent: n(asRecord(md.ath_change_percentage)?.usd),
    atl: plausiblePrice(n(asRecord(md.atl)?.usd)),
    rank: n(rec.market_cap_rank),
    sparkline7d: sparkline.length > 1 ? sparkline : null,
    homepage: typeof homepage === 'string' ? homepage : null,
    updatedAt: toMs(rec.last_updated),
    provenance: prov('coingecko.coins'),
  };
}

function toMs(v: unknown): number | null {
  const s = str(v);
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
}

/** Market chart is a lightweight fallback series (line only, no OHLC). */
export function mapMarketChart(raw: unknown): PricePoint[] {
  const prices = asArray(asRecord(raw)?.prices);
  const out: PricePoint[] = [];
  for (const p of prices) {
    const arr = asArray(p);
    const t = n(arr[0]);
    const v = plausiblePrice(n(arr[1]));
    if (t === null || v === null) continue;
    const time = t < 1e12 ? t * 1000 : t;
    out.push({ time, open: v, high: v, low: v, close: v, volume: null });
  }
  return out;
}

export const coingeckoProvider: MarketDataProvider = {
  id: 'coingecko' as ProviderId,
  label: SOURCE,
  category: 'market',
  docsUrl: 'https://docs.coingecko.com/reference/introduction',
  attribution: 'Market data by CoinGecko',
  capabilities: CAPS,
  requiresKey: false,

  status(settings) {
    if (settings?.enabled === false) return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    return {
      state: 'ready',
      detail: 'Anonymous public tier. Optional Pro API key unlocks higher rate limits.',
    };
  },

  async testConnection(ctx) {
    const started = Date.now();
    try {
      const data = await getJson<unknown>('/ping', ctx, ctx.apiKey);
      const ok = asRecord(data)?.gecko_api_status === 'up';
      return {
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? 'API reachable.' : 'API responded but status was not "up".',
        warnings: ['Public tier is rate limited; consider a Pro key for heavy use.'],
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

  async getSpotPrices(ctx, mints) {
    const prices: Record<string, number | null> = {};
    const liquidityUsd: Record<string, number | null> = {};
    const change24h: Record<string, number | null> = {};
    const unique = [...new Set(mints)].filter(Boolean);

    const coinIds = [...new Set(unique.map(coinIdFor).filter((c): c is string => c !== null))];
    for (const m of unique) {
      prices[m] = null;
      liquidityUsd[m] = null;
      change24h[m] = null;
    }
    if (coinIds.length === 0) {
      return { prices, liquidityUsd, change24h, provenance: prov('coingecko.simple') };
    }

    const path =
      `/simple/price?ids=${coinIds.join(',')}` +
      '&vs_currencies=usd&include_market_cap=true&include_24hr_vol=true&include_24hr_change=true' +
      '&include_last_updated_at=true';

    const data = await getJson<Record<string, unknown>>(path, ctx, ctx.apiKey);
    for (const mint of unique) {
      const coinId = coinIdFor(mint);
      if (!coinId) continue;
      const rec = asRecord(data?.[coinId]);
      if (!rec) continue;
      prices[mint] = plausiblePrice(n(rec.usd));
      change24h[mint] = n(rec.usd_24h_change);
      liquidityUsd[mint] = null;
    }

    return { prices, liquidityUsd, change24h, provenance: prov('coingecko.simple') };
  },

  async getAssetOverview(ctx, assetId) {
    const id = coinIdFor(assetId) ?? (assetId.includes('-') ? assetId : 'solana');
    const path =
      `/coins/${encodeURIComponent(id)}?localization=false&tickers=false&market_data=true` +
      '&community_data=false&developer_data=false&sparkline=true';
    const data = await getJson<unknown>(path, ctx, ctx.apiKey);
    const overview = mapAssetOverview(data);
    if (!overview) {
      throw new AppError('validation', 'CoinGecko response did not contain usable market data.', {
        providerId: 'coingecko',
      });
    }
    return overview;
  },
};

export const _cgInternals = { SOL_MINT };