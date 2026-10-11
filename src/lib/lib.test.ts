import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  NA,
  changeToneClass,
  compact,
  formatAge,
  formatAmount,
  formatPct,
  formatPrice,
  formatUsdCompact,
  isNum,
  num,
  pricePrecision,
  truncateMiddle,
} from './format';
import {
  classifyIdentifier,
  dexscreenerUrl,
  explorerUrl,
  isEvmAddress,
  isSolanaAddress,
  isSolanaSignature,
} from './solana';

/**
 * The "missing is not zero" contract.
 *
 * These tests encode the single most important formatting rule in the app:
 * `null` renders as an em dash and never as 0.
 */

describe('format helpers', () => {
  it('recognises real numbers only', () => {
    expect(isNum(0)).toBe(true);
    expect(isNum(-1.5)).toBe(true);
    expect(isNum(Number.NaN)).toBe(false);
    expect(isNum(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isNum(null)).toBe(false);
    expect(isNum(undefined)).toBe(false);
  });

  it('coerces provider strings without inventing zeros', () => {
    expect(num('42.5')).toBe(42.5);
    expect(num('  ')).toBeNull();
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num({})).toBeNull();
  });

  it('formats zero as zero, not as a dash', () => {
    expect(formatPrice(0)).toBe('$0.00');
    expect(formatUsdCompact(0)).toBe('$0');
    expect(formatPct(0)).toBe('0.00%');
  });

  it('formats null as the em-dash placeholder', () => {
    expect(formatPrice(null)).toBe(NA);
    expect(formatUsdCompact(null)).toBe(NA);
    expect(formatPct(null)).toBe(NA);
    expect(formatAmount(undefined)).toBe(NA);
    expect(compact(null)).toBe(NA);
  });

  it('signs percentages explicitly', () => {
    expect(formatPct(1.234)).toBe('+1.23%');
    expect(formatPct(-1.234)).toBe('-1.23%');
  });

  it('scales compact notation', () => {
    expect(compact(999)).toBe('999');
    expect(compact(1_500)).toBe('1.5K');
    expect(compact(2_400_000)).toBe('2.4M');
    expect(compact(3_100_000_000)).toBe('3.1B');
    expect(compact(1_200_000_000_000)).toBe('1.2T');
  });

  it('adapts price precision to magnitude', () => {
    expect(pricePrecision(1500)).toBe(2);
    expect(pricePrecision(1.5)).toBe(4);
    expect(pricePrecision(0.0000123)).toBeGreaterThan(6);
  });

  it('keeps tiny token prices readable', () => {
    expect(formatPrice(0.0000097)).toMatch(/0\.00000/);
  });

  it('colours change values', () => {
    expect(changeToneClass(1)).toBe('text-bull');
    expect(changeToneClass(-1)).toBe('text-bear');
    expect(changeToneClass(0)).toBe('text-dim');
    expect(changeToneClass(null)).toBe('text-dim');
  });

  it('formats ages', () => {
    const now = 1_700_000_000_000;
    expect(formatAge(now, now + 5_000)).toBe('5s');
    expect(formatAge(now, now + 120_000)).toBe('2m');
    expect(formatAge(now, now + 7_200_000)).toBe('2h');
    expect(formatAge(now, now + 172_800_000)).toBe('2d');
    expect(formatAge(null)).toBe(NA);
  });

  it('truncates identifiers without losing their identity', () => {
    expect(truncateMiddle('ABCDEFGHIJKLMNOP', 4, 4)).toBe('ABCD…MNOP');
    expect(truncateMiddle('short', 4, 4)).toBe('short');
  });
});

