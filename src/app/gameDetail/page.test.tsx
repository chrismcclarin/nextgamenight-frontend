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
}));

// 88.6.1-25 S2: the RsvpSection stub records its latest props so a test can fire
// onRsvpChange; it still renders the same testid marker, so nothing that queries it moves.
const rsvpProps = vi.hoisted(() => ({
  current: null as null | { onRsvpChange?: (status: string) => void },
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

vi.mock('@/app/components/FriendshipStatusProvider', () => ({
  useFriendshipStatus: () => ({ getStatus: () => 'none', sendRequest: vi.fn() }),
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
vi.mock('@/app/components/BallotSection', () => ({
  default: () => <div data-testid="ballot-section" />,
}));
vi.mock('@/app/components/BringGamePicker', () => ({ default: () => null }));
vi.mock('@/app/components/BringSummary', () => ({
  default: () => <div data-testid="bring-summary" />,
}));
// 88.6.1-25 task 3: CreateEvent records its props (AC-7 asserts which group the edit modal gets)
// and still renders nothing; GameSuggestionCard renders one button named for its game, so a test
// can tap a Recommended Games card. Every older case resolves suggestions to [], so no card renders.
vi.mock('@/app/components/createEvent', () => ({
  default: (props: Record<string, unknown>) => {
    h.createEventProps.push(props);
    return null;
  },
}));
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
vi.mock('@/app/components/QRCodeModal', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
// StarRatingPicker is deliberately NOT stubbed (plan 88-20). It is the one child
// whose a11y contract this file asserts — DEF-88-10-01's eleventh site is the
// orphan <label> that sat over it, and a `() => null` stub makes both the
// radiogroup-name pin and the orphan-label sweep vacuous on the review dialog.
vi.mock('@/app/components/ClickableMemberName', () => ({
  default: ({ username }: { username?: string }) => <span>{username}</span>,
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
  } = options;
  h.selfUuid = SELF_UUID;
  h.search = search;
  (gamesAPI.getGame as Mock).mockResolvedValue(game);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue(events);
  (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue(reviews);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor(role));
  (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
  return render(<GameDetailPage />);
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
  } = options;
  h.selfUuid = SELF_UUID;
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
  return render(<GameDetailPage />);
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
  h.createEventProps.length = 0;
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
});

// D-40 / F-6c / F-6d. jsdom applies no media queries, so BOTH breakpoint
// renderings are in the DOM at once here: the `md:hidden` kebab trigger and the
// `hidden md:flex` ghost pair. That is what makes the negative pin meaningful —
// it proves the role gate covers both layouts, not just the one a desktop
// walkthrough would look at.
describe('gameDetail role-gated session affordances', () => {
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
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);
    expect(eventsAPI.deleteEvent).toHaveBeenCalledWith(SESSION.id);
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
// fleet default ('Tap again to confirm', was the divergent click-again wording);
// the control meets the 44px floor. The 65-02 INTERACTION — inline second click,
// 3s revert, never a modal — is unchanged and re-pinned below.
const RESTING_REMOVE = /^Remove .+ from this event$/;
const ARMED_REMOVE = 'Tap again to confirm';

describe('gameDetail two-tap participant remove inside the Modal (Phase 65-02)', () => {
  it('arms on the first click and deletes nothing yet, announcing the target', async () => {
    const user = userEvent.setup();
    (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

    const dialog = await openParticipantsModal(user);
    const removes = within(dialog).getAllByRole('button', { name: RESTING_REMOVE });
    await user.click(removes[0]);

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
    await user.click(within(dialog).getByRole('button', { name: ARMED_REMOVE }));

    expect(eventsAPI.removeParticipation).toHaveBeenCalledTimes(1);
    expect(eventsAPI.removeParticipation).toHaveBeenCalledWith(EVENT_ID, 'p-0');
  });

  it('reverts to Remove when the confirm window lapses, deleting nothing', async () => {
    // `shouldAdvanceTime` is load-bearing, not decoration: RTL's `waitFor`
    // sniffs for JEST fake timers, does not recognise vitest's, and then polls
    // with a `setInterval` that the fake clock has frozen — every `findBy*` in
    // this file hangs for 5s and the whole suite times out after it. Letting the
    // fake clock also track real time keeps `waitFor` alive while still allowing
    // the 3s confirm window to be jumped rather than waited out.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      (eventsAPI.removeParticipation as Mock).mockResolvedValue({});
      renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });

      const dialog = await openParticipantsModal(user);
      await user.click(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })[0]);
      within(dialog).getByRole('button', { name: ARMED_REMOVE });

      await act(async () => {
        vi.advanceTimersByTime(3100);
      });

      expect(
        within(dialog).queryByRole('button', { name: ARMED_REMOVE })
      ).toBeNull();
      // Every row is back at rest — none of the six is self, so all six are removable.
      expect(within(dialog).getAllByRole('button', { name: RESTING_REMOVE })).toHaveLength(
        SIX_PARTICIPANTS.length
      );
      expect(eventsAPI.removeParticipation).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
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

const INVITE = 'Invite to group';

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
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
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
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
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

    const sending = screen.getByRole('button', { name: 'Sending...' });
    expect(sending).toHaveAttribute('aria-disabled', 'true');
    expect(sending.hasAttribute('disabled')).toBe(false);
    // The visible in-flight cue that replaces the `.btn:disabled` wash (V-17).
    expect(sending).toHaveTextContent('Sending...');
    // No `disabled:opacity-*` utility was added at the call site — it keys on
    // the native attribute this control no longer carries.
    expect(sending.className).not.toMatch(/(^|[\s:])disabled:opacity-/);
  });

  it('keeps focus ON the control while sending, and does not move it when the outcome settles', async () => {
    const user = userEvent.setup();
    const invite$ = deferredInvite();
    renderEventDetail({ role: 'owner', participants: [GUEST] });
    const invite = await screen.findByRole('button', { name: INVITE });

    await user.click(invite);
    // The whole point of the 2026-09-14 amendment: a natively-disabled element
    // leaves the focus order and focus drops to <body> mid-submit.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Sending...' }));

    await act(async () => {
      invite$.settle({});
    });
    await screen.findByText('Invite sent!');
    // RECORDED, not asserted as a landing target: focus is NOT moved. Under arm B
    // the button is replaced by a non-focusable status chip, so the user lands
    // wherever its removal leaves them — `<body>`. This is a DOM fact and belongs
    // in the jsdom half; it is disclosed in 88.6-18-SUMMARY.md rather than
    // silently absorbed.
    expect(document.activeElement).toBe(document.body);
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

    const retry = await screen.findByRole('button', { name: 'Retry' });
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
    expect(chip).not.toHaveAttribute('tabindex');
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
});

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
    expect(screen.queryByRole('button', { name: 'Show full title' })).toBeNull();
  });

  it('shows the toggle with disclosure semantics when it overflows; Esc collapses; editable-origin Esc does not (rows 326+334)', async () => {
    const user = userEvent.setup();
    setMeasuredOverflow(100, 50);
    renderGameDetail({ game: GAME_WITH_DESC });

    const toggle = await screen.findByRole('button', { name: 'Show More' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveAttribute('aria-controls', 'game-description');

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

  it('the title twin gains a keyboard-reachable expand when clamped and overflowing', async () => {
    setMeasuredOverflow(100, 50);
    renderGameDetail({ game: GAME_WITH_DESC });

    const titleButton = await screen.findByRole('button', { name: 'Show full title' });
    expect(titleButton).toHaveAttribute('aria-controls', 'game-title');
    fireEvent.click(titleButton);
    // One-shot expand (Phase 76 design preserved): the affordance leaves once expanded.
    expect(screen.queryByRole('button', { name: 'Show full title' })).toBeNull();
  });
});

describe('gameDetail guest-removal disclosure (row 530 FE half)', () => {
  it('tells admins the removal boundary in the participants modal', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'owner', participants: SIX_PARTICIPANTS });
    const dialog = await openParticipantsModal(user);
    expect(
      within(dialog).getByText('Guests and your own row are removed via Edit Event.')
    ).toBeInTheDocument();
  });

  it('renders no disclosure for plain members (they have no Remove affordance)', async () => {
    const user = userEvent.setup();
    renderEventDetail({ role: 'member', participants: SIX_PARTICIPANTS });
    const dialog = await openParticipantsModal(user);
    expect(
      within(dialog).queryByText('Guests and your own row are removed via Edit Event.')
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
    await act(async () => {
      cancel.click();
      cancel.click();
    });

    expect(eventsAPI.deleteEvent).toHaveBeenCalledTimes(1);
    // The ruled arm (c): still OPEN, with the in-flight label readable IN PLACE —
    // not "after reopening".
    const inFlight = within(list).getByRole('button', { name: 'Cancelling…' });
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight.hasAttribute('disabled')).toBe(false);
  });

  it('keeps the menu OPEN and readable while Leave is in flight, and sends exactly one DELETE', async () => {
    const user = userEvent.setup();
    deferred(eventsAPI.leaveEvent as Mock);
    renderEventDetail({ role: 'game-only' });
    const { list } = await openEventActions(user);

    const leave = within(list).getByRole('button', { name: 'Leave event' });
    await act(async () => {
      leave.click();
      leave.click();
    });

    expect(eventsAPI.leaveEvent).toHaveBeenCalledTimes(1);
    const inFlight = within(list).getByRole('button', { name: 'Leaving…' });
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight.hasAttribute('disabled')).toBe(false);
  });

  it('leaves focus ON the activated item, and Escape from there closes and restores to the trigger', async () => {
    const user = userEvent.setup();
    deferred(eventsAPI.deleteEvent as Mock);
    renderEventDetail({ role: 'owner' });
    const { trigger, list } = await openEventActions(user);

    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));
    // The whole reason the gate is `ariaDisabled` and not the native attribute:
    // a natively-disabled focused element blurs to <body>, which is exactly the
    // state this menu's container-bound Escape cannot see.
    const inFlight = within(list).getByRole('button', { name: 'Cancelling…' });
    expect(document.activeElement).toBe(inFlight);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).not.toBe(trigger);

    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Cancelling…' })).toBeNull()
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
    await user.click(within(list).getByRole('button', { name: 'Leave event' }));
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
    await user.click(within(list).getByRole('button', { name: 'Leave event' }));

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
    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));
    expect(eventsAPI.deleteEvent).not.toHaveBeenCalled();

    h.userSub = 'auth0|self-sub';
    rerender(<GameDetailPage />);
    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));

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
// exactly two sites (`:2444`, `:2513`, measured 2026-09-22), both inside the game-TITLE overflow
// handlers on the page body — neither is reachable from any dialog rendered here. One tree, one run
// per rule set per dialog, no resize.
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
const SIGN_IN_LATCH = `ngevent:signinRedirect:${EVENT_ID}`;
const UNAUTHORIZED = () => new ApiError('Unauthorized', 'unauthorized', 401);
const FORBIDDEN = () => new ApiError('Access denied', 'forbidden', 403);
const ACCOUNT_DELETED = () => new ApiError('gone', 'account_deleted', 410);
// Copy rows E1-E3 (88.6.1-COPY-TABLE.html, straight apostrophes per D-32 R8) and X1, the
// register's unauthorized line shipped by plan 88.6.1-07. Asserted byte-exactly.
const NO_ACCESS_TITLE = "You don't have access to this event";
const NO_ACCESS_DETAIL =
  "You may be signed in with a different account, or you haven't been invited yet.";
