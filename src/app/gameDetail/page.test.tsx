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
import { render, screen, within, cleanup } from '@testing-library/react';
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

const h = vi.hoisted(() => ({ selfUuid: undefined as string | undefined }));

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
  useSearchParams: () => new URLSearchParams(`game_id=${GAME_ID}&group_id=${GROUP_ID}`),
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
vi.mock('@/app/components/RsvpSection', () => ({ default: () => null }));
vi.mock('@/app/components/BallotSection', () => ({ default: () => null }));
vi.mock('@/app/components/BringGamePicker', () => ({ default: () => null }));
vi.mock('@/app/components/BringSummary', () => ({ default: () => null }));
vi.mock('@/app/components/createEvent', () => ({ default: () => null }));
vi.mock('@/app/components/GameSuggestionCard', () => ({ default: () => null }));
vi.mock('@/app/components/QRCodeModal', () => ({ default: () => null }));
vi.mock('@/app/components/TimezoneNudgeBanner', () => ({ default: () => null }));
vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));
vi.mock('@/app/components/StarRatingPicker', () => ({ default: () => null }));
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
    eventsAPI: { getGroupEvents: vi.fn(), getEvent: vi.fn(), deleteEvent: vi.fn() },
    gameReviewsAPI: { getGameReviews: vi.fn(), submitReview: vi.fn(), deleteReview: vi.fn() },
    groupsAPI: { getGroupMembers: vi.fn() },
    rsvpAPI: { getEventRsvps: vi.fn() },
    eventBringsAPI: { getEventBrings: vi.fn() },
    suggestionsAPI: { getEventSuggestions: vi.fn() },
    invitesAPI: { sendParticipantInvite: vi.fn() },
  };
});

import GameDetailPage from './page';
import { gamesAPI, eventsAPI, gameReviewsAPI, groupsAPI, rsvpAPI } from '@/lib/api';

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
  (gamesAPI.getGame as Mock).mockResolvedValue(game);
  (eventsAPI.getGroupEvents as Mock).mockResolvedValue(events);
  (gameReviewsAPI.getGameReviews as Mock).mockResolvedValue(reviews);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(rosterFor(role));
  (rsvpAPI.getEventRsvps as Mock).mockResolvedValue({ rsvps: [] });
  return render(<GameDetailPage />);
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
    // The filter inputs are not label-associated on this branch (that is plan
    // 88-20's form-control scope, not this plan's) — reach the control through
    // its label's own wrapper rather than silently widening this plan.
    const minDurationField = screen.getByText('Min Duration (min)').parentElement as HTMLElement;
    await user.type(within(minDurationField).getByRole('spinbutton'), '60');

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
