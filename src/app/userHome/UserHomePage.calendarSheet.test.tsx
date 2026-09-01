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
//
// EXTENDED BY PLAN 88.1-17 (SPEC Req 12): the sheet arm no longer renders one
// chronological feed. It renders upcoming events first and collapses past events behind
// a counted disclosure, so this file additionally locks ORDER and the COLLAPSE — see the
// `Req 12` describe at the bottom. Two of the plan-10 pins above were RE-POINTED rather
// than deleted (each says so at its site); both were asserting that a past row is on
// screen the instant the sheet opens, which Req 12 makes false by design.
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
 * FOUR rows — two past, two future — deliberately of the two shapes the click rule
 * discriminates between: a FUTURE event (opens by event id) and a PAST event that has
 * a game (opens by game id). None carries an explicit `title`, which is the common
 * shape in this app's own seed data — `eventTitle` then falls back to the game name,
 * which is why the row heading is the game text the requirement is about.
 *
 * TWO ON EACH SIDE IS THE NON-VACUITY (plan 88.1-17, T-88.1-45). With one past and one
 * future row, "upcoming first" cannot distinguish soonest-first from latest-first, and
 * "past most-recent-first" cannot distinguish either direction — a reversed sort would
 * pass. The two futures are 3 days apart and the two pasts 7 days apart, and `EVENTS`
 * is passed SCRAMBLED so the component's own sort is what is under test.
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

const FUTURE_LATER = {
  id: 'e-later',
  group_id: 'g3',
  game_id: 'game-gloomhaven',
  start_date: at(3 * DAY),
  status: 'scheduled',
  Game: { name: 'Gloomhaven' },
  Group: { name: 'Gamma' },
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

const PAST_OLDER = {
  id: 'e-older',
  group_id: 'g4',
  game_id: 'game-azul',
  start_date: at(-10 * DAY),
  status: 'completed',
  Game: { name: 'Azul' },
  Group: { name: 'Delta' },
  EventParticipations: [],
};

/** Deliberately NOT in chronological order — see the fixture note above. */
const EVENTS = [FUTURE_LATER, PAST_OLDER, FUTURE_EVENT, PAST_EVENT];

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
vi.mock('@/app/components/EventCalendar', () => {
  // Named (and capitalised) on purpose: an inline `default: () => {...}` that calls a
  // hook trips react-hooks/rules-of-hooks, which is an ERROR in this repo's lint config
  // and fails `next build` — not just a test-file warning.
  function MockEventCalendar() {
    React.useEffect(() => {
      h.calendarMounts += 1;
    }, []);
    return <div>desktop calendar</div>;
  }
  return { default: MockEventCalendar };
});
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
    // Phase 88.5 (RESEARCH Pitfall 4) — rsvpAPI MUST be mocked here, not just
    // eventsAPI. `NextGameNightCard` (plan 88.5-05) mounts inside this sheet and
    // fires getEventRsvps on open; an unmocked rsvpAPI reaches the real apiFetch
    // and therefore a real jsdom fetch, which turns every test in this file into
    // an unhandled rejection. Neither override may be dropped "because this test
    // isn't about RSVPs" — the network reach is what breaks, not the assertion.
    rsvpAPI: {
      ...actual.rsvpAPI,
      // Neutral default = the "no RSVPs yet" state, shaped exactly like the route
      // (routes/rsvp.js:536 returns { rsvps, summary } with all three counts).
      getEventRsvps: vi.fn(() =>
        Promise.resolve({ rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } })
      ),
      submitRsvp: vi.fn(() =>
        Promise.resolve({ id: 'rsvp-mock', status: 'yes', note: null })
      ),
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

/** Phase 88.5 — accessor for the mocked rsvpAPI fns (same idiom as getEventsMock). */
async function getRsvpMocks() {
  const api = await import('@/lib/api');
  return {
    getEventRsvps: api.rsvpAPI.getEventRsvps as ReturnType<typeof vi.fn>,
    submitRsvp: api.rsvpAPI.submitRsvp as ReturnType<typeof vi.fn>,
  };
}

async function mockEvents(value: unknown[] | Error) {
  const fn = await getEventsMock();
  if (value instanceof Error) fn.mockRejectedValue(value);
  else fn.mockResolvedValue(value);
}

/** Open the 11b sheet through its only entry point and return the dialog. */
async function openCalendarSheet(user: ReturnType<typeof userEvent.setup>) {
  // Phase 88.5: end-anchored name regex relaxed to `/^calendar\b/i` — the button's
  // accessible name gains a count ("Calendar, {n} upcoming games this week",
  // UI-SPEC 6.1.5, plan 88.5-07). Prefix + word boundary, NOT a bare substring:
  // it must still exclude any other control whose name merely contains "calendar".
  // Do not re-tighten to an end anchor.
  await user.click(await screen.findByRole('button', { name: /^calendar\b/i }));
  return screen.getByRole('dialog', { name: SHEET_TITLE });
}

/**
 * Row order, read in DOM order. `EventRow`'s title is an `<h5>` and every
 * seeded-shape event's title falls back to its game name (see the fixture note),
 * so this reads as the list of game names top to bottom.
 */
function rowOrder(dialog: HTMLElement): string[] {
  return within(dialog)
    .getAllByRole('heading', { level: 5 })
    .map((h) => (h.textContent ?? '').trim());
}

/** The Req 12 past disclosure, by its accessible name (which carries the count). */
function pastToggle(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole('button', { name: /past events \(\d+\)/i });
}

/** Open the sheet on a given event list, from a clean tree. */
async function openSheetWith(events: unknown[]) {
  await mockEvents(events);
  const user = userEvent.setup();
  renderHome();
  const dialog = await openCalendarSheet(user);
  return { user, dialog };
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
  // Phase 88.5: same leak, same reason — these are module-level `vi.fn()`s too.
  const rsvp = await getRsvpMocks();
  rsvp.getEventRsvps.mockClear();
  rsvp.submitRsvp.mockClear();
});

