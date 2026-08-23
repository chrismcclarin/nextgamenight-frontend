// Phase 88.1 plan 10 — Req 11b phone calendar-sheet pins.
//
// These exist because the sheet hosts the BARE list view, which does not bring the
// calendar component's built-in WR-03 error banner along with it. Everything the
// host has to wire by hand is therefore un-gated unless it is pinned here.
//
// What these lock, in order of how badly a regression would hurt:
//   1. ERROR IS CHECKED BEFORE EMPTY (T-88.1-27). An errored fetch also has zero
//      events, so a flipped branch shows "No events" at someone whose request
//      failed — the exact `DECISION Phase 88-18` bug re-hosted. Two branches, two
//      pins: terminal identity failure (ML-17) and the events-fetch failure.
//   2. THE CALENDAR COMPONENT IS NOT RE-MOUNTED (T-88.1-28). Its
//      `saveCalendarPrefs` effect fires on mount, so a second `scope='home'` mount
//      would silently overwrite the desktop calendar's saved view. Pinned as a
//      mount COUNT, which is the only thing that actually catches a second mount.
//   3. ONE FETCH. The sheet consumes the page's in-memory result; a second
//      `getUserEvents` call would mean a loading flash and a duplicate request.
//   4. The tap outcome: the sheet is gone AND the navigation happened, with the
//      destination matching the desktop calendar's own event-click rule.
//
// Geometry (the 44x44 floor, the 85dvh height, Footer occlusion, whether the game
// text is visually clipped) is deliberately NOT asserted here: jsdom has no layout,
// so a pixel assertion would be theatre. That is e2e/phone-home-event-discovery's job.
import * as React from 'react';
import { render, screen, cleanup, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHEET_TITLE = 'Calendar';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * Two rows, deliberately of the two shapes the click rule discriminates between:
 * a FUTURE event (opens by event id) and a PAST event that has a game (opens by
 * game id). Neither carries an explicit `title`, which is the common shape in this
 * app's own seed data — `eventTitle` then falls back to the game name, which is why
 * the row heading is the game text the requirement is about.
 */
const FUTURE_EVENT = {
  id: 'e-soon',
  group_id: 'g1',
  game_id: 'game-catan',
  start_date: at(2 * HOUR),
  status: 'scheduled',
  Game: { name: 'Catan' },
  Group: { name: 'Alpha' },
  EventParticipations: [],
};

const PAST_EVENT = {
  id: 'e-past',
  group_id: 'g2',
  game_id: 'game-wingspan',
  start_date: at(-3 * DAY),
  status: 'completed',
  Game: { name: 'Wingspan' },
  Group: { name: 'Beta' },
  EventParticipations: [],
};

const EVENTS = [PAST_EVENT, FUTURE_EVENT];

// Mutable identity, mirroring UserHomePage.identity.test.tsx's harness.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  push: vi.fn(),
  calendarMounts: 0,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: {
      isError: h.isError,
      error: h.isError ? new Error('identity failed') : null,
      refetch: vi.fn(),
    },
    isPending: !h.selfUuid && !h.isError,
  }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  // A STABLE push across renders — a fresh vi.fn() per call (the sibling phone
  // spec's shape, which never asserts on it) would make every call assertion here
  // read an object nobody kept.
  useRouter: () => ({ push: h.push }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Siblings that own their own fetches are out of scope for these pins. The calendar
// stub COUNTS ITS MOUNTS — that count is the T-88.1-28 pin, not decoration.
vi.mock('@/app/components/grouplist', () => ({ default: () => <div>group list</div> }));
vi.mock('@/app/components/EventCalendar', () => ({
  default: () => {
    React.useEffect(() => {
      h.calendarMounts += 1;
    }, []);
    return <div>desktop calendar</div>;
  },
}));
vi.mock('@/app/components/FriendInvitePanel', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    eventsAPI: {
      ...actual.eventsAPI,
      // Never settles by default: the in-flight attempt against a dead backend.
      getUserEvents: vi.fn(() => new Promise(() => {})),
    },
  };
});

import UserHome from './UserHomePage';

/** UserHomePage is `.js`, so its inferred prop type has every prop REQUIRED. */
function renderHome() {
  return render(
    <UserHome
      GroupList={null}
      getGroupList={vi.fn()}
      onCreateGroup={vi.fn()}
      groupListRefreshKey={0}
      onMemberAdded={vi.fn()}
    />
  );
}

async function getEventsMock() {
  const api = await import('@/lib/api');
  return api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>;
}

