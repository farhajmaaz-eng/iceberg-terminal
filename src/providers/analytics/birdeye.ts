import { request } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { n, plausibleNonNegative, plausiblePrice, str } from '@/lib/validate';
import type { Provenance, TokenSecurity } from '@/types/models';
import type {
  AnalyticsProvider,
  ProviderId,
  ProviderSetting,
  RecentTrade,
  RequestContext,
  TokenOverviewResult,
} from '../types';

/**
 * Birdeye — premium Solana analytics (BYOK).
 *
 * Docs:  https://docs.birdeye.so/
 * Base:  https://public-api.birdeye.so
 * Auth:  `X-API-KEY` header. Free trial keys are available from Birdeye.
 * CORS:  browser-direct supported for the public API.
 *
 * Everything Birdeye reports is labelled as Birdeye-sourced. Iceberg never
 * substitutes its own guess for a missing Birdeye field.
 */

const BASE = 'https://public-api.birdeye.so';
const SOURCE = 'Birdeye';

const CAPS = {
  publicAccess: false,
  requiresApiKey: true,
  browserDirect: true,
  spotPrice: true,
  candles: true,
  volume: true,
  liquidity: true,
  marketCap: true,
  holderCount: true,
  tokenSecurity: true,
  tokenSearch: true,
  newTokenDiscovery: false,
  walletBalances: false,
  walletTokenAccounts: false,
  transactionHistory: false,
  transactionStreaming: false,
  news: false,
} as const;

function prov(sourceId: string): Provenance {
  return { origin: 'live', source: SOURCE, sourceId, fetchedAt: Date.now(), stale: false };
}

function requireKey(ctx: RequestContext): string {
  const key = (ctx.apiKey ?? '').trim();
  if (!key) {
    throw new AppError('unauthorized', 'Birdeye requires an API key. Add one in Settings › Providers.', {
      providerId: 'birdeye',
    });
  }
  return key;
}

async function get<T>(ctx: RequestContext, path: string): Promise<T> {
  return request<T>(`${BASE}${path}`, {
    providerId: 'birdeye',
    signal: ctx.signal,
    bucket: 'birdeye@60',
    // Never logged, never exported, never sent anywhere but Birdeye.
    headers: { 'X-API-KEY': requireKey(ctx), 'x-chain': 'solana' },
    timeoutMs: 12_000,
    attempts: 2,
    accept: 'application/json',
  });
}

export function mapTokenSecurity(raw: unknown): TokenSecurity {
  const data = (raw as { data?: unknown } | null)?.data ?? raw;
  const rec = (data ?? {}) as Record<string, unknown>;

  const signals: TokenSecurity['riskSignals'] = [];

  const overall = n(rec.overallScore);
  if (overall !== null) {
    signals.push({
      label: 'Birdeye overall score',
      value: `${overall}/100`,
      severity: overall < 40 ? 'risk' : overall < 70 ? 'warn' : 'info',
    });
  }
  if (typeof rec.ownerProgram === 'string' && rec.ownerProgram) {
    signals.push({ label: 'Owner program', value: rec.ownerProgram, severity: 'info' });
  }
  if (typeof rec.ownerAddress === 'string' && rec.ownerAddress) {
    signals.push({ label: 'Token owner', value: rec.ownerAddress, severity: 'info' });
  }
  if (typeof rec.transferFee === 'number' && rec.transferFee > 0) {
    signals.push({
      label: 'Transfer fee',
      value: `${rec.transferFee} bps`,
      severity: rec.transferFee > 100 ? 'risk' : 'warn',
    });
  }
  if (rec.isMintable === true) {
    signals.push({ label: 'Mint authority', value: 'Mint authority is active', severity: 'risk' });
  }
  if (rec.isFreezable === true) {
    signals.push({ label: 'Freeze authority', value: 'Freeze authority is active', severity: 'risk' });
  }
  if (rec.rugged === true) {
    signals.push({ label: 'Birdeye rug flag', value: 'Provider reports a rug event', severity: 'risk' });
  }

  const rawTop = Array.isArray(rec.topTokenHolders) ? (rec.topTokenHolders as unknown[]) : [];
  const totalSupply = n(rec.totalSupply);
  const topHolders = rawTop
    .map((h) => {
      const hr = (h ?? {}) as Record<string, unknown>;
      const address = str(hr.address);
      const amount = n(hr.amount);
      if (!address) return null;
      const pct =
        typeof hr.percentage === 'number'
          ? hr.percentage
          : totalSupply && amount !== null
            ? (amount / totalSupply) * 100
            : null;
      return { address, amount, pct };
    })
    .filter((x): x is { address: string; amount: number | null; pct: number | null } => x !== null);

  return {
    mintAuthority: typeof rec.isMintable === 'boolean' ? rec.isMintable : null,
    freezeAuthority: typeof rec.isFreezable === 'boolean' ? rec.isFreezable : null,
    decimals: n(rec.decimals),
    supply: totalSupply,
    topHolders: topHolders.length ? topHolders.slice(0, 10) : null,
    overallScore: overall,
    riskSignals: signals,
    provenance: prov('birdeye.token-security'),
  };
}

