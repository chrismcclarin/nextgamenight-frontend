'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; // useState kept for paintMode
import { format, addDays, addMinutes, startOfWeek, nextMonday, parseISO } from 'date-fns';
// BUG-01 / F-810: slot instants are generated AND parsed against the PROFILE
// timezone via the Phase 84 date-fns-tz layer (v2-pinned, test-pinned). Relative
// (not `@/`) import so this `.js` component resolves under vitest — mirrors
// AvailabilityForm's `../../lib/api` note.
import { wallClockToUtc, utcToWallClock } from '../../lib/datetime';
import WriteCell from './heatmap/WriteCell';

// Zero-pad an hour/minute to two digits for the "yyyy-MM-ddTHH:mm" wall-clock
// string handed to wallClockToUtc. Module-level (stable identity, no deps).
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * AvailabilityGrid - Paint-to-select availability grid component
 *
 * Displays an N-day x 28-slot grid (10:00 AM - 11:30 PM, 30-min intervals)
 * Users can click-and-drag to paint time slots
 *
 * @param {Object} props
 * @param {Array} props.value - Array of { slotId, preference } from RHF Controller
 * @param {function} props.onChange - RHF field.onChange
 * @param {string} props.timezone - User's detected timezone (IANA)
 * @param {boolean} props.disabled - When "I'm unavailable" is checked
 * @param {Date} props.weekStartDate - Optional: override start date (defaults to next Monday)
 * @param {number} props.numDays - Optional: column count, default 7. Plan 71-05
 *   POLL-01 passes the poll's date_window length (1-14 days). The "Select All"
 *   day-checkbox UX still works because it just iterates days[].
 */
