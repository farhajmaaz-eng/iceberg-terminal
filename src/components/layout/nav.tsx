import * as React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  CandlestickChart as CandleIcon,
  LayoutGrid,
  ListFilter,
  Lock,
  Newspaper,
  Settings,
  Star,
  Waves,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useProviderStore } from '@/store/providers';
import { useVaultStore } from '@/store/vault';
import { useIsFetching } from '@tanstack/react-query';

export interface NavItem {
  to: string;
  label: string;
  short: string;
  icon: React.ElementType;
  /** Command keyword that jumps here. */
  cmd: string;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Markets', short: 'MKT', icon: LayoutGrid, cmd: 'MARKETS' },
  { to: '/screener', label: 'Screener', short: 'SCR', icon: ListFilter, cmd: 'SCREENER' },
  { to: '/activity', label: 'Activity', short: 'ACT', icon: Activity, cmd: 'ACTIVITY' },
  { to: '/flows', label: 'Flows', short: 'FLW', icon: Waves, cmd: 'FLOWS' },
  { to: '/news', label: 'News', short: 'NWS', icon: Newspaper, cmd: 'NEWS' },
  { to: '/watchlist', label: 'Watchlist', short: 'WTL', icon: Star, cmd: 'WATCHLIST' },
  { to: '/settings', label: 'Settings', short: 'CFG', icon: Settings, cmd: 'SETTINGS' },
];

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn('h-5 w-5', className)} aria-hidden>
      <path d="M16 4 L27 27 H22.6 L16 13.2 L9.4 27 H5 Z" fill="currentColor" className="text-cyan" />
      <path d="M11.4 21 H20.6 L22.6 27 H9.4 Z" fill="currentColor" className="text-bull" opacity="0.8" />
    </svg>
  );
}

/**
 * A single navigation row.
 *
 * The active state is a 2px accent rail plus a one-step surface lift rather
 * than a full cyan-tinted pill. On a dense list of seven items, one tinted row
 * is legible; a tinted *region* competes with the data beside it.
 */
function NavRow({
  to,
  label,
  icon: Icon,
  cmd,
  collapsed,
  end,
  title,
}: NavItem & { collapsed: boolean; end?: boolean; title?: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      title={collapsed ? `${label}  ·  ${cmd}` : title}
      aria-current={undefined}
      className={({ isActive }) =>
        cn(
          'group relative flex h-7 items-center gap-2 rounded-sm px-2 text-xs transition-colors duration-75 ease-snap',
          isActive ? 'nav-active font-medium' : 'text-slate-400 hover:bg-surface-2 hover:text-slate-100',
        )
      }
    >
      {({ isActive }) => (
        <>
          <Icon size={13} className={cn('shrink-0', isActive ? 'text-cyan' : 'text-dim group-hover:text-slate-300')} />
          {!collapsed ? <span className="truncate">{label}</span> : null}
          {!collapsed ? (
            <span
              className={cn(
                'ml-auto font-mono text-[9px] tracking-label transition-opacity duration-150',
                isActive ? 'text-cyan/50' : 'text-dim/60 group-hover:text-dim',
              )}
            >
              {cmd}
            </span>
          ) : null}
        </>
      )}
    </NavLink>
  );
}

/**
 * Session rail.
 *
 * The sidebar previously ended after seven links, leaving ~700px of empty
 * surface that made the whole app look unfinished. Real terminals fill that
 * column with *state*: which feed is live, whether anything is in flight, and
 * whether the credential vault is open. That is information the operator wants
 * permanently visible, and it turns dead space into the app's status readout.
 */
