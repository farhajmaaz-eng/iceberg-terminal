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
  type VaultEnvelope,
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
 *    explicit unlock.
 *
 * Lock-state invariants — `unlocked` describes the VAULT, never an individual
 * credential, which is where the subtle bugs live:
 *  1. Storing a key must never flip `unlocked` as a side effect.
 *  2. A deliberately locked vault refuses BOTH reads and writes.
 *  3. First-run setup is still possible: with no vault established there is
 *     nothing to protect, so the initial credential may be saved.
 *  4. A passphrase supplied while an encrypted vault exists must VERIFY
 *     against that vault before anything is persisted. Mixing two passphrases
 *     would produce a vault that neither passphrase can open.
 *  5. An encrypted record is never downgraded to weak obfuscation.
 *  6. A malformed RECORD is a warning; a storage FAILURE fails closed.
 */

export interface VaultState {
  /** providerId -> decrypted key, memory only. */
  session: Record<string, string>;
  /** true when at least one stored envelope is passphrase-encrypted. */
  encrypted: boolean;
  /** true when at least one stored envelope is weak obfuscation. */
  obfuscated: boolean;
  unlocked: boolean;
  /** True once the user explicitly locked the vault in this tab. */
  lockedByUser: boolean;
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

/** The supplied passphrase does not open the vault that already exists. */
export class PassphraseMismatchError extends Error {
  constructor() {
    super(
      'That passphrase does not open the existing encrypted vault. Use the passphrase you already set — ' +
        'credentials in one vault must share a single passphrase.',
    );
    this.name = 'PassphraseMismatchError';
  }
}

/**
 * Passphrases are compared after Unicode normalization so that visually
 * identical inputs (e.g. composed vs decomposed accents) cannot produce a
 * confusing mismatch or a vault that cannot be reopened.
 */
export function normalizePassphrase(passphrase: string): string {
  return passphrase.normalize('NFKC');
}

function syncStoredFlags(stored: string[], encrypted: boolean, obfuscated: boolean) {
  for (const id of stored) {
    useProviderStore.getState().setProviderHasKey(id, true);
  }
  return { stored, encrypted, obfuscated };
}

/**
 * How a per-record failure should be treated.
 *
 * `corrupt`  — the record itself is malformed. Isolated; warn and continue.
 * `storage`  — the database could not be read. Not isolated: we cannot know
 *               what else is in there, so the whole vault fails closed.
 */
type RecordFailure = 'corrupt' | 'storage';

function classifyRecordError(e: unknown): RecordFailure {
  if (e instanceof InvalidEnvelopeError) return 'corrupt';
  if (e instanceof StorageError) return 'storage';
  return 'corrupt';
}

export const useVaultStore = create<VaultState>((set, get) => ({
  session: {},
  encrypted: false,
  obfuscated: false,
  unlocked: false,
  lockedByUser: false,
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
        lockedByUser: false,
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
        // A malformed record is isolated and reported. A storage failure is
        // NOT: we cannot claim to know the rest of the vault, so fail closed.
        if (classifyRecordError(e) === 'storage') {
          set({
            loading: false,
            unlocked: false,
            lockedByUser: false,
            session: {},
            warnings,
            error:
              e instanceof StorageError
                ? `${e.message} The vault has been left locked.`
                : 'Could not read the local credential vault. It has been left locked.',
          });
          return;
        }
        warnings.push(e instanceof Error ? `${id}: ${e.message}` : `${id}: stored credential is malformed.`);
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
        warnings.push(e instanceof Error ? `${id}: ${e.message}` : `${id}: could not be decoded.`);
      }
    }

    set({
      loading: false,
      session,
      // No encrypted records -> there is nothing to unlock.
      unlocked: !encrypted,
      // A fresh load re-establishes the real state; only an explicit lock()
      // during this tab's lifetime sets this.
      lockedByUser: false,
      warnings,
      ...syncStoredFlags(ids, encrypted, obfuscated),
      error: null,
    });
  },

  async unlock(passphrase) {
    set({ loading: true, error: null, warnings: [] });
    const ids = await listSecretProviderIds().catch((e: unknown) => {
      set({
        loading: false,
        unlocked: false,
        session: {},
        error: e instanceof StorageError ? `${e.message} The vault remains locked.` : 'Could not read the local vault.',
      });
      return null;
    });
    if (ids === null) return false;

    const normalized = normalizePassphrase(passphrase);
    const session: Record<string, string> = {};
    const warnings: string[] = [];

    for (const id of ids) {
      let env;
      try {
        env = await loadSecret(id);
      } catch (e) {
        // Storage failure is not isolated — fail closed.
        if (classifyRecordError(e) === 'storage') {
          set({
            loading: false,
            unlocked: false,
            session: {},
            warnings,
            error:
              e instanceof StorageError
                ? `${e.message} The vault remains locked.`
                : 'Could not read the local vault. It remains locked.',
          });
          return false;
        }
        warnings.push(e instanceof Error ? `${id}: ${e.message}` : `${id}: unreadable.`);
        continue;
      }
      if (!env) continue;

      if (!isEncrypted(env)) {
        try {
          session[id] = deobfuscate(env);
        } catch (e) {
          warnings.push(e instanceof Error ? `${id}: ${e.message}` : `${id}: could not be decoded.`);
        }
        continue;
      }

      try {
        session[id] = await decryptSecret(env, normalized);
      } catch (e) {
        // A malformed record is isolated; a failed authentication is fatal for
        // the unlock because it means the passphrase is wrong.
        if (e instanceof InvalidEnvelopeError) {
          warnings.push(`${id}: ${e.message}`);
          continue;
        }
        set({ loading: false, session: {}, unlocked: false, error: 'Incorrect passphrase.' });
        return false;
      }
    }

    set({ loading: false, session, unlocked: true, lockedByUser: false, warnings, error: null });
    return true;
  },

