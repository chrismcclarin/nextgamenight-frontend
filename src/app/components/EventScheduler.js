'use client';

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, differenceInMinutes, setHours, setMinutes, addMinutes, addDays, getHours, getMinutes } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Calendar styling is handled by globals.css .rbc-* overrides (from design system Plan 01)

const locales = {
  'en-US': enUS,
};

const localizer = dateFnsLocalizer({
  format,
  parse,
  startOfWeek: (date) => startOfWeek(date, { weekStartsOn: 1 }),
  getDay,
  locales,
});

export default function EventScheduler({
  onTimeSelected,
  initialDate,
  minTime,
  maxTime,
  step = 30,
  events = [],
  heatmapData = null,
  // CAL-05: initial visual view ('week' | 'day'). Day-tap entry passes
  // 'day' so the picker opens focused on the tapped day. Default 'week'
  // keeps the header-button entry path unchanged. The user can still
  // toggle between week/day after mount via react-big-calendar's view
  // picker — defaultView only seeds the initial mode.
  defaultView = 'week',
  // Phase 66-01: controlled selected slot. Parent (createEvent.js) owns
  // the canonical date/time state via newEvent.start_date + duration_minutes
  // and derives this prop with a useMemo. Round-trips visual ↔ manual
  // mode are preserved because both modes read/write the same parent state.
  selectedSlot = null,
  // Phase 66-03 CREVT-06: parent-derived peak-availability time. When
  // present, react-big-calendar scrolls so this time-of-day is at the top
  // of the visible viewport. Date portion is ignored by scrollToTime.
  // null = no auto-scroll (use the calendar's default scroll position).
  scrollToTime = null,
}) {
  const [currentDate, setCurrentDate] = useState(initialDate || new Date());
  const [currentView, setCurrentView] = useState(
    defaultView === 'day' ? 'day' : 'week'
  );

  // Build heatmap lookup: "localDate_localHour" -> slot
  // Backend returns UTC dates/hours -- convert to local so keys match the calendar
  const heatmapLookup = useMemo(() => {
    if (!heatmapData?.slots) return new Map();
    const map = new Map();
    for (const slot of heatmapData.slots) {
      const utcDate = new Date(`${slot.date}T${String(slot.hour).padStart(2, '0')}:00:00Z`);
      const localDateStr = format(utcDate, 'yyyy-MM-dd');
      const localHour = utcDate.getHours();
      map.set(`${localDateStr}_${localHour}`, slot);
    }
    return map;
  }, [heatmapData]);

  const totalMembers = heatmapData?.totalMembers || 0;
  const membersWithoutDataCount = heatmapData?.membersWithoutDataCount || 0;
  const totalGroupMembers = heatmapData?.totalGroupMembers || 0;

  // Build conflict lookup: "localDate_localHour" -> array of { user_id, username }
  const conflictLookup = useMemo(() => {
    if (!heatmapData?.gcalConflicts) return new Map();
    const map = new Map();
    for (const c of heatmapData.gcalConflicts) {
      const utcDate = new Date(`${c.date}T${String(c.hour).padStart(2, '0')}:00:00Z`);
      const localDateStr = format(utcDate, 'yyyy-MM-dd');
      const localHour = utcDate.getHours();
      const key = `${localDateStr}_${localHour}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push({ user_id: c.user_id, username: c.username });
    }
    return map;
  }, [heatmapData]);

  // Set default min/max times (10 AM to midnight)
  const defaultMinTime = minTime || setHours(setMinutes(new Date(0, 0, 0), 0), 10); // 10:00 AM
  const defaultMaxTime = maxTime || setHours(setMinutes(new Date(0, 0, 0), 59), 23); // 11:59 PM

  // Phase 68-03 MOB-07: touch long-press → drag detection layered on top of
  // react-big-calendar (which only supports mouse drag for slot selection).
  // The handlers compute time-coordinates from touch points, derive a
  // {start, end} range, and call the same `onTimeSelected` callback the
  // desktop mouse path uses. Desktop click-and-drag is unchanged.
  const wrapperRef = useRef(null);
  const pressTimerRef = useRef(null);
  const dragStartRef = useRef(null); // { time, dayIndex, clientX, clientY }
  const [isDragging, setIsDragging] = useState(false);
  const [dragHighlight, setDragHighlight] = useState(null); // { top, left, width, height }

  // coordsToSlot: turn page coordinates into a {time, dayIndex} pair.
  // Bounds derive from defaultMinTime / defaultMaxTime — passing custom
  // minTime/maxTime props now Just Works. snappedMinute is clamped to
  // (totalMinutes - step) so the last addressable slot never rolls into
  // the next day. addMinutes() handles minute → hour overflow without
  // manual arithmetic.
  const coordsToSlot = useCallback((clientX, clientY) => {
    const wrapper = wrapperRef.current?.querySelector('.rbc-time-content');
    if (!wrapper) return null;
    const rect = wrapper.getBoundingClientRect();
    const numCols = currentView === 'day' ? 1 : 7;
    const dayIndex = Math.max(
      0,
      Math.min(numCols - 1, Math.floor((clientX - rect.left) / (rect.width / numCols)))
    );
    const yPct = Math.max(
      0,
      Math.min(1, (clientY - rect.top + wrapper.scrollTop) / wrapper.scrollHeight)
    );

    const totalMinutes = differenceInMinutes(defaultMaxTime, defaultMinTime);
    const rawMinute = yPct * totalMinutes;
    const snappedMinute = Math.min(
      Math.round(rawMinute / step) * step,
      totalMinutes - step
    );

    const baseDate = currentView === 'day'
      ? currentDate
      : addDays(startOfWeek(currentDate, { weekStartsOn: 1 }), dayIndex);
    const dayAtMin = setMinutes(setHours(baseDate, getHours(defaultMinTime)), getMinutes(defaultMinTime));
    const time = addMinutes(dayAtMin, snappedMinute);

    return { time, dayIndex };
  }, [currentView, currentDate, step, defaultMinTime, defaultMaxTime]);

  // Compute the absolute-position highlight rect for the current drag range,
  // anchored to the wrapper's coordinate space (not the document).
  const computeHighlightRect = useCallback((startTime, endTime, dayIndex) => {
    const wrapper = wrapperRef.current?.querySelector('.rbc-time-content');
    if (!wrapper) return null;
    const wrapperRect = wrapperRef.current.getBoundingClientRect();
    const innerRect = wrapper.getBoundingClientRect();
    const numCols = currentView === 'day' ? 1 : 7;
    const colWidth = innerRect.width / numCols;

    const totalMinutes = differenceInMinutes(defaultMaxTime, defaultMinTime);
    const startBase = setMinutes(setHours(startTime, getHours(defaultMinTime)), getMinutes(defaultMinTime));
    // Use minutes-since-day-min computed from the touched times' time-of-day only.
    const startMinFromMin = (getHours(startTime) - getHours(defaultMinTime)) * 60 + (getMinutes(startTime) - getMinutes(defaultMinTime));
    const endMinFromMin = (getHours(endTime) - getHours(defaultMinTime)) * 60 + (getMinutes(endTime) - getMinutes(defaultMinTime));
    const lo = Math.min(startMinFromMin, endMinFromMin);
    const hi = Math.max(startMinFromMin, endMinFromMin) + step; // include the trailing slot

    const topPx = (lo / totalMinutes) * wrapper.scrollHeight - wrapper.scrollTop;
    const heightPx = ((hi - lo) / totalMinutes) * wrapper.scrollHeight;
    const leftPx = innerRect.left - wrapperRect.left + dayIndex * colWidth;

    // Reference startBase so the linter doesn't complain about an unused var
    // (it documents the anchor we'd use for cross-day clamping in future work).
    void startBase;

    return {
      top: Math.max(0, topPx + (innerRect.top - wrapperRect.top)),
      left: leftPx,
      width: colWidth,
      height: Math.max(step, heightPx),
    };
  }, [currentView, step, defaultMinTime, defaultMaxTime]);

  const cancelLongPress = useCallback(() => {
    if (pressTimerRef.current) {
      clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  }, []);

  const handleTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) {
      cancelLongPress();
      return;
    }
    const touch = e.touches[0];
    const slot = coordsToSlot(touch.clientX, touch.clientY);
    if (!slot) return;
    dragStartRef.current = {
      ...slot,
      clientX: touch.clientX,
      clientY: touch.clientY,
    };
    cancelLongPress();
    pressTimerRef.current = setTimeout(() => {
      // 250ms grace elapsed without the user lifting / scrolling — enter drag mode.
      setIsDragging(true);
      const rect = computeHighlightRect(slot.time, slot.time, slot.dayIndex);
      if (rect) setDragHighlight(rect);
    }, 250);
  }, [coordsToSlot, computeHighlightRect, cancelLongPress]);

  const handleTouchEnd = useCallback((e) => {
    cancelLongPress();
    if (!isDragging || !dragStartRef.current) {
      // Single short tap or scroll — nothing committed.
      setIsDragging(false);
      setDragHighlight(null);
      dragStartRef.current = null;
      return;
    }
    const touch = e.changedTouches[0];
    const endSlot = touch ? coordsToSlot(touch.clientX, touch.clientY) : null;
    const startTime = dragStartRef.current.time;
    const endTime = endSlot ? endSlot.time : startTime;

    let start = startTime <= endTime ? startTime : endTime;
    let end = startTime <= endTime ? endTime : startTime;
    // Guarantee at least one slot of duration (covers tap-without-move once
    // drag mode has been entered).
    if (differenceInMinutes(end, start) < step) {
      end = addMinutes(start, step);
    } else {
      // The touchEnd cell currently represents the START of that slot — extend
      // by `step` so the user-visible range covers the slot they released on.
      end = addMinutes(end, step);
    }
    if (onTimeSelected) {
      onTimeSelected(start, end);
    }
    setIsDragging(false);
    setDragHighlight(null);
    dragStartRef.current = null;
  }, [isDragging, coordsToSlot, onTimeSelected, step, cancelLongPress]);

  const handleTouchCancel = useCallback(() => {
    cancelLongPress();
    setIsDragging(false);
    setDragHighlight(null);
    dragStartRef.current = null;
  }, [cancelLongPress]);

  // Imperatively attach touchmove with { passive: false } so we can call
  // preventDefault() to block scroll while in drag mode. React's onTouchMove
  // is passive in newer versions (preventDefault is a no-op there).
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return undefined;

    const handleTouchMove = (e) => {
      if (!dragStartRef.current) return;
      if (!isDragging) {
        // User is scrolling — abort the long-press timer if it hasn't fired.
        cancelLongPress();
        return;
      }
      // In drag mode: block scroll, update highlight to current touch point.
      e.preventDefault();
      const touch = e.touches[0];
      if (!touch) return;
      const slot = coordsToSlot(touch.clientX, touch.clientY);
      if (!slot) return;
      const rect = computeHighlightRect(dragStartRef.current.time, slot.time, dragStartRef.current.dayIndex);
      if (rect) setDragHighlight(rect);
    };

    wrapper.addEventListener('touchmove', handleTouchMove, { passive: false });
    return () => {
      wrapper.removeEventListener('touchmove', handleTouchMove);
    };
  }, [isDragging, coordsToSlot, computeHighlightRect, cancelLongPress]);

  // Cleanup any lingering timer on unmount.
  useEffect(() => {
    return () => {
      if (pressTimerRef.current) {
        clearTimeout(pressTimerRef.current);
        pressTimerRef.current = null;
      }
    };
  }, []);

  // Phase 66-01: navigation-only effect. Slot highlighting now flows from
  // the controlled `selectedSlot` prop (parent-owned), so this hook only
  // syncs the calendar's visible week/day to `initialDate`.
  useEffect(() => {
    if (initialDate) {
      setCurrentDate(initialDate);
    }
  }, [initialDate]);

  const handleSelectSlot = ({ start, end }) => {
    // Ensure we have valid dates
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return;
    }

    // Ensure end is after start
    if (end <= start) {
      return;
    }

    // Phase 66-01: notify parent only — parent updates newEvent.start_date +
    // duration_minutes, which round-trips back via the `selectedSlot` prop.
    if (onTimeSelected) {
      onTimeSelected(start, end);
    }
  };

  const formatDuration = (start, end) => {
    const minutes = differenceInMinutes(end, start);
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    
    if (hours === 0) {
      return `${mins} min`;
    } else if (mins === 0) {
      return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
    } else {
      return `${hours}h ${mins}m`;
    }
  };

  // Combine selected slot with external events for display
  const displayEvents = [
    ...(events || []),
    ...(selectedSlot ? [{
      id: 'selected',
      title: 'Selected Time',
      start: selectedSlot.start,
      end: selectedSlot.end,
    }] : [])
  ];

  // Tint time slots based on group availability
  const getSlotProps = useCallback((date) => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const hour = date.getHours();
    const key = `${dateStr}_${hour}`;
    const slot = heatmapLookup.get(key);
    const count = slot?.availableCount || 0;

    let bgColor = undefined;
    if (totalMembers > 0 && count > 0) {
      const ratio = count / totalMembers;
      // Green availability gradient -- status indicator, intentionally green
      if (ratio <= 0.25) bgColor = 'rgba(34, 197, 94, 0.15)';
      else if (ratio <= 0.5) bgColor = 'rgba(34, 197, 94, 0.25)';
      else if (ratio <= 0.75) bgColor = 'rgba(34, 197, 94, 0.4)';
      else bgColor = 'rgba(34, 197, 94, 0.55)';
    }

    return {
      style: {
        minHeight: '60px',
        ...(bgColor && { backgroundColor: bgColor }),
      },
    };
  }, [heatmapLookup, totalMembers]);

  // Custom time slot wrapper: adds availability count + hover tooltip with conflict info
  const calendarComponents = useMemo(() => ({
    timeSlotWrapper: ({ children, value }) => {
      if (!value || !(value instanceof Date)) return children;

      const dateStr = format(value, 'yyyy-MM-dd');
      const hour = value.getHours();
      const key = `${dateStr}_${hour}`;
      const slot = heatmapLookup.get(key);
      const conflicts = conflictLookup.get(key);

      if ((!slot || slot.availableCount === 0) && !conflicts) return children;

      const names = (slot?.availableMembers || []).map(m => m.username).join(', ');
      let tip = slot?.availableCount > 0
        ? `${slot.availableCount}/${totalMembers} available: ${names}`
        : '';

      if (conflicts && conflicts.length > 0) {
        for (const c of conflicts) {
          tip += `${tip ? '\n' : ''}⚠ ${c.username} said yes, but calendar shows busy`;
        }
      }

      return (
        <div title={tip} style={{ position: 'relative', height: '100%' }}>
          {children}
          {slot?.availableCount > 0 && (
            <span style={{
              position: 'absolute',
              top: '2px',
              right: '4px',
              fontSize: '10px',
              color: 'var(--color-status-success)',
              fontWeight: 600,
              pointerEvents: 'none',
              zIndex: 1,
            }}>
              {slot.availableCount}
            </span>
          )}
        </div>
      );
    },
  }), [heatmapLookup, conflictLookup, totalMembers]);

  return (
    <div className="space-y-4">
      <div
        ref={wrapperRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        className="relative h-[600px] bg-surface-card rounded-card border border-line overflow-hidden"
      >
        {dragHighlight && (
          <div
            className="absolute pointer-events-none bg-btn-primary/20 border-2 border-btn-primary rounded z-10"
            style={{
              top: dragHighlight.top,
              left: dragHighlight.left,
              width: dragHighlight.width,
              height: dragHighlight.height,
            }}
          />
        )}
        <Calendar
          key={heatmapData ? 'heatmap-loaded' : 'heatmap-empty'}
          localizer={localizer}
          selectable
          onSelectSlot={handleSelectSlot}
          view={currentView}
          onView={(view) => setCurrentView(view)}
          views={['week', 'day']}
          step={step}
          timeslots={1}
          min={defaultMinTime}
          max={defaultMaxTime}
          date={currentDate}
          onNavigate={(date) => setCurrentDate(date)}
          events={displayEvents}
          className="h-full"
          style={{ height: '100%' }}
          eventPropGetter={(event) => {
            // Style busy events differently (red) vs selected time (primary)
            const isBusy = event.resource?.isBusy;
            return {
              style: {
                backgroundColor: isBusy ? 'var(--color-status-error)' : 'var(--color-btn-primary-bg)',
                borderColor: isBusy ? 'var(--color-status-error)' : 'var(--color-btn-primary-bg)',
                color: 'white',
                borderRadius: '4px',
                padding: '4px 8px',
                opacity: isBusy ? 0.7 : 1,
              },
            };
          }}
          slotPropGetter={getSlotProps}
          components={calendarComponents}
          {...(scrollToTime ? { scrollToTime } : {})}
        />
      </div>

      {totalMembers > 0 && (
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <span>Availability:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.25)' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.4)' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: 'rgba(34, 197, 94, 0.55)' }} />
          </div>
          <span>More available</span>
          <span className="text-content-muted ml-1">(hover for names)</span>
        </div>
      )}

      {membersWithoutDataCount > 0 && (
        <p className="text-xs text-content-muted mt-1">
          {membersWithoutDataCount} of {totalGroupMembers} members haven't shared availability yet
        </p>
      )}

      {totalMembers === 0 && totalGroupMembers > 0 && (
        <p className="text-sm text-content-muted text-center py-2">
          No one has shared availability yet
        </p>
      )}

      {selectedSlot && (
        <div className="p-4 bg-surface-card-hover rounded-card border border-line-accent">
          <p className="text-sm font-medium text-content-primary mb-1">Selected Time:</p>
          <p className="text-lg text-accent font-semibold">
            {format(selectedSlot.start, 'EEEE, MMMM d, h:mm a')}
            {' - '}
            {format(selectedSlot.end, 'h:mm a')}
            {' '}
            <span className="text-accent">({formatDuration(selectedSlot.start, selectedSlot.end)})</span>
          </p>
        </div>
      )}

      {!selectedSlot && (
        <div className="p-4 bg-surface-page rounded-card border border-line">
          <p className="text-sm text-content-secondary">
            Click and drag on the calendar to select a time slot for your event.
          </p>
        </div>
      )}
    </div>
  );
}