afterEach(() => {
  cleanup();
  h.selfUuid = undefined;
  h.isError = false;
  vi.restoreAllMocks();
});

describe('Req 11b — the Calendar button and its sheet', () => {
  it('opens the calendar sheet with the page rows in it, in one tap', async () => {
    // RE-POINTED by plan 88.1-17 (SPEC Req 12). This originally asserted that BOTH the
    // future row and the past row were present the moment the sheet opened. Under Req 12
    // the past row must NOT be — so the inversion below is itself the collapse pin, and
    // the "rows come from the page's list, not a sheet-local fetch" claim this test
    // exists for is still made, now via the reveal.
    const { user, dialog } = await openSheetWith(EVENTS);

    expect(await within(dialog).findByText('Catan')).toBeInTheDocument();
    expect(within(dialog).queryByText('Wingspan')).toBeNull();

    await user.click(pastToggle(dialog));
    expect(within(dialog).getByText('Wingspan')).toBeInTheDocument();
  });

  it('consumes the page fetch — it does not issue a second getUserEvents', async () => {
    await mockEvents(EVENTS);
    const user = userEvent.setup();
    renderHome();

    // Sample BEFORE opening. The absolute count at mount is a property of the
    // test environment's effect semantics, not of this plan — what Req 11b's "no
    // second fetch" actually means is that OPENING THE SHEET adds none.
    // Phase 88.5: relaxed to a prefix for the counted accessible name — see the
    // note in openCalendarSheet above.
    await screen.findByRole('button', { name: /^calendar\b/i });
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
    // The empty state is what a flipped branch order would render here. The matcher
    // covers BOTH empty strings (T-88.1-27): plan 88.1-17 changed the sheet arm's copy to
    // "No upcoming events", so a guard looking only for the desktop "No events" line would
    // still pass while no longer catching the flipped branch it exists for.
    expect(within(dialog).queryByText(/^no (upcoming )?events$/i)).toBeNull();
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
    // Same T-88.1-27 widening as the guard above — see its comment.
    expect(within(dialog).queryByText(/^no (upcoming )?events$/i)).toBeNull();
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
    const { user, dialog } = await openSheetWith(EVENTS);

    // RE-POINTED by plan 88.1-17 (SPEC Req 12): past rows are behind the disclosure now.
    // The ASSERTION is unchanged on purpose — the past-event destination rule is live
    // behaviour (`UserHomePage.js` handleCalendarSheetEventClick), which is exactly why
    // Req 12 collapses past events rather than dropping them from the sheet.
    await within(dialog).findByText('Catan');
    await user.click(pastToggle(dialog));

    await within(dialog).findByText('Wingspan');
    await user.click(within(dialog).getByRole('button', { name: /Wingspan/ }));

    expect(h.push).toHaveBeenCalledWith(
      `/gameDetail?game_id=${PAST_EVENT.game_id}&group_id=${PAST_EVENT.group_id}`
    );
  });
});

