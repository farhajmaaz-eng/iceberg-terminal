import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { CornerDownLeft, Search, Terminal, X } from 'lucide-react';
import { Dialog, DialogContent } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { classifyIdentifier } from '@/lib/solana';
import { formatPrice, formatPct, changeToneClass } from '@/lib/format';
import { TokenAvatar } from '@/components/tables/cells';
import { useTokenSearch } from '@/data/queries';
import { useWalletStore } from '@/store/wallets';
import { useWatchlistStore } from '@/store/watchlists';
import {
  COMMANDS,
  completeCommand,
  parseCommand,
  useCommandContext,
  executeCommand,
  type CommandDefinition,
} from './commands';
import { useToast } from './toast';

/**
 * Command palette + global search.
 *
 * One input handles three jobs:
 *  1. Command execution (verb syntax, e.g. `TOKEN <mint>`).
 *  2. Token / wallet / signature search.
 *  3. Navigation.
 *
 * Keyboard: ↑ ↓ history & selection · Tab complete · Enter run · Esc close.
 */

export interface PaletteState {
  open: boolean;
  mode: 'command' | 'search';
  initialValue: string;
}

type Listener = (state: PaletteState) => void;

class PaletteBus {
  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  open(mode: PaletteState['mode'] = 'command', initialValue = ''): void {
    const state: PaletteState = { open: true, mode, initialValue };
    this.listeners.forEach((fn) => fn(state));
  }

  close(): void {
    this.listeners.forEach((fn) => fn({ open: false, mode: 'command', initialValue: '' }));
  }
}

export const paletteBus = new PaletteBus();

export function openPalette(mode: PaletteState['mode'] = 'command', initialValue = ''): void {
  paletteBus.open(mode, initialValue);
}

type Row =
  | { kind: 'command'; key: string; command: CommandDefinition; hint: string }
  | { kind: 'search'; key: string; label: string; sublabel: string; href: string; mint?: string; logoUri?: string | null; symbol?: string | null; price?: number | null; change?: number | null }
  | { kind: 'hint'; key: string; label: string; sublabel: string; href: string };

