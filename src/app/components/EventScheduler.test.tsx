// Phase 88.1-01 (D-08 Layer 2) — CHARACTERIZATION pins for the create-event scheduler.
//
// WHAT THIS FILE IS FOR: Phase 88.1 replaces the react-big-calendar implementation of
// EventScheduler with the RBC-free WeekGrid. These pins were written against the SHIPPED
// react-big-calendar version FIRST, so the rebuild has something to be measured against —
// SPEC Req 1's "characterization tests before the rewrite" mandate.
//
// THE LOAD-BEARING PROPERTY: **role, label and visible-text locators only.** No class
// selectors, no library-internal DOM. That is what lets plan 88.1-09 assert the REBUILT
// scheduler with this exact file, unchanged. If you find yourself reaching for a class
// selector to make a pin pass, the rebuild has lost an accessible name — fix the component,
// not the locator.
//
// The six pinned behaviors:
//   1. Week navigation bubbles out through `onWeekChange` (the component half of Req 4 —
//      the pure rule half lives in lib/eventFormUtils `resolveWeekNav`).
//   2. `defaultView="day"` enters day view. Pinned at the PROP, not at one caller: there
//      are TWO producers of it (groupHomePage and gameDetail, the latter guarded by
//      DECISION 65-03 EVT-05) and both funnel through createEvent's `initialVisualView`.
//   3. The controlled `selectedSlot` prop renders the "Selected Time:" panel. That string
//      is a verbatim parity carry — the whole harness keys on it; do not reword it.
//   4. Availability tint/count is keyed on the LOCAL date+hour of a UTC wire slot.
//   5. `scrollToTime` mounts cleanly, and the legend + partial-data note render.
//   6. `initialDate` re-syncs the visible week AFTER mount (Phase 71.2 poll-CTA anchor) —
//      it is a HYBRID contract, not a mount-only seed. A seed-only rebuild fails this.
//
// DELIBERATELY NOT PINNED HERE:
//   - P5, the long-press grace timer. The shipped value and the rebuild's owner-ruled value
//     differ on purpose; a pin on the number would go red and invite someone to "fix" the
//     rebuild backwards. Gesture timing belongs to the Playwright layer (plan 88.1-14).
//   - P7, anything geometric. jsdom has no layout — element boxes and scroll extents are all
//     zero, so column widths and the strip cell height are Playwright assertions, never
//     vitest ones.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOfWeek } from 'date-fns';

