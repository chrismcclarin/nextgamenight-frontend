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

// BUG-01 / F-810 — slot instants must be GENERATED and PARSED against the
// PROFILE timezone via the date-fns-tz layer (wallClockToUtc / utcToWallClock),
// not browser-local setHours/getHours. The generation path and the reverse
// slot-id parsers (used by the cross-day paint/clear broadcast) must share one
// TZ basis, or a user whose profile TZ differs from the browser TZ persists
// slots on the wrong wall-clock hour/day.
describe('AvailabilityGrid — BUG-01 profile-TZ round-trip (F-810)', () => {
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

  it('generation + reverse round-trips a slot to the same wall-clock hour+day in the profile TZ (cross-day)', () => {
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
          numDays={1}
          weekStartDate={WEEK_START}
          timezone={PROFILE_TZ}
        />
      );
    }
    render(<Harness />);
    // First cell = row 0 (10:00 AM) on day 0 (2026-06-29).
    fireEvent.pointerDown(cellsByLabel()[0]);

    const emitted = onChange.mock.calls.at(-1)![0] as Slot[];
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

  it('cross-day broadcast reverse-parses the clicked slot in the profile TZ, painting the same wall-clock hour on every checked day', () => {
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
          numDays={2}
          weekStartDate={WEEK_START}
          timezone={PROFILE_TZ}
        />
      );
    }
    render(<Harness />);
    const checkboxes = screen.getAllByRole('checkbox'); // [All, day0, day1]
    fireEvent.click(checkboxes[1]); // check day 0 -> paints day 0
    fireEvent.click(checkboxes[2]); // check day 1 -> paints day 1, checkedDays=[0,1]
    // Clear painted slots but KEEP checkedDays, so the next click broadcasts.
    fireEvent.click(screen.getByRole('button', { name: 'Clear All' }));
    // Click the first empty cell (row 0, day 0) — cross-day broadcast to both days.
    fireEvent.pointerDown(cellsByLabel()[0]);

    const emitted = onChange.mock.calls.at(-1)![0] as Slot[];
    expect(emitted).toHaveLength(2);
    const wcs = emitted.map((s) => utcToWallClock(s.slotId, PROFILE_TZ)!);
    // Same wall-clock hour on both days (the reverse parser found the right
    // slot under the profile TZ), on adjacent profile-TZ calendar days 29 & 30.
    expect(wcs.every((w) => w.hours === 10 && w.minutes === 0)).toBe(true);
    expect(wcs.map((w) => w.day).sort()).toEqual([29, 30]);
  });
});
