'use client';

// WeekGrid — RBC-free week slot-grid container (PRIM-01, D-06).
//
// The composable, RBC-free building block the 5 prod div-grids converge onto in
// 84-10 (and that EventScheduler can later rebuild on, dropping RBC per D-08).
// "RBC-free" = it imports nothing from the calendar library; that independence is
// the whole point of D-06. It composes useHeatmapCell + Read/Write cells (time-axis column +
// day columns) and owns the roving focus:
//
//   - `focusedCoord` state marks which cell holds the single tabIndex=0.
//   - a `cellRefs` map keyed by "row:col" stores each cell's DOM node so an arrow
//     key moves REAL DOM focus (`.focus()`), mirroring the legacy intensity read-grid's
//     `cellRefs[...].focus()` — not just a tabIndex shuffle. (That component was deleted by
//     plan 88-31's dead-code gate; the behaviour it is credited with here is the one this
//     grid still implements, and the original is in git history if the wording matters.)
//   - handlers handed to the (React.memo) cells are STABLE across renders:
//     `onMove` is a single stable callback (the hook passes it the clamped
//     target), ref + per-coord `onSelect` callbacks are memoized in a Map, and
//     pointer-paint is delegated at the grid level by reading `data-coord`. No
//     fresh inline closures per cell per render, so the memoized cells stay
//     un-re-rendered during a paint drag.

import React, { memo, useCallback, useRef, useState } from 'react';
import { ReadCell } from './ReadCell';
import { WriteCell, cyclePreference, type Preference } from './WriteCell';

const coordKey = (row: number, col: number) => `${row}:${col}`;

/**
 * Per-cell read data returned by `getCell` (color args + presentation).
 *
 * DECISION Phase 88-31: the second arm of this union — the default/intensity shape carrying
 * `participantCount` / `preferredCount` — was deleted with the rest of the dead intensity
 * cluster (SPEC "END-OF-PHASE DEAD-CODE GATE").
 *
 * WORTH KNOWING: this arm is NOT in the SPEC's enumerated delete list, and `tsc --noEmit` is
 * what makes that safe rather than lucky — leaving it would have left a type describing props
 * `ReadCell` no longer accepts, and the build would have said so. It is recorded here because
 * the next person auditing that list against what actually shipped will otherwise read this as
 * scope drift.
 */
export type WeekGridReadData = {
  variant: 'merged';
  availableCount: number;
  totalMembers: number;
  ariaLabel?: string;
  tooltipContent?: React.ReactNode;
};

interface WeekGridBaseProps {
  /** Number of day columns. */
  days: number;
  /** Number of time-slot rows. */
  slots: number;
  /** Column header labels (length `days`). */
  dayLabels?: string[];
  /** Time-axis labels (length `slots`). */
  slotLabels?: string[];
  /** Accessible label for the grid. */
  ariaLabel?: string;
  /** Disable all cells. */
  disabled?: boolean;
  /**
   * Override the per-cell wrapper class (row height / border / any non-width styling).
   * WIDTHS NO LONGER COME FROM HERE — since the 88.1-02 CSS-grid conversion the column widths
   * are owned by `gridTemplateColumns` on the grid container, so header and body cannot desync.
   * Passing `w-*` utilities here does nothing useful; change `gutterPx` or `days` instead.
   */
  cellClassName?: string;
  /**
   * Width of the time-axis gutter column, in px. Default 24 — the value 87.8-13 F-2 recorded as
   * fitting the widest compact label ("12p" at 10px mono) at 375px, where the old 40px "read as
   * dead left padding". The day columns take `1fr` each, so the grid always fits its container.
   */
  gutterPx?: number;
}

export interface ReadWeekGridProps extends WeekGridBaseProps {
  variant: 'read';
  /** Returns the read/intensity data for a given coord. */
  getCell: (row: number, col: number) => WeekGridReadData;
}

export interface WriteWeekGridProps extends WeekGridBaseProps {
  variant: 'write';
  /** Returns the current preference for a given coord. */
  getPreference: (row: number, col: number) => Preference;
  /** Persists a preference change for a coord (keyboard cycle + pointer paint). */
  onChange?: (row: number, col: number, next: Preference) => void;
}