// Synthetic identity only (threat T-88.1-02): no real user data in fixtures. The component
// reads `selfUuid` to mark self-conflicts in the per-slot tooltip; mocked so the suite needs
// neither Auth0 nor a react-query provider.
const SELF_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: SELF_UUID,
    self: { id: SELF_UUID, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

import type { ComponentType } from 'react';
import EventSchedulerDefault from './EventScheduler';

// EventScheduler is still a `.js` component (the FE is mid JS->TS migration, WS-12), so its
// INFERRED prop type marks every prop required and narrows the defaulted ones to `null`.
// Cast to an explicit type, per the repo idiom (ScheduleForm.test.tsx:40,
// AvailabilityForm.test.tsx:32). Doing this in the test rather than annotating the component
// is deliberate: the component is being REPLACED this phase, so a JSDoc/TS signature written
// onto the RBC version would be thrown away in plan 88.1-09. This shape doubles as the prop
// contract the rebuild has to honour — it is what the pins below actually exercise.
type HeatmapSlot = {
  date: string;
  hour: number;
  availableCount: number;
  availableMembers?: Array<{ user_id?: string; username: string }>;
};
type EventSchedulerProps = {
  initialDate?: Date;
  defaultView?: 'week' | 'day';
  selectedSlot?: { start: Date; end: Date } | null;
  scrollToTime?: Date | null;
  onWeekChange?: (date: Date) => void;
  onTimeSelected?: (start: Date, end: Date) => void;
  heatmapData?: {
    slots: HeatmapSlot[];
    totalMembers?: number;
    totalGroupMembers?: number;
    membersWithoutDataCount?: number;
    gcalConflicts?: Array<{ date: string; hour: number; user_id: string; username: string }>;
  } | null;
};
const EventScheduler = EventSchedulerDefault as unknown as ComponentType<EventSchedulerProps>;

afterEach(cleanup);

// Wednesday 2026-07-22, local noon. Its Monday is 2026-07-20.
const WEEK_N = new Date(2026, 6, 22, 12, 0, 0);
// Wednesday 2026-08-05 — two weeks later. Its Monday is 2026-08-03.
const WEEK_N_PLUS_2 = new Date(2026, 7, 5, 12, 0, 0);

const pad = (n: number) => String(n).padStart(2, '0');
const isoDay = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const mondayOf = (d: Date) => isoDay(startOfWeek(d, { weekStartsOn: 1 }));

/** Visible day-column header labels, in DOM order (e.g. ['20 Mon', …]). */
const columnHeaders = () =>
  screen.queryAllByRole('columnheader').map((el) => el.textContent);

// --- Heatmap fixture -------------------------------------------------------------------
// The wire is UTC (the backend emits `date` + `hour` in UTC); the grid is LOCAL. The fixture
// is therefore built BACKWARDS from a local target cell, so the pinned cell always lands
// inside the calendar's visible 10:00-23:59 window whatever timezone the machine runs in —
// a hard-coded UTC hour renders off-grid for some offsets and the pin would be flaky by
// geography. The expected accessible name is then re-derived with plain `Date` getters
// rather than the component's date-fns path. A rebuild that keys the badge on the RAW UTC
// hour puts it on a different cell on every non-UTC runtime, which is the failure mode.
const LOCAL_TARGET = new Date(2026, 6, 22, 14, 0, 0); // Wed 2026-07-22, 2 PM local
const WIRE_SLOT = {
  date: LOCAL_TARGET.toISOString().slice(0, 10),
  hour: LOCAL_TARGET.getUTCHours(),
};
const asLocal = new Date(`${WIRE_SLOT.date}T${pad(WIRE_SLOT.hour)}:00:00Z`);
const EXPECTED_CELL_LABEL = `Availability for ${isoDay(asLocal)} hour ${asLocal.getHours()}`;

const heatmapFixture = {
  totalMembers: 4,
  totalGroupMembers: 6,
  membersWithoutDataCount: 2,
  slots: [
    {
      ...WIRE_SLOT,
      availableCount: 3,
      availableMembers: [{ user_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', username: 'Bea' }],
    },
  ],
  gcalConflicts: [],
};

describe('EventScheduler — week navigation bubbles to onWeekChange (Req 4, component half)', () => {
  it('forward navigation reports a date in the FOLLOWING week and moves the visible week', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onWeekChange={onWeekChange} />);

    expect(columnHeaders()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    expect(onWeekChange).toHaveBeenCalledTimes(1);
    const reported = onWeekChange.mock.calls[0][0] as Date;
    expect(reported).toBeInstanceOf(Date);
    // The parent clamps + de-dupes on the WEEK, so what matters is which week this lands in.
    expect(mondayOf(reported)).toBe('2026-07-27');
    // …and the grid itself actually moved, not just the callback.
    expect(columnHeaders()?.[0]).toContain('27');
  });

  it('backward navigation reports a date in the PRECEDING week', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onWeekChange={onWeekChange} />);

    fireEvent.click(screen.getByRole('button', { name: /^(back|previous|prev)$/i }));

    const reported = onWeekChange.mock.calls[0][0] as Date;
    expect(mondayOf(reported)).toBe('2026-07-13');
  });

  it('does not blow up when the parent supplies no onWeekChange', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(() =>
      fireEvent.click(screen.getByRole('button', { name: /^next$/i }))
    ).not.toThrow();
  });
});

describe('EventScheduler — day-view entry is a PROP contract (defaultView)', () => {
  // Pinned at the prop rather than at a caller: groupHomePage and gameDetail both produce
  // it (gameDetail's `?date=` arm is DECISION 65-03 EVT-05) and both reach the scheduler
  // through createEvent's `initialVisualView`. Asserting one caller would leave the other
  // unguarded through the rebuild.
  it('renders a SINGLE day column with defaultView="day"', () => {
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" />);
    const headers = columnHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('22');
  });

  it('renders the full seven-day week by default', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(columnHeaders()).toHaveLength(7);
  });
});

