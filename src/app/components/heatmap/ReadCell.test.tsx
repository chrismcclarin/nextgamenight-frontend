// Behavior pins for the ReadCell presentational wrapper (PRIM-01 / 84-05).
//
// AMENDED BY PHASE 88-31 (SPEC "END-OF-PHASE DEAD-CODE GATE"): every pin below used to render
// the DEFAULT (intensity) variant, because that was the shape with the fewest required props.
// That variant and its colour ramp are deleted, so the pins moved to `variant="merged"`.
//
// They were CONVERTED, NOT DELETED, and the distinction matters: only one of the six was about
// the dead ramp (a byte-identical class assertion, which the merged pin directly below it
// already made for the surviving ramp — that one IS gone as a duplicate). The other five pin
// arrow-key roving, the React.memo drag guarantee and passive `roving={false}` mode, all of
// which are live behaviour of a live primitive and none of which depends on the colour
// function. Deleting them because their fixture happened to use the dead variant would have
// removed real coverage under cover of a dead-code gate.
//
// ReadCell is a thin React.memo wrapper over useHeatmapCell that renders a
// read heatmap cell. It must:
//   1. expose role="gridcell" with the verbatim availabilityColor class
//   2. wire arrow-key roving through useHeatmapCell -> the grid onMove
//   3. preserve TimeSlotCell's React.memo drag guarantee (a sibling value change
//      does NOT re-render an unrelated memoized cell)
//   4. support roving={false} (passive 72-02 read-summary mode for
//      EventHeatmapBackground): static tabIndex, NO arrow-key roving handler,
//      and NO required focusedCoord/cellRefs/onMove container.
import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as colors from '@/lib/availabilityColor';
import { ReadCell } from './ReadCell';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ReadCell — semantics + verbatim color', () => {
  it('applies mergedCellColor verbatim for variant="merged"', () => {
    render(
      <ReadCell
        variant="merged"
        row={0}
        col={0}
        rows={1}
        cols={1}
        availableCount={3}
        totalMembers={5}
      />
    );
    expect(screen.getByRole('gridcell').className).toBe(colors.mergedCellColor(3, 5));
  });
});

describe('ReadCell — keyboard roving wired through useHeatmapCell', () => {
  it('an arrow keydown invokes the grid onMove with the clamped target', () => {
    const onMove = vi.fn();
    render(
      <ReadCell
        row={0}
        col={0}
        rows={2}
        cols={2}
        focused
        onMove={onMove}
        variant="merged"
        availableCount={2}
        totalMembers={4}
      />
    );
    fireEvent.keyDown(screen.getByRole('gridcell'), { key: 'ArrowRight' });
    expect(onMove).toHaveBeenCalledWith(0, 1);
  });
});

describe('ReadCell — React.memo drag-render guarantee', () => {
  function TwoCells({ aCount }: { aCount: number }) {
    const onMove = React.useCallback(() => {}, []);
    const onSelect = React.useCallback(() => {}, []);
    return (
      <div role="grid">
        <ReadCell
          row={0}
          col={0}
          rows={1}
          cols={2}
          focused
          onMove={onMove}
          onSelect={onSelect}
          variant="merged"
          availableCount={aCount}
          totalMembers={4}
        />
        <ReadCell
          row={0}
          col={1}
          rows={1}
          cols={2}
          onMove={onMove}
          onSelect={onSelect}
          variant="merged"
          availableCount={7}
          totalMembers={4}
        />
      </div>
    );
  }

  it('changing one cell value does NOT re-render the sibling memoized cell', () => {
    const spy = vi.spyOn(colors, 'mergedCellColor');
    const { rerender } = render(<TwoCells aCount={3} />);
    spy.mockClear();
    rerender(<TwoCells aCount={5} />);
    const availableArgs = spy.mock.calls.map((c) => c[0]);
    // Cell A re-rendered with its new value...
    expect(availableArgs).toContain(5);
    // ...but cell B (value 7, stable handlers) was skipped by React.memo.
    expect(availableArgs).not.toContain(7);
  });
});

describe('ReadCell — roving={false} passive read-summary mode (72-02)', () => {
  it('renders a static tabIndex and needs no container props', () => {
    render(
      <ReadCell
        row={0}
        col={0}
        rows={1}
        cols={1}
        roving={false}
        variant="merged"
        availableCount={2}
        totalMembers={4}
      />
    );
    expect(screen.getByRole('gridcell')).toHaveAttribute('tabindex', '0');
  });

  it('attaches NO arrow-key roving handler (an arrow keydown does not move)', () => {
    const onMove = vi.fn();
    render(
      <ReadCell
        row={0}
        col={0}
        rows={2}
        cols={2}
        roving={false}
        onMove={onMove}
        variant="merged"
        availableCount={2}
        totalMembers={4}
      />
    );
    fireEvent.keyDown(screen.getByRole('gridcell'), { key: 'ArrowRight' });
    expect(onMove).not.toHaveBeenCalled();
  });
});
