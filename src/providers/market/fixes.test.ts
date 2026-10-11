import { describe, expect, it } from 'vitest';
import { _internals } from '@/providers/market/dexscreener';
import type { Market } from '@/types/models';

const { mapMarket, mapSummary, pickImageUrl, totalTxns, sumReported } = _internals;

/**
 * Regression tests for the six fixes in this pass.
 *
 * Each describe block maps to one reported issue.
 */

function pair(overrides: Record<string, unknown> = {}) {
  return {
    chainId: 'solana',
    dexId: 'raydium',
    url: 'https://dexscreener.com/solana/abc',
    pairAddress: 'Czfq3xZZDmsdGdUyrNLtRhGc47cXcZtLG4crryfu44zE',
    baseToken: { address: 'So11111111111111111111111111111111111111112', name: 'Wrapped SOL', symbol: 'SOL' },
    quoteToken: { address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', name: 'USD Coin', symbol: 'USDC' },
    priceUsd: '110.25',
    txns: { h24: { buys: 100, sells: 50 } },
    volume: { h24: 1000 },
    liquidity: { usd: 5000 },
    ...overrides,
  };
}

// ── Fix 1: DexScreener image field ────────────────────────────────────────────

describe('DexScreener image handling', () => {
  it('reads imageUrl when it is a plain string (the real API shape)', () => {
    // Regression: the field was read with asArray(), which returns [] for a
    // string, so imageUrl was ALWAYS null and no logo ever rendered.
    const url = 'https://cdn.dexscreener.com/cms/images/abc?width=800&height=800';
    const m = mapMarket(pair({ info: { imageUrl: url } }));
    expect(m!.imageUrl).toBe(url);
  });

  it('still accepts the legacy array shape', () => {
    const url = 'https://cdn.dexscreener.com/cms/images/legacy';
    const m = mapMarket(pair({ info: { imageUrl: [url] } }));
    expect(m!.imageUrl).toBe(url);
  });

  it('falls back to header then openGraph when imageUrl is absent', () => {
    const header = 'https://cdn.dexscreener.com/cms/images/header';
    const og = 'https://cdn.dexscreener.com/cms/images/og';
    expect(mapMarket(pair({ info: { header } }))!.imageUrl).toBe(header);
    expect(mapMarket(pair({ info: { openGraph: og } }))!.imageUrl).toBe(og);
  });

  it('propagates the resolved logo onto the token summary', () => {
    const url = 'https://cdn.dexscreener.com/cms/images/logo';
    const s = mapSummary([pair({ info: { imageUrl: url } })]);
    expect(s!.logoUri).toBe(url);
  });

  it('rejects non-http(s) schemes from attacker-controlled metadata', () => {
    expect(pickImageUrl({ imageUrl: 'javascript:alert(1)' })).toBeNull();
    expect(pickImageUrl({ imageUrl: 'data:text/html,<script>alert(1)</script>' })).toBeNull();
    expect(pickImageUrl({ imageUrl: 'blob:https://x/y' })).toBeNull();
  });

  it('rejects empty, non-string and junk values without throwing', () => {
    expect(pickImageUrl(null)).toBeNull();
    expect(pickImageUrl({})).toBeNull();
    expect(pickImageUrl({ imageUrl: '' })).toBeNull();
    expect(pickImageUrl({ imageUrl: '   ' })).toBeNull();
    expect(pickImageUrl({ imageUrl: 42 })).toBeNull();
    expect(pickImageUrl({ imageUrl: [null, undefined, { a: 1 }] })).toBeNull();
  });

  it('skips a bad first candidate and uses the next valid one', () => {
    const good = 'https://cdn.dexscreener.com/cms/images/good';
    expect(pickImageUrl({ imageUrl: 'javascript:x', header: good })).toBe(good);
  });

  it('returns null when the provider sends no info block at all', () => {
    expect(mapMarket(pair())!.imageUrl).toBeNull();
  });
});

// ── Fix 2: transaction totals with an unknown component ──────────────────────

function marketWithTxns(buys: number | null, sells: number | null, id: string): Market {
  return {
    id,
    chain: 'solana',
    dex: 'raydium',
    pairAddress: id,
    url: null,
    base: { address: 'Mint1', symbol: 'A', name: 'A', chain: 'solana' },
    quote: { address: 'Mint2', symbol: 'B', name: 'B', chain: 'solana' },
    priceUsd: 1,
    priceNative: null,
    priceChange: null,
    volume: null,
    liquidity: null,
    marketCap: null,
    fdv: null,
    txns: { m5: null, h1: null, h6: null, h24: { buys, sells } },
    pairCreatedAt: null,
    labels: null,
    imageUrl: null,
    provenance: { origin: 'live', source: 'test', fetchedAt: Date.now() },
  };
}

describe('transaction totals', () => {
  it('sums when both components are known', () => {
    expect(totalTxns([marketWithTxns(10, 5, 'p1'), marketWithTxns(2, 1, 'p2')])).toBe(18);
  });

  it('returns null when a contributing pool omits sells', () => {
    // Regression: (buys ?? 0) + (sells ?? 0) reported 10 here, implying the
    // token had 10 trades when in fact one component was never reported.
    expect(totalTxns([marketWithTxns(10, null, 'p1')])).toBeNull();
  });

  it('returns null when a contributing pool omits buys', () => {
    expect(totalTxns([marketWithTxns(null, 5, 'p1')])).toBeNull();
  });

  it('never returns a partial total that looks complete', () => {
    const markets = [marketWithTxns(10, 5, 'p1'), marketWithTxns(3, null, 'p2')];
    const total = totalTxns(markets);
    expect(total).toBeNull();
    expect(total).not.toBe(18);
  });

  it('still totals pools that report both, ignoring pools with no window', () => {
    const withNoWindow = marketWithTxns(999, 999, 'p3');
    withNoWindow.txns = { m5: null, h1: null, h6: null, h24: null };
    expect(totalTxns([marketWithTxns(10, 5, 'p1'), withNoWindow])).toBe(15);
  });

  it('treats zero as a real measurement, not as missing', () => {
    expect(totalTxns([marketWithTxns(0, 0, 'p1')])).toBe(0);
    expect(totalTxns([marketWithTxns(0, 0, 'p1')])).not.toBeNull();
  });

  it('returns null when no pool reports a window at all', () => {
    const m = marketWithTxns(null, null, 'p1');
    m.txns = { m5: null, h1: null, h6: null, h24: null };
    expect(totalTxns([m])).toBeNull();
    expect(totalTxns([])).toBeNull();
  });

  it('exposes null txns24h on a summary when a component is unknown', () => {
    const s = mapSummary([
      pair({ pairAddress: 'p1', txns: { h24: { buys: 10, sells: null } } }),
    ]);
    expect(s!.txns24h).toBeNull();
    // The individual components are still reported as far as they are known.
    expect(s!.buys24h).toBe(10);
    expect(s!.sells24h).toBeNull();
  });

  it('sumReported ignores non-finite values rather than poisoning the total', () => {
    expect(sumReported([1, Number.NaN, 2])).toBe(3);
    expect(sumReported([null, null])).toBeNull();
  });
});