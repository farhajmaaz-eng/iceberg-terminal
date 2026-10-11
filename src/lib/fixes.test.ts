import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  MIN_ITERATIONS,
  MAX_ITERATIONS,
  InvalidEnvelopeError,
  deobfuscate,
  decryptSecret,
  encryptSecret,
  isEncrypted,
  obfuscateSecret,
  validateEnvelope,
  type VaultEnvelope,
} from './crypto';
import { STORES, StorageError, idbWriteAtomic, wipeLocalData } from './idb';
import {
  applyBundle,
  buildExport,
  parseBundle,
  serializeExport,
  ImportError,
} from './workspace';
import {
  __resetStorageHealthForTests,
  getStorageHealth,
  reportStorageProblem,
  describeStorageProblem,
} from './storage-health';
import { useVaultStore, VaultLockedError, vaultRequiresUnlock } from '@/store/vault';

/**
 * Regression tests for fixes 3-6.
 */

function validEnvelope(overrides: Partial<VaultEnvelope> = {}): VaultEnvelope {
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: 210_000,
    salt: btoa('0123456789abcdef'),
    iv: btoa('123456789012'),
    cipherText: btoa('0123456789abcdefghijklmnop'),
    updatedAt: Date.now(),
    ...overrides,
  };
}

// ── Fix 3: PBKDF2 iteration validation ───────────────────────────────────────

describe('vault envelope validation', () => {
  it('accepts a well-formed envelope', () => {
    expect(() => validateEnvelope(validEnvelope())).not.toThrow();
  });

  it('rejects an absurd iteration count before any KDF work happens', () => {
    // Regression: envelope.iterations went straight into deriveKey, so a
    // hostile IndexedDB record could hang the main thread for minutes.
    expect(() => validateEnvelope(validEnvelope({ iterations: 2_147_483_647 }))).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ iterations: Number.MAX_SAFE_INTEGER }))).toThrow(InvalidEnvelopeError);
  });

  it('rejects non-integer, zero, negative and NaN iteration counts', () => {
    for (const iterations of [0, -1, 1, 999, Number.NaN, Number.POSITIVE_INFINITY, 210_000.5]) {
      expect(() => validateEnvelope(validEnvelope({ iterations }))).toThrow(InvalidEnvelopeError);
    }
  });

  it('accepts the documented boundaries', () => {
    expect(() => validateEnvelope(validEnvelope({ iterations: MIN_ITERATIONS }))).not.toThrow();
    expect(() => validateEnvelope(validEnvelope({ iterations: MAX_ITERATIONS }))).not.toThrow();
  });

  it('names the offending field so the message is actionable', () => {
    try {
      validateEnvelope(validEnvelope({ iterations: 0 }));
      throw new Error('expected a throw');
    } catch (e) {
      expect(e).toBeInstanceOf(InvalidEnvelopeError);
      expect((e as InvalidEnvelopeError).field).toBe('iterations');
      expect((e as Error).message).toMatch(/range/i);
    }
  });

  it('rejects structurally invalid envelopes', () => {
    expect(() => validateEnvelope(null)).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ v: 2 as 1 }))).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ alg: 'ROT13' as 'AES-GCM' }))).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ kdf: 'MD5' as 'PBKDF2-SHA256' }))).toThrow(InvalidEnvelopeError);
  });

  it('rejects malformed or oversized base64 fields without allocating wildly', () => {
    expect(() => validateEnvelope(validEnvelope({ salt: '!!!not base64!!!' }))).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ salt: '' }))).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope(validEnvelope({ salt: 'AAAA' }))).toThrow(InvalidEnvelopeError); // 3 bytes < 8
    expect(() => validateEnvelope(validEnvelope({ iv: 'AAAA' }))).toThrow(InvalidEnvelopeError); // < 12 bytes
    expect(() => validateEnvelope(validEnvelope({ cipherText: 'A'.repeat(200_000) }))).toThrow(InvalidEnvelopeError);
  });

  it('does not let an obfuscation record claim a KDF cost', async () => {
    const obfPromise = obfuscateSecret('x');
    const obf = await obfPromise;
    expect(obf.alg).toBe('XOR');
    expect(() => validateEnvelope(obf)).not.toThrow();
    expect(() => validateEnvelope({ ...obf, kdf: 'PBKDF2-SHA256' })).toThrow(InvalidEnvelopeError);
    expect(() => validateEnvelope({ ...obf, iterations: 210_000 })).toThrow(InvalidEnvelopeError);
  });

  it('isEncrypted no longer accepts an out-of-range iteration count', () => {
    expect(isEncrypted(validEnvelope())).toBe(true);
    expect(isEncrypted(validEnvelope({ iterations: 2 }))).toBe(false);
    expect(isEncrypted(validEnvelope({ iterations: 2_147_483_647 }))).toBe(false);
    expect(isEncrypted(validEnvelope({ iterations: Number.NaN }))).toBe(false);
    expect(isEncrypted(validEnvelope({ alg: 'XOR', kdf: 'NONE', iterations: 0 }))).toBe(false);
  });

  it('decryptSecret refuses a tampered iteration count instead of running the KDF', async () => {
    const real = await encryptSecret('secret-value', 'correct-pass');
    const tampered = { ...real, iterations: 2_147_483_647 };
    await expect(decryptSecret(tampered, 'correct-pass')).rejects.toBeInstanceOf(InvalidEnvelopeError);
  });

  it('decryptSecret still reports a wrong passphrase clearly', async () => {
    const real = await encryptSecret('secret-value', 'correct-pass');
    await expect(decryptSecret(real, 'wrong-pass')).rejects.toThrow(/wrong passphrase|altered/i);
    await expect(decryptSecret(real, 'correct-pass')).resolves.toBe('secret-value');
  });

  it('deobfuscate validates its input', () => {
    expect(() => deobfuscate({ ...validEnvelope(), alg: 'XOR', kdf: 'NONE', iterations: 0, iv: '' })).not.toThrow();
    expect(() =>
      deobfuscate({ ...validEnvelope(), alg: 'XOR', kdf: 'NONE', iterations: 0, iv: '', salt: 'AAAA' }),
    ).toThrow(InvalidEnvelopeError);
  });
});

