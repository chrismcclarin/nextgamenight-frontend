// Convergence pins for AvailabilityGrid (PRIM-01 / 84-10, F-803/809 fix).
//
// The write grid converges onto the shared WriteCell. AvailabilityGrid is one of
// the three roving keyboard INPUT grids: it owns focusedCoord + a cellRefs map
// and drives REAL DOM focus on arrow keys (mirroring WeekGrid), and gains the
// keyboard select-cycle (null -> preferred -> if-need-be -> null) for free from
// useHeatmapCell — the F-803/809 keyboard-parity gap this plan closes.
import * as React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AvailabilityGrid from './AvailabilityGrid';
import { utcToWallClock } from '@/lib/datetime';

afterEach(cleanup);

const Grid = AvailabilityGrid as unknown as (props: Record<string, unknown>) => React.JSX.Element;

// The write cells carry copy row A2's name ("Monday, June 29 at 10:00 AM, not selected"),
// which ENDS in the state word; an empty (null) cell ends ", not selected". The toolbar
// buttons have text labels, so this suffix filter targets the grid cells only.
const cellsByLabel = () => screen.getAllByRole('button', { name: /, not selected$/ });

// Painted-cell sibling locator: the cell's name is WriteCell's resolved aria-label (the
// `ariaLabel` override, else the preference), so a cell painted in the default paint mode
// carries a name ending ", preferred".
const paintedCells = () => screen.getAllByRole('button', { name: /, preferred$/ });

// 88.6.1-39: a cell by its DOM index (stable while its name changes with its state), and a
// mouse tap that ends the way a real one does, with the release reaching the document, where
// the grid's gesture-end listener lives.
const slotCellsAt = (i: number) => document.querySelectorAll<HTMLElement>('[data-slot-id]')[i];
function mouseTap(cell: HTMLElement) {
  fireEvent.pointerDown(cell);
  fireEvent.pointerUp(document);
}

// Kiritimati is UTC+14, so a 10:00 wall-clock slot on 2026-06-29 maps to a UTC
// instant on 2026-06-28 — the cross-day case where a browser-local
// setHours/getHours approach corrupts BOTH the generated instant and the
// reverse-parsed day. Far enough from any plausible host TZ to prove the fix
// reads the profile TZ, not the runner's local TZ.
const PROFILE_TZ = 'Pacific/Kiritimati';
// Local-midnight Monday 2026-06-29, constructed via the numeric ctor so
// format(day, 'yyyy-MM-dd') is host-TZ-independent.
const WEEK_START = new Date(2026, 5, 29);

type Slot = { slotId: string; preference: string };

// Controlled-state harness: renders the grid with live value state so multi-step
// interactions (fill day -> tap cell -> clear) see each other's effects, and
// returns the onChange spy for asserting emitted selections.
function renderHarness(numDays: number) {
  const onChange = vi.fn();
  function Harness() {
    const [value, setValue] = React.useState<Slot[]>([]);
    return (
      <Grid
        value={value}
        onChange={(v: unknown) => {
          onChange(v);
          setValue(v as Slot[]);
        }}
        numDays={numDays}
        weekStartDate={WEEK_START}
        timezone={PROFILE_TZ}
      />
    );
  }
  render(<Harness />);
  return onChange;
}

const lastEmitted = (onChange: ReturnType<typeof vi.fn>) =>
  onChange.mock.calls.at(-1)![0] as Slot[];

describe('AvailabilityGrid — converged on WriteCell with container-owned roving focus', () => {
  it('arrow keydown moves document.activeElement to the adjacent write cell (cellRefs focus)', () => {
    render(
      <Grid value={[]} onChange={() => {}} numDays={2} weekStartDate={new Date('2026-06-29')} />
    );
    const cells = cellsByLabel();
    cells[0].focus();
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]); // (0,1)
  });

  it('Enter cycles the focused cell preference null -> preferred via onChange', () => {
    const onChange = vi.fn();
    render(
      <Grid value={[]} onChange={onChange} numDays={2} weekStartDate={new Date('2026-06-29')} />
    );
    const cells = cellsByLabel();
    cells[0].focus();
    fireEvent.keyDown(cells[0], { key: 'Enter' });

    expect(onChange).toHaveBeenCalledTimes(1);
    const next = onChange.mock.calls[0][0] as Array<{ slotId: string; preference: string }>;
    expect(next).toHaveLength(1);
    expect(next[0].preference).toBe('preferred');
  });
});

