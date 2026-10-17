'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useTimezone } from '../components/TimezoneProvider';
import { EmptyState } from '../../components/ui/EmptyState';
import { Heading } from '../../components/ui/Heading';
import { FetchErrorBanner, RefreshFailedNotice } from '../../components/ui/FetchErrorBanner';
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
 * @param {boolean} [props.busy=false] - Plan 88.6.1-62 (Req 9): the host's refresh is in flight;
 *   marks the rows wrapper (or the retained empty state) `aria-busy` in place. No live region
 *   lives inside either.
 * @param {boolean} [props.retained=false] - Plan 88.6.1-62: the host's `useRetainedContent`
 *   result — content from an earlier SUCCESSFUL load for the host's current identity may stay on
 *   screen (88.6.1-70 contract C3 + C10: has-loaded, never a row count; false for an access or
 *   gone answer). The card computes nothing itself and lists no codes.
 * @param {{ current: HTMLElement | null } | null} [props.headingRef=null] - Plan 88.6.1-62: the
 *   host's ref for this card's heading, so the host's C12 guard and this card's notice share ONE
 *   target; absent, the card uses its own.
 */
export default function UpcomingEventsCard({ events, showGroupName = false, loading = false, viewerDbUserId = null, errorState = null, action = null, onEventClick = null, busy = false, retained = false, headingRef = null }) {
  const router = useRouter();
  const { timezone } = useTimezone();
  const [expanded, setExpanded] = useState(false);
  const ownHeadingRef = useRef(null);
  const upcomingHeadingRef = headingRef ?? ownHeadingRef;

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
      {/* DECISION Phase 88.6-28 (D-04/§4.4 size-less-headings row, §4.5): this card title moves
          onto the `Heading` primitive at `level={3} size="body"` — 16px, the size-less-heading
          rung — and takes its 700 from the primitive's cva base.

          THE WEIGHT IS WHY THIS SITE IS RECORDED SEPARATELY: at HEAD it carried `font-medium`,
          and it was the ONLY heading in the entire tree at weight 500. It is the single site that
          makes `typeScaleTouchedSurfaces.test.ts`'s "raw headings need a weight edit" population
          read "N-1 font-semibold and 1 font-medium" rather than being uniformly 600. That
          sentence in the gate's own assertion message is updated in the same commit.

          LEVEL PRESERVED (P4): it was an `<h3>` and it renders an `<h3>`. `EXPECTED_LEVELS`'
          `{ 3: 1 }` entry for this file is byte-unchanged, which is the assertion that proves it.
          `size` is passed EXPLICITLY rather than derived — the primitive would derive `heading`
          (20) from level 3, and §4.4 routes a SIZE-LESS heading to Body 16 instead, so inheriting
          here would be a silent +4px. `font-medium` is DELETED rather than carried: the base is
          `font-bold` and a 500 utility beside it would lose to the cascade anyway while reading
          like an intentional override. */}
      <Heading level={3} size="body" className="text-content-primary" ref={upcomingHeadingRef}>
        Upcoming Events
      </Heading>

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
      ) : errorState?.showError && !retained ? (
        /* DECISION Phase 88-18 (Req 6 / T-88-18-01): a failed events fetch renders the shared
           error treatment here, checked BEFORE the empty branch. The parent used to swallow the
           failure in a `console.error` and hand this card an empty array, so the card printed
           "No upcoming events" at someone whose calendar had simply failed to load. Empty and
           failed are different facts (UI-SPEC 9.2). Ordering is load-bearing: an errored fetch
           also has zero events, so flipping these two branches silently restores the bug.
           AMENDED Phase 88.6.1-62 (AC-29, RF1): with nothing loaded for the host's identity the
           failure is still checked before the empty state (this full banner); after a failed
           refresh the earlier answer — rows or its empty state — stays under the RF1 notice
           (88.6.1-70 contract C3 / C6), so the empty state never stands beside a failure it would
           misreport. A first-load retry keeps this banner (r2 #69): with C2 the error stays set
           through the retry and the host withholds `loading` while it shows, so this card's
           loader-before-error order is unchanged and still pinned. */
        <div className="mt-2">
          <FetchErrorBanner
            state={errorState}
            title="We couldn't load your upcoming events"
            reportContext="Upcoming events card (home page)"
          />
        </div>
      ) : (
        <>
          {/* Plan 88.6.1-62 (88.6.1-70 contract C6): mounted in this arm on every render, above
              the content, so its region is on the page before any failure (C8 b). Not mounted
              without an owner state — the notice requires one. */}
          {errorState ? (
            <RefreshFailedNotice
              state={errorState}
              retained={retained}
              focusTarget={upcomingHeadingRef}
              className="mt-2"
            />
          ) : null}
          {upcomingEvents.length === 0 ? (
            /* 88-33 Task 7 step 3 (M4 rider, UAT row 433's copy gap): the body NAMES the
               7-day window — the card silently filters to it, and the walk's "no upcoming
               events even though they created one for next week" misread came straight from
               the undisclosed window. Heading stays warm; copy recorded in the SUMMARY for
               §6.2.1 ratification at phase close.
               Plan 88.6.1-62 (r2 #230): wrapped so the retained empty answer is marked busy in place
               too; the wrapper adds no spacing. */
            <div aria-busy={busy || undefined}>
              <EmptyState
                icon="CalendarDays"
                heading="Nothing on the calendar"
                body="Nothing scheduled in the next 7 days — plan a game night and it'll show up here."
                action={action ?? undefined}
              />
            </div>
          ) : (
            <div className="mt-2" aria-busy={busy || undefined}>
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
                    {/* DECISION Phase 88.6-28 (R2 / UI-SPEC §4.3): every span in this row STAYS at
                        Label 14 (`text-sm`), chosen OVER promoting `{gameName}` to Body 16 under
                        §4.3's "the ONE primary string per row or card" clause.

                        ON THE MERITS a row title at 16 over its metadata at 14 is the hierarchy §4.3
                        is written to produce — that reading of the clause is real and is why this is
                        recorded rather than silently skipped. THE RECORD AND THE GEOMETRY BOTH GO THE
                        OTHER WAY here, and for a CONSEQUENCE reason rather than a bookkeeping one:
                        this is not a title line over a metadata line, it is ONE inline run —
                        `{gameName} · {dateTime} · {groupName}` plus the Guest pill — inside a single
                        wrapping `<button>`. Promoting one span in that run sets a 16px word beside
                        14px words on the SAME baseline at 375px, which is a visible delta with no row
                        in UI-SPEC §1.2's closed sanctioned-delta list (V-4's authority is "the R2
                        sweep, §4.3", and §4.3's own tie-break is "primary content, not a caption" —
                        a content-vs-caption distinction, not an instruction to split an inline run).
                        Every span here is §4.3's metadata/timestamp case.

                        So: no size change in this row, and the file's rung roster entry names only
                        the heading. Promoting the game name is a look decision and wants a V-row. */}
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
                      /* DECISION Phase 88.6-28 (D-01, UI-SPEC §4.2 "12px is the floor", V-7): the
                         Guest pill folds UP `text-[10px]` -> `text-xs` (12). An arbitrary value is
                         off the closed rung set by definition, and 10px is under the app's floor.
                         Badge labels are an enumerated Caption role, so 12 is this pill's rung and
                         it goes no further up.

                         V-7 REFLOW: D-01's screenshot gate is scoped to the DENSE GRIDS — the month
                         tile and the week strip, both fixed-height boxes. This pill is not one: it
                         is an `inline-flex` with `px-1.5 py-0.5` inside a wrapping `<button>` row
                         that has no height constraint (`min-h-11 md:min-h-0` is a FLOOR), so the
                         +2px grows the pill and, at worst, wraps it to the row's next line the way
                         a long game name already can. No fixed box is crossed. */
                      <span
                        className="inline-flex items-center px-1.5 py-0.5 ml-2 text-xs uppercase tracking-wide rounded-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50"
                        title="You joined this event as a guest (not a group member)"
                      >
                        Guest
                      </span>
                    )}
                  </button>
                );
              })}

              {/* DECISION Phase 88.6.1-62 (Req 5): ONE toggle with `aria-expanded` OVER two swapped
                  buttons — swapping unmounts the pressed button and drops focus to the top of the
                  document; one node at one position keeps it. Its two labels are the existing strings
                  (D-31). The card is md and up only (`hidden md:flex`, UserHomePage.js), so the phone
                  44px floor is not measured on it. Changing this is a decision, not a cleanup. */}
              {upcomingEvents.length > 3 && (
                <button
                  type="button"
                  aria-expanded={expanded}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((open) => !open);
                  }}
                  className="text-sm text-content-link cursor-pointer mt-1 ml-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {expanded ? 'Show less' : `+ ${overflowCount} more`}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
