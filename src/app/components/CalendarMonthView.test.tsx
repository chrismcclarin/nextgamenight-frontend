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
import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { blend, contrastRatio } from '../../lib/wcag';
import { GROUP_COLOUR_PRESETS } from '../../lib/groupColourPresets';
import * as guestEdges from './GuestPill';

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
    viewSwitch?: React.ReactNode;
    tzLegend?: string | null;
  };
  function renderGrid({ anchor = new Date(2031, 8, 1, 12, 0, 0, 0), variant, events = [], viewerDbUserId, onNavigateMonth = vi.fn(), onGoToday = vi.fn(), viewSwitch, tzLegend = null }: GridOpts) {
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
        tzLegend={tzLegend}
        viewerDbUserId={viewerDbUserId}
        viewSwitch={viewSwitch}
      />,
    );
    const grids = out.container.querySelectorAll('.grid.grid-cols-7');
    return {
      container: out.container,
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
  it('N1 (88.9): the viewSwitch slot renders in the nav row beside the Today pill', () => {
    // 88.9-39: EventCalendar passes the Month | List switch in; the nav row seats it next to Today.
    for (const variant of ['full', 'compact'] as const) {
      renderGrid({ variant, viewSwitch: <span data-testid="slot" /> });
      const slot = screen.getByTestId('slot');
      const today = screen.getByRole('button', { name: 'Today' });
      expect(slot.parentElement, `${variant}: the slot and the Today pill share one parent`).toBe(today.parentElement);
      cleanup();
    }
    // No slot passed: nothing extra renders beside Today.
    renderGrid({ variant: 'full' });
    expect(screen.queryByTestId('slot')).toBeNull();
    expect(screen.getByRole('button', { name: 'Today' })).toBeTruthy();
  });
  // 88.9-62 (owner pick C at N13, 2026-11-12): the arrows sit on the month title's line. jsdom lays
  // nothing out, so this pins the STRUCTURE the layout comes from; the boxes are read in a real
  // engine by e2e/month-nav-row.spec.ts.
  it("X22 (88.9): the chevrons share the title's row; the caption, then the Today pill with the switch, sit below it; Tab order is Previous month, Next month, Today, the switch", () => {
    for (const variant of ['full', 'compact'] as const) {
      const { container } = renderGrid({ variant, tzLegend: 'PST', viewSwitch: <button type="button">slot</button> });
      const prev = screen.getByRole('button', { name: 'Previous month' });
      const next = screen.getByRole('button', { name: 'Next month' });
      const heading = screen.getByRole('heading', { level: 3, name: 'September 2031' });
      const today = screen.getByRole('button', { name: 'Today' });
      const slot = screen.getByRole('button', { name: 'slot' });
      const caption = screen.getByText('Times shown in PST');
      const titleRow = heading.parentElement as HTMLElement;
      // One row holds the chevron, the title and the chevron, in that order (DOM order is the
      // visual order of the wide arm).
      expect(Array.from(titleRow.children), `${variant}: the title row is not chevron, title, chevron`).toEqual([prev, heading, next]);
      expect(titleRow.contains(today), `${variant}: the title row holds the Today pill`).toBe(false);
      expect(titleRow.contains(caption), `${variant}: the title row holds the caption`).toBe(false);
      const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      expect(follows(titleRow, caption), `${variant}: the caption does not follow the title row`).toBe(true);
      expect(follows(caption, today), `${variant}: the Today pill does not follow the caption`).toBe(true);
      expect(slot.parentElement, `${variant}: the switch and the Today pill do not share one row`).toBe(today.parentElement);
      // Tab order is document order here (no positive tabindex anywhere in the nav block).
      expect(Array.from(container.querySelectorAll('button')).slice(0, 4), `${variant}: the first four buttons are not Previous month, Next month, Today, the switch`).toEqual([prev, next, today, slot]);
      cleanup();
    }
  });
  it('X28 (88.9): the nav block is a size container and under 14rem the title takes its own line below the arrows', () => {
    for (const variant of ['full', 'compact'] as const) {
      renderGrid({ variant });
      const heading = screen.getByRole('heading', { level: 3, name: 'September 2031' });
      const navBlock = (heading.parentElement as HTMLElement).parentElement as HTMLElement;
      expect(tokens(navBlock), `${variant}: the title row's parent is not a size container`).toContain('@container');
      for (const t of ['min-w-0', 'flex-1', 'text-center', '@max-[14rem]:order-last', '@max-[14rem]:basis-full']) {
        expect(tokens(heading), `${variant}: the month title lacks ${t}`).toContain(t);
      }
      for (const t of ['whitespace-nowrap', 'truncate', 'text-ellipsis']) {
        expect(tokens(heading), `${variant}: the month title clips (${t})`).not.toContain(t);
      }
      expect(heading.className, `${variant}: the month title clips (line-clamp)`).not.toMatch(/line-clamp-/);
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

  // 88.9-62 (X28, WCAG 1.4.4, and owner ruling M29 of 2026-11-14): Wed needs 1.70rem and a column
  // at 200% text on a 375 phone is under 1rem, so each label shows one letter there; and each cell
  // speaks its full day name from the cell itself (the labelled focusable leaf the availability
  // chart's header uses), never a spelled letter.
  it('X28 (88.9): each weekday label shows its three-letter name or, under 14rem, its first letter, and speaks its full day name from the cell', () => {
    const FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    for (const variant of ['full', 'compact'] as const) {
      const { weekdays } = renderGrid({ variant });
      expect(weekdays).toHaveLength(7);
      expect(tokens(weekdays[0].parentElement as HTMLElement), `${variant}: the weekday row is not a size container`).toContain('@container');
      weekdays.forEach((cell, i) => {
        const day = FULL[i];
        expect(tokens(cell), `${variant}: ${day} is not 12px`).toContain('text-xs');
        expect(tokens(cell), `${variant}: ${day} is not 700`).toContain('font-bold');
        // AMENDED 88.9-52 (A-11): the cell is an img, so its name is allowed (ARIA 1.2 prohibits naming a generic) and desktop screen readers speak it.
        expect(cell.getAttribute('role'), `${variant}: the ${day} cell is not a labelled img`).toBe('img');
        expect(cell.getAttribute('tabindex'), `${variant}: the ${day} cell is not a focusable leaf outside the Tab order`).toBe('-1');
        expect(cell.getAttribute('aria-label'), `${variant}: the ${day} cell does not speak its full day name`).toBe(day);
        const parts = Array.from(cell.children);
        expect(parts, `${variant}: the ${day} cell does not hold exactly two elements`).toHaveLength(2);
        const [short, letter] = parts;
        expect(short.tagName, `${variant}: ${day}'s three-letter form is not a span`).toBe('SPAN');
        expect(short.textContent, `${variant}: ${day}'s three-letter form`).toBe(day.slice(0, 3));
        expect(tokens(short), `${variant}: ${day}'s three-letter form stays under 14rem`).toContain('@max-[14rem]:hidden');
        expect(letter.tagName, `${variant}: ${day}'s one-letter form is not a span`).toBe('SPAN');
        expect(letter.textContent, `${variant}: ${day}'s one-letter form`).toBe(day[0]);
        expect(tokens(letter), `${variant}: ${day}'s one-letter form shows at rest`).toContain('hidden');
        expect(tokens(letter), `${variant}: ${day}'s one-letter form never shows`).toContain('@max-[14rem]:inline');
        for (const part of parts) {
          expect(part.getAttribute('aria-hidden'), `${variant}: a visible form of ${day} is not hidden from the accessibility tree`).toBe('true');
        }
      });
      cleanup();
    }
  });

  // 88.9-52 (A-11): a desktop screen-reader user reading the grid hears which weekday a date falls
  // on: the weekday headers are labelled imgs (above) and the day target's name starts with the weekday.
  it('A-11 (88.9-52): the day target names its weekday first, on a multi-game day and on an empty day with the hint', () => {
    const two = [
      { id: 'a11-1', start_date: '2031-09-19T18:00:00', Game: { name: 'Azul' }, Group: { name: 'Crew', background_color: null }, rsvp_summary: null },
      { id: 'a11-2', start_date: '2031-09-19T20:00:00', Game: { name: 'Catan' }, Group: { name: 'Crew', background_color: null }, rsvp_summary: null },
    ];
    for (const variant of ['full', 'compact'] as const) {
      const out = render(
        <CalendarMonthView
          days={getDaysInMonth(new Date(2031, 8, 1, 12))}
          activeEvents={two}
          currentDate={new Date(2031, 8, 1, 12)}
          variant={variant}
          onDayClick={vi.fn()}
          onEventClick={vi.fn()}
          onNavigateMonth={vi.fn()}
          onGoToday={vi.fn()}
          showEmptyDayHint
          monthNames={MONTHS}
          tzLegend={null}
        />,
      );
      expect(screen.getByRole('button', { name: 'Friday, September 19, 2 games. Open this day.' }), `${variant}: the two-game day`).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Saturday, September 20. Add an event on this day.' }), `${variant}: an empty day`).toBeTruthy();
      expect(out.container.querySelectorAll('[role="button"][aria-label$="this day."]:not([aria-label*="day, "])'), `${variant}: a day target without its weekday`).toHaveLength(0);
      cleanup();
    }
  });

  // 88.9-52 (Q62, owner ruling A, 2026-11-16): the compact grid prints the count alone, on one
  // line, and speaks the count in words from a labelled leaf; the full grid keeps the word and
  // drops it only when the day grid is narrow (W18).
  const crowd = (n: number, onDay = 20) =>
    Array.from({ length: n }, (_, i) => ({
      id: `evt-crowd-${onDay}-${i}`,
      start_date: `2031-09-${String(onDay).padStart(2, '0')}T${String(10 + (i % 10)).padStart(2, '0')}:00:00`,
      Game: { name: `Game ${i}` },
      Group: { name: 'Crowd', background_color: null },
      rsvp_summary: null,
    }));

  it('Q62 (88.9-52): the compact grid shows +N on one line and speaks N more event(s) from a labelled leaf', () => {
    const { cells } = renderGrid({ variant: 'compact', events: [...crowd(3, 20), ...crowd(5, 22)] });
    expect(tokens(cells[0].parentElement as HTMLElement), 'the day grid is not a size container').toContain('@container');
    const one = screen.getByRole('img', { name: '1 more event' });
    const three = screen.getByRole('img', { name: '3 more events' });
    expect((cells[0].parentElement as HTMLElement).querySelectorAll('[role="img"]'), 'a day with one or two games prints a more label').toHaveLength(2);
    for (const [label, text] of [[one, '+1'], [three, '+3']] as const) {
      expect(label.textContent, 'the compact label still prints the word').toBe(text);
      expect(label.getAttribute('tabindex'), 'the label is not a focusable leaf outside the Tab order').toBe('-1');
      expect(label.children, 'the label holds more than its one hidden text span').toHaveLength(1);
      expect(label.children[0].getAttribute('aria-hidden'), 'the printed count is not hidden from the accessibility tree').toBe('true');
      // S-B2 (88.9-52): relative z-10 lifts the label above the NEXT cell's opaque ground, which
      // otherwise paints over the end of a two-digit count at 200% text. jsdom has no paint order:
      // this pins the classes only.
      for (const t of ['text-xs', 'text-content-secondary', 'pointer-events-none', 'select-none', 'whitespace-nowrap', '@max-[14rem]:-mx-1', 'relative', 'z-10']) {
        expect(tokens(label), `the compact label lacks ${t}`).toContain(t);
      }
    }
  });

  it('Q62 / W18 (88.9-52): the full grid keeps +N more, on one line, and hides the word when the day grid is under 32rem', () => {
    renderGrid({ variant: 'full', events: crowd(3, 20) });
    const label = screen.getByRole('img', { name: '1 more event' });
    expect(label.textContent).toBe('+1 more');
    expect(tokens(label), 'the full label can wrap').toContain('whitespace-nowrap');
    expect(tokens(label), 'the full label takes the compact pull').not.toContain('@max-[14rem]:-mx-1');
    expect(tokens(label), 'the full label is lifted; it has no pull and never leaves its cell').not.toContain('z-10');
    const word = within(label).getByText('more', { exact: false, selector: 'span span' });
    expect(word.textContent).toBe(' more');
    expect(tokens(word), 'the word does not give way in a narrow grid').toContain('@max-[32rem]:hidden');
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

  // AMENDED Phase 88.9-60 (X23a, owner pick page 10a, 2026-11-14): this test pinned F7a (light arm
  // with no shadow and no stroke, dark arm at the half-pixel stroke, both under a 70% white wash).
  // A picture tile now takes the one photo text set in BOTH arms, past or not, with no wash.
  it('X23a (88.9): an image tile takes the photo text set in both arms', () => {
    const imageGroup = { name: 'Photo Crew', background_color: '#722f37', background_image_url: 'https://i.imgur.com/x.png' };
    const cases = [
      { when: 'upcoming', anchor: new Date(2031, 8, 1, 12, 0, 0, 0), start: '2031-09-20T19:00:00' },
      { when: 'past', anchor: new Date(2020, 8, 1, 12, 0, 0, 0), start: '2020-09-20T19:00:00' },
    ];
    for (const { when, anchor, start } of cases) {
      renderGrid({
        anchor,
        variant: 'full',
        events: [{ ...rsvpEvent, id: `evt-image-${when}`, start_date: start, rsvp_summary: null, Group: imageGroup }],
      });
      const tile = screen.getByRole('button', { name: 'Catan - Photo Crew' });
      expect(tile.style.backgroundImage, `${when}: the fixture tile paints no picture, so this pins nothing`).toContain('i.imgur.com/x.png');
      for (const arm of ['', '-l']) {
        const side = arm ? 'light' : 'dark';
        expect(tile.style.getPropertyValue(`--t-color${arm}`), `${when} ${side} arm colour`).toBe('#ffffff');
        expect(tile.style.getPropertyValue(`--t-stroke${arm}`), `${when} ${side} arm stroke`).toBe('2px #000000');
        expect(tile.style.getPropertyValue(`--t-paint${arm}`), `${when} ${side} arm paint order`).toBe('stroke fill');
        expect(tile.style.getPropertyValue(`--t-track${arm}`), `${when} ${side} arm letter-spacing`).toBe('0.03em');
        expect(tile.style.getPropertyValue(`--t-shadow${arm}`), `${when} ${side} arm shadow`).toBe('none');
      }
      expect(tile.innerHTML, `${when}: the 70% white wash is still mounted over the tile photo`).not.toContain('rgba(255, 255, 255, 0.7)');
      const name = within(tile).getByText('Catan');
      for (const util of [
        '[-webkit-text-stroke:var(--t-stroke-l)]',
        'dark:[-webkit-text-stroke:var(--t-stroke)]',
        '[paint-order:var(--t-paint-l,normal)]',
        'dark:[paint-order:var(--t-paint,normal)]',
        '[letter-spacing:var(--t-track-l,normal)]',
        'dark:[letter-spacing:var(--t-track,normal)]',
      ]) {
        expect(tokens(name), `${when}: the game name does not read ${util}`).toContain(util);
      }
      cleanup();
    }
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
    // AMENDED 88.9-52 (W14 follow-up 2): the full tile's dark edge is amber-500 at full strength,
    // not 70% (the full-tile ratio test below says why).
    for (const t of ['border', 'border-dashed', 'border-amber-700', 'dark:border-amber-500']) {
      expect(tokens(guest), `the guest tile lacks ${t}`).toContain(t);
    }
    expect(tokens(guest), 'the full guest tile still carries the 70% dark edge').not.toContain('dark:border-amber-500/70');
    const member = screen.getByRole('button', { name: 'Wingspan - Home Crew' });
    expect(tokens(member), 'a member tile is dashed').not.toContain('border-dashed');
    cleanup();

    // AMENDED 88.9-52 (W14, owner 2026-11-16: try the dashed guest edge on the compact tile): the
    // compact guest tile takes the same edge and the same word; a compact member tile has no border
    // at all, so its 28px text box at 375 is unchanged. Before W14 the compact tile had neither.
    renderGrid({ variant: 'compact', events: [guestEvent, memberEvent], viewerDbUserId: VIEWER });
    const compactGuest = screen.getByRole('button', { name: 'Azul - Guest Crew, Guest' });
    // AMENDED 88.9-52 (W14 follow-up): the compact tile's dark edge is amber-500 at full strength,
    // not the full tile's 70% (the ratio test below says why).
    for (const t of ['border', 'border-dashed', 'border-amber-700', 'dark:border-amber-500']) {
      expect(tokens(compactGuest), `the compact guest tile lacks ${t}`).toContain(t);
    }
    expect(tokens(compactGuest), 'the compact guest tile still carries the 70% dark edge').not.toContain('dark:border-amber-500/70');
    const compactMember = screen.getByRole('button', { name: 'Wingspan - Home Crew' });
    expect(tokens(compactMember).filter((t) => /(^|:)border(-|$)/.test(t)), 'a compact member tile carries a border').toEqual([]);
    cleanup();

    // The word sits before the RSVP counts in the compact name.
    renderGrid({ variant: 'compact', events: [{ ...guestEvent, rsvp_summary: { yes: 2, maybe: 0, no: 1 } }], viewerDbUserId: VIEWER });
    expect(screen.getByRole('button', { name: "Azul - Guest Crew, Guest, 2 going, 0 maybe, 1 can't" })).toBeTruthy();
    cleanup();

    // Compact with no viewer id: no edge, no word.
    renderGrid({ variant: 'compact', events: [guestEvent] });
    expect(tokens(screen.getByRole('button', { name: 'Azul - Guest Crew' })), 'the compact tile is dashed with no viewer id').not.toContain('border-dashed');
    cleanup();

    // No viewer id: nothing is dashed and nothing says Guest.
    renderGrid({ variant: 'full', events: [guestEvent, memberEvent] });
    for (const name of ['Azul - Guest Crew', 'Wingspan - Home Crew']) {
      expect(tokens(screen.getByRole('button', { name })), `${name} is dashed with no viewer id`).not.toContain('border-dashed');
    }
  });

  // The guest edge of one tile variant, measured. The edge classes come off the RENDERED tile, the
  // hexes off globals.css, the tints off the preset table. Each edge is composited over the tile's
  // own fill (a tile's background paints under its border), then measured against that fill (the
  // inner side) and against each ground a day cell can hold (the outer side). Floor 3.0 (WCAG
  // 1.4.11). An image tile is not measured: a photo has no fixed ratio (the marker in GuestPill.tsx).
  // S-B1 (88.9-52), the HOVERED TILE arm: a tile under the pointer paints with its own hover
  // classes, read off the rendered tiles (tile = the untinted one, tintedTile = a tinted one): a
  // hover opacity fades the edge AND the fill together over the cell, and a hover fill replaces the
  // fill under the edge. Every cell ground is measured, a superset of the cells a pointer can be in.
  const measureGuestEdge = (tile: string[], tintedTile: string[], variant: 'compact' | 'full'): { failures: string[]; measured: number; hovered: number } => {
  const css = readFileSync(resolvePath(__dirname, '../globals.css'), 'utf8');
  const decls = (name: string): string[] =>
    [...css.matchAll(new RegExp('^[ \\t]*' + name + ':[ \\t]*([^;]+);', 'gm'))].map((m) => m[1].trim());
  const one = (name: string): string => {
    const hits = decls(name);
    if (hits.length !== 1 || !/^#[0-9a-f]{6}$/i.test(hits[0])) throw new Error(`${name}: expected one hex declaration, found ${JSON.stringify(hits)}`);
    return hits[0];
  };
  // A themed token is declared twice, light first then dark; each is a hex or one var() hop.
  const themed = (name: string): { light: string; dark: string } => {
    const hits = decls(name);
    if (hits.length !== 2) throw new Error(`${name}: expected a light and a dark declaration, found ${hits.length}`);
    const [light, dark] = hits.map((v) => {
      const hop = /^var\((--[a-z0-9-]+)\)$/.exec(v);
      return hop ? one(hop[1]) : v;
    });
    return { light, dark };
  };
  const readEdge = (pattern: RegExp, what: string): { hex: string; alpha: number } => {
    const hits = tile.map((t) => pattern.exec(t)).filter((m): m is RegExpExecArray => m !== null);
    if (hits.length !== 1) throw new Error(`the ${variant} guest tile holds ${hits.length} ${what} edge colours, expected 1`);
    return { hex: one(`--color-amber-${hits[0][1]}`), alpha: hits[0][2] === undefined ? 1 : Number(hits[0][2]) / 100 };
  };
  const edge = {
    light: readEdge(/^border-amber-(\d{2,3})(?:\/(\d{1,3}))?$/, 'light'),
    dark: readEdge(/^dark:border-amber-(\d{2,3})(?:\/(\d{1,3}))?$/, 'dark'),
  };
  for (const t of ['border', 'border-dashed', 'border-amber-700', 'dark:border-amber-500']) {
    if (!tintedTile.includes(t)) throw new Error(`the tinted ${variant} guest tile lacks ${t}, so it is not the same edge`);
  }
  const hoverOf = (classes: string[], what: string): { opacity: number; fill: { light: string; dark: string } | null } => {
    const opacities = classes.map((t) => /^hover:opacity-(\d{1,3})$/.exec(t)).filter((m): m is RegExpExecArray => m !== null);
    const hoverFills = classes.map((t) => /^hover:bg-surface-([a-z-]+)$/.exec(t)).filter((m): m is RegExpExecArray => m !== null);
    if (opacities.length > 1 || hoverFills.length > 1) throw new Error(`the ${what} ${variant} guest tile holds ${opacities.length} hover opacities and ${hoverFills.length} hover fills, expected at most 1 of each`);
    return {
      opacity: opacities.length === 1 ? Number(opacities[0][1]) / 100 : 1,
      fill: hoverFills.length === 1 ? themed(`--color-bg-${hoverFills[0][1]}`) : null,
    };
  };
  const hover = { untinted: hoverOf(tile, 'untinted'), tinted: hoverOf(tintedTile, 'tinted') };
  const muted = themed('--color-bg-muted');
  const cells = {
    "this month's cell": themed('--color-bg-tile'),
    "today's cell": muted,
    'an adjacent-month cell': themed('--color-bg-page'),
    'a hovered cell': themed('--color-bg-hover'),
    // The full grid alone paints past days on their own ground.
    ...(variant === 'full' ? { 'a past cell': themed('--color-bg-tile-past') } : {}),
  };

  const failures: string[] = [];
  let measured = 0;
  let hovered = 0;
  for (const theme of ['light', 'dark'] as const) {
    const fills = [
      // An untinted COMPACT tile is filled with the muted surface; an untinted FULL tile has no
      // fill of its own, so the cell behind it is both its inner and its outer side.
      ...(variant === 'compact' ? [{ name: 'untinted', fill: muted[theme] as string | null }] : [{ name: 'untinted', fill: null as string | null }]),
      ...GROUP_COLOUR_PRESETS.map((p) => ({ name: `${p.name} tint`, fill: p[theme] as string | null })),
    ];
    for (const { name, fill } of fills) {
      const sides: [string, string][] = [...(fill === null ? [] : [['its own fill', fill] as [string, string]]), ...Object.entries(cells).map(([cell, v]): [string, string] => [cell, v[theme]])];
      for (const [side, against] of sides) {
        const painted = blend(edge[theme].hex, edge[theme].alpha, fill ?? against);
        const value = contrastRatio(painted, against);
        if (value === null) throw new Error(`could not measure the ${theme} edge on ${name} against ${side}`);
        measured += 1;
        if (value < 3.0) failures.push(`[${theme}] ${name} tile, edge painted ${painted}: ${value.toFixed(4)}:1 against ${side} (${against}), floor 3.00:1`);
      }

      // The hovered tile.
      const h = name === 'untinted' ? hover.untinted : hover.tinted;
      const hoverFill = h.fill === null ? fill : h.fill[theme];
      for (const [cell, v] of Object.entries(cells)) {
        const ground = v[theme];
        const edgePainted = blend(blend(edge[theme].hex, edge[theme].alpha, hoverFill ?? ground), h.opacity, ground);
        const fillPainted = hoverFill === null ? null : blend(hoverFill, h.opacity, ground);
        const hoverSides: [string, string][] = [[cell, ground], ...(fillPainted === null ? [] : [['its own hovered fill', fillPainted] as [string, string]])];
        for (const [side, against] of hoverSides) {
          const value = contrastRatio(edgePainted, against);
          if (value === null) throw new Error(`could not measure the hovered ${theme} edge on ${name} against ${side}`);
          measured += 1;
          hovered += 1;
          if (value < 3.0) failures.push(`[${theme}] HOVERED ${name} tile (opacity ${h.opacity}) in ${cell}, edge painted ${edgePainted}: ${value.toFixed(4)}:1 against ${side} (${against}), floor 3.00:1`);
        }
      }
    }
  }
    return { failures, measured, hovered };
  };

  // S-B1: one untinted and one tinted guest tile of a variant, as class tokens.
  const guestTiles = (variant: 'compact' | 'full'): { tile: string[]; tintedTile: string[] } => {
    const VIEWER = '00000000-0000-4000-8000-000000000028';
    const guestNight = (id: string, game: string, colour: string | null) => ({
      id,
      start_date: '2031-09-20T19:00:00',
      Game: { name: game },
      Group: { name: 'Guest Crew', background_color: colour },
      rsvp_summary: null,
      EventParticipations: [{ user_id: VIEWER, is_guest: true }],
    });
    renderGrid({ variant, viewerDbUserId: VIEWER, events: [guestNight('evt-guest', 'Azul', null), guestNight('evt-guest-tint', 'Root', '#722f37')] });
    const tile = tokens(screen.getByRole('button', { name: 'Azul - Guest Crew, Guest' }));
    const tintedTile = tokens(screen.getByRole('button', { name: 'Root - Guest Crew, Guest' }));
    cleanup();
    if (!tintedTile.includes('bg-[var(--group-ground-light)]')) throw new Error(`the tinted ${variant} fixture tile is not tinted, so the hovered arm reads the wrong classes`);
    if (tile.includes('bg-[var(--group-ground-light)]')) throw new Error(`the untinted ${variant} fixture tile is tinted`);
    return { tile, tintedTile };
  };

  it('W14 (88.9-52): the compact guest tile edge clears 3:1 against its own fill and against every day cell around it, both themes', () => {
    // Measured by measureGuestEdge above: this month's cell, today's cell, an adjacent-month cell
    // on the page ground, and the hovered cell; then the same again for the tile under the pointer
    // (S-B1: at hover:opacity-90 the light edge on today's cell measured 2.9516).
    const { tile, tintedTile } = guestTiles('compact');
    const { failures, measured, hovered } = measureGuestEdge(tile, tintedTile, 'compact');
    expect(failures, `the compact guest edge must clear 3:1 on every arm:\n${failures.join('\n')}`).toEqual([]);
    // At rest: 2 themes x 9 fills x (own fill + 4 cell grounds) = 90.
    // Hovered: 2 themes x 9 fills x 4 cell grounds x (the cell + the hovered fill) = 144.
    expect(hovered, 'anti-vacuity: 144 hovered measurements').toBe(144);
    expect(measured, 'anti-vacuity: 234 measurements').toBe(234);
  });

  it('W14 follow-up (88.9-52): the full guest tile edge clears 3:1 against its own fill and against every day cell around it, both themes', () => {
    // WORDS fixer finding, 88.9-52: the full tile kept GUEST_ROW_EDGE (amber-500 at 70% in dark);
    // by the compact tile's arithmetic a blue-tinted full tile in today's cell or a hovered cell
    // measured 2.98 on its outer side in dark. The full grid also paints past days on their own
    // ground, and an untinted full tile has no fill, so the cell is behind its edge.
    const { tile, tintedTile } = guestTiles('full');
    const { failures, measured, hovered } = measureGuestEdge(tile, tintedTile, 'full');
    expect(failures, `the full guest edge must clear 3:1 on every arm:\n${failures.join('\n')}`).toEqual([]);
    // At rest: 2 themes x (8 tints x (own fill + 5 cell grounds) + the untinted tile on 5 cell grounds) = 106.
    // Hovered: 2 themes x (8 tints x 5 cell grounds x (the cell + the hovered fill) + the untinted tile on 5 cell grounds) = 170.
    expect(hovered, 'anti-vacuity: 170 hovered measurements').toBe(170);
    expect(measured, 'anti-vacuity: 276 measurements').toBe(276);
  });

  it('S-B1 (88.9-52): a guest tile answers the pointer with a solid edge and keeps full opacity; a member tile keeps its own hover', () => {
    const VIEWER = '00000000-0000-4000-8000-000000000028';
    const night = (id: string, game: string, colour: string | null, isGuest: boolean) => ({
      id,
      start_date: '2031-09-20T19:00:00',
      Game: { name: game },
      Group: { name: 'Crew', background_color: colour },
      rsvp_summary: null,
      EventParticipations: [{ user_id: VIEWER, is_guest: isGuest }],
    });
    for (const variant of ['compact', 'full'] as const) {
      for (const colour of [null, '#722f37']) {
        renderGrid({ variant, viewerDbUserId: VIEWER, events: [night('evt-g', 'Azul', colour, true), night('evt-m', 'Root', colour, false)] });
        const guest = tokens(screen.getByRole('button', { name: 'Azul - Crew, Guest' }));
        const member = tokens(screen.getByRole('button', { name: 'Root - Crew' }));
        cleanup();
        const where = `${variant}, ${colour === null ? 'untinted' : 'tinted'}`;
        expect(guest, `${where}: the guest tile has no solid-edge hover`).toContain('hover:border-solid');
        expect(guest.filter((t) => t.startsWith('hover:opacity-')), `${where}: the guest tile fades under the pointer`).toEqual([]);
        expect(member, `${where}: a member tile took the guest hover`).not.toContain('hover:border-solid');
        // The member hover is what it was: the fill step on an untinted compact tile, 90% elsewhere.
        const memberHover = variant === 'compact' && colour === null ? 'hover:bg-surface-elevated' : 'hover:opacity-90';
        expect(member, `${where}: the member tile lost ${memberHover}`).toContain(memberHover);
      }
    }
  });

  it('S-B3 (88.9-52): the guest edge is one family in GuestPill.tsx; the month tiles import theirs and hold no amber edge literal', () => {
    // Read through the namespace so a missing export fails here as an assertion.
    const family = guestEdges as unknown as { GUEST_ROW_EDGE?: string; GUEST_TILE_EDGE?: string; GUEST_TILE_HOVER?: string };
    // No class value changed in the move: the rows keep the owner-ruled 70% in dark, the tiles are full strength.
    expect(family.GUEST_ROW_EDGE).toBe('border border-dashed border-amber-700 dark:border-amber-500/70');
    expect(family.GUEST_TILE_EDGE, 'GuestPill.tsx does not export the tile edge').toBe('border border-dashed border-amber-700 dark:border-amber-500');
    expect(family.GUEST_TILE_HOVER, 'GuestPill.tsx does not export the tile hover').toBe('hover:border-solid');

    const { tile, tintedTile } = guestTiles('compact');
    const full = guestTiles('full');
    for (const rendered of [tile, tintedTile, full.tile, full.tintedTile]) {
      for (const t of [...(family.GUEST_TILE_EDGE ?? '').split(' '), family.GUEST_TILE_HOVER ?? '']) {
        expect(rendered, `a guest month tile lacks ${t}`).toContain(t);
      }
    }

    // The source holds no amber border class of its own, in code or in a string (comments are
    // dropped line by line: every marker line in the file starts with // or sits in a block).
    const source = readFileSync(resolvePath(__dirname, 'CalendarMonthView.js'), 'utf8');
    const literals = source.split('\n').filter((line) => /['"\x60][^'"\x60]*border-amber-\d/.test(line) && /className|const /.test(line));
    expect(literals, 'CalendarMonthView.js carries its own amber edge literal again').toEqual([]);
    expect(source, 'CalendarMonthView.js does not import the tile edge from GuestPill').toMatch(/import \{ GUEST_TILE_EDGE, GUEST_TILE_HOVER \} from '\.\/GuestPill';/);
  });
});
