// Phase 88.6-23 task 2 — the wire-shape net over the invite-accept page.
//
// Every arm below is built from the REAL wire shape of `POST /invites/accept-by-token`: a body
// with NO envelope `code`, so the code the page sees is the STATUS-DERIVED one `mapErrorToCode`
// falls back to (`api.ts` `statusToCode`). Pinning an envelope this route never sends would make
// the whole file vacuous.
//
// THE TWO 403 ARMS ARE THE POINT. A code-less 403 has TWO sources on this call — the backend's
// wrong-email refusal (`routes/invites.js:757-758`) and the same-origin BFF proxy's CSRF gate
// (`src/app/api/[...path]/route.ts`) — and both resolve to `code: 'forbidden'`. An arm for the
// backend 403 alone passes on the UNGATED version and proves nothing.
//
// `.tsx` is mandatory: `vitest.config.mts:67` collects `src/**/*.{test,spec}.{ts,tsx}` only.
import * as React from 'react';
import { render, screen, cleanup, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'd'.repeat(48);
const GROUP_ID = '44444444-4444-4444-8444-444444444444';

const { authState } = vi.hoisted(() => ({
  authState: {
    user: undefined as { sub: string } | undefined,
    isLoading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(`token=${'d'.repeat(48)}`),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: authState.user, isLoading: authState.isLoading }),
}));

// Spread the real module so `ApiError` is the REAL class and `getFetchErrorMessage` keeps the
// REAL register — otherwise every copy assertion here is vacuous.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    // D-24 (plan 88.6.1-35, A7): wraps the REAL predicate, so every arm — and
    // getFetchErrorMessage, which imports the same mocked module — behaves exactly as before;
    // vi.clearAllMocks() keeps the implementation and only clears the calls.
    isCsrfRejection: vi.fn(actual.isCsrfRejection),
    invitesAPI: {
      acceptInviteByToken: vi.fn(),
      getInviteInfo: vi.fn(),
    },
  };
});

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  errCtx: (err: unknown) => ({
    name: (err as Error)?.name ?? typeof err,
    message: (err as Error)?.message ?? String(err),
  }),
}));

import InviteAcceptPage from './page';
import { invitesAPI, ApiError, mapErrorToCode, isCsrfRejection } from '@/lib/api';
import { logger } from '@/lib/logger';

type Mock = ReturnType<typeof vi.fn>;
const accept = () => invitesAPI.acceptInviteByToken as unknown as Mock;
const inviteInfo = () => invitesAPI.getInviteInfo as unknown as Mock;

/**
 * Build the rejection exactly as `apiFetch` builds it — the code comes from `mapErrorToCode`
 * over the real body, never hand-picked, so the STATUS -> CODE fallback is what is under test.
 * The message is the POST-alias-drop shape (`HTTP error! status: N`), which is what
 * `extractErrorMessage` returns once plan 88.6-42 stops reading `body.error` in wave 8.
 */
function wireError(status: number, body: Record<string, unknown>) {
  return new ApiError(
    `HTTP error! status: ${status}`,
    mapErrorToCode(body, status),
    status,
    body
  );
}

/** The backend's wrong-email refusal — `routes/invites.js:757-758`. No `code`, no `errors[]`. */
const BACKEND_403 = () => wireError(403, { error: 'This invite is not for you' });

/** The BFF proxy's CSRF rejection — `src/app/api/[...path]/route.ts`. Also a code-less 403. */
const CSRF_403 = () =>
  wireError(403, { error: 'Cross-origin request rejected', csrf_rejected: true });

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = { sub: 'auth0|abc' };
  authState.isLoading = false;
  accept().mockReset();
  inviteInfo().mockReset();
  localStorage.clear();
});

afterEach(cleanup);

