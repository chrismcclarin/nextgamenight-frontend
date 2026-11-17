'use client';
import { forwardRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  PHOTO_TEXT_STYLE,
  SUBTEXT_MUTED_ON_LIGHT,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
} from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { useBgImageFailed } from '../../lib/hooks/useBgImageFailed';
import { formatTime, formatWithTzAbbr, withYearOutsideCurrent } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import RsvpCount from './RsvpCount';
// 88.9-39: the ONE tag classifier (F2c) and the ONE guest predicate (D5a) — both shared with the
// day modal / upcoming card, so no surface derives either twice. The twin count pill left with
// D6c; nothing here counts anything.
import { statusTagLabel } from '../../lib/upcomingEvents';
import { isGuestEvent } from '../../lib/eventClassification';
import GuestPill, { GUEST_ROW_EDGE } from './GuestPill';

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
 *
 * AMENDED Phase 88.9-61 (X29 A): EVERY arm now renders the two-section order described just
 * above (owner 2026-11-14, X29 option A with the 4:35 PM and 4:45 PM additions), so the
 * chronological feed, the Today delineator, the mount-time centre-scroll (Scroll anchoring) and
 * the top sentinel in the Layout list are history, and plan 10's "bit-for-bit unchanged" for the
 * desktop arms was amended by that ruling. What still differs by arm is height (the two
 * constants below against the sheet's flex fill) and the row's phone treatment (game name,
 * guest cue, status tag). See the Req 12 DECISION marker in the render body.
 */
const PAST_PAGE_SIZE = 30;

// The house isomorphic form (src/app/components/heatmap/paintGestureActiveStore.ts ("const useIsomorphicLayoutEffect = typeof window")):
// a layout effect in the browser, a plain effect on the server, where React 18 warns about the
// former on every server-rendered page. Used once below, for the scroll correction after a fold.
const useIsomorphicLayoutEffect = typeof window !== 'undefined' ? useLayoutEffect : useEffect;

// The day header's pattern — "Saturday, May 10". The year is never written here: the shared rule
// in src/lib/datetime.ts appends it when the day is outside the viewer's current year (X29).
const DAY_HEADER_FORMAT = 'EEEE, MMMM d';

// Fixed scroll-container heights chosen to match CalendarMonthView's natural
// rendered height for the same `variant`:
//   compact: 6 rows × min-h-[80px] + gaps + day-name header + month nav ≈ 540
//   full:    6 rows × min-h-[100px] + gaps + day-name header + month nav ≈ 660
// We subtract a little to account for the list view's section header/tz line
// rendered above the scroll container so the OUTER card height matches the
// month-view card height.
const CONTAINER_HEIGHT_COMPACT = 480;
const CONTAINER_HEIGHT_FULL = 600;
/* DECISION Phase 88.9-39 (88.9-25 hand-off 4, after CS-05): the two constants above stay as an
   UPPER BOUND — the six-row month — chosen OVER sizing the list to the rendered grid. Since CS-05
   (whole weeks: 28, 35 or 42 cells) the month card is 84px (compact) / 104px (full) shorter in a
   five-week month, so Month <-> List changes the card height there; that is ACCEPTED as an
   owner-visible consequence (glance row, 88.9-51). REJECTED: a list height derived from the grid's
   row count — the list card would then change height month to month on its own, and editing the
   desktop constants is what the 88.1 marker below rejects (look-only phase, P4). The comment above
   is history: "match" now means "match the TALLEST month". Changing this is a decision, not a
   cleanup. */

/* DECISION Phase 88.1 (plan 10, SPEC Req 11b / UI-SPEC S4): the phone bottom-sheet rendering
   is an ADDITIVE `variant` arm ('sheet'), chosen OVER editing the two height constants above
   or deleting the `sm:` gate on the game name.

   WHY THE EDIT-IN-PLACE VERSION LOSES: this is a live DESKTOP surface and 88.1's acceptance
   includes ">=768px pixel-unchanged". The two constants exist to match CalendarMonthView's
   natural rendered height for the same variant (see the comment above them), so the OUTER card
   heights agree when the user toggles month/list — changing either one reflows the desktop card.
   (AMENDED Phase 88.9-39: since CS-05 they match the six-row month only — the upper bound; the
   DECISION above the 88.1 block records the five-week-month consequence as accepted.)
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
     MUST stay on `SafeImage` (untrusted remote URL, T-88.1-25) — never a bare <img>.

   AMENDED Phase 88.9-61 (X29 A): the today-divider and empty-state bullets above are history —
   the divider is deleted on every arm and ONE empty line serves every arm (see the Req 12 and
   W18 / D2 markers in the render body). The arm itself stands: height, the game-name treatment
   and the gated RSVP row still fork on it, and the two desktop constants are still untouched. */
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
     is precisely the disagreement threat T-88.5-25 names. statusTagLabel (88.9-39) picks a TAG
     for a row already placed; it never decides membership.

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
     props (src/app/components/EventCalendar.js ("<CalendarListView")) and are pixel-unchanged.

     AMENDED Phase 88.9-61 (X29 A; owner 2026-11-14: 'Yes, live games should stay in upcoming'):
     "sheet arm only" and "SHEET ARM ONLY ... pixel-unchanged" above are history. EVERY arm
     partitions by these two sets now: the home sheet's are still computed in `UserHomePage`, and
     the two desktop arms' in `EventCalendar` from the same shared predicates
     (src/app/components/EventCalendar.js ("happeningNowIds={happeningNowIds}")), so a live game
     begun before midnight is not folded away behind the Past header on the group page (W59).

     AMENDED Phase 88.9-61 (X11, owner L1): the split below is two-way; still pure set lookup.
     The this-week id set prop left with the Later subheader it existed to draw — the two sets
     that remain are the only inputs. */
  happeningNowIds = EMPTY_ID_SET,
  startedNotLiveIds = EMPTY_ID_SET,
  // 88.9-39 D5a (R2-27), sheet arm only, threaded by UserHomePage: the viewer's own Users.id
  // UUID, compared in memory by isGuestEvent to mark a guest night's row. Never rendered. AMENDED Phase 88.9-63 (X27): every arm; EventCalendar threads it for the desktop arms.
  viewerDbUserId = null,
  // Plan 88.6.1-62 (Req 9): sheet arm only, set by the home page while a refresh of an
  // already-loaded list runs; marks the list's scroll region busy in place. The desktop arms pass
  // nothing, so their DOM is unchanged.
  busy = false,
}) {
  // The phone bottom-sheet arm. Derived once here so the height and the row's
  // game-name treatment can never disagree about which surface they are on.
  const isSheet = variant === 'sheet';

  // Req 12: ids for the two section headings and the regions their buttons control (every arm
  // since 88.9-61). `useId` so two mounted list views can never collide on the same
  // `aria-controls` target.
  const uid = useId();
  /* X6 (88.9-60), moved here by 88.9-52 (A-17): the shared picture-load probe is called ONCE for the
     whole list, as its contract asks (src/lib/hooks/useBgImageFailed.ts ("Call ONCE at a component")),
     and handed down through DateGroup to each EventRow, which asks it in its flag. It was called in
     every EventRow: one store listener and two effects per row.
     DECISION Phase 88.9-52 (A-17): the rows ask the LIST's probe during their own render, chosen OVER
     a probe per row. That is sound only while DateGroup and EventRow are not memoised: the probe
     records what it was asked on each list render, so a row that skipped a list render would drop out
     of the set a failed picture wakes. Wrapping either in React.memo is a decision, not a cleanup. */
  const bgImageFailed = useBgImageFailed();
  const upcomingHeadingId = `${uid}-upcoming`;
  const upcomingPanelId = `${uid}-upcoming-panel`;
  const pastHeadingId = `${uid}-past-heading`;
  const pastPanelId = `${uid}-past`;
  // 88.5-08 (D-04) derived the two sub-section heading ids from the SAME `useId` value for the
  // same collision reason. AMENDED Phase 88.9-39 (owner pick D6c): the This-week id went with its
  // heading. AMENDED Phase 88.9-61 (X11): the Later heading id went with its heading too; every
  // upcoming row shares the outer h3 and needs no id.
  // Upcoming OPEN, Past COLLAPSED by default — see the Req 12 DECISION marker in the render body
  // (the owner's: X29 option A says "collapsed" and X25a's note "Upcoming open, Past closed").
  const [upcomingExpanded, setUpcomingExpanded] = useState(true);
  const [pastExpanded, setPastExpanded] = useState(false);
  const upcomingButtonRef = useRef(null);
  const pastButtonRef = useRef(null);
  const upcomingPanelRef = useRef(null);
  const pastPanelRef = useRef(null);
  /* Folding a section hides its region (and, for Past, unmounts its rows). If keyboard focus is
     inside that region it would be dropped to the page body, so it moves to the section's own
     header button FIRST — the control the person just used, or would use to reopen it
     (T-88.9-262). `preventScroll` because the header is already where the eye is. Focus that is
     anywhere else is left alone. */
  const pendingFoldRef = useRef(null);
  const toggleSection = (expanded, setExpanded, panelRef, buttonRef) => {
    if (expanded && panelRef.current) {
      if (panelRef.current.contains(document.activeElement)) {
        buttonRef.current?.focus({ preventScroll: true });
      }
      // Read by the layout effect below, after this fold has committed.
      pendingFoldRef.current = panelRef.current.closest('section');
    }
    setExpanded(!expanded);
  };

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

  // Long, friendly date header — "Saturday, May 10", or "Saturday, March 15, 2025" when the day
  // is outside the viewer's current year (X29, 88.9-61: the one shared year rule). Rendered in the viewer's
  // timezone via the consolidated datetime layer; formatWithTzAbbr falls back to
  // UTC internally when timezone is unset (the provider already defaults it to
  // browser/UTC, so the bare-UTC branch is defensive only). The catch handles a
  // malformed IANA string by rendering in UTC rather than crashing.
  const formatDayHeader = (utc) => {
    const d = new Date(utc);
    if (isNaN(d.getTime())) return '';
    try {
      return formatWithTzAbbr(d, timezone, withYearOutsideCurrent(DAY_HEADER_FORMAT, d, timezone));
    } catch {
      return formatWithTzAbbr(d, null, withYearOutsideCurrent(DAY_HEADER_FORMAT, d, null));
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

  // Group a list into date buckets (a day header and its rows).
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

     ADDED (1): `pastListGroups` MOVED IN HERE from its own `useMemo`. It had to move, and
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
     (src/app/userHome/UserHomePage.js ("eventsAPI.getUserEvents(selfUuid).then(evts => {") / src/app/userHome/UserHomePage.js ("UpcomingEventsCard does its own filter+sort; pass the raw list.")) — the user's whole history, with no backend date filter. The
     decision stands; the premise behind it is restated here rather than left pointing at a cost
     profile this block no longer has.

     AMENDED Phase 88.9-61 (X11, owner L1): the partition of the upcoming section is two-way;
     still pure set lookup, still no `.status` read here. The buckets are happening-now
     (unchanged) and EVERY other `futureGroups` row that is not started-not-live (those still go
     to Past). The third bucket — the next-7-day rows against a Later remainder — left with the
     Later subheader: "This week" and "Later" above are history, and a future-dated cancelled
     night now sits in the one list in date order.

     AMENDED Phase 88.9-61 (X29 A): this partition runs on EVERY arm (it returned empty lists off
     the sheet), and its past outputs are named for the list, not the sheet. A host that passes no
     sets gets the plain date-key split by construction: both sets are empty, so nothing is taken
     out of either side. */
  const {
    happeningNowGroups,
    notStartedGroups,
    pastListGroups,
    pastListTotal,
  } = (() => {
    /* 1. HAPPENING NOW — one ASCENDING pass over both buckets. `pastEvents` and
       `todayAndFutureEvents` are each ascending and the first is entirely before the second by
       date key, so the concatenation is ascending and date order is preserved. NOT
       live-first-then-the-rest: these rows keep their place in the day. */
    const happeningRows = [];
    for (const ev of pastEvents) if (happeningNowIds.has(ev.id)) happeningRows.push(ev);
    for (const ev of todayAndFutureEvents) if (happeningNowIds.has(ev.id)) happeningRows.push(ev);
    const happening = groupByDate(happeningRows);

    /* 2. EVERY OTHER UPCOMING ROW, over `futureGroups` as before (X11, 88.9-61: one bucket
       where there were two). Two exclusions: a happening-now row has already been taken above,
       and a started-not-live row is routed to the past list below. What is left is the rest of
       the future range BY ELIMINATION, in date order. */
    const notStarted = [];
    const startedNotLiveFromFuture = [];
    for (const group of futureGroups) {
      const items = [];
      for (const ev of group.items) {
        if (happeningNowIds.has(ev.id)) continue;
        if (startedNotLiveIds.has(ev.id)) {
          startedNotLiveFromFuture.push(ev);
          continue;
        }
        items.push(ev);
      }
      // The bucket keeps the group's own key/sample, so `formatDayHeader`, ordering and
      // timezone handling are byte-identical to the undivided render.
      if (items.length > 0) notStarted.push({ ...group, items });
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
      notStartedGroups: notStarted,
      pastListGroups: groupByDate([...pastSource].reverse()),
      pastListTotal: pastTotal,
    };
  })();

  /* DECISION Phase 88.9-39 D6c: happening-now and this-week groups fold by date key into ONE list,
     chosen OVER two sibling maps; with no subheader between them a live game and a later game on
     the same day would render two identical day headers. Changing this is a decision, not a
     cleanup. A NEW object per key, never a source array mutated; happening-now rows first within
     a day. The empty-state gate below still reads the three partition lists.
     AMENDED Phase 88.9-61 (X11): the fold now takes happening-now and EVERY other upcoming row,
     so this is the whole upcoming list and only day headers separate rows; the empty-state gate
     reads this one list. */
  const upcomingGroups = (() => {
    const byKey = new Map();
    for (const group of [...happeningNowGroups, ...notStartedGroups]) {
      const folded = byKey.get(group.key);
      if (folded) folded.items.push(...group.items);
      else byKey.set(group.key, { ...group, items: [...group.items] });
    }
    return [...byKey.values()];
  })();

  // The scroll region. It is the IntersectionObserver root below; nothing scrolls it on mount —
  // the list opens at its top on every arm (X29 A, 88.9-61: the mount-time centre-scroll on the
  // Today delineator left with the delineator).
  const containerRef = useRef(null);

  /* FOLD SCROLL (X25a, 88.9-61). A header sticks only while its own rows are under it, so a
     section folded from deep inside it shrinks to its header and that header is left ABOVE the
     visible part of the list — the person has just pressed a control that then vanishes, and
     with a long open Past section the browser does not pull the list back on its own. After the
     fold commits, if the folded section starts above the visible part, the region scrolls to the
     section's top: its header is back in view with the next section's header directly under it.
     A layout effect, so the corrected position is the first one painted. It runs only for a
     fold the person just made (the pending ref), never on mount and never on an unfold. */
  useIsomorphicLayoutEffect(() => {
    const section = pendingFoldRef.current;
    if (!section) return;
    pendingFoldRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    // The region is `position: relative`, so it is the offset parent of both sections.
    if (section.offsetTop < container.scrollTop) container.scrollTop = section.offsetTop;
  }, [upcomingExpanded, pastExpanded]);

  // Past-window IntersectionObserver: when the sentinel at the BOTTOM of the open Past region
  // enters the SCROLL CONTAINER's viewport AND there are more past events to load, reveal
  // another page of them. We use the scroll container as the IO root so the
  // sentinel triggers inside the card, not the page.
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
        // Req 12 forked the MARGIN with the sentinel's POSITION (top edge on the desktop
        // feed, bottom edge on the sheet). AMENDED Phase 88.9-61 (X29 A): one bottom margin —
        // every arm's open Past region runs newest-to-oldest DOWNWARD with the sentinel after
        // its last group, so the pre-load margin is on the BOTTOM edge everywhere. Root,
        // threshold, page size and the `allMorePastLoaded` guard are unchanged.
        rootMargin: '0px 0px 200px 0px',
        threshold: 0.01,
      }
    );

    observer.observe(node);
    return () => observer.disconnect();
    // `pastExpanded` is load-bearing: the sentinel node does not exist until the
    // panel expands, so without it the observer would be set up against a null ref
    // once and never re-attach.
  }, [allMorePastLoaded, pastEvents.length, pastExpanded]);

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
     LARGEST viewport, so the bottom rows would sit under the toolbar. HISTORY: the divergence from `Modal.tsx`'s then-`max-h-[90vh]` was recorded by plan
     88.1-04 and routed to Phase 88.6 by plan 88.1-06. AMENDED Phase 88.6.2 (2026-10-25, review B-WR-01): CLOSED by plan 88.6-08, Modal is `dvh` too (src/app/components/Modal.tsx ("flex max-h-[90dvh] w-[calc(100%-1.5rem)]")),
     as Modal's own src/app/components/Modal.tsx ("THE OTHER SIDE, now closed (historical)") records; changing this back to `vh` re-opens D-06 AND re-creates the divergence.

     `min-h-0` is load-bearing: without it a flex child refuses to shrink below its content and
     the list overflows the sheet instead of scrolling inside it. */
  const shellClassName = isSheet
    ? 'space-y-4 flex h-full min-h-0 flex-col'
    : 'space-y-4';
  // Both arms pad the region's scroll position at the top by 3.5rem (the 44px header, the 4px a
  // row's ring reaches above it, 8px of air; rem, so it grows with the text like the header's
  // own floor) — see the X25a DECISION above SectionHeader.
  // AMENDED Phase 88.9-52 (W17, after-build look page): 5.75rem. The 3.5rem above cleared the
  // focused ROW, but its own day heading stayed behind the stuck header (the first Past row
  // showed with no date above it). The extra 2.25rem is that heading's box: a 1.25rem line,
  // 0.25rem of pad, the 1px rule and the 0.5rem gap (33px at 100%; 36px given). Chosen OVER a
  // script that scrolls the heading into view (the X25a DECISION rejects a focus handler).
  const scrollRegionClassName = isSheet
    ? 'relative overflow-y-auto pr-1 min-h-0 flex-1 max-h-[85dvh] scroll-pt-23'
    : 'relative overflow-y-auto pr-1 scroll-pt-23';
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
  //
  // 88.9-61 (X25a + X29 A): the same shape as the loaded render — the tz caption band, then the
  // Upcoming events heading INSIDE the scroll region, in the box SectionHeader gives its button
  // (44px tall, same inset). A plain heading with no button: there is nothing to fold yet.
  if (loading && (!Array.isArray(events) || events.length === 0)) {
    return (
      <div className={shellClassName}>
        {tzAbbr && (
          <div className="flex items-baseline justify-between gap-3 flex-wrap">
            <span className="text-xs text-content-muted">
              Times shown in {tzAbbr}
            </span>
          </div>
        )}
        <div
          className={scrollRegionClassName}
          style={scrollRegionStyle}
        >
          <div className="space-y-4">
            <Heading level={3} size="heading" className="min-h-11 flex items-center px-4 text-content-primary">Upcoming events</Heading>
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
      </div>
    );
  }

  return (
    <div className={shellClassName}>
      {/* The fixed band above the scroll region holds ONLY the timezone caption, and renders only
          when there is one (88.9-61, X25a: the Upcoming events heading moved inside the region,
          where it can stick over its own rows and fold; the caption stays at the start edge, as
          the picked frame shows it). */}
      {tzAbbr && (
        <div className="flex items-baseline justify-between gap-3 flex-wrap">
          <span className="text-xs text-content-muted">
            Times shown in {tzAbbr}
          </span>
        </div>
      )}

      <div
        ref={containerRef}
        className={scrollRegionClassName}
        style={scrollRegionStyle}
        aria-busy={busy || undefined}
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
              ONLY: the desktop arms pass no id sets (src/app/components/EventCalendar.js ("<CalendarListView")) and are
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

                   AMENDED Phase 88.9-39 (owner pick D6c + F2c, 88.9-PICKS-B3B.json /
                   88.9-PICKS-B5.json, 2026-11-07): the THIS WEEK eyebrow, its count pill and
                   sr-only count left the sheet, chosen OVER the counted subheader; its rows now
                   sit under the Upcoming events h3 at the default levels; cancelled / completed
                   rows carry a status tag (F2c) — the "ordinary row treatment" sentence above is
                   history: EventRow's statusTag arm is that per-status styling, gated on this
                   Later section. The W58 visual half is settled by placement: an already-started
                   cancelled / completed row is in Past, and F2c tags the future ones.

                   AMENDED Phase 88.9-61 (X26): only a cancelled row reaches the status arm;
                   (X11) gated on the upcoming section, sheet-only, dormant.

                   AMENDED Phase 88.9-61 (X11, owner L1): the Later subheader is REMOVED, chosen
                   OVER a label that could sit over an already-started row
                   (planning:.planning/deferred/phase-88.6.md) and that split one list. Items 2
                   and 3 above are history: every upcoming row that is not happening now sits in
                   ONE date-ordered list under the Upcoming events heading.

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
              construction above the scroll region exists to avoid.
              AMENDED Phase 88.9-39 (owner pick D6c): only Later demotes now; the folded
              happening-now + next-7-day list renders at the default levels under the `<h3>`.
              AMENDED Phase 88.9-61 (X11): no caller demotes; the seam stays.

              AMENDED Phase 88.9-61 (X25a + X29 A; owner 4:35 PM 'two separate headers, and then
              something to denote a separation'): EVERY arm renders two sections headed by
              h3-wrapped buttons; Upcoming open, Past closed; the heading moved INSIDE the scroll
              region (still one Upcoming events heading); a rule above Past; the Today delineator
              DELETED (it carried DECISION Phase 88-27 (D-32 bucket B)) — chosen OVER X250's fixed
              heading over past rows and OVER the feed. Back to one feed re-opens N40 and X05.
              Both headers fold (owner 4:45 PM: 'maybe we make both upcoming and past events drop
              downs?'). Everything above that says "the sheet arm" and "desktop arms untouched"
              is history from here: the same render serves the phone sheet, the home List view
              and the group page List view. */}
          {/* Section 1 — upcoming. Named by its own header (the id still ends in the upcoming
              suffix); `futureGroups` is already soonest-first and includes TODAY's events (the
              split is `k >= todayKey`). The same 16px sits under each header, so the two
              sections are equal by construction. */}
          <section aria-labelledby={upcomingHeadingId} className="space-y-4">
            <SectionHeader
              headingId={upcomingHeadingId}
              panelId={upcomingPanelId}
              expanded={upcomingExpanded}
              onToggle={() => toggleSection(upcomingExpanded, setUpcomingExpanded, upcomingPanelRef, upcomingButtonRef)}
              buttonRef={upcomingButtonRef}
            >
              Upcoming events
            </SectionHeader>

            <div id={upcomingPanelId} ref={upcomingPanelRef} hidden={!upcomingExpanded} className="space-y-6">
              {/* EVERY UPCOMING ROW — deliberately NO subheader, not even plain text (the THIS
                  WEEK eyebrow, its pill and its sr-only count left with D6c, 88.9-39; the Later
                  subheader left with X11, 88.9-61). These rows sit directly under the section's
                  `<h3>`, which is their only heading, so their `DateGroup` keeps the DEFAULT
                  heading levels (h4 day header, h5 row title). ONE map over `upcomingGroups`
                  (the D6c marker above): the partition buckets fold back by date key so a live
                  game and a later game on the same day share one day header, live first. This is
                  the only map whose rows may carry the status tag (F2c), so it is the one that
                  passes `statusTagEligible` (the tag itself stays sheet-only inside EventRow). */}
              {upcomingGroups.map((group) => (
                <DateGroup
                  key={group.key}
                  group={group}
                  formatDayHeader={formatDayHeader}
                  timezone={timezone}
                  onEventClick={onEventClick}
                  isSheet={isSheet}
                  viewerDbUserId={viewerDbUserId}
                  bgImageFailed={bgImageFailed}
                  statusTagEligible
                />
              ))}

              {/* The ONE empty line, inside the open Upcoming section. Gated on the whole
                  upcoming list being empty — the partition covers `futureGroups` exhaustively,
                  so an event anywhere in the future range keeps this line off. */}
              {upcomingGroups.length === 0 && (
                <div className="flex items-center justify-center pt-4">
                  {/* DECISION Phase 88.6-27 (W18 / D2): this SECTION-level empty takes D2's
                      recorded section MINI-FORMULA — one line of prose at
                      `text-content-muted text-sm` — and the string is byte-unchanged (P1).

                      REJECTED: `<EmptyState>`. Its own `DECISION Phase 88-18 (D2)` marker
                      (src/components/ui/EmptyState.tsx ("DECISION Phase 88-33 Task 7 (D2, owner-ruled 2026-08-15)"), owner ruling 2026-08-15, planning:.planning/phases/88-fe-wave-3-design-system-a11y/88-UAT.md ("D2 RULED 2026-08-15 (owner, packet review)")) (AMENDED 2026-10-24, 88.6.2-34: the D2 marker is the Phase 88-33 Task 7 one anchored here; 88-18 is that file's heading-level marker)
                      makes the full icon+heading+body formula PAGE-LEVEL ONLY and says in
                      terms not to upgrade section empties as a cleanup. It is also
                      unsatisfiable here: the component REQUIRES `icon`, `heading` and `body`
                      while this site is a single `<p>`, and it would introduce an `h3` that
                      this file's `EXPECTED_LEVELS` entry does not carry.

                      GROUND: the sheet is `bg-surface-card` (src/components/ui/BottomSheet.tsx ("rounded-t-[12px] border-t border-line bg-surface-card")), and
                      `tokenContrast.test.ts` pins `--color-text-muted` on `--color-bg-card`
                      at >= 4.5 in BOTH themes. Upgrading this to the full formula is a
                      decision, not a cleanup.

                      AMENDED Phase 88.9-61 (X29 A; owner 2026-11-14 'It should just say no
                      events'): one line, every arm — No events with no nights, No upcoming
                      events only when past nights exist, nothing under Past; same card ground on
                      every host (the sheet is the card surface, and both desktop hosts wrap this
                      component in the card utility, src/app/components/EventCalendar.js ("<CalendarListView"),
                      which paints the same token; the muted rung is pinned on it at 4.5 or more
                      in both themes). The desktop twin of this marker folded into this one. */}
                  <p className="text-content-muted text-sm">{pastListTotal > 0 ? 'No upcoming events' : 'No events'}</p>
                </div>
              )}
            </div>
          </section>

          {/* Section 2 — past. Renders only when there IS history. Phase 88.6-27: gated on
              `pastListTotal`, the list's own all-history total, not on `pastEvents.length` —
              a row that is happening NOW has left this bucket and a row that started earlier
              today has joined it. The rule above it is the owner's separation (4:35 PM, X25a:
              1px in the border-line colour, 12px under it; the list's 24px gap sits above). */}
          {pastListTotal > 0 && (
            <section aria-labelledby={pastHeadingId} className="border-t border-line pt-3 space-y-4">
              {/* The count is `pastEvents.length` (ALL history), not the rendered window —
                it is telling the user how much there is, not how much is mounted.

                AMENDED Phase 88.6-27 (W58 + W59): the ALL-HISTORY stance above is
                PRESERVED exactly; only the BUCKET MEMBERSHIP changed. The number is now
                `pastListTotal` — all of `pastEvents` minus its happening-now members,
                plus the `futureGroups` rows that started today and are no longer running
                — which is still every past row that exists, not the rendered window. Two
                consequences, both reasons NOT to "simplify" this onto the window list:
                a window-derived count would read "Past events (30)" on any group with
                more than `PAST_PAGE_SIZE` past rows, and gating the disclosure on a
                FILTERED window would unmount the rolling sentinel and its observer
                whenever every windowed row happened to be filtered out, making further
                paging impossible. */}
              <SectionHeader
                headingId={pastHeadingId}
                panelId={pastPanelId}
                expanded={pastExpanded}
                onToggle={() => toggleSection(pastExpanded, setPastExpanded, pastPanelRef, pastButtonRef)}
                buttonRef={pastButtonRef}
              >
                Past events ({pastListTotal})
              </SectionHeader>

              {/* The region is ALWAYS rendered so `aria-controls` always resolves to a real
                  element; only its CHILDREN are conditional, so a collapsed panel mounts no
                  rows. */}
              <div id={pastPanelId} ref={pastPanelRef} hidden={!pastExpanded} className="space-y-6">
                {pastExpanded && (
                  <>
                    {pastListGroups.map((group) => (
                      <DateGroup
                        key={group.key}
                        group={group}
                        formatDayHeader={formatDayHeader}
                        timezone={timezone}
                        onEventClick={onEventClick}
                        isSheet={isSheet}
                        viewerDbUserId={viewerDbUserId}
                        bgImageFailed={bgImageFailed}
                      />
                    ))}

                    {/* The rolling loader, at the BOTTOM: history runs downward here. See the
                        bottom `rootMargin` in the observer effect above. */}
                    {!allMorePastLoaded && (
                      <div ref={sentinelRef} className="h-1" aria-hidden="true" />
                    )}
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One section header: an `<h3>` WRAPPING the button that folds its section. Both sections use
 * this one component, so the two headers are equal by construction (owner 4:35 PM, 2026-11-14:
 * "two separate headers"; 4:45 PM: both fold).
 *
 * The heading wraps the button, never the reverse: a heading inside a button would lose its
 * heading role for assistive tech, and the Calendar sheet's e2e reads "a heading inside a row
 * button" as a row title.
 *
 * A real <button> via the shipped Button primitive, carrying the aria-expanded / aria-controls
 * pair (the idiom at `gameDetail/page.js`'s description toggle). The role-button DIV next door in
 * `PromptScheduleSection.js` is NOT the pattern to copy: its own marker says it exists because
 * its label is a <p>, and `<button><p>` breaks hydration. This label is phrasing content, so the
 * real button is available.
 *
 * LAYOUT LIVES ON THE INNER SPAN, deliberately: `.btn` is UNLAYERED
 * (src/app/globals.css ("UNLAYERED with every other declaration it has today")) and sets `justify-content: center`, so a
 * `justify-between` utility on the button itself would be dead on arrival — the failure mode
 * the Button primitive's own marker records eight times over.
 *
 * `min-h-11` is the 44px floor stated at the CALL SITE. `.btn`'s own floor is phone-only and
 * unlayered; pinning it here makes the e2e measurement a property of this control rather than of
 * a global rule.
 *
 * THE LABEL SPAN CARRIES THE TYPE, for the same unlayered reason: `.btn` sets 14px / 600 on the
 * button, which would win over the `<h3>`'s own 20 / 700 for the text inside it. The span's own
 * classes put the heading rung back on the words (X25a: the Past label at the h3's 20px / 700).
 *
 * DECISION Phase 88.9-61 (X25a, page 10a; owner N40: 'it looks like the past events are under
 * the Upcoming events heading'): each header sticks while its own rows are under it, chosen OVER
 * X25b (headers scroll away) and X250 (one fixed heading over every row). Scroll padding keeps a
 * focused row clear of a stuck header (WCAG 2.4.11), chosen OVER a script focus handler.
 * Removing either is a decision, not a cleanup. The heading sticks at the top of the scroll
 * region, above the rows (a row paints at z-index 1) and on the card ground, which is the ground
 * of the sheet and of both desktop cards, so a row passing under it does not show through.
 *
 * DECISION Phase 88.9-52 (W9, after-build look page, no objection from the owner 2026-11-16): the
 * heading is a size container and, under 14rem of its width (about 200% text on a 375 phone), the
 * label row spreads over the button's 1rem side padding, chosen OVER the padded row, where the
 * header read Upcomi / ng / events. The padding is the unlayered .btn rule's, so a padding utility
 * on the button would be dead (the LAYOUT note above); the row takes a negative margin and the
 * matching width. ARITHMETIC from the 2026-11-16 capture, not a rendered read: the header is
 * 254px there, the label had 156px and Upcoming needs about 196px; with the padding it has 220px.
 * The label reads from the left (text-left: .btn centres text, which showed once it wrapped) and
 * the chevron keeps its size. At 100% nothing moves. Changing this is a decision, not a cleanup.
 */
function SectionHeader({ headingId, panelId, expanded, onToggle, buttonRef, children }) {
  return (
    <Heading level={3} size="heading" id={headingId} className="@container sticky top-0 z-10 bg-surface-card">
      {/* DECISION Phase 88.9-61 (X25a focus ring): the header button draws the house ring INSET,
          chosen OVER Button's default ring-offset-2, whose 4px outside ring the scroll region
          cuts on the left (overflow clips both axes, no left pad), at scrollTop 0, and above a
          stuck header (WCAG 2.4.7); the house form for a full-bleed control (ThemeToggle row,
          compact month tile). Removing it is a decision, not a cleanup. The ring sits on the
          button's own ground, the card: 7.79:1 light and 8.30:1 dark, against a 3:1 floor. */}
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={panelId}
        className="w-full min-h-11 focus-visible:ring-inset focus-visible:ring-offset-0"
      >
        <span className="flex w-full items-center justify-between gap-2 @max-[14rem]:-mx-4 @max-[14rem]:w-[calc(100%+2rem)]">
          <span className="min-w-0 text-left text-xl leading-tight font-bold text-content-primary">{children}</span>
          <Icon
            name="ChevronDown"
            size={18}
            className={expanded ? 'shrink-0 transition-transform rotate-180' : 'shrink-0 transition-transform'}
          />
        </span>
      </Button>
    </Heading>
  );
}

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
 * AMENDED Phase 88.9-61 (X11): no caller demotes; the seam stays. The This-week pair left with
 * 88.9-39 D6c and the Later pair with the Later subheader, so every call renders the defaults.
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
  // 88.9-39: forwarded to EventRow. `statusTagEligible` is passed by the sheet's upcoming list
  // ONLY (F2c; the Later group until X11, 88.9-61, folded it into that list).
  viewerDbUserId = null,
  statusTagEligible = false,
  // 88.9-52 (A-17): the list's one picture-load probe, forwarded to EventRow.
  bgImageFailed,
}) {
  // Capitalised so JSX treats it as a component; the value is a lowercase intrinsic tag.
  const DayHeading = headingLevel;
  return (
    <section key={group.key} className="space-y-2">
      {/* UI-SPEC §4.5: HIERARCHY, so 600 -> 700. The 14px rung is unchanged — this is the
          Label rung and it is on the scale already. The element stays the `headingLevel` seam
          (see the DR2-7b marker above); only the weight utility moves. */}
      <DayHeading className="text-sm font-bold text-content-secondary uppercase tracking-wider pb-1 border-b border-line">
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
            viewerDbUserId={viewerDbUserId}
            statusTagEligible={statusTagEligible}
            bgImageFailed={bgImageFailed}
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
  { event, timezone, onClick, viewerDbUserId = null, statusTagEligible = false, bgImageFailed, isSheet = false, headingLevel = 'h5' },
  ref
) {
  // See the `headingLevel` DECISION on `DateGroup` above — the default IS the shipped
  // level, so every caller that passes nothing renders exactly what it rendered before.
  const TitleHeading = headingLevel;
  // X6 (88.9-60): the shared picture-load probe arrives as a prop (88.9-52 A-17: called once, in
  // CalendarListView); one row, one lookup, in the flag below.
  const groupBgImage = event.Group?.background_image_url;
  const groupProfilePic = event.Group?.profile_picture_url;

  /*
   * DECISION Phase 88.6-41 (W49 / FSEC-03): ONE image flag, derived from the
   * VALIDATED `safeBgImageStyle` output. This replaces the 88.3.1 plan-08
   * two-flag marker, whose REJECTED arm ("converging `hasBgImage` onto the
   * validated style here … converge all four in one pass, with a rendered
   * check") this plan discharged. History, because it is the record of why the
   * divergence shipped: `safeBgImageStyle` drops relative/invalid URLs, so a
   * truthy-but-rejected URL paints NO image — that row is a plain coloured card
   * and must get its ink. 88.3.1 fixed the INK half with a second flag and left
   * the TEXT half raw, because converging it changes what those rows paint.
   *
   * The surviving flag keeps the RAW NAME because that is the name every text
   * treatment below already reads; it is the RHS that moved onto the validated
   * side. `grouplist.js` is the reference shape (unchanged, and the control in
   * `groupColourRendering.test.ts` test 31's source scan).
   *
   * The 0.85 white wash below converged in the SAME commit, not in a follow-up:
   * see the `onDarkGround` comment further down — the image case deliberately
   * falls through to the DARK pole because the row washes the image white at
   * 0.85. Converting the flag alone would put TEXT_ON_DARK under a still-raw
   * white wash on an invalid-URL row over a dark preset — white on near-white.
   * The flag and its wash are one designed pair. A decision, not a cleanup.
   *
   * AMENDED Phase 88.9-39 F2c: the flag is also false on a status row — that row paints no
   * image, so the flag now reads 'this row paints an image'; the derivation from
   * safeBgImageStyle is unchanged.
   *
   * AMENDED Phase 88.9-60 (X6, owner F1): also false when the picture fails to load (src/lib/hooks/useBgImageFailed.ts); derivation unchanged.
   */
  /* DECISION Phase 88.9-39 F2c: a cancelled / completed sheet row takes the card ground and
     text-content-muted ink as its own arm of the ground ternary, chosen OVER keeping the group
     tint or image under muted ink — muted is measured only on the card (6.58 / 6.00); on a
     user-chosen tint it is unbounded. The label comes from statusTagLabel; this file still
     compares no status itself. The tag is gated on the Later section (statusTagEligible), chosen
     OVER isSheet alone — the past list holds every after-the-fact log, which the backend writes
     as completed (backend:Sonnet/routes/events.js ("status: new Date(start_date) > new Date() ? 'scheduled' : 'completed',")).
     AMENDED Phase 88.9-61 (X26): only a cancelled row reaches the status arm; (X11) gated on the
     upcoming section, sheet-only, dormant. */
  const statusTag = isSheet && statusTagEligible ? statusTagLabel(event) : null;
  const bgImageStyle = safeBgImageStyle(groupBgImage);
  const hasBgImage = !!bgImageStyle && !statusTag && !bgImageFailed(bgImageStyle);
  /* DECISION Phase 88.9-39 D5a: a guest sheet row swaps its 1px line border for the dashed amber
     left edge as an exclusive border arm, chosen OVER stacking the edge on border-line —
     border-dashed and the amber colour apply to every side, so a stacked row would dash all four
     edges. The inline borderColor key is deleted rather than overridden, as EventDayModal's W30
     did: an inline declaration beats any class, so the amber edge and border-line could not
     paint.
     AMENDED Phase 88.9-63 (X27 + orchestrator decision 3): a dashed outline on all four sides, on
     every arm, chosen OVER sheet-only marking (guest on the phone, nothing on its desktop twin).
     The exclusive arm and the inline borderColor deletion stand. */
  const guest = isGuestEvent(event, viewerDbUserId);
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
   *
   * AMENDED Phase 88.9-60 (X23a, owner pick page 10a, 2026-11-14): on a PICTURE row both
   * treatments return a copy of the one photo text set (colorUtils), in both themes, chosen
   * OVER the dark-pole fallthrough this had (dark ink that only read because the row washed
   * its picture white at 0.85). The wash and that fallthrough left together. The set is
   * SPREAD, never restated at this site.
   */
  const titleTreatment = (rowGround) => {
    if (hasBgImage) return { ...PHOTO_TEXT_STYLE };
    if (isThemed) return getTextStyle(false, null);
    const onDarkGround = isDarkBackground(rowGround);
    return {
      color: onDarkGround ? TEXT_ON_DARK : TEXT_ON_LIGHT,
      textShadow: onDarkGround
        ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
        : '1px 1px 2px rgba(255, 255, 255, 0.9)',
      WebkitTextStroke: onDarkGround ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
    };
  };
  const subtitleTreatment = (rowGround) => {
    if (hasBgImage) return { ...PHOTO_TEXT_STYLE };
    if (isThemed) return getSubtitleStyle(false, null);
    const onDarkGround = isDarkBackground(rowGround);
    return {
      color: onDarkGround ? 'rgba(255,255,255,0.9)' : SUBTEXT_MUTED_ON_LIGHT,
      textShadow: onDarkGround
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
  // 88.9-39 F2c: a status row takes text-content-muted alone at BOTH computations' consumers
  // (title, time, game name) — no `--t-*` classes, no style vars, no shadow or stroke — so
  // neither CR-02 path reaches it (the row's ground is the card, where muted is measured).
  const statusInk = statusTag ? 'text-content-muted' : null;

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
         src/app/globals.css ("--shadow-theme-md: var(--shadow-md);")), so the hover hue changes visibly and deliberately.
         PLAIN `hover:`, NOT `enabled-hover:`: this is a card `div`, not a `.btn` — the
         enabled-hover variant exists to withhold the lift from a GATED CONTROL, and there is no
         control here to gate. REJECTED: leaving the alias in place for visual continuity.
         Re-spelling it back to `shadow-md` is a decision, not a cleanup. */
      className={`p-3 sm:p-4 ${guest ? GUEST_ROW_EDGE : 'border border-line'} rounded-lg transition-all hover:shadow-theme-md cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card ${tinted && !statusTag ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`}
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
         * AMENDED Phase 88.6-41 (W49): the "REJECTED: the raw `hasBgImage` — see
         * the two-flag marker above" note that sat here is retired with its
         * parent. There is no raw flag left to reject: `hasBgImage` IS the
         * validated flag now (`!!bgImageStyle`, see the marker at its
         * declaration), and `groupColourRendering.test.ts` tests 29 and 31 are
         * the machine check that it stays that way.
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
          hasBackgroundImage: hasBgImage,
        }),
        ...(hasBgImage ? bgImageStyle : null),
        backgroundSize: 'cover',
        backgroundPosition: 'center',
        position: 'relative',
        zIndex: 1,
      }}
    >
      {/* contrast wash for bg images (HISTORY: the element is gone, see the amendment).
          AMENDED Phase 88.6-41 (W49): gated on the VALIDATED flag, in the SAME
          commit as the text treatments above. An invalid URL paints no image, so
          this used to wash a plain coloured row white at 0.85 while the treatment
          (now converged) assumed no image — white text on near-white.
          AMENDED Phase 88.9-60 (X23a): the wash went with the dark-pole fallthrough —
          the pair changed as one; a picture row wears the photo set. Words that keep
          their own ink sit on their own opaque ground instead: the RSVP counts in the
          chip below, the avatar disc and the status tag on theirs. The Guest pill gets
          NO className override here: its ground over an unwashed photo is covered by
          88.9-63 Task 2 (X17a, the opaque pill pair), and a call-site dark class would
          beat that token through tailwind-merge. Re-adding a wash is a decision, not a
          cleanup. */}
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
              } ${statusInk ?? '[color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [paint-order:var(--t-paint-l,normal)] dark:[paint-order:var(--t-paint,normal)] [letter-spacing:var(--t-track-l,normal)] dark:[letter-spacing:var(--t-track,normal)]'}`}
              style={statusInk ? undefined : titleVars}
            >
              {eventTitle}
            </TitleHeading>
            <span className={`text-sm ${hasBgImage ? 'font-bold' : ''} ${statusInk ?? '[color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [paint-order:var(--t-paint-l,normal)] dark:[paint-order:var(--t-paint,normal)] [letter-spacing:var(--t-track-l,normal)] dark:[letter-spacing:var(--t-track,normal)]'}`} style={statusInk ? undefined : subtitleVars}>
              {startTime}
            </span>
            {/* D5a (88.9-39): the shared Guest pill after the time, on a guest night's row only. */}
            {guest && <GuestPill />}
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
              } ${hasBgImage ? 'font-bold' : ''} ${statusInk ?? '[color:var(--t-color-l)] dark:[color:var(--t-color)] [text-shadow:var(--t-shadow-l)] dark:[text-shadow:var(--t-shadow)] [-webkit-text-stroke:var(--t-stroke-l)] dark:[-webkit-text-stroke:var(--t-stroke)] [paint-order:var(--t-paint-l,normal)] dark:[paint-order:var(--t-paint,normal)] [letter-spacing:var(--t-track-l,normal)] dark:[letter-spacing:var(--t-track,normal)]'}`}
              style={statusInk ? undefined : subtitleVars}
            >
              {gameName}
            </p>
          )}

          {/* md: RSVP count (drops below 768px) */}
          {/* DECISION Phase 88.9-60 (X23a RSVP chip, owner ruling Q3 A, 2026-11-14): on a picture row the
              RSVP count line sits in a small card-ground chip that hugs the text, colours kept, chosen OVER
              re-styling the coloured status inks with the photo stroke set (the inks are pinned on the card
              ground by tokenContrast test 19 and a coloured fill against the 2px black outline fails
              fill-vs-outline) and OVER a ground on the full-width md:flex box (a card band across the photo,
              the wash X23a removed). Changing this is a decision, not a cleanup. */}
          <div className={hasBgImage ? 'hidden md:inline-flex w-fit mt-1.5 px-1.5 py-0.5 rounded-sm bg-surface-card' : 'hidden md:flex mt-1.5'}>
            <RsvpCount
              rsvpSummary={event.rsvp_summary}
              variant="full"
              className="text-xs"
            />
          </div>
        </div>

        {/* F2c (88.9-39): the Caption-12 status tag at the row end (bg-surface-muted + secondary
            ink, 6.96 / 7.07); the title column is min-w-0 so it gives way first (R2E3 overflow). */}
        {statusTag && (
          <span className="ml-auto shrink-0 px-2 py-0.5 rounded-sm bg-surface-muted text-content-secondary text-xs font-bold">{statusTag}</span>
        )}

        {/* DECISION Phase 88.9-52 (PIX-4, R23 side finding of the picture pass): the square is hidden
            under sm with max-sm:hidden and takes NO display class from sm up, chosen OVER the
            hidden-then-block pair it carried. SafeImage hands this class string to its fallback box
            too, and the block won over the box's own flex, so a failed picture's die sat in the
            box's top-left corner instead of its centre. With no display class the box keeps its
            flex and the picture keeps its own display; both are flex items of this row, so the
            picture lays out as it did. WHEN the fallback shows is unchanged (an owner question is
            open on that). Putting a display class back here is a decision, not a cleanup. */}
        {event.Game?.image_url && (
          <SafeImage
            src={event.Game.image_url}
            alt={event.Game?.name}
            className="max-sm:hidden w-12 h-12 md:w-14 md:h-14 object-cover rounded-sm shrink-0"
          />
        )}
      </div>
    </div>
  );
});
