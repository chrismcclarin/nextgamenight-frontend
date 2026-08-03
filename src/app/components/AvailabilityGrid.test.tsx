// Convergence pins for AvailabilityGrid (PRIM-01 / 84-10, F-803/809 fix).
//
// The write grid converges onto the shared WriteCell. AvailabilityGrid is one of
// the three roving keyboard INPUT grids: it owns focusedCoord + a cellRefs map
// and drives REAL DOM focus on arrow keys (mirroring WeekGrid), and gains the
// keyboard select-cycle (null -> preferred -> if-need-be -> null) for free from
// useHeatmapCell — the F-803/809 keyboard-parity gap this plan closes.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import AvailabilityGrid from './AvailabilityGrid';
import { utcToWallClock } from '@/lib/datetime';

afterEach(cleanup);

const Grid = AvailabilityGrid as unknown as (props: Record<string, unknown>) => React.JSX.Element;

// The empty (null) write cells carry aria-label "not selected"; the toolbar
// buttons have text labels, so this name filter targets the grid cells only.
const cellsByLabel = () => screen.getAllByRole('button', { name: 'not selected' });

// Painted-cell sibling locator: WriteCell renders aria-label={preference ||
// 'not selected'} (WriteCell.tsx:125), so a cell painted in the default paint
// mode carries the accessible name "preferred".
const paintedCells = () => screen.getAllByRole('button', { name: 'preferred' });

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
