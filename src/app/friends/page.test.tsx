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
// `refreshFriendships` is hoisted so tests can assert the unfriend mutation
// refreshes the provider (88-33 Task 9, UAT row 553).
// Phase 88.6-19: `receivedRequests` and the two mutators joined this holder so the
// Requests tab can actually be rendered and its accept/decline catches driven. They
// were inline literals, which made the two catches this plan registers as a no-sink
// residual unreachable from any test — the reason they had no coverage at all.
const providerCtx = vi.hoisted(() => ({
  refreshFriendships: vi.fn(),
  receivedRequests: [] as Array<Record<string, unknown>>,
  acceptRequest: vi.fn(),
  declineRequest: vi.fn(),
}));
vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    receivedRequests: providerCtx.receivedRequests,
    acceptRequest: providerCtx.acceptRequest,
    declineRequest: providerCtx.declineRequest,
    loading: false,
    getStatus: () => 'none',
    refreshFriendships: providerCtx.refreshFriendships,
  }),
}));

// Phase 88.6-19 (AC-2). The house log channel and the page's ONE Sentry escalation
// path, both replaced so the arms below can count calls rather than infer them.
// `errCtx` stays REAL (importOriginal) — the property under test is that the raw
// `Error` never reaches `logger.info`'s `ctx` parameter, which a mocked helper
// could not show.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return { ...actual, logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } };
});
vi.mock('@/lib/queryClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/queryClient')>();
  return { ...actual, queryCacheOnError: vi.fn() };
});

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
      sendFriendInvite: vi.fn().mockResolvedValue({}),
    },
  };
});

import FriendsPage from './page';
// ApiError survives the partial mock above (the `importOriginal` spread), so the
// error pins exercise the REAL code-to-copy derivation in useFetchErrorState.
import { ApiError, friendshipsAPI } from '@/lib/api';
import { logger } from '@/lib/logger';
import { queryCacheOnError } from '@/lib/queryClient';

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
  // `clearAllMocks` clears CALLS, not IMPLEMENTATIONS, so a rejection set by one arm
  // would leak into every later one in file order. Restore the defaults explicitly.
  providerCtx.receivedRequests = [];
  providerCtx.acceptRequest.mockResolvedValue({});
  providerCtx.declineRequest.mockResolvedValue({});
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

  it('the logged-out branch keeps a real ANCHOR to the Auth0 handler', async () => {
    /* Phase 88.6-19 task 3. Neither friends test file exercised `!user` before this, so the
       logged-out branch — the one surface a signed-out visitor can reach — had no coverage at
       all, and its `.btn` migration could have silently changed the element KIND with nothing to
       catch it. What this pins, and why each half matters:
         - `role: 'link'` (not `button`): `<Button asChild>` slots onto the child, so the child
           must still be an `<a>`. If a future edit drops `asChild`, or swaps the child for a
           `<Link>`, this role query is what notices.
         - the EXACT href: a client-router navigation to Auth0's handoff route is a behaviour
           change, not a cleanup (UI-SPEC §3.2's asChild row says so in terms).
       `auth.user` is restored in the `finally` so no later test inherits a signed-out page. */
    const saved = auth.user;
    auth.user = null as unknown as typeof auth.user;
    try {
      render(<FriendsPage />);
      const login = await screen.findByRole('link', { name: 'Log In' });
      expect(login).toHaveAttribute('href', '/api/auth/login');
      expect(login.tagName).toBe('A');
      // The primitive's own classes reached the slotted child (the `Slot` contract).
      expect(login.className).toContain('btn');
      expect(login.className).toContain('min-h-11');
      // `type` is meaningless on an anchor and `Button` omits it when slotted.
      expect(login).not.toHaveAttribute('type');
    } finally {
      auth.user = saved;
    }
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

// 88-CODE-REVIEW D2: the send-request failure paths had ZERO coverage, which is
// how the conflict copy shipped keyed on a code a 409 never produces. ApiError
// is real here (importOriginal spread), so these pins exercise the REAL byCode
// derivation over an ApiError carrying the 409-mapped code — the status→code
// arm itself is pinned in api.test.ts (mapErrorToCode 409 → 'conflict'); this
// file hand-supplies the code and does NOT execute statusToCode (delta-review
// comment correction, 2026-08-06 — do not delete the api.test.ts pin believing
// this one covers that seam).
// 88-CODE-REVIEW MED#1: removing a friend must also prune them from the
// bulk-invite selection — before this pin, the "N selected" count kept counting
// the ex-friend and handleBulkInvite still dispatched a group invite on behalf
// of the severed relationship (the relationship-exit-pruning class).
describe('remove friend prunes the bulk-invite selection (MED#1)', () => {
  it('unselects the removed friend — the selected counter clears with the row', async () => {
    const { groupsAPI } = await import('@/lib/api');
    // The invite bar filters to groups where SELF is owner/admin, via the
    // roster on each group row — the shape the derive effect reads.
    (groupsAPI.getUserGroups as Mock).mockResolvedValue([
      {
        id: 'g1',
        name: 'Test Group',
        Users: [{ id: SELF_UUID, UserGroup: { role: 'owner' } }],
      },
    ]);
    renderFriends();

    fireEvent.change(await screen.findByLabelText('Invite to group'), {
      target: { value: 'g1' },
    });
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Select Dana' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Remove Dana' }));
    fireEvent.click(screen.getByRole('button', { name: 'Tap again to confirm' }));

    await waitFor(() =>
      expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledWith(FRIENDSHIP.id)
    );
    expect(screen.queryByText('1 selected')).not.toBeInTheDocument();
  });
});

