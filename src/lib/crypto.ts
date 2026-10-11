import { STORES, idbDelete, idbGet, idbKeys, idbSet } from './idb';

/**
 * Local secret vault.
 *
 * Credentials are stored in IndexedDB as AES-GCM ciphertext derived from a
 * user-supplied passphrase (PBKDF2-SHA256, 210k iterations, per-record random
 * salt + IV).
 *
 * SECURITY NOTE (also surfaced in-app and in SECURITY.md):
 *   This protects a stored key at rest against someone who only reads the
 *   IndexedDB file. It does NOT protect the key while the application is
 *   running, and it cannot protect against compromised JavaScript, a malicious
 *   browser extension, or an already-compromised device. Browser-side
 *   encryption is defence-in-depth, not a vault.
 */

const PBKDF2_ITERATIONS = 210_000;
/**
 * Accepted range for the iteration count read back from a stored envelope.
 *
 * The envelope lives in IndexedDB, which any script in the origin (or an
 * already-compromised machine) can rewrite. Feeding an attacker-chosen
 * `iterations` straight into `deriveKey` is a denial-of-service primitive:
 * 2^31-1 iterations hangs the main thread for minutes, and 0/NaN/negative
 * makes WebCrypto throw an opaque error that is impossible to act on. So the
 * value is bounded *before* it is used, and structural fields are validated
 * too.
 */
export const MIN_ITERATIONS = 1_000;
export const MAX_ITERATIONS = 2_000_000;
const MIN_SALT_BYTES = 8;
const MIN_IV_BYTES = 12;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 256;

export interface VaultEnvelope {
  v: 1;
  /** 'AES-GCM' = real encryption. 'XOR' = obfuscation only (no passphrase). */
  alg: 'AES-GCM' | 'XOR';
  kdf: 'PBKDF2-SHA256' | 'NONE';
  iterations: number;
  salt: string;
  iv: string;
  cipherText: string;
  updatedAt: number;
}

/** Raised when a stored envelope is structurally invalid or out of bounds. */
export class InvalidEnvelopeError extends Error {
  readonly field: string;
  constructor(field: string, detail: string) {
    super(`Local vault record is invalid (${field}: ${detail}).`);
    this.name = 'InvalidEnvelopeError';
    this.field = field;
  }
}

function decodeBounded(field: string, value: unknown, min: number, max: number): Uint8Array {
  if (typeof value !== 'string' || value.length === 0) {
    throw new InvalidEnvelopeError(field, 'expected a non-empty base64 string');
  }
  // Guard before decoding: a hostile string should not be allowed to allocate.
  const maxChars = Math.ceil((max * 4) / 3) + 4;
  if (value.length > maxChars) {
    throw new InvalidEnvelopeError(field, `longer than ${max} bytes`);
  }
  let bytes: Uint8Array;
  try {
    bytes = fromBase64(value);
  } catch {
    throw new InvalidEnvelopeError(field, 'not valid base64');
  }
  if (bytes.length < min) {
    throw new InvalidEnvelopeError(field, `shorter than ${min} bytes`);
  }
  if (bytes.length > max) {
    throw new InvalidEnvelopeError(field, `longer than ${max} bytes`);
  }
  return bytes;
}

/**
 * Validate an envelope's structure and parameters before any crypto runs.
 *
 * Throws {@link InvalidEnvelopeError} rather than letting WebCrypto fail
 * opaquely or burn CPU on an absurd iteration count.
 */
