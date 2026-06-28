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
