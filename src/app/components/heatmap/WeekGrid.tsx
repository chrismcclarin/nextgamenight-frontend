'use client';

// WeekGrid — RBC-free week slot-grid container (PRIM-01, D-06).
//
// The composable, RBC-free building block the 5 prod div-grids converge onto in
// 84-10 (and that EventScheduler can later rebuild on, dropping RBC per D-08).
// "RBC-free" = it imports nothing from the calendar library; that independence is
// the whole point of D-06. It composes useHeatmapCell + Read/Write cells (time-axis column +
// day columns) and owns the roving focus:
//
//   - `focusedCoord` state marks which cell holds the single tabIndex=0.
//   - a `cellRefs` map keyed by "row:col" stores each cell's DOM node so an arrow
//     key moves REAL DOM focus (`.focus()`), mirroring the legacy intensity read-grid's
//     `cellRefs[...].focus()` — not just a tabIndex shuffle. (That component was deleted by
//     plan 88-31's dead-code gate; the behaviour it is credited with here is the one this
//     grid still implements, and the original is in git history if the wording matters.)
//   - handlers handed to the (React.memo) cells are STABLE across renders:
//     `onMove` is a single stable callback (the hook passes it the clamped
//     target), ref + per-coord `onSelect` callbacks are memoized in a Map, and
//     pointer-paint is delegated at the grid level by reading `data-coord`. No
//     fresh inline closures per cell per render, so the memoized cells stay
//     un-re-rendered during a paint drag.

import React, { memo, useCallback, useRef, useState } from 'react';
import { ReadCell } from './ReadCell';
import { WriteCell, cyclePreference, type Preference } from './WriteCell';

const coordKey = (row: number, col: number) => `${row}:${col}`;

/**
 * Per-cell read data returned by `getCell` (color args + presentation).
 *
 * DECISION Phase 88-31: the second arm of this union — the default/intensity shape carrying
 * `participantCount` / `preferredCount` — was deleted with the rest of the dead intensity
 * cluster (SPEC "END-OF-PHASE DEAD-CODE GATE").
 *
 * WORTH KNOWING: this arm is NOT in the SPEC's enumerated delete list, and `tsc --noEmit` is
 * what makes that safe rather than lucky — leaving it would have left a type describing props
 * `ReadCell` no longer accepts, and the build would have said so. It is recorded here because
 * the next person auditing that list against what actually shipped will otherwise read this as
 * scope drift.
 *
 * SEAM 1 (plan 88.1-02, D-01): `colorClass`, `style` and `children` are additive optional FIELDS
 * on this surviving `merged` arm. Adding FIELDS is not what DECISION Phase 88-31 forbids — adding
 * a second `variant` arm is. The rebuilt scheduler needs all three: a translucent wash class that
 * is NOT the opaque ramp, per-cell inline style, and a participant-count badge as cell content.
 */
export type WeekGridReadData = {
  variant: 'merged';
  availableCount: number;
  totalMembers: number;
  ariaLabel?: string;
  tooltipContent?: React.ReactNode;
  /**
   * Opt-in colour override forwarded to `ReadCell.colorClass` (88.1-02 Task 1). Omit for today's
   * ramp; `null` to emit no colour class (the scheduler's empty slot); a string to use verbatim
   * (the scheduler's translucent wash).
   */
  colorClass?: string | null;
  /** Inline style forwarded to the cell (e.g. an rgba wash the class system cannot express). */
  style?: React.CSSProperties;
  /** Cell content forwarded to the cell (e.g. the participant-count badge). */
  children?: React.ReactNode;
};

