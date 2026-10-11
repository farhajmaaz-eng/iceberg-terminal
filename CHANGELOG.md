# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Fixed

- **DexScreener logos.** `info.imageUrl` is returned as a plain string, but it
  was read with an array helper, so every token logo resolved to `null` and only
  generated identicons ever rendered. Image fields are now normalized across
  string/array shapes, fall back to `header`/`openGraph`, and are restricted to
  `http(s)` before reaching an `<img src>` (token metadata is
  attacker-controlled).
- **Transaction totals with an unknown component.** `txns24h` computed
  `(buys ?? 0) + (sells ?? 0)`, substituting zero for a missing side and
  under-reporting the total. A total is now reported only when every component
  of every contributing pool is known; otherwise it is `—`. Partial aggregates
  (liquidity, volume) keep their sum-of-reported-pools behaviour and are
  labelled as such.
- **PBKDF2 iteration counts are validated before decryption.** A stored
  envelope's `iterations` value flowed straight into `deriveKey`, so a tampered
  local record could hang the main thread (2³¹−1) or produce an opaque WebCrypto
  failure (`0`/`NaN`). Envelopes are now validated on read and before any key
  derivation: bounded iteration count, algorithm/KDF/version checks, and length
  checks on salt, IV and ciphertext before decoding.
- **Vault lock state.** Locking could be bypassed or undone: `setKey` silently
  set `unlocked: true`, so saving a credential reopened a locked vault;
  re-saving without a passphrase silently downgraded an encrypted record to
  weak obfuscation; `lock()` was a no-op for an obfuscation-only vault; and a
  storage read failure reported the vault as open. Locked vaults now block reads
  *and* writes, cannot be downgraded, always report locked, and fail closed on
  storage errors.
- **"Clear vault" left keys on disk.** It removed only the legacy blob, not the
  per-provider `secret:<id>` records, so it appeared to succeed while encrypted
  credentials remained and the vault came back locked.
- **Storage failures looked like empty data.** IndexedDB helpers swallowed
  errors and returned `undefined`/`[]`, making a blocked or quota-exceeded
  database indistinguishable from an empty watchlist — and letting an export
  quietly produce an empty file. Reads now throw `StorageError`; best-effort
  paths opt in explicitly; and a persistent banner reports the failure.
- **Workspace import was not atomic and did not round-trip.** Records were
  written one at a time (a mid-way failure left partial state) and the export
  format dropped IndexedDB keys, so an import restored nothing while reporting
  success. Import now writes every record in a single transaction, exports
  explicit `{ key, value }` pairs (still accepting the previous shape), and
  returns a report of what was written, skipped or ignored. Reset likewise
  reports exactly which stores were cleared.

## [0.1.0] — 2026-10-10

Initial public release.

### Added

#### Workstation shell

- Bloomberg-inspired dense dark UI: near-black surfaces, compact panels,
  monospaced tabular numerals, aligned numeric columns.
- Multi-panel desktop workstation (chart + trending pools + stat rail +
  watchlist), single-column mobile layout with dedicated bottom navigation and
  horizontally scrollable tables.
- Global keyboard shortcuts: `⌘K`/`Ctrl+K` command palette, `/` search, `?` help,
  arrow-key navigation, `Tab` completion, command history.
- Error boundary, loading/empty/error states and stale-data indicators on every
  data surface.

#### Modules

- **Markets** — SOL/USDC candlestick chart with volume histogram, seven
  timeframes, SOL price/volume/market cap/ATH tiles, trending pools table,
  watchlist rail, liquidity & flow summary with the arithmetic stated inline.
- **Screener** — searchable/sortable token screener with liquidity, volume,
  market cap, percentage-change and pool-age filters; coverage limitations stated
  in-app.
- **Token research** — price/volume chart, pool & DEX table, on-chain mint
  metadata, risk indicators, recent signatures, watchlist toggle, explorer links.
  The mint address is the canonical identifier.