export function CommandPalette() {
  const [state, setState] = React.useState<PaletteState>({ open: false, mode: 'command', initialValue: '' });
  const [value, setValue] = React.useState('');
  const [history, setHistory] = React.useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = React.useState(-1);
  const [selected, setSelected] = React.useState(0);

  const navigate = useNavigate();
  const ctx = useCommandContext(navigate);
  const toast = useToast();
  const wallets = useWalletStore((s) => s.wallets);
  const watchedMints = useWatchlistStore((s) => s.lists);
  const inputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => paletteBus.subscribe(setState), []);

  React.useEffect(() => {
    if (state.open) {
      setValue(state.initialValue);
      setSelected(0);
      setHistoryIndex(-1);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [state.open, state.initialValue, state.mode]);

  const parsed = parseCommand(value);
  const isCommandish = parsed.verb.length > 0 && COMMANDS.some((c) => c.verb === parsed.verb);
  const searchTerm = isCommandish ? '' : value.trim();

  const search = useTokenSearch(state.open && searchTerm.length >= 2 ? searchTerm : '');

  const rows = React.useMemo<Row[]>(() => {
    const out: Row[] = [];

    if (isCommandish) {
      out.push({
        kind: 'command',
        key: `run-${parsed.verb}`,
        command: COMMANDS.find((c) => c.verb === parsed.verb)!,
        hint: `Enter ⏎`,
      });
      if (parsed.arg) {
        const kind = classifyIdentifier(parsed.arg);
        if (kind !== 'unknown') {
          out.push({
            kind: 'hint',
            key: 'open-arg',
            label: parsed.arg,
            sublabel: kind === 'signature' ? 'Open transaction' : 'Open account / token',
            href: kind === 'signature' ? `/tx/${parsed.arg}` : `/wallet/${parsed.arg}`,
          });
        }
      }
      return out;
    }

    // Commands, filtered.
    const verbPrefix = parsed.verb;
    if (searchTerm.length === 0 || verbPrefix.length > 0) {
      for (const c of COMMANDS) {
        if (verbPrefix && !c.verb.startsWith(verbPrefix.toUpperCase())) continue;
        out.push({ kind: 'command', key: c.verb, command: c, hint: c.usage });
      }
      if (out.length > 8) return out.slice(0, 8);
    }

    // Direct identifier hit.
    const idKind = classifyIdentifier(searchTerm);
    if (idKind === 'signature') {
      out.push({
        kind: 'hint',
        key: 'sig',
        label: searchTerm,
        sublabel: 'Transaction signature → inspector',
        href: `/tx/${searchTerm}`,
      });
    } else if (idKind === 'address') {
      out.push({
        kind: 'hint',
        key: 'addr',
        label: searchTerm,
        sublabel: 'Solana address → wallet / token research',
        href: `/wallet/${searchTerm}`,
      });
    }

    // Token results.
    for (const t of (search.data?.tokens ?? []).slice(0, 6)) {
      out.push({
        kind: 'search',
        key: `tok-${t.address}`,
        label: t.symbol ?? t.address,
        sublabel: `${t.name ?? ''}${t.name ? ' · ' : ''}${t.address}`,
        href: `/token/${t.address}`,
        mint: t.address,
        logoUri: t.logoUri,
        symbol: t.symbol,
        price: t.priceUsd,
        change: t.change24h,
      });
    }

    // Local context: watched wallets + tokens.
    const walletHit = wallets.find((w) => w.address === searchTerm || w.label?.toLowerCase() === searchTerm.toLowerCase());
    if (walletHit) {
      out.push({
        kind: 'hint',
        key: `wl-${walletHit.address}`,
        label: walletHit.label ?? walletHit.address,
        sublabel: 'Watched wallet',
        href: `/wallet/${walletHit.address}`,
      });
    }
    if (searchTerm.length >= 2) {
      for (const list of watchedMints) {
        for (const item of list.items) {
          if (item.symbol?.toLowerCase().startsWith(searchTerm.toLowerCase())) {
            out.push({
              kind: 'search',
              key: `wl-tok-${item.mint}`,
              label: item.symbol ?? item.mint,
              sublabel: `In watchlist "${list.name}"`,
              href: `/token/${item.mint}`,
              mint: item.mint,
              symbol: item.symbol,
            });
          }
        }
      }
    }

    return out.slice(0, 12);
  }, [isCommandish, parsed, searchTerm, search.data, wallets, watchedMints]);

  React.useEffect(() => setSelected(0), [rows.length, value]);

  const completions = React.useMemo(() => (state.mode === 'command' ? completeCommand(value) : []), [value, state.mode]);

  const runCommand = React.useCallback(
    async (input: string) => {
      const result = await executeCommand(input, ctx);
      toast.push({
        message: result.message,
        tone: result.tone ?? (result.ok ? 'success' : 'error'),
      });
      if (result.ok) {
        setHistory((h) => [input, ...h.filter((x) => x !== input)].slice(0, 50));
        setHistoryIndex(-1);
        paletteBus.close();
      }
      return result;
    },
    [ctx, toast],
  );

  const activate = React.useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      if (row.kind === 'command') {
        // If the user typed arguments after the verb (e.g. `TOKEN <mint>` or
        // `DEMO ON`), run the full input — not just the bare verb, which would
        // execute an incomplete command.
        const typed = value.trim();
        const line =
          typed.toUpperCase().startsWith(`${row.command.verb} `) || typed.toUpperCase() === row.command.verb
            ? typed
            : row.command.verb;
        void runCommand(line);
      } else {
        navigate(row.href);
        setHistory((h) => [value, ...h.filter((x) => x !== value)].slice(0, 50));
        paletteBus.close();
      }
    },
    [navigate, runCommand, value],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Tab completion
    if (e.key === 'Tab') {
      e.preventDefault();
      if (completions.length === 0) return;
      const idx = Math.max(0, completions.indexOf(value.trim()));
      const next = completions[(idx + (e.shiftKey ? -1 : 1) + completions.length) % completions.length];
      if (next) setValue(next);
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (value.trim() === '' && history.length > 0) {
        const next = Math.min(historyIndex + 1, history.length - 1);
        setHistoryIndex(next);
        setValue(history[next] ?? '');
        return;
      }
      setSelected((s) => (rows.length ? (s + 1) % rows.length : 0));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (value.trim() === '' && history.length > 0) {
        const next = historyIndex <= 0 ? -1 : historyIndex - 1;
        setHistoryIndex(next);
        setValue(next === -1 ? '' : (history[next] ?? ''));
        return;
      }
      setSelected((s) => (rows.length ? (s - 1 + rows.length) % rows.length : 0));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      const current = rows[selected];
      if (current) {
        activate(current);
        return;
      }
      if (value.trim()) void runCommand(value);
      return;
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      paletteBus.close();
    }
  };

  return (
    <Dialog open={state.open} onOpenChange={(o) => !o && paletteBus.close()}>
      <DialogContent
        className="top-[12%] w-[min(96vw,44rem)] -translate-y-0 border-edge bg-surface-1"
        aria-label="Command palette"
      >
        <div className="flex items-center gap-2 border-b border-edge px-3 py-2">
          {state.mode === 'command' ? (
            <Terminal size={13} className="shrink-0 text-cyan" />
          ) : (
            <Search size={13} className="shrink-0 text-cyan" />
          )}
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              state.mode === 'command'
                ? 'Type a command (HELP) or search tokens, wallets, signatures…'
                : 'Search tokens, public wallets, transaction signatures…'
            }
            className="w-full bg-transparent font-mono text-sm text-slate-100 outline-none placeholder:text-dim"
            spellCheck={false}
            autoComplete="off"
            aria-label="Command input"
          />
          <kbd className="kbd">ESC</kbd>
          <button
            type="button"
            onClick={() => paletteBus.close()}
            className="text-dim hover:text-slate-200"
            aria-label="Close palette"
          >
            <X size={14} />
          </button>
        </div>

        <div className="max-h-[min(60vh,26rem)] overflow-y-auto scroll-thin">
          {rows.length === 0 ? (
            <div className="px-3 py-6 text-center font-mono text-xs text-dim">
              {value.trim() ? 'No matches. Try a mint address, or a command like HELP.' : 'Type to search…'}
            </div>
          ) : (
            <ul role="listbox" className="py-1">
              {rows.map((row, i) => (
                <li key={row.key} role="option" aria-selected={i === selected}>
                  <button
                    type="button"
                    onMouseEnter={() => setSelected(i)}
                    onClick={() => activate(row)}
                    className={cn(
                      'flex w-full items-center gap-2 px-3 py-1.5 text-left transition-colors',
                      i === selected ? 'bg-cyan/10' : 'hover:bg-surface-2',
                    )}
                  >
                    {row.kind === 'command' ? (
                      <>
                        <span className="w-16 shrink-0 font-mono text-[11px] font-semibold text-cyan">
                          {row.command.verb}
                        </span>
                        <span className="min-w-0 flex-1 truncate text-xs text-slate-300">{row.command.summary}</span>
                        <span className="hidden shrink-0 font-mono text-[10px] text-dim sm:block">{row.hint}</span>
                      </>
                    ) : row.kind === 'search' ? (
                      <>
                        <TokenAvatar logoUri={row.logoUri} symbol={row.symbol} mint={row.mint ?? row.key} size="sm" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-xs font-medium text-slate-100">{row.label}</span>
                          <span className="block truncate font-mono text-[10px] text-dim">{row.sublabel}</span>
                        </span>
                        {row.price != null ? (
                          <span className="shrink-0 text-right">
                            <span className="tnum block text-[11px] text-slate-200">{formatPrice(row.price)}</span>
                            {row.change != null ? (
                              <span className={cn('tnum block text-[10px]', changeToneClass(row.change))}>
                                {formatPct(row.change)}
                              </span>
                            ) : null}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-[11px] text-slate-200">{row.label}</span>
                          <span className="block truncate text-[10px] text-dim">{row.sublabel}</span>
                        </span>
                      </>
                    )}
                    {i === selected ? <CornerDownLeft size={11} className="shrink-0 text-cyan" /> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-edge px-3 py-1.5 font-mono text-[10px] text-dim">
          <span>
            <kbd className="kbd">↑↓</kbd> navigate
          </span>
          <span>
            <kbd className="kbd">Tab</kbd> complete
          </span>
          <span>
            <kbd className="kbd">⏎</kbd> run
          </span>
          {history.length > 0 ? (
            <span className="ml-auto truncate">{history.length} in history</span>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}