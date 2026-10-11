# Architecture

This document describes how Iceberg Terminal is put together and, more
importantly, **why** it is put together that way. The dominant constraint is
not rendering performance — it is *data integrity in a product whose entire
value is the numbers it shows*.

---

## 1. Design goals

| Goal | Consequence in the codebase |
| --- | --- |
| Never show a number we cannot source | Every metric is `number \| null`; `null` renders as `—` and never as `0`. |
| Never present demo data as live | Every model carries `Provenance`; `DemoBanner` / `ProvenanceBadge` render from it. |
| No mandatory backend | The app is a static bundle. Credentials live in the user's browser. |
| Provider-agnostic | Components consume normalized models, never provider payloads. |
| Read-only | There is no signing path, no wallet connection, no swap. |
| Local-first | Watchlists, notes, alerts and preferences persist to IndexedDB. |

---

## 2. Layers

```
┌──────────────────────────────────────────────────────────────┐
│ features/*        Pages: Markets, Screener, Token, Wallet,   │
│                   Activity, Flows, News, Watchlist, Settings │
├──────────────────────────────────────────────────────────────┤
│ components/*      Design system, charts, tables, layout      │
├──────────────────────────────────────────────────────────────┤
│ data/*            Query hooks + capability routing + fallback │
├──────────────────────────────────────────────────────────────┤
│ providers/*       Adapters + registry + normalized models    │
├──────────────────────────────────────────────────────────────┤
│ lib/*             http, errors, redact, crypto, idb, format  │
├──────────────────────────────────────────────────────────────┤
│ store/*           zustand (providers, vault, watchlists,     │
│                   wallets, alerts)                           │
└──────────────────────────────────────────────────────────────┘
```

Data flows strictly downward. A page never imports a provider implementation.

---

## 3. The provider abstraction

### 3.1 Interfaces

`src/providers/types.ts` declares four capability-shaped interfaces:

- `MarketDataProvider` — spot prices, candles, asset aggregates, search, discovery
- `ChainDataProvider` — balances, token accounts, signatures, transactions, mint accounts
- `AnalyticsProvider` — token security, holder counts, recent trades
- `NewsProvider` — headlines

Every provider also declares:

- `capabilities: ProviderCapabilities` — what it actually publishes
- `status(settings)` — `ready` / `unconfigured` / `disabled` / `error` plus a human explanation
- `testConnection(ctx)` — a real round trip with latency and warnings
- `docsUrl`, `attribution`, `requiresKey`

### 3.2 Adding a provider

1. Implement one of the interfaces in `src/providers/<category>/<name>.ts`.
2. Append it to the relevant array in `src/providers/index.ts`.

That is the entire change. The Settings screen, capability badges, data-source
attribution and the Help page all iterate the registry, so they update with no
UI edits.

### 3.3 Normalization

Provider payloads are **untrusted input**. Every adapter runs its response
through `src/lib/validate.ts`:

- `asRecord` / `asArray` / `str` / `n` / `bool` coerce and return `null` on junk
- `numMap` / `window2` handle provider window shapes and return `null` if nothing is present
- `plausiblePrice` / `plausibleNonNegative` reject negatives and non-finite values
- `toEpochMs` handles seconds, milliseconds and ISO strings

A malformed field therefore becomes `null` — "not reported" — rather than `0`
("measured as zero") or an exception.

Two field-shape rules learned the hard way:

- **Don't assume a container type.** DexScreener returns `info.imageUrl` as a
  plain string; reading it with `asArray()` (which returns `[]` for a string)
  silently made every logo `null`, so only generated identicons ever rendered.
  Image fields are now normalized across string/array shapes and restricted to
  `http(s)` before reaching an `<img src>`, since token metadata is
  attacker-controlled.
- **A total is only a total when every component is known.** Transaction counts
  combine *buys* and *sells*, so `(buys ?? 0) + (sells ?? 0)` would report a
  confident number from a half-reported pool. `totalTxns()` returns `null`
  instead. By contrast, `sumReported()` (liquidity, volume) deliberately sums
  whatever pools reported — that is a *partial aggregate*, and the UI labels
  those columns as provider-reported aggregates rather than complete totals.

