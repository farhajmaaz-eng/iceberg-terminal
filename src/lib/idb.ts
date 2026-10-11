/**
 * Minimal promise-based IndexedDB wrapper.
 *
 * Iceberg Terminal is local-first: watchlists, notes, layout and (optionally
 * encrypted) provider credentials live in the user's browser. Nothing is sent
 * to an Iceberg-controlled server because there isn't one.
 *
 * ERROR SEMANTICS (important):
 *   Read/write helpers **throw** when storage fails. A blocked, quota-exceeded
 *   or unavailable database must never be indistinguishable from "no data" —
 *   silently returning an empty watchlist would make the user think their data
 *   was deleted, and would let an export quietly produce an empty file.
 *   Callers that genuinely want best-effort behaviour must opt in explicitly via
 *   the `bestEffort*` helpers.
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

/** A read/write failed. Distinct from "the store is empty". */
export class StorageError extends Error {
  readonly store: StoreName | null;
  readonly operation: string;
  override readonly cause?: unknown;

  constructor(operation: string, store: StoreName | null, cause?: unknown) {
    super(
      `Storage ${operation} failed${store ? ` for "${store}"` : ''}. ` +
        'Your data may still be intact — this usually means IndexedDB is blocked, ' +
        'out of quota, or unavailable in this browser context.',
    );
    this.name = 'StorageError';
    this.store = store;
    this.operation = operation;
    this.cause = cause;
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

function tx<T>(
  store: StoreName,
  mode: IDBTransactionMode,
  fn: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  // openDb() rejects with StorageUnavailableError (we have no store context yet);
  // wrap it so callers only ever have to handle StorageError.
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        let t: IDBTransaction;
        try {
          t = db.transaction(store, mode);
        } catch (e) {
          reject(new StorageError(mode, store, e));
          return;
        }
        const req = fn(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(new StorageError(mode, store, req.error));
      }),
    (e: unknown) => {
      throw e instanceof StorageError ? e : new StorageError(mode, store, e);
    },
  );
}

/** One key/value pair from a store. Keys are part of the data and must not be lost. */
export interface StoredEntry {
  key: string;
  value: unknown;
}

/**
 * Read every entry in a store as explicit key/value pairs.
 *
 * `getAll()` returns values only and discards the keys, which makes an export
 * impossible to restore. Workspace export/import needs the keys.
 */
export async function idbEntries(store: StoreName): Promise<StoredEntry[]> {
  const db = await openDb().catch((e: unknown) => {
    throw e instanceof StorageError ? e : new StorageError('readonly', store, e);
  });

  return new Promise<StoredEntry[]>((resolve, reject) => {
    let t: IDBTransaction;
    try {
      t = db.transaction(store, 'readonly');
    } catch (e) {
      reject(new StorageError('readonly', store, e));
      return;
    }
    const out: StoredEntry[] = [];
    const req = t.objectStore(store).openCursor();
    req.onsuccess = () => {
      const cursor = req.result;
      if (!cursor) return;
      if (typeof cursor.key === 'string') out.push({ key: cursor.key, value: cursor.value });
      cursor.continue();
    };
    req.onerror = () => reject(new StorageError('readonly', store, req.error));
    t.oncomplete = () => resolve(out);
    t.onabort = () => reject(new StorageError('readonly', store, t.error));
  });
}

/**
 * Run every write inside a SINGLE transaction spanning all target stores.
 *
 * IndexedDB transactions are atomic: if any request fails the whole
 * transaction aborts and no store is modified. This is what makes a workspace
 * import all-or-nothing rather than leaving the app half-restored.
 *
 * All requests must be issued synchronously — the transaction auto-commits
 * once the microtask queue drains.
 */
