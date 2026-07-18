'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, parseISO, isToday } from 'date-fns';
import ReadCell from './heatmap/ReadCell';
import { useTimezone } from '../components/TimezoneProvider';

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const HOURS = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

/**
 * Format hour number to display label.
 */
function formatHourLabel(hour) {
  if (hour === 12) return '12 PM';
  if (hour > 12) return `${hour - 12} PM`;
  return `${hour} AM`;
}

/**
 * MergedHeatmapGrid - 7x11 grid layout with day headers and hour labels.
 * Mon-Sun columns, 12pm-10pm rows.
 *
 * @param {Object} props
 * @param {Array} props.slots - Array of slot objects from heatmap API
 * @param {number} props.totalMembers - Total group members
 * @param {Object|null} props.selectedSlot - Currently selected slot { date, hour }
 * @param {function} props.onSlotSelect - Callback when a slot is clicked
 */
export default function MergedHeatmapGrid({ slots = [], totalMembers, selectedSlot, onSlotSelect }) {
  const { timezone } = useTimezone();
  // Build a lookup map: slotsMap[date][hour] for O(1) access
  const slotsMap = useMemo(() => {
    const map = {};
    slots.forEach((slot) => {
      if (!map[slot.date]) map[slot.date] = {};
      map[slot.date][slot.hour] = slot;
    });
    return map;
  }, [slots]);

  // Extract unique dates in order (Mon=dayOfWeek 1 through Sun=dayOfWeek 7)
  const dates = useMemo(() => {
    const dateSet = new Map();
    slots.forEach((slot) => {
      if (!dateSet.has(slot.date)) {
        dateSet.set(slot.date, slot.dayOfWeek);
      }
    });
    // Sort by dayOfWeek (1-7)
    return Array.from(dateSet.entries())
      .sort((a, b) => a[1] - b[1])
      .map(([date]) => date);
  }, [slots]);

  // ARIA grid roving tabindex pattern (84-10 convergence): the roving keyboard
  // state machine now lives in the shared ReadCell/useHeatmapCell engine. This
  // container owns focusedCoord {row,col} + a cellRefs map keyed by "row:col"
  // and drives REAL DOM focus on each cell's onMove (mirroring WeekGrid), so the
  // grid-level handleKeyDown could be removed without losing arrow-key nav.
  const totalRows = HOURS.length;
  const numCols = dates.length;
  const coordKey = (row, col) => `${row}:${col}`;
  const cellRefs = useRef(new Map());
  const refCallbacks = useRef(new Map());
  const [focusedCoord, setFocusedCoord] = useState({ row: 0, col: 0 });
  const getCellRef = useCallback((key) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (node) => {
        if (node) cellRefs.current.set(key, node);
        else cellRefs.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);
  const handleCellMove = useCallback((row, col) => {
    setFocusedCoord({ row, col });
    cellRefs.current.get(coordKey(row, col))?.focus();
  }, []);

  // Tooltip tone: mobile (touch) gets the larger expand chrome — preserved from
  // the old MergedHeatmapCell's useHoverNone. Forwarded to ReadCell -> tooltip.
  const [isHoverNone, setIsHoverNone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia('(hover: none)');
    setIsHoverNone(mq.matches);
    const handler = (event) => setIsHoverNone(event.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);
  const tone = isHoverNone ? 'mobile' : 'default';

  // If no slots, show placeholder
  if (dates.length === 0) {
    return (
      <div className="text-center text-content-muted py-8">
        No availability data for this week.
      </div>
    );
  }

  return (
    <div
      className="grid grid-cols-8 gap-px bg-line rounded-lg overflow-hidden"
      role="grid"
      aria-label="Group availability heatmap"
    >
      {/* Header row: empty corner + 7 day headers */}
      <div className="bg-surface-card p-2" /> {/* Empty corner */}
      {dates.map((dateStr, idx) => {
        const dateObj = parseISO(dateStr);
        const isTodayDate = isToday(dateObj);
        return (
          <div
            key={dateStr}
            className={`bg-surface-card p-2 text-center ${isTodayDate ? 'bg-accent/10' : ''}`}
          >
            <div className="text-xs font-semibold text-content-secondary">
              {DAY_LABELS[idx]}
            </div>
            <div
              className={`text-sm font-bold ${isTodayDate ? 'text-accent' : 'text-content-primary'}`}
            >
              {format(dateObj, 'd')}
            </div>
          </div>
        );
      })}

      {/* Body rows: hour label + 7 cells per row */}
      {HOURS.map((hour, rowIndex) => (
        <React.Fragment key={`hour-${hour}`}>
          {/* Hour label */}
          <div
            className="bg-surface-card p-2 flex items-center justify-end"
          >
            <span className="text-xs text-content-muted font-medium whitespace-nowrap">
              {formatHourLabel(hour)}
            </span>
          </div>

          {/* day cells for this hour */}
          {dates.map((dateStr, colIndex) => {
            const slot = slotsMap[dateStr]?.[hour];
            const isSelected =
              selectedSlot?.date === dateStr && selectedSlot?.hour === hour;
            const availableCount = slot?.availableCount ?? 0;
            const availableMembers = slot?.availableMembers ?? [];
            const dayOfWeek = slot?.dayOfWeek ?? 0;
            const key = coordKey(rowIndex, colIndex);
            const focused = focusedCoord.row === rowIndex && focusedCoord.col === colIndex;
            const selectionRing = isSelected ? 'ring-2 ring-accent' : '';
            const tooltipContent =
              availableCount > 0 ? (
                // 87.4 review PR2-L5: 'Member' fallback — never render a raw UUID as a label
                <div>{availableMembers.map((m) => m.username || 'Member').join(', ')}</div>
              ) : null;

            return (
              <div
                key={`${dateStr}-${hour}`}
                className="bg-surface-card"
                onFocus={() => setFocusedCoord({ row: rowIndex, col: colIndex })}
                onClick={() =>
                  onSlotSelect?.({ date: dateStr, hour, dayOfWeek, availableCount, availableMembers })
                }
              >
                <ReadCell
                  variant="merged"
                  row={rowIndex}
                  col={colIndex}
                  rows={totalRows}
                  cols={numCols}
                  focused={focused}
                  onMove={handleCellMove}
                  triggerRef={getCellRef(key)}
                  availableCount={availableCount}
                  totalMembers={totalMembers}
                  ariaLabel={`${dateStr} ${hour}:00, ${availableCount} available`}
                  tooltipContent={tooltipContent}
                  tone={tone}
                  fill={false}
                  className={`min-h-[44px] min-w-[44px] flex flex-col items-center justify-center cursor-pointer transition-shadow rounded-sm ${selectionRing}`}
                >
                  <span className="text-sm font-semibold leading-none">{availableCount}</span>
                </ReadCell>
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
