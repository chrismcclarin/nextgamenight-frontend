'use client';

/**
 * Self-row cache-coherence helpers (Phase 87.3-07, D-02).
 *
 * `useSelfIdentity` pins the `['users','self']` cache at `staleTime: Infinity`,
 * so it NEVER self-refreshes (see the SELF_IDENTITY_KEY invalidation contract in
 * useSelfIdentity.ts). Once the providers/pages that previously ran their own
 * ad-hoc self-fetch resolve identity from that immortal cache, every self-row
 * mutation MUST route its success through one of these helpers — otherwise a
 * later remount re-initializes editable state (username, timezone, tutorial
 * state, phone/phone_verified, notification preferences) from the stale
 * pre-mutation row.
 *
 * The immortal row is hydrated from GET with the `withContactInfo` scope
 * (phone/email present); mutation responses are DEFAULT-scope (phone/email
 * absent). NEVER write a mutation response into this cache wholesale — PATCH
 * the changed fields, or invalidate. (A wholesale `replaceSelfCache` helper
 * existed briefly and was removed for exactly this scope-mismatch poisoning.)
 *
 * Both helpers resolve the query key from {@link SELF_IDENTITY_KEY} exported by
 * the hook module — no mutation site hand-writes the `['users','self']` literal.
 */
import type { QueryClient } from '@tanstack/react-query';
import { SELF_IDENTITY_KEY, type SelfIdentity } from './useSelfIdentity';

/**
 * Merge a partial patch into the cached self row (no network round-trip).
 * No-op when the cache is empty (the mutation's own success path already owns
 * local UI state; nothing to reconcile until the row exists).
 */
export function patchSelfCache(
  queryClient: QueryClient,
  patch: Partial<SelfIdentity>,
): void {
  queryClient.setQueryData<SelfIdentity>(SELF_IDENTITY_KEY, (old) =>
    old ? { ...old, ...patch } : old,
  );
}

/**
 * Mark the self row stale and refetch active observers (server round-trip). Use
 * when the mutation does not return the full updated row and the authoritative
 * post-mutation state must come from the server.
 */
export function invalidateSelfCache(queryClient: QueryClient): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: SELF_IDENTITY_KEY });
}
