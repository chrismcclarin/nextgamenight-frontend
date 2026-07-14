'use client';

/**
 * useSelfIdentity — the single shared self-identity primitive (D-01).
 *
 * Resolves the caller's own `Users.id` UUID exactly once per session via a
 * react-query hook keyed by {@link SELF_IDENTITY_KEY} (`staleTime: Infinity`,
 * since the UUID is immutable once provisioned). Every is-me site (plans
 * 04/05/06/07) consumes THIS hook instead of an ad-hoc per-page self-fetch, so
 * no duplicate identity fetch survives the cutover (D-01/D-02).
 *
 * The hook inherits the hardened `queryClient` retry/410 taxonomy — it does NOT
 * re-implement retry. `account_deleted` (410) is already NON-retryable in
 * `queryClient.shouldRetry`; on that terminal tombstone the hook routes to the
 * logout/goodbye path (D-10) rather than surfacing retry noise.
 *
 * Pair it with `useFetchErrorState(query)` + the compact `FetchErrorBanner`
 * variant to surface a non-blocking degrade notice on permanent failure (D-08).
 */
import * as React from 'react';
import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { useUser } from '@auth0/nextjs-auth0/client';
import { ApiError, usersAPI } from '@/lib/api';
import { detectBrowserTimezone } from '@/lib/datetime';
import type { User } from '@/lib/schemas/users';

/**
 * SELF_IDENTITY_KEY — the query-key PREFIX for the caller's own resolved self
 * row. The live key is `[...SELF_IDENTITY_KEY, user.sub]` — scoped per account
 * so an in-session account switch gets a fresh cache entry and can never be
 * served the PREVIOUS user's identity/PII from the immortal cache.
 *
 * INVALIDATION CONTRACT (load-bearing): the self query is pinned at
 * `staleTime: Infinity`, so the cached self row NEVER self-refreshes. Every
 * mutation path that writes a self-row field — username, timezone, tutorial
 * completion, phone verification, notification preferences — MUST, on success,
 * either patch via `patchSelfCache` (prefix-matched `setQueriesData`) or
 * `queryClient.invalidateQueries({ queryKey: SELF_IDENTITY_KEY })` (prefix
 * match covers the sub-scoped key). No consumer may initialize editable state
 * from a pre-mutation cached row: without an explicit refresh the immortal
 * cache would re-serve stale profile data on the next remount. Plan 07's
 * migrated mutation paths wire to this contract.
 */
export const SELF_IDENTITY_KEY = ['users', 'self'] as const;

/** The logout redirect that lands on the /goodbye page (matches 87.2). */
const LOGOUT_GOODBYE_URL = '/api/auth/logout?returnTo=/goodbye';

/**
 * The resolved self row. `getUser` returns the persisted record which always
 * carries the `Users.id` UUID as `id`; post-PR-C (87.3 plan 09) the flat
 * `user_id` carries the SAME UUID via the toSelfWire alias — the Auth0 sub
 * never crosses the wire. `UserSchema` models `id` as optional (nested
 * includes may omit it), so we narrow it to required here — it is the value
 * the is-me compares target (D-04).
 */
export type SelfIdentity = User & { id: string };

export interface UseSelfIdentityResult {
  /** The caller's resolved `Users.id` UUID (undefined until resolved). */
  selfUuid: string | undefined;
  /** The full resolved self row (undefined until resolved). */
  self: SelfIdentity | undefined;
  /** The raw query — pass to `useFetchErrorState` for the degrade banner. */
  query: UseQueryResult<SelfIdentity, unknown>;
  /** True while the self row is still resolving (react-query v5 semantics). */
  isPending: boolean;
}

/**
 * Resolve the caller's own `Users.id` UUID via the shared, cached self-fetch.
 *
 * `usersAPI.getUser(user.sub)` uses the sub as a lookup PARAM (allowlisted — it
 * is not an is-me compare); the resolved `.id` is the UUID consumers compare
 * against nested `User.id` fields.
 */
export function useSelfIdentity(): UseSelfIdentityResult {
  const { user } = useUser();

  const query = useQuery<SelfIdentity>({
    // Scoped by sub (see SELF_IDENTITY_KEY doc): a different logged-in account
    // resolves against its own cache entry, never the previous user's row.
    queryKey: [...SELF_IDENTITY_KEY, user?.sub ?? null],
    queryFn: async (): Promise<SelfIdentity> => {
      // TZ-01: forward the detected browser timezone as getUser's 2nd arg so the
      // self-fetch keeps its persist/backfill WRITE side-effect once plan 07
      // migrates TimezoneProvider onto this hook. On detection failure the
      // helper is passed `null`, which getUser omits from the query string —
      // matching today's provider-mount behavior.
      const detected = detectBrowserTimezone();
      const row = await usersAPI.getUser(user?.sub ?? '', detected);
      return row as SelfIdentity;
    },
    // Boolean-wrap so `enabled` is never `undefined` and the query never fires
    // while logged out.
    enabled: Boolean(user?.sub),
    // The UUID is immutable once provisioned — the immortal cache is refreshed
    // ONLY via the SELF_IDENTITY_KEY invalidation contract above.
    staleTime: Infinity,
    // NO custom `retry:` predicate — inherit queryClient.shouldRetry, where
    // `account_deleted` (410) is already NON-retryable.
  });

  // D-10: a resolved 410 `account_deleted` is a terminal tombstone, not retry
  // noise. Route to the logout/goodbye path exactly as DangerZoneDeleteAccount.
  const { error } = query;
  React.useEffect(() => {
    if (error instanceof ApiError && error.code === 'account_deleted') {
      window.location.assign(LOGOUT_GOODBYE_URL);
    }
  }, [error]);

  return {
    selfUuid: query.data?.id,
    self: query.data,
    query,
    isPending: query.isPending,
  };
}
