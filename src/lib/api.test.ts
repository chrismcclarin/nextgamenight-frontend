// Verification pins for the ApiError seam (TS-02 / D-07).
// Proves the error-code contract every call site reads (`err.code`) is stable
// AND that mapErrorToCode already prefers an envelope `code` — so the BAPI-01
// swap in Phase 85 is a one-function rewrite that leaves call sites untouched.
// Mostly pure (no fetch mock); the one exception is the network-failure
// classification block, which stubs global fetch to pin the WR-04 contract.
import { afterEach, vi } from 'vitest';

import {
  ApiError,
  apiFetch,
  availabilityFormAPI,
  magicAuthAPI,
  mapErrorToCode,
  rsvpAPI,
  rsvpPublicAPI,
  usersAPI,
} from './api';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

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

  // AMENDED Phase 88.6-42 (2026-09-17): the validation hint no longer reads a TOP-LEVEL
  // `errors[]` — that legacy mirror arm was dropped and the hint now reads the canonical
  // `details.errors`. The 400 outcome below is UNCHANGED, but it now comes from
  // statusToCode(400) rather than from the body, so the old title's 'regardless of status'
  // is no longer true. The regardless-of-status property is re-pinned on the canonical
  // shape, and the mirror's fall-through is pinned, in the 88.6-42 describe at the foot of
  // this file.
  it('maps a details.errors body to validation regardless of status', () => {
    expect(mapErrorToCode({ details: { errors: [{ message: 'x' }] } }, 400)).toBe('validation');
    expect(mapErrorToCode({ details: { errors: [{ message: 'x' }] } }, 500)).toBe('validation');
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

// Phase 88.8 plan 13 (SPEC R12) — WIRE-LEVEL pins for the five email-change
// calls. These stub `fetch` and call the REAL client function, so the
// body-construction line in api.ts actually executes.
//
// WHY NOT AT THE MOCK. The section's colocated suite mocks `usersAPI` at the
// module boundary, which makes it structurally blind to the wire: the functions
// take SCALARS, so a module-boundary mock never receives a body object at all
// and `JSON.stringify` never runs. An assertion there would be checking the
// mock's own arguments. The backend suite has the mirror-image blindness — it is
// written by whoever wrote the route, so it agrees with itself. A request-key
// mismatch is invisible to BOTH CIs; in production every Save would return the
// validation envelope and the field would read "Something looks off with that
// request", killing R12 silently. These assertions are the only thing standing
// there. The exact key-SET check (not a `toMatchObject`) is deliberate: an added
// alias key must fail, and the backend refuses any body carrying a second key
// (routes/users.js:1226-1229, :1760-1763).
//
// NO `grep`-based key gate is added on api.ts. The body is written in ES6
// shorthand, so there is no colon after the key and a colon-anchored grep fails
// a CORRECT implementation; and the same pattern matches the TypeScript
// parameter annotation, so it passes the WRONG one. Inverted on both arms.
describe('usersAPI email-change calls — the serialised wire body, path and method', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const okJson = () =>
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () =>
        '{"outcome":"code_sent","email":"a@b.c","pending_email_change":null,"verification_sent":true,"email_changed_at":null,"revert_available":false}',
    });

  const callOf = (fetchMock: ReturnType<typeof vi.fn>) => {
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    return { url, init };
  };

  it('requestEmailChange POSTs exactly { email } to /users/:id/email', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await usersAPI.requestEmailChange('u-1', 'new@example.com');

    const { url, init } = callOf(fetchMock);
    expect(url).toContain('/users/u-1/email');
    expect(url).not.toContain('/email/');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    // EXACT key set: an added alias (`new_email`, `address`) must fail here,
    // because the backend refuses a body with more than the one key.
    expect(Object.keys(body).sort()).toEqual(['email']);
    expect(body.email).toBe('new@example.com');
  });

  it('verifyEmailChange POSTs exactly { code } to /users/:id/email/verify', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await usersAPI.verifyEmailChange('u-1', 'AB12CD34');

    const { url, init } = callOf(fetchMock);
    expect(url).toContain('/users/u-1/email/verify');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body as string);
    expect(Object.keys(body).sort()).toEqual(['code']);
    expect(body.code).toBe('AB12CD34');
  });

  it('resendEmailChangeCode POSTs NO body to /users/:id/email/resend', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await usersAPI.resendEmailChangeCode('u-1');

    const { url, init } = callOf(fetchMock);
    expect(url).toContain('/users/u-1/email/resend');
    expect(init.method).toBe('POST');
    // A resend that accepted an address would be a second REQUEST endpoint
    // wearing the first one's name (SPEC A11) — the address comes from the
    // stored token row, never from the client.
    expect(init.body).toBeUndefined();
  });

  it('cancelEmailChange POSTs NO body to /users/:id/email/cancel', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await usersAPI.cancelEmailChange('u-1');

    const { url, init } = callOf(fetchMock);
    expect(url).toContain('/users/u-1/email/cancel');
    expect(init.method).toBe('POST');
    // A route that accepts no address cannot discard the wrong thing.
    expect(init.body).toBeUndefined();
  });

  it('revertEmailToSignIn POSTs NO body to /users/:id/email/revert', async () => {
    const fetchMock = okJson();
    vi.stubGlobal('fetch', fetchMock);

    await usersAPI.revertEmailToSignIn('u-1');

    const { url, init } = callOf(fetchMock);
    expect(url).toContain('/users/u-1/email/revert');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('percent-encodes the user_id path segment on every one of the five', async () => {
    // The id can be an Auth0 sub (`auth0|abc`) as well as a UUID — matchesSelf
    // accepts either (middleware/objectAuth.js:59-84) — and a raw `|` in a path
    // is not a legal URL character.
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['email', () => usersAPI.requestEmailChange('auth0|a b', 'x@y.z')],
      ['email/verify', () => usersAPI.verifyEmailChange('auth0|a b', 'AB12CD34')],
      ['email/resend', () => usersAPI.resendEmailChangeCode('auth0|a b')],
      ['email/cancel', () => usersAPI.cancelEmailChange('auth0|a b')],
      ['email/revert', () => usersAPI.revertEmailToSignIn('auth0|a b')],
    ];
    for (const [suffix, run] of calls) {
      const fetchMock = okJson();
      vi.stubGlobal('fetch', fetchMock);
      await run();
      const { url } = callOf(fetchMock);
      expect(url).toContain(`/users/auth0%7Ca%20b/${suffix}`);
      vi.unstubAllGlobals();
    }
  });
});

