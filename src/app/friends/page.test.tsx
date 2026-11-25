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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as React from 'react';
import { act, render, screen, cleanup, waitFor, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPINNER_MIN_MS } from '@/components/ui/useDelayedSpinner';
import { expectFocusRingEdge, expectFocusRingInset, expectRingGround } from '@/test-utils/focusRingAssert'; // AMENDED Phase 88.9-54 (R-C3b): the hold budget

const SELF_UUID = 'ffffffff-ffff-4fff-8fff-ffffffffffff';
const FRIEND_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const FRIEND_2_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

/**
 * Mutable resolved identity. The friends page GATES its whole render on
 * `selfUuid` (D-09) — with it undefined the page is a spinner and nothing else,
 * so every list assertion needs it set.
 */
// 88.6.1-63: `identityError` drives the identity query's `isError` (FK1: a failed re-read over a held row).
const h = vi.hoisted(() => ({ selfUuid: undefined as string | undefined, identityError: false }));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: {
      isError: h.identityError,
      error: h.identityError ? new Error('identity failed') : null,
      isPending: !h.selfUuid,
      refetch: vi.fn(),
    },
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
  // 88.9-40 (SESSION-01): what useUser reports when /api/auth/me itself fails.
  error: null as unknown,
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: auth.user, error: auth.error, isLoading: false }),
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
  // 88.6.1-40: stands in for plan 88.6.1-66's read-only context fact (a request row in flight on any surface).
  isRequestActionPending: vi.fn((_id: string) => false),
  // 88.6.1-40 carry-in: the provider's first-load flag (true until its first load settles).
  loading: false,
  // 88.6.1-72: plan 88.6.1-66's load-error object (null while healthy), its has-loaded fact (the
  // Requests tab's C3 input; true = a load succeeded for this user) and its JOINING retry (the
  // Requests adapter's refetch, review finding #149; `refreshFriendships` stays the post-unfriend sync).
  error: null as unknown,
  hasLoaded: true,
  retryFriendships: vi.fn(),
}));
vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    receivedRequests: providerCtx.receivedRequests,
    acceptRequest: providerCtx.acceptRequest,
    declineRequest: providerCtx.declineRequest,
    isRequestActionPending: providerCtx.isRequestActionPending,
    loading: providerCtx.loading,
    getStatus: () => 'none',
    refreshFriendships: providerCtx.refreshFriendships,
    error: providerCtx.error,
    hasLoaded: providerCtx.hasLoaded,
    retryFriendships: providerCtx.retryFriendships,
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
import { ApiError, friendshipsAPI, groupsAPI, invitesAPI } from '@/lib/api';
import { logger } from '@/lib/logger';
import { queryCacheOnError } from '@/lib/queryClient';
// AMENDED Phase 88.9-66 (X68, owner ruled 2026-11-14): a full banner shows Try again, so where a test
// below reads the line a forbidden, validation or unknown failure shows in one, it reads the
// beside-retry form (messageBesideRetry over the register line).
import { getFetchErrorMessage, messageBesideRetry } from '@/components/ui/useFetchErrorState';
import { REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';
import { signInLatchKey } from '@/lib/hooks/useSignInRedirect';
import { CONFIRM_DELAY_MS } from '@/components/ui/confirmDelay';

// F9b (88.9-23): the two-tap gate refuses the second tap for CONFIRM_DELAY_MS after arming.
// A test that commits installs a fake clock that still advances with real time (so the
// promise-driven renders keep flowing; installed after the mount fetches settle, as the
// OW-2 test below does) BEFORE the arming tap, then steps past the gate with passGate().
function fakeClock() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
}

function passGate() {
  act(() => {
    vi.advanceTimersByTime(CONFIRM_DELAY_MS);
  });
}

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
  h.identityError = false;
  auth.error = null;
  window.sessionStorage.clear();
  // `clearAllMocks` clears CALLS, not IMPLEMENTATIONS, so a rejection set by one arm
  // would leak into every later one in file order. Restore the defaults explicitly.
  providerCtx.receivedRequests = [];
  providerCtx.acceptRequest.mockReset().mockResolvedValue({});
  providerCtx.declineRequest.mockReset().mockResolvedValue({});
  providerCtx.isRequestActionPending.mockImplementation(() => false);
  providerCtx.loading = false;
  // 88.6.1-72: a healthy provider whose load succeeded (every pre-existing case renders as before);
  // both loads resolve plan 88.6.1-66's `{ isError: false }`.
  providerCtx.error = null;
  providerCtx.hasLoaded = true;
  providerCtx.refreshFriendships.mockReset().mockResolvedValue({ isError: false });
  providerCtx.retryFriendships.mockReset().mockResolvedValue({ isError: false });
  // 88.6.1-40: the API mocks too (reset first, so an unconsumed one-shot cannot leak), because one arm's admin group used to leak into every later render.
  (groupsAPI.getUserGroups as Mock).mockReset().mockResolvedValue([]);
  (groupsAPI.getGroupMembers as Mock).mockReset().mockResolvedValue([]);
  (invitesAPI.sendFriendInvite as Mock).mockReset().mockResolvedValue({});
  (friendshipsAPI.sendRequest as Mock).mockReset().mockResolvedValue({});
  (friendshipsAPI.removeFriend as Mock).mockReset().mockResolvedValue({});
  (friendshipsAPI.searchUserByEmail as Mock).mockReset().mockResolvedValue(null);
  // 88.6.1-72: the two list mocks too, so a one-shot answer an arm leaves unconsumed cannot leak
  // into the next arm (renderFriends sets each one's standing answer).
  (friendshipsAPI.getFriends as Mock).mockReset().mockResolvedValue([]);
  (friendshipsAPI.getSentRequests as Mock).mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// 88.9-40 (SESSION-01): the gameDetail suite's location stub (src/app/gameDetail/page.test.tsx ("function stubLocation(")),
// pinned to /friends: the guard reads pathname + search + hash and calls replace; the prompt's Log In
// href and the latch key read the same location. Each caller restores REAL_LOCATION itself.
const REAL_LOCATION = window.location;
function stubLocation(pathname = '/friends') {
  const replace = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: {
      origin: 'http://localhost',
      protocol: 'http:',
      host: 'localhost',
      hostname: 'localhost',
      port: '',
      pathname,
      search: '',
      hash: '',
      href: `http://localhost${pathname}`,
      replace,
      assign: vi.fn(),
    },
  });
  return replace;
}
function restoreLocation() {
  Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION });
}

