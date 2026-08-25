// src/app/components/heatmap/usePaintGesture.ts
//
// Headless long-press paint/drag gesture engine (88.1 D-01a, Req 5).
//
// This is an EXTRACTION of the shipped Phase 87.8-14 touch machine that lives inline in
// `AvailabilityGrid.js:341-594`, not a fresh implementation. Every one of the four traps
// encoded below (implicit pointer capture, static CSS pan-suppression killing native scroll,
// the stationary-finger rAF gap, memo stability) cost a walkthrough round to discover, so the
// mechanism is carried over unchanged in substance and the original DECISION marker is
// reproduced verbatim-in-meaning at the bottom of this block.
//
// Semantics-agnostic by design, exactly like `useHeatmapCell`: this hook does NOT know what a
// "cell" is, what attribute identifies one, what a commit means, or what scrolls. It owns the
// pointer STATE MACHINE and nothing else. Three things the shipped copy hardcoded are injected
// here instead:
//
//   1. `resolvePoint(x, y)` — cell resolution. The check-in grid resolves its own slot
//      attribute; the week grid resolves its own coordinate attribute (RESEARCH C11). Injecting
//      the resolver means NEITHER consumer has to change its attribute, which is what keeps
//      `e2e/availability-grid-touch.spec.ts` passing untouched (D-02 requires that).
//   2. Both scroll axes (RESEARCH C10 — a correctness fix, not a generalization). The shipped
//      copy scrolls the WINDOW vertically because the check-in grid is a full-page surface. The
//      scheduler lives inside a Radix dialog whose content is `overflow-hidden`
//      (`Modal.tsx:186`) with the body `overflow-y-auto` (`Modal.tsx:289`), where a window
//      scroll does nothing or scrolls the page BEHIND the modal (pitfall P4). The vertical
//      default is the window, so the Phase 92 re-point of AvailabilityGrid is a
//      no-behavior-change swap.
//   3. The edge-band bounds source. The shipped copy band-checks against the viewport; inside a
//      dialog the meaningful band is the scroll container's rect.
//
// ATTACHMENT SHAPE: grid-level delegation — the returned handlers go on ONE container element,
// never per cell (RESEARCH C11). That is what the week grid already does, what point-based
// resolution is inherently suited to, and what preserves the React.memo guarantee on ~196-392
// cells that the shipped marker calls "the smooth/janky boundary on a phone".
//
// -----------------------------------------------------------------------------------------
// DECISION Phase 87.8 (TOUCH): touch gets a LONG-PRESS (~300ms) paint model —
// plain drag scrolls natively (both axes), tap commits ONE target on finger-UP,
// hold-then-drag paints — chosen OVER (b) plain-drag-paints with gutter-only
// scrolling (the shipped defect: scroll was only reachable from the 16px page
// gutters, which the owner found by feel) and OVER (c) a paint/scroll mode-toggle
// button (extra chrome; a mode the user must remember). Matches the Google/Apple
// Calendar convention. Owner ruling 2026-08-02 (model a).
//
// Mechanism notes a future editor must not "clean up":
// - NO static CSS pan-suppression anywhere on the grid or its cells. (The CSS
//   property is deliberately not named in this file so 88.1-03's grep gate can
//   prove it is absent.) Native scroll is suppressed ONLY while the gesture is
//   ACTIVE, via the NON-PASSIVE touchmove listener installed by `gestureRef`
//   below — the static CSS property is evaluated at gesture start and cannot be
//   conditional. Re-adding it to any cell re-kills scrolling on the whole surface.
// - Painting resolves targets with `document.elementFromPoint` (see
//   `pointResolver` below), NOT pointerenter: touch implicitly captures the
//   pointer to the first cell touched, so enter events never fire on neighbours.
//   Point resolution is the standard workaround; a non-cell resolution is a
//   no-op, never a throw.
// - EDGE AUTO-SCROLL: while active, a finger held in the container's ~48px edge
//   band auto-scrolls slowly AND KEEPS PAINTING (owner requirement 2026-08-02:
//   paint 10am-to-7pm in one gesture on a screen that shows 10-to-5). THE TRAP: a
//   stationary finger fires NO pointermove events while content scrolls beneath
//   it — so the rAF loop below drives BOTH the scroll and the resolve step at the
//   last-known finger coords. Painting driven only from the pointermove handler
//   would scroll without painting.
// - CALLBACK STABILITY: everything this hook returns is referentially stable for
//   the life of the component (live props are read through `argsRef`), so a
//   consumer can hand the handlers to memoized children without re-rendering
//   them on every drag frame. Rebuilding the handlers per render silently
//   regresses React.memo on every cell — that memo working is the smooth/janky
//   boundary on a phone, not a micro-optimization.
// -----------------------------------------------------------------------------------------
//
// DECISION Phase 88.1-03 (D-01a/D-02): this file is an EXTRACTION of the machine above, and the
// check-in grid deliberately KEEPS its inline copy for now — two implementations of the
// owner-ruled touch model exist in the interim, on purpose. Convergence is owner-ruled
// (2026-08-22) to Phase 92, with a durable entry at `.planning/deferred/phase-92.md`. Do NOT
// "finish the job" by re-pointing `AvailabilityGrid.js` at this hook outside that phase: that
// grid is owner-walked and verified, and 88.1's SPEC scopes it out. The one substantive change
// from the shipped copy is the C10 scroll-target/bounds parameterization described above.
//
// -----------------------------------------------------------------------------------------
// TWO COMMIT SHAPES, ONE MACHINE (`mode`) — RESEARCH P6 / A4.
//
// The shipped scheduler got mouse drag-select for free from react-big-calendar's
// `selectable` + `onSelectSlot` (`EventScheduler.js:501-502`), which reports a start/end PAIR
// and feeds the Phase 66-01 contract `onTimeSelected(start, end)` — one canonical `start_date`
// plus `duration_minutes` (`createEvent.js:64-95`). WeekGrid has only per-cell PAINT
// (`WeekGrid.tsx` delegated pointer handlers), which is a different gesture: paint commits per
// cell, range-select commits a pair. Dropping RBC without building the range machine would
// silently leave desktop drag broken, so it is front-loaded here:
//
//   - `mode: 'range'` — pointerdown ANCHORS, movement EXTENDS and reports the live
//     `(anchor, current)` pair through `onExtend` so the consumer can draw a selection
//     rectangle, pointerup COMMITS once through `onCommit`. No per-cell callback fires.
//   - `mode: 'paint'` — what the check-in grid does today: each newly-entered target fires
//     `onEnter` and the commit is implicit. Kept verbatim so the Phase 92 re-point is a swap.
//
// RESEARCH A4 (MEDIUM confidence) said "mouse drag-select is genuinely absent from WeekGrid" —
// a read of intent, not of a missing function. Confirmed on inspection while writing this arm:
// WeekGrid's paint path calls `cyclePreference` per entered coord and has no notion of an
// anchor, so it cannot express a range; this arm is the resolution, not a second mechanism.
//
// `mode` is REQUIRED rather than defaulted to 'paint' — a scheduler wiring that forgot it would
// otherwise compile, fire per-cell callbacks and quietly re-create exactly the P6 defect this
// arm exists to prevent. A missing discriminator must be a type error, not a runtime surprise.
//
// AMENDED (C2, a deliberate BEHAVIOR CHANGE, not parity): the shipped scheduler long-press is
// 250ms (`EventScheduler.js:214`, Phase 68-03 MOB-07); adopting the owner-ruled 87.8-14 model
// moves it to the 300ms threshold above. The shipped 250ms machine also has NO slop cancellation
// and NO edge auto-scroll, so the swap is a strict improvement — but it is still a change, and
// per pitfall P5 NO characterization pin may assert either timer value. Pins assert behavior
// relative to the threshold (before/after), never the number.
// -----------------------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef } from 'react';