// ── Fix 4: vault lock-state transitions ─────────────────────────────────────

describe('vault lock-state transitions', () => {
  const provider = 'birdeye';

  beforeEach(async () => {
    await useVaultStore.getState().clearAll();
    useVaultStore.setState({ warnings: [], error: null, loading: false });
    await useVaultStore.getState().hydrate();
  });

  afterEach(async () => {
    await useVaultStore.getState().clearAll();
  });

  it('starts unlocked when there are no encrypted records', () => {
    const s = useVaultStore.getState();
    expect(s.encrypted).toBe(false);
    expect(s.unlocked).toBe(true);
  });

  it('hydrates an encrypted vault in the locked state', async () => {
    await useVaultStore.getState().setKey(provider, 'key-value', 'my-passphrase');
    expect(useVaultStore.getState().encrypted).toBe(true);

    // Simulate a fresh tab: memory is gone, only ciphertext remains.
    useVaultStore.setState({ session: {}, unlocked: false });
    await useVaultStore.getState().hydrate();

    const s = useVaultStore.getState();
    expect(s.encrypted).toBe(true);
    expect(s.unlocked).toBe(false);
    expect(s.getKey(provider)).toBeUndefined();
  });

  it('lock() is a real lock and stays locked for an obfuscation-only vault', async () => {
    await useVaultStore.getState().setKey(provider, 'key-value');
    expect(useVaultStore.getState().encrypted).toBe(false);

    useVaultStore.getState().lock();

    const s = useVaultStore.getState();
    // Regression: lock() used to compute `unlocked: !encrypted`, which left an
    // obfuscation-only vault reporting itself as open.
    expect(s.unlocked).toBe(false);
    expect(s.getKey(provider)).toBeUndefined();
    expect(s.hasKey(provider)).toBe(false);
    expect(vaultRequiresUnlock(s)).toBe(false); // nothing to unlock, but still locked
  });

  it('unlock() restores key material after lock', async () => {
    await useVaultStore.getState().setKey(provider, 'key-value', 'my-passphrase');
    useVaultStore.getState().lock();
    expect(useVaultStore.getState().getKey(provider)).toBeUndefined();

    const ok = await useVaultStore.getState().unlock('my-passphrase');
    expect(ok).toBe(true);
    expect(useVaultStore.getState().unlocked).toBe(true);
    expect(useVaultStore.getState().getKey(provider)).toBe('key-value');
  });

  it('unlock() fails closed on a wrong passphrase', async () => {
    await useVaultStore.getState().setKey(provider, 'key-value', 'my-passphrase');
    useVaultStore.getState().lock();

    const ok = await useVaultStore.getState().unlock('nope');
    expect(ok).toBe(false);
    const s = useVaultStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.session).toEqual({});
    expect(s.getKey(provider)).toBeUndefined();
    expect(s.error).toMatch(/passphrase|corrupted/i);
  });

  it('REFUSES to store a key while locked (no silent unlock)', async () => {
    await useVaultStore.getState().setKey(provider, 'first', 'my-passphrase');
    useVaultStore.getState().lock();
    expect(useVaultStore.getState().unlocked).toBe(false);

    // Regression: setKey used to write straight into the session and set
    // `unlocked: true`, so storing a key quietly reopened a locked vault.
    await expect(useVaultStore.getState().setKey('cryptopanic', 'other-key', 'my-passphrase')).rejects.toBeInstanceOf(
      VaultLockedError,
    );

    const s = useVaultStore.getState();
    expect(s.unlocked).toBe(false);
    expect(s.getKey(provider)).toBeUndefined();
    expect(s.getKey('cryptopanic')).toBeUndefined();
  });

  it('storing a key does not flip an already-unlocked vault closed', async () => {
    await useVaultStore.getState().setKey(provider, 'first', 'my-passphrase');
    await useVaultStore.getState().unlock('my-passphrase');
    expect(useVaultStore.getState().unlocked).toBe(true);

    await useVaultStore.getState().setKey('cryptopanic', 'second', 'my-passphrase');
    expect(useVaultStore.getState().unlocked).toBe(true);
    expect(useVaultStore.getState().getKey('cryptopanic')).toBe('second');
  });

  it('refuses to silently downgrade an encrypted record to obfuscation', async () => {
    await useVaultStore.getState().setKey(provider, 'first', 'my-passphrase');
    await useVaultStore.getState().unlock('my-passphrase');

    // No passphrase this time. Writing obfuscated storage would replace real
    // encryption with weak XOR while `encrypted` stayed true.
    await expect(useVaultStore.getState().setKey(provider, 'second')).rejects.toThrow(/downgrade|passphrase/i);

    // The original encrypted value must still be intact.
    useVaultStore.getState().lock();
    const ok = await useVaultStore.getState().unlock('my-passphrase');
    expect(ok).toBe(true);
    expect(useVaultStore.getState().getKey(provider)).toBe('first');
  });

  it('allows an obfuscated write when no passphrase was ever set', async () => {
    await useVaultStore.getState().setKey(provider, 'plain-key');
    expect(useVaultStore.getState().obfuscated).toBe(true);
    expect(useVaultStore.getState().getKey(provider)).toBe('plain-key');
  });

  it('clearAll() leaves the vault open and empty', async () => {
    await useVaultStore.getState().setKey(provider, 'key', 'my-passphrase');
    await useVaultStore.getState().clearAll();
    const s = useVaultStore.getState();
    expect(s.encrypted).toBe(false);
    expect(s.unlocked).toBe(true);
    expect(s.stored).toEqual([]);
  });
});

