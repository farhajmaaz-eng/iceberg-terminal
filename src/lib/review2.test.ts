import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

/** Recursively list files under `dir` whose name matches `re`. */
function walk(dir: string, re: RegExp): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, re));
    else if (re.test(entry.name)) out.push(full);
  }
  return out;
}
import {
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  InvalidEnvelopeError,
  encryptSecret,
  obfuscateSecret,
  validateEnvelope,
  type VaultEnvelope,
} from './crypto';
import { STORES, StorageError, idbEntries, idbWriteAtomic, wipeLocalData } from './idb';
import { validateStoreEntry } from './store-schema';
import {
  applyBundle,
  buildExport,
  parseBundle,
  ImportError,
} from './workspace';
import {
  useVaultStore,
  PassphraseMismatchError,
  VaultLockedError,
  normalizePassphrase,
  vaultIsLocked,
} from '@/store/vault';
import { _internals } from '@/providers/market/dexscreener';

const { totalTxns } = _internals;

/**
 * Regression tests for the second review pass.
 *
 * Each block maps to a numbered issue, and every failure-path test asserts
 * that a rejected operation changed NEITHER persisted nor in-memory state.
 */

// ── Issue 4: totalTxns must not silently omit a half-reported pool ──────────

function marketWithTxns(buys: number | null, sells: number | null, id: string) {
  return {
    id,
    chain: 'solana' as const,
    dex: 'raydium',
    pairAddress: id,
    url: null,
    base: { address: 'Mint1', symbol: 'A', name: 'A', chain: 'solana' as const },
    quote: { address: 'Mint2', symbol: 'B', name: 'B', chain: 'solana' as const },
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
    provenance: { origin: 'live' as const, source: 'test', fetchedAt: Date.now() },
  };
}

describe('issue 4: totalTxns with a half-reported pool', () => {
  it('returns null when one pool is complete and another omits sells', () => {
    // One fully reported pool (10 + 5 = 15) plus a pool that reports buys=7
    // but not sells. The complete pool alone would total 15.
    const total = totalTxns([marketWithTxns(10, 5, 'p1'), marketWithTxns(7, null, 'p2')] as never);
    expect(total).toBeNull();
    expect(total).not.toBe(15);
  });

  it('returns null when one pool is complete and another omits buys', () => {
    // THE REPORTED DEFECT: buys unknown, sells known. Previously this pool was
    // `continue`d, so the aggregate silently reported only the complete pool.
    const total = totalTxns([marketWithTxns(10, 5, 'p1'), marketWithTxns(null, 7, 'p2')] as never);
    expect(total).toBeNull();
    expect(total).not.toBe(15);
  });

  it('does not omit a half-reported pool in any ordering', () => {
    const partial = marketWithTxns(null, 7, 'partial');
    const complete = marketWithTxns(10, 5, 'complete');
    expect(totalTxns([partial, complete] as never)).toBeNull();
    expect(totalTxns([complete, partial] as never)).toBeNull();
  });

  it('still totals when every contributing pool is complete', () => {
    expect(totalTxns([marketWithTxns(10, 5, 'p1'), marketWithTxns(2, 1, 'p2')] as never)).toBe(18);
  });

  it('skips only pools that report neither component', () => {
    expect(totalTxns([marketWithTxns(10, 5, 'p1'), marketWithTxns(null, null, 'p2')] as never)).toBe(15);
  });

  it('treats zero as known', () => {
    expect(totalTxns([marketWithTxns(0, 0, 'p1'), marketWithTxns(1, 1, 'p2')] as never)).toBe(2);
  });

  it('returns null when nothing at all is known', () => {
    expect(totalTxns([marketWithTxns(null, null, 'p1')] as never)).toBeNull();
    expect(totalTxns([] as never)).toBeNull();
  });
});

// ── Issue 1: passphrase must match the existing encrypted vault ─────────────

