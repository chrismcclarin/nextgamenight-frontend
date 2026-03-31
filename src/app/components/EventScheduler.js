'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Calendar, dateFnsLocalizer } from 'react-big-calendar';
import { format, parse, startOfWeek, getDay, differenceInMinutes, parseISO, setHours, setMinutes } from 'date-fns';
import { enUS } from 'date-fns/locale';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Custom styles to match app theme
const calendarStyles = `
  .rbc-calendar {
    font-family: inherit;
  }
  .rbc-header {
    border-bottom: 2px solid #e5e7eb;
    padding: 8px;
    font-weight: 600;
    color: #1f2937;
  }
  .rbc-time-header {
    border-bottom: 1px solid #e5e7eb;
  }
  .rbc-time-content {
    border-top: 1px solid #e5e7eb;
  }
  .rbc-time-slot {
    border-top: 1px solid #f3f4f6;
  }
  .rbc-day-slot .rbc-time-slot {
    border-top: 1px solid #f3f4f6;
  }
  .rbc-today {
    background-color: #eff6ff;
  }
  .rbc-off-range-bg {
    background-color: #f9fafb;
  }
  .rbc-selected {
    background-color: #dbeafe !important;
  }
  .rbc-slot-selection {
    background-color: #bfdbfe;
    opacity: 0.5;
  }
  .rbc-event {
    border-radius: 4px;
    padding: 2px 4px;
  }
  .rbc-event-content {
    font-size: 0.875rem;
    font-weight: 500;
  }
  .rbc-toolbar {
    margin-bottom: 1rem;
  }
  .rbc-toolbar button {
    color: #374151;
    border: 1px solid #d1d5db;
    background-color: white;
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
  }
  .rbc-toolbar button:hover {
    background-color: #f3f4f6;
  }
  .rbc-toolbar button.rbc-active {
    background-color: #3b82f6;
    color: white;
    border-color: #2563eb;
  }
  .rbc-time-view {
    border: 1px solid #e5e7eb;
  }
  .rbc-time-header-gutter {
    border-right: 1px solid #e5e7eb;
  }
  .rbc-day-bg {
    border-right: 1px solid #e5e7eb;
  }
`;

// Inject styles
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style');
  styleSheet.type = 'text/css';
  styleSheet.innerText = calendarStyles;
  document.head.appendChild(styleSheet);
}

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
      if (ratio <= 0.25) bgColor = '#dcfce7';       // green-100
      else if (ratio <= 0.5) bgColor = '#bbf7d0';   // green-200
      else if (ratio <= 0.75) bgColor = '#86efac';   // green-300
      else bgColor = '#4ade80';                       // green-400
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
            color: '#15803d',
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
      <div className="h-[600px] bg-white rounded-lg border border-gray-300 overflow-hidden">
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
            // Style busy events differently (gray/red) vs selected time (blue)
            const isBusy = event.resource?.isBusy;
            return {
              style: {
                backgroundColor: isBusy ? '#ef4444' : '#3b82f6',
                borderColor: isBusy ? '#dc2626' : '#2563eb',
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
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>Availability:</span>
          <div className="flex items-center gap-1">
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#dcfce7' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#bbf7d0' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#86efac' }} />
            <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: '#4ade80' }} />
          </div>
          <span>More available</span>
          <span className="text-gray-400 ml-1">(hover for names)</span>
        </div>
      )}

      {selectedSlot && (
        <div className="p-4 bg-blue-50 rounded-lg border border-blue-200">
          <p className="text-sm font-medium text-blue-900 mb-1">Selected Time:</p>
          <p className="text-lg text-blue-700 font-semibold">
            {format(selectedSlot.start, 'EEEE, MMMM d, h:mm a')} 
            {' - '}
            {format(selectedSlot.end, 'h:mm a')}
            {' '}
            <span className="text-blue-600">({formatDuration(selectedSlot.start, selectedSlot.end)})</span>
          </p>
        </div>
      )}

      {!selectedSlot && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200">
          <p className="text-sm text-gray-600">
            Click and drag on the calendar to select a time slot for your event.
          </p>
        </div>
      )}
    </div>
  );
}
