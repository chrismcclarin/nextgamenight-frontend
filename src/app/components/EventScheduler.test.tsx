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
import { afterEach, describe, expect, it, vi } from 'vitest';
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
 */
type AxeViewport = { name: string; hoverNone: boolean; maxWidth: number };
const AXE_VIEWPORTS: AxeViewport[] = [{ name: 'desktop', hoverNone: false, maxWidth: 1280 }];

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