describe('invite/accept — error branches keyed on `err.code` (D-46)', () => {
  it('the status-derived code for the 403 really is `forbidden` (anti-vacuity)', () => {
    // If this ever stops holding, every arm below is testing the wrong thing.
    expect(BACKEND_403().code).toBe('forbidden');
    expect(CSRF_403().code).toBe('forbidden');
    expect(wireError(404, { error: 'Pending invite not found' }).code).toBe('not_found');
    expect(wireError(500, { error: 'Failed to accept invite' }).code).toBe('internal');
  });

  it('a code-less 404 renders the already-accepted-or-expired line', async () => {
    accept().mockRejectedValue(wireError(404, { error: 'Pending invite not found' }));

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      screen.getByText('This invite may have already been accepted or expired.')
    ).toBeInTheDocument();
  });

  it('the BACKEND 403 renders the wrong-email line', async () => {
    accept().mockRejectedValue(BACKEND_403());

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      screen.getByText('This invite was sent to a different email address.')
    ).toBeInTheDocument();
  });

  it('the CSRF 403 falls to the register and NEVER claims a different email address', async () => {
    accept().mockRejectedValue(CSRF_403());

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      screen.queryByText('This invite was sent to a different email address.'),
      'the proxy rejected the request before it reached the backend — it knows nothing about ' +
        "this visitor's email address"
    ).toBeNull();
    // D-24 (88.6.1-07): a proxy CSRF rejection is not a permission refusal; getFetchErrorMessage
    // resolves it through the unknown arm, and this page passes no fallback.
    expect(
      screen.getByText('Something went wrong. Refresh the page to try again.')
    ).toBeInTheDocument();
    expect(
      screen.queryByText("You don't have access to this. Refresh the page to try again.")
    ).toBeNull();
    // And the proxy's own upstream string never reaches the person either (R1).
    expect(screen.queryByText(/cross-origin request rejected/i)).toBeNull();
  });

  it('a code-less 500 renders the register line, not the upstream text', async () => {
    accept().mockRejectedValue(wireError(500, { error: 'Failed to accept invite' }));

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      screen.getByText('Something went wrong on our end. Please try again shortly.')
    ).toBeInTheDocument();
    expect(screen.queryByText(/failed to accept invite/i)).toBeNull();
  });
});

describe('invite/accept — the token a stale localStorage copy must not hijack (T-88.6-148)', () => {
  it('the URL token is sent even when a DIFFERENT token is stored', async () => {
    localStorage.setItem('pendingInviteToken', 'stale-token-from-a-different-invite');
    accept().mockResolvedValue({ success: true, group_id: GROUP_ID });

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /you've joined the group!/i });
    expect(
      accept(),
      'stored-token-wins joined the visitor to the group of an invite they opened EARLIER'
    ).toHaveBeenCalledWith(TOKEN);
  });

  it('the stored credential is cleared on the ERROR path too', async () => {
    localStorage.setItem('pendingInviteToken', 'stale-token-from-a-different-invite');
    accept().mockRejectedValue(wireError(404, { error: 'Pending invite not found' }));

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      localStorage.getItem('pendingInviteToken'),
      'the shipped `removeItem` sat inside the stored-token-wins branch, so a failed accept ' +
        'left a bearer credential in localStorage forever'
    ).toBeNull();
  });

  it('a LOGGED-OUT visit writes no invite token to localStorage (88.6-59, review MEDLOW-10)', async () => {
    // The write in the `!user` branch outlived its only reader (T-88.6-148 deleted the
    // `getItem`), so it was pure retention of a group-membership bearer credential. The token
    // already survives login through the `returnTo` on the sign-in anchor.
    authState.user = undefined;
    inviteInfo().mockResolvedValue(null);

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /you're invited!/i });
    expect(
      localStorage.getItem('pendingInviteToken'),
      'a logged-out visit left the invite bearer token in browser storage with nothing reading it'
    ).toBeNull();
    expect(accept()).not.toHaveBeenCalled();
  });
});

describe('invite/accept — the success heading and the migrated anchors', () => {
  it('renders the copy that shipped anyway, with no dead `group_name` read behind it', async () => {
    // `routes/invites.js:779` is the sole success return and carries only
    // `{ success: true, group_id }` — measured 2026-09-14.
    accept().mockResolvedValue({ success: true, group_id: GROUP_ID });

    render(<InviteAcceptPage />);

    expect(
      await screen.findByRole('heading', { name: /you've joined the group!/i })
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /go to group/i })).toHaveAttribute(
      'href',
      `/groupHomePage?id=${GROUP_ID}`
    );
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });

  it('the sign-in CTA is still an <a> with a byte-identical returnTo', async () => {
    authState.user = undefined;
    inviteInfo().mockResolvedValue(null);

    render(<InviteAcceptPage />);

    const signIn = await screen.findByRole('link', { name: /sign in to accept/i });
    expect(signIn).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/invite/accept?token=${TOKEN}`)}`
    );
    expect(signIn.tagName).toBe('A');
  });
});

