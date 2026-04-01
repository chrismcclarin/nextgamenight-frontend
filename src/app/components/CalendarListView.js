'use client';
import { getContrastColor } from '../../lib/colorUtils';
import { formatDate, formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

export default function CalendarListView({
  sortedEvents,
  currentDate,
  onEventClick,
  onNavigateMonth,
  onGoToday,
  monthNames,
}) {
  const { timezone } = useTimezone();

  return (
    <div className="space-y-4">
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => onNavigateMonth(-1)}
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
          onClick={() => onNavigateMonth(1)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          Next Month →
        </button>
        <button
          onClick={onGoToday}
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
                onClick={() => onEventClick(event)}
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
                          {event.Group?.name || 'Unknown Group'} - {formatDate(event.start_date, timezone)} {formatTime(event.start_date, timezone)}
                        </p>
                      </div>
                      {!isPastEvent && (
                        <span className="px-2 py-0.5 bg-green-100 text-green-800 text-xs rounded ml-auto">
                          Upcoming
                        </span>
                      )}
                    </div>
                    <div className="flex gap-4 mt-2 text-sm text-gray-500">
                      <span>{formatDate(event.start_date, timezone)}</span>
                      <span>{formatTime(event.start_date, timezone)}</span>
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
  );
}