async function mockEvents(value: unknown[] | Error) {
  const fn = await getEventsMock();
  if (value instanceof Error) fn.mockRejectedValue(value);
  else fn.mockResolvedValue(value);
}

/** Open the 11b sheet through its only entry point and return the dialog. */
async function openCalendarSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: /^calendar$/i }));
  return screen.getByRole('dialog', { name: SHEET_TITLE });
}

beforeEach(async () => {
  h.selfUuid = SELF_UUID;
  h.isError = false;
  h.calendarMounts = 0;
  h.push.mockClear();
  // The api mock is module-level, so call history LEAKS across tests without this
  // (`vi.restoreAllMocks()` does not clear a plain `vi.fn()`'s calls). A leaked
  // call is what makes a "called once" assertion read 2 and look like a duplicate
  // fetch that is not there.
  (await getEventsMock()).mockClear();
});

afterEach(() => {
  cleanup();
  h.selfUuid = undefined;
  h.isError = false;
  vi.restoreAllMocks();
});

describe('Req 11b — the Calendar button and its sheet', () => {
  it('opens the calendar sheet with the page rows in it, in one tap', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    // Both rows come from the page's list, not a sheet-local fetch.
    expect(await within(dialog).findByText('Catan')).toBeInTheDocument();
    expect(within(dialog).getByText('Wingspan')).toBeInTheDocument();
  });

  it('consumes the page fetch — it does not issue a second getUserEvents', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    // Sample BEFORE opening. The absolute count at mount is a property of the
    // test environment's effect semantics, not of this plan — what Req 11b's "no
    // second fetch" actually means is that OPENING THE SHEET adds none.
    await screen.findByRole('button', { name: /^calendar$/i });
    const fn = await getEventsMock();
    const callsBeforeOpen = fn.mock.calls.length;
    expect(callsBeforeOpen).toBeGreaterThan(0);

    await openCalendarSheet(user);
    await within(screen.getByRole('dialog', { name: SHEET_TITLE })).findByText('Catan');

    expect(fn.mock.calls.length).toBe(callsBeforeOpen);
  });

  it('does NOT re-mount the calendar component (T-88.1-28)', async () => {
    // A second `scope="home"` mount overwrites the desktop calendar's saved view
    // on mount. One mount before the sheet opens; still one after.
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    expect(h.calendarMounts).toBe(1);
    await openCalendarSheet(user);
    await within(screen.getByRole('dialog', { name: SHEET_TITLE })).findByText('Catan');
    expect(h.calendarMounts).toBe(1);
  });

  it('has exactly one dismiss-labelled close control and closes on it', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    await user.click(within(dialog).getByRole('button', { name: /close/i }));
    expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();
  });

  it('closes on Escape', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    await openCalendarSheet(user);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();
  });
});

describe('Req 11b — error is checked BEFORE empty (T-88.1-27)', () => {
  it('a failed events fetch shows the calendar error copy, never the empty state', async () => {
    await mockEvents(new Error('boom'));
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    expect(
      await within(dialog).findByText("We couldn't load your calendar")
    ).toBeInTheDocument();
    // The empty state is what a flipped branch order would render here.
    expect(within(dialog).queryByText('No events')).toBeNull();
  });

  it('terminal identity failure degrades to the compact notice, never the empty state', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    expect(
      within(dialog).getByText(/some personal controls are unavailable/i)
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('No events')).toBeNull();
    // The identity branch is checked FIRST, so the events copy is not also shown.
    expect(within(dialog).queryByText("We couldn't load your calendar")).toBeNull();
  });
});

describe('Req 11b — tapping an event', () => {
  it('leaves no open sheet behind and navigates by EVENT id for a future event', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    await within(dialog).findByText('Catan');
    await user.click(within(dialog).getByRole('button', { name: /Catan/ }));

    // Observable half of "close BEFORE navigate": no dialog survives the tap.
    // The ORDERING itself is a code-level guarantee (the close call sits on the
    // line above the push) and is observed from outside by the phone e2e — React
    // batches both into one commit, so jsdom cannot see the order.
    expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(
      `/gameDetail?event_id=${FUTURE_EVENT.id}&group_id=${FUTURE_EVENT.group_id}`
    );
  });

  it('navigates by GAME id for a past event that has a game', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    await within(dialog).findByText('Wingspan');
    await user.click(within(dialog).getByRole('button', { name: /Wingspan/ }));

    expect(h.push).toHaveBeenCalledWith(
      `/gameDetail?game_id=${PAST_EVENT.game_id}&group_id=${PAST_EVENT.group_id}`
    );
  });
});
