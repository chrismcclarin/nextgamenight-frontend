'use client';
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { Icon } from '../../components/ui/Icon';
import {
  getSubtitleStyle,
  getTextStyle,
  groupInkVars,
  isDarkBackground,
  resolveGroupGround,
  storedGroupColour,
  themedTextStyleVars,
  SUBTEXT_MUTED_ON_LIGHT,
  SUBTEXT_ON_LIGHT,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { formatTime, formatWithTzAbbr } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';
// SPEC Req 2 (88.5-08): the TWIN of the Calendar button's count pill. Same component,
// so the per-theme fill fork it owns cannot drift between the two instances. It renders
// the number this file is HANDED; nothing here counts anything.
import UpcomingCountPill from './UpcomingCountPill';

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
 * Phone sheet arm (Phase 88.1 plan 10, SPEC Req 11b): `variant="sheet"` adds a
 * THIRD arm for the phone bottom-sheet host. See the DECISION marker on the
 * variant list below — it is additive on purpose; the desktop arms above are
 * bit-for-bit unchanged.
 *
 * The sheet arm's ORDER is NOT the chronological feed described above (Phase
 * 88.1 plan 17, SPEC Req 12). It renders, top to bottom:
 *       1. "Upcoming events" section — today + future groups, soonest first
 *          (or a section-scoped "No upcoming events" line)
 *       2. a collapsed "Past events (N)" disclosure; expanding it reveals the
 *          past groups MOST-RECENT-FIRST, with the lazy-load sentinel at the
 *          BOTTOM of that panel
 *     No Today delineator, and no mount-time centre-scroll. See the Req 12
 *     DECISION marker at the section fork in the render body.
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

/* DECISION Phase 88.1 (plan 10, SPEC Req 11b / UI-SPEC S4): the phone bottom-sheet rendering
   is an ADDITIVE `variant` arm ('sheet'), chosen OVER editing the two height constants above
   or deleting the `sm:` gate on the game name.

   WHY THE EDIT-IN-PLACE VERSION LOSES: this is a live DESKTOP surface and 88.1's acceptance
   includes ">=768px pixel-unchanged". The two constants exist to match CalendarMonthView's
   natural rendered height for the same variant (see the comment above them), so the OUTER card
   heights agree when the user toggles month/list — changing either one reflows the desktop card.
   Likewise the game name's `hidden sm:block` gate is the DESKTOP responsive-stripping ladder
   documented in the header block; lifting it globally would put the name back at 375px on every
   other host of this component too.

   So: 'sheet' adds height + game-name behaviour ON TOP, and every value the desktop arms read is
   untouched. Collapsing the arm back into the base rendering is a decision that re-opens the
   pixel-unchanged acceptance, not a simplification.

   WHAT THE ARM DELIBERATELY DOES *NOT* CHANGE, so a future reader does not read these as gaps:
   - the md-gated RSVP row stays gated. Un-hiding it at phone width renders EMPTY counts, because
     the phone host (`UserHomePage.js`) fetches without `includeRsvpSummary`. That is a recorded
     latent gap (88.1 D-06), not a bug to fix from this side.
   - the today divider is re-hosted UNRESTYLED — see its own marker below; colouring it re-opens
     a decision taken in Phase 88-27.
     AMENDED BY 88.1-17 (SPEC Req 12, owner walkthrough 2026-08-24): the sheet arm now renders NO
     today divider at all. The two-section split ("Upcoming events" / "Past events (N)") does the
     delineator's job explicitly, and a divider between them would be a second, weaker answer to
     the same question. The bullet's ORIGINAL constraint still binds everything it was written
     about: the divider is still un-restyled and is still rendered on both desktop arms, so
     Phase 88-27's colour decision is untouched.
   - the empty-state line is carried verbatim; its durable follow-up entry is owned by Phase 88.6.
     AMENDED BY 88.1-17 (SPEC Req 12): the sheet arm additionally carries a SECTION-SCOPED
     "No upcoming events" line, because with the past collapsed below it the shared "No events"
     line would be false — there can be plenty of events, all of them past. The shared line is
     still carried verbatim on both desktop arms. Phase 88.6's `EmptyState` conversion therefore
     has TWO strings and THREE hosts to cover; `.planning/deferred/phase-88.6.md` says so.
   - the game IMAGE stays `sm:`-gated (i.e. hidden at 375px). At phone width the row's text column
     is ~300px; a 48px thumbnail plus the group avatar and gaps would take a third of it, and the
     NAME is what Req 11b's "readable game text" acceptance is about. If it is ever un-hidden it
     MUST stay on `SafeImage` (untrusted remote URL, T-88.1-25) — never a bare <img>. */
/* A shared, frozen empty set for the two id-set props below: a stable identity so callers
   that do not pass the props (both desktop arms) get the same default object every render.
   (The partition below is a plain compute, not a memo — ML8 — so this is about not
   allocating a throwaway Set per render, not about dependency checks.) */
const EMPTY_ID_SET = new Set();

