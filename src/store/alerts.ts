import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { alertsStorage } from '@/lib/storage';
import { isSolanaAddress } from '@/lib/solana';

/**
 * Alert rules + firing history.
 *
 * Alerts are evaluated in the tab while it is open. There is no background
 * service, no server, and no push channel — so an alert only fires while the
 * application is running. The UI states this explicitly rather than implying
 * continuous monitoring.
 */

export type AlertKind = 'price-above' | 'price-below' | 'change-up' | 'change-down' | 'volume-spike';

export interface AlertRule {
  id: string;
  kind: AlertKind;
  /** Token mint, or wallet address for wallet-balance alerts. */
  target: string;
  label: string | null;
  /** Threshold semantics:
   *  price-above/below -> USD
   *  change-up/down    -> percent
   *  volume-spike      -> multiple of the rolling baseline
   */
  threshold: number;
  enabled: boolean;
  createdAt: number;
  lastTriggeredAt: number | null;
}

export interface FiredAlert {
  id: string;
  ruleId: string;
  target: string;
  kind: AlertKind;
  message: string;
  firedAt: number;
  acknowledged: boolean;
}

export interface AlertState {
  rules: AlertRule[];
  fired: FiredAlert[];

  addRule(rule: Omit<AlertRule, 'id' | 'createdAt' | 'lastTriggeredAt'>): string | null;
  updateRule(id: string, patch: Partial<Omit<AlertRule, 'id'>>): void;
  removeRule(id: string): void;
  toggleRule(id: string): void;
  markTriggered(id: string, message: string): void;
  acknowledge(id: string): void;
  acknowledgeAll(): void;
  clearHistory(): void;
  rulesFor(target: string): AlertRule[];
}

function newId(): string {
  const rand =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  return `al_${rand.slice(0, 12)}`;
}

export const useAlertStore = create<AlertState>()(
  persist(
    (set, get) => ({
      rules: [],
      fired: [],

      addRule: (rule) => {
        if (!isSolanaAddress(rule.target)) return null;
        const id = newId();
        set((s) => ({
          rules: [...s.rules, { ...rule, id, createdAt: Date.now(), lastTriggeredAt: null }],
        }));
        return id;
      },

      updateRule: (id, patch) =>
        set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, ...patch } : r)) })),

      removeRule: (id) => set((s) => ({ rules: s.rules.filter((r) => r.id !== id) })),

      toggleRule: (id) =>
        set((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r)) })),

      markTriggered: (id, message) => {
        const rule = get().rules.find((r) => r.id === id);
        if (!rule) return;
        set((s) => ({
          rules: s.rules.map((r) => (r.id === id ? { ...r, lastTriggeredAt: Date.now() } : r)),
          fired: [
            {
              id: newId(),
              ruleId: id,
              target: rule.target,
              kind: rule.kind,
              message,
              firedAt: Date.now(),
              acknowledged: false,
            },
            ...s.fired,
          ].slice(0, 100),
        }));
      },

      acknowledge: (id) =>
        set((s) => ({ fired: s.fired.map((f) => (f.id === id ? { ...f, acknowledged: true } : f)) })),

      acknowledgeAll: () => set((s) => ({ fired: s.fired.map((f) => ({ ...f, acknowledged: true })) })),

      clearHistory: () => set({ fired: [] }),

      rulesFor: (target) => get().rules.filter((r) => r.target === target),
    }),
    {
      name: 'iceberg.alerts.v1',
      storage: alertsStorage,
      version: 1,
    },
  ),
);