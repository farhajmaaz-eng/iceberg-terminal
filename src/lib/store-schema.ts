import type { StoreName } from './idb';

/**
 * Per-store validation for imported workspace records.
 *
 * A bundle is untrusted input. Checking only that an entry "has a key and a
 * value" is not enough: writing a malformed record into the watchlists or
 * wallets store would make the app crash on the next load — *after* the import
 * reported success and the user had already dismissed it.
 *
 * Every Iceberg store other than `secrets` and `cache` is written exclusively
 * by the zustand persistence adapter, so a well-formed value is always:
 *   • a JSON **string**, and
 *   • an object with an object `state` and a numeric `version`.
 *
 * Rejecting anything else is what makes an import safe rather than merely
 * atomic.
 */

export type StoreName_ = StoreName;

/**
 * The exact persist key each store legitimately contains, derived from the
 * zustand `persist({ name: ... })` option used by each store. The key must
 * belong to the store it is found in — e.g. a `watchlists` key placed under
 * `wallets` is malformed and would never be read back by any store, so it is
 * rejected rather than silently written.
 *
 *   settings   <- providers store   iceberg.providers.v1
 *   watchlists <- watchlists store  iceberg.watchlists.v1
 *   wallets    <- wallets store     iceberg.wallets.v1
 *   alerts     <- alerts store      iceberg.alerts.v1
 *   layouts    <- (no active writer; reserved)
 */
const KEY_PATTERNS: Record<string, RegExp> = {
  settings: /^iceberg\.providers\.v\d+$/,
  watchlists: /^iceberg\.watchlists\.v\d+$/,
  wallets: /^iceberg\.wallets\.v\d+$/,
  alerts: /^iceberg\.alerts\.v\d+$/,
  layouts: /^iceberg\.layouts\.v\d+$/,
};

export interface StoreEntryValidation {
  ok: boolean;
  reason?: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Validate one `{ key, value }` record for a given store. */
export function validateStoreEntry(
  store: string,
  key: string,
  value: unknown,
): StoreEntryValidation {
  if (store === 'secrets') {
    return { ok: false, reason: 'credential store must never be imported' };
  }
  if (store === 'cache') {
    return { ok: false, reason: 'cache is not portable and is not imported' };
  }

  const pattern = KEY_PATTERNS[store];
  if (!pattern) return { ok: false, reason: `unknown store "${store}"` };
  if (typeof key !== 'string' || key.length === 0) {
    return { ok: false, reason: 'missing record key' };
  }
  if (key.length > 128) {
    return { ok: false, reason: 'record key is implausibly long' };
  }
  if (!pattern.test(key)) {
    return { ok: false, reason: `record key "${key.slice(0, 40)}" does not belong to the "${store}" store` };
  }

  // The adapter stores JSON strings.
  if (typeof value !== 'string') {
    return { ok: false, reason: 'record value is not a JSON string' };
  }
  if (value.length > 8 * 1024 * 1024) {
    return { ok: false, reason: 'record value is implausibly large' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { ok: false, reason: 'record value is not valid JSON' };
  }

  if (!isPlainObject(parsed)) {
    return { ok: false, reason: 'record value is not a persisted-state object' };
  }
  if (!isPlainObject(parsed.state)) {
    return { ok: false, reason: 'record is missing its "state" object' };
  }
  if (typeof parsed.version !== 'number' || !Number.isFinite(parsed.version)) {
    return { ok: false, reason: 'record is missing a numeric "version"' };
  }

  return { ok: true };
}