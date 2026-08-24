'use client';

// SchedulerWeekStrip — the phone week strip that sits above the create-event scheduler's
// full-width single-day column (Phase 88.1 plan 12, CONTEXT D-03, UI-SPEC "S2 phone strip cell").
//
// Seven tappable day cells carrying that day's AGGREGATE availability, so the week stays scannable
// at 375px where seven interactive columns cannot fit. Scan the week here at day granularity; pick
// the actual slot in the column below.
//
// This component holds NO scheduling state. It reports the chosen day upward and nothing else —
// the scheduler owns the displayed date, exactly as it owns it for Back/Today/Next.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { format, isToday } from 'date-fns';
import { calendarWashColor } from '../../lib/availabilityColor';
import { useHeatmapCell } from './heatmap/useHeatmapCell';

/**
 * The DOM id of a strip cell, so the day column below can point `aria-labelledby` at the SELECTED
 * one and the tab/tabpanel relationship is real rather than dangling. Exported (rather than
 * hand-built at both sites) so the two cannot drift.
 */
export function stripTabId(idPrefix: string, index: number): string {
  return `${idPrefix}-strip-day-${index}`;
}

export interface SchedulerWeekStripProps {
  /** The displayed week's seven days, Monday first, in display order. */
  dates: Date[];
  /** Per-day aggregate availability (MAX over the day's slots) — see `heatmap/dayAggregate.ts`. */
  aggregates: number[];
  /** Denominator for the wash ramp and the accessible name. */
  totalMembers: number;
  /** Which day the column below is currently showing. */
  selectedIndex: number;
  /** Report the tapped/selected day upward. The strip does not move the date itself. */
  onSelectDay: (index: number) => void;
  /** Namespace for the per-cell ids (the scheduler passes a `useId()` value). */
  idPrefix: string;
}

/*
 * DECISION Phase 88.1-12 (CONTEXT D-03 reinterpretation + the strip's ARIA role), two choices, one
 * marker because the second only exists because of the first:
 *
 * (1) GEOMETRY — a week STRIP over a single-day COLUMN, chosen OVER three alternatives that were
 *     each examined and each rejected on measurement, not taste:
 *       - a fit-to-width 7-column INTERACTIVE grid: 327px of content at 375px is ~46.7px per
 *         column, and the day axis of an interactive cell then breaches the 44px touch floor once
 *         any padding, gap or border exists. (The strip survives at the same width only because it
 *         is ONE row of 56px-tall cells with `gap-px` and nothing else — see the geometry comment
 *         on the container below.)
 *       - HORIZONTAL SCROLL: measured on the sibling idiom, ~3.5 of 7 columns are visible, so you
 *         cannot scan the week at all — which is the one thing the week view is for.
 *       - a PAGED 3-4 day window: a second navigation concept to learn, and it still cannot scan
 *         the week.
 *     The owner's own alternative — a display-only grid with form entry underneath — was examined
 *     and rejected because MANUAL MODE ALREADY SHIPS THAT EXPERIENCE and stays one toggle away.
 *     SPEC Req 7's literal "week view at 375px" is satisfied by this reading: the week is visible
 *     and scannable at day granularity; what moves to the column below is slot-level precision.
 *
 * (2) ROLE — `tablist`/`tab`, chosen OVER `radiogroup`/`radio`. The two are semantically
 *     equivalent for "pick one of seven", but a strip cell SWITCHES THE VISIBLE DAY COLUMN below
 *     it, which is literally the tab/tabpanel relationship; and plan 88.1-09's desktop Week/Day
 *     control already answers the same question with pressed-state buttons in a labelled group, so
 *     `radiogroup` would be a third idiom for one-of-N on one surface. Assigning a role at all is
 *     NOT optional here: `useHeatmapCell.ts:13-16` states in its own header that it decides no
 *     `role`/`aria-*` — the ReadCell/WriteCell wrappers do — and this strip composes the hook
 *     directly with no wrapper cell, so without this the cells would ship as role-less
 *     tabindex-carrying elements announcing "M 22 4" with no name and no selected state.
 */
