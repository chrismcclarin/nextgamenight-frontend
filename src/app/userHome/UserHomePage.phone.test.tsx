// Phase 88.1 plan 08 — Req 11a phone-surface pins,
// RE-POINTED IN FULL BY PHASE 88.5 PLAN 07 (SPEC Req 1 / Req 2).
//
// WHAT CHANGED, so the next reader does not re-derive the coverage map. The phone-only
// fixed bottom event bar and the "Upcoming events" sheet it opened are DELETED (plan
// 88.5-07: the owner could not see the bar — "I didn't notice or see the bottom bar",
// 2026-08-28). Every pin below that had the bar as its subject was re-pointed, inverted or
// retired against a named green replacement; NOTHING was deleted while red and nothing is
// skipped, which is SPEC Req 1's acceptance. Where each block went:
//
//   COUNT + SUPPRESSION  -> the Calendar button's amber pill and its aria-label
//                           (UI-SPEC 6.1.5). Same contract, new carrier.
//   THE 11a SHEET        -> retired. Four of its five pins are covered by name in the
//                           SIBLING suite `UserHomePage.calendarSheet.test.tsx`, which was
//                           run green before each deletion:
//                             Escape close        -> "closes on Escape"
//                             close button        -> "has exactly one dismiss-labelled
//                                                     close control and closes on it"
//                             ML-17 identity      -> "terminal identity failure degrades to
//                                                     the compact notice, never the empty state"
//                             88-18 fetch error   -> "a failed events fetch shows the calendar
//                                                     error copy, never the empty state"
//                           The fifth ("opens on one tap, named Upcoming events") had no
//                           replacement and needed none: the surface is gone.
//   FOOTER SPACER        -> INVERTED. With the bar deleted there is one state, not two, so
//                           these now pin that NO spacer renders on any of the three return
//                           paths. They are what keeps the retirement honest rather than
//                           incidental (Footer.js, AMENDED Phase 88.5).
//   THE BAR'S DARK-THEME -> retired with no replacement. It pinned the bar's own always-dark
//   TEXT COLOUR             header text token; the element no longer exists, and re-homing a
//                           ruling about a surface that is gone would be theatre.
//   ROW OPERABILITY+AXE  -> re-pointed at the CALENDAR sheet, kept HERE (the sibling suite is
//                           owned by plans 88.5-01/08). None of these four is covered there,
//                           so retiring them would have been a real coverage loss — and the
//                           axe pin is the ONLY axe assertion on any bottom sheet in the repo,
//                           on the very sheet plan 88.5-08 is about to add a hero card and an
//                           RSVP toggle to. "closes the sheet BEFORE navigating" IS covered
//                           there twice ("leaves no open sheet behind…", "navigates by GAME
//                           id…") and was retired.
//
// What these lock now, in order of how badly a regression would hurt:
//   1. COUNT INTEGRITY. `UserHomePage.js` passes the RAW, unfiltered event list on purpose,
//      so a button reading `events.length` would advertise a number the sheet does not show.
//      The fixture below is built so raw length (5) and filtered length (2) DIFFER — a
//      regression to `events.length` fails these tests instead of passing them silently.
//   2. TRUTHFULNESS WHILE PENDING / ERRORED (DECISION Phase 88-33, re-pinned for the button).
//      `events=[]` means "not fetched yet" during the identity-resolution window and on
//      terminal identity failure; announcing it as a count is the exact lie 88-33 fixed.
//   3. THE EXACT RULED COPY, all four states including the SINGULAR arm — the pill is
//      `aria-hidden`, so the label is the only carrier of the number, and an off-by-one
//      plural is the classic silent copy defect.
//   4. Calendar-sheet rows stay operable (pointer AND keyboard) and the open sheet stays
//      axe-clean.
//   5. The Footer reserves NO bottom space on any return path.
//
// Geometry (heights, viewport units, occlusion) is deliberately NOT asserted: jsdom has no
// layout, so a pixel assertion here would be theatre. That is the phone e2e's job.
import * as React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axe } from 'vitest-axe';

