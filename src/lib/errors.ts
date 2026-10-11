/**
 * Error taxonomy. Messages are user-safe: they never embed API keys,
 * Authorization headers or full request URLs that carry credentials.
 */

export type AppErrorKind =
  | 'network'
  | 'timeout'
  | 'aborted'
  | 'rate_limited'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'bad_request'
  | 'server'
  | 'parse'
  | 'validation'
  | 'unsupported'
  | 'unknown';

export class AppError extends Error {
  readonly kind: AppErrorKind;
  readonly status: number | null;
  readonly providerId: string | null;
  readonly retryAfterMs: number | null;
  /** Extra operator-facing context, already redacted. */
  readonly detail: string | null;

  constructor(
    kind: AppErrorKind,
    message: string,
    opts: {
      status?: number | null;
      providerId?: string | null;
      retryAfterMs?: number | null;
      detail?: string | null;
      cause?: unknown;
    } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AppError';
    this.kind = kind;
    this.status = opts.status ?? null;
    this.providerId = opts.providerId ?? null;
    this.retryAfterMs = opts.retryAfterMs ?? null;
    this.detail = opts.detail ?? null;
  }

  get isRetryable(): boolean {
    return (
      this.kind === 'network' ||
      this.kind === 'timeout' ||
      this.kind === 'rate_limited' ||
      (this.kind === 'server' && (this.status ?? 0) >= 500)
    );
  }

  /** Short, user-facing remediation hint. */
  get hint(): string | null {
    switch (this.kind) {
      case 'rate_limited':
        return 'Provider rate limit reached. Raise the refresh interval or configure a dedicated API key.';
      case 'unauthorized':
        return 'The provider rejected the credentials. Re-check the API key in Settings › Providers.';
      case 'forbidden':
        return 'This credential is not permitted to use the requested data source.';
      case 'timeout':
        return 'The provider did not respond in time. Check connectivity or try again.';
      case 'network':
        return 'Network request failed. Check connectivity, CORS, or provider availability.';
      case 'unsupported':
        return 'This provider does not expose the requested capability.';
      case 'validation':
        return 'The provider returned data in an unexpected shape and it was rejected.';
      default:
        return null;
    }
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

/** Normalizes anything thrown into an AppError without leaking secrets. */
export function toAppError(e: unknown, providerId?: string): AppError {
  if (isAppError(e)) return e;
  if (e instanceof DOMException && e.name === 'AbortError') {
    return new AppError('aborted', 'Request cancelled', { providerId, cause: e });
  }
  if (e instanceof Error) {
    if (e.name === 'AbortError') {
      return new AppError('aborted', 'Request cancelled', { providerId, cause: e });
    }
    if (e.name === 'TimeoutError') {
      return new AppError('timeout', 'Request timed out', { providerId, cause: e });
    }
    return new AppError('unknown', e.message || 'Unexpected error', { providerId, cause: e });
  }
  return new AppError('unknown', typeof e === 'string' && e ? e : 'Unexpected error', { providerId, cause: e });
}

/** Extracts a JSON-RPC error message without dumping the whole payload. */
export function rpcErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const err = (payload as { error?: unknown }).error;
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return null;
}