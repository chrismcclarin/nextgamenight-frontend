'use client';

// EventScheduler — the create-event time picker, rebuilt onto the shared WeekGrid engine
// (Phase 88.1 plan 09; SPEC Req 2 / Req 3 / Req 4 / Req 6).
//
// This replaces a calendar-library host that lived here from Phase 66 to Phase 88. Week view and
// day view are now literally the same code path parameterized by `days` (7 vs 1) — that is SPEC
// Req 2, and it is why there is no second component for the day arm.
//
// WHAT IS DELIBERATELY NOT HERE (so a future reader does not read absence as an oversight):
//   - Removing the calendar dependency from package.json is plan 88.1-16 (SPEC sequencing:
//     removal only AFTER parity is verified).
//   - The today COLUMN BODY carries no fill. That is a recorded narrowing with an alternative,
//     not an omission — see the DECISION marker on `renderDayHeader`.
//
// PLAN 88.1-11 ADDED: the drag RANGE machine (`usePaintGesture` in `'range'` mode) and the live
// selection rectangle it draws into WeekGrid's `overlay` seam, plus the gesture-accurate prompt
// copy fork. That closes the one capability the calendar library supplied for free.
//
// PLAN 88.1-12 ADDED: the phone geometry fork — below `md` the seven-column grid is replaced by
// `SchedulerWeekStrip` (day-granularity week scan) above a full-width single-day column, and the
// week/day toggle does not render. See the DECISION marker on `effectiveView` below.
//
// PLAN 88.1-13 ADDED: the today treatment (SPEC Req 8) as a paired ternary on the desktop day
// header, plus a TEMPORARY tint-strength A/B.
//
// PLAN 88.1-15 RESOLVED THAT A/B AND DELETED THE SCAFFOLDING. The owner walked both arms live at
// 375px on 2026-08-24 and picked ARM B ("I like B better") for BOTH themes; the strength now ships
// as a token value scoped to this component's subtree — see the DECISION marker on
// `TODAY_TINT_SCOPE` below. The A/B's deletion token now greps to 0 across `src/` — this sentence
// is worded to KEEP it at 0, the same discipline plan 88.1-12/13 used on `SchedulerWeekStrip`.
// Re-introducing a runtime arm switch would re-open a closed decision.

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  addDays,
  differenceInMinutes,
  format,
  isSameDay,
  isSameWeek,
  isToday,
  setHours,
  setMinutes,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { calendarWashColor, CALENDAR_WASH_RAMP } from '../../lib/availabilityColor';
import { WeekGrid, type WeekGridReadData } from './heatmap/WeekGrid';
import { maxAvailabilityPerDay, peakHourForDay } from './heatmap/dayAggregate';
import SchedulerWeekStrip, { stripTabId } from './SchedulerWeekStrip';
import {
  usePaintGesture,
  pointResolver,
  type GestureBounds,
  type EdgeScrollTargets,
} from './heatmap/usePaintGesture';

// ---------------------------------------------------------------------------
// Grid geometry — 30-minute slots over 10:00-23:59, i.e. 28 rows. Carried verbatim from the
// outgoing host's `min`/`max`/`step` (10:00 AM -> 11:59 PM at step 30).
// ---------------------------------------------------------------------------
const START_HOUR = 10;
const SLOT_MINUTES = 30;
const SLOT_ROWS = 28;
const GRID_MAX_HEIGHT = '600px'; // parity with the outgoing h-[600px] container

/**
 * The phone day column's height budget (UI-SPEC "Measured geometry budget", read from source):
 * 600px of modal (`Modal.tsx:186` `max-h-[90vh]` at 667px tall) − ~61px header − 24px
 * `Modal.Body p-3` − ~150px of mode toggle, legend and selected-time panel ≈ 365px for the strip
 * plus the column; the strip takes 56px (`h-14`) and 4px of separation, leaving ~305px.
 *
 * That is about SIX of the 28 30-minute rows, which is precisely why WeekGrid's scroll-container
 * seam is mandatory here rather than optional, and why `scrollToTime` must land on peak
 * availability — the user opens onto six rows and they had better be the right six.
 *
 * The three inputs above are fixed by prior decisions (`Modal`'s `max-h-[90vh]`, its phone gutter
 * `w-[calc(100%-1.5rem)]`, and `Modal.Body`'s `p-3`). They are inputs to this number, NOT
 * variables — overriding any of them to buy height here re-opens DEF-88-17-01 / 88-32 ruling 6.
 */
const PHONE_GRID_MAX_HEIGHT = '305px';

export interface HeatmapMember {
  user_id?: string;
  username: string;
}

export interface HeatmapSlot {
  date: string;
  hour: number;
  availableCount?: number;
  availableMembers?: HeatmapMember[];
}

export interface HeatmapConflict {
  date: string;
  hour: number;
  user_id: string;
  username: string;
}

export interface EventSchedulerHeatmapData {
  slots?: HeatmapSlot[];
  totalMembers?: number;
  totalGroupMembers?: number;
  membersWithoutDataCount?: number;
  gcalConflicts?: HeatmapConflict[];
  weekStart?: string;
}

/*
 * DECISION Phase 88.1-09 (AMENDED premise, SPEC Req 3): the prop surface NARROWS — `minTime`,
 * `maxTime`, `step` and `events` are GONE, chosen OVER carrying four accepted-but-never-passed
 * props through the rebuild.
 *
 * VERIFIED, not assumed: the only live call site (`createEvent.js:966-1002`) passes exactly
 * `onWeekChange`, `onTimeSelected`, `initialDate`, `selectedSlot`, `heatmapData`, `defaultView`
 * and `scrollToTime`. `grep -rn "<EventScheduler"` finds no other producer.
 *
 * The `events` removal is a PREMISE CORRECTION TO SPEC Req 3, which lists a "busy-event overlay"
 * as a parity surface. Research found that surface has no producer: `events` defaulted to `[]`
 * and the busy branch of the outgoing `eventPropGetter` could never be reached, so the overlay
 * never rendered for any user. Building continuous-block busy layout for it would have been new
 * work wearing parity's clothes. The SELECTED-slot half of that same code path is NOT dead and
 * IS carried — see the selection block in `getCell` below.
 *
 * WHAT RE-OPENS IT: a real producer of external busy blocks (a personal-calendar overlay, say).
 * That is a feature with a design, not a restoration.
 */
export interface EventSchedulerProps {
  /** Commit a chosen range. Phase 66-01: the parent owns the canonical fields. */
  onTimeSelected?: (start: Date, end: Date) => void;
  /** Seeds the displayed week/day AND re-anchors it post-mount. See the hybrid contract below. */
  initialDate?: Date | null;
  /** Group availability for the displayed week (UTC wire). */
  heatmapData?: EventSchedulerHeatmapData | null;
  /** CAL-05: which arm to OPEN in. Seeds `currentView`; the user can toggle after mount. */
  defaultView?: 'week' | 'day';
  /** Phase 66-01: controlled highlight, projected from parent state. */
  selectedSlot?: { start: Date; end: Date } | null;
  /** Phase 66-03 CREVT-06: parent-derived peak-availability time. Date portion ignored. */
  scrollToTime?: Date | null;
  /** Bubbles navigation so the parent's heatmap fetch follows the user (SPEC Req 4). */
  onWeekChange?: (date: Date) => void;
}

/** Wall-clock start of the slot at (row, col). setHours/setMinutes, so DST days stay honest. */
function slotStartFor(day: Date, row: number): Date {
  return setMinutes(
    setHours(day, START_HOUR + Math.floor(row / 2)),
    (row % 2) * SLOT_MINUTES
  );
}

