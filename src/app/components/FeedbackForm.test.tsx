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

// Logged-out: no Auth0 user.
vi.mock('@auth0/nextjs-auth0/client', () => ({ useUser: () => ({ user: null }) }));

import FeedbackForm from './FeedbackForm';
import { PUBLIC_API_BASE_URL } from '../../lib/api';

afterEach(cleanup);

describe('FeedbackForm logged-out submission (87.6 D-08)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
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
