import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as Sentry from '@sentry/nextjs';
import { logger } from './logger';

// GAP1: prove logger -> Sentry routing/argument shapes behaviorally (not by grep),
// with @sentry/nextjs fully mocked so we assert against the recorded call args.
vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

describe('logger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logger.error(msg, err) forwards the error object and lands msg in extra', () => {
    const err = new Error('boom');
    logger.error('something failed', err);

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { msg: 'something failed' },
    });
  });

  it('logger.error(msg) with no error arg synthesizes an Error(msg) + extra.msg', () => {
    logger.error('lonely message');

    expect(Sentry.captureException).toHaveBeenCalledTimes(1);
    const [arg, opts] = (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(arg).toBeInstanceOf(Error);
    expect((arg as Error).message).toBe('lonely message');
    expect(opts).toEqual({ extra: { msg: 'lonely message' } });
  });

  // ADDED by plan 88.6-58 task 5 (2026-09-28, /code-adversarial-review 88.6 MEDLOW-13, AC-4
  // arm A). After the error-alias drop the backend's own string rides ONLY on
  // `ApiError.upstreamMessage`, and before this plan only `queryCacheOnError` forwarded it —
  // so the mutation/action paths, which all reach Sentry through `logger.error`, lost it.
  // The error is matched STRUCTURALLY (no `ApiError` import: api.ts imports this module).
  it('logger.error forwards a string `upstreamMessage` off the error into extra', () => {
    const err = Object.assign(new Error('HTTP error! status: 409'), {
      upstreamMessage: 'This availability prompt no longer exists.',
    });
    logger.error('save failed', err);

    expect(Sentry.captureException).toHaveBeenCalledWith(err, {
      extra: { msg: 'save failed', upstreamMessage: 'This availability prompt no longer exists.' },
    });
  });

  it('CONFIRM-ONLY: a plain Error lands `{ extra: { msg } }` exactly — no upstreamMessage key', () => {
    const err = new Error('plain');
    logger.error('x', err);

    const [, opts] = (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(opts).toEqual({ extra: { msg: 'x' } });
    expect(Object.keys(opts.extra)).toEqual(['msg']);
  });

  it('a NON-string `upstreamMessage` is not forwarded (string-only structural read, T-88.6-G30)', () => {
    const err = Object.assign(new Error('odd'), { upstreamMessage: { body: 'whole parsed body' } });
    logger.error('y', err);

    expect(Sentry.captureException).toHaveBeenCalledWith(err, { extra: { msg: 'y' } });
  });

  it('logger.warn(msg, ctx) routes to captureMessage at warning level with ctx in extra', () => {
    logger.warn('heads up', { k: 1 });

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    expect(Sentry.captureMessage).toHaveBeenCalledWith('heads up', {
      level: 'warning',
      extra: { k: 1 },
    });
  });

  it('logger.info(msg, ctx) routes to addBreadcrumb at info level with ctx in data', () => {
    logger.info('fyi', { k: 1 });

    expect(Sentry.addBreadcrumb).toHaveBeenCalledTimes(1);
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      message: 'fyi',
      level: 'info',
      data: { k: 1 },
    });
  });

  it('does not spread raw response bodies/tokens/PII into the Sentry payload', () => {
    // The caller passes ONLY msg + the error object. A token-bearing field that
    // is NOT part of msg/ctx/err must never appear in the recorded call args.
    const err = new Error('request failed');
    logger.error('fetch failed', err);

    const recorded = JSON.stringify(
      (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mock.calls
    );
    // Only msg + the error reach Sentry; no extra keys are injected by the helper.
    const [, opts] = (Sentry.captureException as unknown as ReturnType<typeof vi.fn>).mock
      .calls[0];
    expect(Object.keys(opts.extra)).toEqual(['msg']);
    expect(recorded).not.toContain('Bearer ');
    expect(recorded).not.toContain('token');
  });
});