/**
 * WeekGrid identifies a cell by the `data-coord="row:col"` attribute on its cell wrapper
 * (`WeekGrid.tsx:474`). The gesture machine resolves targets to that raw string and hands it
 * straight back, so this is the ONE place the format is decoded. A malformed value resolves to
 * null and every caller treats that as "not a cell" — never a throw.
 */
function parseCoord(coord: string): { row: number; col: number } | null {
  const [row, col] = coord.split(':').map(Number);
  return Number.isInteger(row) && Number.isInteger(col) ? { row, col } : null;
}

/**
 * The breakpoint the prompt copy (88.1-11) AND the geometry fork (88.1-12) branch on — Tailwind's
 * `md`, so "md and below" is `max-width: 767px`. Same query and same shape as
 * `gameDetail/page.js:2176`.
 *
 * A VIEWPORT breakpoint, not a container query, and deliberately so: `md` is this codebase's
 * phone/desktop line and every sibling on these surfaces switches on it (`UserHomePage.js`,
 * `FeedbackButton.js`, `CalendarListView.js`). A container query would be the repo's first and
 * would need its own decision, not a drive-by adoption inside a rebuild.
 */
const PHONE_MEDIA_QUERY = '(max-width: 767px)';

/** Compact gutter label — hours only, sized for the 24px gutter (87.8-13 F-2). */
const SLOT_LABELS: string[] = Array.from({ length: SLOT_ROWS }, (_, row) => {
  if (row % 2 !== 0) return '';
  const t = slotStartFor(new Date(2000, 0, 1), row);
  return `${format(t, 'h')}${format(t, 'a').charAt(0).toLowerCase()}`;
});

function formatDuration(start: Date, end: Date): string {
  const minutes = differenceInMinutes(end, start);
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) {
    return `${mins} min`;
  } else if (mins === 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  } else {
    return `${hours}h ${mins}m`;
  }
}

const NAV_BUTTON_CLASS =
  'inline-flex min-h-11 items-center justify-center rounded-btn border border-line px-3 ' +
  'text-sm text-content-secondary hover:text-content-primary hover:bg-surface-card-hover ' +
  'transition-colors duration-200 ease-out ' +
  'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';

/* ============================================================================================
   THE TODAY TINT — SPEC Req 8, RESOLVED. Owner pick, live A/B at 375px, 2026-08-24: ARM B, both
   themes ("I like B better", recorded verbatim in `88.1-CONTEXT.md` under "Walkthrough additions").

   DECISION Phase 88.1 (plan 15, Req 8): the picked strength ships as a TOKEN VALUE re-pointed for
   this component's SUBTREE — `--color-bg-accent-subtle` resolves to `--color-bg-today-tint`
   (globals.css, light `amber-200` / dark `#513902`) for everything inside the scheduler root, and
   for nothing outside it. Chosen OVER three alternatives, each rejected for a different reason:
     - BUMPING the global `--color-bg-accent-subtle` in `globals.css`. Rejected on a MEASURED
       census: that token has ~13 other consumers (five invite/restore pages, `BallotSection`,
       `PendingMemberBanner`, `ManageMembers`, `EmptyState`, plus the MergedHeatmap pair — since
       DELETED by plan 88.1-16). The owner judged ONE surface; a global bump repaints nine he
       never saw. The deletion only LOWERS that count; it does not re-open this alternative.
     - BRANCHING THE CLASS STRINGS (a `bg-surface-today-tint` utility on the today arm of each
       ternary). Rejected: `DECISION Phase 88-27 D-32` is literal — "token VALUE only, never the
       ternary shape" — and the paired-ternary shape is what `tintTreatment.test.ts` and four
       `EventScheduler.test.tsx` pins are written against. Moving it is a decision, not a tidy-up.
     - KEEPING THE `next-themes` READ the A/B used to pick a per-theme literal in JS. Rejected: the
       theme fork now lives in the CSS cascade where it belongs (the token's own `.dark`
       declaration), so this scope is a static object with no hook, no hydration fork, and no
       theme-flash window. That is also why the `next-themes` import is gone from this file.

   THE OVERRIDDEN PROPERTY IS `--color-bg-accent-subtle`, AND OVERRIDING THE `surface-*` NAME
   INSTEAD IS INERT. Carried from plan 88.1-13's MEASUREMENT of a real `next build` of this app, not
   from reading `globals.css`: the source declares the `@theme` key as
   `--color-surface-accent-subtle: var(--color-bg-accent-subtle)` (`globals.css:324`), which reads
   as though either name would work — but Tailwind v4 RESOLVES that one-level alias when it emits
   the utility, and the shipped rule is literally
       .bg-surface-accent-subtle{background-color:var(--color-bg-accent-subtle)}
   so a descendant override of the `surface-*` name is never consulted by anything. Re-pointing
   this at the `surface-*` name would silently un-ship the owner's pick with nothing going red.

   THE SCOPE IS THE WHOLE SCHEDULER SUBTREE, WHICH IS A TRADE, NOT AN ACCIDENT: it is what lets the
   desktop day header (`renderDayHeader`) and the phone strip cell (`SchedulerWeekStrip.tsx:178`)
   share one declaration, and both are today sites. The cost is that ANY FUTURE
   `bg-surface-accent-subtle` ADDED INSIDE THIS COMPONENT WOULD ALSO GET THE STRONGER TINT — today
   there are exactly two, both today sites (censused 2026-08-24). If a non-today accent-subtle
   surface is ever added here, narrow this scope rather than deleting it.

   CONTRAST, recorded so it is chosen with rather than around: the day-number `text-accent` over the
   light arm measures 1.72:1 (it was 1.93:1 at arm A), against the 4.5:1 AA floor — BOTH arms fail,
   and the owner picked the more visible of two failing values with that stated. Phase 88.3 owns the
   ~15-site light `text-accent` census (`.planning/deferred/phase-88.3.md:63-82`, coordination
   recorded by plan 88.1-06). DARK passes either way: 5.05:1 at arm B.
   ============================================================================================ */
const TODAY_TINT_SCOPE = {
  '--color-bg-accent-subtle': 'var(--color-bg-today-tint)',
} as React.CSSProperties;