### 3.4 Capability routing

Capabilities are not evenly distributed. DexScreener has the best pool coverage
but no OHLCV; GeckoTerminal publishes candles but not whole-coin aggregates;
CoinGecko has the aggregates only.

`resolveByCapability(capability, preferredOrder)` in `src/data/context.ts`
selects the first **enabled** provider that actually implements the requested
method. This is why selecting DexScreener as the market provider does not break
the candlestick chart.

Discovery segments are routed by an explicit map (`SEGMENT_PROVIDERS`) because
`boosted`/`profiled` (DexScreener) and `trending`/`new` (GeckoTerminal) are
different datasets, not interchangeable views of one.

---

## 4. Query layer and the fallback policy

`src/data/queries.ts` exposes TanStack Query hooks. Every hook:

1. Resolves the active provider(s) and a `RequestContext` (options + in-memory key + `AbortSignal`).
2. Applies a conservative `staleTime` / `refetchInterval` sized to that provider's rate limits.
3. Delegates the demo/live decision to `withDemoFallback`.

### 4.1 `withDemoFallback`

| Situation | Behaviour |
| --- | --- |
| Demo mode forced | Return deterministic synthetic data, `fallback: 'forced-demo'` |
| Provider disabled | Return demo data, `fallback: 'provider-disabled'` |
| Keyed provider with no key | Return demo data, `fallback: 'provider-unconfigured'` |
| Provider lacks the capability | Return demo data (`forced-demo`) or throw `ProviderUnavailableError` |
| Live call fails, demo off | **Propagate the real error.** Never silently substitute. |

That last row is the important one. A provider outage must not be papered over
with synthetic prices.

### 4.2 Demo data

`src/lib/demo.ts` generates deterministic samples seeded by stable strings, so
they are identical across reloads. `demoNews()` deliberately returns `[]` — there
is no fabricated-headline fallback, ever.

---

## 5. Reliability layer (`src/lib/http.ts`)

Shared by every provider:

- **Timeouts** — hard abort via `AbortController` (default 12 s, RPC 15 s)
- **Cancellation** — the React Query `signal` is threaded through
- **Deduplication** — concurrent identical GETs share one in-flight promise
- **Retries** — bounded exponential backoff with full jitter, capped at 8 s
- **Rate limiting** — `Retry-After` parsing plus a local token bucket per provider
- **No cookies** — `credentials: 'omit'` on every third-party request

### 5.1 Error taxonomy

`src/lib/errors.ts` maps failures to a fixed vocabulary
(`network`, `timeout`, `aborted`, `rate_limited`, `unauthorized`, `forbidden`,
`not_found`, `bad_request`, `server`, `parse`, `validation`, `unsupported`).
Each carries `isRetryable` and a user-facing `hint`. The UI shows the real
message plus the hint and an explicit retry action.

### 5.2 Redaction

`src/lib/redact.ts` scrubs Bearer tokens, `api_key=`-style pairs, query-string
credentials and long base58 key material from anything that reaches a log, an
error message or the UI. Non-JSON response bodies are truncated *and* redacted
before being attached to an error.

---

## 6. State

| Store | Contents | Persistence |
| --- | --- | --- |
| `useProviderStore` | Selected providers, enable flags, options, UI prefs, alert prefs | IndexedDB (no secrets) |
| `useVaultStore` | Decrypted API keys | Memory only; ciphertext in IndexedDB |
| `useWatchlistStore` | Multiple token lists | IndexedDB |
| `useWalletStore` | Public wallet watchlist, labels, notes | IndexedDB |
| `useAlertStore` | Alert rules + firing history | IndexedDB |

Two rules are enforced structurally rather than by convention:

- **No secrets in the persisted provider store.** `partialize` whitelists keys,
  and the vault lives in a separate store with its own encryption envelope.
- **No array-returning zustand selectors.** A selector that builds a new array on
  every call makes `useSyncExternalStore` loop forever; derived data is computed
  with `useMemo` from a stable reference.

### 6.1 Vault

One AES-GCM envelope **per provider**, keyed in IndexedDB as `secret:<id>`.
Per-provider envelopes mean adding or removing one credential never requires
re-encrypting (and therefore re-prompting for the passphrase on) the others.

