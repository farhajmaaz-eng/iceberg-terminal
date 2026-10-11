import { describe, expect, it } from 'vitest';
import { applyFilters } from './ScreenerPage';
import { computeStats } from '@/features/flows/FlowsPage';
import type { TokenMarketSummary } from '@/types/models';

function token(overrides: Partial<TokenMarketSummary> = {}): TokenMarketSummary {
  return {
    address: 'Mint1',
    chain: 'solana',
    symbol: 'AAA',
    name: 'Token A',
    logoUri: null,
    priceUsd: 1,
    priceNative: null,
    marketCap: 1_000_000,
    fdv: null,
    liquidityUsd: 100_000,
    volume24h: 500_000,
    volume6h: 50_000,
    volume1h: 5_000,
    change5m: 1,
    change1h: 2,
    change6h: 3,
    change24h: 10,
    buys24h: 100,
    sells24h: 90,
    txns24h: 190,
    createdAt: Date.now() - 3_600_000,
    topMarketId: 'solana:pool1',
    topDex: 'raydium',
    description: null,
    website: null,
    socials: [],
    provenance: { origin: 'live', source: 'test', fetchedAt: Date.now() },
    ...overrides,
  };
}

describe('screener filters', () => {
  const base = {
    minLiquidity: null,
    minVolume: null,
    minMarketCap: null,
    maxChange: null,
    minChange: null,
    maxAgeHours: null,
  };

  it('returns everything when no filter is set', () => {
    const rows = [token(), token({ address: 'Mint2' })];
    expect(applyFilters(rows, base)).toHaveLength(2);
  });

  it('filters by minimum liquidity', () => {
    const rows = [token({ liquidityUsd: 50_000 }), token({ address: 'Mint2', liquidityUsd: 500_000 })];
    expect(applyFilters(rows, { ...base, minLiquidity: 100_000 })).toHaveLength(1);
  });

  it('excludes tokens whose liquidity the provider did not report', () => {
    const rows = [token({ liquidityUsd: null })];
    expect(applyFilters(rows, { ...base, minLiquidity: 1 })).toHaveLength(0);
  });

  it('filters by a change band', () => {
    const rows = [token({ change24h: -20 }), token({ address: 'Mint2', change24h: 60 }), token({ address: 'Mint3', change24h: null })];
    expect(applyFilters(rows, { ...base, minChange: 0 })).toHaveLength(1);
    expect(applyFilters(rows, { ...base, maxChange: 0 })).toHaveLength(1);
  });

  it('filters by maximum pool age', () => {
    const rows = [token({ createdAt: Date.now() - 3_600_000 }), token({ address: 'Mint2', createdAt: null })];
    expect(applyFilters(rows, { ...base, maxAgeHours: 2 })).toHaveLength(1);
  });

  it('falls back to FDV when market cap is absent', () => {
    const rows = [token({ marketCap: null, fdv: 2_000_000 })];
    expect(applyFilters(rows, { ...base, minMarketCap: 1_500_000 })).toHaveLength(1);
  });
});

describe('flow statistics', () => {
  it('computes turnover, movers and median values', () => {
    const stats = computeStats([
      token({ liquidityUsd: 100_000, volume24h: 500_000, change24h: 80 }),
      token({ address: 'M2', liquidityUsd: 200_000, volume24h: 100_000, change24h: -70 }),
      token({ address: 'M3', liquidityUsd: 300_000, volume24h: 900_000, change24h: 2 }),
    ]);

    // (500k + 100k + 900k) / (100k + 200k + 300k) = 1.5M / 0.6M = 2.5x
    expect(stats.poolTurnover).toBeCloseTo(2.5);
    expect(stats.movers).toBe(2);
    expect(stats.medianTurnover).toBeCloseTo(3);
    // Turnovers: Mint1 = 5x, M2 = 0.5x, M3 = 3x -> highest is Mint1.
    expect(stats.topTurnover[0]!.address).toBe('Mint1');
    expect(stats.topTurnover.map((t) => t.turnover)).toEqual([5, 3, 0.5]);
  });

  it('never treats a missing value as zero when ranking turnover', () => {
    const stats = computeStats([
      token({ liquidityUsd: null, volume24h: 1_000_000 }),
      token({ address: 'M2', liquidityUsd: 100_000, volume24h: 100_000 }),
    ]);
    // The unknown-liquidity pool is excluded from turnover entirely.
    expect(stats.topTurnover).toHaveLength(1);
    expect(stats.topTurnover[0]!.address).toBe('M2');
  });

  it('returns nulls for an empty set rather than zero', () => {
    const stats = computeStats([]);
    expect(stats.poolTurnover).toBeNull();
    expect(stats.medianTurnover).toBeNull();
    expect(stats.newestAge).toBeNull();
    expect(stats.movers).toBe(0);
  });
});