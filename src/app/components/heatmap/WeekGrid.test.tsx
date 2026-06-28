// Behavior pins for the RBC-free WeekGrid container (PRIM-01 / D-06 / 84-05).
//
// WeekGrid composes useHeatmapCell + Read/Write cells into a week slot-grid that:
//   1. exposes role="grid" + role="row"/role="columnheader" scaffold
//   2. owns focusedCoord + a cellRefs map and MOVES REAL DOM FOCUS on arrow keys
//      (the load-bearing D-06 guarantee — not just a tabIndex shuffle)
//   3. hands STABLE onMove/onSelect to the memoized cells (read off data-coord /
//      memoized per coord), persisting write changes through onChange.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WeekGrid } from './WeekGrid';

afterEach(cleanup);

const readCell = () =>
  ({ variant: 'intensity', participantCount: 1, preferredCount: 0, totalMembers: 4 }) as const;

describe('WeekGrid — ARIA grid scaffold', () => {
  it('renders role="grid" with the supplied aria-label', () => {
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        dayLabels={['Mon', 'Tue']}
        slotLabels={['9:00', '9:30']}
        getCell={readCell}
        ariaLabel="Availability heatmap"
      />
    );
    expect(screen.getByRole('grid')).toHaveAttribute('aria-label', 'Availability heatmap');
  });
});

describe('WeekGrid — arrow keys move REAL DOM focus (D-06)', () => {
  it('ArrowRight then ArrowDown walk document.activeElement across cells', () => {
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        dayLabels={['Mon', 'Tue']}
        slotLabels={['9:00', '9:30']}
        getCell={readCell}
        ariaLabel="week"
      />
    );
    // DOM order: (0,0) (0,1) (1,0) (1,1)
    const cells = screen.getAllByRole('gridcell');
    cells[0].focus();
    expect(document.activeElement).toBe(cells[0]);

    fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cells[1]); // (0,1)

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(cells[3]); // (1,1)
  });
});

describe('WeekGrid — write variant persists keyboard cycle through onChange', () => {
  it('Enter on a write cell reports the next preference for that coord', () => {
    const onChange = vi.fn();
    render(
      <WeekGrid
        variant="write"
        days={1}
        slots={1}
        getPreference={() => null}
        onChange={onChange}
        ariaLabel="write grid"
      />
    );
    const btn = screen.getByRole('button');
    btn.focus();
    fireEvent.keyDown(btn, { key: 'Enter' });
    expect(onChange).toHaveBeenCalledWith(0, 0, 'preferred');
  });
});