// BUG-01 / F-810 — slot instants must be GENERATED against the PROFILE timezone
// via the date-fns-tz layer (wallClockToUtc), not browser-local setHours. The
// guard asserts emitted slot ids reverse-parse (utcToWallClock) back to the
// intended wall-clock hour and profile-TZ calendar day — generation and reading
// share one TZ basis, or a user whose profile TZ differs from the browser TZ
// persists slots on the wrong wall-clock hour/day.
describe('AvailabilityGrid — BUG-01 profile-TZ round-trip (F-810)', () => {
  it('generation + reverse round-trips a slot to the same wall-clock hour+day in the profile TZ (cross-day)', () => {
    const onChange = renderHarness(1);
    // First cell = row 0 (10:00 AM) on day 0 (2026-06-29).
    fireEvent.pointerDown(cellsByLabel()[0]);

    const emitted = lastEmitted(onChange);
    expect(emitted).toHaveLength(1);
    const wc = utcToWallClock(emitted[0].slotId, PROFILE_TZ)!;
    expect(wc.hours).toBe(10);
    expect(wc.minutes).toBe(0);
    expect(wc.day).toBe(29);
    expect(wc.month).toBe(6);
    // Cross-day proof: the UTC calendar day differs from the profile wall-clock
    // day, so a browser-local/UTC approach would have persisted the wrong day.
    expect(new Date(emitted[0].slotId).getUTCDate()).not.toBe(29);
  });

  it('slots filled on two different days reverse-parse to the same wall-clock hour on the correct profile-TZ calendar days', () => {
    const onChange = renderHarness(2);
    const checkboxes = screen.getAllByRole('checkbox'); // [All, day0, day1]
    fireEvent.click(checkboxes[1]); // bulk-fill day 0
    fireEvent.click(checkboxes[2]); // bulk-fill day 1

    const emitted = lastEmitted(onChange);
    expect(emitted).toHaveLength(56); // 28 slots x 2 days, no overlap
    // Take one emitted slot id from each day: the 10:00 AM row appears exactly
    // once per day, on adjacent profile-TZ calendar days 29 & 30.
    const tenAm = emitted
      .map((s) => utcToWallClock(s.slotId, PROFILE_TZ)!)
      .filter((w) => w.hours === 10 && w.minutes === 0);
    expect(tenAm).toHaveLength(2);
    expect(tenAm.map((w) => w.day).sort()).toEqual([29, 30]);
  });
});

