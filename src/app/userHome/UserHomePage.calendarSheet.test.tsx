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

/**
 * EXTENDED BY PLAN 88.5-08 (SPEC Reqs 2-4, OWNER RULING 2a): the sheet now leads with the
 * "Next game night" hero and its upcoming section subdivides into Happening now (unlabelled,
 * uncounted) / This week (carrying the twin count pill) / Later. See the `Phase 88.5` describes
 * at the bottom.
 *
 * THE CLOCK IS FIXED, and that is a correctness requirement, not tidiness. The happening-now
 * classification asks whether an event STARTED EARLIER TODAY — "today" in `America/New_York`,
 * the timezone this file mocks. Against the real wall clock a fixture at `now - 2h` falls on
 * YESTERDAY's date key whenever the suite happens to run between midnight and 02:00 local,
 * which drops it out of `futureGroups` entirely and reds the pin for reasons that have nothing
 * to do with the code. Only `Date` is faked (`toFake: ['Date']`) so `setTimeout` stays real and
 * `userEvent` behaves exactly as it did before — faking timers wholesale here would require
 * threading `advanceTimers` through every interaction.
 *
 * Fixtures are built from `FIXED_NOW` rather than `Date.now()` because they are module-level
 * constants: they are evaluated at IMPORT time, before any `beforeEach` installs the clock.
 */
const FIXED_NOW = new Date('2026-09-04T18:00:00.000Z'); // Friday 2:00 PM America/New_York
const at = (offsetMs: number) => new Date(FIXED_NOW.getTime() + offsetMs).toISOString();

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

/**
 * Phase 88.5-08 fixtures. Each exists to DISCRIMINATE one classification from another; a
 * fixture that every candidate implementation would bucket the same way pins nothing.
 *
 *   HAPPENING_NOW  — live, started 2h ago, so still on TODAY's date key (it is inside
 *                    `futureGroups`) but already begun. Separates "in `futureGroups`" from
 *                    "counted as upcoming".
 *   FAR_FUTURE     — live, 10 days out. Separates the 7-day selector from "everything in the
 *                    future range": an implementation that counted the raw list, or re-derived
 *                    This week from date keys, would swallow this one.
 *   CANCELLED_SOON — 2 days out, so INSIDE the 7-day window by date, but not live. Separates
 *                    the status half of the predicate from the date half.
 */
const HAPPENING_NOW = {
  id: 'e-now',
  group_id: 'g5',
  game_id: 'game-root',
  start_date: at(-2 * HOUR),
  status: 'in_progress',
  Game: { name: 'Root' },
  Group: { name: 'Epsilon' },
  EventParticipations: [],
};

const FAR_FUTURE = {
  id: 'e-far',
  group_id: 'g6',
  game_id: 'game-brass',
  start_date: at(10 * DAY),
  status: 'scheduled',
  Game: { name: 'Brass' },
  Group: { name: 'Zeta' },
  EventParticipations: [],
};

