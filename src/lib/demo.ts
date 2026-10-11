import { hashString, mulberry32 } from './format';
import { SOL_MINT, USDC_MINT } from './constants';
import type {
  ActivityRecord,
  AssetOverview,
  CandleSeries,
  Market,
  NewsItem,
  PricePoint,
  Provenance,
  TokenMarketSummary,
  WalletSnapshot,
} from '@/types/models';

/**
 * Deterministic demo data.
 *
 * Iceberg Terminal runs with zero configuration. When no provider can supply
 * a dataset (and always in VITE_FORCE_DEMO_MODE), modules fall back to the
 * generators here. Everything produced is:
 *
 *   1. Deterministic — seeded by a stable string, identical across reloads.
 *   2. Marked `origin: 'demo'` so the UI renders an unmissable badge.
 *   3. Structurally identical to live data, so no component needs to care.
 *
 * Demo values are NEVER rendered as live market prices. That distinction is
 * enforced by the `<ProvenanceBadge>` component and the global demo banner.
 */

export const DEMO_LABEL = 'DEMO';

function demoProv(source: string, sourceId: string): Provenance {
  return { origin: 'demo', source: `${source} (${DEMO_LABEL})`, sourceId, fetchedAt: Date.now(), stale: false };
}

const DEMO_TOKENS: { symbol: string; name: string; seed: string }[] = [
  { symbol: 'SOL', name: 'Solana', seed: 'SOL' },
  { symbol: 'USDC', name: 'USD Coin', seed: 'USDC' },
  { symbol: 'JUP', name: 'Jupiter', seed: 'JUP' },
  { symbol: 'RAY', name: 'Raydium', seed: 'RAY' },
  { symbol: 'ORCA', name: 'Orca', seed: 'ORCA' },
  { symbol: 'PYTH', name: 'Pyth Network', seed: 'PYTH' },
  { symbol: 'JTO', name: 'Jito', seed: 'JTO' },
  { symbol: 'WIF', name: 'dogwifhat', seed: 'WIF' },
  { symbol: 'BONK', name: 'Bonk', seed: 'BONK' },
  { symbol: 'JUPX', name: 'Jupiter Perps', seed: 'JUPX' },
  { symbol: 'MOON', name: 'Moonshot', seed: 'MOON' },
  { symbol: 'NOVA', name: 'Nova', seed: 'NOVA' },
];

/** Deterministic 32–44 char base58-ish mint for a demo symbol. */
export function demoMint(symbol: string): string {
  const alphabet = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const rng = mulberry32(hashString(`mint:${symbol}`));
  let out = '';
  const len = 32 + Math.floor(rng() * 8);
  for (let i = 0; i < len; i++) out += alphabet[Math.floor(rng() * alphabet.length)];
  return out;
}

function walk(seed: string, start: number, steps: number, volatility: number): number[] {
  const rng = mulberry32(hashString(seed));
  const out: number[] = [];
  let v = start;
  let drift = (rng() - 0.5) * volatility * 0.4;
  for (let i = 0; i < steps; i++) {
    drift += (rng() - 0.5) * volatility * 0.25;
    drift = Math.max(-volatility, Math.min(volatility, drift));
    const shock = (rng() - 0.5) * volatility;
    v = Math.max(start * 0.05, v * (1 + drift / 100 + shock));
    out.push(v);
  }
  return out;
}

export function demoCandles(seed: string, opts: { points?: number; start?: number; stepMs?: number; now?: number } = {}): PricePoint[] {
  const points = opts.points ?? 168;
  const start = opts.start ?? 100;
  const stepMs = opts.stepMs ?? 3_600_000;
  const now = opts.now ?? Date.now();
  const closes = walk(seed, start, points, 1.6);
  const rng = mulberry32(hashString(`candles:${seed}`));
  const out: PricePoint[] = [];
  for (let i = 0; i < points; i++) {
    const close = closes[i]!;
    const open = i === 0 ? start : closes[i - 1]!;
    const wick = Math.abs(close - open) + close * 0.004 * rng();
    out.push({
      time: now - (points - 1 - i) * stepMs,
      open,
      high: Math.max(open, close) + wick,
      low: Math.max(0.00000001, Math.min(open, close) - wick),
      close,
      volume: Math.round((50_000 + rng() * 900_000) * (0.5 + rng())),
    });
  }
  return out;
}