export default function CalendarListView({
  events,
  onEventClick,
  timezone: timezoneProp,
  loading = false,
  variant = 'full',
  /* SPEC Req 2 / OWNER RULING 2a (88.5-08), sheet arm only. These are the ONLY inputs to the
     three-way split below, and they are computed ONCE in `UserHomePage` against ONE shared
     `now` clock (see its `DECISION Phase 88.5 (OWNER RULING 2a)` marker). This file performs
     NO date or status comparison of its own to decide membership — a second derivation here
     is precisely the disagreement threat T-88.5-25 names.

     EXTENDED Phase 88.6-27 (W58 + W59 / D47, owner ruling 2026-09-09 option a) — the sentences
     above stand and now cover a THIRD set. `happeningNowIds` is additionally bounded by the
     event's run window (`duration_minutes` else the ruled 8h default), and `startedNotLiveIds`
     names rows that have started and are NOT running. Together they correct the ONE boundary
     this sheet had wrong in two directions at once: its Past/Upcoming split is a DATE-KEY split
     (`k >= todayKey` below) while these sets are TIME-based, so a live game that started before
     local midnight used to land in the collapsed Past disclosure (W59) and a dead game that
     started earlier today used to sit under "Later" (W58). The boundary is still decided
     entirely in `upcomingEvents.ts` and still travels here as membership only — there is no new
     time or status comparison in this file. SHEET ARM ONLY: the desktop arms pass none of these
     props (`EventCalendar.js:233-239`) and are pixel-unchanged. */
  happeningNowIds = EMPTY_ID_SET,
  startedNotLiveIds = EMPTY_ID_SET,
  thisWeekIds = EMPTY_ID_SET,
  /* The number the Calendar button already shows, handed down so the twin pill is the SAME
     value rather than a second count. `null` means "no claim is being made" (pending/error);
     `UpcomingCountPill` owns that rule. */
  upcomingCount = null,
}) {
  // The phone bottom-sheet arm. Derived once here so the height and the row's
  // game-name treatment can never disagree about which surface they are on.
  const isSheet = variant === 'sheet';

  // Req 12 (sheet arm only): ids for the upcoming section's heading and for the
  // past disclosure's controlled region. `useId` so two mounted list views can
  // never collide on the same `aria-controls` target.
  const uid = useId();
  const upcomingHeadingId = `${uid}-upcoming`;
  const pastPanelId = `${uid}-past`;
  // 88.5-08 (D-04): the two sub-section headings, derived from the SAME `useId` value for
  // the same collision reason. The happening-now group needs no id — it has no heading.
  const thisWeekId = `${uid}-this-week`;
  const laterId = `${uid}-later`;
  // COLLAPSED by default — see the Req 12 DECISION marker at the section fork.
  const [pastExpanded, setPastExpanded] = useState(false);

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

  /* SPEC Req 2 / D-04 / OWNER RULING 2a, sheet arm only — the three-way partition of the
     upcoming section.

     SPLIT BY EVENT, NOT BY GROUP, and that is the load-bearing choice: a single calendar day
     can hold a game that already started AND one that has not, so assigning the whole date
     group to one bucket wholesale would put an uncounted row inside the counted section (or
     vice versa) and make the pill's number disagree with the rows underneath it — the exact
     defect the single-selector constraint exists to prevent. A day that straddles a boundary
     therefore renders its date header in BOTH sub-sections, each carrying only its own rows.

     Membership is pure SET LOOKUP against the two props. `futureGroups` is untouched — still
     the existing `k >= todayKey` date-key split — and Later needs no test of its own: it is
     everything left over by elimination, which is why a cancelled or completed future event
     lands there without this file ever reading `.status`.

     EXTENDED Phase 88.6-27 (W58): still pure set lookup, still no `.status` read here, and
     `futureGroups` is still the untouched date-key split. One row type LEAVES Later: a
     cancelled or completed event that has already STARTED (necessarily today, since it is in
     `futureGroups`) is now routed to the sheet's Past list instead. A FUTURE-DATED cancelled or
     completed event is unaffected and still lands in Later by elimination — the two are
     separated by the shared `hasStarted` predicate, never by anything in this file.

     PLAIN COMPUTE, deliberately NOT a useMemo: the only caller that passes the id-set props
     (`UserHomePage`) builds them as fresh `new Set(...)` identities on every render — its own
     documented "NOT MEMOIZED" stance — so a memo keyed on them could never hit and only
     obscured the cost (adversarial review 2026-09-01, ML8). Two passes over a handful of
     rows per render is the same cost profile UserHomePage already accepts on its side.

     ═══ AMENDED Phase 88.6-27 (W58 + W59 / D47) ═══ Every sentence above stands and the
     PLAIN-COMPUTE decision is unchanged — `UserHomePage` still hands down fresh Set identities
     every render, so a memo still could not hit. Two things are added and one cost sentence is
     corrected.

     ADDED (1): `sheetPastGroups` MOVED IN HERE from its own `useMemo`. It had to move, and
     BOTH ways of leaving it a memo were silent. Adding the Set props to its dep array can never
     hit (fresh identities every render, by `UserHomePage.js`'s documented design), so it would
     recompute every render and buy nothing. OMITTING them computes ONCE for the session,
     because `todayKey` is keyed on `[timezone]`, `pastEvents` on `[events, todayKey, timezone]`
     and `visiblePast` on `[pastEvents, pastVisibleCount]` — all stable absent a refetch — so the
     sheet's Past list would freeze at the first clock it ever saw. The memo's dependency lint
     was DISABLED on its own line, which is what made both mistakes invisible. Computing it in
     this block is consistent with the ML8 rationale above and is honest about the cost.

     ADDED (2): the buckets are now sourced differently, and this is the W58/W59 fix.
     "Happening now" draws from `pastEvents` UNION `todayAndFutureEvents` in ONE ascending pass,
     because a LIVE row that started before local midnight sits on YESTERDAY's date key and is
     therefore in `pastEvents`, not in `futureGroups` — that row is W59. And the sheet's past
     list additionally receives the `futureGroups` rows in `startedNotLiveIds` — a dead game that
     started earlier today — which is W58. The removal half is not optional: a happening-now row
     is REMOVED from the past source, or the midnight-crossing row renders TWICE.

     CORRECTED: "two passes over a handful of rows" no longer describes what this block does.
     The happening-now source is `pastEvents` ∪ `todayAndFutureEvents` and the past COUNT is a
     full-history pass, and `pastEvents` derives from the RAW, unfiltered `getUserEvents` payload
     (`UserHomePage.js:88`/`:91`) — the user's whole history, with no backend date filter. The
     decision stands; the premise behind it is restated here rather than left pointing at a cost
     profile this block no longer has. */
  const {
    happeningNowGroups,
    thisWeekGroups,
    laterGroups,
    sheetPastGroups,
    sheetPastTotal,
  } = (() => {
    if (!isSheet) {
      return {
        happeningNowGroups: [],
        thisWeekGroups: [],
        laterGroups: [],
        sheetPastGroups: [],
        sheetPastTotal: 0,
      };
    }

    /* 1. HAPPENING NOW — one ASCENDING pass over both buckets. `pastEvents` and
       `todayAndFutureEvents` are each ascending and the first is entirely before the second by
       date key, so the concatenation is ascending and date order is preserved. NOT
       live-first-then-the-rest: these rows keep their place in the day. */
    const happeningRows = [];
    for (const ev of pastEvents) if (happeningNowIds.has(ev.id)) happeningRows.push(ev);
    for (const ev of todayAndFutureEvents) if (happeningNowIds.has(ev.id)) happeningRows.push(ev);
    const happening = groupByDate(happeningRows);

    /* 2/3. THIS WEEK and LATER, over `futureGroups` as before. Two exclusions are new: a
       happening-now row has already been taken above, and a started-not-live row is routed to
       the past list below. Later remains everything left over BY ELIMINATION. */
    const week = [];
    const later = [];
    const startedNotLiveFromFuture = [];
    for (const group of futureGroups) {
      const weekItems = [];
      const laterItems = [];
      for (const ev of group.items) {
        if (happeningNowIds.has(ev.id)) continue;
        if (startedNotLiveIds.has(ev.id)) {
          startedNotLiveFromFuture.push(ev);
          continue;
        }
        if (thisWeekIds.has(ev.id)) weekItems.push(ev);
        else laterItems.push(ev);
      }
      // Each bucket keeps the group's own key/sample, so `formatDayHeader`, ordering and
      // timezone handling are byte-identical to the undivided render.
      if (weekItems.length > 0) week.push({ ...group, items: weekItems });
      if (laterItems.length > 0) later.push({ ...group, items: laterItems });
    }

    /* 4. THE SHEET'S PAST LIST. Source = the rendered window `visiblePast`, minus every
       happening-now member, plus the `futureGroups` rows in `startedNotLiveIds`, de-duplicated
       by id.

       THE APPENDED ROWS COME FROM `futureGroups`, NEVER FROM THE RAW SET. `startedNotLiveIds`
       is built in `UserHomePage` off the whole event list; unioning it with `visiblePast`
       directly would duplicate past rows. (It is bounded at the producer too — see its marker
       there — so this is the second of two guards on that one mistake, which is the correct
       number for it.)

       ORDER IS EXPLICIT, not implied by the arithmetic: the source is built ASCENDING (window
       first, then today's started-not-live rows, which are the most recent), and the existing
       `[...].reverse()` turns that into most-recent-first — so the started-today rows head the
       panel. A reversed concat here would ship silently green without a pin, and there is one. */
    const keptWindow = visiblePast.filter((ev) => !happeningNowIds.has(ev.id));
    const seen = new Set(keptWindow.map((ev) => ev.id));
    const appended = [];
    for (const ev of startedNotLiveFromFuture) {
      if (seen.has(ev.id)) continue;
      seen.add(ev.id);
      appended.push(ev);
    }
    const pastSource = [...keptWindow, ...appended];

    /* THE COUNT IS A SEPARATE NUMBER AND STAYS ALL-HISTORY — see the amended comment on the
       disclosure below. `pastEvents` (all history) minus its happening-now members, plus the
       `futureGroups` started-not-live rows. Never the rendered window. */
    const pastTotal =
      pastEvents.reduce((n, ev) => (happeningNowIds.has(ev.id) ? n : n + 1), 0) +
      startedNotLiveFromFuture.length;

    return {
      happeningNowGroups: happening,
      thisWeekGroups: week,
      laterGroups: later,
      sheetPastGroups: groupByDate([...pastSource].reverse()),
      sheetPastTotal: pastTotal,
    };
  })();

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
    // Req 12: the sheet arm renders no divider, so it MUST open at the top of the
    // upcoming list. This early return is explicit rather than incidental — the
    // effect would already no-op on a null ref, but stating it here stops a future
    // reader from restoring mount-time anchoring by re-adding a divider.
    if (isSheet) return;
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
  }, [pastGroups, futureGroups, isSheet]);

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
        //
        // Req 12 forks the MARGIN because it forks the sentinel's POSITION. On the
        // desktop arms history runs upward and the sentinel sits above the past
        // groups, so the pre-load margin is on the TOP edge. On the sheet arm the
        // expanded past panel runs newest-to-oldest DOWNWARD and the sentinel sits
        // after the last group, so the margin has to be on the BOTTOM edge — the
        // desktop value would pre-load nothing there. Root, threshold, page size and
        // the `allMorePastLoaded` guard stay shared.
        rootMargin: isSheet ? '0px 0px 200px 0px' : '200px 0px 0px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
    // `pastExpanded` is load-bearing on the sheet arm: the sentinel node does not
    // exist until the panel expands, so without it the observer would be set up
    // against a null ref once and never re-attach. Constant on the desktop arms.
  }, [allMorePastLoaded, pastEvents.length, isSheet, pastExpanded]);

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

  /* Phone-sheet height (see the variant DECISION at the top of this file). The mechanism is
     FLEX FILL, not a number: the shell becomes a full-height flex column and the scroll region
     takes `flex-1 min-h-0`, so the list fills whatever the host sheet gives it. `max-h-[85dvh]`
     is the belt-and-braces cap for a host that does not constrain height, and matches the sheet
     primitive's own `full` preset (`BottomSheet.tsx` HEIGHT_CLASS).

     `dvh` over `vh` is deliberate and is the primitive's own recorded choice: a bottom-anchored
     surface sits exactly where iOS Safari's dynamic toolbar lives, and `vh` resolves against the
     LARGEST viewport, so the bottom rows would sit under the toolbar. The resulting divergence
     from `Modal.tsx`'s `max-h-[90vh]` is recorded by plan 88.1-04 and routed to Phase 88.6 by
     plan 88.1-06 — "simplifying" this to `vh` for consistency re-opens D-06.

     `min-h-0` is load-bearing: without it a flex child refuses to shrink below its content and
     the list overflows the sheet instead of scrolling inside it. */
  const shellClassName = isSheet
    ? 'space-y-4 flex h-full min-h-0 flex-col'
    : 'space-y-4';
  const scrollRegionClassName = isSheet
    ? 'relative overflow-y-auto pr-1 min-h-0 flex-1 max-h-[85dvh]'
    : 'relative overflow-y-auto pr-1';
  // Inline height only on the desktop arms — the sheet arm is sized by flex.
  const scrollRegionStyle = isSheet ? undefined : { height: containerHeight };

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
      <div className={shellClassName}>
        <div className="flex items-baseline justify-between">
          <Heading level={3} size="heading" className="text-content-primary">Upcoming events</Heading>
        </div>
        <div
          className={scrollRegionClassName}
          style={scrollRegionStyle}
        >
          <div className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border border-line rounded-lg p-4 animate-pulse">
                <div className="h-4 w-1/3 bg-surface-elevated rounded-sm mb-2" />
                <div className="h-3 w-1/4 bg-surface-elevated rounded-sm" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        {/* Req 12: on the sheet arm this heading IS the upcoming section's heading — it is
            referenced by `aria-labelledby` rather than duplicated inside the section, because
            a second "Upcoming events" heading inside the Calendar dialog is exactly the
            strict-mode collision the 11a sheet already has to disambiguate. `undefined` on the
            desktop arms emits no attribute, so their DOM is unchanged. */}
        <Heading
          level={3}
          size="heading"
          id={isSheet ? upcomingHeadingId : undefined}
          className="text-content-primary"
        >
          Upcoming events
        </Heading>
        {tzAbbr && (
          <span className="text-xs text-content-muted">
            Times shown in {tzAbbr}
          </span>
        )}
      </div>

      <div
        ref={containerRef}
        className={scrollRegionClassName}
        style={scrollRegionStyle}
      >
        <div className="space-y-6">
          {/* DECISION Phase 88.1-17 (SPEC Req 12, owner ruling 2026-08-24): the sheet arm renders
              TWO ORDERED SECTIONS — upcoming first, past COLLAPSED BY DEFAULT behind a
              "Past events (N)" disclosure — chosen OVER (i) expanding the past section by default
              and OVER (ii) dropping past events from the phone sheet entirely.

              (i) loses on the real data shape: a weekly group accumulates ~50 past rows against
              1-2 upcoming ones, and the backend applies NO date filter to this fetch
              (`routes/events.js` `Event.findAll` over the or-clauses), so the whole history
              arrives. Expanded-by-default is a milder version of the defect the owner reported —
              he opened this sheet to see "when is the next one" and got history first.

              (ii) loses because past rows are a LIVE destination, not dead weight: the host's tap
              handler (`UserHomePage.js` `handleCalendarSheetEventClick`) routes a past event that
              has a game to `?game_id=`, which is how you get back to a game you played.

              The TodayDivider is deliberately ABSENT here and deliberately RETAINED on both
              desktop arms — the section headers state the same boundary explicitly, and the
              divider's own Phase 88-27 colour decision stays untouched by not touching it.

              Collapsing these two sections back into one chronological feed re-opens the owner's
              walkthrough finding. It is a decision, not a cleanup.

              AMENDED Phase 88.6-27 (W58 + W59, owner ruling 2026-09-09 D47 option a) —
              everything above is unchanged: two sections, past collapsed by default, no
              TodayDivider here, desktop arms untouched. What this adds is that the LINE between
              the two sections is no longer purely the `k >= todayKey` date key. A LIVE game that
              started before local midnight moves UP out of the collapsed Past disclosure into
              Happening now (W59 — a game night in progress, buried, at this app's stated primary
              moment), and a game that started earlier today and is no longer running moves DOWN
              out of the upcoming section into the Past disclosure (W58). The bound is the run
              window: the event's `duration_minutes` when it carries one, else the ruled default
              of EIGHT HOURS. It is decided ONCE in `upcomingEvents.ts` and arrives here as set
              membership — this file still performs no time comparison of its own. SHEET ARM
              ONLY: the desktop arms pass no id sets (`EventCalendar.js:233-239`) and are
              pixel-unchanged.

              AMENDED Phase 88.5 (D-04, OWNER RULING 2a) — section 1 now SUBDIVIDES; everything
              above is unchanged. The two-section upcoming-versus-past structure, the collapsed
              past disclosure, the absent TodayDivider and the untouched desktop arms all stand
              exactly as recorded. What changed is INSIDE section 1, which now reads, in order:

                1. HAPPENING NOW — events in `futureGroups` that have a live status and whose
                   start is at or before the shared `now`. Rendered FIRST, with NO header of any
                   kind, and NOT counted by the pill. Ruling: an event that has already started
                   is not "upcoming", so it must not inflate a badge that promises "this week";
                   but at game night it is the single most relevant row in the sheet, so it must
                   not be buried either. First, unlabelled, uncounted.
                2. THIS WEEK — exactly `selectUpcomingWithin7Days`, carrying the twin count pill.
                3. LATER — everything else in the future range by elimination, date-ordered.
                   This includes CANCELLED and COMPLETED future events, which render with today's
                   ordinary row treatment because no per-status row styling exists in this file.
                   That is no worse than shipped (they had no treatment under the single header
                   either); building one is out of scope here and is registered against Phase 88.6
                   in `.planning/deferred/phase-88.6.md`.

                   AMENDED Phase 88.6-27 (W58, owner ruling 2026-09-09 D47 option a): the bullet
                   above stands for FUTURE-DATED cancelled and completed rows, which still land
                   here. What changed is the row that has ALREADY STARTED: a cancelled or
                   completed game that began earlier today leaves Later for the Past disclosure
                   below, because "Later" promising a game that is already over is the defect
                   W58 names. The boundary is the run window — the event's `duration_minutes`
                   when it has one, else the ruled default of EIGHT HOURS — decided once in
                   `upcomingEvents.ts` and delivered here as set membership. SHEET ARM ONLY: the
                   desktop arms pass no id sets and are pixel-unchanged. The VISUAL half of W58
                   (what a cancelled or completed row LOOKS like) is still unbuilt and is still
                   Phase 88.9's.

              REJECTED, each a real defect avoided:
                (a) WORDING-ONLY SCOPING of the single existing section — retitle it and leave one
                    list. The count and the list then still disagree about which events the number
                    counts, which is the whole complaint.
                (b) HOISTING THE WHOLE REMAINDER above This week, cancelled events included. That
                    gives a cancelled game top billing over the games still actually happening.
                (c) HIDING non-live events from the sheet entirely. An information regression —
                    the member who cancelled still needs to see that it is off.

              HEADING OUTLINE (DR2-7b): the two new `<h4>` sub-section headings sit between the
              outer `<h3>` and `DateGroup`'s own day header, which ships as an `<h4>`. Left alone
              that would flatten the outline, so `DateGroup` and `EventRow` take a `headingLevel`
              prop DEFAULTING to today's level — the desktop arms and the happening-now group pass
              nothing and are unchanged — and the This-week/Later groups demote to `h5`/`h6`.
              Neither `<h4>` may be named after the outer heading: a second heading with that
              string inside the Calendar dialog is the strict-mode collision the `aria-labelledby`
              construction above the scroll region exists to avoid. */}
          {isSheet ? (
            <>
              {/* Section 1 — upcoming, now subdivided (see the AMENDED paragraph above). Labelled
                  by the `<h3>` above rather than by a heading of its own; `futureGroups` is
                  already soonest-first and includes TODAY's events (the split is
                  `k >= todayKey`). */}
              <section aria-labelledby={upcomingHeadingId} className="space-y-6">
                {/* 1. HAPPENING NOW — deliberately NO subheader, not even plain text. These rows
                    sit directly under the outer `<h3>`, which is their only heading, so their
                    `DateGroup` keeps the DEFAULT heading levels (h4 day header, h5 row title):
                    there is no intervening sub-section heading to demote beneath. */}
                {happeningNowGroups.map((group) => (
                  <DateGroup
                    key={group.key}
                    group={group}
                    formatDayHeader={formatDayHeader}
                    timezone={timezone}
                    onEventClick={onEventClick}
                    isSheet={isSheet}
                  />
                ))}

                {/* 2. THIS WEEK — the only sub-section that carries the pill. */}
                {thisWeekGroups.length > 0 && (
                  <div className="space-y-3">
                    <Heading
                      level={4}
                      size="label"
                      id={thisWeekId}
                      className="flex items-center gap-2 uppercase tracking-[0.08em] text-content-secondary"
                    >
                      This week
                      <UpcomingCountPill count={upcomingCount} />
                      {/* The pill is aria-hidden BY CONTRACT — its host announces the
                          number (UpcomingCountPill.tsx doc). The Calendar button honours
                          that; this heading is the other host and must too, or the count
                          is sighted-only here (adversarial review 2026-09-01, ML15).
                          Same visibility condition as the pill: null = no claim, 0 = none. */}
                      {upcomingCount !== null && upcomingCount > 0 && (
                        <span className="sr-only">, {upcomingCount} upcoming this week</span>
                      )}
                    </Heading>
                    <section aria-labelledby={thisWeekId} className="space-y-6">
                      {thisWeekGroups.map((group) => (
                        <DateGroup
                          key={group.key}
                          group={group}
                          formatDayHeader={formatDayHeader}
                          timezone={timezone}
                          onEventClick={onEventClick}
                          isSheet={isSheet}
                          headingLevel="h5"
                          rowHeadingLevel="h6"
                        />
                      ))}
                    </section>
                  </div>
                )}

                {/* 3. LATER — never carries the pill. */}
                {laterGroups.length > 0 && (
                  <div className="space-y-3">
                    {/* Deliberately on ONE line: this plan's acceptance gate greps for the
                        literal `>Later<`, and a heading split across lines to satisfy a
                        formatter reads as absent to it. Single-text-child JSX on one line is
                        the shipped idiom in this file anyway. */}
                    <Heading level={4} size="label" id={laterId} className="uppercase tracking-[0.08em] text-content-secondary">Later</Heading>
                    <section aria-labelledby={laterId} className="space-y-6">
                      {laterGroups.map((group) => (
                        <DateGroup
                          key={group.key}
                          group={group}
                          formatDayHeader={formatDayHeader}
                          timezone={timezone}
                          onEventClick={onEventClick}
                          isSheet={isSheet}
                          headingLevel="h5"
                          rowHeadingLevel="h6"
                        />
                      ))}
                    </section>
                  </div>
                )}

                {/* Section-scoped, NOT the shared "No events" line: with past events collapsed
                    below, "No events" would be false whenever the group has history. Gated on
                    ALL THREE sub-sections being empty (D-04) — the three partition
                    `futureGroups` exhaustively, so an event anywhere in the future range keeps
                    this line off. */}
                {happeningNowGroups.length === 0 &&
                  thisWeekGroups.length === 0 &&
                  laterGroups.length === 0 && (
                    <div className="flex items-center justify-center pt-4">
                      {/* DECISION Phase 88.6-27 (W18 / D2): this SECTION-level empty takes D2's
                          recorded section MINI-FORMULA — one line of prose at
                          `text-content-muted text-sm` — and the string is byte-unchanged (P1).

                          REJECTED: `<EmptyState>`. Its own `DECISION Phase 88-18 (D2)` marker
                          (EmptyState.tsx:18-28, owner ruling 2026-08-15, `88-UAT.md:222-236`)
                          makes the full icon+heading+body formula PAGE-LEVEL ONLY and says in
                          terms not to upgrade section empties as a cleanup. It is also
                          unsatisfiable here: the component REQUIRES `icon`, `heading` and `body`
                          while this site is a single `<p>`, and it would introduce an `h3` that
                          this file's `EXPECTED_LEVELS` entry does not carry.

                          GROUND: the sheet is `bg-surface-card` (`BottomSheet.tsx:213`), and
                          `tokenContrast.test.ts` pins `--color-text-muted` on `--color-bg-card`
                          at >= 4.5 in BOTH themes. Upgrading this to the full formula is a
                          decision, not a cleanup. */}
                      <p className="text-content-muted text-sm">No upcoming events</p>
                    </div>
                  )}
              </section>

              {/* Section 2 — the past disclosure. Renders only when there IS history.
                  Phase 88.6-27: gated on `sheetPastTotal`, the sheet's own all-history total,
                  not on `pastEvents.length` — a row that is happening NOW has left this bucket
                  and a row that started earlier today has joined it. */}
              {sheetPastTotal > 0 && (
                <div className="space-y-4">
                  {/* A real <button> via the shipped Button primitive, carrying the
                      aria-expanded / aria-controls pair (the idiom at `gameDetail/page.js`'s
                      description toggle). The role-button DIV next door in
                      `PromptScheduleSection.js` is NOT the pattern to copy: its own marker says
                      it exists because its label is a <p>, and `<button><p>` breaks hydration.
                      This label is phrasing content, so the real button is available.

                      LAYOUT LIVES ON THE INNER SPAN, deliberately: `.btn` is UNLAYERED
                      (`globals.css:1040-1052`) and sets `justify-content: center`, so a
                      `justify-between` utility on the button itself would be dead on arrival —
                      the failure mode the Button primitive's own marker records eight times over.

                      `min-h-11` is the 44px floor stated at the CALL SITE. `.btn`'s own floor is
                      phone-only and unlayered; pinning it here makes the e2e measurement a
                      property of this control rather than of a global rule.

                      The count is `pastEvents.length` (ALL history), not the rendered window —
                      it is telling the user how much there is, not how much is mounted.

                      AMENDED Phase 88.6-27 (W58 + W59): the ALL-HISTORY stance above is
                      PRESERVED exactly; only the BUCKET MEMBERSHIP changed. The number is now
                      `sheetPastTotal` — all of `pastEvents` minus its happening-now members,
                      plus the `futureGroups` rows that started today and are no longer running
                      — which is still every past row that exists, not the rendered window. Two
                      consequences, both reasons NOT to "simplify" this onto the window list:
                      a window-derived count would read "Past events (30)" on any group with
                      more than `PAST_PAGE_SIZE` past rows, and gating the disclosure on a
                      FILTERED window would unmount the rolling sentinel and its observer
                      whenever every windowed row happened to be filtered out, making further
                      paging impossible. */}
                  <Button
                    variant="ghost"
                    onClick={() => setPastExpanded((v) => !v)}
                    aria-expanded={pastExpanded}
                    aria-controls={pastPanelId}
                    className="w-full min-h-11"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span>Past events ({sheetPastTotal})</span>
                      <Icon
                        name="ChevronDown"
                        size={18}
                        className={`transition-transform ${pastExpanded ? 'rotate-180' : ''}`}
                      />
                    </span>
                  </Button>

                  {/* The region is ALWAYS rendered so `aria-controls` always resolves to a real
                      element; only its CHILDREN are conditional, so a collapsed panel mounts no
                      rows. */}
                  <div id={pastPanelId} hidden={!pastExpanded} className="space-y-6">
                    {pastExpanded && (
                      <>
                        {sheetPastGroups.map((group) => (
                          <DateGroup
                            key={group.key}
                            group={group}
                            formatDayHeader={formatDayHeader}
                            timezone={timezone}
                            onEventClick={onEventClick}
                            isSheet={isSheet}
                          />
                        ))}

                        {/* Same rolling loader, at the BOTTOM: history runs downward here.
                            See the forked `rootMargin` in the observer effect above. */}
                        {!allMorePastLoaded && (
                          <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                        )}
                      </>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
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
                  isSheet={isSheet}
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
                  isSheet={isSheet}
                />
              ))}

              {/* Empty-state hint: only when there are NO events at all. The
                  divider still renders above; this just labels the empty card. */}
              {!hasAnyEvents && (
                <div className="flex items-center justify-center pt-4">
                  {/* DECISION Phase 88.6-27 (W18 / D2): the desktop twin of the sheet's
                      section empty above, on the same recorded MINI-FORMULA
                      (`text-content-muted text-sm`), string byte-unchanged (P1).

                      REJECTED: `<EmptyState>` — same reasoning as the sheet site; see the
                      marker there rather than a second copy of it here.

                      GROUND, VERIFIED rather than assumed: both desktop hosts wrap this
                      component in `.card` (`EventCalendar.js:190`), whose `@utility card` rule
                      is `background-color: var(--color-bg-card)` — the same ground
                      `bg-surface-card` paints. `tokenContrast.test.ts` pins
                      `--color-text-muted` on `--color-bg-card` at >= 4.5 in BOTH themes, so the
                      muted rung is safe here too. It is NOT on a hover or sunken ground; if a
                      future host changes that, this site goes back to
                      `text-content-secondary`. */}
                  <p className="text-content-muted text-sm">No events</p>
                </div>
              )}
            </>
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
      {/* DECISION Phase 88-27 (D-32 bucket B): the rule takes the NEUTRAL, chosen OVER
          `border-content-link` at full strength (which is what 87.7 stripped from here, at 40%).
          It is `aria-hidden` decoration and the pill beside it is already `bg-content-link` at
          full strength — a 2px link-coloured line across the whole viewport would compete with the
          thing it exists to frame. This is D-32's own "or `border-line` where the tint was purely
          decorative" exception. It also closes a shim dependency 88-26's census could not see:
          its lexer fires on a BARE border token, so `border-t-2` with no colour was invisible to
          it, and 88-31 deletes that shim. Removing the colour re-opens both. */}
      <div className="absolute inset-x-0 top-1/2 border-t-2 border-line" aria-hidden="true" />
      {/* UI-SPEC §4.5, the ratified EYEBROW role (Caption 12 / 700 / uppercase / tracking):
          `text-xs` STAYS — 12px is this role's rung, not a miss — and only the WEIGHT moves,
          600 -> 700. It remains a `<span>`: an eyebrow is not a heading, and making it one
          would put a level into an outline that deliberately has none here. */}
      <span className="relative z-10 inline-flex items-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-content-link text-white shadow-theme-sm">
        {label}
      </span>
    </div>
  );
});

