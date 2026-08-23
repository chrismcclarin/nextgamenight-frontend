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

// AMENDED BY PHASE 88-31: this fixture was `{ variant: 'intensity', participantCount, … }`.
// The intensity arm of `WeekGridReadData` went with the dead-code gate, so the fixture moved to
// the surviving `merged` shape. The three pins below are about the ARIA scaffold, real DOM focus
// movement and write-cycle persistence — none of them depends on which colour ramp a read cell
// uses, so this is a fixture swap, not a coverage loss. Converting them was chosen OVER deleting
// them: they are the only tests of `variant="read"` in the suite.
const readCell = () => ({ variant: 'merged', availableCount: 1, totalMembers: 4 }) as const;

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

// Plan 88.1-02 Task 2 (C12): ONE grid template sizes headers AND body cells.
//
// This asserts the AUTHORED style string, not rendered pixels — jsdom has no layout engine
// (PATTERNS P7), so a width assertion here would be vacuous. The discriminating part is that the
// `days` count reaches the template: a hardcoded `repeat(7, 1fr)` would fail the days={3} case.
describe('WeekGrid — CSS-grid geometry (88.1-02 C12)', () => {
  it('sizes columns from one gridTemplateColumns carrying the day count and the gutter', () => {
    render(
      <WeekGrid variant="read" days={3} slots={2} getCell={readCell} ariaLabel="geometry" />
    );
    expect(screen.getByRole('grid')).toHaveStyle({
      gridTemplateColumns: '24px repeat(3, 1fr)',
    });
  });

  it('gutterPx overrides the gutter track without touching the day tracks', () => {
    render(
      <WeekGrid variant="read" days={7} slots={1} gutterPx={40} getCell={readCell} ariaLabel="geometry" />
    );
    expect(screen.getByRole('grid')).toHaveStyle({
      gridTemplateColumns: '40px repeat(7, 1fr)',
    });
  });

  it('row wrappers use display:contents so role="row" does not break the single grid', () => {
    render(<WeekGrid variant="read" days={2} slots={2} getCell={readCell} ariaLabel="geometry" />);
    for (const row of screen.getAllByRole('row')) {
      expect(row).toHaveClass('contents');
    }
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