// ---------------------------------------------------------------------------------------
// Phase 88.6-42 — the alias drop, proven by a LEGACY-ONLY BODY FALLING THROUGH
// ---------------------------------------------------------------------------------------
// The load-bearing half of every pair below is the SECOND assertion. A canonical body
// resolving correctly proves nothing about the drop — it resolved correctly before too.
// Only a body carrying the legacy key AND NOTHING ELSE, resolving to the generic path,
// proves the arm was removed rather than merely reordered.
describe('88.6-42 — the FE reads code/message/details and nothing else', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Drive apiFetch against a not-ok response and CAPTURE the rejection. */
  const rejection = async (status: number, bodyText: string): Promise<ApiError> => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status, text: async () => bodyText })
    );
    // An async `.not.toThrow()` is vacuous — it asserts on the PROMISE, not the
    // rejection. Capture it and assert on the value.
    let caught: unknown = null;
    try {
      await apiFetch('/anything');
    } catch (err) {
      caught = err;
    }
    expect(caught, 'apiFetch must REJECT on a non-ok response').toBeInstanceOf(ApiError);
    return caught as ApiError;
  };

  describe('the message chain (formerly `body.message ?? body.error ?? status`)', () => {
    it('reads the envelope `message`', async () => {
      const err = await rejection(400, '{"message":"That name is already taken."}');
      expect(err.message).toBe('That name is already taken.');
    });

    it('FALLS THROUGH for a legacy-only body — the `body.error` arm is GONE', async () => {
      const err = await rejection(400, '{"error":"Legacy alias text"}');
      expect(err.message).toBe('HTTP error! status: 400');
      expect(err.message).not.toContain('Legacy alias text');
      // …and the code still resolves off the status, so nothing downstream loses a kind.
      expect(err.code).toBe('validation');
    });
  });

  describe('the validation hint (formerly a TOP-LEVEL `errors[]`)', () => {
    it('reads the canonical `details.errors`, whatever the status', () => {
      expect(mapErrorToCode({ details: { errors: [{ message: 'x' }] } }, 500)).toBe('validation');
    });

    it('FALLS THROUGH for a top-level `errors[]` — the legacy mirror arm is GONE', () => {
      // 500 is chosen deliberately: under the old arm this returned `validation`
      // "regardless of status". It now maps off the status like any other body.
      expect(mapErrorToCode({ errors: [{ message: 'x' }] }, 500)).toBe('internal');
      // On a 400 the OUTCOME is unchanged, which is why the three unconverted backend
      // producers measured 2026-09-17 (routes/invites.js:216, routes/friendships.js:278,
      // routes/availability.js:55-64 — all top-level `errors[]` on a 400) are
      // behaviour-neutral across this change.
      expect(mapErrorToCode({ errors: [{ message: 'x' }] }, 400)).toBe('validation');
    });

    it('does not produce `validation` (and does not throw) on a malformed `details.errors`', () => {
      expect(mapErrorToCode({ details: { errors: 'not an array' } }, 500)).toBe('internal');
    });
  });

  describe('the field errors (formerly `details.errors ?? errors`)', () => {
    it('formats the canonical `details.errors`', async () => {
      const err = await rejection(
        400,
        '{"details":{"errors":[{"message":"Name is required"},{"field":"email","msg":"invalid"}]}}'
      );
      expect(err.message).toBe('Name is required. email: invalid');
    });

    it('FALLS THROUGH for a top-level `errors[]` — the second arm is GONE', async () => {
      const err = await rejection(400, '{"errors":[{"message":"Name is required"}]}');
      expect(err.message).toBe('HTTP error! status: 400');
      expect(err.message).not.toContain('Name is required');
    });
  });

  describe('T-88.6-118 — a non-JSON error response still surfaces its text', () => {
    it('carries the raw body text through as the message', async () => {
      const err = await rejection(502, 'Bad Gateway: upstream timed out');
      expect(err.message).toBe('Bad Gateway: upstream timed out');
    });

    it('falls back to the status template for an EMPTY non-JSON body', async () => {
      const err = await rejection(502, '');
      expect(err.message).toBe('HTTP error! status: 502');
    });
  });

  describe('T-88.6-119 / D25 — a malformed `details` never renders `undefined: undefined`', () => {
    const SHAPES: Array<[string, string]> = [
      ['null', 'null'],
      ['a JSON string', '"just a string"'],
      ['a number', '42'],
      ['a top-level array', '[]'],
      ['errors as a string', '{"errors":"x"}'],
      ['details.errors as a string', '{"details":{"errors":"x"}}'],
      ['details.errors of empty objects', '{"details":{"errors":[{}]}}'],
      ['details.errors of nulls', '{"details":{"errors":[null,null]}}'],
      ['details.errors half-populated', '{"details":{"errors":[{},{"field":"a"}]}}'],
    ];

    it.each(SHAPES)('rejects cleanly for %s', async (_label, body) => {
      const err = await rejection(400, body);
      expect(err.code).toBe('validation');
      expect(err.message).not.toContain('undefined');
      // …and the copy a person would actually see is a REGISTER string, never this.
      expect(getFetchErrorMessage(err)).toBe(
        'Something looks off with that request. Refresh the page to try again.'
      );
    });

    it('drops the entries that can render nothing and keeps the ones that can', async () => {
      const err = await rejection(
        400,
        '{"details":{"errors":[{},{"message":"Name is required"},null,{"field":"email","msg":"invalid"}]}}'
      );
      expect(err.message).toBe('Name is required. email: invalid');
    });
  });

  describe('AC-4 arm A — the backend string moves OFF the display path, not away', () => {
    it('populates `upstreamMessage` from the legacy key while `message` ignores it', async () => {
      const err = await rejection(500, '{"error":"pg: duplicate key value"}');
      expect(err.upstreamMessage).toBe('pg: duplicate key value');
      expect(err.message).toBe('HTTP error! status: 500');
    });

    it('leaves it undefined when the body carries no legacy key', async () => {
      const err = await rejection(500, '{"message":"Envelope message"}');
      expect(err.upstreamMessage).toBeUndefined();
      expect(err.message).toBe('Envelope message');
    });

    it('carries a STRING or undefined — never the body, never a widened payload', async () => {
      // R8 §10, stated as a prohibition and pinned as a type. A non-string legacy value
      // (an object, an array, a number) must not ride the field.
      const objectValued = await rejection(500, '{"error":{"nested":"object"}}');
      expect(objectValued.upstreamMessage).toBeUndefined();
      const stringValued = await rejection(500, '{"error":"plain"}');
      expect(typeof stringValued.upstreamMessage).toBe('string');
    });

    it('is populated on the FIELD-ERROR throw path too, not only the plain one', async () => {
      const err = await rejection(
        400,
        '{"error":"legacy too","details":{"errors":[{"message":"Name is required"}]}}'
      );
      expect(err.message).toBe('Name is required');
      expect(err.upstreamMessage).toBe('legacy too');
    });
  });
});

