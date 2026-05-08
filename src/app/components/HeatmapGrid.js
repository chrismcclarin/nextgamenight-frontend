'use client';

import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { format, addDays, nextMonday, startOfWeek, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import HeatmapCell from './HeatmapCell';
import ThresholdSlider from './ThresholdSlider';
import SuggestionCard from './SuggestionCard';
import useSwipeNavigation from './useSwipeNavigation';
import { useTimezone } from '../components/TimezoneProvider';

// HeatmapGrid week semantics (Phase 72 HUX-04):
//   - Page-load default:  nextMonday(today)  (forward-looking poll-suggestions surface)
//   - Today button click: startOfWeek(today) (consistent label semantics across all three surfaces)
//   - Range bounds:       -3 weeks ... +12 weeks from today's Monday

/**
 * Format the week label. If months differ across the week, show both months.
 * (Same idiom as MergedHeatmap.formatWeekLabel — copied here since both are
 * leaf components and the helper is only 4 lines.)
 */
function formatWeekLabel(weekStart) {
  const weekEnd = addDays(weekStart, 6);
  const startMonth = format(weekStart, 'MMM');
  const endMonth = format(weekEnd, 'MMM');
  if (startMonth === endMonth) {
    return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'd')}`;
  }
  return `${format(weekStart, 'MMM d')} - ${format(weekEnd, 'MMM d')}`;
}

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
 * @param {function} props.onWeekChange - Optional callback fired when user changes week via nav (Phase 72 HUX-04)
 */
export default function HeatmapGrid({
  suggestions = [],
  totalMembers = 1,
  timezone: timezoneProp,
  weekStartDate,
  defaultThreshold = 1,
  onSlotSelect,
  onWeekChange,
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

  // Page-load default: nextMonday(today) — this is a forward-looking
  // poll-suggestions surface. Today button (handleToday below) jumps to
  // today's actual Monday for label-accurate semantics. These are two
  // different concerns: initial-render default vs. user-initiated "go to
  // current week" action.
  const initialWeekStart = useMemo(() => {
    if (weekStartDate) return new Date(weekStartDate);
    return nextMonday(new Date());
  }, [weekStartDate]);
  const [weekStart, setWeekStartState] = useState(initialWeekStart);
  // If the weekStartDate prop changes (e.g., callers passing a new value),
  // reset internal state so the prop remains the source of truth on update.
  useEffect(() => {
    setWeekStartState(initialWeekStart);
  }, [initialWeekStart]);

  // Wrap the setter so optional onWeekChange callback fires on every nav
  // action (chevron / Today / swipe).
  const setWeekStart = useCallback(
    (next) => {
      setWeekStartState(next);
      onWeekChange?.(next);
    },
    [onWeekChange]
  );

  // Phase 72 HUX-04: today's actual Monday. Distinct from the page-load
  // nextMonday(today) default — Today button MUST land on this.
  const todayMonday = useMemo(() => startOfWeek(new Date(), { weekStartsOn: 1 }), []);
  const minWeek = useMemo(() => subWeeks(todayMonday, 3), [todayMonday]);
  const maxWeek = useMemo(() => addWeeks(todayMonday, 12), [todayMonday]);
  const canGoBack = weekStart > minWeek;
  const canGoForward = weekStart < maxWeek;

  const handlePrevWeek = useCallback(() => {
    if (canGoBack) setWeekStart(subWeeks(weekStart, 1));
  }, [canGoBack, weekStart, setWeekStart]);
  const handleNextWeek = useCallback(() => {
    if (canGoForward) setWeekStart(addWeeks(weekStart, 1));
  }, [canGoForward, weekStart, setWeekStart]);
  // Today button jumps to today's Monday — NOT nextMonday(today). The button
  // label promises "Today", so it MUST land on the current week (W4 — Plan 03).
  const handleToday = useCallback(() => setWeekStart(todayMonday), [todayMonday, setWeekStart]);
  const isOnTodayMonday = isSameWeek(weekStart, todayMonday, { weekStartsOn: 1 });

  // Swipe gating — visible chevrons remain primary; swipe is a power-user
  // shortcut on (hover: none) devices.
  const [isHoverNone, setIsHoverNone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: none)');
    const update = () => setIsHoverNone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);
  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: handleNextWeek,
    onSwipeRight: handlePrevWeek,
    enabled: isHoverNone,
  });

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
      {/* Week navigation bar — Phase 72 HUX-04: chevrons + label + Today button.
          Page-load default is nextMonday(today); Today button jumps to today's
          actual Monday. -3/+12 week range. */}
      <div className="flex items-center justify-between mb-4 gap-2">
        <button
          onClick={handlePrevWeek}
          disabled={!canGoBack}
          className="px-3 py-2 rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary font-medium"
          aria-label="Previous week"
        >
          &lt;
        </button>
        <div className="flex items-center gap-3 flex-1 justify-center">
          <span className="text-lg font-semibold text-content-primary">
            {formatWeekLabel(weekStart)}
          </span>
          <button
            onClick={handleToday}
            disabled={isOnTodayMonday}
            className="px-3 py-1 text-sm rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary font-medium"
            aria-label="Jump to current week"
          >
            Today
          </button>
        </div>
        <button
          onClick={handleNextWeek}
          disabled={!canGoForward}
          className="px-3 py-2 rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary font-medium"
          aria-label="Next week"
        >
          &gt;
        </button>
      </div>

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

      {/* Grid container with horizontal scroll for mobile.
          Phase 72 HUX-04 — swipe handlers attach to this scroll wrapper so
          horizontal swipes on the grid advance/retreat the week (gated to
          (hover: none) devices). Vertical scroll is preserved by the
          horizontal-vs-vertical guard inside useSwipeNavigation. */}
      <div
        className="overflow-x-auto pb-2"
        onTouchStart={swipeHandlers.onTouchStart}
        onTouchMove={swipeHandlers.onTouchMove}
        onTouchEnd={swipeHandlers.onTouchEnd}
        onTouchCancel={swipeHandlers.onTouchCancel}
      >
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
