'use client';
import { forwardRef, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import {
  getSubtitleStyle,
  getTextStyle,
  isDarkBackground,
  resolveGroupBackgroundColor,
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
export default function CalendarListView({
  events,
  onEventClick,
  timezone: timezoneProp,
  loading = false,
  variant = 'full',
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

  /* Req 12, sheet arm only: the SAME window (`visiblePast`) grouped in DESCENDING date order.
     `visiblePast` is memoized and shared with the desktop arms, so this reverses a COPY and
     never mutates it. `groupByDate` preserves insertion order, so reversing the flat list
     yields both descending GROUPS and descending rows inside each group — which is what
     "most recent first" means once a day holds more than one event. */
  const sheetPastGroups = useMemo(
    () => (isSheet ? groupByDate([...visiblePast].reverse()) : []),
    [isSheet, visiblePast, timezone] // eslint-disable-line react-hooks/exhaustive-deps
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
          <h3 className="text-lg font-semibold text-content-primary">Upcoming events</h3>
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
        <h3
          id={isSheet ? upcomingHeadingId : undefined}
          className="text-lg font-semibold text-content-primary"
        >
          Upcoming events
        </h3>
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
              walkthrough finding. It is a decision, not a cleanup. */}
          {isSheet ? (
            <>
              {/* Section 1 — upcoming. Labelled by the `<h3>` above rather than by a heading of
                  its own; `futureGroups` is already soonest-first and includes TODAY's events
                  (the split is `k >= todayKey`). */}
              <section aria-labelledby={upcomingHeadingId} className="space-y-6">
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

                {/* Section-scoped, NOT the shared "No events" line: with past events collapsed
                    below, "No events" would be false whenever the group has history. */}
                {futureGroups.length === 0 && (
                  <div className="flex items-center justify-center pt-4">
                    <p className="text-content-secondary text-sm">No upcoming events</p>
                  </div>
                )}
              </section>

              {/* Section 2 — the past disclosure. Renders only when there IS history. */}
              {pastEvents.length > 0 && (
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
                      it is telling the user how much there is, not how much is mounted. */}
                  <Button
                    variant="ghost"
                    onClick={() => setPastExpanded((v) => !v)}
                    aria-expanded={pastExpanded}
                    aria-controls={pastPanelId}
                    className="w-full min-h-11"
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span>Past events ({pastEvents.length})</span>
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
                  <p className="text-content-secondary text-sm">No events</p>
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
function DateGroup({ group, formatDayHeader, timezone, onEventClick, isSheet = false }) {
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
            isSheet={isSheet}
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
const EventRow = forwardRef(function EventRow({ event, timezone, onClick, isSheet = false }, ref) {
  // null when the group has no colour of its own (D-28).
  const groupBgColor = resolveGroupBackgroundColor(event.Group?.background_color);
  const groupBgImage = event.Group?.background_image_url;
  const groupProfilePic = event.Group?.profile_picture_url;

  const hasBgImage = !!groupBgImage;
  // No image and no group colour: the row sits on the app's themed surface, so
  // the SHARED fallback resolution owns it. This row's bespoke contrast maths
  // below is computed against a coloured ground and produces dark-on-dark here.
  const isThemed = !hasBgImage && !groupBgColor;
  const isDark = !hasBgImage && !isThemed && isDarkBackground(groupBgColor);

  const titleStyle = isThemed
    ? getTextStyle(false, null)
    : {
        // isDark already implies !hasBgImage, so the image case falls through
        // to the dark pole: the row washes the image white at 0.85 below.
        color: isDark ? TEXT_ON_DARK : TEXT_ON_LIGHT,
        textShadow: hasBgImage
          ? '1px 1px 2px rgba(255, 255, 255, 0.9)'
          : isDark
            ? '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)'
            : '1px 1px 2px rgba(255, 255, 255, 0.9)',
        WebkitTextStroke: isDark ? '0.5px rgba(0, 0, 0, 0.9)' : 'none',
      };
  const subtitleStyle = isThemed
    ? getSubtitleStyle(false, null)
    : {
        color: hasBgImage
          ? SUBTEXT_ON_LIGHT
          : isDark
            ? 'rgba(255,255,255,0.9)'
            : SUBTEXT_MUTED_ON_LIGHT,
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
      className="p-3 sm:p-4 border border-line rounded-lg transition-all hover:shadow-md cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 bg-surface-card"
      style={{
        ...(groupBgColor && { backgroundColor: groupBgColor }),
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
            <h5
              className={
                isSheet
                  ? 'font-semibold text-base min-w-0 line-clamp-2'
                  : 'font-semibold text-base truncate'
              }
              style={titleStyle}
            >
              {eventTitle}
            </h5>
            <span className="text-sm" style={subtitleStyle}>
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
              className={
                isSheet
                  ? 'block text-base line-clamp-2 mt-0.5'
                  : 'hidden sm:block text-sm truncate mt-0.5'
              }
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
            className="hidden sm:block w-12 h-12 md:w-14 md:h-14 object-cover rounded-sm shrink-0"
          />
        )}
      </div>
    </div>
  );
});
