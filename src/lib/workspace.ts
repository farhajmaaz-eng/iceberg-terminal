import { dumpAllStores } from './storage';
import { STORES, idbSet, wipeLocalData } from './idb';

/**
 * Versioned workspace import/export.
 *
 * Guarantees:
 *  • The format is versioned and validated on import.
 *  • The secrets store is NEVER included — API keys cannot leave the browser
 *    via an export, even by accident.
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
  stores: Record<string, unknown[]>;
  /** Declared for transparency; always empty. */
  excluded: string[];
}

export async function buildExport(): Promise<WorkspaceBundle> {
  const stores = await dumpAllStores();
  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    appVersion: __APP_VERSION__,
    stores,
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

  const stores: Record<string, unknown[]> = {};
  for (const [name, value] of Object.entries(parsed.stores)) {
    if (name === STORES.secrets) continue; // hard block, regardless of file contents
    if (!Array.isArray(value)) continue; // skip unknown/malformed stores
    stores[name] = value.filter((entry) => isRecord(entry) || typeof entry === 'string');
  }

  return {
    format: EXPORT_FORMAT,
    version,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    appVersion: typeof parsed.appVersion === 'string' ? parsed.appVersion : 'unknown',
    stores,
    excluded: Array.isArray(parsed.excluded) ? parsed.excluded.map(String) : [],
  };
}

/** Write a validated bundle into IndexedDB. */
export async function applyBundle(bundle: WorkspaceBundle): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const [name, entries] of Object.entries(bundle.stores)) {
    if (!(Object.values(STORES) as string[]).includes(name)) continue;
    let written = 0;
    for (const entry of entries) {
      if (!isRecord(entry)) continue;
      const key = entry['state'];
      if (!isRecord(key)) continue;
      const { name: stateName, value } = key as { name?: unknown; value?: unknown };
      if (typeof stateName !== 'string' || value === undefined) continue;
      await idbSet(name as (typeof STORES)[keyof typeof STORES], stateName, value);
      written++;
    }
    counts[name] = written;
  }
  return counts;
}

export async function resetLocalData(): Promise<void> {
  await wipeLocalData();
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