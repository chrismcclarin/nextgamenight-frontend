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
import { render, screen, cleanup } from '@testing-library/react';
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
import { invitesAPI, ApiError, mapErrorToCode } from '@/lib/api';
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
    expect(
      screen.getByText("You don't have access to this. Refresh the page to try again.")
    ).toBeInTheDocument();
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
