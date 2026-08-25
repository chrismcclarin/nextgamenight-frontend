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
//
// PLAN 88.1-11 ADDITIONS (last section): the mouse drag RANGE machine — one commit per gesture,
// backwards-drag normalization, nothing committed mid-drag — plus the live selection rectangle's
// presence/class contract and the gesture-accurate prompt copy fork. Its own preamble explains
// how a drag is driven in jsdom and, more importantly, what that does NOT prove.
//
// PLAN 88.1-09 ADDITIONS (below the plan-01 pins): SPEC Req 6 — roving keyboard navigation with
// REAL focus movement, keyboard commit, the ARIA scaffold, an axe run, both-direction day-arm
// stepping, the carried Today control, and the committed-selection block on the grid.
//
// NOT ONE PLAN-01 PIN WAS EDITED. The rebuild passes all fifteen unchanged, including the
// `columnHeaders()` helper — which mattered more than it looks: WeekGrid renders a blank corner
// cell above the time gutter, and it is only NOT a `columnheader` here because the rebuilt
// scheduler opts out through WeekGrid's `gutterHeaderRole` seam. Had it not, every
// `toHaveLength(7)` in this file and in the Layer-3 suite would have read 8.
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { addDays, format, startOfDay, startOfWeek } from 'date-fns';

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

// =========================================================================================
// Plan 88.1-09 — SPEC Req 6 (keyboard + ARIA) and the rebuilt chrome.
// =========================================================================================

/** The grid is 28 rows (30-minute slots over 10:00-23:59) by `days` columns. */
const SLOT_ROWS = 28;
const gridcells = () => screen.getAllByRole('gridcell');
/** Cell at (row, col) in DOM order — the grid renders row-major. */
const cellAt = (row: number, col: number, cols: number) => gridcells()[row * cols + col];

const button = (name: RegExp) => screen.getByRole('button', { name });