export default function AvailabilityGrid({
  value = [],
  onChange,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  disabled = false,
  weekStartDate,
  numDays = 7,
}) {
  // Ref for drag state — must be a ref (not state) so pointer events read the
  // latest value synchronously without waiting for a re-render
  const isDraggingRef = useRef(false);
  const [paintMode, setPaintMode] = useState('preferred'); // 'preferred' | 'if-need-be'
  const [checkedDays, setCheckedDays] = useState([]); // array of day indices (0-6)
  const gridRef = useRef(null);

  // ARIA grid roving tabindex (84-10 / F-803/809): AvailabilityGrid is one of
  // the three roving keyboard INPUT grids. The nav-key + select state machine
  // lives in the shared WriteCell/useHeatmapCell engine; this container owns
  // focusedCoord {row,col} + a cellRefs map keyed by "row:col" and drives REAL
  // DOM focus on each cell's onMove (mirroring WeekGrid).
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

  // Derived: are all days checked? Sized to numDays so the Plan 71-05 polls
  // (1-14 day windows) compute "All" correctly for any window length.
  const allChecked = checkedDays.length === numDays;

  // Calculate the week start date (next Monday if not provided)
  const weekStart = useMemo(() => {
    if (weekStartDate) {
      return new Date(weekStartDate);
    }
    const now = new Date();
    return nextMonday(now);
  }, [weekStartDate]);

  // Generate N days starting from weekStart. numDays defaults to 7 so all
  // existing callers (recurring-schedule magic-token form) keep their shape;
  // Plan 71-05 polls pass the variable-length date_window count.
  const days = useMemo(() => {
    return Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));
  }, [weekStart, numDays]);

  // Generate 28 time slots (10:00 AM - 11:30 PM, 30-min intervals).
  // Matches EventScheduler.js's defaultMinTime/defaultMaxTime range so that
  // the slots a user can vote on cover the same window they can pick when
  // creating an event from the poll's results.
  const timeSlots = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => {
      const baseHour = 10; // 10:00 AM
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

  // Generate slot ID from date and time.
  //
  // BUG-01 / F-810 fix: build a wall-clock string in the PROFILE timezone and
  // convert to a UTC instant via the existing date-fns-tz layer, instead of the
  // old browser-local `setHours`/`toISOString` (which corrupted the persisted
  // instant whenever the profile TZ differed from the browser TZ). Kept as a
  // routed-through-wallClockToUtc function, but it is invoked ONCE per
  // [days, timeSlots, timezone] change to build `slotIdGrid` below — NOT inline
  // per cell per render or per pointermove (see the memoized map).
  const generateSlotId = useCallback(
    (day, timeSlot) => {
      const wall = `${format(day, 'yyyy-MM-dd')}T${pad2(timeSlot.hour)}:${pad2(timeSlot.minute)}`;
      const utc = wallClockToUtc(wall, timezone);
      return (utc || new Date(wall)).toISOString();
    },
    [timezone]
  );

  // Precompute the whole grid's slot-id mapping ONCE per [days, timeSlots,
  // timezone] change. The heavy TZ conversion (wallClockToUtc) runs O(cells)
  // here — never inline on the per-cell render loop or the paint/pointermove
  // handlers, which instead READ from this structure:
  //   - byCoord: "dayIndex:timeSlotIndex" -> slotId  (forward, render + paint)
  //   - byId:    slotId -> { dayIndex, timeSlotIndex, hour, minute }
  //             (reverse, so the cross-day handlers parse a slotId in the SAME
  //              profile TZ that generateSlotId emitted — symmetric by
  //              construction, closing the BUG-01 write/parse asymmetry)
  // `timezone` is a transitive dependency via generateSlotId, so the precomputed
  // ids invalidate and regenerate when the profile TZ changes.
  const slotIdGrid = useMemo(() => {
    const byCoord = new Map();
    const byId = new Map();
    days.forEach((day, dayIndex) => {
      timeSlots.forEach((ts, timeSlotIndex) => {
        const slotId = generateSlotId(day, ts);
        byCoord.set(`${dayIndex}:${timeSlotIndex}`, slotId);
        byId.set(slotId, { dayIndex, timeSlotIndex, hour: ts.hour, minute: ts.minute });
      });
    });
    return { byCoord, byId };
  }, [days, timeSlots, generateSlotId]);

  // O(1) forward lookup: the render loop and paint/toggle/clear handlers read
  // slot ids from here instead of invoking the TZ conversion inline.
  const slotIdForCoord = useCallback(
    (dayIndex, timeSlotIndex) => slotIdGrid.byCoord.get(`${dayIndex}:${timeSlotIndex}`),
    [slotIdGrid]
  );

  // Toggle a single per-day "All" column checkbox. Plan 71-05 manual-checkpoint
  // Bug 1 (round 2) fix: previously this only flipped `checkedDays` state,
  // which made subsequent CLICKS broadcast across days but did NOT paint
  // anything in the day column on its own. Users clicking the per-day "All"
  // header expected every slot in that column to fill — and got an empty
  // submit + "You haven't selected a timeframe" error.
  //
  // New behavior: toggling a per-day "All" ON paints every slot in THAT day's
  // column with the current paintMode. Toggling OFF clears every slot in that
  // day's column. The cross-day broadcast for subsequent clicks still works
  // because we keep `checkedDays` in sync.
  //
  // Declared AFTER days/timeSlots/generateSlotId because the callback closes
  // over them; declaring earlier triggers a TDZ ReferenceError at render.
  const toggleDayCheck = useCallback((dayIndex) => {
    const day = days[dayIndex];
    if (!day) return;
    const isCurrentlyChecked = checkedDays.includes(dayIndex);
    if (isCurrentlyChecked) {
      // Uncheck: remove from checkedDays AND clear every slot in this day column.
      setCheckedDays((prev) => prev.filter((d) => d !== dayIndex));
      const dayKeys = new Set(timeSlots.map((_, ti) => slotIdForCoord(dayIndex, ti)));
      const filtered = value.filter((s) => !dayKeys.has(s.slotId));
      if (filtered.length !== value.length) {
        onChange?.(filtered);
      }
    } else {
      // Check: add to checkedDays AND paint every empty slot in this day column.
      setCheckedDays((prev) => [...prev, dayIndex]);
      const existing = new Set(value.map((s) => s.slotId));
      const additions = [];
      timeSlots.forEach((_, ti) => {
        const id = slotIdForCoord(dayIndex, ti);
        if (id && !existing.has(id)) {
          additions.push({ slotId: id, preference: paintMode });
        }
      });
      if (additions.length > 0) {
        onChange?.([...value, ...additions]);
      }
    }
  }, [checkedDays, days, timeSlots, slotIdForCoord, value, paintMode, onChange]);

  // Toggle Select All: when toggled ON, paint every visible slot with the
  // current paint mode (matches user expectation "All = I'm available for
  // everything in this window"). When toggled OFF, clear every painted slot.
  // Also keeps `checkedDays` in sync so subsequent per-day clicks still get
  // the cross-day broadcast behavior. Plan 71-05 manual-checkpoint Bug 1 fix:
  // previously this only set checkedDays without painting, so submitting after
  // toggling "All" failed validation with "Pick at least one time slot".
  const toggleSelectAll = useCallback(() => {
    const willCheckAll = checkedDays.length !== numDays;
    if (willCheckAll) {
      setCheckedDays(Array.from({ length: numDays }, (_, i) => i));
      // Paint every slot in the grid that isn't already painted.
      const existing = new Set(value.map((s) => s.slotId));
      const additions = [];
      days.forEach((day, di) => {
        timeSlots.forEach((ts, ti) => {
          const id = slotIdForCoord(di, ti);
          if (id && !existing.has(id)) {
            additions.push({ slotId: id, preference: paintMode });
          }
        });
      });
      if (additions.length > 0) {
        onChange?.([...value, ...additions]);
      }
    } else {
      setCheckedDays([]);
      // Uncheck All clears every painted slot — symmetric with the check path.
      onChange?.([]);
    }
  }, [checkedDays.length, numDays, days, timeSlots, slotIdForCoord, value, paintMode, onChange]);

  // Format time label for the row. Pure hour/minute -> "h:mm a" (byte-identical
  // to the prior `format(date, 'h:mm a')` output) with no `setHours` — the label
  // is a fixed time-of-day, independent of any date or timezone.
  const formatTimeLabel = useCallback((timeSlot) => {
    const h12 = timeSlot.hour % 12 || 12;
    const ampm = timeSlot.hour >= 12 ? 'PM' : 'AM';
    return `${h12}:${pad2(timeSlot.minute)} ${ampm}`;
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

  // Reverse slot-id parsers — BUG-01 / F-810.
  //
  // These interpret a slotId in the SAME profile timezone that generateSlotId
  // emitted (via the precomputed byId map, or utcToWallClock as the symmetric
  // fallback), NOT the old browser-local `getFullYear`/`getDate`/`getHours`.
  // Generation and parsing now share one TZ basis, so the cross-day branches of
  // handleToggleSlot / handlePaintSlot / handleClearAll stay correct when the
  // profile TZ differs from the browser TZ. They run once per handler call
  // (discrete pointer/clear events) — never per cell per render.

  // Helper: get the day index from a slotId.
  const getDayIndexFromSlotId = useCallback(
    (slotId) => {
      const meta = slotIdGrid.byId.get(slotId);
      if (meta) return meta.dayIndex;
      // Fallback: interpret in the profile TZ and match against the grid's days.
      const wc = utcToWallClock(slotId, timezone);
      if (!wc) return -1;
      return days.findIndex((d) => {
        const [dy, dm, dd] = format(d, 'yyyy-MM-dd').split('-').map(Number);
        return dy === wc.year && dm === wc.month && dd === wc.day;
      });
    },
    [slotIdGrid, days, timezone]
  );

  // Helper: extract { hour, minute } from a slotId in the profile TZ.
  const getTimeSlotFromSlotId = useCallback(
    (slotId) => {
      const meta = slotIdGrid.byId.get(slotId);
      if (meta) return { hour: meta.hour, minute: meta.minute };
      const wc = utcToWallClock(slotId, timezone);
      return wc ? { hour: wc.hours, minute: wc.minutes } : { hour: 0, minute: 0 };
    },
    [slotIdGrid, timezone]
  );

  // Helper: get the time-slot index from a slotId (used by the cross-day
  // handlers to re-derive the same time on every checked day).
  const getTimeSlotIndexFromSlotId = useCallback(
    (slotId) => {
      const meta = slotIdGrid.byId.get(slotId);
      if (meta) return meta.timeSlotIndex;
      const { hour, minute } = getTimeSlotFromSlotId(slotId);
      return timeSlots.findIndex((ts) => ts.hour === hour && ts.minute === minute);
    },
    [slotIdGrid, getTimeSlotFromSlotId, timeSlots]
  );

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
          const timeSlotIndex = getTimeSlotIndexFromSlotId(slotId);
          const daysToFill = checkedDays.includes(clickedDayIndex)
            ? checkedDays
            : [clickedDayIndex]; // unchecked day = single slot only
          const newSlots = [];
          daysToFill.forEach((di) => {
            const id = slotIdForCoord(di, timeSlotIndex);
            if (id && !slotMap.has(id)) {
              newSlots.push({ slotId: id, preference: paintMode });
            }
          });
          if (newSlots.length > 0) {
            onChange?.([...value, ...newSlots]);
          }
        }
      }
    },
    [value, onChange, slotMap, paintMode, checkedDays, slotIdForCoord, getDayIndexFromSlotId, getTimeSlotIndexFromSlotId]
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
        const timeSlotIndex = getTimeSlotIndexFromSlotId(slotId);
        const daysToFill = checkedDays.includes(paintedDayIndex)
          ? checkedDays
          : [paintedDayIndex]; // unchecked day = single cell only
        const newSlots = [];
        daysToFill.forEach((di) => {
          const id = slotIdForCoord(di, timeSlotIndex);
          if (id && !slotMap.has(id)) {
            newSlots.push({ slotId: id, preference: paintMode });
          }
        });
        if (newSlots.length > 0) {
          onChange?.([...value, ...newSlots]);
        }
      }
    },
    [value, onChange, slotMap, paintMode, checkedDays, slotIdForCoord, getDayIndexFromSlotId, getTimeSlotIndexFromSlotId]
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

  // Keyboard select-cycle (WriteCell reports the NEXT preference after Enter/
  // Space). Single-cell edit by design: arrow+select keyboard nav operates on
  // the focused cell only (the cross-day "All"/checkbox broadcast stays a
  // pointer-paint affordance). next === null removes the slot.
  const handleKeyboardSelect = useCallback(
    (row, col, next) => {
      const day = days[col];
      const ts = timeSlots[row];
      if (!day || !ts) return;
      const slotId = slotIdForCoord(col, row);
      if (!slotId) return;
      const without = value.filter((s) => s.slotId !== slotId);
      onChange?.(next === null ? without : [...without, { slotId, preference: next }]);
    },
    [days, timeSlots, slotIdForCoord, value, onChange]
  );

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
        <div className="text-sm text-content-secondary">
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
                px-3 py-1.5 text-sm font-medium rounded-btn border border-line
                text-content-secondary bg-surface-card
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-card-hover'}
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
          <div className="w-4 h-4 bg-green-300 border border-line rounded-sm" />
          <span className="text-content-secondary">Preferred</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-yellow-300 border border-line rounded-sm" />
          <span className="text-content-secondary">If Need Be</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-surface-elevated border border-line rounded-sm" />
          <span className="text-content-secondary">Not Available</span>
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
                className="w-24 sm:w-28 flex-shrink-0 text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
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
                <span className="text-xs text-content-muted font-medium">All</span>
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
              <div className="w-16 sm:w-20 flex-shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium">
                {formatTimeLabel(timeSlot)}
              </div>

              {/* Day columns. The wrapper carries the cell dims + border; the
                  shared WriteCell fills it with the byte-identical preference
                  color and owns roving keyboard + pointer-paint. */}
              {days.map((day, colIndex) => {
                // Read the precomputed slot id — the TZ conversion already ran
                // once in slotIdGrid, so this hot per-cell path stays O(1).
                const slotId = slotIdForCoord(colIndex, rowIndex);
                const preference = slotMap.get(slotId) || null;
                const key = coordKey(rowIndex, colIndex);
                const focused = focusedCoord.row === rowIndex && focusedCoord.col === colIndex;

                return (
                  <div
                    key={slotId}
                    className="w-24 sm:w-28 flex-shrink-0 h-12 sm:h-14 border border-line"
                    onFocus={() => setFocusedCoord({ row: rowIndex, col: colIndex })}
                  >
                    <WriteCell
                      row={rowIndex}
                      col={colIndex}
                      rows={timeSlots.length}
                      cols={numDays}
                      focused={focused}
                      disabled={disabled}
                      preference={preference}
                      slotId={slotId}
                      onMove={handleCellMove}
                      onSelect={(next) => handleKeyboardSelect(rowIndex, colIndex, next)}
                      onPointerDown={handlePointerDown}
                      onPointerEnter={handlePointerEnter}
                      cellRef={getCellRef(key)}
                      className="transition-colors duration-75"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selection summary */}
      <div className="mt-3 text-sm text-content-secondary">
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
