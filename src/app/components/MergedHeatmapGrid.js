'use client';

import React, { useMemo } from 'react';
import { format, parseISO, isToday } from 'date-fns';
import MergedHeatmapCell from './MergedHeatmapCell';

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

  // If no slots, show placeholder
  if (dates.length === 0) {
    return (
      <div className="text-center text-gray-500 py-8">
        No availability data for this week.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-8 gap-px bg-gray-200 rounded-lg overflow-hidden">
      {/* Header row: empty corner + 7 day headers */}
      <div className="bg-white p-2" /> {/* Empty corner */}
      {dates.map((dateStr, idx) => {
        const dateObj = parseISO(dateStr);
        const isTodayDate = isToday(dateObj);
        return (
          <div
            key={dateStr}
            className={`bg-white p-2 text-center ${isTodayDate ? 'bg-blue-50' : ''}`}
          >
            <div className="text-xs font-semibold text-gray-600">
              {DAY_LABELS[idx]}
            </div>
            <div
              className={`text-sm font-bold ${isTodayDate ? 'text-blue-600' : 'text-gray-900'}`}
            >
              {format(dateObj, 'd')}
            </div>
          </div>
        );
      })}

      {/* Body rows: hour label + 7 cells per row */}
      {HOURS.map((hour) => (
        <React.Fragment key={`hour-${hour}`}>
          {/* Hour label */}
          <div
            className="bg-white p-2 flex items-center justify-end"
          >
            <span className="text-xs text-gray-500 font-medium whitespace-nowrap">
              {formatHourLabel(hour)}
            </span>
          </div>

          {/* 7 cells for this hour */}
          {dates.map((dateStr) => {
            const slot = slotsMap[dateStr]?.[hour];
            const isSelected =
              selectedSlot?.date === dateStr && selectedSlot?.hour === hour;

            return (
              <div key={`${dateStr}-${hour}`} className="bg-white">
                <MergedHeatmapCell
                  hour={hour}
                  date={dateStr}
                  dayOfWeek={slot?.dayOfWeek ?? 0}
                  availableCount={slot?.availableCount ?? 0}
                  totalMembers={totalMembers}
                  availableMembers={slot?.availableMembers ?? []}
                  isSelected={isSelected}
                  onSelect={onSlotSelect}
                />
              </div>
            );
          })}
        </React.Fragment>
      ))}
    </div>
  );
}