export function demoCandleSeries(
  market: string,
  interval: string,
  overrides: Partial<{ points: number; stepMs: number; start: number }> = {},
): CandleSeries {
  const stepByInterval: Record<string, number> = {
    '1m': 60_000,
    '5m': 300_000,
    '15m': 900_000,
    '1h': 3_600_000,
    '4h': 14_400_000,
    '1d': 86_400_000,
    '1w': 604_800_000,
  };
  const stepMs = overrides.stepMs ?? stepByInterval[interval] ?? 3_600_000;
  const points = overrides.points ?? (stepMs >= 86_400_000 ? 180 : 200);
  return {
    marketId: market,
    interval: interval as CandleSeries['interval'],
    candles: demoCandles(market, { points, stepMs, start: overrides.start ?? 100 }),
    provenance: demoProv('Synthetic OHLCV', 'demo.ohlcv'),
  };
}

export function demoAssetOverview(symbol = 'SOL'): AssetOverview {
  const key = symbol.toUpperCase();
  const series = demoCandles(`overview:${key}`, { points: 168, start: key === 'SOL' ? 148 : 0.8, stepMs: 3_600_000 });
  const price = series[series.length - 1]!.close;
  const first = series[0]!.close;
  const rng = mulberry32(hashString(`ov:${key}`));
  const supply = key === 'SOL' ? 545_000_000 : Math.round(1_000_000_000 * rng());
  const volume = Math.round(price * supply * (0.01 + rng() * 0.06));
  return {
    id: key.toLowerCase(),
    symbol: key,
    name: DEMO_TOKENS.find((t) => t.symbol === key)?.name ?? key,
    priceUsd: price,
    change24h: ((price - first) / first) * 100,
    change7d: ((price - series[0]!.close) / series[0]!.close) * 100,
    volume24h: volume,
    marketCap: price * supply,
    fdv: price * supply * 1.05,
    circulatingSupply: supply,
    totalSupply: supply,
    ath: Math.max(...series.map((c) => c.high)),
    athChangePercent: -18.4,
    atl: Math.min(...series.map((c) => c.low)),
    rank: key === 'SOL' ? 5 : Math.ceil(rng() * 400),
    sparkline7d: series.map((c) => c.close),
    homepage: null,
    updatedAt: Date.now(),
    provenance: demoProv('Synthetic coin metrics', 'demo.overview'),
  };
}

export function demoSparkline(seed: string, points = 40, start = 1): number[] {
  return walk(seed, start, points, 2.2);
}

export function demoTokenSummaries(count = 24, chain: 'solana' = 'solana'): TokenMarketSummary[] {
  const out: TokenMarketSummary[] = [];
  for (let i = 0; i < count; i++) {
    const meta = DEMO_TOKENS[i % DEMO_TOKENS.length]!;
    const suffix = Math.floor(i / DEMO_TOKENS.length);
    const symbol = suffix === 0 ? meta.symbol : `${meta.symbol}${suffix}`;
    const seed = `tok:${symbol}`;
    const rng = mulberry32(hashString(seed));
    const priceUsd = i === 0 ? (demoAssetOverview('SOL').priceUsd ?? 150) : 10 ** (-6 + rng() * 4);
    const mcap = priceUsd * (1_000_000 + rng() * 9_000_000_000);
    const liquidity = mcap * (0.01 + rng() * 0.2);
    const h24 = Math.max(0, (rng() - 0.45) * 180);
    const createdAt = Date.now() - Math.round((3600 + rng() * 6 * 3600 * 24 * 900) * 1000);
    out.push({
      address: i === 0 ? SOL_MINT : demoMint(symbol),
      chain,
      symbol,
      name: meta.name,
      logoUri: null,
      priceUsd,
      priceNative: null,
      marketCap: i === 0 ? mcap : rng() > 0.12 ? mcap : null,
      fdv: rng() > 0.3 ? mcap * (1 + rng()) : null,
      liquidityUsd: liquidity,
      volume24h: liquidity * (0.3 + rng() * 6),
      volume6h: liquidity * (0.05 + rng() * 1.2),
      volume1h: liquidity * (0.01 + rng() * 0.4),
      change5m: (rng() - 0.5) * 8,
      change1h: (rng() - 0.5) * 22,
      change6h: (rng() - 0.5) * 60,
      change24h: h24,
      buys24h: Math.round(40 + rng() * 9000),
      sells24h: Math.round(40 + rng() * 9000),
      txns24h: Math.round(80 + rng() * 18000),
      createdAt,
      topMarketId: `solana:${demoMint(symbol)}`,
      topDex: rng() > 0.5 ? 'raydium' : rng() > 0.5 ? 'orca' : 'pumpfun',
      description: null,
      website: null,
      socials: [],
      quoteSymbol: 'SOL',
      quoteAddress: USDC_MINT,
      provenance: demoProv('Synthetic token data', 'demo.screener'),
    });
  }
  return out;
}