// ── Fix 5 + 6: storage failures and atomic import ────────────────────────────

describe('storage failures are not empty data', () => {
  beforeEach(() => {
    __resetStorageHealthForTests();
  });

  it('reports a distinct error kind for a storage failure', () => {
    reportStorageProblem({ kind: 'unavailable', message: 'blocked' });
    const health = getStorageHealth();
    expect(health.available).toBe(false);
    expect(health.problems[0]!.kind).toBe('unavailable');
    expect(describeStorageProblem(health.problems[0]!)).toMatch(/unavailable/i);
  });

  it('distinguishes a quota failure from a generic failure', () => {
    reportStorageProblem({ kind: 'quota', message: 'quota exceeded' });
    expect(describeStorageProblem(getStorageHealth().problems[0]!)).toMatch(/quota/i);
  });

  it('exports THROW rather than silently producing an empty bundle', async () => {
    // Simulate a blocked database: fake-indexeddb is available, so patch the
    // global to make open() fail.
    const original = globalThis.indexedDB;
    // @ts-expect-error — deliberately breaking the global for this test
    globalThis.indexedDB = undefined;
    try {
      await expect(buildExport()).rejects.toBeInstanceOf(StorageError);
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it('a wipe failure is reported per store rather than claimed as success', async () => {
    const report = await wipeLocalData();
    expect(report.cleared.length + report.failed.length).toBeGreaterThan(0);
    expect(Array.isArray(report.failed)).toBe(true);
  });
});

describe('workspace import is atomic', () => {
  const validBundle = {
    format: 'iceberg-terminal.workspace',
    version: 1,
    stores: {
      watchlists: [
        { state: { name: 'iceberg.watchlists.v1', value: { state: { lists: ['a'] }, version: 1 } } },
        { state: { name: 'iceberg.watchlists.v2', value: { state: { lists: ['b'] }, version: 1 } } },
      ],
      wallets: [{ state: { name: 'iceberg.wallets.v1', value: { state: { wallets: [] }, version: 1 } } }],
    },
  };

  it('writes every record and reports exactly what landed', async () => {
    const bundle = parseBundle(JSON.stringify(validBundle));
    const report = await applyBundle(bundle);
    expect(report.total).toBe(3);
    expect(report.written.watchlists).toBe(2);
    expect(report.written.wallets).toBe(1);
    expect(report.skipped).toBe(0);

    // Verify the records are actually readable back.
    const after = await buildExport();
    expect(after.stores.watchlists).toHaveLength(2);
    expect(after.stores.wallets).toHaveLength(1);
  });

  it('counts unusable entries as skipped instead of silently dropping them', async () => {
    const bundle = parseBundle(
      JSON.stringify({
        ...validBundle,
        stores: {
          watchlists: [
            { state: { name: 'ok', value: { a: 1 } } },
            { notState: true },
            { state: { value: 1 } },
            { state: { name: 'noValue' } },
            'a string',
          ],
        },
      }),
    );
    const report = await applyBundle(bundle);
    expect(report.total).toBe(1);
    expect(report.skipped).toBe(4);
  });

  it('never writes the secrets store, even if the bundle names it', async () => {
    const bundle = parseBundle(
      JSON.stringify({
        ...validBundle,
        stores: { secrets: [{ state: { name: 'secret:birdeye', value: 'stolen' } }] },
      }),
    );
    const report = await applyBundle(bundle);
    expect(report.total).toBe(0);
    const after = await buildExport();
    expect(JSON.stringify(after)).not.toContain('stolen');
    expect(after.stores).not.toHaveProperty('secrets');
  });

  it('flags unknown stores so the user knows data was ignored', async () => {
    const bundle = parseBundle(JSON.stringify({ ...validBundle, stores: { mystery: [{ state: { name: 'x', value: 1 } }] } }));
    const report = await applyBundle(bundle);
    expect(report.unknownStores).toEqual(['mystery']);
  });

  it('leaves NOTHING behind when a write fails part-way through', async () => {
    await wipeLocalData();
    const before = await buildExport();

    const bundle = parseBundle(
      JSON.stringify({
        ...validBundle,
        stores: {
          watchlists: [{ state: { name: 'good', value: { ok: true } } }],
          wallets: [{ state: { name: 'bad', value: { alsoFine: true } } }],
        },
      }),
    );

    // Inject a genuine mid-transaction failure: the second put throws.
    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function patched(this: IDBObjectStore, ...args: unknown[]) {
      calls++;
      if (calls === 2) throw new Error('simulated storage failure');
      return originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
    } as IDBObjectStore['put'];

    try {
      await expect(applyBundle(bundle)).rejects.toBeTruthy();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    const after = await buildExport();
    // Neither the good nor the bad record survived: the import was atomic.
    expect(after.stores.watchlists).toEqual(before.stores.watchlists);
    expect(after.stores.wallets).toEqual(before.stores.wallets);
  });

  it('idbWriteAtomic with a mid-transaction failure commits nothing', async () => {
    await wipeLocalData();
    await idbWriteAtomic([{ store: STORES.alerts, key: 'seed', value: { ok: 1 } }]);

    const originalPut = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function patched(this: IDBObjectStore, ...args: unknown[]) {
      calls++;
      if (calls === 2) throw new Error('simulated storage failure');
      return originalPut.apply(this, args as Parameters<IDBObjectStore['put']>);
    } as IDBObjectStore['put'];

    try {
      await expect(
        idbWriteAtomic([
          { store: STORES.alerts, key: 'ok', value: { fine: true } },
          { store: STORES.alerts, key: 'bad', value: { nope: true } },
        ]),
      ).rejects.toBeTruthy();
    } finally {
      IDBObjectStore.prototype.put = originalPut;
    }

    const bundle = await buildExport();
    expect(bundle.stores.alerts).toHaveLength(1); // only the pre-existing seed
  });

  it('round-trips a bundle without loss', async () => {
    await wipeLocalData();
    await idbWriteAtomic([{ store: STORES.wallets, key: 'iceberg.wallets.v1', value: { state: { wallets: ['x'] } } }]);
    const first = await buildExport();
    await wipeLocalData();
    await applyBundle(parseBundle(serializeExport(first)));
    const second = await buildExport();
    expect(second.stores.wallets).toEqual(first.stores.wallets);
  });

  it('rejects a malformed bundle before touching storage', () => {
    expect(() => parseBundle('not json')).toThrow(ImportError);
    expect(() => parseBundle(JSON.stringify({ format: 'other', version: 1 }))).toThrow(ImportError);
  });
});