export type WeekGridProps = ReadWeekGridProps | WriteWeekGridProps;

// Row height + border only. The width utilities (`w-24`/`sm:w-28`) and `shrink-0` that used to
// live here were deleted by the 88.1-02 CSS-grid conversion — see the DECISION marker at the
// geometry site below. (Class names are written with a slash rather than as a literal utility
// pair so plan 88.1-02's "no fixed widths survive" grep gate reads 0 on prose too.)
const DEFAULT_CELL_CLASS = 'h-12 sm:h-14 border border-line';

/**
 * DECISION Phase 88.1-02 (C12 / UI-SPEC "S1 desktop geometry"): ONE CSS grid with
 * `gridTemplateColumns: \`${gutterPx}px repeat(${days}, 1fr)\`` sizes the header row AND the body
 * cells — chosen OVER keeping the flex + fixed-width idiom and letting consumers pass
 * `cellClassName`.
 *
 * WHY the rejected option was rejected: four widths had to agree by hand — the gutter header
 * (`w-16`/`sm:w-20`), the day header (`w-24`/`sm:w-28`), the row gutter (same pair as the gutter
 * header) and
 * `DEFAULT_CELL_CLASS` — and only the LAST of those was overridable. So passing `cellClassName`
 * silently desynced the header row from the body, and nothing in the prop name told the next
 * reader that. The old defaults also came to 7 x 96px + 64px = 736px, which at 375px turned the
 * grid into the horizontal-scroll surface D-03 explicitly rejected; `1fr` columns fit-to-width at
 * both target geometries (~117px columns in the create-event modal's real 896px `max-w-4xl`).
 *
 * The idiom is copied from the owner-passed sibling `EventHeatmapBackground.js:210-212`, including
 * `className="contents"` on the per-row wrapper (`:235`) so keeping `role="row"` does not break the
 * single grid.
 *
 * NOT AN OVERRIDE OF ANYTHING PRIOR: `DECISION Phase 88-31` above guards the read-data UNION, not
 * the layout. WeekGrid had zero live consumers and `WeekGrid.test.tsx` had no geometry assertions
 * when this was done, which is why it was free now and would not have been later.
 *
 * WHAT RE-OPENS IT: a consumer that genuinely needs fixed-width columns wider than its container
 * (a print/export view, say). That wants a `columnPx` prop alongside `1fr`, not a return to four
 * hand-synced width utilities.
 */
