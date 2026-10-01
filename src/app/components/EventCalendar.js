'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { eventsAPI } from '../../lib/api';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { getDaysInMonth } from '../../lib/calendarUtils';
import { loadCalendarPrefs, saveCalendarPrefs } from '../../lib/calendarViewPrefs';
import CalendarMonthView from './CalendarMonthView';
import CalendarListView from './CalendarListView';
import EventDayModal from './EventDayModal';
import { useTimezone } from './TimezoneProvider';
import { formatWithTzAbbr } from '../../lib/datetime';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '../../lib/logger';

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
  // Resolve the caller's own Users.id UUID; getUserEvents sends it instead of
  // the Auth0 sub. It resolves ASYNC after mount, so the fetch effect keys on it.
  const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
  const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
  const [internalEvents, setInternalEvents] = useState([]);
  const [loading, setLoading] = useState(externalEvents === null);
  /* DECISION Phase 88.6-27 (UI-SPEC §6.2, the error-branch-before-empty-branch rule): the
     calendar fetch's failure is TRACKED, chosen OVER the shipped `setInternalEvents([])`-and-
     move-on.

     THE DEFECT THIS CLOSES, in the user's words rather than the code's: a failed fetch rendered
     an EMPTY CALENDAR. The app told someone there was nothing on their calendar when the truth
     was that it could not find out. That is the same class as the `DECISION Phase 88-18` bug on
     the upcoming-events card and the WR-03 stuck spinner one state over — and this very plan
     enforces §6.2 on this component's OWN hosts, so leaving it standing inside the file would
     have been the rule applied everywhere except where it was inconvenient.

     RESOLVED HERE (arm a) rather than routed, because this file ALREADY HAS the failure idiom:
     it imports `useFetchErrorState` and `FetchErrorBanner` and already renders that exact
     banner, in this exact card frame, for the identity branch below. No new copy is authored —
     `useFetchErrorState` supplies the ratified message from the caught `ApiError`.

     The adapter shape (`isError`/`error`/`refetch` onto the hook) is the shipped 88-14 friends
     pattern, copied from `UserHomePage.js`'s upcoming-events adapter rather than invented.
     `retry` must be STABLE — the hook holds it in an effect dep — so it bumps a key that
     re-runs the fetch effect instead of duplicating the fetch body. */
  const [fetchError, setFetchError] = useState(null);
  const [fetchRetryKey, setFetchRetryKey] = useState(0);
  const fetchRetryRef = useRef(null);
  fetchRetryRef.current = () => setFetchRetryKey((k) => k + 1);
  const retryFetch = useCallback(() => {
    fetchRetryRef.current?.();
    return Promise.resolve();
  }, []);
  const fetchErrorState = useFetchErrorState({
    isError: Boolean(fetchError),
    error: fetchError,
    refetch: retryFetch,
  });
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

  /* DECISION Phase 88.6-27 (R2 #45/#122): the phase's ONE cancelled-generation staleness guard,
     applied here — this file was the FOURTH unguarded post-await state write in the phase, and
     the phase claims in four separate plan files that the idiom is "defined once and completely".
     A site left unguarded in a file this same plan is already editing would make that claim
     false.

     THE SHAPE IS CITED, NOT RE-DERIVED: the shipped source plan 29 names is
     `NextGameNightCard.tsx:197/204-205/209-211` — an effect-scoped `let cancelled`, invalidated
     in the effect's cleanup and checked before every post-await write. `AbortController` is
     REJECTED for this class BY NAME in that same record; do not re-open it.

     FOUR POINTS, named so nobody invents a second shape: the flag is INVALIDATED in this
     effect's cleanup (which, until this plan, this effect did not have at all — it returned
     nothing), and CHECKED before each of the three post-await writes inside `fetchEvents`. */
  useEffect(() => {
    // Mount-fire gate: only fetch once the caller's own UUID resolves. selfUuid
    // is in the dep array (async-resolution rule) so the fetch fires once
    // identity resolves, not only at initial mount.
    let cancelled = false;
    if (externalEvents === null && selfUuid) {
      fetchEvents(() => cancelled);
    }
    return () => {
      cancelled = true;
    };
    /* Refetch when refreshKey, identity or the retry key changes.

       `user?.sub` RATHER THAN `user` — [Rule 1 fix, plan 88.6-27 task 3]. `useUser()` returns a
       fresh object on every render, so a bare `user` dep re-fired this effect on EVERY render.
       Until this plan that loop was invisible: the catch's `setInternalEvents([])` allocated a
       new array, which re-rendered, which re-fired the effect, which refetched — a silent
       refetch storm on any failing calendar, with nothing rendering differently to show it. The
       moment the failure got a VISIBLE branch (the §6.2 fix above) the loop surfaced as a
       surface oscillating between "Loading calendar..." and the error banner, which is how it
       was caught. The sibling that already does this correctly is `UserHomePage.js`'s
       upcoming-events effect, whose deps are `[user?.sub, refreshKey, selfUuid,
       upcomingRetryKey]`; this converges on it rather than inventing a third shape. Widening
       this back to the object is a decision, not a cleanup. */
  }, [user?.sub, refreshKey, selfUuid, fetchRetryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // CAL-03/CAL-07: persist viewMode + currentDate whenever either changes.
  // Save fires after user interactions (toggle list, navigate month) so
  // subsequent reloads / modal cycles restore the same view. The 1-hour
  // TTL on month restoration is enforced inside loadCalendarPrefs.
  useEffect(() => {
    saveCalendarPrefs(scope, { viewMode, currentDate });
  }, [scope, viewMode, currentDate]);

  const fetchEvents = async (isCancelled = () => false) => {
    if (!selfUuid) return;
    try {
      setLoading(true);
      setFetchError(null);
      const data = await eventsAPI.getUserEvents(selfUuid, { includeRsvpSummary: true });
      if (isCancelled()) return;
      setInternalEvents(data || []);
    } catch (error) {
      /* AC-2, at the level the owner amended it to on 2026-09-13: `logger.info`, REPLACING the
         raw `console.error` rather than sitting beside it. STATE THE COST: `logger.info` is
         `Sentry.addBreadcrumb` (`logger.ts:34-36`), so this failure reaches Sentry only attached
         to a later event in the same session — it does not file an issue of its own. Lint does
         NOT govern this choice: this file is on `.eslintrc.json`'s `no-console: off` allowlist,
         so a raw call would have passed; UI-SPEC §6.4 and `logger.ts`'s own module contract are
         what decide it, and this plan states ONE direction for all three of its console sites.
         `errCtx(error)` and never the raw `Error`: the second parameter is a plain object, and
         `checkJs: false` hides that mistake in a `.js` file. NOTE the egress widening, recorded
         rather than discovered later: the shipped call passed a bare STRING
         (`error.message || 'Unknown error'`); `errCtx` adds the error's NAME. Nothing else —
         no response body, no event or group title, no attendee name or email (T-84-01).
         Reported REGARDLESS of cancellation: a developer log is not user-facing context, and a
         failure that happened still happened. */
      logger.info('Error fetching events', errCtx(error));
      if (isCancelled()) return;
      /* §6.2: the error branch is now DISTINGUISHABLE from a genuinely empty calendar. The list
         is still cleared — a stale list beside an error banner is its own lie — but `fetchError`
         is what the render reads FIRST, so "we could not load this" is no longer rendered as
         "you have nothing scheduled". */
      setFetchError(
        error instanceof Error ? error : new Error('The calendar request did not complete.')
      );
      setInternalEvents([]);
    } finally {
      if (!isCancelled()) setLoading(false);
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

  // CAL-06 (revised): if the surface has list view disabled, force month view
  // even if persisted state says 'list'. Defensive guard — if a parent passes
  // showListView={false}, persisted 'list' choice would otherwise strand users
  // without a toggle. Group + home both pass true today; this is belt-and-
  // suspenders for any future surface that might disable list view.
  const effectiveViewMode = !showListView && viewMode === 'list' ? 'month' : viewMode;

  // CAL-06 (post-pivot): list view shows past + future events with same styling,
  // anchored at the next upcoming event. We pass the FULL chronologically-sorted
  // events array — the list view component handles past-event windowing
  // internally (initial 30 past + all future, expand on scroll). Past events are
  // no longer dropped at this layer.
  const chronologicalEvents = [...activeEvents]
    .filter(event => !!event?.start_date)
    .sort((a, b) => new Date(a.start_date) - new Date(b.start_date));

  // WR-03: in self-fetch mode (externalEvents === null) the calendar gates its
  // fetch on selfUuid; fetchEvents early-returns on `!selfUuid` before its
  // try/finally, so a TERMINAL identity failure leaves `loading` stuck true and
  // the "Loading calendar..." spinner below hangs forever with no affordance.
  // Surface the calendar's error banner where the calendar would be (mirrors the
  // friends-page identity gate). Only applies in self-fetch mode — when
  // externalEvents is supplied the parent owns loading and never gates on selfUuid.
  if (externalEvents === null && selfIdentityErrorState.showError) {
    return (
      <div className="card p-3 md:p-6">
        <Heading level={2} size="heading" className="text-content-primary mb-6">{title}</Heading>
        <FetchErrorBanner
          state={selfIdentityErrorState}
          title="Couldn't load your calendar"
          reportContext="event calendar — self-identity resolution"
        />
      </div>
    );
  }

  /* §6.2 — THE ERROR BRANCH IS CHECKED BEFORE THE EMPTY ONE, and the ORDER here is the whole
     fix. It sits after the identity branch above (a failure that means the fetch never fired)
     and before `loading` and the grid below (which, with `internalEvents` cleared, would paint
     an empty calendar). Same card frame, same banner component, same ratified copy source as
     its sibling — the only thing that is new is that a failed fetch now has somewhere to go.
     Only in SELF-FETCH mode: when `externalEvents` is supplied the parent owns the fetch and
     this state can never be set. */
  if (externalEvents === null && fetchErrorState.showError) {
    return (
      <div className="card p-3 md:p-6">
        <Heading level={2} size="heading" className="text-content-primary mb-6">{title}</Heading>
        <FetchErrorBanner
          state={fetchErrorState}
          title="Couldn't load your calendar"
          reportContext="event calendar — events fetch"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="card p-3 md:p-6">
        <p className="text-content-secondary">Loading calendar...</p>
      </div>
    );
  }

  return (
    <div className="card p-3 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <Heading level={2} size="heading" className="text-content-primary">{title}</Heading>
        {showListView && (
          <div className="flex gap-2">
            {/* DECISION Phase 88.3-17 (DEF-88.3-13-04, owner ruling A, 2026-08-27):
                the List/Month toggle gains the project focus ring. This is the
                control the owner named twice in the phone UAT — test 4 ("List view
                on the calendar doesn't read as a button to me") and test 8c(i) —
                and plan 88.3-16 Task 1(C) measured its RESTING treatment
                verify-only (it inherits `.btn-secondary`'s plan-14 fill + border:
                warm-200 fill 1.31:1 on the white card, warm-300 edge 1.22:1 on the
                fill), leaving its FOCUS state the one half nothing had touched.
                `.btn` defines no `focus-visible` style and there is no global one,
                so until now this painted the browser default. `ring-*` compiles to
                `box-shadow` and therefore survives the unlayered
                `.btn { border: none }`; a `focus-visible:border-*` would not.
                Pinned by the five-file scan in `groupColourRendering.test.ts`. */}
            {/* Phase 88.6-27: `btn btn-secondary` -> the primitive's secondary variant. TWO
                classes go and neither is a loss. `text-sm` was DEAD — `.btn` declares
                `font-size` unlayered (`globals.css:2201`) — and the per-site focus-ring string
                is retired because the ring now lives ONCE in the primitive's cva base
                (`Button.tsx:113`, A-2 ARM A, owner ruling 2026-09-15). The 88.3-17 marker above
                is byte-unchanged and still true: this control has a project focus ring, it just
                no longer states it itself. `cascadeOrder.test.ts` asserts exactly one of the two
                mechanisms exists, so keeping both would red. */}
            <Button
              variant="secondary"
              onClick={() => setViewMode(viewMode === 'month' ? 'list' : 'month')}
            >
              {viewMode === 'month' ? 'List View' : 'Month View'}
            </Button>
          </div>
        )}
      </div>

      {effectiveViewMode === 'month' ? (
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
          events={chronologicalEvents}
          onEventClick={handleEventClick}
          timezone={timezone}
          loading={loading}
          variant={variant}
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
