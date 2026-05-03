'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { eventsAPI } from '../../lib/api';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { getDaysInMonth } from '../../lib/calendarUtils';
import { loadCalendarPrefs, saveCalendarPrefs } from '../../lib/calendarViewPrefs';
import CalendarMonthView from './CalendarMonthView';
import CalendarListView from './CalendarListView';
import EventDayModal from './EventDayModal';
import { useTimezone } from './TimezoneProvider';
import { formatWithTzAbbr } from '../../lib/tzUtils';

export default function EventCalendar({
  refreshKey = 0,
  events: externalEvents = null,   // If provided, use these instead of fetching
  variant = 'full',                // 'full' (user home) or 'compact' (group home)
  onEmptyDayClick = null,          // Callback: (dateString) => void -- for click-to-create
  onEventClick: externalOnEventClick = null, // Override default event click navigation
  title = 'Game Sessions Calendar', // Configurable header title
  showListView = true,             // Whether to show list view toggle
  scope = 'home',                  // CAL-03: persistence scope key (e.g. 'home', 'group:<id>')
}) {
  const { user } = Auth();
  const { timezone } = useTimezone();
  const router = useRouter();
  const [internalEvents, setInternalEvents] = useState([]);
  const [loading, setLoading] = useState(externalEvents === null);
  // CAL-03/CAL-07: initial state is hydrated synchronously from localStorage
  // so the very first render reflects the persisted view (no flicker between
  // default 'month' and the user's saved 'list' choice).
  const [viewMode, setViewMode] = useState(() => {
    const prefs = loadCalendarPrefs(scope);
    return prefs?.viewMode || 'month';
  });
  const [currentDate, setCurrentDate] = useState(() => {
    const prefs = loadCalendarPrefs(scope);
    return prefs?.currentDate || new Date();
  });
  const [selectedDay, setSelectedDay] = useState(null); // For modal: { date, events }

  const activeEvents = externalEvents !== null ? externalEvents : internalEvents;

  useEffect(() => {
    if (externalEvents === null && user?.sub) {
      fetchEvents();
    }
  }, [user, refreshKey]); // Refetch when refreshKey changes

  // CAL-03/CAL-07: persist viewMode + currentDate whenever either changes.
  // Save fires after user interactions (toggle list, navigate month) so
  // subsequent reloads / modal cycles restore the same view. The 1-hour
  // TTL on month restoration is enforced inside loadCalendarPrefs.
  useEffect(() => {
    saveCalendarPrefs(scope, { viewMode, currentDate });
  }, [scope, viewMode, currentDate]);

  const fetchEvents = async () => {
    if (!user?.sub) return;
    try {
      setLoading(true);
      const data = await eventsAPI.getUserEvents(user.sub, { includeRsvpSummary: true });
      setInternalEvents(data || []);
    } catch (error) {
      console.error('Error fetching events:', error.message || 'Unknown error');
      setInternalEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const navigateMonth = (direction) => {
    setCurrentDate(prev => {
      const newDate = new Date(prev);
      newDate.setMonth(prev.getMonth() + direction);
      return newDate;
    });
  };

  const goToToday = () => {
    setCurrentDate(new Date());
  };

  const defaultEventClick = (event) => {
    const isFutureEvent = event.start_date && new Date(event.start_date) >= new Date();
    if (isFutureEvent || !event.game_id) {
      router.push(`/gameDetail?event_id=${event.id}&group_id=${event.group_id}`);
    } else {
      router.push(`/gameDetail?game_id=${event.game_id}&group_id=${event.group_id}`);
    }
  };

  const handleEventClick = externalOnEventClick || defaultEventClick;

  // CAL-04 / CAL-05: single dispatcher for whole-day-cell taps.
  // - 0 events: invoke onEmptyDayClick (group calendar) or no-op (home).
  // - 1 event: jump straight to event detail (skip the modal — fewer clicks).
  // - 2+ events: open EventDayModal listing the day's events.
  //
  // Adjacent-month act-in-place invariant (CAL-01): we DO NOT call
  // setCurrentDate here. Tapping a prev/next-month cell opens the
  // modal/handler in place, leaving the visible month grid unchanged
  // so that closing the modal returns the user to the same view.
  const handleDayClick = (date, dayEvents) => {
    if (!date) return;
    if (dayEvents.length === 0) {
      if (onEmptyDayClick) {
        const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
        onEmptyDayClick(dateStr);
      }
      return;
    }
    if (dayEvents.length === 1) {
      handleEventClick(dayEvents[0]);
      return;
    }
    setSelectedDay({ date, events: dayEvents });
  };

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  // Phase 62-02: TZ legend for the calendar header. Per CONTEXT.md,
  // monthly cells are too tight for per-cell abbreviations — instead
  // render a single "Times shown in {abbr}" line on the header. We
  // use `formatWithTzAbbr` against `currentDate` (or now if missing)
  // so DST changes flip MST<->MDT correctly when navigating months.
  const tzLegend = timezone
    ? formatWithTzAbbr(currentDate || new Date(), timezone, 'zzz')
    : null;

  // CAL-01: getDaysInMonth now returns {date, isCurrentMonth}[] — 42 cells.
  const days = getDaysInMonth(currentDate);

  // CAL-06: list view is today-onward (NOT month-scoped). Build a separate
  // forward-only list directly from activeEvents. Past events are dropped —
  // they live in event detail / game-history surfaces.
  const startOfToday = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  })();
  const sortedEventsTodayOnward = [...activeEvents]
    .filter(event => {
      if (!event?.start_date) return false;
      return new Date(event.start_date) >= startOfToday;
    })
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  if (loading) {
    return (
      <div className="card p-6">
        <p className="text-content-secondary">Loading calendar...</p>
      </div>
    );
  }

  return (
    <div className="card p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-content-primary">{title}</h2>
        {showListView && (
          <div className="flex gap-2">
            <button
              onClick={() => setViewMode(viewMode === 'month' ? 'list' : 'month')}
              className="btn btn-secondary text-sm"
            >
              {viewMode === 'month' ? 'List View' : 'Month View'}
            </button>
          </div>
        )}
      </div>

      {viewMode === 'month' ? (
        <CalendarMonthView
          days={days}
          activeEvents={activeEvents}
          currentDate={currentDate}
          variant={variant}
          onDayClick={handleDayClick}
          onEventClick={handleEventClick}
          onNavigateMonth={navigateMonth}
          onGoToday={goToToday}
          showEmptyDayHint={!!onEmptyDayClick}
          monthNames={monthNames}
          tzLegend={tzLegend}
        />
      ) : (
        <CalendarListView
          events={sortedEventsTodayOnward}
          onEventClick={handleEventClick}
          timezone={timezone}
          loading={loading}
        />
      )}

      {selectedDay && (
        <EventDayModal
          selectedDay={selectedDay}
          onClose={() => setSelectedDay(null)}
          onEventClick={(event) => {
            handleEventClick(event);
            setSelectedDay(null);
          }}
          onCreateEventOnDay={onEmptyDayClick ? (date) => {
            // CAL-04: "+ New event on this day" uses the same empty-day-click
            // path as a tap on a blank cell — yields the visual day-mode
            // entry on group calendars, hidden entirely on home.
            const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            setSelectedDay(null);
            onEmptyDayClick(dateStr);
          } : null}
        />
      )}
    </div>
  );
}
