// Phase 88 plan 06 Task 2 — RENDER HARNESS for the gameDetail surface.
//
// WHY THIS FILE EXISTS (read before extending):
// gameDetail is the Req 20 composition surface, but the only test over it was
// the narrow `gameDetail.identity.test.tsx` own-review gate. There was no
// general harness, so Req 20's pins had nowhere to live. This file supplies the
// mock stack and — critically — a ROLE-PARAMETERISED render helper.
//
// ROLE PARAMETERISATION IS THE POINT. `userRole` is not a prop: the page derives
// it inside `resolveUserScope(roster, selfUuid)` from the CALLER'S OWN roster row
// (`UserGroup.role`, or `UserGroup === null` for a game-only caller). Retrofitting
// that into an existing flat mock stack is painful, so `renderGameDetail({ role })`
// builds the roster correctly from the start. The D-40 session-delete gate and the
// Req 20 pins both need it.
//
// NOT IN SCOPE HERE: the Req 13 creator-vs-non-creator trio was RE-SCOPED to
// Phase 92 (adversarial-review DEC-1, owner 2026-08-05). Deliberately NO
// creator-identity fixtures are built in this file. `role` is group role only.
//
// WHAT IS ASSERTED HERE: only what is true on THIS branch. Not-yet-true pins live
// in the EXTENSION POINTS block below so this file is green for every plan
// between now and the one that adds them.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` page under test.
//
// ---------------------------------------------------------------------------
// EXTENSION POINTS — who adds what, and where
// ---------------------------------------------------------------------------
// * plan 88-11 (SPEC Req 20) adds the F-6a..F-6d composition pins here. Render
//   via `renderGameDetail` and scope with `sessionsSection()` / `reviewsSection()`
//   below rather than re-deriving containers.
// * plan 88-20 adds the 16px control pins for gameDetail's buttons/controls.
// * The D-40 session-delete gate extends `describe('role-gated session
//   affordances')` — the roster plumbing it needs is already here.
import * as React from 'react';
import { render, screen, within, cleanup, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SPINNER_DELAY_MS, SPINNER_MIN_MS } from '@/components/ui/useDelayedSpinner'; // AMENDED Phase 88.9-54 (R-C3b): the hold budget
import { CONFIRM_DELAY_MS } from '@/components/ui/confirmDelay';
import { REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';
import { expectFocusRing } from '@/test-utils/focusRingAssert';

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
// The page guards all three URL ids (game_id, event_id, group_id) with isUuid at the
// one URL read (88.6.1-25, D-03 / CSPT), so every id the harness puts in the URL must be
// UUID-shaped, and each fixture id is distinct from every other one.
const GAME_ID = '77777777-7777-4777-8777-777777777777';
const GROUP_ID = '44444444-4444-4444-8444-444444444444';
// A valid UUID that is NOT the event's group (88.6.1-25 task 3, D-41 precedence).
const URL_ONLY_GROUP_ID = '66666666-6666-4666-8666-666666666666';

/**
 * Group role of the CALLER, as it will appear on their roster row.
 * `'game-only'` models the caller-self-row contract's `UserGroup === null` case.
 */
export type CallerRole = 'owner' | 'admin' | 'member' | 'pending' | 'game-only';

const EVENT_ID = '55555555-5555-4555-8555-555555555555';

// `search` is hoisted state, not a literal, because gameDetail renders a WHOLLY
// DIFFERENT tree for `?event_id=` (the single-event view: participant strip,
// See-all modal, guest invites) than for `?game_id=` (the game view: sessions,
// reviews). Plan 88-20 touches both, so the harness has to be able to reach both.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  search: '',
  // 88.6-18: hoisted so a test can model the AUTH half of a handler pre-check the
  // same way `selfUuid` models the identity half. Defaults to the shipped literal,
  // so every pre-existing test is byte-equivalent.
  userSub: 'auth0|self-sub' as string | undefined,
  // 88.6.1-25: `useUser().isLoading`, so a test can hold the session unsettled (the SPEC
  // backstop `concurrency / R1`). False by default, so every older test is unchanged.
  authLoading: false as boolean,
  // 88.6.1-25: ONE router push spy and ONE identity refetch spy for the whole file, so a
  // test can assert a navigation (AC-7) or the D-02 identity recheck. Both used to be a
  // fresh vi.fn() per render, which nothing could observe.
  push: vi.fn(),
  selfRefetch: vi.fn(),
  // 88.6.1-25 task 3: every CreateEvent render's props, newest last (AC-7, the edit modal).
  createEventProps: [] as Array<Record<string, unknown>>,
  // 88.6.1-68: how many CreateEvent instances are mounted right now (a mount effect counts up, its
  // cleanup counts down), so an arm can tell whether the host closed (unmounted) its dialog.
  createEventMounts: 0,
}));

// 88.6.1-25 S2: the RsvpSection stub records its latest props so a test can fire
// onRsvpChange; it still renders the same testid marker, so nothing that queries it moves.
const rsvpProps = vi.hoisted(() => ({
  current: null as null | { onRsvpChange?: (status: string) => void },
}));
// quick-261021-ffb (Games to Bring re-entry): the BringSummary and BringGamePicker stubs record their
// latest props, so a test can read the viewer's RSVP the section receives, fire its control, and see
// whether the one picker is open and for which event.
const bringSummaryProps = vi.hoisted(() => ({
  current: null as null | { userRsvpStatus?: string | null; onEditClick?: () => void },
}));
const bringPickerProps = vi.hoisted(() => ({
  current: null as null | { isOpen?: boolean; eventId?: string | null; onClose?: () => void },
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self-sub' } : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: h.selfRefetch },
    isPending: !h.selfUuid,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ push: h.push, replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: h.userSub ? { sub: h.userSub } : undefined, isLoading: h.authLoading }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'UTC' }),
}));

// R19 (88.9-52): the status is 'none' for everyone unless a test names friends here (reset in afterEach).
const friendship = vi.hoisted(() => ({ accepted: new Set<string>() }));
afterEach(() => friendship.accepted.clear());
vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({
    getStatus: (id: string) => (friendship.accepted.has(id) ? 'accepted' : 'none'),
    sendRequest: vi.fn(),
  }),
}));

// Heavy / self-fetching children stubbed. `FetchErrorBanner` is deliberately kept
// REAL — it renders null while the identity query is healthy, so stubbing it
// would only mask a regression in the degrade path.
// Testid markers, not bare nulls (88-33 Task 7): the fork G split asserts WHERE
// these mount (Upcoming cards yes, history cards no), which a null stub can't pin.
vi.mock('@/app/components/RsvpSection', () => ({
  default: (props: { onRsvpChange?: (status: string) => void }) => {
    rsvpProps.current = props;
    return <div data-testid="rsvp-section" />;
  },
}));
// 88.6.1-74 (SR-7, SR-26): the stub echoes its `userRsvpStatus` prop, nothing else changes.
vi.mock('@/app/components/BallotSection', () => ({
  default: ({ userRsvpStatus }: { userRsvpStatus?: string | null }) => (
    <div data-testid="ballot-section" data-rsvp-status={userRsvpStatus ?? ''} />
  ),
}));
vi.mock('@/app/components/BringGamePicker', () => ({
  default: (props: { isOpen?: boolean; eventId?: string | null; onClose?: () => void }) => {
    bringPickerProps.current = props;
    return null;
  },
}));
// quick-261021-ffb: the stub echoes its `userRsvpStatus` prop (the BallotSection stub's idiom above).
vi.mock('@/app/components/BringSummary', () => ({
  default: (props: { userRsvpStatus?: string | null; onEditClick?: () => void }) => {
    bringSummaryProps.current = props;
    return <div data-testid="bring-summary" data-rsvp-status={props.userRsvpStatus ?? ''} />;
  },
}));
// 88.6.1-25 task 3: CreateEvent records its props (AC-7 asserts which group the edit modal gets)
// and still renders nothing; GameSuggestionCard renders one button named for its game, so a test
// can tap a Recommended Games card. Every older case resolves suggestions to [], so no card renders.
vi.mock('@/app/components/createEvent', async () => {
  const { useEffect } = await import('react');
  function CreateEventStub(props: Record<string, unknown>) {
    h.createEventProps.push(props);
    // 88.6.1-68: the mount counter (see `h.createEventMounts`).
    useEffect(() => {
      h.createEventMounts += 1;
      return () => {
        h.createEventMounts -= 1;
      };
    }, []);
    return null;
  }
  return { default: CreateEventStub };
});
vi.mock('@/app/components/GameSuggestionCard', () => ({
  default: ({
    game,
    onClick,
  }: {
    game: { id: string; name: string };
    onClick?: (game: { id: string; name: string }) => void;
  }) => (
    <button type="button" onClick={() => onClick?.(game)}>
      {game.name}
    </button>
  ),
}));
// 89.6-28 R-C10: the stub still renders nothing, but records whether the QR dialog was ever opened
// (the EventDayModal.test.tsx qrProps idiom), so an empty invite_url can be shown to open no box.
const qrOpened = vi.hoisted(() => ({ count: 0 }));
vi.mock('@/app/components/QRCodeModal', () => ({
  default: (props: { isOpen?: boolean }) => {
    if (props.isOpen) qrOpened.count += 1;
    return null;
  },
}));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
// StarRatingPicker is deliberately NOT stubbed (plan 88-20). It is the one child
// whose a11y contract this file asserts — DEF-88-10-01's eleventh site is the
// orphan <label> that sat over it, and a `() => null` stub makes both the
// radiogroup-name pin and the orphan-label sweep vacuous on the review dialog.
vi.mock('@/app/components/ClickableMemberName', () => ({
  // 88.9-52 R4 D3: the stub marks itself with the user id it was handed, so a test can tell a name
  // routed through the name control from the page's own plain text.
  default: ({ username, userId }: { username?: string; userId?: string }) => <span data-member-name={userId}>{username}</span>,
}));

// Keep ApiError/ApiErrorCode REAL (the real useFetchErrorState reads them);
// `importOriginal` spread means a REMOVED export still fails (T-88-06-01).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    gamesAPI: { getGame: vi.fn() },
    eventsAPI: {
      getGroupEvents: vi.fn(),
      getEvent: vi.fn(),
      deleteEvent: vi.fn(),
      removeParticipation: vi.fn(),
      getEventInviteToken: vi.fn(),
      leaveEvent: vi.fn(),
    },
    gameReviewsAPI: { getGameReviews: vi.fn(), submitReview: vi.fn(), deleteReview: vi.fn() },
    groupsAPI: { getGroupMembers: vi.fn() },
    rsvpAPI: { getEventRsvps: vi.fn() },
    eventBringsAPI: { getEventBrings: vi.fn() },
    suggestionsAPI: { getEventSuggestions: vi.fn() },
    invitesAPI: { sendParticipantInvite: vi.fn() },
  };
});

import GameDetailPage from './page';
import {
  gamesAPI,
  eventsAPI,
  gameReviewsAPI,
  groupsAPI,
  rsvpAPI,
  eventBringsAPI,
  suggestionsAPI,
  invitesAPI,
  ApiError,
} from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

export const GAME = {
  id: GAME_ID,
  name: 'Wingspan',
  description: 'A bird game',
  image_url: '',
  is_custom: false,
  min_players: 1,
  max_players: 5,
  playing_time: 60,
  theme: 'Nature',
  year_published: 2019,
  bgg_id: 266192,
};

/** One past session of GAME. `comments` is the row's distinctive visible text. */
export const SESSION = {
  id: 'evt-1',
  game_id: GAME_ID,
  group_id: GROUP_ID,
  start_date: '2026-01-15T18:00:00Z',
  duration_minutes: 90,
  comments: 'Close finish on the last round',
  EventParticipations: [],
};

/**
 * Build the roster the page resolves the caller's role from. The caller's own
 * row must be present — that is the Plan 71.1-01 caller-self-row contract, and
 * `resolveUserScope` returns scope 'none' without it.
 */
export function rosterFor(role: CallerRole) {
  return [
    {
      id: SELF_UUID,
      username: 'Me',
      user_id: 'auth0|self-sub',
      UserGroup: role === 'game-only' ? null : { role },
    },
    {
      id: OTHER_UUID,
      username: 'Someone Else',
      user_id: 'auth0|other',
      UserGroup: { role: 'member' },
    },
  ];
}

export interface RenderGameDetailOptions {
  /** Caller's group role. Drives every `userRole`/`userScope` gate on the page. */
  role?: CallerRole;
  /** Sessions returned for the group (filtered by the page down to this game). */
  events?: Array<Record<string, unknown>>;
  /** Reviews for this game. Default [] so no own-review affordance renders. */
  reviews?: Array<Record<string, unknown>>;
  /**
   * The game itself. Overriding it is how the `is_custom` render branch is
   * reached — the page picks its branch from this payload, and D-38's CTA sits
   * after BOTH branches, so both need covering.
   */
  game?: Record<string, unknown> | null;
  /**
   * The URL query (88.6.1-25). Default `game_id=GAME_ID&group_id=GROUP_ID`; a test of the
   * URL guard passes its own (a rejected or missing id).
   */
  search?: string;
  /**
   * 88.6.1-74: render inside a `<main>` container, the layout's shape (`layout.js`, its one
   * `<main>` element), so plan 04's focus floor has a `main`. Default false.
   */
  inMain?: boolean;
  /** 88.6.1-74: render with the self identity unresolved (`selfUuid` undefined). Default false. */
  identityPending?: boolean;
}

// 88.6.1-74: the container a render with `inMain` uses. Testing Library's cleanup removes a
// container it was handed when that container's parent is document.body.
function renderPage(inMain: boolean) {
  if (!inMain) return render(<GameDetailPage />);
  return render(<GameDetailPage />, {
    container: document.body.appendChild(document.createElement('main')),
  });
}

/**
 * Render gameDetail with a resolved identity and a caller role.
 *
 * @example renderGameDetail({ role: 'member' })
 */
