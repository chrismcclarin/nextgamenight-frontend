// 88.3 code-adversarial-review run 4, M1 (2026-08-28): the COMPACT month tile —
// the variant the group page mounts and the surface the owner tests on a phone —
// was pinned only by Gate B's source-string scans. This is the behavioural pin:
// a regression that keeps the attribute strings but breaks the handler, drops the
// RSVP suffix from the name, or leaks the keypress into the day cell reds here.
import * as React from 'react';
import { render, screen, cleanup, act, within, fireEvent } from '@testing-library/react';
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
 * page-ground arm comes straight after the today arm, its full-variant past case nested inside it, 88.9 A4b, reordered by 88.9-28 C3). `getDaysInMonth` returns whole weeks (28, 35 or 42 cells, CS-05) including any adjacent-month days,
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
    // after this plan; since 88.9-28 C3 the adjacent arm comes straight after the today arm and nests the full-variant past case, so this half reds only if that nested past case is lost.
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
    // AMENDED Phase 88.9-28 (C3): a full-grid past this-month cell sits on bg-surface-tile-past
    // (owner pick C3), chosen OVER the page ground this line read before; the pointer half is unchanged.
    expect(cell.classList.contains('bg-surface-tile-past')).toBe(true);
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
    // AMENDED Phase 88.9-28 (C3): the past this-month ground is bg-surface-tile-past now, as in (b).
    expect(cell.classList.contains('bg-surface-tile-past')).toBe(true);
    expect(cell.classList.contains('cursor-pointer')).toBe(false);
  });
});

