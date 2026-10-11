# Providers

Iceberg Terminal ships with six integrations across four categories. Three work
with **zero configuration**; three are bring-your-own-key.

All endpoints, authentication methods and CORS behaviour below were verified
against live APIs during development. Where a provider is rate limited or
blocks browsers, that is called out plainly rather than papered over.

---

## Quick start

| You want | Configure |
| --- | --- |
| DEX market data, charts, screener, wallets | **Nothing.** Defaults work out of the box. |
| Token security signals + holder counts | Add a [Birdeye](https://birdeye.so) API key |
| Crypto news | Add a [CryptoPanic](https://cryptopanic.com/developers/api/) token |
| Reliable on-chain reads at volume | Add a [Helius](https://helius.dev) or [Alchemy](https://alchemy.com) RPC key |

Everything is entered in **Settings › Providers** and stored in your browser.

---

## Market data

### DexScreener — keyless, default

| | |
| --- | --- |
| Docs | https://docs.dexscreener.com/api/reference |
| Base | `https://api.dexscreener.com` |
| Auth | none |
| CORS | `Access-Control-Allow-Origin: *` |
| Limits | ~300 req/min; a 120/min client-side token bucket is applied |

**Provides:** spot prices per mint, per-pool liquidity/volume/txn counts, token
search, boosted and profiled token discovery, market cap / FDV.

**Does not provide:** OHLCV candles, holder counts, token-security signals.
Selecting it does **not** disable charts — the app routes candle requests to
GeckoTerminal (see *Capability routing* below).

> Endpoint note: `/latest/dex/tokens/{mint}` and `/latest/dex/search` wrap
> results in `{ schemaVersion, pairs: [...] }`. `/tokens/v1/{chain}/{addrs}`
> returns a bare array. Both shapes are handled; `pairs: null` yields `[]`.

### GeckoTerminal (CoinGecko onchain) — keyless

| | |
| --- | --- |
| Docs | https://www.geckoterminal.com/dex-api |
| Base | `https://api.geckoterminal.com/api/v2` |
| Auth | none (free tier) |
| CORS | `Access-Control-Allow-Origin: *` |
| Limits | free tier is tight (observed ~30 req/min, HTTP 429 beyond). A 24/min client bucket keeps us under it. |

**Provides:** OHLCV candles (`/pools/{pool}/ohlcv/{minute,hour,day}`), trending
pools, new pools, pool search, batched token metrics
(`/tokens/multi/{addresses}`).

**Does not provide:** whole-coin aggregates (market cap, ATH/ATL, circulating
supply). Those come from CoinGecko.

Candle point counts are capped at 1000 and mapped to lightweight-charts'
`UTCTimestamp` (seconds).

### CoinGecko — keyless (optional Pro key)

| | |
| --- | --- |
| Docs | https://docs.coingecko.com/reference/introduction |
| Base | `https://api.coingecko.com/api/v3` |
| Auth | optional `x-cg-pro-api-key` header; anonymous tier works |
| CORS | `Access-Control-Allow-Origin: *` |
| Limits | anonymous tier is the most restrictive (observed 429s). A 10/min client bucket is applied without a key, 30/min with one. |

**Provides:** SOL (and other whole-coin) price, 24h/7d change, aggregate volume,
market cap, FDV, circulating/total supply, ATH/ATL, rank, 7-day sparkline.

**Does not provide:** DEX pool data, candles.

---

## Chain

### Solana JSON-RPC — keyless by default

Five flavours, selectable in **Settings › Providers**:

| Flavour | Endpoint | Key | Browser-safe |
| --- | --- | --- | --- |
| `public` (**default**) | `https://solana-rpc.publicnode.com` | no | ✅ |
| `solana-foundation` | `https://api.mainnet-beta.solana.com` | no | ❌ **blocks browsers** |
| `helius` | `https://mainnet.helius-rpc.com/?api-key=…` | yes | ✅ |
| `alchemy` | `https://solana-mainnet.g.alchemy.com/v2/…` | yes | ✅ |
| `custom` | any HTTPS JSON-RPC URL | varies | varies |

> **Why not `api.mainnet-beta.solana.com` by default?** It answers browser
> requests with `403 {"code":403,"message":"Access for origin … is not allowed"}`,
> which makes every on-chain panel fail in a static browser deployment. PublicNode
> mirrors mainnet and sends `Access-Control-Allow-Origin: *`. The Foundation
> endpoint remains selectable, and the app detects the Origin rejection and
> returns an actionable message instead of a generic failure.

**Provides:** `getBalance`, `getTokenAccountsByOwner`, `getSignaturesForAddress`,
`getTransaction` (jsonParsed), `getAccountInfo` (mint authorities, decimals,
supply, program owner), `getHealth`.

**Known limitations:**

- Public endpoints routinely block `getTokenAccountsByOwner`. The wallet view
  handles this explicitly: it shows *"Token accounts unavailable"* rather than
  reporting an empty portfolio. Add a Helius or Alchemy key to read holdings.
- Public endpoints block non-finalized data; activity feeds are polled, not
  streamed. There is no WebSocket path in this version.
- Helius' enhanced transaction parsing is not required and not used.

---

## Analytics (BYOK)

### Birdeye

| | |
| --- | --- |
| Docs | https://docs.birdeye.so/ |
| Base | `https://public-api.birdeye.so` |
| Auth | `X-API-KEY` header (free trial keys available) |
| CORS | supported |

**Provides:** token security (owner program, mint/freeze/transfer-fee authority,
rug flags), an overall score, top holders, holder counts, token overview, recent
trades.

Everything Birdeye reports is rendered with a `Birdeye` provenance label. Where
Birdeye reports nothing, Iceberg shows `not available` — it does not substitute
a locally-computed safety score.

Without a key, the Risk Indicators panel shows the on-chain mint/freeze
authority facts (which come from the RPC and need no key) plus a pointer to
Settings.

---

## News (BYOK)

### CryptoPanic

| | |
| --- | --- |
| Docs | https://cryptopanic.com/developers/api/ |
| Base | `https://cryptopanic.com/api/v1` |
| Auth | `auth_token` query parameter (the only form the API accepts) |
| CORS | supported |

**Provides:** headlines with source, publication timestamp, author, tags,
description and a source link.

**Without a key the News module shows setup instructions and an empty state.**
There is no sample-news fallback: Iceberg does not fabricate headlines. Story
text is rendered as plain text from the JSON payload and is never injected as
HTML.

Because the token travels in the URL, `src/lib/redact.ts` strips `auth_token=…`
from every error path.

---

## Capability routing

Selecting a *market provider* does not mean every module uses it. The app asks
for a **capability** and resolves the first enabled provider that implements it:

| Capability | Resolution order |
| --- | --- |
| OHLCV candles | GeckoTerminal → CoinGecko → *(selected market provider)* |
| Whole-coin aggregates | CoinGecko → GeckoTerminal → … |
| Token markets / spot prices | Selected market provider (default DexScreener) |
| Discovery `trending` / `new` | GeckoTerminal → DexScreener |
| Discovery `boosted` / `profiled` | DexScreener → GeckoTerminal |

The Settings screen renders each provider's declared capabilities, so a disabled
or capability-poor provider visibly changes what appears.

---

## Rate limits and etiquette

- Every request passes through a client-side token bucket sized to the provider's
  published limit, so a burst from the UI cannot trigger a provider ban.
- Caching is conservative by default (15–90 s stale times) and every panel shows
  its last-update age.
- `429` is handled as a distinct error kind with a remediation hint; the UI does
  not retry blindly.
- Please respect each provider's terms. Free public tiers exist for casual use.

---

## Adding your own

You do not need to fork Iceberg to add a provider:

1. Implement `MarketDataProvider`, `ChainDataProvider`, `AnalyticsProvider` or
   `NewsProvider` from `src/providers/types.ts`.
2. Normalize your responses with the helpers in `src/lib/validate.ts`.
3. Append the instance to the array in `src/providers/index.ts`.

The Settings screen, capability badges, connection tester, attribution and Help
page pick it up automatically. See `docs/ARCHITECTURE.md` §3.2.