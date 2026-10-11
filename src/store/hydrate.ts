import { STORES, idbAll } from '@/lib/idb';

/**
 * Persistence hydration.
 *
 * Zustand's IndexedDB-backed persistence is async, so on the first render the
 * stores hold their defaults. This module waits for rehydration to settle
 * before the shell renders, preventing a flash of default watchlists and
 * letting the vault report its stored-credential flags.
 */

export interface HydrationResult {
  stores: Record<string, number>;
  ok: boolean;
}

export async function hydratePersistedState(): Promise<HydrationResult> {
  const names = Object.values(STORES).filter((n) => n !== STORES.secrets && n !== STORES.cache);
  const counts: Record<string, number> = {};
  let ok = true;

  await Promise.all(
    names.map(async (name) => {
      try {
        counts[name] = (await idbAll<unknown>(name)).length;
      } catch {
        ok = false;
      }
    }),
  );

  // Yield once so zustand's async rehydration callbacks run before paint.
  await new Promise<void>((resolve) => {
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => resolve());
    else setTimeout(resolve, 0);
  });

  return { stores: counts, ok };
}