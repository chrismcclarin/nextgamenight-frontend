// Rendering-unchanged pins for UpcomingEventsCard (Phase 88.1-05, Req-11).
//
// WHY THESE EXIST:
//   1. The 7-day/status/sort predicate moved OUT of this component into
//      `src/lib/upcomingEvents.ts` so the phone bottom bar's count pill (plan 88.1-08)
//      and this body derive from one predicate. The extraction was meant to be
//      byte-identical in output — these pins are the proof, and the tripwire if a later
//      change to the selector quietly changes what the card shows.
//   2. The branch ORDER — loading, then error, then empty, then rows — is load-bearing.
//      `DECISION Phase 88-18` records that an errored fetch ALSO has zero events, so
//      flipping the error and empty branches silently restores a shipped bug where the
//      card printed "Nothing on the calendar" at someone whose calendar had simply
//      failed to load. Plan 88.1-08 re-hosts this card inside the phone sheet; this pin
//      is the guard that goes with it.
//
// The clock is FIXED (vi.setSystemTime) because the card reads the wall clock through the
// selector's default `now` — without pinning it these fixtures would age out of the window.
import * as React from 'react';
import { render, screen, cleanup, within, act, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

import UpcomingEventsCard from './UpcomingEventsCard';
import { REGION_EMPTY_DWELL_MS } from '@/components/ui/StatusRegion';

/** Fixed "now": Saturday 2026-08-22T12:00:00Z. The +7d boundary is 2026-08-29T12:00:00Z. */
const NOW = new Date('2026-08-22T12:00:00.000Z');

type Fixture = {
  id: string;
  group_id: string;
  start_date: string;
  status?: string;
  Game: { name: string };
};

const ev = (id: string, start_date: string, name: string, status?: string): Fixture => ({
  id,
  group_id: 'g1',
  start_date,
  Game: { name },
  ...(status ? { status } : {}),
});

/** UpcomingEventsCard is `.js`, so its inferred prop type has every prop REQUIRED. */
function renderCard(overrides: Record<string, unknown> = {}) {
  const props = {
    events: [] as Fixture[],
    showGroupName: false,
    loading: false,
    viewerDbUserId: null,
    errorState: null,
    action: null,
    ...overrides,
  };
  // The component is `.js`, so its props are inferred from JSDoc (`events: any[]`,
  // `viewerDbUserId?: string`). The null-tolerance fixture deliberately passes `null`
  // where the JSDoc says string/array, so the cast goes through `unknown` at this one
  // boundary rather than loosening the component's own annotations.
  const Card = UpcomingEventsCard as unknown as React.ComponentType<Record<string, unknown>>;
  return render(<Card {...props} />);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('UpcomingEventsCard — rows are exactly the selector output', () => {
  // A past event, two in-window events (out of order), an out-of-window event, and a
  // cancelled in-window event. Only the two in-window live ones may render.
  const MIXED = [
    ev('later', '2026-08-26T23:00:00.000Z', 'Later Game'),
    ev('past', '2026-08-21T18:00:00.000Z', 'Past Game'),
    ev('beyond', '2026-09-05T23:00:00.000Z', 'Beyond Window Game'),
    ev('cancelled', '2026-08-24T23:00:00.000Z', 'Cancelled Game', 'cancelled'),
    ev('sooner', '2026-08-23T23:00:00.000Z', 'Sooner Game'),
  ];

  it('renders only the in-window, still-live events', () => {
    renderCard({ events: MIXED });

    expect(screen.getByText('Sooner Game')).toBeInTheDocument();
    expect(screen.getByText('Later Game')).toBeInTheDocument();
    expect(screen.queryByText('Past Game')).not.toBeInTheDocument();
    expect(screen.queryByText('Beyond Window Game')).not.toBeInTheDocument();
    expect(screen.queryByText('Cancelled Game')).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
  });

  it('renders them in ascending start-date order', () => {
    const { container } = renderCard({ events: MIXED });
    const text = container.textContent ?? '';
    expect(text.indexOf('Sooner Game')).toBeGreaterThan(-1);
    expect(text.indexOf('Sooner Game')).toBeLessThan(text.indexOf('Later Game'));
  });

  it('slices to 3 rows and offers the rest as an overflow count', () => {
    const five = [
      ev('e1', '2026-08-23T23:00:00.000Z', 'Game One'),
      ev('e2', '2026-08-24T23:00:00.000Z', 'Game Two'),
      ev('e3', '2026-08-25T23:00:00.000Z', 'Game Three'),
      ev('e4', '2026-08-26T23:00:00.000Z', 'Game Four'),
      ev('e5', '2026-08-27T23:00:00.000Z', 'Game Five'),
      // Filtered out — so the overflow count must be 2, not 3. The count is derived from
      // the SELECTOR's length, never from the raw list the page owner passes.
      ev('gone', '2026-09-30T23:00:00.000Z', 'Game Six'),
    ];
    renderCard({ events: five });

    expect(screen.getByText('Game One')).toBeInTheDocument();
    expect(screen.getByText('Game Three')).toBeInTheDocument();
    expect(screen.queryByText('Game Four')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /\+ 2 more/ })).toBeInTheDocument();
  });

  it('shows the empty state when nothing is in the window', () => {
    renderCard({ events: [ev('past', '2026-08-21T18:00:00.000Z', 'Past Game')] });
    expect(screen.getByText('Nothing on the calendar')).toBeInTheDocument();
  });

  it('tolerates a null events prop', () => {
    renderCard({ events: null });
    expect(screen.getByText('Nothing on the calendar')).toBeInTheDocument();
  });
});