const CANCELLED_SOON = {
  id: 'e-cancelled',
  group_id: 'g7',
  game_id: 'game-tm',
  start_date: at(2 * DAY),
  status: 'cancelled',
  Game: { name: 'Terraforming Mars' },
  Group: { name: 'Eta' },
  EventParticipations: [],
};

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
// Phase 88.5-08: this stub gained ONE affordance — a button that fires the host's
// `onGroupSettingsUpdated`, which is the shipped path that bumps `refreshKey` and therefore
// RE-RUNS the events fetch. That is the only way to reach the stale-data-during-refetch state
// from outside the component, and reaching it from outside is what makes the pin meaningful.
vi.mock('@/app/components/grouplist', () => ({
  default: ({ onGroupSettingsUpdated }: { onGroupSettingsUpdated?: () => void }) => (
    <button type="button" onClick={() => onGroupSettingsUpdated?.()}>
      force a group refresh
    </button>
  ),
}));
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
 * Row order, read in DOM order. Every seeded-shape event's title falls back to its game name
 * (see the fixture note), so this reads as the list of game names top to bottom.
 *
 * RE-POINTED BY PLAN 88.5-08 (DR2-7b). This used to be `getAllByRole('heading', { level: 5 })`,
 * which is no longer a description of "the rows": the sheet arm now renders row titles at TWO
 * levels — `h5` for happening-now rows (which keep `EventRow`'s default level) and `h6` for
 * This-week/Later rows (demoted one level beneath their sub-section's `h5` date header) — and,
 * worse, the This-week/Later DATE HEADERS are themselves `h5`, so a level-5 query now returns a
 * mix of rows and date headers.
 *
 * It reads STRUCTURE instead of level: a row title is the heading that lives inside an
 * `EventRow`, and an `EventRow` is the `role="button"` container. Date headers sit outside any
 * row, and the hero's when-line is a plain `<span>` inside a NATIVE `<button>` (no `role`
 * attribute), so neither can leak in. This survives any future heading-level change.
 */
function rowOrder(dialog: HTMLElement): string[] {
  return Array.from(dialog.querySelectorAll('h4, h5, h6'))
    .filter((el) => el.closest('[role="button"]') !== null)
    .map((el) => (el.textContent ?? '').trim());
}

/**
 * The Calendar button, read while the sheet is OPEN.
 *
 * `hidden: true` is required, not laziness: the open dialog `aria-hidden`s the rest of the
 * page, so the default (accessibility-tree-only) query cannot see the button at all. Reading it
 * here — rather than before opening — is what makes the single-selector pin a ONE-RENDER
 * assertion: the button and the sheet's contents are outputs of the same commit.
 */
function calendarButton(): HTMLElement {
  return screen.getByRole('button', { name: /^calendar\b/i, hidden: true });
}

/**
 * The `This week` / `Later` sub-section, resolved through the `aria-labelledby` wiring rather
 * than by role: `<section>` only maps to `region` when it has an accessible name, and this
 * asserts the WIRING (subheader id ↔ section label) at the same time as it finds the element.
 */
function subSection(dialog: HTMLElement, name: 'This week' | 'Later'): HTMLElement {
  // Prefix match, not exact: the This-week subheader's accessible name carries an
  // sr-only count clause (", N upcoming this week" — ML15, 2026-09-01) whenever the
  // pill shows one, mirroring the Calendar button's counted name.
  const heading = within(dialog).getByRole('heading', {
    level: 4,
    name: new RegExp(`^${name}\\b`),
  });
  const section = dialog.querySelector(`section[aria-labelledby="${heading.id}"]`);
  expect(section, `no <section> is labelled by the "${name}" subheader`).not.toBeNull();
  return section as HTMLElement;
}

/** Row count inside a sub-section — `EventRow` is the `role="button"` container. */
function sectionRowCount(section: HTMLElement): number {
  return within(section).queryAllByRole('button').length;
}

/** True when `a` precedes `b` in DOM order. */
function precedes(a: Element, b: Element): boolean {
  return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
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
  // Phase 88.5-08: see the FIXED_NOW note at the top. `Date` only — timers stay real.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FIXED_NOW);

  h.selfUuid = SELF_UUID;
  h.isError = false;
  h.calendarMounts = 0;
  h.push.mockClear();
  // The api mock is module-level, so call history LEAKS across tests without this
  // (`vi.restoreAllMocks()` does not clear a plain `vi.fn()`'s calls). A leaked
  // call is what makes a "called once" assertion read 2 and look like a duplicate
  // fetch that is not there.
  //
  // Phase 88.5-08: the IMPLEMENTATION is restored too, not just the call history. `mockClear`
  // leaves a `mockResolvedValue`/`mockImplementation` set by a previous test in place, so the
  // stale-refetch pin's never-settling override, and the persisted-status pin's populated
  // rsvps, would silently leak into every test that ran after them. Each line below restores
  // exactly the default the `vi.mock` factory declares — `mockReset` would strip it instead
  // and leave `getUserEvents` returning `undefined`, which crashes on `.then`.
  const eventsFn = await getEventsMock();
  eventsFn.mockClear();
  eventsFn.mockImplementation(() => new Promise(() => {}));
  const rsvp = await getRsvpMocks();
  rsvp.getEventRsvps.mockClear();
  rsvp.getEventRsvps.mockResolvedValue({ rsvps: [], summary: { yes: 0, maybe: 0, no: 0 } });
  rsvp.submitRsvp.mockClear();
  rsvp.submitRsvp.mockResolvedValue({ id: 'rsvp-mock', status: 'yes', note: null });
});