describe('issue 1: passphrase verification against the existing vault', () => {
  const A = 'alpha-passphrase';
  const B = 'bravo-passphrase';

  beforeEach(async () => {
    await useVaultStore.getState().clearAll();
    await useVaultStore.getState().hydrate();
  });

  afterEach(async () => {
    await useVaultStore.getState().clearAll();
  });

  async function persisted(providerId: string): Promise<VaultEnvelope | undefined> {
    const { loadSecret } = await import('./crypto');
    return loadSecret(providerId);
  }

  it('rejects a second credential sealed with a different passphrase', async () => {
    await useVaultStore.getState().setKey('birdeye', 'key-a', A);
    const before = await persisted('birdeye');

    // Mixing passphrases would produce a vault that NEITHER passphrase opens.
    await expect(useVaultStore.getState().setKey('cryptopanic', 'key-b', B)).rejects.toBeInstanceOf(
      PassphraseMismatchError,
    );

    // Nothing persisted for the rejected provider...
    expect(await persisted('cryptopanic')).toBeUndefined();
    // ...and the existing record is byte-identical (untouched).
    expect(await persisted('birdeye')).toEqual(before);
  });

  it('leaves in-memory state unchanged after a mismatch', async () => {
    await useVaultStore.getState().setKey('birdeye', 'key-a', A);
    const snapshot = {
      session: { ...useVaultStore.getState().session },
      stored: [...useVaultStore.getState().stored],
      encrypted: useVaultStore.getState().encrypted,
    };

    await expect(useVaultStore.getState().setKey('cryptopanic', 'key-b', B)).rejects.toBeTruthy();

    const after = useVaultStore.getState();
    expect(after.session).toEqual(snapshot.session);
    expect(after.stored).toEqual(snapshot.stored);
    expect(after.encrypted).toBe(snapshot.encrypted);
    expect(after.getKey('cryptopanic')).toBeUndefined();
    expect(after.getKey('birdeye')).toBe('key-a');
  });

  it('accepts a second credential when the passphrase matches', async () => {
    await useVaultStore.getState().setKey('birdeye', 'key-a', A);
    await expect(useVaultStore.getState().setKey('cryptopanic', 'key-b', A)).resolves.toBeUndefined();
    expect(await persisted('cryptopanic')).toBeTruthy();
    // Both open with the one passphrase.
    useVaultStore.getState().lock();
    expect(await useVaultStore.getState().unlock(A)).toBe(true);
    expect(useVaultStore.getState().getKey('birdeye')).toBe('key-a');
    expect(useVaultStore.getState().getKey('cryptopanic')).toBe('key-b');
  });

  it('a mismatched add leaves the whole vault unlockable with the original passphrase', async () => {
    await useVaultStore.getState().setKey('birdeye', 'key-a', A);
    await expect(useVaultStore.getState().setKey('cryptopanic', 'key-b', B)).rejects.toBeTruthy();

    useVaultStore.getState().lock();
    expect(await useVaultStore.getState().unlock(A)).toBe(true);
  });

  it('verifies against the pre-existing record for the same provider too', async () => {
    await useVaultStore.getState().setKey('birdeye', 'key-a', A);
    await expect(useVaultStore.getState().setKey('birdeye', 'key-b', B)).rejects.toBeInstanceOf(
      PassphraseMismatchError,
    );
    useVaultStore.getState().lock();
    expect(await useVaultStore.getState().unlock(A)).toBe(true);
    expect(useVaultStore.getState().getKey('birdeye')).toBe('key-a');
  });

  it('normalizes equivalent Unicode passphrases', async () => {
    // "é" composed vs decomposed must be treated as the same passphrase.
    const composed = 'pässphrase-á';
    const decomposed = 'pässphrase-á';
    expect(normalizePassphrase(composed)).toBe(normalizePassphrase(decomposed));

    await useVaultStore.getState().setKey('birdeye', 'key-a', composed);
    await expect(useVaultStore.getState().setKey('cryptopanic', 'key-b', decomposed)).resolves.toBeUndefined();
  });
});

