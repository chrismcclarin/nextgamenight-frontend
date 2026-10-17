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
 *     [AMENDED Phase 88.6.1-07 (D-24): still true — `code` is read from `err.code` only,
 *     and this module still never parses a body. The one structural question the MESSAGE
 *     asks (is this the proxy's CSRF refusal?) is answered by api.ts's `isCsrfRejection`,
 *     so the body's shape stays known in one file.]
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
import { ApiError, isCsrfRejection, type ApiErrorCode } from '@/lib/api';

export type FetchErrorCode = ApiErrorCode;

// A layout effect on the client, a plain effect on the server, where effects never run and a bare
// `useLayoutEffect` logs React 18's "does nothing on the server" warning on every SSR'd page that
// uses this hook. The house idiom (`paintGestureActiveStore.ts`, anchor
// `const useIsomorphicLayoutEffect`).
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? React.useLayoutEffect : React.useEffect;

export interface FetchErrorState {
  /** True once the query has surfaced a visible error (retries exhausted). */
  showError: boolean;
  /** User-facing copy derived from the error code (safe display text). */
  message: string;
  /** The `ApiError.code` (or `'unknown'` for non-ApiError failures). */
  code: FetchErrorCode;
  /** Re-attempt the query. Resolves when the refetch settles. */
  retry: () => Promise<unknown>;
  /**
   * True once a retry the PERSON started (`retry()`) has failed in the current failure episode;
   * false again when the failure ends (the error clears). Never set by the automatic tab-return
   * re-attempt. Optional: a hand-built state without it reads as "no retry has failed", the
   * rule's resting state. The full `FetchErrorBanner` offers `Report this` only while it is true
   * (owner ruling 2026-10-05, plan 88.6.1-69).
   *
   * Caller contract: `error` must keep its identity across renders of the same failure (every
   * measured production adapter holds it in state, or reads it from TanStack). A caller that
   * builds a fresh error object on every render cannot crash the host (nothing is written during
   * render), but the identity rule cannot read its retries correctly.
   */
  retryFailed?: boolean;
}

/**
 * One retry being tracked, from the press (or the tab-return re-attempt) to its verdict.
 * `phase` is `inFlight` until the retry's promise settles, then the verdict it waits to see
 * committed.
 */
type RetryAttempt = {
  id: number;
  /** The person pressed (true) or the hook's own tab-return re-attempt ran (false). */
  byPerson: boolean;
  /** The committed error showing at the press, read for the unknown-result identity rule. */
  errorAtStart: unknown;
  phase: 'inFlight' | 'awaitFailed' | 'awaitSucceeded' | 'awaitUnknown';
};

/**
 * Reads a refetch's OWN result: an object whose `isError` is `true` failed, `false` succeeded,
 * anything else (an awaited loader resolving nothing, an adapter resolving before its run) is
 * unknown. The same rule as `FetchErrorBanner`'s module-private `classifyRetryResult`, restated
 * here because this hook must not import the component module.
 */
function classifyRefetchResult(result: unknown): 'failed' | 'succeeded' | 'unknown' {
  if (typeof result !== 'object' || result === null) return 'unknown';
  const { isError } = result as { isError?: unknown };
  if (isError === true) return 'failed';
  if (isError === false) return 'succeeded';
  return 'unknown';
}

/** The phase a settled attempt moves to, from its own result. */
function verdictPhase(result: unknown): RetryAttempt['phase'] {
  const verdict = classifyRefetchResult(result);
  if (verdict === 'failed') return 'awaitFailed';
  if (verdict === 'succeeded') return 'awaitSucceeded';
  return 'awaitUnknown';
}

/** User-facing copy per error code. Rendered as auto-escaped React text. */
const MESSAGE_BY_CODE: Record<FetchErrorCode, string> = {
  network: "We couldn't reach the server. Check your connection and try again.",
  rate_limited: "You're going a little fast — give it a moment, then try again.",
  // DECISION Phase 88.6.1-07 (D-30, copy row X1): the owner-ratified sentence
  // (88.6.1-COPY-TABLE.html:161, row `'X1'`, column 5). The previous line told the person to reload the page,
  // and that remedy is false for a session whose cookie exists but whose token cannot be
  // acquired: the proxy degrades to a tokenless forward (`src/app/api/[...path]/route.ts:174-185`,
  // anchor `let accessToken: string | null = null;`), and a reload re-runs that same acquisition
  // (CONTEXT D-01). REJECTED: a sign-in link or button on the banner (D-33 row 24, not this
  // phase; plan 88.6.1-58 writes its pointer). REJECTED: per-surface overrides (this register
  // line is the one carrier). Reverting to reload advice is a decision, not a cleanup.
  unauthorized: 'Your session may have expired. Sign in again to continue.',
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
  // Phase 88.8 (BOPS-05, SPEC R7 / D-19): the never-provisioned 404 registered
  // BE-side by plan 07. The Record is EXHAUSTIVE over ApiErrorCode (see the
  // 88-33 note below) so widening the union without this entry is a build
  // failure by design — that is the ONE site in this sweep that fails loudly;
  // the union, NON_RETRYABLE_API_CODES and classifyDeleteError all fail silently.
  //
  // DECISION Phase 88.8 D-19: this Record gets a SURFACE-NEUTRAL wording, chosen
  // OVER pasting D-19's discuss-agreed string ("There's no account data to
  // delete yet. Reload the page and try again.") verbatim. That string names the
  // DELETE flow, and this Record is the generic query-fallback copy for ANY
  // query — the same generic-here / richer-at-the-surface split already used for
  // account_deleted, already_restored and the two invite 409s. D-19's exact
  // wording IS used, verbatim, at the one surface that renders it today:
  // NOT_PROVISIONED_MESSAGE in DangerZoneDeleteAccount.tsx. Both say the same
  // thing — reload, because reloading runs the just-in-time provisioning fetch.
  not_provisioned:
    "Your account isn't set up yet. Reload the page and try again.",
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
  // Copy = the wire string, byte-identical to ERROR_REGISTRY (wave-12 review
  // MED #13 fixed a trailing-period drift here).
  invite_pending: 'This person already has a pending invite',
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
  // Phase 88.8 post-merge (round 6 #15): the synthetic-target 400. GENERIC copy for any
  // surface that renders this Record directly; the ONE surface that can provoke the code
  // today — EmailAddressSection's Save — overrides it with field-attached copy through
  // `byCode`. Terminal by construction: the same address fails identically forever, so
  // no "try again" phrasing.
  unsupported_address:
    "That address can't be used with this app — the domain is reserved by our sign-in system.",
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
  /**
   * Copy used when the failure carries no `ApiError.code` (i.e. `unknown`).
   *
   * This applies ONLY when the resolved code is `unknown` — see the
   * `if (code === 'unknown' && options.fallback)` gate in `getFetchErrorMessage`. A `forbidden` or a
   * `conflict` error resolves through `MESSAGE_BY_CODE` and ignores `fallback` entirely —
   * which is deliberate: the register's strings are ratified copy and a caller-supplied
   * string must not be able to shadow them.
   * [AMENDED Phase 88.6.1-07 (D-24): one exception — a `forbidden` error that
   * `isCsrfRejection` recognises (the proxy's own CSRF refusal, not a backend one) resolves
   * its MESSAGE as `unknown`, so it DOES take the fallback. The sibling docblock on
   * `UseFetchErrorStateOptions.fallbackMessage` carries the same amendment.]
   *
   * DECISION Phase 88.6-14 (D-33): renaming this to `unknownFallbackMessage` was considered
   * and REJECTED as churn across every call site (`OpenPollsList.js:103-119`, anchor
   * `toast.error(` around the end-check-in call, and its
   * siblings across the R1 sweeps) for no behaviour change — and it would put a rename
   * inside the same waves as a behaviour migration. The narrowing is documented here
   * instead, and pinned by `useFetchErrorState.test.tsx`'s `fallback`-only-when-`unknown`
   * assertion. The sibling spelling `UseFetchErrorStateOptions.fallbackMessage` (anchor `fallbackMessage?: string;`)
   * carries the same record so the two cannot drift. Changing this is a decision, not a
   * cleanup.
   */
  fallback?: string;
  /** Per-code copy overrides for a surface-specific outcome (e.g. `validation`). */
  byCode?: Partial<Record<FetchErrorCode, string>>;
}

/* DECISION Phase 88-25 (Req 14 / T-88-25-01): user-facing failure copy is DERIVED from
   `ApiError.code`, chosen OVER the `error.message || 'Failed to X'` idiom that shipped on ~20
   ACTION-path sites (toasts and inline field errors) across gameDetail, userProfile, friends,
   groupPlanning and OpenPollsList.

   WHY THE SHIPPED IDIOM LOSES — it is an information-disclosure bug, not just a copy nit.
   `ApiError.message` was `body.message ?? body.error ?? \`HTTP error! status: ${status}\``
   when this was written, so whatever the backend said landed verbatim in the DOM, and an
   unhandled 500 painted a raw status string at the user. AMENDED Phase 88.6-42 (2026-09-17):
   the legacy `body.error` arm is GONE — the chain is now `body.message ?? \`HTTP error!
   status: ${status}\`` (api.ts extractErrorMessage) — so the raw-status half of that hazard
   stands and the verbatim-backend-string half now only reaches an `ApiError` through a
   converted route's own envelope `message`. The ARGUMENT below is unchanged: copy is DERIVED
   from the code, never from the message. 88-19 closed the same hole on the
   page-level branch by giving `ErrorFallback` NO error prop by contract; this is that ruling
   applied to the action path, at the mechanism rather than string by string.

   WHY THIS LIVES BESIDE THE HOOK: the hook and the toasts must not drift into two registers for
   the same failure. `useFetchErrorState` now derives its own `message` through this function, so
   MESSAGE_BY_CODE has exactly one reader.

   `byCode` exists so a surface that genuinely needs a sharper outcome (e.g. a 400 on a username
   change is "that name is taken", not the generic validation line) can say so in DESIGNED copy
   without reopening the interpolation. Passing an upstream string into `fallback` or `byCode`
   re-opens the hole and is the one thing this function cannot stop — do not do it.

   [AMENDED Phase 88.6.1-07 (D-24): copy is still derived from the code, never from the message.
   The one read added here is a structural boolean at the seam (api.ts's `isCsrfRejection`,
   which reads the body's `csrf_rejected` key off `ApiError.details`), not prose; it decides
   only WHICH code's copy the message uses. See the DECISION Phase 88.6.1-07 block below.] */

/* DECISION Phase 88.6.1-07 (D-24 (a2), MEDLOW-9; copy row X2): a proxy CSRF 403 resolves its
   MESSAGE through the `unknown` arm — `byCode.unknown`, else the caller's `fallback`, else the
   register's unknown line — while `err.code` stays the honest `'forbidden'`. The proxy refused
   the request before the backend saw it, so a role sentence ("Only the poll creator...") or the
   register's permission line states something the app does not know.

   REJECTED (a1): `mapErrorToCode` returning `'unknown'` for the flagged body. It labels a real
   HTTP response "we don't know", flips `shouldRetry` (`src/lib/queryClient.ts:121`, anchor
   `export function shouldRetry`) to retryable-once for that error, and never reaches the restore
   page's status-keyed 403 arm.
   REJECTED (b): per-site guards. Six would be guarded while dozens of generic sites still print
   the permission line, and the predicate would be copied per site (duplication tenet).
   REJECTED: "bypass `byCode.forbidden` only", the register's own fix text
   (`.planning/deferred/phase-88.6.1.md:197`, anchor `review MEDLOW-9`). It falls to `MESSAGE_BY_CODE.forbidden`, which is
   still a permission claim (DF correction 4).

   The resulting line, stated plainly: a surface that passes a `fallback` prints its own
   "We couldn't ... Please try again." line; a surface that passes none prints the register's
   unknown line. Both are that screen's ordinary line for a cause it cannot name (copy row X2,
   "No new sentence"; D-31). `deriveCode` and the hook's `code` field are untouched. Changing
   this to a code remap or per-site checks is a decision, not a cleanup. */
export function getFetchErrorMessage(
  error: unknown,
  options: FetchErrorMessageOptions = {}
): string {
  // The code the MESSAGE resolves through; a proxy CSRF 403 reads as `unknown` here only.
  const code: FetchErrorCode = isCsrfRejection(error) ? 'unknown' : deriveCode(error);
  const override = options.byCode?.[code];
  if (override) return override;
  if (code === 'unknown' && options.fallback) return options.fallback;
  return MESSAGE_BY_CODE[code] ?? MESSAGE_BY_CODE.unknown;
}

export interface UseFetchErrorStateOptions {
  /**
   * Copy used when the failure carries no `ApiError.code` (i.e. `unknown`).
   *
   * NOT a general override, despite the name. This applies ONLY when the resolved code is
   * `unknown` (see the `if (code === 'unknown' && options.fallback)` gate, reached via
   * `getFetchErrorMessage`'s `fallback`). A `forbidden`
   * or `conflict` error resolves through `MESSAGE_BY_CODE` and ignores `fallbackMessage`
   * entirely — which is deliberate: the register's strings are ratified copy and a
   * caller-supplied string must not be able to shadow them.
   * [AMENDED Phase 88.6.1-07 (D-24): one exception — a `forbidden` error that
   * `isCsrfRejection` recognises (the proxy's own CSRF refusal, not a backend one) resolves
   * its MESSAGE as `unknown`, so it DOES take the fallback. The sibling docblock on
   * `FetchErrorMessageOptions.fallback` carries the same amendment.]
   *
   * DECISION Phase 88.6-14 (D-33, closing the 2026-07-09 todo from the phase 87.2 code
   * review IN-10): this docblock previously read "Override the derived copy (e.g. a
   * surface-specific message)", which describes a general override this option has never
   * been. Renaming it to `unknownFallbackMessage` was considered and REJECTED as churn
   * across every call site (`OpenPollsList.js:103-119`, anchor `toast.error(` around the
   * end-check-in call, and its siblings across the R1
   * sweeps) for no behaviour change — and it would put a rename inside the same waves as a
   * behaviour migration. The narrowing is documented here instead, and pinned by
   * `useFetchErrorState.test.tsx`'s `fallback`-only-when-`unknown` assertion. The sibling
   * spelling `FetchErrorMessageOptions.fallback` (anchor `fallback?: string;`) carries the same record so the two
   * cannot drift. The body comment in `useFetchErrorState` (anchor
   * `// Single reader of MESSAGE_BY_CODE`) says the same thing, but a caller reading
   * this exported interface never sees it — it is not a substitute for this docblock.
   * Changing this is a decision, not a cleanup.
   */
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

  /* DECISION Phase 88.6.1-69 (retryFailed): owner ruling 2026-10-05 ("c everywhere") — the full
     banner offers `Report this` only after a retry the person started has failed. CHOSEN: the
     memory lives HERE, because this hook runs in the HOST and outlives a caller-gated banner;
     "failed" is read from the COMMITTED state (a known-failed result once the error commits; for
     an unknown result, a NEW error object once the retry's promise has settled; a clear after the
     settle is a success), resolved at commit in a layout effect with no state written during
     render; the flag is lowered only when the failure ENDS; the field is optional.
     REJECTED, each so it is not re-proposed as a tidy-up:
     (a) a flag inside `FetchErrorBanner` — a never-loaded query's refetch commits `pending` with no
         data (`@tanstack/query-core` `query.js`, anchor `...data === void 0 && {`), the caller
         removes the banner at the press, and the flag dies with it; the link would never appear;
     (b) "the error still shows after the promise settled" — an adapter that resolves before its
         run (`UserHomePage.js`, anchor `return Promise.resolve();`) settles while the OLD error
         still shows, so the link would appear over a request that may still succeed (SPEC
         Prohibition 2);
     (c) a required field — 16 hand-built test doubles in 8 suites other plans own, and no
         production builder;
     (d) counting the automatic tab-return re-attempt — the owner's rule is about the person
         having tried ("a call to action at the spot of the action");
     (e) reusing plan 21's `retryFailedAgain` — it is per banner mount and dies with the banner;
     (f) a render-time adjust holding the last-seen error in state — a caller that builds its
         error fresh on every render loops "Too many re-renders" and crashes the host (review #77);
     (g) lowering the flag on any new error object no tracked retry explains — a reconnect
         refetch (`queryClient.ts`, `refetchOnReconnect: true`) re-failing the same query would
         withdraw the link while the failure persists, against "for as long as that failure
         persists" (review #78).
     STATED LIMITS: (1) the home upcoming-events adapter clears its error at the start of its run
     (`UserHomePage.js`, anchor `setUpcomingError(null);`), so a failed retry there reads as a
     success and the link waits for the next failed retry (an under-report) until plan
     88.6.1-62's C4 conversion; (2) a hand-rolled adapter whose data key changes while mounted,
     straight from one error to another, keeps the flag across the switch (plan 71 records the one
     such shape, a group switch while mounted, as unreachable today); (3) a NEVER-LOADED TanStack
     query refetched by anything but a tracked attempt (a reconnect refetch, an invalidation,
     another observer) passes through `pending`, so the episode-end rule lowers the flag and the
     link returns only after the person's next failed retry — an under-offer this hook cannot tell
     apart from a key change. Changing where this lives, reading the promise as the verdict, or
     resetting on a new error object, is a decision, not a cleanup. */
  const [retryFailed, setRetryFailed] = React.useState(false);
  // Written only from `retry()` and its settle, never during render.
  const [attempt, setAttempt] = React.useState<RetryAttempt | null>(null);
  const attemptIdRef = React.useRef(0);
  // The committed error, read at the press. The only record of it: no render-time state.
  const latestErrorRef = React.useRef<unknown>(error);
  useIsomorphicLayoutEffect(() => {
    latestErrorRef.current = error;
  });

  const retry = React.useCallback(async () => {
    const id = ++attemptIdRef.current;
    setAttempt({ id, byPerson: true, errorAtStart: latestErrorRef.current, phase: 'inFlight' });
    // Only the newest attempt decides: a superseded one settles into nothing.
    const settleAs = (phase: RetryAttempt['phase']) =>
      setAttempt((current) => (current !== null && current.id === id ? { ...current, phase } : current));
    try {
      const result = await Promise.resolve(refetch());
      settleAs(verdictPhase(result));
      return result;
    } catch (err) {
      settleAs('awaitUnknown');
      throw err;
    }
  }, [refetch]);

  // Resolve the verdict at COMMIT, before paint (a `useEffect` would paint a frame with the wrong
  // link). Each set runs only when its value changes, so an unstable error identity can at worst
  // re-run a no-op effect.
  useIsomorphicLayoutEffect(() => {
    if (attempt === null) {
      // The failure episode ended with no attempt in flight (a TanStack key change reaches this
      // through `pending`). A new error object alone never lowers the flag (REJECTED (g)).
      if (!isError && retryFailed) setRetryFailed(false);
      return;
    }
    // An in-flight attempt is never judged and never ends the episode: the verdict waits for
    // its promise, so no re-render during a held retry can show the link (Prohibition 2).
    if (attempt.phase === 'inFlight') return;
    const failed =
      Boolean(isError) &&
      (attempt.phase === 'awaitFailed' || (attempt.phase === 'awaitUnknown' && error !== attempt.errorAtStart));
    const succeeded = !isError && (attempt.phase === 'awaitSucceeded' || attempt.phase === 'awaitUnknown');
    if (failed) {
      if (attempt.byPerson && !retryFailed) setRetryFailed(true);
      setAttempt(null);
    } else if (succeeded) {
      if (retryFailed) setRetryFailed(false);
      setAttempt(null);
    }
  }, [attempt, isError, error, retryFailed]);

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

  return { showError, message, code, retry, retryFailed };
}
