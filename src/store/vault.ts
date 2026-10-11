import { create } from 'zustand';
import {
  clearVault,
  cryptoAvailable,
  deobfuscate,
  decryptSecret,
  deleteSecret,
  encryptSecret,
  InvalidEnvelopeError,
  isEncrypted,
  listSecretProviderIds,
  loadSecret,
  obfuscateSecret,
  saveSecret,
} from '@/lib/crypto';
import { StorageError } from '@/lib/idb';
import { useProviderStore } from './providers';

/**
 * Session credential store.
 *
 * Design rules (enforced, documented in SECURITY.md):
 *  • Secrets live in memory only for the lifetime of the tab.
 *  • They are persisted exclusively as ciphertext, one envelope per provider.
 *  • They are never written to localStorage, never exported, never logged.
 *  • "Lock" drops all key material from memory; restoring it requires an
 *    explicit unlock with the passphrase.
 *
 * Lock-state invariants (these are the subtle part):
 *  1. `unlocked` is a property of the VAULT, not of any single credential.
 *     It must not be flipped to true as a side effect of storing a key.
 *  2. While the vault is locked, no credential may be read AND no new
 *     credential may be stored — otherwise "lock" would be cosmetic.
 *  3. Storing a key for a provider whose stored record is encrypted must not
 *     silently downgrade that record to weak obfuscation.
 *  4. Any storage failure is fail-CLOSED: if we cannot read the vault we
 *     cannot know what is in it, so we must not report it as unlocked.
 */

export interface VaultState {
  /** providerId -> decrypted key, memory only. */
  session: Record<string, string>;
  /** true when at least one stored envelope is passphrase-encrypted. */
  encrypted: boolean;
  /** true when at least one stored envelope is weak obfuscation. */
  obfuscated: boolean;
  unlocked: boolean;
  webCryptoAvailable: boolean;
  loading: boolean;
  error: string | null;
  /** Non-fatal problems, e.g. a single corrupt record among several. */
  warnings: string[];
  /** providerIds known to have a stored credential. */
  stored: string[];

  hydrate(): Promise<void>;
  unlock(passphrase: string): Promise<boolean>;
  lock(): void;
  setKey(providerId: string, key: string, passphrase?: string): Promise<void>;
  removeKey(providerId: string): Promise<void>;
  getKey(providerId: string): string | undefined;
  hasKey(providerId: string): boolean;
  clearAll(): Promise<void>;
}

export class VaultLockedError extends Error {
  constructor(message = 'The local vault is locked. Unlock it before managing credentials.') {
    super(message);
    this.name = 'VaultLockedError';
  }
}

function syncStoredFlags(stored: string[], encrypted: boolean, obfuscated: boolean) {
  for (const id of stored) {
    useProviderStore.getState().setProviderHasKey(id, true);
  }
  return { stored, encrypted, obfuscated };
}

