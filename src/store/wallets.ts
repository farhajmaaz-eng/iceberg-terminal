import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { walletsStorage } from '@/lib/storage';
import { isSolanaAddress } from '@/lib/solana';

/**
 * Public wallet watchlist.
 *
 * Only PUBLIC addresses. Iceberg Terminal never requests, stores, or uses a
 * seed phrase or private key — there is no field for one anywhere in the app.
 */

export interface WatchedWallet {
  address: string;
  label: string | null;
  note: string | null;
  addedAt: number;
  /** Optional grouping tag, e.g. "fund" / "treasury" / "insider-watch". */
  group: string | null;
  /** When true the wallet appears in the live on-chain activity feed. */
  trackActivity: boolean;
}

export interface WalletState {
  wallets: WatchedWallet[];

  addWallet(address: string, label?: string | null): boolean;
  removeWallet(address: string): void;
  updateWallet(address: string, patch: Partial<Omit<WatchedWallet, 'address'>>): void;
  isWatched(address: string): boolean;
  tracked(): WatchedWallet[];
}

export const useWalletStore = create<WalletState>()(
  persist(
    (set, get) => ({
      wallets: [],

      addWallet: (address, label) => {
        if (!isSolanaAddress(address)) return false;
        const a = address.trim();
        if (get().wallets.some((w) => w.address === a)) return false;
        set((s) => ({
          wallets: [
            ...s.wallets,
            { address: a, label: label?.trim() || null, note: null, addedAt: Date.now(), group: null, trackActivity: true },
          ],
        }));
        return true;
      },

      removeWallet: (address) => set((s) => ({ wallets: s.wallets.filter((w) => w.address !== address) })),

      updateWallet: (address, patch) =>
        set((s) => ({
          wallets: s.wallets.map((w) => (w.address === address ? { ...w, ...patch } : w)),
        })),

      isWatched: (address) => get().wallets.some((w) => w.address === address),
      tracked: () => get().wallets.filter((w) => w.trackActivity),
    }),
    {
      name: 'iceberg.wallets.v1',
      storage: walletsStorage,
      version: 1,
    },
  ),
);