// SPEC R9 + owner ruling 2026-08-02: day checkboxes are a DERIVED two-way
// mirror of the painted grid (checked ⟺ every slot in the column is painted)
// with bulk fill/clear semantics, and the cross-day broadcast is REMOVED —
// no gesture ever writes outside its own cell/day.
// ---------------------------------------------------------------------------------------
// Plan 88.6-25 task 3 — T-88.6-69 (the seven unnamed checkboxes) and AC-18 (their hit area).
// ---------------------------------------------------------------------------------------
// BEFORE this plan the whole file carried ZERO aria- and zero role= attributes, so these seven
// announced as bare "checkbox, not checked" with no day — WCAG 4.1.2 / 1.3.1.
//
// The expected names are NOT literals this suite invents. They are read off the rendered HEADER
// CELLS, which are the other consumer of the same `formatDayHeader` callback — so the assertion
// is "the checkbox announces exactly what a sighted user reads in that column", which is the
// property, rather than "the checkbox announces the string this test happens to expect". A
// hard-coded table would keep passing if formatDayHeader's format string changed under it.
describe('AvailabilityGrid — the seven per-day checkboxes announce their day, at a 44px target', () => {
  it('names each checkbox with its own column header text (T-88.6-69)', () => {
    const { container } = render(
      <Grid
        value={[]}
        onChange={() => {}}
        numDays={7}
        weekStartDate={WEEK_START}
        timezone={PROFILE_TZ}
      />
    );

    // `border-b` is unique to the day-header cells in this component (grep: one site).
    const headerText = [...container.querySelectorAll('div.border-b')].map((d) =>
      (d.textContent ?? '').trim()
    );
    // Anti-vacuity, both halves: seven cells, none of them empty. Without this, a render that
    // produced seven blank headers would make the equality below pass against seven blank names.
    expect(headerText).toHaveLength(7);
    expect(headerText.every((t) => t.length > 0)).toBe(true);

    const [, ...dayBoxes] = screen.getAllByRole('checkbox'); // [All, day0 … day6]
    expect(dayBoxes).toHaveLength(7);
    expect(dayBoxes.map((b) => b.getAttribute('aria-label'))).toEqual(headerText);

    // …and each is REACHABLE by that name, which is what a screen-reader user actually has.
    for (const t of headerText) {
      expect(screen.getByRole('checkbox', { name: t })).toBeTruthy();
    }
  });

  it('puts the AC-18 hit-area floor on the WRAPPER and leaves the checkbox GLYPH at 16px', () => {
    // The rejected alternative is the one a future reader will reach for: moving the floor onto
    // the <input>. `w-4 h-4` on a native checkbox sizes the RENDERED GLYPH, so `w-11 h-11` there
    // paints a 44px checkbox — a look change this phase has no ruling for. jsdom performs no
    // layout, so this pins the MECHANISM (which element carries which class); the rendered
    // numbers are in 88.6-25-SUMMARY.md, measured in Chromium at 375px and 1280px.
    render(
      <Grid
        value={[]}
        onChange={() => {}}
        numDays={7}
        weekStartDate={WEEK_START}
        timezone={PROFILE_TZ}
      />
    );

    const [allBox, ...dayBoxes] = screen.getAllByRole('checkbox');
    for (const box of dayBoxes) {
      const wrapper = box.parentElement!;
      expect(wrapper.className).toContain('min-h-11');
      expect(wrapper.className).toContain('min-w-11');
      expect(box.className).toContain('w-4');
      expect(box.className).toContain('h-4');
      expect(box.className).not.toContain('w-11');
    }
    // The "All" toggle took the same rung on its own wrapper — the <label> that owns its box —
    // and its 14px glyph is likewise unchanged. Its accessible NAME was already correct (the
    // visible "All" text inside the label) and is deliberately untouched.
    const allWrapper = allBox.parentElement!;
    expect(allWrapper.tagName).toBe('LABEL');
    expect(allWrapper.className).toContain('min-h-11');
    expect(allWrapper.className).toContain('min-w-11');
    expect(allBox.className).toContain('w-3.5');
    expect(screen.getByRole('checkbox', { name: 'All' })).toBe(allBox);
  });

  // Phase 88.6-57 (CR-102, 88.6-REVIEW.md): the test above pins WHICH ELEMENT carries the
  // floor classes, which cannot tell a <label> wrapper from a <div> one — and a <div>'s padding
  // forwards NO activation to the input inside it, so the shipped 44px wrapper toggled nothing
  // and the real target stayed the 16px glyph. These two assertions pin the MECHANISM itself:
  // the wrapper is a LABEL (exactly like the "All" control), and a click on the wrapper — not
  // on the input — reaches that day's handler.
  it('makes each day WRAPPER a <label>, so a click on the 44px area toggles that day (CR-102)', () => {
    const onChange = vi.fn();
    render(
      <Grid
        value={[]}
        onChange={onChange}
        numDays={7}
        weekStartDate={WEEK_START}
        timezone={PROFILE_TZ}
      />
    );

    const [, ...dayBoxes] = screen.getAllByRole('checkbox');
    expect(dayBoxes).toHaveLength(7);
    for (const box of dayBoxes) {
      expect(box.parentElement!.tagName).toBe('LABEL');
    }
    dayBoxes.forEach((box, i) => {
      fireEvent.click(box.parentElement!);
      expect(onChange, `day ${i}: a wrapper click must reach the checkbox`).toHaveBeenCalledTimes(i + 1);
    });
  });
});
describe('AvailabilityGrid — mirror day checkboxes + bulk fill/clear (SPEC R9, owner ruling 2026-08-02)', () => {
  it('tapping an unchecked day checkbox fills every empty slot in that column only', () => {
    const onChange = renderHarness(2);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[]; // [All, day0, day1]
    fireEvent.click(checkboxes[1]);

    const emitted = lastEmitted(onChange);
    expect(emitted).toHaveLength(28); // day 0's full column, nothing else
    const wcs = emitted.map((s) => utcToWallClock(s.slotId, PROFILE_TZ)!);
    expect(wcs.every((w) => w.day === 29)).toBe(true); // day 1 (the 30th) untouched
    expect(checkboxes[1].checked).toBe(true); // mirror derives checked from fullness
    expect(checkboxes[2].checked).toBe(false);
  });

  it('tapping a checked day checkbox removes that day\'s slots and leaves other days untouched', () => {
    const onChange = renderHarness(2);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[1]); // fill day 0 -> box derives checked
    fireEvent.pointerDown(cellsByLabel()[0]); // day 0 is full, so the first empty cell is row 0 of day 1
    fireEvent.click(checkboxes[1]); // checked box -> clear day 0's slots

    const emitted = lastEmitted(onChange);
    expect(emitted).toHaveLength(1); // only the hand-painted day-1 slot survives
    expect(utcToWallClock(emitted[0].slotId, PROFILE_TZ)!.day).toBe(30);
    expect(checkboxes[1].checked).toBe(false);
  });

  it('hand-painting every slot of a day flips its checkbox (and All) to checked — mirror-on', () => {
    renderHarness(1);
    const [allBox, dayBox] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    expect(dayBox.checked).toBe(false);

    // Paint all 28 slots one by one; each paint removes the cell from the
    // "not selected" query, so index 0 is always the next empty cell.
    for (let i = 0; i < 28; i++) {
      fireEvent.pointerDown(cellsByLabel()[0]);
    }

    expect(dayBox.checked).toBe(true); // derived, never set
    expect(allBox.checked).toBe(true); // master All mirrors across all days
  });

  it('removing one slot from a full day flips its checkbox to unchecked — mirror-off', () => {
    renderHarness(1);
    const [allBox, dayBox] = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(dayBox); // bulk-fill the day
    expect(dayBox.checked).toBe(true);

    fireEvent.pointerDown(paintedCells()[0]); // tap a painted cell -> removes that one slot

    expect(dayBox.checked).toBe(false);
    expect(allBox.checked).toBe(false);
  });

  it('Clear All empties everything — full day AND partial day — and every checkbox derives unchecked (R9)', () => {
    const onChange = renderHarness(2);
    const checkboxes = screen.getAllByRole('checkbox') as HTMLInputElement[];
    fireEvent.click(checkboxes[1]); // full day 0
    fireEvent.pointerDown(cellsByLabel()[0]); // partial day 1 (one slot)

    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));

    // The old "only clears checked days" branch is dead: Clear All clears the
    // ENTIRE selection, matching its label.
    expect(lastEmitted(onChange)).toEqual([]);
    // The 2026-05-16 bug (checkbox stays ticked after Clear All) is impossible
    // by construction — there is no checkbox state left to strand.
    checkboxes.forEach((cb) => expect(cb.checked).toBe(false));
  });

  it('NO-CROSS-DAY GUARD: with day 0 full (box checked), a tap in day 1 emits exactly one new slot, in day 1', () => {
    const onChange = renderHarness(2);
    fireEvent.click(screen.getAllByRole('checkbox')[1]); // day 0 full -> box checked
    const before = lastEmitted(onChange);

    fireEvent.pointerDown(cellsByLabel()[0]); // first empty cell: row 0 of day 1

    const after = lastEmitted(onChange);
    const beforeIds = new Set(before.map((s) => s.slotId));
    const delta = after.filter((s) => !beforeIds.has(s.slotId));
    // Regression fence around the REMOVED cross-day broadcast (owner ruling
    // 2026-08-02): if anyone re-adds a linkage that lets one gesture write to
    // another day, this fails at the point of introduction.
    expect(delta).toHaveLength(1);
    expect(utcToWallClock(delta[0].slotId, PROFILE_TZ)!.day).toBe(30);
    expect(after).toHaveLength(before.length + 1);
  });
});