describe('EventScheduler — roving keyboard navigation moves REAL DOM focus (Req 6)', () => {
  // The `WeekGrid.test.tsx:78-100` idiom, on the composed scheduler: focus a gridcell, fire a
  // nav key, assert `document.activeElement` actually MOVED. A tabIndex shuffle is not the
  // guarantee — the guarantee is that a keyboard user's focus ring is on the cell they navigated
  // to. The handler under test is `useHeatmapCell`'s; this proves the rebuild WIRED it, which is
  // exactly what the outgoing implementation never did.
  // DEF-88.1-10-01 (RESOLVED 2026-08-24, recorded here because THIS is the test that surfaced it):
  // this case passes alone in ~12.6s and used to expire against vitest's 5000ms default whenever
  // the whole directory ran in parallel on a 4-core machine. Plan 88.1-18 was routed to fix it with
  // a per-test timeout argument, but the owner had already ruled the other way in the interim —
  // `vitest.config.mts` now carries a suite-wide `testTimeout: 20000` (FE commit `7fb52e6`), chosen
  // OVER per-test arguments because the same flake had spread to four files. So there is
  // deliberately NO timeout argument here: adding one would shadow the ceiling the owner picked and
  // hide the next instance of the same problem. If this expires again, the number to look at is in
  // `vitest.config.mts`, not on this line.
  it('walks the full eight-key set across the WEEK arm', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    const cols = 7;

    cellAt(0, 0, cols).focus();
    expect(document.activeElement).toBe(cellAt(0, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cellAt(0, 1, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cellAt(1, 1, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(cellAt(1, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cellAt(0, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'End' });
    expect(document.activeElement).toBe(cellAt(0, cols - 1, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Home' });
    expect(document.activeElement).toBe(cellAt(0, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageDown' });
    expect(document.activeElement).toBe(cellAt(SLOT_ROWS - 1, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageUp' });
    expect(document.activeElement).toBe(cellAt(0, 0, cols));
  });

  it('walks the vertical keys in the DAY arm, and the horizontal keys correctly do not move', () => {
    // The day arm is ONE column, so ArrowLeft/ArrowRight/Home/End have nowhere to go. That is the
    // hook's clamp behaving, not a gap: asserting focus STAYS is the honest contract for a
    // single-column grid, and it is what catches a rebuild that lets focus escape the grid.
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" />);
    const cols = 1;
    expect(gridcells()).toHaveLength(SLOT_ROWS);

    cellAt(0, 0, cols).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cellAt(1, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageDown' });
    expect(document.activeElement).toBe(cellAt(SLOT_ROWS - 1, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(cellAt(SLOT_ROWS - 2, 0, cols));

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'PageUp' });
    expect(document.activeElement).toBe(cellAt(0, 0, cols));

    for (const key of ['ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      fireEvent.keyDown(document.activeElement as HTMLElement, { key });
      expect(document.activeElement).toBe(cellAt(0, 0, cols));
    }
  });
});

describe('EventScheduler — keyboard commit reaches onTimeSelected (Req 6)', () => {
  it('Enter on a focused cell commits that 30-minute slot in the WEEK arm', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    // (row 2, col 2) = the third half-hour slot (11:00) on the Wednesday of WEEK_N's Monday week.
    cellAt(2, 2, 7).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });

    expect(onTimeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeSelected.mock.calls[0] as [Date, Date];
    const monday = startOfWeek(WEEK_N, { weekStartsOn: 1 });
    expect(start).toEqual(new Date(addDays(monday, 2).setHours(11, 0, 0, 0)));
    expect(end).toEqual(new Date(addDays(monday, 2).setHours(11, 30, 0, 0)));
  });

  it('Space commits in the DAY arm, on the displayed day', () => {
    const onTimeSelected = vi.fn();
    render(
      <EventScheduler initialDate={WEEK_N} defaultView="day" onTimeSelected={onTimeSelected} />
    );

    cellAt(1, 0, 1).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: ' ' });

    const [start, end] = onTimeSelected.mock.calls[0] as [Date, Date];
    expect(start).toEqual(new Date(startOfDay(WEEK_N).setHours(10, 30, 0, 0)));
    expect(end).toEqual(new Date(startOfDay(WEEK_N).setHours(11, 0, 0, 0)));
  });

  it('a non-select key commits nothing', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);
    cellAt(0, 0, 7).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'a' });
    expect(onTimeSelected).not.toHaveBeenCalled();
  });
});

describe('EventScheduler — the ARIA scaffold survives the rebuild (Req 6)', () => {
  it('exposes grid / row / columnheader / gridcell, and every cell is named', () => {
    render(<EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />);

    expect(screen.getByRole('grid')).toBeInTheDocument();
    // Header row + 28 slot rows.
    expect(screen.getAllByRole('row')).toHaveLength(SLOT_ROWS + 1);
    expect(screen.getAllByRole('columnheader')).toHaveLength(7);

    const cells = gridcells();
    expect(cells).toHaveLength(SLOT_ROWS * 7);
    for (const cell of cells) {
      expect(cell.getAttribute('aria-label')).toBeTruthy();
    }
  });
});

/*
 * COVERAGE NOTE 2026-08-22 (adversarial review, carried into the code): this axe pin executes in
 * WAVE 3 — two waves before the phone fork and `SchedulerWeekStrip` exist (plan 88.1-12, wave 5).
 * As of today it audits the DESKTOP arm only, while SPEC Req 6's target is "both views" and the
 * phone arm is the primary surface under the phone-forward tenet.
 *
 * It is therefore written PARAMETERIZED OVER THE FORK rather than as a single desktop render:
 * plan 88.1-12 adds `{ name: 'phone', hoverNone: true, maxWidth: 375 }` to the table below and
 * this pin takes the phone composition with no rewrite. A phone entry is deliberately NOT added
 * now — with no fork in the component it would render the identical desktop tree and read as
 * phone coverage that does not exist.
 *
 * A GREEN RUN HERE IS NOT EVIDENCE ABOUT THE PHONE ARM. Plan 88.1-12's acceptance carries the
 * obligation to re-run axe against the shipped phone composition (strip + single-day column);
 * do not report Req 6 as met on this pin alone.
 *
 * PLAN 88.1-12 (wave 5), DISCHARGING THE ABOVE: the fork now exists, so the phone entry is added
 * below exactly as the note was written for — no rewrite of the pin, one table row. The phone arm
 * it audits is the SHIPPED composition: `SchedulerWeekStrip`'s tablist above a single-day column
 * carrying `role="tabpanel"`, with no week/day toggle. The obligation is therefore discharged
 * HERE and not before; a run of this file from plan 88.1-09 or 88.1-11 still proves only desktop.
 */
type AxeViewport = { name: string; hoverNone: boolean; maxWidth: number };
const AXE_VIEWPORTS: AxeViewport[] = [
  { name: 'desktop', hoverNone: false, maxWidth: 1280 },
  { name: 'phone', hoverNone: true, maxWidth: 375 },
];

/** Answer the media queries the fork will branch on, per viewport. */
function stubMatchMedia({ hoverNone, maxWidth }: AxeViewport) {
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => {
    const widthMatch = /max-width:\s*(\d+)px/.exec(query);
    const matches = widthMatch
      ? maxWidth <= Number(widthMatch[1])
      : query.includes('hover: none')
        ? hoverNone
        : false;
    return {
      matches,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return () => {
    window.matchMedia = original;
  };
}

describe.each(AXE_VIEWPORTS)('EventScheduler — axe on the $name arm (Req 6)', (viewport) => {
  it('reports no violations across the grid, the nav controls and the view toggle', async () => {
    const restore = stubMatchMedia(viewport);
    try {
      const { container } = render(
        <EventScheduler
          initialDate={WEEK_N}
          heatmapData={heatmapFixture}
          selectedSlot={{
            start: new Date(2026, 6, 22, 19, 0, 0),
            end: new Date(2026, 6, 22, 21, 30, 0),
          }}
        />
      );
      expect(await axe(container)).toHaveNoViolations();
    } finally {
      restore();
    }
  }, 30000);
});

describe('EventScheduler — day-arm navigation steps ONE day, in both directions', () => {
  // The plan-01 and plan-07 pins only ever exercised the WEEK arm forwards and backwards, plus a
  // single forward day step inside the Layer-3 same-week case. This closes the asymmetry: the day
  // arm must step by a day in BOTH directions and bubble each step, so the parent's
  // `resolveWeekNav` gets the chance to skip (same week) or re-fetch (crossed a boundary).
  it('next renders the FOLLOWING day and reports it', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" onWeekChange={onWeekChange} />);
    expect(columnHeaders()).toEqual([format(WEEK_N, 'dd EEE')]);

    fireEvent.click(button(/^next$/i));

    expect(columnHeaders()).toEqual([format(addDays(WEEK_N, 1), 'dd EEE')]);
    expect(onWeekChange).toHaveBeenCalledTimes(1);
    expect(isoDay(onWeekChange.mock.calls[0][0] as Date)).toBe(isoDay(addDays(WEEK_N, 1)));
  });

  it('previous renders the PRIOR day and reports it', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" onWeekChange={onWeekChange} />);

    fireEvent.click(button(/^(back|previous|prev)$/i));

    expect(columnHeaders()).toEqual([format(addDays(WEEK_N, -1), 'dd EEE')]);
    expect(isoDay(onWeekChange.mock.calls[0][0] as Date)).toBe(isoDay(addDays(WEEK_N, -1)));
  });

  it('toggling week -> day -> week keeps the stepped-to date (the toggle never writes it)', () => {
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" />);

    fireEvent.click(button(/^next$/i)); // Thu 23 Jul
    fireEvent.click(button(/^week$/i));

    // The displayed week is the one CONTAINING the stepped-to day, not a reset to `initialDate`.
    expect(columnHeaders()).toHaveLength(7);
    expect(columnHeaders()[0]).toBe(format(startOfWeek(addDays(WEEK_N, 1), { weekStartsOn: 1 }), 'dd EEE'));

    fireEvent.click(button(/^day$/i));
    expect(columnHeaders()).toEqual([format(addDays(WEEK_N, 1), 'dd EEE')]);
  });
});

describe('EventScheduler — the carried Today control returns to the current week/day', () => {
  // DECISION Phase 88.1-09 (owner ruling 2026-08-22): the outgoing toolbar rendered a Today
  // control for free, so it is in shipped UI and must not silently vanish in a rebuild whose
  // promise is parity. It routes through the same nav path as Next/Back, so the parent sees an
  // ordinary navigation.
  const todayMonday = () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), 'dd EEE');

  it('returns the WEEK arm from a navigated-away week and reports today', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onWeekChange={onWeekChange} />);
    fireEvent.click(button(/^next$/i));
    expect(columnHeaders()[0]).not.toBe(todayMonday());

    fireEvent.click(button(/^today$/i));

    expect(columnHeaders()[0]).toBe(todayMonday());
    const reported = onWeekChange.mock.calls.at(-1)?.[0] as Date;
    expect(isoDay(reported)).toBe(isoDay(new Date()));
  });

  it('returns the DAY arm to today and reports it', () => {
    const onWeekChange = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} defaultView="day" onWeekChange={onWeekChange} />);
    expect(columnHeaders()).toEqual([format(WEEK_N, 'dd EEE')]);

    fireEvent.click(button(/^today$/i));

    expect(columnHeaders()).toEqual([format(new Date(), 'dd EEE')]);
    expect(isoDay(onWeekChange.mock.calls.at(-1)?.[0] as Date)).toBe(isoDay(new Date()));
  });
});

