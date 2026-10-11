import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { _internals } from '@/providers/market/dexscreener';
import type { Market } from '@/types/models';

/**
 * Provider normalization tests.
 *
 * These cover the contract that protects the rest of the app: a provider
 * payload must become a valid internal model, and a malformed/partial payload
 * must degrade to `null` fields rather than throwing or inventing zeros.
 */

const { mapMarket, mapSummary } = _internals;

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    url: 'https://dexscreener.com/solana/abc',
    pairAddress: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    baseToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
    quoteToken: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin', symbol: 'USDC' },
    priceUsd: '110.25',
    priceNative: '0.00907',
    txns: { m5: { buys: 8, sells: 7 }, h1: { buys: 102, sells: 110 }, h6: null, h24: { buys: 2075, sells: 2049 } },
    volume: { m5: 10043.25, h1: 165658.53, h6: 723915.81, h24: 3062323.96 },
    priceChange: { m5: 0.05, h1: -0.13, h6: 0.63, h24: 0.38 },
    liquidity: { usd: 652187.22, base: 3703.81, quote: 243778 },
    fdv: 29178757,
    marketCap: 29178757,
    pairCreatedAt: 1748980000000,
    ...overrides,
  };
}

describe('DexScreener normalization', () => {
  it('maps a well-formed pair into a Market', () => {
    const m = mapMarket(pair());
    expect(m).not.toBeNull();
    expect(m!.chain).toBe('solana');
    expect(m!.priceUsd).toBeCloseTo(110.25);
    expect(m!.liquidity?.usd).toBeCloseTo(652187.22);
    expect(m!.txns?.h24).toEqual({ buys: 2075, sells: 2049 });
    expect(m!.provenance.origin).toBe('live');
  });

  it('coerces numeric strings to numbers', () => {
    const m = mapMarket(pair({ priceUsd: '123.45', marketCap: '999' }));
    expect(typeof m!.priceUsd).toBe('number');
    expect(m!.marketCap).toBe(999);
  });

  it('returns null for a payload without a pair address', () => {
    expect(mapMarket({ chainId: 'solana', baseToken: { address: 'x' } })).toBeNull();
    expect(mapMarket(null)).toBeNull();
    expect(mapMarket('nonsense')).toBeNull();
    expect(mapMarket([])).toBeNull();
  });

  it('returns null when the base token has no address', () => {
    expect(mapMarket(pair({ baseToken: { symbol: 'X' } }))).toBeNull();
  });

  it('keeps missing values as null rather than zero', () => {
    const m = mapMarket({
      chainId: 'solana',
      pairAddress: 'abc',
      baseToken: { address: 'Mint1', symbol: 'A' },
      quoteToken: { address: 'Mint2', symbol: 'B' },
    });
    expect(m!.priceUsd).toBeNull();
    expect(m!.marketCap).toBeNull();
    expect(m!.volume).toBeNull();
    expect(m!.liquidity).toBeNull();
    expect(m!.txns).toBeNull();
    // Crucially: null must not be 0.
    expect(m!.priceUsd).not.toBe(0);
    expect(m!.marketCap).not.toBe(0);
  });

  it('rejects negative or absurd liquidity rather than passing it through', () => {
    const m = mapMarket(pair({ liquidity: { usd: -5, base: null, quote: null } }));
    expect(m!.liquidity?.usd).toBeNull();
  });

  it('rejects a negative price', () => {
    const m = mapMarket(pair({ priceUsd: '-1' }));
    expect(m!.priceUsd).toBeNull();
  });

  it('maps pairCreatedAt milliseconds through unchanged', () => {
    const m = mapMarket(pair({ pairCreatedAt: 1748980000000 }));
    expect(m!.pairCreatedAt).toBe(1748980000000);
  });

  it('converts pairCreatedAt seconds to milliseconds', () => {
    const m = mapMarket(pair({ pairCreatedAt: 1748980000 }));
    expect(m!.pairCreatedAt).toBe(1748980000000);
  });

  it('groups markets per token and ranks by liquidity', () => {
    const shallow = pair({ pairAddress: 'Shallow', liquidity: { usd: 100, base: 1, quote: 1 }, dexId: 'orca' });
    const deep = pair({ pairAddress: 'Deep', liquidity: { usd: 9_000_000, base: 1, quote: 1 } });

    const s = mapSummary([shallow, deep]);
    expect(s).not.toBeNull();
    expect(s!.topMarketId).toBe('solana:Deep');
    // Aggregates sum across pools rather than taking the deepest alone.
    expect(s!.liquidityUsd).toBeCloseTo(9_000_100);
    expect(s!.volume24h).toBeCloseTo(3062323.96 * 2);
  });

  it('returns null summary for an empty pool list', () => {
    expect(mapSummary([])).toBeNull();
  });

  it('marks demo provenance distinctly from live', () => {
    const m: Market | null = mapMarket(pair());
    expect(m!.provenance.origin).not.toBe('demo');
  });
});

describe('DexScreener network layer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns an empty list for an unknown token (pairs: null)', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ schemaVersion: '1.0.0', pairs: null }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const { dexscreenerProvider } = await import('@/providers/market/dexscreener');
    await expect(dexscreenerProvider.getTokenMarkets?.({}, 'NotARealMint1111')).resolves.toEqual([]);
  });

  it('unwraps the { pairs: [...] } envelope used by /latest/dex/tokens', async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ schemaVersion: '1.0.0', pairs: [pair()] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
    ) as unknown as typeof fetch;

    const { dexscreenerProvider } = await import('@/providers/market/dexscreener');
    const markets = await dexscreenerProvider.getTokenMarkets?.({}, 'So11111111111111111111111111111111111111112');
    expect(markets).toHaveLength(1);
    expect(markets![0]!.base.symbol).toBe('SOL');
  });

  it('sets the documented JSON accept header and no credentials', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ schemaVersion: '1.0.0', pairs: [pair()] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    ) as unknown as typeof fetch;

    const { dexscreenerProvider } = await import('@/providers/market/dexscreener');
    await dexscreenerProvider.getTokenMarkets?.({}, 'So11111111111111111111111111111111111111112');

    const call = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const init = call[1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect((init.headers as Record<string, string>)['accept']).toBe('application/json');
    expect(String(call[0])).toContain('https://api.dexscreener.com/');
  });
});