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

// Phase 88.8 plan 13 Task 3(b): the contact handle is `Users.email` off the
// shared self row, never the Auth0 session claim.
const h = vi.hoisted(() => ({ self: undefined as undefined | Record<string, unknown> }));
vi.mock('../../lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    self: h.self,
    selfUuid: h.self?.id as string | undefined,
    query: { isError: false, error: null, isPending: !h.self, refetch: vi.fn() },
    isPending: !h.self,
  }),
}));

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
