// Phase 88 plan 06 Task 2 — RENDER HARNESS for the friends surface.
//
// WHY THIS FILE EXISTS (read before extending):
// friends/page.js had no test file at all, so Req 6's empty-state work and the
// remove-friend gate had nowhere to be asserted. This harness supplies the mock
// stack and a render helper; later plans add ASSERTIONS, not infrastructure.
//
// WHAT IS ASSERTED HERE: plan 88-14 has since landed the two-tap remove gate and
// the EmptyState adoption this harness was built for, so the native-`confirm()`
// pins are gone and the `confirmSpy` plumbing with them. The gate's behaviour is
// pinned in `describe('remove friend (two-tap tier)')`; the hook's own mechanics
// (timer, re-arm, aria) live in `ConfirmDialog.test.tsx` and are not re-tested here.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` page under test.
//
// ---------------------------------------------------------------------------
// EXTENSION POINTS — who adds what, and where
// ---------------------------------------------------------------------------
// * Further Req 6 / Req 11 surface work extends `describe('friends list')` —
//   use `renderFriends({ friends: [] })` for the empty case and
//   `renderFriends({ loadError: ... })` for the failed-fetch case. Those two are
//   deliberately DIFFERENT surfaces; see the DECISION marker on the Friends tab.
import * as React from 'react';
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const FRIEND_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FRIEND_2_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * Mutable resolved identity. The friends page GATES its whole render on
 * `selfUuid` (D-09) — with it undefined the page is a spinner and nothing else,
 * so every list assertion needs it set.
 */
const h = vi.hoisted(() => ({ selfUuid: undefined as string | undefined }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
    isPending: !h.selfUuid,
  }),
}));

// DECISION Phase 88 plan 06: the `user` object is hoisted to a STABLE reference
// rather than built inline in the hook, because friends/page.js keys its mount
// fetch on `[user]` (the object) and not on `user?.sub`. An inline object is a
// new identity every render, so the effect re-fires on every state update and
// the page never leaves "Loading friends...". Inlining it back is a hang, not a
// tidy-up. The other page harnesses in this phase can inline safely — they key
// on `user?.sub`.
// `vi.hoisted` because the mock factory is evaluated on the hoisted `./page`
// import, before a plain module-level const would be initialised.
const auth = vi.hoisted(() => ({
  user: { sub: 'auth0|self', name: 'Self', email: 'self@example.com' },
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: auth.user, isLoading: false }),
}));

// Received requests live in the shared provider (POLL-02), not in page state.
vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    receivedRequests: [],
    acceptRequest: vi.fn().mockResolvedValue({}),
    declineRequest: vi.fn().mockResolvedValue({}),
    loading: false,
    getStatus: () => 'none',
  }),
}));

// Only the network surfaces are replaced; the `importOriginal` spread keeps
// ApiError intact for the REAL useFetchErrorState and makes a removed export
// fail rather than silently resolve to a mock (T-88-06-01).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn().mockResolvedValue([]),
      getSentRequests: vi.fn().mockResolvedValue([]),
      searchUserByEmail: vi.fn().mockResolvedValue(null),
      sendRequest: vi.fn().mockResolvedValue({}),
      removeFriend: vi.fn().mockResolvedValue({}),
    },
    groupsAPI: {
      ...actual.groupsAPI,
      getUserGroups: vi.fn().mockResolvedValue([]),
      getGroupMembers: vi.fn().mockResolvedValue([]),
    },
    invitesAPI: {
      ...actual.invitesAPI,
      sendGroupInvite: vi.fn().mockResolvedValue({}),
    },
  };
});

