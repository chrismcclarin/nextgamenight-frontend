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
import { render, screen, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

import UpcomingEventsCard from './UpcomingEventsCard';

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