import { selectUpcomingWithin7Days } from '@/lib/upcomingEvents';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHEET_TITLE = 'Calendar';

/** UI-SPEC 6.1.5, verbatim. The suppressed arm is the bare label. */
const NAME_SUPPRESSED = 'Calendar';
const nameFor = (n: number) =>
  n === 1
    ? 'Calendar, 1 upcoming game this week'
    : `Calendar, ${n} upcoming games this week`;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * DISCRIMINATING fixture: 5 raw rows, 2 of which are "upcoming".
 * A button counting `events.length` would say 5 over a sheet showing 2.
 */
const EVENTS = [
  {
    id: 'e-past',
    group_id: 'g1',
    start_date: at(-2 * DAY),
    status: 'scheduled',
    Game: { name: 'Yesterdays Game' },
    Group: { name: 'Alpha' },
    EventParticipations: [],
  },
  {
    id: 'e-soon',
    group_id: 'g1',
    start_date: at(2 * HOUR),
    status: 'scheduled',
    Game: { name: 'Catan' },
    Group: { name: 'Alpha' },
    EventParticipations: [],
  },
  {
    id: 'e-week',
    group_id: 'g2',
    start_date: at(3 * DAY),
    status: 'scheduled',
    Game: { name: 'Wingspan' },
    Group: { name: 'Beta' },
    EventParticipations: [],
  },
  {
    id: 'e-far',
    group_id: 'g2',
    start_date: at(10 * DAY),
    status: 'scheduled',
    Game: { name: 'Far Future Game' },
    Group: { name: 'Beta' },
    EventParticipations: [],
  },
  {
    id: 'e-cancelled',
    group_id: 'g1',
    start_date: at(DAY),
    status: 'cancelled',
    Game: { name: 'Cancelled Game' },
    Group: { name: 'Alpha' },
    EventParticipations: [],
  },
];

const FILTERED = selectUpcomingWithin7Days(EVENTS);

/** Exactly ONE upcoming row — the fixture for the singular arm of UI-SPEC 6.1.5. */
const ONE_UPCOMING = [EVENTS[0], EVENTS[1]];

// Mutable identity, mirroring UserHomePage.identity.test.tsx's harness.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  // Footer's third return path. Defaults false, so every pre-existing case sees the resolved
  // auth state it saw before.
  authLoading: false,
  /* Footer's PUBLIC return path. Added by 88.5-07: the inverted spacer pins have to cover all
     three paths, and with only `authLoading` this harness could reach two of them — the
     logged-out case would silently have rendered the AUTH footer and duplicated its
     neighbour. Defaults false, so every other case keeps the signed-in state it had. */
  loggedOut: false,
}));

/* WR-02: `useRouter` returned a FRESH `vi.fn()` on every call, so nothing could ever assert on
   navigation — the spy the component held was never the spy a test could read. Hoisted to ONE
   stable object instead. Verified before changing it: no pre-existing case in this file asserts
   on `push` (the only prior occurrence was the mock line itself), so this cannot flip an
   existing outcome. */
const nav = vi.hoisted(() => ({ push: vi.fn() }));

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
  useUser: () =>
    h.authLoading
      ? { user: undefined, isLoading: true }
      : h.loggedOut
        ? { user: undefined, isLoading: false }
        : { user: { sub: 'auth0|self' }, isLoading: false },
}));

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => nav,
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

// Siblings that own their own fetches are out of scope for these pins.
vi.mock('@/app/components/grouplist', () => ({ default: () => <div>group list</div> }));
vi.mock('@/app/components/EventCalendar', () => ({ default: () => <div>calendar</div> }));
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
    /* Phase 88.5-07 (threat T-88.5-25) — rsvpAPI MUST be stubbed here too, not just
       eventsAPI. This factory spreads the ACTUAL module and overrode `eventsAPI` alone, so
       `rsvpAPI` passed straight through to the real client. That was harmless only while
       nothing in this file opened the calendar sheet; the re-pointed row/axe pins below do
       open it, and `NextGameNightCard` (plan 88.5-05, mounted into that sheet by plan
       88.5-08) fires getEventRsvps on open — which would reach the real apiFetch and
       therefore a real jsdom network call from a unit run. Do NOT drop either override
       "because this test isn't about RSVPs": the NETWORK REACH is what breaks, not the
       assertion. The sibling `UserHomePage.calendarSheet.test.tsx` carries its own copy
       (plan 88.5-01) — that fix does not cover this file. */
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
import Footer from '../components/Footer';

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