// Plan 88.1-17 — SPEC Req 12 (owner walkthrough 2026-08-24, CONTEXT D-09).
//
// The owner opened this sheet to answer "when is the next one?" and got history first,
// because `CalendarListView` was designed as ONE chronological desktop feed. These pin
// the two-section shape: upcoming on top, past collapsed behind a counted disclosure.
//
// EVERY case here is written so the WRONG order fails it — see the fixture note above
// (T-88.1-45). A one-past/one-future fixture cannot tell a sort from its reverse.
describe('Req 12 — upcoming first, past collapsed', () => {
  it('the first row is the soonest upcoming event', async () => {
    const { dialog } = await openSheetWith(EVENTS);
    await within(dialog).findByText('Catan');

    const order = rowOrder(dialog);
    // Soonest-first, not latest-first: the two futures are 3 days apart, so a reversed
    // sort puts Gloomhaven here and fails.
    expect(order[0]).toBe('Catan');
    expect(order.indexOf('Gloomhaven')).toBeGreaterThan(order.indexOf('Catan'));
  });

  it('no past row is visible before the disclosure is opened', async () => {
    const { dialog } = await openSheetWith(EVENTS);

    // POSITIVE CONTROL FIRST: without it a sheet that rendered nothing at all would
    // pass both absence assertions vacuously.
    expect(await within(dialog).findByText('Catan')).toBeInTheDocument();
    expect(within(dialog).queryByText('Wingspan')).toBeNull();
    expect(within(dialog).queryByText('Azul')).toBeNull();
  });

  it('the disclosure names the total past count and is collapsed by default', async () => {
    const { dialog } = await openSheetWith(EVENTS);
    await within(dialog).findByText('Catan');

    const toggle = pastToggle(dialog);
    expect(toggle).toHaveAccessibleName(/past events \(2\)/i);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    // NON-VACUITY on the NUMBER: 2 is also what a count read off the visible window
    // would say here, so state what it must NOT be. (0) is "counted nothing at all",
    // (4) is "counted the whole list instead of the past bucket".
    const name = (toggle.textContent ?? '').trim();
    expect(name).not.toMatch(/\(0\)/);
    expect(name).not.toMatch(/\(4\)/);
  });

  it('expanding reveals past rows most-recent-first and reports itself expanded', async () => {
    const { user, dialog } = await openSheetWith(EVENTS);
    await within(dialog).findByText('Catan');

    const toggle = pastToggle(dialog);
    const panelId = toggle.getAttribute('aria-controls');
    expect(panelId, 'the disclosure carries no aria-controls').toBeTruthy();
    // The controlled region exists BEFORE expansion so aria-controls always resolves.
    const panel = document.getElementById(panelId as string);
    expect(panel, `aria-controls="${panelId}" resolves to no element`).not.toBeNull();
    expect(panel).toHaveAttribute('hidden');

    await user.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(panel).not.toHaveAttribute('hidden');

    // MOST-RECENT-FIRST: the two pasts are 7 days apart, so oldest-first fails here.
    // Read against the full row order so the past section's POSITION is pinned too —
    // it must sit below the whole upcoming section, not interleaved with it.
    expect(rowOrder(dialog)).toEqual(['Catan', 'Gloomhaven', 'Wingspan', 'Azul']);
  });

  it('renders the section-scoped empty line with no upcoming, and no past section with no past', async () => {
    // (a) Past only — the shared "No events" copy would be a lie here (there ARE
    // events, all of them past), which is why the sheet arm carries its own line.
    {
      const { dialog } = await openSheetWith([PAST_EVENT, PAST_OLDER]);
      expect(await within(dialog).findByText('No upcoming events')).toBeInTheDocument();
      expect(pastToggle(dialog)).toHaveAccessibleName(/past events \(2\)/i);
    }

    cleanup();

    // (b) Future only — no disclosure at all, and the upcoming section is populated
    // rather than empty.
    {
      const { dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER]);
      expect(await within(dialog).findByText('Catan')).toBeInTheDocument();
      expect(within(dialog).queryByText('No upcoming events')).toBeNull();
      expect(
        within(dialog).queryByRole('button', { name: /past events/i })
      ).toBeNull();
    }
  });
});
