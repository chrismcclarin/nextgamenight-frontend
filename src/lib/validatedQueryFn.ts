/**
 * validatedQueryFn — the parse-before-cache boundary (D-12 / C-004).
 *
 * A thin Zod-parse boundary over the EXISTING `apiFetch` seam: it runs apiFetch
 * once and parses the result BEFORE the value enters the React Query cache, so
 * malformed/untrusted API JSON never reaches UI state (T-84-06). A ZodError
 * propagates to `QueryCache.onError` → Sentry (scrubbed). It does NOT
 * re-implement fetch, Auth0 token injection, or error typing — those stay in
 * `api.ts` (an ApiError from apiFetch propagates unchanged). The generic is
 * preserved so callers get `z.infer` types (WS-12).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * FOUNDATION RULE (every later-wave validatedQueryFn migration INHERITS this):
 *
 *   Adopting validatedQueryFn on a NEW endpoint REQUIRES a contract test in
 *   *.contract.test.ts that:
 *     (1) targets that ACTUAL consumed endpoint's schema (not a generic shape),
 *     (2) parses a CAPTURED real BE response through a `.passthrough()` schema
 *         (so additive BE keys don't break the FE),
 *     (3) asserts the UI-CONSUMED fields are present + correctly typed AND that
 *         removing/renaming a consumed field FAILS the parse.
 *   "parse does not throw" alone is NOT sufficient — the test must detect
 *   realistic shape drift. Reference: validatedQueryFn.contract.test.ts
 *   (GET /api/games → GameSchema.passthrough()).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import type { ZodType } from 'zod';
import { apiFetch } from '@/lib/api';

export function validatedQueryFn<T>(schema: ZodType<T>, url: string) {
  return async (): Promise<T> => {
    const raw = await apiFetch<unknown>(url); // throws ApiError on !ok (existing seam)
    return schema.parse(raw); // throws ZodError → QueryCache.onError → Sentry
  };
}
