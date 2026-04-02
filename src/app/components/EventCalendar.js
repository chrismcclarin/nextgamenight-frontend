'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { eventsAPI } from '../../lib/api';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { getDaysInMonth } from '../../lib/calendarUtils';
import CalendarMonthView from './CalendarMonthView';
import CalendarListView from './CalendarListView';
import EventDayModal from './EventDayModal';

export default function EventCalendar({
  refreshKey = 0,
  events: externalEvents = null,   // If provided, use these instead of fetching
  variant = 'full',                // 'full' (user home) or 'compact' (group home)
  onEmptyDayClick = null,          // Callback: (dateString) => void -- for click-to-create
  onEventClick: externalOnEventClick = null, // Override default event click navigation
  title = 'Game Sessions Calendar', // Configurable header title
  showListView = true,             // Whether to show list view toggle
}) {
  const { user } = Auth();
  const router = useRouter();
  const [internalEvents, setInternalEvents] = useState([]);
  const [loading, setLoading] = useState(externalEvents === null);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'list'
  const [selectedDay, setSelectedDay] = useState(null); // For modal: { date, events }

  const activeEvents = externalEvents !== null ? externalEvents : internalEvents;

  useEffect(() => {
    if (externalEvents === null && user?.sub) {
      fetchEvents();
    }
  }, [user, refreshKey]); // Refetch when refreshKey changes

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

  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

  const days = getDaysInMonth(currentDate);
  const sortedEvents = [...activeEvents]
    .filter(event => {
      const d = new Date(event.start_date);
      return d.getMonth() === currentDate.getMonth() && d.getFullYear() === currentDate.getFullYear();
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
          onEmptyDayClick={onEmptyDayClick}
          onEventClick={handleEventClick}
          onNavigateMonth={navigateMonth}
          onGoToday={goToToday}
          onShowDayModal={(day) => setSelectedDay(day)}
          monthNames={monthNames}
        />
      ) : (
        <CalendarListView
          sortedEvents={sortedEvents}
          currentDate={currentDate}
          onEventClick={handleEventClick}
          onNavigateMonth={navigateMonth}
          onGoToday={goToToday}
          monthNames={monthNames}
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
        />
      )}
    </div>
  );
}