export function renderGameDetail(options: RenderGameDetailOptions = {}) {
  const {
    role = 'member',
    events = [SESSION],
    reviews = [],
    game = GAME,
    search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`,
    inMain = false,
    identityPending = false,
  } = options;
  h.selfUuid = identityPending ? undefined : SELF_UUID;
  h.search = search;
  (gamesAPI.getGame as Mock).mockResolvedValue(game);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue(events);
  (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue(reviews);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor(role));
  (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
  return renderPage(inMain);
}

/**
 * A flattened EventParticipation row, as `formatEventWithCustomParticipants`
 * returns it: `user_id` IS the Users.id UUID, and a CUSTOM guest has it null.
 * That null is what separates "guest with an account we can invite" from
 * "a name someone typed in", which is the whole of the Req 15 gate.
 */
export function participantRow(
  overrides: Partial<{
    user_id: string | null;
    username: string;
    is_guest: boolean;
    is_custom: boolean;
  }> = {}
) {
  return {
    user_id: OTHER_UUID,
    username: 'Someone Else',
    is_guest: false,
    is_custom: false,
    ...overrides,
  };
}

export interface RenderEventDetailOptions {
  role?: CallerRole;
  participants?: Array<Record<string, unknown>>;
  /**
   * The URL `group_id` (88.6.1-25). Default GROUP_ID (the event's own group); `null` drops
   * the param, as the event-created notification link does.
   */
  urlGroupId?: string | null;
  /** When set, `getEvent` rejects with this value instead of resolving the fixture. */
  getEventRejectsWith?: unknown;
  /** Merged over the event fixture (e.g. a location a test asserts is NOT on screen). */
  eventOverrides?: Record<string, unknown>;
  /**
   * Render with the self identity still unresolved (`selfUuid` undefined), so a test can resolve
   * it later and drive the fetch effect's identity re-run. Default false: every older test is
   * unchanged.
   */
  identityPending?: boolean;
  /** 88.6.1-74: render inside a `<main>` container (see RenderGameDetailOptions.inMain). */
  inMain?: boolean;
}

/**
 * The event `getEvent` resolves for EVENT_ID, in its flattened backend shape. Exported so a
 * test can queue it with `mockResolvedValueOnce(eventFixture())` before a retry.
 */
export function eventFixture(
  overrides: Record<string, unknown> = {},
  participants: Array<Record<string, unknown>> = [participantRow()]
) {
  return {
    id: EVENT_ID,
    title: 'Game Night',
    start_date: '2026-03-01T18:00:00Z',
    duration_minutes: 120,
    group_id: GROUP_ID,
    Group: { id: GROUP_ID, name: 'The Group' },
    EventParticipations: participants,
    ...overrides,
  };
}

// X42 (88.9-65): Share Game QR renders only BEFORE the night starts, and the page reads the live
// clock for that. A test that needs the button pins the clock to this instant, three days before
// eventFixture's fixed start, so both sides of the comparison are fixed points: the W64 rule
// recorded at TEST_NOW below (a bare future date read against the wall clock is refused there).
// Each describe that calls it restores real timers in its own afterEach; shouldAdvanceTime is
// carried for the reason that marker gives.
const BEFORE_THE_NIGHT = new Date('2026-02-26T18:00:00Z');
function pinClockBeforeTheNight() {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(BEFORE_THE_NIGHT);
}

/**
 * Render the SINGLE-EVENT view (`?event_id=`) — the tree that owns the
 * participant strip, the See-all modal and the guest-invite affordance.
 *
 * @example renderEventDetail({ role: 'owner', participants: [participantRow()] })
 */
export function renderEventDetail(options: RenderEventDetailOptions = {}) {
  const {
    role = 'owner',
    participants = [participantRow()],
    urlGroupId = GROUP_ID,
    getEventRejectsWith,
    eventOverrides = {},
    identityPending = false,
    inMain = false,
  } = options;
  h.selfUuid = identityPending ? undefined : SELF_UUID;
  h.search =
    urlGroupId === null ? `event_id=${EVENT_ID}` : `event_id=${EVENT_ID}&group_id=${urlGroupId}`;
  if (getEventRejectsWith !== undefined) {
    (eventsAPI.getEvent as Mock).mockRejectedValue(getEventRejectsWith);
  } else {
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture(eventOverrides, participants));
  }
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor(role));
  (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
  (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([]);
  (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValue([]);
  return renderPage(inMain);
}

/** Open the See-all participants modal and return its dialog element. */
export async function openParticipantsModal(
  user: ReturnType<typeof userEvent.setup>
): Promise<HTMLElement> {
  await user.click(await screen.findByRole('button', { name: /^See all \(/ }));
  return screen.findByRole('dialog');
}

/** The Game Sessions card, scoped from its heading. */
/**
 * The Game Sessions section, resolved only once the history→filteredEvents mirror has
 * SETTLED. The page renders "Game Sessions (0 of 1)" for one commit before the mirror
 * effect lands (page.js: the count is `filtered.length === history.length ? N : "X of N"`);
 * a helper that resolved on ANY "Game Sessions (" heading handed callers a section with
 * no rows yet, and every synchronous row query after it was a lottery on a slow CI
 * runner — the 88-33-vintage race behind the "0 of 1" flake (240a463, 2bbe1ea, and two
 * CI-only failures on FE PR #28, 2026-09-02, on two different tests in the same file).
 * With no filter active the settled heading is the plain "(N)" form, so waiting for
 * exactly that form waits for the rows. Every caller here scopes right after render
 * with no filter applied; a test that asserts a filtered "(X of N)" heading queries it
 * directly (see the "(1 of 2)" assertion) and must not use this helper.
 */
export async function sessionsSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /^Game Sessions \(\d+\)$/ });
  return heading.closest('div')?.parentElement as HTMLElement;
}

/** The Game Sessions header row (title + filter toggle), scoped from the heading. */
export async function sessionsHeader(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /^Game Sessions \(/ });
  return heading.parentElement as HTMLElement;
}

/** The Reviews card, scoped from its heading. */
export async function reviewsSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /^Reviews \(/ });
  return heading.closest('div')?.parentElement as HTMLElement;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = undefined;
  h.search = '';
  h.userSub = 'auth0|self-sub';
  // 88.6.1-25: the session settles by default, the two shared spies forget any queued
  // behaviour, and the sign-in latch never leaks between cases (jsdom sessionStorage is real).
  h.authLoading = false;
  h.push.mockReset();
  h.selfRefetch.mockReset();
  rsvpProps.current = null;
  bringSummaryProps.current = null;
  bringPickerProps.current = null;
  h.createEventProps.length = 0;
  h.createEventMounts = 0;
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe('gameDetail render harness', () => {
  it('renders the game and its sessions card', async () => {
    renderGameDetail();
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(
      await screen.findByRole('heading', { name: 'Game Sessions (1)' })
    ).toBeInTheDocument();
  });

  it('renders a session row for each session of this game', async () => {
    renderGameDetail();
    const sessions = await sessionsSection();
    expect(within(sessions).getByText('Close finish on the last round')).toBeInTheDocument();
  });

  it('counts only sessions of THIS game in the header, excluding other games', async () => {
    // The page filters the group's events down to THIS game — the total is the
    // this-game set, not the raw group feed.
    renderGameDetail({
      events: [SESSION, { ...SESSION, id: 'evt-2', game_id: 'OTHER_GAME' }],
    });
    expect(
      await screen.findByRole('heading', { name: 'Game Sessions (1)' })
    ).toBeInTheDocument();
  });
});

// X50 (88.9-65, owner 2026-11-13): a score prints without the zeros nobody typed. The backend
// returns a stored score as two-decimal text; the session chip shows 57 and 57.5, and a
// participant with no score shows no Score piece at all (an absent score printed a bare label).
describe('gameDetail session chip score (X50, 88.9-65)', () => {
  it('X50 (88.9-65): the session chip prints Score: 57 for 57.00, Score: 57.5 for 57.50, nothing for a null score', async () => {
    renderGameDetail({
      events: [
        {
          ...SESSION,
          EventParticipations: [
            { user_id: 'p-a', username: 'Ann', score: '57.00', placement: 1 },
            { user_id: 'p-b', username: 'Bea', score: '57.50' },
            { user_id: 'p-c', username: 'Cy', score: null },
            { user_id: 'p-d', username: 'Dee' },
          ],
        },
      ],
    });
    const sessions = await sessionsSection();
    expect(await within(sessions).findByText('Score: 57')).toBeInTheDocument();
    expect(within(sessions).getByText('Score: 57.5')).toBeInTheDocument();
    expect(within(sessions).queryByText(/57\.00|57\.50/)).toBeNull();
    // Four participants, two scores: the null and the absent score print no Score piece.
    expect(within(sessions).getByText('Dee')).toBeInTheDocument();
    expect(within(sessions).getAllByText(/^Score:/)).toHaveLength(2);
  });
});

// D-39 / F-6b. The "of" is the ONLY signal that a filter is hiding sessions, so
// the two states are pinned separately: its absence at rest is as load-bearing as
// its presence while filtering.
// ---------------------------------------------------------------------------
// 88-33 Task 7 step 1b/1c — the fork G Upcoming/history split (owner-ruled
// 2026-08-20): future events render in a dedicated "Upcoming" section ABOVE
// Game Sessions with their RSVP/Ballot/Bring surfaces intact; Game Sessions
// renders ONLY the history partition, as pure session records.
// ---------------------------------------------------------------------------
/*
 * DECISION Phase 88.6-41 (W64) — the ONE anchor this partition is measured
 * against, both sides of the comparison.
 *
 * WHAT WAS WRONG. `FUTURE_SESSION.start_date` was
 * `new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString()` under the comment
 * "Always in the future relative to the test run" — a fixture derived from the WALL
 * CLOCK at module-evaluation time. That is the full-run-only, near-midnight failure
 * signature W64 recorded: the module evaluates at one instant, the component computes
 * the Upcoming-vs-history partition at another, and in a long full run those two can
 * straddle a local-midnight boundary.
 *
 * WHY OBSERVATIONAL CLOSURE WAS REFUSED. "The full run passed" passes on essentially
 * every non-midnight run, so it would have recorded W64 closed with the gate green and
 * nothing actually verified. The cause was located, so the fix is the only path.
 *
 * BOTH HALVES ARE REQUIRED, and this is a requirement rather than a preference.
 *   (1) the FIXTURE derives from `TEST_NOW`, never from `Date.now()`/`new Date()`;
 *   (2) the CLOCK the partition is computed against is pinned to the SAME `TEST_NOW`
 *       for this describe.
 * A bare future-dated constant read against the live wall clock is NOT a fix — it
 * converts a once-a-day flake into a one-time cliff on a fixed calendar date, which is
 * strictly worse because nothing will be looking when it arrives. Both sides of the
 * comparison have to move together.
 *
 * SCOPE IS LOAD-BEARING. The clock control lives in THIS describe's own
 * `beforeEach`/`afterEach` and is never file-level. A file-level `useFakeTimers` in a
 * global `beforeEach` would collide with the deliberately-scoped
 * `vi.useFakeTimers({ shouldAdvanceTime: true })` in the two-tap describe below and its
 * recorded reason (RTL's `waitFor` sniffs for JEST fake timers, does not recognise
 * vitest's, and every `findBy*` in this file then hangs for 5s). `shouldAdvanceTime` is
 * carried here for exactly that reason, and the two blocks stay separate.
 *
 * WHY THIS DATE. It is AFTER `SESSION`'s fixed `2026-01-15T18:00:00Z`, so the history
 * event stays history; `TEST_NOW + 3d` is the upcoming one. Both fixtures are now fixed
 * points, so the partition is arithmetic rather than a race with the calendar.
 *
 * HAND-OFF, plan 45 (wave 10, this same file, adds composed axe audits): do NOT
 * re-introduce a `Date.now()`-derived fixture here, and confirm this anchoring survives
 * the audit addition — lengthening this file's runtime is precisely what moved it
 * across the boundary in the first place.
 */
const TEST_NOW = new Date('2026-06-15T12:00:00Z');

const FUTURE_SESSION = {
  id: 'evt-future',
  game_id: GAME_ID,
  group_id: GROUP_ID,
  // Three days after TEST_NOW — a FIXED point, not "three days from whenever this
  // module happened to evaluate". See the W64 marker above.
  start_date: new Date(TEST_NOW.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  duration_minutes: 120,
  comments: 'The upcoming night',
  EventParticipations: [],
};

describe('gameDetail Upcoming/history split (fork G, 88-33 Task 7)', () => {
  // W64, the COMPARISON half. The component computes this partition against the LIVE
  // clock, so pinning only the fixture would relocate the cliff rather than remove it.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TEST_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders a future event in the Upcoming section WITH its RSVP surface, never in Game Sessions', async () => {
    renderGameDetail({ events: [SESSION, FUTURE_SESSION] });

    const upcomingHeading = await screen.findByRole('heading', { name: 'Upcoming (1)' });
    // History count excludes the future event. findByRole, NOT getByRole: the
    // page mirrors historyEvents into filteredEvents via an effect, so one
    // commit renders "Game Sessions (0 of 1)" before the mirror lands, and a
    // slow runner can catch that frame (FE PR #26 quality flake, 2026-08-31).
    // The settled count is still asserted exactly — nothing is widened.
    expect(
      await screen.findByRole('heading', { name: 'Game Sessions (1)' })
    ).toBeInTheDocument();

    // The future event's card lives inside the Upcoming card, with the
    // interactive surfaces mounted.
    const upcomingCard = upcomingHeading.closest('.card')!;
    expect(within(upcomingCard as HTMLElement).getByText('The upcoming night')).toBeInTheDocument();
    expect(within(upcomingCard as HTMLElement).getByTestId('rsvp-section')).toBeInTheDocument();
    expect(within(upcomingCard as HTMLElement).getByTestId('ballot-section')).toBeInTheDocument();
    expect(within(upcomingCard as HTMLElement).getByTestId('bring-summary')).toBeInTheDocument();

    // ...and the Game Sessions card does NOT contain it.
    const sessionsCard = screen
      .getByRole('heading', { name: 'Game Sessions (1)' })
      .closest('.card')!;
    expect(within(sessionsCard as HTMLElement).queryByText('The upcoming night')).toBeNull();
  });

  it('renders a past event as a pure session record — no RSVP/ballot/bring UI, no Upcoming section', async () => {
    renderGameDetail({ events: [SESSION] });

    await screen.findByRole('heading', { name: 'Game Sessions (1)' });
    expect(screen.getByText(SESSION.comments)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Upcoming/ })).toBeNull();
    // Step 1c: history cards mount none of the three interactive surfaces.
    expect(screen.queryByTestId('rsvp-section')).toBeNull();
    expect(screen.queryByTestId('ballot-section')).toBeNull();
    expect(screen.queryByTestId('bring-summary')).toBeNull();
  });

  it('fires the per-event RSVP-status fetch for UPCOMING events only (the N+1 kill, step 1c)', async () => {
    renderGameDetail({ events: [SESSION, { ...SESSION, id: 'evt-old-2' }, FUTURE_SESSION] });

    await screen.findByRole('heading', { name: 'Upcoming (1)' });
    await waitFor(() => expect(rsvpAPI.getEventRsvps).toHaveBeenCalled());
    expect(rsvpAPI.getEventRsvps).toHaveBeenCalledTimes(1);
    expect(rsvpAPI.getEventRsvps).toHaveBeenCalledWith('evt-future');
  });

  it('a group with ONLY a future event gets the ruled D2 empty copy, never the filters copy', async () => {
    renderGameDetail({ events: [FUTURE_SESSION] });

    const empty = await screen.findByText(
      "No game sessions yet — they'll show up here after your group plays this game."
    );
    // D2 mini-formula classes.
    expect(empty.className).toContain('text-content-muted');
    expect(empty.className).toContain('text-sm');
    expect(screen.queryByText('No sessions match your filters.')).toBeNull();
  });

  it('reviews empty rider converges onto the mini-formula', async () => {
    renderGameDetail({ events: [SESSION], reviews: [] });
    const empty = await screen.findByText('No reviews yet. Be the first to review this game.');
    expect(empty.className).toContain('text-content-muted');
    expect(empty.className).toContain('text-sm');
  });
});

describe('gameDetail sessions header (D-39)', () => {
  it('renders a bare count when no filter is hiding anything', async () => {
    renderGameDetail({ events: [SESSION, { ...SESSION, id: 'evt-2' }] });
    expect(
      await screen.findByRole('heading', { name: 'Game Sessions (2)' })
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /Game Sessions \(\d+ of/ })).toBeNull();
  });

  it('renders "N of M" once a filter actually hides sessions', async () => {
    const user = userEvent.setup();
    renderGameDetail({
      events: [SESSION, { ...SESSION, id: 'evt-2', duration_minutes: 30 }],
    });
    await screen.findByRole('heading', { name: 'Game Sessions (2)' });

    await user.click(screen.getByRole('button', { name: /Show Filters/ }));
    // Plan 88-20 label-associated every session filter (DEF-88-10-01), so this
    // now reaches the control the way a screen-reader user does. It previously
    // had to walk the label's wrapper because nothing named the control.
    await user.type(screen.getByLabelText('Min Duration (min)'), '60');

    expect(
      await screen.findByRole('heading', { name: 'Game Sessions (1 of 2)' })
    ).toBeInTheDocument();
  });

  it('stacks the header and floors the filter toggle at phone width', async () => {
    renderGameDetail();
    const header = await sessionsHeader();
    expect(header.className).toContain('flex-col');
    expect(header.className).toContain('sm:flex-row');

    const filterToggle = within(header).getByRole('button', { name: /Show Filters/ });
    expect(filterToggle.className).toContain('min-h-11');
    expect(filterToggle.className).toContain('w-full');
    expect(filterToggle.className).toContain('sm:w-auto');
  });

  // 88.6.1-47 (D-21 / D-44, AC-19): the toggle is a DISCLOSURE — aria-expanded, and an
  // aria-controls present only while the panel is mounted (the KM-2 pair, KebabMenu's house
  // form). The arrow glyphs are hidden, so the name is exactly the words. No aria-pressed.
  it('F1: Show Filters & Sort is a disclosure whose name is the words and whose aria-controls exists only while open', async () => {
    const user = userEvent.setup();
    renderGameDetail();
    const header = await sessionsHeader();
    const toggle = within(header).getByRole('button', { name: 'Show Filters & Sort' });

    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(within(toggle).getByText('▼')).toHaveAttribute('aria-hidden', 'true');

    await user.click(toggle);
    const open = within(header).getByRole('button', { name: 'Hide Filters' });
    expect(open).toBe(toggle);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).not.toHaveAttribute('aria-pressed');
    expect(within(open).getByText('▲')).toHaveAttribute('aria-hidden', 'true');
    const panelId = open.getAttribute('aria-controls');
    expect(panelId).toBeTruthy();
    const panel = document.getElementById(panelId as string);
    expect(panel).not.toBeNull();
    expect(
      (panel as HTMLElement).contains(screen.getByRole('heading', { name: 'Filter & Sort Sessions' }))
    ).toBe(true);

    await user.click(open);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(toggle).not.toHaveAttribute('aria-pressed');
    expect(toggle).toHaveAccessibleName('Show Filters & Sort');
  });

  // 88.9-36 G2a (owner pick G2a, 88.9-PICKS-B6.json item G2, register W54): while the panel is
  // open the toggle carries btn-fuse-bottom (square bottom corners below 640px, globals.css), the
  // header row drops its bottom margin below 640px, and the panel drops its top edge and top radius
  // below 640px — the toggle reads as the panel's header. Closed, nothing changes. jsdom applies
  // no media query, so this pins the classes; the computed shape is the G2a e2e.
  it('G2a (88.9): toggle and panel fuse, panel id kept', async () => {
    const user = userEvent.setup();
    renderGameDetail();
    const header = await sessionsHeader();
    const toggle = within(header).getByRole('button', { name: 'Show Filters & Sort' });

    expect(toggle.classList.contains('btn-fuse-bottom')).toBe(false);
    // 88.9-52 (W33): beside the w-full heading the auto-width toggle was squeezed until its label
    // broke in two at 1280; from 640 it keeps its own width and its words on one line.
    for (const cls of ['sm:shrink-0', 'sm:whitespace-nowrap']) {
      expect(toggle.classList.contains(cls), `the closed toggle carries ${cls}`).toBe(true);
    }
    expect(header.classList.contains('mb-4')).toBe(true);
    expect(header.classList.contains('mb-0')).toBe(false);

    await user.click(toggle);
    const open = within(header).getByRole('button', { name: 'Hide Filters' });
    expect(open).toBe(toggle);
    expect(open.classList.contains('btn-fuse-bottom')).toBe(true);
    expect(header.classList.contains('mb-0')).toBe(true);
    expect(header.classList.contains('sm:mb-4')).toBe(true);
    expect(open).toHaveAttribute('aria-expanded', 'true');
    expect(open).toHaveAttribute('aria-controls', 'game-sessions-filters');
    const panel = document.getElementById('game-sessions-filters') as HTMLElement;
    expect(panel).not.toBeNull();
    for (const cls of [
      'rounded-t-none',
      'border-t-0',
      'rounded-b-lg',
      'sm:rounded-t-lg',
      'sm:border-t',
      'border',
      'border-line',
      'bg-surface-page',
      'p-4',
      'mb-6',
    ]) {
      expect(panel.classList.contains(cls), `panel class ${cls}`).toBe(true);
    }
    expect(panel.classList.contains('rounded-lg')).toBe(false);

    await user.click(open);
    expect(toggle.classList.contains('btn-fuse-bottom')).toBe(false);
    expect(header.classList.contains('mb-4')).toBe(true);
    expect(header.classList.contains('mb-0')).toBe(false);
  });
});

// D-40 / F-6c / F-6d. jsdom applies no media queries, so BOTH breakpoint
// renderings are in the DOM at once here: the `md:hidden` kebab trigger and the
// `hidden md:flex` ghost pair. That is what makes the negative pin meaningful —
// it proves the role gate covers both layouts, not just the one a desktop
// walkthrough would look at.
describe('gameDetail role-gated session affordances', () => {
  // X49 (88.9-65, owner 2026-11-13): the phone kebab paints Delete in the danger ink; the desktop
  // button now does too, at ghost WEIGHT (no fill, so F-6c's demotion holds). Edit is unchanged.
  it('X49 (88.9-65): the desktop session Delete wears ghostDanger, Edit stays ghost', async () => {
    renderGameDetail({ role: 'owner' });
    const sessions = await sessionsSection();
    const edit = await within(sessions).findByRole('button', { name: 'Edit' });
    const del = within(sessions).getByRole('button', { name: 'Delete' });
    const classes = (el: HTMLElement) => el.className.split(/\s+/);
    expect(classes(del)).toContain('text-content-status-error');
    expect(classes(del)).toContain('bg-transparent');
    expect(classes(del)).toContain('enabled-hover:bg-surface-ghost-hover');
    expect(classes(del)).not.toContain('text-content-secondary');
    expect(classes(del)).not.toContain('btn-danger');
    expect(classes(edit)).toContain('text-content-secondary');
    expect(classes(edit)).not.toContain('text-content-status-error');
  });

  it.each(['owner', 'admin'] as const)(
    'shows the per-session Edit and Delete affordances to a group %s, in both layouts',
    async (role) => {
      renderGameDetail({ role });
      const sessions = await sessionsSection();

      // Desktop layout: ghost-demoted, still visible. findByRole on the FIRST
      // row query: sessionsSection() resolves on the heading alone, and the
      // session rows land a tick later — under CI/full-suite load the sync
      // getByRole raced them ("No sessions match your filters." still in the
      // DOM; flaked 2026-08-21 on PR #23 and once locally). Once Edit exists
      // the row is committed, so the sibling queries stay sync.
      const desktopEdit = await within(sessions).findByRole('button', { name: 'Edit' });
      const desktopDelete = within(sessions).getByRole('button', { name: 'Delete' });
      expect(desktopEdit).toBeInTheDocument();
      expect(desktopDelete).toBeInTheDocument();
      const desktopCluster = desktopEdit.parentElement as HTMLElement;
      expect(desktopCluster.className).toContain('hidden');
      expect(desktopCluster.className).toContain('md:flex');
      // F-6c: no longer the solid primary/danger pair that outranked the content.
      expect(desktopEdit.className).not.toContain('btn-primary');
      expect(desktopDelete.className).not.toContain('btn-danger');

      // Phone layout: the kebab, so the row content reclaims the width (F-6d).
      const kebab = within(sessions).getByRole('button', { name: 'Session actions' });
      expect((kebab.closest('div')?.parentElement as HTMLElement).className).toContain(
        'md:hidden'
      );
    }
  );

  it('hides them from a plain member in BOTH layouts', async () => {
    renderGameDetail({ role: 'member' });
    // Absence assertions must run AFTER the row lands, or they pass vacuously on
    // the "(0 of 1)" frame where no row exists yet.
    const sessions = await sessionsSection();
    expect(within(sessions).queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument();
    expect(within(sessions).queryByRole('button', { name: 'Delete' })).not.toBeInTheDocument();
    // The phone affordance is gated by the same check — a kebab with no items
    // would still be a leak, so assert the trigger itself is absent.
    expect(
      within(sessions).queryByRole('button', { name: 'Session actions' })
    ).not.toBeInTheDocument();
  });
});

// D-09 dialog tier / Req 11 / T-88-11-02. The play record is shared data, so the
// gate must BLOCK: nothing is deleted until an explicit confirmation, and cancel
// aborts. These two pins are the mitigation the threat register names.
describe('gameDetail session-delete gate (D-40, dialog tier)', () => {
  // F9b (88.9-23): the dialog-tier confirm is gated for CONFIRM_DELAY_MS from open; the commits
  // below step past it. Describe-level and shouldAdvanceTime, per this file's fake-timer rule.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function openDeleteFromKebab(user: ReturnType<typeof userEvent.setup>) {
    // sessionsSection() now resolves only on the settled heading (rows present);
    // findByRole keeps the kebab query itself retrying too.
    const sessions = await sessionsSection();
    const trigger = await within(sessions).findByRole('button', { name: 'Session actions' });
    await user.click(trigger);
    // Plan 88.6-16 (D-12) dropped the ARIA menu pattern from KebabMenu: the items
    // are plain buttons inside the list the trigger names through `aria-controls`
    // while open. Same scoping as the old role query, no assertion changed.
    const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
    expect(list, 'the Session actions kebab names its open list through aria-controls').not.toBeNull();
    await user.click(within(list as HTMLElement).getByRole('button', { name: 'Delete' }));
    return screen.findByRole('dialog');
  }

  it('opens the blocking dialog from the kebab and deletes nothing yet', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });

    const dialog = await openDeleteFromKebab(user);
    expect(within(dialog).getByText('Delete this session?')).toBeInTheDocument();
    expect(
      within(dialog).getByText(
        'The play record, scores and who was there are deleted for everyone.'
      )
    ).toBeInTheDocument();
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();
  });

  it('aborts on cancel', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });

    const dialog = await openDeleteFromKebab(user);
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();
  });

  it('deletes only after the explicit confirmation, and for the armed session', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });

    const dialog = await openDeleteFromKebab(user);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);
    expect(eventsAPI.deleteEvent).toHaveBeenCalledWith(SESSION.id);
  });

  // R-C3a (88.9-56, owner ruling 2026-11-10, 'hear'): the Delete session confirm keeps its verb
  // beside the house spinner while the delete runs, heard as 'Delete, deleting'.
  it("R-C3a (88.9): the pending Delete session confirm keeps its verb with the spinner and is named 'Delete, deleting'", async () => {
    const visibleText = (el: HTMLElement): string | null => {
      const clone = el.cloneNode(true) as HTMLElement;
      clone.querySelectorAll('.sr-only').forEach((node) => node.remove());
      return clone.textContent;
    };
    const user = userEvent.setup();
    const write = deferred(eventsAPI.deleteEvent as Mock);
    renderGameDetail({ role: 'owner' });

    const sessions = await sessionsSection();
    await user.click(within(sessions).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    const pending = within(dialog).getByRole('button', { name: 'Delete, deleting' });
    expect(pending).toHaveTextContent('Delete');
    expect(visibleText(pending)).toBe('Delete');
    await waitFor(() => expect(pending.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));
    expect(pending).toHaveAttribute('aria-disabled', 'true');
    expect(pending).not.toHaveAttribute('disabled');
    await waitFor(() => expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1));
    fireEvent.click(pending);
    await act(async () => {});
    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);

    write.settle({});
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('routes the desktop ghost Delete through the same gate', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });

    const sessions = await sessionsSection();
    await user.click(within(sessions).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Delete this session?')).toBeInTheDocument();
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();
  });

  // 88.6.1-47 (H6 / D-04 / D-05, AC-14): the confirmed delete is followed by the dialog's own
  // restore to the opener, and only once the DEFERRED refetch removes the card does focus land on
  // the list heading — never <body>. Ordering backstop (host half): the first waitFor is the
  // restored opener, so a settle-time focus move would fail it.
  it('H6a: after a confirmed delete focus returns to the opener, then lands on Game Sessions (N) once the refetch removes the card', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });

    const sessions = await sessionsSection();
    const refetch = deferred(eventsAPI.getGroupEvents as Mock);
    const desktopDelete = within(sessions).getByRole('button', { name: 'Delete' });
    await user.click(desktopDelete);
    const dialog = await screen.findByRole('dialog');
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(eventsAPI.deleteEvent).toHaveBeenCalledWith(SESSION.id);
    await waitFor(() => expect(document.activeElement).toBe(desktopDelete));

    await act(async () => {
      refetch.settle([]);
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Game Sessions (0)' }))
    );
  });
});

// 88.6.1-47 (H6, AC-14 adjacency + empty): deleting an UPCOMING session lands focus on the
// heading of the list that held it — `Upcoming (N)` while that section survives, else
// `Game Sessions (N)` (the Upcoming section is omitted when empty, DECISION Phase 88-33 Task 7
// step 1b rider). Fixtures derive from FUTURE_SESSION, so this describe pins the clock in its
// OWN hooks (the W64 rule above TEST_NOW).
describe('gameDetail session delete — focus lands on the list heading (88.6.1-47, H6)', () => {
  const FUTURE_2 = {
    ...FUTURE_SESSION,
    id: 'evt-future-2',
    comments: 'The second upcoming night',
    start_date: new Date(TEST_NOW.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString(),
  };

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(TEST_NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  async function deleteFirstUpcomingThroughKebab(
    user: ReturnType<typeof userEvent.setup>,
    upcomingHeadingName: string
  ) {
    const heading = await screen.findByRole('heading', { name: upcomingHeadingName });
    const card = heading.closest('.card') as HTMLElement;
    const [trigger] = await within(card).findAllByRole('button', { name: 'Session actions' });
    await user.click(trigger);
    const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
    expect(list, 'the Session actions kebab names its open list through aria-controls').not.toBeNull();
    await user.click(within(list as HTMLElement).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog');
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    return trigger;
  }

  it('H6b: with another upcoming session left, focus lands on Upcoming (1)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner', events: [FUTURE_SESSION, FUTURE_2] });
    await screen.findByRole('heading', { name: 'Upcoming (2)' });
    const refetch = deferred(eventsAPI.getGroupEvents as Mock);

    const trigger = await deleteFirstUpcomingThroughKebab(user, 'Upcoming (2)');
    expect(eventsAPI.deleteEvent).toHaveBeenCalledWith(FUTURE_SESSION.id);
    // The dialog's own restore: back on the named kebab trigger first.
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await act(async () => {
      refetch.settle([FUTURE_2]);
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Upcoming (1)' }))
    );
  });

  it('H6c: deleting the LAST upcoming session unmounts that section, and focus lands on Game Sessions (1)', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner', events: [SESSION, FUTURE_SESSION] });
    await screen.findByRole('heading', { name: 'Upcoming (1)' });
    await screen.findByRole('heading', { name: 'Game Sessions (1)' });
    const refetch = deferred(eventsAPI.getGroupEvents as Mock);

    const trigger = await deleteFirstUpcomingThroughKebab(user, 'Upcoming (1)');
    expect(eventsAPI.deleteEvent).toHaveBeenCalledWith(FUTURE_SESSION.id);
    await waitFor(() => expect(document.activeElement).toBe(trigger));

    await act(async () => {
      refetch.settle([SESSION]);
    });
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Game Sessions (1)' }))
    );
    expect(screen.queryByRole('heading', { name: /^Upcoming/ })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 9 — gameDetail's two hand-rolled overlays adopt <Modal> (plan 88-20).
//
// These were the LAST two `.modal-overlay` surfaces in the repo. The pins go
// through ROLE and ACCESSIBLE NAME rather than class names on purpose: a class
// census proves the old shell is gone, it does not prove the new one announces
// itself. Both are asserted — the census half mirrors GroupSettings.test.tsx.
// ---------------------------------------------------------------------------

/** Six participants, so the strip's "See all (6)" affordance renders at all. */
const SIX_PARTICIPANTS = Array.from({ length: 6 }, (_, i) =>
  participantRow({ user_id: `p-${i}`, username: `Player ${i}` })
);

describe('gameDetail overlays are Modal-hosted (Req 9)', () => {
  it('renders the See-all participants list as a dialog named by its header', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    // aria-labelledby is wired from <Modal.Header>; querying BY NAME is what
    // proves the header actually labels the dialog rather than merely sitting
    // inside it, which is the whole point of the migration.
    expect(dialog).toBe(screen.getByRole('dialog', { name: 'Participants (6)' }));
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('A-39 (88.9-52): the bringing die is a labelled role img leaf in the See-all list too', async () => {
    // Review 88.9-52 A-39: a bare span with aria-label has no role, so the label is not reliably
    // spoken (iOS VoiceOver reads the glyph). The sixth participant is outside the five-chip strip,
    // so the only die on the page is the See-all row's.
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([{ User: { id: 'p-5' } }]);
    const dialog = await openParticipantsModal(user);
    await waitFor(() =>
      expect(within(dialog).getAllByRole('img', { name: 'Bringing a game' })).toHaveLength(1)
    );
    expect(screen.getAllByRole('img', { name: 'Bringing a game' })).toHaveLength(1);
  });

  it('W26 (88.9-52): before the night a person who has not replied shows No reply, on the chip and in See-all', async () => {
    pinClockBeforeTheNight();
    try {
      const user = userEvent.setup();
      renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
      await screen.findByText('Player 0');
      await waitFor(() => expect(screen.getAllByText('No reply')).toHaveLength(5));
      const dialog = await openParticipantsModal(user);
      expect(within(dialog).getAllByText('No reply')).toHaveLength(6);
    } finally {
      vi.useRealTimers();
    }
  });

  // 88.9-52 R4 D2 (owner 2026-11-18: wrap, no line limit, and the name keeps its room). The chip's
  // name was cut to one line. jsdom lays nothing out, so this holds the classes of the by-piece
  // form; the rendered widths are in e2e/gamedetail-refresh-failed.spec.ts ("R4 D2 (88.9-52)").
  it('R4 D2 (88.9-52): a Participants chip wraps by piece, its name is never cut and never squeezed under one word', async () => {
    pinClockBeforeTheNight();
    try {
      renderEventDetail({ role: 'owner', participants: [{ ...SIX_PARTICIPANTS[0], username: 'Weekend Warriors' }] });
      const name = await screen.findByText('Weekend Warriors');
      expect(name.className).not.toMatch(/(^|\s)(truncate|line-clamp-\S+|whitespace-nowrap|wrap-anywhere|min-w-0|overflow-hidden)(\s|$)/);
      expect(name).toHaveClass('wrap-break-word', 'max-w-full', 'font-semibold');
      // The bordered chip: its pieces drop to the next line before the name gives up a word.
      const chip = name.parentElement as HTMLElement;
      expect(chip).toHaveClass('inline-flex', 'flex-wrap', 'max-w-full');
      expect(chip.className).not.toMatch(/(^|\s)(min-w-0|overflow-hidden)(\s|$)/);
      await waitFor(() => expect(within(chip).getByText('No reply')).toBeInTheDocument());
      // The chip and its Invite button: the button drops under the chip.
      // AMENDED Phase 89.6-19 (O-9c): the pair is the house row (it wraps); the chip is its text with
      // a 0px basis, so Invite stays beside while the chip's longest piece fits beside it.
      const outer = chip.parentElement as HTMLElement;
      expect(outer).toHaveClass('bb-row', 'items-baseline', 'self-center', 'max-w-full');
      expect(chip).toHaveClass('bb-row-text', '[--bb-row-min:0px]');
    } finally {
      vi.useRealTimers();
    }
  });

  it('W26 (88.9-52): once the night has started nobody shows No reply; a reply that was given stays', async () => {
    // eventFixture's night began 2026-03-01; the page reads the live clock (hasStarted), and RSVP
    // closes at the start, so "No reply" on a started night describes nothing anyone can act on.
    const user = userEvent.setup();
    const participants = [
      participantRow(),
      ...SIX_PARTICIPANTS.slice(0, 5),
    ];
    renderEventDetail({ role: 'owner', participants });
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: OTHER_UUID }, status: 'yes' }] });
    await screen.findByText('Player 0');
    expect(await screen.findByText('Going')).toBeInTheDocument();
    expect(screen.queryAllByText('No reply')).toHaveLength(0);
    const dialog = await openParticipantsModal(user);
    expect(within(dialog).getByText('Going')).toBeInTheDocument();
    expect(within(dialog).queryAllByText('No reply')).toHaveLength(0);
  });

  it('R19 (88.9-52): in See-all the desktop Friend pill comes BEFORE the RSVP pill, and Friend is said once', async () => {
    // Owner 2026-11-17: friend should come first. ClickableMemberName is stubbed in this file, so the
    // only Friend here is the page's own desktop pill; the phone pill is the component's (pinned in
    // src/app/components/ClickableMemberName.indicator.test.tsx ("says Friend once, and has no tick")).
    const user = userEvent.setup();
    friendship.accepted.add(OTHER_UUID);
    renderEventDetail({ role: 'owner', participants: [participantRow(), ...SIX_PARTICIPANTS.slice(0, 5)] });
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: OTHER_UUID }, status: 'yes' }] });
    await screen.findByText('Player 0');
    const dialog = await openParticipantsModal(user);
    const going = await within(dialog).findByText('Going');
    const friends = within(dialog).getAllByText('Friend');
    expect(friends).toHaveLength(1);
    const friend = friends[0];
    expect(friend.parentElement).toBe(going.parentElement);
    expect(friend.compareDocumentPosition(going) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    for (const cls of ['hidden', 'md:inline-flex', 'bg-surface-pill-emerald', 'text-content-pill-emerald']) {
      expect(friend).toHaveClass(cls);
    }
  });

  // R4-A1 (88.9-52) drew a guest's name as plain text and showed the page's own Friend pill at every
  // width. AMENDED Phase 88.9-52 (R4 D3, owner 2026-11-18: same controls as elsewhere): every named
  // person with an account goes through the name control the session rows use, so a guest who is not
  // yet a friend gets the add-friend control here too, and a guest who is a friend gets the control's
  // own phone pill. The page's Friend pill is therefore the desktop twin on EVERY row. A typed-in name
  // (no account) and the viewer's own row stay plain text.
  // The marker is at src/app/gameDetail/page.js ("AMENDED Phase 88.9-52 (R4 D3, owner 2026-11-18): same controls as elsewhere").
  it('R4 D3 (88.9-52; R4-A1 superseded): in See-all every named person with an account goes through the name control, a typed-in name stays plain, and Friend is one pill per row', async () => {
    pinClockBeforeTheNight();
    try {
      const user = userEvent.setup();
      friendship.accepted.add('p-1');
      const participants = [
        ...SIX_PARTICIPANTS.map((p) => (p.user_id === 'p-1' || p.user_id === 'p-2' ? { ...p, is_guest: true } : p)),
        participantRow({ user_id: null, username: 'Typed Tom', is_custom: true }),
      ];
      renderEventDetail({ role: 'owner', participants });
      await screen.findByText('Player 0');
      const dialog = await openParticipantsModal(user);

      // A guest who is a friend: the name control is mounted for it, with the guest's own user id.
      const friendName = within(dialog).getByText('Player 1');
      expect(friendName).toHaveAttribute('data-member-name', 'p-1');
      const line = friendName.closest('div') as HTMLElement;
      // One page pill, the desktop twin (the phone's is the name control's own, 4px after the name).
      const friends = within(dialog).getAllByText('Friend');
      expect(friends).toHaveLength(1);
      const friend = friends[0];
      expect(line).toContainElement(friend);
      for (const cls of ['hidden', 'md:inline-flex', 'bg-surface-pill-emerald', 'text-content-pill-emerald']) {
        expect(friend).toHaveClass(cls);
      }
      // AMENDED Phase 89.6-30 (N04): the desktop twin is the Pill block with its display replaced, so
      // its class list holds no bare inline-flex (tailwind-merge dropped the block's own display for
      // the hidden passed after it): a phone never shows two Friends.
      expect(friend.className.split(/\s+/)).not.toContain('inline-flex');
      // R4 B5's 2px phone pull went with the page's phone pill.
      expect(friend.className.split(/\s+/).some((c) => c.includes('-ms-'))).toBe(false);
      // AMENDED Phase 89.6-30 (N04): it was Friend, then the RSVP pill, then Guest. Owner pick N04 = B
      // puts the reply tag LAST: Friend, then Guest, then the reply tag.
      const noReply = within(line).getByText('No reply');
      const guest = within(line).getByText('Guest');
      expect(friend.compareDocumentPosition(guest) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(guest.compareDocumentPosition(noReply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // A guest who is NOT a friend: the name control too (it is what draws the add-friend control), no pill.
      const strangerName = within(dialog).getByText('Player 2');
      expect(strangerName).toHaveAttribute('data-member-name', 'p-2');
      expect(within(strangerName.closest('div') as HTMLElement).queryByText('Friend')).toBeNull();

      // Every other account row goes through it as well, each with its own id.
      for (const n of [0, 3, 4, 5]) {
        expect(within(dialog).getByText(`Player ${n}`)).toHaveAttribute('data-member-name', `p-${n}`);
      }
      // A typed-in name has no account: plain text, no name control.
      const typed = within(dialog).getByText('Typed Tom', { exact: false });
      expect(typed.closest('[data-member-name]')).toBeNull();
      expect((typed.closest('div') as HTMLElement).querySelector('[data-member-name]')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // AMENDED Phase 89.6-30 (N04): the title said "with the You pill". Owner pick N04 = B writes the
  // viewer as (You) in plain grey words, so the title and the last assertion follow. The viewer's own
  // row is now IN the list (it was not: the read of You was guarded by an if and never ran).
  it('R4 D3 (88.9-52): the viewer\'s own See-all row stays plain text and reads (You) in plain words, and a roster friend keeps the desktop pill', async () => {
    pinClockBeforeTheNight();
    try {
      const user = userEvent.setup();
      friendship.accepted.add(OTHER_UUID);
      const participants = [participantRow(), participantRow({ user_id: SELF_UUID, username: 'Me' }), ...SIX_PARTICIPANTS.slice(0, 5)];
      renderEventDetail({ role: 'owner', participants });
      await screen.findByText('Player 0');
      const dialog = await openParticipantsModal(user);
      const pills = within(dialog).getAllByText('Friend');
      expect(pills).toHaveLength(1);
      expect(pills[0].className.split(/\s+/)).toEqual(expect.arrayContaining(['hidden', 'md:inline-flex']));
      // No row of the list draws a page pill at phone width any more.
      for (const pill of pills) expect(pill.className.split(/\s+/)).not.toContain('max-md:-ms-0.5');
      // AMENDED Phase 89.6-30 (N04): the viewer's row holds (You) in the muted ink, no name control,
      // and nothing in the dialog is the bare word You.
      const you = within(dialog).getByText('(You)');
      expect(you).toHaveClass('text-content-muted');
      expect((you.closest('div') as HTMLElement).querySelector('[data-member-name]')).toBeNull();
      expect(within(you.closest('div') as HTMLElement).getByText('Me')).toBeInTheDocument();
      expect(within(dialog).queryByText('You')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  // Owner pick N04 = B (2026-11-22): one tag block. jsdom lays nothing out, so this holds the classes and
  // the order; the rendered heights are read in the sweep,
  // e2e/support/largeTextSurfaces/night.ts ("export async function readTagLines").
  it('N04 B (89.6-30): in See-all every tag is one box at regular weight, the reply tag comes last, and the viewer reads (You) in plain words', async () => {
    pinClockBeforeTheNight();
    try {
      const user = userEvent.setup();
      const participants = [
        participantRow({ user_id: SELF_UUID, username: 'Me' }),
        participantRow({ user_id: 'guest-uuid', username: 'Visiting Pat', is_guest: true }),
        ...SIX_PARTICIPANTS.slice(0, 4),
      ];
      renderEventDetail({ role: 'owner', participants });
      await screen.findByText('Player 0');
      const dialog = await openParticipantsModal(user);

      // A guest row: Guest and the reply tag are the one box, and the reply tag is last.
      const guestLine = within(dialog).getByText('Visiting Pat').closest('div') as HTMLElement;
      const guest = within(guestLine).getByText('Guest');
      const noReply = within(guestLine).getByText('No reply');
      for (const tag of [guest, noReply]) {
        expect(tag).toHaveClass('inline-flex', 'align-middle', 'leading-4', 'whitespace-nowrap', 'text-xs', 'px-1.5', 'py-0.5', 'rounded-sm');
        expect(tag.className.split(/\s+/)).not.toContain('font-bold');
      }
      expect(guest.compareDocumentPosition(noReply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

      // The viewer's own row: plain grey words, no tag.
      const you = within(dialog).getByText('(You)');
      expect(you).toHaveClass('text-content-muted', 'font-normal');
      expect(you.className).not.toMatch(/(^|\s)(bg-\S+|px-\S+|py-\S+)(\s|$)/);
      expect(within(dialog).queryByText('You')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('closes the participants list on Esc', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    await openParticipantsModal(user);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('renders the review form as a dialog named by its header', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await user.click(await screen.findByRole('button', { name: 'Add Review' }));

    const dialog = await screen.findByRole('dialog', { name: 'Write a Review' });
    // The pre-migration close glyph had NO accessible name at all on this one —
    // a screen-reader user had no announced way out of a form.
    expect(within(dialog).getByRole('button', { name: 'Close' })).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Review')).toBeInTheDocument();
    expect(document.querySelector('.modal-overlay')).toBeNull();
  });

  it('closes the review form on Esc', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await user.click(await screen.findByRole('button', { name: 'Add Review' }));

    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('mounts neither dialog until it is opened', async () => {
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    await screen.findByRole('button', { name: /^See all \(/ });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

// EVT-08. The two-tap remove renders INSIDE the migrated See-all modal, so the
// migration could have broken it silently — Radix's focus trap re-parents the
// subtree, and the arm/revert is a timer on component state. Both halves of the
// gate are pinned: it must ARM without deleting, and it must REVERT on its own.
// 88-33 Task 5 (fork 7): the hand-rolled handler converged onto useConfirmAction.
// Contract shifts pinned here: the resting accessible name now NAMES THE TARGET
// ("Remove Player 0 from this event", was a bare 'Remove'); the armed copy is the
// fleet default (named 'Tap again to confirm', was the divergent click-again wording;
// since R13, 88.9-52, the words it SHOWS are the short 'Tap again', pinned below);
// the control meets the 44px floor. The 65-02 INTERACTION — inline second click,
// 3s revert, never a modal — is unchanged and re-pinned below.
const RESTING_REMOVE = /^Remove .+ from this event$/;
const ARMED_REMOVE = 'Tap again to confirm';
// F9b (88.9-23): the armed NAME while the gate runs (the label counts Wait 3, 2, 1, then
// Tap again, named ARMED_REMOVE). X69 (88.9-67): the resting name, then the wait.
const GATED_REMOVE = /^Remove .+ from this event, wait \d seconds?$/;

describe('gameDetail two-tap participant remove inside the Modal (Phase 65-02)', () => {
  // F9b (88.9-23): the second click is refused for CONFIRM_DELAY_MS after arming; the commits
  // below step past it. Describe-level and shouldAdvanceTime, per this file's fake-timer rule.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('arms on the first click and deletes nothing yet, announcing the target', async () => {
    const user = userEvent.setup();
    (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    const removes = within(dialog).getAllByRole('button', { name: RESTING_REMOVE });
    await user.click(removes[0]);

    // F9b: gated first (the countdown label), and the announcement lands at the live edge.
    expect(within(dialog).getByRole('button', { name: GATED_REMOVE })).toHaveTextContent('Wait (3)');
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(
      within(dialog).getByRole('button', { name: ARMED_REMOVE })
    ).toBeInTheDocument();
    expect(eventsAPI.removeParticipation).not.toHaveBeenCalled();
    // The statusNode announces the armed state — convergence without it would
    // silently delete the announcement (Task 5 step 3).
    const statuses = screen.getAllByRole('status');
    expect(
      statuses.some((s) => (s.textContent ?? '').includes('Press again to confirm: Remove Player 0'))
    ).toBe(true);
  });

  it('meets the 44px floor and destructive resting prominence', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    const resting = within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0];
    expect(resting.className).toContain('min-h-11');
    expect(resting.className).toContain('border-status-error');
  });

  it('removes the armed participant on the second click', async () => {
    const user = userEvent.setup();
    (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    await user.click(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0]);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await user.click(within(dialog).getByRole('button', { name: ARMED_REMOVE }));

    expect(eventsAPI.removeParticipation).toHaveBeenCalledTimes(1);
    expect(eventsAPI.removeParticipation).toHaveBeenCalledWith(EVENT_ID, 'p-0');
  });

  it('OW-2 (89.6-04): an armed Remove inside the dialog is still live after 60 s; a press elsewhere in the dialog disarms it, says Confirmation cancelled. and deletes nothing', async () => {
    // `shouldAdvanceTime` is load-bearing, not decoration: RTL's `waitFor`
    // sniffs for JEST fake timers, does not recognise vitest's, and then polls
    // with a `setInterval` that the fake clock has frozen — every `findBy*` in
    // this file hangs for 5s and the whole suite times out after it. Letting the
    // fake clock also track real time keeps `waitFor` alive while still allowing
    // the 3 s wait (and the minute after it) to be jumped rather than waited out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
      renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

      const dialog = await openParticipantsModal(user);
      await user.click(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0]);
      within(dialog).getByRole('button', { name: GATED_REMOVE });

      // OW-2 A: no window. The wait, then a minute, and the control is still live.
      await act(async () => {
        vi.advanceTimersByTime(CONFIRM_DELAY_MS + 60_000);
      });
      expect(within(dialog).getAllByRole('button', { name: ARMED_REMOVE })).toHaveLength(1);

      // A press elsewhere in the dialog is outside the control: the dialog CONTAINS the control, so
      // it is not a layer above it, and the press disarms.
      await user.click(within(dialog).getByRole('heading', { name: /^Participants \(/ }));

      expect(
        within(dialog).queryByRole('button', { name: ARMED_REMOVE })
      ).toBeNull();
      expect(within(dialog).queryByRole('button', { name: GATED_REMOVE })).toBeNull();
      // Every row is back at rest — none of the six is self, so all six are removable.
      expect(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })).toHaveLength(
        SIX_PARTICIPANTS.length
      );
      // The gate's own region, inside the dialog, says the disarm.
      const said = within(dialog)
        .getAllByRole('status')
        .filter((region) => region.textContent === 'Confirmation cancelled.');
      expect(said).toHaveLength(1);
      expect(eventsAPI.removeParticipation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Plan review scoped check S14. The gate's receipt state lives at page level, outside the dialog,
  // so a disarm that speaks while the dialog closes would come back in the reopened dialog's region.
  // The dialog's close cancels the gate silently instead (the close is the feedback).
  it('OW-2 (89.6-04): Escape on an armed Remove inside the Participants dialog closes the dialog and leaves the gate disarmed', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    await user.click(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0]);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(within(dialog).getByRole('button', { name: ARMED_REMOVE })).toHaveFocus();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Reopened at once, with no timer advanced: inside the 4 s receipt window.
    const reopened = await openParticipantsModal(user);
    expect(within(reopened).getAllByRole('button', { name: RESTING_REMOVE })).toHaveLength(
      SIX_PARTICIPANTS.length
    );
    expect(within(reopened).queryByRole('button', { name: ARMED_REMOVE })).toBeNull();
    expect(within(reopened).queryByRole('button', { name: GATED_REMOVE })).toBeNull();
    const regions = within(reopened).getAllByRole('status');
    expect(regions.length).toBeGreaterThan(0);
    expect(
      regions.map((region) => region.textContent),
      'no stale cancel words in the reopened dialog'
    ).not.toContain('Confirmation cancelled.');
    expect(eventsAPI.removeParticipation).not.toHaveBeenCalled();
  });

  // X36a (88.9-65, once-over R3): the commit is SEEN and HEARD. While the DELETE is out the pressed
  // Remove stays focusable (aria-disabled, never the native attribute), keeps its word, is named
  // with the removing suffix and shows the delayed house spinner; the gate's latch sends one DELETE
  // for two taps. When the row leaves, focus lands on the See-all dialog's title (owner 2026-11-14,
  // Q6 A), never on the dialog container or the body. The arm is read by aria-pressed, never by
  // the countdown words (another plan rewords them).
  it('X36a (88.9-65): a committing Participants Remove is aria-disabled, named with the removing suffix, shows the house spinner after 200 ms, two taps send one DELETE, and focus lands on the dialog title when the row leaves', async () => {
    const user = userEvent.setup();
    const del = deferred(eventsAPI.removeParticipation as Mock);
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    const remove = within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0];
    await user.click(remove);
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    // The committing tap, then one more while the DELETE is held.
    await user.click(remove);
    await user.click(remove);
    expect(eventsAPI.removeParticipation).toHaveBeenCalledTimes(1);
    expect(eventsAPI.removeParticipation).toHaveBeenCalledWith(EVENT_ID, 'p-0');

    expect(remove).toHaveAttribute('aria-disabled', 'true');
    expect(remove.hasAttribute('disabled')).toBe(false);
    expect(remove).toHaveAccessibleName('Remove Player 0 from this event, removing');
    expect(remove).toHaveTextContent(/^Remove/);
    // The house spinner is delayed: it is there once SPINNER_DELAY_MS has passed.
    act(() => {
      vi.advanceTimersByTime(SPINNER_DELAY_MS);
    });
    expect(remove.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1);

    // The DELETE resolves and the row leaves: focus goes to the dialog's title.
    const title = within(dialog).getByRole('heading', { name: /^Participants \(/ });
    await act(async () => {
      del.settle({});
    });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(within(dialog).queryByRole('button', { name: /^Remove Player 0 / })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Req 15 — the guest-invite dead end, closed from the event view (plan 88-20).
//
// The affordance already existed, but only in the per-session results list on
// the OTHER view: an owner looking at tonight's event could see "Guest" on a
// participant and had no way to act on it without navigating into history.
//
// Two negative pins carry as much weight as the positive one. A custom guest
// (`user_id: null`) is a name someone typed in, not an account — an invite
// against it would be dispatched at a non-existent user (T-88-20-02). And a
// plain member must see nothing (T-88-20-01).
// ---------------------------------------------------------------------------

// AMENDED Phase 88.9-65 (X63): the visible word is Invite and the NAME carries the person, from an
// sr-only span inside the button; every guest in these describes is Visiting Pat. The error arm
// keeps the visible word Retry and is named for the person too (owner 2026-11-14, Q7 B).
const INVITE = 'Invite Visiting Pat to the group';
const RETRY_INVITE = 'Retry inviting Visiting Pat to the group';

describe('gameDetail guest invite from the event view (Req 15)', () => {
  const GUEST_WITH_ACCOUNT = participantRow({
    user_id: 'guest-uuid',
    username: 'Visiting Pat',
    is_guest: true,
  });
  const CUSTOM_GUEST = participantRow({
    user_id: null,
    username: 'Whoever Sam Brought',
    is_guest: true,
    is_custom: true,
  });

  it.each(['owner', 'admin'] as const)(
    'offers the invite to a group %s, on the participant strip',
    async (role) => {
      renderEventDetail({ role, participants: [GUEST_WITH_ACCOUNT] });
      expect(await screen.findByRole('button', { name: INVITE })).toBeInTheDocument();
    }
  );

  it('also offers it inside the See-all modal, for guests past the strip cutoff', async () => {
    const user = userEvent.setup();
    // The strip renders only the first five; the sixth is reachable ONLY through
    // the modal, which is why both surfaces carry the affordance.
    renderEventDetail({
      role: 'owner',
      participants: [...SIX_PARTICIPANTS, GUEST_WITH_ACCOUNT],
    });
    const dialog = await openParticipantsModal(user);
    expect(within(dialog).getByRole('button', { name: INVITE })).toBeInTheDocument();
  });

  it('renders NO affordance for a custom guest — there is no account to invite', async () => {
    renderEventDetail({ role: 'owner', participants: [CUSTOM_GUEST] });
    // Wait for the strip itself, so the absence is a real absence and not a race.
    await screen.findByRole('heading', { name: 'Participants (1)' });
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
  });

  it('renders no affordance for a non-guest participant', async () => {
    renderEventDetail({ role: 'owner', participants: [participantRow()] });
    await screen.findByRole('heading', { name: 'Participants (1)' });
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
  });

  it('withholds it from a plain member', async () => {
    renderEventDetail({ role: 'member', participants: [GUEST_WITH_ACCOUNT] });
    await screen.findByRole('heading', { name: 'Participants (1)' });
    expect(screen.queryByRole('button', { name: INVITE })).toBeNull();
  });

  it('sends through the shipped participant-invite call path, by user_id', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    // The email is resolved server-side (83-06 PII default-deny), so the client
    // must send the UUID and nothing else.
    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledWith(GROUP_ID, 'guest-uuid');
    // 88.6-18 (D8 arm B, owner 2026-09-09): the four SETTLED outcomes render a
    // non-interactive status chip, not a button — so these are text queries. The
    // `Retry` queries below stay role-based, because `error` is still a Button.
    expect(await screen.findByText('Invite sent!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite sent!' })).toBeNull();
  });

  it('falls back to the shipped 409 -> "Already invited" copy for an UNCODED conflict', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue({ status: 409 });
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    // 409 is "already a member or already invited" — not a failure to retry.
    expect(await screen.findByText('Already invited')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Already invited' })).toBeNull();
    expect(screen.queryByRole('button', { name: RETRY_INVITE })).toBeNull();
  });

  // 88-33 Task 2 step 4b (UAT row 614, Fork F): the two 409 outcomes are told
  // apart. Both the ENVELOPE-CODE path (once 88-34 ships the ERROR_REGISTRY
  // entries) and the STRING path (production, until that merges) are pinned —
  // dropping the string branch early silently reverts the surface.
  it('renders "Invite pending" for the invite_pending envelope code', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue(
      new ApiError('This person already has a pending invite', 'invite_pending', 409)
    );
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    expect(await screen.findByText('Invite pending')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Invite pending' })).toBeNull();
    expect(screen.queryByRole('button', { name: RETRY_INVITE })).toBeNull();
  });

  it('renders "Already a member" for the already_member envelope code', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue(
      new ApiError('This person is already a member of the group', 'already_member', 409)
    );
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    expect(await screen.findByText('Already a member')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Already a member' })).toBeNull();
  });

  // The "CODE-LESS 409 (production, pre-88-34)" test that lived here was
  // deleted 2026-08-21 with the prose fallback it pinned: once the 88-34
  // backend deploy was confirmed live, that wire shape stopped existing
  // (owner-ruled removal condition — see the amended DECISION in page.js's
  // GuestInviteButton). The bare-409 safety net stays pinned by the
  // "UNCODED conflict" test above.

  // Phase 89.6-19 (register R5-01b, pick O-9c = B): the typed-in guest's tag was glued to the name
  // (Warriors(Guest), one unbreakable word), and the strip chip is the house row's text.
  it('89.6-19 (participants): a typed-in guest reads <name> (Guest) as two words on the strip chip and the See-all row, and the chip row is the house row', async () => {
    const user = userEvent.setup();
    const typedIn = participantRow({ user_id: null, username: 'Weekend Warriors', is_guest: true, is_custom: true });
    renderEventDetail({ role: 'owner', participants: [typedIn, ...SIX_PARTICIPANTS.slice(0, 5)] });
    await screen.findByRole('heading', { name: 'Participants (6)' });
    const stripName = Array.from(document.querySelectorAll('span.font-semibold.wrap-break-word')).find((node) =>
      (node.textContent ?? '').startsWith('Weekend Warriors')
    );
    expect(stripName, 'the strip chip of the typed-in guest never rendered').toBeDefined();
    expect(stripName?.textContent).toBe('Weekend Warriors (Guest)');
    const chip = stripName?.parentElement;
    expect(chip).toHaveClass('bb-row-text');
    expect(chip?.parentElement).toHaveClass('bb-row');
    const dialog = await openParticipantsModal(user);
    const rowName = Array.from(dialog.querySelectorAll('span.font-semibold')).find((node) =>
      (node.textContent ?? '').startsWith('Weekend Warriors')
    );
    expect(rowName?.textContent).toBe('Weekend Warriors (Guest)');
  });
});

// ---------------------------------------------------------------------------
// Plan 88.6-18 — the GuestInvite control after the D8 arm-B ruling and its
// 2026-09-14 `sending` amendment.
//
// jsdom performs NO layout and loads NO stylesheet, so nothing below rests on
// `getComputedStyle` of a stylesheet-driven property. The `.btn:disabled` wash
// whose loss V-17 discloses is a BROWSER-only measurement and is deliberately
// not asserted here (review D28). What jsdom can prove is asserted: attributes,
// class lists, roles, `document.activeElement` and call counts.
// ---------------------------------------------------------------------------

describe('gameDetail GuestInvite in-flight gate (88.6-18, D8 amendment + T-88.6-50)', () => {
  // AMENDED Phase 88.9-65 (X42): D6-5 and rule 1 read Share Game QR, so they pin the clock before
  // the night (pinClockBeforeTheNight); this restores real timers after every test.
  afterEach(() => {
    vi.useRealTimers();
  });

  const GUEST = participantRow({
    user_id: 'guest-uuid',
    username: 'Visiting Pat',
    is_guest: true,
  });

  /** An invite mock that stays IN FLIGHT until the returned `settle` is called. */
  function deferredInvite() {
    let settle: (value?: unknown) => void = () => {};
    let fail: (reason?: unknown) => void = () => {};
    (invitesAPI.sendParticipantInvite as Mock).mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          settle = resolve;
          fail = reject;
        })
    );
    return {
      settle: (v?: unknown) => settle(v),
      fail: (r?: unknown) => fail(r),
    };
  }

  // Phase 89.6-19 (register B3-04, S-3): VoiceOver read the button's title as a second line after its name.
  it('S-3 (89.6-19): Invite and Retry are heard once — no title, no accessible description', async () => {
    const first = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });
    expect(invite).not.toHaveAttribute('title');
    expect(invite).not.toHaveAccessibleDescription();
    await act(async () => {
      invite.click();
    });
    await act(async () => {
      first.fail(new Error('network'));
    });
    const retry = await screen.findByRole('button', { name: RETRY_INVITE });
    expect(retry).not.toHaveAttribute('title');
    expect(retry).not.toHaveAccessibleDescription();
  });

  it('sends ONCE for two activations dispatched with NO render flush between them', async () => {
    deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    // THE NO-FLUSH SHAPE IS LOAD-BEARING. Both activations are dispatched inside
    // ONE `act()`, so React has not re-rendered between them and the previous
    // render's closure still reads `status === null`. After a flush the state
    // term alone satisfies this assertion and it passes with no latch in the
    // code — which is the vacuity this shape exists to avoid. Under the
    // 2026-09-14 amendment the latch is the ONLY thing refusing the second
    // press: an `aria-disabled` control still fires its handler.
    await act(async () => {
      invite.click();
      invite.click();
    });

    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledTimes(1);
  });

  it('exposes aria-disabled and NO native disabled attribute while sending', async () => {
    deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await act(async () => {
      invite.click();
    });

    const sending = screen.getByRole('button', { name: INVITE + ', sending' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    expect(sending.hasAttribute('disabled')).toBe(false);
    // The visible in-flight cue that replaces the `.btn:disabled` wash (V-17): since rule 1
    // (88.9-46 B26) the kept label plus the house spinner, never a label swap.
    expect(sending).toHaveTextContent(/^Invite/);
    // No `disabled:opacity-*` utility was added at the call site — it keys on
    // the native attribute this control no longer carries.
    expect(sending.className).not.toMatch(/(^|[\s:])disabled:opacity-/);
  });

  it('keeps focus ON the control while sending, and lands it on the settled chip once (D-06)', async () => {
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await user.click(invite);
    // The whole point of the 2026-09-14 amendment: a natively-disabled element
    // leaves the focus order and focus drops to <body> mid-submit.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: INVITE + ', sending' }));

    await act(async () => {
      invite$.settle({});
    });
    const chip = await screen.findByText('Invite sent!');
    // D-06 (owner 2026-10-04, 88.6.1-47): the chip takes focus ONCE, through the shared
    // useFocusRecovery hook armed at the press. Before this, the button was replaced by a
    // non-focusable chip and the user landed on <body> (this test pinned that landing; it is
    // flipped in place). A named target, never "not body" (C-5).
    await waitFor(() => expect(document.activeElement).toBe(chip));
  });

  it('re-enables and re-sends after a failure — the latch clears in the error branch only', async () => {
    const first = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await act(async () => {
      invite.click();
    });
    await act(async () => {
      first.fail(new Error('network'));
    });

    const retry = await screen.findByRole('button', { name: RETRY_INVITE });
    expect(retry.hasAttribute('disabled')).toBe(false);
    expect(retry).not.toHaveAttribute('aria-disabled');

    (invitesAPI.sendParticipantInvite as Mock).mockResolvedValue({});
    await act(async () => {
      retry.click();
    });
    // TWICE, not once: a latch that never released would make the retry dead.
    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledTimes(2);
  });

  it('renders each settled outcome as a non-interactive chip carrying its fuller explanation', async () => {
    (invitesAPI.sendParticipantInvite as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await act(async () => {
      invite.click();
    });

    const chip = await screen.findByText('Invite sent!');
    expect(chip.tagName).toBe('SPAN');
    expect(chip).not.toHaveAttribute('role');
    expect(chip).not.toHaveAttribute('aria-live');
    // D-06 (88.6.1-47): programmatically focusable, still OUT of the Tab order.
    expect(chip).toHaveAttribute('tabindex', '-1');
    // The branch `title` is the only fuller explanation each settled state has.
    expect(chip).toHaveAttribute('title', 'Invite sent!');
    // Geometry survives: on a <span> nothing supplies what `.btn` supplied.
    expect(chip.className).toContain('min-h-11');
    expect(chip.className).toContain('rounded-sm');
    expect(chip.className).toContain('border');
    // The shipped colour pair is preserved verbatim, which is why the SETTLED
    // states take no UI-SPEC §1.2 V-row.
    expect(chip.className).toContain('bg-status-success-subtle');
    expect(chip.className).toContain('text-content-status-success');
    // EXACTLY ONE live region in the settled subtree: the always-mounted sr-only
    // StatusRegion. `88.6-UI-SPEC.md:571-573`.
    //
    // SCOPE CORRECTED by plan 88.6-36 task 3 (2026-09-16): this queried `document`, i.e. the
    // WHOLE PAGE, while its own comment says "in the settled subtree" — the two disagreed and
    // nothing surfaced it until a second legitimate region appeared elsewhere on the page.
    // `FetchErrorBanner`'s compact branch is now EMPTY-FIRST, so its `sr-only` polite region is
    // mounted on this page unconditionally (gameDetail is one of the six call sites that fix
    // closes), and a page-wide count of 1 became a count of 2. The ASSERTION'S INTENT is
    // unchanged and is now actually enforced where it claims to be: the GuestInvite region is
    // this chip's own sibling (`gameDetail/page.js:295-308`, GuestInviteButton's `if (settled) {`, returns the two inside one
    // fragment), so scoping to the chip's parent is the subtree the comment always meant. A
    // page-wide count here would also have gone red for any unrelated surface adding a region,
    // which is the wrong gate to hand the next executor.
    const regions = chip.parentElement!.querySelectorAll('[aria-live]');
    expect(regions).toHaveLength(1);
    expect(regions[0].className).toContain('sr-only');
  });

  it('puts the live invite states on the `sm` Button rung with the W19 border intact', async () => {
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    expect(invite.className).toContain('btn');
    expect(invite.className).toContain('btn-sm');
    // The border survives migration ONLY because plan 05 layered `.btn`'s reset.
    expect(invite.className).toContain('border-line');
    // Dead-on-`.btn` utilities are gone from the states that became a Button.
    for (const dead of ['text-xs', 'px-2', 'py-1', 'rounded-sm']) {
      expect(invite.className.split(/\s+/)).not.toContain(dead);
    }
    // `min-h-11` is still present — from the cva base, not the call site.
    expect(invite.className).toContain('min-h-11');
  });

  // 88.6.1-47 (D-06 / W041, AC-14): the settled-chip focus landing at its other mounts and
  // edges. The shared useFocusRecovery hook (plan 88.6.1-04) is armed at the press with the chip
  // as the preferred target, so focus moves only when it was lost, and never off a user who went
  // elsewhere.
  it('D6-3: inside the See-all dialog the settled chip takes focus, and focus stays inside the dialog', async () => {
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [...SIX_PARTICIPANTS, GUEST] });
    const dialog = await openParticipantsModal(user);

    await user.click(within(dialog).getByRole('button', { name: INVITE }));
    await act(async () => {
      invite$.settle({});
    });

    const chip = await within(dialog).findByText('Invite sent!');
    // Before D-06 the removed button sent focus to the dialog CONTAINER (C-5).
    await waitFor(() => expect(document.activeElement).toBe(chip));
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('D6-4: a 409 pending outcome pressed in the Safari click shape (no focus on the button) lands on the Invite pending chip', async () => {
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    // The Safari shape: a click that does NOT focus the button. Asserted first, because the
    // whole arm turns on it — `user.click` would focus the button and pass with or without the
    // hook's `from` seed. (Read as the tag name: the flipped D-06 pin retired the old <body>
    // landing assertion from this describe, and this is a PRECONDITION, not a landing.)
    expect(document.activeElement?.tagName).toBe('BODY');
    fireEvent.click(invite);
    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledTimes(1);

    await act(async () => {
      invite$.fail(new ApiError('This person already has a pending invite', 'invite_pending', 409));
    });

    const chip = await screen.findByText('Invite pending');
    await waitFor(() => expect(document.activeElement).toBe(chip));
  });

  it('D6-5 (control): a user who moved focus elsewhere while sending is not moved when the chip renders', async () => {
    pinClockBeforeTheNight();
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await user.click(invite);
    const share = screen.getByRole('button', { name: 'Share Game QR' });
    act(() => {
      share.focus();
    });
    expect(document.activeElement).toBe(share);

    await act(async () => {
      invite$.settle({});
    });
    // POSITIVE settle signal first (P-6), then the "not moved" read.
    await screen.findByText('Invite sent!');
    expect(document.activeElement).toBe(share);
  });

  it('D6-6 (control): an error outcome keeps focus on the same node, now named Retry inviting the guest to the group', async () => {
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await user.click(invite);
    const sending = screen.getByRole('button', { name: INVITE + ', sending' });
    expect(sending).toBe(invite);

    await act(async () => {
      invite$.fail(new Error('network'));
    });

    const retry = await screen.findByRole('button', { name: RETRY_INVITE });
    expect(retry).toBe(invite);
    expect(document.activeElement).toBe(retry);
  });

  // Rule 1 (88.9-46 B26 / B29, owner pick O16a + the Q3 ruling): the invite keeps the label the
  // user PRESSED while sending (Invite from rest, Retry from the error state; 88.9-65 X63), and Share
  // Game QR keeps its label; each shows the one house spinner and is named label plus suffix.
  it('rule 1 (88.9): the guest invite and Share Game QR keep their labels and show the spinner while busy (B26, B29)', async () => {
    pinClockBeforeTheNight();
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await user.click(invite);
    expect(invite).toHaveAccessibleName(INVITE + ', sending');
    expect(invite).toHaveTextContent(/^Invite/);
    await waitFor(() => expect(invite.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(invite).toHaveAttribute('aria-disabled', 'true');
    expect(invite.hasAttribute('disabled')).toBe(false);
    await user.click(invite);
    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledTimes(1);

    await act(async () => {
      invite$.fail(new Error('network'));
    });
    const retry = await screen.findByRole('button', { name: RETRY_INVITE });
    expect(retry).toBe(invite);
    await waitFor(() => expect(retry.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0), { timeout: SPINNER_MIN_MS + 1500 }); // AMENDED Phase 88.9-54 (R-C3b): waits for the 500 ms hold

    // Pressed from the error state: Retry is the label under the user's finger, so Retry stays.
    const retry$ = deferredInvite();
    await user.click(retry);
    expect(retry).toHaveAccessibleName(RETRY_INVITE + ', sending');
    expect(retry).toHaveTextContent(/^Retry/);
    await waitFor(() => expect(retry.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(invitesAPI.sendParticipantInvite).toHaveBeenCalledTimes(2);
    await act(async () => {
      retry$.settle({});
    });
    await screen.findByText('Invite sent!');

    // B29 (R-W4: ', loading'): two presses in one act send ONE request; the busy control keeps its
    // label with the spinner.
    const token = deferred(eventsAPI.getEventInviteToken as Mock);
    const share = screen.getByRole('button', { name: 'Share Game QR' });
    await act(async () => {
      share.click();
      share.click();
    });
    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledTimes(1);
    expect(share).toHaveAccessibleName('Share Game QR, loading');
    expect(share).toHaveTextContent(/^Share Game QR/);
    await waitFor(() => expect(share.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-54 (R-C3b): waits for the 200 ms appear
    expect(share).toHaveAttribute('aria-disabled', 'true');
    expect(share.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      token.settle({ invite_url: 'https://example.test/i/rule1' });
    });
    const idle = await screen.findByRole('button', { name: 'Share Game QR' });
    expect(idle).toBe(share);
    await waitFor(() => expect(idle.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0), { timeout: SPINNER_MIN_MS + 1500 }); // AMENDED Phase 88.9-54 (R-C3b): waits for the 500 ms hold
  });

  // X63 (88.9-65, owner at N43): the strip chip grew three lines thick at 375 because the invite
  // sat INSIDE it under a long label. The visible word is now Invite, the name says who (an
  // sr-only span inside the button, so the name lives on the focusable control itself), the
  // error arm keeps the word Retry and says what is retried and for whom (owner 2026-11-14,
  // Q7 B), and the button sits BESIDE its chip, as at its other two sites.
  it('X63 (88.9-65): the guest invite reads Invite, is named Invite <name> to the group, after an error reads Retry named Retry inviting <name> to the group, renders beside the strip chip, and shows the house spinner while held', async () => {
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: 'Invite Visiting Pat to the group' });
    // The visible word is the button's first text; the rest of the name is visually hidden.
    expect(invite.firstChild?.textContent).toBe('Invite');
    expect(invite.querySelector('.sr-only')?.textContent).toBe(' Visiting Pat to the group');

    // Beside the chip: the chip is the bordered box holding the name, and it does not hold the button.
    const chip = screen.getByText('Visiting Pat').parentElement as HTMLElement;
    expect(chip.className).toContain('border-line');
    expect(chip.contains(invite), 'the invite sits beside the chip, not inside it').toBe(false);
    const group = chip.parentElement as HTMLElement;
    expect(group.contains(invite)).toBe(true);
    // AMENDED 88.9-52 R4 D2 (owner 2026-11-18): the pair may wrap, so the button drops under the chip, and
    // the chip no longer carries min-w-0 (it let the button squeeze the name; the chip is capped at the
    // strip by max-w-full instead).
    // AMENDED Phase 89.6-19 (O-9c): the pair is the house row (bb-row wraps) with baseline alignment.
    expect(group.className.split(/\s+/)).toEqual(expect.arrayContaining(['bb-row', 'items-baseline', 'self-center', 'max-w-full']));
    expect(chip.className.split(/\s+/)).toContain('max-w-full');
    expect(chip.className.split(/\s+/)).not.toContain('min-w-0');

    // Held: the kept word, the name with the suffix, and the house spinner.
    await user.click(invite);
    expect(invite).toHaveAccessibleName('Invite Visiting Pat to the group, sending');
    await waitFor(() => expect(invite.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));

    // The send fails once: the visible word is Retry and the name says what is retried, for whom.
    await act(async () => {
      invite$.fail(new Error('network'));
    });
    const retry = await screen.findByRole('button', { name: 'Retry inviting Visiting Pat to the group' });
    expect(retry).toBe(invite);
    expect(retry).toHaveAccessibleName('Retry inviting Visiting Pat to the group');
    expect(retry).toHaveTextContent(/^Retry/);
    expect(retry.firstChild?.textContent).toBe('Retry');
  });

  // S4w = S4-c (plan 89.6-36): while its Spinner shows, a busy Button hides its ELEMENT children
  // (they go transparent); a bare text node is not an element and would stay drawn under the
  // Spinner. The guest invite rendered its visible word as bare text inside a fragment, the one
  // busy Button in the app that did. The white-space word break between the word and the sr-only
  // span is a text node on purpose (X63) and is allowed.
  it('S4w (89.6-36): the busy guest invite hides its word: no direct text node of the button holds non-whitespace', async () => {
    const user = userEvent.setup();
    deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: 'Invite Visiting Pat to the group' });
    await user.click(invite);
    await waitFor(() => expect(invite.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));
    const bareWords = Array.from(invite.childNodes).filter((n) => n.nodeType === 3 && (n.textContent ?? '').trim());
    expect(bareWords.map((n) => n.textContent), 'a word drawn as bare text stays visible under the Spinner').toHaveLength(0);
    // The name is untouched by the wrap: the word, the rest of the name, then the busy suffix.
    expect(invite).toHaveAccessibleName('Invite Visiting Pat to the group, sending');
  });});

// UI-SPEC §9.3 E10-long-text / SPEC AC-5 — the quote-bearing-name backstop.
// The two-tap Remove interpolates a user-supplied display name into its
// accessible name; a name carrying a double quote and an apostrophe must render
// intact inside it rather than truncating or escaping the label.
describe('gameDetail row actions: quote-bearing names (§9.3 E10-long-text)', () => {
  const AWKWARD = 'Pat "The Wall" O\'Brien-Smith';

  it('renders a quote-and-apostrophe name intact inside the Remove accessible name', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 6 }, (_, i) =>
      participantRow({ user_id: `p-${i}`, username: i === 0 ? AWKWARD : `Player ${i}` })
    );
    renderEventDetail({ role: 'owner', participants: rows });

    const dialog = await openParticipantsModal(user);
    expect(
      within(dialog).getByRole('button', { name: `Remove ${AWKWARD} from this event` })
    ).toBeInTheDocument();
  });
});

// Req 15 ORDERING. `page.js` records "the invite sits BEFORE Remove, not after"
// as a source comment and this plan's prohibition names an ordering TEST that
// must stay green — measured 2026-09-16, NO such test existed. It is written
// here rather than assumed, so the prohibition is checkable.
describe('gameDetail row actions: invite before remove (Req 15)', () => {
  it('renders the guest invite BEFORE the two-tap Remove in document order', async () => {
    const user = userEvent.setup();
    const guest = participantRow({
      user_id: 'guest-uuid',
      username: 'Visiting Pat',
      is_guest: true,
    });
    const rows = [
      guest,
      ...Array.from({ length: 5 }, (_, i) =>
        participantRow({ user_id: `p-${i}`, username: `Player ${i}` })
      ),
    ];
    renderEventDetail({ role: 'owner', participants: rows });

    const dialog = await openParticipantsModal(user);
    const invite = within(dialog).getByRole('button', { name: INVITE });
    const remove = within(dialog).getByRole('button', {
      name: 'Remove Visiting Pat from this event',
    });
    expect(
      invite.compareDocumentPosition(remove) & Node.DOCUMENT_POSITION_FOLLOWING,
      'the constructive action must come first — swapping them puts "Remove" under the thumb that was reaching for "Invite"'
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Req 1 (the 16px iOS focus-zoom floor) + DEF-88-10-01 (label association).
//
// These sweep the WHOLE surface rather than naming controls one at a time, on
// purpose: the failure this phase is closing is not "control X is 12px", it is
// "nothing notices when a sub-16px control lands". A named-control pin goes
// green forever the moment someone adds an eleventh filter; the sweep does not.
//
// jsdom compiles no Tailwind, so computed font-size is meaningless here — the
// assertion is on the class contract the `Input`/`Textarea`/`SelectControl`
// primitives supply (`text-base`, unconditional, no breakpoint variant).
// ---------------------------------------------------------------------------

/** Open both control-bearing surfaces: the session-filter panel and the review dialog. */
async function openAllControlSurfaces(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /Show Filters/ }));
  await user.click(screen.getByRole('button', { name: 'Add Review' }));
}

/** Every form control currently in the document, portal-included. */
function allControls(): HTMLElement[] {
  return Array.from(
    document.body.querySelectorAll<HTMLElement>('input, select, textarea')
  );
}

describe('gameDetail form controls (Req 1 — the 16px floor)', () => {
  it('carries no sub-16px size class on any control', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await openAllControlSurfaces(user);

    const controls = allControls();
    // Guard against the sweep silently passing over an empty set.
    expect(controls.length).toBeGreaterThanOrEqual(12);

    const offenders = controls
      .filter((c) => /\btext-(xs|sm)\b/.test(c.className))
      .map((c) => `${c.tagName.toLowerCase()}#${c.id || '(no id)'}: ${c.className}`);
    expect(offenders).toEqual([]);
  });

  it('renders every text-entry control at text-base', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await openAllControlSurfaces(user);

    // The recommend checkbox is excluded by TYPE, not by name: iOS focus-zoom is
    // a text-entry behaviour, and the primitive's `block w-full p-2` would
    // stretch a checkbox across the dialog. See the marker at its call site.
    const textEntry = allControls().filter(
      (c) => !(c instanceof HTMLInputElement && c.type === 'checkbox')
    );
    const unsized = textEntry
      .filter((c) => !/\btext-base\b/.test(c.className))
      .map((c) => `${c.tagName.toLowerCase()}#${c.id || '(no id)'}`);
    expect(unsized).toEqual([]);
  });
});