export default function EventScheduler({
  onTimeSelected,
  initialDate,
  heatmapData = null,
  // CAL-05: initial visual view ('week' | 'day'). Day-tap entry passes 'day' so the picker opens
  // focused on the tapped day. Honoured as a PROP contract, not for one caller — there are two
  // producers (`groupHomePage/page.js:551` and `gameDetail/page.js:2903`, the latter guarded by
  // DECISION Phase 65-03 EVT-05). Default 'week' keeps the header-button entry path unchanged.
  defaultView = 'week',
  // Phase 66-01: controlled selected slot. Parent (createEvent.js) owns the canonical date/time
  // state via newEvent.start_date + duration_minutes and derives this prop with a useMemo.
  // Round-trips visual <-> manual are preserved because both modes read/write the same state.
  // THERE IS NO LOCAL SELECTION STATE IN THIS COMPONENT, and there must not be one.
  selectedSlot = null,
  scrollToTime = null,
  onWeekChange,
}: EventSchedulerProps) {
  // ---------------------------------------------------------------------------
  // Displayed-date ownership. INTERNAL state seeded from `initialDate`, with exactly TWO writers
  // past the seed — carried verbatim from the outgoing component because both halves are
  // load-bearing and neither is obvious:
  //
  //   (a) NAV writes it immediately BEFORE bubbling `onWeekChange`. The prefill / edit-event
  //       paths pin the parent's `initialDate` to the prefill date and never follow navigation
  //       (`createEvent.js:806-825`), so a FULLY CONTROLLED reading of `initialDate` would freeze
  //       week and day nav dead on those paths.
  //   (b) A post-mount effect re-syncs whenever `initialDate` CHANGES — now ACROSS WEEKS ONLY,
  //       see the marker on the effect below. That is the Phase 71.2 poll-CTA anchor: on the
  //       `promptId` journey the poll's own `weekStart` only arrives after the fetch resolves,
  //       so a mount-only seed opens on the wrong week and shows no tiles. It is also the nav
  //       blank-grid fix. BOTH of those reasons are CROSS-week by construction — the poll
  //       anchor arrives with the poll's own `weekStart` (a different week, or the re-sync is a
  //       no-op anyway), and the blank-grid fix exists precisely because the grid is showing a
  //       week the data is not for. A SAME-week re-anchor has no consumer at all: it is the
  //       CR-01 defect. `createEvent.js` re-emits the FETCHED WEEK'S MONDAY as a fresh `Date`
  //       after every heatmap fetch (`:359` -> `:840`), and in the day arm — the only arm below
  //       `md` — that moved the displayed day to Monday on every non-Monday.
  //
  // `initialDate` is therefore a HYBRID contract: neither a mount-only seed nor a controlled
  // prop. Both readings are pinned (EventScheduler.test.tsx / createEvent.integration.test.tsx).
  // The VIEW TOGGLE is not a third writer — toggling week<->day never moves the date.
  // ---------------------------------------------------------------------------
  const [currentDate, setCurrentDate] = useState<Date>(initialDate || new Date());
  const [currentView, setCurrentView] = useState<'week' | 'day'>(
    defaultView === 'day' ? 'day' : 'week'
  );

  /* DECISION Phase 88.1-20 (CR-01, 88.1-REVIEW.md): writer (b) ignores exactly one class of
     incoming value — a WEEK ANCHOR for the week ALREADY DISPLAYED, i.e. the Monday of the week
     `currentDate` is in. Everything else still re-anchors, including a same-week DIFFERENT DAY.

     WHY THAT SHAPE AND NOT PLAIN `isSameWeek`: a plain same-week suppression was tried first and
     turned two Req-13 pins red ("starts at the TOP on a day with no availability" and
     "RE-DERIVES the landing when the displayed day changes", `EventScheduler.test.tsx`), both of
     which move the displayed day WITHIN one week through `initialDate` and expect the day-peak
     landing to follow. A same-week different-day hand-over is a genuine day intent; the week's
     own Monday is not, because the only producer of that value is the parent's FETCH ANCHOR
     (`createEvent.js:359` `setHeatmapWeekStart(effectiveMonday)` -> `:840` the fallthrough),
     re-emitted as a fresh `Date` after every heatmap fetch. In the day arm — the only arm below
     `md` — taking it moved the displayed day to Monday on every non-Monday. That is CR-01.

     Chosen OVER two rejected alternatives:
       (i) stabilising `heatmapWeekStart`'s identity in `createEvent.js` (rejected: it makes the
           fix depend on ONE parent memo staying stable forever, and any OTHER parent handing
           over a week anchor re-opens the bug; the guard belongs to the consumer's contract,
           which is where the contract is documented — right above this line), and
      (ii) making `initialDate` a mount-only seed (rejected: the comment directly above says that
           breaks the Phase 71.2 poll CTA, and it is pinned at two layers).

     This closes the RE-SYNC half of CR-01 only. The SEED half — the scheduler mounting when the
     heatmap fetch has already resolved, so `initialDate` is the anchor before this effect ever
     runs — cannot be closed here: at mount a Monday from the fetch and a Monday from
     `prefillDate` are indistinguishable to this component, and defaulting to today would break
     "tap Monday -> create event on Monday". It is closed at the parent, where the two are
     distinguishable — see the matching marker at `createEvent.js`'s `calendarInitialDate`.
     BOTH halves are reachable in production: `createEvent.js:902` gates the whole form on the
     GROUP-MEMBERS fetch while the heatmap effect at `:325` runs independently, so which of the
     two paths you get is a race between two network calls.

     The boundary is MONDAY deliberately (`weekStartsOn: 1`), matching `heatmapWeekStart`'s own
     snap (`createEvent.js:352`), `resolveWeekNav` and `weekDates` below — a different boundary
     here would suppress re-anchors the fetch considers cross-week and vice versa.
     The FUNCTIONAL form is load-bearing: adding `currentDate` to the deps would re-run this
     effect on every navigation and defeat the guard. */
  useEffect(() => {
    if (initialDate) {
      setCurrentDate((prev) => {
        const displayedMonday = startOfWeek(prev, { weekStartsOn: 1 });
        const isAnchorForDisplayedWeek =
          isSameWeek(initialDate, prev, { weekStartsOn: 1 }) &&
          isSameDay(initialDate, displayedMonday);
        return isAnchorForDisplayedWeek ? prev : initialDate;
      });
    }
  }, [initialDate]);

  /* DECISION Phase 88.1-11: the prompt's breakpoint fork is a matchMedia STATE fork, chosen OVER
     rendering both strings and hiding one with responsive utility classes.

     WHY THE CSS FORK LOSES: it puts BOTH instructions in the DOM at once, and jsdom applies no
     stylesheet — so no vitest pin could tell the two arms apart, and the plan's requirement to
     assert the RENDERED STRING (P7 forbids reading layout) would be unsatisfiable. It also ships
     two contradictory instructions to any consumer that reads the DOM rather than the cascade.

     The shape is the repo's own: `useState(false)` + a mount effect, exactly as
     `createEvent.js:47-55` detects `(hover: none)` (the second precedent,
     `MergedHeatmapGrid.js:85-96`, was DELETED by plan 88.1-16 — the idiom stands, the
     citation is archival). Starting
     FALSE is deliberate — this is an SSR'd client component, so the initial render must match the
     server's, and the desktop string is the safe pre-measurement state. */
  const [isPhoneViewport, setIsPhoneViewport] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const mq = window.matchMedia(PHONE_MEDIA_QUERY);
    setIsPhoneViewport(mq.matches);
    const handler = (event: MediaQueryListEvent) => setIsPhoneViewport(event.matches);
    if (mq.addEventListener) {
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
    mq.addListener(handler);
    return () => mq.removeListener(handler);
  }, []);

  // Phase 72-02 UAT: identify the viewing user so we can render a self-conflict line in the
  // per-slot tooltip. 87.4 PR-2 (D-02): UUID-only compare against selfUuid.
  const { selfUuid } = useSelfIdentity();

  // Build heatmap lookup: "localDate_localHour" -> slot.
  // The wire is UTC; the grid is LOCAL. Carried verbatim — `createEvent.js:88-95` mirrors this
  // exact keying for `peakScrollTime`, so the two must not drift.
  const heatmapLookup = useMemo(() => {
    const map = new Map<string, HeatmapSlot>();
    if (!heatmapData?.slots) return map;
    for (const slot of heatmapData.slots) {
      const utcDate = new Date(`${slot.date}T${String(slot.hour).padStart(2, '0')}:00:00Z`);
      const localDateStr = format(utcDate, 'yyyy-MM-dd');
      const localHour = utcDate.getHours();
      map.set(`${localDateStr}_${localHour}`, slot);
    }
    return map;
  }, [heatmapData]);

  // Build conflict lookup: "localDate_localHour" -> [{ user_id, username }]. Same keying.
  const conflictLookup = useMemo(() => {
    const map = new Map<string, Array<{ user_id: string; username: string }>>();
    if (!heatmapData?.gcalConflicts) return map;
    for (const c of heatmapData.gcalConflicts) {
      const utcDate = new Date(`${c.date}T${String(c.hour).padStart(2, '0')}:00:00Z`);
      const localDateStr = format(utcDate, 'yyyy-MM-dd');
      const localHour = utcDate.getHours();
      const key = `${localDateStr}_${localHour}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push({ user_id: c.user_id, username: c.username });
    }
    return map;
  }, [heatmapData]);

  const totalMembers = heatmapData?.totalMembers || 0;
  const membersWithoutDataCount = heatmapData?.membersWithoutDataCount || 0;
  const totalGroupMembers = heatmapData?.totalGroupMembers || 0;

  /* DECISION Phase 88.1-12 (CONTEXT D-03 / D-04): below `md` the scheduler renders a week STRIP
     over a full-width SINGLE-DAY column, and `currentView` stops being consulted — there is no
     week/day toggle at phone because strip-plus-day IS the phone rendering. At `md` and above
     nothing changes: the seven-column fit-to-width grid and its toggle are exactly plan 88.1-11's.

     THE FORK IS matchMedia STATE, NOT `md:hidden` CLASSES — the same choice, for the same reasons,
     that plan 88.1-11 recorded on `isPhoneViewport` below, and it weighs far more here than it did
     for a sentence of copy. A CSS fork puts BOTH renderings in the DOM: two grids (~196 cells plus
     28), two `role="grid"`s, a `tablist` that is visually absent on desktop but still announced,
     and a week/day toggle that Req 7 says must not exist at phone yet would be present to every
     consumer reading the DOM rather than the cascade. It is also unassertable — jsdom applies no
     stylesheet, so no vitest pin could tell the two arms apart, and the arm pins this plan requires
     ("no toggle at phone", "exactly one day column") would all be vacuous.
     KNOWN COST, disclosed rather than hidden: `isPhoneViewport` starts false and is corrected in a
     mount effect, so the phone arm can paint one desktop frame first. Plan 88.1-11's marker fixed
     that initial value deliberately (SSR parity), so it is left alone here rather than quietly
     re-opened; see this plan's SUMMARY.

     `currentView` is still real state and is still the desktop toggle's — it is deliberately NOT
     cleared when the viewport narrows, so rotating a phone to landscape past `md` returns you to
     the arm you were in rather than resetting you to week.
     `effectiveView` is the ONE place the two inputs combine. Reading `currentView` directly
     anywhere below this line is the bug this variable exists to prevent. */
  const effectiveView: 'week' | 'day' = isPhoneViewport ? 'day' : currentView;

  // ---------------------------------------------------------------------------
  // Columns. Monday week start is kept — the outgoing localizer was never its only carrier
  // (`createEvent.js:337,975` and the extracted `resolveWeekNav` both use weekStartsOn: 1).
  //
  // The week is computed unconditionally now: the day arm needs it too, because the phone strip
  // shows the week CONTAINING the displayed day. Both arrays are separately memoized and selected
  // by a ternary so `columnDates` keeps a stable identity — `getCell`'s per-coordinate cache is
  // keyed on it and a fresh array every render would defeat WeekGrid's ~196-cell memo.
  // ---------------------------------------------------------------------------
  const days = effectiveView === 'day' ? 1 : 7;
  const weekDates = useMemo(() => {
    const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [currentDate]);
  const dayDates = useMemo(() => [startOfDay(currentDate)], [currentDate]);
  const columnDates = effectiveView === 'day' ? dayDates : weekDates;

  // Which strip cell is the displayed day. Monday-first, so Sunday is index 6.
  const selectedDayIndex = useMemo(() => {
    const target = startOfDay(currentDate).getTime();
    const found = weekDates.findIndex((d) => d.getTime() === target);
    return found >= 0 ? found : 0;
  }, [weekDates, currentDate]);

  // Per-day aggregate for the strip: the MAX over each day's slots (see `dayAggregate.ts` for why
  // MAX and not a mean). Keyed on the same `${localDate}_${localHour}` map the grid cells read, so
  // the strip and the column can never disagree about the same day.
  const stripAggregates = useMemo(
    () =>
      maxAvailabilityPerDay(
        heatmapLookup,
        weekDates.map((d) => format(d, 'yyyy-MM-dd'))
      ),
    [heatmapLookup, weekDates]
  );

  // SPEC Req 13: the DISPLAYED day's own peak hour, for the day arm's landing (see the
  // scrollToTime effect below). Derived HERE, beside `stripAggregates`, and from the SAME
  // `heatmapLookup` on purpose — the strip tint and the column landing are then two readings of
  // one map and can never disagree about a day. `null` (no availability, or week arm) means the
  // effect does not scroll.
  const dayPeakHour = useMemo(
    () =>
      effectiveView === 'day'
        ? peakHourForDay(heatmapLookup, format(dayDates[0], 'yyyy-MM-dd'))
        : null,
    [effectiveView, heatmapLookup, dayDates]
  );

  // ---------------------------------------------------------------------------
  // Navigation. The per-arm STEP SIZE is the parity detail: the outgoing host inherited
  // `views={['week','day']}`, so its Next/Back moved a week in week view and a day in day view.
  // BOTH arms bubble through the same `onWeekChange(date)` regardless of granularity — the
  // parent's `resolveWeekNav` owns the same-week skip and the -3/+12 clamp, and the fetch stays
  // at `createEvent.js:329-353`. Do not re-implement either here.
  // ---------------------------------------------------------------------------
  const navigateTo = useCallback(
    (date: Date) => {
      setCurrentDate(date);
      if (onWeekChange) onWeekChange(date);
    },
    [onWeekChange]
  );

  // Step granularity follows the DISPLAYED arm, so at phone Back/Next move one day — the strip
  // then re-renders on the week containing it, which is how you cross a week boundary there. Both
  // arms still bubble through `onWeekChange`, so the parent's same-week skip does the de-duping.
  const stepDays = effectiveView === 'day' ? 1 : 7;
  const goBack = useCallback(
    () => navigateTo(addDays(currentDate, -stepDays)),
    [navigateTo, currentDate, stepDays]
  );
  const goNext = useCallback(
    () => navigateTo(addDays(currentDate, stepDays)),
    [navigateTo, currentDate, stepDays]
  );
  /* DECISION Phase 88.1-09 (owner ruling 2026-08-22): the Today control is CARRIED, chosen OVER
     dropping it as chrome the rebuild does not need. The outgoing toolbar rendered one for free
     (no toolbar override existed, so it was in shipped UI), and the rebuild's promise is parity
     of NAV AFFORDANCES, not just of the grid. It routes through `navigateTo` exactly like Next
     and Back, so the parent sees an ordinary navigation and `resolveWeekNav` skips it when today
     is already inside the displayed week. Removing it is a decision, not a cleanup. */
  const goToday = useCallback(() => navigateTo(new Date()), [navigateTo]);

  // A strip tap is NAVIGATION at day granularity, so it routes through `navigateTo` rather than
  // becoming a third writer of `currentDate` (the two-writer rule at the top of this component is
  // load-bearing). It always lands inside the displayed week, so the parent's `resolveWeekNav`
  // recognises it as a same-week move and skips the refetch.
  const handleStripSelect = useCallback(
    (index: number) => {
      const day = weekDates[index];
      if (day) navigateTo(day);
    },
    [weekDates, navigateTo]
  );

  // ---------------------------------------------------------------------------
  // Commit. ONE derivation serves the keyboard select, a tap and a drag range: the earlier row
  // opens the range and the later row closes it, so a BACKWARDS drag normalizes instead of
  // emitting a negative duration (threat T-88.1-29). A single-slot commit is just the degenerate
  // case where both rows are the same.
  //
  // `commitRef` is a latest-prop mirror so the gesture callbacks and the keyboard seam below can
  // be created ONCE. WeekGrid memoizes ~196 cells and hands them stable callbacks; a fresh
  // handler identity on every week change would be a re-render the engine explicitly guards.
  // ---------------------------------------------------------------------------
  const commitRows = useCallback(
    (rowA: number, rowB: number, col: number) => {
      const day = columnDates[col];
      if (!day) return;
      const first = Math.min(rowA, rowB);
      const last = Math.max(rowA, rowB);
      const start = slotStartFor(day, first);
      const end = slotStartFor(day, last + 1);
      if (onTimeSelected) onTimeSelected(start, end);
    },
    [columnDates, onTimeSelected]
  );
  const commitRef = useRef(commitRows);
  commitRef.current = commitRows;

  // SPEC Req 6: keyboard commit runs through `useHeatmapCell`'s EXISTING Enter/Space branch,
  // routed by WeekGrid's seam 5. There is no second keyboard handler in this file, and adding
  // one would be the regression that seam exists to prevent.
  const handleCellSelect = useCallback((row: number, col: number) => {
    commitRef.current(row, row, col);
  }, []);

  // ---------------------------------------------------------------------------
  // The opening scroll position. WeekGrid's `scrollContainerRef` is ONE seam with three
  // consumers — this, the rAF edge auto-scroll (88.1-03) and the phone day column (88.1-12).
  // Resolve the row, then read its authored offset; no geometry is fabricated, so in jsdom
  // (where every box is zero) this is an inert no-op rather than a false pass — plan 88.1-18's
  // pins make it observable by stubbing `offsetTop`, which is a test-side mechanism only.
  //
  // TWO ARMS AS OF SPEC Req 13. The WEEK arm is the original Phase 66-03 CREVT-06 parity path
  // and still lands on the parent's week-wide `scrollToTime`. The DAY arm no longer reads
  // `scrollToTime` AT ALL — it derives the displayed day's own peak from `heatmapLookup`.
  //
  /* DECISION Phase 88.1-18 (SPEC Req 13, owner walkthrough 2026-08-24): in day view the landing
     is derived from the DISPLAYED DAY (`dayPeakHour`) and re-derives whenever the day changes,
     CHOSEN OVER continuing to apply the parent's week-wide `scrollToTime`. Rejected because on a
     phone roughly six of 28 rows are visible (see the `PHONE_GRID_MAX_HEIGHT` budget above), so a
     peak belonging to a DIFFERENT day lands the user on empty space — the owner's own diagnosis:
     "a holdover from seeing the whole week's times, when we are only seeing a day."

     AND, for an empty day, CHOSEN OVER falling back to the week peak (owner ruling 2026-08-24):
     no availability means NO SCROLL, so the column sits at the top of the grid (10:00). The
     explicit `scrollTop = 0` is not decoration — without it, navigating from a day WITH a peak to
     a day with none leaves the previous day's offset in place, which is the very thing this
     requirement removes (a scroll position belonging to another day).

     WEEK VIEW IS DELIBERATELY LEFT ON THE PARENT'S VALUE, including its `prefillDate` scoping
     (see the marker above `peakScrollTime` in `createEvent.js`). Re-unifying the two arms is a
     decision, not a cleanup. */
  // ---------------------------------------------------------------------------
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    let minutesFromStart: number;
    if (effectiveView === 'day') {
      if (dayPeakHour === null) {
        container.scrollTop = 0;
        return;
      }
      minutesFromStart = (dayPeakHour - START_HOUR) * 60;
    } else {
      if (!scrollToTime) return;
      minutesFromStart =
        (scrollToTime.getHours() - START_HOUR) * 60 + scrollToTime.getMinutes();
    }

    const row = Math.max(
      0,
      Math.min(SLOT_ROWS - 1, Math.floor(minutesFromStart / SLOT_MINUTES))
    );
    const cell = container.querySelector(`[data-coord="${row}:0"]`) as HTMLElement | null;
    if (!cell) return;
    container.scrollTop = cell.offsetTop;
  }, [scrollToTime, effectiveView, currentDate, dayPeakHour]);

  // ---------------------------------------------------------------------------
  // DRAG RANGE SELECTION (plan 88.1-11, SPEC Req 5 / Req 3).
  //
  // This is the one capability the calendar library supplied for free: its `selectable` +
  // `onSelectSlot` reported a start/end PAIR. WeekGrid has per-cell paint, which is a different
  // gesture, so the pair machine is `usePaintGesture` in `'range'` mode — anchor on pointerdown,
  // extend on movement, commit ONCE on release. Nothing commits mid-drag.
  //
  // DECISION Phase 88.1-11 (AMENDED, C2): the long-press threshold moves 250ms -> 300ms.
  // PREMISE RE-VERIFIED this session, not inherited: the deleted Phase 68-03 MOB-07 machine held
  // 250ms (`EventScheduler.js:214`, recorded in 88.1-09's SUMMARY as it was removed), and it had
  // NO slop cancellation and NO edge auto-scroll. The replacement is the single owner-ruled
  // 87.8-14 model (ruling 2026-08-02, model (a): long-press paints, plain drag scrolls natively,
  // tap commits one slot) at that model's 300ms, chosen OVER re-tuning the shared hook down to
  // the scheduler's old number — one model, one threshold, two consumers. The OWNER RULING IS
  // UNCHANGED; only this surface's conformance to it is new. Re-pointing this at 250ms would
  // fork the two grids' feel again, which is the thing 87.8-14 fixed. Per pitfall P5 no pin
  // asserts either number: gesture TIMING is the Playwright layer's (plan 88.1-14).
  //
  // DECISION Phase 88.1-11 (range shape): a drag commits on the ANCHOR's DAY COLUMN, with only
  // the ROWS normalized — chosen OVER letting a horizontal drag span days. A cross-day pair
  // would reach `createEvent.js:982-1000` as a `duration_minutes` measured in days, which the
  // manual 1-720 minute field it round-trips through cannot express and no backend contract
  // accepts; the grid's own client-side bound is one day's 10:00-23:59 window (threat
  // T-88.1-29). Multi-day event ranges are a feature with a design, not a drag affordance.
  // ---------------------------------------------------------------------------
  const [dragRect, setDragRect] = useState<{
    top: number;
    left: number;
    width: number;
    height: number;
  } | null>(null);

  // The injected resolver (RESEARCH C11). WeekGrid marks cells with `data-coord`;
  // AvailabilityGrid marks its own with a different attribute — injecting the name is precisely
  // why neither consumer had to change and why `e2e/availability-grid-touch.spec.ts` stays
  // untouched (D-02). Built once: the hook keeps every returned handler stable only if what it
  // is given is stable too.
  const resolvePoint = useMemo(() => pointResolver('data-coord'), []);

  /**
   * Measure the live selection rectangle against the POSITIONED GRID BODY.
   *
   * Called from the gesture callbacks (a committed-DOM read in an event handler), never during
   * render and never from a layout effect: `onExtend` only fires when the resolved CELL changes,
   * so this runs a few dozen times per drag rather than once per pointermove, and folding the
   * measurement into the same state update keeps that one render instead of two.
   *
   * Offsets are used rather than client rects on purpose — `offsetTop`/`offsetLeft` are relative
   * to the grid body (WeekGrid's `relative` container is the offsetParent), which is exactly the
   * box the overlay layer is `inset-0` of, so the rectangle travels WITH the scroll instead of
   * sticking to the viewport during edge auto-scroll.
   */
  const measureDragRect = useCallback((anchorCoord: string, currentCoord: string) => {
    const container = scrollContainerRef.current;
    const anchor = parseCoord(anchorCoord);
    const current = parseCoord(currentCoord);
    if (!container || !anchor || !current) return null;
    const first = Math.min(anchor.row, current.row);
    const last = Math.max(anchor.row, current.row);
    const firstEl = container.querySelector<HTMLElement>(`[data-coord="${first}:${anchor.col}"]`);
    const lastEl = container.querySelector<HTMLElement>(`[data-coord="${last}:${anchor.col}"]`);
    if (!firstEl || !lastEl) return null;
    return {
      top: firstEl.offsetTop,
      left: firstEl.offsetLeft,
      width: firstEl.offsetWidth,
      height: lastEl.offsetTop + lastEl.offsetHeight - firstEl.offsetTop,
    };
  }, []);

  const handleExtend = useCallback(
    (anchorCoord: string, currentCoord: string) => {
      setDragRect(measureDragRect(anchorCoord, currentCoord));
    },
    [measureDragRect]
  );

  const handleRangeCommit = useCallback((anchorCoord: string, currentCoord: string) => {
    setDragRect(null);
    const anchor = parseCoord(anchorCoord);
    const current = parseCoord(currentCoord);
    if (!anchor || !current) return;
    commitRef.current(anchor.row, current.row, anchor.col);
  }, []);

  /**
   * Edge auto-scroll targets (RESEARCH C10 / pitfall P4 / threat T-88.1-32).
   *
   * BOTH axes are pointed at the grid's own scroll container, and the edge bands are measured
   * from its rect. The hook's documented VERTICAL DEFAULT is the page — correct for the
   * full-page check-in grid it was extracted from, wrong here: this grid lives inside a Radix
   * dialog whose content is `overflow-hidden` (`Modal.tsx:186`) with the body `overflow-y-auto`
   * (`Modal.tsx:289`), so a page-level scroll is either inert or scrolls the page BEHIND the
   * modal. The symptom of getting this wrong is a paint that works but stops dead at the visible
   * edge — the exact owner-reported symptom 87.8-14 was written to fix, reappearing in a new
   * host. Built once so the hook's handlers stay referentially stable.
   */
  const edgeScroll = useMemo<EdgeScrollTargets>(
    () => ({
      scrollVerticalBy: (dy: number) => {
        const el = scrollContainerRef.current;
        if (el) el.scrollTop += dy;
      },
      scrollHorizontalBy: (dx: number) => {
        const el = scrollContainerRef.current;
        if (el) el.scrollLeft += dx;
      },
      getBounds: (): GestureBounds => {
        const el = scrollContainerRef.current;
        // No container = no edge band anywhere, which stops the rAF loop on its next tick
        // rather than spinning it against a degenerate zero rect.
        if (!el) {
          return {
            top: Number.NEGATIVE_INFINITY,
            left: Number.NEGATIVE_INFINITY,
            bottom: Number.POSITIVE_INFINITY,
            right: Number.POSITIVE_INFINITY,
          };
        }
        const rect = el.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right };
      },
    }),
    []
  );

  const { handlers: gestureHandlers, gestureRef } = usePaintGesture<string>({
    // REQUIRED discriminator, and deliberately so (88.1-03): omitting it would compile to
    // per-cell paint callbacks and silently re-create the P6 defect the range arm prevents.
    mode: 'range',
    resolvePoint,
    onExtend: handleExtend,
    onCommit: handleRangeCommit,
    edgeScroll,
  });

  /**
   * One node, two consumers: `scrollContainerRef` (scrollToTime parity + the edge-scroll
   * targets above) and the hook's `gestureRef`, which installs the CONDITIONAL non-passive
   * touchmove suppressor on the SCROLLING element. Both must point at the same element, so they
   * are merged into one stable callback ref rather than WeekGrid growing a second seam.
   *
   * Suppression is that listener, gated on the painting state — never a static CSS pan-blocker
   * (the property is deliberately not named anywhere in this file so plan 88.1-11's grep gate
   * can prove it is absent). A static blocker is evaluated at gesture start and cannot be
   * conditional, so it kills native scrolling across the whole surface (threat T-88.1-30).
   */
  const setScrollContainer = useCallback(
    (node: HTMLDivElement | null) => {
      scrollContainerRef.current = node;
      gestureRef(node);
    },
    [gestureRef]
  );

  // ---------------------------------------------------------------------------
  // Per-cell read data.
  //
  // DECISION Phase 88.1-11 (memo pressure, the obligation 88.1-09 handed forward IN WRITING):
  // the payloads are CACHED per coordinate for the life of their inputs, chosen OVER returning
  // a fresh object per call as this function did when it was written.
  //
  // WHY IT MATTERS NOW AND DID NOT BEFORE: `tooltipContent`, `style` and `children` are freshly
  // constructed objects/elements, so `ReadCell`'s `React.memo` — a shallow compare — sees three
  // changed props on EVERY cell every time WeekGrid re-renders. Before this plan WeekGrid
  // re-rendered on nav, view toggle, selection and heatmap load; 88.1-09 recorded that as
  // "harmless at this re-render frequency but NOT harmless once a drag re-renders". A drag now
  // re-renders WeekGrid each time the selection rectangle crosses a cell boundary, and an
  // uncached payload turns each of those into ~196 cell re-renders — what
  // `AvailabilityGrid.js:368-373` calls "the smooth/janky boundary on a phone, not a
  // micro-optimization".
  //
  // The cache is created INSIDE the memo, so its lifetime is exactly the inputs' lifetime and
  // there is no second invalidation rule to keep in sync with the dependency array. Returning a
  // fresh object per call again is a decision to re-introduce the drag re-render, not a cleanup.
  // ---------------------------------------------------------------------------
  const getCell = useMemo(() => {
    const cache = new Map<string, WeekGridReadData>();
    const compute = (row: number, col: number): WeekGridReadData => {
      const day = columnDates[col];
      const start = slotStartFor(day, row);
      const end = slotStartFor(day, row + 1);
      const dateStr = format(start, 'yyyy-MM-dd');
      const hour = start.getHours();
      const key = `${dateStr}_${hour}`;

      const slot = heatmapLookup.get(key);
      const conflicts = conflictLookup.get(key) || [];
      const availableCount = slot?.availableCount || 0;
      const hasAvailability = availableCount > 0;

      // ONE predicate shared by both the positive "is this conflict mine" compare and the
      // adjacent negative "other members" filter, so they cannot drift apart.
      const isMe = (id: string | undefined) => id != null && id === selfUuid;
      const userHasConflict = conflicts.some((c) => isMe(c.user_id));
      const otherConflicts = conflicts.filter((c) => !isMe(c.user_id));
      const annotated = hasAvailability || userHasConflict || otherConflicts.length > 0;

      /* DECISION Phase 88-23 DES-02 (carried, re-recorded at its new site): the canonical 5-step
         availability ramp is applied here as the TRANSLUCENT `calendarWashColor` variant, chosen
         OVER the opaque `mergedCellColor` the read grids use — this shading sits BEHIND gridlines
         and the selection block and must not cover them. The full derivation lives on
         `calendarWashColor` in src/lib/availabilityColor.ts. Do not reinline a private ramp here,
         and do not "unify" this onto the opaque one as a cleanup.
         The colour reaches the cell through the D-01 seam as `colorClass={null}` PLUS an inline
         `backgroundColor`, never through style alone: `calendarWashColor` returns `undefined` for
         the empty case by design, and ReadCell's default would then emit an OPAQUE
         `bg-surface-elevated` over the gridlines — and an appended `bg-*` also beats
         `bg-surface-accent-subtle` in the class string, which is a red gate in tintTreatment. */
      const backgroundColor = calendarWashColor(availableCount, totalMembers);

      const names = hasAvailability
        ? (slot?.availableMembers || []).map((m) => m.username).join(', ')
        : '';

      const tooltipContent = annotated ? (
        <div>
          {hasAvailability && (
            <div>
              {availableCount} of {totalMembers} available{names ? ` — ${names}` : ''}
            </div>
          )}
          {userHasConflict && (
            <div className="text-amber-700 mt-1">
              You have a Google Calendar conflict at this time
            </div>
          )}
          {otherConflicts.map((c) => (
            <div key={c.user_id} className="text-amber-700 text-xs mt-1">
              {c.username}: said yes, calendar shows busy
            </div>
          ))}
        </div>
      ) : undefined;

      // Every cell is named for screen readers. The ANNOTATED name is a verbatim parity carry —
      // it is what the harness locates cells by — so the plain-slot name deliberately uses a
      // different shape, keeping "which cells carry availability" answerable by name alone.
      const ariaLabel = annotated
        ? `Availability for ${dateStr} hour ${hour}`
        : `${format(start, 'EEEE, MMMM d')} at ${format(start, 'h:mm a')}`;

      const isSelected =
        !!selectedSlot && start < selectedSlot.end && end > selectedSlot.start;

      return {
        variant: 'merged',
        availableCount,
        totalMembers,
        ariaLabel,
        tooltipContent,
        colorClass: null,
        // `position: relative` is load-bearing, not styling: the count badge and the selection
        // block are absolutely positioned against this cell.
        style: { position: 'relative', ...(backgroundColor ? { backgroundColor } : {}) },
        children:
          isSelected || hasAvailability ? (
            <>
              {isSelected && (
                /* DECISION Phase 88.1-09: the COMMITTED selection is a FILLED block on
                   --color-btn-primary-bg, chosen OVER drawing it border-only "because D-32 says
                   no fill". D-32 (recorded at the overlay site below) governs the IN-PROGRESS
                   DRAG affordance, where a fill would hide the cells being selected. A committed
                   selection is a different state with the opposite need: it is the user's
                   confirmation of the time they chose, and it is exactly what the outgoing
                   `eventPropGetter` rendered for the `selected` pseudo-event. Merging the two
                   treatments is a regression, not compliance. */
                <div
                  aria-hidden="true"
                  data-testid="scheduler-selected-block"
                  className="absolute inset-0 rounded-xs"
                  style={{ backgroundColor: 'var(--color-btn-primary-bg)', zIndex: 0 }}
                />
              )}
              {hasAvailability && (
                // The count badge is the mandatory NON-COLOUR cue, not decoration — a wash-only
                // encoding is unreadable to the ~8% of men with colour-vision deficiency.
                <span
                  style={{
                    position: 'absolute',
                    top: '2px',
                    right: '4px',
                    fontSize: '10px',
                    color: 'var(--color-status-success)',
                    fontWeight: 600,
                    zIndex: 1,
                  }}
                >
                  {availableCount}
                </span>
              )}
            </>
          ) : undefined,
      };
    };
    return (row: number, col: number): WeekGridReadData => {
      const key = `${row}:${col}`;
      let data = cache.get(key);
      if (!data) {
        data = compute(row, col);
        cache.set(key, data);
      }
      return data;
    };
  }, [columnDates, heatmapLookup, conflictLookup, totalMembers, selfUuid, selectedSlot]);

  /* DECISION Phase 88.1-13 (SPEC Req 8; UI-SPEC "Where the today tint lands"). Three choices,
     recorded together because the second and third only exist because of the first.

     (1) THE TREATMENT LANDS ON THE DAY HEADER, NOT THE COLUMN BODY. This is a NAMED NARROWING of
         SPEC Req 8's literal "today-COLUMN tint", chosen OVER filling the day's cells, on three
         grounds:
           - it is the surface the owner ACTUALLY JUDGED. `.planning/deferred/phase-88.1.md:52,57-59`
             records "the today-column HEADER tint" plus a live dark-375px measurement —
             rgb(47,59,80) on the today header against rgb(35,45,62) on the other six. The D3 bar
             ("noticeable at a glance, not merely distinguishable on inspection") was set against a
             header cell;
           - A BODY FILL WOULD CORRUPT THE DATA LAYER. `calendarWashColor` is TRANSLUCENT green and
             paints over each cell's own background; amber under rgba(34,197,94,a) reads olive, and
             nothing may outrank the painted heatmap. The shipped `.rbc-today` this replaces was
             purple — a COOL tint under green — so moving the hue to amber turns that stacking from
             acceptable to muddy. It is not the same change at a new hue;
           - the paired ternary survives INTACT, at full measured strength, on a clean surface.
         THE ALTERNATIVE, if the owner wants column-wide at the 88.1-15 checkpoint: a 2px
         `--color-line-accent` column EDGE RULE, never a fill. That re-opens
         `DECISION Phase 88-27 D-32 bucket B` (`CalendarListView.js:388-395`, which ruled a NEUTRAL
         rule OVER a coloured one), so it is a decision to raise, not a tweak to apply.

     (2) THE TWO TERNARIES ARE PAIRED AND MUTUALLY EXCLUSIVE — surface and day text switch together
         or not at all. The idiom is the §10.3 exemplar's, carried verbatim in shape from
         `MergedHeatmapGrid.js:139,145` — a file plan 88.1-16 has since DELETED, having first
         re-pointed `tintTreatment.test.ts` test 4's third exemplar off it and onto THIS site in
         the same commit. THIS IS NOW THE CANONICAL §10.3 EXEMPLAR; there is no other copy to
         fall back on. COLLAPSING EITHER HALF INTO ONE STATIC CLASS PLUS AN INTERPOLATED
         TINT TURNS THE TINT OFF; it does not simplify. There is no tailwind-merge on this template
         literal, so two same-specificity background rules resolve by STYLESHEET ORDER, and MEASURED
         in a real `next build` of this app `.bg-surface-accent-subtle` is emitted BEFORE
         `.bg-surface-card` — the plain card wins and the tint renders NOTHING.
         The non-today text value moves from plan 88.1-09's inherited secondary to the exemplar's
         explicit primary, so the two branches are a genuine pair rather than "accent or whatever
         the cell happened to inherit".

     (3) THE SURFACE HALF FULL-BLEEDS the header cell via `block -my-2 py-2`, chosen OVER adding a
         `dayHeaderClassName` seam to WeekGrid. WeekGrid owns the header cell and hardcodes
         `bg-surface-card` and `py-2` on it (`WeekGrid.tsx:457`); this seam hands back that cell's
         CONTENT, and `WeekGrid.tsx:93-96` says in its own words that a ReactNode is required here
         BECAUSE "the scheduler's header is a paired today ternary". The negative margin cancels the
         cell's padding so the tint covers the whole header rather than a chip around the label —
         a chip does not clear the D3 bar. A new seam would change a shared engine with other
         consumers to style one of them. Removing the bleed shrinks the treatment: a decision. */
  const renderDayHeader = useCallback(
    (col: number) => {
      const day = columnDates[col];
      const today = isToday(day);
      return (
        <span
          className={`block -my-2 py-2 ${today ? 'bg-surface-accent-subtle' : 'bg-surface-card'}`}
        >
          <span className={today ? 'text-accent' : 'text-content-primary'}>
            {format(day, 'dd EEE')}
          </span>
        </span>
      );
    },
    [columnDates]
  );

  /* DECISION Phase 88-27 (D-32 bucket A) — carried, re-recorded at its new home, and POPULATED
     by plan 88.1-11 exactly as the marker was planted for. The DRAG selection rectangle
     deliberately gets NO FILL, chosen OVER the bucket-A default of a `-subtle` surface token:
     every mechanism D-33 allows is OPAQUE, and an opaque fill would hide the grid cells the drag
     is selecting — the opposite of what a selection rectangle is for. A 2px border carries it
     alone. A translucent selection wash is the one legitimate use of alpha in the whole census
     and is a Phase 88.3 question. Adding a fill is a decision, not a completion.
     This is NOT the committed-selection block — that one IS filled, see the marker in `getCell`
     above. The two states are drawn at two sites so they cannot be merged by accident.
     `pointer-events-none` is load-bearing too: a layer that consumed pointer events would
     swallow the very drag it is drawing. */
  const dragOverlay: React.ReactNode = dragRect ? (
    <div
      aria-hidden="true"
      data-testid="scheduler-drag-rect"
      className="absolute pointer-events-none border-2 border-btn-primary rounded-sm z-10"
      style={{
        top: dragRect.top,
        left: dragRect.left,
        width: dragRect.width,
        height: dragRect.height,
      }}
    />
  ) : null;

  const viewLabel =
    effectiveView === 'day'
      ? format(columnDates[0], 'EEEE, MMMM d, yyyy')
      : `${format(columnDates[0], 'MMM d')} - ${format(columnDates[columnDates.length - 1], 'MMM d, yyyy')}`;

  // Namespaces the strip's per-cell ids so the day column's `aria-labelledby` resolves even if two
  // schedulers ever mount in one document.
  const stripId = useId();

  /* DECISION Phase 88.1-09 (premise correction, VERIFIED): the week/day toggle is a pair of
     PRESSED-state buttons in a labelled group, chosen OVER the shipped `Tabs` primitive that the
     plan named. Two reasons, in order of weight:
       1. Radix `TabsTrigger` renders `role="tab"`, not `button` (probed on this tree, not
          assumed). The Layer-3 pin locates the day arm as
          `getByRole('button', { name: /^day$/i })` (createEvent.integration.test.tsx:111,206) and
          is contractually UNEDITABLE, so Tabs would have forced a harness edit to make the
          implementation pass — the inversion this phase's rules exist to prevent.
       2. Tabs is also the wrong semantic here: `role="tab"` promises a set of tabpanels. There is
          ONE grid, re-parameterized by `days` — that is the whole point of SPEC Req 2. A toggle
          button group with `aria-pressed` says what is actually true.
     Moving this to Tabs is a decision that breaks a pin, not a convergence. */
  const viewToggleButton = (value: 'week' | 'day', label: string) => (
    <button
      type="button"
      onClick={() => setCurrentView(value)}
      aria-pressed={currentView === value}
      className={`${NAV_BUTTON_CLASS} ${
        currentView === value ? 'bg-surface-card-hover text-content-primary' : ''
      }`}
    >
      {label}
    </button>
  );

  return (
    // `TODAY_TINT_SCOPE` is the owner-picked today tint's ENTIRE scope: it re-points one inherited
    // custom property for this subtree, so both today sites (the desktop day header below and
    // `SchedulerWeekStrip`'s today cell) resolve it and nothing outside this component does.
    // Removing this style attribute silently reverts the pick to the pre-88.1 strength — see the
    // DECISION marker on the constant.
    <div className="space-y-4" style={TODAY_TINT_SCOPE}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button type="button" onClick={goBack} className={NAV_BUTTON_CLASS}>
            Back
          </button>
          <button type="button" onClick={goToday} className={NAV_BUTTON_CLASS}>
            Today
          </button>
          <button type="button" onClick={goNext} className={NAV_BUTTON_CLASS}>
            Next
          </button>
        </div>
        <span className="text-sm font-medium text-content-primary">{viewLabel}</span>
        {/* D-04: no week/day toggle at phone. The strip IS the week view there, so a control
            offering to switch to it would be offering a state that does not exist. */}
        {!isPhoneViewport && (
          <div className="flex items-center gap-2" role="group" aria-label="Calendar view">
            {viewToggleButton('week', 'Week')}
            {viewToggleButton('day', 'Day')}
          </div>
        )}
      </div>

      {/* 4px between the strip and the column, per the measured budget — the root's `space-y-4`
          would spend 16px of the ~365px the two of them share. Inert at desktop, where this
          wrapper has a single child. */}
      <div className="space-y-1">
        {isPhoneViewport && (
          <SchedulerWeekStrip
            dates={weekDates}
            aggregates={stripAggregates}
            totalMembers={totalMembers}
            selectedIndex={selectedDayIndex}
            onSelectDay={handleStripSelect}
            idPrefix={stripId}
          />
        )}
        <div
          className="bg-surface-card rounded-card border border-line"
          // The tab/tabpanel relationship is REAL, not decorative: the strip's tabs switch which
          // day this panel shows, and naming the panel from the selected tab is what stops the
          // strip being seven tabs pointing at nothing.
          role={isPhoneViewport ? 'tabpanel' : undefined}
          aria-labelledby={
            isPhoneViewport ? stripTabId(stripId, selectedDayIndex) : undefined
          }
        >
          <WeekGrid
            variant="read"
            days={days}
            slots={SLOT_ROWS}
            slotLabels={SLOT_LABELS}
            ariaLabel="Group availability by day and time"
            getCell={getCell}
            renderDayHeader={renderDayHeader}
            gutterHeaderRole="presentation"
            overlay={dragOverlay}
            gestureHandlers={gestureHandlers}
            onCellSelect={handleCellSelect}
            scrollContainerRef={setScrollContainer}
            // The phone budget is ~305px, not 600px — see PHONE_GRID_MAX_HEIGHT. Without the
            // smaller bound the column would run past the modal's own scroll region and the
            // internal scroll the budget depends on would silently stop being the thing that
            // moves.
            maxBodyHeight={isPhoneViewport ? PHONE_GRID_MAX_HEIGHT : GRID_MAX_HEIGHT}
          />
        </div>
      </div>

      {totalMembers > 0 && (
        <div className="flex items-center gap-2 text-xs text-content-muted">
          <span>Availability:</span>
          {/* Swatches render FROM the exported ramp, never hand-copied literals -- a legend with
              its own copy of the colours is free to desync from the ramp it describes, and no
              lint or grep gate can see that (the previous 4-swatch legend was correct only by
              coincidence of maintenance). Five swatches because the ramp has five steps. */}
          <div className="flex items-center gap-1">
            {CALENDAR_WASH_RAMP.map((color) => (
              <div key={color} className="w-3 h-3 rounded-xs" style={{ backgroundColor: color }} />
            ))}
          </div>
          <span>More available</span>
        </div>
      )}

      {membersWithoutDataCount > 0 && (
        <p className="text-xs text-content-muted mt-1">
          {membersWithoutDataCount} of {totalGroupMembers} members haven&apos;t shared availability yet
        </p>
      )}

      {totalMembers === 0 && totalGroupMembers > 0 && (
        <p className="text-sm text-content-muted text-center py-2">
          No one has shared availability yet
        </p>
      )}

      {selectedSlot && (
        <div className="p-4 bg-surface-card-hover rounded-card border border-line-accent">
          <p className="text-sm font-medium text-content-primary mb-1">Selected Time:</p>
          <p className="text-lg text-accent font-semibold">
            {format(selectedSlot.start, 'EEEE, MMMM d, h:mm a')}
            {' - '}
            {format(selectedSlot.end, 'h:mm a')}
            {' '}
            <span className="text-accent">({formatDuration(selectedSlot.start, selectedSlot.end)})</span>
          </p>
        </div>
      )}

      {!selectedSlot && (
        <div className="p-4 bg-surface-page rounded-card border border-line">
          {/* DECISION Phase 88.1-11 (UI-SPEC Copywriting, PRESCRIBED CHANGE — not a parity
              carry): the prompt names the gesture THE DEVICE CAN ACTUALLY PERFORM. The shipped
              string says "Click and drag" on a surface whose primary device is a phone at
              somebody's kitchen table; Req 5 ships long-press-to-paint there, and an instruction
              naming a mouse gesture on a touch device is a phone-forward failure, not a wording
              nit. Both strings are kept — the desktop one is verbatim
              (`EventScheduler.js:582`) and is what the plan-01 pin locates. */}
          <p className="text-sm text-content-secondary">
            {isPhoneViewport
              ? 'Tap and hold on a day to pick a time.'
              : 'Click and drag on the calendar to select a time slot for your event.'}
          </p>
        </div>
      )}
    </div>
  );
}
