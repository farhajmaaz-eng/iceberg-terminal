import type { AppError } from '@/lib/errors';

/**
 * Fallback wrapper for provider calls.
 *
 * Policy (documented in docs/ARCHITECTURE.md):
 *  • Demo data is produced ONLY when the user has opted into demo mode or no
 *    provider is available/configured.
 *  • A provider failure while demo mode is OFF surfaces as a real error — we
 *    never silently swap a live provider for synthetic numbers.
 *  • When demo data IS produced, the reason is attached so the UI can explain
 *    exactly why the user is looking at sample values.
 */

export type FallbackReason =
  | 'forced-demo'
  | 'no-provider'
  | 'provider-disabled'
  | 'provider-unconfigured'
  | 'capability-missing';

export interface FallbackResult<T> {
  value: T;
  /** null when the value came from a live provider. */
  fallback: FallbackReason | null;
}

export class ProviderUnavailableError extends Error {
  readonly reason: FallbackReason;
  readonly providerId: string | null;

  constructor(reason: FallbackReason, message: string, providerId: string | null = null) {
    super(message);
    this.name = 'ProviderUnavailableError';
    this.reason = reason;
    this.providerId = providerId;
  }
}

export function isProviderUnavailable(e: unknown): e is ProviderUnavailableError {
  return e instanceof ProviderUnavailableError;
}

export async function withDemoFallback<TLive, TDemo>(
  opts: {
    forceDemo: boolean;
    disabled: boolean;
    requiresKey: boolean;
    hasKey: boolean;
    providerLabel: string;
    providerId: string;
    /** null => the provider genuinely cannot do this. */
    capabilityMissing?: boolean;
  },
  live: () => Promise<TLive>,
  demo: (reason: FallbackReason) => TDemo,
): Promise<FallbackResult<TLive | TDemo>> {
  const { forceDemo, disabled, requiresKey, hasKey, capabilityMissing } = opts;

  if (capabilityMissing) {
    if (forceDemo) return { value: demo('capability-missing'), fallback: 'capability-missing' };
    throw new ProviderUnavailableError(
      'capability-missing',
      `${opts.providerLabel} does not provide this capability.`,
      opts.providerId,
    );
  }
  if (forceDemo) return { value: demo('forced-demo'), fallback: 'forced-demo' };
  if (disabled) {
    return { value: demo('provider-disabled'), fallback: 'provider-disabled' };
  }
  if (requiresKey && !hasKey) {
    return { value: demo('provider-unconfigured'), fallback: 'provider-unconfigured' };
  }

  // Live call. Errors propagate — the UI shows a real error state.
  const value = await live();
  return { value, fallback: null };
}

export function describeFallback(reason: FallbackReason | null | undefined): string | null {
  switch (reason) {
    case 'forced-demo':
      return 'Demo mode is enabled globally. All values are deterministic synthetic samples.';
    case 'no-provider':
      return 'No data provider is configured.';
    case 'provider-disabled':
      return 'The selected provider is disabled. Showing synthetic samples.';
    case 'provider-unconfigured':
      return 'The selected provider needs an API key. Showing synthetic samples until one is added.';
    case 'capability-missing':
      return 'The selected provider does not publish this data type. Showing synthetic samples.';
    default:
      return null;
  }
}

export function appErrorMessage(e: unknown): { message: string; hint: string | null } {
  if (isProviderUnavailable(e)) return { message: e.message, hint: 'Configure a provider in Settings › Providers.' };
  const err = e as AppError;
  return {
    message: err?.message ?? 'Something went wrong.',
    hint: typeof err?.hint === 'string' ? err.hint : null,
  };
}