// 88.9-28 round-2 look pins: N1 (month nav), C3 (soft tiles), C8a (weekday 12/700), E1a (no
// visible compact count), F7a (light image arm) and D5a/O18a (guest edge). Same pinned clock as
// the A4b describe above: 1 September 2031, a Monday.
describe('CalendarMonthView — round-2 look (88.9-28)', () => {
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

  type GridOpts = {
    anchor?: Date;
    variant: 'compact' | 'full';
    events?: unknown[];
    viewerDbUserId?: string;
    onNavigateMonth?: (delta: number) => void;
    onGoToday?: () => void;
  };
  function renderGrid({ anchor = new Date(2031, 8, 1, 12, 0, 0, 0), variant, events = [], viewerDbUserId, onNavigateMonth = vi.fn(), onGoToday = vi.fn() }: GridOpts) {
    const days = getDaysInMonth(anchor);
    const out = render(
      <CalendarMonthView
        days={days}
        activeEvents={events}
        currentDate={anchor}
        variant={variant}
        onDayClick={vi.fn()}
        onEventClick={vi.fn()}
        onNavigateMonth={onNavigateMonth}
        onGoToday={onGoToday}
        monthNames={MONTHS}
        tzLegend={null}
        viewerDbUserId={viewerDbUserId}
      />,
    );
    const grids = out.container.querySelectorAll('.grid.grid-cols-7');
    return {
      days,
      weekdays: Array.from(grids[0].children) as HTMLElement[],
      cells: Array.from(grids[1].children) as HTMLElement[],
    };
  }
  const tokens = (el: Element) => el.className.split(/\s+/).filter(Boolean);

  it('N1 (88.9): icon-only month nav with the accessible names Previous month / Next month, one-line title, Today pill', () => {
    for (const variant of ['full', 'compact'] as const) {
      const onNavigateMonth = vi.fn();
      const onGoToday = vi.fn();
      renderGrid({ variant, onNavigateMonth, onGoToday });
      const prev = screen.getByRole('button', { name: 'Previous month' });
      const next = screen.getByRole('button', { name: 'Next month' });
      for (const [label, btn] of [['Previous month', prev], ['Next month', next]] as const) {
        expect((btn.textContent ?? '').trim(), `${variant}: ${label} carries visible text`).toBe('');
        for (const t of ['btn-icon-square', 'min-h-11', 'min-w-11']) {
          expect(tokens(btn), `${variant}: ${label} lacks ${t}`).toContain(t);
        }
      }
      fireEvent.click(prev);
      expect(onNavigateMonth).toHaveBeenLastCalledWith(-1);
      fireEvent.click(next);
      expect(onNavigateMonth).toHaveBeenLastCalledWith(1);
      const heading = screen.getByRole('heading', { level: 3, name: 'September 2031' });
      for (const t of ['whitespace-nowrap', 'truncate', 'text-ellipsis']) {
        expect(tokens(heading), `${variant}: the month title clips (${t})`).not.toContain(t);
      }
      expect(heading.className, `${variant}: the month title clips (line-clamp)`).not.toMatch(/line-clamp-/);
      fireEvent.click(screen.getByRole('button', { name: 'Today' }));
      expect(onGoToday).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('button', { name: 'Go to Today' }), `${variant}: the retired Go to Today name is still rendered`).toBeNull();
      cleanup();
    }
  });
  const cellOf = (days: { date: Date; isCurrentMonth: boolean }[], cells: HTMLElement[], month: number, date: number) => {
    const i = days.findIndex((c) => c.date.getMonth() === month && c.date.getDate() === date);
    expect(i).toBeGreaterThan(-1);
    return cells[i];
  };
  const groundsOf = (el: Element) => tokens(el).filter((t) => /^bg-surface-/.test(t));

  it('C3 (88.9): this-month tile / past / adjacent untiled', () => {
    // Full grid, September 2031, today the 15th: 10 Sept is past, 20 Sept is future, 31 Aug and
    // 2 Oct are the leading and trailing adjacent cells.
    vi.setSystemTime(new Date(2031, 8, 15, 12, 0, 0, 0));
    const { days, cells } = renderGrid({ variant: 'full' });
    for (const cell of cells) {
      expect(tokens(cell), 'every cell is radius 6px').toContain('rounded-md');
      expect(tokens(cell), 'no cell keeps the old small radius').not.toContain('rounded-sm');
      expect(tokens(cell), 'no cell keeps the old 1px line outline').not.toContain('border-line');
      expect(tokens(cell).filter((t) => t === 'border'), 'every cell carries exactly one 1px border width').toHaveLength(1);
      expect(groundsOf(cell), 'every cell carries exactly one ground').toHaveLength(1);
    }
    expect(groundsOf(cellOf(days, cells, 8, 20))).toEqual(['bg-surface-tile']);
    expect(tokens(cellOf(days, cells, 8, 20))).toContain('border-transparent');
    expect(groundsOf(cellOf(days, cells, 8, 10))).toEqual(['bg-surface-tile-past']);
    for (const [month, date] of [[7, 31], [9, 2]] as const) {
      const adjacent = cellOf(days, cells, month, date);
      expect(groundsOf(adjacent), `adjacent ${month + 1}/${date} stays untiled on the page ground`).toEqual(['bg-surface-page']);
    }
    const today = cellOf(days, cells, 8, 15);
    expect(groundsOf(today)).toEqual(['bg-surface-muted']);
    expect(tokens(today)).toContain('border-line-accent');
  });

  it('C8a (88.9): weekday row 12/700', () => {
    for (const variant of ['full', 'compact'] as const) {
      const { weekdays } = renderGrid({ variant });
      expect(weekdays).toHaveLength(7);
      for (const cell of weekdays) {
        expect(tokens(cell), `${variant}: weekday ${cell.textContent} is not 12px`).toContain('text-xs');
        expect(tokens(cell), `${variant}: weekday ${cell.textContent} is not 700`).toContain('font-bold');
        expect(tokens(cell), `${variant}: weekday ${cell.textContent} keeps the 14px size`).not.toContain('text-sm');
      }
      cleanup();
    }
  });

  const rsvpEvent = {
    id: 'evt-rsvp',
    start_date: '2031-09-20T19:00:00',
    Game: { name: 'Catan' },
    Group: { name: 'Tuesday Crew', background_color: '#722f37' },
    rsvp_summary: { yes: 3, maybe: 1, no: 2 },
  };

  it('E1a (88.9): compact tile carries no RSVP count', () => {
    renderGrid({ variant: 'compact', events: [rsvpEvent] });
    const tile = screen.getByRole('button', { name: "Catan - Tuesday Crew, 3 going, 1 maybe, 2 can't" });
    for (const chip of ['3Y', '1M', '2N']) {
      expect(within(tile).queryByText(chip), `the compact tile still renders the ${chip} count chip`).toBeNull();
    }
    expect((tile.textContent ?? '').trim()).toBe('Catan');
  });

  it("F7a (88.9): an image tile's light arm has no shadow and no stroke; its dark arm is unchanged", () => {
    const imageEvent = {
      ...rsvpEvent,
      id: 'evt-image',
      rsvp_summary: null,
      Group: { name: 'Photo Crew', background_color: '#722f37', background_image_url: 'https://i.imgur.com/x.png' },
    };
    renderGrid({ variant: 'full', events: [imageEvent] });
    const tile = screen.getByRole('button', { name: 'Catan - Photo Crew' });
    expect(tile.style.getPropertyValue('--t-shadow-l'), 'light arm shadow').toBe('none');
    expect(tile.style.getPropertyValue('--t-stroke-l'), 'light arm stroke').toBe('none');
    expect(tile.style.getPropertyValue('--t-shadow'), 'dark arm shadow').toBe('2px 2px 4px rgba(0, 0, 0, 0.9), -1px -1px 2px rgba(0, 0, 0, 0.9)');
    expect(tile.style.getPropertyValue('--t-stroke'), 'dark arm stroke').toBe('0.5px rgba(0, 0, 0, 0.9)');
  });

  it("D5a/O18a (88.9): a guest event's full tile carries the dashed amber edge, a member event's does not", () => {
    // A synthetic viewer id (T-88.9-76): compared only, never rendered.
    const VIEWER = '00000000-0000-4000-8000-000000000028';
    const guestEvent = {
      id: 'evt-guest',
      start_date: '2031-09-20T19:00:00',
      Game: { name: 'Azul' },
      Group: { name: 'Guest Crew', background_color: null },
      rsvp_summary: null,
      EventParticipations: [{ user_id: VIEWER, is_guest: true }],
    };
    const memberEvent = {
      id: 'evt-member',
      start_date: '2031-09-22T19:00:00',
      Game: { name: 'Wingspan' },
      Group: { name: 'Home Crew', background_color: null },
      rsvp_summary: null,
      EventParticipations: [{ user_id: VIEWER, is_guest: false }],
    };
    renderGrid({ variant: 'full', events: [guestEvent, memberEvent], viewerDbUserId: VIEWER });
    const guest = screen.getByRole('button', { name: 'Azul - Guest Crew, Guest' });
    for (const t of ['border-dashed', 'border-amber-700', 'dark:border-amber-500/70']) {
      expect(tokens(guest), `the guest tile lacks ${t}`).toContain(t);
    }
    const member = screen.getByRole('button', { name: 'Wingspan - Home Crew' });
    expect(tokens(member), 'a member tile is dashed').not.toContain('border-dashed');
    cleanup();

    // The compact tile gets neither the edge nor the word: its cue is the sheet row (88.9-39).
    renderGrid({ variant: 'compact', events: [guestEvent], viewerDbUserId: VIEWER });
    const compactTile = screen.getByRole('button', { name: 'Azul - Guest Crew' });
    expect(tokens(compactTile), 'the compact guest tile is dashed').not.toContain('border-dashed');
    cleanup();

    // No viewer id: nothing is dashed and nothing says Guest.
    renderGrid({ variant: 'full', events: [guestEvent, memberEvent] });
    for (const name of ['Azul - Guest Crew', 'Wingspan - Home Crew']) {
      expect(tokens(screen.getByRole('button', { name })), `${name} is dashed with no viewer id`).not.toContain('border-dashed');
    }
  });
});