// ---------------------------------------------------------------------------------------
// Phase 88.6-42 task 2 — the FIVE apiFetch-BYPASSING helpers (T-88.6-122, T-88.6-123)
// ---------------------------------------------------------------------------------------
describe('88.6-42 — transport hardening on the apiFetch-bypassing public helpers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  const jsonOnce = (status: number, bodyText: string) =>
    vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status, text: async () => bodyText, json: async () => JSON.parse(bodyText) });

  const CALLS: Array<[string, () => Promise<unknown>]> = [
    ['rsvpPublicAPI.respondViaToken', () => rsvpPublicAPI.respondViaToken('t', 'e', 'u', 'yes')],
    ['magicAuthAPI.validateToken', () => magicAuthAPI.validateToken('t')],
    ['availabilityFormAPI.submitResponse', () => availabilityFormAPI.submitResponse({ a: 1 })],
    [
      'availabilityFormAPI.prefillFromGcal',
      () => availabilityFormAPI.prefillFromGcal({ magicToken: 't', startDate: '2026-01-01', numDays: 7, timezone: 'UTC' }),
    ],
    [
      'availabilityFormAPI.prefillFromSaved',
      () => availabilityFormAPI.prefillFromSaved({ magicToken: 't', startDate: '2026-01-01', numDays: 7, timezone: 'UTC' }),
    ],
  ];

  it.each(CALLS)('%s carries an AbortSignal — i.e. a timeout exists at all', async (_name, run) => {
    // The honest cause (R8 §12 a): these five lacked a timeout because NOTHING in this
    // module had one. This is the arm that proves one is now attached — per helper, not
    // retrofitted into apiFetch, which is THE FENCE.
    const fetchMock = jsonOnce(200, '{"slot_ids":[],"count":0}');
    vi.stubGlobal('fetch', fetchMock);
    await run();
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it.each(CALLS)('%s MAPS a transport rejection instead of swallowing it', async (_name, run) => {
    // A SWALLOWED abort re-creates the stuck-button state the timeout exists to prevent
    // (AvailabilityForm clears its in-flight flag only in `finally`), so the property under
    // test is that the promise REJECTS — never that it resolves undefined.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    let caught: unknown = null;
    try {
      await run();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it.each(CALLS)('%s GUARDS the success parse — a proxy HTML 200 rejects, never SyntaxError', async (_name, run) => {
    vi.stubGlobal('fetch', jsonOnce(200, '<!DOCTYPE html><html><body>gateway</body></html>'));
    let caught: unknown = null;
    try {
      await run();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).name).not.toBe('SyntaxError');
  });

  it('adds NO res.ok throw — a 410 body still resolves so its discriminant survives', async () => {
    // D62 branch B (owner, 2026-09-09) KEEPS `rsvp/[token]/page.js`'s `result.error` read and
    // `AvailabilityForm.js`'s. An res.ok throw here would strand both — that is branch A,
    // which the owner rejected.
    vi.stubGlobal('fetch', jsonOnce(410, '{"error":"event_cancelled","group_id":"g-1"}'));
    await expect(rsvpPublicAPI.respondViaToken('t', 'e', 'u', 'yes')).resolves.toEqual({
      error: 'event_cancelled',
      group_id: 'g-1',
    });

    vi.stubGlobal('fetch', jsonOnce(400, '{"error":"This link is no longer valid.","action":"request_new"}'));
    await expect(availabilityFormAPI.submitResponse({ a: 1 })).resolves.toMatchObject({
      error: 'This link is no longer valid.',
    });
  });

  it('keeps the prefill helpers resolving { slot_ids, count } and their error-branch copy', async () => {
    vi.stubGlobal('fetch', jsonOnce(200, '{"slot_ids":["2026-01-01T00:00:00.000Z"],"count":1}'));
    await expect(
      availabilityFormAPI.prefillFromGcal({ magicToken: 't', startDate: '2026-01-01', numDays: 7, timezone: 'UTC' })
    ).resolves.toEqual({ slot_ids: ['2026-01-01T00:00:00.000Z'], count: 1 });

    // The D62-branch-B read is UNCHANGED: a code-less `{ error }` still supplies the copy.
    vi.stubGlobal('fetch', jsonOnce(400, '{"error":"Google Calendar is not connected"}'));
    await expect(
      availabilityFormAPI.prefillFromGcal({ magicToken: 't', startDate: '2026-01-01', numDays: 7, timezone: 'UTC' })
    ).rejects.toThrow('Google Calendar is not connected');
  });

  it('T-88.6-123 — respondViaToken percent-encodes ALL FOUR query arms', async () => {
    const fetchMock = jsonOnce(200, '{"ok":true}');
    vi.stubGlobal('fetch', fetchMock);
    await rsvpPublicAPI.respondViaToken('tok en', 'ev/1', 'auth0|u 1', 'not going');
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('token=tok%20en');
    // These two were the asymmetry (#103) — raw before this plan.
    expect(url).toContain('&e=ev%2F1');
    expect(url).toContain('&s=not%20going');
    expect(url).toContain('&u=auth0%7Cu%201');
    expect(url).not.toContain('ev/1');
  });
});

describe('88.6-42 / D41 cluster C — usersAPI.deleteAccount takes an OPTIONAL AbortSignal', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('threads a caller-supplied signal into the fetch options', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"message":"ok"}' });
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();
    await usersAPI.deleteAccount(controller.signal);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBe(controller.signal);
  });

  it('is OPTIONAL — the existing zero-argument callers are unaffected and get NO signal', async () => {
    // Signature-only: no default timeout is introduced here. Plan 88.6-30 creates the signal
    // at its own call site; this plan hosts the widening so ONE wave-8 plan owns api.ts (D41).
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => '{"message":"ok"}' });
    vi.stubGlobal('fetch', fetchMock);
    await usersAPI.deleteAccount();
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeUndefined();
  });
});
