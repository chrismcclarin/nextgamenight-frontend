'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { eventsAPI, API_BASE_URL } from '../../lib/api';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { getContrastColor, getEventTileTextColor, getBrightness } from '../../lib/colorUtils';
import { formatDate, formatTime } from '../../lib/dateUtils';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

export default function EventCalendar({ refreshKey = 0 }) {
  const { user } = Auth();
  const router = useRouter();
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentDate, setCurrentDate] = useState(new Date());
  const [viewMode, setViewMode] = useState('month'); // 'month' or 'list'
  const [selectedDay, setSelectedDay] = useState(null); // For modal: { date, events }

  useEffect(() => {
    if (user?.sub) {
      fetchEvents();
    }
  }, [user, refreshKey]); // Refetch when refreshKey changes

  const fetchEvents = async () => {
    if (!user?.sub) return;
    try {
      setLoading(true);
      const data = await eventsAPI.getUserEvents(user.sub, { includeRsvpSummary: true });
      setEvents(data || []);
    } catch (error) {
      console.error('Error fetching events:', error.message || 'Unknown error');
      setEvents([]);
    } finally {
      setLoading(false);
    }
  };

  const getDaysInMonth = (date) => {
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const lastDay = new Date(year, month + 1, 0);
    const daysInMonth = lastDay.getDate();
    const startingDayOfWeek = firstDay.getDay();
    
    const days = [];
    
    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDayOfWeek; i++) {
      days.push(null);
    }
    
    // Add all days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      days.push(new Date(year, month, day));
    }
    
    return days;
  };

  const getEventsForDate = (date) => {
    if (!date) return [];
    // Get date in local timezone (YYYY-MM-DD)
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    
    return events.filter(event => {
      if (!event.start_date) return false;
      // Convert event date to local date string
      const eventDate = new Date(event.start_date);
      const eventYear = eventDate.getFullYear();
      const eventMonth = String(eventDate.getMonth() + 1).padStart(2, '0');
      const eventDay = String(eventDate.getDate()).padStart(2, '0');
      const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`;
      return eventDateStr === dateStr;
    });
  };

  const isToday = (date) => {
    if (!date) return false;
    const today = new Date();
    return date.toDateString() === today.toDateString();
  };

  const isPast = (date) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate < today;
  };

  const isFuture = (date) => {
    if (!date) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate > today;
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

  const handleEventClick = (event) => {
    const isFuture = event.start_date && new Date(event.start_date) >= new Date();
    if (isFuture || !event.game_id) {
      // Future events or events without a game: show event-focused view (RSVP, ballot, edit)
      router.push(`/gameDetail?event_id=${event.id}&group_id=${event.group_id}`);
    } else {
      // Past events with a game: show game detail view (sessions, reviews)
      router.push(`/gameDetail?game_id=${event.game_id}&group_id=${event.group_id}`);
    }
  };


  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  const days = getDaysInMonth(currentDate);
  const sortedEvents = [...events].sort((a, b) => 
    new Date(a.start_date) - new Date(b.start_date)
  );

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <p className="text-gray-600">Loading calendar...</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Game Sessions Calendar</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode(viewMode === 'month' ? 'list' : 'month')}
            className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors text-sm"
          >
            {viewMode === 'month' ? 'List View' : 'Month View'}
          </button>
        </div>
      </div>

      {viewMode === 'month' ? (
        <>
          {/* Month Navigation */}
          <div className="flex justify-between items-center mb-4">
            <button
              onClick={() => navigateMonth(-1)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ← Previous
            </button>
            <div className="text-center">
              <h3 className="text-xl font-semibold text-gray-900">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
              </h3>
              <button
                onClick={goToToday}
                className="text-sm text-blue-600 hover:text-blue-700 mt-1"
              >
                Go to Today
              </button>
            </div>
            <button
              onClick={() => navigateMonth(1)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Next →
            </button>
          </div>

          {/* Calendar Grid */}
          <div className="grid grid-cols-7 gap-1 mb-4">
            {dayNames.map(day => (
              <div key={day} className="text-center font-semibold text-gray-700 py-2 text-sm">
                {day}
              </div>
            ))}
          </div>

          <div className="grid grid-cols-7 gap-1">
            {days.map((date, index) => {
              const dayEvents = getEventsForDate(date);
              const isCurrentDay = isToday(date);
              const isPastDate = isPast(date);
              const isFutureDate = isFuture(date);

              return (
                <div
                  key={index}
                  className={`min-h-[100px] border border-gray-200 rounded p-1 ${
                    !date ? 'bg-gray-50' : 
                    isCurrentDay ? 'bg-blue-50 border-blue-300' :
                    isPastDate ? 'bg-gray-50' :
                    'bg-white'
                  }`}
                >
                  {date && (
                    <>
                      <div className={`text-sm font-medium mb-1 ${
                        isCurrentDay ? 'text-blue-700' : 
                        isPastDate ? 'text-gray-400' :
                        'text-gray-900'
                      }`}>
                        {date.getDate()}
                      </div>
                      <div className="space-y-1">
                        {dayEvents.slice(0, 2).map(event => {
                          const groupBgColor = event.Group?.background_color || '#ffffff';
                          const groupProfilePic = event.Group?.profile_picture_url;
                          const groupBgImage = event.Group?.background_image_url;
                          
                          return (
                            <div
                              key={event.id}
                              onClick={() => handleEventClick(event)}
                              className={`text-xs p-1 rounded truncate hover:opacity-90 transition-opacity flex items-center gap-1 font-medium cursor-pointer`}
                              style={{
                                backgroundColor: groupBgColor,
                                backgroundImage: groupBgImage ? `url(${groupBgImage})` : 'none',
                                backgroundSize: 'cover',
                                backgroundPosition: 'center',
                                color: isPastDate ? '#6b7280' : getEventTileTextColor(groupBgColor),
                                position: 'relative',
                                zIndex: 1,
                                border: `1px solid ${isPastDate ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)'}`,
                              }}
                              title={`${event.Game?.name || 'Game Night'} - ${event.Group?.name || 'Group'}`}
                            >
                              {groupBgImage && (
                                <div style={{
                                  position: 'absolute',
                                  top: 0,
                                  left: 0,
                                  right: 0,
                                  bottom: 0,
                                  backgroundColor: 'rgba(255, 255, 255, 0.7)',
                                  borderRadius: '0.25rem',
                                  zIndex: 0,
                                }} />
                              )}
                              <div className="flex items-center gap-1 relative z-10 flex-1 min-w-0">
                                {groupProfilePic && (
                                  <span className="flex-shrink-0 text-xs leading-none">
                                    {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                      <SafeImage
                                        src={groupProfilePic}
                                        alt={event.Group?.name || ''}
                                        fallbackIcon="👥"
                                        className="w-4 h-4 rounded-full object-cover border border-gray-300"
                                      />
                                    ) : (
                                      <span className="text-sm">{groupProfilePic}</span>
                                    )}
                                  </span>
                                )}
                                <span
                                  className="truncate"
                                  style={(() => {
                                    if (groupBgImage) {
                                      return {
                                        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.9), -1px -1px 2px rgba(0, 0, 0, 0.9)',
                                        WebkitTextStroke: groupBgImage,
                                        fontWeight: '600',
                                      };
                                    }
                                    const brightness = getBrightness(groupBgColor);
                                    return {
                                      textShadow: brightness > 128
                                        ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                        : '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)',
                                      WebkitTextStroke: brightness <= 128 ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
                                      fontWeight: '600',
                                    };
                                  })()}
                                >
                                  {event.Game?.name || 'Game Night'}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                        {dayEvents.length > 2 && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedDay({ date, events: dayEvents });
                            }}
                            className="text-xs text-blue-600 hover:text-blue-700 hover:underline cursor-pointer font-medium"
                            title={`Click to see all ${dayEvents.length} games on this day`}
                          >
                            +{dayEvents.length - 2} more
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </>
      ) : (
        /* List View */
        <div className="space-y-4">
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => navigateMonth(-1)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              ← Previous Month
            </button>
            <div className="flex-1 text-center">
              <h3 className="text-xl font-semibold text-gray-900">
                {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
              </h3>
            </div>
            <button
              onClick={() => navigateMonth(1)}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              Next Month →
            </button>
            <button
              onClick={goToToday}
              className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 transition-colors"
            >
              Today
            </button>
          </div>

          {sortedEvents.length === 0 ? (
            <p className="text-gray-600 text-center py-8">No game sessions found.</p>
          ) : (
            <div className="space-y-3">
              {sortedEvents.map(event => {
                const eventDate = new Date(event.start_date);
                const isPastEvent = eventDate < new Date();
                const groupBgColor = event.Group?.background_color || '#ffffff';
                const groupProfilePic = event.Group?.profile_picture_url;
                const groupBgImage = event.Group?.background_image_url;

                return (
                  <div
                    key={event.id}
                    onClick={() => handleEventClick(event)}
                    className={`p-4 border rounded-lg transition-all hover:shadow-md cursor-pointer`}
                    style={{
                      backgroundColor: groupBgColor,
                      backgroundImage: groupBgImage ? `url(${groupBgImage})` : 'none',
                      backgroundSize: 'cover',
                      backgroundPosition: 'center',
                      position: 'relative',
                      zIndex: 1,
                      borderColor: isPastEvent ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                    }}
                  >
                    <div style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                      borderRadius: '0.5rem',
                    }} />
                    <div className="flex justify-between items-start relative z-10">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          {groupProfilePic && (
                            <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border-2 border-gray-300 shadow-sm">
                              {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                <SafeImage
                                  src={groupProfilePic}
                                  alt={event.Group?.name}
                                  fallbackIcon="👥"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span>{groupProfilePic}</span>
                              )}
                            </div>
                          )}
                          <div>
                            <h4
                              className="font-semibold"
                              style={(() => {
                                const hasBgImage = !!groupBgImage;
                                const textColor = hasBgImage ? '#1f2937' : getContrastColor(groupBgColor);
                                const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                return {
                                  color: textColor,
                                  textShadow: hasBgImage
                                    ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                    : (isDark
                                      ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
                                      : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                  WebkitTextStroke: isDark ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
                                };
                              })()}
                            >
                              {event.Game?.name || 'Game Night'}
                            </h4>
                            <p
                              className="text-sm"
                              style={(() => {
                                const hasBgImage = !!groupBgImage;
                                const textColor = hasBgImage ? '#4b5563' : (getContrastColor(groupBgColor) === '#ffffff' ? 'rgba(255,255,255,0.9)' : '#6b7280');
                                const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                return {
                                  color: textColor,
                                  textShadow: hasBgImage
                                    ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                    : (isDark
                                      ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
                                      : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                  WebkitTextStroke: isDark ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
                                };
                              })()}
                            >
                              {event.Group?.name || 'Unknown Group'} - {eventDate.toLocaleDateString()} {eventDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </p>
                          </div>
                          {!isPastEvent && (
                            <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded ml-auto">
                              Upcoming
                            </span>
                          )}
                        </div>
                        <div className="flex gap-4 mt-2 text-sm text-gray-500">
                          <span>{formatDate(event.start_date)}</span>
                          <span>{formatTime(event.start_date)}</span>
                          {event.duration_minutes && (
                            <span>{event.duration_minutes} min</span>
                          )}
                        </div>
                        {/* RSVP counts for upcoming events */}
                        {!isPastEvent && (
                          <RsvpCount rsvpSummary={event.rsvp_summary} variant="full" className="mt-1.5 text-xs" />
                        )}
                      </div>
                      <SafeImage
                        src={event.Game?.image_url}
                        alt={event.Game?.name}
                        className="w-16 h-16 object-cover rounded"
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal for showing all events on a day */}
      {selectedDay && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
          onClick={() => setSelectedDay(null)}
        >
          <div
            className="bg-white rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="bg-blue-600 text-white px-6 py-4 flex justify-between items-center">
              <h3 className="text-xl font-bold">
                {selectedDay.date.toLocaleDateString('en-US', { 
                  weekday: 'long',
                  month: 'long', 
                  day: 'numeric',
                  year: 'numeric'
                })}
              </h3>
              <button
                onClick={() => setSelectedDay(null)}
                className="text-white hover:text-gray-200 text-2xl font-bold"
                title="Close"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto flex-1">
              {selectedDay.events.length === 0 ? (
                <p className="text-gray-600 text-center py-8">No events on this day.</p>
              ) : (
                <div className="space-y-3">
                  {selectedDay.events.map(event => {
                    const eventDate = new Date(event.start_date);
                    const isPastEvent = eventDate < new Date();
                    const groupBgColor = event.Group?.background_color || '#ffffff';
                    const groupProfilePic = event.Group?.profile_picture_url;
                    const groupBgImage = event.Group?.background_image_url;

                    return (
                      <div
                        key={event.id}
                        onClick={() => {
                          handleEventClick(event);
                          setSelectedDay(null);
                        }}
                        className={`p-4 border rounded-lg transition-all hover:shadow-md cursor-pointer`}
                        style={{
                          backgroundColor: groupBgColor,
                          backgroundImage: groupBgImage ? `url(${groupBgImage})` : 'none',
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                          position: 'relative',
                          zIndex: 1,
                          borderColor: isPastEvent ? 'rgba(0,0,0,0.1)' : 'rgba(0,0,0,0.2)',
                        }}
                      >
                        <div style={{
                          position: 'absolute',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
                          borderRadius: '0.5rem',
                        }} />
                        <div className="flex justify-between items-start relative z-10">
                          <div className="flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              {groupProfilePic && (
                                <div className="w-10 h-10 rounded-full bg-white flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border-2 border-gray-300 shadow-sm">
                                  {groupProfilePic.startsWith('http') || groupProfilePic.startsWith('/') ? (
                                    <SafeImage
                                      src={groupProfilePic}
                                      alt={event.Group?.name}
                                      fallbackIcon="👥"
                                      className="w-full h-full object-cover"
                                    />
                                  ) : (
                                    <span>{groupProfilePic}</span>
                                  )}
                                </div>
                              )}
                              <div>
                                <h4
                                  className="font-semibold"
                                  style={(() => {
                                    const hasBgImage = !!groupBgImage;
                                    const textColor = hasBgImage ? '#1f2937' : getContrastColor(groupBgColor);
                                    const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                    return {
                                      color: textColor,
                                      textShadow: hasBgImage
                                        ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                        : (isDark
                                          ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
                                          : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                      WebkitTextStroke: isDark ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
                                    };
                                  })()}
                                >
                                  {event.Game?.name || 'Game Night'}
                                </h4>
                                <p
                                  className="text-sm"
                                  style={(() => {
                                    const hasBgImage = !!groupBgImage;
                                    const textColor = hasBgImage ? '#4b5563' : (getContrastColor(groupBgColor) === '#ffffff' ? 'rgba(255,255,255,0.9)' : '#6b7280');
                                    const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

                                    return {
                                      color: textColor,
                                      textShadow: hasBgImage
                                        ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
                                        : (isDark
                                          ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
                                          : '1px 1px 2px rgba(255, 255, 255, 0.9)'),
                                      WebkitTextStroke: isDark ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
                                    };
                                  })()}
                                >
                                  {event.Group?.name || 'Unknown Group'} - {formatTime(event.start_date)}
                                </p>
                              </div>
                              {!isPastEvent && (
                                <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded ml-auto">
                                  Upcoming
                                </span>
                              )}
                            </div>
                            <div className="flex gap-4 mt-2 text-sm text-gray-500">
                              {event.duration_minutes && (
                                <span>Duration: {event.duration_minutes} min</span>
                              )}
                            </div>
                          </div>
                          <SafeImage
                            src={event.Game?.image_url}
                            alt={event.Game?.name}
                            className="w-16 h-16 object-cover rounded"
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

