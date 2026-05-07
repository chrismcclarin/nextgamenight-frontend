'use client';

import React, { useCallback, useMemo, useRef, useState } from 'react';
import { format, parseISO, isToday } from 'date-fns';
import MergedHeatmapCell from './MergedHeatmapCell';
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

  // ARIA grid roving tabindex pattern (Plan 72-02 a11y goal: WCAG 2.1 AA).
  // Cell focus uses HeatmapTooltip's triggerRef prop (Plan 72-01 API) to expose
  // the cloned trigger DOM element. Linear index = rowIndex * COLS + colIndex.
  const COLS = 7; // 7 days, Mon-Sun
  const totalRows = HOURS.length;
  const cellRefs = useRef([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const setCellRef = useCallback((idx) => (el) => {
    if (el) cellRefs.current[idx] = el;
  }, []);

  const handleKeyDown = useCallback((event) => {
    const idx = focusedIndex;
    const row = Math.floor(idx / COLS);
    const col = idx % COLS;
    let target = idx;
    switch (event.key) {
      case 'ArrowLeft':
        target = row * COLS + Math.max(0, col - 1);
        break;
      case 'ArrowRight':
        target = row * COLS + Math.min(COLS - 1, col + 1);
        break;
      case 'ArrowUp':
        target = Math.max(0, row - 1) * COLS + col;
        break;
      case 'ArrowDown':
        target = Math.min(totalRows - 1, row + 1) * COLS + col;
        break;
      case 'Home':
        target = row * COLS;
        break;
      case 'End':
        target = row * COLS + (COLS - 1);
        break;
      case 'PageUp':
        target = col;
        break;
      case 'PageDown':
        target = (totalRows - 1) * COLS + col;
        break;
      default:
        return;
    }
    event.preventDefault();
    if (target !== idx) {
      setFocusedIndex(target);
      cellRefs.current[target]?.focus();
    }
  }, [focusedIndex, totalRows]);

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
      onKeyDown={handleKeyDown}
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

          {/* 7 cells for this hour */}
          {dates.map((dateStr, colIndex) => {
            const slot = slotsMap[dateStr]?.[hour];
            const isSelected =
              selectedSlot?.date === dateStr && selectedSlot?.hour === hour;
            const linearIndex = rowIndex * COLS + colIndex;

            return (
              <div
                key={`${dateStr}-${hour}`}
                className="bg-surface-card"
                onFocus={() => setFocusedIndex(linearIndex)}
              >
                <MergedHeatmapCell
                  hour={hour}
                  date={dateStr}
                  dayOfWeek={slot?.dayOfWeek ?? 0}
                  availableCount={slot?.availableCount ?? 0}
                  totalMembers={totalMembers}
                  availableMembers={slot?.availableMembers ?? []}
                  isSelected={isSelected}
                  onSelect={onSlotSelect}
                  triggerRef={setCellRef(linearIndex)}
                  tabIndex={focusedIndex === linearIndex ? 0 : -1}
                />
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