- Passphrase set → PBKDF2-SHA256, 210 000 iterations, random salt + IV
- No passphrase → single-byte-XOR obfuscation, and the UI labels it
  *"obfuscated"*, not *"encrypted"*

Envelopes are **validated on read and before any key derivation**
(`validateEnvelope`). The record lives in IndexedDB, which any script in the
origin can rewrite, and `iterations` used to flow straight into `deriveKey`:

- an absurd count (2³¹−1) hangs the main thread — a denial-of-service primitive
- `0`/`NaN`/negative makes WebCrypto fail with an opaque error
- malformed or oversized base64 allocates before it can be rejected

Validation bounds the iteration count, checks the algorithm/KDF/version tags,
and length-checks salt, IV and ciphertext *before* decoding. Obfuscation records
must declare `kdf: "NONE"` and `iterations: 0`, so a corrupt record cannot route
a "decrypt" through an unbounded derivation.

#### Lock-state invariants

`unlocked` is a property of the **vault**, not of any single credential, and
that distinction is where the bugs lived:

1. `setKey` must not flip `unlocked` to `true` as a side effect of storing a key
   — otherwise saving a credential quietly reopens a vault the user locked.
2. While locked, `getKey`/`hasKey` return nothing **and** `setKey` refuses, so
   "lock" is never cosmetic.
3. Storing a key for a provider that already has a passphrase-encrypted record
   must not silently downgrade it to weak obfuscation; the passphrase is
   required instead.
4. Any storage failure is **fail-closed**: if the vault cannot be read we cannot
   know what is in it, so it is reported as locked rather than open.
5. `lock()` always locks, including for an obfuscation-only vault (there is no
   passphrase to re-open with, but the state must not claim to be open).
6. `clearVault()` removes the `secret:<id>` records too, not just the legacy
   blob — otherwise "Clear vault" appeared to succeed while the encrypted keys
   remained on disk.

---

## 7. Classification policy (on-chain)

`classifyTransaction()` in `src/providers/chain/solanaRpc.ts` labels a record
only when the parsed instruction genuinely encodes it:

`transfer` · `swap` · `mint` · `burn` · `close-account` · `unknown`

It never emits `buy`, `sell`, `accumulation`, `liquidity-add` or
`liquidity-remove`. Proving those requires pre/post balances across both legs of
a route, which aggregators routinely make ambiguous. A guess would be a
statement about intent that the data cannot support.

Token legs come from `preTokenBalances` → `postTokenBalances` deltas. Where the
node omits decimals metadata the UI says so instead of assuming 6 or 9.

---

## 8. Partial-failure handling

Wallet snapshots fetch balance and token accounts with `Promise.allSettled`.
Public RPC endpoints routinely block `getTokenAccountsByOwner` while answering
`getBalance`. Collapsing those into one promise would either lose a working
balance or — worse — render an empty holding list, an affirmative false claim
about the wallet. The snapshot therefore carries:

- `holdingsAvailable: boolean`
- `holdingsError: string | null`

and the UI shows *"Token accounts unavailable"* instead of *"0 balances"*.

The same principle applies to every panel: a failed sub-request degrades that
panel and says so, rather than silently blanking a metric.

### 8.1 Storage failure is not empty data

A browser can refuse IndexedDB outright (private mode, blocked storage,
partitioning). The read/write helpers therefore **throw** a `StorageError`
rather than returning `undefined`/`[]`, because a swallowed failure is
indistinguishable from "you have no watchlist" — the user would think their data
was deleted, and an export would quietly produce an empty file.

Two kinds of unavailability remain, and the difference matters:

- A **corrupt record** genuinely has no value → `null` is correct.
- A **storage failure** means the question could not be asked → it is recorded in
  `storage-health` and rendered as a persistent banner. The zustand adapter
  still degrades (so the app boots) but records the failure, and save failures
  re-throw so they are never reported as saved.

Only paths that genuinely want best-effort behaviour use the explicit
`bestEffortIdb*` helpers.

### 8.2 Workspace import is atomic

