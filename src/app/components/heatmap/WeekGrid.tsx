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
//     key moves REAL DOM focus (`.focus()`), mirroring HeatmapGrid's
//     `cellRefs[...].focus()` — not just a tabIndex shuffle.
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

/** Per-cell read data returned by `getCell` (color args + presentation). */
export type WeekGridReadData =
  | {
      variant?: 'intensity';
      participantCount: number;
      preferredCount: number;
      totalMembers: number;
      ariaLabel?: string;
      tooltipContent?: React.ReactNode;
    }
  | {
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
  /** Override the per-cell wrapper class (dims/border). */
  cellClassName?: string;
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

const DEFAULT_CELL_CLASS = 'w-24 sm:w-28 h-12 sm:h-14 flex-shrink-0 border border-line';

export const WeekGrid = memo(function WeekGrid(props: WeekGridProps) {
  const { days, slots, dayLabels, slotLabels, ariaLabel, disabled = false, cellClassName } = props;

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
      if (data.variant === 'merged') {
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
        <ReadCell
          {...common}
          participantCount={data.participantCount}
          preferredCount={data.preferredCount}
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
        className="min-w-max"
        role="grid"
        aria-label={ariaLabel}
        onPointerDown={handleGridPointerDown}
        onPointerOver={handleGridPointerOver}
      >
        {/* Day header row */}
        <div className="flex" role="row">
          <div className="w-16 sm:w-20 flex-shrink-0" role="columnheader" />
          {Array.from({ length: days }, (_, col) => (
            <div
              key={`h-${col}`}
              role="columnheader"
              className="w-24 sm:w-28 flex-shrink-0 text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
            >
              {dayLabels?.[col] ?? ''}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {Array.from({ length: slots }, (_, row) => (
          <div key={`r-${row}`} className="flex" role="row">
            <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
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
