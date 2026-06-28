// Parity pins for useHeatmapCell (D-04).
//
// The hook owns the COMPLETE roving-tabindex + nav-key state machine lifted from
// HeatmapGrid.js:227-267. This suite proves keyboard parity for EVERY one of the
// eight nav keys (arrows + Home/End/PageUp/PageDown) plus Enter/Space select,
// non-nav pass-through, and the roving tabIndex rule — so when 84-10 deletes the
// grid-level handler, no key can silently regress.
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import { useHeatmapCell, type HeatmapCellArgs } from './useHeatmapCell';

/** Build a minimal keyboard event with a preventDefault spy. */
function keyEvent(key: string) {
  const preventDefault = vi.fn();
  return { key, preventDefault } as unknown as React.KeyboardEvent & {
    preventDefault: ReturnType<typeof vi.fn>;
  };
}

/** Render the hook in the middle of a 5x5 grid so every key has room to move. */
function renderMidGrid(overrides: Partial<HeatmapCellArgs> = {}) {
  const onMove = vi.fn();
  const onSelect = vi.fn();
  const args: HeatmapCellArgs = {
    row: 2,
    col: 2,
    rows: 5,
    cols: 5,
    focused: true,
    disabled: false,
    onMove,
    onSelect,
    ...overrides,
  };
  const { result, rerender } = renderHook((a: HeatmapCellArgs) => useHeatmapCell(a), {
    initialProps: args,
  });
  return { result, rerender, onMove, onSelect, args };
}

describe('useHeatmapCell — roving tabIndex rule', () => {
  it('is 0 when focused and not disabled', () => {
    const { result } = renderMidGrid({ focused: true, disabled: false });
    expect(result.current.tabIndex).toBe(0);
  });

  it('is -1 when not focused', () => {
    const { result } = renderMidGrid({ focused: false });
    expect(result.current.tabIndex).toBe(-1);
  });

  it('is -1 when disabled even if focused', () => {
    const { result } = renderMidGrid({ focused: true, disabled: true });
    expect(result.current.tabIndex).toBe(-1);
  });
});

describe('useHeatmapCell — eight nav keys (parity with HeatmapGrid.js:227-267)', () => {
  it('ArrowUp moves row-1, same col', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('ArrowUp');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(1, 2);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ArrowDown moves row+1, same col', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('ArrowDown');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(3, 2);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ArrowLeft moves col-1, same row', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('ArrowLeft');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(2, 1);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('ArrowRight moves col+1, same row', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('ArrowRight');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(2, 3);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('Home moves to first col of row', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('Home');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(2, 0);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('End moves to last col of row', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('End');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(2, 4);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('PageUp moves to top row of column', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('PageUp');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(0, 2);
    expect(e.preventDefault).toHaveBeenCalled();
  });

  it('PageDown moves to last row of column', () => {
    const { result, onMove } = renderMidGrid();
    const e = keyEvent('PageDown');
    result.current.onKeyDown(e);
    expect(onMove).toHaveBeenCalledWith(4, 2);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

describe('useHeatmapCell — edge clamping (preventDefault still fires)', () => {
  it('ArrowUp at top row clamps and still preventDefaults', () => {
    const { result, onMove } = renderMidGrid({ row: 0, col: 2 });
    const e = keyEvent('ArrowUp');
    result.current.onKeyDown(e);
    // target === current cell: onMove not called with a different cell,
    // but the event is still swallowed (matches grid else-branch).
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalledWith(-1, 2);
  });

  it('ArrowLeft at first col clamps and still preventDefaults', () => {
    const { result, onMove } = renderMidGrid({ row: 2, col: 0 });
    const e = keyEvent('ArrowLeft');
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalledWith(2, -1);
  });

  it('ArrowDown at bottom row clamps to rows-1', () => {
    const { result, onMove } = renderMidGrid({ row: 4, col: 2 });
    const e = keyEvent('ArrowDown');
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalledWith(5, 2);
  });

  it('ArrowRight at last col clamps to cols-1', () => {
    const { result, onMove } = renderMidGrid({ row: 2, col: 4 });
    const e = keyEvent('ArrowRight');
    result.current.onKeyDown(e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalledWith(2, 5);
  });
});

describe('useHeatmapCell — select keys', () => {
  it('Enter fires onSelect with preventDefault', () => {
    const { result, onSelect, onMove } = renderMidGrid();
    const e = keyEvent('Enter');
    result.current.onKeyDown(e);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
  });

  it('Space fires onSelect with preventDefault', () => {
    const { result, onSelect } = renderMidGrid();
    const e = keyEvent(' ');
    result.current.onKeyDown(e);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(e.preventDefault).toHaveBeenCalled();
  });
});

describe('useHeatmapCell — non-nav pass-through and disabled', () => {
  it('a non-nav key returns without preventDefault and without callbacks', () => {
    const { result, onMove, onSelect } = renderMidGrid();
    const e = keyEvent('a');
    result.current.onKeyDown(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('Tab is not swallowed (focus can leave the grid)', () => {
    const { result } = renderMidGrid();
    const e = keyEvent('Tab');
    result.current.onKeyDown(e);
    expect(e.preventDefault).not.toHaveBeenCalled();
  });

  it('when disabled, onKeyDown is a no-op for nav and select keys', () => {
    const { result, onMove, onSelect } = renderMidGrid({ disabled: true });
    const arrow = keyEvent('ArrowRight');
    result.current.onKeyDown(arrow);
    const enter = keyEvent('Enter');
    result.current.onKeyDown(enter);
    expect(onMove).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(arrow.preventDefault).not.toHaveBeenCalled();
    expect(enter.preventDefault).not.toHaveBeenCalled();
  });
});
