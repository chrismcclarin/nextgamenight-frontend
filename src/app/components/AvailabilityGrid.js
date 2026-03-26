'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; // useState kept for paintMode
import { format, addDays, addMinutes, startOfWeek, nextMonday, parseISO } from 'date-fns';
import { formatInTimeZone, toZonedTime } from 'date-fns-tz';
import TimeSlotCell from './TimeSlotCell';

/**
 * AvailabilityGrid - Paint-to-select availability grid component
 *
 * Displays a 7-day x 12-slot grid (5PM-11PM, 30-min intervals)
 * Users can click-and-drag to paint time slots
 *
 * @param {Object} props
 * @param {Array} props.value - Array of { slotId, preference } from RHF Controller
 * @param {function} props.onChange - RHF field.onChange
 * @param {string} props.timezone - User's detected timezone (IANA)
 * @param {boolean} props.disabled - When "I'm unavailable" is checked
 * @param {Date} props.weekStartDate - Optional: override week start (defaults to next Monday)
 */
export default function AvailabilityGrid({
  value = [],
  onChange,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  disabled = false,
  weekStartDate,
}) {
  // Ref for drag state — must be a ref (not state) so pointer events read the
  // latest value synchronously without waiting for a re-render
  const isDraggingRef = useRef(false);
  const [paintMode, setPaintMode] = useState('preferred'); // 'preferred' | 'if-need-be'
  const [checkedDays, setCheckedDays] = useState([]); // array of day indices (0-6)
  const gridRef = useRef(null);

  // Derived: are all 7 days checked?
  const allChecked = checkedDays.length === 7;

  // Toggle a single day checkbox
  const toggleDayCheck = useCallback((dayIndex) => {
    setCheckedDays((prev) =>
      prev.includes(dayIndex)
        ? prev.filter((d) => d !== dayIndex)
        : [...prev, dayIndex]
    );
  }, []);

  // Toggle Select All: check all 7 or uncheck all
  const toggleSelectAll = useCallback(() => {
    setCheckedDays((prev) => (prev.length === 7 ? [] : [0, 1, 2, 3, 4, 5, 6]));
  }, []);

  // Calculate the week start date (next Monday if not provided)
  const weekStart = useMemo(() => {
    if (weekStartDate) {
      return new Date(weekStartDate);
    }
    const now = new Date();
    return nextMonday(now);
  }, [weekStartDate]);

  // Generate 7 days starting from weekStart
  const days = useMemo(() => {
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  }, [weekStart]);

  // Generate 12 time slots (5:00 PM - 10:30 PM, 30-min intervals)
  const timeSlots = useMemo(() => {
    return Array.from({ length: 12 }, (_, i) => {
      const baseHour = 17; // 5:00 PM
      const minutes = i * 30;
      const hour = baseHour + Math.floor(minutes / 60);
      const min = minutes % 60;
      return { hour, minute: min };
    });
  }, []);

  // Convert value array to a map for efficient lookup
  const slotMap = useMemo(() => {
    const map = new Map();
    value.forEach(({ slotId, preference }) => {
      map.set(slotId, preference);
    });
    return map;
  }, [value]);

  // Generate slot ID from date and time
  const generateSlotId = useCallback((day, timeSlot) => {
    const date = new Date(day);
    date.setHours(timeSlot.hour, timeSlot.minute, 0, 0);
    return date.toISOString();
  }, []);

  // Format time label for the row
  const formatTimeLabel = useCallback((timeSlot) => {
    const date = new Date();
    date.setHours(timeSlot.hour, timeSlot.minute, 0, 0);
    return format(date, 'h:mm a');
  }, []);

  // Format day header
  const formatDayHeader = useCallback((day) => {
    return format(day, 'EEE M/d');
  }, []);

  // Get friendly timezone display name
  const getTimezoneDisplay = useCallback((tz) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      });
      const parts = formatter.formatToParts(new Date());
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      return tzPart ? `${tz} (${tzPart.value})` : tz;
    } catch {
      return tz;
    }
  }, []);

  // Helper: get the day index (0-6) from a slotId (ISO date string)
  const getDayIndexFromSlotId = useCallback(
    (slotId) => {
      const slotDate = new Date(slotId);
      const slotY = slotDate.getFullYear();
      const slotM = slotDate.getMonth();
      const slotD = slotDate.getDate();
      return days.findIndex((d) => {
        return d.getFullYear() === slotY && d.getMonth() === slotM && d.getDate() === slotD;
      });
    },
    [days]
  );

  // Helper: extract { hour, minute } from a slotId
  const getTimeSlotFromSlotId = useCallback((slotId) => {
    const d = new Date(slotId);
    return { hour: d.getHours(), minute: d.getMinutes() };
  }, []);

  // Handle slot toggle (click)
  const handleToggleSlot = useCallback(
    (slotId) => {
      const currentPreference = slotMap.get(slotId);

      if (currentPreference) {
        // Remove: always per-day only (remove just this one slot)
        const newValue = value.filter((s) => s.slotId !== slotId);
        onChange?.(newValue);
      } else {
        // Add slot with current paint mode
        if (checkedDays.length === 0) {
          // No checkboxes checked — single-day behavior
          const newValue = [...value, { slotId, preference: paintMode }];
          onChange?.(newValue);
        } else {
          // Cross-day: add matching time on all checked days
          const clickedDayIndex = getDayIndexFromSlotId(slotId);
          const timeSlot = getTimeSlotFromSlotId(slotId);
          const daysToFill = checkedDays.includes(clickedDayIndex)
            ? checkedDays
            : [clickedDayIndex]; // unchecked day = single slot only
          const newSlots = [];
          daysToFill.forEach((di) => {
            const id = generateSlotId(days[di], timeSlot);
            if (!slotMap.has(id)) {
              newSlots.push({ slotId: id, preference: paintMode });
            }
          });
          if (newSlots.length > 0) {
            onChange?.([...value, ...newSlots]);
          }
        }
      }
    },
    [value, onChange, slotMap, paintMode, checkedDays, days, generateSlotId, getDayIndexFromSlotId, getTimeSlotFromSlotId]
  );

  // Handle slot paint (drag - add only, additive across checked days)
  const handlePaintSlot = useCallback(
    (slotId) => {
      if (checkedDays.length === 0) {
        // No checkboxes — single slot paint (original behavior)
        if (!slotMap.has(slotId)) {
          const newValue = [...value, { slotId, preference: paintMode }];
          onChange?.(newValue);
        }
      } else {
        // Cross-day paint: add matching time on all checked days
        const paintedDayIndex = getDayIndexFromSlotId(slotId);
        const timeSlot = getTimeSlotFromSlotId(slotId);
        const daysToFill = checkedDays.includes(paintedDayIndex)
          ? checkedDays
          : [paintedDayIndex]; // unchecked day = single cell only
        const newSlots = [];
        daysToFill.forEach((di) => {
          const id = generateSlotId(days[di], timeSlot);
          if (!slotMap.has(id)) {
            newSlots.push({ slotId: id, preference: paintMode });
          }
        });
        if (newSlots.length > 0) {
          onChange?.([...value, ...newSlots]);
        }
      }
    },
    [value, onChange, slotMap, paintMode, checkedDays, days, generateSlotId, getDayIndexFromSlotId, getTimeSlotFromSlotId]
  );

  // Pointer event handlers
  const handlePointerDown = useCallback(
    (slotId) => {
      isDraggingRef.current = true;
      handleToggleSlot(slotId);
    },
    [handleToggleSlot]
  );

  const handlePointerEnter = useCallback(
    (slotId) => {
      if (isDraggingRef.current) {
        handlePaintSlot(slotId);
      }
    },
    [handlePaintSlot]
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Global pointer up listener for catching release outside grid
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isDraggingRef.current = false;
    };

    document.addEventListener('pointerup', handleGlobalPointerUp);
    document.addEventListener('pointercancel', handleGlobalPointerUp);

    return () => {
      document.removeEventListener('pointerup', handleGlobalPointerUp);
      document.removeEventListener('pointercancel', handleGlobalPointerUp);
    };
  }, []);

  // Toggle paint mode
  const togglePaintMode = useCallback(() => {
    setPaintMode((prev) => (prev === 'preferred' ? 'if-need-be' : 'preferred'));
  }, []);

  // Clear all selections (checkbox-aware)
  const handleClearAll = useCallback(() => {
    if (checkedDays.length === 0) {
      // No checkboxes — clear everything
      onChange?.([]);
    } else {
      // Only clear slots belonging to checked days
      const filtered = value.filter((s) => {
        const dayIdx = getDayIndexFromSlotId(s.slotId);
        return !checkedDays.includes(dayIdx);
      });
      onChange?.(filtered);
    }
  }, [onChange, value, checkedDays, getDayIndexFromSlotId]);

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {/* Timezone display */}
        <div className="text-sm text-gray-600">
          Times shown in: <span className="font-medium">{getTimezoneDisplay(timezone)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Paint mode toggle */}
          <button
            type="button"
            onClick={togglePaintMode}
            disabled={disabled}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-md border
              transition-colors
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80'}
              ${
                paintMode === 'preferred'
                  ? 'bg-green-100 border-green-400 text-green-800'
                  : 'bg-yellow-100 border-yellow-400 text-yellow-800'
              }
            `}
          >
            {paintMode === 'preferred' ? 'Adding: Preferred' : 'Adding: If Need Be'}
          </button>

          {/* Clear all button */}
          {value.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={disabled}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-md border border-gray-300
                text-gray-700 bg-white
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-50'}
              `}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-green-300 border border-gray-300 rounded-sm" />
          <span className="text-gray-600">Preferred</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-yellow-300 border border-gray-300 rounded-sm" />
          <span className="text-gray-600">If Need Be</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-gray-100 border border-gray-300 rounded-sm" />
          <span className="text-gray-600">Not Available</span>
        </div>
      </div>

      {/* Grid container with horizontal scroll for mobile */}
      <div
        ref={gridRef}
        className="overflow-x-auto pb-2"
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerUp={handlePointerUp}
      >
        <div
          className="min-w-max"
          style={{ touchAction: 'none' }}
        >
          {/* Day headers */}
          <div className="flex">
            {/* Spacer for time labels column */}
            <div className="w-16 sm:w-20 flex-shrink-0" />

            {/* Day headers */}
            {days.map((day, index) => (
              <div
                key={day.toISOString()}
                className="w-24 sm:w-28 flex-shrink-0 text-center py-2 text-sm font-medium text-gray-700 border-b border-gray-300"
              >
                {formatDayHeader(day)}
              </div>
            ))}
          </div>

          {/* Day checkboxes row */}
          <div className="flex">
            {/* Select All toggle in the time-label spacer */}
            <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2">
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleSelectAll}
                  disabled={disabled}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-xs text-gray-500 font-medium">All</span>
              </label>
            </div>

            {/* Individual day checkboxes */}
            {days.map((day, index) => (
              <div
                key={`cb-${day.toISOString()}`}
                className="w-24 sm:w-28 flex-shrink-0 flex items-center justify-center py-1"
              >
                <input
                  type="checkbox"
                  checked={checkedDays.includes(index)}
                  onChange={() => toggleDayCheck(index)}
                  disabled={disabled}
                  className="w-4 h-4 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>

          {/* Time slot rows */}
          {timeSlots.map((timeSlot, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex">
              {/* Time label column — mirrors the header spacer width */}
              <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-gray-600 font-medium">
                {formatTimeLabel(timeSlot)}
              </div>

              {/* Day columns */}
              {days.map((day) => {
                const slotId = generateSlotId(day, timeSlot);
                const preference = slotMap.get(slotId) || null;

                return (
                  <div key={slotId} className="w-24 sm:w-28 flex-shrink-0">
                    <TimeSlotCell
                      slotId={slotId}
                      preference={preference}
                      onPointerDown={handlePointerDown}
                      onPointerEnter={handlePointerEnter}
                      disabled={disabled}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selection summary */}
      <div className="mt-3 text-sm text-gray-600">
        {value.length === 0 ? (
          <span>Click and drag to select your available times</span>
        ) : (
          <span>
            {value.filter((s) => s.preference === 'preferred').length} preferred,{' '}
            {value.filter((s) => s.preference === 'if-need-be').length} if-need-be slots selected
          </span>
        )}
      </div>
    </div>
  );
}

// Named export for flexibility
export { AvailabilityGrid };