Import collects every record first, then writes them all inside a **single
IndexedDB transaction** (`idbWriteAtomic`). IndexedDB transactions are atomic,
so a failure part-way through rolls everything back: there is no
half-restored watchlist paired with a full wallet.

The export format stores explicit `{ key, value }` pairs. `getAll()` returns
values only and discards keys, which made an export impossible to import — a
"successful" export that restored nothing. `applyBundle` accepts both the
current shape and the earlier `{ state: { name, value } }` shape, and reports
exactly what landed:

```ts
{ written: { watchlists: 12, wallets: 3 }, total: 15, skipped: 0, unknownStores: [] }
```

Entries that cannot yield a key are counted as `skipped` rather than dropped,
and unknown stores are named, so a partial restore is always explained.

---

## 9. Rendering and responsive design

- **Desktop (≥1280px)** — two-column workstation: chart + overview + trending
  table on the left, watchlist and liquidity rail on the right. Each column
  fills the viewport height and its panels scroll independently.
- **Tablet/mobile** — a single scrolling column, with a bottom nav, horizontally
  scrollable tables, and fixed-height charts that fill their panel via
  `ResizeObserver`.

Charts measure their container instead of hard-coding pixel heights, so the same
component is correct at any breakpoint.

### 9.1 Grid rows must be content-sized below `xl`

The desktop/mobile layouts share one grid and differ only by `align-content`.
On desktop rows must `stretch` so each column fills the viewport; on mobile they
must `start` so each row is exactly as tall as its content.

This is not cosmetic. With a definite height and the default `align-content:
stretch`, the browser distributes free space evenly between rows. A column
containing a chart, a stat strip and a table is far taller than half the
viewport, so it overflows its row and the panels visually overlap the column
below. The fix is `[align-content:start]` below `xl` and
`xl:[align-content:stretch]`, plus `shrink-0` on the column wrappers so they
cannot be compressed below their content.

Tailwind 3 has no `content-start`/`content-stretch` utilities, hence the
arbitrary-value syntax.

### 9.2 Visual system

Constraints that keep the interface reading as an instrument rather than a
dashboard:

- **Cyan is reserved** for interactive and active state — focus rings, active
  nav, links, sortable columns. It is never decoration, so a cyan pixel always
  means "you can act here" or "you are here".
- **Provenance is asymmetric.** Synthetic data is loud (banner + badge): it is a
  safety claim and must be unmissable. A live provider's name is quiet
  (`tone="source"`): it is metadata, repeated across a view, and would otherwise
  out-shout the values it describes.
- **Depth comes from surface value, not shadow.** `surface-0…4` are tuned so a
  panel, its header and a hovered row are visibly different. The single
  `shadow-overlay` is reserved for genuine overlays.
- **Freshness is quiet until it matters.** `UpdatedAt` is near-invisible while
  data is current and switches to amber only when stale, so a strip of four
  tiles does not print "updated 4s ago" four times.
- **Numbers are tabular everywhere**, with a true zero (`cv05`), because a price
  column that shifts width as digits change is unreadable.
- **Missing values recede.** A `—` change is rendered dimmed and unbolded so it
  cannot be misread as "flat".

---

## 10. Testing strategy

| Layer | Tool | What it locks in |
| --- | --- | --- |
| Unit | Vitest | Normalization, missing data, error taxonomy, redaction, crypto, persistence, command parsing, filters |
| Component | Vitest + RTL | Provenance badges, demo banner, error states, sparkline fallbacks |
| Regression | Vitest | Image-field shape, transaction totals, envelope validation, vault lock transitions, storage failures, import atomicity |
| End-to-end | Playwright | Shell render, navigation, palette → command execution, watchlist mutation, demo-mode labelling, logo loading, vault lock enforcement |

The unit suite asserts the *negative* cases aggressively — that a missing value
stays `null`, that demo data is labelled, that a provider error surfaces rather
than being hidden — because those are the failures that make a tool like this
misleading rather than merely broken.

---

## 11. Non-goals

These are deliberately unimplemented, not "coming soon":

- Wallet connection, signing, swaps, transactions
- Seed phrase or private key input (there is no field for one anywhere)
- Server-side alert evaluation or push notifications
- PnL, cost basis, historical balances
- Any composite token "safety score" Iceberg computes itself