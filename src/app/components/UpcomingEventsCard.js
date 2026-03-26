'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Format event date/time in relative + compact format.
 * - Today: "Today 7pm"
 * - Tomorrow: "Tomorrow 2pm"
 * - Within 6 days: "Fri 6pm"
 * - Time: 12-hour, no minutes on the hour (7pm), with minutes otherwise (7:30pm)
 */
function formatRelativeDateTime(dateStr) {
  const eventDate = new Date(dateStr);
  const now = new Date();

  // Build date part
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const dayAfterTomorrow = new Date(todayStart);
  dayAfterTomorrow.setDate(dayAfterTomorrow.getDate() + 2);

  const eventDayStart = new Date(eventDate.getFullYear(), eventDate.getMonth(), eventDate.getDate());

  let datePart;
  if (eventDayStart.getTime() === todayStart.getTime()) {
    datePart = 'Today';
  } else if (eventDayStart.getTime() === tomorrowStart.getTime()) {
    datePart = 'Tomorrow';
  } else {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    datePart = dayNames[eventDate.getDay()];
  }

  // Build time part
  let hours = eventDate.getHours();
  const minutes = eventDate.getMinutes();
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const timePart = minutes === 0
    ? `${hours}${ampm}`
    : `${hours}:${String(minutes).padStart(2, '0')}${ampm}`;

  return `${datePart} ${timePart}`;
}

/**
 * UpcomingEventsCard - Compact summary of events in the next 7 days.
 *
 * @param {Object} props
 * @param {Array} props.events - Array of event objects from eventsAPI
 * @param {boolean} [props.showGroupName=false] - Show group name per row (for UserHome multi-group view)
 * @param {boolean} [props.loading=false] - Show loading placeholder
 */
export default function UpcomingEventsCard({ events, showGroupName = false, loading = false }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);

  // Defensive: treat null/undefined as empty array
  const safeEvents = events || [];

  // Filter: future events, within 7 days, scheduled or in_progress only
  const now = new Date();
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  const upcomingEvents = safeEvents
    .filter(event => {
      const startDate = new Date(event.start_date);
      if (startDate <= now) return false;
      if (startDate > sevenDaysLater) return false;
      const status = event.status || 'scheduled';
      if (status !== 'scheduled' && status !== 'in_progress') return false;
      return true;
    })
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  const displayEvents = expanded ? upcomingEvents : upcomingEvents.slice(0, 3);
  const overflowCount = upcomingEvents.length - 3;

  const handleEventClick = (event) => {
    router.push(`/gameDetail?event_id=${event.id}&group_id=${event.group_id}`);
  };

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4">
      <h3 className="font-medium text-gray-900">Upcoming Events</h3>

      {loading ? (
        <p className="text-sm text-gray-400 mt-2">Loading...</p>
      ) : upcomingEvents.length === 0 ? (
        <p className="text-sm text-gray-500 mt-2">No upcoming events</p>
      ) : (
        <div className="mt-2">
          {displayEvents.map(event => {
            const gameName = event.Game?.name || 'Game TBD';
            const dateTime = formatRelativeDateTime(event.start_date);
            const groupName = event.Group?.name;

            return (
              <div
                key={event.id}
                onClick={() => handleEventClick(event)}
                className="hover:bg-gray-50 rounded py-1.5 px-2 cursor-pointer"
              >
                <span className="text-sm text-gray-700">{gameName}</span>
                <span className="text-sm text-gray-400"> · </span>
                <span className="text-sm text-gray-700">{dateTime}</span>
                {showGroupName && groupName && (
                  <>
                    <span className="text-sm text-gray-400"> · </span>
                    <span className="text-sm text-gray-700">{groupName}</span>
                  </>
                )}
              </div>
            );
          })}

          {overflowCount > 0 && !expanded && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(true);
              }}
              className="text-sm text-blue-600 cursor-pointer mt-1 ml-2"
            >
              + {overflowCount} more
            </button>
          )}

          {expanded && upcomingEvents.length > 3 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
              className="text-sm text-blue-600 cursor-pointer mt-1 ml-2"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
