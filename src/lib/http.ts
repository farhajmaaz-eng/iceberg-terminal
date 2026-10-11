import { AppError, toAppError } from './errors';
import { redact } from './redact';

/**
 * Network primitives shared by every provider.
 *
 * Provides: hard timeouts, abort propagation, in-flight request
 * deduplication, bounded exponential backoff with jitter, and provider
 * rate-limit awareness (Retry-After + local token buckets).
 */

const DEFAULT_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 3;

interface RequestOptions {
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Retry attempts for transient failures (network/timeout/5xx/429). */
  attempts?: number;
  providerId?: string;
  /** Stable key used for in-flight deduplication. */
  dedupeKey?: string;
  /** Parse as JSON (default) or return raw Response (for tests). */
  expect?: 'json' | 'text' | 'response';
  /** Local rate-limit bucket name. */
  bucket?: string;
  accept?: string;
}

interface BucketState {
  tokens: number;
  updatedAt: number;
}

const buckets = new Map<string, BucketState>();
const inflight = new Map<string, Promise<unknown>>();

/** Local client-side throttle so we don't hammer providers with 429s. */
function consumeToken(bucket: string, cost = 1): void {
  const [name, perMinuteStr] = bucket.split('@');
  const perMinute = Number(perMinuteStr ?? '60');
  const capacity = Math.max(1, Math.ceil(perMinute / 4));
  const now = Date.now();
  const state = buckets.get(name) ?? { tokens: capacity, updatedAt: now };
  const refillPerMs = perMinute / 60_000;
  const elapsed = now - state.updatedAt;
  state.tokens = Math.min(capacity, state.tokens + elapsed * refillPerMs);
  state.updatedAt = now;
  if (state.tokens < cost) {
    const waitMs = Math.ceil((cost - state.tokens) / refillPerMs);
    throw new AppError('rate_limited', `Local rate limiter: waiting ${waitMs}ms before next ${name} request`, {
      retryAfterMs: waitMs,
    });
  }
  state.tokens -= cost;
  buckets.set(name, state);
}

export function resetHttpState(): void {
  buckets.clear();
  inflight.clear();
}

function parseRetryAfter(headers: Headers): number | null {
  const ra = headers.get('retry-after');
  if (!ra) return null;
  const secs = Number(ra);
  if (Number.isFinite(secs)) return Math.min(secs * 1000, 60_000);
  const date = Date.parse(ra);
  if (Number.isFinite(date)) return Math.min(Math.max(0, date - Date.now()), 60_000);
  return null;
}

function classify(status: number, providerId?: string, retryAfterMs: number | null = null): AppError {
  if (status === 401) {
    return new AppError('unauthorized', 'Provider rejected the API key (401).', {
      status,
      providerId,
      retryAfterMs,
    });
  }
  if (status === 403) {
    return new AppError('forbidden', 'API key is not allowed to access this resource (403).', {
      status,
      providerId,
      retryAfterMs,
    });
  }
  if (status === 404) {
    return new AppError('not_found', 'Resource not found (404).', { status, providerId });
  }
  if (status === 429) {
    return new AppError('rate_limited', 'Provider rate limit exceeded (429).', {
      status,
      providerId,
      retryAfterMs: retryAfterMs ?? 5_000,
    });
  }
  if (status >= 500) {
    return new AppError('server', `Provider server error (${status}).`, { status, providerId });
  }
  if (status >= 400) {
    return new AppError('bad_request', `Provider rejected the request (${status}).`, { status, providerId });
  }
  return new AppError('unknown', `Unexpected HTTP ${status}.`, { status, providerId });
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });

/** 1x, 2x, 4x backoff with full jitter, capped at 8s. */
export function backoffDelay(attempt: number): number {
  const base = Math.min(8_000, 400 * 2 ** attempt);
  return Math.round(base * (0.5 + Math.random() * 0.5));
}

async function rawFetch(url: string, options: RequestOptions): Promise<unknown> {
  const {
    method = 'GET',
    headers = {},
    body,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    signal,
    providerId,
    expect = 'json',
    accept,
  } = options;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException('Timeout', 'TimeoutError'));
  }, timeoutMs);
  const onOuterAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      clearTimeout(timer);
      throw new AppError('aborted', 'Request cancelled', { providerId });
    }
    signal.addEventListener('abort', onOuterAbort, { once: true });
  }

  try {
    const res = await fetch(url, {
      method,
      headers: {
        ...(accept ? { accept } : {}),
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
      // Never send cookies to third-party data providers.
      credentials: 'omit',
      mode: 'cors',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });

    if (expect === 'response') return res;

    if (!res.ok) {
      throw classify(res.status, providerId, parseRetryAfter(res.headers));
    }

    if (expect === 'text') return await res.text();

    const text = await res.text();
    if (!text.trim()) return null;
    try {
      return JSON.parse(text) as unknown;
    } catch (e) {
      // Never echo the body verbatim — it can contain echoes of credentials.
      throw new AppError('parse', 'Provider returned a non-JSON response.', {
        providerId,
        status: res.status,
        detail: redact(text.slice(0, 160)),
        cause: e,
      });
    }
  } catch (e) {
    if (controller.signal.aborted && !signal?.aborted) {
      throw new AppError('timeout', `Request exceeded ${timeoutMs}ms timeout.`, { providerId, cause: e });
    }
    throw toAppError(e, providerId);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onOuterAbort);
  }
}

/**
 * Fetch with retries + dedupe. Identical concurrent GET requests keyed by
 * `dedupeKey` share a single in-flight promise.
 */
export async function request<T = unknown>(
  url: string,
  options: RequestOptions = {},
): Promise<T> {
  const {
    attempts = MAX_ATTEMPTS,
    dedupeKey,
    bucket,
    signal,
  } = options;

  const key = dedupeKey ?? (options.method === 'POST' ? null : `${options.method}:${url}`);
  if (key && inflight.has(key)) {
    return inflight.get(key) as Promise<T>;
  }

  const run = async (): Promise<T> => {
    let lastError: AppError | null = null;
    for (let attempt = 0; attempt < Math.max(1, attempts); attempt++) {
      if (bucket) {
        try {
          consumeToken(bucket);
        } catch (e) {
          const err = toAppError(e, options.providerId);
          if (attempt === 0) throw err;
          lastError = err;
          await sleep(Math.min(err.retryAfterMs ?? 1_000, 5_000), signal);
          continue;
        }
      }
      try {
        return (await rawFetch(url, options)) as T;
      } catch (e) {
        const err = toAppError(e, options.providerId);
        if (err.kind === 'aborted') throw err;
        lastError = err;
        if (!err.isRetryable || attempt === Math.max(1, attempts) - 1) throw err;
        await sleep(err.retryAfterMs ?? backoffDelay(attempt), signal);
      }
    }
    throw lastError ?? new AppError('unknown', 'Request failed', { providerId: options.providerId });
  };

  if (!key) return run();
  const p = run().finally(() => {
    inflight.delete(key);
  });
  inflight.set(key, p);
  return p;
}

export const http = { request };