'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, differenceInMinutes, parseISO, setHours, setMinutes } from 'date-fns';
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
  initialStart,
  initialEnd,
  minTime,
  maxTime,
  step = 30,
  events = [],
  heatmapData = null
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [currentDate, setCurrentDate] = useState(initialDate || new Date());
  const [currentView, setCurrentView] = useState('week');

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

  // Set default min/max times (10 AM to midnight)
  const defaultMinTime = minTime || setHours(setMinutes(new Date(0, 0, 0), 0), 10); // 10:00 AM
  const defaultMaxTime = maxTime || setHours(setMinutes(new Date(0, 0, 0), 59), 23); // 11:59 PM

  // Initialize from props if provided
  useEffect(() => {
    if (initialDate) {
      setCurrentDate(initialDate);
    }
    
    if (initialDate && initialStart && initialEnd) {
      try {
        const dateStr = format(initialDate, 'yyyy-MM-dd');
        const startDateTime = parseISO(`${dateStr}T${initialStart}`);
        const endDateTime = parseISO(`${dateStr}T${initialEnd}`);
        
        if (!isNaN(startDateTime.getTime()) && !isNaN(endDateTime.getTime())) {
          setSelectedSlot({ start: startDateTime, end: endDateTime });
        }
      } catch (error) {
        console.error('Error parsing initial time:', error);
      }
    } else {
      // Clear selected slot if initial values are cleared
      setSelectedSlot(null);
    }
  }, [initialDate, initialStart, initialEnd]);

  const handleSelectSlot = ({ start, end }) => {
    // Ensure we have valid dates
    if (!start || !end || isNaN(start.getTime()) || isNaN(end.getTime())) {
      return;
    }

    // Ensure end is after start
    if (end <= start) {
      return;
    }

    const slot = { start, end };
    setSelectedSlot(slot);
    
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

  // Custom time slot wrapper: adds availability count + hover tooltip
  const calendarComponents = useMemo(() => ({
    timeSlotWrapper: ({ children, value }) => {
      if (!value || !(value instanceof Date)) return children;

      const dateStr = format(value, 'yyyy-MM-dd');
      const hour = value.getHours();
      const slot = heatmapLookup.get(`${dateStr}_${hour}`);

      if (!slot || slot.availableCount === 0) return children;

      const names = (slot.availableMembers || []).map(m => m.username).join(', ');
      const tip = `${slot.availableCount}/${totalMembers} available: ${names}`;

      return (
        <div title={tip} style={{ position: 'relative', height: '100%' }}>
          {children}
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
        </div>
      );
    },
  }), [heatmapLookup, totalMembers]);

  return (
    <div className="space-y-4">
      <div className="h-[600px] bg-surface-card rounded-card border border-line overflow-hidden">
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