describe('send friend request — conflict/validation copy (D2)', () => {
  async function searchAndFind() {
    renderFriends({ friends: [] });
    (friendshipsAPI.searchUserByEmail as Mock).mockResolvedValue({
      id: 'user-search-hit',
      username: 'Riley',
      email: 'riley@example.com',
    });
    fireEvent.change(screen.getByPlaceholderText("Enter friend's email address"), {
      target: { value: 'riley@example.com' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    return screen.findByRole('button', { name: 'Send Request' });
  }

  it('a code-less 409 shows the ratified conflict copy, not the generic fallback', async () => {
    const send = await searchAndFind();
    (friendshipsAPI.sendRequest as Mock).mockRejectedValue(
      new ApiError('Friend request already pending', 'conflict', 409)
    );
    fireEvent.click(send);

    expect(
      await screen.findByText("You're already friends, or a request is already pending.")
    ).toBeInTheDocument();
  });

  it('a 400 shows the validation copy — no longer the (wrong) already-pending line', async () => {
    const send = await searchAndFind();
    (friendshipsAPI.sendRequest as Mock).mockRejectedValue(
      new ApiError('Cannot send a friend request to yourself', 'validation', 400)
    );
    fireEvent.click(send);

    expect(
      await screen.findByText("That request couldn't be sent. Check who you're sending it to.")
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/already have one pending/)
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
    // 88-33 Task 9 (UAT row 553): the shared provider refreshes so friend
    // pills on every other surface drop the severed relationship too.
    expect(providerCtx.refreshFriendships).toHaveBeenCalled();
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

// 88-33 Task 7 (WI-F7, Rule-2 riders): the requests/sent section empties ride
// the D2 mini-formula — one muted text-sm line.
describe('friends request-tab empties (D2 mini-formula riders)', () => {
  it('sent + received empties are muted text-sm one-liners', async () => {
    renderFriends({ sent: [] });
    await screen.findByText('Dana'); // page settled

    fireEvent.click(screen.getByRole('button', { name: /Requests/ }));
    const received = await screen.findByText('No pending friend requests.');
    expect(received.className).toContain('text-content-muted');
    expect(received.className).toContain('text-sm');

    fireEvent.click(screen.getByRole('button', { name: /Sent/ }));
    const sentEmpty = await screen.findByText('No sent friend requests.');
    expect(sentEmpty.className).toContain('text-content-muted');
    expect(sentEmpty.className).toContain('text-sm');
  });
});

/* Phase 88.6-19 task 3 (AC-2). Everything below is NEW.
 *
 * WHY THESE ARE BEHAVIORAL AND NOT A SOURCE GREP: the acceptance this file answers is not
 * "no `console.` string remains" — that is a call-site scan and it lives in the summary's
 * receipt. It is that the six converted catches still reach a channel, that the THREE LOAD
 * catches did not acquire a SECOND Sentry capture for one failure, and that nothing was
 * escalated past the level the owner ruled on 2026-09-13. Only a call count can say those. */
describe('friends AC-2 — the converted channel, and what it did NOT become', () => {
  const boom = () => new Error('HTTP error! status: 500');

  it('a failed friends LOAD files exactly ONE Sentry capture and one breadcrumb', async () => {
    renderFriends({ loadError: boom() });
    await screen.findByText("Couldn't load your friends");

    // The pre-existing `queryCacheOnError` forward is the SOLE Sentry EVENT for this
    // failure and is byte-unchanged. The converted line adds a breadcrumb beside it,
    // never a second capture — which is the whole reason the load catches could be
    // converted IN PLACE rather than dropped.
    const captures = (queryCacheOnError as Mock).mock.calls.filter(
      ([, meta]) => (meta as { queryKey?: string[] })?.queryKey?.[1] === 'accepted'
    );
    expect(captures).toHaveLength(1);

    const breadcrumbs = (logger.info as Mock).mock.calls.filter(
      ([msg]) => msg === 'Error fetching friends:'
    );
    expect(breadcrumbs).toHaveLength(1);
    expect(breadcrumbs[0][1]).toEqual({ name: 'Error', message: 'HTTP error! status: 500' });
    expect(breadcrumbs[0][1]).not.toBeInstanceOf(Error);
  });

  it('nothing on this page is escalated — no converted call files an EVENT of its own', async () => {
    // `logger.error` is `Sentry.captureException` and `logger.warn` is
    // `Sentry.captureMessage`; both are events and both are the arms the owner rejected
    // when AC-2's level was amended to `info` on 2026-09-13. Promoting a site here is a
    // decision that needs a recorded ruling, not a cleanup.
    renderFriends({ loadError: boom() });
    await screen.findByText("Couldn't load your friends");
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it.each([
    ['accept', 'Accept', 'acceptRequest', 'Error accepting request:'],
    ['decline', 'Decline', 'declineRequest', 'Error declining request:'],
  ] as const)(
    'a failed %s reaches the log channel AND shows the user nothing — the registered residual',
    async (_label, button, mutator, message) => {
      // These two are the sites this plan registers as an owner-facing residual in
      // `.planning/deferred/phase-88.6.md`: after the conversion the failure is silent to
      // the user AND silent in the browser console, surviving only as a breadcrumb. BOTH
      // halves are asserted here, so the residual is pinned as a FACT rather than as a
      // sentence in a summary that nothing re-checks. If a later plan gives either path a
      // toast or a banner, the second half reds and the register entry must be amended.
      providerCtx.receivedRequests = [
        { id: 'req-1', Requester: { id: FRIEND_2_UUID, username: 'Sam' } },
      ];
      providerCtx[mutator].mockRejectedValue(boom());
      renderFriends();
      await screen.findByText('Dana');
      fireEvent.click(screen.getByRole('button', { name: /^Requests/ }));

      fireEvent.click(await screen.findByRole('button', { name: button }));

      await waitFor(() =>
        expect((logger.info as Mock).mock.calls.some(([m]) => m === message)).toBe(true)
      );
      const call = (logger.info as Mock).mock.calls.find(([m]) => m === message);
      expect(call?.[1]).toEqual({ name: 'Error', message: 'HTTP error! status: 500' });
      expect(call?.[1]).not.toBeInstanceOf(Error);

      // The silent half. Settled on a POSITIVE signal first (the breadcrumb above), so
      // this absence claim is observed AFTER the failure landed rather than on tick one.
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(/couldn't|went wrong|Something/i)).not.toBeInTheDocument();
      // ...and the row is still sitting there, indistinguishable from an unattempted one.
      expect(screen.getByText('Sam')).toBeInTheDocument();
    }
  );

  it('a failed REMOVE keeps its sink — which is why it is EXCLUDED from that residual', async () => {
    (friendshipsAPI.removeFriend as Mock).mockRejectedValue(boom());
    renderFriends();
    fireEvent.click(await screen.findByRole('button', { name: 'Remove Dana' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Tap again to confirm' }));

    await waitFor(() =>
      expect((logger.info as Mock).mock.calls.some(([m]) => m === 'Error removing friend:')).toBe(
        true
      )
    );
    expect(
      await screen.findByText("We couldn't remove that friend. Please try again.")
    ).toBeInTheDocument();
  });
});

describe('friends D-16 / R2 #171 — the tab strip', () => {
  it('the count pill is off the below-AA link ink', async () => {
    renderFriends();
    await screen.findByText('Dana');
    const pill = screen.getByText('1');
    expect(pill.className).toContain('bg-surface-muted');
    expect(pill.className).toContain('text-content-secondary');
    // 3.9909 on this ground — the token was wrong, not the ground (zero of the 61
    // `text-content-link` sites on it is a link).
    expect(pill.className).not.toContain('text-content-link');
  });

  it('the ACTIVE tab is announced, not only coloured', async () => {
    renderFriends();
    await screen.findByText('Dana');
    const friendsTab = screen.getByRole('button', { name: /^Friends/ });
    const sentTab = screen.getByRole('button', { name: /^Sent/ });
    expect(friendsTab).toHaveAttribute('aria-current', 'true');
    expect(sentTab).not.toHaveAttribute('aria-current');

    fireEvent.click(sentTab);
    await waitFor(() => expect(sentTab).toHaveAttribute('aria-current', 'true'));
    expect(screen.getByRole('button', { name: /^Friends/ })).not.toHaveAttribute('aria-current');
  });
});

describe('friends #127 / R8 §2 — the email search 404 is STATUS-keyed, not prose-matched', () => {
  // Added by plan 88.6-42 task 1 (2026-09-17), in the SAME commit as the `body.error` alias
  // drop that forced it. Before that drop the outcome below was decided by TWO prose arms on
  // `ApiError.message` — `.includes('404')` and `.includes('No user found')`. The second could
  // never match again once the alias went (its string comes from Sonnet/routes/friendships.js:251,
  // a RAW 404 with no `code` and no `message`), and the first survived only INCIDENTALLY,
  // because the bare fallback template "HTTP error! status: 404" happens to contain "404".
  // That is luck, not a design — this suite is what makes it a design.
  const search = async (rejectWith: unknown) => {
    (friendshipsAPI.searchUserByEmail as Mock).mockRejectedValue(rejectWith);
    renderFriends();
    const input = await screen.findByLabelText("Friend's email address");
    fireEvent.change(input, { target: { value: 'nobody@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  };

  it('renders the search outcome copy for a 404, byte-identical to before the re-key', async () => {
    // The real shape after the drop: a raw backend 404, so `message` is the bare template
    // and `status` is the ONLY thing that identifies the outcome.
    await search(new ApiError('HTTP error! status: 404', 'not_found', 404));
    expect(await screen.findByText('No user found with that email.')).toBeInTheDocument();
  });

  it('does NOT depend on the message text — a 404 with NO "404" in its message still works', async () => {
    // This is the arm that proves the re-key. Against the OLD prose arms this rejection
    // rendered the generic failure line; against the status test it renders the outcome.
    await search(new ApiError('Resource not found', 'not_found', 404));
    expect(await screen.findByText('No user found with that email.')).toBeInTheDocument();
  });

  it('a NON-404 failure still gets the DERIVED register copy, not the search outcome', async () => {
    // A coded failure resolves through MESSAGE_BY_CODE and ignores `fallback` entirely —
    // that narrowing is DECISION Phase 88.6-14 (D-33) in useFetchErrorState.ts, not a slip here.
    await search(new ApiError('HTTP error! status: 500', 'internal', 500));
    expect(
      await screen.findByText('Something went wrong on our end. Please try again shortly.')
    ).toBeInTheDocument();
    expect(screen.queryByText('No user found with that email.')).toBeNull();
  });

  it('a non-ApiError rejection does not throw on the optional-chained status read', async () => {
    // The re-key reads `err?.status`. A plain TypeError has none, so it must fall to the
    // generic branch rather than blowing up inside the catch.
    await search(new TypeError('Failed to fetch'));
    expect(
      await screen.findByText("We couldn't run that search. Please try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText('No user found with that email.')).toBeNull();
  });
});
