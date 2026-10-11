import { StorageError } from './idb';

/**
 * Local-storage health.
 *
 * A browser can refuse IndexedDB outright (private mode, blocked storage,
 * third-party-storage partitioning). When that happens the app must still run —
 * but it must NOT quietly behave as though the user's watchlist were simply
 * empty, or as though their edits had been saved.
 *
 * This module is the single place that distinction is made: readers that have
 * to degrade (zustand's persist adapter, the hydration probe) record the
 * failure here, and the shell renders a persistent warning from it.
 */

export type StorageFailureKind = 'unavailable' | 'read' | 'write' | 'quota';

export interface StorageProblem {
  kind: StorageFailureKind;
  message: string;
  at: number;
}

export interface StorageHealth {
  available: boolean;
  problems: StorageProblem[];
}

type Listener = (health: StorageHealth) => void;

const state: StorageHealth = { available: true, problems: [] };
const listeners = new Set<Listener>();

const MAX_PROBLEMS = 8;

function emit(): void {
  for (const fn of listeners) fn({ ...state, problems: [...state.problems] });
}

/** Record a storage problem. Callers that must degrade call this first. */
export function reportStorageProblem(problem: Omit<StorageProblem, 'at'>): void {
  state.available = false;
  state.problems = [{ ...problem, at: Date.now() }, ...state.problems].slice(0, MAX_PROBLEMS);
  emit();
}

/** Classify a thrown storage error and record it. Returns the error. */
export function recordStorageError(operation: 'read' | 'write', error: unknown): unknown {
  const message = error instanceof Error ? error.message : String(error);
  const quota = /quota/i.test(message);
  reportStorageProblem({
    kind: quota ? 'quota' : operation,
    message,
  });
  return error;
}

/** Called once a storage operation succeeds after a failure. */
export function clearStorageProblems(): void {
  if (state.problems.length === 0) return;
  state.available = true;
  state.problems = [];
  emit();
}

export function getStorageHealth(): StorageHealth {
  return { ...state, problems: [...state.problems] };
}

export function subscribeStorageHealth(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Human-readable summary for the warning banner. */
export function describeStorageProblem(p: StorageProblem): string {
  switch (p.kind) {
    case 'unavailable':
      return 'Local storage is unavailable in this browser context.';
    case 'quota':
      return 'Browser storage quota exceeded — some changes may not have been saved.';
    case 'write':
      return 'Could not write to local storage.';
    default:
      return 'Could not read from local storage.';
  }
}

export function __resetStorageHealthForTests(): void {
  state.available = true;
  state.problems = [];
  emit();
}

export { StorageError };