function SessionRail({ collapsed }: { collapsed: boolean }) {
  const vaultUnlocked = useVaultStore((s) => s.unlocked);
  const vaultStored = useVaultStore((s) => s.stored.length);
  const selectedMarket = useProviderStore((s) => s.selectedMarket);
  const isFetching = useIsFetching();
  const { pathname } = useLocation();

  // Fetching is only interesting on views that actually fetch; on Settings it
  // would flicker constantly and mean nothing.
  const showActivity = pathname !== '/settings' && isFetching > 0;

  if (collapsed) {
    return (
      <div className="flex flex-col items-center gap-2 border-t border-edge py-2">
        <span
          className={cn('h-1.5 w-1.5 rounded-full transition-colors duration-300', showActivity ? 'bg-cyan' : 'bg-dim/40')}
          title={showActivity ? 'Fetching data' : 'Idle'}
        />
        <Lock
          size={11}
          className={cn(vaultStored === 0 ? 'text-dim/40' : vaultUnlocked ? 'text-bull/70' : 'text-amber/80')}
          aria-label={vaultStored === 0 ? 'No credentials stored' : vaultUnlocked ? 'Vault unlocked' : 'Vault locked'}
        />
      </div>
    );
  }

  return (
    <div className="border-t border-edge px-2.5 py-2">
      <div className="eyebrow mb-1.5">Session</div>

      <dl className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-dim">
            <span
              className={cn(
                'h-1.5 w-1.5 shrink-0 rounded-full transition-colors duration-300',
                showActivity ? 'animate-pulse bg-cyan' : 'bg-dim/40',
              )}
            />
            Feed
          </dt>
          <dd className={cn('font-mono text-[10px]', showActivity ? 'text-cyan' : 'text-slate-400')}>
            {showActivity ? 'FETCHING' : 'IDLE'}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="text-[11px] text-dim">Market</dt>
          <dd className="truncate font-mono text-[10px] text-slate-400" title={selectedMarket}>
            {selectedMarket ?? '—'}
          </dd>
        </div>

        <div className="flex items-center justify-between gap-2">
          <dt className="flex items-center gap-1.5 text-[11px] text-dim">
            <Lock size={9} className="shrink-0" />
            Vault
          </dt>
          <dd
            className={cn(
              'font-mono text-[10px]',
              vaultStored === 0 ? 'text-dim/60' : vaultUnlocked ? 'text-bull/80' : 'text-amber/80',
            )}
          >
            {vaultStored === 0 ? 'NO KEYS' : vaultUnlocked ? 'OPEN' : 'LOCKED'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function SideNav({ collapsed }: { collapsed: boolean }) {
  return (
    <nav
      className={cn(
        'hidden shrink-0 flex-col border-r border-edge bg-surface-1 md:flex',
        collapsed ? 'w-11' : 'w-48',
      )}
      aria-label="Primary"
    >
      <div className={cn('flex h-9 shrink-0 items-center border-b border-edge', collapsed ? 'justify-center px-0' : 'gap-2 px-2.5')}>
        <BrandMark />
        {!collapsed ? (
          <div className="min-w-0 leading-none">
            <div className="truncate text-[11px] font-semibold tracking-[0.06em] text-slate-100">ICEBERG</div>
            <div className="mt-[3px] truncate font-mono text-[9px] uppercase tracking-[0.2em] text-dim">Terminal</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-1">
        {NAV_ITEMS.map((item) => (
          <NavRow key={item.to} {...item} collapsed={collapsed} end={item.to === '/'} />
        ))}
      </div>

      {/* Watched public wallets live on the Watchlist route; the old standalone
          "Wallet" entry pointed at /wallet, which merely redirects here, so it
          was a second link to the same page that also lit up alongside
          Watchlist. Wallet *addresses* remain reachable at /wallet/:address. */}
      <SessionRail collapsed={collapsed} />
    </nav>
  );
}

export function MobileNav() {
  const { pathname } = useLocation();
  return (
    <nav
      className="fixed inset-x-0 bottom-0 z-30 flex h-14 items-stretch border-t border-edge bg-surface-1/95 backdrop-blur md:hidden"
      aria-label="Mobile"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {NAV_ITEMS.slice(0, 5).map((item) => {
        const active = item.to === '/' ? pathname === '/' : pathname.startsWith(item.to);
        return (
          <NavLink
            key={item.to}
            to={item.to}
            className={cn(
              'flex flex-1 flex-col items-center justify-center gap-1 text-[9px] font-medium uppercase tracking-label transition-colors',
              active ? 'text-cyan' : 'text-dim',
            )}
          >
            {({ isActive }) => (
              <>
                <span className={cn('h-0.5 w-5 rounded-full transition-colors', isActive ? 'bg-cyan' : 'bg-transparent')} />
                <item.icon size={16} />
                {item.short}
              </>
            )}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function ChartIcon() {
  return <CandleIcon size={12} />;
}