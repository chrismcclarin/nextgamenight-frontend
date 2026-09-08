/**
 * 87.6 D-08 / T-87.6-03 — logged-out FeedbackForm transport proof.
 *
 * FeedbackForm mounts from the PUBLIC Footer (root layout), so a fully
 * logged-out visitor must be able to submit a bug report / suggestion via
 * feedbackAPI.submitFeedback on publicFetch (direct PUBLIC_API_BASE_URL,
 * never the authenticated BFF). Feedback carries NO user attribution (owner
 * decision 2026-07-24, review WR-01): the body must not include user_id.
 *
 * This test observes the ACTUAL request the component issues by stubbing the
 * GLOBAL fetch (the real network boundary publicFetch hits) — NOT by mocking
 * feedbackAPI / publicFetch / the api.ts module exports (which would only prove
 * a mock was called, or never intercept due to module-internal binding). Auth
 * is mocked to logged-out; the assertions are that the outgoing request targets
 * the public backend origin, carries NO Authorization header, and omits user_id.
 *
 * This is the FE-TRANSPORT half of the logged-out proof; the BE-source half is
 * cited in the SUMMARY (server.js public prefix '/feedback' + optionalAuth +
 * the unauthenticated POST handler).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Logged-out: no Auth0 user. Retained for the 87.6 transport proof below even
// though FeedbackForm no longer consumes the hook directly (Phase 88.8 plan 13
// Task 3(b) removed its only reader) — `useSelfIdentity` is what the component
// reads now, and the two must agree in the logged-out case.
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));

// Round 6 #3/#28: the submit-failure report.
vi.mock('@sentry/nextjs', () => ({ captureException: vi.fn() }));

// Phase 88.8 plan 13 Task 3(b): the contact handle is `Users.email` off the
// shared self row, never the Auth0 session claim.
const h = vi.hoisted(() => ({
  self: undefined as undefined | Record<string, unknown>,
  // Round 3 DR3: per-test overrides for the query flags the submit gate reads.
  query: {} as Record<string, unknown>,
}));
vi.mock('../../lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: h.self,
    selfUuid: h.self?.id as string | undefined,
    query: { isError: false, error: null, isPending: !h.self, refetch: vi.fn(), ...h.query },
    isPending: !h.self,
  }),
}));

import * as Sentry from '@sentry/nextjs';

import FeedbackForm from './FeedbackForm';
import { PUBLIC_API_BASE_URL } from '../../lib/api';

const SESSION_EMAIL = 'session-only@example.com';
const APP_EMAIL = 'app-address@example.com';
const SYNTHETIC = 'google-oauth2-1|xyz@auth0.local';

afterEach(cleanup);

describe('FeedbackForm logged-out submission (87.6 D-08)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    // Stub the real network boundary. publicFetch does `await response.text()`
    // then JSON.parses it, so return a minimal ok Response-like.
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('submits to the public feedback endpoint with NO Authorization header', async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'Logged-out bug');
    await user.type(
      screen.getByPlaceholderText(/provide as much detail/i),
      'Reporting this while signed out.',
    );
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    // The success panel confirms the component treated the request as accepted.
    await waitFor(() => expect(screen.getByText(/Thank You/i)).toBeInTheDocument());

    // Exactly one outgoing request, at the public backend origin.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(calledUrl).toBe(`${PUBLIC_API_BASE_URL}/feedback`);
    expect(calledUrl.startsWith(PUBLIC_API_BASE_URL)).toBe(true);
    expect(calledOptions.method).toBe('POST');

    // No Authorization header on the logged-out public request (case-insensitive).
    const headers = (calledOptions.headers ?? {}) as Record<string, string>;
    const headerKeys = Object.keys(headers).map((k) => k.toLowerCase());
    expect(headerKeys).not.toContain('authorization');

    // FE half of the no-attribution contract (WR-01): the outgoing body never
    // carries user_id (the BE half — stored null regardless — is pinned in
    // periodictabletopbackend_v2/Sonnet/tests/routes/feedback.test.js).
    const body = JSON.parse(calledOptions.body as string);
    expect(body).not.toHaveProperty('user_id');
  });
});

/**
 * Phase 88.8 plan 13 Task 3(b) — `user_email` is `Users.email`, or null.
 *
 * `user_email` is a CONTACT HANDLE, not attribution: `routes/feedback.js` puts
 * it in the admin mail's From line (`:162`, `:183`) and, when truthy, in
 * `replyTo` (`:204`). A wrong address there is worse than none — it is precisely
 * the value D-42's move and the account-deletion scrub will not match.
 */
