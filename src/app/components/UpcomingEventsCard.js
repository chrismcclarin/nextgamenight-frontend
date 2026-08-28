'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '../components/TimezoneProvider';
import { EmptyState } from '../../components/ui/EmptyState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { selectUpcomingWithin7Days } from '../../lib/upcomingEvents';

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
 *   Resolved at the parent via the shared useSelfIdentity() query (selfUuid);
 *   Phase 87.3-07 (D-02). When null/missing, no event is marked as guest
 *   (graceful default).
 * @param {Object} [props.errorState=null] - Phase 88-18 (Req 6 / T-88-18-01):
 *   the OWNER of the events fetch passes its `useFetchErrorState` result here so
 *   a failed load renders the shared error treatment INSIDE this card instead of
 *   falling through to "nothing on the calendar". The card does not fetch, so it
 *   cannot derive this itself.
 * @param {React.ReactNode} [props.action=null] - Optional caller-owned CTA for
 *   the empty state, so any gating stays at the call site.
 * @param {(event: Object) => void} [props.onEventClick=null] - Phase 88.1-20 (WR-02):
 *   optional caller-owned row activation, so any host-specific teardown stays at the
 *   call site — the 11a BottomSheet must CLOSE before it navigates, and the desktop
 *   column has nothing to close. When omitted the card navigates itself, unchanged.
 */
