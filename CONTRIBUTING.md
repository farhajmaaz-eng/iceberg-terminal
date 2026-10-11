# Contributing to Iceberg Terminal

Thanks for helping. This project has one rule that outranks convenience:

> **Never make the app show a number it cannot source.**

If a change makes it easier to fake data, guess at intent, or paper over a
provider failure, it will not be merged — no matter how good the feature looks.

---

## Getting set up

```bash
git clone https://github.com/<your-username>/iceberg-terminal.git
cd iceberg-terminal
npm install
npm run dev
```

Requires **Node.js ≥ 20.19**. No API keys are needed to run or develop the app.

```bash
cp .env.example .env.local   # optional — only non-secret defaults live here
```

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Type-check (`tsc -b`) then build to `dist/` |
| `npm run preview` | Serve the production build locally |
| `npm run lint` | ESLint (flat config, TypeScript rules) |
| `npm run typecheck` | `tsc -b` only |
| `npm test` | Vitest unit + component suite |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:e2e` | Playwright end-to-end suite (builds first) |
| `npm run check` | lint → typecheck → test → build |

**Run `npm run check` before opening a PR.** It is the same gate CI uses.

Playwright needs a one-time browser install:

```bash
npx playwright install chromium
```

---

## Project layout

```
src/
  components/   Design system, charts, tables, app shell
  data/         Query hooks, capability routing, demo-fallback policy
  features/     One folder per module (markets, screener, token, wallet, …)
  lib/          http, errors, redact, crypto, idb, format, demo, workspace
  providers/    Provider adapters + registry + normalized models
  store/        zustand stores (providers, vault, watchlists, wallets, alerts)
  types/        Canonical domain models
e2e/            Playwright specs
docs/           ARCHITECTURE.md, PROVIDERS.md
```

Read `docs/ARCHITECTURE.md` before a non-trivial change. It explains *why* the
layers are separated and which invariants must hold.

---

## Rules that are not negotiable

### 1. `null` means "not reported". Never coerce it to `0`.

```ts
// ✅
liquidityUsd: plausibleNonNegative(n(rec.liquidity));

// ❌
liquidityUsd: num(rec.liquidity) ?? 0;
```

`0` is a measurement. `null` is an absence of measurement. The UI renders `null`
as `—`; rendering it as `0` is a lie about the data.

### 2. Demo data must be labelled.

Any synthetic value carries `Provenance.origin === 'demo'` and is rendered with
`DemoBanner` / `ProvenanceBadge`. Never produce demo data outside
`src/lib/demo.ts`, and never use `withDemoFallback`'s demo branch when a live
call was actually attempted and failed.

### 3. Don't infer intent from on-chain data.

Label a transaction only when the parsed instruction encodes it. Do not add
`buy`, `sell`, `accumulation` or `liquidity-add` based on heuristics. See
`classifyTransaction()`.

### 4. Provider components never see provider payloads.

Components import models from `src/types/models.ts` and adapters from
`src/providers/`. A component that imports `mapMarket` or reaches into a raw
response shape will be rejected in review.

### 5. Secrets are memory-only.

Never write an API key to a persisted store, a log, an error message, a toast,
or an export. Credentials go through `useVaultStore.setKey()`, which writes
ciphertext to the secrets store only.

### 6. Untrusted text is text.

Token names, descriptions and news headlines are attacker-controlled. Render
them as React children. `dangerouslySetInnerHTML` is banned without a very good
reason and a sanitiser.

---

## Adding a provider

See `docs/PROVIDERS.md`. In short:

1. Implement one of the interfaces in `src/providers/types.ts`.
2. Normalize with `src/lib/validate.ts`.
3. Declare real `capabilities` — do not claim what the API does not publish.
4. Register it in `src/providers/index.ts`.

Settings, capability badges and attribution update automatically.

---

## Testing expectations

A PR is expected to include tests when it touches:

| Area | Required |
| --- | --- |
| Provider normalization | Yes — including malformed and partial payloads |
| Error handling | Yes — including the retryable/terminal split |
| Local persistence | Yes — round-trip plus import/export validation |
| Redaction | Yes — assert the secret is absent from output |
| New UI states | Yes — loading, empty, error, stale |
| Styling tweaks | No |

Prefer testing the negative cases. "This malformed payload yields `null`" and
"this error surfaces instead of being hidden" are the assertions that keep this
project honest.

---

## Commit messages

Short imperative subject, optional body explaining *why*.

```
fix(dexscreener): unwrap the { pairs } envelope in getTokenMarkets

The /latest/dex/tokens endpoint wraps results in an object, so every
market lookup silently returned an empty list and charts never resolved.
```

Types in use: `feat`, `fix`, `refactor`, `test`, `docs`, `perf`, `style`, `chore`.

---

## Reporting bugs

Open an issue with:

- what you did, what you expected, what happened
- browser + OS
- whether demo mode was on
- the exact provider configuration (never include your API key)

If it is a security issue, follow `SECURITY.md` instead.

---

## Code of conduct

Be direct, be technical, assume good faith, and critique the work rather than the
person. Disagreeing about a design decision is normal and welcome; being
unpleasant about it is not.

---

## License

Contributions are accepted under the [MIT License](LICENSE).