describe('FeedbackForm user_email — the APP address, never the Auth0 session claim (88.8 R12)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const submit = async () => {
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    return JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ success: true }),
    }));
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends the SELF row address when it DIFFERS from the mocked session address', async () => {
    // Discriminating by construction: a fixture where the two agree proves
    // nothing about which one was read.
    h.self = { id: 'u-1', email: APP_EMAIL };
    const body = await submit();
    expect(body.user_email).toBe(APP_EMAIL);
    expect(body.user_email).not.toBe(SESSION_EMAIL);
  });

  it('sends NULL for a SYNTHETIC self address — the sentinel is not a contact handle', async () => {
    // Downstream consequence, verified at the backend rather than assumed here:
    // the admin mail's From falls back to its existing 'Anonymous' literal
    // (routes/feedback.js:162, :183) and the send options carry NO `replyTo`
    // key at all, because `:204` is a conditional spread. Losing reply-to is
    // CORRECT — there is no inbox behind `<sub>@auth0.local`.
    h.self = { id: 'u-1', email: SYNTHETIC };
    const body = await submit();
    expect(body.user_email).toBeNull();
  });

  it('sends null when logged out — unchanged from what shipped', async () => {
    h.self = undefined;
    const body = await submit();
    expect(body.user_email).toBeNull();
  });

  it('never sends the Auth0 session address, in ANY of the three cases', async () => {
    for (const row of [{ id: 'u-1', email: APP_EMAIL }, { id: 'u-1', email: SYNTHETIC }, undefined]) {
      vi.clearAllMocks();
      fetchMock.mockClear();
      cleanup();
      h.self = row;
      const body = await submit();
      expect(body.user_email).not.toBe(SESSION_EMAIL);
    }
  });
});

/**
 * Code review round 3 DR3 (owner ruling 2026-09-05) — the self-row gate on Submit is
 * PERCEIVABLE and REACHABLE, and the missing-reply-to case is DISCLOSED. Three lenses
 * converged on the round-1 guard: it natively disabled Submit with no label change and
 * no announcement while the self row loaded (a keyboard dead end), and dropped the
 * handle silently when the self query errored.
 */