- **Wallet intelligence** — SOL balance, SPL holdings, transaction history,
  mark-to-market portfolio estimate, local labels and notes, explorer links, and
  an explicit panel listing what the view does *not* show.
- **On-chain activity** — polled signature feed for watched wallets with type
  and address filters.
- **Liquidity & flows** — turnover ratios, volume distribution, new-pool
  discovery, DEX comparison and watched-token events. Observed facts are
  separated from computed ratios and the arithmetic is exposed in tooltips.
- **News** — CryptoPanic-backed feed with search and tag filtering; setup
  instructions and an empty state when unconfigured. Never fabricated.
- **Watchlists & alerts** — multiple local lists, public-wallet watchlist,
  price/percentage/volume alerts, configurable polling, optional browser
  notifications, in-app alert inbox.
- **Command interface** — `HELP`, `MARKETS`, `SOL`, `TOKEN <mint>`, `WALLET
  <address>`, `SCREENER`, `ACTIVITY`, `FLOWS`, `NEWS`, `WATCHLIST`, `SETTINGS`,
  `WATCH`, `TX <signature>`, `REFRESH`, `DEMO ON|OFF`. All perform real actions.

#### Provider architecture (BYOK)

- Capability-declared provider interfaces for market data, chain, analytics and
  news, plus a registry that drives Settings, capability badges and attribution
  automatically.
- **DexScreener** (keyless), **GeckoTerminal** (keyless), **CoinGecko** (keyless)
  — spot prices, OHLCV candles, discovery, search and whole-coin aggregates.
- **Solana JSON-RPC** — PublicNode (browser-safe default), Solana Foundation,
  Helius, Alchemy or a custom endpoint.
- **Birdeye** (BYOK) — token security, holder counts, token overview, trades.
- **CryptoPanic** (BYOK) — news with source, timestamp, tags and links.
- Capability routing so a provider without OHLCV never breaks charts.
- Per-provider enable/disable, API key entry, connection testing with latency,
  authentication and rate-limit error messages, and capability detection.

#### Data integrity

- `null` never renders as `0`; missing values display as `—`.
- Deterministic, clearly-labelled demo mode (banner + badge) used only when demo
  mode is on or a provider genuinely cannot serve the data. A provider failure
  with demo mode off surfaces a real error.
- Transaction classification limited to what parsed instructions encode; no
  inferred buy/sell/accumulation labels.
- Partial-failure handling: an unread token-account query reports "unavailable"
  instead of an empty portfolio.
- Runtime validation of all provider payloads; retries with jittered backoff,
  request timeouts, cancellation, deduplication, local rate limiting and
  `Retry-After` handling.
- Untrusted token metadata and headlines are never rendered as HTML.

#### Security & privacy

- Credentials held in memory for the session only; persisted exclusively as
  AES-GCM ciphertext (PBKDF2-SHA256, 210k iterations) with a user passphrase, or
  honestly-labelled weak obfuscation without one.
- Secret redaction layer applied to all logs, errors and messages.
- Workspace export/import uses a versioned JSON format that excludes secrets by
  construction and rejects hostile bundles.
- No telemetry. No server. No accounts. No seed phrase or private key input
  anywhere. Read-only: no wallet connection, signing or swaps.

#### Engineering

- React 18 + TypeScript (strict) + Vite 6, Tailwind CSS, shadcn/ui-style
  primitives, Lucide icons, Lightweight Charts, Zustand, TanStack Query,
  IndexedDB.
- 169 unit/component tests (Vitest + React Testing Library) covering provider
  normalization, missing data, error taxonomy, redaction, encryption, local
  persistence, command parsing and screener/flow calculations.
- 10 Playwright end-to-end tests against the production build.
- `npm run check` gate: lint → typecheck → tests → build.

[0.1.0]: https://github.com/farhajmaaz-eng/iceberg-terminal/releases/tag/v0.1.0