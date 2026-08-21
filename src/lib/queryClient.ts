/**
 * App-Router-safe TanStack Query client factory + the single global error
 * escalation point (D-13 / D-14). This is the FOUNDATION every later-wave
 * validatedQueryFn migration inherits.
 *
 * Source pattern: tanstack.com/query/v5 advanced-ssr + nextjs example.
 *
 * Threat mitigations locked here (84 threat register):
 *   T-84-05 (Info Disclosure → Sentry): QueryCache.onError tags Sentry with
 *     entity+scope (queryKey[0]/[1]) ONLY — NEVER JSON.stringify(queryKey)
 *     (the full key may carry PII in later-wave migrations). For a ZodError,
 *     it forwards ONLY issues.map({path,code}) — never `received`/input values.
 *   T-84-07 (cross-request cache bleed): getQueryClient() returns a FRESH
 *     client on the server (isServer); browser uses a module-scoped singleton.
 *   T-84-08 (retry storm): `retry` is a PREDICATE that never retries ZodError
 *     or non-transient ApiError codes; transient failures retry at most once.
 */
import { QueryClient, QueryCache, isServer } from '@tanstack/react-query';
import * as Sentry from '@sentry/nextjs';
import { ZodError } from 'zod';
import { ApiError } from '@/lib/api';

// ApiError codes that are NOT transient — retrying them is pointless and a DoS
// risk against our own backend (T-84-08 / T-86-11). Retry classification for the
// Phase 85 BE domain codes was decided in 86-04 (Decision A):
//   unauthorized / forbidden / not_found / validation — client-side faults; a
//     retry cannot change the outcome. NON-retryable.
//   rate_limited (429) — the backend is explicitly asking us to slow down; an
//     immediate retry worsens the storm. Also the status-mapped code for raw
//     `{ error }` 429s, so unconverted routes back off too. NON-retryable.
//   reminder_cooldown (429) — a domain 429 the BE explicitly asks us to back
//     off on (next_reminder_available). NON-retryable.
//   prompt_closed / prompt_deadline_expired (400) — terminal domain states; the
//     prompt won't reopen on retry. NON-retryable.
//   token_invalid (400) — a bad/expired token won't validate on retry.
//     NON-retryable.
//   owner_of_active_groups (409) — the account-deletion owner gate (Phase 87.2 /
//     Pitfall 11). A retried pre-flight/DELETE cannot change the gate outcome and
//     only wastes a request + delays the blocked-state UI. NON-retryable.
//   account_deleted (410) — terminal tombstone (repeat-DELETE against a gone
//     account). Maps to the logout->/goodbye path, never a retry. NON-retryable.
//   already_restored (409) — the group-restore accept gate (Phase 88.2). Another
//     member already took the group back; the outcome is settled and the FE
//     redirects into the live group. NON-retryable.
//   window_expired / already_used / invalid_token (all 410) — the three terminal
//     group-restore refusals (Phase 88.2). Every one is a settled end state, so a
//     retry re-issues a STATE-CHANGING POST /groups/accept-ownership against a
//     group whose restore already resolved. Latent today (the restore page calls
//     the client directly, not through a mutation) — closed now precisely so it
//     stays closed when someone later routes it through TanStack and nothing
//     complains. NON-retryable. Note invalid_token (410, group restore) is a
//     DIFFERENT code from token_invalid (400, magic-token reject) listed above —
//     see the ApiErrorCode comment in lib/api.ts; do not merge them.
//   gone (410, status-mapped) — M-2: the fallback code for CODE-LESS 410 bodies
//     (88.2's join-by-token + invite accept/decline liveness gates). Gone is
//     terminal by definition; without this entry those 410s classified as
//     `unknown` and retried once while their coded siblings above did not.
//     NON-retryable.
// Left RETRYABLE-once (transient): `internal` (500 — may be a blip) and the
// client-side `network` code, plus `unknown` — shouldRetry allows one retry.
const NON_RETRYABLE_API_CODES: ReadonlyArray<string> = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  'rate_limited',
  'reminder_cooldown',
  'prompt_closed',
  'prompt_deadline_expired',
  'token_invalid',
  'owner_of_active_groups',
  'account_deleted',
  'already_restored',
  'window_expired',
  'already_used',
  'invalid_token',
  'gone',
  // 88-CODE-REVIEW D2: a 409 is a terminal-state conflict — non-transient by
  // definition; as `unknown` it was pointlessly retried once.
  'conflict',
  // 88-33 Task 2 / Fork F (owner-ruled 2026-08-20): the two group-invite 409s
  // registered BE-side by 88-34 Task 4. The SAME 88-CODE-REVIEW D2 ruling
  // applies — a verified-terminal 409 conflict is never retried. Without these
  // two rows the codes classify as neither `conflict` (they carry their own
  // envelope code) nor a listed terminal, so `shouldRetry` would retry each one
  // once the moment the backend starts emitting them: a silent, transient-only
  // regression of D2 that no other gate would catch.
  'already_member',
  'invite_pending',
];

/**
 * D-13 retry predicate. Exported so the behavioral test can unit-call the truth
 * table directly (GAP6) without standing up a live query.
 *   - ZodError (schema drift) → never retry.
 *   - non-transient ApiError code → never retry.
 *   - transient (network / 5xx / unknown) → retry at most once.
 */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof ZodError) return false;
  if (error instanceof ApiError && NON_RETRYABLE_API_CODES.includes(error.code)) return false;
  return failureCount < 1;
}

// A queryKey part is only used as a Sentry tag when it is a primitive string;
// anything else collapses to undefined so we never serialize a structured
// (potentially PII-bearing) key segment into a tag.
function keyTag(part: unknown): string | undefined {
  return typeof part === 'string' ? part : undefined;
}

/**
 * The single global QueryCache.onError (v5 removed per-query onError, D-14).
 * Exported so the behavioral test can feed it a real ZodError directly (GAP5).
 *
 * @param error the query error (Error subclass at runtime).
 * @param query anything carrying a `queryKey` (a live Query, or a test stub).
 */
export function queryCacheOnError(
  error: unknown,
  query: { queryKey: ReadonlyArray<unknown> }
): void {
  const tags = {
    entity: keyTag(query.queryKey?.[0]),
    scope: keyTag(query.queryKey?.[1]),
  };

  if (error instanceof ZodError) {
    // T-84-05: NEVER forward the raw ZodError — its issues may carry
    // `received`/input values (PII). Forward ONLY {path, code} per issue.
    const zodIssues = error.issues.map((i) => ({ path: i.path, code: i.code }));
    Sentry.captureException(new Error('validatedQueryFn schema drift'), {
      tags,
      extra: { zodIssues },
    });
    return;
  }

  // ApiError / network / unknown — forward as-is with entity/scope tags only.
  Sentry.captureException(error, { tags });
}

function makeQueryClient(): QueryClient {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => queryCacheOnError(error, query),
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000, // D-13
        gcTime: 300_000,
        refetchOnWindowFocus: false,
        refetchOnReconnect: true,
        retry: shouldRetry, // PREDICATE, not a flat count (T-84-08)
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a FRESH client on the server (no cross-request cache bleed, T-84-07)
 * and a module-scoped singleton in the browser. NOT useState — the factory
 * already guards the browser singleton.
 */
export function getQueryClient(): QueryClient {
  if (isServer) return makeQueryClient();
  if (!browserQueryClient) browserQueryClient = makeQueryClient();
  return browserQueryClient;
}