// ── Issue 2: obfuscation-only vault lock invariant ──────────────────────────

describe('issue 2: obfuscation-only vault lock invariant', () => {
  beforeEach(async () => {
    await useVaultStore.getState().clearAll();
    await useVaultStore.getState().hydrate();
  });

  afterEach(async () => {
    await useVaultStore.getState().clearAll();
  });

  it('preserves the first-run setup path when no vault exists', async () => {
    expect(useVaultStore.getState().stored).toHaveLength(0);
    await expect(useVaultStore.getState().setKey('birdeye', 'first-key')).resolves.toBeUndefined();
    expect(useVaultStore.getState().getKey('birdeye')).toBe('first-key');
    expect(useVaultStore.getState().encrypted).toBe(false);
    expect(useVaultStore.getState().obfuscated).toBe(true);
  });

  it('does NOT reopen on save after lock() for an obfuscation vault', async () => {
    await useVaultStore.getState().setKey('birdeye', 'first-key');
    expect(useVaultStore.getState().encrypted).toBe(false);

    useVaultStore.getState().lock();
    expect(useVaultStore.getState().unlocked).toBe(false);
    expect(vaultIsLocked(useVaultStore.getState())).toBe(true);

    // THE REPORTED DEFECT: this used to succeed and set unlocked=true.
    await expect(useVaultStore.getState().setKey('cryptopanic', 'second-key')).rejects.toBeInstanceOf(
      VaultLockedError,
    );

    const s = useVaultStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.getKey('birdeye')).toBeUndefined();
    expect(s.getKey('cryptopanic')).toBeUndefined();
  });

  it('a rejected save after lock() writes nothing to IndexedDB', async () => {
    await useVaultStore.getState().setKey('birdeye', 'first-key');
    useVaultStore.getState().lock();
    const before = await idbEntries(STORES.secrets);

    await expect(useVaultStore.getState().setKey('cryptopanic', 'second-key')).rejects.toBeTruthy();

    expect(await idbEntries(STORES.secrets)).toEqual(before);
  });

  it('allows reopening an obfuscation vault via unlock() with no passphrase', async () => {
    await useVaultStore.getState().setKey('birdeye', 'first-key');
    useVaultStore.getState().lock();

    expect(await useVaultStore.getState().unlock('')).toBe(true);
    expect(useVaultStore.getState().unlocked).toBe(true);
    expect(useVaultStore.getState().getKey('birdeye')).toBe('first-key');
  });

  it('a fresh hydrate() re-establishes state (lock is per-tab)', async () => {
    await useVaultStore.getState().setKey('birdeye', 'first-key');
    useVaultStore.getState().lock();
    await useVaultStore.getState().hydrate();
    expect(useVaultStore.getState().unlocked).toBe(true);
    expect(useVaultStore.getState().lockedByUser).toBe(false);
  });

  it('clearAll() restores the first-run setup path', async () => {
    await useVaultStore.getState().setKey('birdeye', 'first-key');
    useVaultStore.getState().lock();
    await useVaultStore.getState().clearAll();
    expect(useVaultStore.getState().lockedByUser).toBe(false);
    await expect(useVaultStore.getState().setKey('birdeye', 'again')).resolves.toBeUndefined();
  });
});

// ── Issue 3: malformed record vs storage failure ───────────────────────────