describe('EventScheduler — the committed selection is a FILLED block ON the grid', () => {
  /* The outgoing implementation rendered the committed slot as a filled block via its event
     styler (primary background, white text). That block is a LIVE surface — the user's visual
     confirmation of the time they picked — and the plan-01 pin on the `Selected Time:` panel is a
     DIFFERENT element that stays green whether or not the block exists. So it gets its own pin.

     It is asserted by test id + its background TOKEN rather than by class-string equality, and
     deliberately NOT by geometry (jsdom has no layout — P7). The count of covered cells is the
     discriminating part: a block rendered once, or over the whole column, fails. */
  const start = new Date(2026, 6, 22, 19, 0, 0); // Wed 19:00
  const end = new Date(2026, 6, 22, 21, 30, 0); // -> 21:30, i.e. five 30-minute cells

  it('fills exactly the cells the selected range covers, on the primary token', () => {
    render(<EventScheduler initialDate={WEEK_N} selectedSlot={{ start, end }} />);

    const blocks = screen.getAllByTestId('scheduler-selected-block');
    expect(blocks).toHaveLength(5);
    for (const block of blocks) {
      expect(block.style.backgroundColor).toBe('var(--color-btn-primary-bg)');
    }
    // The block sits inside the cell for 19:00 on the Wednesday column (row 18, col 2).
    expect(cellAt(18, 2, 7)).toContainElement(blocks[0]);
  });

  it('renders no block at all when nothing is selected', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(screen.queryAllByTestId('scheduler-selected-block')).toHaveLength(0);
  });

  it('is a SEPARATE surface from the "Selected Time:" panel, not a substitute for it', () => {
    render(<EventScheduler initialDate={WEEK_N} selectedSlot={{ start, end }} />);
    expect(screen.getByText('Selected Time:')).toBeInTheDocument();
    expect(screen.getAllByTestId('scheduler-selected-block').length).toBeGreaterThan(0);
  });
});

// =========================================================================================
// Plan 88.1-11 — the drag RANGE machine, the live rectangle, and the gesture-accurate prompt.
// =========================================================================================

/*
 * WHY THESE PINS EXIST AT ALL — RESEARCH P6, stated plainly: the calendar library supplied
 * mouse drag-select for free (`selectable` + `onSelectSlot` gave a start/end PAIR). WeekGrid
 * supplies per-cell paint, which is a different gesture. Building only the touch arm would leave
 * DESKTOP DRAG SILENTLY BROKEN and nothing else in the suite would notice — every other pin here
 * commits through the keyboard or through the controlled `selectedSlot` prop.
 *
 * HOW A DRAG IS DRIVEN IN JSDOM, and what that does and does NOT prove.
 *
 * `document.elementFromPoint` is NOT IMPLEMENTED by jsdom (probed this session: it is
 * `undefined`), and the gesture machine resolves every target through it. So the pins below
 * install a resolver stub that maps a synthetic client point to a chosen cell — `clientX` is the
 * COLUMN index and `clientY` is the ROW index, by construction.
 *
 * This is deliberately NOT the trap `DECISION Phase 88.1-07 Task 2` warns about in
 * `createEvent.integration.test.tsx:254-269`. That warning is about stubbing geometry and then
 * letting a slot be DERIVED from it — the library divided by the height of a zero-height rect,
 * so the pin would have "passed" on a slot no user could have clicked. Nothing here reads
 * layout: `pointResolver` walks `closest('[data-coord]')` and reads an attribute this repo
 * authored. The point-to-cell mapping is stated by the test rather than measured, so what is
 * pinned is the STATE MACHINE and the coordinate->time derivation — anchor, extend, normalize,
 * commit once — and nothing about pixels.
 *
 * WHAT IS THEREFORE NOT PINNED HERE, and where it lives instead (plan 88.1-14, at 375x667):
 *   - that a real finger at a real pixel lands on the cell under it;
 *   - the rectangle's POSITION and SIZE (P7 — every box in jsdom is zero, so a geometry
 *     assertion here would pass on zeroes and prove nothing). Its PRESENCE and its class
 *     contract are pinned; its behaviour is Playwright's.
 *   - all gesture TIMING (P5). No pin below asserts the long-press threshold, or any other
 *     duration. The shipped 250ms and the owner-ruled 300ms differ ON PURPOSE, and a pin on the
 *     number would go red and invite someone to "fix" the rebuild backwards.
 */

/** Map a synthetic client point to a grid cell: clientX = column, clientY = row. */
function stubPointResolution() {
  const doc = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
  };
  const original = doc.elementFromPoint;
  doc.elementFromPoint = (x: number, y: number) =>
    document.querySelector(`[data-coord="${y}:${x}"]`);
  return () => {
    doc.elementFromPoint = original;
  };
}

const POINTER = { pointerId: 1, pointerType: 'mouse' } as const;
const grid = () => screen.getByRole('grid');

/** Fire one pointer event at the cell (row, col) — see the coordinate convention above. */
function pointerAt(
  kind: 'pointerDown' | 'pointerMove' | 'pointerUp' | 'pointerCancel',
  row: number,
  col: number
) {
  fireEvent[kind](grid(), { ...POINTER, clientX: col, clientY: row });
}

