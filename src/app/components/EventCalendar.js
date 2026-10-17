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
import { FetchErrorBanner, RefreshFailedNotice, RetainedContentFocusGuard, useRetainedContent } from '../../components/ui/FetchErrorBanner';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '../../lib/logger';

/* DECISION Phase 88.6.1-73 (headingRef) [orchestrator request 2026-10-05, for plan 88.6.1-71]:
   CHOSEN — a NAMED optional object-ref prop, `headingRef` (`React.RefObject<HTMLElement | null>`),
   attached to the calendar's title heading in EVERY branch that renders one (the identity-failure
   card, the first-load failure card and the calendar itself, in self-fetch AND external-events
   mode; the loading card renders no heading, so there it is null). React 18 gives a function
   component no `ref` prop (`package.json`, react ^18.2.0), hence a named prop. The calendar's own
   RF1 notice, banner and focus guard use the same resolved ref (`calendarHeadingRef`), so a host
   and the calendar agree on one element. Its consumers: plan 88.6.1-71's group-page events
   banner, notice and focus guard.
   REJECTED — (a) wrapping the component in `React.forwardRef`: a component-level `ref`
   conventionally means the root element, not the heading, so a host would be misled; (b) the host
   finding the heading by its text in the DOM (breaks when `title` changes, and the heading is
   absent in the loading branch with nothing to say so); (c) a callback ref (the consumers are
   `focusTarget` props, which take object refs). Changing this is a decision, not a cleanup. */
