import { dumpAllStores } from './storage';
import { STORES, idbWriteAtomic, wipeLocalData, type StoreName, type StoredEntry } from './idb';
import { validateStoreEntry } from './store-schema';

/**
 * Versioned workspace import/export.
 *
 * Guarantees:
 *  • The format is versioned and validated on import.
 *  • The secrets store is NEVER included — API keys cannot leave the browser
 *    via an export, even by accident.
 *  • Import is ATOMIC: every entry is written inside one IndexedDB transaction,
 *    so a failure part-way through rolls the whole thing back rather than
 *    leaving the app with a half-restored watchlist and a full wallet.
 *  • Import is additive per store key, so a bad file can't nuke live data
 *    without an explicit overwrite.
 */

export const EXPORT_FORMAT = 'iceberg-terminal.workspace';
export const EXPORT_VERSION = 1;

export interface WorkspaceBundle {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  /** Application version that produced the bundle. */
  appVersion: string;
  /**
   * store -> entries. Each entry is `{ key, value }` so the record key
   * survives the round-trip.
   */
  stores: Record<string, StoredEntry[]>;
  /** Entries that were present in the file but unusable. */
  rejectedEntries: number;
  /** Declared for transparency; always empty. */
  excluded: string[];
}

/** What actually landed, so the UI can report the real outcome. */
export interface ImportReport {
  /** store -> number of persisted state records written. */
  written: Record<string, number>;
  /** Total records written. */
  total: number;
  /** Entries that were present but unusable and therefore skipped. */
  skipped: number;
  /** Stores named in the bundle that are not recognised by this version. */
  unknownStores: string[];
  /** store -> why specific records were rejected (capped, for the UI). */
  rejected: Record<string, string[]>;
}

export async function buildExport(): Promise<WorkspaceBundle> {
  const stores = await dumpAllStores();
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    stores,
    rejectedEntries: 0,
    excluded: ['secrets (API credentials are never exported)'],
  };
}

export function serializeExport(bundle: WorkspaceBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export class ImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ImportError';
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Normalize raw bundle entries into `{ key, value }` pairs.
 *
 * Accepts the current lossless shape (`{ key, value }`) and the earlier
 * `{ state: { name, value } }` shape so a bundle exported by a previous build
 * still imports.
 *
 * Entries that cannot yield a string key are counted as `rejected` rather than
 * dropped, so the import report can tell the user how much of their file was
 * unusable instead of quietly restoring less than they expected.
 */
function normalizeEntries(raw: unknown[]): { entries: StoredEntry[]; rejected: number } {
  const entries: StoredEntry[] = [];
  let rejected = 0;

  for (const entry of raw) {
    if (!isRecord(entry)) {
      rejected++;
      continue;
    }
    // Current shape.
    if (typeof entry['key'] === 'string' && 'value' in entry) {
      entries.push({ key: entry['key'], value: entry['value'] });
      continue;
    }
    // Legacy zustand-persist shape.
    const state = entry['state'];
    if (isRecord(state) && typeof state['name'] === 'string' && 'value' in state) {
      entries.push({ key: state['name'], value: state['value'] });
      continue;
    }
    rejected++;
  }

  return { entries, rejected };
}

/** Parse + validate a bundle. Throws ImportError with an actionable message. */
export function parseBundle(text: string): WorkspaceBundle {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ImportError('File is not valid JSON.');
  }
  if (!isRecord(parsed)) throw new ImportError('Unexpected bundle structure.');
  if (parsed.format !== EXPORT_FORMAT) {
    throw new ImportError(`Unrecognized format "${String(parsed.format)}". Expected "${EXPORT_FORMAT}".`);
  }
  const version = Number(parsed.version);
  if (!Number.isInteger(version) || version < 1) throw new ImportError('Missing or invalid bundle version.');
  if (version > EXPORT_VERSION) {
    throw new ImportError(
      `Bundle was created by a newer version of Iceberg Terminal (v${version}). Update the app before importing.`,
    );
  }
  if (!isRecord(parsed.stores)) throw new ImportError('Bundle has no stores object.');

  const stores: Record<string, StoredEntry[]> = {};
  let rejectedEntries = 0;
  for (const [name, value] of Object.entries(parsed.stores)) {
    if (name === STORES.secrets) continue; // hard block, regardless of file contents
    if (!Array.isArray(value)) continue; // skip unknown/malformed stores
    const normalized = normalizeEntries(value);
    stores[name] = normalized.entries;
    rejectedEntries += normalized.rejected;
  }

  return {
    format: EXPORT_FORMAT,
    version,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
    stores,
    rejectedEntries,
    excluded: Array.isArray(parsed.excluded) ? parsed.excluded.map(String) : [],
  };
}

/**
 * Write a validated bundle into IndexedDB atomically.
 *
 * Every record is validated *before* the transaction opens, and all of them are
 * then written inside a single transaction. If any write fails, IndexedDB
 * aborts and **nothing** is modified — there is no partially-restored state.
 * The returned report describes only what actually landed.
 *
 * Records that do not match the shape their store expects are rejected here
 * rather than written and discovered at the next page load.
 */
export async function applyBundle(bundle: WorkspaceBundle): Promise<ImportReport> {
  const validStores = new Set<string>(Object.values(STORES));
  const writes: { store: StoreName; key: string; value: unknown }[] = [];
  const written: Record<string, number> = {};
  const rejected: Record<string, string[]> = {};
  const unknownStores: string[] = [];
  let skipped = bundle.rejectedEntries ?? 0;

  for (const [name, entries] of Object.entries(bundle.stores)) {
    if (name === STORES.secrets) continue; // hard block, regardless of file contents
    if (!validStores.has(name)) {
      unknownStores.push(name);
      skipped += entries.length;
      continue;
    }

    let count = 0;
    const reasons: string[] = [];
    for (const entry of entries) {
      if (typeof entry.key !== 'string' || entry.key === '' || entry.value === undefined) {
        skipped++;
        reasons.push('entry is missing a key or value');
        continue;
      }
      const verdict = validateStoreEntry(name, entry.key, entry.value);
      if (!verdict.ok) {
        skipped++;
        reasons.push(`${entry.key.slice(0, 40)}: ${verdict.reason}`);
        continue;
      }
      writes.push({ store: name as StoreName, key: entry.key, value: entry.value });
      count++;
    }
    written[name] = count;
    if (reasons.length) rejected[name] = reasons.slice(0, 5);
  }

  // One transaction for everything: all-or-nothing.
  await idbWriteAtomic(writes);

  return {
    written,
    total: writes.length,
    skipped,
    unknownStores,
    rejected,
  };
}

export interface ResetReport {
  cleared: string[];
  failed: { store: string; error: string }[];
  localStorageCleared: boolean;
}

export async function resetLocalData(): Promise<ResetReport> {
  const report = await wipeLocalData();
  return {
    cleared: [...report.cleared],
    failed: report.failed.map((f) => ({ store: f.store, error: f.error })),
    localStorageCleared: report.localStorageCleared,
  };
}

export function downloadBundle(bundle: WorkspaceBundle): void {
  const blob = new Blob([serializeExport(bundle)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.href = url;
  a.download = `iceberg-workspace-${stamp}.iceberg.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}