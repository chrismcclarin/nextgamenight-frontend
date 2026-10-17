/**
 * "Identity failed" means the identity query FAILED and NO row is held — the one rule
 * (Phase 88.6.1-79, AC-29).
 *
 * TanStack keeps a query's `data` when a refetch fails and reports `isError` true beside it
 * (`@tanstack/query-core` `queryObserver.js`, `isRefetchError: isError && hasData`). The
 * identity row is refetched only after the Email section's own invalidation
 * (`EmailAddressSection.tsx`, anchor `const refetchSelfAfterLocalMutation =`), and when that
 * re-read fails the app still holds the row and every control that reads it still works. So
 * the raw `isError` flag is NOT "the identity could not be loaded": that is `isError` AND no
 * row.
 *
 * Exports:
 *   - `selfIdentityFailedWithNoRow(query, selfUuid)` — the boolean rule. Pass the hook's
 *     `query` and its `selfUuid` (or `self?.id`).
 *   - `selfIdentityErrorSource(query, selfUuid)` — the `{ isError, error, refetch }` source
 *     `useFetchErrorState` reads, with `isError` from the rule and `error` / `refetch` passed
 *     through by reference. A host writes
 *     `useFetchErrorState(selfIdentityErrorSource(selfQuery, selfUuid))` where it used to
 *     write `useFetchErrorState(selfQuery)`.
 *
 * DECISION Phase 88.6.1-79 (AC-29, one no-row rule): CHOSEN — one rule, keyed on `selfUuid`
 * like every writer guard, in its own module. REJECTED: (a) the raw flag — TanStack reports
 * `isError` with the row still held after a failed refetch; (b) TanStack's `isLoadingError` —
 * the same condition, but the test harnesses model identity by the flag plus `selfUuid`, and
 * plan 88.6.1-61 rejected it for the writer-guard reason; (c) a field on `useSelfIdentity`'s
 * return — 30 test files replace that module wholesale with factories that would not carry a
 * new function field, so every consumer CALLING it would crash in those suites; (d) per-site
 * local conditions — plans 88.6.1-11, -41 and -61 each wrote one, the duplication the
 * milestone tenet forbids; (e) teaching `useFetchErrorState` to hide errors when data is held
 * — wrong for every retained-content site that WANTS its notice beside the kept rows (Profile's
 * identity header is one: it reads the RAW state on purpose, plan 88.6.1-79 Task 3).
 * The rule is CODE-BLIND on purpose: an access or gone answer over a held row is decided by the
 * one page that displays the row (Profile, `identityWithdrawn`), not here — the feedback form and
 * plan 88.6.1-63's hosts need the rule as written.
 * ACCEPTED CONSEQUENCE: with a held row nothing is shown, so `useFetchErrorState`'s error-only
 * tab-return refetch (anchor `document.addEventListener('visibilitychange', handleVisibility);`)
 * does not arm — the same as the app-wide healthy-view policy (`queryClient.ts`,
 * `refetchOnWindowFocus: false`); the next mount of any identity consumer refetches the
 * invalidated row. The 410 `account_deleted` routing reads the RAW error inside
 * `useSelfIdentity` and is untouched by this rule.
 * Plan 88.6.1-63 wires this rule into the home page, the Friends page and the compact-notice
 * hosts. Changing this is a decision, not a cleanup.
 */
import type { FetchErrorSource } from '@/components/ui/useFetchErrorState';

/** The one field of the identity query the rule reads. */
type IdentityErrorFlag = { isError?: boolean } | null | undefined;

/**
 * True only when the identity query is in error AND no row is held (`selfUuid` falsy).
 * A failed refetch over a held row is false: the row is still there and still works.
 */
export function selfIdentityFailedWithNoRow(
  query: IdentityErrorFlag,
  selfUuid: string | null | undefined
): boolean {
  return query?.isError === true && !selfUuid;
}

/**
 * The source `useFetchErrorState` reads for an identity consumer: `isError` is
 * `selfIdentityFailedWithNoRow`; `error` and `refetch` are the query's own references
 * (`refetch` is bound once per observer, so a host's hook dependencies stay stable).
 */
export function selfIdentityErrorSource<TData = unknown, TError = unknown>(
  query: FetchErrorSource<TData, TError>,
  selfUuid: string | null | undefined
): FetchErrorSource<TData, TError> {
  return {
    isError: selfIdentityFailedWithNoRow(query, selfUuid),
    error: query.error,
    refetch: query.refetch,
  } as FetchErrorSource<TData, TError>;
}
