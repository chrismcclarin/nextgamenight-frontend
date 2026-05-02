'use client';
import { getEventsForDate, isToday } from '../../lib/calendarUtils';
import { getEventTileTextColor, getBrightness } from '../../lib/colorUtils';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

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

const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function CalendarMonthView({
  days,
  activeEvents,
  currentDate,
  variant,
  onEmptyDayClick,
  onEventClick,
  onNavigateMonth,
  onGoToday,
  onShowDayModal,
  monthNames,
  tzLegend,
}) {
  return (
    <>
      {/* Month Navigation */}
      <div className="flex justify-between items-center mb-4">
        <button
          onClick={() => onNavigateMonth(-1)}
          className="btn btn-primary"
        >
          &larr; Previous
        </button>
        <div className="text-center">
          <h3 className="text-xl font-semibold text-content-primary">
            {monthNames[currentDate.getMonth()]} {currentDate.getFullYear()}
          </h3>
          {tzLegend && (
            <p className="text-xs text-content-muted mt-0.5">
              Times shown in {tzLegend}
            </p>
          )}
          <button
            onClick={onGoToday}
            className="text-sm text-content-link hover:text-content-link-hover mt-1"
          >
            Go to Today
          </button>
        </div>
        <button
          onClick={() => onNavigateMonth(1)}
          className="btn btn-primary"
        >
          Next &rarr;
        </button>
      </div>

      {/* Calendar Grid */}
      <div className="grid grid-cols-7 gap-1 mb-4">
        {dayNames.map(day => (
          <div key={day} className="text-center font-semibold text-content-secondary py-2 text-sm">
            {day}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {days.map((date, index) => {
          const dayEvents = getEventsForDate(date, activeEvents);
          const isCurrentDay = isToday(date);
          const isPastDate = isPast(date);
          const isFutureDate = isFuture(date);
          const isEmpty = date && dayEvents.length === 0;

          return (
            <div
              key={index}
              onClick={() => {
                if (isEmpty && onEmptyDayClick) {
                  const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
                  onEmptyDayClick(dateStr);
                }
              }}
              className={`${variant === 'compact' ? 'min-h-[80px]' : 'min-h-[100px]'} border border-line rounded p-1 ${variant === 'compact' ? 'flex flex-col' : ''} ${
                !date ? 'bg-surface-page' :
                isCurrentDay ? 'bg-surface-card-hover border-line-accent' :
                variant === 'full' && isPastDate ? 'bg-surface-page' :
                isEmpty && onEmptyDayClick ? 'bg-surface-card hover:bg-surface-card-hover hover:border-line-accent cursor-pointer transition-colors group' :
                'bg-surface-card'
              }`}
            >
              {date && (
                <>
                  <div className={`${variant === 'compact' ? 'text-xs' : 'text-sm'} font-medium mb-1 ${
                    isCurrentDay ? 'text-accent' :
                    variant === 'full' && isPastDate ? 'text-content-muted' :
                    'text-content-primary'
                  }`}>
                    {date.getDate()}
                  </div>
                  {dayEvents.length > 0 ? (
                    <div className={variant === 'compact' ? 'space-y-0.5' : 'space-y-1'}>
                      {dayEvents.slice(0, 2).map(event => {
                        if (variant === 'compact') {
                          const rs = event.rsvp_summary;
                          const hasRsvps = rs && (rs.yes > 0 || rs.maybe > 0 || rs.no > 0);
                          const isFutureEvent = event.start_date && new Date(event.start_date) >= new Date();
                          return (
                            <div
                              key={event.id}
                              className="text-xs p-0.5 bg-surface-card-hover text-accent rounded font-medium cursor-pointer hover:bg-surface-elevated transition-colors"
                              onClick={(e) => {
                                e.stopPropagation();
                                onEventClick(event);
                              }}
                            >
                              <div className="truncate">{event.Game?.name || 'Game Night'}</div>
                              {hasRsvps && isFutureEvent && (
                                <RsvpCount rsvpSummary={rs} variant="compact" className="text-[10px] leading-tight mt-0.5" />
                              )}
                            </div>
                          );
                        }
                        // Full variant (user-home)
                        const groupBgColor = event.Group?.background_color || '#ffffff';
                        const groupProfilePic = event.Group?.profile_picture_url;
                        const groupBgImage = event.Group?.background_image_url;

                        return (
                          <div
                            key={event.id}
                            onClick={() => onEventClick(event)}
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
                                      className="w-4 h-4 rounded-full object-cover border border-line"
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
                            onShowDayModal({ date, events: dayEvents });
                          }}
                          className="text-xs text-content-link hover:text-content-link-hover hover:underline cursor-pointer font-medium"
                          title={`Click to see all ${dayEvents.length} games on this day`}
                        >
                          +{dayEvents.length - 2} more
                        </button>
                      )}
                    </div>
                  ) : onEmptyDayClick ? (
                    <div className="flex items-center justify-center flex-1 opacity-0 group-hover:opacity-40 transition-opacity">
                      <span className="text-2xl text-content-muted select-none">+</span>
                    </div>
                  ) : null}
                </>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}
