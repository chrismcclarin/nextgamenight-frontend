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
import { render, screen, within, cleanup, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = '11111111-1111-4111-8111-111111111111';
const OTHER_UUID = '22222222-2222-4222-8222-222222222222';
const GAME_ID = 'GAME1';
const GROUP_ID = 'GROUP1';

/**
 * Group role of the CALLER, as it will appear on their roster row.
 * `'game-only'` models the caller-self-row contract's `UserGroup === null` case.
 */
export type CallerRole = 'owner' | 'admin' | 'member' | 'pending' | 'game-only';

const EVENT_ID = 'EVT1';

// `search` is hoisted state, not a literal, because gameDetail renders a WHOLLY
// DIFFERENT tree for `?event_id=` (the single-event view: participant strip,
// See-all modal, guest invites) than for `?game_id=` (the game view: sessions,
// reviews). Plan 88-20 touches both, so the harness has to be able to reach both.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  search: '',
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self-sub' } : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
    isPending: !h.selfUuid,
  }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(h.search),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self-sub' }, isLoading: false }),
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
  default: () => <div data-testid="rsvp-section" />,
}));
vi.mock('@/app/components/BallotSection', () => ({
  default: () => <div data-testid="ballot-section" />,
}));
vi.mock('@/app/components/BringGamePicker', () => ({ default: () => null }));
vi.mock('@/app/components/BringSummary', () => ({
  default: () => <div data-testid="bring-summary" />,
}));
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/GameSuggestionCard', () => ({ default: () => null }));
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
  game?: Record<string, unknown>;
}

/**
 * Render gameDetail with a resolved identity and a caller role.
 *
 * @example renderGameDetail({ role: 'member' })
 */
export function renderGameDetail(options: RenderGameDetailOptions = {}) {
  const { role = 'member', events = [SESSION], reviews = [], game = GAME } = options;
  h.selfUuid = SELF_UUID;
  h.search = `game_id=${GAME_ID}&group_id=${GROUP_ID}`;
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
}

/**
 * Render the SINGLE-EVENT view (`?event_id=`) — the tree that owns the
 * participant strip, the See-all modal and the guest-invite affordance.
 *
 * @example renderEventDetail({ role: 'owner', participants: [participantRow()] })
 */
export function renderEventDetail(options: RenderEventDetailOptions = {}) {
  const { role = 'owner', participants = [participantRow()] } = options;
  h.selfUuid = SELF_UUID;
  h.search = `event_id=${EVENT_ID}&group_id=${GROUP_ID}`;
  (eventsAPI.getEvent as Mock).mockResolvedValue({
    id: EVENT_ID,
    title: 'Game Night',
    start_date: '2026-03-01T18:00:00Z',
    duration_minutes: 120,
    group_id: GROUP_ID,
    Group: { id: GROUP_ID, name: 'The Group' },
    EventParticipations: participants,
  });
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
export async function sessionsSection(): Promise<HTMLElement> {
  const heading = await screen.findByRole('heading', { name: /^Game Sessions \(/ });
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
const FUTURE_SESSION = {
  id: 'evt-future',
  game_id: GAME_ID,
  group_id: GROUP_ID,
  // Always in the future relative to the test run.
  start_date: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
  duration_minutes: 120,
  comments: 'The upcoming night',
  EventParticipations: [],
};

describe('gameDetail Upcoming/history split (fork G, 88-33 Task 7)', () => {
  it('renders a future event in the Upcoming section WITH its RSVP surface, never in Game Sessions', async () => {
    renderGameDetail({ events: [SESSION, FUTURE_SESSION] });

    const upcomingHeading = await screen.findByRole('heading', { name: 'Upcoming (1)' });
    // History count excludes the future event.
    expect(
      screen.getByRole('heading', { name: 'Game Sessions (1)' })
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

      // Desktop layout: ghost-demoted, still visible.
      const desktopEdit = within(sessions).getByRole('button', { name: 'Edit' });
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
    const sessions = await sessionsSection();
    await user.click(within(sessions).getByRole('button', { name: 'Session actions' }));
    await user.click(within(sessions).getByRole('menuitem', { name: 'Delete' }));
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
    expect(await screen.findByRole('button', { name: 'Invite sent!' })).toBeInTheDocument();
  });

  it('falls back to the shipped 409 -> "Already invited" copy for an UNCODED conflict', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue({ status: 409 });
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    // 409 is "already a member or already invited" — not a failure to retry.
    expect(await screen.findByRole('button', { name: 'Already invited' })).toBeInTheDocument();
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
    expect(await screen.findByRole('button', { name: 'Invite pending' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('renders "Already a member" for the already_member envelope code', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue(
      new ApiError('This person is already a member of the group', 'already_member', 409)
    );
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    expect(await screen.findByRole('button', { name: 'Already a member' })).toBeInTheDocument();
  });

  it('still tells them apart from a CODE-LESS 409 (production, pre-88-34)', async () => {
    const user = userEvent.setup();
    (invitesAPI.sendParticipantInvite as Mock).mockRejectedValue({
      status: 409,
      message: 'This person already has a pending invite',
    });
    renderEventDetail({ role: 'owner', participants: [GUEST_WITH_ACCOUNT] });

    await user.click(await screen.findByRole('button', { name: INVITE }));
    expect(await screen.findByRole('button', { name: 'Invite pending' })).toBeInTheDocument();
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