describe('gameDetail control labelling (DEF-88-10-01)', () => {
  const FILTER_LABELS = [
    'From Date',
    'To Date',
    'Player Won',
    'Player Picked',
    'Player Participated',
    'Min Duration (min)',
    'Max Duration (min)',
    'Min Players',
    'Min Score',
    'Sort By',
  ];

  it.each(FILTER_LABELS)('names the "%s" session filter to assistive tech', async (label) => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await user.click(await screen.findByRole('button', { name: /Show Filters/ }));
    expect(screen.getByLabelText(label)).toBeInTheDocument();
  });

  it('leaves no orphan <label> anywhere on the surface', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await openAllControlSurfaces(user);

    // An orphan is a <label> that neither points at a control (`for`) nor wraps
    // one. That is the exact idiom DEF-88-10-01's repo-wide sweep hunts, and it
    // is what a screen reader renders as "edit blank".
    const orphans = Array.from(document.body.querySelectorAll('label'))
      .filter((l) => !l.htmlFor && !l.querySelector('input, select, textarea'))
      .map((l) => l.textContent?.trim());
    expect(orphans).toEqual([]);
  });

  it('keeps the star-rating group named without an orphan label', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await user.click(await screen.findByRole('button', { name: 'Add Review' }));

    // Both halves matter, so both are pinned: the visible "Rating" text survives
    // (as a <span>, not an orphan <label>), and the control's own accessible name
    // comes from the radiogroup. Dropping the first leaves a sighted user
    // guessing; dropping the second leaves a screen-reader user with nothing.
    expect((await screen.findByText('Rating')).tagName).toBe('SPAN');
    expect(screen.getByRole('radiogroup', { name: 'Game rating' })).toBeInTheDocument();
  });
});