export async function idbWriteAtomic(
  writes: { store: StoreName; key: string; value: unknown }[],
): Promise<void> {
  if (writes.length === 0) return;

  const stores = [...new Set(writes.map((w) => w.store))];
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    throw e instanceof StorageError ? e : new StorageError('readwrite', null, e);
  }

  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, 'readwrite');
    } catch (e) {
      reject(new StorageError('readwrite', null, e));
      return;
    }

    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      try {
        t.abort();
      } catch {
        /* already aborting */
      }
      reject(new StorageError('readwrite', null, cause));
    };

    t.oncomplete = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error ?? new Error('Transaction aborted'));

    // Issue every request synchronously so they share this transaction.
    try {
      for (const w of writes) {
        t.objectStore(w.store).put(w.value, w.key);
      }
    } catch (e) {
      fail(e);
    }
  });
}

/** Clear several stores in one transaction. */
export async function idbClearAtomic(stores: StoreName[]): Promise<void> {
  if (stores.length === 0) return;
  let db: IDBDatabase;
  try {
    db = await openDb();
  } catch (e) {
    throw e instanceof StorageError ? e : new StorageError('clear', null, e);
  }
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    let t: IDBTransaction;
    try {
      t = db.transaction(stores, 'readwrite');
    } catch (e) {
      reject(new StorageError('clear', null, e));
      return;
    }
    const fail = (cause: unknown) => {
      if (settled) return;
      settled = true;
      reject(new StorageError('clear', null, cause));
    };
    t.oncomplete = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };
    t.onerror = () => fail(t.error);
    t.onabort = () => fail(t.error);
    try {
      for (const s of stores) t.objectStore(s).clear();
    } catch (e) {
      fail(e);
    }
  });
}

/** Strict read: throws on failure, returns `undefined` only for "absent". */
export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return tx<T | undefined>(store, 'readonly', (s) => s.get(key) as IDBRequest<T | undefined>);
}

export async function idbSet(store: StoreName, key: string, value: unknown): Promise<void> {
  await tx(store, 'readwrite', (s) => s.put(value, key));
}

export async function idbDelete(store: StoreName, key: string): Promise<void> {
  await tx(store, 'readwrite', (s) => s.delete(key));
}

/** Strict read of every entry. An empty array means "genuinely empty". */
export async function idbAll<T>(store: StoreName): Promise<T[]> {
  return tx<T[]>(store, 'readonly', (s) => s.getAll() as IDBRequest<T[]>);
}

export async function idbClear(store: StoreName): Promise<void> {
  await tx(store, 'readwrite', (s) => s.clear());
}

export async function idbKeys(store: StoreName): Promise<string[]> {
  const keys = await tx<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys());
  return keys.filter((k): k is string => typeof k === 'string');
}

// ── Explicit best-effort helpers ─────────────────────────────────────────────
// Use only where "proceed with less data" is genuinely correct, e.g. decorating
// a surface that already renders a storage error.

export async function bestEffortIdbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  try {
    return await idbGet<T>(store, key);
  } catch {
    return undefined;
  }
}

export async function bestEffortIdbAll<T>(store: StoreName): Promise<T[]> {
  try {
    return await idbAll<T>(store);
  } catch {
    return [];
  }
}

export interface WipeReport {
  cleared: StoreName[];
  failed: { store: StoreName; error: string }[];
  localStorageCleared: boolean;
}

/**
 * Destructive reset used by Settings › Reset local data.
 *
 * Clearing runs in one transaction so a partial wipe cannot leave the app in a
 * half-erased state, and the caller is told exactly what happened.
 */
export async function wipeLocalData(): Promise<WipeReport> {
  const names = Object.values(STORES);
  const failed: { store: StoreName; error: string }[] = [];
  let cleared: StoreName[] = [];

  try {
    await idbClearAtomic(names);
    cleared = names;
  } catch {
    // Fall back to per-store clearing so one bad store cannot block the rest,
    // but record every store we could not clear.
    for (const name of names) {
      try {
        await idbClear(name);
        cleared.push(name);
      } catch (err) {
        failed.push({ store: name, error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  let localStorageCleared = false;
  try {
    localStorage.clear();
    localStorageCleared = true;
  } catch {
    localStorageCleared = false;
  }

  return { cleared, failed, localStorageCleared };
}

export function __resetDbHandleForTests(): void {
  dbPromise = null;
}