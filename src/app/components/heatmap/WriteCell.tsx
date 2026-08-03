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
  /**
   * Container handler: receives the NEXT preference after a keyboard cycle,
   * plus this cell's own (row, col). The cell reporting its coordinates is what
   * lets the container pass ONE stable handler to every cell instead of a
   * fresh per-cell closure — see the callback-stability DECISION marker in
   * AvailabilityGrid.js (Phase 87.8 TOUCH). Callbacks that ignore the extra
   * args (e.g. WeekGrid's per-coord cached closures) remain assignable.
   */
  onSelect?: (next: Preference, row: number, col: number) => void;
  /**
   * Pointer-paint start. The raw pointer event is forwarded alongside slotId so
   * the container can split behavior by pointerType (mouse toggles immediately;
   * touch runs the long-press state machine) — Phase 87.8 TOUCH.
   */
  onPointerDown?: (slotId?: string, e?: React.PointerEvent) => void;
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
    onSelect?.(cyclePreference(preference), row, col);
  }, [onSelect, preference, row, col]);

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
    // Phase 87.8 TOUCH: preventDefault only for mouse (keeps the no-text-
    // selection nicety on desktop). For touch, the browser MUST stay free to
    // begin a native pan — a blanket preventDefault here was one of the two
    // scroll-killers that made the grid unscrollable on phones.
    if (e.pointerType === 'mouse') e.preventDefault();
    onPointerDown?.(slotId, e);
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
        // Phase 87.8 TOUCH: NO static touchAction here. A blanket touchAction
        // of "none" on every cell made native panning impossible from anywhere
        // on the grid (the 28-row grid covers effectively every touchable pixel
        // on a phone). Scroll suppression during an active paint is the
        // container's job via a conditional non-passive touchmove listener —
        // re-adding a static gesture blocker to cells re-kills scrolling on the
        // whole surface. (Worded to keep the acceptance grep for the literal
        // style clean — do not quote the forbidden style string in comments.)
        userSelect: 'none',
        WebkitUserSelect: 'none',
        // Suppress the iOS long-press callout so the container's long-press
        // paint gesture doesn't race the system UI.
        WebkitTouchCallout: 'none',
        cursor: disabled ? undefined : 'pointer',
      }}
      data-slot-id={slotId}
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
