import { AppError } from './errors';

/**
 * Redaction guard. Any string that reaches a log, an error message or the UI
 * passes through here first so that credentials can never leak into the
 * console, a toast, or a React error boundary.
 */

const SECRET_PATTERNS: { re: RegExp; replace: string }[] = [
  // Bearer/Basic headers
  { re: /\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}/gi, replace: '$1 [REDACTED]' },
  // key=value / key: value pairs for well-known secret param names
  {
    re: /((?:api[-_]?key|apikey|x-api-key|x-api-secret|secret|token|password|passphrase|auth[-_]?token|private[-_]?key)\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,&;"']+)/gi,
    replace: '$1[REDACTED]',
  },
  // Query-string style credentials
  { re: /([?&](?:api[-_]?key|apikey|x-api-key|x-api-secret|key|token|access[-_]?token)=)[^&\s]+/gi, replace: '$1[REDACTED]' },
  // Hex private keys (EVM raw keys / 32-byte secrets), 0x + 128 hex chars
  { re: /\b0x[0-9a-f]{128}\b/gi, replace: '[REDACTED_KEY_MATERIAL]' },
  // Solana keypair JSON (array of 64 numbers) — an unmistakable secret shape
  { re: /\[\s*\d{1,3}(\s*,\s*\d{1,3}){20,}\s*\]/g, replace: '[REDACTED_KEY_MATERIAL]' },
  // Long base58 key material
  { re: /\b[1-9A-HJ-NP-Za-km-z]{86,90}\b/g, replace: '[REDACTED_KEY_MATERIAL]' },
];

export function redact(input: string): string {
  let out = input;
  for (const { re, replace } of SECRET_PATTERNS) {
    out = out.replace(re, replace);
  }
  return out;
}

export function redactError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e);
  return redact(raw);
}

/** Log an error safely. Console noise is opt-in via `__ICEBERG_DEBUG__`. */
export function safeWarn(message: string, e?: unknown): void {
  if (!(globalThis as { __ICEBERG_DEBUG__?: boolean }).__ICEBERG_DEBUG__) return;
  console.warn(redact(message), e instanceof Error ? redact(e.message) : undefined);
}

export function assertNever(value: never, context: string): never {
  throw new AppError('validation', `Unhandled variant in ${context}: ${String(value)}`);
}