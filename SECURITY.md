# Security Policy

## Supported versions

Only the latest `main` branch is supported. This is a pre-1.0 project with no
release cadence; fixes land on `main`.

## Reporting a vulnerability

Please **do not open a public issue** for a security vulnerability.

Use GitHub's private reporting: **Security → Report a vulnerability** on the
repository, or email the maintainer listed in `package.json`.

Include:
- what an attacker can achieve
- reproduction steps
- affected version/commit
- whether any credential material is involved

You can expect an acknowledgement within 7 days. Fixes for confirmed issues are
released as fast as the severity warrants.

---

## Threat model

Iceberg Terminal is a **static, browser-only** application. There is no server,
no database and no account system. That shapes the entire risk profile:

- The attacker's likely goal is to obtain an API key the user pasted in, or to
  run arbitrary script in the app's origin.
- There is no server-side component to compromise.
- There is no authentication layer, because there are no accounts.

---

## Credential handling

### What the app does

1. **BYOK only.** Keys are entered in-app. No key is required to use the app.
2. **Memory only for the session.** Decrypted keys live in a zustand store for
   the lifetime of the tab. They are never in `localStorage`.
3. **Encrypted at rest (optional).** With a passphrase, each key is sealed with
   AES-GCM using a PBKDF2-SHA256-derived key (210 000 iterations, random 16-byte
   salt, random 12-byte IV). Without a passphrase, keys are stored with
   deliberately weak XOR obfuscation and the UI labels them *"obfuscated"*,
   not *"encrypted"*.
4. **Excluded from exports.** The workspace exporter skips the secrets store
   entirely, and the importer hard-rejects any bundle containing one.
5. **Never logged.** `src/lib/redact.ts` scrubs Bearer tokens, `api_key=`-style
   pairs, query-string credentials and long base58 key material from anything
   reaching a log, a toast or an error boundary. Non-JSON error bodies are
   redacted before being attached to an error.
6. **No cookies.** Every third-party request uses `credentials: 'omit'`.
7. **Never proxied.** Keys go only to the provider they belong to, over HTTPS.

### What the app cannot do

Read this part carefully — these are properties of the platform, not bugs:

- **Browser storage is not a vault.** A passphrase protects a stored key against
  someone who only reads the IndexedDB file. It does **not** protect the key
  while the application is running.
- **Client-side encryption is defence-in-depth, not secrecy.** Anything executing
  JavaScript in the page origin — a malicious browser extension, an injected
  script, a supply-chain compromise in a dependency — can read the decrypted key
  from memory while a request is in flight.
- **Browser storage is not secure against a compromised device.** A machine that
  is already compromised can read the plaintext before it is encrypted.
- **Vite environment variables are public.** Anything prefixed `VITE_` is
  inlined into the JavaScript bundle at build time. `.env.example` therefore
  contains only non-secret defaults (endpoint URLs, feature flags). No secret
  belongs in a `VITE_*` variable, ever.
- **A passphrase cannot be recovered.** There is no reset. Losing it means
  removing and re-entering the key.

### Tampered local records

The vault lives in IndexedDB, which any script in the origin (or an
already-compromised machine) can rewrite. Envelopes are therefore validated
**before** any key derivation runs:

- `iterations` must be an integer within a bounded range. Left unchecked, a
  hostile value of 2³¹−1 hangs the main thread — a denial-of-service primitive —
  and `0`/`NaN` makes WebCrypto fail opaquely.
- Version, algorithm and KDF tags must match, and an obfuscation record must
  declare `kdf: "NONE"` with `iterations: 0` so it cannot be routed through an
  unbounded derivation.
- `salt`, `iv` and `cipherText` are length-checked before decoding, so a
  malformed record is rejected instead of allocating on the way to failing.
- A wrong passphrase and a tampered record both surface as a clear message
  rather than an opaque crypto error.

### Locking the vault

`unlocked` describes the **vault**, not any individual credential. Locking drops
all key material from memory and:

- blocks reads (`getKey`/`hasKey` return nothing)
- blocks writes (storing a key while locked is refused)
- cannot be bypassed by saving another credential
- cannot be silently undone by re-saving a key without a passphrase, which
  would otherwise downgrade an encrypted record to weak obfuscation
- fails **closed**: if the vault cannot be read, it is reported as locked
  rather than open

"Clear vault" removes the per-provider `secret:<id>` records as well as the
legacy blob, so it cannot appear to succeed while keys remain on disk.

### Practical guidance

- Use **provider-scoped keys** with spending limits where the provider offers
  them.
- Prefer providers that support key rotation; rotate if a device is compromised.
- Use a dedicated browser profile if you are serious about isolation.
- Set a passphrase for the vault. Obfuscated storage stops a casual glance at
  IndexedDB, nothing more.

