'use client';

import { useState, useEffect } from 'react';
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
  startOfWeek,
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
  events = []
}) {
  const [selectedSlot, setSelectedSlot] = useState(null);
  const [currentDate, setCurrentDate] = useState(initialDate || new Date());
  const [currentView, setCurrentView] = useState('week');

  // Set default min/max times (4 PM to midnight)
  const defaultMinTime = minTime || setHours(setMinutes(new Date(0, 0, 0), 0), 16); // 4:00 PM
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

  return (
    <div className="space-y-4">
      <div className="h-[600px] bg-white rounded-lg border border-gray-300 overflow-hidden">
        <Calendar
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
          slotPropGetter={() => ({
            style: {
              minHeight: '60px',
            },
          })}
        />
      </div>

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
