/**
 * Display formatters.
 *
 * Rule enforced across the app: `null`/`undefined` renders as an em-dash
 * placeholder, never as 0. `0` is a real, meaningful value and is formatted
 * as "0".
 */

export const NA = '—';

export function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

/** Coerce provider payloads. Returns null for junk instead of NaN/0. */
export function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

const USD_TIERS: { limit: number; suffix: string; div: number }[] = [
  { limit: 1e12, suffix: 'T', div: 1e12 },
  { limit: 1e9, suffix: 'B', div: 1e9 },
  { limit: 1e6, suffix: 'M', div: 1e6 },
  { limit: 1e3, suffix: 'K', div: 1e3 },
];

/** Adaptive price precision: tiny tokens keep significant digits. */
export function pricePrecision(v: number): number {
  const a = Math.abs(v);
  if (a === 0) return 2;
  if (a >= 1000) return 2;
  if (a >= 1) return 4;
  if (a >= 0.01) return 5;
  if (a >= 0.0001) return 7;
  return 9;
}

export function formatPrice(v: number | null | undefined, opts?: { compact?: boolean }): string {
  if (!isNum(v)) return NA;
  const n = v as number;
  const abs = Math.abs(n);
  if (opts?.compact && abs >= 1000) return `$${compact(n)}`;
  const p = pricePrecision(n);
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: p, maximumFractionDigits: p })}`;
}

export function compact(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return NA;
  const n = v as number;
  const abs = Math.abs(n);
  for (const t of USD_TIERS) {
    if (abs >= t.limit) {
      const scaled = n / t.div;
      return `${scaled.toLocaleString('en-US', {
        minimumFractionDigits: 0,
        maximumFractionDigits: digits,
      })}${t.suffix}`;
    }
  }
  return n.toLocaleString('en-US', { maximumFractionDigits: digits });
}

export function formatUsdCompact(v: number | null | undefined): string {
  if (!isNum(v)) return NA;
  return `$${compact(v)}`;
}

export function formatNumber(v: number | null | undefined, digits = 0): string {
  if (!isNum(v)) return NA;
  return (v as number).toLocaleString('en-US', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

export function formatCompactNumber(v: number | null | undefined): string {
  return isNum(v) ? compact(v) : NA;
}

/** Signed percentage with an explicit sign. null -> em dash. */
export function formatPct(v: number | null | undefined, digits = 2): string {
  if (!isNum(v)) return NA;
  const n = v as number;
  const sign = n > 0 ? '+' : '';
  return `${sign}${n.toFixed(digits)}%`;
}

export function formatAmount(v: number | null | undefined, maxDecimals = 4): string {
  if (!isNum(v)) return NA;
  const n = v as number;
  const abs = Math.abs(n);
  if (abs >= 1e9) return compact(n);
  if (abs > 0 && abs < 1e-6) return n.toExponential(2);
  return n.toLocaleString('en-US', { maximumFractionDigits: maxDecimals });
}

export function truncateMiddle(value: string, head = 6, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

export function truncateAddress(value: string, size = 4): string {
  if (value.length <= size * 2 + 1) return value;
  return `${value.slice(0, size)}…${value.slice(-size)}`;
}

export function formatLamports(lamports: number | null | undefined): string {
  if (!isNum(lamports)) return NA;
  return `${(lamports / 1e9).toLocaleString('en-US', { maximumFractionDigits: 9 })} SOL`;
}

export function formatClockTime(ts: number | null | undefined): string {
  if (!isNum(ts)) return NA;
  return new Date(ts as number).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatDateTime(ts: number | null | undefined): string {
  if (!isNum(ts)) return NA;
  return new Date(ts as number).toLocaleString('en-US', {
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatAge(fromTs: number | null | undefined, now = Date.now()): string {
  if (!isNum(fromTs)) return NA;
  const diff = Math.max(0, now - (fromTs as number));
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

export function changeToneClass(v: number | null | undefined): string {
  if (!isNum(v)) return 'text-dim';
  const n = v as number;
  if (n > 0) return 'text-bull';
  if (n < 0) return 'text-bear';
  return 'text-dim';
}

/** Simple seeded PRNG so demo data is deterministic across reloads. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}