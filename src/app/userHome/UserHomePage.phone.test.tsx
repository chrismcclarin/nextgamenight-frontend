// Phase 88.1 plan 08 — Req 11a phone-surface pins.
//
// What these lock, in order of how badly a regression would hurt:
//   1. COUNT INTEGRITY. `UserHomePage.js` passes the RAW, unfiltered event list to
//      `UpcomingEventsCard` on purpose, so a bar reading `events.length` would
//      advertise a number the sheet does not show. The fixture below is built so
//      raw length (5) and filtered length (2) DIFFER — a regression to
//      `events.length` fails these tests instead of passing them silently.
//   2. TRUTHFULNESS WHILE PENDING / ERRORED (DECISION Phase 88-33, re-pinned for the
//      bar). `events=[]` means "not fetched yet" during the identity-resolution
//      window and on terminal identity failure; rendering it as "none in the next 7
//      days" is the exact lie 88-33 fixed on the card.
//   3. The sheet's branch ORDER — identity error, then fetch error, then empty. An
//      errored fetch also has zero events, so flipping those silently restores the
//      88-18 bug in its new host.
//   4. Three dismiss paths (Esc + close button here; outside tap is E2E).
//   5. The Footer spacer appears ONLY when the bar is mounted.
//
// Geometry (heights, viewport units, occlusion) is deliberately NOT asserted: jsdom has no
// layout, so a pixel assertion here would be theatre. That is plan 88.1-10's job.
import * as React from 'react';
import { render, screen, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { axe } from 'vitest-axe';

import { selectUpcomingWithin7Days } from '@/lib/upcomingEvents';

const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SHEET_TITLE = 'Upcoming events';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

/**
 * DISCRIMINATING fixture: 5 raw rows, 2 of which are "upcoming".
 * A bar counting `events.length` would say 5 over a sheet showing 2.
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

// Mutable identity, mirroring UserHomePage.identity.test.tsx's harness.
const h = vi.hoisted(() => ({
  selfUuid: undefined as string | undefined,
  isError: false,
  // Footer's third return path. Defaults false, so every pre-existing case sees the resolved
  // auth state it saw before.
  authLoading: false,
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
  };
});

import UserHome from './UserHomePage';
import Footer from '../components/Footer';
import PhoneEventBar from '../components/PhoneEventBar';

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

const findBar = (name: string | RegExp) =>
  screen.findByRole('button', { name });

async function openSheet(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(await findBar(name));
  return screen.getByRole('dialog', { name: SHEET_TITLE });
}

beforeEach(() => {
  h.selfUuid = SELF_UUID;
  h.isError = false;
  h.authLoading = false;
  nav.push.mockClear();
});

afterEach(() => {
  cleanup();
  h.selfUuid = undefined;
  h.isError = false;
  h.authLoading = false;
  vi.restoreAllMocks();
});

describe('Req 11a — the phone bottom bar count', () => {
  it('the fixture actually discriminates: raw length differs from the filtered count', () => {
    // If this ever stops holding, pin 2 below is vacuous.
    expect(FILTERED).toHaveLength(2);
    expect(EVENTS.length).not.toBe(FILTERED.length);
  });

  it('counts the SELECTOR result, not the raw list it is handed', async () => {
    await mockEvents(EVENTS);
    renderHome();

    const bar = await findBar(
      `Open upcoming events, ${FILTERED.length} in the next 7 days`
    );
    // The visible pill carries the same filtered number as the accessible name.
    expect(bar).toHaveTextContent(
      new RegExp(`^Upcoming events${FILTERED.length}$`)
    );
    // The raw-length name must not exist anywhere.
    expect(
      screen.queryByRole('button', {
        name: `Open upcoming events, ${EVENTS.length} in the next 7 days`,
      })
    ).toBeNull();
  });

  it('hides the count pill at zero and says "none in the next 7 days"', async () => {
    await mockEvents([]);
    renderHome();

    const bar = await findBar('Open upcoming events, none in the next 7 days');
    // The pill is the only thing that would add a number to the bar's own text.
    expect(bar).toHaveTextContent(/^Upcoming events$/);
  });
});

describe('Req 11a — the sheet', () => {
  it('opens on one tap, is named "Upcoming events", and shows the same rows the card shows', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);

    expect(within(sheet).getByText('Catan')).toBeInTheDocument();
    expect(within(sheet).getByText('Wingspan')).toBeInTheDocument();
    // The rows the selector drops must not appear.
    expect(within(sheet).queryByText('Yesterdays Game')).toBeNull();
    expect(within(sheet).queryByText('Far Future Game')).toBeNull();
    expect(within(sheet).queryByText('Cancelled Game')).toBeNull();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    await openSheet(user, /Open upcoming events/);
    await user.keyboard('{Escape}');

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull()
    );
  });

  it('closes from the close button', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);
    await user.click(within(sheet).getByRole('button', { name: 'Close' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull()
    );
  });

  it('shows the ML-17 identity banner, NOT the empty state, on terminal identity failure', async () => {
    const user = userEvent.setup();
    h.selfUuid = undefined;
    h.isError = true;
    renderHome();

    const sheet = await openSheet(user, 'Open upcoming events');

    // FetchErrorBanner's retry control reads "Retry" (FetchErrorBanner.tsx:85).
    expect(within(sheet).getByRole('button', { name: /Retry/ })).toBeInTheDocument();
    expect(within(sheet).queryByText('Nothing on the calendar')).toBeNull();
  });

  it('shows the 88-18 fetch-error treatment, NOT "Nothing on the calendar"', async () => {
    const user = userEvent.setup();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mockEvents(new Error('boom'));
    renderHome();

    const sheet = await openSheet(user, 'Open upcoming events');

    expect(
      await within(sheet).findByText("We couldn't load your upcoming events")
    ).toBeInTheDocument();
    expect(within(sheet).queryByText('Nothing on the calendar')).toBeNull();
  });
});

describe('Req 11a — the bar never claims a truthful zero it does not have (DECISION Phase 88-33)', () => {
  const NO_COUNT_NAME = 'Open upcoming events';

  it('makes no count claim while identity is still resolving', async () => {
    h.selfUuid = undefined;
    h.isError = false;
    renderHome();

    expect(await findBar(NO_COUNT_NAME)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /none in the next 7 days/ })
    ).toBeNull();
  });

  it('makes no count claim on terminal identity failure', async () => {
    h.selfUuid = undefined;
    h.isError = true;
    renderHome();

    expect(await findBar(NO_COUNT_NAME)).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /none in the next 7 days/ })
    ).toBeNull();
  });

  it('makes no count claim when the events fetch failed', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await mockEvents(new Error('boom'));
    renderHome();

    // Wait for the rejection to settle, then re-check: the bar holds events=[]
    // here too, and an errored fetch is not a clear calendar.
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: NO_COUNT_NAME })
      ).toBeInTheDocument()
    );
    expect(
      screen.queryByRole('button', { name: /none in the next 7 days/ })
    ).toBeNull();
  });

  it('DOES make the zero claim once the fetch has genuinely returned nothing', async () => {
    await mockEvents([]);
    renderHome();

    expect(
      await findBar('Open upcoming events, none in the next 7 days')
    ).toBeInTheDocument();
  });
});

describe('Footer clearance for the fixed bar', () => {
  it('reserves no space when no phone bar is mounted', () => {
    render(<Footer />);
    expect(screen.queryByTestId('phone-bottom-bar-spacer')).toBeNull();
  });

  it('reserves space once a phone bar is mounted', async () => {
    render(
      <>
        <PhoneEventBar events={[]} onOpen={vi.fn()} />
        <Footer />
      </>
    );
    expect(
      await screen.findByTestId('phone-bottom-bar-spacer')
    ).toBeInTheDocument();
  });

  // 88.1-20 (88.1-REVIEW.md IN-01): the auth-LOADING branch returned a bare placeholder and
  // dropped the spacer — the one return path that did not honour the contract. This is a
  // CONTRACT pin, not an occlusion pin: in the loading state the footer renders no links, and
  // plan 19 measured this branch and REFUTED it as the cause of the CI occlusion failure.
  it('reserves space in the auth-LOADING branch too, when a phone bar is mounted', async () => {
    h.authLoading = true;
    render(
      <>
        <PhoneEventBar events={[]} onOpen={vi.fn()} />
        <Footer />
      </>
    );
    expect(
      await screen.findByTestId('phone-bottom-bar-spacer')
    ).toBeInTheDocument();
  });

  it('reserves NO space while auth is loading if no phone bar is mounted', () => {
    h.authLoading = true;
    render(<Footer />);
    expect(screen.queryByTestId('phone-bottom-bar-spacer')).toBeNull();
  });
});

// Plan 88.1-17 Task 4 — the owner's dark-theme walkthrough defect (2026-08-24).
//
// This is a CLASS pin, not a colour measurement: jsdom has no colour, and the whole
// point is to stop the theme-flipping token from coming back. `text-content-inverse`
// resolves to #ffffff in light and purple-950 under `.dark`, while `bg-surface-header`
// is warm-800/warm-900 — dark in BOTH themes. The pairing therefore rendered near-black
// text on a near-black bar in dark theme, and the owner could not see the bar at all.
describe('Req 11a — the bar is readable in BOTH themes', () => {
  it('bar text stays white on the always-dark header surface (does not use the theme-flipping inverse token)', () => {
    render(<PhoneEventBar events={[]} onOpen={vi.fn()} />);

    const bar = screen.getByRole('button', { name: /open upcoming events/i })
      .parentElement as HTMLElement;
    // Confirm we grabbed the bar container itself before asserting about its text token.
    expect(bar).toHaveClass('fixed', 'bottom-0', 'bg-surface-header');

    expect(bar).toHaveClass('text-white');
    expect(bar).not.toHaveClass('text-content-inverse');
  });
});

describe('Req 11a — tapping a row in the sheet (WR-02 / WR-03)', () => {
  // WR-02: the sheet is a focus-trapped Radix dialog. Navigating without closing it leaves the
  // destination page mounted BEHIND an overlay that still traps focus — the user lands on
  // gameDetail and cannot reach it. The desktop column has no sheet, so the teardown belongs to
  // the CALLER, not to the card: `UpcomingEventsCard` takes an optional `onEventClick`.
  const CATAN_URL = '/gameDetail?event_id=e-soon&group_id=g1';

  it('closes the sheet BEFORE navigating', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);
    await user.click(within(sheet).getByText('Catan'));

    // Asserted on the DOM after the click rather than by spying on call order: a
    // navigate-then-close implementation leaves the dialog mounted, which is the actual harm.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: SHEET_TITLE })).toBeNull()
    );
    expect(nav.push).toHaveBeenCalledTimes(1);
    expect(nav.push).toHaveBeenCalledWith(CATAN_URL);
  });

  it('rows are real buttons, reachable inside the focus trap', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);

    // Pre-fix the row is a `div` with an onClick and no role at all, so this cannot resolve.
    const row = within(sheet).getByRole('button', { name: /Catan/ });
    expect(row).toBeInTheDocument();
  });

  it('Enter on a focused row navigates', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);
    const row = within(sheet).getByRole('button', { name: /Catan/ });
    row.focus();
    expect(document.activeElement).toBe(row);

    await user.keyboard('{Enter}');
    expect(nav.push).toHaveBeenCalledWith(CATAN_URL);
  });

  it('Space on a focused row navigates', async () => {
    const user = userEvent.setup();
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);
    const row = within(sheet).getByRole('button', { name: /Catan/ });
    row.focus();

    await user.keyboard(' ');
    expect(nav.push).toHaveBeenCalledWith(CATAN_URL);
  });

  it('axe passes on the OPEN sheet with rows rendered', async () => {
    const user = userEvent.setup();
    // The POPULATED fixture, not the empty state — the point is the rows themselves.
    await mockEvents(EVENTS);
    renderHome();

    const sheet = await openSheet(user, /Open upcoming events/);
    expect(within(sheet).getByText('Catan')).toBeInTheDocument();

    expect(await axe(sheet)).toHaveNoViolations();
  });
});