describe('invite/accept — AC-2: the invite-info failure is a house-logger breadcrumb', () => {
  it('a failed invite-info fetch calls logger.info with the frozen message and a keyed ctx', async () => {
    authState.user = undefined;
    inviteInfo().mockRejectedValue(wireError(500, { error: 'boom' }));

    render(<InviteAcceptPage />);

    // Settle on the branch's own copy, not on chrome.
    await screen.findByText(/you've been invited to a group on next game night\./i);

    expect(logger.info).toHaveBeenCalledWith(
      'Failed to fetch invite info:',
      expect.objectContaining({ name: 'ApiError', message: 'HTTP error! status: 500' })
    );
    // T-84-01: the ctx carries the error's name and message and nothing else — never the body.
    const ctx = (logger.info as unknown as Mock).mock.calls[0][1];
    expect(Object.keys(ctx).sort()).toEqual(['message', 'name']);
  });
});

// Plan 88.6.1-35 — W039 (AC-32) and the Req 8 page region (AC-24).
//
// The page's region handle. Re-declared here on purpose: the page must NOT export it (Next's
// generated route types reject a page module's extra named exports; see the rsvp page's
// "NOT EXPORTED, deliberately" note).
const PAGE_STATUS_TESTID = 'invite-accept-page-status';
const ACCEPTED_ANNOUNCEMENT =
  "You've joined the group! You can now see events, suggest games, and coordinate with your group.";
const NOT_FOUND_LINE = 'This invite may have already been accepted or expired.';

// A first POST that stays in flight until the test resolves it, and the route's REAL answer to
// any repeat call for the same token (routes/invites.js, the 'Pending invite not found' 404):
// the accept route is not idempotent, so a second POST can only fail.
function holdFirstAcceptThen404() {
  let resolveFirst: (v: unknown) => void = () => {};
  accept()
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    )
    .mockRejectedValue(wireError(404, { error: 'Pending invite not found' }));
  return (v: unknown) => resolveFirst(v);
}

