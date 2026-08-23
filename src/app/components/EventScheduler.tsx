'use client';

// EventScheduler — the create-event time picker, rebuilt onto the shared WeekGrid engine
// (Phase 88.1 plan 09; SPEC Req 2 / Req 3 / Req 4 / Req 6).
//
// This replaces a calendar-library host that lived here from Phase 66 to Phase 88. Week view and
// day view are now literally the same code path parameterized by `days` (7 vs 1) — that is SPEC
// Req 2, and it is why there is no second component for the day arm.
//
// WHAT IS DELIBERATELY NOT HERE (so a future reader does not read absence as an oversight):
//   - The drag RANGE machine and its live selection rectangle are plan 88.1-11. The `overlay`
//     seam and its DECISION marker are scaffolded below, unpopulated, on purpose.
//   - The phone strip geometry is plan 88.1-12.
//   - Removing the calendar dependency from package.json is plan 88.1-16 (SPEC sequencing:
//     removal only AFTER parity is verified).

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addDays,
  differenceInMinutes,
  format,
  isToday,
  setHours,
  setMinutes,
  startOfDay,
  startOfWeek,
} from 'date-fns';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { calendarWashColor, CALENDAR_WASH_RAMP } from '../../lib/availabilityColor';
import { WeekGrid, type WeekGridReadData } from './heatmap/WeekGrid';