import FriendsPage from './page';
// ApiError survives the partial mock above (the `importOriginal` spread), so the
// error pins exercise the REAL code-to-copy derivation in useFetchErrorState.
import { ApiError, friendshipsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

/** One accepted friendship row. `friendship.id` is what remove/accept send. */
export const FRIENDSHIP = {
  id: 'fr-1',
  friend: { id: FRIEND_UUID, username: 'Dana' },
};

/** A SECOND row. Required by the cross-target pin (AR DEC-2) — arming one row
 *  and tapping another must re-arm, never commit, so one row is not enough. */
export const FRIENDSHIP_2 = {
  id: 'fr-2',
  friend: { id: FRIEND_2_UUID, username: 'Sam' },
};

export interface RenderFriendsOptions {
  /** Accepted friendships. Pass `[]` for the empty-state case. */
  friends?: Array<Record<string, unknown>>;
  /** Outgoing requests shown on the Sent tab. */
  sent?: Array<Record<string, unknown>>;
  /**
   * Caller's resolved UUID. Pass `null` — NOT `undefined` — to render the
   * pre-identity gate: a default parameter also fires on an explicit
   * `undefined`, which would silently resolve identity instead.
   */
  selfUuid?: string | null;
  /**
   * Make the friends fetch REJECT. The list then stays empty, which is exactly
   * the state that used to render the empty copy — so this is the option that
   * proves empty and error are different surfaces.
   */
  loadError?: unknown;
}

/** Render the friends page with a resolved identity by default. */
export function renderFriends(options: RenderFriendsOptions = {}) {
  const { friends = [FRIENDSHIP], sent = [], selfUuid = SELF_UUID, loadError } = options;
  h.selfUuid = selfUuid ?? undefined;
  if (loadError !== undefined) {
    (friendshipsAPI.getFriends as Mock).mockRejectedValue(loadError);
  } else {
    (friendshipsAPI.getFriends as Mock).mockResolvedValue(friends);
  }
  (friendshipsAPI.getSentRequests as Mock).mockResolvedValue(sent);
  return render(<FriendsPage />);
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('friends render harness', () => {
  it('renders the page shell and the add-friend search once identity resolves', async () => {
    renderFriends();
    expect(await screen.findByRole('heading', { name: 'Friends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add Friend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  it('renders nothing but the identity gate while selfUuid is unresolved', async () => {
    // D-09: the friend/friend classification IS the content, so the page never
    // renders a partial list before the caller's UUID lands.
    renderFriends({ selfUuid: null });
    await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalled());
    expect(screen.queryByRole('heading', { name: 'Friends' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Add Friend' })).not.toBeInTheDocument();
    expect(screen.queryByText('Dana')).not.toBeInTheDocument();
  });
});

describe('friends list', () => {
  it('renders a row per friendship with its remove affordance', async () => {
    renderFriends();
    expect(await screen.findByText('Dana')).toBeInTheDocument();
    // The accessible name states the action AND the person (§7.2 / D-36).
    expect(screen.getByRole('button', { name: 'Remove Dana' })).toBeInTheDocument();
  });

  it('renders the shared EmptyState when the caller has no friends', async () => {
    renderFriends({ friends: [] });

    expect(
      await screen.findByRole('heading', { name: 'No friends yet' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Search by email above to find the people you play with.')
    ).toBeInTheDocument();
    // §9.2: no CTA button — the search field above IS the action.
    expect(
      screen.queryByText('No friends yet. Search for friends by email above!')
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
  });

  // Req 6 + Req 14: a failed fetch also leaves the list empty. It must NOT read
  // as "you have no friends".
  it('renders the fetch-error surface — not the empty state — when the fetch fails', async () => {
    renderFriends({ loadError: new ApiError('boom', 'network', 500) });

    expect(
      await screen.findByText("Couldn't load your friends")
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "We couldn't reach the server. Check your connection and try again."
      )
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Try again/ })).toBeInTheDocument();

    expect(
      screen.queryByRole('heading', { name: 'No friends yet' })
    ).not.toBeInTheDocument();
  });

  it('retries the fetch from the error surface', async () => {
    renderFriends({ loadError: new ApiError('boom', 'network', 500) });
    const retry = await screen.findByRole('button', { name: /Try again/ });

    (friendshipsAPI.getFriends as Mock).mockResolvedValue([FRIENDSHIP]);
    fireEvent.click(retry);

    expect(await screen.findByText('Dana')).toBeInTheDocument();
    expect(
      screen.queryByText("Couldn't load your friends")
    ).not.toBeInTheDocument();
  });
});

describe('remove friend (two-tap tier)', () => {
  /** The row's remove control, by its resting accessible name. */
  const removeButton = (name: string) =>
    screen.getByRole('button', { name: `Remove ${name}` });

  it('carries the phone tap floor, a focus-visible ring and a naming label', async () => {
    renderFriends();
    const button = await screen.findByRole('button', { name: 'Remove Dana' });

    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('min-h-11');
    expect(button.className).toContain('focus-visible:ring-2');
    expect(button.className).toContain('focus-visible:ring-focus-ring');
    // `outline-hidden`, not `outline-none` — Tailwind v4 naming.
    expect(button.className).toContain('focus:outline-hidden');
  });

  it('arms on the first tap and sends nothing', async () => {
    renderFriends();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Dana' }));

    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    expect(screen.getByText('Dana')).toBeInTheDocument();

    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveTextContent('Tap again to confirm');
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    // The live region names the target so a row switch re-announces.
    expect(screen.getByRole('status')).toHaveTextContent(
      'Press again to confirm: Remove Dana'
    );
  });

  it('commits on a second tap inside the window and drops the row', async () => {
    renderFriends();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Dana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    await waitFor(() =>
      expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledWith(FRIENDSHIP.id)
    );
    expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('Dana')).not.toBeInTheDocument());
  });

  it('reverts to the resting label once the arm window lapses', async () => {
    renderFriends();
    const button = await screen.findByRole('button', { name: 'Remove Dana' });

    // Fake timers are installed AFTER the mount fetches settle — installing them
    // first would stall the promise-driven render this test depends on.
    vi.useFakeTimers();
    fireEvent.click(button);
    expect(button).toHaveTextContent('Tap again to confirm');

    act(() => {
      vi.advanceTimersByTime(3000);
    });

    expect(button).toHaveTextContent('Remove');
    expect(button).toHaveAttribute('aria-label', 'Remove Dana');
    expect(button).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('status')).toHaveTextContent('');
    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  // AR DEC-2. The hook keys the armed state on the TARGET id, not a boolean —
  // without that, arming one row and single-tapping another destroys the second.
  it('re-arms rather than commits when a DIFFERENT row is tapped inside the window', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Dana' }));
    fireEvent.click(removeButton('Sam'));

    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    expect(screen.getByText('Sam')).toBeInTheDocument();

    // Sam is now the armed row; Dana has reverted to resting.
    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    expect(removeButton('Dana')).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('status')).toHaveTextContent(
      'Press again to confirm: Remove Sam'
    );
  });

  it('removes the row that is actually armed after a cross-row switch', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Dana' }));
    fireEvent.click(removeButton('Sam'));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    await waitFor(() =>
      expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledWith(FRIENDSHIP_2.id)
    );
    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalledWith(FRIENDSHIP.id);
    await waitFor(() => expect(screen.queryByText('Sam')).not.toBeInTheDocument());
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });
});