describe('issue 3: corrupt records warn, storage failures fail closed', () => {
  beforeEach(async () => {
    await useVaultStore.getState().clearAll();
    await wipeLocalData();
    await useVaultStore.getState().hydrate();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await useVaultStore.getState().clearAll();
    await wipeLocalData();
  });

  /** Write a syntactically valid store record whose contents are corrupt. */
  async function writeCorruptRecord(providerId: string) {
    const { saveSecret } = await import('./crypto');
    await saveSecret(providerId, {
      v: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: 999_999_999, // out of bounds -> InvalidEnvelopeError
      salt: 'AAAA',
      iv: 'AAAA',
      cipherText: 'AAAA',
      updatedAt: Date.now(),
    });
  }

  it('reports a malformed record as a warning and still hydrates', async () => {
    await writeCorruptRecord('corrupt-one');
    await useVaultStore.getState().setKey('birdeye', 'good-key');

    await useVaultStore.getState().hydrate();
    const s = useVaultStore.getState();

    expect(s.error).toBeNull();
    expect(s.warnings.some((w) => w.includes('corrupt-one'))).toBe(true);
    expect(s.stored).toContain('corrupt-one');
  });

  it('fails closed when reading an individual record hits a storage failure', async () => {
    await useVaultStore.getState().setKey('birdeye', 'good-key');

    // Simulate IndexedDB failing for one record read.
    const cryptoMod = await import('./crypto');
    const original = cryptoMod.loadSecret;
    vi.spyOn(cryptoMod, 'loadSecret').mockImplementation(async (id: string) => {
      if (id === 'birdeye') {
        throw new StorageError('readonly', STORES.secrets, new Error('disk on fire'));
      }
      return original(id);
    });

    await useVaultStore.getState().hydrate();
    const s = useVaultStore.getState();

    // MUST NOT be downgraded to a warning: the vault stays locked.
    expect(s.unlocked).toBe(false);
    expect(s.session).toEqual({});
    expect(s.getKey('birdeye')).toBeUndefined();
    expect(s.error).toMatch(/locked/i);
  });

  it('fails closed on a storage failure during unlock() too', async () => {
    await useVaultStore.getState().setKey('birdeye', 'good-key', 'passphrase');
    useVaultStore.getState().lock();

    const cryptoMod = await import('./crypto');
    vi.spyOn(cryptoMod, 'loadSecret').mockRejectedValue(
      new StorageError('readonly', STORES.secrets, new Error('disk on fire')),
    );

    const ok = await useVaultStore.getState().unlock('passphrase');
    expect(ok).toBe(false);
    const s = useVaultStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.session).toEqual({});
    expect(s.getKey('birdeye')).toBeUndefined();
  });

  it('fails closed when the vault cannot be enumerated at all', async () => {
    await useVaultStore.getState().setKey('birdeye', 'good-key');
    const cryptoMod = await import('./crypto');
    vi.spyOn(cryptoMod, 'listSecretProviderIds').mockRejectedValue(
      new StorageError('readonly', STORES.secrets, new Error('nope')),
    );

    await useVaultStore.getState().hydrate();
    expect(useVaultStore.getState().unlocked).toBe(false);
    expect(useVaultStore.getState().error).toBeTruthy();
  });
});

// ── Issue 7: per-store import validation ───────────────────────────────────

