import { request } from '@/lib/http';
import { AppError } from '@/lib/errors';
import {
  asArray,
  asRecord,
  numMap,
  n,
  plausibleNonNegative,
  plausiblePrice,
  str,
  toEpochMs,
  window2,
} from '@/lib/validate';
import type {
  CandleSeries,
  ChainId,
  Market,
  Provenance,
  TokenMarketSummary,
  TokenRef,
} from '@/types/models';
import type {
  CandleRequest,
  DiscoveryRequest,
  MarketDataProvider,
  ProviderId,
  ProviderSetting,
  RequestContext,
} from '../types';
import { SOL_MINT } from '@/lib/constants';

/**
 * DexScreener — public, keyless DEX market data with browser CORS support.
 *
 * Docs: https://docs.dexscreener.com/api/reference
 * Base:  https://api.dexscreener.com
 * Rate:  ~300 req/min (documented as 60 rpm for some endpoints; a local
 *        token bucket is applied regardless).
 * Terms:  Free for personal use. Attribution required — rendered in the UI.
 */

const BASE = 'https://api.dexscreener.com';
const SOURCE = 'DexScreener';

const CAPS = {
  publicAccess: true,
  requiresApiKey: false,
  browserDirect: true,
  spotPrice: true,
  candles: false, // DexScreener does not expose OHLCV
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

function prov(sourceId: string, extra?: Partial<Provenance>): Provenance {
  return { origin: 'live', source: SOURCE, sourceId, fetchedAt: Date.now(), stale: false, ...extra };
}

function mapChain(v: unknown): ChainId {
  switch (str(v)) {
    case 'solana':
      return 'solana';
    case 'ethereum':
      return 'ethereum';
    case 'bsc':
      return 'bsc';
    case 'base':
      return 'base';
    case 'arbitrum':
      return 'arbitrum';
    default:
      return 'other';
  }
}

function mapToken(v: unknown, chain: ChainId): TokenRef {
  const rec = asRecord(v);
  return {
    address: str(rec?.address) ?? '',
    symbol: str(rec?.symbol),
    name: str(rec?.name),
    chain,
  };
}

function mapMarket(raw: unknown): Market | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const chain = mapChain(rec.chainId);
  const pairAddress = str(rec.pairAddress);
  if (!pairAddress) return null;
  const base = mapToken(rec.baseToken, chain);
  if (!base.address) return null;

  const liquidity = asRecord(rec.liquidity);
  const info = asRecord(rec.info);
  const images = asArray(info?.imageUrl);

  const txns = asRecord(rec.txns);
  const txnsSummary = txns
    ? {
        m5: window2(txns.m5),
        h1: window2(txns.h1),
        h6: window2(txns.h6),
        h24: window2(txns.h24),
      }
    : null;

  return {
    id: `${chain}:${pairAddress}`,
    chain,
    dex: str(rec.dexId),
    pairAddress,
    url: str(rec.url),
    base,
    quote: mapToken(rec.quoteToken, chain),
    priceUsd: plausiblePrice(n(rec.priceUsd)),
    priceNative: plausiblePrice(n(rec.priceNative)),
    priceChange: numMap(rec.priceChange),
    volume: numMap(rec.volume),
    liquidity: liquidity
      ? {
          usd: plausibleNonNegative(n(liquidity.usd)),
          base: plausibleNonNegative(n(liquidity.base)),
          quote: plausibleNonNegative(n(liquidity.quote)),
        }
      : null,
    marketCap: plausibleNonNegative(n(rec.marketCap)),
    fdv: plausibleNonNegative(n(rec.fdv)),
    txns: txnsSummary,
    pairCreatedAt: toEpochMs(rec.pairCreatedAt),
    labels: asArray(rec.labels).filter((x): x is string => typeof x === 'string'),
    imageUrl: typeof images[0] === 'string' ? (images[0] as string) : null,
    provenance: prov('dexscreener.pairs'),
  };
}