describe('UpcomingEventsCard — branch precedence (DECISION Phase 88-18)', () => {
  const errorState = {
    showError: true,
    message: "We couldn't reach the server. Check your connection and try again.",
    code: 'network',
    retry: vi.fn(),
  };

  it('renders the error treatment and NOT the empty state when the fetch failed', () => {
    // The whole point: a failed fetch also hands the card zero events. If the empty branch
    // were checked first, this user would be told their calendar is clear when it simply
    // failed to load. Ordering is load-bearing, not stylistic.
    renderCard({ events: [], errorState });

    expect(screen.getByText("We couldn't load your upcoming events")).toBeInTheDocument();
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
    expect(screen.queryByText(/Nothing scheduled in the next 7 days/)).not.toBeInTheDocument();
  });

  it('keeps the loading branch ahead of the error branch', () => {
    renderCard({ events: [], errorState, loading: true });

    const status = screen.getByRole('status', { name: /loading your upcoming events/i });
    expect(within(status).getByText(/Loading your upcoming events/)).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load your upcoming events")).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
  });
});

describe('UpcomingEventsCard — the 44px row floor is PHONE-scoped (owner D-13)', () => {
  // 88.1-CODE-REVIEW.md H2. WR-03 made these rows real `<button>`s and gave them `min-h-11`
  // for the phone touch floor, which also grew them on desktop — a >=768px layout change Req 11
  // says is out of bounds. The owner's D-13 ruling scopes the floor to phone. The class pair is
  // the assertion because jsdom applies no stylesheet: there is no computed height to read here,
  // and the mobile Playwright project is where the rendered result is proven.
  it('the row button keeps min-h-11 and opts out of it at md and up', () => {
    renderCard({ events: [ev('e1', '2026-08-23T23:00:00.000Z', 'Game One')] });

    const row = screen.getByRole('button', { name: /Game One/ });
    // Phone: the floor stays. Removing this re-breaks WR-03's touch target.
    expect(row.className).toContain('min-h-11');
    // Desktop: the floor is released, restoring the pre-phase row height.
    expect(row.className).toContain('md:min-h-0');
  });

  it('the row carries no `.btn` class, which is why the utility opt-out can work at all', () => {
    // ANTI-VACUITY for the pin above. `globals.css:1173-1177` applies the phone floor as an
    // UNLAYERED `.btn { min-height: 2.75rem }`, and an unlayered author rule beats every
    // `@layer utilities` rule — so on a `.btn` element `md:min-h-0` would silently do nothing
    // (globals.css:1164-1171 documents that trap, hit twice already). This row is a bare
    // button, so the opt-out lands. If a future edit puts `.btn` on this row, the D-13 pin
    // above would still pass while the desktop height quietly reverted; this catches that.
    renderCard({ events: [ev('e1', '2026-08-23T23:00:00.000Z', 'Game One')] });

    const row = screen.getByRole('button', { name: /Game One/ });
    expect(row.className.split(/\s+/)).not.toContain('btn');
  });
});