describe('issue 7: workspace import validates values per store', () => {
  const goodValue = JSON.stringify({ state: { lists: [] }, version: 1 });

  it('accepts a well-formed record', () => {
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', goodValue)).toEqual({ ok: true });
  });

  it('rejects the secrets and cache stores outright', () => {
    expect(validateStoreEntry('secrets', 'secret:birdeye', goodValue).ok).toBe(false);
    expect(validateStoreEntry('cache', 'anything', goodValue).ok).toBe(false);
  });

  it('rejects an unknown store', () => {
    expect(validateStoreEntry('mystery', 'x', goodValue).ok).toBe(false);
  });

  it('rejects a key that does not belong to the store', () => {
    expect(validateStoreEntry('watchlists', 'some.other.key', goodValue).ok).toBe(false);
    expect(validateStoreEntry('wallets', 'iceberg.watchlists.v1', goodValue).ok).toBe(false);
  });

  it('rejects a non-string value (the adapter only ever writes strings)', () => {
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', { state: {} }).ok).toBe(false);
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', null).ok).toBe(false);
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', 42).ok).toBe(false);
  });

  it('rejects invalid JSON', () => {
    const v = validateStoreEntry('watchlists', 'iceberg.watchlists.v1', '{not json');
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/JSON/i);
  });

  it('rejects a record missing state or version', () => {
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', JSON.stringify({ version: 1 })).ok).toBe(false);
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', JSON.stringify({ state: {} })).ok).toBe(false);
    expect(
      validateStoreEntry('watchlists', 'iceberg.watchlists.v1', JSON.stringify({ state: {}, version: 'x' })).ok,
    ).toBe(false);
  });

  it('rejects an absurdly long key or value', () => {
    expect(validateStoreEntry('watchlists', 'a'.repeat(500), goodValue).ok).toBe(false);
    expect(validateStoreEntry('watchlists', 'iceberg.watchlists.v1', 'x'.repeat(9_000_000)).ok).toBe(false);
  });

  it('never writes a malformed record, and reports why', async () => {
    await wipeLocalData();
    const bundle = parseBundle(
      JSON.stringify({
        format: 'iceberg-terminal.workspace',
        version: 1,
        stores: {
          watchlists: [
            { key: 'iceberg.watchlists.v1', value: goodValue },
            { key: 'iceberg.watchlists.v1', value: 'garbage' },
            { key: 'not-a-valid-key', value: goodValue },
          ],
        },
      }),
    );

    const report = await applyBundle(bundle);
    expect(report.written.watchlists).toBe(1);
    expect(report.skipped).toBe(2);
    expect(report.rejected.watchlists).toBeTruthy();

    // Only the valid record landed.
    const entries = await idbEntries(STORES.watchlists);
    expect(entries).toHaveLength(1);
    expect(entries[0]!.value).toBe(goodValue);
  });

  it('a rejected record leaves a previously stored value intact', async () => {
    await wipeLocalData();
    await idbWriteAtomic([{ store: STORES.wallets, key: 'iceberg.wallets.v1', value: goodValue }]);
    const before = await idbEntries(STORES.wallets);

    const bundle = parseBundle(
      JSON.stringify({
        format: 'iceberg-terminal.workspace',
        version: 1,
        stores: { wallets: [{ key: 'iceberg.wallets.v1', value: 'not-json' }] },
      }),
    );
    const report = await applyBundle(bundle);

    expect(report.written.wallets).toBe(0);
    expect(report.skipped).toBe(1);
    expect(await idbEntries(STORES.wallets)).toEqual(before);
  });

  it('an empty bundle is a valid no-op', async () => {
    await wipeLocalData();
    const report = await applyBundle(parseBundle(JSON.stringify({ format: 'iceberg-terminal.workspace', version: 1, stores: {} })));
    expect(report.total).toBe(0);
    expect(report.skipped).toBe(0);
  });

  it('still rejects a malformed bundle before touching storage', () => {
    expect(() => parseBundle('nope')).toThrow(ImportError);
  });

  it('a real export round-trips through validation', async () => {
    await wipeLocalData();
    await idbWriteAtomic([{ store: STORES.watchlists, key: 'iceberg.watchlists.v1', value: goodValue }]);
    const exported = await buildExport();
    await wipeLocalData();
    const report = await applyBundle(exported);
    expect(report.skipped).toBe(0);
    expect(report.written.watchlists).toBe(1);
  });
});

// ── Security hardening ─────────────────────────────────────────────────────