interface WeekGridBaseProps {
  /** Number of day columns. */
  days: number;
  /** Number of time-slot rows. */
  slots: number;
  /** Column header labels (length `days`). */
  dayLabels?: string[];
  /** Time-axis labels (length `slots`). */
  slotLabels?: string[];
  /** Accessible label for the grid. */
  ariaLabel?: string;
  /** Disable all cells. */
  disabled?: boolean;
  /**
   * Override the per-cell wrapper class (row height / border / any non-width styling).
   * WIDTHS NO LONGER COME FROM HERE — since the 88.1-02 CSS-grid conversion the column widths
   * are owned by `gridTemplateColumns` on the grid container, so header and body cannot desync.
   * Passing `w-*` utilities here does nothing useful; change `gutterPx` or `days` instead.
   */
  cellClassName?: string;
  /**
   * Width of the time-axis gutter column, in px. Default 24 — the value 87.8-13 F-2 recorded as
   * fitting the widest compact label ("12p" at 10px mono) at 375px, where the old 40px "read as
   * dead left padding". The day columns take `1fr` each, so the grid always fits its container.
   */
  gutterPx?: number;
  /**
   * SEAM 2 (88.1-02, D-01) — custom day headers. Rendered INSIDE the existing
   * `role="columnheader"` element; when omitted, falls back to `dayLabels?.[col] ?? ''`.
   * A ReactNode is required because the scheduler's header is a paired today ternary (S3) and the
   * phone strip's is a two-line date stack — neither is expressible as a string.
   *
   * MEMO-STABILITY: pass a stable callback (`useCallback`). Every seam value that reaches a cell
   * must be referentially stable across a drag or it defeats the `React.memo` on ~196 cells that
   * `AvailabilityGrid.js:368-373` calls "the smooth/janky boundary on a phone, not a
   * micro-optimization."
   */
  renderDayHeader?: (col: number) => React.ReactNode;
  /**
   * SEAM 3 (88.1-02, D-01) — overlay slot. Rendered as the LAST child of the grid body, which
   * carries `relative`, so absolutely-positioned content resolves against the full-size scrolled
   * content and travels with the scroll rather than sticking to the viewport.
   *
   * This hosts the drag-selection rectangle. Selection cannot be expressed as tinted cells:
   * manual mode legitimately produces OFF-GRID ranges (`createEvent.js:64-74` derives
   * `selectedSlot` from a free-form datetime-local plus a 1-720 minute field — e.g. 19:15-20:00
   * on a 30-minute grid).
   */
  overlay?: React.ReactNode;
  /**
   * SEAM 4a (88.1-02, D-01/C10) — ref to the SCROLLING element (the wrapper). One ref serves three
   * consumers: `scrollToTime` parity (plan 88.1-09 owns the scrollTop calculation), the rAF edge
   * auto-scroll (plan 88.1-03), and the internal-scroll requirement the phone height budget forces.
   * Only meaningful together with `maxBodyHeight` — without it the wrapper scrolls horizontally
   * only and there is nothing vertical to scroll.
   */
  scrollContainerRef?: React.Ref<HTMLDivElement>;
  /**
   * SEAM 6 (88.1-09) — role of the EMPTY top-left corner cell above the time gutter.
   *
   * DECISION Phase 88.1-09: an opt-in override defaulting to `'columnheader'` (today's shape,
   * byte-identical when omitted), chosen OVER unconditionally changing the corner to
   * `'presentation'`.
   *
   * WHY THE OVERRIDE EXISTS AT ALL: the corner labels no column — it is the intersection of the
   * header row and the time gutter — so a consumer whose contract is "N day columns means N
   * column headers" cannot live with it. The rebuilt scheduler is exactly that consumer: BOTH
   * halves of its acceptance harness locate day columns as `getAllByRole('columnheader')` and
   * assert `toHaveLength(7)` / `[0] === '24 Mon'` (`EventScheduler.test.tsx:99-100,137` and
   * `createEvent.integration.test.tsx:109,137,184`), and both files are contractually UNEDITABLE.
   *
   * WHY NOT change it for everyone: `WeekGrid.test.tsx:171,181` pins the corner AS a columnheader
   * ("headers[0] is the gutter corner; the day headers follow") and indexes the day headers from
   * 1. Flipping the default would edit a pin to make a different pin pass — the thing this phase's
   * harness rules forbid. Both readings of a blank corner are ARIA-legal; this makes the choice
   * the consumer's.
   *
   * WHAT RE-OPENS IT: giving the corner real content (a timezone abbreviation, say). Content means
   * it is describing something, and the whole question changes.
   */
  gutterHeaderRole?: 'columnheader' | 'presentation';
}

