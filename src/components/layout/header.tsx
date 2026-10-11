import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Menu, PanelLeftClose, PanelLeftOpen, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { BrandMark } from './nav';
import { openPalette } from '@/features/command/command-palette';
import { useProviderStore } from '@/store/providers';
import { changeToneClass, formatPct, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';
import { useSpotPrices } from '@/data/queries';
import { SOL_MINT, USDC_MINT } from '@/lib/constants';

/**
 * Application header.
 *
 * Contains the global search entry point, a live SOL/USDC reference quote
 * from the configured market provider, demo-mode state, and the alert bell.
 */
export function Header({ onToggleSidebar, sidebarCollapsed }: { onToggleSidebar: () => void; sidebarCollapsed: boolean }) {
  const navigate = useNavigate();
  const forceDemo = useProviderStore((s) => s.forceDemo);
  const [term, setTerm] = React.useState('');

  const sol = useSpotPrices([SOL_MINT]);
  const price = sol.data?.prices[SOL_MINT] ?? null;
  const change = sol.data?.change24h[SOL_MINT] ?? null;

  return (
    <header className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-surface-1 px-2">
      <Button
        size="icon"
        variant="ghost"
        onClick={onToggleSidebar}
        aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="hidden md:inline-flex"
      >
        {sidebarCollapsed ? <PanelLeftOpen size={13} /> : <PanelLeftClose size={13} />}
      </Button>
      <Button size="icon" variant="ghost" className="md:hidden" onClick={() => navigate('/')} aria-label="Home">
        <Menu size={14} />
      </Button>

      <div className="md:hidden">
        <BrandMark />
      </div>

      <form
        className="relative min-w-0 max-w-md flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          openPalette('search', term);
          setTerm('');
        }}
      >
        <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-dim" />
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          onFocus={() => openPalette('search', term)}
          placeholder="Search tokens, wallets, signatures"
          aria-label="Global search"
          className="h-6 w-full rounded-sm border border-edge bg-surface-0 pl-6 pr-12 font-mono text-xs text-slate-100 transition-colors placeholder:text-dim focus:border-cyan/50 focus:outline-none"
          spellCheck={false}
        />
        <kbd className="kbd pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2">⌘K</kbd>
      </form>

      <div className="ml-auto flex items-center gap-1.5">
        {forceDemo ? (
          <Badge tone="demo" title="All values on this page are deterministic synthetic samples.">
            demo mode
          </Badge>
        ) : null}

        {/* Reference quote: the one always-worth-knowing number, so it earns a
            fixed slot at the right of the header. The mint prefix beside it
            was redundant with the SOL/USDC pair label and read as noise. */}
        <button
          type="button"
          onClick={() => navigate('/markets/solana')}
          className="hidden items-center gap-2 rounded-sm border border-edge bg-surface-2 py-1 pl-2 pr-2.5 transition-colors hover:border-edge-strong hover:bg-surface-3 lg:flex"
          aria-label="Solana market overview"
          title={`SOL quoted against USDC · ${USDC_MINT}`}
        >
          <span className="font-mono text-[10px] tracking-label text-dim">SOL/USDC</span>
          <span className="tnum text-xs font-medium text-slate-100">{formatPrice(price)}</span>
          <span
            className={cn(
              'tnum w-14 border-l border-edge pl-2 text-right text-[10px]',
              changeToneClass(change),
            )}
          >
            {formatPct(change)}
          </span>
        </button>

        <button
          type="button"
          onClick={() => openPalette('command')}
          className="flex h-7 items-center gap-1.5 rounded-sm border border-edge-strong bg-surface-3 px-2 text-slate-300 transition-colors hover:bg-surface-4 hover:text-white"
          aria-label="Open command palette"
        >
          <Zap size={12} className="text-cyan" />
          {/* The HELP hint is redundant on touch devices where the label would
              crowd the header; the icon remains the control. */}
          <span className="hidden font-mono text-[11px] tracking-label sm:inline">HELP</span>
        </button>
      </div>
    </header>
  );
}

/** Global unhandled-error boundary. */
export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  override componentDidCatch(error: Error) {
    console.error('Unhandled UI error', error);
  }

  override render() {
    if (this.state.error) {
      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
          <div className="font-mono text-xs font-semibold uppercase tracking-widest text-bear">Interface error</div>
          <p className="max-w-lg text-xs text-slate-400">
            Something in the interface failed to render. Your local data is untouched. Reload to recover; if it
            persists, please report it.
          </p>
          <pre className="max-w-2xl overflow-auto whitespace-pre-wrap rounded-sm border border-edge bg-surface-1 p-2 text-left font-mono text-[10px] text-dim">
            {this.state.error.message}
          </pre>
          <Button variant="outline" onClick={() => window.location.reload()}>
            Reload
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}