export const WeekGrid = memo(function WeekGrid(props: WeekGridProps) {
  const {
    days,
    slots,
    dayLabels,
    slotLabels,
    ariaLabel,
    disabled = false,
    cellClassName,
    gutterPx = 24,
  } = props;

  const [focusedCoord, setFocusedCoord] = useState({ row: 0, col: 0 });

  // DOM-node registry for roving focus. Keyed by "row:col".
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());
  // Stable per-coord ref callbacks (created once per coord, memo-friendly).
  const refCallbacks = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const getCellRef = useCallback((key: string) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (node: HTMLDivElement | null) => {
        if (node) cellRefs.current.set(key, node);
        else cellRefs.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);

  // Single STABLE onMove: the hook hands it the clamped target coord. Updates
  // focusedCoord AND moves real DOM focus to the target cell.
  const onMove = useCallback((row: number, col: number) => {
    setFocusedCoord({ row, col });
    cellRefs.current.get(coordKey(row, col))?.focus();
  }, []);

  // Keep the latest onChange reachable from stable per-coord callbacks without
  // making those callbacks depend on (and churn with) onChange identity.
  const onChange = props.variant === 'write' ? props.onChange : undefined;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Stable per-coord onSelect callbacks (keyboard cycle persistence).
  const selectCallbacks = useRef(new Map<string, (next: Preference) => void>());
  const getOnSelect = useCallback((row: number, col: number) => {
    const key = coordKey(row, col);
    let cb = selectCallbacks.current.get(key);
    if (!cb) {
      cb = (next: Preference) => onChangeRef.current?.(row, col, next);
      selectCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);

  // --- Delegated pointer-paint (write only) --------------------------------
  // Grid-level handlers read `data-coord` off the event target so we never hand
  // per-cell pointer closures to the memoized cells.
  const isPainting = useRef(false);
  const paintValue = useRef<Preference>(null);

  const coordFromEvent = (e: React.PointerEvent): { row: number; col: number } | null => {
    const el = (e.target as HTMLElement).closest('[data-coord]');
    const raw = el?.getAttribute('data-coord');
    if (!raw) return null;
    const [row, col] = raw.split(':').map(Number);
    return { row, col };
  };

  const handleGridPointerDown = (e: React.PointerEvent) => {
    if (disabled || props.variant !== 'write') return;
    const c = coordFromEvent(e);
    if (!c) return;
    const next = cyclePreference(props.getPreference(c.row, c.col));
    paintValue.current = next;
    isPainting.current = true;
    onChangeRef.current?.(c.row, c.col, next);
  };

  const handleGridPointerOver = (e: React.PointerEvent) => {
    if (disabled || props.variant !== 'write' || !isPainting.current) return;
    const c = coordFromEvent(e);
    if (!c) return;
    onChangeRef.current?.(c.row, c.col, paintValue.current);
  };

  const endPaint = () => {
    isPainting.current = false;
  };

  // --- Cell renderer --------------------------------------------------------
  const renderCell = (row: number, col: number) => {
    const key = coordKey(row, col);
    const focused = focusedCoord.row === row && focusedCoord.col === col;

    if (props.variant === 'read') {
      const data = props.getCell(row, col);
      const common = {
        row,
        col,
        rows: slots,
        cols: days,
        focused,
        disabled,
        onMove,
        triggerRef: getCellRef(key),
      };
      // One read variant since 88-31 (see `WeekGridReadData` above); the branch that used to
      // sit here rendered the deleted intensity cell.
      return (
        <ReadCell
          {...common}
          variant="merged"
          availableCount={data.availableCount}
          totalMembers={data.totalMembers}
          ariaLabel={data.ariaLabel}
          tooltipContent={data.tooltipContent}
        />
      );
    }

    return (
      <WriteCell
        row={row}
        col={col}
        rows={slots}
        cols={days}
        focused={focused}
        disabled={disabled}
        preference={props.getPreference(row, col)}
        slotId={key}
        onMove={onMove}
        onSelect={getOnSelect(row, col)}
        cellRef={getCellRef(key)}
      />
    );
  };

  return (
    <div className="overflow-x-auto pb-2" onPointerUp={endPaint} onPointerLeave={endPaint}>
      <div
        className="grid gap-px"
        style={{ gridTemplateColumns: `${gutterPx}px repeat(${days}, 1fr)` }}
        role="grid"
        aria-label={ariaLabel}
        onPointerDown={handleGridPointerDown}
        onPointerOver={handleGridPointerOver}
      >
        {/* Day header row. `contents` keeps role="row" without breaking the single grid
            (EventHeatmapBackground.js:235). */}
        <div className="contents" role="row">
          <div role="columnheader" />
          {Array.from({ length: days }, (_, col) => (
            <div
              key={`h-${col}`}
              role="columnheader"
              className="text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
            >
              {dayLabels?.[col] ?? ''}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {Array.from({ length: slots }, (_, row) => (
          <div key={`r-${row}`} className="contents" role="row">
            {/* pr-1 (not the old pr-2) because the gutter is now 24px, not 64-80px — 8px of
                right padding would leave 16px for the label. Matches the owner-passed
                EventHeatmapBackground.js:238 gutter at the same width. */}
            <div className="flex items-center justify-end pr-1 text-xs sm:text-sm text-content-secondary font-medium">
              {slotLabels?.[row] ?? ''}
            </div>
            {Array.from({ length: days }, (_, col) => (
              <div key={coordKey(row, col)} data-coord={coordKey(row, col)} className={cellClassName ?? DEFAULT_CELL_CLASS}>
                {renderCell(row, col)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
});

export default WeekGrid;