// ---------------------------------------------------------------------------
// Grid geometry — 30-minute slots over 10:00-23:59, i.e. 28 rows. Carried verbatim from the
// outgoing host's `min`/`max`/`step` (10:00 AM -> 11:59 PM at step 30).
// ---------------------------------------------------------------------------
const START_HOUR = 10;
const SLOT_MINUTES = 30;
const SLOT_ROWS = 28;
const GRID_MAX_HEIGHT = '600px'; // parity with the outgoing h-[600px] container

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
  //   (b) A post-mount effect re-syncs whenever `initialDate` CHANGES. That is the Phase 71.2
  //       poll-CTA anchor: on the `promptId` journey the poll's own `weekStart` only arrives
  //       after the fetch resolves, so a mount-only seed opens on the wrong week and shows no
  //       tiles. It is also the nav blank-grid fix.
  //
  // `initialDate` is therefore a HYBRID contract: neither a mount-only seed nor a controlled
  // prop. Both readings are pinned (EventScheduler.test.tsx / createEvent.integration.test.tsx).
  // The VIEW TOGGLE is not a third writer — toggling week<->day never moves the date.
  // ---------------------------------------------------------------------------
  const [currentDate, setCurrentDate] = useState<Date>(initialDate || new Date());
  const [currentView, setCurrentView] = useState<'week' | 'day'>(
    defaultView === 'day' ? 'day' : 'week'
  );

  useEffect(() => {
    if (initialDate) {
      setCurrentDate(initialDate);
    }
  }, [initialDate]);

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

  // ---------------------------------------------------------------------------
  // Columns. Monday week start is kept — the outgoing localizer was never its only carrier
  // (`createEvent.js:337,975` and the extracted `resolveWeekNav` both use weekStartsOn: 1).
  // ---------------------------------------------------------------------------
  const days = currentView === 'day' ? 1 : 7;
  const columnDates = useMemo(() => {
    if (currentView === 'day') return [startOfDay(currentDate)];
    const monday = startOfWeek(currentDate, { weekStartsOn: 1 });
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  }, [currentView, currentDate]);

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

  const stepDays = currentView === 'day' ? 1 : 7;
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

  // ---------------------------------------------------------------------------
  // Commit. A tap or a keyboard select commits ONE 30-minute slot through `onTimeSelected`.
  // The range machine is plan 88.1-11.
  //
  // `commitRef` is a latest-prop mirror so the pointer handlers and the keyboard seam below can
  // be created ONCE. WeekGrid memoizes ~196 cells and hands them stable callbacks; a fresh
  // handler identity on every week change would be a re-render the engine explicitly guards.
  // ---------------------------------------------------------------------------
  const commitSlot = useCallback(
    (row: number, col: number) => {
      const day = columnDates[col];
      if (!day) return;
      const start = slotStartFor(day, row);
      const end = slotStartFor(day, row + 1);
      if (onTimeSelected) onTimeSelected(start, end);
    },
    [columnDates, onTimeSelected]
  );
  const commitRef = useRef(commitSlot);
  commitRef.current = commitSlot;

  // SPEC Req 6: keyboard commit runs through `useHeatmapCell`'s EXISTING Enter/Space branch,
  // routed by WeekGrid's seam 5. There is no second keyboard handler in this file, and adding
  // one would be the regression that seam exists to prevent.
  const handleCellSelect = useCallback((row: number, col: number) => {
    commitRef.current(row, col);
  }, []);

  // Tap commit. Anchor on pointerdown, commit on pointerup at the SAME cell, so a stray drag
  // across cells does not silently commit the wrong one. Plan 88.1-11 replaces this with the
  // range machine on the same seam.
  const pointerAnchor = useRef<string | null>(null);
  const gestureHandlers = useMemo(() => {
    const coordFromEvent = (e: React.PointerEvent): string | null =>
      (e.target as HTMLElement).closest('[data-coord]')?.getAttribute('data-coord') ?? null;
    return {
      onPointerDown: (e: React.PointerEvent) => {
        pointerAnchor.current = coordFromEvent(e);
      },
      onPointerUp: (e: React.PointerEvent) => {
        const coord = coordFromEvent(e);
        if (coord && coord === pointerAnchor.current) {
          const [row, col] = coord.split(':').map(Number);
          commitRef.current(row, col);
        }
        pointerAnchor.current = null;
      },
      onPointerCancel: () => {
        pointerAnchor.current = null;
      },
    };
  }, []);

  // ---------------------------------------------------------------------------
  // scrollToTime parity (Phase 66-03 CREVT-06). WeekGrid's `scrollContainerRef` is ONE seam with
  // three consumers — this, the rAF edge auto-scroll (88.1-03) and the phone day column
  // (88.1-12). Resolve the row, then read its authored offset; no geometry is fabricated, so in
  // jsdom (where every box is zero) this is an inert no-op rather than a false pass.
  // ---------------------------------------------------------------------------
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || !scrollToTime) return;
    const minutesFromStart =
      (scrollToTime.getHours() - START_HOUR) * 60 + scrollToTime.getMinutes();
    const row = Math.max(
      0,
      Math.min(SLOT_ROWS - 1, Math.floor(minutesFromStart / SLOT_MINUTES))
    );
    const cell = container.querySelector(`[data-coord="${row}:0"]`) as HTMLElement | null;
    if (!cell) return;
    container.scrollTop = cell.offsetTop;
  }, [scrollToTime, currentView, currentDate]);

  // ---------------------------------------------------------------------------
  // Per-cell read data.
  // ---------------------------------------------------------------------------
  const getCell = useCallback(
    (row: number, col: number): WeekGridReadData => {
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
    },
    [columnDates, heatmapLookup, conflictLookup, totalMembers, selfUuid, selectedSlot]
  );

  const renderDayHeader = useCallback(
    (col: number) => {
      const day = columnDates[col];
      // Paired with MergedHeatmapGrid's today treatment: the accent lands on the label itself,
      // which is the part this seam owns (the header cell's own background belongs to WeekGrid).
      return (
        <span className={isToday(day) ? 'text-accent' : undefined}>{format(day, 'dd EEE')}</span>
      );
    },
    [columnDates]
  );

  /* DECISION Phase 88-27 (D-32 bucket A) — carried, re-recorded at its new home. The DRAG
     selection rectangle deliberately gets NO FILL, chosen OVER the bucket-A default of a
     `-subtle` surface token: every mechanism D-33 allows is OPAQUE, and an opaque fill would
     hide the grid cells the drag is selecting — the opposite of what a selection rectangle is
     for. A 2px border carries it alone. A translucent selection wash is the one legitimate use
     of alpha in the whole census and is a Phase 88.3 question. Adding a fill is a decision, not
     a completion.
     The overlay seam is scaffolded here UNPOPULATED on purpose: plan 88.1-11 draws into it, and
     the marker is planted now so it cannot be lost in the gap between the two plans. This is NOT
     the committed-selection block — that one IS filled, see the marker in `getCell` above. */
  const dragOverlay: React.ReactNode = null;

  const viewLabel =
    currentView === 'day'
      ? format(columnDates[0], 'EEEE, MMMM d, yyyy')
      : `${format(columnDates[0], 'MMM d')} - ${format(columnDates[columnDates.length - 1], 'MMM d, yyyy')}`;

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
    <div className="space-y-4">
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
        <div className="flex items-center gap-2" role="group" aria-label="Calendar view">
          {viewToggleButton('week', 'Week')}
          {viewToggleButton('day', 'Day')}
        </div>
      </div>

      <div className="bg-surface-card rounded-card border border-line">
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
          scrollContainerRef={scrollContainerRef}
          maxBodyHeight={GRID_MAX_HEIGHT}
        />
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
          <p className="text-sm text-content-secondary">
            Click and drag on the calendar to select a time slot for your event.
          </p>
        </div>
      )}
    </div>
  );
}
