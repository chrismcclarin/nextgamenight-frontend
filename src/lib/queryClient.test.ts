/**
 * Behavioral gate for the TanStack Query foundation (D-13 / D-14, T-84-05/06/07/08).
 *
 * This is the GATE — NOT grep. It proves, by behavior:
 *   GAP4 — a rejecting queryFn routed through the wired QueryCache.onError fires
 *          Sentry.captureException ONCE, tagged { entity, scope } sourced from
 *          queryKey[0]/[1] (NOT JSON.stringify(queryKey)).
 *   GAP5 — a real ZodError carrying a `received`/input PII value is forwarded to
 *          Sentry as ONLY issues.map({path,code}); the raw value is ABSENT from
 *          the captured captureException arguments.
 *   GAP6 — the retry predicate truth table: false for ZodError + the four
 *          non-transient ApiError codes, true on the first transient failure,
 *          false on the second.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { ApiError, apiFetch } from '@/lib/api';
import { getQueryClient, queryCacheOnError, shouldRetry } from '@/lib/queryClient';

// `addBreadcrumb` joined this mock in 88.6-42: `lib/api.ts` now routes its own
// developer logs through `logger.info` (AC-2), which calls it, and the end-to-end arm below
// drives a REAL apiFetch rejection through that path.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  addBreadcrumb: vi.fn(),
  captureMessage: vi.fn(),
}));

// The 2nd captureException arg is a wide Sentry union; in these tests we only
// ever pass the `{ tags, extra }` object shape, so narrow it for assertions.
type CaptureCtx = { tags?: Record<string, unknown>; extra?: Record<string, unknown> };
const ctxOf = (callIndex = 0): CaptureCtx =>
  vi.mocked(Sentry.captureException).mock.calls[callIndex][1] as CaptureCtx;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getQueryClient()', () => {
  it('returns a singleton in the browser (jsdom)', () => {
    expect(getQueryClient()).toBe(getQueryClient());
  });
});

describe('GAP4 — QueryCache.onError → Sentry escalation (wired, via a live query)', () => {
  it('fires captureException ONCE tagged {entity,scope} from queryKey[0]/[1]', async () => {
    const client = getQueryClient();
    await client
      .fetchQuery({
        queryKey: ['games', 'list'],
        queryFn: () => Promise.reject(new ApiError('boom', 'not_found', 404)),
        retry: false,
      })
      .catch(() => {});

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const opts = ctxOf();
    expect(opts.tags).toMatchObject({ entity: 'games', scope: 'list' });
    // The full key must NEVER be serialized into a tag (PII guard, T-84-05).
    expect(opts.tags).not.toHaveProperty('queryKey');
  });
});

describe('GAP5 — ZodError PII-scrub (T-84-05)', () => {
  it('forwards ONLY issues.map({path,code}); raw received/input value is ABSENT', () => {
    // A REAL ZodError instance whose issue carries a PII value in BOTH `received`
    // and the human message (the worst case the scrub must defuse).
    const leaky = new ZodError([
      {
        code: 'invalid_type',
        expected: 'number',
        // @ts-expect-error — `received` is a legacy/extra issue field carrying the raw value.
        received: 'SECRET_PII',
        path: ['games', 0, 'min_players'],
        message: "Invalid input: got 'SECRET_PII'",
      },
    ]);

    queryCacheOnError(leaky, { queryKey: ['games', 'list'] });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const errArg = vi.mocked(Sentry.captureException).mock.calls[0][0];
    const opts = ctxOf();

    // A scrubbed sentinel Error is forwarded, NOT the raw ZodError.
    expect(errArg).toBeInstanceOf(Error);
    expect(errArg).not.toBeInstanceOf(ZodError);

    // Only {path, code} survives per issue.
    expect(opts.extra?.zodIssues).toEqual([{ path: ['games', 0, 'min_players'], code: 'invalid_type' }]);

    // Entity/scope tags still present.
    expect(opts.tags).toMatchObject({ entity: 'games', scope: 'list' });

    // The raw PII value must be ABSENT from EVERYTHING captured.
    expect(JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0])).not.toContain('SECRET_PII');
  });

  it('forwards non-Zod errors (ApiError/network) as-is with entity/scope tags', () => {
    const apiErr = new ApiError('nope', 'forbidden', 403);
    queryCacheOnError(apiErr, { queryKey: ['groups', 'detail'] });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const errArg = vi.mocked(Sentry.captureException).mock.calls[0][0];
    expect(errArg).toBe(apiErr);
    expect(ctxOf().tags).toMatchObject({ entity: 'groups', scope: 'detail' });
  });
});

describe('GAP6 — retry predicate truth table (D-13, T-84-08)', () => {
  it('never retries a ZodError', () => {
    expect(shouldRetry(0, new ZodError([]))).toBe(false);
  });

  it.each(['unauthorized', 'forbidden', 'not_found', 'validation', 'rate_limited'] as const)(
    'never retries non-transient ApiError code %s',
    (code) => {
      expect(shouldRetry(0, new ApiError('x', code, 400))).toBe(false);
    }
  );

  it('never retries a status-mapped code-less 410 (M-2: gone is terminal)', () => {
    expect(shouldRetry(0, new ApiError('x', 'gone', 410))).toBe(false);
  });

  // 88-33 Task 2 / Fork F: one dedicated row PER new group-invite 409 code
  // (88-34 Task 4's ERROR_REGISTRY entries). A verified-terminal conflict is
  // never retried — 88-CODE-REVIEW D2. Deliberately NOT folded into the
  // `it.each` above: these two are the codes the plan requires proof for, and a
  // row that disappears into a shared list is a row nobody notices losing.
  it('never retries already_member (409 terminal conflict — D2)', () => {
    expect(shouldRetry(0, new ApiError('x', 'already_member', 409))).toBe(false);
  });

  it('never retries invite_pending (409 terminal conflict — D2)', () => {
    expect(shouldRetry(0, new ApiError('x', 'invite_pending', 409))).toBe(false);
  });

  /* Phase 88.6-38 (88.8 code review round 7 #5): `queryClient.ts:111`'s
     `unsupported_address` row shipped in the 88.8 post-merge fix set with NO test — the
     registry's own comment there calls itself out as changing nothing today, which is
     exactly the shape a later reader deletes. On the `:122-133` convention above: a
     DEDICATED row per code, not folded into the `it.each`, because a row that disappears
     into a shared list is a row nobody notices losing. What it asserts: the predicate
     classifies the synthetic-target 400 as TERMINAL, so `shouldRetry` refuses it on the
     first failure — correct because the backend refusal is a pure function of the address
     (`provisioningService.js:142-147`), so an identical retry returns an identical 400.
     Demonstrated RED by deleting the registry row, which makes the code fall through to
     the `failureCount < 1` transient default and return true. */
  it('never retries unsupported_address (400 terminal — the refusal is a pure function of the address)', () => {
    expect(shouldRetry(0, new ApiError('x', 'unsupported_address', 400))).toBe(false);
  });

  it('retries a transient failure at most once', () => {
    const networkErr = new ApiError('down', 'network', 0);
    expect(shouldRetry(0, networkErr)).toBe(true);
    expect(shouldRetry(1, networkErr)).toBe(false);
  });

  it('retries a generic (5xx-ish) error once, then stops', () => {
    const transient = new Error('500 boom');
    expect(shouldRetry(0, transient)).toBe(true);
    expect(shouldRetry(1, transient)).toBe(false);
  });
});