describe('solana identifier validation', () => {
  const MINT = 'So11111111111111111111111111111111111111112';
  const ADDRESS = '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9';
  const SIG = '5wmVyoTuAH3pdWsynA48GjGdDCZWHjKU64RbLg3PgHrPVQuJbgnjrpR4o7wfZBX5m6JqJ3twWokQqH52eNxS7oNf';

  it('accepts valid base58 mints and addresses', () => {
    expect(isSolanaAddress(MINT)).toBe(true);
    expect(isSolanaAddress(ADDRESS)).toBe(true);
  });

  it('rejects invalid characters and lengths', () => {
    expect(isSolanaAddress('0x1234')).toBe(false);
    expect(isSolanaAddress('short')).toBe(false);
    expect(isSolanaAddress(`${MINT}O0Il`)).toBe(false); // 'O' and '0' are not base58
    expect(isSolanaAddress(12345)).toBe(false);
    expect(isSolanaAddress(null)).toBe(false);
  });

  it('accepts a real transaction signature and rejects short strings', () => {
    expect(isSolanaSignature(SIG)).toBe(true);
    expect(isSolanaSignature(MINT)).toBe(false);
    expect(isSolanaSignature('nope')).toBe(false);
  });

  it('classifies pasted identifiers', () => {
    expect(classifyIdentifier(SIG)).toBe('signature');
    expect(classifyIdentifier(ADDRESS)).toBe('address');
    expect(classifyIdentifier('hello world')).toBe('unknown');
  });

  it('recognises EVM addresses separately', () => {
    expect(isEvmAddress('0x1131db5977242a03ebead1acd18f80a9a29e5922')).toBe(true);
    expect(isEvmAddress(MINT)).toBe(false);
  });

  it('builds explorer links', () => {
    expect(explorerUrl('tx', SIG)).toBe(`https://solscan.io/tx/${SIG}`);
    expect(explorerUrl('token', MINT)).toBe(`https://solscan.io/token/${MINT}`);
    expect(explorerUrl('address', ADDRESS)).toBe(`https://solscan.io/account/${ADDRESS}`);
    expect(dexscreenerUrl('solana', 'ABC')).toBe('https://dexscreener.com/solana/abc');
  });
});

describe('IndexedDB persistence', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('round-trips watchlist state through IndexedDB', async () => {
    const { STORES, idbSet, idbGet, idbDelete, idbKeys } = await import('./idb');
    await idbSet(STORES.watchlists, 'k1', JSON.stringify({ hello: 'world' }));
    expect(await idbGet<string>(STORES.watchlists, 'k1')).toBe('{"hello":"world"}');
    expect(await idbKeys(STORES.watchlists)).toContain('k1');
    await idbDelete(STORES.watchlists, 'k1');
    expect(await idbGet(STORES.watchlists, 'k1')).toBeUndefined();
  });

  it('returns undefined instead of throwing when a key is absent', async () => {
    const { STORES, idbGet } = await import('./idb');
    expect(await idbGet(STORES.settings, 'never-written')).toBeUndefined();
  });

  it('never exports the secrets store', async () => {
    const { STORES } = await import('./idb');
    const { dumpAllStores } = await import('./storage');
    const dump = await dumpAllStores();
    expect(Object.keys(dump)).not.toContain(STORES.secrets);
  });
});

describe('workspace import/export', () => {
  it('round-trips a versioned bundle', async () => {
    const { buildExport, parseBundle, serializeExport } = await import('./workspace');
    const bundle = await buildExport();
    expect(bundle.format).toBe('iceberg-terminal.workspace');
    expect(bundle.version).toBe(1);
    const parsed = parseBundle(serializeExport(bundle));
    expect(parsed.format).toBe('iceberg-terminal.workspace');
  });

  it('rejects a malformed bundle with an actionable message', async () => {
    const { ImportError, parseBundle } = await import('./workspace');
    expect(() => parseBundle('not json')).toThrow(ImportError);
    expect(() => parseBundle('{"format":"other"}')).toThrow(/Unrecognized format/);
    expect(() => parseBundle('{"format":"iceberg-terminal.workspace"}')).toThrow(/version/i);
    expect(() =>
      parseBundle('{"format":"iceberg-terminal.workspace","version":99,"stores":{}}'),
    ).toThrow(/newer version/);
  });

  it('hard-strips any secrets store present in a hostile bundle', async () => {
    const { parseBundle } = await import('./workspace');
    const bundle = parseBundle(
      JSON.stringify({
        format: 'iceberg-terminal.workspace',
        version: 1,
        stores: { secrets: [{ state: { name: 'x', value: { apiKey: 'stolen' } } }], watchlists: [] },
      }),
    );
    expect(bundle.stores).not.toHaveProperty('secrets');
    expect(JSON.stringify(bundle)).not.toContain('stolen');
  });
});