describe('friends render harness', () => {
  it('renders the page shell and the add-friend search once identity resolves', async () => {
    renderFriends();
    expect(await screen.findByRole('heading', { name: 'Friends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Add Friend' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
  });

  // 88.6.1-63 (AC-29): a failed identity re-read that kept its row is not an identity failure;
  // the page renders, not the whole-page identity error.
  it('a held identity row renders the page, not the identity error (88.6.1-63, AC-29)', async () => {
    h.identityError = true;
    renderFriends();
    expect(await screen.findByRole('heading', { name: 'Add Friend' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /try again/i })).not.toBeInTheDocument();
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
       `auth.user` is restored in the `finally` so no later test inherits a signed-out page.
       AMENDED Phase 88.9-40 (SESSION-01): the prompt is now the DECLINED arm (a signed-out visitor is
       redirected first), so the latch is set after the location stub, and the href carries returnTo
       (buildSignInUrl, src/lib/signIn.ts) — still a hard-navigation `<a>`, which is 88.6-19's rule. */
    const saved = auth.user;
    auth.user = null as unknown as typeof auth.user;
    const replace = stubLocation('/friends');
    window.sessionStorage.setItem(signInLatchKey(window.location), '1');
    try {
      render(<FriendsPage />);
      // AMENDED Phase 88.9-66 (X70b, owner 2026-11-14): the declined return is the shared banner in
      // the centred frame, so the hard-navigation anchor this test guards is the banner's own Sign
      // in. It is a plain link, not a slotted Button, so the btn class read is gone; the 44px floor
      // and the exact href stay.
      const signInLink = await screen.findByRole('link', { name: 'Sign in' });
      expect(signInLink).toHaveAttribute('href', '/api/auth/login?returnTo=%2Ffriends');
      expect(replace).not.toHaveBeenCalled();
      expect(signInLink.tagName).toBe('A');
      expect(signInLink.className).toContain('min-h-11');
      expect(signInLink).not.toHaveAttribute('type');
      expect(signInLink.closest('[data-slot="page-frame"]'), 'the banner sits in the shared centred frame').not.toBeNull();
      expect(screen.getByText("Couldn't load your friends")).toBeInTheDocument();
      expect(screen.queryByRole('link', { name: 'Log In' })).toBeNull();
      // 88.9-52 A-04: the page-replacing banner screen keeps ONE level-1 heading, for screen readers only.
      expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
      expect(screen.getByRole('heading', { level: 1, name: 'Friends' })).toHaveClass('sr-only');
    } finally {
      auth.user = saved;
      restoreLocation();
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

    fakeClock();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Dana' }));
    passGate();
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

// 88.6.1-72 Task 2: the remove gate's own polite region, the element rendered immediately before
// the Add Friend card. Every loaded render of the Friends tab now also carries the RF1 notice's
// region (and the Add Friend card the found-result region), so a bare status query is ambiguous;
// the expected texts below are unchanged.
function gateStatus(): HTMLElement {
  const card = screen.getByRole('heading', { name: 'Add Friend' }).closest('div.card');
  const region = card?.previousElementSibling as HTMLElement | null;
  expect(region).toHaveAttribute('role', 'status');
  return region as HTMLElement;
}

describe('remove friend (two-tap tier)', () => {
  /** The row's remove control, by its resting accessible name. */
  const removeButton = (name: string) =>
    screen.getByRole('button', { name: `Remove ${name}` });

  it('carries the phone tap floor, a focus-visible ring and a naming label', async () => {
    renderFriends();
    const button = await screen.findByRole('button', { name: 'Remove Dana' });

    expect(button).toHaveAttribute('type', 'button');
    expect(button.className).toContain('min-h-11');
    expectFocusRingEdge(button, undefined, 'Remove Dana');
    // `outline-hidden`, not `outline-none` — Tailwind v4 naming.
    expect(button.className).toContain('focus:outline-hidden');
  });

  it('arms on the first tap and sends nothing', async () => {
    renderFriends();
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);

    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    expect(screen.getByText('Dana')).toBeInTheDocument();

    // F9b (MED-62): inside the gate the armed Remove counts down and is aria-disabled, and
    // nothing is announced yet.
    const gated = screen.getByRole('button', { name: 'Remove Dana, wait 3 seconds' });
    expect(gated).toHaveTextContent('Wait (3)');
    expect(gated).toHaveAttribute('aria-disabled', 'true');
    expect(gated).toHaveAttribute('aria-pressed', 'true');
    expect(gateStatus().textContent).toBe('');
    passGate();

    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveTextContent(/^Tap again$/);
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    // The live region names the target so a row switch re-announces.
    expect(gateStatus()).toHaveTextContent(
      'Press again to confirm: Remove Dana'
    );
  });

  it('commits on a second tap inside the window and drops the row', async () => {
    renderFriends();
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);
    passGate();
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

  // OW-2 A (owner 2026-11-22, Phase 89.6-04): the armed state has no time limit. This test replaced
  // the one that pinned the revert at the end of the old live window.
  it('OW-2 (89.6-04): an armed Remove is still live after 60 s; a press outside it disarms, says Confirmation cancelled. and removes nothing', async () => {
    renderFriends();
    const button = await screen.findByRole('button', { name: 'Remove Dana' });

    // Fake timers are installed AFTER the mount fetches settle — installing them
    // first would stall the promise-driven render this test depends on.
    vi.useFakeTimers();
    try {
      fireEvent.click(button);
      expect(button).toHaveTextContent('Wait (3)');

      act(() => {
        vi.advanceTimersByTime(CONFIRM_DELAY_MS);
      });
      act(() => {
        vi.advanceTimersByTime(60_000);
      });
      const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
      expect(armed).toBe(button);
      expect(armed).toHaveAttribute('aria-pressed', 'true');

      // A press anywhere outside the control itself disarms it, and the gate's own region says so.
      fireEvent.mouseDown(screen.getByRole('heading', { name: 'Add Friend' }));
      expect(screen.getByRole('button', { name: 'Remove Dana' })).toBe(button);
      expect(button).toHaveTextContent('Remove');
      expect(button).not.toHaveAttribute('aria-pressed');
      expect(gateStatus().textContent).toBe('Confirmation cancelled.');
      expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // AR DEC-2. The hook keys the armed state on the TARGET id, not a boolean —
  // without that, arming one row and single-tapping another destroys the second.
  it('re-arms rather than commits when a DIFFERENT row is tapped inside the window', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);
    fireEvent.click(removeButton('Sam'));

    expect(friendshipsAPI.removeFriend as Mock).not.toHaveBeenCalled();
    expect(screen.getByText('Sam')).toBeInTheDocument();
    passGate();

    // Sam is now the armed row; Dana has reverted to resting.
    const armed = screen.getByRole('button', { name: 'Tap again to confirm' });
    expect(armed).toHaveAttribute('aria-pressed', 'true');
    expect(removeButton('Dana')).not.toHaveAttribute('aria-pressed');
    expect(gateStatus()).toHaveTextContent(
      'Press again to confirm: Remove Sam'
    );
  });

  it('removes the row that is actually armed after a cross-row switch', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);
    fireEvent.click(removeButton('Sam'));
    passGate();
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
    ['accept', 'Accept', 'acceptRequest', 'Error accepting request:', "We couldn't accept that friend request. Please try again."],
    ['decline', 'Decline', 'declineRequest', 'Error declining request:', "We couldn't decline that friend request. Please try again."],
  ] as const)(
    'a failed %s reaches the log channel AND shows its line (88.6.1-72)',
    async (_label, button, mutator, message, line) => {
      // These two are the sites this plan registers as an owner-facing residual in
      // `.planning/deferred/phase-88.6.md`: after the conversion the failure is silent to
      // the user AND silent in the browser console, surviving only as a breadcrumb. BOTH
      // halves are asserted here, so the residual is pinned as a FACT rather than as a
      // sentence in a summary that nothing re-checks. If a later plan gives either path a
      // toast or a banner, the second half reds and the register entry must be amended.
      // CLOSED by 88.6.1-72 on the owner's 2026-10-05 ruling: the sentence above is what
      // happened. The second half now pins the shown line (copy rows N5 / N6, D-30, as the
      // bell's `fallback` for the same provider call; `boom()` is a plain Error, code `unknown`,
      // so the fallback answers), and the breadcrumb half is unchanged. Plan 88.6.1-58 amends
      // `.planning/deferred/phase-88.6.md:2004-2006`.
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

      // The shown half (88.6.1-72): the failure's own line, exactly, in the house alert; and
      // the row is still there, ready for a retry.
      expect((await screen.findByRole('alert')).textContent).toBe(line);
      expect(screen.getByText('Sam')).toBeInTheDocument();
    }
  );

  it('a failed REMOVE keeps its sink — which is why it is EXCLUDED from that residual', async () => {
    (friendshipsAPI.removeFriend as Mock).mockRejectedValue(boom());
    renderFriends();
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);
    passGate();
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

  // PIX-8 (88.9-52, picture pass): the active tab's label was the primary BUTTON FILL colour used as
  // ink (a dim slate blue on the dark page: 2.99, and 4.34 on the light page, both under 4.5). It is the
  // primary text ink now, the Tabs primitive's active ink. The active tab is still told apart by more
  // than colour: the 2px underline and aria-current. The numbers are held in
  // src/app/tokenContrast.test.ts ("PIX-8 (88.9-52): the Friends tab labels on the page").
  it('PIX-8 (88.9-52): the active tab label is the primary text ink with its underline; the inactive tabs keep the secondary ink and no underline', async () => {
    renderFriends();
    await screen.findByText('Dana');
    const tokens = (el: HTMLElement) => el.className.split(/\s+/);
    const friendsTab = screen.getByRole('button', { name: /^Friends/ });
    const sentTab = screen.getByRole('button', { name: /^Sent/ });
    expect(tokens(friendsTab)).toContain('text-content-primary');
    expect(tokens(friendsTab)).not.toContain('text-btn-primary');
    expect(tokens(friendsTab)).toContain('border-b-2');
    // AMENDED Phase 89.6-09 (U1, owner pick O-3): the underline's colour class is the tab-indicator
    // token now (it was border-btn-primary, 2.99 on the dark page); the 2px underline stands.
    expect(tokens(friendsTab)).toContain('border-tab-indicator');
    expect(tokens(sentTab)).toContain('text-content-secondary');
    expect(tokens(sentTab)).not.toContain('border-b-2');

    fireEvent.click(sentTab);
    await waitFor(() => expect(tokens(sentTab)).toContain('text-content-primary'));
    expect(tokens(sentTab)).toContain('border-b-2');
    expect(tokens(screen.getByRole('button', { name: /^Friends/ }))).toContain('text-content-secondary');
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

// Phase 88.6.1-40 Task 1 (Req 7, Req 4 / D-35, Req 8 / D-22, Req 11). Shared helpers for the
// three 88.6.1-40 describes below. `//` comments only in this file (FE-TESTING-CONVENTIONS CF-9).
function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

// One macrotask inside act: every promise continuation queued before it has run.
const flushMacrotask = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

// A group the caller administers (the invite bar lists only owner/admin groups).
const adminGroup = (id: string, name: string) => ({
  id,
  name,
  Users: [{ id: SELF_UUID, UserGroup: { role: 'owner' } }],
});

const statusRegion = () => document.getElementById('friends-batch-status');
const errorRegion = () => document.getElementById('friends-batch-error');
const inviteButton = () => screen.getByRole('button', { name: /^Invite to Group( ?, sending)?$/ }); // AMENDED Phase 88.9-56 (R-C3b reach): Button busy names it Invite to Group, sending

// Renders with the given admin groups, selects `select`, and returns once that group's member
// load has settled: the members call was made (positive), one macrotask has flushed, and the
// members loader is gone (asserted, not waited on).
async function renderWithGroups(
  groups: Array<Record<string, unknown>>,
  select: string,
  options: RenderFriendsOptions = {}
) {
  (groupsAPI.getUserGroups as Mock).mockResolvedValue(groups);
  const utils = renderFriends(options);
  fireEvent.change(await screen.findByLabelText('Invite to group'), {
    target: { value: select },
  });
  await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledWith(select));
  await flushMacrotask();
  // AMENDED Phase 88.9-66 (X35): the members line is plain text now (its heard words moved to a region).
  expect(screen.queryByText('Loading group members...')).toBeNull();
  return utils;
}

describe('friends — the Friends tab, the bulk invite and its outcome (88.6.1-40)', () => {
  // AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred): this test held the OUTSET ring (Req 7,
  // AC-23) and now holds the ring INSIDE the tab with the label padded clear of it. The marker is at
  // src/app/friends/page.js ("AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred").
  it('T: each tab button carries the INSET ring with the label padded clear of it, never the outset form (R11)', async () => {
    renderFriends();
    await screen.findByText('Dana');
    const tabs = [/^Friends/, /^Requests/, /^Sent/].map((name) => screen.getByRole('button', { name }));
    for (const tab of tabs) {
      const classes = tab.className.split(/\s+/);
      for (const token of [
        'focus:outline-hidden',
        // The label sits clear of the 2px ring at each side (12px). Up and down it is centred by
        // the tab itself (88.9-52 R4 S3, the test below), no longer by a 3px bottom padding.
        'px-3',
        'min-h-11',
        'min-w-11',
        // A tab never shrinks or wraps its label: the gaps between tabs give way instead.
        'shrink-0',
        'whitespace-nowrap',
      ]) {
        expect(classes, token).toContain(token);
      }
      expectFocusRingInset(classes, tab.textContent ?? '');
      // The outset form is gone whole: no offset, no halo colour, no bottom-only padding.
      expect(tab.className).not.toContain('ring-offset');
      expect(classes).not.toContain('pb-3');
      expect(classes).not.toContain('pb-[3px]');
    }
    // The strip row holds the three tabs and the two gaps between them, nothing else; a gap is not
    // exposed to a screen reader and may narrow (the tabs may not).
    const row = tabs[0].parentElement as HTMLElement;
    expect(Array.from(row.children).map((el) => el.tagName)).toEqual(['BUTTON', 'SPAN', 'BUTTON', 'SPAN', 'BUTTON']);
    for (const gap of Array.from(row.children).filter((el) => el.tagName === 'SPAN')) {
      expect(gap).toHaveAttribute('aria-hidden', 'true');
      expect(gap.className.split(/\s+/)).toEqual(expect.arrayContaining(['w-8', 'shrink', 'min-w-0']));
    }
    expect(row.className.split(/\s+/)).not.toContain('gap-8');
    // The active tab keeps its underline and its spoken state.
    expect(tabs[0]).toHaveAttribute('aria-current', 'true');
    // AMENDED Phase 89.6-09 (U1): the underline's colour class is border-tab-indicator.
    expect(tabs[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['border-b-2', 'border-tab-indicator']));
    expect(tabs[1]).not.toHaveAttribute('aria-current');
  });

  // 88.9-52 R4 S3 (the round-3 capture). Two defects in what R11 built. (1) At 200% text the
  // three tabs came to 549px in a 311px strip and the PAGE scrolled sideways, with Sent off
  // screen: the strip now scrolls inside itself, the house rule for a tab strip
  // (src/components/ui/Tabs.tsx ("the strip SCROLLS at 375px, it does not wrap")), and a pressed tab is brought into view.
  // (2) The word was not in the middle of its tab (11.5 above and 12.5 below on Requests, 10.5
  // and 13.5 on Friends, 11.5 and 14.5 on Sent): each tab is now a centring flex box, so the
  // word and its count pill share one centre line, and the active tab's 2px underline is paid
  // for by 2px of top padding. jsdom lays nothing out, so this pins the tokens and the scroll
  // call; the rendered numbers are in e2e/friends-page.spec.ts ("R4 S3 (88.9-52)").
  it('R4 S3 (88.9-52): the strip scrolls inside itself, a pressed tab is brought into view, and each label is centred by its tab', async () => {
    const scrolled: Array<{ label: string | null; arg: unknown }> = [];
    const original = (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = function (this: Element, arg: unknown) {
      scrolled.push({ label: this.textContent, arg });
    };
    try {
      renderFriends();
      await screen.findByText('Dana');
      const tabs = [/^Friends/, /^Requests/, /^Sent/].map((name) => screen.getByRole('button', { name }));
      const row = tabs[0].parentElement as HTMLElement;
      // The row is the scroll box; the strip line stays on its parent, outside the scroll box.
      expect(row.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'overflow-x-auto']));
      expect(row.className.split(/\s+/)).not.toContain('flex-wrap');
      expect((row.parentElement as HTMLElement).className.split(/\s+/)).toEqual(expect.arrayContaining(['border-b', 'border-line']));
      for (const tab of tabs) {
        const classes = tab.className.split(/\s+/);
        expect(classes).toEqual(expect.arrayContaining(['inline-flex', 'items-center', 'justify-center']));
        const active = tab.getAttribute('aria-current') === 'true';
        // Only the active tab has the underline, and only it has the 2px that balances it.
        expect(classes.includes('border-b-2'), tab.textContent ?? '').toBe(active);
        expect(classes.includes('pt-[2px]'), tab.textContent ?? '').toBe(active);
        // R4 D7 (owner page pick S3 = Merge, 2026-11-18): while the ACTIVE tab has keyboard focus
        // its underline is not a border under the ring but a 2px band drawn over the ring's bottom
        // edge, so inside the ring the label has the same space above and below (10 / 10; it was
        // 10 / 8). Three classes, all on the active tab only and all behind focus-visible: the
        // border goes, 2px of bottom padding takes its place (the label does not move), and an
        // inset band in the underline's own colour is painted above the ring layer.
        // The marker is at src/app/friends/page.js ("AMENDED Phase 88.9-52 (R4 D7, owner page pick S3 = Merge, 2026-11-18)").
        // AMENDED Phase 89.6-09 (U1): the band reads the tab-indicator runtime property, the same
        // token as the underline (it read the primary fill's key before).
        for (const merged of ['focus-visible:border-b-0', 'focus-visible:pb-[2px]', 'focus-visible:inset-shadow-[0_-2px_0_0_var(--color-tab-indicator-line)]']) {
          expect(classes.includes(merged), merged + ' on ' + (tab.textContent ?? '')).toBe(active);
        }
        // The ring itself is unchanged on every tab: 2px, inset, the focus-ring colour.
        expectFocusRingInset(classes, tab.textContent ?? '');
        // The underline keeps its colour: the band reads the same token the border class names.
        if (active) expect(classes).toContain('border-tab-indicator');
        // No other up-or-down padding or margin is left to push the label off the middle.
        expect(classes.filter((c) => /^-?(p[ytb]|m[ytb])-/.test(c) && c !== 'pt-[2px]')).toEqual([]);
      }
      // Nothing scrolled on arrival.
      expect(scrolled).toEqual([]);
      fireEvent.click(tabs[2]);
      expect(scrolled).toHaveLength(1);
      expect(scrolled[0].label).toMatch(/^Sent/);
      // Nearest both ways: a tab already in view moves nothing, and the page is not re-centred.
      expect(scrolled[0].arg).toEqual({ block: 'nearest', inline: 'nearest' });
      const now = [/^Friends/, /^Requests/, /^Sent/].map((name) => screen.getByRole('button', { name }));
      expect(now[2]).toHaveAttribute('aria-current', 'true');
      expect(now[2].className.split(/\s+/)).toEqual(expect.arrayContaining(['border-b-2', 'pt-[2px]']));
      expect(now[0].className.split(/\s+/)).not.toContain('pt-[2px]');
    } finally {
      (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView = original;
    }
  });

  // 88.9-52 R4 B1 (the round-4 re-shoot). With text at 200% the request card was wider than the
  // screen (438px at 375, 437px at 320): the name column could shrink to one letter and the
  // Accept / Decline pair could not shrink or drop. Now each of the four rows may wrap, the name
  // breaks between words (inside a word only when that word is wider than the row), and the
  // action keeps to the right on a line of its own. jsdom lays nothing out, so this pins the
  // tokens; the rendered widths are in e2e/friends-page.spec.ts ("R4 B1 (88.9-52)").
  // The marker is at src/app/friends/page.js ("AMENDED Phase 88.9-52 (R4 B1, the round-4 re-shoot").
  it('R4 B1 (88.9-52): the friend, request, sent and found rows may wrap, their names break between words, and the action keeps to the right', async () => {
    const tokens = (el: Element | null | undefined) => (el?.className ?? '').split(/\s+/);
    const checkName = (name: HTMLElement, what: string) => {
      expect(tokens(name), `${what}: the name breaks between words`).toContain('wrap-break-word');
      expect(tokens(name), `${what}: the name may not break at any letter`).not.toContain('wrap-anywhere');
    };
    const checkRow = (row: HTMLElement | null, what: string) => {
      expect(row, `${what}: no row`).not.toBeNull();
      expect(tokens(row), `${what}: the row may wrap`).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'gap-3']));
      const column = (row as HTMLElement).firstElementChild as HTMLElement;
      // The text column's floor is its longest word, capped at the row: never zero.
      expect(tokens(column), `${what}: the text column`).toEqual(expect.arrayContaining(['flex-1', 'max-w-full']));
      expect(tokens(column), `${what}: the text column may not shrink to nothing`).not.toContain('min-w-0');
      const action = (row as HTMLElement).lastElementChild as HTMLElement;
      expect(action, `${what}: the action is a second child`).not.toBe(column);
      expect(tokens(action), `${what}: the action keeps to the right`).toContain('ml-auto');
      return action;
    };

    providerCtx.receivedRequests = [SAM_REQUEST];
    renderFriends({ sent: [ALEX_SENT] });
    // Friends tab: the friend row.
    const dana = await screen.findByText('Dana');
    checkName(dana, 'friend row');
    const friendRow = dana.closest('[data-friend-row]') as HTMLElement;
    const remove = checkRow(friendRow, 'friend row');
    expect(remove.tagName, 'friend row: the action is Remove').toBe('BUTTON');
    // The name and the already-in-group note share a line that may wrap.
    expect(tokens(dana.parentElement), 'friend row: the name line may wrap').toContain('flex-wrap');

    // The found row.
    const found = await searchShows(MORGAN_HIT, 'morgan@example.com');
    checkName(found, 'found row');
    const foundAction = checkRow(found.closest('[data-found-row]') as HTMLElement, 'found row');
    expect(tokens(foundAction), 'found row: the action is capped at the row').toContain('max-w-full');
    expect(tokens(foundAction), 'found row: the action may shrink to the row').not.toContain('shrink-0');

    // Requests tab: the request row. Accept and Decline may stack inside the row.
    fireEvent.click(screen.getByRole('button', { name: /^Requests/ }));
    const sam = await screen.findByText('Sam');
    checkName(sam, 'request row');
    const pair = checkRow(sam.closest('[data-request-row]') as HTMLElement, 'request row');
    expect(tokens(pair), 'request row: the pair').toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'justify-end', 'max-w-full', 'gap-2']));
    expect(tokens(pair), 'request row: the pair may shrink to the row').not.toContain('shrink-0');
    expect(within(pair).getAllByRole('button').map((b) => b.textContent)).toEqual(['Accept', 'Decline']);

    // Sent tab: the sent row.
    fireEvent.click(screen.getByRole('button', { name: /^Sent/ }));
    const alex = await screen.findByText('Alex');
    checkName(alex, 'sent row');
    const pill = checkRow(alex.closest('[data-sent-row]') as HTMLElement, 'sent row');
    expect(pill.textContent).toBe('Pending');
  });

  // 88.9-52 R4 B1b (the round-4 re-shoot, 375 with text at 200%): the address field was squeezed
  // to about 80px beside the Search button. The search row may wrap and the field asks for 8rem
  // before it shares a line, so at large text the button drops under a full-width field.
  // The marker is at src/app/friends/page.js ("DECISION Phase 88.9-52 (R4 B1b, the round-4 re-shoot").
  it('R4 B1b (88.9-52): the search row may wrap and the address field asks for 8rem before it shares a line', async () => {
    renderFriends();
    await screen.findByText('Dana');
    const field = emailField();
    const form = field.closest('form') as HTMLFormElement;
    expect(form.className.split(/\s+/)).toEqual(expect.arrayContaining(['flex', 'flex-wrap', 'gap-3']));
    const classes = field.className.split(/\s+/);
    expect(classes).toEqual(expect.arrayContaining(['grow', 'basis-32']));
    // flex-1 is a zero basis: with it the row never wraps and the field is the part that gives.
    expect(classes).not.toContain('flex-1');
    // The button is the field's sibling in the same row.
    expect(within(form).getByRole('button', { name: 'Search' }).parentElement).toBe(form);
  });

  it('B-gate: Invite to Group is aria-disabled (never native), refuses a gated press, and sends once for two presses (D-35)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    const invite = inviteButton();
    // At rest with nothing checked: gated, focusable, and a press sends nothing.
    expect(invite).not.toHaveAttribute('disabled');
    expect(invite).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(invite);
    expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(0);

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    expect(invite).not.toHaveAttribute('aria-disabled');

    const send = deferred();
    (invitesAPI.sendFriendInvite as Mock).mockReturnValueOnce(send.promise);
    fireEvent.click(invite);
    expect(invite).toHaveAttribute('aria-disabled', 'true');
    expect(invite).toHaveAttribute('aria-busy', 'true');
    expect(invite).not.toHaveAttribute('disabled');
    fireEvent.click(invite);
    expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      send.resolve({});
    });
    // Positive signal: the outcome landed.
    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!'));
    // The selection cleared, so the pressed button is gated again, still focusable.
    expect(invite).not.toHaveAttribute('disabled');
    expect(invite).toHaveAttribute('aria-disabled', 'true');
  });

  it('B2: both batch regions are mounted empty and sr-only before any batch; a success is heard from the SAME polite node (Req 8, D-22)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    const status = statusRegion();
    const error = errorRegion();
    expect(status).not.toBeNull();
    expect(status).toHaveAttribute('role', 'status');
    expect(status?.textContent).toBe('');
    expect(status?.className.split(/\s+/)).toContain('sr-only');
    expect(error).not.toBeNull();
    expect(error).toHaveAttribute('role', 'alert');
    expect(error?.textContent).toBe('');
    expect(error?.className.split(/\s+/)).toContain('sr-only');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());
    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!'));
    // Node identity: the region that was there before the outcome is the one that speaks it.
    expect(statusRegion()).toBe(status);
    const classes = status?.className.split(/\s+/) ?? [];
    expect(classes).not.toContain('sr-only');
    for (const token of ['mt-3', 'p-3', 'rounded-lg', 'bg-status-success-subtle', 'text-content-status-success', 'border-status-success']) {
      expect(classes).toContain(token);
    }
    expect(errorRegion()).toBe(error);
    expect(error?.textContent).toBe('');
  });

  it('B3: a partial batch is heard from the polite region with the warning tint', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1', {
      friends: [FRIENDSHIP, FRIENDSHIP_2],
    });
    (invitesAPI.sendFriendInvite as Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s), 1 failed'));
    expect(statusRegion()?.className.split(/\s+/)).toContain('bg-status-warning-subtle');
    expect(errorRegion()?.textContent).toBe('');
  });

  it('B4: an all-failed batch is heard from the alert region as R2, byte-equal (D-32)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());

    await waitFor(() =>
      expect(errorRegion()?.textContent).toBe("We couldn't send those invites. Please try again.")
    );
    const classes = errorRegion()?.className.split(/\s+/) ?? [];
    expect(classes).toContain('bg-status-error-subtle');
    expect(classes).not.toContain('sr-only');
    expect(statusRegion()?.textContent).toBe('');
  });

  it('B5: the success line names the group the batch was SENT to, not one chosen afterwards (Req 11)', async () => {
    await renderWithGroups(
      [adminGroup('g1', 'Test Group'), adminGroup('g2', 'Other Group')],
      'g1'
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());
    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!'));

    fireEvent.change(screen.getByLabelText('Invite to group'), { target: { value: 'g2' } });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledWith('g2'));
    await flushMacrotask();
    expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!');
    expect(statusRegion()?.textContent).not.toContain('Other Group');
  });

  it('B6 (R8 backstop): the same outcome twice in a row is a DOM mutation on the same node both times', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());
    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!'));
    const status = statusRegion() as HTMLElement;

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(status, { childList: true, characterData: true, subtree: true });
    try {
      fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
      fireEvent.click(inviteButton());
      await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!'));
      expect(records.length).toBeGreaterThan(0);
      expect(statusRegion()).toBe(status);
    } finally {
      observer.disconnect();
    }
  });

  it('B-stay: the outcome stays past 5 s; it clears only when the next batch starts (Req 11, review r2 #203)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    const status = statusRegion();
    expect(status).not.toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    // Fake timers only after the page settled (they would stall the mount fetches otherwise).
    vi.useFakeTimers();
    await act(async () => {
      fireEvent.click(inviteButton());
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(statusRegion()).toBe(status);
    expect(statusRegion()?.textContent).toBe('Invited 1 friend(s) to Test Group!');
    vi.useRealTimers();
  });

  it('B-reload: a selection made during a member reload cannot outlive it into Invited 0 (Req 11, review r2 #49)', async () => {
    await renderWithGroups(
      [adminGroup('g1', 'Test Group'), adminGroup('g2', 'Other Group')],
      'g1'
    );
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    fireEvent.change(screen.getByLabelText('Invite to group'), { target: { value: 'g2' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    // Refused while the new group's members load.
    expect(inviteButton()).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      held.resolve([{ id: FRIEND_UUID }]);
    });
    // Positive signal: the new group's members landed (Dana is shown as already in it).
    await screen.findByText('(already in group)');
    expect(screen.queryByText('1 selected')).toBeNull();
    fireEvent.click(inviteButton());
    await flushMacrotask();
    expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(0);
    expect(statusRegion()?.textContent ?? '').not.toContain('Invited 0');
    expect(errorRegion()?.textContent ?? '').not.toContain('Invited 0');
    expect(screen.queryByText(/Invited 0/)).toBeNull();
  });

  it('B-focus: a FOCUSED checkbox whose friend turns out to be a member hands focus to that row\'s Remove before it is disabled (88.6.1 code review A-55)', async () => {
    await renderWithGroups(
      [adminGroup('g1', 'Test Group'), adminGroup('g2', 'Other Group')],
      'g1'
    );
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    fireEvent.change(screen.getByLabelText('Invite to group'), { target: { value: 'g2' } });
    const dana = screen.getByRole('checkbox', { name: 'Select Dana' });
    act(() => dana.focus());
    expect(document.activeElement).toBe(dana);

    await act(async () => {
      held.resolve([{ id: FRIEND_UUID }]);
    });
    await screen.findByText('(already in group)');
    expect(dana).toBeDisabled();
    // Never body (a browser blurs a natively disabled focused control): the row's own next control.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Dana' }));
  });

  it('B-stale: an older group\'s late members answer neither prunes the selection nor ends the load (newest wins, review r3 L-05)', async () => {
    await renderWithGroups(
      [adminGroup('g1', 'Test Group'), adminGroup('g2', 'Other Group'), adminGroup('g3', 'Third Group')],
      'g1'
    );
    const dg2 = deferred<unknown>();
    const dg3 = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock)
      .mockReturnValueOnce(dg2.promise)
      .mockReturnValueOnce(dg3.promise);
    fireEvent.change(screen.getByLabelText('Invite to group'), { target: { value: 'g2' } });
    fireEvent.change(screen.getByLabelText('Invite to group'), { target: { value: 'g3' } });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    expect(screen.getByText('1 selected')).toBeInTheDocument();

    // The OLDER answer (g2's) lands, naming Dana a member.
    await act(async () => {
      dg2.resolve([{ id: FRIEND_UUID }]);
      await new Promise<void>((r) => setTimeout(r, 0));
    });
    expect(screen.getByText('1 selected')).toBeInTheDocument();
    expect(inviteButton()).toHaveAttribute('aria-disabled', 'true');

    // The CURRENT answer (g3's) lands: positive signal, the button is no longer gated.
    await act(async () => {
      dg3.resolve([]);
    });
    await waitFor(() => expect(inviteButton()).not.toHaveAttribute('aria-disabled'));
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});

// Phase 88.6.1-40 Task 2 (D-35, Req 5 / D-04 / D-05, review r2 #47 / #201, review r3 H-02).
// jsdom never blurs a disabled element (FE-TESTING-CONVENTIONS C-11), so every RED half below is
// an ATTRIBUTE or a REQUEST COUNT; the focus claims are proven on a positive signal (C-5).
// AMENDED Phase 88.9-52 (Q66): a search hit is id and username only, as the backend sends it.
const RILEY_HIT = { id: 'user-search-hit', username: 'Riley' };
const MORGAN_HIT = { id: 'user-morgan', username: 'Morgan' };
const SAM_REQUEST = { id: 'req-1', Requester: { id: FRIEND_2_UUID, username: 'Sam' } };
const RILEY_REQUEST = { id: 'req-2', Requester: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', username: 'Riley' } };

const emailField = () => screen.getByPlaceholderText("Enter friend's email address");

// Runs one search to a hit and resolves once the hit's card shows its name.
async function searchShows(hit: { username: string }, email: string) {
  (friendshipsAPI.searchUserByEmail as Mock).mockResolvedValueOnce(hit);
  fireEvent.change(emailField(), { target: { value: email } });
  fireEvent.submit(emailField().closest('form') as HTMLFormElement);
  return screen.findByText(hit.username);
}

// Runs one search to a hit and returns the hit's Send Request button.
async function searchTo(hit: { username: string }, email: string) {
  await searchShows(hit, email);
  return screen.findByRole('button', { name: 'Send Request' });
}

// A request row: the nearest ancestor of the requester's name that holds both row buttons.
function requestRow(name: string): HTMLElement {
  let el: HTMLElement | null = screen.getByText(name).parentElement;
  while (el && el.querySelectorAll('button').length < 2) el = el.parentElement;
  return el as HTMLElement;
}

// An accept/decline stand-in that drops its row from the provider's list only when it resolves
// (the order plan 88.6.1-66 gives the real provider: remove on confirm, then resolve).
function dropOnResolve(hold: Promise<unknown>) {
  return async (id: string) => {
    await hold;
    providerCtx.receivedRequests = providerCtx.receivedRequests.filter((r) => r.id !== id);
    return {};
  };
}

async function openRequests(requests: Array<Record<string, unknown>>) {
  providerCtx.receivedRequests = requests;
  const utils = renderFriends();
  await screen.findByText('Dana');
  fireEvent.click(screen.getByRole('button', { name: /^Requests/ }));
  await screen.findByText(String((requests[0].Requester as { username: string }).username));
  return utils;
}

describe('friends — pressed controls keep focus and land it somewhere real (88.6.1-40)', () => {
  it('S1: Search is native-disabled only for an empty field; in flight it is aria-disabled and searches once', async () => {
    renderFriends({ friends: [] });
    const search = await screen.findByRole('button', { name: 'Search' });
    // GUARD (rule of KIND): an empty field at rest keeps the native attribute.
    expect(search).toHaveAttribute('disabled');
    expect(search).not.toHaveAttribute('aria-disabled');

    fireEvent.change(emailField(), { target: { value: 'riley@example.com' } });
    const held = deferred<unknown>();
    (friendshipsAPI.searchUserByEmail as Mock).mockReturnValueOnce(held.promise);
    fireEvent.click(search);
    expect(search).toHaveAttribute('aria-disabled', 'true');
    expect(search).not.toHaveAttribute('disabled');
    // rule 1 (88.9-46 B21): the label is kept; the busy name adds the heard suffix.
    expect(search).toHaveAccessibleName('Search, searching');
    expect(search).toHaveTextContent(/^Search/);
    fireEvent.click(search);
    // The Enter-from-field path.
    fireEvent.submit(search.closest('form') as HTMLFormElement);
    expect(friendshipsAPI.searchUserByEmail as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve(null);
    });
  });

  it('S2: Send Request in flight is aria-disabled, keeps its label (rule 1), and sends once for two presses', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    const held = deferred<unknown>();
    (friendshipsAPI.sendRequest as Mock).mockReturnValueOnce(held.promise);
    act(() => send.focus());
    fireEvent.click(send);
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toHaveAttribute('disabled');
    expect(send).toHaveAccessibleName('Send Request, sending');
    expect(send).toHaveTextContent(/^Send Request/);
    fireEvent.click(send);
    expect(friendshipsAPI.sendRequest as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve({});
    });
  });

  it('S3: a successful send hands focus to the Request sent chip, out of the Tab order (Req 5, D-06 shape)', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    act(() => send.focus());
    fireEvent.click(send);

    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('Request sent')));
    const chip = screen.getByText('Request sent');
    expect(chip).toHaveAttribute('tabindex', '-1');
    expect(chip.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });

  it('S4 (R8 backstop): a repeated send failure is removed and re-inserted; focus stays on Send Request', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    (friendshipsAPI.sendRequest as Mock).mockRejectedValueOnce(new Error('x'));
    fireEvent.click(send);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send that request. Please try again."
    );

    const held = deferred<unknown>();
    (friendshipsAPI.sendRequest as Mock).mockReturnValueOnce(held.promise);
    const again = screen.getByRole('button', { name: 'Send Request' });
    act(() => again.focus());
    fireEvent.click(again);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(document.activeElement).toBe(again);

    await act(async () => {
      held.reject(new Error('x'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "We couldn't send that request. Please try again."
    );
  });

  it('S-race (a): a send that settles after a new search never marks the person found next as sent (review r2 #47)', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    const held = deferred<unknown>();
    (friendshipsAPI.sendRequest as Mock).mockReturnValueOnce(held.promise);
    act(() => send.focus());
    fireEvent.click(send);

    await searchShows(MORGAN_HIT, 'morgan@example.com');
    await act(async () => {
      held.resolve({});
    });
    // Positive signal: the send settled (Morgan's button is no longer busy — its name is the bare label).
    expect(await screen.findByRole('button', { name: 'Send Request' })).toBeInTheDocument();
    expect(screen.queryByText('Request sent')).toBeNull();
    expect(document.activeElement?.textContent).not.toBe('Request sent');
  });

  it('S-race (b): a send that fails after a new search never puts its alert on the next person found', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    const held = deferred<unknown>();
    (friendshipsAPI.sendRequest as Mock).mockReturnValueOnce(held.promise);
    fireEvent.click(send);

    await searchShows(MORGAN_HIT, 'morgan@example.com');
    await act(async () => {
      held.reject(new Error('x'));
    });
    expect(await screen.findByRole('button', { name: 'Send Request' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('R1: Remove in flight is aria-disabled, keeps Remove (rule 1), names the person, and removes once', async () => {
    const held = deferred<unknown>();
    (friendshipsAPI.removeFriend as Mock).mockReturnValueOnce(held.promise);
    renderFriends();
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(remove);
    passGate();
    fireEvent.click(remove);
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).not.toHaveAttribute('disabled');
    // rule 1 (88.9-46 B23): the visible word stays Remove; the aria-label carries the suffix.
    expect(remove).toHaveTextContent(/^Remove/);
    expect(remove).toHaveAccessibleName('Remove Dana, removing');
    // GUARD half: the confirm hook's own re-entry refusal.
    fireEvent.click(remove);
    expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.resolve({});
    });
  });

  it('R2: after a removal focus lands on the next row\'s first enabled control (Req 5 adjacency)', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    act(() => remove.focus());
    fakeClock();
    fireEvent.click(remove);
    passGate();
    fireEvent.click(remove);
    // No group is selected, so Sam's checkbox is natively disabled and his Remove is first.
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Sam' }))
    );
  });

  it('R2b (A-74, Safari shape): a Remove friend tapped twice without ever taking focus still lands focus on the next row, not <body>', async () => {
    renderFriends({ friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    // iOS Safari does not focus a tapped button: nothing is focused for either tap.
    (document.activeElement as HTMLElement | null)?.blur();
    fakeClock();
    fireEvent.click(remove);
    passGate();
    fireEvent.click(remove);
    expect(document.activeElement).toBe(document.body);
    await waitFor(() => expect(screen.queryByText('Dana')).not.toBeInTheDocument());
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Remove Sam' }))
    );
  });

  it('R3: after the last removal focus lands on the Friends tab button (Req 5 empty)', async () => {
    renderFriends();
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    act(() => remove.focus());
    fakeClock();
    fireEvent.click(remove);
    passGate();
    fireEvent.click(remove);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Friends/ }))
    );
  });

  it('A1: Accept and Decline in flight are aria-disabled; the sibling stays native; each sends once', async () => {
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const accepting = deferred<unknown>();
    providerCtx.acceptRequest.mockReturnValueOnce(accepting.promise);
    const sam = within(requestRow('Sam'));
    const samAccept = sam.getByRole('button', { name: 'Accept' });
    fireEvent.click(samAccept);
    expect(samAccept).toHaveAttribute('aria-disabled', 'true');
    expect(samAccept).not.toHaveAttribute('disabled');
    expect(samAccept).toHaveAccessibleName('Accept, accepting');
    expect(sam.getByRole('button', { name: 'Decline' })).toHaveAttribute('disabled');
    fireEvent.click(samAccept);
    expect(providerCtx.acceptRequest).toHaveBeenCalledTimes(1);

    const declining = deferred<unknown>();
    providerCtx.declineRequest.mockReturnValueOnce(declining.promise);
    const riley = within(requestRow('Riley'));
    const rileyDecline = riley.getByRole('button', { name: 'Decline' });
    fireEvent.click(rileyDecline);
    expect(rileyDecline).toHaveAttribute('aria-disabled', 'true');
    expect(rileyDecline).toHaveAccessibleName('Decline, declining');
    expect(riley.getByRole('button', { name: 'Accept' })).toHaveAttribute('disabled');
    fireEvent.click(rileyDecline);
    expect(providerCtx.declineRequest).toHaveBeenCalledTimes(1);
    expect(requestRow('Sam')).toHaveAttribute('data-request-row', 'req-1');

    await act(async () => {
      accepting.resolve({});
      declining.resolve({});
    });
  });

  // Rule 1 (88.9-46, owner pick O16a extended by the Q3 ruling): every in-flight friends button
  // keeps its resting label, shows the one house spinner (data-slot spinner, plan 88.9-24) and is
  // NAMED label plus a heard suffix that re-uses its retired in-flight word. The visible text is
  // read as /^Label/ because the sr-only suffix is part of textContent, not of what is painted.
  it('rule 1 (88.9): Search and Send Request keep their labels and show the spinner while busy (B21, B22)', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const search = screen.getByRole('button', { name: 'Search' });
    fireEvent.change(emailField(), { target: { value: 'riley@example.com' } });
    const heldSearch = deferred<unknown>();
    (friendshipsAPI.searchUserByEmail as Mock).mockReturnValueOnce(heldSearch.promise);
    fireEvent.click(search);
    // B21: the SAME node, now busy.
    expect(search).toHaveAccessibleName('Search, searching');
    expect(search).toHaveTextContent(/^Search/);
    await waitFor(() => expect(search.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(search).toHaveAttribute('aria-disabled', 'true');
    expect(search).not.toHaveAttribute('disabled');
    // The status line below the form is a caption, not a button (census B note): it keeps its word.
    // AMENDED Phase 88.9-66 (X35): the caption is plain text; the words it is heard by are pinned in the X35 describe.
    expect(screen.getByText('Searching...').closest('[role="status"]')).toBeNull();
    fireEvent.click(search);
    expect(friendshipsAPI.searchUserByEmail as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      heldSearch.resolve(RILEY_HIT);
    });
    expect(search).not.toHaveAttribute('aria-disabled');
    await waitFor(() => expect(search.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0), { timeout: SPINNER_MIN_MS + 1500 }); // AMENDED Phase 88.9-54 (R-C3b): waits for the 500 ms hold

    // B22: the hit's Send Request, held.
    const send = await screen.findByRole('button', { name: 'Send Request' });
    const heldSend = deferred<unknown>();
    (friendshipsAPI.sendRequest as Mock).mockReturnValueOnce(heldSend.promise);
    fireEvent.click(send);
    expect(send).toHaveAccessibleName('Send Request, sending');
    expect(send).toHaveTextContent(/^Send Request/);
    await waitFor(() => expect(send.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toHaveAttribute('disabled');
    fireEvent.click(send);
    expect(friendshipsAPI.sendRequest as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      heldSend.resolve({});
    });
  });

  it('rule 1 (88.9): Remove, Accept and Decline keep their labels and show the spinner while busy (B23-B25)', async () => {
    // B23 — a RAW button behind the two-tap gate: the visible word stays Remove, the spinner sits
    // beside it, and the aria-label (which overrides content) carries the person and the suffix,
    // so Label-in-Name (WCAG 2.5.3) still holds.
    const heldRemove = deferred<unknown>();
    (friendshipsAPI.removeFriend as Mock).mockReturnValueOnce(heldRemove.promise);
    renderFriends();
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(remove);
    passGate();
    fireEvent.click(remove);
    expect(remove).toHaveAccessibleName('Remove Dana, removing');
    expect(remove).toHaveTextContent(/^Remove/);
    await waitFor(() => expect(remove.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove).not.toHaveAttribute('disabled');
    fireEvent.click(remove);
    expect(friendshipsAPI.removeFriend as Mock).toHaveBeenCalledTimes(1);
    await act(async () => {
      heldRemove.resolve({});
    });
    // The row leaves with the friend, and the spinner with it (no hold read).
    await waitFor(() => expect(remove).not.toBeInTheDocument()); // AMENDED Phase 88.9-56 (R-C3b reach): ends with the host
    vi.useRealTimers();
    cleanup();

    // B24 / B25 — the Requests tab: the pressed control is busy, its sibling natively disabled
    // (the 88.6-22 rule of KIND split is unchanged).
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const accepting = deferred<unknown>();
    providerCtx.acceptRequest.mockReturnValueOnce(accepting.promise);
    const sam = within(requestRow('Sam'));
    const samAccept = sam.getByRole('button', { name: 'Accept' });
    fireEvent.click(samAccept);
    expect(samAccept).toHaveAccessibleName('Accept, accepting');
    expect(samAccept).toHaveTextContent(/^Accept/);
    await waitFor(() => expect(samAccept.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(samAccept).toHaveAttribute('aria-disabled', 'true');
    expect(samAccept).not.toHaveAttribute('disabled');
    expect(sam.getByRole('button', { name: 'Decline' })).toHaveAttribute('disabled');
    fireEvent.click(samAccept);
    expect(providerCtx.acceptRequest).toHaveBeenCalledTimes(1);

    const declining = deferred<unknown>();
    providerCtx.declineRequest.mockReturnValueOnce(declining.promise);
    const riley = within(requestRow('Riley'));
    const rileyDecline = riley.getByRole('button', { name: 'Decline' });
    fireEvent.click(rileyDecline);
    // R-W4 (owner, 2026-11-08): ', declining' — the same word the bell's Declines took in 88.9-45.
    expect(rileyDecline).toHaveAccessibleName('Decline, declining');
    expect(rileyDecline).toHaveTextContent(/^Decline/);
    await waitFor(() => expect(rileyDecline.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(rileyDecline).toHaveAttribute('aria-disabled', 'true');
    expect(rileyDecline).not.toHaveAttribute('disabled');
    expect(riley.getByRole('button', { name: 'Accept' })).toHaveAttribute('disabled');
    fireEvent.click(rileyDecline);
    expect(providerCtx.declineRequest).toHaveBeenCalledTimes(1);

    await act(async () => {
      accepting.resolve({});
      declining.resolve({});
    });
  });

  it('A2: after an accept the row leaves and focus lands on the next row\'s Accept (Req 5 adjacency)', async () => {
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    providerCtx.acceptRequest.mockImplementationOnce(dropOnResolve(Promise.resolve()));
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);
    await waitFor(() =>
      expect(document.activeElement).toBe(within(requestRow('Riley')).getByRole('button', { name: 'Accept' }))
    );
  });

  it('A3: after the last accept focus lands on the Requests tab button (Req 5 empty)', async () => {
    await openRequests([SAM_REQUEST]);
    providerCtx.acceptRequest.mockImplementationOnce(dropOnResolve(Promise.resolve()));
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Requests/ }))
    );
  });

  it('A4 (R5 ordering backstop): the pressed Accept holds focus while pending; the next Accept takes it only after the row leaves', async () => {
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const held = deferred<unknown>();
    providerCtx.acceptRequest.mockImplementationOnce(dropOnResolve(held.promise));
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);
    // Confirm-only in jsdom (C-11); the attribute is the RED half.
    expect(document.activeElement).toBe(samAccept);
    expect(samAccept.isConnected).toBe(true);
    expect(samAccept).toHaveAttribute('aria-disabled', 'true');

    await act(async () => {
      held.resolve({});
    });
    const rileyAccept = within(requestRow('Riley')).getByRole('button', { name: 'Accept' });
    await waitFor(() => expect(document.activeElement).toBe(rileyAccept));
    expect(screen.queryByText('Sam')).toBeNull();
  });

  it('A5 (R5 concurrency, review r2 #201): a row still in flight is never the focus target; the Requests tab is', async () => {
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const accepting = deferred<unknown>();
    const declining = deferred<unknown>();
    providerCtx.acceptRequest.mockImplementationOnce(dropOnResolve(accepting.promise));
    providerCtx.declineRequest.mockImplementationOnce(dropOnResolve(declining.promise));
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);
    const rileyDecline = within(requestRow('Riley')).getByRole('button', { name: 'Decline' });
    act(() => rileyDecline.focus());
    fireEvent.click(rileyDecline);

    // Riley's decline settles FIRST, then Sam's accept.
    await act(async () => {
      declining.resolve({});
    });
    await flushMacrotask();
    await act(async () => {
      accepting.resolve({});
    });
    await flushMacrotask();
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Requests/ }))
    );
    expect(document.activeElement).not.toBe(document.body);
  });

  it('A6 (review r3 H-02): a row whose request runs from the bell is natively disabled here; a press made here keeps aria-disabled', async () => {
    providerCtx.isRequestActionPending.mockImplementation((id: string) => id === 'req-1');
    const { rerender } = await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const sam = within(requestRow('Sam'));
    const samAccept = sam.getByRole('button', { name: 'Accept' });
    const samDecline = sam.getByRole('button', { name: 'Decline' });
    expect(samAccept).toHaveAttribute('disabled');
    expect(samAccept).not.toHaveAttribute('aria-disabled');
    expect(samDecline).toHaveAttribute('disabled');
    expect(samDecline).not.toHaveAttribute('aria-disabled');
    fireEvent.click(samAccept);
    fireEvent.click(samDecline);
    expect(providerCtx.acceptRequest).toHaveBeenCalledTimes(0);
    expect(providerCtx.declineRequest).toHaveBeenCalledTimes(0);
    const riley = within(requestRow('Riley'));
    for (const name of ['Accept', 'Decline']) {
      expect(riley.getByRole('button', { name })).not.toHaveAttribute('disabled');
      expect(riley.getByRole('button', { name })).not.toHaveAttribute('aria-disabled');
    }

    // The bell's request settles: Sam's row is live again.
    providerCtx.isRequestActionPending.mockImplementation(() => false);
    rerender(<FriendsPage />);
    expect(samAccept).not.toHaveAttribute('disabled');
    expect(samDecline).not.toHaveAttribute('disabled');

    // A press made HERE sets the provider's record too; the page's own record wins (rule of POSITION).
    const held = deferred<unknown>();
    providerCtx.acceptRequest.mockImplementationOnce((id: string) => {
      providerCtx.isRequestActionPending.mockImplementation((x: string) => x === id);
      return held.promise;
    });
    const rileyAccept = riley.getByRole('button', { name: 'Accept' });
    fireEvent.click(rileyAccept);
    expect(rileyAccept).toHaveAttribute('aria-disabled', 'true');
    expect(rileyAccept).not.toHaveAttribute('disabled');

    await act(async () => {
      held.resolve({});
    });
  });
});