/** Long-press threshold before a touch gesture engages. */
export const LONG_PRESS_MS = 300;
/** Movement past this distance before the threshold cancels the gesture (native scroll wins). */
export const SLOP_PX = 8;
/** Depth of the auto-scroll band measured in from each edge of the bounds. */
export const EDGE_BAND_PX = 48;
/** Max px scrolled per frame at full band depth — slow by design. */
export const EDGE_MAX_STEP_PX = 6;

/**
 * The pointer-event fields this machine reads. Structural on purpose: React's synthetic
 * `PointerEvent` and the DOM's native one both satisfy it, so the same handlers serve the
 * spread-onto-JSX path and the document-level settle listeners.
 */
export interface GesturePointerEvent {
  pointerId: number;
  pointerType?: string;
  clientX: number;
  clientY: number;
  /**
   * Which button produced the press. React's synthetic `PointerEvent` and the DOM's native one
   * BOTH supply it, so the structural contract above still holds for both call paths; it is
   * optional only so hand-rolled points (every fixture in `usePaintGesture.test.ts`) stay valid.
   * ABSENT MEANS PRIMARY — see the filter in `onPointerDown`.
   */
  button?: number;
}

/** Edge-band bounds in CLIENT coordinates (same space as `clientX`/`clientY`). */
export interface GestureBounds {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Injected scroll targets + bounds for the edge auto-scroll loop (RESEARCH C10).
 *
 * Omit the whole object to get the shipped 87.8-14 behavior: vertical scrolling on the window,
 * no horizontal scrolling, bands measured against the viewport.
 */
export interface EdgeScrollTargets {
  /** Scroll the vertical axis by `dy` px. Defaults to the window (see `defaultScrollVerticalBy`). */
  scrollVerticalBy?: (dy: number) => void;
  /** Scroll the horizontal axis by `dx` px. No default — omit for a vertical-only surface. */
  scrollHorizontalBy?: (dx: number) => void;
  /** Client-space rect the edge bands are measured from. Defaults to the viewport. */
  getBounds?: () => GestureBounds;
}

/**
 * Which commit shape the consumer wants. See "TWO COMMIT SHAPES, ONE MACHINE" in the file header.
 * - `'paint'` — per-cell: every newly-entered target fires `onEnter`.
 * - `'range'` — anchor → extend → commit: `onExtend` reports the live pair, `onCommit` ends it.
 */
export type PaintGestureMode = 'paint' | 'range';

export interface PaintGestureArgs<T> {
  /** Commit shape. Required on purpose — see the header note on why it is not defaulted. */
  mode: PaintGestureMode;
  /**
   * Resolve the client point (x, y) to a consumer-defined target, or null for "not a cell".
   * A null resolution is always a no-op, never an error. Build one with `pointResolver`.
   */
  resolvePoint: (x: number, y: number) => T | null;
  /**
   * PAINT MODE ONLY. Called for each newly-entered target while the gesture is active, including
   * the anchor at entry and the single target of a tap. Never fires in range mode.
   */
  onEnter?: (target: T) => void;
  /**
   * RANGE MODE ONLY. Called with the live `(anchor, current)` pair each time the extended range
   * changes — including once at entry, where anchor and current are the same target — so the
   * consumer can render a selection rectangle. Never fires in paint mode.
   */
  onExtend?: (anchor: T, current: T) => void;
  /**
   * Called EXACTLY ONCE at the end of a gesture that resolved at least one target, with the
   * anchor and the last-resolved target. Never called on `pointercancel`. This is the range
   * mode's commit; a paint consumer may ignore it or use it as a "drag finished" signal.
   */
  onCommit?: (anchor: T, current: T) => void;
  /**
   * Target identity, used to decide "newly entered". Defaults to `Object.is`, which is correct
   * for the string/number targets `pointResolver` produces. A resolver returning fresh objects
   * MUST pass a comparator or every frame will re-report the same cell.
   */
  isSameTarget?: (a: T, b: T) => boolean;
  /** When true, pointerdown is ignored outright — no timer, no state, no callbacks. */
  disabled?: boolean;
  /** Edge auto-scroll wiring (RESEARCH C10). */
  edgeScroll?: EdgeScrollTargets;
}

export interface PaintGestureHandlers {
  onPointerDown: (event: GesturePointerEvent) => void;
  onPointerMove: (event: GesturePointerEvent) => void;
  onPointerUp: (event: GesturePointerEvent) => void;
  onPointerCancel: (event: GesturePointerEvent) => void;
}

export interface PaintGestureResult {
  /**
   * Spread onto ONE container element (the grid body). Referentially stable for the life of the
   * component. `onPointerUp`/`onPointerCancel` are ALSO installed on `document` so a finger that
   * lifts outside the grid still settles; both paths are idempotent (the first one to run tears
   * the state down, the second finds nothing and returns).
   */
  handlers: PaintGestureHandlers;
  /**
   * Callback ref for the element that must stop scrolling while the gesture is active. Installs
   * the NON-PASSIVE touchmove suppressor. Point it at the SCROLLING element.
   */
  gestureRef: (node: HTMLElement | null) => void;
}

/**
 * Build a `resolvePoint` that maps a client point to the value of `attribute` on the nearest
 * ancestor element carrying it. This is where `document.elementFromPoint` lives — the attribute
 * name is a parameter precisely so no consumer's attribute is hardcoded into the shared machine
 * (RESEARCH C11).
 */
export function pointResolver(attribute: string): (x: number, y: number) => string | null {
  return (x, y) => {
    if (typeof document === 'undefined') return null;
    const el = document.elementFromPoint?.(x, y);
    const cell = el?.closest?.(`[${attribute}]`);
    return cell?.getAttribute(attribute) ?? null;
  };
}

/**
 * Default vertical scroll target: the window.
 *
 * DOCUMENTED DEFAULT FALLBACK — this is the shipped 87.8-14 behavior (`AvailabilityGrid.js:432`),
 * kept as the default so the Phase 92 re-point of the check-in grid is a no-behavior-change swap.
 * Any consumer inside a dialog MUST override it (pitfall P4).
 */
const defaultScrollVerticalBy = (dy: number) => {
  if (typeof window !== 'undefined') window.scrollBy(0, dy);
};

/** Default bounds: the viewport, matching the shipped copy's band checks. */
const defaultGetBounds = (): GestureBounds => ({
  top: 0,
  left: 0,
  bottom: typeof window === 'undefined' ? 0 : window.innerHeight,
  right: typeof window === 'undefined' ? 0 : window.innerWidth,
});

interface GestureState<T> {
  pointerId: number;
  pointerType: string;
  /** Target resolved at pointerdown — the tap target and the anchor candidate. */
  downTarget: T | null;
  anchor: T | null;
  current: T | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  timer: ReturnType<typeof setTimeout> | null;
  /** True once the machine has ENGAGED (long-press fired, or a mouse pressed down). */
  active: boolean;
}

/**
 * Headless long-press paint gesture. See the file header for the mechanism notes and the
 * 87.8 owner ruling.
 */
export function usePaintGesture<T>(args: PaintGestureArgs<T>): PaintGestureResult {
  // Latest-props mirror (the `modelRef` idiom from `AvailabilityGrid.js` / `WeekGrid.tsx:267`):
  // everything returned below is built once with no dependencies and reads live values here, so
  // handler identity never churns and memoized cells never re-render mid-drag.
  const argsRef = useRef(args);
  argsRef.current = args;

  const stateRef = useRef<GestureState<T> | null>(null);
  const rafRef = useRef<number | null>(null);
  const nodeRef = useRef<HTMLElement | null>(null);

  // THE SINGLE `resolvePoint` CALL PATH. Every arm of the machine — pointerdown, pointermove and
  // the rAF tick — funnels through here, so mouse and touch can never drift onto different
  // resolution strategies (which is exactly what C11 flags in the two shipped grids).
  const resolveAt = useCallback((x: number, y: number): T | null => {
    return argsRef.current.resolvePoint(x, y) ?? null;
  }, []);

  const stopEdgeLoop = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  /** Tear down the in-flight gesture (timer, state, edge loop). Commits nothing. */
  const teardown = useCallback(() => {
    const st = stateRef.current;
    if (st?.timer) clearTimeout(st.timer);
    stateRef.current = null;
    stopEdgeLoop();
  }, [stopEdgeLoop]);

  /**
   * Report a resolved target. Sets the anchor on first resolution, dedupes repeats (the rAF loop
   * re-resolves every frame at a stationary finger) and dispatches to the mode's callback: paint
   * reports the entered cell, range reports the extended pair.
   */
  const applyTarget = useCallback((next: T | null) => {
    const st = stateRef.current;
    if (!st || !st.active || next == null) return;
    const { mode, onEnter, onExtend, isSameTarget } = argsRef.current;
    const same = isSameTarget ?? Object.is;
    if (st.current != null && same(st.current, next)) return;
    st.current = next;
    if (st.anchor == null) st.anchor = next;
    if (mode === 'range') onExtend?.(st.anchor, next);
    else onEnter?.(next);
  }, []);

  /**
   * Edge auto-scroll loop. Runs only while the gesture is active AND the pointer sits inside an
   * edge band. Each tick scrolls a few px (scaled with depth into the band) and RE-RESOLVES at
   * the last-known coords — the finger is stationary, so no pointermove will do it for us.
   */
  const maybeRunEdgeLoop = useCallback(() => {
    if (rafRef.current != null) return; // already running
    const step = (depth: number) =>
      Math.max(1, Math.round((Math.min(depth, EDGE_BAND_PX) / EDGE_BAND_PX) * EDGE_MAX_STEP_PX));
    const tick = () => {
      const st = stateRef.current;
      if (!st || !st.active) {
        rafRef.current = null;
        return;
      }
      const edge = argsRef.current.edgeScroll;
      const bounds = (edge?.getBounds ?? defaultGetBounds)();
      const scrollY = edge?.scrollVerticalBy ?? defaultScrollVerticalBy;
      const scrollX = edge?.scrollHorizontalBy;
      let dy = 0;
      let dx = 0;
      if (st.lastY < bounds.top + EDGE_BAND_PX) dy = -step(bounds.top + EDGE_BAND_PX - st.lastY);
      else if (st.lastY > bounds.bottom - EDGE_BAND_PX)
        dy = step(st.lastY - (bounds.bottom - EDGE_BAND_PX));
      if (st.lastX < bounds.left + EDGE_BAND_PX) dx = -step(bounds.left + EDGE_BAND_PX - st.lastX);
      else if (st.lastX > bounds.right - EDGE_BAND_PX)
        dx = step(st.lastX - (bounds.right - EDGE_BAND_PX));
      if (dy === 0 && dx === 0) {
        // Pointer left the band — stop the loop; the next pointermove restarts it.
        rafRef.current = null;
        return;
      }
      if (dy !== 0) scrollY(dy);
      if (dx !== 0 && scrollX) scrollX(dx);
      applyTarget(resolveAt(st.lastX, st.lastY));
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
  }, [applyTarget, resolveAt]);

  /** Long-press fired within slop (or a mouse pressed down): ENGAGE. */
  const engage = useCallback(() => {
    const st = stateRef.current;
    if (!st) return;
    st.timer = null;
    st.active = true;
    // Haptic tick on the touch path only — a mouse press has no hold to acknowledge.
    if (st.pointerType === 'touch' && typeof navigator !== 'undefined') navigator.vibrate?.(10);
    applyTarget(st.downTarget);
  }, [applyTarget]);

  /**
   * Settle the gesture. `commit === false` is the pointercancel path: the browser took the
   * gesture (native scroll), so nothing is committed in EITHER the pending or the active state.
   */
  const finish = useCallback(
    (commit: boolean) => {
      const st = stateRef.current;
      if (!st) return;
      if (commit) {
        if (!st.active && st.timer) {
          // TAP: finger up before the threshold. Commit the ONE recorded target on finger-up —
          // how every native list behaves, and what distinguishes a tap from a scroll.
          clearTimeout(st.timer);
          st.timer = null;
          st.active = true;
          applyTarget(st.downTarget);
        }
        if (st.anchor != null && st.current != null) {
          argsRef.current.onCommit?.(st.anchor, st.current);
        }
      }
      teardown();
    },
    [applyTarget, teardown]
  );

  const onPointerDown = useCallback(
    (event: GesturePointerEvent) => {
      if (argsRef.current.disabled) return;
      // DECISION Phase 88.1-20 (WR-01): non-primary presses are dropped HERE, at the gesture's
      // entry point, and NOWHERE ELSE. Without this a right-click on a slot opened the context
      // menu AND wrote the event's start time — `onPointerUp` commits for any press once a
      // gesture is live. Absent-means-primary is required, not incidental: every fixture at
      // `usePaintGesture.test.ts` omits the field, and touch contact reports 0, so touch is
      // unaffected either way.
      // Chosen OVER filtering every handler (rejected: `pointercancel` carries -1 by spec, so a
      // filter there would stop cancellation outright, and gating `onPointerMove` would re-fork
      // the mouse and touch arms — the NOTE (C11) below exists to prevent exactly that).
      // Chosen OVER suppressing the context menu instead (rejected: that changes browser
      // behaviour the user expects; the defect is that a right-click COMMITS, not that a menu
      // opens).
      // POSITION IS LOAD-BEARING: this sits ABOVE the stale-gesture `teardown()`, so a
      // non-primary press arriving mid-drag cannot destroy a live primary gesture. Pinned.
      if ((event.button ?? 0) !== 0) return;
      if (stateRef.current) teardown(); // stale-gesture safety
      const pointerType = event.pointerType ?? 'mouse';
      stateRef.current = {
        pointerId: event.pointerId,
        pointerType,
        downTarget: resolveAt(event.clientX, event.clientY),
        anchor: null,
        current: null,
        startX: event.clientX,
        startY: event.clientY,
        lastX: event.clientX,
        lastY: event.clientY,
        timer: null,
        active: false,
      };
      if (pointerType === 'touch') {
        // Nothing commits yet: a tap commits on finger-UP, and movement past slop hands the
        // gesture back to the browser so the surface scrolls natively.
        stateRef.current.timer = setTimeout(engage, LONG_PRESS_MS);
        return;
      }
      // Mouse (and synthetic test events with no pointerType) engage immediately — the ONLY
      // difference between the two input types is this entry condition.
      engage();
    },
    [engage, resolveAt, teardown]
  );

  const onPointerMove = useCallback(
    (event: GesturePointerEvent) => {
      const st = stateRef.current;
      if (!st || event.pointerId !== st.pointerId) return;
      st.lastX = event.clientX;
      st.lastY = event.clientY;
      if (!st.active) {
        if (st.timer && Math.hypot(event.clientX - st.startX, event.clientY - st.startY) > SLOP_PX) {
          // Slop exceeded before the threshold: cancel. The browser owns the pan from here
          // (expect a pointercancel when scroll takes over).
          teardown();
        }
        return;
      }
      // NOTE (C11): unlike the shipped copy this handler is NOT gated on `pointerType === 'touch'`.
      // The mouse arm is routed through the same point resolution instead of per-cell enter
      // closures, which is what lets both input types share one resolver and one commit shape.
      applyTarget(resolveAt(event.clientX, event.clientY));
      maybeRunEdgeLoop();
    },
    [applyTarget, maybeRunEdgeLoop, resolveAt, teardown]
  );

  const onPointerUp = useCallback(
    (event: GesturePointerEvent) => {
      const st = stateRef.current;
      if (!st || event.pointerId !== st.pointerId) return;
      finish(true);
    },
    [finish]
  );

  const onPointerCancel = useCallback(
    (event: GesturePointerEvent) => {
      const st = stateRef.current;
      if (!st || event.pointerId !== st.pointerId) return;
      finish(false);
    },
    [finish]
  );

  // NON-PASSIVE touchmove suppressor — the CONDITIONAL scroll blocker. While the gesture is
  // active (and ONLY then) preventDefault stops the native pan so the drag paints instead of
  // scrolling. It has to be registered by hand with `{ passive: false }`: React's synthetic
  // touchmove listener is passive, and the static CSS alternative cannot be conditional.
  const onNativeTouchMove = useCallback((event: Event) => {
    if (stateRef.current?.active) event.preventDefault();
  }, []);

  const gestureRef = useCallback(
    (node: HTMLElement | null) => {
      if (nodeRef.current === node) return;
      nodeRef.current?.removeEventListener('touchmove', onNativeTouchMove);
      nodeRef.current = node;
      node?.addEventListener('touchmove', onNativeTouchMove, { passive: false });
    },
    [onNativeTouchMove]
  );

  // Document-level settle listeners: end the gesture wherever the pointer lands, inside the grid
  // or outside it. Idempotent with the returned handlers — whichever runs first tears the state
  // down and the other finds nothing.
  useEffect(() => {
    const handleUp = (event: PointerEvent) => onPointerUp(event);
    const handleCancel = (event: PointerEvent) => onPointerCancel(event);
    document.addEventListener('pointerup', handleUp);
    document.addEventListener('pointercancel', handleCancel);
    return () => {
      document.removeEventListener('pointerup', handleUp);
      document.removeEventListener('pointercancel', handleCancel);
    };
  }, [onPointerCancel, onPointerUp]);

  // Unmount safety: never leave a live timer or rAF loop behind. A leaked rAF loop re-resolves
  // every frame for the life of the page (threat T-88.1-06).
  useEffect(
    () => () => {
      teardown();
      nodeRef.current?.removeEventListener('touchmove', onNativeTouchMove);
      nodeRef.current = null;
    },
    [onNativeTouchMove, teardown]
  );

  return useMemo(
    () => ({
      handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel },
      gestureRef,
    }),
    [gestureRef, onPointerCancel, onPointerDown, onPointerMove, onPointerUp]
  );
}

export default usePaintGesture;
