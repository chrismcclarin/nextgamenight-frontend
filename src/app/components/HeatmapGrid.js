'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import { format, addDays, nextMonday } from 'date-fns';
import HeatmapCell from './HeatmapCell';
import ThresholdSlider from './ThresholdSlider';
import SuggestionCard from './SuggestionCard';
import { useTimezone } from '../components/TimezoneProvider';

/**
 * HeatmapGrid - Displays collective availability as a color-coded heatmap
 *
 * Shows a 7-day x 12-slot grid (5PM-11PM, 30-min intervals) with:
 * - Color intensity based on participant count per slot
 * - Threshold slider to filter out slots below minimum
 * - Tooltip showing participant names on hover
 *
 * @param {Object} props
 * @param {Array} props.suggestions - Array of suggestion objects from API
 * @param {number} props.totalMembers - Total number of group members
 * @param {string} props.timezone - User's timezone (IANA format)
 * @param {Date} props.weekStartDate - Optional: override week start (defaults to next Monday)
 * @param {number} props.defaultThreshold - Initial threshold value (default: 1)
 * @param {function} props.onSlotSelect - Optional callback when a slot is clicked
 */
export default function HeatmapGrid({
  suggestions = [],
  totalMembers = 1,
  timezone: timezoneProp,
  weekStartDate,
  defaultThreshold = 1,
  onSlotSelect,
  // Props for SuggestionCard integration
  groupId,
  isAdmin = false,
  pollClosed = false,
  onEventCreated,
}) {
  const { timezone: contextTimezone } = useTimezone();
  const timezone = timezoneProp || contextTimezone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  const [threshold, setThreshold] = useState(defaultThreshold);

  // ARIA grid roving tabindex pattern: only the focused cell holds tabIndex=0;
  // arrow keys move focus and update tabIndex via state. Cell focus uses
  // HeatmapTooltip's triggerRef prop (Plan 72-01 API) to expose the cloned
  // trigger DOM element. Linear index = rowIndex * COLS + colIndex.
  const COLS = 7; // 7 days
  const cellRefs = useRef([]);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const setCellRef = useCallback((idx) => (el) => {
    if (el) cellRefs.current[idx] = el;
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

  // Build slot map from suggestions for O(1) lookup
  const slotMap = useMemo(() => {
    const map = new Map();
    suggestions.forEach((s) => {
      // Key by suggested_start ISO string
      map.set(s.suggested_start, s);
    });
    return map;
  }, [suggestions]);

  // Calculate viable count (slots meeting threshold)
  const viableCount = useMemo(() => {
    return suggestions.filter((s) => s.participant_count >= threshold).length;
  }, [suggestions, threshold]);

  // Get top 5 suggestions meeting threshold for card display
  const topSuggestions = useMemo(() => {
    return suggestions
      .filter((s) => s.participant_count >= threshold)
      .sort((a, b) => b.score - a.score || b.participant_count - a.participant_count)
      .slice(0, 5);
  }, [suggestions, threshold]);

  // Generate slot ID from date and time (matching AvailabilityGrid format)
  const generateSlotId = useCallback((day, timeSlot) => {
    const date = new Date(day);
    date.setHours(timeSlot.hour, timeSlot.minute, 0, 0);
    return date.toISOString();
  }, []);

  // Format time for display
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

  // Handle slot click
  const handleSlotClick = useCallback(
    (slotId, suggestion) => {
      if (onSlotSelect && suggestion && suggestion.participant_count >= threshold) {
        onSlotSelect(slotId, suggestion);
      }
    },
    [onSlotSelect, threshold]
  );

  // Roving-tabindex arrow-key navigation (Plan 72-02 a11y goal: WCAG 2.1 AA).
  // Total cells = timeSlots.length × COLS. The tooltip auto-reveals on focus
  // via HeatmapTooltip's useFocus interaction; Esc dismisses (also handled by
  // the primitive's useDismiss).
  const totalRows = timeSlots.length;
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
        return; // not a nav key — bail without preventDefault
    }
    if (target !== idx) {
      event.preventDefault();
      setFocusedIndex(target);
      cellRefs.current[target]?.focus();
    } else {
      event.preventDefault();
    }
  }, [focusedIndex, totalRows]);

  return (
    <div className="w-full">
      {/* Threshold slider */}
      <div className="mb-4">
        <ThresholdSlider
          value={threshold}
          onChange={setThreshold}
          min={1}
          max={totalMembers}
          viableCount={viableCount}
        />
      </div>

      {/* Timezone display */}
      <div className="text-sm text-content-secondary mb-3">
        Times shown in: <span className="font-medium">{getTimezoneDisplay(timezone)}</span>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <span className="text-content-secondary">Fewer available</span>
        <div className="flex gap-1">
          <div className="w-6 h-4 bg-surface-elevated border border-line rounded-sm" />
          <div className="w-6 h-4 bg-yellow-200 border border-yellow-400 rounded-sm" />
          <div className="w-6 h-4 bg-yellow-400 border border-yellow-500 rounded-sm" />
          <div className="w-6 h-4 bg-orange-400 border border-orange-500 rounded-sm" />
          <div className="w-6 h-4 bg-red-500 border border-red-600 rounded-sm" />
        </div>
        <span className="text-content-secondary">More available</span>
      </div>

      {/* Grid container with horizontal scroll for mobile */}
      <div className="overflow-x-auto pb-2">
        <div
          className="min-w-max"
          role="grid"
          aria-label="Availability heatmap"
          onKeyDown={handleKeyDown}
        >
          {/* Day headers */}
          <div className="flex" role="row">
            {/* Spacer for time labels column */}
            <div className="w-16 sm:w-20 flex-shrink-0" role="columnheader" />

            {/* Day headers */}
            {days.map((day) => (
              <div
                key={day.toISOString()}
                className="w-24 sm:w-28 flex-shrink-0 text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
                role="columnheader"
              >
                {formatDayHeader(day)}
              </div>
            ))}
          </div>

          {/* Time slot rows */}
          {timeSlots.map((timeSlot, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex" role="row">
              {days.map((day, colIndex) => {
                const slotId = generateSlotId(day, timeSlot);
                const suggestion = slotMap.get(slotId);
                const participantCount = suggestion?.participant_count || 0;
                const preferredCount = suggestion?.preferred_count || 0;
                const participants = suggestion?.participants || [];
                const hidden = participantCount < threshold;
                const linearIndex = rowIndex * COLS + colIndex;

                return (
                  <div
                    key={slotId}
                    className="flex-shrink-0"
                    onClick={() => handleSlotClick(slotId, suggestion)}
                    onFocus={() => setFocusedIndex(linearIndex)}
                  >
                    <HeatmapCell
                      slotId={slotId}
                      participantCount={participantCount}
                      preferredCount={preferredCount}
                      participants={participants}
                      totalMembers={totalMembers}
                      hidden={hidden}
                      timeLabel={formatTimeLabel(timeSlot)}
                      showTimeLabel={colIndex === 0}
                      triggerRef={setCellRef(linearIndex)}
                      tabIndex={focusedIndex === linearIndex ? 0 : -1}
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Summary */}
      <div className="mt-3 text-sm text-content-secondary">
        {suggestions.length === 0 ? (
          <span>No availability data yet. Responses will appear here as members submit them.</span>
        ) : viableCount === 0 ? (
          <span className="text-amber-600">
            No time slots meet the minimum of {threshold} participants.
            Try lowering the threshold.
          </span>
        ) : (
          <span>
            Showing {viableCount} slot{viableCount !== 1 ? 's' : ''} with {threshold}+ participants.
            Click a slot to schedule an event.
          </span>
        )}
      </div>

      {/* Top Suggestions Cards - Show when there are viable slots */}
      {topSuggestions.length > 0 && groupId && (
        <div className="mt-6 border-t border-line pt-4">
          <h4 className="text-sm font-semibold text-content-secondary mb-3">
            Top Available Time Slots
          </h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {topSuggestions.map((suggestion) => (
              <SuggestionCard
                key={suggestion.id}
                suggestion={suggestion}
                groupId={groupId}
                isAdmin={isAdmin}
                pollClosed={pollClosed}
                onEventCreated={onEventCreated}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Named export for flexibility
export { HeatmapGrid };
