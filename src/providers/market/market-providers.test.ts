import { describe, expect, it } from 'vitest';
import { _gtInternals } from '@/providers/market/geckoterminal';
import { mapAssetOverview, mapMarketChart, coinIdFor } from '@/providers/market/coingecko';
import type { CandleInterval } from '@/types/models';

const { mapPoolSummary, mapInterval } = _gtInternals;

function pool(overrides: Record<string, unknown> = {}) {
  return {
    id: 'solana_Gma1QtoLJHroZhod4bjW5ee9JoeJQ7zJsTadmVfSiBve',
    type: 'pool',
    attributes: {
      base_token_price_usd: '0.00024658',
      base_token_price_quote_token: '0.00000217',
      address: 'Gma1QtoLJHroZhod4bjW5ee9JoeJQ7zJsTadmVfSiBve',
      name: 'SEED / SOL',
      pool_created_at: '2026-10-10T07:01:00Z',
      fdv_usd: '242673.98',
      market_cap_usd: null,
      reserve_in_usd: '148223.5',
      price_change_percentage: { m5: '2.648', h1: '-4.597', h6: '-4.517', h24: '391.326' },
      transactions: { m5: { buys: 2, sells: 0 }, h24: { buys: 4959, sells: 1779 } },
      volume_usd: { h24: '512340.11', h6: '81223.4', h1: '12003.9' },
      ...overrides,
    },
    relationships: {
      base_token: { data: { id: 'solana_CvxQvqNQVRqq96oeoRnf6H64Memd8Weas9gte2xupump' } },
      quote_token: { data: { id: 'solana_So11111111111111111111111111111111111111112' } },
      dex: { data: { id: 'raydium-clmm' } },
    },
  };
}

describe('GeckoTerminal normalization', () => {
  it('maps a pool into a TokenMarketSummary', () => {
    const s = mapPoolSummary(pool());
    expect(s).not.toBeNull();
    expect(s!.address).toBe('CvxQvqNQVRqq96oeoRnf6H64Memd8Weas9gte2xupump');
    expect(s!.symbol).toBe('SEED');
    expect(s!.quoteSymbol).toBe('SOL');
    expect(s!.topDex).toBe('raydium-clmm');
    expect(s!.priceUsd).toBeCloseTo(0.00024658);
    expect(s!.liquidityUsd).toBeCloseTo(148223.5);
    expect(s!.change24h).toBeCloseTo(391.326);
    expect(s!.volume24h).toBeCloseTo(512340.11);
  });

  it('derives token age from pool_created_at', () => {
    const s = mapPoolSummary(pool());
    expect(s!.createdAt).toBe(Date.parse('2026-10-10T07:01:00Z'));
  });

  it('keeps an explicit null market cap as null, never 0', () => {
    const s = mapPoolSummary(pool({ market_cap_usd: null }));
    expect(s!.marketCap).toBeNull();
    expect(s!.marketCap).not.toBe(0);
    expect(s!.fdv).toBeCloseTo(242673.98);
  });

  it('omits transaction counts the provider did not report', () => {
    const s = mapPoolSummary(
      pool({ transactions: { h24: { buys: 10, sells: 5 } } }),
    );
    expect(s!.txns24h).toBe(15);
    const s2 = mapPoolSummary(pool({ transactions: undefined }));
    expect(s2!.txns24h).toBeNull();
    expect(s2!.buys24h).toBeNull();
  });

  it('returns null for malformed pool payloads', () => {
    expect(mapPoolSummary(null)).toBeNull();
    expect(mapPoolSummary({})).toBeNull();
    expect(mapPoolSummary({ attributes: {} })).toBeNull();
    expect(mapPoolSummary({ attributes: { address: 'x' } })).toBeNull();
  });

  it('rejects a negative reserve value', () => {
    const s = mapPoolSummary(pool({ reserve_in_usd: '-1' }));
    expect(s!.liquidityUsd).toBeNull();
  });

  it('maps canonical intervals onto the GT timeframe model', () => {
    const cases: [CandleInterval, { timeframe: string; aggregate: number }][] = [
      ['1m', { timeframe: 'minute', aggregate: 1 }],
      ['15m', { timeframe: 'minute', aggregate: 15 }],
      ['4h', { timeframe: 'hour', aggregate: 4 }],
      ['1d', { timeframe: 'day', aggregate: 1 }],
      ['1w', { timeframe: 'day', aggregate: 7 }],
    ];
    for (const [interval, expected] of cases) {
      expect(mapInterval(interval)).toEqual(expected);
    }
  });

  it('strips the network prefix from GT ids', () => {
    const s = mapPoolSummary(pool());
    expect(s!.topMarketId).toBe('solana:Gma1QtoLJHroZhod4bjW5ee9JoeJQ7zJsTadmVfSiBve');
  });
});

describe('CoinGecko normalization', () => {
  const coin = {
    id: 'solana',
    symbol: 'sol',
    name: 'Solana',
    market_cap_rank: 5,
    last_updated: '2026-10-10T07:00:00.000Z',
    links: { homepage: ['https://solana.com', 'https://solana.com/'] },
    market_data: {
      current_price: { usd: 110.28 },
      price_change_percentage_24h: 0.419,
      price_change_percentage_7d: 4.2,
      total_volume: { usd: 1_787_201_318 },
      market_cap: { usd: 64_926_233_473 },
      fully_diluted_valuation: { usd: 70_000_000_000 },
      circulating_supply: 545_000_000,
      total_supply: 600_000_000,
      ath: { usd: 293.31 },
      ath_change_percentage: { usd: -62.4 },
      atl: { usd: 0.023 },
      sparkline_in_7d: { price: Array.from({ length: 168 }, (_, i) => 100 + i) },
    },
  };

  it('maps a coin response into an AssetOverview', () => {
    const o = mapAssetOverview(coin);
    expect(o).not.toBeNull();
    expect(o!.priceUsd).toBeCloseTo(110.28);
    expect(o!.symbol).toBe('SOL');
    expect(o!.marketCap).toBeCloseTo(64_926_233_473);
    expect(o!.sparkline7d).toHaveLength(168);
    expect(o!.updatedAt).toBe(Date.parse('2026-10-10T07:00:00.000Z'));
    expect(o!.homepage).toBe('https://solana.com');
  });

  it('returns null when market_data is absent', () => {
    expect(mapAssetOverview({ id: 'x' })).toBeNull();
    expect(mapAssetOverview(null)).toBeNull();
  });

  it('nulls missing sub-objects instead of throwing', () => {
    const o = mapAssetOverview({ id: 'x', market_data: {} });
    expect(o).not.toBeNull();
    expect(o!.priceUsd).toBeNull();
    expect(o!.marketCap).toBeNull();
    expect(o!.volume24h).toBeNull();
    expect(o!.sparkline7d).toBeNull();
  });

  it('maps a market chart into flat candles and skips junk rows', () => {
    const points = mapMarketChart({
      prices: [
        [1_700_000_000_000, 100.5],
        ['bad', 1],
        [1_700_000_060_000, 101.25],
      ],
    });
    expect(points).toHaveLength(2);
    expect(points[0]!.time).toBe(1_700_000_000_000);
    expect(points[0]!.close).toBeCloseTo(100.5);
  });

  it('resolves mint addresses to coin ids', () => {
    expect(coinIdFor('So11111111111111111111111111111111111111112')).toBe('solana');
    expect(coinIdFor('solana')).toBe('solana');
    expect(coinIdFor('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v')).toBe('usd-coin');
    expect(coinIdFor('some-random-mint')).toBeNull();
  });
});