// Phase 88.6.1-40 Task 3 (AC-27 / AC-29's refresh half, Req 9) and the orchestrator-routed
// carry-in (the email search offering Send Request before the page's own lists have loaded).
const RILEY_FRIENDSHIP = {
  id: 'fr-3',
  friend: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Riley' },
};
const ALEX_SENT = { id: 'sr-1', Addressee: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'Alex' } };
const RILEY_SENT = { id: 'sr-2', Addressee: { id: RILEY_HIT.id, username: 'Riley' } };
const MORGAN_SENT = { id: 'sr-3', Addressee: { id: MORGAN_HIT.id, username: 'Morgan' } };

describe('friends — lists refresh in place (88.6.1-40, AC-29)', () => {
  it('F1: a refresh after an accept keeps the friends rows on screen (no loading line)', async () => {
    await openRequests([SAM_REQUEST]);
    const refresh = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockReturnValueOnce(refresh.promise);
    fireEvent.click(within(requestRow('Sam')).getByRole('button', { name: 'Accept' }));
    // Positive signal: the post-accept refresh is in flight.
    await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: /^Friends/ }));
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.queryByText('Loading friends...')).toBeNull();

    await act(async () => {
      refresh.resolve([FRIENDSHIP]);
    });
  });

  it('F4: the newest friends response wins even when an older one lands last', async () => {
    await openRequests([SAM_REQUEST, RILEY_REQUEST]);
    const d1 = deferred<unknown>();
    const d2 = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock)
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    fireEvent.click(within(requestRow('Riley')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalledTimes(2));
    fireEvent.click(within(requestRow('Sam')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalledTimes(3));

    await act(async () => {
      d2.resolve([FRIENDSHIP, RILEY_FRIENDSHIP, FRIENDSHIP_2]);
    });
    await flushMacrotask();
    await act(async () => {
      d1.resolve([FRIENDSHIP, RILEY_FRIENDSHIP]);
    });
    await flushMacrotask();
    fireEvent.click(screen.getByRole('button', { name: /^Friends/ }));
    // Positive signal: the friends rows are rendered.
    expect(await screen.findByRole('button', { name: 'Remove Riley' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Sam' })).toBeInTheDocument();
  });

  it('S5: a refresh after a send keeps the sent rows on screen (no loading line)', async () => {
    renderFriends({ friends: [], sent: [ALEX_SENT] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    fireEvent.click(screen.getByRole('button', { name: /^Sent/ }));
    await screen.findByText('Alex');
    const send = await searchTo(RILEY_HIT, 'riley@example.com');
    const refresh = deferred<unknown>();
    (friendshipsAPI.getSentRequests as Mock).mockReturnValueOnce(refresh.promise);
    fireEvent.click(send);
    // Positive signal: the post-send refresh is in flight.
    await waitFor(() => expect(friendshipsAPI.getSentRequests as Mock).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.queryByText('Loading sent requests...')).toBeNull();

    await act(async () => {
      refresh.resolve([ALEX_SENT, RILEY_SENT]);
    });
  });

  it('S7: the newest sent response wins even when an older one lands last', async () => {
    renderFriends({ friends: [], sent: [ALEX_SENT] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const d1 = deferred<unknown>();
    const d2 = deferred<unknown>();
    (friendshipsAPI.getSentRequests as Mock)
      .mockReturnValueOnce(d1.promise)
      .mockReturnValueOnce(d2.promise);
    fireEvent.click(await searchTo(RILEY_HIT, 'riley@example.com'));
    await waitFor(() => expect(friendshipsAPI.getSentRequests as Mock).toHaveBeenCalledTimes(2));
    fireEvent.click(await searchTo(MORGAN_HIT, 'morgan@example.com'));
    await waitFor(() => expect(friendshipsAPI.getSentRequests as Mock).toHaveBeenCalledTimes(3));

    await act(async () => {
      d2.resolve([ALEX_SENT, RILEY_SENT, MORGAN_SENT]);
    });
    await flushMacrotask();
    await act(async () => {
      d1.resolve([ALEX_SENT, RILEY_SENT]);
    });
    await flushMacrotask();
    fireEvent.click(screen.getByRole('button', { name: /^Sent/ }));
    // Positive signal: the sent rows are rendered; each row carries one Pending pill.
    await screen.findByText('Alex');
    expect(screen.getAllByText('Pending')).toHaveLength(3);
  });

  it('C1 (carry-in): a search that lands before the friends list does not offer Send Request to a friend', async () => {
    const firstLoad = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockReturnValueOnce(firstLoad.promise);
    renderFriends();
    await screen.findByRole('heading', { name: 'Add Friend' });
    await searchShows(FRIENDSHIP.friend, 'dana@example.com');
    // Positive signal: the result card is shown (the list behind it is still loading).
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send Request' })).toBeNull();

    await act(async () => {
      firstLoad.resolve([FRIENDSHIP]);
    });
    expect(await screen.findByText('Already friends')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send Request' })).toBeNull();
  });

  it('C2 (carry-in): while the provider\'s first load runs, a person who sent you a request is not offered Send Request', async () => {
    providerCtx.loading = true;
    const { rerender } = renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    await searchShows(SAM_REQUEST.Requester, 'sam@example.com');
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send Request' })).toBeNull();

    // The provider's first load lands, listing Sam's request to you.
    providerCtx.receivedRequests = [SAM_REQUEST];
    providerCtx.loading = false;
    rerender(<FriendsPage />);
    expect(await screen.findByText('Request pending')).toBeInTheDocument();
  });

  it('C3 (carry-in GUARD): a FAILED friends load does not hold the search action forever', async () => {
    renderFriends({ loadError: new ApiError('boom', 'network', 500) });
    await screen.findByText("Couldn't load your friends");
    expect(await searchTo(RILEY_HIT, 'riley@example.com')).toBeInTheDocument();
  });
});

// Phase 88.6.1-72 Task 1 (owner rulings 2026-10-05: N5 / N6 on a failed Accept / Decline, FR1 and
// the RF1 notice on the Requests tab; 88.6.1-70 contract C1-C12). `//` comments only (CF-9).

// Copy row RF1 / D-47 (plan 88.6.1-70's REFRESH_FAILED_NOTICE, contract C7): the ONLY place this
// file spells it. While the notice shows and its region is not quiet it is on screen TWICE (the
// sr-only polite region plus the visible line).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
// Copy row FR1 (owner ruling 2026-10-05), the Requests tab's full-banner title.
const FR1 = "Couldn't load your friend requests";
const NO_PENDING = 'No pending friend requests.';
const N5 = "We couldn't accept that friend request. Please try again.";

// The house tab-return idiom (src/components/ui/useFetchErrorState.test.tsx, `function fireVisibility`).
function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

const requestsTab = () => screen.getByRole('button', { name: /^Requests/ });
const friendsTabButton = () => screen.getByRole('button', { name: /^Friends/ });
// The RF1 notice's VISIBLE line: the occurrence outside every role=status node.
const rf1Line = () => screen.getAllByText(RF1).find((n) => n.closest('[role="status"]') === null) ?? null;
// The RF1 notice's polite region (a role=status node carrying the sentence).
const rf1Region = () => screen.getAllByRole('status').find((n) => n.textContent === RF1) ?? null;
// The page's own request-action line: the one paragraph carrying the alert role on the Requests tab
// (FR1's banner speaks through its own region, never a paragraph).
const requestActionLine = () => document.querySelector('p[role="alert"]');
const precedes = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

// Healthy first render, then the Requests tab (no wait on its content: each test waits for its own).
async function openRequestsTab(requests: Array<Record<string, unknown>>) {
  providerCtx.receivedRequests = requests;
  const utils = renderFriends();
  await screen.findByText('Dana');
  fireEvent.click(requestsTab());
  return utils;
}

// Healthy Requests tab listing Sam, then the provider's load fails with `err` (a rerender stands in
// for the provider's commit).
async function samThenFailure(err: unknown) {
  const utils = await openRequestsTab([SAM_REQUEST]);
  await screen.findByText('Sam');
  providerCtx.error = err;
  utils.rerender(<FriendsPage />);
  return utils;
}

describe('friends — the Requests tab tells the truth (88.6.1-72, owner rulings 2026-10-05)', () => {
  const boom = () => new Error('HTTP error! status: 500');

  it('N2. a coded Accept failure keeps its register line, never the N5 fallback (D-33 row 22)', async () => {
    const err = new ApiError('offline', 'network', 0);
    providerCtx.acceptRequest.mockRejectedValueOnce(err);
    await openRequestsTab([SAM_REQUEST]);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(getFetchErrorMessage(err));
    expect(alert.textContent).not.toBe(N5);
  });

  it('N3. the same Accept failure twice is removed at the second press and inserted again (R8 backstop)', async () => {
    providerCtx.acceptRequest.mockRejectedValueOnce(boom());
    await openRequestsTab([SAM_REQUEST]);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect((await screen.findByRole('alert')).textContent).toBe(N5);

    const held = deferred<unknown>();
    providerCtx.acceptRequest.mockReturnValueOnce(held.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    // Synchronously, at the press: the old line is gone (clear-first, D-42).
    expect(screen.queryByRole('alert')).toBeNull();

    await act(async () => {
      held.reject(boom());
    });
    expect((await screen.findByRole('alert')).textContent).toBe(N5);
  });

  it('N4. GUARD: after a failed Accept focus stays on the pressed Accept, live again (Req 5)', async () => {
    // Green by construction in jsdom (it never blurs, FE-TESTING-CONVENTIONS C-11); the real-browser
    // proof is e2e (4). The positive signal is the breadcrumb, which exists before and after the fix.
    providerCtx.acceptRequest.mockRejectedValueOnce(boom());
    await openRequestsTab([SAM_REQUEST, RILEY_REQUEST]);
    await screen.findByText('Sam');
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);
    await waitFor(() =>
      expect((logger.info as Mock).mock.calls.some(([m]) => m === 'Error accepting request:')).toBe(true)
    );
    await waitFor(() => expect(samAccept).not.toHaveAttribute('aria-disabled'));
    expect(document.activeElement).toBe(samAccept);
  });

  it('Q1. a failed load with nothing retained is FR1 (never the empty line); Try again runs the joining retry', async () => {
    providerCtx.hasLoaded = false;
    providerCtx.error = new ApiError('offline', 'network', 0);
    await openRequestsTab([]);
    expect(await screen.findByText(FR1)).toBeInTheDocument();
    expect(screen.queryByText(NO_PENDING)).toBeNull();
    expect(screen.getByText(getFetchErrorMessage(providerCtx.error))).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(providerCtx.retryFriendships).toHaveBeenCalledTimes(1);
    expect(providerCtx.refreshFriendships).not.toHaveBeenCalled();
    await act(async () => {});
  });

  it('Q2. a failed refresh keeps the requests under RF1, spoken from a region that was already there (C8 a, b)', async () => {
    const utils = await openRequestsTab([SAM_REQUEST]);
    await screen.findByText('Sam');
    const before = screen.getAllByRole('status');
    providerCtx.error = new ApiError('offline', 'network', 0);
    utils.rerender(<FriendsPage />);

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Sam')).toBeInTheDocument();
    const region = rf1Region();
    expect(region).not.toBeNull();
    expect(before.find((n) => n === region)).toBe(region);
    expect(screen.queryByText(FR1)).toBeNull();
    expect(screen.queryByText(NO_PENDING)).toBeNull();
    expect(precedes(rf1Line() as Node, screen.getByText('Sam'))).toBe(true);
  });

  it('Q3. a list that loaded EMPTY is retained: RF1 above the empty line, never FR1 (C3, owner ruling Y)', async () => {
    const utils = await openRequestsTab([]);
    await screen.findByText(NO_PENDING);
    providerCtx.error = new ApiError('offline', 'network', 0);
    utils.rerender(<FriendsPage />);

    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText(NO_PENDING)).toBeInTheDocument();
    expect(screen.queryByText(FR1)).toBeNull();
  });

  it('Q4. the notice Retry runs the joining retry; a success removes the notice and keeps the rows (C8 c)', async () => {
    const utils = await samThenFailure(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(providerCtx.retryFriendships).toHaveBeenCalledTimes(1);
    expect(providerCtx.refreshFriendships).not.toHaveBeenCalled();
    await act(async () => {});

    providerCtx.error = null;
    utils.rerender(<FriendsPage />);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('Sam')).toBeInTheDocument();
  });

  it('Q5. GUARD: healthy and empty shows the empty line, with neither FR1 nor RF1', async () => {
    await openRequestsTab([]);
    expect(await screen.findByText(NO_PENDING)).toBeInTheDocument();
    expect(screen.queryByText(FR1)).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('Q6. a 401 or 403 refresh withdraws the requests behind FR1 with the register line; a 500 keeps them under RF1 (C8 e, C10)', async () => {
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      await samThenFailure(err);
      expect(await screen.findByText(FR1)).toBeInTheDocument();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      expect(screen.queryByText('Sam')).toBeNull();
      expect(screen.getAllByText(messageBesideRetry(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
      cleanup();
      providerCtx.error = null;
    }

    await samThenFailure(new ApiError('Server error', 'internal', 500));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Sam')).toBeInTheDocument();
    expect(screen.queryByText(FR1)).toBeNull();
  });

  it('Q7. a provider that loaded EMPTY before the page opened and failed since shows RF1 above the empty line (D-50, plan 66 hasLoaded)', async () => {
    providerCtx.hasLoaded = true;
    providerCtx.error = new ApiError('offline', 'network', 0);
    await openRequestsTab([]);
    // Mounted mid-failure: the notice fills its region after its dwell (quietOnMount).
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const empty = screen.getByText(NO_PENDING);
    expect(screen.queryByText(FR1)).toBeNull();
    expect(precedes(rf1Line() as Node, empty)).toBe(true);
  });

  it('Q8. a refresh NOBODY pressed: a withdrawal lands focus on the Requests tab; a success with Retry focused too (C8 f, C12)', async () => {
    // (f1) A row control holds focus; the tab-return re-attempt is answered 403.
    let utils = await samThenFailure(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    providerCtx.retryFriendships.mockResolvedValueOnce({ isError: true });
    act(() => fireVisibility('visible'));
    // Nobody pressed anything: the hook's re-attempt went through the adapter's joining retry.
    expect(providerCtx.retryFriendships).toHaveBeenCalledTimes(1);
    await act(async () => {});
    providerCtx.error = new ApiError('Forbidden', 'forbidden', 403);
    utils.rerender(<FriendsPage />);
    expect(await screen.findByText(FR1)).toBeInTheDocument();
    expect(screen.queryByText('Sam')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(requestsTab()));
    expect(document.activeElement).not.toBe(document.body);
    cleanup();
    providerCtx.error = null;
    providerCtx.retryFriendships.mockClear();

    // (f2) The notice's Retry holds focus; the tab-return re-attempt succeeds.
    utils = await samThenFailure(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    act(() => fireVisibility('visible'));
    expect(providerCtx.retryFriendships).toHaveBeenCalledTimes(1);
    await act(async () => {});
    providerCtx.error = null;
    utils.rerender(<FriendsPage />);
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('Sam')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(requestsTab()));
  });

  it('L1. a tab change clears the request-action line, so a return never announces it again (#238)', async () => {
    providerCtx.acceptRequest.mockRejectedValueOnce(boom());
    await openRequestsTab([SAM_REQUEST]);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    expect((await screen.findByRole('alert')).textContent).toBe(N5);

    fireEvent.click(friendsTabButton());
    fireEvent.click(requestsTab());
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('L2. the line is never beside FR1, and FR1 clears it so a recovery never brings it back (#83)', async () => {
    const actionErr = new ApiError('Unauthorized', 'unauthorized', 401);
    providerCtx.acceptRequest.mockRejectedValueOnce(actionErr);
    const utils = await openRequestsTab([SAM_REQUEST]);
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(requestActionLine()?.textContent).toBe(getFetchErrorMessage(actionErr)));

    providerCtx.error = new ApiError('Unauthorized', 'unauthorized', 401);
    utils.rerender(<FriendsPage />);
    expect(await screen.findByText(FR1)).toBeInTheDocument();
    expect(requestActionLine()).toBeNull();

    providerCtx.error = null;
    utils.rerender(<FriendsPage />);
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(requestActionLine()).toBeNull();
  });

  it('L3. the line leaves with the request it names (handled elsewhere, reconciled away) (#83)', async () => {
    providerCtx.acceptRequest.mockRejectedValueOnce(boom());
    const utils = await openRequestsTab([SAM_REQUEST, RILEY_REQUEST]);
    await screen.findByText('Sam');
    fireEvent.click(within(requestRow('Sam')).getByRole('button', { name: 'Accept' }));
    expect((await screen.findByRole('alert')).textContent).toBe(N5);

    providerCtx.receivedRequests = [RILEY_REQUEST];
    utils.rerender(<FriendsPage />);
    expect(await screen.findByText('Riley')).toBeInTheDocument();
    expect(screen.queryByText('Sam')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  // 88.6.1 code review A-54: L3 shows the line first and removes the row in a LATER render (a later
  // load reconciling it away), which still holds. Production's own order inside the failing call is the
  // reverse: the provider's reconcile removes the row, marks the error requestRowRemoved, then rethrows.
  it('L5. a failure whose row the provider reconciled away INSIDE the call still shows its line, and focus is not dropped (A-54)', async () => {
    const utils = await openRequestsTab([SAM_REQUEST, RILEY_REQUEST]);
    await screen.findByText('Sam');
    providerCtx.acceptRequest.mockImplementationOnce(async () => {
      // The provider's order: the row leaves receivedRequests, then the marked error is rethrown.
      providerCtx.receivedRequests = [RILEY_REQUEST];
      utils.rerender(<FriendsPage />);
      const err = boom() as Error & { requestRowRemoved?: boolean };
      err.requestRowRemoved = true;
      throw err;
    });
    const samAccept = within(requestRow('Sam')).getByRole('button', { name: 'Accept' });
    act(() => samAccept.focus());
    fireEvent.click(samAccept);

    expect((await screen.findByRole('alert')).textContent).toBe(N5);
    expect(screen.queryByText('Sam')).toBeNull();
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));

    // The next press clears it, as for any request-action line.
    providerCtx.acceptRequest.mockResolvedValueOnce({ alreadyAccepted: false });
    fireEvent.click(within(requestRow('Riley')).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  });

  it('L4. the same tab change clears the Friends tab remove line (#83, review r3 L-20)', async () => {
    (friendshipsAPI.removeFriend as Mock).mockRejectedValue(boom());
    renderFriends();
    const dana = await screen.findByRole('button', { name: 'Remove Dana' });
    fakeClock();
    fireEvent.click(dana);
    passGate();
    fireEvent.click(await screen.findByRole('button', { name: 'Tap again to confirm' }));
    expect(await screen.findByText("We couldn't remove that friend. Please try again.")).toBeInTheDocument();

    fireEvent.click(requestsTab());
    fireEvent.click(friendsTabButton());
    expect(await screen.findByText('Dana')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

// Phase 88.6.1-72 Task 2 (orchestrator consistency decision 2026-10-05: one treatment per page;
// 88.6.1-70 contract C1-C12). The Friends and Sent lists keep their rows under RF1 after a failed
// refresh; the full banner only while nothing is retained. Reuses Task 1's RF1, rf1Line, rf1Region,
// precedes and fireVisibility.
const FRIENDS_TITLE = "Couldn't load your friends";
const SENT_TITLE = "Couldn't load your sent requests";
const sentTabButton = () => screen.getByRole('button', { name: /^Sent/ });

// The Friends list refreshes after an accept made on the Requests tab, and that refresh is
// answered `err`; the test is back on the Friends tab when this returns.
async function friendsRefreshFails(err: unknown, friends: Array<Record<string, unknown>> = [FRIENDSHIP]) {
  providerCtx.receivedRequests = [SAM_REQUEST];
  const utils = renderFriends({ friends });
  if (friends.length > 0) await screen.findByText('Dana');
  else await screen.findByRole('heading', { name: 'No friends yet' });
  // AMENDED Phase 88.9-40 (RF-F6 / RF-S2, SESSION-01): a 401 refresh now redirects once (the shared
  // guard), and a load that succeeds clears a latch set before it, so for a 401 answer the latch is
  // set HERE — after the load, before the refresh — and the test pins the DECLINED arm: the banner
  // with the register line it always held.
  if (err instanceof ApiError && err.code === 'unauthorized') window.sessionStorage.setItem(signInLatchKey(window.location), '1');
  // After the mount's own call, so the mount does not consume it.
  (friendshipsAPI.getFriends as Mock).mockRejectedValueOnce(err);
  // Relative counts: an arm that runs this twice (after a cleanup) keeps the earlier calls.
  const calls = (friendshipsAPI.getFriends as Mock).mock.calls.length;
  fireEvent.click(requestsTab());
  fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
  await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalledTimes(calls + 1));
  fireEvent.click(friendsTabButton());
  return utils;
}

// The Sent list refreshes after a send, and that refresh is answered `err`; the test is on the
// Sent tab when this returns.
async function sentRefreshFails(err: unknown, sent: Array<Record<string, unknown>> = [ALEX_SENT]) {
  const utils = renderFriends({ friends: [], sent });
  await screen.findByRole('heading', { name: 'No friends yet' });
  fireEvent.click(sentTabButton());
  if (sent.length > 0) await screen.findByText('Alex');
  else await screen.findByText('No sent friend requests.');
  const send = await searchTo(RILEY_HIT, 'riley@example.com');
  // AMENDED Phase 88.9-40 (RF-S2): the same seam as friendsRefreshFails — a 401 answer pins the declined arm.
  if (err instanceof ApiError && err.code === 'unauthorized') window.sessionStorage.setItem(signInLatchKey(window.location), '1');
  (friendshipsAPI.getSentRequests as Mock).mockRejectedValueOnce(err);
  const calls = (friendshipsAPI.getSentRequests as Mock).mock.calls.length;
  fireEvent.click(send);
  await waitFor(() => expect(friendshipsAPI.getSentRequests as Mock).toHaveBeenCalledTimes(calls + 1));
  return utils;
}

describe('friends — one treatment per page: Friends and Sent keep their rows under RF1 (88.6.1-72)', () => {
  it('RF-F1. a failed friends refresh keeps the rows under RF1, spoken from a region that was already there (C8 a, b)', async () => {
    // The refresh is held until the Friends tab shows, so the failure lands while the notice's
    // region is on screen (the tab's panel remounts on every return, so a failure that landed
    // while another tab showed would reach a NEW region; that mid-failure mount is RF-F4's shape).
    providerCtx.receivedRequests = [SAM_REQUEST];
    renderFriends();
    await screen.findByText('Dana');
    const refresh = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockReturnValueOnce(refresh.promise);
    fireEvent.click(requestsTab());
    fireEvent.click(await screen.findByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(friendshipsAPI.getFriends as Mock).toHaveBeenCalledTimes(2));
    fireEvent.click(friendsTabButton());
    await screen.findByText('Dana');
    const before = screen.getAllByRole('status');

    await act(async () => {
      refresh.reject(new ApiError('offline', 'network', 0));
    });
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Dana')).toBeInTheDocument();
    const region = rf1Region();
    expect(before.find((n) => n === region)).toBe(region);
    expect(screen.queryByText(FRIENDS_TITLE)).toBeNull();
    expect(precedes(rf1Line() as Node, screen.getByText('Dana'))).toBe(true);
  });

  it('RF-F2. Retry recovers the friends list and lands focus on the Friends tab (C8 c, Edge R5)', async () => {
    await friendsRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    (friendshipsAPI.getFriends as Mock).mockResolvedValueOnce([FRIENDSHIP, FRIENDSHIP_2]);
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    fireEvent.click(retry);
    expect(await screen.findByText('Sam')).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    await waitFor(() => expect(document.activeElement).toBe(friendsTabButton()));
  });

  it('RF-F3. the notice survives its own Retry: still shown while the retry runs (C2)', async () => {
    await friendsRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const held = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockReturnValueOnce(held.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(rf1Line()).not.toBeNull();
    // AMENDED Phase 88.9-46 (RF-F3): the notice's Retry is FetchErrorBanner's — rule 1 keeps its label and
    // names it 'Retry, retrying' while busy (the bare /Retrying/ stem matched the retired swap word).
    expect(screen.getByRole('button', { name: /^Retry, retrying$/ })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByText('Dana')).toBeInTheDocument();

    await act(async () => {
      held.resolve([FRIENDSHIP]);
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Retry, retrying$/ })).toBeNull());
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-F4. a friends list that loaded EMPTY is retained: RF1 above No friends yet, never the banner (C3, owner ruling Y)', async () => {
    await friendsRefreshFails(new ApiError('offline', 'network', 0), []);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const empty = screen.getByRole('heading', { name: 'No friends yet' });
    expect(screen.queryByText(FRIENDS_TITLE)).toBeNull();
    expect(precedes(rf1Line() as Node, empty)).toBe(true);
  });

  it('RF-F5. a first-load banner survives its own Try again, then lands focus on the Friends tab (C2 + C6)', async () => {
    renderFriends({ loadError: new ApiError('boom', 'network', 500) });
    await screen.findByText(FRIENDS_TITLE);
    const held = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockReturnValueOnce(held.promise);
    const tryAgain = screen.getByRole('button', { name: /Try again/ });
    act(() => tryAgain.focus());
    fireEvent.click(tryAgain);
    expect(screen.getByText(FRIENDS_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Loading friends...')).toBeNull();

    await act(async () => {
      held.resolve([FRIENDSHIP]);
    });
    expect(await screen.findByText('Dana')).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(friendsTabButton()));
  });

  it('RF-F6. a 401 or 403 friends refresh withdraws the rows behind the banner with the register line; a 500 keeps them under RF1 (C8 e, C10)', async () => {
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      await friendsRefreshFails(err);
      expect(await screen.findByText(FRIENDS_TITLE)).toBeInTheDocument();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      expect(screen.queryByText('Dana')).toBeNull();
      expect(screen.getAllByText(messageBesideRetry(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
      cleanup();
    }

    await friendsRefreshFails(new ApiError('Server error', 'internal', 500));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Dana')).toBeInTheDocument();
    expect(screen.queryByText(FRIENDS_TITLE)).toBeNull();
  });

  it('RF-F7. a friends refresh NOBODY pressed: a withdrawal lands focus on the Friends tab; a success with Retry focused too (C8 f, C12)', async () => {
    // (f1) A row control holds focus; the tab-return re-attempt is answered 403.
    await friendsRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const removeDana = screen.getByRole('button', { name: 'Remove Dana' });
    act(() => removeDana.focus());
    (friendshipsAPI.getFriends as Mock).mockRejectedValueOnce(new ApiError('Forbidden', 'forbidden', 403));
    act(() => fireVisibility('visible'));
    expect(await screen.findByText(FRIENDS_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Dana')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(friendsTabButton()));
    expect(document.activeElement).not.toBe(document.body);
    cleanup();

    // (f2) The notice's Retry holds focus; the tab-return re-attempt succeeds.
    await friendsRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    (friendshipsAPI.getFriends as Mock).mockResolvedValueOnce([FRIENDSHIP]);
    act(() => fireVisibility('visible'));
    await waitFor(() => expect(document.activeElement).toBe(friendsTabButton()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('Dana')).toBeInTheDocument();
  });

  it('RF-S1. a failed sent refresh keeps the rows under RF1; Retry recovers them (C8 a, c)', async () => {
    await sentRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.queryByText(SENT_TITLE)).toBeNull();

    (friendshipsAPI.getSentRequests as Mock).mockResolvedValueOnce([ALEX_SENT, RILEY_SENT]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    // Positive signal: Riley's row joined the list (each sent row carries one Pending pill).
    await waitFor(() => expect(screen.getAllByText('Pending')).toHaveLength(2));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('RF-S2. a 401 or 403 sent refresh withdraws the rows behind the banner with the register line; a 500 keeps them under RF1 (C8 e, C10)', async () => {
    for (const err of [
      new ApiError('Unauthorized', 'unauthorized', 401),
      new ApiError('Forbidden', 'forbidden', 403),
    ]) {
      await sentRefreshFails(err);
      expect(await screen.findByText(SENT_TITLE)).toBeInTheDocument();
      expect(screen.queryAllByText(RF1)).toHaveLength(0);
      expect(screen.queryByText('Alex')).toBeNull();
      expect(screen.getAllByText(messageBesideRetry(getFetchErrorMessage(err))).length).toBeGreaterThan(0);
      cleanup();
    }

    await sentRefreshFails(new ApiError('Server error', 'internal', 500));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Alex')).toBeInTheDocument();
    expect(screen.queryByText(SENT_TITLE)).toBeNull();
  });

  it('RF-S3. a sent list that loaded EMPTY is retained: RF1 above No sent friend requests., never the banner (owner ruling Y)', async () => {
    await sentRefreshFails(new ApiError('Server error', 'internal', 500), []);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    const empty = screen.getByText('No sent friend requests.');
    expect(screen.queryByText(SENT_TITLE)).toBeNull();
    expect(precedes(rf1Line() as Node, empty)).toBe(true);
  });

  it('RF-S4. a sent refresh NOBODY pressed: a withdrawal or a success with Retry focused lands focus on the Sent tab (C8 f, C12)', async () => {
    // The Sent rows hold no focusable control, so (f1) focuses the notice's Retry, the only control
    // inside the tab's retained arm. No guard plant here: with Retry focused the notice's own watch
    // moves focus too, so the guard's teeth are Q8's and RF-F7's (recorded, not hidden).
    await sentRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    act(() => screen.getByRole('button', { name: 'Retry' }).focus());
    (friendshipsAPI.getSentRequests as Mock).mockRejectedValueOnce(new ApiError('Forbidden', 'forbidden', 403));
    act(() => fireVisibility('visible'));
    expect(await screen.findByText(SENT_TITLE)).toBeInTheDocument();
    expect(screen.queryByText('Alex')).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(sentTabButton()));
    expect(document.activeElement).not.toBe(document.body);
    cleanup();

    await sentRefreshFails(new ApiError('offline', 'network', 0));
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    act(() => screen.getByRole('button', { name: 'Retry' }).focus());
    (friendshipsAPI.getSentRequests as Mock).mockResolvedValueOnce([ALEX_SENT]);
    act(() => fireVisibility('visible'));
    await waitFor(() => expect(document.activeElement).toBe(sentTabButton()));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('Alex')).toBeInTheDocument();
  });
});

// Phase 88.6.1-72 Task 3 (owner rulings 2026-10-05): the Invite to Group batch counts a terminal
// 409 as already invited, in the invite panel's shipped words (from one module); a found search
// result is announced (copy row F7).
const searchStatus = () => document.getElementById('friends-search-status');

describe("friends — an all-failed batch tells the first failure's reason (88.6.1-90, close ruling P-92)", () => {
  // The invite panel's rule (DECISION Phase 88.6-22, FriendInvitePanel.js), from the shared
  // module: the FIRST non-terminal failure's register line, R2 when that failure has no code.
  // Register lines are read through getFetchErrorMessage, never typed.
  const R2 = "We couldn't send those invites. Please try again.";

  it('P92-1. an all-failed batch coded network shows the network line in the alert region, never R2', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    const failure = new ApiError('Network down', 'network', 0);
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(failure);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(errorRegion()?.textContent).toBe(getFetchErrorMessage(failure)));
    expect(errorRegion()?.textContent).not.toBe(R2);
    expect(errorRegion()?.className.split(/\s+/)).toContain('bg-status-error-subtle');
    expect(statusRegion()?.textContent).toBe('');
  });

  it('P92-2. two failures, the first coded network and the second code-less: the first reason is told', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1', { friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const first = new ApiError('Network down', 'network', 0);
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(first).mockRejectedValueOnce(new Error('x'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(errorRegion()?.textContent).toBe(getFetchErrorMessage(first)));
    expect(errorRegion()?.textContent).not.toBe(R2);
    expect(statusRegion()?.textContent).toBe('');
  });

  it('P92-3. two failures, the first code-less and the second coded network: R2, never the network line', async () => {
    // The other half of the first-failure rule: green on a page that always shows R2, and the
    // guard against keeping the first CODED failure instead of the first failure (its RED is a
    // plant, recorded in the plan's SUMMARY).
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1', { friends: [FRIENDSHIP, FRIENDSHIP_2] });
    const second = new ApiError('Network down', 'network', 0);
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(new Error('x')).mockRejectedValueOnce(second);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(errorRegion()?.textContent).toBe(R2));
    expect(errorRegion()?.textContent).not.toBe(getFetchErrorMessage(second));
    expect(statusRegion()?.textContent).toBe('');
  });
});

describe('friends — outcomes told right (88.6.1-72, owner rulings 2026-10-05)', () => {
  it('K1. a batch with one sent and one already pending reads the panel line, success tint (owner ruling 2026-10-05)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1', { friends: [FRIENDSHIP, FRIENDSHIP_2] });
    (invitesAPI.sendFriendInvite as Mock)
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(new ApiError('This person already has a pending invite', 'invite_pending', 409));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Sam' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(statusRegion()?.textContent).toBe('Invited 1 — 1 already invited or a member'));
    expect(statusRegion()?.className.split(/\s+/)).toContain('bg-status-success-subtle');
    expect(errorRegion()?.textContent).toBe('');
  });

  // R-C1 twin (88.9-56): the friends page Invite to Group clears only the ids whose outcome is final.
  it('R-C1 (88.9): the friends page bulk invite clears only the ids with a final outcome and keeps a transient failure and a mid-send tick', async () => {
    const LEE_UUID = 'cacacaca-caca-4aca-8aca-cacacacacaca';
    const FRIENDSHIP_3 = { id: 'fr-3', friend: { id: LEE_UUID, username: 'Lee' } };
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1', { friends: [FRIENDSHIP, FRIENDSHIP_2, FRIENDSHIP_3] });
    const send = deferred();
    (invitesAPI.sendFriendInvite as Mock)
      .mockReturnValueOnce(send.promise)
      .mockRejectedValueOnce(new ApiError('Server error', 'internal', 500));
    const dana = screen.getByRole('checkbox', { name: 'Select Dana' });
    const sam = screen.getByRole('checkbox', { name: 'Select Sam' });
    const lee = screen.getByRole('checkbox', { name: 'Select Lee' });
    fireEvent.click(dana);
    fireEvent.click(sam);
    fireEvent.click(inviteButton());
    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(1));
    // R-C3b reach (88.9-56): Invite to Group is on Button busy now — the heard suffix, the label
    // kept, the house spinner after the appear delay, and no hand-rolled spinning div.
    const sending = inviteButton();
    expect(sending).toHaveAccessibleName('Invite to Group, sending'); // AMENDED Phase 88.9-56 (R-C3b reach): the busy name
    const visible = sending.cloneNode(true) as HTMLElement;
    visible.querySelectorAll('.sr-only').forEach((node) => node.remove());
    expect(visible.textContent).toBe('Invite to Group'); // AMENDED Phase 88.9-56 (R-C3b reach): the label is kept
    await waitFor(() => expect(sending.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(sending.querySelectorAll('div.animate-spin')).toHaveLength(0); // AMENDED Phase 88.9-56 (R-C3b reach): no hand-rolled glyph
    // A friend ticked while the batch is in flight.
    fireEvent.click(lee);

    await act(async () => {
      send.resolve({});
    });
    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(dana).not.toBeChecked()); // sent
    expect(sam).toBeChecked(); // transient (internal): kept for the retry
    expect(lee).toBeChecked(); // ticked mid-send, never sent

    fireEvent.click(inviteButton());
    await waitFor(() => expect(invitesAPI.sendFriendInvite as Mock).toHaveBeenCalledTimes(4));
    expect((invitesAPI.sendFriendInvite as Mock).mock.calls.slice(2).map((call) => call[1]).sort()).toEqual(
      [FRIEND_2_UUID, LEE_UUID].sort()
    );
  });

  it('K2. a batch where everyone was already a member reads the panel line, success tint, never a failure', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(
      new ApiError('This person is already a member of the group', 'already_member', 409)
    );
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());

    await waitFor(() => expect(statusRegion()?.textContent).toBe('Everyone selected was already invited or a member'));
    expect(statusRegion()?.className.split(/\s+/)).toContain('bg-status-success-subtle');
    expect(errorRegion()?.textContent).toBe('');
  });

  it('K3. GUARD: a 409 with any other code is still a failure (the panel contract, MED #9)', async () => {
    await renderWithGroups([adminGroup('g1', 'Test Group')], 'g1');
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(new ApiError('x', 'conflict', 409));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Dana' }));
    fireEvent.click(inviteButton());

    // AMENDED IN PLACE by 88.6.1-90 (close ruling P-92, owner 2026-10-18): the expected text was
    // R2; an all-failed batch now tells its first failure's register line, so a coded 409 reads
    // the conflict line (read through getFetchErrorMessage, never typed). The GUARD is unchanged:
    // the batch is still a FAILURE, heard from the alert region, the polite one empty.
    await waitFor(() =>
      expect(errorRegion()?.textContent).toBe(getFetchErrorMessage(new ApiError('x', 'conflict', 409)))
    );
    expect(statusRegion()?.textContent).toBe('');
  });

  it('F1. a found result is announced from an always-mounted sr-only polite region: Found {name}. (copy row F7)', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    const region = searchStatus();
    expect(region).not.toBeNull();
    expect(region).toHaveAttribute('role', 'status');
    expect(region?.className.split(/\s+/)).toContain('sr-only');
    expect(region?.textContent).toBe('');
    await searchTo(RILEY_HIT, 'riley@example.com');
    expect(searchStatus()?.textContent).toBe('Found Riley.');
    expect(searchStatus()).toBe(region);
  });

  // 88.9-52 Q66: the backend never sends the other person's email (the search answers id and
  // username; request rows carry id, username and picture_url), so the page has no branch that
  // draws one. A payload that carried one anyway must not put it on screen or in a spoken line.
  it("Q66 (88.9-52): the other person's email is never drawn or spoken, in the found row, a request row or a sent row", async () => {
    const OTHER = 'other.person@example.test';
    providerCtx.receivedRequests = [{ id: 'req-q66', Requester: { id: FRIEND_2_UUID, username: 'Sam', email: OTHER } }];
    renderFriends({ friends: [], sent: [{ id: 'sr-q66', Addressee: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', username: 'Alex', email: OTHER } }] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    (friendshipsAPI.searchUserByEmail as Mock).mockResolvedValueOnce({ ...RILEY_HIT, email: OTHER });
    fireEvent.change(emailField(), { target: { value: 'riley@example.com' } });
    fireEvent.submit(emailField().closest('form') as HTMLFormElement);
    await screen.findByRole('button', { name: 'Send Request' });
    expect(searchStatus()?.textContent).toBe('Found Riley.');
    expect(document.body.textContent).not.toContain(OTHER);

    fireEvent.click(screen.getByRole('button', { name: /^Requests/ }));
    await screen.findByText('Sam');
    expect(document.body.textContent).not.toContain(OTHER);

    fireEvent.click(screen.getByRole('button', { name: /^Sent/ }));
    await screen.findByText('Alex');
    expect(document.body.textContent).not.toContain(OTHER);
  });

  it('F2. a miss keeps the search alert and leaves the found region empty', async () => {
    (friendshipsAPI.searchUserByEmail as Mock).mockRejectedValue(
      new ApiError('HTTP error! status: 404', 'not_found', 404)
    );
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    fireEvent.change(emailField(), { target: { value: 'nobody@example.com' } });
    fireEvent.submit(emailField().closest('form') as HTMLFormElement);
    expect((await screen.findByRole('alert')).textContent).toBe('No user found with that email.');
    expect(searchStatus()?.textContent).toBe('');
  });

  it('F3. the same result found twice is a DOM mutation on the same region (R8 backstop)', async () => {
    renderFriends({ friends: [] });
    await screen.findByRole('heading', { name: 'No friends yet' });
    await searchTo(RILEY_HIT, 'riley@example.com');
    expect(searchStatus()?.textContent).toBe('Found Riley.');
    const region = searchStatus() as HTMLElement;
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });
    try {
      (friendshipsAPI.searchUserByEmail as Mock).mockResolvedValueOnce(RILEY_HIT);
      fireEvent.submit(emailField().closest('form') as HTMLFormElement);
      await waitFor(() => expect(friendshipsAPI.searchUserByEmail as Mock).toHaveBeenCalledTimes(2));
      // Positive signal: the second search settled (Send Request is back).
      await screen.findByRole('button', { name: 'Send Request' });
      expect(records.length).toBeGreaterThan(0);
      expect(searchStatus()).toBe(region);
      expect(region.textContent).toBe('Found Riley.');
    } finally {
      observer.disconnect();
    }
  });
});

// Phase 88.9-40 (SESSION-01, owner ruling 2026-11-07, SPEC A8): a signed-out friends visit goes
// straight to sign-in and back here (the shared guard,
// src/lib/hooks/useSignInRedirect.ts ("DECISION Phase 88.9-40 (SESSION-01, owner ruling"))); the
// prompt remains for a return with the latch set, its Log In link now carrying returnTo; a
// useUser() error is the Reload fallback, not the prompt. AMENDED Phase 88.9-66 (X70b, owner
// 2026-11-14): the return with the latch set now shows the shared banner with Sign in.
describe('friends sign-in guard (88.9-40: SESSION-01)', () => {
  let savedUser: typeof auth.user;
  beforeEach(() => {
    savedUser = auth.user;
  });
  afterEach(() => {
    auth.user = savedUser;
    auth.error = null;
    restoreLocation();
  });

  it("SESSION-01 (88.9): a signed-out friends visit is sent to sign-in once with /friends as returnTo; back with the latch set the banner's Sign in link carries returnTo", async () => {
    const replace = stubLocation('/friends');
    auth.user = null as unknown as typeof auth.user;
    render(<FriendsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Ffriends');
    // The redirect frame is the auth hold, never the prompt. AMENDED Phase 88.9-66 (X35): the hold is
    // recognised by the words its polite region takes after the dwell.
    expect(await screen.findByText('Signing you in')).toHaveAttribute('role', 'status');
    // AMENDED Phase 88.9-66 (X70b): no Sign in paints during the redirect frame.
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
    cleanup();

    // Back in the same tab without signing in: the shared banner, its Sign in carrying returnTo, no
    // redirect (AMENDED Phase 88.9-66, X70b: the older log-in prompt is gone).
    render(<FriendsPage />);
    const signInLink = await screen.findByRole('link', { name: 'Sign in' });
    expect(signInLink).toHaveAttribute('href', '/api/auth/login?returnTo=%2Ffriends');
    expect(screen.getByText("Couldn't load your friends")).toBeInTheDocument();
    expect(screen.queryByText('Please log in to view your friends.')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Log In' })).toBeNull();
    expect(screen.queryByText('Signing you in')).toBeNull();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('SESSION-01 (88.9): a useUser error on friends shows Reload, not the signed-out banner, and never redirects', async () => {
    const replace = stubLocation('/friends');
    auth.user = null as unknown as typeof auth.user;
    auth.error = Object.assign(new Error('me failed'), { status: 500 });
    render(<FriendsPage />);
    expect(await screen.findByRole('button', { name: 'Reload page' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: "Couldn't load your friends" })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Sign in' })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBeNull();
  });

  // 88.9-52 review A-37: the REDIRECT arm of a list read's 401 (the helpers above pin only the
  // declined arm, by setting the latch first). No latch here, so the guard navigates once.
  it('SESSION-01 (88.9-52 A-37): a 401 on the friends list with no latch is sent to sign-in once, /friends as returnTo, and sets the latch', async () => {
    const replace = stubLocation('/friends');
    renderFriends({ loadError: new ApiError('Unauthorized', 'unauthorized', 401) });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Ffriends');
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
    // The redirect frame is the hold, never a banner.
    expect(screen.queryByText("Couldn't load your friends")).toBeNull();
  });

  it('SESSION-01 (88.9-52 A-37): a 401 on the sent list with no latch is sent to sign-in once and sets the latch', async () => {
    const replace = stubLocation('/friends');
    h.selfUuid = SELF_UUID;
    (friendshipsAPI.getFriends as Mock).mockResolvedValue([FRIENDSHIP]);
    (friendshipsAPI.getSentRequests as Mock).mockRejectedValue(new ApiError('Unauthorized', 'unauthorized', 401));
    render(<FriendsPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith('/api/auth/login?returnTo=%2Ffriends');
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
  });

  // 88.9-52 review A-31 (Friends half): back from sign-in with the latch set, the friends list
  // answering first must not clear the latch while the sent list is still out; its 401 then takes
  // the declined arm (the banner with Sign in), never a second trip.
  it('SESSION-01 (88.9-52 A-31): back with the latch set, a friends list that loads before the sent list answers 401 does not redirect again', async () => {
    const replace = stubLocation('/friends');
    window.sessionStorage.setItem(signInLatchKey(window.location), '1');
    h.selfUuid = SELF_UUID;
    const sent = deferred<unknown>();
    (friendshipsAPI.getFriends as Mock).mockResolvedValue([FRIENDSHIP]);
    (friendshipsAPI.getSentRequests as Mock).mockReturnValue(sent.promise);
    render(<FriendsPage />);
    await screen.findByText('Dana');
    // The friends list alone has not proven the session: the latch is still set.
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
    await act(async () => {
      sent.reject(new ApiError('Unauthorized', 'unauthorized', 401));
    });
    fireEvent.click(sentTabButton());
    expect(await screen.findByText(SENT_TITLE)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBe('1');
  });

  // The stale-latch trap: a read that settles as a plain failure must not hold the latch set, or the
  // person's next real expiry would show a banner where it should send them to sign-in.
  it('SESSION-01 (88.9-52 A-31): the latch is cleared once the three reads have settled with no 401, even when the sent list failed', async () => {
    stubLocation('/friends');
    window.sessionStorage.setItem(signInLatchKey(window.location), '1');
    h.selfUuid = SELF_UUID;
    (friendshipsAPI.getFriends as Mock).mockResolvedValue([FRIENDSHIP]);
    (friendshipsAPI.getSentRequests as Mock).mockRejectedValue(new ApiError('Server error', 'internal', 500));
    render(<FriendsPage />);
    await screen.findByText('Dana');
    await waitFor(() => expect(window.sessionStorage.getItem(signInLatchKey(window.location))).toBeNull());
  });
});

// 88.9-52 W38 (owner ruling, 88.9-RULINGS.md: the inline two-tap controls take ONE look at rest,
// armed and busy; schedule Delete and phone Remove on Profile are the model). The friend Remove has
// no border in any state (it drew an outlined box when armed), speaks its arm in weight alone, and
// while its write runs the spinner sits BEFORE the word, so the word stays where the other rows'
// Remove is. jsdom has no layout, so the proof is the class list and the child order.
describe('friend Remove takes the one inline two-tap look (88.9-52: W38)', () => {
  const borderClasses = (el: HTMLElement) => el.className.split(/\s+/).filter((c) => /(^|:)border(-|$)/.test(c));

  it('W38 (88.9-52): the friend Remove has no box at rest, armed or busy; armed is weight only; the busy spinner leads the word', async () => {
    const heldRemove = deferred<unknown>();
    (friendshipsAPI.removeFriend as Mock).mockReturnValueOnce(heldRemove.promise);
    renderFriends();
    const remove = await screen.findByRole('button', { name: 'Remove Dana' });
    const classes = () => remove.className.split(/\s+/);

    // At rest: the model's host classes, and no border class of any kind.
    expect(borderClasses(remove)).toEqual([]);
    for (const c of ['inline-flex', 'items-center', 'min-h-11', 'shrink-0', 'whitespace-nowrap', 'px-2', 'rounded-btn', 'text-sm', 'text-content-status-error', 'hover:bg-status-error-subtle']) {
      expect(classes(), c).toContain(c);
    }
    expectFocusRingEdge(classes(), undefined, 'Remove at rest');
    expect(classes()).not.toContain('font-semibold');

    // Armed, while it counts down and once live: weight only, still no border.
    fakeClock();
    fireEvent.click(remove);
    expect(remove).toHaveTextContent('Wait (3)');
    expect(borderClasses(remove)).toEqual([]);
    expect(classes()).toContain('font-semibold');
    // PIX-2 (88.9-52, W38 one look): the short Wait (3) is anchored to the RIGHT end of the reserve, as
    // the schedule Delete's is. A button centres its text, so without this the label sat mid-reserve
    // (measured: left edge 240 in a 151px reserve at 375) while the schedule Delete's ended at the edge.
    const reserveRoot = remove.querySelector('span.inline-grid') as HTMLElement;
    expect(reserveRoot, 'the armed Remove has no reserve around its label').not.toBeNull();
    expect(reserveRoot.querySelectorAll('[data-reserve]').length).toBeGreaterThan(0);
    expect(reserveRoot.className.split(/\s+/)).toContain('justify-items-end');
    passGate();
    expect(remove).toHaveTextContent(/^Tap again$/);
    expect(borderClasses(remove)).toEqual([]);
    expect(classes()).toContain('font-semibold');

    // Busy: the resting weight, no border, and the spinner is the FIRST child, before the word.
    fireEvent.click(remove);
    expect(remove).toHaveAccessibleName('Remove Dana, removing');
    await waitFor(() => expect(remove.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));
    expect(borderClasses(remove)).toEqual([]);
    expect(classes()).not.toContain('font-semibold');
    const spinner = remove.querySelector('[data-slot="spinner"]') as HTMLElement;
    expect(remove.firstElementChild).toBe(spinner);
    expect(spinner.className.split(/\s+/)).toContain('mr-2');
    expect(spinner.className.split(/\s+/)).not.toContain('ml-2');
    expect(remove).toHaveTextContent(/^Remove$/);

    await act(async () => {
      heldRemove.resolve({});
    });
    await waitFor(() => expect(remove).not.toBeInTheDocument());
  });
});

// DECISION Phase 88.9-58 (X14 family, owner 2026-11-14 on the live page: "Why not just turn them
// into white cards?"): the three bordered rows on the Friends page are card surfaces with no hover,
// chosen OVER the unfilled bordered row with a hover wash (page-coloured at rest, a reaction on a
// row that is not clickable). The controls inside a row therefore sit on a card, so their focus
// halo names the card, not the page. The rendered half is e2e/friends-page.spec.ts ("X14 Friends rows (88.9): friend and request rows paint the card colour").
describe('friends rows are cards (88.9-58: X14 family)', () => {
  it('X14 Friends rows (88.9): the friend, received-request and sent-request rows are card surfaces with no hover, their Accept and Decline take the card as halo host, and the checkbox keeps the browser ring', async () => {
    providerCtx.receivedRequests = [SAM_REQUEST];
    renderFriends({ sent: [ALEX_SENT] });
    await screen.findByText('Dana');

    const classesOf = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    const expectCardRow = (row: Element | null, what: string) => {
      expect(row, `${what}: the row is not rendered`).not.toBeNull();
      const tokens = classesOf(row as Element);
      expect(tokens, `${what}: the row must paint the card colour`).toContain('bg-surface-card');
      expect(tokens, `${what}: the row keeps its own border`).toContain('border-line');
      expect(tokens, `${what}: the row is a list row, not the card utility (its p-4 is right for a list item)`).not.toContain('card');
      expect(
        tokens.filter((t) => t.split(':').includes('hover')),
        `${what}: the row is not clickable, so it must not react to hover`,
      ).toEqual([]);
    };

    const friendRow = document.querySelector('[data-friend-row]');
    expectCardRow(friendRow, 'friend row');
    const checkbox = within(friendRow as HTMLElement).getByRole('checkbox');
    // AMENDED Phase 89.6-12 (O-1b c, owner pick 2026-11-22): the checkbox no longer carries an app ring
    // or a halo at all, so it no longer names the card; the browser draws its focus ring (the written
    // exception, DECISION Phase 89.6-12 (O-1b) in globals.css). The 88.9-58 halo pin held until then.
    expect(
      classesOf(checkbox).filter((t) => t.includes('ring')),
      'the checkbox carries no app ring or halo: the browser draws its focus ring',
    ).toEqual([]);
    expect(classesOf(checkbox), 'the checkbox must not hide its outline').not.toContain('focus:outline-hidden');

    fireEvent.click(requestsTab());
    await screen.findByText('Sam');
    const requestRowEl = document.querySelector('[data-request-row]');
    expectCardRow(requestRowEl, 'received-request row');
    for (const name of ['Accept', 'Decline']) {
      const button = within(requestRowEl as HTMLElement).getByRole('button', { name });
      // On a card: the Button default card halo, never the page one.
      expectRingGround(classesOf(button), 'card', name);
    }
    // Decline is the ordinary secondary on the card: no page-ground fill override.
    const decline = within(requestRowEl as HTMLElement).getByRole('button', { name: 'Decline' });
    expect(classesOf(decline)).toContain('btn-secondary');
    expect(decline.getAttribute('class') ?? '', 'Decline takes the ordinary secondary fill on its card').not.toContain('color-btn-secondary-page-bg');

    fireEvent.click(sentTabButton());
    const alex = await screen.findByText('Alex');
    let sentRow: HTMLElement | null = alex.parentElement;
    while (sentRow && !classesOf(sentRow).includes('justify-between')) sentRow = sentRow.parentElement;
    expectCardRow(sentRow, 'sent-request row');
  });
});

// Phase 88.9-66 (X35, once-over R13): the Friends busy lines are HEARD. Each line used to be a row
// that mounted already holding its words with the status role, and a screen reader announces a
// change to a live region, never the arrival of one, so none of them was spoken. Now each host
// keeps ONE visually hidden polite region mounted (StatusRegion with settleOnMount, plan 88.9-65),
// fed the line's former accessible name while the line shows; the visible row is plain text with
// the same words, classes and timing as before. The shape every test here uses: capture the polite
// regions while they are empty, wait for the words, and require the node that speaks to be one of
// the captured ones.
describe('friends busy lines are heard (88.9-66: X35)', () => {
  const statuses = () => screen.queryAllByRole('status');
  const emptyRegions = () => statuses().filter((n) => n.textContent === '');
  const speaking = (words: string) => statuses().find((n) => n.textContent === words);

  async function expectSpokenFrom(mountedEmpty: HTMLElement[], words: string) {
    await waitFor(() => expect(speaking(words), `no polite region ever said "${words}"`).toBeDefined());
    const region = speaking(words) as HTMLElement;
    expect(mountedEmpty, `the region that says "${words}" was not on the page, empty, before it spoke`).toContain(region);
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('sr-only');
    return region;
  }

  // A visible busy row: on screen with its words, and not itself a live region or hidden from one.
  function expectPlainRow(words: string) {
    const row = screen.getByText(words);
    expect(row.closest('[role="status"]'), `"${words}" is still inside a status row`).toBeNull();
    expect(row.closest('[aria-hidden="true"]'), `"${words}" must stay readable in place`).toBeNull();
    return row;
  }

  it('X35 (88.9): Signing you in and Loading your friends are spoken from a region that was mounted empty', async () => {
    const savedUser = auth.user;
    stubLocation('/friends');
    auth.user = null as unknown as typeof auth.user;
    try {
      render(<FriendsPage />);
      // The redirect frame's first commit: one polite region, empty.
      expect(statuses(), 'the sign-in hold mounts exactly one polite region').toHaveLength(1);
      const mounted = emptyRegions();
      expect(mounted, 'the sign-in hold mounted its region already holding words').toHaveLength(1);
      await expectSpokenFrom(mounted, 'Signing you in');
    } finally {
      auth.user = savedUser;
      restoreLocation();
    }
    cleanup();

    renderFriends({ selfUuid: null });
    expect(statuses(), 'the identity loader mounts exactly one polite region').toHaveLength(1);
    const mounted = emptyRegions();
    expect(mounted, 'the identity loader mounted its region already holding words').toHaveLength(1);
    await expectSpokenFrom(mounted, 'Loading your friends');
  });

  it('X35 (88.9): Searching and Loading group members are spoken from a region that was already there, and the visible rows keep their words', async () => {
    (groupsAPI.getUserGroups as Mock).mockResolvedValue([adminGroup('g-1', 'Tuesday Crew')]);
    renderFriends();
    const select = await screen.findByLabelText('Invite to group');
    // Past the arrival dwell of every region mounted with the page and with the invite bar.
    await act(() => new Promise<void>((r) => setTimeout(r, REGION_EMPTY_DWELL_MS + 20)));
    const before = statuses();
    expect(speaking('Searching for that email address')).toBeUndefined();

    const heldSearch = deferred<unknown>();
    (friendshipsAPI.searchUserByEmail as Mock).mockReturnValueOnce(heldSearch.promise);
    fireEvent.change(emailField(), { target: { value: 'riley@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const searchRegion = speaking('Searching for that email address') as HTMLElement;
    expect(searchRegion, 'no polite region said the search words the moment the search started').toBeDefined();
    expect(before, 'the search region was mounted with its words instead of being fed them').toContain(searchRegion);
    expectPlainRow('Searching...');
    await act(async () => {
      heldSearch.resolve(null);
    });
    await waitFor(() => expect(screen.queryByText('Searching...')).toBeNull());
    expect(searchRegion.textContent).toBe('');

    const heldMembers = deferred<unknown[]>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(heldMembers.promise);
    fireEvent.change(select, { target: { value: 'g-1' } });
    const membersRegion = await waitFor(() => {
      const region = speaking('Loading group members');
      expect(region, 'no polite region said the members words').toBeDefined();
      return region as HTMLElement;
    });
    expect(before, 'the members region was mounted with its words instead of being fed them').toContain(membersRegion);
    expectPlainRow('Loading group members...');
    await act(async () => {
      heldMembers.resolve([]);
    });
    await waitFor(() => expect(screen.queryByText('Loading group members...')).toBeNull());
    expect(membersRegion.textContent).toBe('');
  });

  it('X35 (88.9): the Friends, Requests and Sent loaders are spoken after the dwell from a region mounted with their tab', async () => {
    h.selfUuid = SELF_UUID;
    (friendshipsAPI.getFriends as Mock).mockReturnValue(deferred<unknown[]>().promise);
    (friendshipsAPI.getSentRequests as Mock).mockReturnValue(deferred<unknown[]>().promise);
    providerCtx.loading = true;
    render(<FriendsPage />);

    // The Friends tab's first commit: its row shows at once, its region is there and empty.
    let mounted = emptyRegions();
    expectPlainRow('Loading friends...');
    expect(speaking('Loading your friends')).toBeUndefined();
    await expectSpokenFrom(mounted, 'Loading your friends');

    fireEvent.click(requestsTab());
    mounted = emptyRegions();
    expectPlainRow('Loading requests...');
    expect(speaking('Loading your friend requests')).toBeUndefined();
    await expectSpokenFrom(mounted, 'Loading your friend requests');

    fireEvent.click(sentTabButton());
    mounted = emptyRegions();
    expectPlainRow('Loading sent requests...');
    expect(speaking('Loading your sent requests')).toBeUndefined();
    await expectSpokenFrom(mounted, 'Loading your sent requests');
  });

  it('X35 (88.9): this page and FriendInvitePanel hold no conditionally mounted labelled status row', () => {
    // Read from disk with fs: every polite region in these two files is the StatusRegion primitive,
    // so neither source writes the status role as an attribute any more.
    for (const file of ['src/app/friends/page.js', 'src/app/components/FriendInvitePanel.js']) {
      const source = readFileSync(resolve(process.cwd(), file), 'utf8');
      expect(source.split('role="status"').length - 1, `${file} still writes a status role by hand`).toBe(0);
      expect(source, `${file} feeds no settle-on-mount region`).toContain('settleOnMount');
    }
  });
});

// 88.9-52 R3 (owner: "we have to remember to update the[m] if we modify the title"): the heading
// only screen readers get and the page's own visible name are ONE constant, so one cannot be
// changed without the other. Read off the page source: a hand-typed copy at either site fails here.
describe('friends page name, one source (88.9-52 R3)', () => {
  it('R3 (88.9-52): the screen-reader-only page heading and the visible page name come from one constant', () => {
    const src = readFileSync(resolve(__dirname, 'page.js'), 'utf8');
    const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
    expect(count(src, "const FRIENDS_PAGE_TITLE = 'Friends';"), 'the one declaration').toBe(1);
    expect(count(src, 'srHeading="'), 'a hand-typed hidden heading').toBe(0);
    expect(count(src, 'srHeading={FRIENDS_PAGE_TITLE}'), 'the signed-out frame').toBe(1);
    expect(count(src, '>{FRIENDS_PAGE_TITLE}</Heading>'), 'the three visible level-1 titles').toBe(3);
    expect(count(src, '>Friends</Heading>'), 'a hand-typed visible title').toBe(0);
  });

  // 88.9-52 S-C6: the source read above counts substrings, so a comment could satisfy it. This one
  // reads the two RENDERED headings: the visible title on a normal render and the screen-reader-only
  // heading on the signed-out banner screen must be the same words.
  it('S-C6 (88.9-52): rendered, the signed-out screen-reader-only heading reads what the visible title reads', async () => {
    renderFriends();
    const visible = await screen.findByRole('heading', { level: 1 });
    expect(visible).not.toHaveClass('sr-only');
    const visibleName = visible.textContent;
    expect(visibleName).toBeTruthy();
    cleanup();

    const saved = auth.user;
    auth.user = null as unknown as typeof auth.user;
    stubLocation('/friends');
    window.sessionStorage.setItem(signInLatchKey(window.location), '1');
    try {
      render(<FriendsPage />);
      await screen.findByRole('link', { name: 'Sign in' });
      const hidden = screen.getByRole('heading', { level: 1 });
      expect(hidden).toHaveClass('sr-only');
      expect(hidden.textContent).toBe(visibleName);
    } finally {
      auth.user = saved;
      restoreLocation();
    }
  });
});
