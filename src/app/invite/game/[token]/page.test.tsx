// Phase 88.6-23 task 1 — the alias-independence net over the game-invite landing page.
//
// WHAT THIS FILE EXISTS FOR, in one sentence: to prove that the "Game Night Has Passed"
// screen and the permanent-invalid screen are selected by the HTTP STATUS and not by the
// backend's prose, so plan 88.6-42's `body.error` alias drop in wave 8 cannot silently kill
// them on the app's public QR/SMS entry surface.
//
// THE LOAD-BEARING DETAIL: every `ApiError` below is built with the POST-ALIAS-DROP message
// shape — `HTTP error! status: 410` / `… 404`, which is what `extractErrorMessage`
// (`src/lib/api.ts`) returns once `body?.error` stops being read. A test that passed a
// realistic "This game night has already passed" message would go green against the OLD
// prose-matching code too, and would prove nothing at all.
//
// `.tsx` is mandatory: `vitest.config.mts:67` collects `src/**/*.{test,spec}.{ts,tsx}` only,
// so a `.js` sibling would be silently never run.
import * as React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const TOKEN = 'b'.repeat(64);

const { pushMock, authState } = vi.hoisted(() => ({
  pushMock: vi.fn(),
  authState: {
    user: undefined as { sub: string } | undefined,
    isLoading: false,
  },
}));

vi.mock('next/navigation', () => ({
  useParams: () => ({ token: TOKEN }),
  useRouter: () => ({ push: pushMock, replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: authState.user, isLoading: authState.isLoading }),
}));

// Spread the real module so `ApiError` stays the REAL class and `getFetchErrorMessage` keeps
// its real register — the page's copy assertions would be vacuous against a stub.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: {
      getEventInvitePreview: vi.fn(),
      joinGameByToken: vi.fn(),
    },
  };
});

import GameInvitePage from './page';
import { eventsAPI, ApiError } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;
const preview = () => eventsAPI.getEventInvitePreview as unknown as Mock;
const join = () => eventsAPI.joinGameByToken as unknown as Mock;

/**
 * The shape `ApiError` carries AFTER plan 88.6-42 drops the `body.error` alias: the backend
 * still sends `{ error: '…' }`, but `extractErrorMessage` stops reading it, so the message
 * degenerates to the status fallback. Building the arms this way is what makes a green run
 * evidence rather than a coincidence.
 */
function postAliasDropError(status: number, code: 'gone' | 'not_found') {
  return new ApiError(`HTTP error! status: ${status}`, code, status, {
    error: 'This game night has already passed',
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  authState.user = undefined;
  authState.isLoading = false;
  preview().mockReset();
  join().mockReset();
});

afterEach(cleanup);

describe('invite/game/[token] — status-keyed branches (D-45 / D-59)', () => {
  it('a 410 renders the expired screen even when the message carries no backend prose', async () => {
    preview().mockRejectedValue(postAliasDropError(410, 'gone'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /game night has passed/i }),
      'the 410 branch must be selected by `err.status`, not by the words in `err.message`'
    ).toBeInTheDocument();
    // The negative half: the generic permanent copy must NOT be what rendered.
    expect(screen.queryByText(/this invite link is no longer valid\./i)).toBeNull();
  });

  it('a 404 renders the permanent-invalid screen, also with no prose to match', async () => {
    preview().mockRejectedValue(postAliasDropError(404, 'not_found'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i })
    ).toBeInTheDocument();
    expect(screen.getByText('This invite link is no longer valid.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /game night has passed/i })).toBeNull();
  });

  it('a transient failure renders the RATIFIED register line, never the upstream text', async () => {
    // A real network failure arrives as `ApiError(…, 'network', 0)` from `apiFetch`
    // (`src/lib/api.ts:348-352`). R1: the register supplies the words.
    preview().mockRejectedValue(
      new ApiError('Network error: Could not connect to the server.', 'network', 0)
    );

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /couldn't join game night/i })
    ).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/could not connect to the server/i)).toBeNull();
  });

  it('a join failure renders the register line rather than "Failed to join game night."', async () => {
    authState.user = { sub: 'auth0|abc' };
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });
    join().mockRejectedValue(postAliasDropError(404, 'not_found'));

    render(<GameInvitePage />);

    expect(
      await screen.findByRole('heading', { name: /this invite is no longer valid/i })
    ).toBeInTheDocument();
    expect(screen.getByText("We couldn't find what you were looking for.")).toBeInTheDocument();
    expect(screen.queryByText(/failed to join game night/i)).toBeNull();
  });
});

describe('invite/game/[token] — the migrated anchors keep their element kind and href', () => {
  it('the sign-in CTA is still a link with a byte-identical returnTo', async () => {
    preview().mockResolvedValue({ game_name: 'Wingspan', event_date: '2030-01-01T00:00:00Z' });

    render(<GameInvitePage />);

    const signIn = await screen.findByRole('link', { name: /join game night/i });
    // T-88.6-64: this is the anonymous user's ONLY way in. An `asChild` migration that
    // rewrote the element to a `<Link>`, or re-encoded the query, locks them out.
    expect(signIn).toHaveAttribute(
      'href',
      `/api/auth/login?returnTo=${encodeURIComponent(`/invite/game/${TOKEN}`)}`
    );
    expect(signIn.tagName).toBe('A');
  });

  it('the expired screen Go Home CTA is still a link to /', async () => {
    preview().mockRejectedValue(postAliasDropError(410, 'gone'));

    render(<GameInvitePage />);

    await screen.findByRole('heading', { name: /game night has passed/i });
    expect(screen.getByRole('link', { name: /go home/i })).toHaveAttribute('href', '/');
  });
});
