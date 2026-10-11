/**
 * Solana address / signature validation (base58, ed25519-compatible lengths).
 *
 * Purely client-side format checks used to decide what kind of research view
 * to open from the command palette and global search. They do NOT prove an
 * account exists — only the chain does that.
 */

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const BASE58_SET = new Set(BASE58_ALPHABET.split(''));

export function isBase58(value: string): boolean {
  if (!value) return false;
  for (const ch of value) if (!BASE58_SET.has(ch)) return false;
  return true;
}

/** Solana pubkey: 32 bytes -> 32-44 base58 chars. */
export function isSolanaAddress(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 32 || v.length > 44) return false;
  return isBase58(v);
}

/** Transaction signature: 64 bytes -> 64-88 base58 chars. */
export function isSolanaSignature(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (v.length < 64 || v.length > 90) return false;
  return isBase58(v);
}

export function isSolanaMint(value: unknown): value is string {
  return isSolanaAddress(value);
}

export function classifyIdentifier(value: string): 'signature' | 'address' | 'unknown' {
  const v = value.trim();
  if (isSolanaSignature(v)) return 'signature';
  if (isSolanaAddress(v)) return 'address';
  return 'unknown';
}

/** EVM 0x address — accepted by search but Solana-first by default. */
export function isEvmAddress(value: unknown): value is string {
  return typeof value === 'string' && /^0x[a-fA-F0-9]{40}$/.test(value.trim());
}

export function explorerUrl(kind: 'tx' | 'address' | 'token', value: string): string {
  const base = 'https://solscan.io';
  switch (kind) {
    case 'tx':
      return `${base}/tx/${value}`;
    case 'token':
      return `${base}/token/${value}`;
    default:
      return `${base}/account/${value}`;
  }
}

export function dexscreenerUrl(chain: string, pairAddress: string): string {
  return `https://dexscreener.com/${chain}/${pairAddress.toLowerCase()}`;
}