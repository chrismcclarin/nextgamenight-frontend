'use client';
import { useMemo } from 'react';
import { getContrastColor } from '../../lib/colorUtils';
import { formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import { formatWithTzAbbr } from '../../lib/tzUtils';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

/**
 * CalendarListView — Phase 64 Plan 03 (CAL-06)
 *
 * Date-grouped, today-onward feed of upcoming events for the calendar surface.
 * Replaces the previous month-scoped flat list (we no longer "navigate" the
 * list — list view answers "what's coming up", month view handles browsing).
 *
 * Layout:
 *   - Section header ("Upcoming events") + tz legend (when timezone resolved).
 *   - Events grouped under date headers ("Saturday, May 10").
 *   - Single-event days still render their own header (consistent rhythm).
 *
 * Filter:
 *   - today-onward only (start_date >= start of today in user's effective TZ).
 *   - past events DROPPED (they live in event detail / game-history surfaces).
 *
 * Sort: chronological ascending.
 *
 * Responsive row stripping (mirrors UpcomingEventsCard's "drop info as the
 * screen shrinks" philosophy):
 *   - all sizes: title + start time
 *   - >=640px (sm): + game name
 *   - >=768px (md): + RSVP / participant count
 *
 * TZ correctness: all date keying + display routes through tzUtils +
 * dateUtils helpers (Phase 62 single authority — no new TZ paths).
 */
export default function CalendarListView({
  events,
  onEventClick,
  timezone: timezoneProp,
  loading = false,
}) {
  // useTimezone provides the user's effective TZ. We accept an explicit
  // `timezone` prop too so EventCalendar can pass through the same value
  // it already pulled from the provider — but fall back to the hook so
  // standalone usage still works.
  const { timezone: ctxTimezone } = useTimezone();
  const timezone = timezoneProp || ctxTimezone || null;

  // tz-aware "YYYY-MM-DD" key for grouping. Uses the same date-fns-tz
  // pipeline as tzUtils — no parallel TZ math.
  const dateKey = (utc) => {
    if (!utc) return '';
    if (timezone) {
      try {
        return formatWithTzAbbr(utc, timezone, 'yyyy-MM-dd');
      } catch {
        // fall through to local
      }
    }
    const d = new Date(utc);
    if (isNaN(d.getTime())) return '';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  };

  // Today's local-calendar date key (in the user's effective TZ).
  const todayKey = useMemo(() => dateKey(new Date()), [timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Long, friendly date header — "Saturday, May 10".
  const formatDayHeader = (utc) => {
    if (timezone) {
      try {
        return formatWithTzAbbr(utc, timezone, 'EEEE, MMMM d');
      } catch {
        // fall through
      }
    }
    const d = new Date(utc);
    if (isNaN(d.getTime())) return '';
    return d.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
    });
  };

  // Filter today-onward + sort ascending + group by date key.
  const grouped = useMemo(() => {
    const safe = Array.isArray(events) ? events : [];
    const future = safe
      .filter((ev) => {
        const k = dateKey(ev.start_date);
        return k && k >= todayKey;
      })
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    const map = new Map();
    for (const ev of future) {
      const k = dateKey(ev.start_date);
      if (!map.has(k)) map.set(k, { key: k, sample: ev.start_date, items: [] });
      map.get(k).items.push(ev);
    }
    return Array.from(map.values());
  }, [events, todayKey, timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Loading skeleton — only when we genuinely have no data yet AND parent
  // signals loading. Otherwise the empty state is the right answer.
  if (loading && (!Array.isArray(events) || events.length === 0)) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-content-primary">Upcoming events</h3>
        </div>
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border rounded-lg p-4 animate-pulse">
              <div className="h-4 w-1/3 bg-surface-elevated rounded mb-2" />
              <div className="h-3 w-1/4 bg-surface-elevated rounded" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // tz legend — mirror EventCalendar's "Times shown in {abbr}" pattern.
  const tzAbbr = timezone
    ? (() => {
        try {
          return formatWithTzAbbr(new Date(), timezone, 'zzz');
        } catch {
          return null;
        }
      })()
    : null;

  return (
    <div className="space-y-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <h3 className="text-lg font-semibold text-content-primary">Upcoming events</h3>
        {tzAbbr && (
          <span className="text-xs text-content-muted">
            Times shown in {tzAbbr}
          </span>
        )}
      </div>

      {grouped.length === 0 ? (
        <div className="text-center py-10">
          <p className="text-content-secondary text-base">No upcoming events</p>
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map((group) => (
            <section key={group.key} className="space-y-2">
              <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wide pb-1 border-b border-line">
                {formatDayHeader(group.sample)}
              </h4>
              <div className="space-y-2">
                {group.items.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    timezone={timezone}
                    onClick={() => onEventClick && onEventClick(event)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Single event row.
 *
 * Visual chrome matches the prior list view's per-event styling (group bg
 * color/image, profile pic, contrast-aware text) — only the layout changes
 * to support responsive stripping.
 *
 * Always: title + start time
 * sm:    + game name
 * md:    + RSVP / participant count
 */
function EventRow({ event, timezone, onClick }) {
  const groupBgColor = event.Group?.background_color || '#ffffff';
  const groupBgImage = event.Group?.background_image_url;
  const groupProfilePic = event.Group?.profile_picture_url;

  const hasBgImage = !!groupBgImage;
  const titleColor = hasBgImage ? '#1f2937' : getContrastColor(groupBgColor);
  const isDark = !hasBgImage && getContrastColor(groupBgColor) === '#ffffff';

  const titleStyle = {
    color: titleColor,
    textShadow: hasBgImage
      ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
      : isDark
        ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
        : '1px 1px 2px rgba(255, 255, 255, 0.9)',
    WebkitTextStroke: isDark ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
  };
  const subtitleColor = hasBgImage
    ? '#4b5563'
    : getContrastColor(groupBgColor) === '#ffffff'
      ? 'rgba(255,255,255,0.9)'
      : '#6b7280';
  const subtitleStyle = {
    color: subtitleColor,
    textShadow: hasBgImage
      ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
      : isDark
        ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
        : '1px 1px 2px rgba(255, 255, 255, 0.9)',
    WebkitTextStroke: isDark ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
  };

  const eventTitle = event.title || event.Game?.name || 'Game Night';
  const startTime = formatTime(event.start_date, timezone);
  const gameName = event.Game?.name;
  // Avoid duplicating game name if title already equals it.
  const showGameName = gameName && gameName !== eventTitle;

  return (
    <div
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick && onClick();
        }
      }}
      role="button"
      tabIndex={0}
      className="p-3 sm:p-4 border rounded-lg transition-all hover:shadow-md cursor-pointer focus:outline-none focus:ring-2 focus:ring-content-link"
      style={{
        backgroundColor: groupBgColor,
        backgroundImage: groupBgImage ? `url(${groupBgImage})` : 'none',
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        position: 'relative',
        zIndex: 1,
        borderColor: 'rgba(0,0,0,0.2)',
      }}
    >
      {/* contrast wash for bg images */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent',
          borderRadius: '0.5rem',
        }}
      />
      <div className="relative z-10 flex items-center gap-3">
        {groupProfilePic && (
          <div className="w-10 h-10 rounded-full bg-surface-card flex items-center justify-center text-xl flex-shrink-0 overflow-hidden border-2 border-line shadow-theme-sm">
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

        <div className="flex-1 min-w-0">
          {/* always-visible row: title + time */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <h5
              className="font-semibold text-base truncate"
              style={titleStyle}
            >
              {eventTitle}
            </h5>
            <span className="text-sm" style={subtitleStyle}>
              {startTime}
            </span>
          </div>

          {/* sm: game name (drops below 640px) */}
          {showGameName && (
            <p
              className="hidden sm:block text-sm truncate mt-0.5"
              style={subtitleStyle}
            >
              {gameName}
            </p>
          )}

          {/* md: RSVP count (drops below 768px) */}
          <div className="hidden md:flex mt-1.5">
            <RsvpCount
              rsvpSummary={event.rsvp_summary}
              variant="full"
              className="text-xs"
            />
          </div>
        </div>

        {event.Game?.image_url && (
          <SafeImage
            src={event.Game.image_url}
            alt={event.Game?.name}
            className="hidden sm:block w-12 h-12 md:w-14 md:h-14 object-cover rounded flex-shrink-0"
          />
        )}
      </div>
    </div>
  );
}