// Plan 88.6-63 (review round 2 #23). Before this, Clear All rendered only while `value.length > 0`,
// so ACTIVATING it unmounted it and focus fell to <body> on the magic-link write grid; and the
// selection summary was a plain div, so the running count was never announced. The fix keeps the
// button mounted (aria-disabled + a first-line refusal when empty) and makes the summary ONE
// always-mounted polite StatusRegion. Copy is the shipped copy (P1).
// Since 88.6.1-39 the summary is spoken by a separate sr-only region at gesture end, and the visible line is no longer a region (D-14 / D-45).
describe('88.6-63 (review round 2 #23) — Clear All keeps focus; the summary announces', () => {
  it('activating Clear All empties the selection and focus STAYS on it, now aria-disabled', () => {
    const onChange = renderHarness(2);
    fireEvent.pointerDown(cellsByLabel()[0]); // paint one slot

    const clear = screen.getByRole('button', { name: 'Clear All' });
    clear.focus();
    expect(document.activeElement).toBe(clear);
    fireEvent.click(clear);

    expect(lastEmitted(onChange)).toEqual([]);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Clear All' }));
    expect(screen.getByRole('button', { name: 'Clear All' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('at an empty selection Clear All is present, aria-disabled, and refuses the press', () => {
    const onChange = renderHarness(2);

    const clear = screen.getByRole('button', { name: 'Clear All' });
    expect(clear).toHaveAttribute('aria-disabled', 'true');
    // Not NATIVELY disabled — a natively-disabled focused control blurs to <body>.
    expect(clear).not.toBeDisabled();
    fireEvent.click(clear);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('the visible line is plain text; the ONE status region is the sr-only summary, empty at mount (rewritten by 88.6.1-39, D-45)', () => {
    renderHarness(2);

    // ONE status region, and it is the sr-only summary, empty before anything happened.
    const regions = screen.getAllByRole('status');
    expect(regions).toHaveLength(1);
    expect(regions[0]).toHaveClass('sr-only');
    expect(regions[0].textContent).toBe('');

    // The visible line is plain text: no role, not live, and NOT hidden from browse mode.
    const line = screen.getByTestId('availability-grid-summary-line');
    expect(line).not.toHaveAttribute('role');
    expect(line).not.toHaveAttribute('aria-live');
    expect(line).not.toHaveAttribute('aria-hidden');
    // The same box and type the region composed for it before (top margin, small type, secondary ink).
    expect(line).toHaveClass('mt-3', 'text-sm', 'text-content-secondary');
    expect(line.textContent).toBe('Click and drag to select your available times');

    mouseTap(slotCellsAt(0)); // paint one slot (default mode: preferred)
    expect(line.textContent).toBe('1 preferred, 0 if need be slots selected');

    // The count still filters on the wire enum: an If Need Be paint counts 1, never 0 (CP-3).
    fireEvent.click(screen.getByRole('button', { name: 'Adding: Preferred' }));
    expect(screen.getByRole('button', { name: 'Adding: If Need Be' })).toBeTruthy();
    mouseTap(slotCellsAt(1));
    expect(line.textContent).toBe('1 preferred, 1 if need be slots selected');
  });
});

// Plan 88.6.1-17 (D-14 / AC-21, copy row A2). Before this plan every check-in cell was named
// only by its state, so a VoiceOver user touching the grid heard "not selected" 196 to 392
// times with no day and no time. Copy row A2 (owner-ratified, D-30) names each cell
// "{long day} at {time}, {state}", state one of "preferred", "if need be", "not selected".
// Cells are located by the data-slot-id attribute (the e2e convention), never by name.
const slotCells = () => Array.from(document.querySelectorAll<HTMLElement>('[data-slot-id]'));

describe('88.6.1-17 (D-14 / AC-21, copy row A2) — a check-in cell is named by its day, time and state', () => {
  it('G1: the first cell of a grid starting Monday 2026-06-29 is "Monday, June 29 at 10:00 AM, not selected"', () => {
    renderHarness(1);
    const cells = slotCells();
    expect(cells).toHaveLength(28);
    expect(cells[0]).toHaveAccessibleName('Monday, June 29 at 10:00 AM, not selected');
  });

  it('G2: after a tap the same cell is named "..., preferred"', () => {
    renderHarness(1);
    fireEvent.pointerDown(slotCells()[0]);
    expect(slotCells()[0]).toHaveAccessibleName('Monday, June 29 at 10:00 AM, preferred');
  });

  it('G3: painted in the If Need Be mode the cell says "if need be", never the stored enum', () => {
    renderHarness(1);
    fireEvent.click(screen.getByRole('button', { name: 'Adding: Preferred' }));
    // Anti-vacuity: the mode really switched before the tap.
    expect(screen.getByRole('button', { name: 'Adding: If Need Be' })).toBeTruthy();
    fireEvent.pointerDown(slotCells()[0]);
    const cell = slotCells()[0];
    expect(cell).toHaveAccessibleName('Monday, June 29 at 10:00 AM, if need be');
    expect(cell.getAttribute('aria-label')).not.toContain('if-need-be');
  });

  it('U1: in the unavailable-week mode a cell exposes aria-disabled="true" (#170)', () => {
    render(
      <Grid
        value={[]}
        onChange={() => {}}
        numDays={1}
        weekStartDate={WEEK_START}
        timezone={PROFILE_TZ}
        disabled
      />
    );
    const cells = slotCells();
    expect(cells).toHaveLength(28);
    expect(cells[0]).toHaveAttribute('aria-disabled', 'true');
  });
});

// Plan 88.6.1-17, whole grid (AC-21 "each WriteCell"). The expected TIMES are read off the
// rendered full-width row labels (the house argument above: assert what a sighted user reads,
// not a string this suite invents). The expected DAYS are A2's ratified long form, written out
// literally, so a change to the day format string turns this red.
const LONG_DAYS = [
  'Monday, June 29',
  'Tuesday, June 30',
  'Wednesday, July 1',
  'Thursday, July 2',
  'Friday, July 3',
  'Saturday, July 4',
  'Sunday, July 5',
];

describe('88.6.1-17 whole grid (AC-21) — every cell, every state, on the wall clock the labels show', () => {
  it('G4: all 196 cells of a 7-day grid are named by their column day, their row label and their state, all distinct', () => {
    const { container } = render(
      <Grid value={[]} onChange={() => {}} numDays={7} weekStartDate={WEEK_START} timezone={PROFILE_TZ} />
    );
    // The full-width row label is the only rendered element carrying the sm:inline class.
    const rowLabels = [...container.querySelectorAll('span[class~="sm:inline"]')].map((s) =>
      (s.textContent ?? '').trim()
    );
    // Anti-vacuity: 28 labels, first and last as the grid is specified.
    expect(rowLabels).toHaveLength(28);
    expect(rowLabels[0]).toBe('10:00 AM');
    expect(rowLabels[27]).toBe('11:30 PM');

    const cells = [...container.querySelectorAll<HTMLElement>('[data-slot-id]')];
    expect(cells).toHaveLength(196);
    // DOM order is row-major: index i is row floor(i / 7), column i mod 7.
    cells.forEach((cell, i) => {
      const row = Math.floor(i / 7);
      const col = i % 7;
      expect(cell.getAttribute('aria-label'), `cell ${i}`).toBe(
        LONG_DAYS[col] + ' at ' + rowLabels[row] + ', not selected'
      );
    });
    const names = cells.map((c) => c.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(196);
    expect(cells[0]).toHaveAccessibleName('Monday, June 29 at 10:00 AM, not selected');
    expect(cells[195]).toHaveAccessibleName('Sunday, July 5 at 11:30 PM, not selected');
  });

  it('G5: the name follows the grid wall clock, not the slot instant — two profile zones, same name, different slot id', () => {
    const renderFirstCell = (tz: string) => {
      const { container, unmount } = render(
        <Grid value={[]} onChange={() => {}} numDays={1} weekStartDate={WEEK_START} timezone={tz} />
      );
      const cell = container.querySelector<HTMLElement>('[data-slot-id]')!;
      const out = { slotId: cell.getAttribute('data-slot-id'), name: cell.getAttribute('aria-label') };
      unmount();
      return out;
    };
    const kiritimati = renderFirstCell('Pacific/Kiritimati');
    const kathmandu = renderFirstCell('Asia/Kathmandu');
    // Anti-vacuity: the persisted instant really moved (by 8 h 15 min) between the two renders.
    expect(kiritimati.slotId).toBeTruthy();
    expect(kathmandu.slotId).toBeTruthy();
    expect(kiritimati.slotId).not.toBe(kathmandu.slotId);
    expect(kiritimati.name).toBe('Monday, June 29 at 10:00 AM, not selected');
    expect(kathmandu.name).toBe('Monday, June 29 at 10:00 AM, not selected');
  });

  it('G6: a column filled in the If Need Be mode says "if need be" on all 28 cells and never speaks the enum', () => {
    renderHarness(2);
    fireEvent.click(screen.getByRole('button', { name: 'Adding: Preferred' }));
    expect(screen.getByRole('button', { name: 'Adding: If Need Be' })).toBeTruthy();
    fireEvent.click(screen.getAllByRole('checkbox')[1]); // bulk-fill day 0

    const names = slotCells().map((c) => c.getAttribute('aria-label') ?? '');
    expect(names).toHaveLength(56);
    const ifNeedBe = names.filter((n) => n.endsWith(', if need be'));
    const empty = names.filter((n) => n.endsWith(', not selected'));
    expect(ifNeedBe).toHaveLength(28);
    expect(empty).toHaveLength(28);
    // The 28 if-need-be names are day 0's column (even DOM indexes in a 2-day grid).
    expect(ifNeedBe.every((n) => n.startsWith('Monday, June 29 at '))).toBe(true);
    expect(names.some((n) => n.includes('if-need-be'))).toBe(false);
  });
});

// Plan 88.6.1-39 (D-14 / D-45, AC-24, register R3-M20). Before this plan the visible count line
// WAS the live region, so a screen reader heard every painted cell while the finger was still
// moving. Now one separate sr-only region, empty at mount, speaks the count ONCE, when the gesture
// ends (a tap included), read from the selection the parent committed. The region is found by
// role (it is the only status node) and must be the SAME node before and after (C-6).
const SUMMARY_ONE = '1 preferred, 0 if need be slots selected';

describe('88.6.1-39 (D-14 / D-45, AC-24) — the count is spoken ONCE, when a gesture ends, from the committed selection', () => {
  it('G39-1: a touch tap speaks the count once, after the tap commits, from the region that was there and empty', () => {
    renderHarness(1);
    const region = screen.getByRole('status');
    expect(region).toHaveClass('sr-only');
    expect(region.textContent).toBe('');

    fireEvent.pointerDown(slotCellsAt(0), { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerUp(document, { pointerId: 1, pointerType: 'touch' });

    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe(SUMMARY_ONE);
  });

  it('G39-2: a mouse drag over three cells speaks nothing while the button is down, then one summary at release', () => {
    renderHarness(1);
    const region = screen.getByRole('status');

    fireEvent.pointerDown(slotCellsAt(0));
    expect(region.textContent, 'the count was spoken at the first painted cell').toBe('');
    fireEvent.pointerEnter(slotCellsAt(1));
    expect(region.textContent, 'the count was spoken per cell during the drag').toBe('');
    fireEvent.pointerEnter(slotCellsAt(2));
    expect(region.textContent, 'the count was spoken per cell during the drag').toBe('');

    fireEvent.pointerUp(document);
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe('3 preferred, 0 if need be slots selected');
  });

  it('G39-3: keyboard select (Enter on a cell) is a discrete action and speaks the count once', () => {
    renderHarness(1);
    const region = screen.getByRole('status');
    const cell = slotCellsAt(0);
    cell.focus();
    fireEvent.keyDown(cell, { key: 'Enter' });

    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe(SUMMARY_ONE);
  });

  it('G39-5: a second finger lifting while a long-press paint is in flight is not the gesture end and speaks nothing', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    try {
      renderHarness(1);
      const region = screen.getByRole('status');

      fireEvent.pointerDown(slotCellsAt(0), { pointerId: 1, pointerType: 'touch', clientX: 5, clientY: 5 });
      // Past the long-press timer: paint mode starts and toggles cell 0 on (one cell painted).
      act(() => {
        vi.advanceTimersByTime(350);
      });
      expect(slotCellsAt(0)).toHaveAttribute('aria-pressed', 'true');

      fireEvent.pointerDown(document, { pointerId: 2, pointerType: 'touch' });
      fireEvent.pointerUp(document, { pointerId: 2, pointerType: 'touch' });
      expect(region.textContent, 'the count was spoken while the first finger was still painting').toBe('');

      fireEvent.pointerUp(document, { pointerId: 1, pointerType: 'touch' });
      expect(screen.getByRole('status')).toBe(region);
      expect(region.textContent).toBe(SUMMARY_ONE);
    } finally {
      vi.useRealTimers();
    }
  });
});

// Plan 88.6.1-39 (D-16 / D-33 rows 11 and 17, copy rows A1 / A3 / A4). A local media stub for
// the phone arm, modelled on EventScheduler.test.tsx's stubMatchMedia (FE-TESTING-CONVENTIONS
// C-2): it answers any query naming max-width 767px with `matches`, every other query false,
// captures the change handler the shared phone hook registers, and must be installed BEFORE
// render and restored in a finally.
function stubPhoneMedia(matches: boolean) {
  const original = window.matchMedia;
  let handler: ((event: { matches: boolean }) => void) | null = null;
  window.matchMedia = ((query: string) =>
    ({
      matches: query.includes('max-width: 767px') ? matches : false,
      media: query,
      onchange: null,
      addEventListener: (_type: string, cb: (event: { matches: boolean }) => void) => {
        if (query.includes('max-width: 767px')) handler = cb;
      },
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
  return {
    restore: () => {
      window.matchMedia = original;
    },
    flip: (next: boolean) => {
      if (!handler) throw new Error('the phone hook registered no change handler');
      handler({ matches: next });
    },
  };
}

const DESKTOP_HINT = 'Click and drag to select your available times';
const PHONE_HINT = 'Tap a time to select it. Press and hold, then drag, to select several.';
const ALL_CLEARED = 'All times cleared.';
const SUMMARY_ZERO = '0 preferred, 0 if need be slots selected';
const summaryLine = () => screen.getByTestId('availability-grid-summary-line');

describe('88.6.1-39 (D-16 / D-33 rows 11 and 17, copy rows A1 / A3 / A4) — what the line says and what is spoken', () => {
  it('C39-1: Clear All shows and speaks A4 until the next paint; an un-paint to empty brings the instruction back, not A4', () => {
    renderHarness(2);
    const region = screen.getByRole('status');
    mouseTap(slotCellsAt(0));
    expect(region.textContent).toBe(SUMMARY_ONE);

    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent, 'Clear All must say what happened').toBe(ALL_CLEARED);
    expect(summaryLine().textContent).toBe(ALL_CLEARED);

    mouseTap(slotCellsAt(0));
    expect(summaryLine().textContent).toBe(SUMMARY_ONE);
    expect(region.textContent).toBe(SUMMARY_ONE);

    mouseTap(slotCellsAt(0)); // un-paint: the grid is empty again, but no Clear All just happened
    expect(region.textContent, 'D-33 row 11: zero is spoken as a count').toBe(SUMMARY_ZERO);
    expect(summaryLine().textContent).toBe(DESKTOP_HINT);
  });

  it('C39-2: a day checkbox and the All checkbox each speak the count once; unchecking All shows the instruction, not A4', () => {
    renderHarness(2);
    const region = screen.getByRole('status');
    const [allBox, day0] = screen.getAllByRole('checkbox');

    fireEvent.click(day0);
    expect(region.textContent).toBe('28 preferred, 0 if need be slots selected');
    fireEvent.click(allBox);
    expect(region.textContent).toBe('56 preferred, 0 if need be slots selected');
    fireEvent.click(allBox); // uncheck: clears everything
    expect(region.textContent).toBe(SUMMARY_ZERO);
    expect(summaryLine().textContent).toBe(DESKTOP_HINT);
    expect(screen.getByRole('status')).toBe(region);
  });

  it('C39-3: on a phone the line gives the tap and press-and-hold instruction (A1), and nothing is spoken', () => {
    const media = stubPhoneMedia(true);
    try {
      renderHarness(1);
      expect(summaryLine().textContent).toBe(PHONE_HINT);
      expect(screen.queryByText(DESKTOP_HINT)).toBeNull();
      expect(screen.getByRole('status').textContent).toBe('');
    } finally {
      media.restore();
    }
  });

  it('C39-4: the phone hook flipping after mount changes the line and is NOT announced (CP-5)', () => {
    const media = stubPhoneMedia(false);
    try {
      renderHarness(1);
      const region = screen.getByRole('status');
      expect(summaryLine().textContent).toBe(DESKTOP_HINT);
      expect(region.textContent).toBe('');

      act(() => media.flip(true));
      expect(summaryLine().textContent).toBe(PHONE_HINT);
      expect(region.textContent, 'the viewport flip was announced').toBe('');
    } finally {
      media.restore();
    }
  });

  it('C39-5: the same summary twice in a row is injected again, as a new span inside the same region (Edge R8)', () => {
    renderHarness(1);
    mouseTap(slotCellsAt(0));
    const region = screen.getByRole('status');
    expect(region.textContent).toBe(SUMMARY_ONE);
    const firstSpan = region.firstElementChild;
    expect(firstSpan).not.toBeNull();

    fireEvent.pointerDown(slotCellsAt(0)); // un-paints cell 0
    fireEvent.pointerEnter(slotCellsAt(1)); // paints cell 1
    fireEvent.pointerUp(document);

    expect(screen.getByRole('status')).toBe(region);
    expect(region.textContent).toBe(SUMMARY_ONE);
    expect(region.firstElementChild, 'an identical summary kept the old text node, so it is not re-announced').not.toBe(firstSpan);
  });

  it('C39-6: a touch that moves past the slop (a scroll) and ends in pointercancel paints nothing and speaks nothing', () => {
    renderHarness(1);
    const region = screen.getByRole('status');
    const cell = slotCellsAt(0);
    fireEvent.pointerDown(cell, { pointerId: 2, pointerType: 'touch', clientX: 5, clientY: 5 });
    fireEvent.pointerMove(cell, { pointerId: 2, pointerType: 'touch', clientX: 5, clientY: 40 });
    fireEvent.pointerCancel(document, { pointerId: 2, pointerType: 'touch' });

    expect(document.querySelectorAll('[data-slot-id][aria-pressed="true"]')).toHaveLength(0);
    expect(region.textContent, 'a scroll was announced').toBe('');
  });

  // Wave 6 CI gate (e2e arm (8), run 38993406485): the phone arm taps, presses Clear All, then
  // taps again, and the line stayed on A4. This pins that sequence on the TOUCH path the phone
  // uses (pointerdown pointerType touch arms the 300 ms long-press timer, a pointerup on the
  // document 60 ms later commits the tap), on the phone instruction branch. It was GREEN on the
  // tree the run failed on: the component brings the count back; the e2e arm's second tap landed
  // off the grid (see the arm's own note). It fails if the A4 branch ever outranks a non-empty
  // selection or if the touch commit stops reaching the parent.
  it('C39-7: on a phone, a touch tap after Clear All brings the count back on the line and in the region', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const media = stubPhoneMedia(true);
    const touchTap = (cell: HTMLElement, pointerId: number) => {
      fireEvent.pointerDown(cell, { pointerId, pointerType: 'touch', clientX: 5, clientY: 5 });
      act(() => {
        vi.advanceTimersByTime(60); // the arm's tap(): start, 60 ms, end — under the 300 ms timer
      });
      fireEvent.pointerUp(document, { pointerId, pointerType: 'touch' });
    };
    try {
      renderHarness(1);
      const region = screen.getByRole('status');
      expect(summaryLine().textContent).toBe(PHONE_HINT);

      touchTap(slotCellsAt(0), 2);
      expect(summaryLine().textContent).toBe(SUMMARY_ONE);

      fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
      expect(summaryLine().textContent).toBe(ALL_CLEARED);
      expect(region.textContent).toBe(ALL_CLEARED);

      touchTap(slotCellsAt(0), 3);
      expect(slotCellsAt(0)).toHaveAttribute('aria-pressed', 'true');
      expect(summaryLine().textContent, 'the counts did not come back after the next tap').toBe(SUMMARY_ONE);
      expect(region.textContent).toBe(SUMMARY_ONE);
    } finally {
      media.restore();
      vi.useRealTimers();
    }
  });
});