describe('EventScheduler — controlled selectedSlot renders the summary panel', () => {
  it('shows "Selected Time:" with the formatted range and the duration', () => {
    render(
      <EventScheduler
        initialDate={WEEK_N}
        selectedSlot={{
          start: new Date(2026, 6, 22, 19, 0, 0),
          end: new Date(2026, 6, 22, 21, 30, 0),
        }}
      />
    );

    // Verbatim parity carry — this string is the harness's anchor. Do not reword it.
    expect(screen.getByText('Selected Time:')).toBeInTheDocument();
    expect(
      screen.getByText(/Wednesday, July 22, 7:00 PM\s*-\s*9:30 PM/)
    ).toBeInTheDocument();
    expect(screen.getByText('(2h 30m)')).toBeInTheDocument();
  });

  it('shows the drag-to-select prompt instead when nothing is selected', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(screen.queryByText('Selected Time:')).not.toBeInTheDocument();
    expect(screen.getByText(/select a time slot for your event/i)).toBeInTheDocument();
  });
});

describe('EventScheduler — availability is keyed on the LOCAL date+hour of a UTC slot', () => {
  it('puts the count badge on the local cell the UTC slot converts to', () => {
    render(<EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />);

    // One accessible name per addressable cell; the hour spans two half-hour groups, so the
    // same name appears on both. Assert the name exists and carries the count.
    const cells = screen.getAllByLabelText(EXPECTED_CELL_LABEL);
    expect(cells.length).toBeGreaterThan(0);
    expect(within(cells[0]).getByText('3')).toBeInTheDocument();
  });

  it('leaves every OTHER cell unannotated (only slots with availability are described)', () => {
    render(<EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />);
    const described = screen.getAllByLabelText(/^Availability for /);
    // Every described cell is the one keyed cell — a stray key would widen this set.
    described.forEach((el) =>
      expect(el.getAttribute('aria-label')).toBe(EXPECTED_CELL_LABEL)
    );
  });

  it('renders no availability annotations at all when there is no heatmap data', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(screen.queryAllByLabelText(/^Availability for /)).toHaveLength(0);
  });
});

describe('EventScheduler — scrollToTime, legend and the partial-data note', () => {
  it('mounts with scrollToTime and renders the availability legend', () => {
    expect(() =>
      render(
        <EventScheduler
          initialDate={WEEK_N}
          heatmapData={heatmapFixture}
          scrollToTime={new Date(2026, 6, 22, 18, 0, 0)}
        />
      )
    ).not.toThrow();

    expect(screen.getByText('Availability:')).toBeInTheDocument();
    expect(screen.getByText('More available')).toBeInTheDocument();
  });

  it('names how many members are missing from the data', () => {
    render(<EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />);
    expect(
      screen.getByText(/2 of 6 members haven't shared availability yet/)
    ).toBeInTheDocument();
  });

  it('says so plainly when nobody has shared availability', () => {
    render(
      <EventScheduler
        initialDate={WEEK_N}
        heatmapData={{ totalMembers: 0, totalGroupMembers: 6, membersWithoutDataCount: 0, slots: [] }}
      />
    );
    expect(screen.getByText('No one has shared availability yet')).toBeInTheDocument();
    // The legend is availability-gated — no data, no legend.
    expect(screen.queryByText('Availability:')).not.toBeInTheDocument();
  });
});

describe('EventScheduler — initialDate re-syncs the visible week AFTER mount', () => {
  // Phase 71.2 poll-CTA anchor. `initialDate` is a HYBRID contract: it seeds the calendar at
  // mount AND re-anchors it whenever the parent changes it. A rebuild that treats it as a
  // mount-only seed leaves the poll CTA pointing at the wrong week with no other symptom.
  it('moves the visible week when the parent hands it a later initialDate', () => {
    const { rerender } = render(<EventScheduler initialDate={WEEK_N} />);
    expect(columnHeaders()?.[0]).toContain('20');

    rerender(<EventScheduler initialDate={WEEK_N_PLUS_2} />);

    const headers = columnHeaders();
    expect(headers).toHaveLength(7);
    expect(headers[0]).toContain('03');
    expect(headers.some((h) => h?.includes('20 Mon'))).toBe(false);
  });

  it('re-syncs in DAY view too (the gameDetail ?date= arm, DECISION 65-03 EVT-05)', () => {
    const { rerender } = render(<EventScheduler initialDate={WEEK_N} defaultView="day" />);
    expect(columnHeaders()?.[0]).toContain('22');

    rerender(<EventScheduler initialDate={WEEK_N_PLUS_2} defaultView="day" />);

    const headers = columnHeaders();
    expect(headers).toHaveLength(1);
    expect(headers[0]).toContain('05');
  });
});