describe('FeedbackForm — round 3 DR3: the loading gate answers, the error case is disclosed', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = undefined;
    h.query = {};
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.query = {};
  });

  it('while the self row is FETCHING, Submit is aria-disabled (never natively), stays in the tab order, explains itself, and a press files nothing', async () => {
    h.query = { isFetching: true };
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');

    const submit = screen.getByRole('button', { name: /^Submit$/i });
    expect(submit).toHaveAttribute('aria-disabled', 'true');
    expect(submit).not.toHaveAttribute('disabled');
    expect(screen.getByRole('status')).toHaveTextContent(/loading your details/i);

    await user.click(submit);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('when the self query ERRORED, the reporter is told the reply-to is missing, and can still file (user_email null, never the session address)', async () => {
    h.query = { isError: true, isFetching: false };
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);
    expect(screen.getByText(/couldn't load your email address/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Submit$/i })).not.toHaveAttribute('aria-disabled', 'true');

    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.user_email).toBeNull();
  });

  it('a settled row WITH a usable address shows neither the loading line nor the missing-reply-to line', () => {
    h.self = { id: 'u1', email: APP_EMAIL };
    render(<FeedbackForm onClose={() => {}} />);
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(screen.queryByText(/couldn't load your email address/i)).not.toBeInTheDocument();
  });
});

/* ---------------------------------------------------------------------------
   POST-MERGE FIX SET (code review round 5 MED/LOW, 2026-09-07) — #37/#41/#8/#40.
   --------------------------------------------------------------------------- */

describe('FeedbackForm — post-merge fix set (round 5)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  const fillAndSubmit = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), 'A description here.');
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));
  };

  beforeEach(() => {
    vi.clearAllMocks();
    h.self = { id: 'u1', email: APP_EMAIL };
    h.query = {};
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    h.self = undefined;
    h.query = {};
  });

  it('#37 — a FAILED submit is announced through a live region and named by Submit`s aria-describedby', async () => {
    // The harm: the red box painted and assistive tech was told nothing, so a keyboard or
    // screen-reader reporter believed the report had gone.
    fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const alertRegion = screen.getByRole('alert');
    // ALWAYS MOUNTED AND EMPTY FIRST — a region that mounts WITH its content announces
    // nothing, which is the shape this fix replaces.
    expect(alertRegion).toHaveTextContent('');

    await fillAndSubmit(user);

    await waitFor(() => expect((screen.getByRole('alert').textContent ?? '').length).toBeGreaterThan(0));
    const submit = screen.getByRole('button', { name: /^Submit$/i });
    expect(submit.getAttribute('aria-describedby')).toContain(screen.getByRole('alert').id);
    // The gate line is still referenced too — the failure JOINS it, never replaces it.
    expect(submit.getAttribute('aria-describedby')).toContain(screen.getByRole('status').id);
  });

  it('#3/#28 — a failed submit is REPORTED to Sentry, class-only, with none of the report body in the payload', async () => {
    fetchMock = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    vi.stubGlobal('fetch', fetchMock);
    const user = userEvent.setup();
    render(<FeedbackForm onClose={() => {}} />);

    const SECRET_PROSE = 'my password is hunter2 and my address is nobody@example.com';
    await user.type(screen.getByPlaceholderText(/Brief description/i), 'A subject');
    await user.type(screen.getByPlaceholderText(/provide as much detail/i), SECRET_PROSE);
    await user.click(screen.getByRole('button', { name: /^Submit$/i }));

    await waitFor(() => expect(Sentry.captureException).toHaveBeenCalledTimes(1));
    const [err, ctx] = vi.mocked(Sentry.captureException).mock.calls[0] as [
      Error,
      { tags?: Record<string, unknown> },
    ];
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/^feedback submit failed: /);
    expect(ctx.tags).toEqual({ feature: 'feedback', op: 'submit' });
    /* THE POINT OF "class-only": this is the app's own bug channel, so the body in flight
       is the reporter's prose, their address and possibly a screenshot. None of it may
       ride along to Sentry. */
    const payload = JSON.stringify(vi.mocked(Sentry.captureException).mock.calls[0]);
    expect(payload).not.toContain('hunter2');
    expect(payload).not.toContain('nobody@example.com');
  });

  it('#41 — the reply-to warning arrives as a CHANGE to the already-mounted region, not as a new node', async () => {
    /* What the round-4 comment over-claimed: `selfNotReady` is `isFetching`, false on a
       warm cache and false for a settled errored query, so the sentence could be present
       on the region`s very first commit — which announces nothing. The text is now set
       from an effect, and the region is the SAME DOM node before and after, which is what
       makes the first appearance an announceable change.
       WHAT THIS CANNOT PROVE, stated rather than implied: RTL`s render flushes effects
       inside act(), so no assertion here can observe the one commit between mount and
       effect. Node identity across the transition is the observable half. */
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    const { rerender } = render(<FeedbackForm onClose={() => {}} />);
    const before = screen.getByRole('status');
    expect(before).toHaveTextContent('');

    h.self = { id: 'u1', email: SYNTHETIC };
    rerender(<FeedbackForm onClose={() => {}} />);

    const after = screen.getByRole('status');
    expect(after).toBe(before);
    expect(after).toHaveTextContent(/couldn't load your email address/i);
  });

  it('#8/#40 — two concurrently mounted forms carry DISTINCT ids, and each Submit points at its OWN status line', () => {
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ success: true }) }));
    vi.stubGlobal('fetch', fetchMock);
    /* Two mount sites exist today (Footer, and FetchErrorBanner, which can appear more
       than once), so the hard-coded `feedback-submit-status` could resolve a Submit`s
       description to the OTHER form`s status line. Queried through the DOM rather than
       the accessibility tree on purpose: a modal marks its siblings aria-hidden, which
       would hide one of the two from a role query and make this pass vacuously. */
    render(
      <>
        <FeedbackForm onClose={() => {}} />
        <FeedbackForm onClose={() => {}} />
      </>
    );

    const statuses = Array.from(document.querySelectorAll('[role="status"]'));
    expect(statuses).toHaveLength(2);
    const ids = statuses.map((n) => n.id);
    expect(ids[0]).toBeTruthy();
    expect(ids[0]).not.toBe(ids[1]);
    expect(ids).not.toContain('feedback-submit-status');

    const submits = Array.from(document.querySelectorAll('button[type="submit"]'));
    expect(submits).toHaveLength(2);
    submits.forEach((btn, i) => {
      expect(btn.getAttribute('aria-describedby')).toContain(ids[i]);
      expect(btn.getAttribute('aria-describedby')).not.toContain(ids[i === 0 ? 1 : 0]);
    });
  });
});