describe('EventScheduler — mouse drag selects a RANGE and commits once (P6 regression guard)', () => {
  let restoreResolver: () => void;
  beforeEach(() => {
    restoreResolver = stubPointResolution();
  });
  afterEach(() => restoreResolver());

  const monday = startOfWeek(WEEK_N, { weekStartsOn: 1 });
  /** Wall-clock time of grid row `row` on day column `col` (10:00 start, 30-minute slots). */
  const slotTime = (row: number, col: number) =>
    new Date(addDays(monday, col).setHours(10 + Math.floor(row / 2), (row % 2) * 30, 0, 0));

  it('commits ONE start/end pair spanning every crossed slot', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    pointerAt('pointerDown', 4, 2); // Wed 12:00
    pointerAt('pointerMove', 5, 2);
    pointerAt('pointerMove', 7, 2); // …through Wed 13:30
    pointerAt('pointerUp', 7, 2);

    expect(onTimeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeSelected.mock.calls[0] as [Date, Date];
    expect(start).toEqual(slotTime(4, 2));
    // The range CLOSES the last crossed slot rather than starting it — 13:30 + 30 min.
    expect(end).toEqual(slotTime(8, 2));
  });

  it('normalizes a BACKWARDS drag to start < end (T-88.1-29)', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    pointerAt('pointerDown', 7, 2); // anchor LATE…
    pointerAt('pointerMove', 4, 2); // …drag EARLIER
    pointerAt('pointerUp', 4, 2);

    expect(onTimeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeSelected.mock.calls[0] as [Date, Date];
    expect(start).toEqual(slotTime(4, 2));
    expect(end).toEqual(slotTime(8, 2));
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it('commits NOTHING mid-drag — not per cell, not on the anchor', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    pointerAt('pointerDown', 4, 2);
    expect(onTimeSelected).not.toHaveBeenCalled();

    for (const row of [5, 6, 7, 8]) {
      pointerAt('pointerMove', row, 2);
      expect(onTimeSelected).not.toHaveBeenCalled();
    }

    pointerAt('pointerUp', 8, 2);
    expect(onTimeSelected).toHaveBeenCalledTimes(1);
  });

  it('a click with no movement still commits the single slot under the pointer', () => {
    // The tap path must survive the range machine: this is what plan 88.1-09 shipped and what a
    // user does most often. Degenerate range = one slot.
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    pointerAt('pointerDown', 6, 3);
    pointerAt('pointerUp', 6, 3);

    expect(onTimeSelected).toHaveBeenCalledTimes(1);
    const [start, end] = onTimeSelected.mock.calls[0] as [Date, Date];
    expect(start).toEqual(slotTime(6, 3));
    expect(end).toEqual(slotTime(7, 3));
  });

  it('pointercancel commits nothing (the browser took the gesture)', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    pointerAt('pointerDown', 4, 2);
    pointerAt('pointerMove', 7, 2);
    pointerAt('pointerCancel', 7, 2);

    expect(onTimeSelected).not.toHaveBeenCalled();
  });

  it('a drag that starts off-grid (the gutter, a header) commits nothing', () => {
    const onTimeSelected = vi.fn();
    render(<EventScheduler initialDate={WEEK_N} onTimeSelected={onTimeSelected} />);

    // Column -1 resolves to no `[data-coord]` element at all.
    pointerAt('pointerDown', 4, -1);
    pointerAt('pointerUp', 4, -1);

    expect(onTimeSelected).not.toHaveBeenCalled();
  });
});

describe('EventScheduler — the live selection rectangle (DECISION Phase 88-27, D-32 bucket A)', () => {
  let restoreResolver: () => void;
  beforeEach(() => {
    restoreResolver = stubPointResolution();
  });
  afterEach(() => restoreResolver());

  const rect = () => screen.queryByTestId('scheduler-drag-rect');

  it('appears while the drag is live and disappears on commit', () => {
    render(<EventScheduler initialDate={WEEK_N} />);
    expect(rect()).not.toBeInTheDocument();

    pointerAt('pointerDown', 4, 2);
    expect(rect()).toBeInTheDocument();

    pointerAt('pointerMove', 7, 2);
    expect(rect()).toBeInTheDocument();

    pointerAt('pointerUp', 7, 2);
    expect(rect()).not.toBeInTheDocument();
  });

  it('has a 2px border and NO FILL, and never eats the drag it is drawing', () => {
    // The class contract, not the geometry (P7). The no-fill half is the load-bearing one: an
    // opaque fill would hide the very cells the drag is selecting, which is what D-32 bucket A
    // rejected. A future "completion" that adds a background makes this pin red on purpose.
    render(<EventScheduler initialDate={WEEK_N} />);
    pointerAt('pointerDown', 4, 2);

    const el = rect() as HTMLElement;
    expect(el.className).toContain('border-2');
    expect(el.className).toContain('border-btn-primary');
    expect(el.className).toContain('pointer-events-none');
    expect(el.style.backgroundColor).toBe('');
    expect(el.getAttribute('aria-hidden')).toBe('true');

    pointerAt('pointerUp', 4, 2);
  });

  it('is a DIFFERENT surface from the committed selection block', () => {
    // Two states, two treatments: in-progress = border only, committed = filled. Merging them is
    // the regression both DECISION markers exist to prevent.
    render(
      <EventScheduler
        initialDate={WEEK_N}
        selectedSlot={{ start: new Date(2026, 6, 22, 19, 0, 0), end: new Date(2026, 6, 22, 19, 30, 0) }}
      />
    );
    expect(screen.getAllByTestId('scheduler-selected-block').length).toBeGreaterThan(0);
    expect(rect()).not.toBeInTheDocument();
  });
});