const EVENT_LOAD_FAILED = "We couldn't load this event";
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
  expect(screen.queryByText('Loading game night...')).toBeNull();
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
      expect(tokens, `${s.label}: the house focus ring`).toContain('focus-visible:ring-2');
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
    expect(window.sessionStorage.getItem(SIGN_IN_LATCH)).toBe('1');
    expect(screen.getByText('Loading game night...')).toBeInTheDocument();
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
    expect(screen.getByText('Loading game night...')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Event not found')).toBeNull();
    h.authLoading = false;
    rerender(<GameDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it('L1: the shared loader reads copy row E4 and is a labelled status', async () => {
    renderGameDetail();
    expect(screen.getByText('Loading game night...')).toBeInTheDocument();
    expect(screen.queryByText(/^Loading game details/)).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading game night...' })).toBeInTheDocument();
    // Settle, so the game's resolution does not land after cleanup.
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
    expect(screen.queryByLabelText('Bringing a game')).toBeNull();
  });

  it('S2: a user-triggered bring refresh still paints the indicator (review r3 M-15)', async () => {
    renderEventDetail();
    expect(await screen.findByText('Someone Else')).toBeInTheDocument();
    await waitFor(() => expect(eventBringsAPI.getEventBrings).toHaveBeenCalledTimes(1));
    await flushMacrotask();
    expect(screen.queryByLabelText('Bringing a game')).toBeNull();
    (eventBringsAPI.getEventBrings as Mock).mockResolvedValue([{ User: { id: OTHER_UUID } }]);
    await act(async () => {
      rsvpProps.current?.onRsvpChange?.('yes');
    });
    expect(await screen.findByLabelText('Bringing a game')).toBeInTheDocument();
  });

  // ---- Task 2: every other answer the event fetch can get has its own honest screen ----

  it('C1: a 401 with the latch already set (back from sign-in) renders the E3 banner with X1, never a second redirect (AC-2)', async () => {
    window.sessionStorage.setItem(SIGN_IN_LATCH, '1');
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    renderEventDetail({ getEventRejectsWith: UNAUTHORIZED() });
    expect(await screen.findByText(EVENT_LOAD_FAILED)).toBeInTheDocument();
    expect(screen.getByText(X1_SENTENCE)).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
    expect(screen.queryByText('Event not found')).toBeNull();
    // A 401 never clears the latch (review r2 #305): clearing it would rebuild the loop.
    expect(window.sessionStorage.getItem(SIGN_IN_LATCH)).toBe('1');
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
    window.sessionStorage.setItem(SIGN_IN_LATCH, '1');
    renderEventDetail();
    expect(await screen.findByRole('heading', { name: 'Game Night' })).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(SIGN_IN_LATCH)).toBeNull());
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
    window.sessionStorage.setItem(SIGN_IN_LATCH, '1');
    const replace = stubLocation({ search: `?event_id=${EVENT_ID}&group_id=${GROUP_ID}` });
    renderEventDetail({ getEventRejectsWith: FORBIDDEN() });
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('C7b: an answer that proves the session (403) clears the latch (review r2 #305)', async () => {
    window.sessionStorage.setItem(SIGN_IN_LATCH, '1');
    renderEventDetail({ getEventRejectsWith: FORBIDDEN() });
    expect(await screen.findByRole('heading', { name: NO_ACCESS_TITLE })).toBeInTheDocument();
    await waitFor(() => expect(window.sessionStorage.getItem(SIGN_IN_LATCH)).toBeNull());
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
    expect(screen.getByText('Loading game night...')).toBeInTheDocument();
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
    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));
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
    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));
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
    await user.click(within(list).getByRole('button', { name: 'Cancel event' }));
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
});