describe('local vault encryption', () => {
  it('encrypts and decrypts with a passphrase', async () => {
    const { encryptSecret, decryptSecret, isEncrypted } = await import('./crypto');
    const envelope = await encryptSecret('sk-super-secret-value', 'correct horse');
    expect(isEncrypted(envelope)).toBe(true);
    expect(envelope.cipherText).not.toContain('super-secret');
    await expect(decryptSecret(envelope, 'correct horse')).resolves.toBe('sk-super-secret-value');
  });

  it('fails closed on a wrong passphrase', async () => {
    const { encryptSecret, decryptSecret } = await import('./crypto');
    const envelope = await encryptSecret('value', 'right-pass');
    await expect(decryptSecret(envelope, 'wrong-pass')).rejects.toBeTruthy();
  });

  it('rejects a too-short passphrase', async () => {
    const { encryptSecret } = await import('./crypto');
    await expect(encryptSecret('v', '123')).rejects.toThrow(/6 characters/);
  });

  it('marks obfuscated envelopes as not-really-encrypted', async () => {
    const { obfuscateSecret, isEncrypted, deobfuscate } = await import('./crypto');
    const envelope = await obfuscateSecret('plain-value');
    expect(isEncrypted(envelope)).toBe(false);
    expect(deobfuscate(envelope)).toBe('plain-value');
  });
});

describe('deterministic demo data', () => {
  it('produces identical values for identical seeds', async () => {
    const { demoTokenSummaries, demoCandles, demoMint } = await import('./demo');
    const a = demoTokenSummaries(5);
    const b = demoTokenSummaries(5);
    expect(a.map((x) => x.priceUsd)).toEqual(b.map((x) => x.priceUsd));
    expect(demoCandles('seed', { points: 10 }).map((c) => c.close)).toEqual(
      demoCandles('seed', { points: 10 }).map((c) => c.close),
    );
    expect(demoMint('ABC')).toBe(demoMint('ABC'));
  });

  it('labels every demo payload with origin "demo"', async () => {
    const { demoTokenSummaries, demoMarkets, demoWallet, demoCandleSeries, demoAssetOverview } = await import(
      './demo'
    );
    const s = demoTokenSummaries(1)[0]!;
    expect(s.provenance.origin).toBe('demo');
    expect(s.provenance.source).toContain('DEMO');
    expect(demoMarkets(1)[0]!.provenance.origin).toBe('demo');
    expect(demoWallet('addr').provenance.origin).toBe('demo');
    expect(demoCandleSeries('m', '1h').provenance.origin).toBe('demo');
    expect(demoAssetOverview().provenance.origin).toBe('demo');
  });

  it('never fabricates news', async () => {
    const { demoNews } = await import('./demo');
    expect(demoNews(50)).toEqual([]);
  });
});

describe('demo fallback policy', () => {
  it('returns demo data only when opted in, and propagates live errors', async () => {
    const { withDemoFallback } = await import('@/data/fallback');
    const demo = { value: 'synthetic' };

    const forced = await withDemoFallback(
      { forceDemo: true, disabled: false, requiresKey: false, hasKey: false, providerLabel: 'X', providerId: 'x' },
      async () => 'live',
      () => demo,
    );
    expect(forced).toEqual({ value: demo, fallback: 'forced-demo' });

    const unconfigured = await withDemoFallback(
      { forceDemo: false, disabled: false, requiresKey: true, hasKey: false, providerLabel: 'X', providerId: 'x' },
      async () => 'live',
      () => demo,
    );
    expect(unconfigured.fallback).toBe('provider-unconfigured');

    const live = await withDemoFallback(
      { forceDemo: false, disabled: false, requiresKey: false, hasKey: false, providerLabel: 'X', providerId: 'x' },
      async () => 'live',
      () => demo,
    );
    expect(live).toEqual({ value: 'live', fallback: null });
  });

  it('surfaces a real provider error instead of silently substituting demo data', async () => {
    const { withDemoFallback } = await import('@/data/fallback');
    await expect(
      withDemoFallback(
        { forceDemo: false, disabled: false, requiresKey: false, hasKey: false, providerLabel: 'X', providerId: 'x' },
        async () => {
          throw new Error('provider exploded');
        },
        () => ({ value: 'synthetic' }),
      ),
    ).rejects.toThrow('provider exploded');
  });

  it('reports a capability gap rather than pretending the provider supports it', async () => {
    const { withDemoFallback, ProviderUnavailableError } = await import('@/data/fallback');
    await expect(
      withDemoFallback(
        {
          forceDemo: false,
          disabled: false,
          requiresKey: false,
          hasKey: false,
          providerLabel: 'X',
          providerId: 'x',
          capabilityMissing: true,
        },
        async () => 'live',
        () => 'demo',
      ),
    ).rejects.toBeInstanceOf(ProviderUnavailableError);
  });
});