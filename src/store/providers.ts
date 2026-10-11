import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_CHAIN_PROVIDER, DEFAULT_MARKET_PROVIDER } from '@/providers';
import type { ProviderId } from '@/providers/types';
import { settingsStorage } from '@/lib/storage';
import type { RpcFlavour } from '@/providers/chain/solanaRpc';

/**
 * Provider + preference configuration.
 *
 * This store deliberately contains NO credentials. API keys live only in the
 * encrypted vault (see store/vault.ts) and are never written to the persisted
 * settings blob, to localStorage, or to an export file.
 */

export interface ProviderConfig {
  enabled: boolean;
  /** Provider-specific non-secret options (flavour, custom endpoint, ...). */
  options: Record<string, string>;
  /** True when a credential is present in the vault for this provider. */
  hasKey?: boolean;
}

export type ProviderConfigMap = Record<string, ProviderConfig>;

export interface UiPrefs {
  /** Active panel layout id. */
  layoutId: string;
  sidebarCollapsed: boolean;
  /** Mobile bottom-nav selection is derived from route, stored for return-nav. */
  density: 'compact' | 'comfortable';
  numberFormat: 'compact' | 'full';
  defaultChain: string;
  soundOnAlert: boolean;
}

export interface AlertPrefs {
  /** Seconds between polls for watchlist prices. */
  pollIntervalSec: number;
  browserNotifications: boolean;
  notifyPermission: 'default' | 'granted' | 'denied' | 'unsupported';
  /** Relative change threshold (%) for the "percent move" alert type. */
  defaultPctThreshold: number;
}

export interface ProviderState {
  selectedMarket: ProviderId;
  selectedChain: ProviderId;
  selectedAnalytics: ProviderId | null;
  selectedNews: ProviderId | null;
  configs: ProviderConfigMap;
  forceDemo: boolean;

  prefs: UiPrefs;
  alerts: AlertPrefs;

  setSelected(kind: 'market' | 'chain' | 'analytics' | 'news', id: ProviderId | null): void;
  setProviderEnabled(id: string, enabled: boolean): void;
  setProviderOption(id: string, key: string, value: string): void;
  setProviderHasKey(id: string, hasKey: boolean): void;
  setForceDemo(v: boolean): void;
  updatePrefs(patch: Partial<UiPrefs>): void;
  updateAlerts(patch: Partial<AlertPrefs>): void;
  setNotifyPermission(p: AlertPrefs['notifyPermission']): void;
  resetPrefs(): void;
}

const DEFAULT_CONFIGS: ProviderConfigMap = {
  dexscreener: { enabled: true, options: {} },
  geckoterminal: { enabled: true, options: {} },
  coingecko: { enabled: true, options: {} },
  'solana-rpc': {
    enabled: true,
    options: {
      flavour: ((import.meta.env?.VITE_DEFAULT_RPC_FLAVOUR as RpcFlavour) || 'public') as RpcFlavour,
      url: (import.meta.env?.VITE_DEFAULT_RPC_URL as string) || '',
    },
  },
  birdeye: { enabled: false, options: {} },
  cryptopanic: { enabled: false, options: {} },
};

const envForcedDemo = String(import.meta.env?.VITE_FORCE_DEMO_MODE ?? '').toLowerCase() === 'true';

const DEFAULT_PREFS: UiPrefs = {
  layoutId: 'workstation',
  sidebarCollapsed: false,
  density: 'compact',
  numberFormat: 'compact',
  defaultChain: 'solana',
  soundOnAlert: false,
};

const DEFAULT_ALERT_PREFS: AlertPrefs = {
  pollIntervalSec: 60,
  browserNotifications: false,
  notifyPermission:
    typeof Notification === 'undefined' ? 'unsupported' : (Notification.permission as AlertPrefs['notifyPermission']),
  defaultPctThreshold: 10,
};

function detectNotifyPermission(): AlertPrefs['notifyPermission'] {
  if (typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission as AlertPrefs['notifyPermission'];
}

export const useProviderStore = create<ProviderState>()(
  persist(
    (set) => ({
      selectedMarket: (import.meta.env?.VITE_DEFAULT_MARKET_PROVIDER as string) || DEFAULT_MARKET_PROVIDER,
      selectedChain: DEFAULT_CHAIN_PROVIDER,
      selectedAnalytics: null,
      selectedNews: null,
      configs: DEFAULT_CONFIGS,
      forceDemo: envForcedDemo,

      prefs: DEFAULT_PREFS,
      alerts: { ...DEFAULT_ALERT_PREFS, notifyPermission: detectNotifyPermission() },

      setSelected: (kind, id) =>
        set((s) => {
          switch (kind) {
            case 'market':
              return id ? { selectedMarket: id } : {};
            case 'chain':
              return id ? { selectedChain: id } : {};
            case 'analytics':
              return { selectedAnalytics: id };
            case 'news':
              return { selectedNews: id };
            default:
              return s;
          }
        }),

      setProviderEnabled: (id, enabled) =>
        set((s) => ({
          configs: { ...s.configs, [id]: { enabled, options: s.configs[id]?.options ?? {} } },
        })),

      setProviderOption: (id, key, value) =>
        set((s) => ({
          configs: {
            ...s.configs,
            [id]: { enabled: s.configs[id]?.enabled ?? true, options: { ...(s.configs[id]?.options ?? {}), [key]: value } },
          },
        })),

      setProviderHasKey: (id, hasKey) =>
        set((s) => ({ configs: { ...s.configs, [id]: { ...(s.configs[id] ?? { enabled: true, options: {} }), hasKey } } })),

      setForceDemo: (v) => set({ forceDemo: v }),
      updatePrefs: (patch) => set((s) => ({ prefs: { ...s.prefs, ...patch } })),
      updateAlerts: (patch) => set((s) => ({ alerts: { ...s.alerts, ...patch } })),
      setNotifyPermission: (p) => set((s) => ({ alerts: { ...s.alerts, notifyPermission: p } })),
      resetPrefs: () => set({ prefs: DEFAULT_PREFS, alerts: { ...DEFAULT_ALERT_PREFS, notifyPermission: detectNotifyPermission() } }),
    }),
    {
      name: 'iceberg.providers.v1',
      storage: settingsStorage,
      version: 1,
      partialize: (s) =>
        ({
          selectedMarket: s.selectedMarket,
          selectedChain: s.selectedChain,
          selectedAnalytics: s.selectedAnalytics,
          selectedNews: s.selectedNews,
          configs: s.configs,
          forceDemo: s.forceDemo,
          prefs: s.prefs,
          alerts: s.alerts,
        }) as ProviderState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ProviderState>;
        return {
          ...current,
          ...p,
          configs: { ...DEFAULT_CONFIGS, ...(p.configs ?? {}) },
          prefs: { ...DEFAULT_PREFS, ...(p.prefs ?? {}) },
          alerts: {
            ...DEFAULT_ALERT_PREFS,
            ...(p.alerts ?? {}),
            // Permission is re-read from the browser on every load.
            notifyPermission: detectNotifyPermission(),
          },
        };
      },
    },
  ),
);

/** True when demo mode is forced globally (build flag or user toggle). */
export function useForceDemo(): boolean {
  return useProviderStore((s) => s.forceDemo);
}