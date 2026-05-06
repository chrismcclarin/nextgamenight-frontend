'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '../components/TimezoneProvider';

/**
 * Format event date/time in relative + compact format with timezone support.
 * - Today: "Today 7pm EST"
 * - Tomorrow: "Tomorrow 2pm EST"
 * - Within 6 days: "Fri 6pm EST"
 * - Time: 12-hour, no minutes on the hour (7pm), with minutes otherwise (7:30pm)
 *
 * @param {string} dateStr - ISO date string
 * @param {string} [timezone] - Optional IANA timezone (e.g., 'America/New_York')
 */
function formatRelativeDateTime(dateStr, timezone) {
  const eventDate = new Date(dateStr);
  const now = new Date();

  // Helper to get date parts in the target timezone
  const getDateParts = (d, tz) => {
    if (!tz) {
      return { year: d.getFullYear(), month: d.getMonth(), day: d.getDate(), weekday: d.getDay(), hours: d.getHours(), minutes: d.getMinutes() };
    }
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric',
      weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true,
    }).formatToParts(d);
    const get = (type) => parts.find(p => p.type === type)?.value;
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return {
      year: parseInt(get('year'), 10),
      month: parseInt(get('month'), 10) - 1,
      day: parseInt(get('day'), 10),
      weekday: dayMap[get('weekday')] ?? 0,
      hours: (() => {
        let h = parseInt(get('hour'), 10);
        const dp = get('dayPeriod');
        if (dp === 'PM' && h !== 12) h += 12;
        if (dp === 'AM' && h === 12) h = 0;
        return h;
      })(),
      minutes: parseInt(get('minute'), 10),
    };
  };

  const nowParts = getDateParts(now, timezone);
  const eventParts = getDateParts(eventDate, timezone);

  // Compare dates
  const todayKey = `${nowParts.year}-${nowParts.month}-${nowParts.day}`;
  const tomorrowDate = new Date(nowParts.year, nowParts.month, nowParts.day + 1);
  const tomorrowKey = `${tomorrowDate.getFullYear()}-${tomorrowDate.getMonth()}-${tomorrowDate.getDate()}`;
  const eventKey = `${eventParts.year}-${eventParts.month}-${eventParts.day}`;

  let datePart;
  if (eventKey === todayKey) {
    datePart = 'Today';
  } else if (eventKey === tomorrowKey) {
    datePart = 'Tomorrow';
  } else {
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    datePart = dayNames[eventParts.weekday];
  }

  // Build time part
  let hours = eventParts.hours;
  const minutes = eventParts.minutes;
  const ampm = hours >= 12 ? 'pm' : 'am';
  hours = hours % 12;
  if (hours === 0) hours = 12;

  const timePart = minutes === 0
    ? `${hours}${ampm}`
    : `${hours}:${String(minutes).padStart(2, '0')}${ampm}`;

  // Append timezone abbreviation if provided
  let tzAbbr = '';
  if (timezone) {
    try {
      tzAbbr = ' ' + new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
        .formatToParts(eventDate)
        .find(p => p.type === 'timeZoneName')?.value;
    } catch { /* ignore */ }
  }

  return `${datePart} ${timePart}${tzAbbr}`;
}

/**
 * UpcomingEventsCard - Compact summary of events in the next 7 days.
 *
 * @param {Object} props
 * @param {Array} props.events - Array of event objects from eventsAPI
 * @param {boolean} [props.showGroupName=false] - Show group name per row (for UserHome multi-group view)
 * @param {boolean} [props.loading=false] - Show loading placeholder
 * @param {string} [props.viewerDbUserId=null] - Phase 71.1 GAMP-09: User.id UUID
 *   (NOT Auth0 string). When provided, events where the viewer's
 *   EventParticipation row has is_guest=true are visually distinguished
 *   (game-only / two-QR-model events) with a dashed amber border + Guest pill.
 *   Resolved at the parent via usersAPI.getUser(user.sub). When null/missing,
 *   no event is marked as guest (graceful default).
 */
export default function UpcomingEventsCard({ events, showGroupName = false, loading = false, viewerDbUserId = null }) {
  const router = useRouter();
  const { timezone } = useTimezone();
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
    <div className="card p-4 mb-4">
      <h3 className="font-medium text-content-primary">Upcoming Events</h3>

      {loading ? (
        <p className="text-sm text-content-muted mt-2">Loading...</p>
      ) : upcomingEvents.length === 0 ? (
        <p className="text-sm text-content-muted mt-2">No upcoming events</p>
      ) : (
        <div className="mt-2">
          {displayEvents.map(event => {
            const gameName = event.Game?.name || 'Game TBD';
            const dateTime = formatRelativeDateTime(event.start_date, timezone);
            const groupName = event.Group?.name;

            // Phase 71.1 GAMP-09: visually distinguish events where the viewer
            // joined as a guest (EventParticipation.is_guest=true). Match on
            // User.id UUID — not Auth0 string, not email. The previous fragile
            // email heuristic is gone.
            const isGuestEvent = (() => {
              if (!viewerDbUserId) return false;
              const eps = Array.isArray(event.EventParticipations) ? event.EventParticipations : [];
              return eps.some(p => p.user_id === viewerDbUserId && p.is_guest === true);
            })();

            return (
              <div
                key={event.id}
                onClick={() => handleEventClick(event)}
                className={`hover:bg-surface-card-hover rounded py-1.5 px-2 cursor-pointer ${isGuestEvent ? 'border-l-2 border-dashed border-amber-400 dark:border-amber-500/70 pl-3' : ''}`}
              >
                <span className="text-sm text-content-secondary">{gameName}</span>
                <span className="text-sm text-content-muted"> · </span>
                <span className="text-sm text-content-secondary">{dateTime}</span>
                {showGroupName && groupName && (
                  <>
                    <span className="text-sm text-content-muted"> · </span>
                    <span className="text-sm text-content-secondary">{groupName}</span>
                  </>
                )}
                {isGuestEvent && (
                  <span
                    className="inline-flex items-center px-1.5 py-0.5 ml-2 text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50"
                    title="You joined this event as a guest (not a group member)"
                  >
                    Guest
                  </span>
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
              className="text-sm text-content-link cursor-pointer mt-1 ml-2"
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
              className="text-sm text-content-link cursor-pointer mt-1 ml-2"
            >
              Show less
            </button>
          )}
        </div>
      )}
    </div>
  );
}
