import * as React from 'react';
import { Navigate, Route, HashRouter as Router, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/primitives';
import { Header, ErrorBoundary } from '@/components/layout/header';
import { MobileNav, SideNav } from '@/components/layout/nav';
import { CommandPalette, openPalette } from '@/features/command/command-palette';
import { ToastProvider } from './features/command/toast';
import { AlertBell, useAlertEngine } from '@/features/watchlist/AlertDialogEngine';
import { MarketsPage } from '@/features/markets/MarketsPage';
import { ScreenerPage } from '@/features/screener/ScreenerPage';
import { TokenPage } from '@/features/token/TokenPage';
import { WalletPage } from '@/features/wallet/WalletPage';
import { ActivityPage } from '@/features/activity/ActivityPage';
import { FlowsPage } from '@/features/flows/FlowsPage';
import { NewsPage } from '@/features/news/NewsPage';
import { WatchlistPage } from '@/features/watchlist/WatchlistPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { HelpPage } from '@/features/help/HelpPage';
import { TxPage } from '@/features/tx/TxPage';
import { useProviderStore } from '@/store/providers';
import { useVaultStore } from '@/store/vault';
import { hydratePersistedState } from '@/store/hydrate';
import { AppBackground } from './background';

/**
 * Iceberg Terminal — application root.
 *
 * HashRouter keeps the whole app a static bundle that works on any static host
 * (GitHub Pages, S3, Netlify) with no server rewrite rules.
 */

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      gcTime: 5 * 60_000,
    },
  },
});

function Shell() {
  const location = useLocation();
  const collapsed = useProviderStore((s) => s.prefs.sidebarCollapsed);
  const updatePrefs = useProviderStore((s) => s.updatePrefs);
  const hydrate = useVaultStore((s) => s.hydrate);

  useAlertEngine();

  React.useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Global keyboard shortcuts.
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        openPalette('command');
        return;
      }
      if (typing) return;
      if (e.key === '/') {
        e.preventDefault();
        openPalette('search', '');
        return;
      }
      if (e.key === '?') {
        e.preventDefault();
        openPalette('command', 'HELP');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  React.useEffect(() => {
    // Reset scroll on navigation for the scrollable panes.
    document.querySelectorAll('[data-scroll-root]').forEach((el) => {
      el.scrollTop = 0;
    });
  }, [location.pathname]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-0">
      <Header
        sidebarCollapsed={collapsed}
        onToggleSidebar={() => updatePrefs({ sidebarCollapsed: !collapsed })}
      />
      <div className="flex min-h-0 flex-1">
        <SideNav collapsed={collapsed} />
        <main className="flex min-h-0 flex-1 flex-col pb-14 md:pb-0" data-scroll-root>
          <Routes>
            <Route path="/" element={<MarketsPage />} />
            <Route path="/markets/:asset" element={<MarketsPage />} />
            <Route path="/screener" element={<ScreenerPage />} />
            <Route path="/token/:mint" element={<TokenPage />} />
            <Route path="/wallet" element={<Navigate to="/watchlist" replace />} />
            <Route path="/wallet/:address" element={<WalletPage />} />
            <Route path="/activity" element={<ActivityPage />} />
            <Route path="/flows" element={<FlowsPage />} />
            <Route path="/news" element={<NewsPage />} />
            <Route path="/watchlist" element={<WatchlistPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/help" element={<HelpPage />} />
            <Route path="/tx/:signature" element={<TxPage />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </main>
      </div>
      <MobileNav />
      <CommandPalette />
      <AlertBell />
      <AppBackground />
    </div>
  );
}

function NotFound() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
      <div className="font-mono text-2xl font-bold text-surface-4">404</div>
      <p className="text-xs text-slate-400">No such view in this terminal.</p>
      <a href="#/" className="text-xs text-cyan hover:underline">
        ← back to Markets
      </a>
    </div>
  );
}

export function App() {
  React.useEffect(() => {
    void hydratePersistedState();
  }, []);

  return (
    <ErrorBoundary>
      {/* ToastProvider must wrap the shell so command results surface. */}
      <ToastProvider>
        <QueryClientProvider client={queryClient}>
          <TooltipProvider delayDuration={250} skipDelayDuration={100}>
            <Router>
              <Shell />
            </Router>
          </TooltipProvider>
        </QueryClientProvider>
      </ToastProvider>
    </ErrorBoundary>
  );
}