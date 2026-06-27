// Behavior pins for the ReadCell presentational wrapper (PRIM-01 / 84-05).
//
// ReadCell is a thin React.memo wrapper over useHeatmapCell that renders a
// read/intensity heatmap cell. It must:
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
  it('renders role="gridcell" with the byte-identical intensityColor class', () => {
    render(
      <ReadCell
        row={0}
        col={0}
        rows={1}
        cols={1}
        participantCount={2}
        preferredCount={1}
        totalMembers={4}
      />
    );
    const cell = screen.getByRole('gridcell');
    expect(cell.className).toBe(colors.intensityColor(2, 1, 4));
  });

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
        participantCount={2}
        preferredCount={1}
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
          participantCount={aCount}
          preferredCount={0}
          totalMembers={4}
        />
        <ReadCell
          row={0}
          col={1}
          rows={1}
          cols={2}
          onMove={onMove}
          onSelect={onSelect}
          participantCount={7}
          preferredCount={0}
          totalMembers={4}
        />
      </div>
    );
  }

  it('changing one cell value does NOT re-render the sibling memoized cell', () => {
    const spy = vi.spyOn(colors, 'intensityColor');
    const { rerender } = render(<TwoCells aCount={3} />);
    spy.mockClear();
    rerender(<TwoCells aCount={5} />);
    const participantArgs = spy.mock.calls.map((c) => c[0]);
    // Cell A re-rendered with its new value...
    expect(participantArgs).toContain(5);
    // ...but cell B (value 7, stable handlers) was skipped by React.memo.
    expect(participantArgs).not.toContain(7);
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
        participantCount={2}
        preferredCount={0}
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
        participantCount={2}
        preferredCount={0}
        totalMembers={4}
      />
    );
    fireEvent.keyDown(screen.getByRole('gridcell'), { key: 'ArrowRight' });
    expect(onMove).not.toHaveBeenCalled();
  });
});
