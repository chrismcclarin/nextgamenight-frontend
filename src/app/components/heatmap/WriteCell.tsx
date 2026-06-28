'use client';

// WriteCell — presentational write/preference heatmap cell (PRIM-01, D-04/D-06).
//
// A THIN React.memo wrapper over the engine: keyboard/roving comes from
// `useHeatmapCell`, color comes from `preferenceColor` (applied VERBATIM as the
// className — no cn/tailwind-merge so the byte-identical pinned strings survive),
// and the analog markup (role="button", aria-pressed, pointer-paint handlers) is
// carried over from TimeSlotCell.js.
//
// Keyboard parity with pointer-paint: Enter/Space cycles the preference
// null -> preferred -> if-need-be -> null. WriteCell owns the cycle mapping and
// reports the NEXT value via onSelect, so the container only persists state.
//
// React.memo is explicit and load-bearing — it carries over TimeSlotCell's
// drag-render guarantee so a pointer-paint drag re-renders only the painted cell.

import React, { memo, useCallback } from 'react';
import { preferenceColor } from '@/lib/availabilityColor';
import { useHeatmapCell } from './useHeatmapCell';

export type Preference = 'preferred' | 'if-need-be' | null;

const noop = () => {};

/** null -> preferred -> if-need-be -> null. */
export function cyclePreference(current: Preference): Preference {
  if (current === null) return 'preferred';
  if (current === 'preferred') return 'if-need-be';
  return null;
}

export interface WriteCellProps {
  /** This cell's row index (0-based). */
  row: number;
  /** This cell's column index (0-based). */
  col: number;
  /** Total rows in the grid. */
  rows: number;
  /** Total columns in the grid. */
  cols: number;
  /** Whether this cell currently holds roving focus. */
  focused?: boolean;
  /** Inert cell: tabIndex -1, no keyboard/pointer. */
  disabled?: boolean;
  /** Current preference value. */
  preference: Preference;
  /** Container handler: clamped target (row, col) on a nav key. */
  onMove?: (row: number, col: number) => void;
  /** Container handler: receives the NEXT preference after a keyboard cycle. */
  onSelect?: (next: Preference) => void;
  /** Pointer-paint start (slotId forwarded for the container's paint model). */
  onPointerDown?: (slotId?: string) => void;
  /** Pointer-paint drag-over. */
  onPointerEnter?: (slotId?: string) => void;
  /** Opaque slot identifier forwarded to the pointer-paint handlers. */
  slotId?: string;
  /** Registers this cell's DOM node with the container's cellRefs map. */
  cellRef?: React.Ref<HTMLDivElement>;
  /**
   * Extra classes APPENDED after the verbatim preferenceColor string (e.g.
   * `transition-colors duration-75`). Color stays byte-identical; the no-arg
   * path keeps className EXACTLY equal to preferenceColor (84-05 contract).
   */
  className?: string;
}

export const WriteCell = memo(function WriteCell({
  row,
  col,
  rows,
  cols,
  focused = false,
  disabled = false,
  preference,
  onMove = noop,
  onSelect,
  onPointerDown,
  onPointerEnter,
  slotId,
  cellRef,
  className,
}: WriteCellProps) {
  // Keyboard select cycles the three-state preference; WriteCell owns the mapping
  // and reports the NEXT value so the hook stays semantics-agnostic.
  const handleSelect = useCallback(() => {
    onSelect?.(cyclePreference(preference));
  }, [onSelect, preference]);

  const { tabIndex, onKeyDown } = useHeatmapCell({
    row,
    col,
    rows,
    cols,
    focused,
    disabled,
    onMove,
    onSelect: handleSelect,
  });

  const handlePointerDown = (e: React.PointerEvent) => {
    if (disabled) return;
    e.preventDefault();
    onPointerDown?.(slotId);
  };

  const handlePointerEnter = () => {
    if (disabled) return;
    onPointerEnter?.(slotId);
  };

  return (
    <div
      ref={cellRef}
      className={className ? `${preferenceColor(preference, disabled)} ${className}` : preferenceColor(preference, disabled)}
      style={{
        width: '100%',
        height: '100%',
        touchAction: 'none',
        userSelect: 'none',
        WebkitUserSelect: 'none',
        cursor: disabled ? undefined : 'pointer',
      }}
      role="button"
      aria-label={preference || 'not selected'}
      aria-pressed={!!preference}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onPointerDown={handlePointerDown}
      onPointerEnter={handlePointerEnter}
    />
  );
});

export default WriteCell;
