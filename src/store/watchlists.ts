import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { watchlistStorage } from '@/lib/storage';
import { SOL_MINT } from '@/lib/constants';
import { isSolanaAddress } from '@/lib/solana';

/**
 * Watchlists — multiple, local-only, user-owned collections of token mints.
 *
 * Mint addresses are the canonical key. Symbols are stored only as a display
 * cache and are never used for lookups (symbols collide and are spoofable).
 */

export interface WatchlistItem {
  mint: string;
  /** Cached symbol for offline display. Not authoritative. */
  symbol?: string | null;
  note?: string | null;
  addedAt: number;
}

export interface Watchlist {
  id: string;
  name: string;
  items: WatchlistItem[];
  createdAt: number;
  updatedAt: number;
  color?: string;
}

export interface WatchlistState {
  lists: Watchlist[];
  activeListId: string;

  createList(name: string): string;
  renameList(id: string, name: string): void;
  deleteList(id: string): boolean;
  setActive(id: string): void;
  addToken(listId: string, mint: string, symbol?: string | null): void;
  removeToken(listId: string, mint: string): void;
  toggleToken(mint: string, symbol?: string | null): boolean;
  setNote(listId: string, mint: string, note: string | null): void;
  isWatched(mint: string): boolean;
  watchedMints(): string[];
}

function newId(prefix: string): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${rand.slice(0, 12)}`;
}

function seedLists(): Watchlist[] {
  const now = Date.now();
  return [
    {
      id: 'wl_core',
      name: 'Core',
      color: 'cyan',
      items: [{ mint: SOL_MINT, symbol: 'SOL', addedAt: now }],
      createdAt: now,
      updatedAt: now,
    },
    {
      id: 'wl_research',
      name: 'Research',
      color: 'amber',
      items: [],
      createdAt: now,
      updatedAt: now,
    },
  ];
}

export const useWatchlistStore = create<WatchlistState>()(
  persist(
    (set, get) => ({
      lists: seedLists(),
      activeListId: 'wl_core',

      createList: (name) => {
        const id = newId('wl');
        const now = Date.now();
        set((s) => ({
          lists: [...s.lists, { id, name: name.trim() || 'Untitled list', items: [], createdAt: now, updatedAt: now }],
        }));
        return id;
      },

      renameList: (id, name) =>
        set((s) => ({
          lists: s.lists.map((l) => (l.id === id ? { ...l, name: name.trim() || l.name, updatedAt: Date.now() } : l)),
        })),

      deleteList: (id) => {
        const state = get();
        if (state.lists.length <= 1) return false; // always keep at least one list
        const lists = state.lists.filter((l) => l.id !== id);
        set({ lists, activeListId: state.activeListId === id ? lists[0]!.id : state.activeListId });
        return true;
      },

      setActive: (id) => set({ activeListId: id }),

      addToken: (listId, mint, symbol) =>
        set((s) => {
          if (!isSolanaAddress(mint)) return s;
          return {
            lists: s.lists.map((l) => {
              if (l.id !== listId) return l;
              if (l.items.some((i) => i.mint === mint)) return l;
              return {
                ...l,
                items: [...l.items, { mint, symbol: symbol ?? null, addedAt: Date.now() }],
                updatedAt: Date.now(),
              };
            }),
          };
        }),

      removeToken: (listId, mint) =>
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id === listId ? { ...l, items: l.items.filter((i) => i.mint !== mint), updatedAt: Date.now() } : l,
          ),
        })),

      /** Returns true when the token is now watched (i.e. after the toggle). */
      toggleToken: (mint, symbol) => {
        if (!isSolanaAddress(mint)) return false;
        const state = get();
        const inList = state.lists.find((l) => l.id === state.activeListId);
        const exists = inList?.items.some((i) => i.mint === mint) ?? false;
        if (exists) state.removeToken(state.activeListId, mint);
        else state.addToken(state.activeListId, mint, symbol);
        return !exists;
      },

      setNote: (listId, mint, note) =>
        set((s) => ({
          lists: s.lists.map((l) =>
            l.id === listId
              ? {
                  ...l,
                  items: l.items.map((i) => (i.mint === mint ? { ...i, note: note?.trim() || null } : i)),
                  updatedAt: Date.now(),
                }
              : l,
          ),
        })),

      isWatched: (mint) => get().lists.some((l) => l.items.some((i) => i.mint === mint)),
      watchedMints: () => [...new Set(get().lists.flatMap((l) => l.items.map((i) => i.mint)))],
    }),
    {
      name: 'iceberg.watchlists.v1',
      storage: watchlistStorage,
      version: 1,
    },
  ),
);