describe('EventScheduler — the prompt names the gesture the DEVICE can perform (Req 5, UI-SPEC)', () => {
  // Asserted on the RENDERED STRING, never on a viewport measurement (P7: jsdom has no layout).
  // The fork is a matchMedia state fork precisely so this is answerable at all — see the
  // DECISION marker at `isPhoneViewport`.
  const PHONE_COPY = 'Tap and hold on a day to pick a time.';
  const DESKTOP_COPY = 'Click and drag on the calendar to select a time slot for your event.';

  it('says tap-and-hold at md and below', () => {
    const restore = stubMatchMedia({ name: 'phone', hoverNone: true, maxWidth: 375 });
    try {
      render(<EventScheduler initialDate={WEEK_N} />);
      expect(screen.getByText(PHONE_COPY)).toBeInTheDocument();
      expect(screen.queryByText(DESKTOP_COPY)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('keeps the shipped click-and-drag sentence above md', () => {
    const restore = stubMatchMedia({ name: 'desktop', hoverNone: false, maxWidth: 1280 });
    try {
      render(<EventScheduler initialDate={WEEK_N} />);
      expect(screen.getByText(DESKTOP_COPY)).toBeInTheDocument();
      expect(screen.queryByText(PHONE_COPY)).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('shows no prompt at all once a slot is selected, on either arm', () => {
    for (const viewport of [
      { name: 'phone', hoverNone: true, maxWidth: 375 },
      { name: 'desktop', hoverNone: false, maxWidth: 1280 },
    ]) {
      const restore = stubMatchMedia(viewport);
      try {
        render(
          <EventScheduler
            initialDate={WEEK_N}
            selectedSlot={{ start: new Date(2026, 6, 22, 19, 0, 0), end: new Date(2026, 6, 22, 21, 30, 0) }}
          />
        );
        expect(screen.queryByText(PHONE_COPY)).not.toBeInTheDocument();
        expect(screen.queryByText(DESKTOP_COPY)).not.toBeInTheDocument();
      } finally {
        restore();
        cleanup();
      }
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PLAN 88.1-12: the phone geometry fork (CONTEXT D-03 / D-04, SPEC Req 7).
//
// Every pin below drives the arm through the matchMedia stub, NEVER by measuring anything: jsdom
// has no layout, so the 46.7px strip cell, the 44px touch floor and the day column's internal
// scroll are all asserted for real in plan 88.1-14's Playwright spec at 375x667. What is
// answerable here is WHICH TREE renders, and that is what these assert.
// ---------------------------------------------------------------------------------------------

/** Render an arm with matchMedia stubbed, and hand back a restore fn for the finally block. */
function renderAtViewport(viewport: AxeViewport, ui: React.ReactElement) {
  const restore = stubMatchMedia(viewport);
  const utils = render(ui);
  return { ...utils, restore };
}
const PHONE: AxeViewport = { name: 'phone', hoverNone: true, maxWidth: 375 };
const DESKTOP: AxeViewport = { name: 'desktop', hoverNone: false, maxWidth: 1280 };

describe('EventScheduler — the PHONE arm is a week strip over a single-day column', () => {
  it('renders seven strip cells and exactly ONE day column', () => {
    const { restore } = renderAtViewport(
      PHONE,
      <EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />
    );
    try {
      expect(screen.getByRole('tablist', { name: /choose a day/i })).toBeInTheDocument();
      expect(screen.getAllByRole('tab')).toHaveLength(7);
      // ONE interactive day column — the 7-column grid D-03 rejected at this width is not here.
      expect(columnHeaders()).toHaveLength(1);
      expect(gridcells()).toHaveLength(SLOT_ROWS);
    } finally {
      restore();
    }
  });

  it('renders NO week/day toggle (D-04 — the strip IS the week view at phone)', () => {
    const { restore } = renderAtViewport(PHONE, <EventScheduler initialDate={WEEK_N} />);
    try {
      expect(screen.queryByRole('group', { name: /calendar view/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^week$/i })).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^day$/i })).not.toBeInTheDocument();
      // …while the nav affordances the rebuild promised parity on all survive.
      expect(screen.getByRole('button', { name: /^back$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^today$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('names the day column from the SELECTED strip cell, so the tabs point at something real', () => {
    const { restore } = renderAtViewport(PHONE, <EventScheduler initialDate={WEEK_N} />);
    try {
      const panel = screen.getByRole('tabpanel');
      const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
      expect(selected).toBeDefined();
      expect(panel).toHaveAttribute('aria-labelledby', selected!.id);
      // WEEK_N is Wednesday 22 July 2026.
      expect(selected!.getAttribute('aria-label')).toMatch(/wednesday 22/i);
    } finally {
      restore();
    }
  });

  it('carries the day aggregate — the MAX over that day’s slots — onto the strip cell', () => {
    // The fixture puts availableCount 3 (of 4) on ONE slot of Wednesday 22 July; every other day
    // has nothing. A mean or a sum over the day would not read 3.
    const { restore } = renderAtViewport(
      PHONE,
      <EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />
    );
    try {
      expect(screen.getByRole('tab', { name: /wednesday 22, 3 of 4 available/i })).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: /monday 20, 0 of 4 available/i })).toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('opens focused on the target date for BOTH day-entry producers (CAL-05 and ?date=)', () => {
    // groupHomePage's CAL-05 path and gameDetail's `?date=` path (DECISION Phase 65-03 EVT-05)
    // both reach here as `defaultView="day"` plus an `initialDate` on the tapped day. At phone
    // there is no view to switch to, so "opens in day mode" has to mean "opens with that day
    // selected in the strip" — pinned at the prop, because asserting one caller leaves the other
    // unguarded.
    const target = addDays(WEEK_N, 2); // Friday 24 July
    const { restore } = renderAtViewport(
      PHONE,
      <EventScheduler initialDate={target} defaultView="day" />
    );
    try {
      const selected = screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true');
      expect(selected!.getAttribute('aria-label')).toMatch(/friday 24/i);
      expect(columnHeaders()).toEqual([format(target, 'dd EEE')]);
    } finally {
      restore();
    }
  });

  it('selecting a strip cell changes which day the column shows', () => {
    const onWeekChange = vi.fn();
    const { restore } = renderAtViewport(
      PHONE,
      <EventScheduler initialDate={WEEK_N} onWeekChange={onWeekChange} />
    );
    try {
      expect(columnHeaders()).toEqual([format(WEEK_N, 'dd EEE')]);

      fireEvent.click(screen.getByRole('tab', { name: /friday 24/i }));

      expect(columnHeaders()).toEqual([format(addDays(WEEK_N, 2), 'dd EEE')]);
      // It bubbles as an ordinary same-week navigation; the parent's resolveWeekNav skips it.
      expect(isoDay(onWeekChange.mock.calls[0][0] as Date)).toBe(isoDay(addDays(WEEK_N, 2)));
      expect(mondayOf(onWeekChange.mock.calls[0][0] as Date)).toBe(mondayOf(WEEK_N));
    } finally {
      restore();
    }
  });

  it('follows Back/Next with the strip — the selected cell moves, and the week follows it', () => {
    const { restore } = renderAtViewport(PHONE, <EventScheduler initialDate={WEEK_N} />);
    try {
      // Wed 22 -> Thu 23: one DAY, because the visible column is a day.
      fireEvent.click(button(/^next$/i));
      expect(columnHeaders()).toEqual([format(addDays(WEEK_N, 1), 'dd EEE')]);
      const selected = () =>
        screen.getAllByRole('tab').find((t) => t.getAttribute('aria-selected') === 'true')!;
      expect(selected().getAttribute('aria-label')).toMatch(/thursday 23/i);
      // Still the same week in the strip.
      expect(screen.getAllByRole('tab')[0].getAttribute('aria-label')).toMatch(/monday 20/i);
    } finally {
      restore();
    }
  });
});

describe('EventScheduler — the DESKTOP arm is untouched by the fork', () => {
  it('keeps the seven-column grid and the week/day toggle', () => {
    const { restore } = renderAtViewport(
      DESKTOP,
      <EventScheduler initialDate={WEEK_N} heatmapData={heatmapFixture} />
    );
    try {
      expect(columnHeaders()).toHaveLength(7);
      expect(screen.getByRole('group', { name: /calendar view/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^week$/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^day$/i })).toBeInTheDocument();
      // No strip, and no dangling tabpanel role on the grid container.
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    } finally {
      restore();
    }
  });

  it('still toggles to a single day column through the button group', () => {
    const { restore } = renderAtViewport(DESKTOP, <EventScheduler initialDate={WEEK_N} />);
    try {
      fireEvent.click(button(/^day$/i));
      expect(columnHeaders()).toEqual([format(WEEK_N, 'dd EEE')]);
      expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
      fireEvent.click(button(/^week$/i));
      expect(columnHeaders()).toHaveLength(7);
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// PLAN 88.1-13: the today treatment (SPEC Req 8, UI-SPEC "Where the today tint lands").
//
// THESE ARE CLASS-CONTRACT ASSERTIONS, AND THAT IS THE POINT — not a lapse from the file's
// role/label/text discipline. What Req 8 actually contracts is that the treatment is a PAIRED
// ternary of MUTUALLY EXCLUSIVE branches rather than one static class plus an interpolated tint,
// and that shape is only observable in the emitted class string: the two renderings differ in
// nothing else, because the defect they guard against is resolved by STYLESHEET ORDER, which jsdom
// never applies. A role/text locator cannot tell a working tint from a silently dropped one.
//
// So: nothing here claims the tint is VISIBLE, legible, or strong enough — that is plan 88.1-14's
// Playwright run and plan 88.1-15's owner walk. What is answerable here is that both halves are
// present on today and absent everywhere else, and that no colliding colour class ships beside
// them (threat T-88.1-39).
//
// The clock is FIXED because `isToday` reads the wall clock: without that, "today" is whatever day
// the suite happens to run on and the pin either lands on a different column or, at a week
// boundary, on none of the rendered seven.
// ---------------------------------------------------------------------------------------------

describe('EventScheduler — today carries BOTH halves of the paired ternary (Req 8)', () => {
  // Wednesday 2026-07-22 — index 2 of a Monday-first week, so a pin that silently lands on the
  // first or last column would fail rather than pass by position.
  const TODAY = new Date(2026, 6, 22, 12, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The colour utilities the paired ternary may emit on one element — exactly one is allowed. */
  const colourClassesOf = (el: Element) =>
    el.className.split(/\s+/).filter((c) => /^text-(accent|content-[a-z]+)$/.test(c));

  it('desktop: the today day header carries the tint AND the accent label; the other six carry neither', () => {
    const { restore } = renderAtViewport(DESKTOP, <EventScheduler initialDate={TODAY} />);
    try {
      const headers = screen.getAllByRole('columnheader');
      expect(headers).toHaveLength(7);

      const todayIndex = headers.findIndex((h) => h.textContent === format(TODAY, 'dd EEE'));
      expect(todayIndex).toBe(2);

      headers.forEach((header, index) => {
        const html = header.innerHTML;
        if (index === todayIndex) {
          // BOTH halves, and NEITHER of the non-today values — a half-applied treatment (tint
          // without the accent label, or the reverse) is the regression this pairs against.
          expect(html).toContain('bg-surface-accent-subtle');
          expect(html).toContain('text-accent');
          expect(html).not.toContain('bg-surface-card');
          expect(html).not.toContain('text-content-primary');
        } else {
          expect(html).toContain('bg-surface-card');
          expect(html).toContain('text-content-primary');
          expect(html).not.toContain('bg-surface-accent-subtle');
          expect(html).not.toContain('text-accent');
        }
      });
    } finally {
      restore();
    }
  });

  it('desktop: the tint and the plain surface are never emitted in the SAME class string', () => {
    // The collapse the exemplar's in-file warning describes (was `MergedHeatmapGrid.js:130-138`,
    // deleted by plan 88.1-16 — the warning now lives on the exemplar at `EventScheduler.tsx`):
    // a static `bg-surface-card` with the tint appended renders NOTHING, because
    // `.bg-surface-accent-subtle` is emitted BEFORE `.bg-surface-card` in a real build. It looks
    // identical to a working treatment in every role/text assertion, so it is pinned here.
    const { restore } = renderAtViewport(DESKTOP, <EventScheduler initialDate={TODAY} />);
    try {
      for (const header of screen.getAllByRole('columnheader')) {
        for (const el of header.querySelectorAll('[class]')) {
          const classes = el.className.split(/\s+/);
          expect(
            classes.includes('bg-surface-accent-subtle') && classes.includes('bg-surface-card')
          ).toBe(false);
        }
      }
    } finally {
      restore();
    }
  });

  it('phone: the today strip cell carries the tint AND the accent date number; the other six carry neither', () => {
    const { restore } = renderAtViewport(PHONE, <EventScheduler initialDate={TODAY} />);
    try {
      const tabs = screen.getAllByRole('tab');
      expect(tabs).toHaveLength(7);

      const todayTab = tabs.find((t) => t.getAttribute('aria-current') === 'date');
      expect(todayTab).toBeDefined();
      // The accessible half (plan 88.1-12) and the visual half (this plan) point at the SAME day —
      // a treatment that tinted a different cell than `aria-current` names would be worse than none.
      expect(todayTab!.getAttribute('aria-label')).toMatch(/wednesday 22/i);

      expect(todayTab!.innerHTML).toContain('bg-surface-accent-subtle');
      expect(todayTab!.innerHTML).toContain('text-accent');

      for (const tab of tabs.filter((t) => t !== todayTab)) {
        expect(tab.innerHTML).toContain('bg-surface-card');
        expect(tab.innerHTML).not.toContain('bg-surface-accent-subtle');
        expect(tab.innerHTML).not.toContain('text-accent');
      }
    } finally {
      restore();
    }
  });

  it('phone: the date-number span carries EXACTLY ONE text-colour class per branch (T-88.1-39)', () => {
    // The collision this guards: plan 88.1-12 copied a static muted colour onto this span, and
    // this plan's ternary owns that slot. If both ever ship in one class string, stylesheet order
    // decides — and the static class would silently outrank `text-accent` on today's cell no
    // matter which one appears later in the JSX. Counting the classes is the only way to see it.
    const { restore } = renderAtViewport(PHONE, <EventScheduler initialDate={TODAY} />);
    try {
      const tabs = screen.getAllByRole('tab');
      const todayTab = tabs.find((t) => t.getAttribute('aria-current') === 'date');

      for (const tab of tabs) {
        const dayNumber = within(tab).getByTestId('strip-day-number');
        const colours = colourClassesOf(dayNumber);
        expect(colours).toHaveLength(1);
        // Non-today keeps M-03 parity with the sibling idiom directly above it — deliberately NOT
        // the desktop header's non-today value. See the DECISION marker at the site.
        expect(colours[0]).toBe(tab === todayTab ? 'text-accent' : 'text-content-muted');
      }
    } finally {
      restore();
    }
  });
});

// =============================================================================================
// PLAN 88.1-18 — SPEC Req 13: day view opens on the DISPLAYED DAY's own peak.
//
// A DELIBERATE, SCOPED NARROWING OF THIS FILE'S GEOMETRY EXCLUSION (see ":P7, anything geometric"
// in the preamble). That rule stands for REAL layout — jsdom computes none, so column widths and
// strip cell heights remain Playwright's. What is answerable here is the effect's OWN assignment:
// `container.scrollTop = cell.offsetTop`. Both halves were probed against this repo's vitest
// (4.1.7, jsdom) on 2026-08-24: `scrollTop` round-trips faithfully, and an `offsetTop` accessor
// installed on `HTMLElement.prototype` is read by the component.
//
// So the stub below FABRICATES NO LAYOUT. It gives each cell a synthetic, row-derived offset, and
// the assertions then read back which ROW the effect chose — which is the whole of Req 13. It is
// installed per-test and the ORIGINAL property descriptor is restored in `afterEach`, so it cannot
// leak into a neighbouring suite (threat T-88.1-51).
//
// NON-VACUITY: the fixture makes the DAY peak and the WEEK peak land on DIFFERENT rows, and case 4
// pins the week arm on the week row — so case 2's zero means "did not scroll", not "the stub is
// not wired". Against the pre-88.1-18 component, cases 1-3 are red and case 4 is green.
// =============================================================================================

/** Synthetic per-row offset. No relation to real layout — see the block comment above. */
const ROW_PX = 20;

/** Build a UTC wire slot from a LOCAL (date, hour) target — the `WIRE_SLOT` idiom at :127-131. */
const wireSlotAt = (localDay: Date, localHour: number, availableCount: number) => {
  const local = new Date(
    localDay.getFullYear(),
    localDay.getMonth(),
    localDay.getDate(),
    localHour,
    0,
    0
  );
  return {
    date: local.toISOString().slice(0, 10),
    hour: local.getUTCHours(),
    availableCount,
  };
};

// The displayed week is Mon 2026-07-20 .. Sun 2026-07-26 (WEEK_N is the Wednesday).
const REQ13_MON = new Date(2026, 6, 20, 12, 0, 0); // no slots at all — the "empty day" case
const REQ13_WED = new Date(2026, 6, 22, 12, 0, 0); // peak 13:00 -> row 6
const REQ13_THU = new Date(2026, 6, 23, 12, 0, 0); // peak 16:00 -> row 12
const REQ13_FRI = new Date(2026, 6, 24, 12, 0, 0); // peak 19:00, count 3 -> the WEEK peak, row 18

const rowOf = (hour: number) => (hour - 10) * 2;
const WED_ROW = rowOf(13); // 6
const THU_ROW = rowOf(16); // 12
const WEEK_ROW = rowOf(19); // 18

/**
 * One week of availability where the displayed day's peak and the week's peak DISAGREE.
 *
 * Wednesday's own peak is 13:00 (count 2) — chosen so it is neither its earliest populated hour
 * (11:00) nor its latest (20:00), so a "first slot" or "last slot" rule answers differently.
 * Friday carries the week-wide maximum (count 3 at 19:00), which is what `createEvent.js`'s
 * `peakScrollTime` would hand over as `scrollToTime`.
 */
const req13Heatmap = {
  totalMembers: 4,
  totalGroupMembers: 4,
  membersWithoutDataCount: 0,
  slots: [
    wireSlotAt(REQ13_WED, 11, 1),
    wireSlotAt(REQ13_WED, 13, 2),
    wireSlotAt(REQ13_WED, 20, 1),
    wireSlotAt(REQ13_THU, 16, 2),
    wireSlotAt(REQ13_FRI, 19, 3),
  ],
  gcalConflicts: [],
};

/** Exactly what `createEvent.js:84-126` produces for this fixture: the week peak, 19:00. */
const REQ13_WEEK_SCROLL_TO_TIME = new Date(2026, 6, 24, 19, 0, 0);

/** The scroll container is the DIRECT PARENT of the `role="grid"` body (`WeekGrid.tsx:419-434`). */
const scroller = () => screen.getByRole('grid').parentElement as HTMLElement;

describe('EventScheduler — day view lands on the DAY peak, not the week peak (Req 13)', () => {
  let originalOffsetTop: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalOffsetTop = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetTop');
    Object.defineProperty(HTMLElement.prototype, 'offsetTop', {
      configurable: true,
      get(this: HTMLElement) {
        const coord = this.getAttribute?.('data-coord');
        return coord ? Number(coord.split(':')[0]) * ROW_PX : 0;
      },
    });
  });

  afterEach(() => {
    if (originalOffsetTop) {
      Object.defineProperty(HTMLElement.prototype, 'offsetTop', originalOffsetTop);
    } else {
      // jsdom ships the accessor, so this branch should never run — but deleting is still the
      // correct restore for "there was nothing here before", and leaving the stub installed is
      // exactly the cross-suite leak T-88.1-51 names.
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetTop;
    }
  });

  it('opens on the DISPLAYED day\'s peak even while the parent hands over the week peak', () => {
    render(
      <EventScheduler
        initialDate={REQ13_WED}
        defaultView="day"
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );

    // Wednesday's own peak is 13:00 -> row 6. The week's is 19:00 -> row 18, which is what the
    // pre-Req-13 component landed on and is therefore the wrong answer worth naming.
    expect(scroller().scrollTop).toBe(WED_ROW * ROW_PX);
    expect(scroller().scrollTop).not.toBe(WEEK_ROW * ROW_PX);
  });

  it('starts at the TOP on a day with no availability, instead of inheriting another day\'s row', () => {
    // Monday has no slots. The owner's ruling (2026-08-24) is that this does NOT fall back to the
    // week peak — the column simply does not scroll.
    const { rerender } = render(
      <EventScheduler
        initialDate={REQ13_MON}
        defaultView="day"
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );
    expect(scroller().scrollTop).toBe(0);

    // NON-VACUITY, in the SAME test: a populated day in the SAME render still lands non-zero, so
    // "everything is 0 because the stub is not wired" cannot masquerade as "correct".
    rerender(
      <EventScheduler
        initialDate={REQ13_WED}
        defaultView="day"
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );
    expect(scroller().scrollTop).toBeGreaterThan(0);
  });

  it('RE-DERIVES the landing when the displayed day changes', () => {
    const { rerender } = render(
      <EventScheduler
        initialDate={REQ13_WED}
        defaultView="day"
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );
    expect(scroller().scrollTop).toBe(WED_ROW * ROW_PX);

    rerender(
      <EventScheduler
        initialDate={REQ13_THU}
        defaultView="day"
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );
    // Thursday peaks at 16:00, not Wednesday's 13:00 — the landing MOVED with the day.
    expect(scroller().scrollTop).toBe(THU_ROW * ROW_PX);
    expect(scroller().scrollTop).not.toBe(WED_ROW * ROW_PX);
  });

  it('leaves WEEK view on the parent-supplied scrollToTime (Req 13 holds it unchanged)', () => {
    // This case does double duty: it is the week-view guarantee AND the proof that the stub and
    // the effect are wired at all, which is what gives case 2's zero its meaning.
    render(
      <EventScheduler
        initialDate={REQ13_WED}
        heatmapData={req13Heatmap}
        scrollToTime={REQ13_WEEK_SCROLL_TO_TIME}
      />
    );
    expect(columnHeaders()).toHaveLength(7);
    expect(scroller().scrollTop).toBe(WEEK_ROW * ROW_PX);
    expect(scroller().scrollTop).not.toBe(WED_ROW * ROW_PX);
  });
});

describe('EventScheduler — assistive-tech affordances on the grid (88.1-21, 88.1-CODE-REVIEW.md)', () => {
  const SELECTED = {
    start: new Date(2026, 6, 22, 19, 0, 0),
    end: new Date(2026, 6, 22, 19, 30, 0),
  };

  it('announces a committed selection with aria-selected on the gridcell', () => {
    render(<EventScheduler initialDate={WEEK_N} selectedSlot={SELECTED} />);

    const blocks = screen.getAllByTestId('scheduler-selected-block');
    expect(blocks.length).toBeGreaterThan(0);
    for (const block of blocks) {
      const cell = block.closest('[role="gridcell"]');
      expect(cell).not.toBeNull();
      expect(cell?.getAttribute('aria-selected')).toBe('true');
    }
  });

  it('says aria-selected="false" on the OTHER cells, not nothing', () => {
    // The negative is the load-bearing half. A grid where only the selected cell carries
    // aria-selected tells assistive tech the remaining cells are not selectable — the opposite
    // of true, and worse than omitting the attribute everywhere.
    render(<EventScheduler initialDate={WEEK_N} selectedSlot={SELECTED} />);

    const unselected = screen
      .getAllByRole('gridcell')
      .filter((c) => !c.querySelector('[data-testid="scheduler-selected-block"]'));
    expect(unselected.length).toBeGreaterThan(0);
    expect(unselected[0].getAttribute('aria-selected')).toBe('false');
  });

  it('gives gridcells the project focus-visible ring instead of the UA default outline', () => {
    render(<EventScheduler initialDate={WEEK_N} />);

    // The four tokens copied verbatim from AvailabilityGrid.js:628 — the closest shipped
    // precedent, itself a heatmap grid cell. `focus:outline-hidden` is DELIBERATE and allowed
    // (focusAndMotionTreatment.test.ts:20-24); do not "fix" it to outline-none.
    const cell = screen.getAllByRole('gridcell')[0];
    expect(cell.className).toContain('focus:outline-hidden');
    expect(cell.className).toContain('focus-visible:ring-2');
    expect(cell.className).toContain('focus-visible:ring-focus-ring');
    expect(cell.className).toContain('focus-visible:ring-offset-2');
  });
});

describe('EventScheduler — the per-slot conflict tooltip tells self from other (Req 3)', () => {
  // The conflict rides the SAME backwards-constructed wire slot as `heatmapFixture`, so the
  // annotated cell lands inside the visible 10:00-23:59 window on any runner timezone. A
  // hard-coded UTC hour renders off-grid for some offsets — documented at :117-124, not
  // hypothetical.
  const OTHER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const SELF_LINE = /You have a Google Calendar conflict at this time/;
  const OTHER_LINE = /Bea: said yes, calendar shows busy/;

  const withConflicts = (
    gcalConflicts: Array<{ date: string; hour: number; user_id: string; username: string }>
  ) => ({ ...heatmapFixture, gcalConflicts });

  const openTooltip = async () => {
    // HeatmapTooltip attaches useClick to the reference (HeatmapTooltip.js:223) as well as
    // useFocus (:227); click is the primary path.
    const cell = screen.getAllByRole('gridcell', { name: EXPECTED_CELL_LABEL })[0];
    expect(cell).toBeDefined();
    fireEvent.click(cell);
  };

  it('renders the SELF line, and not the other-member line, for my own conflict', async () => {
    render(
      <EventScheduler
        initialDate={WEEK_N}
        heatmapData={withConflicts([
          { ...WIRE_SLOT, user_id: SELF_UUID, username: 'Me' },
        ])}
      />
    );
    await openTooltip();

    expect(await screen.findByText(SELF_LINE)).toBeInTheDocument();
    expect(screen.queryByText(OTHER_LINE)).not.toBeInTheDocument();
  });

  it('renders the other-member line naming them, and not the SELF line, for someone else', async () => {
    render(
      <EventScheduler
        initialDate={WEEK_N}
        heatmapData={withConflicts([
          { ...WIRE_SLOT, user_id: OTHER_UUID, username: 'Bea' },
        ])}
      />
    );
    await openTooltip();

    expect(await screen.findByText(OTHER_LINE)).toBeInTheDocument();
    expect(screen.queryByText(SELF_LINE)).not.toBeInTheDocument();
  });
});
