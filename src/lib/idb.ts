/**
 * Minimal promise-based IndexedDB wrapper.
 *
 * Iceberg Terminal is local-first: watchlists, notes, layout and (optionally
 * encrypted) provider credentials live in the user's browser. Nothing is sent
 * to an Iceberg-controlled server because there isn't one.
 */

export const DB_NAME = 'iceberg-terminal';
export const DB_VERSION = 1;

export const STORES = {
  settings: 'settings',
  watchlists: 'watchlists',
  wallets: 'wallets',
  alerts: 'alerts',
  layouts: 'layouts',
  secrets: 'secrets',
  cache: 'cache',
} as const;

export type StoreName = (typeof STORES)[keyof typeof STORES];

let dbPromise: Promise<IDBDatabase> | null = null;

function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

export class StorageUnavailableError extends Error {
  constructor(message = 'IndexedDB is unavailable in this browser context.') {
    super(message);
    this.name = 'StorageUnavailableError';
  }
}

export function openDb(): Promise<IDBDatabase> {
  if (!isIndexedDbAvailable()) {
    return Promise.reject(new StorageUnavailableError());
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORES.settings)) db.createObjectStore(STORES.settings);
      if (!db.objectStoreNames.contains(STORES.watchlists)) db.createObjectStore(STORES.watchlists);
      if (!db.objectStoreNames.contains(STORES.wallets)) db.createObjectStore(STORES.wallets);
      if (!db.objectStoreNames.contains(STORES.alerts)) db.createObjectStore(STORES.alerts);
      if (!db.objectStoreNames.contains(STORES.layouts)) db.createObjectStore(STORES.layouts);
      if (!db.objectStoreNames.contains(STORES.secrets)) db.createObjectStore(STORES.secrets);
      if (!db.objectStoreNames.contains(STORES.cache)) db.createObjectStore(STORES.cache);
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(req.error ?? new StorageUnavailableError());
    req.onblocked = () => reject(new StorageUnavailableError('IndexedDB upgrade blocked by another tab.'));
  });

  dbPromise.catch(() => {
    dbPromise = null;
  });

  return dbPromise;
}

function tx<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error ?? new Error(`IndexedDB ${mode} failed on ${store}`));
      }),
  );
}

export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return await tx<T>(store, 'readonly', (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
}

export async function idbAll<T>(store: StoreName): Promise<T[]> {
  try {
    return await tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
  } catch {
    return [];
  }
}

export async function idbClear(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  try {
    const keys = await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
    return keys.filter((k): k is string => typeof k === 'string');
  } catch {
    return [];
  }
}

/** Destructive reset used by Settings › Reset local data. */
export async function wipeLocalData(): Promise<void> {
  const names = Object.values(STORES);
  for (const name of names) {
    try {
      await idbClear(name);
    } catch {
      // Best effort: a single failing store must not block the rest.
    }
  }
  try {
    localStorage.clear();
  } catch {
    // ignore
  }
}

export function __resetDbHandleForTests(): void {
  dbPromise = null;
}