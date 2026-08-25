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
import * as colors from '@/lib/availabilityColor';
import { WeekGrid } from './WeekGrid';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

// Plan 88.1-02 Task 3: the five seams (D-01's four + the Req 6 keyboard-select passthrough).
// No geometry assertions — jsdom has no layout (PATTERNS P7).
describe('WeekGrid — seam 1: per-cell colour/style/content passthrough', () => {
  it('a colorClass supplied through WeekGridReadData reaches the cell class string', () => {
    render(
      <WeekGrid
        variant="read"
        days={1}
        slots={1}
        getCell={() => ({ variant: 'merged', availableCount: 3, totalMembers: 5, colorClass: 'wash-3' })}
        ariaLabel="seam1"
      />
    );
    const cls = screen.getByRole('gridcell').className;
    expect(cls).toContain('wash-3');
    // The override replaced the ramp rather than merging with it.
    expect(cls).not.toContain('bg-green-300');
  });

  it('colorClass={null} through WeekGridReadData suppresses the ramp entirely', () => {
    render(
      <WeekGrid
        variant="read"
        days={1}
        slots={1}
        getCell={() => ({ variant: 'merged', availableCount: 0, totalMembers: 5, colorClass: null })}
        ariaLabel="seam1"
      />
    );
    expect(screen.getByRole('gridcell').className).not.toContain('bg-surface-elevated');
  });

  it('style and children reach the cell', () => {
    render(
      <WeekGrid
        variant="read"
        days={1}
        slots={1}
        getCell={() => ({
          variant: 'merged',
          availableCount: 2,
          totalMembers: 4,
          style: { backgroundColor: 'rgba(34, 197, 94, 0.29)' },
          children: <span data-testid="badge">2</span>,
        })}
        ariaLabel="seam1"
      />
    );
    expect(screen.getByRole('gridcell')).toHaveStyle({ backgroundColor: 'rgba(34, 197, 94, 0.29)' });
    expect(screen.getByTestId('badge')).toBeInTheDocument();
  });
});

describe('WeekGrid — seam 2: renderDayHeader', () => {
  it('renders custom header nodes INSIDE the columnheader elements', () => {
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={1}
        dayLabels={['Mon', 'Tue']}
        getCell={readCell}
        renderDayHeader={(col) => <span data-testid={`dh-${col}`}>day {col}</span>}
        ariaLabel="seam2"
      />
    );
    const headers = screen.getAllByRole('columnheader');
    // headers[0] is the gutter corner; the day headers follow.
    expect(headers[1]).toContainElement(screen.getByTestId('dh-0'));
    expect(headers[2]).toContainElement(screen.getByTestId('dh-1'));
    // The custom node REPLACED the string label rather than rendering beside it.
    expect(headers[1]).not.toHaveTextContent('Mon');
  });

  it('falls back to the dayLabels string when omitted', () => {
    render(
      <WeekGrid variant="read" days={2} slots={1} dayLabels={['Mon', 'Tue']} getCell={readCell} ariaLabel="seam2" />
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers[1]).toHaveTextContent('Mon');
    expect(headers[2]).toHaveTextContent('Tue');
  });
});

describe('WeekGrid — seam 3: overlay over a positioned body', () => {
  it('renders overlay content whose positioned ancestor is the grid body', () => {
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        getCell={readCell}
        overlay={<div data-testid="sel-rect" />}
        ariaLabel="seam3"
      />
    );
    const rect = screen.getByTestId('sel-rect');
    expect(rect).toBeInTheDocument();
    const grid = screen.getByRole('grid');
    expect(grid).toHaveClass('relative');
    expect(grid).toContainElement(rect);
    // The overlay is out of grid flow and does not swallow the drag it draws.
    expect(rect.parentElement).toHaveClass('absolute', 'inset-0', 'pointer-events-none');
  });

  it('renders no overlay layer when the seam is unused', () => {
    const { container } = render(
      <WeekGrid variant="read" days={2} slots={2} getCell={readCell} ariaLabel="seam3" />
    );
    expect(container.querySelector('.pointer-events-none')).toBeNull();
  });
});

