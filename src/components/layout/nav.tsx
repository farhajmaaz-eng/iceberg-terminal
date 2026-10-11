import * as React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  CandlestickChart as CandleIcon,
  LayoutGrid,
  ListFilter,
  Newspaper,
  Settings,
  Star,
  Wallet,
  Waves,
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
      <path d="M16 4 L27 27 H22.6 L16 13.2 L9.4 27 H5 Z" fill="#22d3ee" />
      <path d="M11.4 21 H20.6 L22.6 27 H9.4 Z" fill="#22c55e" opacity="0.85" />
    </svg>
  );
}

export function SideNav({ collapsed }: { collapsed: boolean }) {
  return (
    <nav
      className={cn(
        'hidden shrink-0 flex-col border-r border-edge bg-surface-1 md:flex',
        collapsed ? 'w-11' : 'w-44',
      )}
      aria-label="Primary"
    >
      <div className="flex h-9 items-center gap-2 border-b border-edge px-2.5">
        <BrandMark />
        {!collapsed ? (
          <div className="min-w-0">
            <div className="truncate text-xs font-semibold tracking-tight text-slate-100">ICEBERG</div>
            <div className="truncate font-mono text-[9px] uppercase tracking-[0.18em] text-dim">Terminal</div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-1 flex-col gap-0.5 p-1">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              cn(
                'group flex h-7 items-center gap-2 rounded-sm px-2 text-xs transition-colors',
                isActive
                  ? 'bg-cyan/10 text-cyan'
                  : 'text-slate-400 hover:bg-surface-3 hover:text-slate-100',
              )
            }
            title={item.label}
          >
            <item.icon size={13} className="shrink-0" />
            {!collapsed ? <span className="truncate">{item.label}</span> : null}
            {!collapsed ? (
              <span className="ml-auto hidden font-mono text-[9px] text-dim group-hover:inline lg:inline">
                {item.cmd}
              </span>
            ) : null}
          </NavLink>
        ))}
      </div>

      <NavLink
        to="/wallet"
        className={({ isActive }) =>
          cn(
            'flex h-8 items-center gap-2 border-t border-edge px-2.5 text-xs transition-colors',
            isActive ? 'bg-cyan/10 text-cyan' : 'text-slate-400 hover:bg-surface-3 hover:text-slate-100',
          )
        }
      >
        <Wallet size={13} />
        {!collapsed ? <span>Wallet</span> : null}
      </NavLink>
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
              'flex flex-1 flex-col items-center justify-center gap-0.5 text-[9px] font-medium uppercase tracking-wider transition-colors',
              active ? 'text-cyan' : 'text-dim',
            )}
          >
            <item.icon size={16} />
            {item.short}
          </NavLink>
        );
      })}
    </nav>
  );
}

export function ChartIcon() {
  return <CandleIcon size={12} />;
}