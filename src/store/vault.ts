import { create } from 'zustand';
import {
  clearVault,
  cryptoAvailable,
  deobfuscate,
  decryptSecret,
  deleteSecret,
  encryptSecret,
  isEncrypted,
  listSecretProviderIds,
  loadSecret,
  obfuscateSecret,
  saveSecret,
} from '@/lib/crypto';
import { useProviderStore } from './providers';

/**
 * Session credential store.
 *
 * Design rules (enforced, documented in SECURITY.md):
 *  • Secrets live in memory only for the lifetime of the tab.
 *  • They are persisted exclusively as ciphertext, one envelope per provider.
 *  • They are never written to localStorage, never exported, never logged.
 *  • "Lock" drops all key material from memory and requires the passphrase
 *    to restore it.
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
  stored: [],

  async hydrate() {
    set({ loading: true, error: null });
    try {
      const ids = await listSecretProviderIds();
      let encrypted = false;
      let obfuscated = false;
      const session: Record<string, string> = {};
      for (const id of ids) {
        const env = await loadSecret(id);
        if (!env) continue;
        if (isEncrypted(env)) {
          encrypted = true;
          continue; // requires an explicit unlock
        }
        obfuscated = true;
        session[id] = deobfuscate(env);
      }
      set({
        loading: false,
        session,
        unlocked: !encrypted,
        ...syncStoredFlags(ids, encrypted, obfuscated),
        error: null,
      });
    } catch (e) {
      set({
        loading: false,
        error: e instanceof Error ? e.message : 'Failed to read the local vault.',
        unlocked: true,
      });
    }
  },

  async unlock(passphrase) {
    set({ loading: true, error: null });
    try {
      const ids = await listSecretProviderIds();
      const session: Record<string, string> = {};
      for (const id of ids) {
        const env = await loadSecret(id);
        if (!env) continue;
        if (!isEncrypted(env)) {
          session[id] = deobfuscate(env);
          continue;
        }
        session[id] = await decryptSecret(env, passphrase);
      }
      set({ loading: false, session, unlocked: true, error: null });
      return true;
    } catch {
      set({ loading: false, error: 'Incorrect passphrase, or the local vault is corrupted.' });
      return false;
    }
  },

  lock() {
    set({ session: {}, unlocked: !get().encrypted });
  },

  async setKey(providerId, key, passphrase) {
    const trimmed = key.trim();
    if (!trimmed) throw new Error('API key cannot be empty.');
    const usePassphrase = Boolean(passphrase) && get().webCryptoAvailable;
    const envelope = usePassphrase
      ? await encryptSecret(trimmed, passphrase!)
      : await obfuscateSecret(trimmed);
    await saveSecret(providerId, envelope);
    set((s) => ({
      session: { ...s.session, [providerId]: trimmed },
      stored: s.stored.includes(providerId) ? s.stored : [...s.stored, providerId],
      encrypted: usePassphrase || s.encrypted,
      obfuscated: !usePassphrase && s.obfuscated,
      unlocked: true,
      error: null,
    }));
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
    return get().session[providerId];
  },

  hasKey(providerId) {
    return Boolean(get().session[providerId]);
  },

  async clearAll() {
    await clearVault();
    for (const id of get().stored) useProviderStore.getState().setProviderHasKey(id, false);
    set({ session: {}, stored: [], encrypted: false, obfuscated: false, unlocked: true, error: null });
  },
}));