async function mockEvents(value: unknown[] | Error) {
  const api = await import('@/lib/api');
  const fn = api.eventsAPI.getUserEvents as ReturnType<typeof vi.fn>;
  if (value instanceof Error) fn.mockRejectedValue(value);
  else fn.mockResolvedValue(value);
}

/** The phone Calendar button, found by its FULL accessible name (the count is in it). */
const findCalendarButton = (name: string | RegExp) =>
  screen.findByRole('button', { name });

/**
 * Open the calendar sheet through the Calendar button — the page's only phone entry
 * point now that the bar is gone.
 *
 * The name regex is a PREFIX with a word boundary, not an end anchor: the button's
 * accessible name carries the count (UI-SPEC 6.1.5). It must still exclude any other
 * control whose name merely contains "calendar". Do not re-tighten to an end anchor.
 */
async function openCalendarSheet(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await findCalendarButton(/^calendar\b/i));
  return screen.getByRole('dialog', { name: SHEET_TITLE });
}

beforeEach(() => {
  h.selfUuid = SELF_UUID;
  h.isError = false;
  h.authLoading = false;
  h.loggedOut = false;
  nav.push.mockClear();
});

afterEach(() => {
  cleanup();
  h.selfUuid = undefined;
  h.isError = false;
  h.authLoading = false;
  h.loggedOut = false;
  vi.restoreAllMocks();
});

describe('SPEC Req 2 — the Calendar button carries the upcoming count', () => {
  it('the fixture actually discriminates: raw length differs from the filtered count', () => {
    // If this ever stops holding, the pin below is vacuous.
    expect(FILTERED).toHaveLength(2);
    expect(EVENTS.length).not.toBe(FILTERED.length);
  });

  it('counts the SELECTOR result, not the raw list the page is handed', async () => {
    await mockEvents(EVENTS);
    renderHome();

    const button = await findCalendarButton(nameFor(FILTERED.length));
    // The visible pill carries the same filtered number as the accessible name.
    expect(button).toHaveTextContent(new RegExp(`^Calendar${FILTERED.length}$`));
    // The raw-length name must not exist anywhere.
    expect(
      screen.queryByRole('button', { name: nameFor(EVENTS.length) })
    ).toBeNull();
  });

  it('hides the pill at zero but still says "0" in the accessible name', async () => {
    await mockEvents([]);
    renderHome();

    // UI-SPEC 6.1.5: 0 falls into the PLURAL arm, and the label still states it —
    // only the visual dot is suppressed at 0 (UpcomingCountPill.tsx).
    const button = await findCalendarButton('Calendar, 0 upcoming games this week');
    // The pill is the only thing that would add a number to the button's own text.
    expect(button).toHaveTextContent(/^Calendar$/);
  });

  /* VALIDATION Wave 0: no test covered the SINGULAR arm, and an off-by-one plural is the
     classic silent copy defect — it reads fine to whoever wrote it and is only ever heard
     by a screen-reader user. All four states of UI-SPEC 6.1.5 are pinned as EXACT strings
     here, so re-wording the copy has to be a decision. */
  it('matches UI-SPEC 6.1.5 exactly in all four states, including the singular', async () => {
    // (a) SUPPRESSED — identity still resolving, so no count clause at all.
    h.selfUuid = undefined;
    renderHome();
    expect(await findCalendarButton(NAME_SUPPRESSED)).toBeInTheDocument();
    cleanup();

    // (b) ZERO — counted, and it is none. Plural arm.
    h.selfUuid = SELF_UUID;
    await mockEvents([]);
    renderHome();
    expect(
      await findCalendarButton('Calendar, 0 upcoming games this week')
    ).toBeInTheDocument();
    cleanup();

    // (c) EXACTLY ONE — the singular arm, which nothing else covers.
    await mockEvents(ONE_UPCOMING);
    renderHome();
    expect(
      await findCalendarButton('Calendar, 1 upcoming game this week')
    ).toBeInTheDocument();
    // Non-vacuity on the NUMBER as well as the grammar: the plural form at 1 must not exist.
    expect(
      screen.queryByRole('button', { name: 'Calendar, 1 upcoming games this week' })
    ).toBeNull();
    cleanup();

    // (d) MANY — plural arm again, with the fixture's filtered count.
    await mockEvents(EVENTS);
    renderHome();
    expect(
      await findCalendarButton('Calendar, 2 upcoming games this week')
    ).toBeInTheDocument();
  });
});