export function demoMarkets(count = 20): Market[] {
  return demoTokenSummaries(count).map((t, i) => {
    const pairAddress = demoMint(`pair${t.symbol}${i}`);
    return {
      id: `solana:${pairAddress}`,
      chain: 'solana',
      dex: t.topDex ?? 'raydium',
      pairAddress,
      url: null,
      base: { address: t.address, symbol: t.symbol, name: t.name, chain: 'solana' },
      quote: { address: USDC_MINT, symbol: t.quoteSymbol ?? 'SOL', name: 'Solana', chain: 'solana' },
      priceUsd: t.priceUsd,
      priceNative: t.priceNative,
      priceChange: { m5: t.change5m, h1: t.change1h, h6: t.change6h, h24: t.change24h },
      volume: { m5: null, h1: t.volume1h, h6: t.volume6h, h24: t.volume24h },
      liquidity: { usd: t.liquidityUsd, base: null, quote: null },
      marketCap: t.marketCap,
      fdv: t.fdv,
      txns: { m5: null, h1: null, h6: null, h24: { buys: t.buys24h, sells: t.sells24h } },
      pairCreatedAt: t.createdAt,
      labels: null,
      imageUrl: null,
      provenance: demoProv('Synthetic DEX markets', 'demo.markets'),
    } satisfies Market;
  });
}

export function demoActivity(seed: string, count = 30): ActivityRecord[] {
  const rng = mulberry32(hashString(`act:${seed}`));
  const mints = DEMO_TOKENS.map((t) => ({ mint: demoMint(t.symbol), symbol: t.symbol }));
  const now = Date.now();
  const kinds: ActivityRecord['kind'][] = ['transfer', 'swap', 'transfer', 'unknown', 'close-account'];
  const out: ActivityRecord[] = [];
  for (let i = 0; i < count; i++) {
    const kind = kinds[Math.floor(rng() * kinds.length)]!;
    const leg = mints[Math.floor(rng() * mints.length)]!;
    const amount = 10 ** (-4 + rng() * 3) * (1 + rng() * 50);
    out.push({
      signature: demoMint(`sig${seed}${i}`).padEnd(64, 'x').slice(0, 88),
      slot: 400_000_000 + Math.round(rng() * 5_000_000),
      blockTime: now - i * (3_000 + rng() * 20_000),
      status: rng() > 0.94 ? 'failed' : 'success',
      kind,
      account: demoMint(seed),
      feeLamports: 5000,
      feeSol: 0.000005,
      tokenAmounts:
        kind === 'unknown'
          ? []
          : [{ mint: leg.mint, symbol: leg.symbol, amount, decimals: 6, uiAmount: amount }],
      solDelta: (rng() - 0.5) * 4,
      computeUnits: Math.round(40_000 + rng() * 180_000),
      err: null,
      provenance: demoProv('Synthetic chain activity', 'demo.activity'),
    });
  }
  return out;
}

export function demoWallet(address: string): WalletSnapshot {
  const rng = mulberry32(hashString(`wallet:${address}`));
  const holdings = DEMO_TOKENS.slice(0, 5).map((t, i) => {
    const amount = 10 ** (0 + rng() * 3) * (i + 1);
    const price = 10 ** (-3 + rng() * 3);
    return {
      mint: i === 0 ? SOL_MINT : demoMint(t.symbol),
      symbol: t.symbol,
      amount,
      decimals: 6,
      uiAmount: amount,
      priceUsd: price,
      valueUsd: amount * price,
      provenance: demoProv('Synthetic holdings', 'demo.wallet'),
    };
  });
  const balance = 2 + rng() * 400;
  const solValue = balance * (demoAssetOverview('SOL').priceUsd ?? 100);
  const holdingsValue = holdings.reduce((acc, h) => acc + (h.valueUsd ?? 0), 0);
  return {
    address,
    balance: {
      address,
      sol: balance,
      lamports: Math.round(balance * 1e9),
      slot: 400_000_000,
      provenance: demoProv('Synthetic balance', 'demo.wallet'),
    },
    holdings,
    holdingsAvailable: true,
    holdingsError: null,
    holdingsPricedAt: Date.now(),
    totalValueUsd: solValue + holdingsValue,
    pricedHoldingCount: holdings.filter((h) => h.priceUsd !== null).length,
    unpricedHoldingCount: holdings.filter((h) => h.priceUsd === null).length,
    provenance: demoProv('Synthetic wallet snapshot', 'demo.wallet'),
  };
}

export function demoNews(count = 20): NewsItem[] {
  // NOTE: no fabricated headlines. This returns an explicit EMPTY list and
  // the UI shows the "configure a news provider" empty state instead.
  void count;
  return [];
}

export function isDemo(value: { provenance?: Provenance } | null | undefined): boolean {
  return value?.provenance?.origin === 'demo';
}