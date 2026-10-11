import * as React from 'react';
import { Link } from 'react-router-dom';
import { isSolanaAddress, isSolanaSignature } from '@/lib/solana';
import { truncateAddress } from '@/lib/format';
import { changeToneClass, formatPct, formatPrice } from '@/lib/format';
import { cn } from '@/lib/utils';

/** Shared token-cell used by every token table so identity rules stay in one place. */
export function TokenCell({
  mint,
  symbol,
  name,
  logoUri,
  right,
  className,
  size = 'md',
}: {
  mint: string;
  symbol?: string | null;
  name?: string | null;
  logoUri?: string | null;
  right?: React.ReactNode;
  className?: string;
  size?: 'sm' | 'md';
}) {
  // Symbols are display-only and are often unknown (a token added by mint
  // address has no symbol until a provider supplies one). Fall back to a
  // truncated mint so the row is still identifiable rather than a bare dash.
  const label = symbol ?? truncateAddress(mint, 4);
  return (
    <div className={cn('flex min-w-0 items-center gap-2', className)}>
      <TokenAvatar logoUri={logoUri} symbol={symbol} mint={mint} size={size} />
      <div className="min-w-0">
        <Link
          to={`/token/${mint}`}
          className="block truncate font-medium text-slate-100 hover:text-cyan"
          title={mint}
        >
          {label}
        </Link>
        {size === 'md' && name ? (
          <div className="flex items-center gap-1.5">
            <span className="truncate font-mono text-[10px] text-dim" title={name}>
              {name}
            </span>
          </div>
        ) : null}
      </div>
      {right ? <div className="ml-auto shrink-0">{right}</div> : null}
    </div>
  );
}

/**
 * Deterministic identicon fallback. Remote logo URIs are user-controlled and
 * therefore never trusted for layout stability — the avatar always has fixed
 * dimensions and a same-origin fallback.
 */
export function TokenAvatar({
  logoUri,
  symbol,
  mint,
  size = 'md',
}: {
  logoUri?: string | null;
  symbol?: string | null;
  mint: string;
  size?: 'sm' | 'md';
}) {
  const [failed, setFailed] = React.useState(false);
  const dim = size === 'sm' ? 'h-5 w-5 text-[8px]' : 'h-6 w-6 text-[9px]';
  const hue = React.useMemo(() => {
    let h = 0;
    for (let i = 0; i < mint.length; i++) h = (h * 31 + mint.charCodeAt(i)) % 360;
    return h;
  }, [mint]);

  if (logoUri && !failed) {
    return (
      <img
        src={logoUri}
        alt=""
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className={cn('shrink-0 rounded-full border border-edge object-cover', dim)}
      />
    );
  }

  return (
    <div
      className={cn('flex shrink-0 items-center justify-center rounded-full border border-edge font-mono font-semibold uppercase', dim)}
      style={{ background: `hsl(${hue} 45% 16%)`, color: `hsl(${hue} 70% 68%)` }}
      aria-hidden
    >
      {(symbol ?? '?').slice(0, 2)}
    </div>
  );
}

export function PriceCell({ value, className }: { value: number | null; className?: string }) {
  return (
    <span className={cn('tnum block text-right', className)}>
      {formatPrice(value)}
    </span>
  );
}

export function ChangeCell({ value, className }: { value: number | null; className?: string }) {
  const tone = changeToneClass(value);
  return (
    <span className={cn('tnum block text-right font-medium', tone, value === null && 'font-normal', className)}>
      {formatPct(value)}
    </span>
  );
}

export function AddressLink({
  value,
  kind = 'address',
  explorer = 'solscan',
  truncate = true,
  className,
}: {
  value: string;
  kind?: 'address' | 'tx' | 'token';
  explorer?: 'solscan' | 'dexscreener' | 'birdeye';
  truncate?: boolean;
  className?: string;
}) {
  const href =
    explorer === 'dexscreener'
      ? `https://dexscreener.com/solana/${value.toLowerCase()}`
      : explorer === 'birdeye'
        ? `https://birdeye.so/token/${value}`
        : `https://solscan.io/${kind === 'tx' ? 'tx' : kind === 'token' ? 'token' : 'account'}/${value}`;

  const label = truncate ? (isSolanaSignature(value) ? truncateAddress(value, 5) : truncateAddress(value, 4)) : value;
  const safe = isSolanaAddress(value) || isSolanaSignature(value) ? href : '#';

  return (
    <a
      href={safe}
      target="_blank"
      rel="noopener noreferrer nofollow"
      className={cn('font-mono text-[10px] text-cyan hover:underline', className)}
      title={value}
    >
      {label}
    </a>
  );
}

/** Accessible sortable table header button. */
export function SortHeader<K extends string>({
  label,
  field,
  active,
  dir,
  onSort,
  align = 'right',
  className,
}: {
  label: React.ReactNode;
  field: K;
  active: K | null;
  dir: 'asc' | 'desc';
  onSort: (field: K) => void;
  align?: 'left' | 'right';
  className?: string;
}) {
  return (
    <th scope="col" className={cn(align === 'right' && 'text-right', className)}>
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wider transition-colors hover:text-slate-200',
          active && 'text-cyan',
          align === 'right' && 'flex-row-reverse',
        )}
        aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        {label}
        <span className="text-[8px]">{active ? (dir === 'asc' ? '▲' : '▼') : ''}</span>
      </button>
    </th>
  );
}