export const useVaultStore = create<VaultState>((set, get) => ({
  session: {},
  encrypted: false,
  obfuscated: false,
  unlocked: false,
  webCryptoAvailable: cryptoAvailable(),
  loading: false,
  error: null,
  warnings: [],
  stored: [],

  async hydrate() {
    set({ loading: true, error: null, warnings: [] });
    let ids: string[] = [];
    try {
      ids = await listSecretProviderIds();
    } catch (e) {
      // Fail CLOSED: we cannot enumerate the vault, so we must not pretend the
      // user has no stored credentials or that it is open.
      set({
        loading: false,
        unlocked: false,
        session: {},
        error:
          e instanceof StorageError
            ? `${e.message} The vault has not been opened.`
            : 'Could not read the local credential vault. It has been left locked.',
      });
      return;
    }

    let encrypted = false;
    let obfuscated = false;
    const session: Record<string, string> = {};
    const warnings: string[] = [];

    for (const id of ids) {
      let env;
      try {
        env = await loadSecret(id);
      } catch (e) {
        // One corrupt record must not lock the user out of the others, but it
        // must be reported rather than silently skipped.
        warnings.push(
          e instanceof InvalidEnvelopeError
            ? `${id}: ${e.message}`
            : `${id}: stored credential could not be read.`,
        );
        continue;
      }
      if (!env) continue;
      if (isEncrypted(env)) {
        encrypted = true;
        continue; // requires an explicit unlock
      }
      try {
        obfuscated = true;
        session[id] = deobfuscate(env);
      } catch (e) {
        warnings.push(e instanceof Error ? `${id}: ${e.message}` : `${id}: could not be read.`);
      }
    }

    set({
      loading: false,
      session,
      // No encrypted records -> there is nothing to unlock.
      unlocked: !encrypted,
      warnings,
      ...syncStoredFlags(ids, encrypted, obfuscated),
      error: null,
    });
  },

  async unlock(passphrase) {
    set({ loading: true, error: null, warnings: [] });
    try {
      const ids = await listSecretProviderIds();
      const session: Record<string, string> = {};
      const warnings: string[] = [];

      for (const id of ids) {
        let env;
        try {
          env = await loadSecret(id);
        } catch (e) {
          warnings.push(e instanceof InvalidEnvelopeError ? `${id}: ${e.message}` : `${id}: unreadable.`);
          continue;
        }
        if (!env) continue;
        if (!isEncrypted(env)) {
          try {
            session[id] = deobfuscate(env);
          } catch {
            warnings.push(`${id}: could not be decoded.`);
          }
          continue;
        }
        try {
          session[id] = await decryptSecret(env, passphrase);
        } catch (e) {
          // A wrong passphrase is fatal for the unlock; a corrupt record is not.
          if (e instanceof InvalidEnvelopeError) {
            warnings.push(`${id}: ${e.message}`);
            continue;
          }
          set({ loading: false, error: 'Incorrect passphrase, or the local vault is corrupted.' });
          return false;
        }
      }

      set({ loading: false, session, unlocked: true, warnings, error: null });
      return true;
    } catch (e) {
      set({
        loading: false,
        unlocked: false,
        session: {},
        error: e instanceof StorageError ? `${e.message} The vault remains locked.` : 'Could not read the local vault.',
      });
      return false;
    }
  },

  lock() {
    // Always a real lock. The previous `unlocked: !encrypted` formulation meant
    // locking an obfuscation-only vault was a no-op, and left the UI claiming
    // it was open.
    set({ session: {}, unlocked: false, error: null });
  },

  async setKey(providerId, key, passphrase) {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('API key cannot be empty.');

    // Invariant 2: storing a credential must not silently unlock the vault.
    const state = get();
    if (state.encrypted && !state.unlocked) {
      throw new VaultLockedError();
    }

    // Invariant 3: never downgrade an encrypted record to weak obfuscation.
    const usePassphrase = Boolean(passphrase) && state.webCryptoAvailable;
    let existing: Awaited<ReturnType<typeof loadSecret>>;
    try {
      existing = await loadSecret(providerId);
    } catch {
      existing = undefined;
    }
    if (!usePassphrase && existing && isEncrypted(existing)) {
      throw new Error(
        'This provider already has a passphrase-encrypted key. Enter your vault passphrase to replace it — ' +
          'saving without one would downgrade it to weak obfuscation.',
      );
    }

    const envelope = usePassphrase
      ? await encryptSecret(trimmed, passphrase!)
      : await obfuscateSecret(trimmed);
    await saveSecret(providerId, envelope);

    // Invariant 1: `unlocked` reflects the vault, not this write. An
    // obfuscation-only vault is open by definition; an encrypted one stays as
    // it was.
    const stillEncrypted = state.encrypted || usePassphrase;
    set((s) => ({
      session: { ...s.session, [providerId]: trimmed },
      stored: s.stored.includes(providerId) ? s.stored : [...s.stored, providerId],
      encrypted: stillEncrypted,
      obfuscated: usePassphrase ? s.obfuscated : s.obfuscated || true,
      unlocked: stillEncrypted ? s.unlocked : true,
      error: null,
    }));
    useProviderStore.getState().setProviderHasKey(providerId, true);
  },

  async removeKey(providerId) {
    await deleteSecret(providerId);
    const stored = get().stored.filter((id) => id !== providerId);
    set((s) => {
      const session = { ...s.session };
      delete session[providerId];
      useProviderStore.getState().setProviderHasKey(providerId, false);
      return { session, stored, error: null };
    });
    if (stored.length === 0) await clearVault();
  },

  getKey(providerId) {
    // Invariant 2, read side: a locked vault yields nothing even if a
    // reference to stale state survived somewhere.
    if (!get().unlocked) return undefined;
    return get().session[providerId];
  },

  hasKey(providerId) {
    if (!get().unlocked) return false;
    return Boolean(get().session[providerId]);
  },

  async clearAll() {
    await clearVault();
    for (const id of get().stored) useProviderStore.getState().setProviderHasKey(id, false);
    set({ session: {}, stored: [], encrypted: false, obfuscated: false, unlocked: true, error: null, warnings: [] });
  },
}));

/** True when the vault holds credentials that require an explicit unlock. */
export function vaultRequiresUnlock(s: Pick<VaultState, 'encrypted' | 'unlocked'>): boolean {
  return s.encrypted && !s.unlocked;
}