export default function UpcomingEventsCard({ events, showGroupName = false, loading = false, viewerDbUserId = null, errorState = null, action = null, onEventClick = null }) {
  const router = useRouter();
  const { timezone } = useTimezone();
  const [expanded, setExpanded] = useState(false);

  /* DECISION Phase 88.1-05 (Req-11, PATTERNS S5): the 7-day window + status filter + sort
     that used to live inline HERE now lives in the shared `selectUpcomingWithin7Days`
     selector — chosen OVER keeping the predicate in this component. The page owner passes
     the RAW list (UserHomePage.js: "UpcomingEventsCard does its own filter+sort"), so the
     phone bottom bar's upcoming-count pill (plan 88.1-08) has to derive its NUMBER from the
     same predicate this body derives its ROWS from, or the bar advertises a count the sheet
     does not show. Re-inlining it here is a decision, not a cleanup. The selector tolerates
     null/undefined, which is why the old `safeEvents` guard is gone rather than lost. */
  const upcomingEvents = selectUpcomingWithin7Days(events);

  const displayEvents = expanded ? upcomingEvents : upcomingEvents.slice(0, 3);
  const overflowCount = upcomingEvents.length - 3;

  /* DECISION Phase 88.1-20 (WR-02/WR-03): row activation is OVERRIDABLE by the host, and the
     row is a real <button>. Chosen OVER moving `router.push` out of the card entirely (rejected:
     the desktop call site has no reason to own a URL, and moving it would change two call sites
     to fix one) and OVER `role="button"` + tabIndex + an Enter/Space handler on the existing div
     (rejected: a native button is Enter AND Space by construction — `CalendarListView.js`'s
     EventRow predates this row and is not a reason to hand-roll what the platform provides).
     The URL shape is deliberately NOT unified with `UserHomePage.js`'s and `EventCalendar.js`'s
     copies of it; that divergence is recorded as out of scope at `UserHomePage.js:145-148`. */
  const handleEventClick = (event) => {
    if (onEventClick) {
      onEventClick(event);
      return;
    }
    router.push(`/gameDetail?event_id=${event.id}&group_id=${event.group_id}`);
  };

  return (
    <div className="card p-3 md:p-6 mb-4">
      <h3 className="font-medium text-content-primary">Upcoming Events</h3>

      {loading ? (
        /* 88-33 Task 1 (M1's in-page-spinner class, walk row "In-page loading states name
           what is loading"): a named status, not a bare "Loading..." — the accessible name
           is what a screen-reader user gets, and the walk's "empty main" readings came from
           accessibility trees with nothing in them. */
        <p
          role="status"
          aria-label="Loading your upcoming events"
          className="text-sm text-content-muted mt-2"
        >
          Loading your upcoming events...
        </p>
      ) : errorState?.showError ? (
        /* DECISION Phase 88-18 (Req 6 / T-88-18-01): a failed events fetch renders the shared
           error treatment here, checked BEFORE the empty branch. The parent used to swallow the
           failure in a `console.error` and hand this card an empty array, so the card printed
           "No upcoming events" at someone whose calendar had simply failed to load. Empty and
           failed are different facts (UI-SPEC 9.2). Ordering is load-bearing: an errored fetch
           also has zero events, so flipping these two branches silently restores the bug. */
        <div className="mt-2">
          <FetchErrorBanner
            state={errorState}
            title="We couldn't load your upcoming events"
            reportContext="Upcoming events card (home page)"
          />
        </div>
      ) : upcomingEvents.length === 0 ? (
        /* 88-33 Task 7 step 3 (M4 rider, UAT row 433's copy gap): the body NAMES the
           7-day window — the card silently filters to it, and the walk's "no upcoming
           events even though they created one for next week" misread came straight from
           the undisclosed window. Heading stays warm; copy recorded in the SUMMARY for
           §6.2.1 ratification at phase close. */
        <EmptyState
          icon="CalendarDays"
          heading="Nothing on the calendar"
          body="Nothing scheduled in the next 7 days — plan a game night and it'll show up here."
          action={action ?? undefined}
        />
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
              /* `block w-full text-left` restores the div's layout — a button is inline-block
                 and centre-aligned by default, which would silently restyle every row.

                 DECISION Phase 88.1-21 (owner D-13, 88.1-CODE-REVIEW.md H2): the 44px floor is
                 `min-h-11 md:min-h-0` — kept on PHONE, released at >=768px. At py-1.5 with
                 text-sm these rows measure ~32px, and this project treats 44 as a floor rather
                 than a target (WR-03), but WR-03's unqualified `min-h-11` also grew the rows on
                 DESKTOP, and Req 11's acceptance says the >=768px layout is pixel-unchanged.
                 Phone is where the floor earns its keep: this card also mounts inside the phone
                 sheet (`userHome/UserHomePage.js:348`), which is the surface the tenet is about.
                 REJECTED: keeping the desktop growth and amending Req 11 instead — a phone-only
                 floor is the smaller change and Req 11's boundary is the thing under test.
                 This does NOT touch WR-03's actual fix, which is that the row is a real
                 `<button>` (keyboard-reachable) rather than a click-handling div. D-13 reverses
                 the height, not the element.

                 WHY A UTILITY OPT-OUT WORKS HERE AND WOULD NOT ON A `.btn`: `globals.css`
                 :1173-1177 applies the phone floor as an UNLAYERED `.btn { min-height: 2.75rem }`,
                 and an unlayered author rule beats every `@layer utilities` rule regardless of
                 specificity — so on a `.btn` element `md:min-h-0` would silently do nothing
                 (the trap documented at `globals.css:1164-1171`, already hit twice). This row
                 is a bare `<button>` carrying no `.btn`, so the utility lands normally; a pin
                 in `UpcomingEventsCard.test.tsx` asserts that stays true.
                 Precedent for phone-scoped floors generally: `DECISION Phase 88-01 (D-36)` at
                 `globals.css:1142-1160`. */
              <button
                key={event.id}
                type="button"
                onClick={() => handleEventClick(event)}
                className={`block w-full text-left min-h-11 md:min-h-0 hover:bg-surface-hover rounded-sm py-1.5 px-2 cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${isGuestEvent ? 'border-l-2 border-dashed border-amber-400 dark:border-amber-500/70 pl-3' : ''}`}
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
                    className="inline-flex items-center px-1.5 py-0.5 ml-2 text-[10px] uppercase tracking-wide rounded-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50"
                    title="You joined this event as a guest (not a group member)"
                  >
                    Guest
                  </span>
                )}
              </button>
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