describe('88.6-42 / AC-4 arm A — the backend string rides in `extra`, never in `tags`', () => {
  // Added by plan 88.6-42 task 1 (2026-09-17). The owner ruled (2026-09-09, AC-4 a) that the
  // backend's own error string is RETAINED for Sentry after the `body.error` alias drop, on a
  // NON-RENDERED `ApiError` field. This is the forward that makes the ruling real. Without a
  // behavioral pin here, the "a STRING, never `errorData`" prohibition in the plan is prose
  // with no machine behind it — which is the failure mode this suite exists to close.
  it('forwards ApiError.upstreamMessage in the capture extra', () => {
    const err = new ApiError('HTTP error! status: 500', 'internal', 500, { error: 'pg: boom' }, 'pg: boom');
    queryCacheOnError(err, { queryKey: ['games', 'list'] });

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const opts = ctxOf();
    expect(opts.extra).toMatchObject({ upstreamMessage: 'pg: boom' });
    // NEVER a tag: tags are indexed and this value has unbounded cardinality.
    expect(opts.tags).not.toHaveProperty('upstreamMessage');
    expect(opts.tags).toMatchObject({ entity: 'games', scope: 'list' });
  });

  it('PINS the forwarded value as `string | undefined` — never `errorData`, never the body', () => {
    // R8 §10. A future widening of the field to carry the parsed body would keep every other
    // assertion in this file green; this is the one that reds.
    const err = new ApiError('HTTP error! status: 500', 'internal', 500, { error: 'pg: boom', sql: 'SELECT 1' }, 'pg: boom');
    queryCacheOnError(err, { queryKey: ['games', 'list'] });

    const forwarded = ctxOf().extra?.upstreamMessage;
    expect(typeof forwarded === 'string' || forwarded === undefined).toBe(true);
    expect(forwarded).not.toBeTypeOf('object');
    // …and nothing else off the body travelled INTO THE EXTRA with it. (The whole parsed
    // body still rides on `ApiError.details`, as it always has — that is the pre-existing
    // D-07 seam and sentry.scrub.js's beforeSend is its bound. What arm A must not do is
    // ADD a second copy of it under a new key.)
    expect(JSON.stringify(ctxOf())).not.toContain('SELECT 1');
    expect(Object.keys(ctxOf().extra ?? {})).toEqual(['upstreamMessage']);
  });

  it('adds NO extra at all when the ApiError carries no upstream string', () => {
    // The common case after Phase 93 converts the emitters: a converted route sends a
    // `message`, there is no legacy key, and the capture stays exactly as it was.
    queryCacheOnError(new ApiError('Envelope message', 'not_found', 404), {
      queryKey: ['games', 'list'],
    });
    expect(ctxOf().extra).toBeUndefined();
  });

  it('a REAL rejection whose body carried ONLY the legacy key reaches Sentry with it', async () => {
    // End-to-end through the wired QueryCache, not a hand-built ApiError: this is the arm that
    // proves the whole chain (apiFetch -> extractUpstreamMessage -> ApiError -> capture).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => '{"error":"pg: duplicate key"}' })
    );
    const client = getQueryClient();
    await client
      .fetchQuery({ queryKey: ['games', 'list'], queryFn: () => apiFetch('/games'), retry: false })
      .catch(() => {});
    vi.unstubAllGlobals();

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const captured = vi.mocked(Sentry.captureException).mock.calls[0][0] as ApiError;
    // The DISPLAY contract is untouched — the backend string is NOT the message…
    expect(captured.message).toBe('HTTP error! status: 500');
    // …but it is still readable on the event, which is the whole of arm A.
    expect(ctxOf().extra).toMatchObject({ upstreamMessage: 'pg: duplicate key' });
  });
});