describe('a refresh keeps the rows (88.6.1-62, D-09a / D-41, RF1)', () => {
  // Copy row RF1 / D-47 (plan 88.6.1-70's REFRESH_FAILED_NOTICE), written once here (contract
  // C7). While the notice shows it is in the DOM twice: the visible line and its polite region.
  const RF1 = "Couldn't refresh. Showing what loaded earlier.";
  // 88.6.1 code review CR-6 / A-22 (owner ratified 2026-10-19): this notice passes `sectionName`,
  // so its polite region and the Retry's description say "Upcoming game nights: " first and the visible line
  // holds RF1 alone — RF1 by exact text is found ONCE, the region holds SPOKEN.
  const SPOKEN = "Upcoming game nights: Couldn't refresh. Showing what loaded earlier.";
  const LOAD_TITLE = "We couldn't load your upcoming events";
  const failed = {
    showError: true,
    message: 'Something went wrong on our end. Please try again.',
    code: 'internal',
    retry: vi.fn(() => Promise.resolve({ isError: false })),
  };
  const healthy = { ...failed, showError: false, message: '' };
  const TWO_ROWS = [
    ev('a', '2026-08-23T23:00:00.000Z', 'Alpha Game'),
    ev('b', '2026-08-24T23:00:00.000Z', 'Beta Game'),
  ];
  const card = () =>
    screen.getByRole('heading', { name: 'Upcoming Events' }).parentElement as HTMLElement;
  // A notice mounted while its failure already shows fills its region after the empty dwell
  // (plan 70's quietOnMount); this suite fakes timers, so the dwell is advanced by hand.
  const passDwell = () =>
    act(() => {
      vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    });
  const precedes = (a: Node, b: Node) =>
    Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

  it('U1 (C8 a): a failed refresh keeps the rows under the RF1 notice, never the full banner', () => {
    renderCard({ events: TWO_ROWS, retained: true, errorState: failed });
    passDwell();

    const copies = within(card()).getAllByText(RF1);
    expect(copies).toHaveLength(1);
    expect(within(card()).getByText(SPOKEN)).toBeInTheDocument();
    expect(within(card()).getByText('Alpha Game')).toBeInTheDocument();
    expect(within(card()).getByText('Beta Game')).toBeInTheDocument();
    const line = copies.find((n) => !n.closest('[role="status"]'));
    expect(line, 'the visible RF1 line').toBeDefined();
    const firstRow = within(card()).getByRole('button', { name: /Alpha Game/ });
    expect(precedes(line as Node, firstRow)).toBe(true);
    expect(screen.queryByText(LOAD_TITLE)).not.toBeInTheDocument();
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
  });

  it('U1-CR6 (CR-6 / A-22): the notice names Upcoming game nights in its region and in the Retry description, never visibly', () => {
    renderCard({ events: TWO_ROWS, retained: true, errorState: failed });
    passDwell();
    const region = within(card()).getAllByRole('status').find((n) => n.textContent === SPOKEN);
    expect(region, 'the region holds the named sentence').toBeDefined();
    expect(within(card()).getAllByText(RF1)).toHaveLength(1);
    expect(within(card()).getByRole('button', { name: 'Retry' })).toHaveAccessibleDescription(SPOKEN);
  });

  it('U2 (R9 empty, nothing loaded): the full banner stands alone, never RF1 or the empty state', () => {
    renderCard({ events: [ev('far', '2026-09-01T23:00:00.000Z', 'Far Game')], errorState: failed });
    passDwell();

    expect(screen.getByText(LOAD_TITLE)).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('Nothing on the calendar')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Far Game/ })).not.toBeInTheDocument();
  });

  it('U2b (C3, D-50 ruling Y): an earlier EMPTY answer is retained — RF1 above "Nothing on the calendar"', () => {
    renderCard({ events: [], retained: true, errorState: failed });
    passDwell();

    const copies = within(card()).getAllByText(RF1);
    expect(copies).toHaveLength(1);
    expect(within(card()).getByText(SPOKEN)).toBeInTheDocument();
    const empty = within(card()).getByText('Nothing on the calendar');
    const line = copies.find((n) => !n.closest('[role="status"]')) as Node;
    expect(precedes(line, empty)).toBe(true);
    expect(screen.queryByText(LOAD_TITLE)).not.toBeInTheDocument();
  });

  it('U3 (Req 9): the rows wrapper is marked busy while a refresh runs, and the attribute is absent at rest', () => {
    const view = renderCard({ events: TWO_ROWS, busy: true });
    const wrapper = screen.getByRole('button', { name: /Alpha Game/ }).parentElement as HTMLElement;
    expect(wrapper).toHaveAttribute('aria-busy', 'true');
    view.unmount();

    renderCard({ events: TWO_ROWS });
    const restWrapper = screen.getByRole('button', { name: /Alpha Game/ }).parentElement as HTMLElement;
    expect(restWrapper).not.toHaveAttribute('aria-busy');
  });

  it('U3b (r2 #230): the retained-empty arm is marked busy in place too, and the attribute is absent at rest', () => {
    const view = renderCard({ events: [], busy: true });
    const busyWrap = screen.getByText('Nothing on the calendar').closest('[aria-busy]');
    expect(busyWrap, 'an element wrapping the empty state carries aria-busy').not.toBeNull();
    expect(busyWrap).toHaveAttribute('aria-busy', 'true');
    view.unmount();

    renderCard({ events: [] });
    expect(screen.getByText('Nothing on the calendar').closest('[aria-busy]')).toBeNull();
  });

  it('U4 (C8 b, Req 8): RF1 is spoken by a status region that was already on the page before the failure', () => {
    const view = renderCard({ events: TWO_ROWS, retained: true, errorState: healthy });
    const before = within(card()).getAllByRole('status');

    const Card = UpcomingEventsCard as unknown as React.ComponentType<Record<string, unknown>>;
    view.rerender(
      <Card
        events={TWO_ROWS}
        showGroupName={false}
        loading={false}
        viewerDbUserId={null}
        errorState={failed}
        action={null}
        retained
      />
    );

    const holder = within(card())
      .getAllByRole('status')
      .find((n) => n.textContent === SPOKEN);
    expect(holder, 'a status node carries RF1').toBeDefined();
    expect(before).toContain(holder);
  });

  it('U5 (r2 #227, Req 5): the overflow toggle is ONE node — pressing it keeps focus and flips aria-expanded', () => {
    renderCard({
      events: [
        ev('e1', '2026-08-23T23:00:00.000Z', 'Game One'),
        ev('e2', '2026-08-24T23:00:00.000Z', 'Game Two'),
        ev('e3', '2026-08-25T23:00:00.000Z', 'Game Three'),
        ev('e4', '2026-08-26T23:00:00.000Z', 'Game Four'),
        ev('e5', '2026-08-27T23:00:00.000Z', 'Game Five'),
      ],
    });
    const toggle = screen.getByRole('button', { name: /\+ 2 more/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    act(() => toggle.focus());
    fireEvent.click(toggle);

    expect(document.activeElement).toBe(toggle);
    expect(toggle).toHaveAccessibleName('Show less');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle).toHaveAccessibleName('+ 2 more');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });
});
