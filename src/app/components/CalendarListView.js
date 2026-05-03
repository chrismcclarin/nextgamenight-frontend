'use client';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { getContrastColor } from '../../lib/colorUtils';
import { formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import { formatWithTzAbbr } from '../../lib/tzUtils';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

/**
 * CalendarListView — Phase 64 Plan 03 (CAL-06), revised post-pivot.
 *
 * Past + future feed grouped by date headers, rendered inside a fixed-height
 * scroll container. The OUTER card height stays constant whether the user is
 * on month or list view — switching view should not reflow the surface.
 * Inside the container, past events sit above and future events below. The
 * container scrolls; the page does not grow.
 *
 * Layout:
 *   - Section header ("Upcoming events") + tz legend (when timezone resolved)
 *   - Fixed-height scroll container (height keyed off `variant` to match
 *     CalendarMonthView's 6-row grid: compact ≈ 540px, full ≈ 660px)
 *   - Inside: top sentinel for past-event lazy load, then date-grouped rows
 *
 * Filter: NONE — all events with valid start_date are sorted chronologically.
 *
 * Initial windowing (memory + render budget):
 *   - All future events (start >= today) are rendered up front
 *   - Last 30 past events rendered initially
 *   - When the top sentinel intersects the SCROLL CONTAINER's viewport
 *     (user scrolls up), reveal 30 more past events. The IntersectionObserver
 *     uses `root: containerRef.current` so it's container-relative, not
 *     page-relative.
 *
 * Scroll anchoring:
 *   - On first render with grouped data, the FIRST upcoming event row is
 *     centered in the scroll container (block: 'center'). Past events sit
 *     above the visible window and future events below — the user sees
 *     "what's next" with context on either side.
 *   - We anchor only ONCE per mount so subsequent re-renders (RSVP refresh,
 *     more past events loaded) don't yank the user back.
 *
 * Responsive row stripping (unchanged from prior impl):
 *   - all sizes: title + start time
 *   - >=640px (sm): + game name
 *   - >=768px (md): + RSVP / participant count
 *
 * TZ correctness: all date keying + display routes through tzUtils +
 * dateUtils helpers (Phase 62 single authority — no new TZ paths).
 */
const PAST_PAGE_SIZE = 30;

// Fixed scroll-container heights chosen to match CalendarMonthView's natural
// rendered height for the same `variant`:
//   compact: 6 rows × min-h-[80px] + gaps + day-name header + month nav ≈ 540
//   full:    6 rows × min-h-[100px] + gaps + day-name header + month nav ≈ 660
// We subtract a little to account for the list view's section header/tz line
// rendered above the scroll container so the OUTER card height matches the
// month-view card height.
const CONTAINER_HEIGHT_COMPACT = 480;
const CONTAINER_HEIGHT_FULL = 600;

export default function CalendarListView({
  events,
  onEventClick,
  timezone: timezoneProp,
  loading = false,
  variant = 'full',
}) {
  const { timezone: ctxTimezone } = useTimezone();
  const timezone = timezoneProp || ctxTimezone || null;

  // tz-aware "YYYY-MM-DD" key for grouping. Same date-fns-tz pipeline as tzUtils.
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

  // Sort events chronologically and split into past vs upcoming buckets.
  // Past = strictly before today's date key. Upcoming = today onward.
  const { pastEvents, upcomingEvents } = useMemo(() => {
    const safe = Array.isArray(events) ? events : [];
    const sorted = safe
      .filter((ev) => !!ev?.start_date)
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    const past = [];
    const upcoming = [];
    for (const ev of sorted) {
      const k = dateKey(ev.start_date);
      if (!k) continue;
      if (k >= todayKey) upcoming.push(ev);
      else past.push(ev);
    }
    return { pastEvents: past, upcomingEvents: upcoming };
  }, [events, todayKey, timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  // How many past events are revealed. Starts at PAST_PAGE_SIZE, grows as the
  // user scrolls up into history. Capped at pastEvents.length.
  const [pastVisibleCount, setPastVisibleCount] = useState(PAST_PAGE_SIZE);

  // Reset the past window when the underlying events array changes identity
  // (new fetch / refresh). Prevents the window from growing unbounded across
  // event refetches and keeps the initial scroll anchor logic predictable.
  useEffect(() => {
    setPastVisibleCount(PAST_PAGE_SIZE);
    // We want this to fire only when `events` reference changes (new fetch).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Build the rendered window: last N past events + all upcoming events.
  const visiblePast = useMemo(() => {
    if (pastEvents.length === 0) return [];
    const start = Math.max(0, pastEvents.length - pastVisibleCount);
    return pastEvents.slice(start);
  }, [pastEvents, pastVisibleCount]);

  const allMorePastLoaded = visiblePast.length >= pastEvents.length;

  // Group the visible window into date buckets.
  const grouped = useMemo(() => {
    const combined = [...visiblePast, ...upcomingEvents];
    if (combined.length === 0) return [];
    const map = new Map();
    for (const ev of combined) {
      const k = dateKey(ev.start_date);
      if (!map.has(k)) map.set(k, { key: k, sample: ev.start_date, items: [] });
      map.get(k).items.push(ev);
    }
    return Array.from(map.values());
  }, [visiblePast, upcomingEvents, timezone]); // eslint-disable-line react-hooks/exhaustive-deps

  // Anchor on the first upcoming event after first render. We only do this
  // once per mount — subsequent updates (RSVP refresh, more past loaded)
  // shouldn't yank the user back. We scroll the SCROLL CONTAINER (not the
  // page) and center the row vertically so past context sits above and
  // future context sits below.
  const containerRef = useRef(null);
  const anchorRef = useRef(null);
  const hasAnchoredRef = useRef(false);
  useEffect(() => {
    if (hasAnchoredRef.current) return;
    const container = containerRef.current;
    const anchor = anchorRef.current;
    if (!container) return;
    if (upcomingEvents.length === 0) {
      // No upcoming events — nothing to anchor to. Mark anchored so we don't
      // keep re-checking on every render.
      hasAnchoredRef.current = true;
      return;
    }
    if (!anchor) return;
    // Compute target so the anchor row sits at the vertical center of the
    // scroll container. offsetTop is relative to the offsetParent — since the
    // container is `position: relative` it serves as the offset parent for
    // descendants, which is exactly what we want.
    const target =
      anchor.offsetTop - container.clientHeight / 2 + anchor.clientHeight / 2;
    container.scrollTop = Math.max(0, target);
    hasAnchoredRef.current = true;
  }, [grouped, upcomingEvents.length]);

  // Top-sentinel IntersectionObserver: when the sentinel enters the SCROLL
  // CONTAINER's viewport AND there are more past events to load, reveal
  // another page of them. We use the scroll container as the IO root so the
  // sentinel triggers when scrolled to the top of the card, not the page.
  const sentinelRef = useRef(null);
  useEffect(() => {
    const node = sentinelRef.current;
    const root = containerRef.current;
    if (!node || !root) return;
    if (allMorePastLoaded) return; // No more to load — observer is a no-op.

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setPastVisibleCount((prev) =>
              Math.min(prev + PAST_PAGE_SIZE, pastEvents.length)
            );
          }
        }
      },
      {
        root,
        // Trigger slightly before the sentinel is fully visible so the new
        // batch is ready by the time the user reaches it.
        rootMargin: '200px 0px 0px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [allMorePastLoaded, pastEvents.length]);

  // First-upcoming index in the rendered window — used to drop the
  // anchor ref on the right row. It's the row whose date key is the
  // smallest k >= todayKey within the rendered groups.
  const firstUpcomingKey = upcomingEvents.length > 0
    ? dateKey(upcomingEvents[0].start_date)
    : null;

  // Fixed scroll-container height matched to month-view's natural height for
  // this variant. Inline style (vs Tailwind arbitrary class) so the value
  // can be a const shared with the loading skeleton.
  const containerHeight =
    variant === 'compact' ? CONTAINER_HEIGHT_COMPACT : CONTAINER_HEIGHT_FULL;

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

  // Loading skeleton — only when no data has arrived yet AND parent signals
  // loading. Empty state is the right answer once data has resolved. The
  // skeleton renders inside the same fixed-height shell so the card doesn't
  // reflow between loading and loaded states.
  if (loading && (!Array.isArray(events) || events.length === 0)) {
    return (
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h3 className="text-lg font-semibold text-content-primary">Upcoming events</h3>
        </div>
        <div
          className="relative overflow-y-auto pr-1"
          style={{ height: containerHeight }}
        >
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border rounded-lg p-4 animate-pulse">
                <div className="h-4 w-1/3 bg-surface-elevated rounded mb-2" />
                <div className="h-3 w-1/4 bg-surface-elevated rounded" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

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

      <div
        ref={containerRef}
        className="relative overflow-y-auto pr-1"
        style={{ height: containerHeight }}
      >
        {grouped.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-content-secondary text-base">No events</p>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Top sentinel — fires the rolling past-event load when scrolled
                into view of the scroll container. Hidden when all past
                events are already loaded. */}
            {!allMorePastLoaded && (
              <div ref={sentinelRef} className="h-1" aria-hidden="true" />
            )}

            {grouped.map((group) => {
              const isFirstUpcomingGroup = group.key === firstUpcomingKey;
              return (
                <section key={group.key} className="space-y-2">
                  <h4 className="text-sm font-semibold text-content-secondary uppercase tracking-wide pb-1 border-b border-line">
                    {formatDayHeader(group.sample)}
                  </h4>
                  <div className="space-y-2">
                    {group.items.map((event, idx) => {
                      // Drop the scroll anchor on the FIRST event of the
                      // FIRST upcoming group. That's the "next upcoming" row.
                      const isAnchor = isFirstUpcomingGroup && idx === 0;
                      return (
                        <EventRow
                          key={event.id}
                          ref={isAnchor ? anchorRef : null}
                          event={event}
                          timezone={timezone}
                          onClick={() => onEventClick && onEventClick(event)}
                        />
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Single event row.
 *
 * Visual chrome unchanged from prior impl — past and future events share
 * styling (no muting). Only the layout supports responsive stripping.
 *
 * Always: title + start time
 * sm:    + game name
 * md:    + RSVP / participant count
 *
 * Forwards a ref so CalendarListView can scroll the next-upcoming row into
 * view on first paint.
 */
const EventRow = forwardRef(function EventRow({ event, timezone, onClick }, ref) {
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
      ref={ref}
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
});
