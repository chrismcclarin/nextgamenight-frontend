// Verification pins for the ApiError seam (TS-02 / D-07).
// Proves the error-code contract every call site reads (`err.code`) is stable
// AND that mapErrorToCode already prefers an envelope `code` — so the BAPI-01
// swap in Phase 85 is a one-function rewrite that leaves call sites untouched.
// Pure: no network / no fetch mock needed for these assertions.
import { ApiError, mapErrorToCode } from './api';

describe('ApiError — shape', () => {
  it('is both an Error and an ApiError, carrying code + status + details', () => {
    const err = new ApiError('too many', 'rate_limited', 429, { retryAfter: 30 });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.message).toBe('too many');
    expect(err.code).toBe('rate_limited');
    expect(err.status).toBe(429);
    expect(err.details).toEqual({ retryAfter: 30 });
  });
});

describe('mapErrorToCode — status mapping', () => {
  it('maps 401 → unauthorized', () => {
    expect(mapErrorToCode({}, 401)).toBe('unauthorized');
  });

  it('maps 403 → forbidden', () => {
    expect(mapErrorToCode({}, 403)).toBe('forbidden');
  });

  it('maps 404 → not_found', () => {
    expect(mapErrorToCode({}, 404)).toBe('not_found');
  });

  it('maps 429 → rate_limited', () => {
    expect(mapErrorToCode({}, 429)).toBe('rate_limited');
  });

  it('maps 422 → validation', () => {
    expect(mapErrorToCode({}, 422)).toBe('validation');
  });

  it('maps an errors[] body to validation regardless of status', () => {
    expect(mapErrorToCode({ errors: [{ message: 'x' }] }, 400)).toBe('validation');
  });

  it('defaults to unknown for an unmapped status', () => {
    expect(mapErrorToCode({}, 200)).toBe('unknown');
  });
});

describe('mapErrorToCode — envelope code preference (BAPI-01 forward-compat)', () => {
  it('prefers an explicit body.code over status mapping', () => {
    // The future {code} envelope wins even when status would map elsewhere.
    // Asserted via a string var so the future-domain code is not type-narrowed.
    const result: string = mapErrorToCode({ code: 'reminder_cooldown' }, 400);
    expect(result).toBe('reminder_cooldown');
  });
});