afterEach(() => {
  cleanup();
  h.selfUuid = undefined;
  h.isError = false;
  vi.restoreAllMocks();
  vi.useRealTimers();
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
  it('the first row is the soonest upcoming event, and the hero sits above it', async () => {
    const { dialog } = await openSheetWith(EVENTS);
    await within(dialog).findByText('Catan');

    const order = rowOrder(dialog);
    // Soonest-first, not latest-first: the two futures are 3 days apart, so a reversed
    // sort puts Gloomhaven here and fails.
    expect(order[0]).toBe('Catan');
    expect(order.indexOf('Gloomhaven')).toBeGreaterThan(order.indexOf('Catan'));

    // EXTENDED by plan 88.5-08 (SPEC Req 3): the hero leads the sheet, above the first row —
    // and is NOT absorbed into the row list. Its when-line is deliberately a span rather than
    // a heading; if that ever changes, this assertion reds here rather than silently shifting
    // every `order[0]` in the file.
    const hero = within(dialog).getByRole('button', { name: /open event$/i });
    const firstRow = within(dialog).getByRole('button', { name: /Catan/ });
    expect(precedes(hero, firstRow)).toBe(true);
    expect(order).not.toContain('Next game night');
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

      // EXTENDED by plan 88.5-08 (D-04): NONE of the three sub-sections may render as an
      // empty shell — not the happening-now group (which would show a bare date header), not
      // This week, not Later. The empty line stands only when all three are empty.
      // Prefix regexes, not exact names: the This-week heading's name can carry the
      // sr-only count clause (ML15), and an exact-name null-check would pass VACUOUSLY
      // against a counted heading that wrongly rendered here.
      expect(within(dialog).queryByRole('heading', { level: 4, name: /^This week\b/ })).toBeNull();
      expect(within(dialog).queryByRole('heading', { level: 4, name: /^Later\b/ })).toBeNull();
      expect(rowOrder(dialog)).toEqual([]);
      // No hero either (SPEC Req 3), and still NO CTA — the 88-18 rule.
      expect(within(dialog).queryByText('Next game night')).toBeNull();
      expect(
        within(dialog).queryByRole('button', { name: /plan game session|create.*event/i })
      ).toBeNull();
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

// Plan 88.5-08 — SPEC Reqs 2/3/4, D-04, and OWNER RULING 2a (2026-08-31).
//
// The badge on the Calendar button is a PROMISE about what is behind it, so the number and the
// first thing the sheet shows have to be the same set. These pin that promise mechanically, and
// each fixture is chosen so a plausible wrong implementation fails rather than coincides.
describe('Phase 88.5 — Happening now / This week / Later', () => {
  it('the button count, the twin pill and the This-week rows are ONE value in one render', async () => {
    // SPEC Req 2's acceptance, stated mechanically. DISCRIMINATING FIXTURE: Brass is 10 days
    // out. An implementation that counted the raw list, or re-derived "this week" from
    // `futureGroups`' date keys, reads 3 where the selector says 2 — so it reds here. A fixture
    // with everything in-window would pass under every candidate and pin nothing.
    const { dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER, FAR_FUTURE]);
    await within(dialog).findByText('Catan');

    expect(calendarButton()).toHaveAccessibleName('Calendar, 2 upcoming games this week');

    const heading = within(dialog).getByRole('heading', { level: 4, name: /^This week\b/ });
    // The twin pill's digits. It is `aria-hidden` (the count is in the button's name), which is
    // why the heading's own accessible name above is still exactly "This week".
    expect(within(heading).getByText('2')).toBeInTheDocument();

    expect(sectionRowCount(subSection(dialog, 'This week'))).toBe(2);
    // and the out-of-window event is visible under Later rather than quietly counted.
    expect(within(subSection(dialog, 'Later')).getByText('Brass')).toBeInTheDocument();
  });

  it('an already-started event renders ABOVE This week and is counted nowhere', async () => {
    // OWNER RULING 2a. Root began 2h ago, so it is still on today's date key (inside
    // `futureGroups`) but is no longer "upcoming".
    const { dialog } = await openSheetWith([HAPPENING_NOW, FUTURE_EVENT, FAR_FUTURE]);
    await within(dialog).findByText('Root');

    expect(rowOrder(dialog)).toEqual(['Root', 'Catan', 'Brass']);

    const thisWeekHeading = within(dialog).getByRole('heading', { level: 4, name: /^This week\b/ });
    const rootRow = within(dialog).getByRole('button', { name: /Root/ });
    expect(precedes(rootRow, thisWeekHeading)).toBe(true);

    // UNCOUNTED, in all three places the number surfaces, and absent from the counted section.
    expect(calendarButton()).toHaveAccessibleName('Calendar, 1 upcoming game this week');
    expect(within(thisWeekHeading).getByText('1')).toBeInTheDocument();
    const week = subSection(dialog, 'This week');
    expect(sectionRowCount(week)).toBe(1);
    expect(within(week).queryByText('Root')).toBeNull();
  });

  it('a cancelled future event renders under Later in date order, and is counted nowhere', async () => {
    // OWNER RULING 2a's other half. Terraforming Mars is 2 days out — INSIDE the 7-day window
    // by date — so only the status half of the predicate keeps it out of This week.
    const { dialog } = await openSheetWith([FUTURE_EVENT, CANCELLED_SOON, FAR_FUTURE]);
    await within(dialog).findByText('Catan');

    const later = subSection(dialog, 'Later');
    // DATE-ORDERED alongside Later's other rows (Sep 6 before Sep 14) — not appended after the
    // live ones, which is what a two-pass "live first, then the rest" build would produce.
    expect(rowOrder(later)).toEqual(['Terraforming Mars', 'Brass']);

    const week = subSection(dialog, 'This week');
    expect(sectionRowCount(week)).toBe(1);
    expect(within(week).queryByText('Terraforming Mars')).toBeNull();
    expect(calendarButton()).toHaveAccessibleName('Calendar, 1 upcoming game this week');
  });

  it('the sheet arm nests its headings h3 > h4 > h5 > h6 with no shared level (DR2-7b)', async () => {
    // All three groups present in ONE render, so the pin exercises the whole outline.
    const { dialog } = await openSheetWith([HAPPENING_NOW, FUTURE_EVENT, FAR_FUTURE]);
    await within(dialog).findByText('Root');

    const levelText = (level: number) =>
      within(dialog)
        .getAllByRole('heading', { level })
        .map((el) => (el.textContent ?? '').replace(/\s+/g, ' ').trim());

    expect(levelText(3)).toEqual(['Upcoming events']);
    // h4 = the happening-now group's DAY header (it has no sub-section heading above it, so it
    // keeps `DateGroup`'s default level) plus the two sub-section headings. "This week1" is the
    // subheader with its twin pill seated inside it, followed by the sr-only count clause
    // (", 1 upcoming this week" — ML15, 2026-09-01) that announces what the aria-hidden pill
    // only shows.
    expect(levelText(4)).toEqual([
      'Friday, September 4',
      'This week1, 1 upcoming this week',
      'Later',
    ]);
    // h5 = the happening-now ROW title (default `EventRow` level), then This-week/Later's day
    // headers, demoted one level beneath their `h4` sub-section heading.
    expect(levelText(5)).toEqual(['Root', 'Friday, September 4', 'Monday, September 14']);
    // h6 = This-week/Later ROW titles only.
    expect(levelText(6)).toEqual(['Catan', 'Brass']);

    // Friday September 4 appears at BOTH h4 and h5 above: the same calendar day holds Root
    // (started) and Catan (not yet), and the date group was split BY EVENT rather than assigned
    // to one bucket wholesale. A wholesale assignment renders that header once and reds here.
  });
});

describe('Phase 88.5 — the "Next game night" hero in the sheet', () => {
  it('renders NO hero while a refetch is pending, even with the prior array still in state', async () => {
    // The events effect never clears `upcomingEvents` before a refetch, so during that window
    // the array still holds the PREVIOUS list. A hero gated only on "is there a selected event"
    // would present a stale, possibly since-cancelled row as the current answer.
    const fn = await getEventsMock();
    fn.mockResolvedValueOnce([FUTURE_EVENT, FUTURE_LATER]);
    // The refetch never settles — the pending window, held open.
    fn.mockImplementation(() => new Promise(() => {}));

    const user = userEvent.setup();
    renderHome();

    // POSITIVE CONTROL: the hero IS there once the first fetch settles. Without it, a sheet
    // that rendered nothing at all would pass the absence assertion below vacuously.
    {
      const dialog = await openCalendarSheet(user);
      expect(await within(dialog).findByText('Next game night')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();
    }

    await user.click(screen.getByRole('button', { name: /force a group refresh/i }));

    const dialog = await openCalendarSheet(user);
    // The stale rows ARE still on screen — that is the point. The pending gate has to take
    // priority over them, not follow the array.
    expect(await within(dialog).findByText('Catan')).toBeInTheDocument();
    expect(within(dialog).queryByText('Next game night')).toBeNull();
    // And no count claim is made while pending (the `null`-is-not-`0` rule).
    expect(calendarButton()).toHaveAccessibleName('Calendar');
  });

  it('shows the eyebrow, the when-line and the group name — and no "hosted by" anywhere (D-14)', async () => {
    const { dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER]);

    expect(await within(dialog).findByText('Next game night')).toBeInTheDocument();
    expect(within(dialog).getByText(/Friday, Sep 4/)).toBeInTheDocument();
    expect(within(dialog).getByText('Alpha')).toBeInTheDocument();
    // D-14: there is no host field on the wire, so inventing one is the failure mode. Asserted
    // as a SUBSTRING over the whole dialog, not as an element query — the copy could arrive in
    // any element.
    expect(dialog.textContent ?? '').not.toMatch(/hosted by/i);
  });

  it('tapping the hero navigates where the rows navigate and leaves no sheet behind', async () => {
    const { user, dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER]);
    await within(dialog).findByText('Next game night');

    await user.click(within(dialog).getByRole('button', { name: /open event$/i }));

    // The close-before-navigate ordering `handleCalendarSheetEventClick` owns, observed the
    // only way jsdom can (React batches both into one commit): no dialog survives the tap.
    expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();
    expect(h.push).toHaveBeenCalledTimes(1);
    expect(h.push).toHaveBeenCalledWith(
      `/gameDetail?event_id=${FUTURE_EVENT.id}&group_id=${FUTURE_EVENT.group_id}`
    );
  });

  it('renders no hero when there is nothing upcoming, and the empty state stands', async () => {
    const { dialog } = await openSheetWith([PAST_EVENT, PAST_OLDER]);

    expect(await within(dialog).findByText('No upcoming events')).toBeInTheDocument();
    expect(within(dialog).queryByText('Next game night')).toBeNull();
  });

  it('renders no hero on the identity-error branch (T-88.5-26)', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    expect(
      within(dialog).getByText(/some personal controls are unavailable/i)
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Next game night')).toBeNull();
  });

  it('renders no hero on the fetch-error branch (T-88.5-26)', async () => {
    await mockEvents(new Error('boom'));
    const user = userEvent.setup();
    renderHome();

    const dialog = await openCalendarSheet(user);
    expect(
      await within(dialog).findByText("We couldn't load your calendar")
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Next game night')).toBeNull();
  });

  it("tapping \"I'm in\" submits the hero event's RSVP through the sheet", async () => {
    // The round trip and the failure path are pinned at the component level in plan 88.5-05;
    // this proves the WIRING through the sheet — right event id, right status.
    const { user, dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER]);
    await within(dialog).findByText('Next game night');

    await user.click(within(dialog).getByRole('button', { name: "I'm in" }));

    expect(await within(dialog).findByText("You're going!")).toBeInTheDocument();
    const { submitRsvp } = await getRsvpMocks();
    expect(submitRsvp).toHaveBeenCalledWith(FUTURE_EVENT.id, 'yes');
  });

  it('shows the persisted going state when the sheet is closed and reopened', async () => {
    const { getEventRsvps } = await getRsvpMocks();
    getEventRsvps.mockResolvedValue({
      rsvps: [{ User: { id: SELF_UUID }, status: 'yes' }],
      summary: { yes: 1, maybe: 0, no: 0 },
    });

    const { user, dialog } = await openSheetWith([FUTURE_EVENT, FUTURE_LATER]);
    expect(await within(dialog).findByText("You're going!")).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull();

    const reopened = await openCalendarSheet(user);
    expect(await within(reopened).findByText("You're going!")).toBeInTheDocument();
    // The unanswered copy must not flash in as the resolved state — "not read yet" and "no
    // answer" are different states (the card's UNKNOWN rule).
    expect(within(reopened).queryByText('RSVP to this event')).toBeNull();
  });
});
