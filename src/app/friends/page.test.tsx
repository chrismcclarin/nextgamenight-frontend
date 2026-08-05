// Phase 88 plan 06 Task 2 — RENDER HARNESS for the friends surface.
//
// WHY THIS FILE EXISTS (read before extending):
// friends/page.js had no test file at all, so Req 6's empty-state work and the
// remove-friend gate had nowhere to be asserted. This harness supplies the mock
// stack and a render helper; later plans add ASSERTIONS, not infrastructure.
//
// WHAT IS ASSERTED HERE: only what is true on THIS branch. In particular the
// remove-friend flow TODAY goes through the native browser `confirm()` — that is
// pinned below as the current behaviour, and plan 88-14 is the plan that replaces
// it. Asserting the replacement now would red every plan in between.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` page under test.
//
// ---------------------------------------------------------------------------
// EXTENSION POINTS — who adds what, and where
// ---------------------------------------------------------------------------
// * plan 88-14 replaces the native `confirm()` in `handleRemove` with the
//   two-tap inline confirmation idiom. When it does, it REPLACES the
//   `describe('remove friend (current: native confirm)')` block below with the
//   two-tap pin (first tap arms and sends nothing; second tap commits) and
//   deletes the `confirmSpy` plumbing.
// * plan 88-14 also swaps the bare "No friends yet." paragraph for the shared
//   <EmptyState> primitive and adds that pin to `describe('friends list')`.
// * Req 6's surface work extends `describe('friends list')` as well — use
//   `renderFriends({ friends: [] })` for the empty case.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const FRIEND_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';

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
import { friendshipsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

/** One accepted friendship row. `friendship.id` is what remove/accept send. */
export const FRIENDSHIP = {
  id: 'fr-1',
  friend: { id: FRIEND_UUID, username: 'Dana' },
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
}

/** Render the friends page with a resolved identity by default. */
export function renderFriends(options: RenderFriendsOptions = {}) {
  const { friends = [FRIENDSHIP], sent = [], selfUuid = SELF_UUID } = options;
  h.selfUuid = selfUuid ?? undefined;
  (friendshipsAPI.getFriends as Mock).mockResolvedValue(friends);
  (friendshipsAPI.getSentRequests as Mock).mockResolvedValue(sent);
  return render(<FriendsPage />);
}

let confirmSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
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
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('renders the empty text when the caller has no friends', async () => {
    renderFriends({ friends: [] });
    expect(
      await screen.findByText('No friends yet. Search for friends by email above!')
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove' })).not.toBeInTheDocument();
  });
});

describe('remove friend (current: native confirm)', () => {
  it('sends the removal and drops the row once the native confirm is accepted', async () => {
    renderFriends();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledWith(FRIENDSHIP.id)
    );
    await waitFor(() => expect(screen.queryByText('Dana')).not.toBeInTheDocument());
  });

  it('sends nothing and keeps the row when the native confirm is declined', async () => {
    confirmSpy.mockReturnValue(false);
    renderFriends();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });
});