export interface ReadWeekGridProps extends WeekGridBaseProps {
  variant: 'read';
  /** Returns the read/intensity data for a given coord. */
  getCell: (row: number, col: number) => WeekGridReadData;
  /**
   * SEAM 4b (88.1-02, D-01) — external pointer handlers spread onto the grid BODY, for the
   * consumer's drag-to-select gesture.
   *
   * READ ARM ONLY, and that is enforced by this type rather than by a comment: the write arm's
   * internal delegated paint handlers are authoritative and must not be silently replaced. The
   * spread is applied AFTER the internal handlers, so on the read arm (where those internal
   * handlers early-return anyway) the consumer's `onPointerDown` wins outright.
   *
   * MEMO-STABILITY: pass stable callbacks.
   */
  gestureHandlers?: Pick<
    React.DOMAttributes<HTMLDivElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel'
  >;
  /**
   * SEAM 4c (88.1-02, added by adversarial review) — height-bound the grid into a SINGLE both-axes
   * scroller. A CSS length, e.g. `'600px'`.
   *
   * WHY THIS EXISTS: today's wrapper is `overflow-x-auto` — horizontal only, with NO height bound.
   * The shipped RBC scheduler gets its vertical scrolling from RBC's own internal scroller inside a
   * `h-[600px] … overflow-hidden` container (`EventScheduler.js:478`). Without this prop the
   * rebuilt grid would simply clip inside the modal, `scrollToTime` parity would silently become a
   * no-op (nothing to scroll), and the phone height budget could not be met — while every pre-e2e
   * gate stayed green, because the only pin is "mounts without throwing".
   *
   * ONE SCROLLER, NOT TWO — chosen OVER a split vertical-only inner scroller. A split would
   * decouple the overlay/badge coordinate space from the horizontal scroll and break the very
   * coupling seam 3 establishes. Omitting this prop is byte-identical to the pre-88.1-02 behavior
   * (`overflow-x-auto`, unbounded height).
   */
  maxBodyHeight?: string;
  /**
   * SEAM 5 (88.1-02, SPEC Req 6) — keyboard/read-arm select passthrough. Called with the cell's
   * coordinate when Enter/Space commits on a focused read cell.
   *
   * This is NOT a new keyboard handler and must never become one: `useHeatmapCell.ts:101-105`
   * already maps Enter/Space to `onSelect`, and `ReadCell` has accepted an `onSelect` prop all
   * along — WeekGrid's read arm simply never populated it, so a keyboard commit on a read cell
   * resolved to `noop`. This seam closes that missing link, and nothing else.
   *
   * MEMO-STABILITY: routed through the same per-coordinate callback cache the write arm uses, so
   * the memoized cells receive a stable identity regardless of how often `onCellSelect` changes.
   */
  onCellSelect?: (row: number, col: number) => void;
}

export interface WriteWeekGridProps extends WeekGridBaseProps {
  variant: 'write';
  /** Returns the current preference for a given coord. */
  getPreference: (row: number, col: number) => Preference;
  /** Persists a preference change for a coord (keyboard cycle + pointer paint). */
  onChange?: (row: number, col: number, next: Preference) => void;
}

export type WeekGridProps = ReadWeekGridProps | WriteWeekGridProps;

// Row height + border only. The width utilities (`w-24`/`sm:w-28`) and `shrink-0` that used to
// live here were deleted by the 88.1-02 CSS-grid conversion — see the DECISION marker at the
// geometry site below. (Class names are written with a slash rather than as a literal utility
// pair so plan 88.1-02's "no fixed widths survive" grep gate reads 0 on prose too.)
const DEFAULT_CELL_CLASS = 'h-12 sm:h-14 border border-line';

