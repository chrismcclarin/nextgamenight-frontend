'use client';

import { useMemo } from 'react';
import { Calendar, momentLocalizer } from 'react-big-calendar';
import moment from 'moment';
import 'react-big-calendar/lib/css/react-big-calendar.css';

// Initialize the localizer with moment
const localizer = momentLocalizer(moment);

/**
 * Generate calendar events from recurring schedules
 * Creates events for the next 4 weeks based on schedule patterns
 *
 * @param {Array} schedules - Array of schedule objects
 * @returns {Array} Array of calendar events
 */
const generateEvents = (schedules) => {
  if (!schedules || schedules.length === 0) return [];

  return schedules.flatMap(schedule => {
    const events = [];

    // Generate events for the next 4 weeks
    for (let week = 0; week < 4; week++) {
      // Get the next occurrence of this day of week
      const date = moment()
        .day(schedule.schedule_day_of_week)
        .add(week, 'weeks');

      // Set the scheduled time
      const [hours, minutes] = schedule.schedule_time.split(':');
      date.hours(parseInt(hours)).minutes(parseInt(minutes)).seconds(0);

      // Skip if date is in the past
      if (date.isBefore(moment())) continue;

      // Create calendar event
      events.push({
        id: `${schedule.id}-week${week}`,
        title: schedule.template_name || 'Prompt',
        start: date.toDate(),
        end: moment(date).add(1, 'hour').toDate(), // 1-hour duration for display
        resource: schedule, // Store full schedule for click handler
        style: {
          backgroundColor: schedule.is_active ? '#3b82f6' : '#9ca3af',
          borderColor: schedule.is_active ? '#2563eb' : '#6b7280',
        },
      });
    }

    return events;
  });
};

/**
 * ScheduleCalendar - Calendar view of prompt schedules using react-big-calendar
 *
 * @param {Object} props
 * @param {Array} props.schedules - Array of schedule objects
 * @param {Function} props.onSelectEvent - Callback when event clicked (passes schedule)
 */
export default function ScheduleCalendar({ schedules = [], onSelectEvent }) {
  // Generate events from schedules (memoized to prevent recalculation)
  const events = useMemo(() => generateEvents(schedules), [schedules]);

  // Handle event click
  const handleSelectEvent = (event) => {
    // Pass the original schedule object to parent
    if (onSelectEvent && event.resource) {
      onSelectEvent(event.resource);
    }
  };

  // Custom event style getter
  const eventStyleGetter = (event) => {
    return {
      style: {
        backgroundColor: event.style?.backgroundColor || '#3b82f6',
        borderColor: event.style?.borderColor || '#2563eb',
        borderRadius: '4px',
        opacity: 0.9,
        color: 'white',
        border: '1px solid',
        display: 'block',
      },
    };
  };

  return (
    <div className="border border-gray-200 rounded-lg p-4 bg-white">
      {/* Legend */}
      <div className="flex items-center gap-4 mb-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#3b82f6' }}></div>
          <span className="text-gray-700">Active</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ backgroundColor: '#9ca3af' }}></div>
          <span className="text-gray-700">Paused</span>
        </div>
      </div>

      {/* Calendar */}
      <div style={{ height: 500 }}>
        <Calendar
          localizer={localizer}
          events={events}
          startAccessor="start"
          endAccessor="end"
          defaultView="week"
          views={['week', 'month']}
          onSelectEvent={handleSelectEvent}
          eventPropGetter={eventStyleGetter}
          style={{ height: '100%' }}
          popup
          tooltipAccessor={(event) => {
            const schedule = event.resource;
            if (!schedule) return event.title;

            const status = schedule.is_active ? 'Active' : 'Paused';
            return `${event.title} (${status})`;
          }}
        />
      </div>

      {/* Empty state */}
      {events.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center">
          <p className="text-gray-500">No schedules to display</p>
        </div>
      )}
    </div>
  );
}
