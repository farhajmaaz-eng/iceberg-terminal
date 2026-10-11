/**
 * Runtime validation for third-party payloads.
 *
 * Provider responses are treated as untrusted input. Anything that fails
 * validation is coerced to `null` (unknown) rather than 0 or an exception,
 * so partial provider payloads still render as much as they legitimately
 * can.
 */

import { num } from './format';

export { num };

type Rec = Record<string, unknown>;

export function asRecord(v: unknown): Rec | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

export function n(v: unknown): number | null {
  return num(v);
}

export function bool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  return null;
}

export function pick<T>(obj: unknown, key: string, coerce: (v: unknown) => T | null): T | null {
  const rec = asRecord(obj);
  if (!rec) return null;
  return coerce(rec[key]);
}

/** Object wrapper for nested provider shapes like `{ m5: { buys } }`. */
export function window2(v: unknown): { buys: number | null; sells: number | null } | null {
  const rec = asRecord(v);
  if (!rec) return null;
  const buys = n(rec.buys);
  const sells = n(rec.sells);
  if (buys === null && sells === null) return null;
  return { buys, sells };
}

export function numMap(v: unknown): { m5: number | null; h1: number | null; h6: number | null; h24: number | null } | null {
  const rec = asRecord(v);
  if (!rec) return null;
  const out = { m5: n(rec.m5), h1: n(rec.h1), h6: n(rec.h6), h24: n(rec.h24) };
  if (out.m5 === null && out.h1 === null && out.h6 === null && out.h24 === null) return null;
  return out;
}

/** Guards against absurd values that indicate a malformed upstream payload. */
export function plausiblePrice(v: number | null): number | null {
  if (v === null) return null;
  if (v < 0) return null;
  if (!Number.isFinite(v)) return null;
  return v;
}

export function plausibleNonNegative(v: number | null): number | null {
  if (v === null) return null;
  return v < 0 ? null : v;
}

/** ISO timestamp / epoch-seconds / epoch-ms -> epoch ms, or null. */
export function toEpochMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) {
    // Heuristic: < 1e12 is seconds (year ~33658 in seconds).
    return v < 1e12 ? Math.round(v * 1000) : Math.round(v);
  }
  if (typeof v === 'string') {
    const asNum = Number(v);
    if (Number.isFinite(asNum) && v.trim() !== '') return toEpochMs(asNum);
    const parsed = Date.parse(v);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}