describe('SPEC Req 2 — the button never claims a count it does not have (DECISION Phase 88-33)', () => {
  /** Any accessible name that makes a numeric claim. The suppressed arm has none. */
  const ANY_COUNT_CLAIM = /upcoming games? this week/;

  it('makes no count claim while identity is still resolving', async () => {
    h.selfUuid = undefined;
    h.isError = false;
    renderHome();

    expect(await findCalendarButton(NAME_SUPPRESSED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANY_COUNT_CLAIM })).toBeNull();
  });

  it('makes no count claim on terminal identity failure', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    renderHome();

    expect(await findCalendarButton(NAME_SUPPRESSED)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: ANY_COUNT_CLAIM })).toBeNull();
  });

  it('makes no count claim when the events fetch failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mockEvents(new Error('boom'));
    renderHome();

    // Wait for the rejection to settle, then re-check: the page holds events=[] here
    // too, and an errored fetch is not a clear calendar.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: NAME_SUPPRESSED })
      ).toBeInTheDocument()
    );
    expect(screen.queryByRole('button', { name: ANY_COUNT_CLAIM })).toBeNull();
  });

  it('DOES make the zero claim once the fetch has genuinely returned nothing', async () => {
    await mockEvents([]);
    renderHome();

    expect(
      await findCalendarButton('Calendar, 0 upcoming games this week')
    ).toBeInTheDocument();
  });
});

/* INVERTED by plan 88.5-07 (SPEC Req 1). These four cases used to pin that the Footer
   reserved 56px exactly when a phone bottom bar was mounted. The bar is deleted and its
   presence store with it, so there is ONE state now, not two — and these are what keep that
   retirement HONEST rather than incidental: they fail if anyone re-introduces the spacer
   without re-introducing the bar it existed for. The auth-LOADING path is kept as its own
   case because it is 88.1-20 IN-01's own pin; its intent (all THREE return paths honour the
   contract) survives the inversion, only the contract flipped. See the AMENDED Phase 88.5
   paragraph in Footer.js for the evidence the clearance is no longer needed. */
describe('SPEC Req 1 — the Footer reserves no bottom space on any return path', () => {
  const SPACER = 'phone-bottom-bar-spacer';

  it('renders no spacer on the logged-out (public) path', () => {
    h.loggedOut = true;
    render(<Footer />);
    // POSITIVE CONTROL, and a DISCRIMINATING one: without the "Report bug" absence this
    // case cannot tell the public footer from the auth footer, and would silently
    // duplicate its neighbour below if the harness ever stopped reaching this branch.
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /report bug/i })).toBeNull();
    expect(screen.queryByTestId(SPACER)).toBeNull();
  });

  it('renders no spacer on the logged-in (auth) path', () => {
    render(<Footer />);
    expect(screen.getByRole('link', { name: 'Privacy' })).toBeInTheDocument();
    // The other half of the discriminator above — this branch DOES carry Report bug.
    expect(
      screen.getByRole('button', { name: /report bug/i })
    ).toBeInTheDocument();
    expect(screen.queryByTestId(SPACER)).toBeNull();
  });

  it('renders no spacer on the auth-LOADING path (88.1-20 IN-01, inverted)', () => {
    h.authLoading = true;
    const { container } = render(<Footer />);
    // The loading branch renders a bare placeholder and no links, so the positive
    // control is that the branch rendered SOMETHING at all.
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByTestId(SPACER)).toBeNull();
  });

  it('renders no spacer anywhere on the home page itself', async () => {
    await mockEvents(EVENTS);
    render(
      <>
        <UserHome
          GroupList={null}
          getGroupList={vi.fn()}
          onCreateGroup={vi.fn()}
          groupListRefreshKey={0}
          onMemberAdded={vi.fn()}
        />
        <Footer />
      </>
    );

    // The page is the one surface that used to mount the bar, so it is the one that
    // would bring the spacer back with it.
    await findCalendarButton(/^calendar\b/i);
    expect(screen.queryByTestId(SPACER)).toBeNull();
  });
});