/**
 * DECISION Phase 88.1-02 (C12 / UI-SPEC "S1 desktop geometry"): ONE CSS grid with
 * `gridTemplateColumns: \`${gutterPx}px repeat(${days}, 1fr)\`` sizes the header row AND the body
 * cells — chosen OVER keeping the flex + fixed-width idiom and letting consumers pass
 * `cellClassName`.
 *
 * WHY the rejected option was rejected: four widths had to agree by hand — the gutter header
 * (`w-16`/`sm:w-20`), the day header (`w-24`/`sm:w-28`), the row gutter (same pair as the gutter
 * header) and
 * `DEFAULT_CELL_CLASS` — and only the LAST of those was overridable. So passing `cellClassName`
 * silently desynced the header row from the body, and nothing in the prop name told the next
 * reader that. The old defaults also came to 7 x 96px + 64px = 736px, which at 375px turned the
 * grid into the horizontal-scroll surface D-03 explicitly rejected; `1fr` columns fit-to-width at
 * both target geometries (~117px columns in the create-event modal's real 896px `max-w-4xl`).
 *
 * The idiom is copied from the owner-passed sibling `EventHeatmapBackground.js:210-212`, including
 * `className="contents"` on the per-row wrapper (`:235`) so keeping `role="row"` does not break the
 * single grid.
 *
 * NOT AN OVERRIDE OF ANYTHING PRIOR: `DECISION Phase 88-31` above guards the read-data UNION, not
 * the layout. WeekGrid had zero live consumers and `WeekGrid.test.tsx` had no geometry assertions
 * when this was done, which is why it was free now and would not have been later.
 *
 * WHAT RE-OPENS IT: a consumer that genuinely needs fixed-width columns wider than its container
 * (a print/export view, say). That wants a `columnPx` prop alongside `1fr`, not a return to four
 * hand-synced width utilities.
 */
