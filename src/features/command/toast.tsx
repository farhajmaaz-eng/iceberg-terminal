import * as React from 'react';

export interface ToastItem {
  id: string;
  message: string;
  tone: 'info' | 'success' | 'warn' | 'error' | 'muted';
  ttl: number;
}

export interface ToastApi {
  push(input: Omit<ToastItem, 'id' | 'ttl'> & { ttl?: number }): void;
  dismiss(id: string): void;
}

const ToastContext = React.createContext<ToastApi | null>(null);

/**
 * Minimal toast bus. Everything the user is told about a command result goes
 * through here, so results are never silently swallowed.
 */
export function ToastProvider({ children }: { children?: React.ReactNode }) {
  const [items, setItems] = React.useState<ToastItem[]>([]);
  const timers = React.useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = React.useCallback((id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
    const t = timers.current.get(id);
    if (t) {
      clearTimeout(t);
      timers.current.delete(id);
    }
  }, []);

  const push = React.useCallback<ToastApi['push']>(
    (input) => {
      const id = `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const ttl = input.ttl ?? (input.tone === 'error' ? 7_000 : 4_000);
      setItems((prev) => [...prev.slice(-4), { id, message: input.message, tone: input.tone, ttl }]);
      const timer = setTimeout(() => {
        setItems((prev) => prev.filter((t) => t.id !== id));
        timers.current.delete(id);
      }, ttl);
      timers.current.set(id, timer);
    },
    [],
  );

  const api = React.useMemo<ToastApi>(() => ({ push, dismiss }), [push, dismiss]);

  React.useEffect(() => {
    const map = timers.current;
    return () => {
      map.forEach((t) => clearTimeout(t));
      map.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed bottom-16 right-2 z-[60] flex w-[min(92vw,26rem)] flex-col gap-1.5 md:bottom-3 md:right-3"
        role="status"
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            className={toneClass(t.tone)}
            onClick={() => dismiss(t.id)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') dismiss(t.id);
            }}
          >
            <span className="font-mono text-[11px] leading-relaxed">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function toneClass(tone: ToastItem['tone']): string {
  const base =
    'pointer-events-auto cursor-pointer rounded-sm border px-2.5 py-1.5 shadow-lg shadow-black/50 transition-colors';
  switch (tone) {
    case 'success':
      return `${base} border-bull/40 bg-bull/10 text-bull`;
    case 'error':
      return `${base} border-bear/40 bg-bear/10 text-bear`;
    case 'warn':
      return `${base} border-amber/40 bg-amber/10 text-amber`;
    case 'muted':
      return `${base} border-edge bg-surface-3 text-slate-300`;
    default:
      return `${base} border-edge-strong bg-surface-2 text-slate-200`;
  }
}

export function useToast(): ToastApi {
  const ctx = React.useContext(ToastContext);
  if (!ctx) {
    // Never crash a render because a provider is missing; degrade to no-ops.
    return { push: () => {}, dismiss: () => {} };
  }
  return ctx;
}