describe('security hardening', () => {
  it('index.html ships a restrictive Content-Security-Policy', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([\s\S]*?)"/);
    expect(csp).not.toBeNull();
    const policy = csp![1]!;

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("script-src 'self'");
    expect(policy).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(policy).not.toMatch(/script-src[^;]*unsafe-eval/);
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("base-uri 'none'");
    expect(policy).toContain("form-action 'none'");
    // Requests may only leave over TLS.
    expect(policy).toMatch(/connect-src[^;]*https:/);
  });

  it('does not claim frame-ancestors in the meta CSP, where it is ignored', () => {
    // frame-ancestors is header-only. A <meta> policy that lists it is
    // silently dropped by the browser, so asserting its presence here would
    // enshrine a false sense of clickjacking protection. The real protection
    // must live in public/_headers instead.
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const csp = html.match(/http-equiv="Content-Security-Policy"[\s\S]*?content="([\s\S]*?)"/);
    expect(csp).not.toBeNull();
    expect(csp![1]).not.toContain('frame-ancestors');

    const headers = readFileSync(resolve(process.cwd(), 'public/_headers'), 'utf8');
    expect(headers).toContain('X-Frame-Options: DENY');
    expect(headers).toMatch(/Content-Security-Policy:[^\n]*frame-ancestors/);
  });

  it('index.html ships a Permissions-Policy that denies device access', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    const m = html.match(/http-equiv="Permissions-Policy"[\s\S]*?content="([^"]*)"/);
    expect(m).not.toBeNull();
    const policy = m![1]!;
    for (const feature of ['camera=()', 'microphone=()', 'geolocation=()', 'payment=()', 'usb=()']) {
      expect(policy).toContain(feature);
    }
  });

  it('index.html declares a no-referrer policy', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
    expect(html).toMatch(/<meta\s+name="referrer"\s+content="no-referrer"/);
  });

  it('no untrusted HTML sinks exist in the source', () => {
    const files = walk(resolve(process.cwd(), 'src'), /\.(ts|tsx)$/);
    expect(files.length).toBeGreaterThan(20);
    for (const path of files) {
      if (path.endsWith('.test.ts') || path.endsWith('.test.tsx')) continue;
      const source = readFileSync(path, 'utf8');
      const rel = path.slice(process.cwd().length + 1);
      expect(source, `${rel} must not use dangerouslySetInnerHTML`).not.toContain('dangerouslySetInnerHTML');
      expect(source, `${rel} must not assign innerHTML`).not.toMatch(/\.innerHTML\s*=/);
      expect(source, `${rel} must not use insertAdjacentHTML`).not.toContain('insertAdjacentHTML');
    }
  });

  it('redaction covers hex private keys and keypair arrays', async () => {
    const { redact } = await import('./redact');
    // 0x + 128 hex = a 64-byte secret. Deliberately NOT 64 hex chars: that is
    // the length of an ordinary transaction hash, and redacting hashes would
    // destroy useful debugging context without protecting anything.
    expect(redact(`k=0x${'a'.repeat(128)}`)).toContain('[REDACTED_KEY_MATERIAL]');
    const pair = `[${Array.from({ length: 64 }, () => Math.floor(Math.random() * 100)).join(',')}]`;
    expect(redact(`keypair=${pair}`)).toContain('[REDACTED_KEY_MATERIAL]');
  });

  it('envelope validation still rejects absurd iteration counts', () => {
    const env = {
      v: 1,
      alg: 'AES-GCM',
      kdf: 'PBKDF2-SHA256',
      iterations: MIN_ITERATIONS - 1,
      salt: btoa('0123456789abcdef'),
      iv: btoa('123456789012'),
      cipherText: btoa('0123456789abcdefghijklmnop'),
      updatedAt: Date.now(),
    } satisfies VaultEnvelope;
    expect(() => validateEnvelope(env)).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope({ ...env, iterations: MAX_ITERATIONS + 1 })).toThrow(InvalidEnvelopeError);
  });

  it('round-trips a real encryption without weakening validation', async () => {
    const env = await encryptSecret('value', 'passphrase-long-enough');
    expect(() => validateEnvelope(env)).not.toThrow();
    const obf = await obfuscateSecret('value');
    expect(() => validateEnvelope(obf)).not.toThrow();
  });
});