export default function EventCalendar({
  refreshKey = 0,
  events: externalEvents = null,   // If provided, use these instead of fetching
  variant = 'full',                // 'full' (user home) or 'compact' (group home)
  onEmptyDayClick = null,          // Callback: (dateString) => void -- for click-to-create
  onEventClick: externalOnEventClick = null, // Override default event click navigation
  title = 'Game Sessions Calendar', // Configurable header title
  showListView = true,             // Whether to show list view toggle
  scope = 'home',                  // CAL-03: persistence scope key (e.g. 'home', 'group:<id>')
  // An optional object ref the calendar attaches to its title heading in every branch that renders
  // one, so a host can pass it as a `focusTarget` (marker above).
  headingRef = null,
}) {
  // Called unconditionally (rules of hooks); the host's ref wins when one is passed.
  const ownHeadingRef = useRef(null);
  const calendarHeadingRef = headingRef ?? ownHeadingRef;
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
     re-runs the fetch effect instead of duplicating the fetch body.

     AMENDED Phase 88.6.1-73 (AC-29 / RF1): `retry` still bumps the key rather than duplicating
     the fetch body; since 2026-10-05 the promise it returns is answered by the run that bump
     starts (88.6.1-70 contract C4), because the RF1 notice reads that outcome — and while a run
     is already in flight it does not bump; that run answers it. */
  // The stamped failure record `{ key, caught }` (Phase 88.6.1-73): `key` is the account (the
  // selfUuid) it was read for, `caught` the error itself. The field is `caught`, not `error`, so
  // this local record is never read as an API envelope's `.error` (errorEnvelopeReads.test.ts).
  const [fetchError, setFetchError] = useState(null);
  // C3 (Phase 88.6.1-73): the selfUuid of the last SUCCESSFUL load, set only by an uncancelled
  // success, never in a catch or a finally.
  const [loadedFor, setLoadedFor] = useState(null);
  const [fetchRetryKey, setFetchRetryKey] = useState(0);
  const fetchRetryRef = useRef(null);
  fetchRetryRef.current = () => setFetchRetryKey((k) => k + 1);
  // C4 (Phase 88.6.1-73): the unanswered `retryFetch` callers, answered by a fetch-effect run, and
  // the marker of the run that is in flight (a value unique to that run, or null).
  const retryWaitersRef = useRef([]);
  const fetchInFlightRef = useRef(null);
  /* DECISION Phase 88.6.1-73 (C4) [88.6.1-70 contract C4; review #81 / #152]: CHOSEN — the key
     bump stays, and the run it starts answers the call with its outcome (`{ isError }`, or
     `undefined` for a run that starts no fetch); while a run is already in flight a call JOINS it
     instead (no bump), so a tab return during a pending fetch never cancels it. Under C2 the error
     now stays set through a run, so the hook's tab-return re-attempt stays armed while a request
     is out (`useFetchErrorState.ts`, anchor `if (!showError) return;`); before this plan the
     start-of-run clear disarmed it as a side effect. ResponseDashboard's in-flight short-circuit
     (anchor `This is what makes that multiplier BOUNDED`) is the house shape for exactly this.
     A cancelled run hands its unanswered callers to its successor (the effect's cleanup). The
     in-flight marker only decides whether this bumps; it cancels nothing, so the effect-scoped
     flag of `DECISION Phase 88.6-27 (R2 #45/#122)` stays the file's ONE staleness shape.
     REJECTED — (a) resolving at once (plan 70's C4: the notice would re-speak the failure while
     the request is still out); (b) calling `fetchEvents` straight from here (it would need a
     second cancellation shape beside the effect-scoped flag, which the 88.6-27 marker forbids by
     name); (c) converting the fetch to a TanStack query (C4 for free, but a rewrite of the effect,
     its guard and its adapter for one contract item); (d) bumping on every call (each tab return
     would throw away the pending answer and issue another read). Changing this is a decision, not
     a cleanup. */
  const retryFetch = useCallback(
    () =>
      new Promise((resolve) => {
        retryWaitersRef.current.push(resolve);
        if (fetchInFlightRef.current === null) fetchRetryRef.current?.();
      }),
    []
  );
  // C2 / C3 (Phase 88.6.1-73): only a record stamped with the CURRENT account reaches the hook, so
  // an account change never shows the previous account's failure, not even for one commit.
  const currentFetchError =
    fetchError && fetchError.key === selfUuid ? fetchError.caught : null;
  const fetchErrorState = useFetchErrorState({
    isError: Boolean(currentFetchError),
    error: currentFetchError,
    refetch: retryFetch,
  });
  // 88.6.1-70 contract C10: `retained` comes from plan 70's one hook, at the top level before any
  // early return. `hasData` is C3's has-loaded flag for THIS account in self-fetch mode, never an
  // event count (a calendar that loaded EMPTY is retained content, owner ruling Y). No code list.
  const retained = useRetainedContent(externalEvents === null && Boolean(selfUuid) && loadedFor === selfUuid, fetchErrorState);
  /* DECISION Phase 88.6.1-73 (C12, focus when content leaves) [88.6.1-70 contract C12 (a), C8 (f)]:
     CHOSEN — plan 70's one shared guard, ONE instance rendered as the card's next sibling (the
     second child of a top-level fragment) in every return below, so React keeps it across the
     switch from the calendar to the not-retained card and sees `retained` go from true to false.
     AFTER the card, because the target MOVES: a withdrawal removes the header row's heading and
     mounts the not-retained card's heading, which carries the same `calendarHeadingRef`; React
     18.2 runs the guard's `componentDidUpdate` and attaches refs in ONE depth-first layout pass, a
     subtree before its next sibling (`react-dom.development.js`, anchors
     `function commitLayoutEffects_begin(` and `commitAttachRef(finishedWork);`), so a guard after
     the card reads the new heading. It takes the notice's own `focusTarget`. External-events mode:
     `retained` is always false there, so the guard never acts (the group page's own guard, plan
     88.6.1-71, covers its events).
     REJECTED — (a) the guard in the calendar return only: it unmounts with the calendar and never
     sees the flip; (b) the guard BEFORE the card: it reads a null ref and lands on the page's top
     heading; (c) focus code of this file's own (D-04). Changing this is a decision, not a
     cleanup. */
  const retainedGuard = <RetainedContentFocusGuard retained={retained} focusTarget={calendarHeadingRef} />;
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
     `NextGameNightCard.tsx:231/236/241/249` — an effect-scoped `let cancelled`, invalidated
     in the effect's cleanup and checked before every post-await write. `AbortController` is
     REJECTED for this class BY NAME in that same record; do not re-open it.

     FOUR POINTS, named so nobody invents a second shape: the flag is INVALIDATED in this
     effect's cleanup (which, until this plan, this effect did not have at all — it returned
     nothing), and CHECKED before each of the three post-await writes inside `fetchEvents`. */
  /* DECISION Phase 88.6.1-11 (MEDLOW-8) [Req 11]: when the parent supplies events, the run that
     starts no fetch RELEASES `loading` itself (the `else if` arm below). Without it, a self-fetch
     cancelled by a dependency change AFTER the parent switched to supplying events left
     "Loading calendar..." up forever: the cancelled run's `finally` skips the release, and its
     successor starts no fetch.
     REJECTED, each kept here so it is not re-proposed as a tidy-up:
     (a) releasing whenever no fetch fires: in self-fetch mode with identity still pending that
         paints an empty grid before the fetch can run (the pending pin in
         `EventCalendar.identity.test.tsx` guards it);
     (b) adding `externalEvents` to the deps: a parent array's identity would re-fire the effect
         on every parent render, and a switch with no dependency change already settles (the
         in-flight fetch is not cancelled, so its `finally` releases `loading`);
     (c) an accept-forever record: the 88.6 round-1 review chose this hardening as "cheaper than
         an accept record that a future consumer could silently invalidate".
     REACHABILITY: unreachable with today's two mounts (`userHome/UserHomePage.js:538` passes no
     `events`; `groupHomePage/page.js:1233` passes a `useState([])` array from its first render).
     It is a decision, not a cleanup. */
  useEffect(() => {
    // Mount-fire gate: only fetch once the caller's own UUID resolves. selfUuid
    // is in the dep array (async-resolution rule) so the fetch fires once
    // identity resolves, not only at initial mount.
    let cancelled = false;
    // C4 (marker at `retryFetch`): this run takes the retry callers waiting when it starts, and
    // answers them, plus any call that joined it while it was out, when it settles uncancelled.
    const taken = retryWaitersRef.current;
    retryWaitersRef.current = [];
    let answered = false;
    const run = {};
    const fetching = externalEvents === null && Boolean(selfUuid);
    if (fetching) {
      fetchInFlightRef.current = run;
      fetchEvents(() => cancelled).then((outcome) => {
        if (cancelled) return;
        // One synchronous step: clear this run's own marker, then answer everyone it owes.
        if (fetchInFlightRef.current === run) fetchInFlightRef.current = null;
        answered = true;
        const joiners = retryWaitersRef.current;
        retryWaitersRef.current = [];
        [...taken, ...joiners].forEach((resolve) => resolve(outcome));
      });
    } else if (externalEvents !== null) {
      // MEDLOW-8 (marker above): the parent owns the events; nothing here will release loading.
      setLoading(false);
    }
    if (!fetching) {
      // C4: a run that starts no fetch answers its callers with `undefined` (no outcome).
      answered = true;
      taken.forEach((resolve) => resolve(undefined));
    }
    return () => {
      cancelled = true;
      // C4: a cancelled run frees the in-flight marker (its own only) and hands the callers it
      // has not answered to its successor; joiners are still in the ref for it too.
      if (fetchInFlightRef.current === run) fetchInFlightRef.current = null;
      if (!answered) retryWaitersRef.current.push(...taken);
    };
    /* Refetch when refreshKey, identity or the retry key changes.

       AMENDED Phase 88.6.1-11 (W022): the CHOICE below stands; its stated CAUSE was wrong and is
       replaced here. `user?.sub` RATHER THAN `user` — [Rule 1 fix, plan 88.6-27 task 3]. The
       retired sentence claimed the SDK hook hands back a new object on each render. It does not:
       `@auth0/nextjs-auth0` 3.8.0 memoises the value its hook returns
       (`node_modules/@auth0/nextjs-auth0/dist/client/use-user.js:109`, a `useMemo` over user,
       error, isLoading and checkSession; `user` itself is provider state at `:90`), so a bare
       `user` dependency does NOT re-fire per render in production. The refetch loop plan 88.6-27
       saw (a surface oscillating between "Loading calendar..." and the error banner once the
       §6.2 fix gave the failure a visible branch) came from `EventCalendar.identity.test.tsx`'s
       inline `useUser` mock, which built a new object on every call; that mock now returns one
       hoisted object.
       THE SIBLINGS ARE CORRECT: 13 effects in 10 files key on a bare `user` (census re-run
       2026-10-15): `app/page.js` (1), `app/invite/accept/page.js` (1),
       `app/invite/group/[token]/page.js` (1), `app/invite/game/[token]/page.js` (1),
       `app/components/grouplist.js` (1), `app/groupPlanning/page.js` (2),
       `app/components/FriendInvitePanel.js` (1), `app/friends/page.js` (1),
       `app/userProfile/page.js` (3), `app/restore/group/[token]/page.tsx` (1). Do NOT "fix" them
       to the sub on this premise; the premise was false.
       This one keeps `user?.sub` to converge with `UserHomePage.js`'s upcoming-events effect,
       whose deps are `[user?.sub, refreshKey, selfUuid, upcomingRetryKey]`
       (`userHome/UserHomePage.js:142`). Switching this dependency to the object is
       behaviour-neutral in production but diverges from that sibling; changing it is a decision,
       not a cleanup. */
  }, [user?.sub, refreshKey, selfUuid, fetchRetryKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // CAL-03/CAL-07: persist viewMode + currentDate whenever either changes.
  // Save fires after user interactions (toggle list, navigate month) so
  // subsequent reloads / modal cycles restore the same view. The 1-hour
  // TTL on month restoration is enforced inside loadCalendarPrefs.
  useEffect(() => {
    saveCalendarPrefs(scope, { viewMode, currentDate });
  }, [scope, viewMode, currentDate]);

  // C4 (Phase 88.6.1-73): resolves `{ isError: false }` / `{ isError: true }` for a run that was not
  // cancelled, and `undefined` when cancelled or with no selfUuid; it never rejects.
  const fetchEvents = async (isCancelled = () => false) => {
    if (!selfUuid) return undefined;
    // The account this run reads for (the stamped record's key, and C3's loadedFor).
    const key = selfUuid;
    try {
      // C2 (88.6.1-70 contract): no start-of-run error clear; only this run's success clears it.
      setLoading(true);
      const data = await eventsAPI.getUserEvents(selfUuid, { includeRsvpSummary: true });
      if (isCancelled()) return undefined;
      setInternalEvents(data || []);
      setLoadedFor(key);
      setFetchError(null);
      return { isError: false };
    } catch (error) {
      /* AC-2, at the level the owner amended it to on 2026-09-13: `logger.info`, REPLACING the
         raw `console.error` rather than sitting beside it. STATE THE COST: `logger.info` is
         `Sentry.addBreadcrumb` (`logger.ts:52-53`), so this failure reaches Sentry only attached
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
      if (isCancelled()) return undefined;
      /* §6.2: the error branch is now DISTINGUISHABLE from a genuinely empty calendar. The list
         is still cleared — a stale list beside an error banner is its own lie — but `fetchError`
         is what the render reads FIRST, so "we could not load this" is no longer rendered as
         "you have nothing scheduled".
         AMENDED Phase 88.6.1-73 (AC-29 / RF1, owner ruling 2026-10-05): the list is no longer
         cleared (88.6.1-70 contract C1). What replaced it: a failed refresh keeps the list, and
         the RF1 notice says the refresh failed and that the earlier calendar is showing. Why the
         old worry no longer applies: the lie this note feared was a list beside a banner claiming
         the calendar could not load; the notice names the list as earlier content, so nothing on
         screen contradicts anything. A failed first load for this account still shows the full
         banner. The record stores the error object itself (`caught`), so a 401 / 403 keeps its
         code (C10), stamped with the account it was read for. */
      setFetchError({
        key,
        caught: error instanceof Error ? error : new Error('The calendar request did not complete.'),
      });
      return { isError: true };
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
  //
  // DECISION Phase 88.6.1-11 (AC-29) [Req 9]: the branch now ALSO requires an UNRESOLVED identity
  // (`!selfUuid`), so the code matches the purpose stated above: the TERMINAL failure. The
  // identity hook's error flag is true even when TanStack KEPT the cached self row after a failed
  // background refetch (`useFetchErrorState.ts:269` reads only `isError`; the one invalidation
  // caller is `EmailAddressSection.tsx:973` through `selfIdentityCache.ts:50`). That row is this
  // user's own, because the query key is per account (`useSelfIdentity.ts:86`), and with it the
  // fetch effect runs. Hiding the calendar then told someone it could not load when it could,
  // and did. REJECTED: (a) gating on the error flag alone (that lie); (b) a compact identity
  // notice beside the calendar (a visible addition, and identity is not the calendar's data).
  // It is a decision, not a cleanup.
  if (externalEvents === null && selfIdentityErrorState.showError && !selfUuid) {
    return (
      <>
        <div className="card p-3 md:p-6">
          <Heading ref={calendarHeadingRef} level={2} size="heading" className="text-content-primary mb-6">{title}</Heading>
          <FetchErrorBanner
            state={selfIdentityErrorState}
            title="Couldn't load your calendar"
            reportContext="event calendar — self-identity resolution"
          />
        </div>
        {retainedGuard}
      </>
    );
  }

  // The loading card, one element for its two returns below (no heading renders in it).
  const loadingCard = (
    <div className="card p-3 md:p-6">
      <p className="text-content-secondary">Loading calendar...</p>
    </div>
  );

  /* §6.2 — THE ERROR BRANCH IS CHECKED BEFORE THE EMPTY ONE, and the ORDER here is the whole
     fix. It sits after the identity branch above (a failure that means the fetch never fired)
     and before `loading` and the grid below (which, with `internalEvents` cleared, would paint
     an empty calendar). Same card frame, same banner component, same ratified copy source as
     its sibling — the only thing that is new is that a failed fetch now has somewhere to go.
     Only in SELF-FETCH mode: when `externalEvents` is supplied the parent owns the fetch and
     this state can never be set.
     AMENDED Phase 88.6.1-73 (AC-29 / RF1): this is now the NOT-YET-LOADED branch — error before
     loading before the calendar still holds here; once events have loaded for this account a
     failure renders the RF1 notice in the calendar branch instead. */
  /* DECISION Phase 88.6.1-73 (AC-29 / RF1, owner ruling 2026-10-05) [D-47, D-51, Req 9]:
     CHOSEN — a failed refresh keeps the calendar and plan 88.6.1-70's `RefreshFailedNotice`
     qualifies it (88.6.1-70 contract C1-C10); the full banner and 'Loading calendar...' are
     FIRST-LOAD-ONLY, keyed on `loadedFor` for the current account; the notice sits between the
     header row and the view, mounted in self-fetch mode only. `retained` comes from plan 70's
     `useRetainedContent` (C10), so a 401 / 403 / 404 / 410 refresh shows the full banner in the
     calendar's place and a later 500 cannot bring the withdrawn events back. The not-retained
     banner takes `focusTarget={calendarHeadingRef}` (review #82): on a successful Try again its
     heading detaches and the header row's heading attaches the same ref in the same commit, so
     focus lands on the calendar's heading as the notice's Retry does, not on the page's top one.
     REJECTED — (a) clearing the list and showing the full banner (the pre-ruling record, amended
     in the catch); (b) the full banner above the retained calendar (two shapes for one
     situation); (c) 'Loading calendar...' on a refresh of loaded events (it would unmount the
     notice and its focused Retry at every press; D-09a / D-37); (d) an RF1 notice for an identity
     refetch failure (nothing on screen is earlier content — identity is not the calendar's data,
     and with a kept identity row the calendar shows FRESH events); (e) a local list of access
     codes or the bare predicate formula without the hook (C10). Changing any of these is a
     decision, not a cleanup. */
  if (externalEvents === null && !retained) {
    if (fetchErrorState.showError) {
      return (
        <>
          <div className="card p-3 md:p-6">
            <Heading ref={calendarHeadingRef} level={2} size="heading" className="text-content-primary mb-6">{title}</Heading>
            <FetchErrorBanner
              state={fetchErrorState}
              title="Couldn't load your calendar"
              reportContext="event calendar — events fetch"
              focusTarget={calendarHeadingRef}
            />
          </div>
          {retainedGuard}
        </>
      );
    }
    return (
      <>
        {loadingCard}
        {retainedGuard}
      </>
    );
  }

  // External-events mode only now (MEDLOW-8's path): self-fetch never reaches here unretained.
  if (loading && !retained) {
    return (
      <>
        {loadingCard}
        {retainedGuard}
      </>
    );
  }

  return (
    <>
    <div className="card p-3 md:p-6">
      <div className="flex justify-between items-center mb-6">
        <Heading ref={calendarHeadingRef} level={2} size="heading" className="text-content-primary">{title}</Heading>
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
                `font-size` unlayered (`globals.css:2297`) — and the per-site focus-ring string
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

      {/* RF1 (88.6.1-70 contract C6): mounted unconditionally in the branch that renders the
          retained calendar, above the view. The mode gate is not a `showError` gate: the mode
          is fixed per mount, and an external-events calendar never fetches. */}
      {externalEvents === null && <RefreshFailedNotice state={fetchErrorState} retained={retained} focusTarget={calendarHeadingRef} className="mb-4" />}

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
          loading={loading && !retained}
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
    {retainedGuard}
    </>
  );
}