export function validateEnvelope(envelope: unknown): asserts envelope is VaultEnvelope {
  if (!envelope || typeof envelope !== 'object') {
    throw new InvalidEnvelopeError('envelope', 'not an object');
  }
  const e = envelope as Partial<VaultEnvelope>;

  if (e.v !== 1) throw new InvalidEnvelopeError('v', `expected 1, got ${String(e.v)}`);

  if (e.alg === 'XOR') {
    // Obfuscation records must NOT claim a KDF cost — otherwise a corrupt
    // record could route a "decrypt" through an unbounded derivation.
    if (e.kdf !== 'NONE') throw new InvalidEnvelopeError('kdf', 'XOR records must use kdf "NONE"');
    if (typeof e.iterations === 'number' && e.iterations !== 0) {
      throw new InvalidEnvelopeError('iterations', 'obfuscated records must declare 0 iterations');
    }
    decodeBounded('salt', e.salt, MIN_SALT_BYTES, 64);
    decodeBounded('cipherText', e.cipherText, 1, MAX_CIPHERTEXT_BYTES);
    return;
  }

  if (e.alg !== 'AES-GCM') {
    throw new InvalidEnvelopeError('alg', `unsupported algorithm ${String(e.alg)}`);
  }
  if (e.kdf !== 'PBKDF2-SHA256') {
    throw new InvalidEnvelopeError('kdf', `unsupported kdf ${String(e.kdf)}`);
  }

  const it = e.iterations;
  if (typeof it !== 'number' || !Number.isInteger(it)) {
    throw new InvalidEnvelopeError('iterations', `expected an integer, got ${String(it)}`);
  }
  if (it < MIN_ITERATIONS || it > MAX_ITERATIONS) {
    throw new InvalidEnvelopeError(
      'iterations',
      `${it} is outside the supported range ${MIN_ITERATIONS}-${MAX_ITERATIONS}`,
    );
  }

  decodeBounded('salt', e.salt, MIN_SALT_BYTES, 64);
  decodeBounded('iv', e.iv, MIN_IV_BYTES, 16);
  // AES-GCM ciphertext is at least one 16-byte tag longer than the plaintext.
  decodeBounded('cipherText', e.cipherText, 17, MAX_CIPHERTEXT_BYTES);
}

/** True when the envelope is genuinely encrypted with a passphrase. */
export function isEncrypted(envelope: VaultEnvelope): boolean {
  if (envelope?.alg !== 'AES-GCM' || envelope.kdf !== 'PBKDF2-SHA256') return false;
  const it = envelope.iterations;
  return typeof it === 'number' && Number.isInteger(it) && it >= MIN_ITERATIONS && it <= MAX_ITERATIONS;
}

function toBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin);
}

function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function cryptoAvailable(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.subtle !== 'undefined' &&
    typeof globalThis.crypto.subtle.importKey === 'function'
  );
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  // Defence in depth: callers validate first, but the KDF must never be handed
  // an out-of-range cost even if a future caller forgets.
  if (!Number.isInteger(iterations) || iterations < MIN_ITERATIONS || iterations > MAX_ITERATIONS) {
    throw new InvalidEnvelopeError('iterations', `${iterations} is outside the supported range`);
  }
  const material = await globalThis.crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return globalThis.crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: KEY_BYTES },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptSecret(plaintext: string, passphrase: string): Promise<VaultEnvelope> {
  if (!cryptoAvailable()) throw new Error('WebCrypto unavailable — cannot encrypt credentials.');
  if (passphrase.length < 6) throw new Error('Passphrase must be at least 6 characters.');
  const salt = globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const cipher = await globalThis.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return {
    v: 1,
    alg: 'AES-GCM',
    kdf: 'PBKDF2-SHA256',
    iterations: PBKDF2_ITERATIONS,
    salt: toBase64(salt),
    iv: toBase64(iv),
    cipherText: toBase64(new Uint8Array(cipher)),
    updatedAt: Date.now(),
  };
}

/**
 * Decrypt a stored envelope.
 *
 * The envelope is validated **before** any key derivation runs, so a corrupt or
 * tampered record fails fast with an actionable message instead of hanging on
 * an absurd iteration count or surfacing an opaque WebCrypto error.
 */
export async function decryptSecret(envelope: VaultEnvelope, passphrase: string): Promise<string> {
  if (!cryptoAvailable()) throw new Error('WebCrypto unavailable — cannot decrypt credentials.');
  validateEnvelope(envelope);

  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  let plain: ArrayBuffer;
  try {
    plain = await globalThis.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      fromBase64(envelope.cipherText),
    );
  } catch {
    // AES-GCM authentication failed: wrong passphrase or tampered ciphertext.
    throw new Error('Could not decrypt — wrong passphrase or the stored record has been altered.');
  }
  return new TextDecoder().decode(plain);
}

