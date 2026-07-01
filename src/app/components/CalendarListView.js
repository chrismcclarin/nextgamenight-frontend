'use client';
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react';
import { getContrastColor } from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { formatTime, formatWithTzAbbr } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';

/**
 * CalendarListView — Phase 64 Plan 03 (CAL-06), Today-delineator revision.
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
 *   - Inside, in order:
 *       1. Top sentinel for past-event lazy load
 *       2. Past date-groups (events strictly before today's TZ-keyed date)
 *       3. Always-on "Today" delineator row (horizontal rule + centered chip)
 *       4. Today + future date-groups (events on/after today's TZ-keyed date)
 *     The Today delineator is rendered REGARDLESS of whether any event falls
 *     on today's date — it's a stable cross-cutting marker, not a date-group.
 *
 * Filter: NONE — all events with valid start_date are sorted chronologically.
 *
 * Initial windowing (memory + render budget):
 *   - All today + future events rendered up front
 *   - Last 30 past events rendered initially
 *   - When the top sentinel intersects the SCROLL CONTAINER's viewport
 *     (user scrolls up), reveal 30 more past events. The IntersectionObserver
 *     uses `root: containerRef.current` so it's container-relative, not
 *     page-relative.
 *
 * Scroll anchoring:
 *   - On first render with grouped data, the TODAY DELINEATOR is centered in
 *     the scroll container. Past events sit above the visible window and
 *     today+future context sits below. We anchor on the divider rather than
 *     the first upcoming event because the divider always exists — even when
 *     the group has only past events, only future events, or no events at all.
 *   - Anchor once per mount so subsequent re-renders (RSVP refresh, more past
 *     events loaded) don't yank the user back.
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

  // Long, friendly date header — "Saturday, May 10". Rendered in the viewer's
  // timezone via the consolidated datetime layer; formatWithTzAbbr falls back to
  // UTC internally when timezone is unset (the provider already defaults it to
  // browser/UTC, so the bare-UTC branch is defensive only). The catch handles a
  // malformed IANA string by rendering in UTC rather than crashing.
  const formatDayHeader = (utc) => {
    const d = new Date(utc);
    if (isNaN(d.getTime())) return '';
    try {
      return formatWithTzAbbr(d, timezone, 'EEEE, MMMM d');
    } catch {
      return formatWithTzAbbr(d, null, 'EEEE, MMMM d');
    }
  };

  // Sort events chronologically and split into past vs today/future buckets.
  // Past = strictly before today's date key. todayAndFuture = today onward.
  const { pastEvents, todayAndFutureEvents } = useMemo(() => {
    const safe = Array.isArray(events) ? events : [];
    const sorted = safe
      .filter((ev) => !!ev?.start_date)
      .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

    const past = [];
    const todayAndFuture = [];
    for (const ev of sorted) {
      const k = dateKey(ev.start_date);
      if (!k) continue;
      if (k >= todayKey) todayAndFuture.push(ev);
      else past.push(ev);
    }
    return { pastEvents: past, todayAndFutureEvents: todayAndFuture };
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

  // Group past + today/future into separate date-bucket arrays. We render
  // them as two distinct sections sandwiching the always-on Today delineator.
  const groupByDate = (list) => {
    if (!list || list.length === 0) return [];
    const map = new Map();
    for (const ev of list) {
      const k = dateKey(ev.start_date);
      if (!map.has(k)) map.set(k, { key: k, sample: ev.start_date, items: [] });
      map.get(k).items.push(ev);
    }
    return Array.from(map.values());
  };

  const pastGroups = useMemo(
    () => groupByDate(visiblePast),
    [visiblePast, timezone] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const futureGroups = useMemo(
    () => groupByDate(todayAndFutureEvents),
    [todayAndFutureEvents, timezone] // eslint-disable-line react-hooks/exhaustive-deps
  );

  const hasAnyEvents = pastGroups.length > 0 || futureGroups.length > 0;

  // Anchor on the always-on TODAY DELINEATOR after first render. We only do
  // this once per mount — subsequent updates (RSVP refresh, more past loaded)
  // shouldn't yank the user back. We scroll the SCROLL CONTAINER (not the
  // page) and center the divider vertically so past context sits above and
  // today/future context sits below. The divider always exists, so this
  // anchor works for every shape of data: all-past, all-future, mixed,
  // and even no-events.
  const containerRef = useRef(null);
  const todayDividerRef = useRef(null);
  const hasAnchoredRef = useRef(false);
  useEffect(() => {
    if (hasAnchoredRef.current) return;
    const container = containerRef.current;
    const divider = todayDividerRef.current;
    if (!container || !divider) return;
    // Compute target so the divider sits at the vertical center of the scroll
    // container. offsetTop is relative to the offsetParent — since the
    // container is `position: relative` it serves as the offset parent for
    // descendants, which is exactly what we want.
    const target =
      divider.offsetTop - container.clientHeight / 2 + divider.clientHeight / 2;
    container.scrollTop = Math.max(0, target);
    hasAnchoredRef.current = true;
  }, [pastGroups, futureGroups]);

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

  // Today delineator label — TZ-aware, short. e.g. "Today, May 4". Rendered via
  // the consolidated datetime layer (UTC fallback handled internally / in catch).
  const todayLabel = useMemo(() => {
    const now = new Date();
    try {
      return `Today, ${formatWithTzAbbr(now, timezone, 'MMM d')}`;
    } catch {
      return `Today, ${formatWithTzAbbr(now, null, 'MMM d')}`;
    }
    // todayKey included so the label re-renders if the calendar day rolls
    // over while the component is mounted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timezone, todayKey]);

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
        <div className="space-y-6">
          {/* Top sentinel — fires the rolling past-event load when scrolled
              into view of the scroll container. Hidden when all past events
              are already loaded (or there are no past events at all). */}
          {!allMorePastLoaded && pastEvents.length > 0 && (
            <div ref={sentinelRef} className="h-1" aria-hidden="true" />
          )}

          {/* Past date-groups (events strictly before today's TZ-keyed date) */}
          {pastGroups.map((group) => (
            <DateGroup
              key={group.key}
              group={group}
              formatDayHeader={formatDayHeader}
              timezone={timezone}
              onEventClick={onEventClick}
            />
          ))}

          {/* Always-on TODAY delineator. Centered chip over a horizontal rule.
              This is the scroll anchor regardless of where today falls in the
              data (or whether it falls anywhere at all). */}
          <TodayDivider ref={todayDividerRef} label={todayLabel} />

          {/* Today + future date-groups. The first group below the divider
              IS today's date-group when today has events; otherwise it's the
              next future date-group; otherwise nothing. */}
          {futureGroups.map((group) => (
            <DateGroup
              key={group.key}
              group={group}
              formatDayHeader={formatDayHeader}
              timezone={timezone}
              onEventClick={onEventClick}
            />
          ))}

          {/* Empty-state hint: only when there are NO events at all. The
              divider still renders above; this just labels the empty card. */}
          {!hasAnyEvents && (
            <div className="flex items-center justify-center pt-4">
              <p className="text-content-secondary text-sm">No events</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Today delineator — full-width horizontal rule with a centered "Today, MMM d"
 * chip. Always rendered. Visually distinct from date-group headers (which are
 * left-aligned uppercase text underlined by a thin border).
 *
 * Forwards a ref so CalendarListView can center-scroll to it on first paint.
 */
const TodayDivider = forwardRef(function TodayDivider({ label }, ref) {
  return (
    <div
      ref={ref}
      role="separator"
      aria-label={label}
      className="relative flex items-center justify-center py-2"
    >
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-content-link/40" aria-hidden="true" />
      <span className="relative z-10 inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-content-link text-white shadow-theme-sm">
        {label}
      </span>
    </div>
  );
});

/**
 * One date-group section (date header + its event rows). Extracted so the
 * past and future renders share identical chrome.
 */
function DateGroup({ group, formatDayHeader, timezone, onEventClick }) {
  return (
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
        ...safeBgImageStyle(groupBgImage),
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
