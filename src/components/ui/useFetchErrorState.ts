'use client';

/**
 * useFetchErrorState — PRIM-03 fetch-error surface state (D-02).
 *
 * The single hook that turns a TanStack `UseQueryResult` into the small state a
 * fetch-error UI needs: `{ showError, message, code, retry }`. It is a pure
 * DERIVATION over the query — it does NOT re-implement fetch, silent-retry, or
 * Sentry escalation:
 *
 *   - Silent-retry is TanStack config (`retry: shouldRetry` in queryClient.ts).
 *     `isError` only flips true AFTER retries are exhausted, so `showError`
 *     reads it directly — no `setTimeout` retry lives here.
 *   - Sentry escalation already lives in the global `QueryCache.onError`
 *     (Phase 84 queryClient.ts) — never duplicated here.
 *   - `code` is read from the `ApiError.code` seam ONLY (`err.code`). The Phase 85
 *     `{ code }` envelope is already resolved into `ApiError.code` by
 *     `mapErrorToCode` in api.ts — this hook NEVER re-parses a response body.
 *
 * Error-only refocus recovery (D-02): the global query client deliberately sets
 * `refetchOnWindowFocus: false` and governs EVERY query, so it must NOT be
 * flipped. This hook owns "are we currently erroring", so it re-attempts the
 * query's own `refetch()` on window refocus WHILE-AND-ONLY-WHILE errored —
 * scoped to this one query, torn down the instant the error clears. That
 * preserves the pre-migration userProfile `visibilitychange` recovery (mobile
 * close-and-reopen auto-recover) without touching the global default.
 */
import * as React from 'react';
import type { UseQueryResult } from '@tanstack/react-query';
import { ApiError, type ApiErrorCode } from '@/lib/api';

export type FetchErrorCode = ApiErrorCode;

export interface FetchErrorState {
  /** True once the query has surfaced a visible error (retries exhausted). */
  showError: boolean;
  /** User-facing copy derived from the error code (safe display text). */
  message: string;
  /** The `ApiError.code` (or `'unknown'` for non-ApiError failures). */
  code: FetchErrorCode;
  /** Re-attempt the query. Resolves when the refetch settles. */
  retry: () => Promise<unknown>;
}

/** User-facing copy per error code. Rendered as auto-escaped React text. */
const MESSAGE_BY_CODE: Record<FetchErrorCode, string> = {
  network: "We couldn't reach the server. Check your connection and try again.",
  rate_limited: "You're going a little fast — give it a moment, then try again.",
  unauthorized: 'Your session may have expired. Refresh the page to sign back in.',
  forbidden: "You don't have access to this. Refresh the page to try again.",
  not_found: "We couldn't find what you were looking for.",
  validation: 'Something looks off with that request. Refresh the page to try again.',
  token_invalid: 'This link is invalid or has expired. Request a new one and try again.',
  prompt_closed: 'This availability poll is already closed.',
  prompt_deadline_expired: 'The deadline for this availability poll has passed.',
  reminder_cooldown: 'A reminder was sent recently. Please wait before sending another.',
  internal: "Something went wrong on our end. Please try again shortly.",
  config: "Something's misconfigured on our end. Please try again shortly.",
  unknown: 'Something went wrong. Refresh the page to try again.',
};

/** Read the code from the ApiError seam ONLY — never re-parse the body. */
function deriveCode(error: unknown): FetchErrorCode {
  if (error instanceof ApiError) return error.code;
  return 'unknown';
}

export interface UseFetchErrorStateOptions {
  /** Override the derived copy (e.g. a surface-specific message). */
  fallbackMessage?: string;
}

/**
 * Derive fetch-error surface state from a TanStack query result.
 *
 * @param query a `UseQueryResult` (only `isError`/`error`/`refetch` are read).
 * @param options optional message override.
 */
export function useFetchErrorState<TData = unknown, TError = unknown>(
  query: UseQueryResult<TData, TError>,
  options: UseFetchErrorStateOptions = {}
): FetchErrorState {
  const { isError, error, refetch } = query;
  const showError = Boolean(isError);
  const code = deriveCode(error);
  const message =
    options.fallbackMessage && code === 'unknown'
      ? options.fallbackMessage
      : MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unknown;

  const retry = React.useCallback(() => Promise.resolve(refetch()), [refetch]);

  // Error-only refocus recovery — scoped to THIS query, active ONLY while
  // erroring, and independent of the global `refetchOnWindowFocus: false`.
  React.useEffect(() => {
    if (!showError) return;
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refetch();
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [showError, refetch]);

  return { showError, message, code, retry };
}