describe('invite/accept — W039 single-shot accept and the Req 8 page region (plan 88.6.1-35)', () => {
  it('T1: a re-run with a new user object mid-flight issues no second POST and the success lands', async () => {
    const resolveFirst = holdFirstAcceptThen404();

    const { rerender } = render(<InviteAcceptPage />);

    // Positive signal first: the POST has really been issued.
    await screen.findByText('Accepting your invite...');
    expect(accept()).toHaveBeenCalledTimes(1);

    // The hazard: an Auth0 revalidation hands back a NEW user object with the same subject, and
    // the effect depends on it.
    await act(async () => {
      authState.user = { sub: 'auth0|abc' };
      rerender(<InviteAcceptPage />);
    });

    await act(async () => {
      resolveFirst({ success: true, group_id: GROUP_ID });
    });

    expect(
      await screen.findByRole('heading', { name: /you've joined the group!/i }),
      'the re-run cancelled the successful POST and fired a second one, whose 404 told a person ' +
        'who had just joined that the invite may have already been accepted'
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_LINE)).toBeNull();
    expect(accept()).toHaveBeenCalledTimes(1);
  });

  it('T2: under StrictMode the accept POSTs once and the success lands', async () => {
    const resolveFirst = holdFirstAcceptThen404();

    render(
      <React.StrictMode>
        <InviteAcceptPage />
      </React.StrictMode>
    );

    await screen.findByText('Accepting your invite...');

    await act(async () => {
      resolveFirst({ success: true, group_id: GROUP_ID });
    });

    expect(
      await screen.findByRole('heading', { name: /you've joined the group!/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(NOT_FOUND_LINE)).toBeNull();
    expect(accept()).toHaveBeenCalledTimes(1);
  });

  it('T3: the slot-0 region is the same empty node through loading and accepting, then speaks the success', async () => {
    authState.isLoading = true;
    let resolveFirst: (v: unknown) => void = () => {};
    accept().mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        })
    );

    const { container, rerender } = render(<InviteAcceptPage />);

    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region.textContent).toBe('');
    expect(region).toHaveClass('sr-only');
    // Fragment slot 0: the region is the page's first element.
    expect(container.firstElementChild).toBe(region);

    await act(async () => {
      authState.isLoading = false;
      rerender(<InviteAcceptPage />);
    });

    await screen.findByText('Accepting your invite...');
    // Node identity across the loading-return to main-return swap (C-6).
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
    expect(region.textContent).toBe('');

    await act(async () => {
      resolveFirst({ success: true, group_id: GROUP_ID });
    });

    await screen.findByRole('heading', { name: /you've joined the group!/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
    expect(region.textContent).toBe(ACCEPTED_ANNOUNCEMENT);
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('T4 (held-out backstop, R8 idempotency): a re-run after the success neither re-POSTs nor flashes', async () => {
    accept().mockResolvedValue({ success: true, group_id: GROUP_ID });

    const { rerender } = render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /you've joined the group!/i });
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    const spoken = region.textContent;

    await act(async () => {
      authState.user = { sub: 'auth0|abc' };
      rerender(<InviteAcceptPage />);
    });

    expect(accept()).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Accepting your invite...')).toBeNull();
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
    expect(region.textContent).toBe(spoken);
  });
});

// Plan 88.6.1-35 Task 2 — the error and signed-out outcomes, copy row L1, D-24 and W054.
const INVITE_INFO = { inviter_name: 'Alice', group_name: 'Tuesday Night Crew' };

describe('invite/accept — outcomes announced, L1, D-24 and W054 (plan 88.6.1-35)', () => {
  it('A1: a failed accept is spoken from the region, with no exposed glyph', async () => {
    accept().mockRejectedValue(wireError(404, { error: 'Pending invite not found' }));

    const { container } = render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
      'Unable to accept invite This invite may have already been accepted or expired.'
    );
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(container.querySelectorAll('svg:not([aria-hidden="true"])')).toHaveLength(0);
  });

  it('A2: signed out, the region stays empty until the invite info settles, then speaks once', async () => {
    authState.user = undefined;
    let resolveInfo: (v: unknown) => void = () => {};
    inviteInfo().mockReturnValue(
      new Promise((resolve) => {
        resolveInfo = resolve;
      })
    );

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: "You're invited!" });
    const region = screen.getByTestId(PAGE_STATUS_TESTID);
    expect(region.textContent).toBe('');

    await act(async () => {
      resolveInfo({ ...INVITE_INFO, member_count: 4 });
    });

    // Positive wait (CF-26).
    await waitFor(() =>
      expect(region.textContent).toBe(
        "You're invited! Alice invited you to join Tuesday Night Crew on Next Game Night. The group has 4 members."
      )
    );
    expect(screen.getByTestId(PAGE_STATUS_TESTID)).toBe(region);
  });

  it('A3: signed out with a failed info request, the region speaks the generic invitation', async () => {
    authState.user = undefined;
    inviteInfo().mockRejectedValue(wireError(500, { error: 'boom' }));

    render(<InviteAcceptPage />);

    await waitFor(() =>
      expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
        "You're invited! You've been invited to a group on Next Game Night."
      )
    );
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('A4 (copy row L1): the loading line names what is loading', () => {
    authState.isLoading = true;

    render(<InviteAcceptPage />);

    expect(screen.getByText('Checking your invitation...')).toBeInTheDocument();
    expect(screen.queryByText('Loading...')).toBeNull();
  });

  it('A5 (W054): a success body carrying only the camelCase id renders no Go to Group link', async () => {
    // The route's sole success body is snake_case only (routes/invites.js:779); the camelCase
    // alias read was dead and is deleted.
    accept().mockResolvedValue({ success: true, groupId: GROUP_ID });

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /you've joined the group!/i });
    expect(screen.queryByRole('link', { name: /go to group/i })).toBeNull();
    expect(screen.getByRole('link', { name: /go home/i })).toBeInTheDocument();
  });

  it('A6: a member count of 0 prints no stray "0" and no count line', async () => {
    authState.user = undefined;
    inviteInfo().mockResolvedValue({ ...INVITE_INFO, member_count: 0 });

    render(<InviteAcceptPage />);

    await waitFor(() =>
      expect(screen.getByTestId(PAGE_STATUS_TESTID).textContent).toBe(
        "You're invited! Alice invited you to join Tuesday Night Crew on Next Game Night."
      )
    );
    expect(screen.queryByText(/the group has/i)).toBeNull();
    expect(screen.getByText('Alice').closest('p')?.textContent).toBe(
      'Alice invited you to join Tuesday Night Crew on Next Game Night.'
    );
  });

  it('A7 (D-24): the wrong-email arm asks the shared isCsrfRejection predicate', async () => {
    const err = BACKEND_403();
    accept().mockRejectedValue(err);

    render(<InviteAcceptPage />);

    await screen.findByRole('heading', { name: /unable to accept invite/i });
    expect(
      screen.getByText('This invite was sent to a different email address.')
    ).toBeInTheDocument();
    expect(isCsrfRejection as unknown as Mock).toHaveBeenCalledWith(err);
  });
});