/**
 * One date-group section (date header + its event rows). Extracted so the
 * past and future renders share identical chrome.
 *
 * DECISION Phase 88.5 (DR2-7b): `headingLevel` (this group's day header) and
 * `rowHeadingLevel` (its rows' titles) are props that DEFAULT to the levels this
 * component has always rendered — `h4` and `h5`. That default is the whole point and is
 * not a formality: both desktop arms and the sheet's happening-now group pass nothing, so
 * their rendered DOM is byte-identical to before the sheet gained sub-sections. Only the
 * sheet's This-week/Later groups, which now nest one level below an `<h4>` sub-section
 * heading, demote to `h5`/`h6` so no two structurally-nested headings share a level.
 * Hard-coding either level back is a decision, not a cleanup: it flattens the outline.
 *
 * Phase 88.6-27 (D-05) — a note, not an amendment: every sentence above stands and the four
 * `headingLevel="h5"` / `rowHeadingLevel="h6"` call sites are unchanged by this plan's sweep.
 * Recorded because the sweep could easily look as if it had merely SURVIVED this decision by
 * luck: the `Heading` primitive (`components/ui/Heading.tsx`) takes `level: 1..6` rather than
 * the 1-4 an obvious reading of the heading contract would give it, and it does so SPECIFICALLY
 * so this seam keeps working — its own `DECISION Phase 88.6-03 (D-05)` marker names this file
 * and these line seams as the reason, and says a 1-4 primitive would bulldoze them. The
 * decision was honoured deliberately.
 */