export const birdeyeProvider: AnalyticsProvider = {
  id: 'birdeye' as ProviderId,
  label: SOURCE,
  category: 'analytics',
  docsUrl: 'https://docs.birdeye.so/',
  attribution: 'Token security & holder data by Birdeye',
  capabilities: CAPS,
  requiresKey: true,

  status(settings?: ProviderSetting) {
    if (settings?.enabled === false) return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    if (!settings?.apiKey) {
      return { state: 'unconfigured', detail: 'Add a Birdeye API key to enable token security and holder data.' };
    }
    return { state: 'ready', detail: 'API key present. Key is stored locally (optionally encrypted).' };
  },

  async testConnection(ctx) {
    const started = Date.now();
    try {
      await get<unknown>(ctx, '/defi/token_security?address=So11111111111111111111111111111111111111112');
      return {
        ok: true,
        latencyMs: Date.now() - started,
        detail: 'Authenticated. Birdeye accepted the key.',
        warnings: [],
        checkedAt: Date.now(),
      };
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('unknown', 'Connection test failed', { cause: e });
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: err.message,
        warnings: err.hint ? [err.hint] : [],
        checkedAt: Date.now(),
      };
    }
  },

  async getTokenSecurity(ctx, mint) {
    const raw = await get<unknown>(ctx, `/defi/token_security?address=${encodeURIComponent(mint)}`);
    return mapTokenSecurity(raw);
  },

  async getHolderCount(ctx, mint) {
    const raw = await get<unknown>(ctx, `/defi/v3/token/holder-count?address=${encodeURIComponent(mint)}`);
    return n((raw as { holderCount?: unknown })?.holderCount);
  },

  async getTokenOverview(ctx, mint): Promise<TokenOverviewResult | null> {
    const raw = await get<{ data?: Record<string, unknown> } | null>(
      ctx,
      `/defi/token_overview?address=${encodeURIComponent(mint)}`,
    );
    const d = raw?.data;
    if (!d) return null;
    return {
      priceUsd: plausiblePrice(n(d.price)),
      marketCap: plausibleNonNegative(n(d.mc)),
      liquidityUsd: plausibleNonNegative(n(d.liquidity)),
      volume24h: plausibleNonNegative(n(d.volume24h)),
      holders: n(d.holder),
      provenance: prov('birdeye.token_overview'),
    };
  },

  async getRecentTrades(ctx, mint, limit = 20): Promise<RecentTrade[]> {
    const raw = await get<{ data?: { data?: unknown[] } | null } | null>(
      ctx,
      `/defi/latest_trades?address=${encodeURIComponent(mint)}&type=sell&limit=${Math.min(limit, 50)}`,
    );
    const rows = Array.isArray(raw?.data?.data) ? (raw.data.data as unknown[]) : [];
    return rows.map((row) => {
      const r = (row ?? {}) as Record<string, unknown>;
      const side = str(r.side);
      return {
        signature: str(r.txHash) ?? str(r.signature),
        blockTime: typeof r.timestamp === 'number' ? r.timestamp * 1000 : null,
        // Only "buy"/"sell" when Birdeye explicitly reports it.
        side: side === 'buy' || side === 'sell' ? side : null,
        priceUsd: plausiblePrice(n(r.price)),
        volumeUsd: plausibleNonNegative(n(r.volume ?? r.value)),
        makerAddress: str(r.ownerAddress ?? r.creator),
        provenance: prov('birdeye.latest_trades'),
      };
    });
  },
};