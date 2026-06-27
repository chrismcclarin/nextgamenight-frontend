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
import { ApiError } from '@/lib/api';
import { getQueryClient, queryCacheOnError, shouldRetry } from '@/lib/queryClient';

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
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

  it.each(['unauthorized', 'forbidden', 'not_found', 'validation'] as const)(
    'never retries non-transient ApiError code %s',
    (code) => {
      expect(shouldRetry(0, new ApiError('x', code, 400))).toBe(false);
    }
  );

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