function StripDayCell({
  date,
  aggregate,
  totalMembers,
  index,
  cols,
  selected,
  focused,
  onMove,
  onSelect,
  registerRef,
  id,
}: {
  date: Date;
  aggregate: number;
  totalMembers: number;
  index: number;
  cols: number;
  selected: boolean;
  focused: boolean;
  onMove: (row: number, col: number) => void;
  onSelect: () => void;
  registerRef: (node: HTMLButtonElement | null) => void;
  id: string;
}) {
  // The strip is a 1-row grid, so the hook's row axis is pinned at 0 and its Up/Down/PageUp/
  // PageDown keys clamp inert — the same honest single-axis contract the scheduler's day arm has.
  // Left/Right/Home/End move. There is NO second key handler here and there must not be one
  // (F-803/809): the grid and the strip answer the same keys because they share this hook.
  const { tabIndex, onKeyDown } = useHeatmapCell({
    row: 0,
    col: index,
    rows: 1,
    cols,
    focused,
    onMove,
    onSelect,
  });

  const background = calendarWashColor(aggregate, totalMembers);
  const today = isToday(date);

  // The rendered cell is three unlabelled fragments ("M", "22", "4"). The full name is assembled
  // from the SAME values the cell renders, so the aggregate is never colour-plus-bare-number to a
  // screen reader.
  const dayName = format(date, 'EEEE d');
  const availability =
    totalMembers > 0
      ? `${aggregate} of ${totalMembers} available`
      : 'availability not shared yet';

  return (
    <button
      type="button"
      role="tab"
      id={id}
      ref={registerRef}
      aria-selected={selected}
      // Today is exposed to assistive tech HERE, not by tint alone — the VISUAL today treatment
      // in the header zone below (plan 88.1-13) is colour-only, so this is what carries the state
      // where colour does not reach. Both halves ship; neither is a substitute for the other.
      aria-current={today ? 'date' : undefined}
      aria-label={`${dayName}, ${availability}`}
      tabIndex={tabIndex}
      onKeyDown={onKeyDown}
      onClick={onSelect}
      // No border and no padding: at 375px each cell is 46.7px wide against a 44px floor, so the
      // 2.7px of margin is the entire budget. Selection is drawn with an INSET box-shadow below
      // for exactly that reason — a ring costs no layout, a border costs 2px.
      className="flex h-14 flex-col overflow-hidden rounded-xs active:opacity-75 transition-opacity duration-100 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1"
      style={
        selected
          ? { boxShadow: 'inset 0 0 0 2px var(--color-btn-primary-bg)' }
          : undefined
      }
    >
      {/* Header zone. Sizing/stacking/leading copied VERBATIM from the owner-passed sibling
          `EventHeatmapBackground.js:216-226` — the M-03 truncation fix, already judged at 375px,
          which CONTEXT D-03 mandates the strip reuse rather than re-invent.

          DECISION Phase 88.1-13 (SPEC Req 8, threat T-88.1-39), two choices at this one zone:

          (1) THE TODAY TERNARY BELOW IS THE SOLE OWNER OF THE DATE-NUMBER SPAN'S TEXT-COLOUR SLOT.
              It REPLACES the static muted class plan 88.1-12 put there; it does not sit beside it.
              Chosen OVER leaving that class in place and appending the accent, because
              same-specificity Tailwind utilities on ONE element resolve by STYLESHEET ORDER, not
              by class-attribute order and with no tailwind-merge on this template literal — so a
              leftover static colour would silently outrank `text-accent` on today's cell no matter
              which class was written last. That is the exact failure the §10.3 exemplar's own
              in-file warning describes (`MergedHeatmapGrid.js:130-138`, measured in a real
              `next build`). Read plan 88.1-12's "verbatim in shape" as covering this span's
              SIZING and STACKING only; the colour slot is this ternary's.

          (2) THE NON-TODAY VALUE IS THE MUTED TOKEN, chosen OVER the brighter value the DESKTOP day
              header's twin ternary uses. The desktop header is its own surface with its own
              sibling; this span's sibling is the M-03 idiom directly above it, and matching that
              sibling is the whole point of copying it. Converging the two sites onto one non-today
              value is a decision that breaks M-03 parity, not a consistency fix.

          The SURFACE half wraps both lines rather than landing on the button: the button's lower
          zone carries the availability wash, and a cell-wide amber would sit UNDER a translucent
          green on days that have availability and stand alone on days that do not — the same
          data-layer corruption the desktop marker rejects a column-body fill for.

          Collapsing either ternary into one static class plus an interpolated tint turns the tint
          OFF (stylesheet order again); it is a decision, not a simplification.

          WHERE THE TINT'S VALUE COMES FROM (plan 88.1-15, Req 8): the CLASS is the shared
          `bg-surface-accent-subtle`, but inside the scheduler that token is re-pointed to
          `--color-bg-today-tint` — the owner's ARM B pick — by `TODAY_TINT_SCOPE` on
          `EventScheduler`'s root div. That is deliberate and it is why this file needed no edit
          when the pick landed. Consequence a future reader should know rather than discover:
          rendering this strip OUTSIDE `EventScheduler` would give its today cell the WEAKER
          global accent tint. If that ever happens, move the scope, do not hard-code a colour
          here (`rawColorValues.test.ts` forbids the literal anyway). */}
      <span className={today ? 'bg-surface-accent-subtle' : 'bg-surface-card'}>
        <span aria-hidden="true" className="text-xs font-medium text-content-muted block leading-tight">
          {format(date, 'EEEEE')}
        </span>
        <span
          aria-hidden="true"
          // Hooked for the T-88.1-39 pin, which asserts exactly ONE colour class per branch here.
          data-testid="strip-day-number"
          className={`text-[10px] ${today ? 'text-accent' : 'text-content-muted'}`}
        >
          {format(date, 'd')}
        </span>
      </span>
      {/* Tint zone. The NUMBER is the mandatory secondary non-colour cue, not decoration:
          colour-only encoding of availability fails the ~8% of men with colour-vision deficiency,
          and it is the same cue the grid cells below carry as their count badge. The ramp is
          `calendarWashColor`, the same one the day column uses, so strip and column read as one
          scale under one legend. */}
      <span
        aria-hidden="true"
        className="flex flex-1 items-center justify-center text-[10px] font-semibold text-content-secondary"
        style={background ? { backgroundColor: background } : undefined}
      >
        {aggregate > 0 ? aggregate : ''}
      </span>
    </button>
  );
}

