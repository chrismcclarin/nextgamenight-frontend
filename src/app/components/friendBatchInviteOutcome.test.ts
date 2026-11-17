// 88.9-52 review A-15: the proxy's same-origin refusal is a 403 with no code, which the client maps
// to forbidden. It says nothing about the invite, so it must not count as a permanent refusal (a
// permanent refusal unticks the friend, and nobody was invited).
import { describe, it, expect } from 'vitest';
import { ApiError } from '../../lib/api';
import { isPermanentInviteRefusal, PERMANENT_INVITE_REFUSALS } from './friendBatchInviteOutcome';

describe('isPermanentInviteRefusal', () => {
  it('a proxy same-origin refusal (403, csrf_rejected) is transient, so the friend stays ticked', () => {
    const err = new ApiError('x', 'forbidden', 403, { csrf_rejected: true });
    expect(isPermanentInviteRefusal(err)).toBe(false);
  });

  it('a plain forbidden answer from the backend stays permanent', () => {
    expect(isPermanentInviteRefusal(new ApiError('x', 'forbidden', 403))).toBe(true);
    expect(isPermanentInviteRefusal(new ApiError('x', 'forbidden', 403, { csrf_rejected: false }))).toBe(true);
  });

  it('every listed code is permanent; a transient code and a non-ApiError are not', () => {
    for (const code of PERMANENT_INVITE_REFUSALS) {
      expect(isPermanentInviteRefusal(new ApiError('x', code, 400))).toBe(true);
    }
    expect(isPermanentInviteRefusal(new ApiError('x', 'network', 0))).toBe(false);
    expect(isPermanentInviteRefusal(new Error('x'))).toBe(false);
  });
});
