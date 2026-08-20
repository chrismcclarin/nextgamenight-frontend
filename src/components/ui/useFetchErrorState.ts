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
  owner_of_active_groups:
    'You still own active groups. Transfer ownership or delete them, then try again.',
  account_deleted: 'This account has already been deleted.',
  // 88-CODE-REVIEW D2 (owner-ratified copy, 2026-08-06): generic fallback for a
  // code-less 409 — surfaces override per outcome via byCode (friends, polls).
  conflict: "That can't be done — it may already be settled. Refresh to see the latest state.",
  // 88-33 Task 2 / Fork F (owner-ruled 2026-08-20): the two group-invite 409s
  // from 88-34's ERROR_REGISTRY. This Record is EXHAUSTIVE over ApiErrorCode by
  // design — widening the union without adding both entries is a TS2739 build
  // failure, and widening the Record to Partial to dodge that error is
  // FORBIDDEN: it would destroy the exhaustiveness guarantee for every other
  // code too. This is the GENERIC query-fallback copy; the invite surface's own
  // richer 'Invite pending' / 'Already a member' resting states take precedence
  // whenever that surface is showing.
  already_member: 'This person is already a member of the group',
  invite_pending: 'This person already has a pending invite.',
  // Phase 88.2 group-restore codes. This map is the GENERIC fallback copy for a
  // query-driven fetch; the restore page owns its own cause-split copy, which is
  // richer than anything sensible here.
  already_restored: 'This group has already been restored.',
  window_expired: 'The recovery window for this group has ended.',
  already_used: 'This link is no longer valid.',
  invalid_token: 'This link is no longer valid.',
  // M-2: status-mapped fallback for a code-less 410 — terminal, so no
  // "try again" phrasing.
  gone: 'This is no longer available.',
  internal: "Something went wrong on our end. Please try again shortly.",
  config: "Something's misconfigured on our end. Please try again shortly.",
  unknown: 'Something went wrong. Refresh the page to try again.',
};

/** Read the code from the ApiError seam ONLY — never re-parse the body. */
function deriveCode(error: unknown): FetchErrorCode {
  if (error instanceof ApiError) return error.code;
  return 'unknown';
}

export interface FetchErrorMessageOptions {
  /** Copy used when the failure carries no `ApiError.code` (i.e. `unknown`). */
  fallback?: string;
  /** Per-code copy overrides for a surface-specific outcome (e.g. `validation`). */
  byCode?: Partial<Record<FetchErrorCode, string>>;
}

/* DECISION Phase 88-25 (Req 14 / T-88-25-01): user-facing failure copy is DERIVED from
   `ApiError.code`, chosen OVER the `error.message || 'Failed to X'` idiom that shipped on ~20
   ACTION-path sites (toasts and inline field errors) across gameDetail, userProfile, friends,
   groupPlanning and OpenPollsList.

   WHY THE SHIPPED IDIOM LOSES — it is an information-disclosure bug, not just a copy nit.
   `ApiError.message` is `body.message ?? body.error ?? \`HTTP error! status: ${status}\``
   (api.ts extractErrorMessage), so whatever the backend says lands verbatim in the DOM, and an
   unhandled 500 paints a raw status string at the user. 88-19 closed the same hole on the
   page-level branch by giving `ErrorFallback` NO error prop by contract; this is that ruling
   applied to the action path, at the mechanism rather than string by string.

   WHY THIS LIVES BESIDE THE HOOK: the hook and the toasts must not drift into two registers for
   the same failure. `useFetchErrorState` now derives its own `message` through this function, so
   MESSAGE_BY_CODE has exactly one reader.

   `byCode` exists so a surface that genuinely needs a sharper outcome (e.g. a 400 on a username
   change is "that name is taken", not the generic validation line) can say so in DESIGNED copy
   without reopening the interpolation. Passing an upstream string into `fallback` or `byCode`
   re-opens the hole and is the one thing this function cannot stop — do not do it. */
export function getFetchErrorMessage(
  error: unknown,
  options: FetchErrorMessageOptions = {}
): string {
  const code = deriveCode(error);
  const override = options.byCode?.[code];
  if (override) return override;
  if (code === 'unknown' && options.fallback) return options.fallback;
  return MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unknown;
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
  // Single reader of MESSAGE_BY_CODE — see the marker on getFetchErrorMessage.
  // Semantics are unchanged: `fallbackMessage` applies ONLY when the failure
  // carries no ApiError code.
  const message = getFetchErrorMessage(error, { fallback: options.fallbackMessage });

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