function sumLiquidity(markets: Market[]): number | null {
  let total = 0;
  let seen = false;
  for (const m of markets) {
    const v = m.liquidity?.usd;
    if (v !== null && v !== undefined) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

function sumNonNull(values: (number | null)[]): number | null {
  let total = 0;
  let seen = false;
  for (const v of values) {
    if (v !== null) {
      total += v;
      seen = true;
    }
  }
  return seen ? total : null;
}

function mapSummary(raw: unknown, socialsFrom?: unknown, descriptionFrom?: string | null): TokenMarketSummary | null {
  const markets = asArray(raw)
    .map(mapMarket)
    .filter((m): m is Market => m !== null);
  if (markets.length === 0) return null;

  // Rank by liquidity: the deepest pool is the canonical reference market.
  const sorted = [...markets].sort(
    (a, b) => (b.liquidity?.usd ?? -1) - (a.liquidity?.usd ?? -1),
  );
  const top = sorted[0]!;
  const tokenAddress = top.base.address;

  const best = (pick: (m: Market) => number | null | undefined): number | null => {
    const vals = sorted.map(pick).filter((v): v is number => v !== null && v !== undefined);
    if (!vals.length) return null;
    // Price-related fields: take the deepest pool's value.
    return vals[0] ?? null;
  };

  const socials = asArray(socialsFrom)
    .map((s) => {
      const rec = asRecord(s);
      const url = str(rec?.url);
      const type = str(rec?.type);
      return url && type ? { type, url } : null;
    })
    .filter((s): s is { type: string; url: string } => s !== null);

  return {
    address: tokenAddress,
    chain: top.chain,
    symbol: top.base.symbol ?? null,
    name: top.base.name ?? null,
    logoUri: top.imageUrl ?? null,
    priceUsd: best((m) => m.priceUsd),
    priceNative: best((m) => m.priceNative),
    marketCap: best((m) => m.marketCap) ?? best((m) => m.fdv),
    fdv: best((m) => m.fdv),
    liquidityUsd: sumLiquidity(sorted),
    volume24h: sumNonNull(sorted.map((m) => m.volume?.h24 ?? null)),
    volume6h: sumNonNull(sorted.map((m) => m.volume?.h6 ?? null)),
    volume1h: sumNonNull(sorted.map((m) => m.volume?.h1 ?? null)),
    change5m: best((m) => m.priceChange?.m5 ?? null),
    change1h: best((m) => m.priceChange?.h1 ?? null),
    change6h: best((m) => m.priceChange?.h6 ?? null),
    change24h: best((m) => m.priceChange?.h24 ?? null),
    buys24h: sumNonNull(sorted.map((m) => m.txns?.h24?.buys ?? null)),
    sells24h: sumNonNull(sorted.map((m) => m.txns?.h24?.sells ?? null)),
    txns24h: sumNonNull(
      sorted.map((m) => {
        const t = m.txns?.h24;
        if (!t || (t.buys === null && t.sells === null)) return null;
        return (t.buys ?? 0) + (t.sells ?? 0);
      }),
    ),
    createdAt: sorted.reduce<number | null>((acc, m) => {
      if (m.pairCreatedAt === null) return acc;
      if (acc === null) return m.pairCreatedAt;
      return Math.min(acc, m.pairCreatedAt);
    }, null),
    topMarketId: top.id,
    topDex: top.dex,
    description: descriptionFrom ?? null,
    website: socials.find((s) => s.type === 'website')?.url ?? null,
    socials,
    provenance: prov('dexscreener.tokens'),
  };
}

async function fetchJson(url: string, ctx: RequestContext, bucket: string): Promise<unknown> {
  return request<unknown>(url, {
    providerId: 'dexscreener',
    signal: ctx.signal,
    bucket,
    timeoutMs: 12_000,
    attempts: 3,
    accept: 'application/json',
  });
}

export const dexscreenerProvider: MarketDataProvider = {
  id: 'dexscreener' as ProviderId,
  label: SOURCE,
  category: 'market',
  docsUrl: 'https://docs.dexscreener.com/api/reference',
  attribution: 'Market data by DexScreener',
  capabilities: CAPS,
  requiresKey: false,

  status(settings) {
    const s: ProviderSetting | undefined = settings;
    if (s?.enabled === false) return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    return {
      state: 'ready',
      detail: 'Public, keyless endpoint. No API key required. Browser CORS supported.',
    };
  },

  async testConnection(ctx) {
    const started = Date.now();
    try {
      const data = await fetchJson(`${BASE}/latest/dex/tokens/${SOL_MINT}`, ctx, 'dexscreener@120');
      const ok = Array.isArray(data);
      return {
        ok,
        latencyMs: Date.now() - started,
        detail: ok ? `Reachable. ${asArray(data).length} SOL markets returned.` : 'Unexpected payload shape.',
        warnings: [],
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

    // Endpoint accepts up to 30 comma-separated token addresses.
    const chunks: string[][] = [];
    for (let i = 0; i < unique.length; i += 30) chunks.push(unique.slice(i, i + 30));

    await Promise.all(
      chunks.map(async (chunk) => {
        const data = await fetchJson(
          `${BASE}/tokens/v1/solana/${chunk.join(',')}`,
          ctx,
          'dexscreener@120',
        );
        const byAddress = new Map<string, Market[]>();
        for (const raw of asArray(data)) {
          const m = mapMarket(raw);
          if (!m) continue;
          const key = m.base.address.toLowerCase();
          const list = byAddress.get(key) ?? [];
          list.push(m);
          byAddress.set(key, list);
          const qKey = m.quote.address.toLowerCase();
          if (qKey !== key) {
            const ql = byAddress.get(qKey) ?? [];
            ql.push(m);
            byAddress.set(qKey, ql);
          }
        }
        for (const [key, markets] of byAddress) {
          const sorted = [...markets].sort((a, b) => (b.liquidity?.usd ?? -1) - (a.liquidity?.usd ?? -1));
          const top = sorted[0]!;
          prices[key] = top.priceUsd;
          liquidityUsd[key] = sumLiquidity(sorted);
          change24h[key] = top.priceChange?.h24 ?? null;
        }
      }),
    );

    for (const m of unique) {
      const k = m.toLowerCase();
      prices[m] = prices[m] ?? prices[k] ?? null;
      liquidityUsd[m] = liquidityUsd[m] ?? liquidityUsd[k] ?? null;
      change24h[m] = change24h[m] ?? change24h[k] ?? null;
    }

    return { prices, liquidityUsd, change24h, provenance: prov('dexscreener.tokens') };
  },

  async getTokenMarkets(ctx, mint) {
    const data = await fetchJson(`${BASE}/latest/dex/tokens/${mint}`, ctx, 'dexscreener@120');
    // This endpoint wraps results: { schemaVersion, pairs: [...] }. It can also
    // return `{ pairs: null }` for an unknown token, which must yield [] rather
    // than throwing.
    const pairs = asArray(asRecord(data)?.pairs);
    return pairs.map(mapMarket).filter((m): m is Market => m !== null);
  },

  async searchTokens(ctx, query) {
    const q = query.trim();
    if (!q) return [];
    const data = await fetchJson(
      `${BASE}/latest/dex/search?q=${encodeURIComponent(q)}`,
      ctx,
      'dexscreener@120',
    );
    const pairs = asArray(asRecord(data)?.pairs);

    // Group by base token so each token appears once, ranked by liquidity.
    const grouped = new Map<string, unknown[]>();
    for (const p of pairs) {
      const m = mapMarket(p);
      if (!m) continue;
      const key = m.base.address.toLowerCase();
      grouped.set(key, [...(grouped.get(key) ?? []), p]);
    }
    const summaries: TokenMarketSummary[] = [];
    for (const [key, group] of grouped) {
      const s = mapSummary(group);
      if (s) summaries.push(s);
      void key;
    }
    return summaries.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0)).slice(0, 30);
  },

  async discoverTokens(ctx, req: DiscoveryRequest) {
    const segment = req.segment ?? 'boosted';
    const limit = Math.min(req.limit ?? 30, 30);

    interface DiscoveryEntry {
      tokenAddress: string;
      description: string | null;
      socials: unknown[];
    }

    const endpoint =
      segment === 'boosted' ? `${BASE}/token-boosts/latest/v1` : `${BASE}/token-profiles/latest/v1`;
    const raw = await fetchJson(endpoint, ctx, 'dexscreener@120');

    const entries: DiscoveryEntry[] = asArray(raw)
      .filter((d) => asRecord(d)?.chainId === 'solana')
      .map((d) => {
        const rec = asRecord(d)!;
        return {
          tokenAddress: str(rec.tokenAddress) ?? '',
          description: str(rec.description),
          socials: asArray(rec.links),
        };
      })
      .filter((d) => d.tokenAddress !== '')
      .slice(0, limit);

    if (entries.length === 0) return [];

    const chunks: DiscoveryEntry[][] = [];
    for (let i = 0; i < entries.length; i += 30) chunks.push(entries.slice(i, i + 30));

    const results = await Promise.all(
      chunks.map(async (chunk) => {
        const list = chunk.map((c) => c.tokenAddress).join(',');
        const data = await fetchJson(`${BASE}/tokens/v1/solana/${list}`, ctx, 'dexscreener@120');
        return asArray(data);
      }),
    );

    const flat = results.flat();
    const summaries: TokenMarketSummary[] = [];
    for (const entry of entries) {
      const rawMatch = flat.find((r) => {
        const m = mapMarket(r);
        return m?.base.address.toLowerCase() === entry.tokenAddress.toLowerCase();
      });
      const s = rawMatch ? mapSummary([rawMatch], entry.socials, entry.description) : null;
      if (s) summaries.push(s);
    }
    return summaries.sort((a, b) => (b.liquidityUsd ?? 0) - (a.liquidityUsd ?? 0));
  },

  async getCandles(_ctx: RequestContext, _req: CandleRequest): Promise<CandleSeries> {
    throw new AppError(
      'unsupported',
      'DexScreener does not publish OHLCV candles. Configure GeckoTerminal for charts.',
      { providerId: 'dexscreener' },
    );
  },
};

export const _internals = { mapMarket, mapSummary, sumNonNull };