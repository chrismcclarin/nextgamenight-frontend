// Phase 87.8 plan 14 — WriteCell memo effectiveness during a paint drag.
//
// The acceptance being pinned: a paint tick that touches ONE cell must not
// change the props of the other cells, so `React.memo` on WriteCell actually
// prevents them from re-rendering. Before this plan, every handler passed to
// WriteCell depended (transitively) on `value`, which changes on every paint
// tick — so all 196-392 cells re-rendered per painted cell, on a phone, during
// the drag-paint interaction where frame budget is tightest. The fix: handlers
// read current state off a ref (modelRef) and keep stable identities, and the
// per-cell `(next) => handleKeyboardSelect(row, col, next)` closure became one
// shared handler (WriteCell reports its own row/col).
//
// METHOD: the WriteCell module is mocked with a counting wrapper that applies
// the SAME shallow-props memo contract as the real cell and renders the real
// cell inside — so the counter increments exactly when the real memoized
// WriteCell would have re-rendered. If any cell prop regresses to per-render
// identity, every cell's count increments on every tick and this fails at the
// point of introduction.

import * as React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const renderCounts = new Map<string, number>();

vi.mock('./heatmap/WriteCell', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./heatmap/WriteCell')>();
  const Real = actual.default;
  const Counting = React.memo(function CountingWriteCell(
    props: React.ComponentProps<typeof Real>
  ) {
    const id = props.slotId ?? `${props.row}:${props.col}`;
    renderCounts.set(id, (renderCounts.get(id) ?? 0) + 1);
    return React.createElement(Real, props);
  });
  return { ...actual, default: Counting };
});

// Import AFTER the mock declaration (vi.mock is hoisted above imports anyway).
import AvailabilityGrid from './AvailabilityGrid';

afterEach(cleanup);
beforeEach(() => renderCounts.clear());

const Grid = AvailabilityGrid as unknown as (props: Record<string, unknown>) => React.JSX.Element;

const cellsByLabel = () => screen.getAllByRole('button', { name: 'not selected' });

type Slot = { slotId: string; preference: string };

// Controlled-state harness (mirrors AvailabilityGrid.test.tsx): live value
// state so successive gestures see each other's effects.
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
        weekStartDate={new Date(2026, 5, 29)}
        timezone="America/Chicago"
      />
    );
  }
  render(<Harness />);
  return onChange;
}

describe('AvailabilityGrid — WriteCell memo survives a paint tick (Phase 87.8 TOUCH callback stability)', () => {
  it('a mouse drag-paint tick re-renders ONLY the painted cell (2-day grid: 1 of 56)', () => {
    const onChange = renderHarness(2); // 56 cells
    const cells = cellsByLabel();
    expect(cells).toHaveLength(56);

    // Start the drag: mouse down toggles the first cell (this tick legitimately
    // re-renders that cell — its `preference` prop changed).
    fireEvent.pointerDown(cells[0]);
    expect(onChange).toHaveBeenCalledTimes(1);

    // Probe the NEXT paint tick in isolation.
    renderCounts.clear();
    fireEvent.pointerEnter(cells[1]); // drag-over paints the second cell

    expect(onChange).toHaveBeenCalledTimes(2);
    const emitted = onChange.mock.calls.at(-1)![0] as Slot[];
    expect(emitted).toHaveLength(2);

    // Exactly ONE cell re-rendered on this tick — the painted one. The other
    // 55 kept referentially-stable props, so the memo short-circuited them.
    const reRendered = [...renderCounts.entries()];
    expect(
      reRendered,
      `paint tick re-rendered ${reRendered.length} cells (expected 1): ${reRendered
        .map(([id, n]) => `${id} x${n}`)
        .join(', ')} — a WriteCell prop has regressed to per-render identity (see the DECISION Phase 87.8 (TOUCH) marker in AvailabilityGrid.js)`
    ).toHaveLength(1);
    expect(reRendered[0][1]).toBe(1);
    // And it is the cell the tick painted.
    expect(emitted.map((s) => s.slotId)).toContain(reRendered[0][0]);
  });

  it('handlers passed to WriteCell keep their identity across a selection change', () => {
    renderHarness(1);
    const cells = cellsByLabel();

    // Toggle one cell, then another: if handler identities were value-coupled,
    // the second tick would re-render every cell, not just the toggled one.
    fireEvent.pointerDown(cells[0]);
    renderCounts.clear();
    fireEvent.pointerDown(cellsByLabel()[0]); // next empty cell

    expect([...renderCounts.entries()]).toHaveLength(1);
  });
});