/* RE-POINTED at the CALENDAR sheet by plan 88.5-07. These pinned row operability and
   accessibility on the deleted 11a sheet; the calendar sheet is the surviving phone list and
   NONE of these four is covered in `UserHomePage.calendarSheet.test.tsx`, so retiring them
   would have been a real coverage loss. They stay in THIS file so plan ownership is clean —
   plans 88.5-01 and 88.5-08 own the sibling suite.

   The rows are `div role="button" tabIndex=0` with a HAND-ROLLED Enter/Space handler
   (`CalendarListView.js:854-864`), not native buttons. That is exactly why the keyboard cases
   below are not redundant with the click case: a native button gets Enter/Space for free, a
   div gets them only for as long as that handler survives. */
describe('SPEC Req 1 — calendar-sheet rows stay operable and accessible', () => {
  const CATAN_URL = '/gameDetail?event_id=e-soon&group_id=g1';

  it('rows are real buttons, reachable inside the focus trap', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openCalendarSheet(user);

    const row = await within(sheet).findByRole('button', { name: /Catan/ });
    expect(row).toBeInTheDocument();
    // A div with an onClick and no tabIndex is reachable by pointer only — the focus
    // trap would skip it entirely.
    expect(row).toHaveAttribute('tabindex', '0');
  });

  it('Enter on a focused row navigates', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openCalendarSheet(user);
    const row = await within(sheet).findByRole('button', { name: /Catan/ });
    row.focus();
    expect(document.activeElement).toBe(row);

    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledWith(CATAN_URL);
  });

  it('Space on a focused row navigates', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openCalendarSheet(user);
    const row = await within(sheet).findByRole('button', { name: /Catan/ });
    row.focus();

    await user.keyboard(' ');
    expect(nav.push).toHaveBeenCalledWith(CATAN_URL);
  });

  /* The ONLY axe assertion on any bottom sheet in this repo — and plan 88.5-08 is about to
     add a hero card and an RSVP segmented control to this exact sheet. Dropping it opens a
     real regression window on the surface most about to change. */
  it('axe passes on the OPEN calendar sheet with rows rendered', async () => {
    const user = userEvent.setup();
    // The POPULATED fixture, not the empty state — the point is the rows themselves.
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openCalendarSheet(user);
    expect(await within(sheet).findByText('Catan')).toBeInTheDocument();

    expect(await axe(sheet)).toHaveNoViolations();
  });
});

// Plan 88.1-21 (88.1-CODE-REVIEW.md), re-pointed by 88.5-07 — the trigger opens a dialog and
// must say so. The bar carried this; the Calendar button it replaces already does
// (`UserHomePage.js`), and this pin is what stops the counted `aria-label` rewrite from
// dropping it.
describe('SPEC Req 1 — the phone trigger announces the sheet it opens', () => {
  it('the Calendar button carries aria-haspopup="dialog" alongside its counted name', async () => {
    await mockEvents(EVENTS);
    renderHome();

    // Found by the COUNTED name on purpose: the attribute and the new label have to
    // coexist on one control, which is the thing that regressed elsewhere.
    const trigger = await findCalendarButton(nameFor(FILTERED.length));
    expect(trigger).toHaveAttribute('aria-haspopup', 'dialog');
  });
});
