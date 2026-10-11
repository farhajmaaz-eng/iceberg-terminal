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
| Untrusted metadata is never executable | Token names and news are rendered as React text, never `dangerouslySetInnerHTML` |
| Provider payloads are validated | `src/lib/validate.ts` rejects junk into `null` rather than passing it through |
| Secrets excluded from exports | Exporter skips the secrets store; importer rejects bundles containing it |
| No telemetry | Iceberg Terminal ships none and sends nothing to any first-party endpoint |

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