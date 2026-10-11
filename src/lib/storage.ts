import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { STORES, idbDelete, idbEntries, idbGet, idbSet, type StoreName, type StoredEntry } from './idb';
import { recordStorageError } from './storage-health';

/**
 * Zustand persistence adapter backed by IndexedDB.
 *
 * Preferences survive reloads and stay local to the browser. Secrets are NOT
 * stored here — they live in the dedicated encrypted vault.
 *
 * Values are stored already-serialized (as zustand expects) and parsed on read,
 * so a corrupted record degrades to `null` instead of crashing the store.
 *
 * A *corrupt record* and a *storage failure* are different things. A corrupt
 * record genuinely has no value, so `null` is correct. A storage failure means
 * we could not ask the question at all — that is recorded in the storage-health
 * store (and surfaced to the user as a banner) rather than being silently
 * reported as "no data".
 */

export function idbStorage(store: StoreName): PersistStorage<unknown> {
  return {
    getItem: async (name): Promise<StorageValue<unknown> | null> => {
      let raw: string | undefined;
      try {
        raw = await idbGet<string>(store, name);
      } catch (e) {
        // Degrade so the app still boots, but do not pretend the store is empty.
        recordStorageError('read', e);
        return null;
      }
      if (typeof raw !== 'string') return null;
      try {
        return JSON.parse(raw) as StorageValue<unknown>;
      } catch {
        // Genuinely corrupt record — this one really is unusable.
        return null;
      }
    },
    setItem: async (name, value) => {
      try {
        await idbSet(store, name, JSON.stringify(value));
      } catch (e) {
        recordStorageError('write', e);
        // Re-throw: zustand's persist layer treats a rejected setItem as a
        // genuine save failure, and the caller can report it.
        throw e;
      }
    },
    removeItem: async (name) => {
      try {
        await idbDelete(store, name);
      } catch (e) {
        recordStorageError('write', e);
        throw e;
      }
    },
  };
}

export const settingsStorage = idbStorage(STORES.settings);
export const watchlistStorage = idbStorage(STORES.watchlists);
export const walletsStorage = idbStorage(STORES.wallets);
export const alertsStorage = idbStorage(STORES.alerts);
export const layoutStorage = idbStorage(STORES.layouts);

/**
 * Full local backup used by Settings › Export workspace.
 *
 * Entries are emitted as explicit `{ key, value }` pairs. `getAll()` would
 * return values only and silently drop the record keys, which makes the export
 * impossible to import — a "successful" export that restores nothing.
 *
 * Strict: a store that cannot be read throws, so an export never quietly
 * produces a file that is missing data the user believed they were saving.
 */
export async function dumpAllStores(): Promise<Record<string, StoredEntry[]>> {
  const names = Object.values(STORES);
  const out: Record<string, StoredEntry[]> = {};
  for (const name of names) {
    // The secrets store is intentionally excluded — never export credentials.
    if (name === STORES.secrets) continue;
    try {
      out[name] = await idbEntries(name);
    } catch (e) {
      recordStorageError('read', e);
      throw e;
    }
  }
  return out;
}