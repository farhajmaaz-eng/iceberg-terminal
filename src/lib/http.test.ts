import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { AppError, isAppError, rpcErrorMessage, toAppError } from '@/lib/errors';
import { redact, redactError } from '@/lib/redact';
import { backoffDelay, request, resetHttpState } from '@/lib/http';

/**
 * Error handling + secret-redaction tests.
 *
 * The redaction tests are a hard security guarantee: a credential must never
 * be able to reach a log line, a toast, or an error boundary.
 */

describe('error taxonomy', () => {
  it('classifies retryable vs terminal failures', () => {
    expect(new AppError('network', 'x').isRetryable).toBe(true);
    expect(new AppError('timeout', 'x').isRetryable).toBe(true);
    expect(new AppError('rate_limited', 'x').isRetryable).toBe(true);
    expect(new AppError('server', 'x', { status: 503 }).isRetryable).toBe(true);
    expect(new AppError('unauthorized', 'x').isRetryable).toBe(false);
    expect(new AppError('validation', 'x').isRetryable).toBe(false);
    expect(new AppError('server', 'x', { status: 500 }).isRetryable).toBe(true);
    expect(new AppError('not_found', 'x').isRetryable).toBe(false);
  });

  it('provides a remediation hint for actionable kinds', () => {
    expect(new AppError('unauthorized', 'x').hint).toMatch(/API key/i);
    expect(new AppError('rate_limited', 'x').hint).toMatch(/rate limit/i);
    expect(new AppError('unknown', 'x').hint).toBeNull();
  });

  it('preserves the retry-after hint', () => {
    expect(new AppError('rate_limited', 'x', { retryAfterMs: 4_000 }).retryAfterMs).toBe(4_000);
  });

  it('normalizes unknown throwables', () => {
    expect(isAppError(toAppError(new Error('boom')))).toBe(true);
    expect(toAppError('a string').message).toBe('a string');
    const abort = new DOMException('Aborted', 'AbortError');
    expect(toAppError(abort).kind).toBe('aborted');
  });

  it('extracts a JSON-RPC error message', () => {
    expect(rpcErrorMessage({ error: { code: -32602, message: 'Invalid param' } })).toBe('Invalid param');
    expect(rpcErrorMessage({ result: 1 })).toBeNull();
    expect(rpcErrorMessage(null)).toBeNull();
  });
});

describe('secret redaction', () => {
  it('redacts bearer tokens', () => {
    expect(redact('Authorization: Bearer sk-abcdef1234567890')).not.toContain('sk-abcdef1234567890');
  });

  it('redacts api key assignments in any casing', () => {
    expect(redact('api_key=ABCDEFGHIJKLMNOP')).toContain('[REDACTED]');
    expect(redact('X-API-Key: supersecretvalue')).toContain('[REDACTED]');
    expect(redact('auth_token: "tok_live_123456789"')).toContain('[REDACTED]');
    expect(redact('secret=qwertyuiop12345')).toContain('[REDACTED]');
  });

  it('redacts credentials carried in a query string', () => {
    const redacted = redact('GET https://api.example/x?api-key=TOPSECRET123&limit=5');
    expect(redacted).not.toContain('TOPSECRET123');
    expect(redacted).toContain('limit=5');
  });

  it('redacts long base58 key material', () => {
    const solanaKey = '5'.repeat(87);
    expect(redact(`raw=${solanaKey}`)).toContain('[REDACTED_KEY_MATERIAL]');
  });

  it('leaves ordinary messages intact', () => {
    expect(redact('Rate limit exceeded for api.dexscreener.com')).toBe('Rate limit exceeded for api.dexscreener.com');
    expect(redactError(new Error('plain failure'))).toBe('plain failure');
  });
});