describe('WeekGrid — seam 4: scroll container, height bound and external gestures', () => {
  it('gestureHandlers.onPointerDown fires on a body pointerdown', () => {
    const onPointerDown = vi.fn();
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        getCell={readCell}
        gestureHandlers={{ onPointerDown }}
        ariaLabel="seam4"
      />
    );
    fireEvent.pointerDown(screen.getAllByRole('gridcell')[0]);
    expect(onPointerDown).toHaveBeenCalled();
  });

  it('maxBodyHeight turns the wrapper into ONE both-axes scroller and receives scrollContainerRef', () => {
    const ref = React.createRef<HTMLDivElement>();
    render(
      <WeekGrid
        variant="read"
        days={7}
        slots={28}
        getCell={readCell}
        maxBodyHeight="600px"
        scrollContainerRef={ref}
        ariaLabel="seam4"
      />
    );
    const wrapper = screen.getByRole('grid').parentElement as HTMLElement;
    // jsdom has NO layout: scrollHeight/clientHeight are both 0, so the behavioral half of this
    // ("there is something to scroll, and scrollToTime can scroll it") is owned by plan 88.1-14's
    // 375x667 e2e. What IS discriminating here is the authored scroll affordance: `overflow-auto`
    // (both axes) with a bounded height, on the element the ref points at.
    expect(wrapper).toHaveClass('overflow-auto');
    expect(wrapper).not.toHaveClass('overflow-x-auto');
    expect(wrapper).toHaveStyle({ maxHeight: '600px' });
    expect(ref.current).toBe(wrapper);
  });

  it('omitting maxBodyHeight leaves the pre-88.1-02 wrapper untouched', () => {
    render(<WeekGrid variant="read" days={7} slots={28} getCell={readCell} ariaLabel="seam4" />);
    const wrapper = screen.getByRole('grid').parentElement as HTMLElement;
    expect(wrapper).toHaveClass('overflow-x-auto');
    expect(wrapper).not.toHaveClass('overflow-auto');
    expect(wrapper.style.maxHeight).toBe('');
  });

  it('the day headers and the time gutter are sticky so scrolling cannot carry them off', () => {
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        dayLabels={['Mon', 'Tue']}
        slotLabels={['9:00', '9:30']}
        getCell={readCell}
        maxBodyHeight="600px"
        ariaLabel="seam4"
      />
    );
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header).toHaveClass('sticky', 'top-0');
    }
    expect(screen.getByText('9:00')).toHaveClass('sticky', 'left-0');
  });
});

describe('WeekGrid — seam 5: keyboard commit on a read cell (SPEC Req 6)', () => {
  it('Enter on a focused read cell fires onCellSelect with that coordinate', () => {
    const onCellSelect = vi.fn();
    render(
      <WeekGrid
        variant="read"
        days={2}
        slots={2}
        getCell={readCell}
        onCellSelect={onCellSelect}
        ariaLabel="seam5"
      />
    );
    // REAL DOM focus + a real keydown, following the D-06 focus-movement pin above — not a
    // synthetic prop call. That is what proves the commit runs through useHeatmapCell's EXISTING
    // Enter/Space handler rather than a second keyboard handler added here.
    const cells = screen.getAllByRole('gridcell'); // (0,0) (0,1) (1,0) (1,1)
    cells[2].focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' });
    expect(onCellSelect).toHaveBeenCalledWith(1, 0);
  });

  it('Space commits too, and a non-select key does not', () => {
    const onCellSelect = vi.fn();
    render(
      <WeekGrid variant="read" days={1} slots={1} getCell={readCell} onCellSelect={onCellSelect} ariaLabel="seam5" />
    );
    const cell = screen.getByRole('gridcell');
    cell.focus();
    fireEvent.keyDown(cell, { key: ' ' });
    expect(onCellSelect).toHaveBeenCalledWith(0, 0);
    onCellSelect.mockClear();
    fireEvent.keyDown(cell, { key: 'a' });
    expect(onCellSelect).not.toHaveBeenCalled();
  });
});

// The memo-stability constraint is the reason seams 4b/5 go through a latest-prop ref mirror plus
// the per-coordinate callback cache instead of being handed to the cells directly. During a drag
// the consumer re-renders WeekGrid on every pointermove with a fresh overlay and (typically) fresh
// handler identities; if that reached the cells, React.memo on ~196 of them would be defeated —
// "the smooth/janky boundary on a phone, not a micro-optimization" (AvailabilityGrid.js:368-373).
describe('WeekGrid — seams are memo-stable across a simulated drag', () => {
  it('re-rendering with NEW onCellSelect/gestureHandlers/overlay identities does not re-render cells', () => {
    const stableGetCell = (row: number, col: number) =>
      ({ variant: 'merged', availableCount: col + 1, totalMembers: 4 }) as const;

    const Host = ({ tick }: { tick: number }) => (
      <WeekGrid
        variant="read"
        days={2}
        slots={1}
        getCell={stableGetCell}
        // Fresh identities on every render — exactly what a dragging consumer produces.
        onCellSelect={() => {}}
        gestureHandlers={{ onPointerMove: () => {} }}
        overlay={<div data-testid="rect" data-tick={tick} />}
        ariaLabel="memo"
      />
    );

    const spy = vi.spyOn(colors, 'mergedCellColor');
    const { rerender } = render(<Host tick={0} />);
    spy.mockClear();
    rerender(<Host tick={1} />);
    // The overlay DID update...
    expect(screen.getByTestId('rect')).toHaveAttribute('data-tick', '1');
    // ...and not one cell re-resolved its colour.
    expect(spy).not.toHaveBeenCalled();
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
