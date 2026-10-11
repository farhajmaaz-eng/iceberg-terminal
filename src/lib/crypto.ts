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

/** True when the envelope is genuinely encrypted with a passphrase. */
export function isEncrypted(envelope: VaultEnvelope): boolean {
  return envelope.alg === 'AES-GCM' && envelope.kdf === 'PBKDF2-SHA256' && envelope.iterations > 1;
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

export async function decryptSecret(envelope: VaultEnvelope, passphrase: string): Promise<string> {
  if (!cryptoAvailable()) throw new Error('WebCrypto unavailable — cannot decrypt credentials.');
  if (envelope.v !== 1 || envelope.alg !== 'AES-GCM' || envelope.kdf !== 'PBKDF2-SHA256') {
    throw new Error('Unsupported vault format.');
  }
  const salt = fromBase64(envelope.salt);
  const iv = fromBase64(envelope.iv);
  const key = await deriveKey(passphrase, salt, envelope.iterations);
  const plain = await globalThis.crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    fromBase64(envelope.cipherText),
  );
  return new TextDecoder().decode(plain);
}

export async function saveVault(envelope: VaultEnvelope): Promise<void> {
  await idbSet(STORES.secrets, 'provider-credentials', envelope);
}

export async function loadVault(): Promise<VaultEnvelope | undefined> {
  const v = await idbGet<VaultEnvelope>(STORES.secrets, 'provider-credentials');
  return v?.v === 1 ? v : undefined;
}

export async function clearVault(): Promise<void> {
  await idbDelete(STORES.secrets, 'provider-credentials');
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
  return v?.v === 1 ? v : undefined;
}

export async function deleteSecret(providerId: string): Promise<void> {
  await idbDelete(STORES.secrets, envelopeKey(providerId));
}

export async function listSecretProviderIds(): Promise<string[]> {
  const keys = await idbKeys(STORES.secrets);
  return keys.filter((k) => k.startsWith('secret:')).map((k) => k.slice('secret:'.length));
}

/** Reverse of `obfuscateSecret` for envelopes written without a passphrase. */
export function deobfuscate(envelope: VaultEnvelope): string {
  const atobDecode = (b64: string): Uint8Array => {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  };
  const salt = atobDecode(envelope.salt);
  const cipher = atobDecode(envelope.cipherText);
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