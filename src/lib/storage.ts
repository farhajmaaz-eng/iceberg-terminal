import type { PersistStorage, StorageValue } from 'zustand/middleware';
import { STORES, idbAll, idbDelete, idbGet, idbSet, type StoreName } from './idb';

/**
 * Zustand persistence adapter backed by IndexedDB.
 *
 * Preferences survive reloads and stay local to the browser. Secrets are NOT
 * stored here — they live in the dedicated encrypted vault.
 *
 * Values are stored already-serialized (as zustand expects) and parsed on read,
 * so a corrupted record degrades to `null` instead of crashing the store.
 */

export function idbStorage(store: StoreName): PersistStorage<unknown> {
  return {
    getItem: async (name): Promise<StorageValue<unknown> | null> => {
      const raw = await idbGet<string>(store, name);
      if (typeof raw !== 'string') return null;
      try {
        return JSON.parse(raw) as StorageValue<unknown>;
      } catch {
        return null;
      }
    },
    setItem: async (name, value) => {
      await idbSet(store, name, JSON.stringify(value));
    },
    removeItem: async (name) => {
      await idbDelete(store, name);
    },
  };
}

export const settingsStorage = idbStorage(STORES.settings);
export const watchlistStorage = idbStorage(STORES.watchlists);
export const walletsStorage = idbStorage(STORES.wallets);
export const alertsStorage = idbStorage(STORES.alerts);
export const layoutStorage = idbStorage(STORES.layouts);

/** Full local backup used by Settings › Export workspace. */
export async function dumpAllStores(): Promise<Record<string, unknown[]>> {
  const names = Object.values(STORES);
  const out: Record<string, unknown[]> = {};
  for (const name of names) {
    // The secrets store is intentionally excluded — never export credentials.
    if (name === STORES.secrets) continue;
    out[name] = await idbAll<unknown>(name);
  }
  return out;
}