export async function saveVault(envelope: VaultEnvelope): Promise<void> {
  await idbSet(STORES.secrets, 'provider-credentials', envelope);
}

export async function loadVault(): Promise<VaultEnvelope | undefined> {
  const v = await idbGet<VaultEnvelope>(STORES.secrets, 'provider-credentials');
  return v?.v === 1 ? v : undefined;
}

/**
 * Per-provider envelopes.
 *
 * Storing one envelope per provider (rather than a single blob) means adding
 * or removing one credential never requires re-encrypting — and therefore
 * re-requesting the passphrase for — every other credential.
 */
function envelopeKey(providerId: string): string {
  return `secret:${providerId}`;
}

export async function saveSecret(providerId: string, envelope: VaultEnvelope): Promise<void> {
  await idbSet(STORES.secrets, envelopeKey(providerId), envelope);
}

export async function loadSecret(providerId: string): Promise<VaultEnvelope | undefined> {
  const v = await idbGet<VaultEnvelope>(STORES.secrets, envelopeKey(providerId));
  if (!v || v.v !== 1) return undefined;
  // Validate on read so a corrupt or tampered record is reported here rather
  // than surfacing as an opaque failure deep inside the unlock flow.
  validateEnvelope(v);
  return v;
}

export async function deleteSecret(providerId: string): Promise<void> {
  await idbDelete(STORES.secrets, envelopeKey(providerId));
}

export async function listSecretProviderIds(): Promise<string[]> {
  const keys = await idbKeys(STORES.secrets);
  return keys.filter((k) => k.startsWith('secret:')).map((k) => k.slice('secret:'.length));
}

/**
 * Remove every stored credential, including the per-provider records.
 *
 * Clearing only the legacy `provider-credentials` blob would leave the
 * `secret:<id>` records intact, so "Clear vault" appeared to succeed while the
 * encrypted keys were still on disk and the vault came back locked on the next
 * load.
 */
export async function clearVault(): Promise<void> {
  const keys = await idbKeys(STORES.secrets);
  await Promise.all([
    idbDelete(STORES.secrets, 'provider-credentials'),
    ...keys.filter((k) => k.startsWith('secret:')).map((k) => idbDelete(STORES.secrets, k)),
  ]);
}

/** Reverse of `obfuscateSecret` for envelopes written without a passphrase. */
export function deobfuscate(envelope: VaultEnvelope): string {
  validateEnvelope(envelope);
  const salt = fromBase64(envelope.salt);
  const cipher = fromBase64(envelope.cipherText);
  if (salt.length === 0) throw new InvalidEnvelopeError('salt', 'empty salt');
  const plain = new Uint8Array(cipher.length);
  for (let i = 0; i < cipher.length; i++) plain[i] = cipher[i]! ^ salt[i % salt.length]!;
  return new TextDecoder().decode(plain);
}

/**
 * Last-resort obfuscation used when the user declines a passphrase.
 * Deliberately weak and honestly labelled in the UI: it prevents a casual
 * glance at IndexedDB, not a determined attacker.
 */
export async function obfuscateSecret(plaintext: string): Promise<VaultEnvelope> {
  const salt = globalThis.crypto?.getRandomValues
    ? globalThis.crypto.getRandomValues(new Uint8Array(SALT_BYTES))
    : new Uint8Array(SALT_BYTES).fill(7);
  const plainBytes = new TextEncoder().encode(plaintext);
  const cipher = new Uint8Array(plainBytes.length);
  for (let i = 0; i < plainBytes.length; i++) cipher[i] = plainBytes[i]! ^ salt[i % salt.length]!;
  return {
    v: 1,
    alg: 'XOR',
    kdf: 'NONE',
    iterations: 0,
    salt: toBase64(salt),
    iv: '',
    cipherText: toBase64(cipher),
    updatedAt: Date.now(),
  };
}