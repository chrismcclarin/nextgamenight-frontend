// 88.3 code-adversarial-review run 4, M1 (2026-08-28): the COMPACT month tile —
// the variant the group page mounts and the surface the owner tests on a phone —
// was pinned only by Gate B's source-string scans. This is the behavioural pin:
// a regression that keeps the attribute strings but breaks the handler, drops the
// RSVP suffix from the name, or leaks the keypress into the day cell reds here.
import * as React from 'react';
import { render, screen, cleanup, act, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CalendarMonthView from './CalendarMonthView';
import { getDaysInMonth } from '../../lib/calendarUtils';

const day = new Date();
day.setDate(15);
day.setHours(12, 0, 0, 0);
const future = new Date(day.getTime() + 365 * 24 * 60 * 60 * 1000);
const y = future.getFullYear(), m = String(future.getMonth() + 1).padStart(2, '0'), d = String(future.getDate()).padStart(2, '0');

const tintedEvent = {
  id: 'evt-tinted',
  start_date: `${y}-${m}-${d}T19:00:00`,
  Game: { name: 'Catan' },
  Group: { name: 'Tuesday Crew', background_color: '#722f37' },
  rsvp_summary: { yes: 3, maybe: 1, no: 2 },
};
const plainEvent = {
  id: 'evt-plain',
  start_date: `${y}-${m}-${d}T20:00:00`,
  Game: { name: 'Wingspan' },
  Group: { name: 'Plain Group', background_color: null },
  rsvp_summary: null,
};

function renderCompact() {
  const onEventClick = vi.fn();
  const onDayClick = vi.fn();
  render(
    <CalendarMonthView
      days={[{ date: future, isCurrentMonth: true }]}
      activeEvents={[tintedEvent, plainEvent]}
      currentDate={future}
      variant="compact"
      onDayClick={onDayClick}
      onEventClick={onEventClick}
      onNavigateMonth={vi.fn()}
      onGoToday={vi.fn()}
      monthNames={['January','February','March','April','May','June','July','August','September','October','November','December']}
      tzLegend={null}
    />,
  );
  return { onEventClick, onDayClick };
}

describe('CalendarMonthView compact tile — keyboard + accessible name (88.3-cr4 M1)', () => {
  afterEach(cleanup);

  it('names the tinted tile with game, group AND the RSVP counts', () => {
    renderCompact();
    expect(screen.getByRole('button', { name: /Catan - Tuesday Crew, 3 going, 1 maybe, 2 can't/ })).toBeTruthy();
  });

  it('Enter on the tile calls onEventClick once with the event and does NOT open the day cell', async () => {
    const { onEventClick, onDayClick } = renderCompact();
    const user = userEvent.setup();
    screen.getByRole('button', { name: /Catan - Tuesday Crew/ }).focus();
    await act(async () => { await user.keyboard('{Enter}'); });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).toHaveBeenCalledWith(tintedEvent);
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('Space on the tile likewise fires the event, not the day cell', async () => {
    const { onEventClick, onDayClick } = renderCompact();
    const user = userEvent.setup();
    screen.getByRole('button', { name: /Catan - Tuesday Crew/ }).focus();
    await act(async () => { await user.keyboard(' '); });
    expect(onEventClick).toHaveBeenCalledTimes(1);
    expect(onDayClick).not.toHaveBeenCalled();
  });

  it('only the tinted tile carries the group ground custom property', () => {
    renderCompact();
    const tinted = screen.getByRole('button', { name: /Catan - Tuesday Crew/ }) as HTMLElement;
    const plain = screen.getByRole('button', { name: /Wingspan - Plain Group/ }) as HTMLElement;
    expect(tinted.style.getPropertyValue('--group-ground')).toBe('#722f37');
    expect(plain.style.getPropertyValue('--group-ground')).toBe('');
  });
});

/*
 * W41 (plan 88.6-40) — "TODAY" IS EXPOSED SEMANTICALLY, NOT BY TINT ALONE.
 *
 * THE INVARIANT IS PER RENDERED **GRID**, NOT PER MONTH, and neither half is gated on
 * `isCurrentMonth`. `isCurrentDay` is computed from the date ALONE, and the cell's ground
 * ternary awards the today treatment BEFORE the adjacent-month branch is reached (the adjacent
 * page-ground arm comes after the today and full-variant past arms, 88.9 A4b). `getDaysInMonth` returns whole weeks (28, 35 or 42 cells, CS-05) including any adjacent-month days,
 * so a grid whose OVERFLOW contains today already renders that overflow cell tinted as today.
 * Gating either half on `isCurrentMonth` would desync the pair — and nothing in this suite
 * asserted the pair before this plan.
 *
 * ASSERTED BY **CONTAINMENT**, not by co-occurrence: the tinted CELL must CONTAIN the
 * `aria-current` element. That is the shipped house idiom (`EventScheduler.test.tsx` uses it on
 * the sibling `SchedulerWeekStrip`, where the nesting direction is inverted — attribute on the
 * named control, tint on an inner span — because there the named control is the OUTER element).
 *
 * A TODAY FIXTURE HAS TO BE AUTHORED HERE either way: the shipped month-view fixtures above are
 * built a year ahead and contain no today reference at all. The clock is pinned with
 * `vi.setSystemTime` so the overflow case is DETERMINISTIC rather than true only in the first
 * week of a month.
 */
describe('CalendarMonthView — aria-current="date" is per rendered GRID (88.6-40, W41)', () => {
  // 1 September 2031. August 2031 starts on a Friday, so `getDaysInMonth(August)`'s 42-cell
  // window (a six-row month under CS-05) runs Sun 27 Jul -> Sat 6 Sep and contains 1 September in its OVERFLOW. That is the
  // case which distinguishes a per-GRID implementation from an `isCurrentMonth`-gated one.
  const PINNED_TODAY = new Date(2031, 8, 1, 12, 0, 0, 0);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function renderGrid(monthAnchor: Date) {
    return render(
      <CalendarMonthView
        days={getDaysInMonth(monthAnchor)}
        activeEvents={[]}
        currentDate={monthAnchor}
        variant="compact"
        onDayClick={vi.fn()}
        onEventClick={vi.fn()}
        onNavigateMonth={vi.fn()}
        onGoToday={vi.fn()}
        monthNames={['January','February','March','April','May','June','July','August','September','October','November','December']}
        tzLegend={null}
      />,
    );
  }

  /** The today TINT lives on the CELL: `bg-surface-muted border-line-accent` (P6, unchanged). */
  const tintedCells = (c: HTMLElement) => c.querySelectorAll('.border-line-accent.bg-surface-muted');
  const currentEls = (c: HTMLElement) => c.querySelectorAll('[aria-current="date"]');

  it('W41-1. the CURRENT month: exactly one element carries it, and the tinted cell CONTAINS it', () => {
    const { container } = renderGrid(PINNED_TODAY);
    const current = currentEls(container);
    expect(current).toHaveLength(1);
    const tinted = tintedCells(container);
    expect(tinted, 'the today TINT must still be on the CELL — P6 is unchanged by this plan').toHaveLength(1);
    expect(
      tinted[0].contains(current[0]),
      'the tinted cell must CONTAIN the aria-current element — co-occurrence is not the claim',
    ).toBe(true);
    // …and it is the DAY NUMBER, not the wrapper: the wrapper is role-less and unnamed, so ARIA
    // would never convey the state when the inner target takes focus.
    expect(current[0].textContent).toBe(String(PINNED_TODAY.getDate()));
    expect(tinted[0].getAttribute('aria-current')).toBeNull();
  });

  it('W41-2. NAVIGATE BACK ONE MONTH: today falls in the OVERFLOW and both halves follow it there', () => {
    // The case that fails loudly if an `isCurrentMonth` gate ever ships on either half.
    const { container } = renderGrid(new Date(2031, 7, 1, 12, 0, 0, 0)); // August 2031
    const current = currentEls(container);
    expect(current, 'today is in this grid\'s trailing overflow — it must still be exposed').toHaveLength(1);
    const tinted = tintedCells(container);
    expect(tinted).toHaveLength(1);
    expect(tinted[0].contains(current[0])).toBe(true);
    // Proof the subject really is an ADJACENT-month cell, from the date (88.9-07: the old
    // opacity-60 proof is gone): the tinted cell comes after the cell showing 31 August.
    const cells = Array.from(tinted[0].parentElement!.children);
    const lastOfMonth = getDaysInMonth(new Date(2031, 7, 1, 12, 0, 0, 0))
      .findIndex((c) => c.isCurrentMonth && c.date.getDate() === 31);
    expect(lastOfMonth).toBeGreaterThan(-1);
    expect(cells.indexOf(tinted[0])).toBeGreaterThan(lastOfMonth);
  });

  it('W41-3. a grid whose FULL rendered window contains no today carries the attribute ZERO times', () => {
    // Two months away, deliberately — "a month with no today" is satisfiable by an overflow day
    // and would make this arm vacuous.
    const { container } = renderGrid(new Date(2031, 10, 1, 12, 0, 0, 0)); // November 2031
    expect(currentEls(container)).toHaveLength(0);
    expect(tintedCells(container)).toHaveLength(0);
  });
});

// A4b + O4b (88.9-07, owner picks): an adjacent-month cell sits on the page ground with its day
// number muted, and NOTHING in the cell is dimmed — the old whole-cell opacity-60 took the day
// number to 2.69 / 3.13 and the untinted tile text to 2.39 / 2.88 (under 4.5).
describe('CalendarMonthView — adjacent-month cells (88.9-07, A4b + O4b)', () => {
  // Same pinned clock as the W41 describe: 1 September 2031, a Monday.
  const PINNED_TODAY = new Date(2031, 8, 1, 12, 0, 0, 0);
  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(PINNED_TODAY);
  });
  afterEach(() => {
    vi.useRealTimers();
    cleanup();
  });

  function renderAt(anchor: Date, variant: 'compact' | 'full', events: unknown[]) {
    const days = getDaysInMonth(anchor);
    const out = render(
      <CalendarMonthView
        days={days}
        activeEvents={events}
        currentDate={anchor}
        variant={variant}
        onDayClick={vi.fn()}
        onEventClick={vi.fn()}
        onNavigateMonth={vi.fn()}
        onGoToday={vi.fn()}
        monthNames={MONTHS}
        tzLegend={null}
      />,
    );
    // The day cells are the children of the second seven-column grid (the first holds the
    // weekday names).
    const grid = out.container.querySelectorAll('.grid.grid-cols-7')[1];
    return { days, cells: Array.from(grid.children) as HTMLElement[] };
  }

  // Every element from el up to and including the cell: none may carry a dimming opacity.
  function dimmedAncestors(el: Element, cell: Element) {
    const hits: string[] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      for (const t of Array.from(n.classList)) if (/^opacity-\d+$/.test(t) && t !== 'opacity-100') hits.push(t);
      if (n === cell) break;
    }
    return hits;
  }

  const eventOn = (id: string, ymd: string, name: string) => ({
    id,
    start_date: `${ymd}T19:00:00`,
    Game: { name },
    Group: { name: 'Plain Group', background_color: null },
    rsvp_summary: null,
  });

  it('A4b (88.9): an adjacent-month cell is undimmed on the page ground and nothing in it carries the mute', () => {
    // Compact grid, August 2031: 3 September sits in the trailing overflow and holds an event.
    const { days, cells } = renderAt(new Date(2031, 7, 1, 12, 0, 0, 0), 'compact', [eventOn('evt-adj', '2031-09-03', 'Azul')]);
    expect(cells, 'August 2031 is a six-row month under CS-05 (starts on a Friday, 31 days)').toHaveLength(42);
    const i = days.findIndex((c) => !c.isCurrentMonth && c.date.getMonth() === 8 && c.date.getDate() === 3);
    expect(i).toBeGreaterThan(-1);
    const cell = cells[i];
    expect(cell.classList.contains('opacity-60')).toBe(false);
    expect(cell.classList.contains('bg-surface-page')).toBe(true);
    const container = cell.querySelector('.space-y-0\\.5');
    expect(container, 'the overflow cell renders its events container').not.toBeNull();
    expect(container!.classList.contains('opacity-60')).toBe(false);
    const dayNumber = Array.from(cell.querySelectorAll('div')).find((n) => n.textContent === '3' && n.children.length === 0)!;
    expect(dayNumber).toBeDefined();
    expect(dimmedAncestors(dayNumber, cell)).toEqual([]);
    const tileText = within(cell).getByText('Azul');
    expect(dimmedAncestors(tileText, cell)).toEqual([]);
  });

  it('A4b (88.9): a clickable PAST adjacent cell on the full grid keeps the past treatment — page ground, no hover ground', () => {
    // Full grid, September 2031: 31 August is the leading overflow day, already past, and holds an
    // event (so it is cellClickable). The no-hover half is the ARM-ORDER guard: green before and
    // after this plan, red only if the adjacent arm is placed ahead of the full-variant past arm.
    const { days, cells } = renderAt(new Date(2031, 8, 1, 12, 0, 0, 0), 'full', [eventOn('evt-past', '2031-08-31', 'Azul')]);
    const i = days.findIndex((c) => !c.isCurrentMonth && c.date.getMonth() === 7 && c.date.getDate() === 31);
    expect(i).toBeGreaterThan(-1);
    const cell = cells[i];
    expect(within(cell).getByText('Azul')).toBeTruthy();
    expect(cell.classList.contains('opacity-60')).toBe(false);
    expect(cell.classList.contains('bg-surface-page')).toBe(true);
    expect(cell.classList.contains('hover:bg-surface-hover')).toBe(false);
  });

  // #204 (register, 88.9-07): the today arm and the full-variant past arm precede the clickable
  // arm, so a clickable today or past cell never got the pointer. These four share this
  // describe's pinned clock and renderAt; (b) and (d) move the clock to mid-month so a
  // current-month day can be past. (a) and (b) are red before the pointer interpolation,
  // (c) and (d) green throughout (cellClickable is false there, so no pointer either way).
  const cellOn = (days: { date: Date; isCurrentMonth: boolean }[], cells: HTMLElement[], month: number, date: number) => {
    const i = days.findIndex((c) => c.isCurrentMonth && c.date.getMonth() === month && c.date.getDate() === date);
    expect(i).toBeGreaterThan(-1);
    return cells[i];
  };

  it('#204 (88.9-07) (a): the compact today cell holding one event carries cursor-pointer', () => {
    const { days, cells } = renderAt(new Date(2031, 8, 1, 12, 0, 0, 0), 'compact', [eventOn('evt-today', '2031-09-01', 'Azul')]);
    const cell = cellOn(days, cells, 8, 1);
    expect(within(cell).getByText('Azul')).toBeTruthy();
    expect(cell.classList.contains('bg-surface-muted')).toBe(true);
    expect(cell.classList.contains('cursor-pointer')).toBe(true);
  });

  it('#204 (88.9-07) (b): a full-variant past current-month cell holding an event carries cursor-pointer', () => {
    vi.setSystemTime(new Date(2031, 8, 15, 12, 0, 0, 0));
    const { days, cells } = renderAt(new Date(2031, 8, 1, 12, 0, 0, 0), 'full', [eventOn('evt-past-cm', '2031-09-10', 'Azul')]);
    const cell = cellOn(days, cells, 8, 10);
    expect(within(cell).getByText('Azul')).toBeTruthy();
    expect(cell.classList.contains('bg-surface-page')).toBe(true);
    expect(cell.classList.contains('cursor-pointer')).toBe(true);
  });

  it('#204 (88.9-07) (c): the today cell with no event and no showEmptyDayHint does not carry cursor-pointer', () => {
    const { days, cells } = renderAt(new Date(2031, 8, 1, 12, 0, 0, 0), 'compact', []);
    const cell = cellOn(days, cells, 8, 1);
    expect(cell.classList.contains('bg-surface-muted')).toBe(true);
    expect(cell.classList.contains('cursor-pointer')).toBe(false);
  });

  it('#204 (88.9-07) (d): a full-variant past cell with no event does not carry cursor-pointer', () => {
    vi.setSystemTime(new Date(2031, 8, 15, 12, 0, 0, 0));
    const { days, cells } = renderAt(new Date(2031, 8, 1, 12, 0, 0, 0), 'full', []);
    const cell = cellOn(days, cells, 8, 10);
    expect(cell.classList.contains('bg-surface-page')).toBe(true);
    expect(cell.classList.contains('cursor-pointer')).toBe(false);
  });
});