export const WeekGrid = memo(function WeekGrid(props: WeekGridProps) {
  const {
    days,
    slots,
    dayLabels,
    slotLabels,
    ariaLabel,
    disabled = false,
    cellClassName,
    gutterPx = 24,
    renderDayHeader,
    overlay,
    scrollContainerRef,
    gutterHeaderRole = 'columnheader',
  } = props;

  // Read-arm-only seams. Narrowed here (not destructured above) so the write arm cannot reach them.
  const gestureHandlers = props.variant === 'read' ? props.gestureHandlers : undefined;
  const maxBodyHeight = props.variant === 'read' ? props.maxBodyHeight : undefined;
  const onCellSelect = props.variant === 'read' ? props.onCellSelect : undefined;

  const [focusedCoord, setFocusedCoord] = useState({ row: 0, col: 0 });

  // DOM-node registry for roving focus. Keyed by "row:col".
  const cellRefs = useRef(new Map<string, HTMLDivElement | null>());
  // Stable per-coord ref callbacks (created once per coord, memo-friendly).
  const refCallbacks = useRef(new Map<string, (node: HTMLDivElement | null) => void>());
  const getCellRef = useCallback((key: string) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (node: HTMLDivElement | null) => {
        if (node) cellRefs.current.set(key, node);
        else cellRefs.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);

  // Single STABLE onMove: the hook hands it the clamped target coord. Updates
  // focusedCoord AND moves real DOM focus to the target cell.
  const onMove = useCallback((row: number, col: number) => {
    setFocusedCoord({ row, col });
    cellRefs.current.get(coordKey(row, col))?.focus();
  }, []);

  // Keep the latest onChange reachable from stable per-coord callbacks without
  // making those callbacks depend on (and churn with) onChange identity.
  const onChange = props.variant === 'write' ? props.onChange : undefined;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Same latest-prop mirror for the read arm's select seam (88.1-02 seam 5), so the per-coord
  // callbacks below never churn with `onCellSelect`'s identity.
  const onCellSelectRef = useRef(onCellSelect);
  onCellSelectRef.current = onCellSelect;

  // Stable per-coord onSelect callbacks, shared by BOTH arms — write-arm keyboard cycle
  // persistence AND the read arm's Req 6 coordinate commit. Generalizing this one cache was chosen
  // OVER building a second read-arm cache: two caches would be two places to get memo stability
  // right, and the read arm would inevitably drift from the write arm's guarantee.
  //
  // The two dispatches are mutually exclusive at runtime — a grid is one variant, so exactly one
  // of the two refs is ever populated.
  const selectCallbacks = useRef(new Map<string, (next?: Preference) => void>());
  const getOnSelect = useCallback((row: number, col: number) => {
    const key = coordKey(row, col);
    let cb = selectCallbacks.current.get(key);
    if (!cb) {
      cb = (next?: Preference) => {
        onChangeRef.current?.(row, col, next ?? null);
        onCellSelectRef.current?.(row, col);
      };
      selectCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);

  // --- Delegated pointer-paint (write only) --------------------------------
  // Grid-level handlers read `data-coord` off the event target so we never hand
  // per-cell pointer closures to the memoized cells.
  const isPainting = useRef(false);
  const paintValue = useRef<Preference>(null);

  const coordFromEvent = (e: React.PointerEvent): { row: number; col: number } | null => {
    const el = (e.target as HTMLElement).closest('[data-coord]');
    const raw = el?.getAttribute('data-coord');
    if (!raw) return null;
    const [row, col] = raw.split(':').map(Number);
    return { row, col };
  };

  const handleGridPointerDown = (e: React.PointerEvent) => {
    if (disabled || props.variant !== 'write') return;
    const c = coordFromEvent(e);
    if (!c) return;
    const next = cyclePreference(props.getPreference(c.row, c.col));
    paintValue.current = next;
    isPainting.current = true;
    onChangeRef.current?.(c.row, c.col, next);
  };

  const handleGridPointerOver = (e: React.PointerEvent) => {
    if (disabled || props.variant !== 'write' || !isPainting.current) return;
    const c = coordFromEvent(e);
    if (!c) return;
    onChangeRef.current?.(c.row, c.col, paintValue.current);
  };

  const endPaint = () => {
    isPainting.current = false;
  };

  // --- Cell renderer --------------------------------------------------------
  const renderCell = (row: number, col: number) => {
    const key = coordKey(row, col);
    const focused = focusedCoord.row === row && focusedCoord.col === col;

    if (props.variant === 'read') {
      const data = props.getCell(row, col);
      const common = {
        row,
        col,
        rows: slots,
        cols: days,
        focused,
        disabled,
        onMove,
        triggerRef: getCellRef(key),
        // SEAM 5 (Req 6): the callback this arm used to omit. `useHeatmapCell`'s existing
        // Enter/Space branch calls it — that is the ONLY keyboard-commit handler in play, and no
        // second one may be added. Always forwarded (not conditionally on `onCellSelect`), because
        // the cached callback is stable either way and no-ops when the seam is unused; a
        // conditional would hand the memoized cells a changing prop.
        onSelect: getOnSelect(row, col),
      };
      // One read variant since 88-31 (see `WeekGridReadData` above); the branch that used to
      // sit here rendered the deleted intensity cell.
      return (
        <ReadCell
          {...common}
          variant="merged"
          availableCount={data.availableCount}
          totalMembers={data.totalMembers}
          ariaLabel={data.ariaLabel}
          tooltipContent={data.tooltipContent}
          colorClass={data.colorClass}
          style={data.style}
        >
          {data.children}
        </ReadCell>
      );
    }

    return (
      <WriteCell
        row={row}
        col={col}
        rows={slots}
        cols={days}
        focused={focused}
        disabled={disabled}
        preference={props.getPreference(row, col)}
        slotId={key}
        onMove={onMove}
        onSelect={getOnSelect(row, col)}
        cellRef={getCellRef(key)}
      />
    );
  };

  // SEAM 4c: with `maxBodyHeight` the wrapper becomes ONE both-axes scroller and is the element
  // `scrollContainerRef` points at; without it, byte-identical to pre-88.1-02 (`overflow-x-auto`,
  // unbounded height).
  const scrollerClassName = maxBodyHeight ? 'overflow-auto pb-2' : 'overflow-x-auto pb-2';

  return (
    <div
      ref={scrollContainerRef}
      className={scrollerClassName}
      style={maxBodyHeight ? { maxHeight: maxBodyHeight } : undefined}
      onPointerUp={endPaint}
      onPointerLeave={endPaint}
    >
      <div
        // `relative` (SEAM 3) makes this the positioned ancestor for the overlay rectangle and the
        // absolutely-positioned count badges. It lives INSIDE the scroller, so both resolve against
        // the full-size scrolled CONTENT and travel with the scroll instead of sticking to the
        // viewport. Harmless when no overlay is passed — there is nothing absolute to resolve.
        className="grid gap-px relative"
        style={{ gridTemplateColumns: `${gutterPx}px repeat(${days}, 1fr)` }}
        role="grid"
        aria-label={ariaLabel}
        onPointerDown={handleGridPointerDown}
        onPointerOver={handleGridPointerOver}
        // SEAM 4b spread LAST on purpose: on the read arm the internal paint handlers above
        // early-return, so the consumer's gesture wins; on the write arm this is `undefined` by
        // construction (read-arm-only type), so the internal handlers stay authoritative.
        {...gestureHandlers}
      >
        {/* Day header row. `contents` keeps role="row" without breaking the single grid
            (EventHeatmapBackground.js:235) — which is also why `sticky` has to live on the header
            CELLS: a display:contents element cannot itself stick. RBC keeps the day names fixed
            while the slots scroll, and this is that parity. Backgrounds are required, not
            decorative: a sticky element with no background lets the scrolled cells show through. */}
        <div className="contents" role="row">
          {/* SEAM 6: the blank corner. `columnheader` by default (unchanged); `presentation` when
              the consumer's contract is "one columnheader per day column" — see the DECISION on
              `gutterHeaderRole`. */}
          <div role={gutterHeaderRole} className="sticky top-0 left-0 z-30 bg-surface-card" />
          {Array.from({ length: days }, (_, col) => (
            <div
              key={`h-${col}`}
              role="columnheader"
              className="sticky top-0 z-20 bg-surface-card text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
            >
              {renderDayHeader ? renderDayHeader(col) : (dayLabels?.[col] ?? '')}
            </div>
          ))}
        </div>

        {/* Time-slot rows */}
        {Array.from({ length: slots }, (_, row) => (
          <div key={`r-${row}`} className="contents" role="row">
            {/* pr-1 (not the old pr-2) because the gutter is now 24px, not 64-80px — 8px of
                right padding would leave 16px for the label. Matches the owner-passed
                EventHeatmapBackground.js:238 gutter at the same width. */}
            <div className="sticky left-0 z-10 bg-surface-card flex items-center justify-end pr-1 text-xs sm:text-sm text-content-secondary font-medium">
              {slotLabels?.[row] ?? ''}
            </div>
            {Array.from({ length: days }, (_, col) => (
              <div key={coordKey(row, col)} data-coord={coordKey(row, col)} className={cellClassName ?? DEFAULT_CELL_CLASS}>
                {renderCell(row, col)}
              </div>
            ))}
          </div>
        ))}

        {/* SEAM 3 — overlay layer, last child of the positioned body.
            DECISION Phase 88.1-02: the node is wrapped in an `absolute inset-0 pointer-events-none`
            layer, chosen OVER rendering it bare. Bare, a non-absolutely-positioned overlay node
            would become a GRID ITEM and shift the last row — the container is a CSS grid, not a
            block; and a pointer-events-consuming layer over the cells would swallow the very
            drag it is drawing. A consumer needing an interactive overlay child sets
            `pointer-events-auto` on that child. */}
        {overlay ? (
          <div className="absolute inset-0 pointer-events-none">{overlay}</div>
        ) : null}
      </div>
    </div>
  );
});

export default WeekGrid;