// quick-260930-w9v — editing a saved review whose rating arrives as a string.
//
// Owner report (production, 2026-09-30): tapping Edit on his own saved review showed the
// "Something went wrong" screen, with "TypeError: o.toFixed is not a function" in the console.
// The wire shape: the rating column is DECIMAL(3, 1)
// (periodictabletopbackend_v2/Sonnet/models/GameReview.js:25), so the API sends it as a string
// such as "4.0"; the backend's own test reads it through Number(...)
// (tests/routes/gameReviews.test.js:149). These pins rely on StarRatingPicker being REAL in this
// file (see the "deliberately NOT stubbed" note near the top) — a stub would make G1 vacuous.
const SAVED_REVIEW = {
  id: 'rev-1',
  rating: '4.0',
  review_text: 'Great engine',
  is_recommended: true,
  createdAt: '2026-09-01T00:00:00Z',
  User: { id: SELF_UUID, username: 'Me' },
};

// R-C5 (88.9-56, owner ruling 2026-11-10): each review's stars are ONE labelled leaf (role img),
// named on the half-star value the glyphs draw, with no sr-only sibling beside it (the project's
// iPhone VoiceOver rule: a labelled leaf is spoken, a hidden sibling is a separate stop or silent).
// renderStars is component-local, so the glyph strings are stated here as escapes.
describe('R-C5 (88.9) — a review rating is heard as a number', () => {
  it('R-C5 (88.9): a review\'s stars are one labelled leaf — role img, Rated n out of 5 on the half-star value the glyphs draw', async () => {
    renderGameDetail({
      role: 'member',
      reviews: [
        { ...SAVED_REVIEW, rating: 3.5 },
        { ...SAVED_REVIEW, id: 'rev-2', rating: '3.7', User: { id: 'a1a1a1a1-a1a1-4a1a-8a1a-a1a1a1a1a1a1', username: 'Ann' } },
        { ...SAVED_REVIEW, id: 'rev-3', rating: 9, User: { id: 'b2b2b2b2-b2b2-4b2b-8b2b-b2b2b2b2b2b2', username: 'Bo' } },
      ],
    });
    const section = await reviewsSection();
    const leaves = await within(section).findAllByRole('img', { name: /^Rated / });
    expect(leaves.map((leaf) => leaf.getAttribute('aria-label'))).toEqual([
      'Rated 3.5 out of 5',
      'Rated 3.5 out of 5',
      'Rated 5 out of 5',
    ]);
    const HALF = '\u2605\u2605\u2605\u00bd\u2606';
    expect(leaves.map((leaf) => leaf.textContent)).toEqual([HALF, HALF, '\u2605\u2605\u2605\u2605\u2605']);
    for (const leaf of leaves) {
      expect(leaf.tagName).toBe('SPAN');
      expect(leaf.parentElement?.children).toHaveLength(1);
      expect(leaf.parentElement?.querySelectorAll('.sr-only')).toHaveLength(0);
    }
  });
});

async function openEditDialog(user: ReturnType<typeof userEvent.setup>): Promise<HTMLElement> {
  await user.click(await within(await reviewsSection()).findByRole('button', { name: 'Edit' }));
  return screen.findByRole('dialog', { name: 'Edit Your Review' });
}

describe('quick-260930-w9v — editing a saved review whose rating arrives as a string', () => {
  // G1 — the crash pin: the dialog used to throw on open (toFixed on the string).
  it('opens the editor on a saved rating of "4.0" with the 4-star radio checked and 4.0 shown', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member', reviews: [SAVED_REVIEW] });

    const dialog = await openEditDialog(user);
    expect(within(dialog).getByRole('radio', { name: '4 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getAllByRole('radio', { checked: true })).toHaveLength(1);
    expect(within(dialog).getByText('4.0')).toBeInTheDocument();
  });

  // G2 — a legacy review rated 0 (the pre-Phase-70 number input allowed it) stays 0 on an
  // untouched resubmit. A prefill of Number(rating) || 2.5 would silently resave it as 2.5.
  it('keeps a legacy saved rating of "0.0" as 0 when the review is resubmitted untouched', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member', reviews: [{ ...SAVED_REVIEW, rating: '0.0' }] });
    (gameReviewsAPI.submitReview as Mock).mockResolvedValueOnce({ ...SAVED_REVIEW, rating: '0.0' });

    const dialog = await openEditDialog(user);
    expect(within(dialog).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Update Review' }));

    await waitFor(() =>
      expect(gameReviewsAPI.submitReview).toHaveBeenCalledWith(expect.objectContaining({ rating: 0 }))
    );
  });

  // G4 — the pin the prefill conversion itself needs (independent review, 2026-09-30: G1-G3 all
  // pass with the picker change alone). A rating of 0 sent as a NUMBER — what the API would send
  // the day its DECIMAL-as-string contract is changed — was replaced by 2.5 under the old
  // rating || 2.5 prefill: the editor opened on 2.5 stars and an untouched resubmit saved 2.5.
  it('keeps a saved rating of numeric 0 as 0: no star checked, and an untouched resubmit sends 0', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member', reviews: [{ ...SAVED_REVIEW, rating: 0 }] });
    (gameReviewsAPI.submitReview as Mock).mockResolvedValueOnce({ ...SAVED_REVIEW, rating: 0 });

    const dialog = await openEditDialog(user);
    expect(within(dialog).queryAllByRole('radio', { checked: true })).toHaveLength(0);
    await user.click(within(dialog).getByRole('button', { name: 'Update Review' }));

    await waitFor(() =>
      expect(gameReviewsAPI.submitReview).toHaveBeenCalledWith(expect.objectContaining({ rating: 0 }))
    );
  });

  // G3 — a review saved with no rating still opens at the 2.5 default. A conversion that
  // forgot the null check would turn null into 0 here.
  it('opens the editor at the 2.5 default when the saved review has no rating', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member', reviews: [{ ...SAVED_REVIEW, rating: null }] });

    const dialog = await openEditDialog(user);
    expect(within(dialog).getByRole('radio', { name: '2.5 stars' })).toHaveAttribute('aria-checked', 'true');
    expect(within(dialog).getByText('2.5')).toBeInTheDocument();
  });
});

describe('gameDetail plan-a-game-night CTA', () => {
  it('is offered to a non-pending group member', async () => {
    renderGameDetail({ role: 'member' });
    expect(
      await screen.findByRole('button', { name: 'Plan a game night with this' })
    ).toBeInTheDocument();
  });

  it('is withheld from a pending member', async () => {
    renderGameDetail({ role: 'pending' });
    await screen.findByRole('heading', { name: 'Wingspan' });
    expect(
      screen.queryByRole('button', { name: 'Plan a game night with this' })
    ).not.toBeInTheDocument();
  });

  // D-38 / F-6a. Rendering ONCE is the pin that matters: the CTA sits after the
  // custom-game/BGG ternary, and the failure mode of moving it inside a branch is
  // a duplicate on one branch and nothing on the other.
  it('renders exactly once, anchored inside the game card, with the phone floor', async () => {
    renderGameDetail({ role: 'member' });
    const ctas = await screen.findAllByRole('button', {
      name: 'Plan a game night with this',
    });
    expect(ctas).toHaveLength(1);
    expect(ctas[0].className).toContain('min-h-11');
    expect(ctas[0].closest('.card')).not.toBeNull();
  });

  it('renders exactly once on the custom-game branch too', async () => {
    renderGameDetail({
      role: 'member',
      game: { ...GAME, is_custom: true, bgg_id: null },
    });
    expect(
      await screen.findAllByRole('button', { name: 'Plan a game night with this' })
    ).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 88-33 Task 9 (WI-F9) — expand affordances + the guest-removal disclosure.
// ---------------------------------------------------------------------------
describe('gameDetail expand affordances (rows 326/334)', () => {
  const GAME_WITH_DESC = {
    ...GAME,
    description: 'A very long description of a very good bird game. '.repeat(10),
  };

  // jsdom performs no layout: scrollHeight/clientHeight are 0. Shadow them on
  // HTMLElement.prototype to simulate a clamped paragraph that overflows.
  const setMeasuredOverflow = (scroll: number, client: number) => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get: () => scroll,
    });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get: () => client,
    });
  };
  afterEach(() => {
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
    delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
  });

  it('hides Show More when the clamped description does not overflow (row 326)', async () => {
    renderGameDetail({ game: GAME_WITH_DESC }); // default jsdom: 0/0 — no overflow
    await screen.findByRole('heading', { name: 'Game Sessions (1)' });
    expect(screen.queryByRole('button', { name: 'Show More' })).toBeNull();
  });

  it('shows the toggle with disclosure semantics when it overflows; Esc collapses; editable-origin Esc does not (rows 326+334)', async () => {
    const user = userEvent.setup();
    setMeasuredOverflow(100, 50);
    renderGameDetail({ game: GAME_WITH_DESC });

    const toggle = await screen.findByRole('button', { name: 'Show More' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'game-description');
    // Phase 89.6-29 (OW-1 = A): the toggle is held at the 44px floor (min-h-11 on an inline-flex box).
    expect(toggle.className.split(/\s+/), 'Show More is not held at the 44px floor').toContain('min-h-11');
    expect(toggle.className.split(/\s+/), 'Show More is not an inline-flex box, so min-h-11 would not centre its word').toContain('inline-flex');

    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: 'Show Less' })).toHaveAttribute(
      'aria-expanded',
      'true'
    );

    // Esc arriving FROM an editable control bails (r1 triage).
    await user.click(screen.getByRole('button', { name: /Show Filters/ }));
    fireEvent.keyDown(screen.getByLabelText('Min Duration (min)'), { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Show Less' })).toBeInTheDocument();

    // A plain Esc on the main page collapses back to Show More.
    fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Show More' })).toBeInTheDocument()
    );
  });

  it('Esc while a dialog is open leaves the expanded description alone (row 334)', async () => {
    setMeasuredOverflow(100, 50);
    renderGameDetail({ game: GAME_WITH_DESC });

    fireEvent.click(await screen.findByRole('button', { name: 'Show More' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add Review' }));
    await screen.findByRole('dialog');

    fireEvent.keyDown(document.body, { key: 'Escape' });
    expect(screen.getByRole('button', { name: 'Show Less' })).toBeInTheDocument();
  });

  // 88.9-52 R4 C1 (accessibility once-over A2, owner 2026-11-18): the page title is never cut.
  // The measured overflow is forced so the old code would have drawn its clamp and its hidden
  // button; the title must carry neither, in the BGG arm and in the custom-game arm.
  it.each([
    ['BGG game', GAME_WITH_DESC],
    ['custom game', { ...GAME_WITH_DESC, is_custom: true, bgg_id: null }],
  ])('R4 C1: the %s title wraps in full: no clamp, no tap-to-expand, no hidden button', async (_arm, game) => {
    setMeasuredOverflow(100, 50);
    renderGameDetail({ game });

    const title = await screen.findByRole('heading', { level: 1, name: game.name });
    expect(title).toHaveAttribute('id', 'game-title');
    expect(title.className).not.toMatch(/line-clamp/);
    expect(title.className).not.toMatch(/cursor-pointer/);
    // A single over-long word breaks only when it cannot fit: the Heading primitive's own
    // overflow-wrap token (never break-all, which would cut every word).
    // AMENDED Phase 89.6-06 (heading-wrap): the primitive's token is wrap-break-word (it was wrap-anywhere).
    expect(title.className).toMatch(/(^|\s)wrap-break-word(\s|$)/);
    expect(title.className).not.toMatch(/break-all/);
    expect(screen.queryByRole('button', { name: /full title/i })).toBeNull();
    expect(document.querySelector('[aria-controls="game-title"]')).toBeNull();
    // A tap on the title changes nothing about it (there is nothing to expand).
    const before = title.className;
    fireEvent.click(title);
    expect(title.className).toBe(before);
  });
});

describe('gameDetail guest-removal disclosure (row 530 FE half)', () => {
  it('tells admins the removal boundary in the participants modal', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    const dialog = await openParticipantsModal(user);
    expect(
      within(dialog).getByText('Names added by hand and your own row are removed via Edit Event.')
    ).toBeInTheDocument();
  });

  it('renders no disclosure for plain members (they have no Remove affordance)', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'member', participants: SIX_PARTICIPANTS });
    const dialog = await openParticipantsModal(user);
    expect(
      within(dialog).queryByText('Names added by hand and your own row are removed via Edit Event.')
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Plan 88.6-18 — the event-actions kebab after the hand-rolled menu was retired
// onto the shared `KebabMenu` component.
//
// THREE AUTHORIZATION GATES ride on this swap (review D56). `KebabMenu` maps its
// `items` UNCONDITIONALLY, so a gate not written into the items array is a LEAKED
// action — and the backend accepts self-leave for any matching `User.id`, so a
// leaked Leave item does not fail, it SUCCEEDS. Each is proven by role, not read.
//
// Everything here is a DOM fact (attributes, `document.activeElement`, call
// counts), so no Playwright arm is needed for any of it (review D28).
// ---------------------------------------------------------------------------

/** Open the Event-actions kebab and return the list the trigger names while open. */
async function openEventActions(user: ReturnType<typeof userEvent.setup>) {
  const trigger = await screen.findByRole('button', { name: 'Event actions' });
  await user.click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
  expect(list, 'the open kebab must name its list through aria-controls').not.toBeNull();
  return { trigger, list: list as HTMLElement };
}

/**
 * F9b (88.9-23): Cancel event / Leave event are twoTap, gated for CONFIRM_DELAY_MS after the
 * first tap. Arm, step past the gate, commit. The fake clock (shouldAdvanceTime, so findBy and
 * waitFor keep working) is the calling describe's, or installed here and restored by the
 * calling describe's afterEach.
 */
async function commitEventAction(user: ReturnType<typeof userEvent.setup>, item: HTMLElement) {
  if (!vi.isFakeTimers()) vi.useFakeTimers({ shouldAdvanceTime: true });
  await user.click(item);
  act(() => {
    vi.advanceTimersByTime(CONFIRM_DELAY_MS);
  });
  await user.click(item);
}

/** A promise-returning mock that stays IN FLIGHT until `settle`/`fail` is called. */
function deferred(mock: Mock) {
  let settle: (value?: unknown) => void = () => {};
  let fail: (reason?: unknown) => void = () => {};
  mock.mockImplementation(
    () =>
      new Promise((resolve, reject) => {
        settle = resolve;
        fail = reject;
      })
  );
  return { settle: (v?: unknown) => settle(v), fail: (r?: unknown) => fail(r) };
}

// 88.6.1-47 (D-35, AC-12): the event page's Share Game QR is a PRESSED control. While its
// invite-token request is in flight it keeps focus (aria-disabled, never the native attribute),
// keeps its label with the house spinner and is named by the heard suffix (rule 1, 88.9-46 B29 —
// copy row E6's swap word is retired), and a synchronous ref latch refuses a second press, so two
// presses send ONE request.
//
// The jsdom focus claim here is NODE IDENTITY only: jsdom never blurs a natively disabled
// element (FE-TESTING-CONVENTIONS C-11), so `document.activeElement` staying on the button
// would pass on the unfixed tree too. The RED halves are the attributes, the label and the
// request count. The real-browser focus proof (and the QR dialog handing focus back) is the
// phone e2e, e2e/share-game-qr-pending.spec.ts, run in CI.
describe('gameDetail Share Game QR in flight (88.6.1-47, D-35)', () => {
  // The busy NAME: the kept label plus the heard suffix (rule 1, 88.9-46; R-W4 ', loading').
  const LOADING = 'Share Game QR, loading';

  // AMENDED Phase 88.9-65 (X42): the button renders only before the night starts, so every test
  // here runs with the clock pinned before the event fixture's start.
  beforeEach(() => {
    pinClockBeforeTheNight();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('Q1: two presses with no render flush between them send ONE request, and the pressed node stays focusable', async () => {
    deferred(eventsAPI.getEventInviteToken as Mock);
    renderEventDetail({ role: 'member' });
    const share = await screen.findByRole('button', { name: 'Share Game QR' });
    share.focus();

    // The no-flush shape (the GuestInvite gate's): both presses inside ONE act, so the second
    // press reads the previous render's state. Only a synchronous latch can refuse it.
    await act(async () => {
      share.click();
      share.click();
    });

    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledTimes(1);
    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledWith(EVENT_ID);
    const loading = screen.getByRole('button', { name: LOADING });
    expect(loading).toBe(share);
    expect(loading).toHaveAttribute('aria-disabled', 'true');
    expect(loading.hasAttribute('disabled')).toBe(false);
    // Confirm-only in jsdom (see the describe comment).
    expect(document.activeElement).toBe(share);
  });

  it('Q2: the in-flight state persists through a second press and ends only when the FIRST request settles', async () => {
    const token = deferred(eventsAPI.getEventInviteToken as Mock);
    renderEventDetail({ role: 'member' });
    const share = await screen.findByRole('button', { name: 'Share Game QR' });

    await act(async () => {
      share.click();
    });
    await act(async () => {
      share.click();
    });

    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledTimes(1);
    const loading = screen.getByRole('button', { name: LOADING });
    expect(loading).toBe(share);
    expect(loading).toHaveAttribute('aria-disabled', 'true');
    expect(loading.hasAttribute('disabled')).toBe(false);

    await act(async () => {
      token.settle({ invite_url: 'https://example.test/i/q2' });
    });

    const idle = await screen.findByRole('button', { name: 'Share Game QR' });
    expect(idle).toBe(share);
    expect(idle).not.toHaveAttribute('aria-disabled');
  });

  it('Q3 (control): a failed request releases the latch, so the next press sends a second request', async () => {
    const token = deferred(eventsAPI.getEventInviteToken as Mock);
    renderEventDetail({ role: 'member' });
    const share = await screen.findByRole('button', { name: 'Share Game QR' });

    await act(async () => {
      share.click();
    });
    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledTimes(1);

    await act(async () => {
      token.fail(new Error('boom'));
    });

    const idle = await screen.findByRole('button', { name: 'Share Game QR' });
    expect(idle).not.toHaveAttribute('aria-disabled');

    await act(async () => {
      idle.click();
    });
    expect(eventsAPI.getEventInviteToken).toHaveBeenCalledTimes(2);
  });
});

// X42 (88.9-65, orchestrator decision, veto open): Share Game QR is offered only BEFORE the night
// starts (the shared start test against the live clock, as the calendar popup and the RSVP
// controls). Both sides of the comparison are fixed points: the event fixture's start and a
// clock pinned on either side of it.
// AMENDED Phase 89.6-28 (X42, D-04 / SPEC A2): the button now shows until the night is OVER
// (isNightOver's FE twin isNightNotOver: before the start, or still running by D47's window), so
// the absent half is re-pinned to one minute after the fixture's 120-minute night ended.
describe('gameDetail Share Game QR only before the night starts (X42, 88.9-65)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('X42 (88.9-65): Share Game QR renders before the night starts and is absent once the night is over', async () => {
    pinClockBeforeTheNight();
    renderEventDetail({ role: 'member' });
    expect(await screen.findByRole('button', { name: 'Share Game QR' })).toBeInTheDocument();
    cleanup();

    // One minute after the fixture's start: the night has started. Heading and chips stay.
    // AMENDED Phase 89.6-28 (X42): one minute after the fixture's 120-minute night ENDED (18:00 + 2h),
    // because a started night still running now keeps the button (SPEC A2).
    vi.setSystemTime(new Date('2026-03-01T20:01:00Z'));
    renderEventDetail({ role: 'member' });
    expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
    expect(screen.getAllByText('Someone Else').length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Share Game QR' })).toBeNull();
  });
});

// 89.6-28 X42 (D-04, SPEC A2): Share Game QR shows until the night is OVER, by one predicate
// (isNightNotOver) shared with the day popup. The event's start and length are staged from the
// pinned instant, never seeded dates; the RSVP pill keeps hasStarted (P-5 No change).
describe('89.6-28 X42 — Share Game QR until the night is over', () => {
  const PIN = new Date('2026-05-10T20:00:00Z');
  const MIN = 60 * 1000;
  const startedAgo = (minutes: number) => new Date(PIN.getTime() - minutes * MIN).toISOString();
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(PIN);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('is present one hour after the start of a 120-minute night, and the RSVP pill still reads the night as started', async () => {
    renderEventDetail({ role: 'member', eventOverrides: { start_date: startedAgo(60), duration_minutes: 120 } });
    expect(await screen.findByRole('button', { name: 'Share Game QR' })).toBeInTheDocument();
    expect(screen.getAllByText('Someone Else').length).toBeGreaterThan(0);
    // nightStarted true: the No reply pill is dropped on a started night (W26, hasStarted kept).
    expect(screen.queryAllByText('No reply')).toHaveLength(0);
  });

  it('is absent 121 minutes after the start of a 120-minute night', async () => {
    renderEventDetail({ role: 'member', eventOverrides: { start_date: startedAgo(121), duration_minutes: 120 } });
    expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share Game QR' })).toBeNull();
  });

  it('with no stored length is present seven hours after the start (the eight-hour default)', async () => {
    renderEventDetail({ role: 'member', eventOverrides: { start_date: startedAgo(7 * 60), duration_minutes: null } });
    expect(await screen.findByRole('button', { name: 'Share Game QR' })).toBeInTheDocument();
  });

  it('with no stored length is absent eight hours and one minute after the start', async () => {
    renderEventDetail({ role: 'member', eventOverrides: { start_date: startedAgo(8 * 60 + 1), duration_minutes: null } });
    expect(await screen.findByRole('heading', { name: 'Participants (1)' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Share Game QR' })).toBeNull();
  });
});

// 89.6-28 R-C10: a read that resolves with no invite_url opens no QR box (it would encode nothing);
// the existing failure arm runs instead, its log and its toast, with no new copy.
describe('89.6-28 R-C10 — an empty invite_url opens no QR box', () => {
  beforeEach(() => {
    pinClockBeforeTheNight();
    qrOpened.count = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    ['undefined', {}],
    ["''", { invite_url: '' }],
  ])('invite_url %s: no QR dialog opens and the failure toast shows', async (_label, data) => {
    const toastError = vi.spyOn(toast, 'error').mockImplementation(() => 'id');
    const warn = vi.spyOn(logger, 'warn').mockImplementation(() => {});
    try {
      (eventsAPI.getEventInviteToken as Mock).mockResolvedValueOnce(data);
      renderEventDetail({ role: 'member' });
      const share = await screen.findByRole('button', { name: 'Share Game QR' });
      await act(async () => {
        share.click();
      });
      await waitFor(() => expect(toastError).toHaveBeenCalledTimes(1));
      expect(warn).toHaveBeenCalledWith('Failed to get game invite token:', expect.any(Object));
      expect(qrOpened.count).toBe(0);
    } finally {
      toastError.mockRestore();
      warn.mockRestore();
    }
  });
});

describe('gameDetail event-actions kebab: the three authorization gates (D56)', () => {
  it.each(['owner', 'admin'] as const)(
    'gives a group %s the Cancel item and NOT the Leave item',
    async (role) => {
      const user = userEvent.setup();
      renderEventDetail({ role });
      const { list } = await openEventActions(user);
      expect(within(list).getByRole('button', { name: 'Cancel event' })).toBeInTheDocument();
      expect(within(list).queryByRole('button', { name: 'Leave event' })).toBeNull();
    }
  );

  it('gives a game-only caller the Leave item and NOT the Cancel item', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'game-only' });
    const { list } = await openEventActions(user);
    expect(within(list).getByRole('button', { name: 'Leave event' })).toBeInTheDocument();
    expect(within(list).queryByRole('button', { name: 'Cancel event' })).toBeNull();
  });

  it.each(['member', 'pending'] as const)(
    'gives a %s no Event-actions trigger at all — the OUTER gate',
    async (role) => {
      renderEventDetail({ role });
      // Settle on something only the loaded single-event view renders, so the
      // absence below is a real absence and not a race on the loading screen.
      await screen.findByRole('heading', { name: 'Game Night' });
      expect(screen.queryByRole('button', { name: 'Event actions' })).toBeNull();
    }
  );
});

describe('gameDetail destructive kebab items: keepOpen, ariaDisabled and the re-entry latch', () => {
  // F9b (88.9-23): Cancel event / Leave event are twoTap, gated for CONFIRM_DELAY_MS after the
  // first tap. Describe-level and shouldAdvanceTime, per this file's fake-timer rule.
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('F9b (88.9): Cancel event arms, stays inert 3 s, then commits once and keeps Cancel event readable with the spinner', async () => {
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    deferred(eventsAPI.deleteEvent as Mock);
    renderEventDetail({ role: 'owner' });
    const { list } = await openEventActions(user);
    const cancel = within(list).getByRole('button', { name: 'Cancel event' });

    await user.click(cancel);
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();
    expect(cancel).toHaveTextContent('Wait (3)');
    expect(cancel).toHaveAccessibleName('Cancel event, wait 3 seconds');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    await user.click(cancel);
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();

    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS - 1000);
    });
    expect(cancel).toHaveTextContent(/^Tap again$/);
    await user.click(cancel);

    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);
    // D24 c: the menu stays OPEN and the busy item is readable in place, focused — since rule 1
    // (88.9-46 B27) the kept label with the house spinner, named 'Cancel event, cancelling'.
    expect(list).toBeInTheDocument();
    const inFlight = within(list).getByRole('button', { name: 'Cancel event, cancelling' });
    expect(inFlight).toBe(cancel);
    expect(inFlight).toHaveTextContent(/^Cancel event/);
    await waitFor(() => expect(inFlight.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(inFlight);
  });

  it('keeps the menu OPEN and readable while Cancel is in flight, and sends exactly one DELETE', async () => {
    const user = userEvent.setup();
    deferred(eventsAPI.deleteEvent as Mock);
    renderEventDetail({ role: 'owner' });
    const { list } = await openEventActions(user);

    const cancel = within(list).getByRole('button', { name: 'Cancel event' });
    // THE NO-FLUSH SHAPE IS LOAD-BEARING (review D63): both activations are
    // dispatched inside ONE `act()`, so the second runs the previous render's
    // closure where `cancellingEvent` is still false. After a flush the item gate
    // alone satisfies this and the test passes with no latch in the code.
    // F9b (88.9-23): arm and step past the gate first, so the pair below is two activations
    // of the LIVE item.
    await act(async () => {
      cancel.click();
    });
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await act(async () => {
      cancel.click();
      cancel.click();
    });

    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);
    // The ruled arm (c): still OPEN, with the busy item readable IN PLACE — not "after
    // reopening". Rule 1 (88.9-46 B27): the label is kept beside the spinner.
    const inFlight = within(list).getByRole('button', { name: 'Cancel event, cancelling' });
    expect(inFlight).toHaveTextContent(/^Cancel event/);
    await waitFor(() => expect(inFlight.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the menu OPEN and readable while Leave is in flight, and sends exactly one DELETE', async () => {
    const user = userEvent.setup();
    deferred(eventsAPI.leaveEvent as Mock);
    renderEventDetail({ role: 'game-only' });
    const { list } = await openEventActions(user);

    const leave = within(list).getByRole('button', { name: 'Leave event' });
    // F9b (88.9-23): arm and step past the gate first, as above.
    await act(async () => {
      leave.click();
    });
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    await act(async () => {
      leave.click();
      leave.click();
    });

    expect(eventsAPI.leaveEvent).toHaveBeenCalledTimes(1);
    // Rule 1 (88.9-46 B28): Leave event keeps its label with the spinner, named ', leaving'.
    const inFlight = within(list).getByRole('button', { name: 'Leave event, leaving' });
    expect(inFlight).toHaveTextContent(/^Leave event/);
    await waitFor(() => expect(inFlight.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight.hasAttribute('disabled')).toBe(false);
  });

  it('leaves focus ON the activated item, and Escape from there closes and restores to the trigger', async () => {
    const user = userEvent.setup();
    deferred(eventsAPI.deleteEvent as Mock);
    renderEventDetail({ role: 'owner' });
    const { trigger, list } = await openEventActions(user);

    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));
    // The whole reason the gate is `ariaDisabled` and not the native attribute:
    // a natively-disabled focused element blurs to <body>, which is exactly the
    // state this menu's container-bound Escape cannot see.
    const inFlight = within(list).getByRole('button', { name: 'Cancel event, cancelling' });
    expect(document.activeElement).toBe(inFlight);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancel event, cancelling' })).toBeNull()
    );
    expect(document.activeElement).toBe(trigger);
  });

  it('STRANDED-LATCH REGRESSION (Leave): a pre-check rejection leaves the retry live', async () => {
    const user = userEvent.setup();
    (eventsAPI.leaveEvent as Mock).mockResolvedValue({});
    const { rerender } = renderEventDetail({ role: 'game-only' });
    await screen.findByRole('button', { name: 'Event actions' });

    // Identity goes UNRESOLVED. `userScope` deliberately keeps its prior value
    // (unresolved = indeterminate, never a downgrade), so the control stays.
    h.selfUuid = undefined;
    rerender(<GameDetailPage />);

    const { list } = await openEventActions(user);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Leave event' }));
    expect(eventsAPI.leaveEvent).not.toHaveBeenCalled();
    // `keepOpen` means the rejected activation left the menu open, so the SAME
    // list is still mounted for the retry — no second trigger click (which would
    // toggle it shut).

    // Identity resolves; the SAME control must still work. A latch taken above
    // `handleLeaveEvent`'s three bare pre-check returns — all of them OUTSIDE any
    // `try` — would never release, and Leave would be dead for the life of the
    // mount. Nothing else in this suite catches that.
    h.selfUuid = SELF_UUID;
    rerender(<GameDetailPage />);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Leave event' }));

    await waitFor(() => expect(eventsAPI.leaveEvent).toHaveBeenCalledTimes(1));
  });

  it('STRANDED-LATCH REGRESSION (Cancel): a pre-check rejection leaves the retry live', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    const { rerender } = renderEventDetail({ role: 'owner' });
    await screen.findByRole('button', { name: 'Event actions' });

    // `handleCancelEvent`'s ONLY pre-check is `!user?.sub || !singleEvent?.id`.
    // `singleEvent` is truthy by construction wherever this control renders (the
    // whole branch is gated on it), so the AUTH half is the reachable one.
    h.userSub = undefined;
    rerender(<GameDetailPage />);

    const { list } = await openEventActions(user);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();

    h.userSub = 'auth0|self-sub';
    rerender(<GameDetailPage />);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));

    await waitFor(() => expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1));
  });
});

