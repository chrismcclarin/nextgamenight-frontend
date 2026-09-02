// Verification pins for the ApiError seam (TS-02 / D-07).
// Proves the error-code contract every call site reads (`err.code`) is stable
// AND that mapErrorToCode already prefers an envelope `code` — so the BAPI-01
// swap in Phase 85 is a one-function rewrite that leaves call sites untouched.
// Mostly pure (no fetch mock); the one exception is the network-failure
// classification block, which stubs global fetch to pin the WR-04 contract.
import { afterEach, vi } from 'vitest';

import { ApiError, apiFetch, mapErrorToCode, rsvpAPI } from './api';

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

  it('maps a code-less 410 → gone (M-2: terminal, matching the coded 410s)', () => {
    expect(mapErrorToCode({}, 410)).toBe('gone');
    // A coded 410 still prefers its envelope code — the fallback must not mask it.
    expect(mapErrorToCode({ code: 'window_expired' }, 410)).toBe('window_expired');
  });

  it('maps a code-less 409 → conflict (88-CODE-REVIEW D2: terminal, never retried)', () => {
    expect(mapErrorToCode({}, 409)).toBe('conflict');
    // A coded 409 still prefers its envelope code, same as the 410 rule above.
    expect(mapErrorToCode({ code: 'owner_of_active_groups' }, 409)).toBe('owner_of_active_groups');
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

describe('apiFetch — network-failure classification (WR-04)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("converts Safari's TypeError('Load failed') into ApiError code 'network'", async () => {
    // Any TypeError from fetch() is a network failure; the message text is
    // engine-specific (Chrome: "Failed to fetch", Safari: "Load failed"), so
    // the seam must classify on the type alone — a message-substring gate
    // would misroute Safari failures into the definitive lane (Pitfall 9).
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Load failed'))
    );
    const rejection = apiFetch('/users/me');
    await expect(rejection).rejects.toBeInstanceOf(ApiError);
    await expect(rejection).rejects.toMatchObject({ code: 'network', status: 0 });
  });

  it('rethrows a non-TypeError (abort) untouched', async () => {
    const abort = new DOMException('The user aborted a request.', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(apiFetch('/users/me')).rejects.toBe(abort);
  });
});

// Phase 88.5 (Owner Ruling 1a) — wire-level pin for the note-preservation
// contract. The backend distinguishes "no opinion about the note" (key ABSENT)
// from "clear the note" (key present, null/empty). That distinction only holds
// because JSON.stringify DROPS an undefined-valued key. If a future refactor of
// submitRsvp normalizes `note` to `null`, every status-only hero-card tap starts
// wiping the tapper's saved note again — silently, with no type error and no
// failing component test. This test is the thing that catches it.
describe('rsvpAPI.submitRsvp — undefined note is dropped from the wire body', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okJson = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '{"id":"r1","status":"yes"}',
    });

  it('omits the note key entirely when note is not passed', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await rsvpAPI.submitRsvp('e1', 'yes');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // Presence, not truthiness: `'note' in body` must be false. A `note: null`
    // or `note: undefined` key here would be a REGRESSION, not an equivalent.
    expect('note' in body).toBe(false);
    expect(Object.keys(body).sort()).toEqual(['event_id', 'status']);
    expect(body).toEqual({ event_id: 'e1', status: 'yes' });
  });

  it('omits the note key when note is explicitly undefined', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await rsvpAPI.submitRsvp('e1', 'maybe', undefined);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect('note' in body).toBe(false);
  });

  it('SENDS the note key with value null when null is passed (explicit clear — the RsvpSection Save-note path)', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await rsvpAPI.submitRsvp('e1', 'yes', null);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // The key must be PRESENT (`null` serializes, unlike `undefined`) — the
    // backend's clear semantics key on presence, and the signature admits null
    // for exactly this caller (api.ts submitRsvp comment, ML4).
    expect('note' in body).toBe(true);
    expect(body.note).toBeNull();
  });

  it('SENDS the note key when a note is passed — including an empty string (explicit clear)', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await rsvpAPI.submitRsvp('e1', 'yes', '');

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    // The other half of the contract: an explicit clear must still reach the
    // backend as a present key, or a member could never delete their own note.
    expect('note' in body).toBe(true);
    expect(body.note).toBe('');
  });
});
