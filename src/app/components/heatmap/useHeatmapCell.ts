// src/app/components/heatmap/useHeatmapCell.ts
//
// Headless heatmap-cell keyboard/roving engine (PRIM-01, D-04).
//
// Owns the COMPLETE roving-tabindex + nav-key state machine that today lives in
// HeatmapGrid.js:227-267. Lifting it into one hook makes write-grid keyboard
// parity true BY CONSTRUCTION instead of by copy-paste (the F-803/809 drift root
// cause). The full eight-key nav set (arrows + Home/End/PageUp/PageDown) is ported
// here and parity-tested BEFORE 84-10 deletes the grid-level handler, so the read
// heatmap cannot silently lose Home/End/PageUp/PageDown.
//
// Semantics-agnostic by design: this hook does NOT decide `role`/`aria-*` (the
// ReadCell/WriteCell wrappers in 84-05 own that) and does NOT resolve color
// (availabilityColor owns that). It only maps keys → onMove/onSelect + the roving
// tabIndex value.

import { useCallback } from 'react';
import type { KeyboardEvent } from 'react';

export interface HeatmapCellArgs {
  /** This cell's row index (0-based). */
  row: number;
  /** This cell's column index (0-based). */
  col: number;
  /** Total number of rows in the grid. */
  rows: number;
  /** Total number of columns in the grid. */
  cols: number;
  /** Whether this cell currently holds roving focus. */
  focused: boolean;
  /** When true, the cell is inert: tabIndex -1 and onKeyDown is a no-op. */
  disabled?: boolean;
  /** Called with the clamped target (row, col) when a nav key moves focus. */
  onMove: (row: number, col: number) => void;
  /** Called when Enter or Space activates the cell. */
  onSelect: () => void;
}

export interface HeatmapCellResult {
  /** Roving tabindex: 0 only when focused && !disabled, else -1. */
  tabIndex: number;
  /** Keydown handler implementing the full nav-key + select state machine. */
  onKeyDown: (event: KeyboardEvent) => void;
}

/**
 * Headless roving-tabindex + nav-key + select keyboard hook for a heatmap cell.
 *
 * Nav-key model is lifted VERBATIM from HeatmapGrid.js:227-267 (clamping math
 * identical, just expressed in (row, col) instead of a flat index):
 *  - ArrowLeft  → col-1 (clamp >= 0)
 *  - ArrowRight → col+1 (clamp <= cols-1)
 *  - ArrowUp    → row-1 (clamp >= 0)
 *  - ArrowDown  → row+1 (clamp <= rows-1)
 *  - Home       → first col of row
 *  - End        → last col of row
 *  - PageUp     → top row of column
 *  - PageDown   → last row of column
 *
 * Every nav key calls preventDefault — INCLUDING at the clamped edge where the
 * target equals the current cell (matches the grid's `else { preventDefault() }`
 * branch). Enter/Space call onSelect with preventDefault. A non-nav key returns
 * without preventDefault so focus/typing can leave the grid.
 */
export function useHeatmapCell(args: HeatmapCellArgs): HeatmapCellResult {
  const { row, col, rows, cols, focused, disabled = false, onMove, onSelect } = args;

  const onKeyDown = useCallback(
    (event: KeyboardEvent) => {
      if (disabled) return; // inert: swallow nothing, fire nothing

      let targetRow = row;
      let targetCol = col;

      switch (event.key) {
        case 'ArrowLeft':
          targetCol = Math.max(0, col - 1);
          break;
        case 'ArrowRight':
          targetCol = Math.min(cols - 1, col + 1);
          break;
        case 'ArrowUp':
          targetRow = Math.max(0, row - 1);
          break;
        case 'ArrowDown':
          targetRow = Math.min(rows - 1, row + 1);
          break;
        case 'Home':
          targetCol = 0;
          break;
        case 'End':
          targetCol = cols - 1;
          break;
        case 'PageUp':
          targetRow = 0;
          break;
        case 'PageDown':
          targetRow = rows - 1;
          break;
        case 'Enter':
        case ' ':
          event.preventDefault();
          onSelect();
          return;
        default:
          return; // not a nav/select key — bail without preventDefault
      }

      // Nav key: always swallow the event. Only call onMove when the clamped
      // target differs from the current cell (matches grid's target !== idx).
      event.preventDefault();
      if (targetRow !== row || targetCol !== col) {
        onMove(targetRow, targetCol);
      }
    },
    [row, col, rows, cols, disabled, onMove, onSelect]
  );

  const tabIndex = focused && !disabled ? 0 : -1;

  return { tabIndex, onKeyDown };
}