// Owner ruling #175 (2026-09-14, option 2): all five breadcrumb navs in the tree
// take an accessible name. This file owns TWO of the five, so each assertion has
// to DISAMBIGUATE its surface rather than assume a single match — and the property
// under test is the landmark's NAME, which only a role-plus-name query proves.
describe('gameDetail breadcrumb landmarks are named (#175)', () => {
  it('names the SINGLE-EVENT surface breadcrumb', async () => {
    renderEventDetail({ role: 'owner' });
    await screen.findByRole('heading', { name: 'Game Night' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Game Night')).toBeInTheDocument();
  });

  it('names the GAME-DETAIL surface breadcrumb', async () => {
    renderGameDetail({ role: 'member' });
    await screen.findByRole('heading', { name: 'Wingspan' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(nav).getByText('Wingspan')).toBeInTheDocument();
  });
});

// 88.9-36 NAV-01 (owner ruling (a), chat 2026-11-07 1:08 PM Pacific, register row 69.9): both
// gameDetail page roots cap at 1280px, centred. The padding stays (DEF-88-24-01); the two roots
// move together. Each root is found as the Breadcrumb navigation's parent, checked to be the render
// container's first element child (one Breadcrumb navigation per view).
// 88.9-59 X5c (owner at the 88.9-51 glance, 2026-11-11): the header and footer moved to a 1600 box
// and these two bodies STAY at 1280 under it, so the cap is no longer "the header's box". The
// assertions are unchanged (confirm-only); the title and the helper name say what they hold now.
describe('gameDetail page width — NAV-01 (88.9-36)', () => {
  it('NAV-01 + X5c cap (88.9): both gameDetail roots stay max-w-7xl mx-auto, a 1280 body under the 1600 header', async () => {
    const expectBodyCap = (container: HTMLElement) => {
      const root = screen.getByRole('navigation', { name: 'Breadcrumb' }).parentElement as HTMLElement;
      expect(root).toBe(container.firstElementChild);
      for (const cls of ['max-w-7xl', 'mx-auto', 'p-edge-card', 'md:p-edge-wide']) { // AMENDED Phase 89.6-15 (O-M1-sites): the root's padding is the px edge-token pair
        expect(root.classList.contains(cls), `root class ${cls}`).toBe(true);
      }
      expect(root.classList.contains('max-w-6xl'), 'root keeps the 6xl cap').toBe(false);
    };

    const event = renderEventDetail({ role: 'owner' });
    await screen.findByRole('heading', { name: 'Game Night' });
    expectBodyCap(event.container);
    event.unmount();

    const game = renderGameDetail({ role: 'member' });
    await screen.findByRole('heading', { name: 'Wingspan' });
    expectBodyCap(game.container);
  });
});

// ── Phase 88.6-47 (todo 2026-09-21, "date range inputs allow end before start") ──
//
// The session filter's From/To pair is pure CLIENT state — an inverted range simply
// yields nothing and explains nothing, which is worse than the availability path where
// the server at least says no. Native `min`/`max` close the picker path (the surface the
// owner reported from); the typed path's missing explanation is routed to Phase 88.9
// with its proposed string, because minting copy here would breach P1.
//
// THIS ASSERTS THE DERIVATION, NOT A DATE: each bound is set from a variable and then
// CHANGED, so a hard-coded bound reds. The empty case is pinned too — this filter starts
// empty on both ends, and an empty-string bound is a real bound of nothing.
//
// [AMENDED Phase 88.6.1-52 (D-25, E5)] The typed path's explanation is no longer routed to
// Phase 88.9: it was ratified as copy row E5 on 2026-10-04 (D-30) and now ships on To Date,
// pinned by the E5 describe at the end of this file. The bounds themselves are unchanged, and
// the test below is byte-unchanged.
describe('gameDetail session date filter bounds (Phase 88.6-47)', () => {
  it('bounds each date control by its sibling, and places no bound while the sibling is empty', async () => {
    const user = userEvent.setup();
    renderGameDetail();

    await user.click(await screen.findByRole('button', { name: /Show Filters/ }));

    const from = screen.getByLabelText('From Date') as HTMLInputElement;
    const to = screen.getByLabelText('To Date') as HTMLInputElement;

    expect(
      from.getAttribute('max'),
      'From Date carries an upper bound while To Date is empty — the filter starts empty on both ends, so an empty-string bound would bound a value that does not exist'
    ).toBeNull();
    expect(to.getAttribute('min'), 'To Date carries a lower bound while From Date is empty').toBeNull();

    const firstFrom = '2026-02-01';
    fireEvent.change(from, { target: { value: firstFrom } });
    expect(
      to.getAttribute('min'),
      'To Date lower bound does not track the From Date value — the bound must be DERIVED from the sibling, never hard-coded'
    ).toBe(firstFrom);

    const secondFrom = '2026-06-15';
    fireEvent.change(from, { target: { value: secondFrom } });
    expect(
      to.getAttribute('min'),
      'To Date lower bound did not follow a CHANGED From Date — this is the assertion that separates a derived bound from a constant'
    ).toBe(secondFrom);

    const toValue = '2026-08-20';
    fireEvent.change(to, { target: { value: toValue } });
    expect(
      from.getAttribute('max'),
      'From Date upper bound does not track the To Date value — the bounds are two-sided on purpose: a user who sets To first must still be able to reach a valid From'
    ).toBe(toValue);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-45 (R7 / AC-7, UI-SPEC §7.5) — the composed axe audits, after this surface's LAST
// migration commit. Ordering confirmed at execution (2026-09-22): `git log -1 -- gameDetail/page.js`
// is `461c857` (plan 88.6-47 task 5, the native date bounds) — NOT plan 18's `73af23a` and NOT plan
// 41's (which never touched this file); the plan-45 must_have amendment predicted exactly this.
//
// THE AUDITED TREES HAVE NO `matchMedia` FORK. `gameDetail/page.js` calls `window.matchMedia` at
// exactly two sites (the two `window.matchMedia('(max-width: 767px)')` reads inside the game
// title's expand handlers in `gameDetail/page.js`; measured 2026-09-22, re-counted 2026-10-16 by
// plan 88.6.1-52), both inside the game-TITLE overflow
// handlers on the page body — neither is reachable from any dialog rendered here. One tree, one run
// per rule set per dialog, no resize.
// AMENDED Phase 88.9-52 (R4 C1): those two reads are gone with the title clamp, so the page now
// calls window.matchMedia nowhere and the heading of this paragraph holds outright.
//
// THIS FILE HAS NO STACKED `ConfirmDialog`-over-`Modal` STATE, contrary to RESEARCH §Q1's reading
// of its two imports: `removeParticipantGate` (`page.js:1104`, `const removeParticipantGate`) is `tier: 'two-tap'` and renders
// `null` by design (DECISION Phase 88-05 D-07), and `deleteSessionGate` (`:1364`, `const deleteSessionGate`) opens from the
// page-level session rows, never from inside a `Modal`. The three dialogs this file CAN show are
// audited one at a time below; the stacked-pair audit lives in `ManageMembers.modals.test.tsx`.
//
// ADDITIONS ONLY: the EVT-08 two-tap describe and the invite-before-remove ordering describe above
// are byte-unchanged (confirmed by `git diff` at commit), and no clock-derived fixture is introduced —
// nothing here reads the clock.
// ---------------------------------------------------------------------------
import { axe } from 'vitest-axe';
import { auditFormControls } from '../../test-utils/formControlAudit';
// AMENDED Phase 88.9-66 (X68, owner ruled 2026-11-14): a full banner shows Try again, so where a test
// below reads the line a forbidden, validation or unknown failure shows in one, it reads the
// beside-retry form (messageBesideRetry over the register line).
import { getFetchErrorMessage, messageBesideRetry } from '@/components/ui/useFetchErrorState';
import { signInLatchKey } from '@/lib/hooks/useSignInRedirect';
import { toast } from 'sonner';
import { logger } from '@/lib/logger';

const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

describe('gameDetail — R7 composed axe audits + focus contracts (88.6-45)', () => {
  it('1. the See-all participants Modal (owner: guest invite + two-tap Remove rows) passes WCAG 4.1.2 and heading-order', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    const dialog = await openParticipantsModal(user);
    // Settle on a branch-specific element, never on chrome: an owner's row action.
    await within(dialog).findAllByRole('button', { name: RESTING_REMOVE });
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the review-form Modal passes WCAG 4.1.2, heading-order and the house rule on every control', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    await user.click(await screen.findByRole('button', { name: 'Add Review' }));
    const dialog = await screen.findByRole('dialog', { name: 'Write a Review' });
    await within(dialog).findByRole('button', { name: 'Submit Review' });
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
    auditFormControls(dialog);
  });

  it('3. the session-delete ConfirmDialog (page-level, dialog tier) passes both rules — the ONLY ConfirmDialog this file can open', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });
    const sessions = await sessionsSection();
    await user.click(within(sessions).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this session?' });
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('4. focus, participants Modal: on OPEN the header Close control; on CLOSE the NAMED "See all" trigger', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    const opener = await screen.findByRole('button', { name: /^See all \(/ });
    opener.focus();
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Participants (6)' });
    // DERIVED BEFORE WRITING: `page.js:2369` (`<Modal open={showAllParticipants}`) mounts `<Modal open onClose>` with no `initialFocusRef`,
    // so the `Modal.tsx` default stands — `<Modal.Header>`'s Close control.
    const close = within(dialog).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('5. focus, review Modal: on OPEN the header Close control; on CLOSE the NAMED "Add Review" trigger', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    const opener = await screen.findByRole('button', { name: 'Add Review' });
    opener.focus();
    await user.click(opener);
    const dialog = await screen.findByRole('dialog', { name: 'Write a Review' });
    // `page.js:3440` (`<Modal open={showReviewForm}`): `<Modal open onClose className="max-w-md">`, no `initialFocusRef`.
    const close = within(dialog).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('6. focus, session-delete ConfirmDialog opened from the KEBAB: Cancel on OPEN; the NAMED kebab trigger on CLOSE (the menu item that opened it unmounts)', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderGameDetail({ role: 'owner' });
    const sessions = await sessionsSection();
    const kebab = await within(sessions).findByRole('button', { name: 'Session actions' });
    await user.click(kebab);
    const list = document.getElementById(kebab.getAttribute('aria-controls') as string) as HTMLElement;
    await user.click(within(list).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('dialog', { name: 'Delete this session?' });
    // `ConfirmDialog.tsx` passes `initialFocusRef={cancelRef}` on button-only tiers (88-33 Task 4).
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    await user.click(cancel);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    // The menu ITEM that opened the dialog is gone with the closed menu, so the element that held
    // focus when the dialog opened is the kebab TRIGGER (`KebabMenu.js` restores to it on close,
    // before the dialog's FocusScope reads `activeElement`). NAMED identity, never "not body".
    await waitFor(() => expect(document.activeElement).toBe(kebab));
  });
});

// ---------------------------------------------------------------------------
// 88.6.1-25 — Requirement 1: an event link shows the screen that matches WHY the event did
// not load (D-01, D-02, D-03, D-41; AC-1..AC-7). Before this plan every failure, signed out
// included, said "Event not found". Comments here are line comments only (CF-9), and every
// absence is asserted after a POSITIVE settle signal (CF-26).
// ---------------------------------------------------------------------------

const REAL_LOCATION = window.location;
const SECOND_EVENT_ID = '88888888-8888-4888-8888-888888888888';
// AMENDED Phase 88.9-40 (SESSION-01): the latch key is the shared guard's — one per path + search,
// read from the CURRENT (stubbed) location — so every test stubs the location BEFORE setting it.
const signInLatch = () => signInLatchKey(window.location);
const UNAUTHORIZED = () => new ApiError('Unauthorized', 'unauthorized', 401);
const FORBIDDEN = () => new ApiError('Access denied', 'forbidden', 403);
const ACCOUNT_DELETED = () => new ApiError('gone', 'account_deleted', 410);
// Copy rows E1-E3 (88.6.1-COPY-TABLE.html, straight apostrophes per D-32 R8) and X1, the
// register's unauthorized line shipped by plan 88.6.1-07. Asserted byte-exactly.
const NO_ACCESS_TITLE = "You don't have access to this event";
const NO_ACCESS_DETAIL =
  "You may be signed in with a different account, or you haven't been invited yet.";
const EVENT_LOAD_FAILED = "Couldn't load this event";
const X1_SENTENCE = 'Your session may have expired. Sign in again to continue.';

// The useFetchErrorState.test.tsx idiom: set the document's visibility, then dispatch.
function fireVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
  document.dispatchEvent(new Event('visibilitychange'));
}

// C-4: jsdom cannot navigate, so window.location becomes a spy-able stub. Returns the
// replace spy. The origin fields keep next/link's URL helpers on solid ground.
function stubLocation({ search, hash = '' }: { search: string; hash?: string }) {
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
      pathname: '/gameDetail',
      search,
      hash,
      href: `http://localhost/gameDetail${search}${hash}`,
      replace,
      assign: vi.fn(),
    },
  });
  return replace;
}

// One macrotask inside act, so every settled promise and the commit after it have landed.
async function flushMacrotask() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

// Every request the page builds from a URL id (the first must_have's eight). The
// self-identity fetch is page chrome and is mocked as a hook, so it is not in this list.
function urlBuiltFetches(): Array<[string, unknown]> {
  return [
    ['getEvent', eventsAPI.getEvent],
    ['getEventSuggestions', suggestionsAPI.getEventSuggestions],
    ['getGroupMembers', groupsAPI.getGroupMembers],
    ['getEventRsvps', rsvpAPI.getEventRsvps],
    ['getEventBrings', eventBringsAPI.getEventBrings],
    ['getGame', gamesAPI.getGame],
    ['getGroupEvents', eventsAPI.getGroupEvents],
    ['getGameReviews', gameReviewsAPI.getGameReviews],
  ];
}

// Every fetch the page could make resolves to a harmless value, so a call shows up as a
// COUNT rather than as a crash that happens to look like zero requests.
function armAllFetches() {
  (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture());
  (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValue([]);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('owner'));
  (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
  (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([]);
  (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
  (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
}

function renderAt(search: string) {
  armAllFetches();
  h.selfUuid = SELF_UUID;
  h.search = search;
  return render(<GameDetailPage />);
}

async function findTextOrFail(text: string, context: string) {
  try {
    return await screen.findByText(text);
  } catch {
    throw new Error(`${context}: "${text}" never rendered`);
  }
}

// G5: a rejected game_id is "Game not found" with ZERO URL-built requests, whatever else
// the URL carries.
async function expectGameNotFoundWithZeroRequests(search: string) {
  renderAt(search);
  expect(await findTextOrFail('Game not found', search)).toBeInTheDocument();
  expect(screen.queryByText('No game selected')).toBeNull();
  expect(screen.queryByText('Event not found')).toBeNull();
  expect(screen.queryByText('Loading game night...', { selector: 'p' })).toBeNull();
  expect(screen.queryByText(/^Loading game details/)).toBeNull();
  // Zero requests leave userScope at 'none', so the scope-aware link is the Home one.
  expect(screen.getByRole('link', { name: '← Back to Home' })).toHaveAttribute('href', '/');
  await flushMacrotask();
  for (const [name, fn] of urlBuiltFetches()) {
    expect(fn, `${search}: ${name} must not be called`).not.toHaveBeenCalled();
  }
}

describe('gameDetail event link — Requirement 1 (88.6.1-25)', () => {
  afterEach(() => {
    // F9b (88.9-23): commitEventAction may install a fake clock mid-test; restore it here.
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: REAL_LOCATION,
    });
  });

  it('G1: a present-but-invalid event_id is "Event not found" with zero URL-built requests (AC-6)', async () => {
    // URLSearchParams decodes the second to ../users/me (the CSPT shape); the third is an
    // empty value, which counts as present; the fourth is a 35-character near-miss.
    const inputs = ['not-a-uuid', '..%2Fusers%2Fme', '', EVENT_ID.slice(0, -1)];
    for (const raw of inputs) {
      const context = `event_id=${raw}`;
      const replace = stubLocation({ search: `?event_id=${raw}&group_id=${GROUP_ID}` });
      renderAt(`event_id=${raw}&group_id=${GROUP_ID}`);
      expect(await findTextOrFail('Event not found', context)).toBeInTheDocument();
      expect(
        screen.getByText('This event no longer exists or has been cancelled.'),
        context
      ).toBeInTheDocument();
      await flushMacrotask();
      for (const [name, fn] of urlBuiltFetches().slice(0, 5)) {
        expect(fn, `${context}: ${name} must not be called`).not.toHaveBeenCalled();
      }
      expect(replace, `${context}: no sign-in redirect`).not.toHaveBeenCalled();
      cleanup();
      vi.clearAllMocks();
    }
  });

  it('G2 (control): a valid event_id fetches the event exactly once, with that id', async () => {
    renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(eventsAPI.getEvent).toHaveBeenCalledTimes(1);
    expect(eventsAPI.getEvent).toHaveBeenCalledWith(EVENT_ID);
  });

  it('G3: a traversal group_id on the event view is dropped; the roster comes from the event group (CSPT)', async () => {
    renderEventDetail({ urlGroupId: '..%2Fusers%2Fme' });
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith(GROUP_ID));
    expect(groupsAPI.getGroupMembers).not.toHaveBeenCalledWith('../users/me');
  });

  it('G4: a traversal group_id on the game view is dropped; no group-scoped fetch runs (CSPT)', async () => {
    renderGameDetail({ search: `game_id=${GAME_ID}&group_id=..%2Fx` });
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    await flushMacrotask();
    expect(eventsAPI.getGroupEvents).not.toHaveBeenCalled();
    expect(gameReviewsAPI.getGameReviews).not.toHaveBeenCalled();
    expect(groupsAPI.getGroupMembers).not.toHaveBeenCalled();
  });

  it('G5a: a traversal game_id is "Game not found" with zero requests (CSPT)', async () => {
    await expectGameNotFoundWithZeroRequests(`game_id=..%2Fusers%2Fme&group_id=${GROUP_ID}`);
  });

  it('G5b: a non-UUID game_id is "Game not found" with zero requests', async () => {
    await expectGameNotFoundWithZeroRequests('game_id=not-a-uuid');
  });

  it('G5c: a rejected game_id beside a VALID event id and group id is still "Game not found", never the event view', async () => {
    await expectGameNotFoundWithZeroRequests(
      `game_id=..%2Fusers%2Fme&event_id=${EVENT_ID}&group_id=${GROUP_ID}`
    );
  });

  it('F1: every back link on the message screens carries the phone 44px floor and the house focus ring', async () => {
    const scenarios: Array<{ label: string; linkName: string; setup: () => void }> = [
      {
        label: 'Event not found (a real 404)',
        linkName: '← Back to Home',
        setup: () => {
          renderEventDetail({ getEventRejectsWith: new ApiError('Not found', 'not_found', 404) });
        },
      },
      {
        label: 'No game selected',
        linkName: '← Back to Home',
        setup: () => {
          renderAt('');
        },
      },
      {
        label: 'Game not found, group member',
        linkName: '← Back to Group',
        setup: () => {
          renderGameDetail({ role: 'member', game: null });
        },
      },
      {
        label: 'Game not found, game-only caller with a group id',
        linkName: '← Back to Home',
        setup: () => {
          renderGameDetail({ role: 'game-only', game: null });
        },
      },
      {
        label: 'Game not found, no group id',
        linkName: '← Back to Home',
        setup: () => {
          renderGameDetail({ game: null, search: `game_id=${GAME_ID}` });
        },
      },
    ];
    for (const s of scenarios) {
      s.setup();
      const link = await screen.findByRole('link', { name: s.linkName });
      // An UNPREFIXED token: a breakpoint-gated min-h does not count (plan 21's rule).
      const tokens = link.className.split(/\s+/);
      expect(tokens, `${s.label}: the unprefixed min-h-11 floor`).toContain('min-h-11');
      expectFocusRing(tokens, `${s.label}: the house focus ring`);
      cleanup();
      vi.clearAllMocks();
    }
  });

  it('R1: a signed-out 401 replaces the page with sign-in once, returning to the same event and its #vote (AC-1)', async () => {
    h.userSub = undefined;
    const search = `?event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search, hash: '#vote' });
    renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${search}#vote`)
    );
    expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Event not found')).toBeNull();
    // Prohibition 1: the redirect path paints no event detail.
    expect(document.body.textContent).not.toContain('The Group');
    const returnTo = new URL(replace.mock.calls[0][0] as string, 'http://localhost').searchParams.get(
      'returnTo'
    ) as string;
    expect(returnTo.startsWith('/')).toBe(true);
    expect(returnTo.startsWith('//')).toBe(false);
  });

  it('R2: a 401 with a session the app still sees (stale) redirects too (D-01: any 401)', async () => {
    const search = `?event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search });
    renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${search}`)
    );
  });

  it('R3: a re-run of the event fetch while redirecting never replaces a second time (idempotency)', async () => {
    h.userSub = undefined;
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    const { rerender } = renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    h.selfUuid = '33333333-3333-4333-8333-333333333333';
    rerender(<GameDetailPage />);
    await waitFor(() => expect(eventsAPI.getEvent).toHaveBeenCalledTimes(2));
    await flushMacrotask();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('B1 (backstop, concurrency / R1): no redirect while the session is still loading; exactly one once it settles', async () => {
    h.userSub = undefined;
    h.authLoading = true;
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    const { rerender } = renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    await waitFor(() => expect(eventsAPI.getEvent).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Event not found')).toBeNull();
    h.authLoading = false;
    rerender(<GameDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  // AMENDED Phase 88.9-65 (X35): L1 reads the VISIBLE line only. The line is plain text outside
  // any live region (a status mounted holding its words is not announced, and a status takes no
  // name from its content); the words the loader SPEAKS are the X35 pin below, alone.
  it('L1: the shared loader reads copy row E4 on its visible line', async () => {
    renderGameDetail();
    const line = screen.getByText('Loading game night...', { selector: 'p' });
    expect(line).toBeInTheDocument();
    expect(screen.queryByText(/^Loading game details/)).toBeNull();
    expect(line.closest('[role="status"]'), 'the visible line is not inside a live region').toBeNull();
    // Settle, so the game's resolution does not land after cleanup.
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  // X35 (88.9-65, once-over R13): the loader is HEARD. Its polite region mounts empty and takes
  // its words after the house dwell (StatusRegion settleOnMount), so they arrive as a change; the
  // words are copy row E4's with ONE ellipsis character (VoiceOver reads three ASCII dots aloud,
  // VO-P2-7), and the visible line keeps E4 byte-equal. The EV-18 shape holds the loader: an
  // in-page key change whose game read stays in flight.
  it('X35 (88.9-65): the page loader\'s polite region mounts empty and says the loader words with one ellipsis character after the dwell; the visible line keeps copy row E4', async () => {
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: GAME_ID, name: 'Azul' }]);
    const r = renderEventDetail();
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    await screen.findByRole('button', { name: 'Azul' });
    const held = deferred(gamesAPI.getGame as Mock);
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
      r.rerender(<GameDetailPage />);
      // The loader's first commit.
      const line = screen.getByText('Loading game night...', { selector: 'p' });
      const region = (line.parentElement as HTMLElement).querySelector('[role="status"]');
      expect(region, 'the loader holds a polite region beside its visible line').not.toBeNull();
      expect(region).toHaveAttribute('aria-live', 'polite');
      expect(region).toHaveClass('sr-only');
      expect(region).toHaveTextContent('');
      expect(line.closest('[role="status"]'), 'the visible line is not inside the region').toBeNull();

      await act(async () => {
        vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
      });
      expect(region?.textContent).toBe('Loading game night…');
      expect(region?.textContent).not.toContain('...');
      // Copy row E4, byte-equal, on the visible line.
      expect(line.textContent).toBe('Loading game night...');
    } finally {
      vi.useRealTimers();
    }
    await act(async () => held.settle(GAME));
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('S1: a superseded event run never paints its bring indicators onto the next event (review r2 #29)', async () => {
    let settleA: (value: unknown) => void = () => {};
    // Event A's brings stay in flight; event B's resolve empty.
    (eventBringsAPI.getEventBrings as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleA = resolve;
          })
      )
      .mockResolvedValueOnce([]);
    const { rerender } = renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalledTimes(1));
    (eventsAPI.getEvent as Mock).mockResolvedValue(
      eventFixture({ id: SECOND_EVENT_ID, title: 'Second Night' })
    );
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Second Night' })).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalledTimes(2));
    await flushMacrotask();
    // A's held answer lands LAST and names B's participant.
    await act(async () => {
      settleA([{ User: { id: OTHER_UUID } }]);
    });
    await flushMacrotask();
    expect(screen.getByText('Someone Else')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'Bringing a game' })).toBeNull();
  });

  it('S2: a user-triggered bring refresh still paints the indicator (review r3 M-15)', async () => {
    renderEventDetail();
    expect(await screen.findByText('Someone Else')).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    expect(screen.queryByRole('img', { name: 'Bringing a game' })).toBeNull();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([{ User: { id: OTHER_UUID } }]);
    await act(async () => {
      rsvpProps.current?.onRsvpChange?.('yes');
    });
    expect(await screen.findByRole('img', { name: 'Bringing a game' })).toBeInTheDocument();
  });

  // ---- Phase 88.9-40 (SESSION-01, SPEC A8): the shared guard on both views ----

  // The game view's twin of R1 / C1: a primary 401 on the game read now takes the same answer arm.
  // Render helper, not renderGameDetail: the game read must be a rejection from the first call.
  function renderGameRejecting(error: unknown, search: string) {
    h.selfUuid = SELF_UUID;
    h.search = search;
    (gamesAPI.getGame as Mock).mockRejectedValue(error);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('member'));
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
    return renderPage(false);
  }

  it('SESSION-01 (88.9): a game link whose read answers 401 goes to sign-in once with the game as returnTo; back with the latch set it is the game banner with Sign in, never a second redirect; then game B in the same mount redirects once', async () => {
    const searchA = `?game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search: searchA });
    renderGameRejecting(UNAUTHORIZED(), searchA.slice(1));
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(replace).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${searchA}`)
    );
    const keyA = signInLatch();
    expect(window.sessionStorage.getItem(keyA)).toBe('1');
    // The redirect frame is the loader, never the banner (P-5).
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    cleanup();

    // Back with the latch set: the game banner with X1 and Sign in, no second redirect.
    const r = renderGameRejecting(UNAUTHORIZED(), searchA.slice(1));
    expect(await screen.findByText(GAME_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByText(X1_SENTENCE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem(keyA)).toBe('1');

    // Game B in the same mount: the clean slate resets the decision, B's own latch is clear, so one
    // replace with B as returnTo; A's latch is untouched.
    const searchB = `?game_id=${SECOND_GAME_ID}&group_id=${GROUP_ID}`;
    const replaceB = stubLocation({ search: searchB });
    h.search = searchB.slice(1);
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(replaceB).toHaveBeenCalledTimes(1));
    expect(replaceB).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${searchB}`)
    );
    expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
    expect(window.sessionStorage.getItem(keyA)).toBe('1');
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('A-40 (88.9-52): a game read that answers 401 while the session is still loading holds the loader, never the banner; one redirect once it settles', async () => {
    // Review 88.9-52 A-40: the game fetch does not wait for useUser, and the hook's hold is not
    // armed while auth loads, so the load-failed banner painted before the loader and the redirect.
    const search = `?game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search });
    h.authLoading = true;
    const r = renderGameRejecting(UNAUTHORIZED(), search.slice(1));
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalled());
    await flushMacrotask();
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    h.authLoading = false;
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
  });

  it("SESSION-01 (88.9): another event in the same mount decides afresh — A declined with its latch set, B's 401 redirects once with B as returnTo, A's latch untouched", async () => {
    const searchA = `?event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
    const replaceA = stubLocation({ search: searchA });
    window.sessionStorage.setItem(signInLatch(), '1');
    const keyA = signInLatch();
    const r = renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(replaceA).not.toHaveBeenCalled();

    const searchB = `?event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    const replaceB = stubLocation({ search: searchB });
    h.search = searchB.slice(1);
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(replaceB).toHaveBeenCalledTimes(1));
    expect(replaceB).toHaveBeenCalledWith(
      '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${searchB}`)
    );
    expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
    expect(window.sessionStorage.getItem(keyA)).toBe('1');
    expect(replaceA).not.toHaveBeenCalled();
  });

  // ---- Task 2: every other answer the event fetch can get has its own honest screen ----

  it('C1: a 401 with the latch already set (back from sign-in) renders the E3 banner with X1, never a second redirect (AC-2)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    window.sessionStorage.setItem(signInLatch(), '1');
    renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByText(X1_SENTENCE)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Event not found')).toBeNull();
    // A 401 never clears the latch (review r2 #305): clearing it would rebuild the loop.
    expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
  });

  it('C2: a latch read that throws fails CLOSED: the banner, never a redirect (P-4)', async () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage blocked');
    });
    try {
      const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
      renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
      expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    } finally {
      getItem.mockRestore();
    }
  });

  it('C3: a latch write that throws fails CLOSED: the banner, never a redirect (P-4)', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage full');
    });
    try {
      const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
      renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
      expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
      expect(replace).not.toHaveBeenCalled();
    } finally {
      setItem.mockRestore();
    }
  });

  it('C4: a successful event load clears the latch', async () => {
    stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    window.sessionStorage.setItem(signInLatch(), '1');
    renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(signInLatch())).toBeNull());
  });

  it('C5: a 403 renders the no-access screen (E1, E2) with Back to Home, no banner, no redirect (AC-3)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    renderEventDetail({ getEventRejectsWith: FORBIDDEN() });
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    expect(screen.getByText(NO_ACCESS_DETAIL)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Home/ })).toHaveAttribute('href', '/');
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(screen.queryByText('Event not found')).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('C6: a 403 on the re-fetch of an event already on screen paints NO event detail (Prohibition 1)', async () => {
    const { rerender } = renderEventDetail({ eventOverrides: { location: 'The Cafe' } });
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.getByText(/The Cafe/)).toBeInTheDocument();
    (eventsAPI.getEvent as Mock).mockRejectedValue(FORBIDDEN());
    h.userSub = 'auth0|other-sub';
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    const text = document.body.textContent ?? '';
    for (const detail of ['Game Night', 'The Cafe', 'The Group', 'Someone Else']) {
      expect(text, `"${detail}" must not be on the no-access screen`).not.toContain(detail);
    }
  });

  it('C7: back from sign-in (latch set) and the answer is 403: the no-access screen, no second redirect (SPEC adjacency / R1)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    window.sessionStorage.setItem(signInLatch(), '1');
    renderEventDetail({ getEventRejectsWith: FORBIDDEN() });
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('C7b: an answer that proves the session (403) clears the latch (review r2 #305)', async () => {
    stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    window.sessionStorage.setItem(signInLatch(), '1');
    renderEventDetail({ getEventRejectsWith: FORBIDDEN() });
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(signInLatch())).toBeNull());
  });

  it('C8: a 404 keeps today\'s words, now as a heading, with the Back link, no banner and no redirect (AC-4)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    renderEventDetail({ getEventRejectsWith: new ApiError('Not found', 'not_found', 404) });
    expect(await screen.findByText('This event no longer exists or has been cancelled.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to Home/ })).toHaveAttribute('href', '/');
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    // The heading half (review r2 #180): the title is found by its heading role.
    expect(screen.getByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
  });

  it('C9: a 500 renders the E3 banner with the register line, and Try again loads the event (AC-5)', async () => {
    const user = userEvent.setup();
    renderEventDetail({ getEventRejectsWith: new ApiError('Server error', 'internal', 500) });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(
      screen.getByText('Something went wrong on our end. Please try again shortly.')
    ).toBeInTheDocument();
    expect(screen.queryByText('Event not found')).toBeNull();
    (eventsAPI.getEvent as Mock).mockResolvedValueOnce(eventFixture());
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(eventsAPI.getEvent).toHaveBeenCalledTimes(2);
  });

  it('C10: a network failure renders the E3 banner with the register network line (AC-5)', async () => {
    renderEventDetail({ getEventRejectsWith: new ApiError('Network error', 'network', 0) });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(
      screen.getByText("We couldn't reach the server. Check your connection and try again.")
    ).toBeInTheDocument();
    expect(screen.queryByText('Event not found')).toBeNull();
  });

  it('C11: a 410 account_deleted holds the loader while the identity recheck is in flight (D-02)', async () => {
    // The recheck never settles in this test: the goodbye route is under way.
    h.selfRefetch.mockReturnValue(new Promise(() => {}));
    renderEventDetail({ getEventRejectsWith: ACCOUNT_DELETED() });
    await waitFor(() => expect(h.selfRefetch).toHaveBeenCalled());
    await flushMacrotask();
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Event not found')).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
  });

  it('C11b: a 410 whose identity recheck settles with no redirect falls through to the E3 banner, never a dead-end loader (review r2 #31)', async () => {
    h.selfRefetch.mockResolvedValue({});
    renderEventDetail({ getEventRejectsWith: ACCOUNT_DELETED() });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryByText('Event not found')).toBeNull();
  });

  it('C12 (control, P-2): a roster 403 after a good event leaves the event rendered', async () => {
    renderEventDetail();
    // renderEventDetail arms getGroupMembers to resolve; the roster is fetched only after the
    // event resolves, so re-arming it here (synchronously after render) is in time.
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(FORBIDDEN());
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith(GROUP_ID));
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
  });

  it('C13: a DIFFERENT event that fails starts from a clean slate: the banner, never the previous event', async () => {
    const { rerender } = renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    (eventsAPI.getEvent as Mock).mockRejectedValue(new ApiError('Server error', 'internal', 500));
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    rerender(<GameDetailPage />);
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText('Game Night')).toBeNull();
  });

  it('C14: a DIFFERENT event drops the previous event\'s role: no owner controls on a roster 403 (review r2 #30)', async () => {
    const { rerender } = renderEventDetail({ role: 'owner' });
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Edit Event' })).toBeInTheDocument();
    (eventsAPI.getEvent as Mock).mockResolvedValue(
      eventFixture({ id: SECOND_EVENT_ID, title: 'Second Night' })
    );
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(FORBIDDEN());
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Second Night' })).toBeInTheDocument();
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledTimes(2));
    await flushMacrotask();
    expect(screen.queryByRole('button', { name: 'Edit Event' })).toBeNull();
    // The kebab TRIGGER, not its Cancel item: an item is not in the DOM until the menu opens
    // (review r3 L-12), so a Cancel query could never fail.
    expect(screen.queryByRole('button', { name: 'Event actions' })).toBeNull();
  });

  it('C15: a final answer (404) does not refetch on refocus; a failure that can change (500) does (review r2 #139)', async () => {
    try {
      renderEventDetail({ getEventRejectsWith: new ApiError('Not found', 'not_found', 404) });
      expect(await screen.findByText('Event not found')).toBeInTheDocument();
      fireVisibility('visible');
      await flushMacrotask();
      expect(eventsAPI.getEvent, '404: refocus must not refetch').toHaveBeenCalledTimes(1);
      cleanup();
      vi.clearAllMocks();
      // The armed side: without it, C15 could pass because no listener exists at all.
      renderEventDetail({ getEventRejectsWith: new ApiError('Server error', 'internal', 500) });
      expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
      fireVisibility('visible');
      await waitFor(() => expect(eventsAPI.getEvent, '500: refocus refetches').toHaveBeenCalledTimes(2));
    } finally {
      delete (document as unknown as { visibilityState?: string }).visibilityState;
    }
  });

  // ---- Task 3: the event's own group wins (D-41, AC-7, D-03) ----

  // The props the edit modal's CreateEvent received most recently.
  function lastCreateEventGroupId() {
    const last = h.createEventProps[h.createEventProps.length - 1];
    return last?.group_id;
  }

  it('A1: from a link with no group_id, cancelling goes to the event\'s own group (AC-7)', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', urlGroupId: null });
    const { list } = await openEventActions(user);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/groupHomePage?id=${GROUP_ID}`));
  });

  it('A2: from a link with no group_id, the edit modal receives the event\'s own group (AC-7)', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', urlGroupId: null });
    await user.click(await screen.findByRole('button', { name: 'Edit Event' }));
    await waitFor(() => expect(h.createEventProps.length).toBeGreaterThan(0));
    expect(lastCreateEventGroupId()).toBe(GROUP_ID);
  });

  it('A3: from a link with no group_id, a Recommended Games tap keeps the event\'s own group (D-03)', async () => {
    const user = userEvent.setup();
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: 'g-azul', name: 'Azul' }]);
    renderEventDetail({ role: 'owner', urlGroupId: null });
    await user.click(await screen.findByRole('button', { name: 'Azul' }));
    expect(h.push).toHaveBeenCalledWith(`/gameDetail?game_id=g-azul&group_id=${GROUP_ID}`);
  });

  it('A4: a DIFFERENT valid URL group_id loses to the event\'s own group at every site, and suggestions are fetched once (D-41, review r2 #140)', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', urlGroupId: URL_ONLY_GROUP_ID });
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith(GROUP_ID));
    expect(groupsAPI.getGroupMembers).not.toHaveBeenCalledWith(URL_ONLY_GROUP_ID);
    await user.click(await screen.findByRole('button', { name: 'Edit Event' }));
    await waitFor(() => expect(h.createEventProps.length).toBeGreaterThan(0));
    expect(lastCreateEventGroupId()).toBe(GROUP_ID);
    const { list } = await openEventActions(user);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/groupHomePage?id=${GROUP_ID}`));
    // getEventSuggestions is event-scoped: the group only decides WHETHER to ask, so the URL hint
    // giving way to the event's group must not ask a second time.
    await flushMacrotask();
    expect(suggestionsAPI.getEventSuggestions).toHaveBeenCalledTimes(1);
  });

  it('A5 (control): a URL group_id equal to the event\'s group carries that group at every site', async () => {
    const user = userEvent.setup();
    (eventsAPI.deleteEvent as Mock).mockResolvedValue({});
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: 'g-azul', name: 'Azul' }]);
    renderEventDetail({ role: 'owner', urlGroupId: GROUP_ID });
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalledWith(GROUP_ID));
    await user.click(await screen.findByRole('button', { name: 'Azul' }));
    expect(h.push).toHaveBeenCalledWith(`/gameDetail?game_id=g-azul&group_id=${GROUP_ID}`);
    await user.click(await screen.findByRole('button', { name: 'Edit Event' }));
    await waitFor(() => expect(h.createEventProps.length).toBeGreaterThan(0));
    expect(lastCreateEventGroupId()).toBe(GROUP_ID);
    const { list } = await openEventActions(user);
    await commitEventAction(user, within(list).getByRole('button', { name: 'Cancel event' }));
    await waitFor(() => expect(h.push).toHaveBeenCalledWith(`/groupHomePage?id=${GROUP_ID}`));
  });

  it('S3: a superseded event\'s suggestions never land on the next event (clean-slate rule, Rule 2 deviation)', async () => {
    let settleA: (value: unknown) => void = () => {};
    // Event A's suggestions stay in flight; event B's resolve empty.
    (suggestionsAPI.getEventSuggestions as Mock)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            settleA = resolve;
          })
      )
      .mockResolvedValueOnce([]);
    const { rerender } = renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    (eventsAPI.getEvent as Mock).mockResolvedValue(
      eventFixture({ id: SECOND_EVENT_ID, title: 'Second Night' })
    );
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Second Night' })).toBeInTheDocument();
    await waitFor(() => expect(suggestionsAPI.getEventSuggestions).toHaveBeenCalledTimes(2));
    await flushMacrotask();
    // A's held answer lands LAST.
    await act(async () => {
      settleA([{ id: 'g-azul', name: 'Azul' }]);
    });
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Second Night' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Azul' })).toBeNull();
  });

  it('S4: suggestions that land before identity resolves survive the identity re-run of the SAME event (wave 4 CI gate)', async () => {
    // CI run 38878098281 (game-suggestion-card.spec.ts, phone): Recommended Games never rendered.
    // The first event load is still in flight when identity resolves, so the fetch effect re-runs
    // fetchEventOnly for the same event before the first run stamped it as loaded. That re-run's
    // reset used to clear the suggestions, and the suggestions effect (keyed on the event, not on
    // identity) never asked again. S3 above still pins the different-event half of the rule.
    let settleFirstGetEvent: (value: unknown) => void = () => {};
    (eventsAPI.getEvent as Mock).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          settleFirstGetEvent = resolve;
        })
    );
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([
      { id: 'g-catan', name: 'Catan' },
    ]);
    const { rerender } = renderEventDetail({ identityPending: true });
    // The suggestions answer lands while the first event load is still held.
    await waitFor(() => expect(suggestionsAPI.getEventSuggestions).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    // Identity resolves: the fetch effect re-runs fetchEventOnly for the SAME event.
    h.selfUuid = SELF_UUID;
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Catan' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Recommended Games' })).toBeInTheDocument();
    // Suggestions are event-scoped: the identity re-run must not ask again.
    expect(suggestionsAPI.getEventSuggestions).toHaveBeenCalledTimes(1);
    // The superseded first load settles last and applies nothing.
    await act(async () => {
      settleFirstGetEvent(eventFixture());
    });
    await flushMacrotask();
    expect(screen.getByRole('button', { name: 'Catan' })).toBeInTheDocument();
  });

  it('S5: suggestions already on screen for one event are cleared when the page moves to a DIFFERENT event (the other half of S4)', async () => {
    // S4 narrowed the clean-slate clear to an event id change; this pins that the narrowed clear
    // still fires for a new event. Event A's suggestions render; event B's stay in flight, so
    // anything still showing on B can only be A's.
    (suggestionsAPI.getEventSuggestions as Mock)
      .mockResolvedValueOnce([{ id: 'g-azul', name: 'Azul' }])
      .mockImplementationOnce(() => new Promise(() => {}));
    const { rerender } = renderEventDetail();
    expect(await screen.findByRole('button', { name: 'Azul' })).toBeInTheDocument();
    (eventsAPI.getEvent as Mock).mockResolvedValue(
      eventFixture({ id: SECOND_EVENT_ID, title: 'Second Night' })
    );
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Second Night' })).toBeInTheDocument();
    await waitFor(() => expect(suggestionsAPI.getEventSuggestions).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('button', { name: 'Azul' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recommended Games' })).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-52 (R10 / AC-31, shared rule 12) — typed line breaks at the game page's three
// typed-text sites: the session card's comments, the own review and the other reviews.
// The jsdom half pins the two classes and the typed characters; the layout half (separate lines,
// no overflow at 375px) is e2e/typed-line-breaks.spec.ts, which runs in CI's phone project.
// Elements are found by EXACT textContent: Testing Library's text matchers collapse whitespace,
// which would hide the very thing under test.
// ---------------------------------------------------------------------------
function exactTextElements(root: HTMLElement, tag: string, text: string): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(tag)).filter((el) => el.textContent === text);
}

function expectTypedTextClasses(el: HTMLElement) {
  expect(el).toHaveClass('whitespace-pre-line');
  expect(el).toHaveClass('wrap-anywhere');
}

const OTHER_REVIEW = {
  ...SAVED_REVIEW,
  id: 'rev-other',
  User: { id: OTHER_UUID, username: 'Someone Else' },
};

describe('gameDetail typed line breaks (R10, 88.6.1-52)', () => {
  it('R10-1: the session comments paragraph keeps a typed line break and wraps a long string', async () => {
    renderGameDetail({ events: [{ ...SESSION, comments: 'Line one\nLine two' }] });
    const section = await sessionsSection();
    const matches = exactTextElements(section, 'p', 'Line one\nLine two');
    expect(matches).toHaveLength(1);
    expectTypedTextClasses(matches[0]);
    expect(matches[0].textContent).toContain('\n');
  });

  it('R10-2: the own-review paragraph keeps a typed line break and wraps a long string', async () => {
    renderGameDetail({ role: 'member', reviews: [{ ...SAVED_REVIEW, review_text: 'Mine one\nMine two' }] });
    const section = await reviewsSection();
    await within(section).findByText('(You)');
    const matches = exactTextElements(section, 'p', 'Mine one\nMine two');
    expect(matches).toHaveLength(1);
    expectTypedTextClasses(matches[0]);
    expect(matches[0].textContent).toContain('\n');
  });

  it('R10-3: an other-review paragraph keeps a typed line break and wraps a long string', async () => {
    renderGameDetail({ role: 'member', reviews: [{ ...OTHER_REVIEW, review_text: 'Theirs one\nTheirs two' }] });
    const section = await reviewsSection();
    await within(section).findByText('Someone Else');
    const matches = exactTextElements(section, 'p', 'Theirs one\nTheirs two');
    expect(matches).toHaveLength(1);
    expectTypedTextClasses(matches[0]);
    expect(matches[0].textContent).toContain('\n');
  });

  // SPEC Edge Coverage encoding / R10 (an AC-31 pin, green before and after by construction):
  // the value is a React text child, so markup in it renders as its own characters.
  it('R10-4: typed markup renders literally at all three sites and no b element exists', async () => {
    renderGameDetail({
      role: 'member',
      events: [{ ...SESSION, comments: '<b>x</b>' }],
      reviews: [
        { ...SAVED_REVIEW, review_text: '<b>x</b>' },
        { ...OTHER_REVIEW, review_text: '<b>x</b>' },
      ],
    });
    const sessions = await sessionsSection();
    const reviews = await reviewsSection();
    await within(reviews).findByText('(You)');
    await within(reviews).findByText('Someone Else');
    expect(exactTextElements(sessions, 'p', '<b>x</b>')).toHaveLength(1);
    expect(exactTextElements(reviews, 'p', '<b>x</b>')).toHaveLength(2);
    expect(sessions.querySelector('b')).toBeNull();
    expect(reviews.querySelector('b')).toBeNull();
  });

  // SPEC Edge Coverage empty / R10 (backstop, held out). Three spaces render as typed; three
  // newlines render as two (owner ruling #115: a run of three or more breaks is one blank line).
  it('R10-5: whitespace-only and blank-line values render as their rendered text with both classes', async () => {
    renderGameDetail({
      role: 'member',
      events: [
        { ...SESSION, id: 'evt-ws-1', comments: '   ' },
        { ...SESSION, id: 'evt-ws-2', start_date: '2026-01-10T18:00:00Z', comments: '\n\n\n' },
      ],
      reviews: [
        { ...SAVED_REVIEW, review_text: '\n\n\n' },
        { ...OTHER_REVIEW, review_text: '   ' },
      ],
    });
    await screen.findByRole('heading', { name: 'Game Sessions (2)' });
    const sessions = await sessionsSection();
    const reviews = await reviewsSection();
    await within(reviews).findByText('(You)');
    const cases: Array<[HTMLElement, string]> = [
      [sessions, '   '],
      [sessions, '\n\n'],
      [reviews, '\n\n'],
      [reviews, '   '],
    ];
    for (const [root, rendered] of cases) {
      const matches = exactTextElements(root, 'p', rendered);
      expect(matches, `one paragraph renders ${JSON.stringify(rendered)}`).toHaveLength(1);
      expectTypedTextClasses(matches[0]);
      expect(matches[0].textContent).toBe(rendered);
    }
  });

  // Owner ruling #115 (2026-10-13): a flood of typed breaks renders as one blank line, at render
  // only, through plan 88.6.1-84's collapseBlankLines.
  it('R10-6: 5000 typed breaks render as one blank line at all three sites', async () => {
    const flood = '\n'.repeat(5000);
    renderGameDetail({
      role: 'member',
      events: [{ ...SESSION, comments: `S-top${flood}S-end` }],
      reviews: [
        { ...SAVED_REVIEW, review_text: `M-top${flood}M-end` },
        { ...OTHER_REVIEW, review_text: `T-top${flood}T-end` },
      ],
    });
    const sessions = await sessionsSection();
    const reviews = await reviewsSection();
    await within(reviews).findByText('(You)');
    await within(reviews).findByText('Someone Else');
    const cases: Array<[HTMLElement, string]> = [
      [sessions, 'S-top\n\nS-end'],
      [reviews, 'M-top\n\nM-end'],
      [reviews, 'T-top\n\nT-end'],
    ];
    for (const [root, rendered] of cases) {
      const matches = exactTextElements(root, 'p', rendered);
      expect(matches, `one paragraph renders ${JSON.stringify(rendered)}`).toHaveLength(1);
      expectTypedTextClasses(matches[0]);
    }
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-52 (D-25, copy row E5, AC-32) — a backwards Sessions date range explains itself.
// The ratified sentence shows under To Date through the house FormField (role="alert", the To
// input aria-invalid and described by it) only while BOTH values are complete dates and To sorts
// before From. Every absence assertion follows a positive settle on the input's own value.
// ---------------------------------------------------------------------------
const E5_TEXT = 'To Date must be on or after From Date.';

async function openSessionFilters() {
  fireEvent.click(await screen.findByRole('button', { name: /Show Filters/ }));
  return {
    from: screen.getByLabelText('From Date') as HTMLInputElement,
    to: screen.getByLabelText('To Date') as HTMLInputElement,
  };
}

function expectToDateValid(to: HTMLInputElement) {
  expect(screen.queryByText(E5_TEXT)).toBeNull();
  expect(to).not.toHaveAttribute('aria-invalid');
  expect(to).not.toHaveAttribute('aria-describedby');
}

describe('gameDetail Sessions date filter explains a backwards range (E5, 88.6.1-52)', () => {
  it('E5-1: a To date before the From date shows E5 as an alert wired to the To input', async () => {
    renderGameDetail({ role: 'member' });
    const { from, to } = await openSessionFilters();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    const msg = await screen.findByText(E5_TEXT);
    expect(msg).toHaveAttribute('role', 'alert');
    expect(msg.id).toBe('session-filter-date-to-error');
    expect(to).toHaveAttribute('aria-invalid', 'true');
    expect(to).toHaveAttribute('aria-describedby', msg.id);
    expect(from).not.toHaveAttribute('aria-invalid');
  });

  // SPEC Edge Coverage empty / R11: the empty list now says why it is empty.
  it('E5-2: the empty session list and E5 show together', async () => {
    renderGameDetail({ role: 'member' });
    const { from, to } = await openSessionFilters();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    expect(await screen.findByText('No sessions match your filters.')).toBeInTheDocument();
    expect(screen.getByText(E5_TEXT)).toBeInTheDocument();
  });

  it('E5-3: clearing To removes E5 and both attributes, and equal dates are valid', async () => {
    renderGameDetail({ role: 'member' });
    const { from, to } = await openSessionFilters();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    expect(await screen.findByText(E5_TEXT)).toBeInTheDocument();

    fireEvent.change(to, { target: { value: '' } });
    expect(to.value).toBe('');
    expectToDateValid(to);

    fireEvent.change(from, { target: { value: '2026-05-01' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    expect(from.value).toBe('2026-05-01');
    expect(to.value).toBe('2026-05-01');
    expectToDateValid(to);
  });

  // 88.9-52 round 4 (R4-A2): the To date is a calendar day in the viewer's zone (UTC in this file),
  // read through the house date-only helper. new Date('2026-01-15') is UTC midnight, and the old
  // setHours(23, 59, 59, 999) then ended the day in the BROWSER's zone: in Pacific that was
  // 07:59 UTC on the 15th, so a session at 18:00 UTC on the To date itself was filtered out. The
  // test sets the process zone itself, so it is red on the old code on any host.
  it('R4-A2: a To date keeps the sessions of that day itself, whatever zone the browser is in', async () => {
    const hostTz = process.env.TZ;
    process.env.TZ = 'America/Los_Angeles';
    try {
      renderGameDetail({ role: 'member' });
      const { from, to } = await openSessionFilters();
      fireEvent.change(to, { target: { value: '2026-01-15' } });
      expect(to.value).toBe('2026-01-15');
      expect(await screen.findByRole('heading', { name: 'Game Sessions (1)' })).toBeInTheDocument();
      expect(screen.queryByText('No sessions match your filters.')).toBeNull();
      // The day before still excludes it, and a From date on the day itself keeps it.
      fireEvent.change(to, { target: { value: '2026-01-14' } });
      expect(await screen.findByText('No sessions match your filters.')).toBeInTheDocument();
      fireEvent.change(to, { target: { value: '' } });
      fireEvent.change(from, { target: { value: '2026-01-15' } });
      expect(await screen.findByRole('heading', { name: 'Game Sessions (1)' })).toBeInTheDocument();
      fireEvent.change(from, { target: { value: '2026-01-16' } });
      expect(await screen.findByText('No sessions match your filters.')).toBeInTheDocument();
    } finally {
      if (hostTz === undefined) delete process.env.TZ;
      else process.env.TZ = hostTz;
    }
  });

  // Control (green before and after): zero look change at rest.
  it('E5-4: at rest the To label keeps its exact classes and the To input carries no error wiring', async () => {
    renderGameDetail({ role: 'member' });
    const { to } = await openSessionFilters();
    const toLabel = document.querySelector('label[for="session-filter-date-to"]') as HTMLLabelElement;
    const fromLabel = document.querySelector('label[for="session-filter-date-from"]') as HTMLLabelElement;
    expect(toLabel.className).toBe('block text-sm text-content-secondary mb-1');
    expect(toLabel.textContent).toBe('To Date');
    expect(fromLabel.className).toBe('block text-sm text-content-secondary mb-1');
    expect(to).not.toHaveAttribute('aria-invalid');
    expect(to).not.toHaveAttribute('aria-describedby');
  });

  // #212: Chrome hands the page progressive year values (0002-, 0020-, 0202-) while a desktop
  // year is typed; a raw string compare would alert mid-entry because '0002' sorts before '2026'.
  it('E5-5: a year still being typed shows no E5', async () => {
    renderGameDetail({ role: 'member' });
    const { from, to } = await openSessionFilters();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    expect(await screen.findByText(E5_TEXT)).toBeInTheDocument();

    fireEvent.change(to, { target: { value: '0002-05-01' } });
    expect(to.value).toBe('0002-05-01');
    expectToDateValid(to);
  });

  // #59: a five-digit year. A raw string compare sorts '10000-' before '2026-' by its first
  // character. jsdom keeps the value (its date sanitiser accepts four or more year digits); the
  // read-back below is this arm's precondition.
  it('E5-6: a five-digit year shows no E5', async () => {
    renderGameDetail({ role: 'member' });
    const { from, to } = await openSessionFilters();
    fireEvent.change(from, { target: { value: '2026-05-10' } });
    fireEvent.change(to, { target: { value: '2026-05-01' } });
    expect(await screen.findByText(E5_TEXT)).toBeInTheDocument();

    fireEvent.change(to, { target: { value: '10000-01-01' } });
    expect(to.value).toBe('10000-01-01');
    expectToDateValid(to);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-52 (D-46 / AC-23, R7-M7) — both gameDetail breadcrumbs reach the house standard:
// the house focus ring on the Home and group links (DECISION Phase 88.3-17, per site), the ">"
// separators hidden from assistive tech, and min-w-0 on the nav. Separators are read by TEXT, as
// groupPlanning/page.test.tsx explains: a role query would pass without the attribute.
// ---------------------------------------------------------------------------
function expectHouseBreadcrumb(nav: HTMLElement) {
  for (const token of ['inline-block', 'max-w-full', 'wrap-break-word', 'min-w-0']) {
    expect(nav).toHaveClass(token);
  }
  const links = within(nav).getAllByRole('link');
  expect(links).toHaveLength(2);
  for (const link of links) {
    expect(link.className.split(/\s+/)).toContain('focus:outline-hidden');
    expectFocusRing(link, link.textContent ?? '');
  }
  const separators = within(nav).getAllByText('>');
  expect(separators).toHaveLength(2);
  for (const sep of separators) {
    expect(sep).toHaveAttribute('aria-hidden', 'true');
  }
}

describe('gameDetail breadcrumbs — ring, hidden separators, min-w-0 (D-46 / R7-M7, 88.6.1-52)', () => {
  it('BC-1: the event view breadcrumb rings Home and the group link, hides both separators and carries min-w-0', async () => {
    renderEventDetail({ role: 'owner' });
    await screen.findByRole('heading', { name: 'Game Night' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await within(nav).findByRole('link', { name: 'The Group' });
    expectHouseBreadcrumb(nav);
  });

  it('BC-2: the game view breadcrumb rings Home and the group link, hides both separators and carries min-w-0', async () => {
    renderGameDetail({ role: 'member' });
    await screen.findByRole('heading', { name: 'Wingspan' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    await within(nav).findByRole('link', { name: 'Group' });
    expectHouseBreadcrumb(nav);
  });

  it('W35 (88.9-52): the game view breadcrumb names the group once the group nights answer carries it; the word Group only until then, and again when the group content is withdrawn', async () => {
    // The game view never loads the group itself; every night in the group-nights answer carries
    // its Group (id + name), a read this view already makes.
    const named = { ...SESSION, id: 'evt-other-game', game_id: 'some-other-game', Group: { id: GROUP_ID, name: 'Weekend Warriors' } };
    const r = renderGameDetail({ role: 'member', events: [named] });
    await screen.findByRole('heading', { name: 'Wingspan' });
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const link = await within(nav).findByRole('link', { name: 'Weekend Warriors' });
    expect(link).toHaveAttribute('href', `/groupHomePage?id=${GROUP_ID}`);
    expect(within(nav).queryByRole('link', { name: 'Group' })).toBeNull();
    expectHouseBreadcrumb(nav);
    // A group read's 403 withdraws the group content: the name goes with it (no link either, the
    // viewer is no longer a member on this page).
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(new ApiError('Access denied', 'forbidden', 403));
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.queryByText('Weekend Warriors')).toBeNull());
  });

  it('W35 (88.9-52): from md up a session\'s participant chips sit side by side; on a phone they stay one per line', async () => {
    const withPeople = {
      ...SESSION,
      EventParticipations: [
        { user_id: OTHER_UUID, username: 'Someone Else', score: 10, placement: 1 },
        { user_id: null, username: 'Typed In', is_custom: true, score: 7, placement: 2 },
      ],
    };
    renderGameDetail({ role: 'member', events: [withPeople] });
    const label = await screen.findByText('Participants:');
    const list = label.nextElementSibling as HTMLElement;
    expect(list.children).toHaveLength(2);
    for (const cls of ['flex', 'flex-col', 'gap-2', 'md:flex-row', 'md:flex-wrap']) {
      expect(list.classList.contains(cls), `the chip list carries ${cls}`).toBe(true);
    }
    expect(list.classList.contains('space-y-2')).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------
// 88.6.1-74 — RF1 on the event and game views (owner ruling 2026-10-05, merits over record):
// a failed REFRESH over content already on screen keeps the content and says so; access and
// gone answers still withdraw it (plan 70's C10); focus never falls to <body> (C12).
// ---------------------------------------------------------------------------------------------

// Copy row RF1 / D-47 (contract C7): the ratified refresh-failed sentence, written once. It is
// expected TWICE while the notice shows (the visible line and its polite region).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const SERVER_500 = () => new ApiError('Server error', 'internal', 500);

// Force ONE same-key refresh of whatever the page shows, the way plan 25's C6 does: the fetch
// effect keys on `user?.sub`, so a changed sub re-runs it for the same event or game.
function forceRefresh(rerender: (ui: React.ReactElement) => void, sub = 'auth0|other-sub') {
  h.userSub = sub;
  rerender(<GameDetailPage />);
}

// The RF1 region: the `role="status"` node whose whole text is the sentence.
function rf1Region(): HTMLElement | undefined {
  return screen.getAllByRole('status').find((n) => n.textContent === RF1);
}

// Whether a region passed through EMPTY, read from the mutation RECORDS (EV-11). A textContent read
// inside the callback would see only the batch's end state and miss the pass through the empty
// string, so the flag comes from the records alone: a characterData record whose oldValue is the
// empty string (the node held nothing before it was set again), or a childList record that removed
// the region's text with no replacement.
function observeClear(region: HTMLElement): { cleared: () => boolean; disconnect: () => void } {
  const armedText = region.textContent ?? '';
  let cleared = false;
  const read = (records: MutationRecord[]) => {
    for (const rec of records) {
      if (rec.type === 'characterData' && rec.oldValue === '') cleared = true;
      if (
        rec.type === 'childList' &&
        rec.addedNodes.length === 0 &&
        armedText !== '' &&
        Array.from(rec.removedNodes).some((n) => n.textContent === armedText)
      ) {
        cleared = true;
      }
    }
  };
  const observer = new MutationObserver(read);
  observer.observe(region, { childList: true, characterData: true, characterDataOldValue: true, subtree: true });
  return {
    cleared: () => {
      read(observer.takeRecords());
      return cleared;
    },
    disconnect: () => observer.disconnect(),
  };
}

// Render the event view and reach a failed same-event refresh (EV-1's state).
async function reachEventRf1(options: RenderEventDetailOptions = {}) {
  const r = renderEventDetail(options);
  await screen.findByRole('heading', { name: 'Game Night' });
  (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
  forceRefresh(r.rerender);
  await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
  return r;
}

describe('gameDetail retained-content notice, event view — RF1 (88.6.1-74)', () => {
  afterEach(() => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: REAL_LOCATION,
    });
  });

  // Wave 7 CI gate (run 39020174955): the e2e arm's own sequence (gamedetail-refresh-failed.spec.ts,
  // event): the first load lands while identity is still pending, identity then resolves and that
  // same-key re-run's event read answers 500. In jsdom the event stays under RF1; the browser
  // withdrew it to the full banner, so the cause is outside this page's state machine as jsdom runs it.
  it('EV-20. identity resolving after the first load, then a failed re-run, keeps the event under RF1', async () => {
    const r = renderEventDetail({ identityPending: true });
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
    h.selfUuid = SELF_UUID;
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
  });

  // Wave 8 CI gate (run 39026336968, the spec's DIAG trail): the event view renders its record as
  // soon as the primary read succeeds (the `singleEvent` branch precedes the loader gate), while the
  // run's side reads are still in flight. In CI, identity resolved in that window: the same-key re-run
  // found no settled run for this key, took the new-key reset, flashed the loader over the event, and
  // its 500 landed on an empty page (the full banner). The e2e order: the first load's primary has
  // answered, its roster read is still out, identity resolves, the re-run's event read answers 500.
  it('EV-21. identity resolving while the first load\'s side reads are in flight keeps the event (no loader flash) and a failed re-run shows RF1', async () => {
    const r = renderEventDetail({ identityPending: true });
    const roster = deferred(groupsAPI.getGroupMembers as Mock);
    await screen.findByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(1));
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
    h.selfUuid = SELF_UUID;
    r.rerender(<GameDetailPage />);
    // The re-run starts in that commit: the event stays and the loader never replaces it.
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByText('Loading game night...', { selector: 'p' })).toBeNull();
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    // The superseded first run's late roster answer writes nothing over the re-run's outcome.
    await act(async () => roster.settle([]));
    expect(screen.getAllByText(RF1)).toHaveLength(2);
  });

  it('EV-1. a failed refresh keeps the event and shows RF1 with one Retry (C8 a)', async () => {
    await reachEventRf1();
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(screen.queryByText('Event not found')).toBeNull();
    const line = screen.getAllByText(RF1).find((n) => n.getAttribute('role') !== 'status');
    expect(line).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
  });

  it('EV-2. the RF1 region is a status node present before the failure (C8 b)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    const before = screen.getAllByRole('status');
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(rf1Region()).toBeTruthy());
    expect(before).toContain(rf1Region());
  });

  it('EV-3. Retry recovers and focus lands on the event heading (C8 c)', async () => {
    const user = userEvent.setup();
    await reachEventRf1();
    const calls = (eventsAPI.getEvent as Mock).mock.calls.length;
    (eventsAPI.getEvent as Mock).mockResolvedValueOnce(eventFixture());
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const heading = screen.getByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect((eventsAPI.getEvent as Mock).mock.calls.length).toBe(calls + 1);
  });

  it('EV-4. while a pressed Retry is held the event stays and Retry keeps focus (C2)', async () => {
    const user = userEvent.setup();
    await reachEventRf1();
    const held = deferred(eventsAPI.getEvent as Mock);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const button = await screen.findByRole('button', { name: 'Retry, retrying' });
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(button);
    await act(async () => held.settle(eventFixture()));
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
  });

  it('EV-5. a 403 refresh withdraws the event to E1, never RF1 (C10)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValue(FORBIDDEN());
    forceRefresh(r.rerender);
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    expect(screen.queryByText('Game Night')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-6. a 401 refresh redirects once and shows the loader, never RF1 (C10, C8 e)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValue(UNAUTHORIZED());
    forceRefresh(r.rerender);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Game Night')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-7. a 404 refresh is "Event not found", never RF1 (C10)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValue(new ApiError('Not found', 'not_found', 404));
    forceRefresh(r.rerender);
    expect(await screen.findByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-8. an account_deleted refresh holds the loader, never RF1 (C10)', async () => {
    h.selfRefetch.mockReturnValue(new Promise(() => {}));
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValue(ACCOUNT_DELETED());
    forceRefresh(r.rerender);
    expect(await screen.findByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    expect(screen.queryByText('Game Night')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('Event not found')).toBeNull();
  });

  it('EV-9. a FIRST-load failure is unchanged: the E3 banner, no RF1 (control)', async () => {
    renderEventDetail({ getEventRejectsWith: SERVER_500() });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-10. a superseded refresh that fails after a newer success shows no RF1 (ordering / R9)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    let failOlder: (e: unknown) => void = () => {};
    (eventsAPI.getEvent as Mock)
      .mockImplementationOnce(() => new Promise((_, reject) => { failOlder = reject; }))
      .mockResolvedValueOnce(eventFixture());
    forceRefresh(r.rerender, 'auth0|older-sub');
    forceRefresh(r.rerender, 'auth0|newer-sub');
    await waitFor(() => expect(eventsAPI.getEvent).toHaveBeenCalledTimes(3));
    await flushMacrotask();
    await act(async () => failOlder(SERVER_500()));
    await flushMacrotask();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
  });

  it('EV-11. a second failed Retry re-announces through the same node and keeps focus (R8 backstop)', async () => {
    const user = userEvent.setup();
    await reachEventRf1();
    const region = rf1Region() as HTMLElement;
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
    // AMENDED Phase 88.9-55 (R-C8): a synchronous empty read right after the click raced the clear-then-re-announce (two renders; under full-suite load the rejection settled inside the click's await and the read saw RF1, wave-8 run at 2bfdf14), so the pass through empty is observed from the mutation records, armed before the click.
    const clear = observeClear(region);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(region.textContent).toBe(RF1));
    expect(clear.cleared(), 'the region passed through empty before it re-announced').toBe(true);
    clear.disconnect();
    expect(rf1Region()).toBe(region);
    const button = screen.getByRole('button', { name: 'Retry' });
    expect(document.activeElement).toBe(button);
  });

  it('EV-12. a gone (410) refresh is plan 70\'s widened set: E3 with its register line, never RF1 (C10)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    const eGone = new ApiError('Gone', 'gone', 410);
    (eventsAPI.getEvent as Mock).mockRejectedValue(eGone);
    forceRefresh(r.rerender);
    expect(await screen.findByText(getFetchErrorMessage(eGone))).toBeInTheDocument();
    expect(screen.getByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText('Game Night')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-13. a network failure on refresh keeps the event under RF1 (C8 e)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(new ApiError('Network', 'network', 0));
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
  });

  it('EV-14. an unpressed 403 withdraws the event while Home holds focus: focus lands on E1\'s title (C12 a)', async () => {
    await reachEventRf1({ inMain: true });
    (eventsAPI.getEvent as Mock).mockRejectedValue(FORBIDDEN());
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    within(nav).getByRole('link', { name: 'Home' }).focus();
    await act(async () => fireVisibility('visible'));
    const title = await screen.findByRole('heading', { name: NO_ACCESS_TITLE });
    await waitFor(() => expect(document.activeElement).toBe(title));
    expect(screen.queryByText('Game Night')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  // A-56 (88.6.1 code review): the event banner (iii) carries the withdrawal target too.
  it('EV-14b. an unpressed gone (410) withdraws the event to the banner while Home holds focus: focus lands on the banner (C12 a)', async () => {
    await reachEventRf1({ inMain: true });
    (eventsAPI.getEvent as Mock).mockRejectedValue(new ApiError('Gone', 'gone', 410));
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    within(nav).getByRole('link', { name: 'Home' }).focus();
    await act(async () => fireVisibility('visible'));
    const bannerTitle = await screen.findByText(EVENT_LOAD_FAILED);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.querySelector('main'));
      expect(document.activeElement?.contains(bannerTitle)).toBe(true);
    });
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-15. Retry holds focus and an unpressed refresh succeeds: focus lands on the heading (C12 b)', async () => {
    await reachEventRf1();
    screen.getByRole('button', { name: 'Retry' }).focus();
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture());
    await act(async () => fireVisibility('visible'));
    const heading = screen.getByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('EV-16. a rejected event_id URL renders its screen without a ReferenceError (C12 a declaration order)', async () => {
    renderAt('event_id=not-a-uuid');
    expect(await screen.findByRole('heading', { name: 'Event not found' })).toBeInTheDocument();
  });

  it('EV-17. the event-to-game key change moves focus to main, never <body> (C12, #308 / H-01)', async () => {
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: GAME_ID, name: 'Azul' }]);
    const r = renderEventDetail({ inMain: true });
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    const card = await screen.findByRole('button', { name: 'Azul' });
    card.focus();
    expect(document.activeElement).toBe(card);
    h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('EV-18. an in-page key change never inserts a one-commit "Game not found" (L-02)', async () => {
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: GAME_ID, name: 'Azul' }]);
    const r = renderEventDetail();
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    await screen.findByRole('button', { name: 'Azul' });
    const held = deferred(gamesAPI.getGame as Mock);
    const added: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const rec of records) rec.addedNodes.forEach((n) => added.push(n));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    expect(await screen.findByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    for (const rec of observer.takeRecords()) rec.addedNodes.forEach((n) => added.push(n));
    expect(added.some((n) => (n.textContent ?? '').includes('Game not found'))).toBe(false);
    expect(screen.queryByText('Game not found')).toBeNull();
    await act(async () => held.settle(GAME));
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    for (const rec of observer.takeRecords()) rec.addedNodes.forEach((n) => added.push(n));
    observer.disconnect();
    expect(added.some((n) => (n.textContent ?? '').includes('Game not found'))).toBe(false);
  });

  it('EV-19. a REVISITED game key never inserts its stale game view for one commit (M2-01)', async () => {
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValueOnce([{ id: GAME_ID, name: 'Azul' }]);
    const r = renderEventDetail();
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    await screen.findByRole('button', { name: 'Azul' });
    h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await screen.findByRole('heading', { name: 'Wingspan' });
    h.search = `event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await screen.findByRole('heading', { name: 'Game Night' });
    const held = deferred(gamesAPI.getGame as Mock);
    const added: Node[] = [];
    const observer = new MutationObserver((records) => {
      for (const rec of records) rec.addedNodes.forEach((n) => added.push(n));
    });
    observer.observe(document.body, { childList: true, subtree: true });
    const isStaleTitle = (n: Node) =>
      n instanceof Element &&
      [n, ...Array.from(n.querySelectorAll('h1'))].some(
        (el) => el.tagName === 'H1' && el.textContent === 'Wingspan'
      );
    h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    expect(await screen.findByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
    for (const rec of observer.takeRecords()) rec.addedNodes.forEach((n) => added.push(n));
    expect(added.some(isStaleTitle)).toBe(false);
    expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
    observer.disconnect();
    await act(async () => held.settle(GAME));
    expect(await screen.findByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(gamesAPI.getGame).toHaveBeenCalledTimes(2);
  });
});

const GAME_LOAD_FAILED = "Couldn't load this game";
// A second valid game id (UUID-shaped, so plan 25's guard lets it through to a request).
const SECOND_GAME_ID = '99999999-9999-4999-8999-999999999999';

// Render the game view and reach a failed same-game refresh (GV-1's state).
async function reachGameRf1(options: RenderGameDetailOptions = {}) {
  const r = renderGameDetail(options);
  await screen.findByRole('heading', { name: 'Wingspan' });
  (gamesAPI.getGame as Mock).mockRejectedValueOnce(SERVER_500());
  forceRefresh(r.rerender);
  await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
  return r;
}

// A refresh whose primary read answers `error`, from a loaded game view.
async function refreshGameRejecting(error: unknown, options: RenderGameDetailOptions = {}) {
  const r = renderGameDetail(options);
  await screen.findByRole('heading', { name: 'Wingspan' });
  (gamesAPI.getGame as Mock).mockRejectedValue(error);
  forceRefresh(r.rerender);
  return r;
}

describe('gameDetail retained-content notice, game view — RF1 (88.6.1-74)', () => {
  it('GV-1. a failed refresh keeps the game and its lists and shows RF1 (C8 a)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    const sessions = (await screen.findByRole('heading', { name: /^Game Sessions \(\d+\)$/ })).textContent;
    (gamesAPI.getGame as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    expect(screen.queryByText('Game not found')).toBeNull();
    expect(screen.getByRole('heading', { name: /^Game Sessions \(/ }).textContent).toBe(sessions);
  });

  it('GV-2. the RF1 region is a status node present before the failure (C8 b)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    const before = screen.getAllByRole('status');
    (gamesAPI.getGame as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(rf1Region()).toBeTruthy());
    expect(before).toContain(rf1Region());
  });

  it('GV-3. Retry recovers and focus lands on the game title (C8 c)', async () => {
    const user = userEvent.setup();
    await reachGameRf1();
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const heading = screen.getByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-4. a pressed Retry keeps the notice and focus while held (C2)', async () => {
    const user = userEvent.setup();
    await reachGameRf1();
    const held = deferred(gamesAPI.getGame as Mock);
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    const button = await screen.findByRole('button', { name: 'Retry, retrying' });
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(document.activeElement).toBe(button);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    await act(async () => held.settle(GAME));
    await waitFor(() => expect(screen.queryAllByText(RF1)).toHaveLength(0));
  });

  it('GV-5. a failed FIRST load of a second game never shows the first game (C3)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    (gamesAPI.getGame as Mock).mockRejectedValue(SERVER_500());
    h.search = `game_id=${SECOND_GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalledWith(SECOND_GAME_ID));
    expect(await screen.findByText(GAME_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-5b. a 404 on a second game is "Game not found", never the first game (C3)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    (gamesAPI.getGame as Mock).mockRejectedValue(new ApiError('Not found', 'not_found', 404));
    h.search = `game_id=${SECOND_GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalledWith(SECOND_GAME_ID));
    expect(await screen.findByText('Game not found')).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
  });

  it('GV-6. a superseded refresh that fails after a newer success shows no RF1 (ordering / R9)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    let failOlder: (e: unknown) => void = () => {};
    (gamesAPI.getGame as Mock)
      .mockImplementationOnce(() => new Promise((_, reject) => { failOlder = reject; }))
      .mockResolvedValueOnce(GAME);
    forceRefresh(r.rerender, 'auth0|older-sub');
    forceRefresh(r.rerender, 'auth0|newer-sub');
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalledTimes(3));
    await flushMacrotask();
    await act(async () => failOlder(SERVER_500()));
    await flushMacrotask();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('GV-7. a 403 refresh drops the game to the full banner with its register line (C10, C8 e)', async () => {
    const e403 = new ApiError('Access denied', 'forbidden', 403);
    await refreshGameRejecting(e403);
    expect(await screen.findByText(messageBesideRetry(getFetchErrorMessage(e403)))).toBeInTheDocument();
    expect(screen.getByText(GAME_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-7b. a 404 refresh is "Game not found" (C10)', async () => {
    await refreshGameRejecting(new ApiError('Not found', 'not_found', 404));
    expect(await screen.findByText('Game not found')).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-8. a 401 refresh drops the game to the full banner with its register line (C10, C8 e) (latch set, 88.9-40)', async () => {
    const e401 = new ApiError('Unauthorized', 'unauthorized', 401);
    // AMENDED Phase 88.9-40 (SESSION-01): a 401 refresh now redirects once (the shared guard), so the
    // latch is set AFTER the loaded game (the load that succeeds clears a latch set before it) and
    // this test pins the DECLINED arm — the full banner it always held.
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    window.sessionStorage.setItem(signInLatch(), '1');
    (gamesAPI.getGame as Mock).mockRejectedValue(e401);
    forceRefresh(r.rerender);
    expect(await screen.findByText(getFetchErrorMessage(e401))).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-9. a network failure on refresh keeps the game under RF1 (C8 e)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    (gamesAPI.getGame as Mock).mockRejectedValueOnce(new ApiError('Network', 'network', 0));
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
  });

  it('GV-10. a gone (410) refresh is plan 70\'s widened set: the full banner, never RF1 (C10)', async () => {
    const eGone = new ApiError('Gone', 'gone', 410);
    await refreshGameRejecting(eGone);
    expect(await screen.findByText(getFetchErrorMessage(eGone))).toBeInTheDocument();
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  // AMENDED 2026-10-19 (88.6.1 code review A-56): focus lands on the banner that explains the
  // withdrawal (its box carries the withdrawal target), no longer on bare `main`.
  it('GV-11. an unpressed 403 withdraws the game while Home holds focus: focus lands on the banner (C12 a)', async () => {
    await reachGameRf1({ inMain: true });
    (gamesAPI.getGame as Mock).mockRejectedValue(new ApiError('Access denied', 'forbidden', 403));
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    within(nav).getByRole('link', { name: 'Home' }).focus();
    await act(async () => fireVisibility('visible'));
    const bannerTitle = await screen.findByText(GAME_LOAD_FAILED);
    await waitFor(() => {
      expect(document.activeElement).not.toBe(document.querySelector('main'));
      expect(document.activeElement?.contains(bannerTitle)).toBe(true);
    });
    expect(screen.queryByText('Wingspan')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-12. an unpressed 404 withdraws the game: focus lands on "Game not found" (C12 a, #338)', async () => {
    await reachGameRf1({ inMain: true });
    (gamesAPI.getGame as Mock).mockRejectedValue(new ApiError('Not found', 'not_found', 404));
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    within(nav).getByRole('link', { name: 'Home' }).focus();
    await act(async () => fireVisibility('visible'));
    const title = await screen.findByText('Game not found');
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('GV-13. Retry holds focus and an unpressed refresh succeeds: focus lands on the title (C12 b)', async () => {
    await reachGameRf1();
    screen.getByRole('button', { name: 'Retry' }).focus();
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    await act(async () => fireVisibility('visible'));
    const heading = screen.getByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('GV-14. a late event run cannot silence the game view\'s RF1 (cross-view supersede, #84)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([SESSION]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    const heldEvent = deferred(eventsAPI.getEvent as Mock);
    forceRefresh(r.rerender);
    await waitFor(() => expect(eventsAPI.getEvent).toHaveBeenCalledTimes(2));
    h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await screen.findByRole('heading', { name: 'Wingspan' });
    await act(async () => heldEvent.settle(eventFixture()));
    await flushMacrotask();
    (gamesAPI.getGame as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender, 'auth0|third-sub');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
  });

  it('GV-15. a late game run cannot silence the event view\'s RF1 (cross-view supersede, M-02)', async () => {
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture());
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([]);
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValue([]);
    const heldGame = deferred(gamesAPI.getGame as Mock);
    forceRefresh(r.rerender);
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalledTimes(2));
    h.search = `event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await screen.findByRole('heading', { name: 'Game Night' });
    await act(async () => heldGame.settle(GAME));
    await flushMacrotask();
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender, 'auth0|third-sub');
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
  });

  it('GV-16. a 404 never arms the tab-return re-attempt; a 500 does (review r2 #139)', async () => {
    await refreshGameRejecting(new ApiError('Not found', 'not_found', 404));
    await screen.findByText('Game not found');
    await flushMacrotask();
    const calls404 = (gamesAPI.getGame as Mock).mock.calls.length;
    await act(async () => fireVisibility('visible'));
    await flushMacrotask();
    expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(calls404);
    cleanup();
    h.userSub = 'auth0|self-sub';
    await reachGameRf1();
    const calls500 = (gamesAPI.getGame as Mock).mock.calls.length;
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    await act(async () => fireVisibility('visible'));
    await waitFor(() => expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(calls500 + 1));
  });

  // Carry-in (deferred-items.md, "The game view's `fetchGameData` has no per-run generation
  // guard"): two game ids in flight, the OLDER answer lands last, the newer game stays.
  it('CARRY-1. a superseded game load never paints over the next game (game-view generation guard)', async () => {
    let settleOlder: (v: unknown) => void = () => {};
    (gamesAPI.getGame as Mock).mockImplementationOnce(
      () => new Promise((resolve) => { settleOlder = resolve; })
    );
    const r = renderGameDetail();
    (gamesAPI.getGame as Mock).mockResolvedValue({ ...GAME, id: SECOND_GAME_ID, name: 'Azul' });
    await waitFor(() => expect(gamesAPI.getGame).toHaveBeenCalledWith(GAME_ID));
    h.search = `game_id=${SECOND_GAME_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    expect(await screen.findByRole('heading', { name: 'Azul' })).toBeInTheDocument();
    await act(async () => settleOlder(GAME));
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Azul' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
  });
});

// owner ruling D8-r2 (2026-10-13; copy rows GD1 / GD2 / E16) and its follow-up (2026-10-15; E17,
// E18, GD3, GD4): the seven never-loaded section lines, each written once here.
const REVIEWS_LOAD_FAILED = "Couldn't load reviews.";
const SESSIONS_LOAD_FAILED = "Couldn't load game sessions.";
const ROSTER_LOAD_FAILED = "Couldn't load who's coming.";
const REPLIES_LOAD_FAILED = "Couldn't load who's replied.";
const BRINGS_LOAD_FAILED = "Couldn't load who's bringing games.";
const MY_RSVPS_LOAD_FAILED = "Couldn't load your RSVPs.";
const GROUP_ROLE_LOAD_FAILED = "Couldn't load your group role.";
const SECTION_LINES = [
  REVIEWS_LOAD_FAILED,
  SESSIONS_LOAD_FAILED,
  ROSTER_LOAD_FAILED,
  REPLIES_LOAD_FAILED,
  BRINGS_LOAD_FAILED,
  MY_RSVPS_LOAD_FAILED,
  GROUP_ROLE_LOAD_FAILED,
];
const CODELESS = () => new Error('side read down');
const OTHER_YES = { rsvps: [{ User: { id: OTHER_UUID }, status: 'yes' }] };
const OTHER_BRINGS = [{ User: { id: OTHER_UUID } }];
const BRINGING = 'Bringing a game';
const UPCOMING_SESSION = {
  ...SESSION,
  id: 'evt-up',
  comments: 'Next week at the cafe',
  start_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
};
const SIDE_REVIEW = {
  id: 'rev-1',
  rating: 4,
  review_text: 'Great with five players',
  is_recommended: true,
  User: { id: OTHER_UUID, username: 'Someone Else' },
};
const CTA = 'Plan a game night with this';

// The visible line of a notice (never its polite region).
function visibleLine(text: string): HTMLElement {
  const line = screen.getAllByText(text).find((n) => n.getAttribute('role') !== 'status');
  if (!line) throw new Error(`no visible line for "${text}"`);
  return line;
}

// The Retry whose accessible description is the given notice line.
function retryFor(text: string): HTMLElement {
  const button = screen
    .getAllByRole('button', { name: 'Retry' })
    .find((b) => b.getAttribute('aria-describedby') && document.getElementById(b.getAttribute('aria-describedby') as string)?.textContent === text);
  if (!button) throw new Error(`no Retry described by "${text}"`);
  return button;
}

// The lowest ancestor of `a` that also contains `b`.
function commonAncestor(a: Element, b: Element): Element {
  let el: Element | null = a;
  while (el && !el.contains(b)) el = el.parentElement;
  return el as Element;
}

function expectNoSectionLines() {
  for (const line of SECTION_LINES) expect(screen.queryAllByText(line), line).toHaveLength(0);
}

describe('gameDetail side reads on a refresh (88.6.1-74, contract C1)', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: REAL_LOCATION,
    });
  });

  it('SR-1. a failed RSVP-list refresh keeps the participant\'s pill and shows RF1', async () => {
    const r = renderEventDetail();
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue(OTHER_YES);
    await screen.findByText('Going');
    (rsvpAPI.getEventRsvps as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByText('Going')).toBeInTheDocument();
  });

  it('SR-2. a failed brings refresh keeps the dice and shows RF1', async () => {
    const r = renderEventDetail();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    const count = screen.getAllByRole('img', { name: BRINGING }).length;
    (eventBringsAPI.getEventBrings as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getAllByRole('img', { name: BRINGING })).toHaveLength(count);
  });

  it('SR-3. a side 403 never silences RF1 over the kept event (P-2 under C10)', async () => {
    const r = renderEventDetail();
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue(OTHER_YES);
    await screen.findByText('Going');
    (rsvpAPI.getEventRsvps as Mock).mockRejectedValueOnce(FORBIDDEN());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.getByText('Going')).toBeInTheDocument();
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
  });

  it('SR-4. a first-render roster 403 keeps the event with no notice of any kind (control)', async () => {
    renderEventDetail();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(FORBIDDEN());
    await screen.findByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalled());
    await flushMacrotask();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(screen.queryAllByText(ROSTER_LOAD_FAILED)).toHaveLength(0);
  });

  it('SR-5. a new event never inherits the previous event\'s dice', async () => {
    const r = renderEventDetail();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture({ id: SECOND_EVENT_ID }));
    (eventBringsAPI.getEventBrings as Mock).mockRejectedValue(SERVER_500());
    h.search = `event_id=${SECOND_EVENT_ID}&group_id=${GROUP_ID}`;
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalledWith(SECOND_EVENT_ID));
    await screen.findByRole('heading', { name: 'Game Night' });
    await flushMacrotask();
    expect(screen.queryAllByRole('img', { name: BRINGING })).toHaveLength(0);
    // The section notice shows; a CODED failure reads the register sentence for its code (SR-23's
    // mechanism), so the expected line comes from getFetchErrorMessage, never typed.
    await waitFor(() => expect(screen.getAllByText(getFetchErrorMessage(SERVER_500()))).toHaveLength(2));
    expect(screen.queryAllByText(BRINGS_LOAD_FAILED)).toHaveLength(0);
  });

  it('SR-6. a failed group-events refresh keeps Upcoming and the session count, and shows RF1', async () => {
    const r = renderGameDetail({ events: [UPCOMING_SESSION, SESSION] });
    await screen.findByRole('heading', { name: 'Upcoming (1)' });
    const sessions = (await screen.findByRole('heading', { name: /^Game Sessions \(\d+\)$/ })).textContent;
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Upcoming (1)' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /^Game Sessions \(/ }).textContent).toBe(sessions);
  });

  it('SR-7. a failed RSVP fan-out refresh keeps the ballot\'s RSVP input and shows RF1', async () => {
    const r = renderGameDetail({ events: [UPCOMING_SESSION, SESSION] });
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: SELF_UUID }, status: 'yes' }] });
    await waitFor(() => expect(screen.getByTestId('ballot-section')).toHaveAttribute('data-rsvp-status', 'yes'));
    (rsvpAPI.getEventRsvps as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByTestId('ballot-section')).toHaveAttribute('data-rsvp-status', 'yes');
  });

  // A loaded member game view with an upcoming session, a past session and a review.
  async function renderLoadedGroupGame(options: RenderGameDetailOptions = {}) {
    const r = renderGameDetail({ events: [UPCOMING_SESSION, SESSION], reviews: [SIDE_REVIEW], ...options });
    await screen.findByText(SIDE_REVIEW.review_text);
    await screen.findByRole('button', { name: CTA });
    return r;
  }

  function expectGroupContentWithdrawn() {
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Upcoming \(/ })).toBeNull();
    expect(screen.queryByText(SESSION.comments)).toBeNull();
    expect(screen.queryByText(UPCOMING_SESSION.comments)).toBeNull();
    expect(screen.queryByText(SIDE_REVIEW.review_text)).toBeNull();
    expect(screen.queryByRole('button', { name: CTA })).toBeNull();
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    expect(screen.queryByText('Game not found')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  }

  it('SR-8. a group-events access answer withdraws the group content and keeps the game', async () => {
    const r = await renderLoadedGroupGame();
    const calls = (eventsAPI.getGroupEvents as Mock).mock.calls.length;
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(FORBIDDEN());
    forceRefresh(r.rerender);
    await waitFor(() => expect((eventsAPI.getGroupEvents as Mock).mock.calls.length).toBe(calls + 1));
    await flushMacrotask();
    await screen.findByRole('heading', { name: 'Wingspan' });
    expectGroupContentWithdrawn();
  });

  it('SR-8b. a reviews access answer withdraws the group content and keeps the game', async () => {
    const r = await renderLoadedGroupGame();
    const calls = (gameReviewsAPI.getGameReviews as Mock).mock.calls.length;
    (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(FORBIDDEN());
    forceRefresh(r.rerender);
    await waitFor(() => expect((gameReviewsAPI.getGameReviews as Mock).mock.calls.length).toBe(calls + 1));
    await flushMacrotask();
    expectGroupContentWithdrawn();
  });

  it('SR-8c. a roster not_found withdraws the group content and is never "Game not found"', async () => {
    const r = await renderLoadedGroupGame();
    const calls = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(new ApiError('Not found', 'not_found', 404));
    forceRefresh(r.rerender);
    await waitFor(() => expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(calls + 1));
    await flushMacrotask();
    expectGroupContentWithdrawn();
  });

  it('SR-9. a roster that first runs on run 2 and fails shows its section notice, never RF1 (D12)', async () => {
    h.userSub = undefined;
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(SERVER_500());
    h.userSub = 'auth0|self-sub';
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalled());
    await flushMacrotask();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    // The section notice shows; a CODED failure reads the register sentence for its code (SR-23's
    // mechanism), so the expected line comes from getFetchErrorMessage, never typed.
    await waitFor(() => expect(screen.getAllByText(getFetchErrorMessage(SERVER_500()))).toHaveLength(2));
    expect(screen.queryAllByText(ROSTER_LOAD_FAILED)).toHaveLength(0);
  });

  it('SR-10. a game roster that first runs on run 2 and fails shows its section notice, never RF1 (D12)', async () => {
    h.userSub = undefined;
    const r = renderGameDetail();
    await screen.findByRole('heading', { name: 'Wingspan' });
    await flushMacrotask();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(SERVER_500());
    h.userSub = 'auth0|self-sub';
    r.rerender(<GameDetailPage />);
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalled());
    await flushMacrotask();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    // The section notice shows; a CODED failure reads the register sentence for its code (SR-23's
    // mechanism), so the expected line comes from getFetchErrorMessage, never typed.
    await waitFor(() => expect(screen.getAllByText(getFetchErrorMessage(SERVER_500()))).toHaveLength(2));
    expect(screen.queryAllByText(GROUP_ROLE_LOAD_FAILED)).toHaveLength(0);
  });

  it('SR-11. with identity unresolved, a loaded group-events read that fails shows RF1 (the derive rule)', async () => {
    const r = renderGameDetail({ identityPending: true });
    const sessions = (await screen.findByRole('heading', { name: /^Game Sessions \(\d+\)$/ })).textContent;
    (eventsAPI.getGroupEvents as Mock).mockRejectedValueOnce(SERVER_500());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: /^Game Sessions \(/ }).textContent).toBe(sessions);
  });

  it('SR-12. a game-only caller (group reads 403 on every run) never sees RF1 or a notice', async () => {
    const r = renderGameDetail();
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(FORBIDDEN());
    (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(FORBIDDEN());
    await screen.findByRole('heading', { name: 'Wingspan' });
    await flushMacrotask();
    const groupCalls = (eventsAPI.getGroupEvents as Mock).mock.calls.length;
    const reviewCalls = (gameReviewsAPI.getGameReviews as Mock).mock.calls.length;
    forceRefresh(r.rerender);
    await waitFor(() => expect((eventsAPI.getGroupEvents as Mock).mock.calls.length).toBe(groupCalls + 1));
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Wingspan' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    expectNoSectionLines();
    expect((gameReviewsAPI.getGameReviews as Mock).mock.calls.length).toBe(reviewCalls);
  });

  it('SR-13. a group withdrawal that removes the focused session control lands focus on the game title (C12)', async () => {
    const r = renderGameDetail({ inMain: true, role: 'owner', events: [UPCOMING_SESSION] });
    await screen.findByRole('heading', { name: 'Upcoming (1)' });
    const control = (await screen.findAllByRole('button', { name: 'Session actions' }))[0];
    control.focus();
    expect(document.activeElement).toBe(control);
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(FORBIDDEN());
    forceRefresh(r.rerender);
    await waitFor(() => expect(screen.queryByRole('heading', { name: 'Upcoming (1)' })).toBeNull());
    const title = screen.getByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('SR-14. an older run\'s brings answer never overwrites a newer run\'s (review r2 #85)', async () => {
    const r = renderEventDetail();
    await screen.findByRole('heading', { name: 'Game Night' });
    await flushMacrotask();
    let settleOlder: (v: unknown) => void = () => {};
    (eventBringsAPI.getEventBrings as Mock)
      .mockImplementationOnce(() => new Promise((resolve) => { settleOlder = resolve; }))
      .mockResolvedValueOnce(OTHER_BRINGS);
    const before = (eventBringsAPI.getEventBrings as Mock).mock.calls.length;
    forceRefresh(r.rerender, 'auth0|older-sub');
    // The older run must reach its brings read (held) before the newer run starts.
    await waitFor(() => expect((eventBringsAPI.getEventBrings as Mock).mock.calls.length).toBe(before + 1));
    forceRefresh(r.rerender, 'auth0|newer-sub');
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    await act(async () => settleOlder([]));
    await flushMacrotask();
    expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0);
  });

  it('SR-15. a user-triggered brings write lands for an upper-case event id in the URL (review r2 #86)', async () => {
    // EVENT_ID is all digits, so its upper case is the same string; this id carries hex letters.
    const LETTERED_EVENT_ID = 'abcdef12-3456-4789-8abc-def123456789';
    h.selfUuid = SELF_UUID;
    h.search = `event_id=${LETTERED_EVENT_ID.toUpperCase()}&group_id=${GROUP_ID}`;
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture({ id: LETTERED_EVENT_ID }));
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('owner'));
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    (suggestionsAPI.getEventSuggestions as Mock).mockResolvedValue([]);
    render(<GameDetailPage />);
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([]);
    await act(async () => rsvpProps.current?.onRsvpChange?.('maybe'));
    await flushMacrotask();
    expect(screen.queryAllByRole('img', { name: BRINGING })).toHaveLength(0);
  });

  it('SR-16. an event whose access comes back never shows the pre-drop dice as current (review r2 #310)', async () => {
    const r = renderEventDetail();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    (eventsAPI.getEvent as Mock).mockRejectedValueOnce(FORBIDDEN());
    forceRefresh(r.rerender);
    await screen.findByRole('heading', { name: NO_ACCESS_TITLE });
    (eventsAPI.getEvent as Mock).mockResolvedValue(eventFixture());
    (eventBringsAPI.getEventBrings as Mock).mockRejectedValue(SERVER_500());
    forceRefresh(r.rerender, 'auth0|third-sub');
    await screen.findByRole('heading', { name: 'Game Night' });
    await flushMacrotask();
    expect(screen.queryAllByRole('img', { name: BRINGING })).toHaveLength(0);
  });

  it('SR-17. a group read\'s 401 takes the primary-401 path: sign-in once, never a silent page (review r2 #311) (redirects once, 88.9-40)', async () => {
    const search = `?game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search });
    try {
      const r = renderGameDetail();
      await screen.findByRole('heading', { name: 'Wingspan' });
      // AMENDED Phase 88.9-40 (SR-17): the primary-401 path now redirects once (the shared guard).
      // The game read's own success clears the latch in the same run, so this is the REDIRECT arm,
      // not a declined one: one replace with the game as returnTo and the loader frame — never a
      // silent page, which is the property #311 pinned.
      // AMENDED Phase 88.9-52 (A-31): the latch is now cleared at the END of a run that saw no 401,
      // so it is the FIRST (clean) run above that left the latch clear, not the refresh's own game
      // read. Same arm, same assertions; SR-17b pins the run that starts with the latch set.
      const e401 = new ApiError('Unauthorized', 'unauthorized', 401);
      (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(e401);
      forceRefresh(r.rerender);
      await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
      expect(replace).toHaveBeenCalledWith(
        '/api/auth/login?returnTo=' + encodeURIComponent(`/gameDetail${search}`)
      );
      expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
      expect(screen.getByText('Loading game night...', { selector: 'p' })).toBeInTheDocument();
      expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION });
    }
  });

  // 88.9-52 (A-31): the game view's bounded latch. A run proves the session only when its game
  // read answered AND no group read answered 401. First render with the given side-read answers.
  function renderGameWithSideAnswers(search: string, set: () => void) {
    h.selfUuid = SELF_UUID;
    h.search = search.slice(1);
    (gamesAPI.getGame as Mock).mockResolvedValue(GAME);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([SESSION]);
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([]);
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('member'));
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
    set();
    return renderPage(false);
  }

  it('SR-17b. back from sign-in (latch set): the game read answers and a group read answers 401 — the sign-in banner, never a second redirect, the latch kept (88.9-52 A-31)', async () => {
    const search = `?game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    const replace = stubLocation({ search });
    try {
      window.sessionStorage.setItem(signInLatch(), '1');
      renderGameWithSideAnswers(search, () => {
        (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(UNAUTHORIZED());
      });
      expect(await screen.findByText(GAME_LOAD_FAILED)).toBeInTheDocument();
      expect(screen.getByText(X1_SENTENCE)).toBeInTheDocument();
      expect(screen.getByRole('link', { name: 'Sign in' })).toBeInTheDocument();
      await flushMacrotask();
      expect(replace).not.toHaveBeenCalled();
      // A run that saw a 401 never clears the latch: clearing it is what rebuilt the loop.
      expect(window.sessionStorage.getItem(signInLatch())).toBe('1');
      expect(screen.queryByRole('heading', { name: 'Wingspan' })).toBeNull();
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION });
    }
  });

  it('SR-17c. a run with no 401 still clears the latch on each of its three clean endings (88.9-52 A-31)', async () => {
    // The rejected placement (beside the final clean write) misses the two early returns: a group
    // read's 403 that withdraws the group content, and a failed refresh (RF1). On both the game read
    // proved the session, so the latch must go — or the next real expiry shows a banner, not sign-in.
    const search = `?game_id=${GAME_ID}&group_id=${GROUP_ID}`;
    stubLocation({ search });
    try {
      // (1) every read answers.
      window.sessionStorage.setItem(signInLatch(), '1');
      const r = renderGameWithSideAnswers(search, () => {});
      await screen.findByRole('heading', { name: 'Wingspan' });
      await waitFor(() => expect(window.sessionStorage.getItem(signInLatch())).toBeNull());
      // (2) a failed refresh of a read that had loaded: RF1, the run returns early.
      window.sessionStorage.setItem(signInLatch(), '1');
      (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(SERVER_500());
      forceRefresh(r.rerender);
      await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
      await waitFor(() => expect(window.sessionStorage.getItem(signInLatch())).toBeNull());
      cleanup();
      // (3) a group read's 403: the group content is withdrawn, the run returns early and clean.
      window.sessionStorage.setItem(signInLatch(), '1');
      renderGameWithSideAnswers(search, () => {
        (eventsAPI.getGroupEvents as Mock).mockRejectedValue(FORBIDDEN());
      });
      await screen.findByRole('heading', { name: 'Wingspan' });
      await waitFor(() => expect(window.sessionStorage.getItem(signInLatch())).toBeNull());
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, writable: true, value: REAL_LOCATION });
    }
  });

  it('SR-18. the event roster\'s own 403 removes the member actions and keeps the event (review r2 #316)', async () => {
    const r = renderEventDetail({ role: 'owner' });
    await screen.findByRole('button', { name: 'Event actions' });
    const calls = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(FORBIDDEN());
    forceRefresh(r.rerender);
    await waitFor(() => expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(calls + 1));
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Event actions' })).toBeNull();
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('SR-19. the event roster\'s 401 is an ordinary side failure: RF1, the member actions kept (review r3 M-01)', async () => {
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    const r = renderEventDetail({ role: 'owner' });
    await screen.findByRole('button', { name: 'Event actions' });
    const calls = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(UNAUTHORIZED());
    forceRefresh(r.rerender);
    await waitFor(() => expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(calls + 1));
    await flushMacrotask();
    expect(screen.getByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    expect(screen.getAllByText(RF1)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Event actions' })).toBeInTheDocument();
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it('SR-20. reviews that failed and never loaded: no count, no "Be the first", the D8-r2 notice and a working Retry', async () => {
    const user = userEvent.setup();
    renderGameDetail({ role: 'member' });
    (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(CODELESS());
    await screen.findByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(screen.getAllByText(REVIEWS_LOAD_FAILED)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Reviews' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Reviews \(\d+\)$/ })).toBeNull();
    expect(screen.queryByText('No reviews yet. Be the first to review this game.')).toBeNull();
    expect(retryFor(REVIEWS_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add Review' })).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    const calls = (gamesAPI.getGame as Mock).mock.calls.length;
    (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue([SIDE_REVIEW]);
    await user.click(retryFor(REVIEWS_LOAD_FAILED));
    expect(await screen.findByRole('heading', { name: 'Reviews (1)' })).toBeInTheDocument();
    expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(calls + 1);
    await waitFor(() => expect(screen.queryAllByText(REVIEWS_LOAD_FAILED)).toHaveLength(0));
  });

  it('SR-21. sessions that failed and never loaded: no count, no empty sentence, the D8-r2 notice; tab return recovers', async () => {
    renderGameDetail();
    (eventsAPI.getGroupEvents as Mock).mockRejectedValue(CODELESS());
    await screen.findByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(screen.getAllByText(SESSIONS_LOAD_FAILED)).toHaveLength(2));
    expect(screen.getByRole('heading', { name: 'Game Sessions' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /^Game Sessions \(/ })).toBeNull();
    expect(screen.queryByText(/^No game sessions yet/)).toBeNull();
    expect(screen.getByText('Show Filters & Sort')).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    (eventsAPI.getGroupEvents as Mock).mockResolvedValue([SESSION]);
    await act(async () => fireVisibility('visible'));
    expect(await screen.findByRole('heading', { name: 'Game Sessions (1)' })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText(SESSIONS_LOAD_FAILED)).toHaveLength(0));
  });

  it('SR-22. an event roster that failed and never loaded shows its notice above the RSVP section; Retry recovers', async () => {
    const user = userEvent.setup();
    renderEventDetail();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(CODELESS());
    await screen.findByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(screen.getAllByText(ROSTER_LOAD_FAILED)).toHaveLength(2));
    const line = visibleLine(ROSTER_LOAD_FAILED);
    expect(line.compareDocumentPosition(screen.getByTestId('rsvp-section')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('heading', { name: /^Participants \(/ })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText(NO_ACCESS_TITLE)).toBeNull();
    expect(screen.queryByText(EVENT_LOAD_FAILED)).toBeNull();
    const calls = (eventsAPI.getEvent as Mock).mock.calls.length;
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('owner'));
    await user.click(retryFor(ROSTER_LOAD_FAILED));
    await waitFor(() => expect(screen.queryAllByText(ROSTER_LOAD_FAILED)).toHaveLength(0));
    expect((eventsAPI.getEvent as Mock).mock.calls.length).toBe(calls + 1);
  });

  it('SR-23. a CODED never-loaded reviews failure shows the register sentence, not the ratified line', async () => {
    renderGameDetail({ role: 'member' });
    const eNet = new ApiError('Network', 'network', 0);
    (gameReviewsAPI.getGameReviews as Mock).mockRejectedValue(eNet);
    await screen.findByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(screen.getAllByText(getFetchErrorMessage(eNet))).toHaveLength(2));
    expect(screen.queryAllByText(REVIEWS_LOAD_FAILED)).toHaveLength(0);
  });

  it('SR-24. an RSVP list that failed and never loaded: no "No reply", no ballot, the E17 notice; Retry recovers', async () => {
    // 88.9-52 (W26): pinned BEFORE the night — a started night shows no "No reply" pill at all, so
    // without the pin the absence below would pass for the wrong reason. Restored by the afterEach.
    pinClockBeforeTheNight();
    const user = userEvent.setup();
    renderEventDetail({ role: 'member' });
    (rsvpAPI.getEventRsvps as Mock).mockRejectedValue(CODELESS());
    await screen.findByText('Someone Else');
    await waitFor(() => expect(screen.getAllByText(REPLIES_LOAD_FAILED)).toHaveLength(2));
    const card = commonAncestor(screen.getByRole('heading', { name: /^Participants \(/ }), visibleLine(REPLIES_LOAD_FAILED));
    expect(within(card as HTMLElement).queryByTestId('rsvp-section')).toBeNull();
    expect(screen.queryByText('No reply')).toBeNull();
    expect(screen.queryByTestId('ballot-section')).toBeNull();
    const calls = (eventsAPI.getEvent as Mock).mock.calls.length;
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue(OTHER_YES);
    await user.click(retryFor(REPLIES_LOAD_FAILED));
    expect(await screen.findByText('Going')).toBeInTheDocument();
    expect((eventsAPI.getEvent as Mock).mock.calls.length).toBe(calls + 1);
    expect(screen.getByTestId('ballot-section')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByText(REPLIES_LOAD_FAILED)).toHaveLength(0));
  });

  // A-48 (88.6.1 code review): the roster read has its own catch, so its failure no longer skips the
  // RSVP-list and brings reads — skipped, the ballot told a viewer who had said Yes to RSVP first.
  it('SR-24b. a first-load roster 500 still reads the RSVP list and brings: the ballot carries the viewer\'s Yes', async () => {
    renderEventDetail({ role: 'member' });
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(SERVER_500());
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: SELF_UUID }, status: 'yes' }] });
    await screen.findByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(groupsAPI.getGroupMembers).toHaveBeenCalled());
    await waitFor(() => expect(rsvpAPI.getEventRsvps).toHaveBeenCalled());
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('ballot-section')).toHaveAttribute('data-rsvp-status', 'yes'));
  });

  it('SR-25. brings that failed and never loaded show the E18 notice; a user-triggered Set clears it', async () => {
    renderEventDetail({ role: 'member' });
    (eventBringsAPI.getEventBrings as Mock).mockRejectedValue(CODELESS());
    await screen.findByText('Someone Else');
    await waitFor(() => expect(screen.getAllByText(BRINGS_LOAD_FAILED)).toHaveLength(2));
    const card = commonAncestor(screen.getByRole('heading', { name: /^Participants \(/ }), visibleLine(BRINGS_LOAD_FAILED));
    expect(within(card as HTMLElement).queryByTestId('rsvp-section')).toBeNull();
    expect(screen.queryAllByRole('img', { name: BRINGING })).toHaveLength(0);
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    await act(async () => rsvpProps.current?.onRsvpChange?.('maybe'));
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    await waitFor(() => expect(screen.queryAllByText(BRINGS_LOAD_FAILED)).toHaveLength(0));
  });

  it('SR-26. an RSVP fan-out that failed and never loaded shows the GD3 notice and no upcoming ballot', async () => {
    renderGameDetail({ events: [UPCOMING_SESSION, SESSION] });
    (rsvpAPI.getEventRsvps as Mock).mockRejectedValue(CODELESS());
    const upcoming = await screen.findByRole('heading', { name: 'Upcoming (1)' });
    await waitFor(() => expect(screen.getAllByText(MY_RSVPS_LOAD_FAILED)).toHaveLength(2));
    const card = commonAncestor(upcoming, visibleLine(MY_RSVPS_LOAD_FAILED));
    expect(within(card as HTMLElement).queryByText(SESSION.comments)).toBeNull();
    expect(within(card as HTMLElement).queryByTestId('ballot-section')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
  });

  it('SR-27. a game roster that failed and never loaded shows the GD4 notice in the game card; Retry recovers', async () => {
    const user = userEvent.setup();
    renderGameDetail();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(CODELESS());
    const title = await screen.findByRole('heading', { name: 'Wingspan' });
    await waitFor(() => expect(screen.getAllByText(GROUP_ROLE_LOAD_FAILED)).toHaveLength(2));
    const card = commonAncestor(title, visibleLine(GROUP_ROLE_LOAD_FAILED));
    expect(within(card as HTMLElement).queryByRole('heading', { name: /^Game Sessions/ })).toBeNull();
    expect(screen.queryByRole('button', { name: CTA })).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText(GAME_LOAD_FAILED)).toBeNull();
    const calls = (gamesAPI.getGame as Mock).mock.calls.length;
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor('member'));
    await user.click(retryFor(GROUP_ROLE_LOAD_FAILED));
    expect(await screen.findByRole('button', { name: CTA })).toBeInTheDocument();
    expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(calls + 1);
    await waitFor(() => expect(screen.queryAllByText(GROUP_ROLE_LOAD_FAILED)).toHaveLength(0));
  });

  it('SR-28. a failed user-triggered brings refresh changes nothing (seam pass S2-4)', async () => {
    renderEventDetail();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue(OTHER_BRINGS);
    await waitFor(() => expect(screen.getAllByRole('img', { name: BRINGING }).length).toBeGreaterThan(0));
    const count = screen.getAllByRole('img', { name: BRINGING }).length;
    (eventBringsAPI.getEventBrings as Mock).mockRejectedValue(SERVER_500());
    await act(async () => rsvpProps.current?.onRsvpChange?.('maybe'));
    await flushMacrotask();
    expect(screen.getAllByRole('img', { name: BRINGING })).toHaveLength(count);
    expect(screen.queryAllByText(BRINGS_LOAD_FAILED)).toHaveLength(0);
  });
});

// Plan 88.6.1-68: a host's created-callback only refreshes; the one close after a success is
// CreateEvent's own `modaltoggle()`, which plan 88.6.1-81 calls only while the press's dialog
// session is still open. The stub records each render's props, so an arm can call the callbacks
// the host handed the dialog while it was open. See DECISION Phase 88.6.1-68 (one close owner).
describe("gameDetail hosts leave the dialog's close to CreateEvent (88.6.1-68)", () => {
  type CreateEventProps = {
    modal: boolean;
    editingEvent: { id: string } | null;
    onEventCreated: (data: unknown) => void;
    modaltoggle: () => void;
  };

  it('GD-1: event view — a late update success refreshes the page and leaves the (reopened) Edit dialog open', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner' });
    await user.click(await screen.findByRole('button', { name: 'Edit Event' }));
    await waitFor(() => expect(h.createEventMounts).toBe(1));
    const p = h.createEventProps.at(-1) as CreateEventProps;
    expect(p.modal).toBe(true);
    expect(p.editingEvent?.id).toBe(EVENT_ID);
    const reads = (eventsAPI.getEvent as Mock).mock.calls.length;
    const brings = (eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === EVENT_ID).length;

    await act(async () => {
      p.onEventCreated(null);
    });
    await waitFor(() => expect((eventsAPI.getEvent as Mock).mock.calls.length).toBe(reads + 1));
    await waitFor(() =>
      // Greater than, not "+1": the refresh reads the brings twice (refreshBringersSet and the
      // brings refresh-key bump), measured 2026-10-17.
      expect((eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === EVENT_ID).length).toBeGreaterThan(
        brings
      )
    );
    expect(h.createEventMounts).toBe(1);
  });

  it('GD-1o: event view, ordinary path (confirm-only) — callback then modaltoggle refreshes and closes', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner' });
    await user.click(await screen.findByRole('button', { name: 'Edit Event' }));
    await waitFor(() => expect(h.createEventMounts).toBe(1));
    const p = h.createEventProps.at(-1) as CreateEventProps;
    const reads = (eventsAPI.getEvent as Mock).mock.calls.length;
    const brings = (eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === EVENT_ID).length;

    await act(async () => {
      p.onEventCreated(null);
      p.modaltoggle();
    });
    await waitFor(() => expect((eventsAPI.getEvent as Mock).mock.calls.length).toBe(reads + 1));
    await waitFor(() =>
      // Greater than, not "+1": the refresh reads the brings twice (refreshBringersSet and the
      // brings refresh-key bump), measured 2026-10-17.
      expect((eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === EVENT_ID).length).toBeGreaterThan(
        brings
      )
    );
    expect(h.createEventMounts).toBe(0);
    expect(screen.getByRole('button', { name: 'Edit Event' })).toBeInTheDocument();
  });
  // Task 3: the game view's two mounts (Edit from the sessions list, Create from the CTA).
  async function openGameViewEdit() {
    const user = userEvent.setup();
    renderGameDetail({ role: 'owner' });
    const sessions = await sessionsSection();
    await user.click(await within(sessions).findByRole('button', { name: 'Edit' }));
    await waitFor(() => expect(h.createEventMounts).toBe(1));
    const p = h.createEventProps.at(-1) as CreateEventProps;
    expect(p.editingEvent?.id).toBe(SESSION.id);
    return p;
  }

  async function openGameViewCreate() {
    const user = userEvent.setup();
    renderGameDetail({ role: 'owner' });
    await user.click(await screen.findByRole('button', { name: 'Plan a game night with this' }));
    await waitFor(() => expect(h.createEventMounts).toBe(1));
    const p = h.createEventProps.at(-1) as CreateEventProps;
    expect(p.editingEvent).toBeNull();
    return p;
  }

  it('GD-2: game view Edit — a late update success refreshes the page and leaves the (reopened) Edit dialog open', async () => {
    const p = await openGameViewEdit();
    const games = (gamesAPI.getGame as Mock).mock.calls.length;
    const brings = (eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === SESSION.id).length;

    await act(async () => {
      p.onEventCreated(null);
    });
    await waitFor(() => expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(games + 1));
    await waitFor(() =>
      expect((eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === SESSION.id).length).toBeGreaterThan(
        brings
      )
    );
    expect(h.createEventMounts).toBe(1);
  });

  it('GD-2o: game view Edit, ordinary path (confirm-only) — callback then modaltoggle refreshes and closes', async () => {
    const p = await openGameViewEdit();
    const games = (gamesAPI.getGame as Mock).mock.calls.length;
    const brings = (eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === SESSION.id).length;

    await act(async () => {
      p.onEventCreated(null);
      p.modaltoggle();
    });
    await waitFor(() => expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(games + 1));
    await waitFor(() =>
      expect((eventBringsAPI.getEventBrings as Mock).mock.calls.filter((c) => c[0] === SESSION.id).length).toBeGreaterThan(
        brings
      )
    );
    expect(h.createEventMounts).toBe(0);
  });

  it('GD-3: game view Create — a late create success refreshes the page and leaves the (reopened) Create dialog open', async () => {
    const p = await openGameViewCreate();
    const games = (gamesAPI.getGame as Mock).mock.calls.length;

    await act(async () => {
      p.onEventCreated({ id: 'e-new' });
    });
    await waitFor(() => expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(games + 1));
    expect(h.createEventMounts).toBe(1);
  });

  it('GD-3o: game view Create, ordinary path (confirm-only) — callback then modaltoggle refreshes and closes', async () => {
    const p = await openGameViewCreate();
    const games = (gamesAPI.getGame as Mock).mock.calls.length;

    await act(async () => {
      p.onEventCreated({ id: 'e-new' });
      p.modaltoggle();
    });
    await waitFor(() => expect((gamesAPI.getGame as Mock).mock.calls.length).toBe(games + 1));
    expect(h.createEventMounts).toBe(0);
  });
});

describe("gameDetail Bringing control — the viewer's RSVP reaches the section, and the picker opens on the first Yes or the control (quick-261021-ffb)", () => {
  it('GB-P1. game view: the RSVP fan-out resolves the viewer as yes and the Upcoming card\'s Bringing section receives it', async () => {
    renderGameDetail({ events: [UPCOMING_SESSION, SESSION] });
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: SELF_UUID }, status: 'yes' }] });
    await waitFor(() => expect(screen.getByTestId('bring-summary')).toHaveAttribute('data-rsvp-status', 'yes'));
  });

  it('GB-P2. event view: the RSVP list resolves the viewer as yes and the Bringing section receives it', async () => {
    renderEventDetail({ role: 'member' });
    (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [{ User: { id: SELF_UUID }, status: 'yes' }] });
    await screen.findByRole('heading', { name: 'Game Night' });
    await waitFor(() => expect(rsvpAPI.getEventRsvps).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByTestId('bring-summary')).toHaveAttribute('data-rsvp-status', 'yes'));
  });

  it('GB-P3. event view, live: the section follows the viewer\'s RSVP changes (yes, then maybe)', async () => {
    renderEventDetail();
    expect(await screen.findByText('Someone Else')).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalled());
    await flushMacrotask();
    await act(async () => rsvpProps.current?.onRsvpChange?.('yes'));
    expect(screen.getByTestId('bring-summary')).toHaveAttribute('data-rsvp-status', 'yes');
    await act(async () => rsvpProps.current?.onRsvpChange?.('maybe'));
    expect(screen.getByTestId('bring-summary')).toHaveAttribute('data-rsvp-status', 'maybe');
  });

  it('GB-P4 (confirm-only). event view: the first Yes opens the picker, a repeated Yes does not, the section\'s control does', async () => {
    renderEventDetail();
    expect(await screen.findByText('Someone Else')).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalled());
    await flushMacrotask();
    expect(bringPickerProps.current?.isOpen).toBe(false);

    await act(async () => rsvpProps.current?.onRsvpChange?.('yes'));
    expect(bringPickerProps.current?.isOpen).toBe(true);
    expect(bringPickerProps.current?.eventId).toBe(EVENT_ID);

    await act(async () => bringPickerProps.current?.onClose?.());
    expect(bringPickerProps.current?.isOpen).toBe(false);

    await act(async () => rsvpProps.current?.onRsvpChange?.('yes'));
    expect(bringPickerProps.current?.isOpen).toBe(false);

    await act(async () => bringSummaryProps.current?.onEditClick?.());
    expect(bringPickerProps.current?.isOpen).toBe(true);
    expect(bringPickerProps.current?.eventId).toBe(EVENT_ID);
  });
});

// 88.9-52 W27 (height half): in the participant strip chip the Owner and Admin pills measured 16px
// tall (padding 0 4px) beside the 20px No reply and Maybe pills. Every pill in the chip now shares
// the See-all row's box, px-1.5 py-0.5. jsdom lays nothing out, so this pins the class tokens.
describe('gameDetail strip chip pills share one box (W27, 88.9-52)', () => {
  it.each(['owner', 'admin'] as const)(
    'W27 (88.9-52): the %s pill and the Guest pill in the strip chip take px-1.5 py-0.5',
    // AMENDED Phase 89.6-30 (N04): owner pick N04 = B. The role tag and the Guest tag are the Pill
    // block (the one box, regular weight: it pinned font-bold on the role tag), and the reply tag
    // FOLLOWS them on the chip (it came first). The clock is pinned before the night so the reply
    // tag draws (W26: no No reply once the night has started).
    async (role) => {
      pinClockBeforeTheNight();
      try {
        renderEventDetail({
          role,
          participants: [
            participantRow({ user_id: SELF_UUID, username: 'Me' }),
            participantRow({ user_id: 'guest-uuid', username: 'Visiting Pat', is_guest: true }),
          ],
        });
        await screen.findByRole('heading', { name: 'Participants (2)' });
        const rolePill = await screen.findByText(role === 'owner' ? 'Owner' : 'Admin', { selector: 'span' });
        const guestPill = screen.getByText('Guest', { selector: 'span[title]' });
        for (const pill of [rolePill, guestPill]) {
          expect(pill).toHaveClass('inline-flex', 'items-center', 'align-middle', 'text-xs', 'leading-4', 'px-1.5', 'py-0.5', 'rounded-sm', 'font-normal');
          expect(pill.className.split(/\s+/)).not.toContain('font-bold');
          expect(pill).not.toHaveClass('px-1');
          const chip = pill.parentElement as HTMLElement;
          const reply = await within(chip).findByText('No reply');
          expect(pill.compareDocumentPosition(reply) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
      } finally {
        vi.useRealTimers();
      }
    }
  );

  // The phone Friend tag inside a review's bold name line is the name control's own (stubbed in this
  // file): its weight is pinned in
  // src/app/components/ClickableMemberName.indicator.test.tsx ("says Friend once, and has no tick").
  it('N04 B (89.6-30): the session chip tags and the own review read in the one style', async () => {
    renderGameDetail({
      role: 'member',
      events: [
        {
          ...SESSION,
          EventParticipations: [{ user_id: 'p-sol', username: 'Sol Player', is_guest: true, is_new_player: true, faction: 'Federation of Sol' }],
        },
      ],
      reviews: [SAVED_REVIEW],
    });
    const sessions = await sessionsSection();
    const guest = await within(sessions).findByText('Guest');
    const newPlayer = within(sessions).getByText('New Player');
    for (const tag of [guest, newPlayer]) {
      expect(tag).toHaveClass('leading-4', 'whitespace-nowrap', 'font-normal');
      expect(tag.className.split(/\s+/)).not.toContain('font-bold');
    }
    // The faction is free text: the same box, and it may wrap by whole words inside its chip.
    const faction = within(sessions).getByText('Federation of Sol');
    expect(faction).toHaveClass('leading-4', 'font-normal', 'whitespace-normal', 'max-w-full', 'wrap-break-word');
    expect(faction.className.split(/\s+/)).not.toContain('whitespace-nowrap');

    // The viewer's own review: (You) in plain grey words, regular weight inside the bold name line.
    const you = within(await reviewsSection()).getByText('(You)');
    expect(you).toHaveClass('text-xs', 'font-normal', 'text-content-muted');
    expect(you.className.split(/\s+/)).not.toContain('text-content-link');
  });
});