describe('http layer', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetHttpState();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function jsonResponse(body: unknown, init: ResponseInit = {}) {
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
      ...init,
    });
  }

  it('returns parsed JSON on success', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({ ok: true })) as unknown as typeof fetch;
    await expect(request('https://api.test/x')).resolves.toEqual({ ok: true });
  });

  it('never sends cookies to third-party providers', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    await request('https://api.test/x');
    const init = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0]![1] as RequestInit;
    expect(init.credentials).toBe('omit');
    expect(init.mode).toBe('cors');
  });

  it('maps HTTP status codes onto the error taxonomy', async () => {
    const cases: [number, string][] = [
      [401, 'unauthorized'],
      [403, 'forbidden'],
      [404, 'not_found'],
      [429, 'rate_limited'],
      [500, 'server'],
      [400, 'bad_request'],
    ];
    for (const [status, kind] of cases) {
      globalThis.fetch = vi.fn(async () => new Response('', { status })) as unknown as typeof fetch;
      resetHttpState();
      await expect(
        request('https://api.test/x', { attempts: 1 }),
      ).rejects.toMatchObject({ kind });
    }
  });

  it('reads Retry-After for a 429', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('', { status: 429, headers: { 'retry-after': '2' } }),
    ) as unknown as typeof fetch;
    await expect(request('https://api.test/x', { attempts: 1 })).rejects.toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 2000,
    });
  });

  it('rejects a non-JSON body without echoing the payload', async () => {
    globalThis.fetch = vi.fn(
      async () => new Response('<html>error page for api_key=SHOULDNOTLEAK</html>', { status: 200 }),
    ) as unknown as typeof fetch;
    await expect(request('https://api.test/x', { attempts: 1 })).rejects.toMatchObject({ kind: 'parse' });
    try {
      await request('https://api.test/x', { attempts: 1 });
    } catch (e) {
      expect(JSON.stringify(e)).not.toContain('SHOULDNOTLEAK');
    }
  });

  it('retries a transient failure and then succeeds', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      if (calls < 3) return new Response('', { status: 503 });
      return jsonResponse({ recovered: true });
    }) as unknown as typeof fetch;
    await expect(request('https://api.test/x', { attempts: 3 })).resolves.toEqual({ recovered: true });
    expect(calls).toBe(3);
  });

  it('gives up after the attempt budget', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response('', { status: 503 });
    }) as unknown as typeof fetch;
    await expect(request('https://api.test/x', { attempts: 2 })).rejects.toBeInstanceOf(AppError);
    expect(calls).toBe(2);
  });

  it('does not retry a 401', async () => {
    let calls = 0;
    globalThis.fetch = vi.fn(async () => {
      calls++;
      return new Response('', { status: 401 });
    }) as unknown as typeof fetch;
    await expect(request('https://api.test/x', { attempts: 3 })).rejects.toMatchObject({ kind: 'unauthorized' });
    expect(calls).toBe(1);
  });

  it('deduplicates concurrent identical GET requests', async () => {
    let resolveFn: ((v: Response) => void) | null = null;
    globalThis.fetch = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          resolveFn = resolve;
        }),
    ) as unknown as typeof fetch;

    const a = request('https://api.test/dedupe');
    const b = request('https://api.test/dedupe');
    resolveFn!(jsonResponse({ shared: true }));
    await expect(Promise.all([a, b])).resolves.toEqual([{ shared: true }, { shared: true }]);
    expect((globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('propagates an external abort signal', async () => {
    const controller = new AbortController();
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;

    const p = request('https://api.test/slow', { signal: controller.signal, attempts: 1 });
    controller.abort();
    await expect(p).rejects.toMatchObject({ kind: 'aborted' });
  });

  it('enforces a timeout', async () => {
    globalThis.fetch = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
        }),
    ) as unknown as typeof fetch;
    await expect(request('https://api.test/timeout', { timeoutMs: 30, attempts: 1 })).rejects.toMatchObject({
      kind: 'timeout',
    });
  });

  it('throttles locally instead of hammering a rate-limited provider', async () => {
    globalThis.fetch = vi.fn(async () => jsonResponse({})) as unknown as typeof fetch;
    await request('https://api.test/rl', { bucket: 'test@1' });
    await expect(request('https://api.test/rl2', { bucket: 'test@1', attempts: 1 })).rejects.toMatchObject({
      kind: 'rate_limited',
    });
  });

  it('produces bounded, jittered backoff delays', () => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const d = backoffDelay(attempt);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(8_000);
    }
  });
});