---

## Application-level guarantees

These are enforced in code and covered by tests, not aspirations:

| Guarantee | Where |
| --- | --- |
| Never asks for a seed phrase or private key | There is no input for one anywhere in the codebase |
| Read-only | No wallet connection, signing, swap or transaction submission |
| No fabricated data | Missing values are `null` → `—`, never `0`; no synthetic headlines; no invented holder counts |
| Demo data is labelled | `Provenance.origin === 'demo'` renders an unmissable banner and badge |
| Untrusted metadata is never executable | Token names and news are rendered as React text; remote image URLs are restricted to http(s) |
| Provider payloads are validated | `src/lib/validate.ts` rejects junk into `null` rather than passing it through |
| Secrets excluded from exports | Exporter skips the secrets store; importer rejects bundles containing it |
| Local records are validated | Vault envelopes are bounds-checked before any key derivation |
| Locking cannot be bypassed | Locked vault blocks reads, blocks writes, and cannot be downgraded |
| Storage failure ≠ empty data | Reads throw `StorageError`; the app surfaces a banner instead of showing an empty list |
| Import is atomic | All records written in one transaction; failure rolls everything back and is reported |
| Import is validated per store | Records must match their store's real key and persisted-state shape, or they are rejected unread |
| One passphrase per vault | Adding a credential cannot seal it with a passphrase that differs from the existing vault |
| No telemetry | Iceberg Terminal ships none and sends nothing to any first-party endpoint |

---

## Deployment security headers

Browser-only apps are often served with no header control at all, so protections
are provided in two places. Both ship in the repo.

### 1. `index.html` — works on any static host

A `<meta http-equiv="Content-Security-Policy">` and a `Permissions-Policy` are
embedded in the document, so they apply even on GitHub Pages, which offers no
header configuration:

- `script-src 'self'` — no inline script, no `eval`. Injected markup cannot execute.
- `object-src 'none'`, `frame-src 'none'` — no plugins, no nested browsing contexts.
- `base-uri 'none'`, `form-action 'none'` — blocks `<base>` hijacking and form exfiltration.
- `img-src https: data:` — provider logo URLs are attacker-controlled, so only http(s) images load.
- `connect-src https: wss:` — requests may only leave over TLS.
- `Permissions-Policy` denies camera, microphone, geolocation, payment, USB and friends; this app needs no device access.

`frame-ancestors` is deliberately **absent** from the meta policy. It is ignored
when a policy is delivered via `<meta>`, so listing it would advertise
clickjacking protection that is not actually active.

### 2. `public/_headers` — honoured by Netlify / Cloudflare Pages

Carries the same CSP **plus** the directives that only work as real headers:

- `frame-ancestors 'none'` and `X-Frame-Options: DENY` — genuine clickjacking protection.
- `X-Content-Type-Options: nosniff`, `Strict-Transport-Security`, `Referrer-Policy: no-referrer`.

GitHub Pages ignores this file. Operators deploying elsewhere should mirror these
headers in whatever their host provides.

### Tightening `connect-src`

The shipped `connect-src` permits any HTTPS origin because Iceberg is BYOK: a
user may configure an arbitrary Solana RPC endpoint, and a narrower default would
break that. An operator who only wants the built-in providers should replace it
with an explicit host list, e.g.:

```
connect-src 'self' https://api.dexscreener.com https://api.geckoterminal.com https://api.coingecko.com https://solana-rpc.publicnode.com;
```

Note that narrowing `connect-src` does not stop a script that is already running;
its value is defence-in-depth alongside `script-src 'self'`.

---

## Dependencies

Dependencies are pinned by lockfile. Notable ones and why they are trusted:

| Package | Why |
| --- | --- |
| `lightweight-charts` | TradingView's Apache-2.0 charting library |
| `@tanstack/react-query` | Widely used, actively maintained |
| `zustand` | Tiny, minimal surface |
| Radix UI primitives | shadcn/ui-compatible, MIT |
| `lucide-react` | Icons only, ISC |

Run `npm audit` before deploying. Report anything that looks exploitable in the
app's runtime path rather than in a build-only tool.

---

## Out of scope

- Vulnerabilities in third-party data providers (report them to the provider)
- Physical access to an unlocked, already-compromised device
- Social engineering
- Users who deliberately paste keys into other tools

---

## Responsible use

Iceberg Terminal displays market data and on-chain facts. It makes **no
predictions** and no alert should be read as a forecast. It is research
software, not investment advice. Nothing in this repository should be used as
the basis for a trading decision without independent verification against the
chain and the underlying providers.