function DateGroup({
  group,
  formatDayHeader,
  timezone,
  onEventClick,
  isSheet = false,
  headingLevel = 'h4',
  rowHeadingLevel = 'h5',
}) {
  // Capitalised so JSX treats it as a component; the value is a lowercase intrinsic tag.
  const DayHeading = headingLevel;
  return (
    <section key={group.key} className="space-y-2">
      {/* UI-SPEC §4.5: HIERARCHY, so 600 -> 700. The 14px rung is unchanged — this is the
          Label rung and it is on the scale already. The element stays the `headingLevel` seam
          (see the DR2-7b marker above); only the weight utility moves. */}
      <DayHeading className="text-sm font-bold text-content-secondary uppercase tracking-wide pb-1 border-b border-line">
        {formatDayHeader(group.sample)}
      </DayHeading>
      <div className="space-y-2">
        {group.items.map((event) => (
          <EventRow
            key={event.id}
            event={event}
            timezone={timezone}
            isSheet={isSheet}
            headingLevel={rowHeadingLevel}
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
const EventRow = forwardRef(function EventRow(
  { event, timezone, onClick, isSheet = false, headingLevel = 'h5' },
  ref
) {
  // See the `headingLevel` DECISION on `DateGroup` above — the default IS the shipped
  // level, so every caller that passes nothing renders exactly what it rendered before.
  const TitleHeading = headingLevel;
  const groupBgImage = event.Group?.background_image_url;
  const groupProfilePic = event.Group?.profile_picture_url;

  const hasBgImage = !!groupBgImage;
  /*
   * DECISION Phase 88.3.1 (plan 08, AMENDMENT AC): a SECOND image flag, derived
   * from the VALIDATED `safeBgImageStyle` result, sits beside the raw
   * `hasBgImage` above — and only `groupInkVars` reads it.
   *
   * WHY TWO. `safeBgImageStyle` drops relative/invalid URLs (FSEC-03), so a
   * truthy-but-rejected URL paints NO image: that row is a plain coloured card
   * and must get its ink. Feeding `groupInkVars` the raw flag would withhold the
   * ink from exactly those rows and leave Req 8's defect standing on them.
   *
   * REJECTED: converging `hasBgImage` onto the validated style here, which is
   * the wave-12 owner ruling already applied at `grouplist.js`. It is the right
   * end state, but it CHANGES WHAT THOSE ROWS PAINT (white-on-image treatment ->
   * plain contrast maths) on a surface this plan was not scoped to re-look at,
   * and the same divergence exists at `CalendarMonthView.js` and
   * `groupHomePage/page.js`. Registered as one family in
   * `.planning/deferred/phase-88.6.md`; converge all four in one pass, with a
   * rendered check. Deleting either flag here is a decision, not a cleanup.
   */
  const bgImageStyle = safeBgImageStyle(groupBgImage);
  const hasValidBgImage = !!bgImageStyle;
  /*
   * DECISION Phase 88.3 (D-09, cascade fix): the row's ground is a MUTUALLY
   * EXCLUSIVE ternary gated on `tinted`, chosen OVER stacking the tint pair
   * beside the always-present `bg-surface-card`. Compile-verified on this
   * tree's tailwindcss@4.3.3: `.bg-[var(--group-ground-light)]` emits at line
   * 1426, `.bg-surface-card` at 1543, `.dark:bg-[var(--group-ground)]` at 2894
   * — same property, same specificity, source order wins, so a stacked
   * className paints the white card surface over the tint in light mode.
   * ALSO REJECTED: gating on `groupBgColor` alone — `ground` is gated on the
   * TINT succeeding so both custom properties turn on or off together
   * (T-88.3-43). This is a decision, not a cleanup.
   */
  /*
   * AMENDED Phase 88.3.1 (plan 08, AMENDMENT J) — the D-09 marker above is KEPT
   * VERBATIM and its Tailwind source-order reasoning is untouched. Two mechanical
   * facts under it changed: `groupBgColor` is gone (its "ALSO REJECTED: gating on
   * `groupBgColor` alone" now reads against `rowGroundPair`, unchanged in
   * substance), and the hand-written `tinted ? … : null` gate is gone because
   * T-88.3-43 became a property of the resolver's RETURN TYPE — `{dark, light, …}`
   * or `null`, never half a pair — instead of a gate six callers each rewrite.
   *
   * The ACCESSOR is `storedGroupColour(event.Group)`, never `background_color`:
   * plan 88.3.1-05 migrates coloured groups to `color_preset='<id>',
   * background_color=NULL`, so reading the legacy column alone renders every
   * migrated group uncoloured with a fully green suite. REJECTED: a per-site
   * `?? background_color` ternary — six copies of one rule. A decision, not a
   * cleanup.
   */
  const rowGroundPair = resolveGroupGround(storedGroupColour(event.Group));
  const ground = rowGroundPair?.dark ?? null;
  const tinted = rowGroundPair?.light ?? null;
  // No image and no group colour: the row sits on the app's themed surface, so
  // the SHARED fallback resolution owns it. This row's bespoke contrast maths
  // below is computed against a coloured ground and produces dark-on-dark here.
  // Keyed on `ground` (not the stored hex) and therefore declared AFTER it —
  // see the CR-02 marker below.
  const isThemed = !hasBgImage && !ground;

  /*
   * DECISION Phase 88.3 (R2-6): the title/subtitle treatment is computed TWICE
   * — once against the stored hex (what dark mode paints) and once against the
   * rendered tint (what light mode paints) — and handed to the cascade as
   * `--t-*` custom properties, chosen OVER the single `isDark` fork this
   * replaced.
   *
   * WHY. `isDarkBackground` was asked about the STORED hex, and every shipped
   * preset is dark, so the branch never flipped: once the ground renders as a
   * pale tint in light mode these rows painted near-white text with a black
   * shadow and stroke ON that tint. Passing the RENDERED ground fixes it, and
   * the ground is only known to CSS — hence the fork lives there.
   * REJECTED: a `useTheme` read, which the shipped DECISION at
   * EventScheduler.tsx rejected for exactly this problem (no hydration fork, no
   * theme-flash window). REJECTED: keeping the inline `color`/`textShadow`/
   * `WebkitTextStroke` keys and layering a `dark:` class over them — an inline
   * declaration beats any class, so the light arm would be inert (the plan-07
   * trap). Those keys are deleted, not overridden. A decision, not a cleanup.
   */
  const titleTreatment = (rowGround) => {
    if (isThemed) return getTextStyle(false, null);
    // `onDarkGround` already implies !hasBgImage, so the image case falls
    // through to the dark pole: the row washes the image white at 0.85 below.
    const onDarkGround = !hasBgImage && isDarkBackground(rowGround);
    return {
      color: onDarkGround ? TEXT_ON_DARK : TEXT_ON_LIGHT,
      textShadow: hasBgImage
        ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
        : onDarkGround
          ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
          : '1px 1px 2px rgba(255, 255, 255, 0.9)',
      WebkitTextStroke: onDarkGround ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
    };
  };
  const subtitleTreatment = (rowGround) => {
    if (isThemed) return getSubtitleStyle(false, null);
    const onDarkGround = !hasBgImage && isDarkBackground(rowGround);
    return {
      color: hasBgImage
        ? SUBTEXT_ON_LIGHT
        : onDarkGround
          ? 'rgba(255,255,255,0.9)'
          : SUBTEXT_MUTED_ON_LIGHT,
      textShadow: hasBgImage
        ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
        : onDarkGround
          ? '1px 1px 3px rgba(0, 0, 0, 0.8)'
          : '1px 1px 2px rgba(255, 255, 255, 0.9)',
      WebkitTextStroke: onDarkGround ? '0.3px rgba(0, 0, 0, 0.9)' : 'none',
    };
  };

  /*
   * DECISION Phase 88.3-cr (CR-02, code-adversarial-review
   * 2026-08-27): the DARK arm is computed on `ground`, not on the
   * stored hex, and the LIGHT arm on `tinted`, not on
   * `tinted || <stored hex>` — mirroring the shipped shape at
   * `groupHomePage/page.js`, which gates BOTH the ground and the
   * text style on the tint succeeding. Gating only the ground was
   * the exact asymmetry the T-88.3-43 marker above warns about:
   * a stored value that `resolveGroupBackgroundColor` passes
   * through but `lightTintGroupBackgroundColor` rejects (anything
   * not a 6-digit hex) would drop the card back to the themed
   * surface while the text treatment was still computed against
   * the malformed string — `getBrightness` returns 255 for it, so
   * the dark arm painted the light-ground pole on a DARK themed
   * card. Unreachable for new writes (the backend validator is
   * `^#[0-9A-Fa-f]{6}$`), which is why this is a consistency fix
   * rather than a bug fix — but "withhold both grounds together"
   * has to mean the text too, or the marker is only half true.
   * REJECTED: leaving the stored hex in and widening the tint
   * validator instead. A decision, not a cleanup.
   *
   * AMENDED Phase 88.3.1 (plan 08), everything above KEPT AS HISTORY: the two
   * function names this marker cites — `resolveGroupBackgroundColor` and the
   * tint — are no longer CALLED in this file; both moved inside the resolver.
   * The control is unchanged and is now structural, because `ground` and
   * `tinted` are destructured from one object and cannot drift apart. The
   * treatments below are deliberately still fed `ground` / `tinted`: they are
   * NOT dead code superseded by the card ink, they are the LEGACY and
   * BACKGROUND-IMAGE fallback the `--group-ink*` chain resolves to, and the live
   * path for every production group until BE PR-2's remap runs.
   */
  const titleVars = themedTextStyleVars(
    titleTreatment(ground),
    titleTreatment(tinted),
  );
  const subtitleVars = themedTextStyleVars(
    subtitleTreatment(ground),
    subtitleTreatment(tinted),
  );

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
      /* DECISION Phase 88.6-27 (D49-b, owner ruling 2026-09-09 option i): `hover:shadow-md` ->
         `hover:shadow-theme-md`. The alias spelling resolved to Tailwind v4's INLINED BLACK
         default rather than this app's warm theme tier (`DECISION Phase 87.7`,
         `globals.css:1141-1155`), so the hover hue changes visibly and deliberately.
         PLAIN `hover:`, NOT `enabled-hover:`: this is a card `div`, not a `.btn` — the
         enabled-hover variant exists to withhold the lift from a GATED CONTROL, and there is no
         control here to gate. REJECTED: leaving the alias in place for visual continuity.
         Re-spelling it back to `shadow-md` is a decision, not a cleanup. */
      className={`p-3 sm:p-4 border border-line rounded-lg transition-all hover:shadow-theme-md cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${tinted ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`}
      style={{
        ...(tinted && {
          '--group-ground': ground,
          '--group-ground-light': tinted,
        }),
        /*
         * DECISION Phase 88.3.1 (SPEC Req 4 / UI-SPEC 3.3): the CARD ink pair
         * rides in the SAME style object as the two grounds, chosen OVER emitting
         * it at whichever text element consumes it — ink and ground must turn on
         * and off together, and `groupColourRendering.test.ts` test 9 can only
         * assert that when both live in one expression.
         * `hasBackgroundImage` is passed EXPLICITLY: this is a `.js` file, so a
         * forgotten option degrades silently to `false`, which is the UNSAFE
         * direction (a preset's tinted ink over a user's photograph).
         * REJECTED: the raw `hasBgImage` — see the two-flag marker above.
         *
         * KNOWN RESIDUAL, recorded so it is not read as an oversight: this row's
         * title and subtitle still fork on `--t-color*` from
         * `themedTextStyleVars`, so nothing in THIS file consumes the ink yet.
         * UI-SPEC 3.3 lists these rows as a CARD surface, but UI-SPEC 3.5's Req 8
         * list does not include them, and re-inking a title nobody has complained
         * about is a visual change needing its own look at 375px. The channel is
         * wired here so that change is a className edit, not a re-plumb.
         */
        ...groupInkVars(rowGroundPair, {
          surface: 'card',
          hasBackgroundImage: hasValidBgImage,
        }),
        ...bgImageStyle,
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
          <div className="w-10 h-10 rounded-full bg-surface-card flex items-center justify-center text-xl shrink-0 overflow-hidden border-2 border-line shadow-theme-sm">
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
            {/* DECISION Phase 88.1 (plan 10, Req 11b): the sheet arm swaps the desktop
                `truncate` for `line-clamp-2`, chosen OVER leaving the row title alone.

                This looks like it belongs to the title, not to the game name — but it IS the
                game name in the common case. `eventTitle` falls back to `event.Game?.name`
                when an event has no explicit title (see its computation above), and
                `showGameName` is then false because the two would be identical, so the
                separate name line below never renders. Every event seeded by
                `scripts/seed-sample-data.js` is that shape. Gating only the line below would
                therefore leave the actual game text single-line-ellipsised at 375px for the
                majority of rows — passing the letter of "lift the sm: gate" while failing
                Req 11b's "readable game text" acceptance. Desktop keeps `truncate` so the
                fixed-height card cannot reflow. */}
            <TitleHeading
              className={`${
                isSheet
                  ? 'font-bold text-base min-w-0 line-clamp-2'
                  : 'font-bold text-base truncate'
              } [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]`}
              style={titleVars}
            >
              {eventTitle}
            </TitleHeading>
            <span className={`text-sm [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]`} style={subtitleVars}>
              {startTime}
            </span>
          </div>

          {/* sm: game name (drops below 640px) — EXCEPT on the phone sheet arm.

              DECISION Phase 88.1 (plan 10, Req 11b): the sheet arm renders the game name at
              every width and at `text-base` (16px), chosen OVER (a) leaving the `sm:` gate in
              place and (b) rendering it at the desktop `text-sm`.

              (a) loses because at 375px the gate means rows carry title + time only, and
              "readable game text" IS Req 11b's acceptance criterion — the requirement exists
              precisely because the month grid truncates names to 3-5 characters at ~49px per
              cell, so a phone rendering that drops the name entirely fails it differently
              rather than passing it. (b) loses because UI-SPEC § Typography sets 16px as the
              floor for PRIMARY content, and on this surface the game name is the primary
              content, not a caption.

              `line-clamp-2` over the desktop `truncate`: a single-line ellipsis at 375px cuts a
              long name mid-word, which is the same "clipped to a few characters" failure in a
              gentler form. Two lines is the readable answer at phone width and costs nothing on
              a sheet whose body scrolls. */}
          {showGameName && (
            <p
              className={`${
                isSheet
                  ? 'block text-base line-clamp-2 mt-0.5'
                  : 'hidden sm:block text-sm truncate mt-0.5'
              } [color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)]`}
              style={subtitleVars}
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
            className="hidden sm:block w-12 h-12 md:w-14 md:h-14 object-cover rounded-sm shrink-0"
          />
        )}
      </div>
    </div>
  );
});
