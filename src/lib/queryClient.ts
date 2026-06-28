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
// risk against our own backend (T-84-08).
const NON_RETRYABLE_API_CODES: ReadonlyArray<string> = [
  'unauthorized',
  'forbidden',
  'not_found',
  'validation',
  // 429: the backend is explicitly asking us to slow down — an immediate retry
  // worsens the rate-limit storm we're trying to avoid (T-84-08). Honoring
  // Retry-After backoff is a later enhancement; for now, do not retry.
  'rate_limited',
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