export default function SchedulerWeekStrip({
  dates,
  aggregates,
  totalMembers,
  selectedIndex,
  onSelectDay,
  idPrefix,
}: SchedulerWeekStripProps) {
  // Roving tabindex: exactly one cell is tabbable, arrows move real DOM focus. This is the
  // container half of the contract `useHeatmapCell` leaves to its host, and it mirrors WeekGrid's
  // own `onMove` handling (`WeekGrid.tsx:284-287`) rather than inventing a second shape.
  const [focusedIndex, setFocusedIndex] = useState(selectedIndex);
  const cellRefs = useRef(new Map<number, HTMLButtonElement | null>());

  // Keep the tabbable cell on the selected day when the date moves from OUTSIDE the strip
  // (Back/Today/Next, or a parent `initialDate` re-sync). No `.focus()` call here on purpose:
  // stealing focus on a prop change would yank it out of whatever the user was actually using.
  useEffect(() => {
    setFocusedIndex(selectedIndex);
  }, [selectedIndex]);

  const onMove = useCallback((_row: number, col: number) => {
    setFocusedIndex(col);
    cellRefs.current.get(col)?.focus();
  }, []);

  const registerRef = useCallback(
    (index: number) => (node: HTMLButtonElement | null) => {
      if (node) cellRefs.current.set(index, node);
      else cellRefs.current.delete(index);
    },
    []
  );

  return (
    <div
      role="tablist"
      aria-label="Choose a day"
      // HARD GEOMETRY CONSTRAINT (UI-SPEC spacing exception 2, pitfall P9). At 375px the modal
      // leaves 327px of content width (375 - 24 modal gutter `Modal.tsx:186` - 24 body padding
      // `Modal.tsx:289` `p-3`), so seven cells are 46.7px against a 44px touch floor — 2.7px of
      // margin, total. `gap-px` is a grid hairline, copied from `EventHeatmapBackground.js:210`,
      // and it is the ONLY separation this strip may carry. Container padding, a larger gap, or a
      // per-cell border each drop the cells below the floor and fail the phone gate
      // (`e2e/touch-targets.spec.ts`). "Tidying" the spacing here is a regression, not a cleanup.
      className="grid gap-px"
      style={{ gridTemplateColumns: `repeat(${dates.length}, 1fr)` }}
    >
      {dates.map((date, index) => (
        <StripDayCell
          key={date.toISOString()}
          id={stripTabId(idPrefix, index)}
          date={date}
          aggregate={aggregates[index] ?? 0}
          totalMembers={totalMembers}
          index={index}
          cols={dates.length}
          selected={index === selectedIndex}
          focused={index === focusedIndex}
          onMove={onMove}
          onSelect={() => {
            setFocusedIndex(index);
            onSelectDay(index);
          }}
          registerRef={registerRef(index)}
        />
      ))}
    </div>
  );
}
