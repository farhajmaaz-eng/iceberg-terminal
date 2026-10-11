import { request } from '@/lib/http';
import { AppError } from '@/lib/errors';
import { asArray, asRecord, str, toEpochMs } from '@/lib/validate';
import type { NewsItem, Provenance } from '@/types/models';
import type { NewsProvider, ProviderId, RequestContext } from '../types';

/**
 * CryptoPanic — crypto news with a developer API (BYOK).
 *
 * Docs:  https://cryptopanic.com/developers/api/
 * Base:  https://cryptopanic.com/api/v1
 * Auth:  `auth_token` query parameter (this is the only form CryptoPanic
 *        accepts), so the token is never placed in a header we might log.
 * CORS:  browser-direct is supported for authenticated calls.
 *
 * When no news provider is configured the News module shows setup
 * instructions and an empty state. Headlines are NEVER fabricated.
 */

const BASE = 'https://cryptopanic.com/api/v1';
const SOURCE = 'CryptoPanic';

const CAPS = {
  publicAccess: false,
  requiresApiKey: true,
  browserDirect: true,
  spotPrice: false,
  candles: false,
  volume: false,
  liquidity: false,
  marketCap: false,
  holderCount: false,
  tokenSecurity: false,
  tokenSearch: false,
  newTokenDiscovery: false,
  walletBalances: false,
  walletTokenAccounts: false,
  transactionHistory: false,
  transactionStreaming: false,
  news: true,
} as const;

function prov(): Provenance {
  return { origin: 'live', source: SOURCE, sourceId: 'cryptopanic.posts', fetchedAt: Date.now(), stale: false };
}

function requireToken(ctx: RequestContext): string {
  const t = (ctx.apiKey ?? '').trim();
  if (!t) {
    throw new AppError('unauthorized', 'CryptoPanic requires an auth token. Add one in Settings › Providers.', {
      providerId: 'cryptopanic',
    });
  }
  return t;
}

/**
 * Strip the auth token from any URL before it could reach an error message.
 * The redaction layer also runs, but we never build a throwable that contains
 * the full request URL.
 */
function sanitize(raw: string): string {
  return raw.replace(/auth_token=[^&\s]+/g, 'auth_token=***');
}

export function mapPost(raw: unknown): NewsItem | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const title = str(rec.title);
  const url = str(rec.url);
  if (!title || !url) return null;

  const domain = url.match(/^https?:\/\/([^/]+)/)?.[1] ?? null;

  return {
    id: str(rec.id) ?? `${title}:${url}`,
    title,
    url,
    source: domain,
    publishedAt: toEpochMs(rec.published_at ?? rec.published_at_utc ?? rec.created_at),
    author: str(rec.author),
    tags: [
      ...(str(rec.currency) ? [str(rec.currency)!] : []),
      ...asArray(rec.categories)
        .map((c) => str(asRecord(c)?.name))
        .filter((c): c is string => Boolean(c)),
    ],
    summary: str(rec.description) ?? null,
    kind: (() => {
      const k = str(rec.kind);
      return k === 'news' || k === 'analysis' || k === 'discussion' ? k : null;
    })(),
    provenance: prov(),
  };
}

export const cryptoPanicProvider: NewsProvider = {
  id: 'cryptopanic' as ProviderId,
  label: SOURCE,
  category: 'news',
  docsUrl: 'https://cryptopanic.com/developers/api/',
  attribution: 'News via CryptoPanic',
  capabilities: CAPS,
  requiresKey: true,

  status(settings) {
    if (settings?.enabled === false) return { state: 'disabled', detail: 'Disabled in Settings › Providers.' };
    if (!settings?.apiKey) {
      return { state: 'unconfigured', detail: 'Add a CryptoPanic auth token to load headlines and research.' };
    }
    return { state: 'ready', detail: 'Auth token present. Stored locally (optionally encrypted).' };
  },

  async testConnection(ctx) {
    const started = Date.now();
    const token = (ctx.apiKey ?? '').trim();
    if (!token) {
      return {
        ok: false,
        latencyMs: null,
        detail: 'No auth token configured.',
        warnings: ['Get a token at https://cryptopanic.com/developers/api/'],
        checkedAt: Date.now(),
      };
    }
    try {
      await request<unknown>(`${BASE}/auth/?auth_token=${encodeURIComponent(token)}`, {
        providerId: 'cryptopanic',
        signal: ctx.signal,
        bucket: 'cryptopanic@20',
        timeoutMs: 12_000,
        attempts: 1,
        accept: 'application/json',
      });
      return {
        ok: true,
        latencyMs: Date.now() - started,
        detail: 'Authenticated. CryptoPanic accepted the token.',
        warnings: [],
        checkedAt: Date.now(),
      };
    } catch (e) {
      const err = e instanceof AppError ? e : new AppError('unknown', 'Connection test failed', { cause: e });
      return {
        ok: false,
        latencyMs: Date.now() - started,
        detail: sanitize(err.message),
        warnings: err.hint ? [err.hint] : [],
        checkedAt: Date.now(),
      };
    }
  },

  async getNews(ctx, opts) {
    const token = requireToken(ctx);
    const params = new URLSearchParams({
      auth_token: token,
      kind: 'news',
      public: 'true',
    });
    if (opts?.search) params.set('search', opts.search);
    if (opts?.limit) params.set('page_size', String(Math.min(opts.limit, 100)));
    if (opts?.currencies?.length) params.set('currencies', opts.currencies.join(','));

    let raw: unknown;
    try {
      raw = await request<unknown>(`${BASE}/posts/?${params.toString()}`, {
        providerId: 'cryptopanic',
        signal: ctx.signal,
        bucket: 'cryptopanic@20',
        timeoutMs: 12_000,
        attempts: 2,
        accept: 'application/json',
        dedupeKey: `cryptopanic:${opts?.search ?? ''}:${opts?.currencies?.join(',') ?? ''}:${opts?.limit ?? 50}`,
      });
    } catch (e) {
      throw new AppError(
        e instanceof AppError ? e.kind : 'unknown',
        sanitize(e instanceof Error ? e.message : 'CryptoPanic request failed'),
        { providerId: 'cryptopanic', status: e instanceof AppError ? e.status : null },
      );
    }

    const results = asArray(asRecord(raw)?.results);
    return results
      .map(mapPost)
      .filter((i): i is NewsItem => i !== null)
      .sort((a, b) => (b.publishedAt ?? 0) - (a.publishedAt ?? 0));
  },
};