  lock() {
    // Always a real lock, including for an obfuscation-only vault. Reopening
    // requires an explicit unlock() which re-reads from storage.
    set({ session: {}, unlocked: false, lockedByUser: true, error: null });
  },

  async setKey(providerId, key, passphrase) {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('API key cannot be empty.');

    const state = get();
    const hasVault = state.stored.length > 0;

    // Invariant 2 + 3: a deliberately locked vault refuses writes, but a
    // first-run setup (no vault established yet) is still allowed.
    if (state.lockedByUser && hasVault) {
      throw new VaultLockedError();
    }
    // An encrypted vault that is not open cannot be written to at all.
    if (state.encrypted && !state.unlocked) {
      throw new VaultLockedError();
    }

    const usePassphrase = Boolean(passphrase) && state.webCryptoAvailable;
    const normalized = usePassphrase ? normalizePassphrase(passphrase!) : '';

    // Load the existing record for THIS provider plus enough of the vault to
    // verify the passphrase against. Every check below happens BEFORE any
    // write, so a rejection leaves IndexedDB and memory untouched.
    let existing: VaultEnvelope | undefined;
    try {
      existing = await loadSecret(providerId);
    } catch (e) {
      // A malformed record for this provider is being replaced anyway; a
      // storage failure must abort.
      if (classifyRecordError(e) === 'storage') {
        throw e;
      }
      existing = undefined;
    }

    // Invariant 5: never downgrade an encrypted record to weak obfuscation.
    if (!usePassphrase && existing && isEncrypted(existing)) {
      throw new Error(
        'This provider already has a passphrase-encrypted key. Enter your vault passphrase to replace it — ' +
          'saving without one would downgrade it to weak obfuscation.',
      );
    }

    // Invariant 4: if the vault is already encrypted, the supplied passphrase
    // MUST open it. Writing a second passphrase would create a vault that
    // neither passphrase can unlock.
    if (usePassphrase && (state.encrypted || (existing && isEncrypted(existing)))) {
      const probe = await findEncryptedEnvelope(state.stored, existing);
      if (probe) {
        try {
          await decryptSecret(probe, normalized);
        } catch (e) {
          if (e instanceof InvalidEnvelopeError) {
            throw new Error(
              'The stored vault record is malformed and its passphrase cannot be verified. ' +
                'Clear the vault and re-enter your keys.',
            );
          }
          throw new PassphraseMismatchError();
        }
      }
    }

    const envelope = usePassphrase
      ? await encryptSecret(trimmed, normalized)
      : await obfuscateSecret(trimmed);
    await saveSecret(providerId, envelope);

    // Invariant 1: this write never flips `unlocked`. An obfuscation-only
    // vault is open by definition; an encrypted one stays exactly as it was.
    const stillEncrypted = state.encrypted || usePassphrase;
    set((s) => ({
      session: { ...s.session, [providerId]: trimmed },
      stored: s.stored.includes(providerId) ? s.stored : [...s.stored, providerId],
      encrypted: stillEncrypted,
      obfuscated: usePassphrase ? s.obfuscated : true,
      unlocked: stillEncrypted ? s.unlocked : true,
      lockedByUser: false,
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
    // Invariant 2, read side: a locked vault yields nothing even if a stale
    // reference to old state survived somewhere.
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
    set({
      session: {},
      stored: [],
      encrypted: false,
      obfuscated: false,
      unlocked: true,
      lockedByUser: false,
      error: null,
      warnings: [],
    });
  },
}));

/**
 * Find an envelope to verify a candidate passphrase against.
 *
 * Prefers the record already loaded for this provider, then any other stored
 * encrypted record. Returns `null` when every record is corrupt or there are
 * none — in which case verification is impossible and is skipped rather than
 * blocking a legitimate save.
 */
async function findEncryptedEnvelope(
  stored: string[],
  preferred: VaultEnvelope | undefined,
): Promise<VaultEnvelope | null> {
  if (preferred && isEncrypted(preferred)) return preferred;
  for (const id of stored) {
    try {
      const env = await loadSecret(id);
      if (env && isEncrypted(env)) return env;
    } catch {
      // Corrupt records are skipped; a storage failure here is not fatal to
      // the *verification* step because we simply fall through to "cannot
      // verify" and the save path already guards storage failures separately.
    }
  }
  return null;
}

/** True when the vault holds credentials that require an explicit unlock. */
export function vaultRequiresUnlock(s: Pick<VaultState, 'encrypted' | 'unlocked'>): boolean {
  return s.encrypted && !s.unlocked;
}

/** True when the vault is shut and must be unlocked before credentials can be read or written. */
export function vaultIsLocked(s: Pick<VaultState, 'unlocked' | 'lockedByUser' | 'stored'>): boolean {
  if (s.unlocked) return false;
  return s.lockedByUser && s.stored.length > 0;
}