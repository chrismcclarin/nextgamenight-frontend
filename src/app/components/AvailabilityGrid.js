'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'; // useState kept for paintMode
import { format, addDays, addMinutes, startOfWeek, nextMonday, parseISO } from 'date-fns';
// BUG-01 / F-810: slot instants are generated against the PROFILE timezone via
// the Phase 84 date-fns-tz layer (v2-pinned, test-pinned); the test suite
// asserts the reverse parse (utcToWallClock) lands on the same wall-clock
// hour/day. Relative (not `@/`) import so this `.js` component resolves under
// vitest — mirrors AvailabilityForm's `../../lib/api` note.
import { wallClockToUtc } from '../../lib/datetime';
import WriteCell from './heatmap/WriteCell';

// Zero-pad an hour/minute to two digits for the "yyyy-MM-ddTHH:mm" wall-clock
// string handed to wallClockToUtc. Module-level (stable identity, no deps).
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * AvailabilityGrid - Paint-to-select availability grid component
 *
 * Displays an N-day x 28-slot grid (10:00 AM - 11:30 PM, 30-min intervals)
 * Users can click-and-drag to paint time slots
 *
 * @param {Object} props
 * @param {Array} props.value - Array of { slotId, preference } from RHF Controller
 * @param {function} props.onChange - RHF field.onChange
 * @param {string} props.timezone - User's detected timezone (IANA)
 * @param {boolean} props.disabled - When "I'm unavailable" is checked
 * @param {Date} props.weekStartDate - Optional: override start date (defaults to next Monday)
 * @param {number} props.numDays - Optional: column count, default 7. Plan 71-05
 *   POLL-01 passes the poll's date_window length (1-14 days). The "Select All"
 *   day-checkbox UX still works because it just iterates days[].
 */
export default function AvailabilityGrid({
  value = [],
  onChange,
  timezone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  disabled = false,
  weekStartDate,
  numDays = 7,
}) {
  // Ref for drag state — must be a ref (not state) so pointer events read the
  // latest value synchronously without waiting for a re-render
  const isDraggingRef = useRef(false);
  const [paintMode, setPaintMode] = useState('preferred'); // 'preferred' | 'if-need-be'
  const gridRef = useRef(null);

  // ARIA grid roving tabindex (84-10 / F-803/809): AvailabilityGrid is one of
  // the three roving keyboard INPUT grids. The nav-key + select state machine
  // lives in the shared WriteCell/useHeatmapCell engine; this container owns
  // focusedCoord {row,col} + a cellRefs map keyed by "row:col" and drives REAL
  // DOM focus on each cell's onMove (mirroring WeekGrid).
  const coordKey = (row, col) => `${row}:${col}`;
  const cellRefs = useRef(new Map());
  const refCallbacks = useRef(new Map());
  const [focusedCoord, setFocusedCoord] = useState({ row: 0, col: 0 });
  const getCellRef = useCallback((key) => {
    let cb = refCallbacks.current.get(key);
    if (!cb) {
      cb = (node) => {
        if (node) cellRefs.current.set(key, node);
        else cellRefs.current.delete(key);
      };
      refCallbacks.current.set(key, cb);
    }
    return cb;
  }, []);
  const handleCellMove = useCallback((row, col) => {
    setFocusedCoord({ row, col });
    cellRefs.current.get(coordKey(row, col))?.focus();
  }, []);

  // Calculate the week start date (next Monday if not provided)
  const weekStart = useMemo(() => {
    if (weekStartDate) {
      return new Date(weekStartDate);
    }
    const now = new Date();
    return nextMonday(now);
  }, [weekStartDate]);

  // Generate N days starting from weekStart. numDays defaults to 7 so all
  // existing callers (recurring-schedule magic-token form) keep their shape;
  // Plan 71-05 polls pass the variable-length date_window count.
  const days = useMemo(() => {
    return Array.from({ length: numDays }, (_, i) => addDays(weekStart, i));
  }, [weekStart, numDays]);

  // Generate 28 time slots (10:00 AM - 11:30 PM, 30-min intervals).
  // Matches EventScheduler.js's defaultMinTime/defaultMaxTime range so that
  // the slots a user can vote on cover the same window they can pick when
  // creating an event from the poll's results.
  const timeSlots = useMemo(() => {
    return Array.from({ length: 28 }, (_, i) => {
      const baseHour = 10; // 10:00 AM
      const minutes = i * 30;
      const hour = baseHour + Math.floor(minutes / 60);
      const min = minutes % 60;
      return { hour, minute: min };
    });
  }, []);

  // Convert value array to a map for efficient lookup
  const slotMap = useMemo(() => {
    const map = new Map();
    value.forEach(({ slotId, preference }) => {
      map.set(slotId, preference);
    });
    return map;
  }, [value]);

  // Generate slot ID from date and time.
  //
  // BUG-01 / F-810 fix: build a wall-clock string in the PROFILE timezone and
  // convert to a UTC instant via the existing date-fns-tz layer, instead of the
  // old browser-local `setHours`/`toISOString` (which corrupted the persisted
  // instant whenever the profile TZ differed from the browser TZ). Kept as a
  // routed-through-wallClockToUtc function, but it is invoked ONCE per
  // [days, timeSlots, timezone] change to build `slotIdGrid` below — NOT inline
  // per cell per render or per pointermove (see the memoized map).
  const generateSlotId = useCallback(
    (day, timeSlot) => {
      const wall = `${format(day, 'yyyy-MM-dd')}T${pad2(timeSlot.hour)}:${pad2(timeSlot.minute)}`;
      const utc = wallClockToUtc(wall, timezone);
      // wallClockToUtc returns null only on a degenerate/invalid profile TZ. Do
      // NOT fall back to `new Date(wall)` — that parses the wall string in the
      // BROWSER-local TZ, which reintroduces the exact BUG-01/F-810 corruption
      // (the same slot would persist a different UTC instant for each viewer).
      // Interpret the wall string as UTC instead: deterministic and viewer-
      // independent, so a bad TZ can never silently emit a browser-relative instant.
      return (utc || new Date(`${wall}:00Z`)).toISOString();
    },
    [timezone]
  );

  // Precompute the whole grid's slot-id mapping ONCE per [days, timeSlots,
  // timezone] change. The heavy TZ conversion (wallClockToUtc) runs O(cells)
  // here — never inline on the per-cell render loop or the paint/pointermove
  // handlers, which instead READ from this map ("dayIndex:timeSlotIndex" ->
  // slotId). `timezone` is a transitive dependency via generateSlotId, so the
  // precomputed ids invalidate and regenerate when the profile TZ changes.
  // (The reverse byId map that once fed the cross-day handlers' slot-id parsing
  // left with the broadcast — see the DECISION marker below. The F-810
  // write-side guarantee lives entirely in generateSlotId, and the test suite
  // pins the reverse parse externally via utcToWallClock.)
  const slotIdGrid = useMemo(() => {
    const byCoord = new Map();
    days.forEach((day, dayIndex) => {
      timeSlots.forEach((ts, timeSlotIndex) => {
        byCoord.set(`${dayIndex}:${timeSlotIndex}`, generateSlotId(day, ts));
      });
    });
    return { byCoord };
  }, [days, timeSlots, generateSlotId]);

  // O(1) forward lookup: the render loop and paint/toggle/clear handlers read
  // slot ids from here instead of invoking the TZ conversion inline.
  const slotIdForCoord = useCallback(
    (dayIndex, timeSlotIndex) => slotIdGrid.byCoord.get(`${dayIndex}:${timeSlotIndex}`),
    [slotIdGrid]
  );

  // DECISION Phase 87.8 (SPEC R9): day checkboxes are DERIVED two-way mirrors of
  // the painted grid (checked ⟺ every slot in the day's column is painted, any
  // preference tier) plus a bulk fill/clear affordance — with NO cross-day
  // linkage of any kind. Chosen OVER (a) the stateful checked-day-driver design
  // this plan originally specified (rejected by owner ruling 2026-08-02: the
  // cross-day "checked days edit together" broadcast it preserved was a
  // misrouted feature — two similarly-named features, profile *availability* vs
  // weekly *check-in*, were historically conflated, and the multi-day request
  // behind the broadcast belongs to PROFILE availability, where Phase 48-01
  // already shipped day-pill multi-select — userProfile/page.js:826) and OVER
  // (b) any future "re-add linked days here". Derived state cannot desync: the
  // 2026-05-16 "checkbox stays checked after Clear All" bug is impossible by
  // construction. Re-adding a broadcast here is a product decision, not a
  // restoration.
  const dayFull = useMemo(
    () =>
      days.map((_, dayIndex) =>
        timeSlots.every((_, timeSlotIndex) => {
          const id = slotIdForCoord(dayIndex, timeSlotIndex);
          return !!id && slotMap.has(id);
        })
      ),
    [days, timeSlots, slotIdForCoord, slotMap]
  );

  // Derived: are all days checked? Sized to numDays so the Plan 71-05 polls
  // (1-14 day windows) compute "All" correctly for any window length.
  const allChecked = dayFull.length === numDays && dayFull.every(Boolean);

  // Per-day "All" column checkbox — bulk fill/clear for that day only.
  //
  // HISTORY (re-authored 2026-08-02): the Plan 71-05 manual-checkpoint Bug 1
  // (round 2) fix made this handler paint/clear the day column (previously it
  // only flipped the checked-day state array, producing an empty submit + "You
  // haven't selected a timeframe" error) AND kept that state in sync so
  // subsequent clicks broadcast across checked days. The owner ruling of
  // 2026-08-02 SUPERSEDED that paint/check-driver semantics: the cross-day
  // broadcast was a misrouted feature belonging to profile availability
  // (shipped there by Phase 48-01), so the state array is deleted entirely
  // — no trace of it remains in code. The paint-on-check
  // expectation 71-05 established still stands.
  //
  // CURRENT RULE: checked state is DERIVED (`dayFull`) — this handler only
  // edits the selection. Day not full -> paint its empty slots with the current
  // paintMode; day full -> remove all of its slots. The mirror updates itself
  // on the next render; no gesture here (or anywhere) writes to another day.
  //
  // Declared AFTER days/timeSlots/generateSlotId because the callback closes
  // over them; declaring earlier triggers a TDZ ReferenceError at render.
  const toggleDayCheck = useCallback((dayIndex) => {
    const day = days[dayIndex];
    if (!day) return;
    if (dayFull[dayIndex]) {
      // Full (checkbox reads checked): remove every slot in this day column.
      const dayKeys = new Set(timeSlots.map((_, ti) => slotIdForCoord(dayIndex, ti)));
      const filtered = value.filter((s) => !dayKeys.has(s.slotId));
      if (filtered.length !== value.length) {
        onChange?.(filtered);
      }
    } else {
      // Not full: paint every empty slot in this day column.
      const additions = [];
      timeSlots.forEach((_, ti) => {
        const id = slotIdForCoord(dayIndex, ti);
        if (id && !slotMap.has(id)) {
          additions.push({ slotId: id, preference: paintMode });
        }
      });
      if (additions.length > 0) {
        onChange?.([...value, ...additions]);
      }
    }
  }, [days, dayFull, timeSlots, slotIdForCoord, slotMap, value, paintMode, onChange]);

  // Toggle Select All: when toggled ON, paint every visible slot with the
  // current paint mode (matches user expectation "All = I'm available for
  // everything in this window"). When toggled OFF, clear every painted slot.
  //
  // HISTORY (re-authored 2026-08-02): the Plan 71-05 manual-checkpoint Bug 1
  // fix made this paint on toggle (previously it only set the checked-day state
  // array without painting, so submitting after "All" failed validation with
  // "Pick at least one time slot") and kept that state in sync for the
  // cross-day broadcast.
  // The owner ruling of 2026-08-02 superseded the driver semantics — the
  // broadcast is removed and `allChecked` is now DERIVED from the painted grid
  // — but the paint-on-toggle expectation 71-05 established still stands.
  const toggleSelectAll = useCallback(() => {
    if (allChecked) {
      // Uncheck All clears every painted slot — symmetric with the check path.
      onChange?.([]);
    } else {
      // Paint every slot in the grid that isn't already painted.
      const additions = [];
      days.forEach((day, di) => {
        timeSlots.forEach((ts, ti) => {
          const id = slotIdForCoord(di, ti);
          if (id && !slotMap.has(id)) {
            additions.push({ slotId: id, preference: paintMode });
          }
        });
      });
      if (additions.length > 0) {
        onChange?.([...value, ...additions]);
      }
    }
  }, [allChecked, days, timeSlots, slotIdForCoord, slotMap, value, paintMode, onChange]);

  // Format time label for the row. Pure hour/minute -> "h:mm a" (byte-identical
  // to the prior `format(date, 'h:mm a')` output) with no `setHours` — the label
  // is a fixed time-of-day, independent of any date or timezone.
  const formatTimeLabel = useCallback((timeSlot) => {
    const h12 = timeSlot.hour % 12 || 12;
    const ampm = timeSlot.hour >= 12 ? 'PM' : 'AM';
    return `${h12}:${pad2(timeSlot.minute)} ${ampm}`;
  }, []);

  // 87.8-13 walkthrough F-7: compact phone-width label ("10:30p", the
  // EventHeatmapBackground idiom) — rendered sm:hidden beside the full label so
  // desktop output stays byte-identical while the phone gutter drops to w-12.
  const formatTimeLabelCompact = useCallback((timeSlot) => {
    const h12 = timeSlot.hour % 12 || 12;
    const ampm = timeSlot.hour >= 12 ? 'p' : 'a';
    return `${h12}:${pad2(timeSlot.minute)}${ampm}`;
  }, []);

  // Format day header
  const formatDayHeader = useCallback((day) => {
    return format(day, 'EEE M/d');
  }, []);

  // Get friendly timezone display name
  const getTimezoneDisplay = useCallback((tz) => {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        timeZoneName: 'short',
      });
      const parts = formatter.formatToParts(new Date());
      const tzPart = parts.find((p) => p.type === 'timeZoneName');
      return tzPart ? `${tz} (${tzPart.value})` : tz;
    } catch {
      return tz;
    }
  }, []);

  // CALLBACK STABILITY (Phase 87.8 TOUCH — see the DECISION marker below):
  // every handler passed to the memoized WriteCells reads CURRENT state off
  // this ref instead of closing over it, so the handlers keep empty dependency
  // arrays and never change identity mid-drag. Without this, `value` changes on
  // every paint tick -> handleToggleSlot/handlePaintSlot recreate -> every
  // cell's props go referentially unstable together -> React.memo on WriteCell
  // never short-circuits and all 196-392 cells re-render per painted cell —
  // exactly where a phone's frame budget is tightest. Assigned during render
  // (idempotent) so any handler firing after commit reads this render's state.
  const modelRef = useRef(null);
  modelRef.current = { value, slotMap, paintMode, onChange, days, timeSlots, slotIdGrid };

  // Handle slot toggle (click / tap-commit / long-press start). Strictly
  // single-cell: a tap on an empty cell adds that one slot with the current
  // paint mode; a tap on a painted cell removes that one slot. (The cross-day
  // ADD branch that used to live here left with the broadcast — see the
  // DECISION marker above.) Reads state via modelRef — identity is stable.
  const handleToggleSlot = useCallback((slotId) => {
    const { value, slotMap, paintMode, onChange } = modelRef.current;
    if (slotMap.get(slotId)) {
      onChange?.(value.filter((s) => s.slotId !== slotId));
    } else {
      onChange?.([...value, { slotId, preference: paintMode }]);
    }
  }, []);

  // Handle slot paint (drag — add only). Strictly single-cell, like toggle.
  const handlePaintSlot = useCallback((slotId) => {
    const { value, slotMap, paintMode, onChange } = modelRef.current;
    if (!slotMap.has(slotId)) {
      onChange?.([...value, { slotId, preference: paintMode }]);
    }
  }, []);

  // ---------------------------------------------------------------------------
  // DECISION Phase 87.8 (TOUCH): touch gets a LONG-PRESS (~300ms) paint model —
  // plain drag scrolls natively (both axes), tap commits ONE slot on finger-UP,
  // hold-then-drag paints — chosen OVER (b) plain-drag-paints with gutter-only
  // scrolling (the shipped defect: scroll was only reachable from the 16px px-4
  // page gutters, which the owner found by feel) and OVER (c) a paint/scroll
  // mode-toggle button (extra chrome; a mode the user must remember). Matches
  // the Google/Apple Calendar convention. Owner ruling 2026-08-02 (model a).
  //
  // Mechanism notes a future editor must not "clean up":
  // - NO static `touch-action: none` anywhere on the grid or its cells. Native
  //   scroll is suppressed ONLY while paint mode is active, via the NON-PASSIVE
  //   touchmove listener below (static CSS touch-action is evaluated at gesture
  //   start and cannot be conditional). Re-adding a static touch-action: none
  //   to any cell re-kills scrolling on the whole surface.
  // - Painting resolves cells with document.elementFromPoint, NOT pointerenter:
  //   touch implicitly captures the pointer to the first cell touched, so enter
  //   events never fire on neighbours. elementFromPoint is the standard
  //   workaround; a non-cell resolution is a no-op, never a throw.
  // - EDGE AUTO-SCROLL: while painting, a finger held in the viewport's
  //   top/bottom (or the grid's left/right) ~48px edge band auto-scrolls slowly
  //   AND KEEPS PAINTING (owner requirement 2026-08-02: paint 10am-to-7pm in
  //   one gesture on a screen that shows 10-to-5). THE TRAP: a stationary
  //   finger fires NO pointermove events while content scrolls beneath it — so
  //   the rAF loop below drives BOTH the scroll and the elementFromPoint paint
  //   step at the last-known finger coords. Painting driven only from the
  //   pointermove handler would scroll without painting.
  // - CALLBACK STABILITY: every prop WriteCell receives from this component is
  //   referentially stable across a paint drag (state is read via modelRef, and
  //   WriteCell reports its own row/col to the shared onSelect). Reintroducing
  //   per-render closures on these props silently regresses React.memo on all
  //   196-392 cells — that memo working is the smooth/janky boundary on a
  //   phone, not a micro-optimization.
  // ---------------------------------------------------------------------------
  const LONG_PRESS_MS = 300;
  const SLOP_PX = 8;
  const EDGE_BAND_PX = 48;
  const EDGE_MAX_STEP_PX = 6; // max px per frame at full band depth — slow by design

  // Active touch gesture state. Null when no touch gesture is in flight.
  // { pointerId, slotId, startX, startY, lastX, lastY, timer, painting }
  const touchRef = useRef(null);
  // requestAnimationFrame id for the edge auto-scroll loop (null = not running).
  const edgeLoopRef = useRef(null);

  const stopEdgeLoop = useCallback(() => {
    if (edgeLoopRef.current != null) {
      cancelAnimationFrame(edgeLoopRef.current);
      edgeLoopRef.current = null;
    }
  }, []);

  // Resolve the cell under (x, y) to its slotId and paint it. Non-cell targets
  // (labels, gaps, elements outside the grid) resolve to null — a no-op.
  const paintAtPoint = useCallback(
    (x, y) => {
      const el = document.elementFromPoint?.(x, y);
      const cell = el?.closest?.('[data-slot-id]');
      const slotId = cell?.getAttribute('data-slot-id');
      if (slotId) handlePaintSlot(slotId);
    },
    [handlePaintSlot]
  );

  // Edge auto-scroll loop: runs only while paint mode is active AND the finger
  // sits inside an edge band. Each tick scrolls a few px (scaled with depth
  // into the band) and re-paints at the last-known finger coords — the finger
  // is stationary, so no pointermove will do it for us.
  const maybeRunEdgeLoop = useCallback(() => {
    if (edgeLoopRef.current != null) return; // already running
    const step = (depth) =>
      Math.max(1, Math.round((Math.min(depth, EDGE_BAND_PX) / EDGE_BAND_PX) * EDGE_MAX_STEP_PX));
    const tick = () => {
      const st = touchRef.current;
      if (!st || !st.painting) {
        edgeLoopRef.current = null;
        return;
      }
      const vh = window.innerHeight;
      const vw = window.innerWidth;
      let dy = 0;
      let dx = 0;
      if (st.lastY < EDGE_BAND_PX) dy = -step(EDGE_BAND_PX - st.lastY);
      else if (st.lastY > vh - EDGE_BAND_PX) dy = step(st.lastY - (vh - EDGE_BAND_PX));
      if (st.lastX < EDGE_BAND_PX) dx = -step(EDGE_BAND_PX - st.lastX);
      else if (st.lastX > vw - EDGE_BAND_PX) dx = step(st.lastX - (vw - EDGE_BAND_PX));
      if (dx === 0 && dy === 0) {
        // Finger left the band — stop the loop; pointermove restarts it.
        edgeLoopRef.current = null;
        return;
      }
      if (dy !== 0) window.scrollBy(0, dy);
      if (dx !== 0 && gridRef.current) gridRef.current.scrollLeft += dx;
      paintAtPoint(st.lastX, st.lastY);
      edgeLoopRef.current = requestAnimationFrame(tick);
    };
    edgeLoopRef.current = requestAnimationFrame(tick);
  }, [paintAtPoint]);

  // Tear down the in-flight touch gesture (timer, paint mode, edge loop).
  const clearTouchGesture = useCallback(() => {
    const st = touchRef.current;
    if (st?.timer) clearTimeout(st.timer);
    touchRef.current = null;
    stopEdgeLoop();
  }, [stopEdgeLoop]);

  // Long-press timer fired within slop: enter PAINT MODE. Haptic tick where
  // supported, and toggle the pressed slot immediately for visual feedback
  // (mirrors the mouse path, where down toggles).
  const enterPaintMode = useCallback(() => {
    const st = touchRef.current;
    if (!st) return;
    st.timer = null;
    st.painting = true;
    if (typeof navigator !== 'undefined') navigator.vibrate?.(10);
    handleToggleSlot(st.slotId);
  }, [handleToggleSlot]);

  // Pointer down, split by pointerType (Phase 87.8 TOUCH):
  // - TOUCH: no toggle yet — record the slot + coords and start the long-press
  //   timer. A tap (up before the timer) commits on finger-UP; movement past
  //   slop cancels and hands the gesture to the browser (native scroll).
  // - MOUSE (and synthetic test events with no pointerType): exactly the
  //   pre-87.8-14 behavior — down toggles immediately, drag paints via enter.
  const handlePointerDown = useCallback(
    (slotId, e) => {
      if (e && e.pointerType === 'touch') {
        if (touchRef.current) clearTouchGesture(); // stale-gesture safety
        touchRef.current = {
          pointerId: e.pointerId,
          slotId,
          startX: e.clientX,
          startY: e.clientY,
          lastX: e.clientX,
          lastY: e.clientY,
          timer: setTimeout(enterPaintMode, LONG_PRESS_MS),
          painting: false,
        };
        return;
      }
      isDraggingRef.current = true;
      handleToggleSlot(slotId);
    },
    [clearTouchGesture, enterPaintMode, handleToggleSlot]
  );

  // Mouse drag-paint via enter events (touch never reaches here: the pointer is
  // implicitly captured to the first cell, so enter doesn't fire on neighbours
  // — and isDraggingRef is only set on the mouse path anyway).
  const handlePointerEnter = useCallback(
    (slotId) => {
      if (isDraggingRef.current) {
        handlePaintSlot(slotId);
      }
    },
    [handlePaintSlot]
  );

  const handlePointerUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  // Container-level pointermove: drives the touch state machine. Before the
  // timer fires, movement past slop cancels the gesture (browser owns the pan —
  // expect a pointercancel when scroll takes over). While painting, resolve the
  // cell under the finger and keep the edge auto-scroll loop fed.
  const handleGridPointerMove = useCallback(
    (e) => {
      const st = touchRef.current;
      if (!st || e.pointerType !== 'touch' || e.pointerId !== st.pointerId) return;
      st.lastX = e.clientX;
      st.lastY = e.clientY;
      if (!st.painting) {
        if (
          st.timer &&
          Math.hypot(e.clientX - st.startX, e.clientY - st.startY) > SLOP_PX
        ) {
          clearTouchGesture();
        }
        return;
      }
      paintAtPoint(e.clientX, e.clientY);
      maybeRunEdgeLoop();
    },
    [clearTouchGesture, paintAtPoint, maybeRunEdgeLoop]
  );

  // Keyboard select-cycle (WriteCell reports the NEXT preference after Enter/
  // Space plus its own row/col — the cell resolving its coords is what keeps
  // this ONE stable handler shared by every cell). Single-cell edit, like every
  // other gesture. next === null removes the slot.
  const handleCellSelect = useCallback((next, row, col) => {
    const { days, timeSlots, slotIdGrid, value, onChange } = modelRef.current;
    if (!days[col] || !timeSlots[row]) return;
    const slotId = slotIdGrid.byCoord.get(`${col}:${row}`);
    if (!slotId) return;
    const without = value.filter((s) => s.slotId !== slotId);
    onChange?.(next === null ? without : [...without, { slotId, preference: next }]);
  }, []);

  // Global pointer up/cancel listeners: end the mouse drag, and settle the
  // touch gesture wherever the finger lands (inside or outside the grid).
  // pointerup with the timer still pending = a TAP — commit the recorded slot
  // on finger-up (how every native list behaves; required to distinguish tap
  // from scroll). pointercancel = the browser took the gesture (native scroll)
  // — tear down with NO commit.
  useEffect(() => {
    const handleGlobalPointerUp = (e) => {
      isDraggingRef.current = false;
      const st = touchRef.current;
      if (st && e.pointerId === st.pointerId) {
        if (!st.painting && st.timer) {
          clearTimeout(st.timer);
          st.timer = null;
          handleToggleSlot(st.slotId);
        }
        clearTouchGesture();
      }
    };
    const handleGlobalPointerCancel = (e) => {
      isDraggingRef.current = false;
      const st = touchRef.current;
      if (st && e.pointerId === st.pointerId) {
        clearTouchGesture();
      }
    };

    document.addEventListener('pointerup', handleGlobalPointerUp);
    document.addEventListener('pointercancel', handleGlobalPointerCancel);

    return () => {
      document.removeEventListener('pointerup', handleGlobalPointerUp);
      document.removeEventListener('pointercancel', handleGlobalPointerCancel);
    };
  }, [clearTouchGesture, handleToggleSlot]);

  // NON-PASSIVE touchmove listener — the conditional scroll suppressor. While
  // paint mode is active (and ONLY then) preventDefault stops the native pan so
  // the drag paints instead of scrolling. Registered once with
  // { passive: false }; React's synthetic listeners are passive for touchmove,
  // and static CSS touch-action cannot express "none only while painting".
  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;
    const onTouchMove = (e) => {
      if (touchRef.current?.painting) e.preventDefault();
    };
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => el.removeEventListener('touchmove', onTouchMove);
  }, []);

  // Unmount safety: never leave a live timer or rAF loop behind.
  useEffect(() => () => clearTouchGesture(), [clearTouchGesture]);

  // Toggle paint mode
  const togglePaintMode = useCallback(() => {
    setPaintMode((prev) => (prev === 'preferred' ? 'if-need-be' : 'preferred'));
  }, []);

  // Clear all selections — unconditionally, matching the button's label. (The
  // "only clear checked days" branch left with the broadcast; every checkbox
  // derives to unchecked from the emptied selection, so the 2026-05-16
  // stranded-checkbox bug cannot recur.)
  const handleClearAll = useCallback(() => {
    onChange?.([]);
  }, [onChange]);

  return (
    <div className="w-full">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        {/* Timezone display */}
        <div className="text-sm text-content-secondary">
          Times shown in: <span className="font-medium">{getTimezoneDisplay(timezone)}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-3">
          {/* Paint mode toggle */}
          <button
            type="button"
            onClick={togglePaintMode}
            disabled={disabled}
            className={`
              px-3 py-1.5 text-sm font-medium rounded-md border
              transition-colors
              focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:opacity-80 active:opacity-75'}
              ${
                paintMode === 'preferred'
                  ? 'bg-green-100 border-green-400 text-green-800'
                  : 'bg-yellow-100 border-yellow-400 text-yellow-800'
              }
            `}
          >
            {paintMode === 'preferred' ? 'Adding: Preferred' : 'Adding: If Need Be'}
          </button>

          {/* Clear all button */}
          {value.length > 0 && (
            <button
              type="button"
              onClick={handleClearAll}
              disabled={disabled}
              className={`
                px-3 py-1.5 text-sm font-medium rounded-btn border border-line
                text-content-secondary bg-surface-card
                focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'hover:bg-surface-hover active:opacity-75'}
              `}
            >
              Clear All
            </button>
          )}
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 mb-3 text-sm">
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-green-300 border border-line rounded-xs" />
          <span className="text-content-secondary">Preferred</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-yellow-300 border border-line rounded-xs" />
          <span className="text-content-secondary">If Need Be</span>
        </div>
        <div className="flex items-center gap-1.5">
          <div className="w-4 h-4 bg-surface-elevated border border-line rounded-xs" />
          <span className="text-content-secondary">Not Available</span>
        </div>
      </div>

      {/* Grid container with horizontal scroll for mobile. touchAction stays
          'pan-x pan-y' (it PERMITS panning); scroll suppression during a paint
          is the non-passive touchmove listener's job — never static CSS. */}
      <div
        ref={gridRef}
        className="overflow-x-auto pb-2"
        style={{ touchAction: 'pan-x pan-y' }}
        onPointerUp={handlePointerUp}
        onPointerMove={handleGridPointerMove}
      >
        <div className="min-w-max">
          {/* Day headers */}
          <div className="flex">
            {/* Spacer for time labels column — sticky with the label column so
                the time axis stays pinned while the grid scrolls horizontally.
                Opaque bg (the form's card surface) so cells slide UNDER it. */}
            <div className="w-12 sm:w-20 shrink-0 sticky left-0 z-10 bg-surface-card" />

            {/* Day headers. 87.8-13 walkthrough F-7: 76px phone columns + the w-12
                gutter put 4 full days in a 375px viewport (48 + 4x76 = 352) vs 3
                before; cells stay 76x48 — above the 44px touch floor. The SAME
                phone width must be carried by all six aligned sites (header
                spacer, headers, checkbox spacer, checkboxes, labels, cells) or
                the columns shear. sm:+ widths unchanged.

                AMENDED Phase 88-28 (Req 4), premise re-verified, decision UNCHANGED: 88-28's
                plan text says this gutter is `w-16`/`w-20` and asks for it to be shrunk at
                phone width with `md:` restoring desktop. That premise is STALE — the work was
                already done here by 87.8-13, one breakpoint lower (`w-12 sm:w-20`), and the
                arithmetic above still holds on this tree. Nothing was re-cut, deliberately:
                  - Narrowing the gutter below `w-12` truncates the compact "10:30p" label
                    the same walkthrough introduced to make `w-12` possible.
                  - Narrowing the 76px columns to fit a 5th day was REJECTED: 76x48 is a
                    measured 87.8-13 value sitting above the 44px floor, and re-deciding it
                    from a stale plan premise is exactly the silent-override this project's
                    Evidence Rule forbids.
                  - Moving `sm:` to `md:` would widen the phone treatment to 768px but would
                    DESYNC the width from the label toggle below (`sm:hidden` /
                    `hidden sm:inline`), which is keyed to the same breakpoint on purpose.
                What 88-28 could not do is MEASURE the rendered column count — that needs a
                browser, and the container's own padding eats into the 375px this arithmetic
                assumes. Plan 88-30 owns the assertion. The six-site lockstep above is pinned
                in `availabilityGridColumns.test.ts`. */}
            {days.map((day, index) => (
              <div
                key={day.toISOString()}
                className="w-[76px] sm:w-28 shrink-0 text-center py-2 text-sm font-medium text-content-secondary border-b border-line"
              >
                {formatDayHeader(day)}
              </div>
            ))}
          </div>

          {/* Day checkboxes row */}
          <div className="flex">
            {/* Select All toggle in the time-label spacer — same sticky
                treatment as the label column so "All" never scrolls away. */}
            <div className="w-12 sm:w-20 shrink-0 flex items-center justify-end pr-2 sticky left-0 z-10 bg-surface-card">
              <label className="flex items-center gap-1 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleSelectAll}
                  disabled={disabled}
                  className="w-3.5 h-3.5 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-xs text-content-muted font-medium">All</span>
              </label>
            </div>

            {/* Individual day checkboxes */}
            {days.map((day, index) => (
              <div
                key={`cb-${day.toISOString()}`}
                className="w-[76px] sm:w-28 shrink-0 flex items-center justify-center py-1"
              >
                <input
                  type="checkbox"
                  checked={!!dayFull[index]}
                  onChange={() => toggleDayCheck(index)}
                  disabled={disabled}
                  className="w-4 h-4 accent-blue-600 cursor-pointer disabled:cursor-not-allowed"
                />
              </div>
            ))}
          </div>

          {/* Time slot rows */}
          {timeSlots.map((timeSlot, rowIndex) => (
            <div key={`row-${rowIndex}`} className="flex">
              {/* Time label column — mirrors the header spacer width. Sticky
                  left-0 pins the time axis while the grid scrolls horizontally
                  (Phase 87.8 TOUCH); the opaque bg is required — sticky labels
                  over painted cells are unreadable without one. */}
              <div className="w-12 sm:w-20 shrink-0 flex items-center justify-end pr-2 text-xs sm:text-sm text-content-secondary font-medium sticky left-0 z-10 bg-surface-card">
                <span className="sm:hidden">{formatTimeLabelCompact(timeSlot)}</span>
                <span className="hidden sm:inline">{formatTimeLabel(timeSlot)}</span>
              </div>

              {/* Day columns. The wrapper carries the cell dims + border; the
                  shared WriteCell fills it with the byte-identical preference
                  color and owns roving keyboard + pointer-paint. */}
              {days.map((day, colIndex) => {
                // Read the precomputed slot id — the TZ conversion already ran
                // once in slotIdGrid, so this hot per-cell path stays O(1).
                const slotId = slotIdForCoord(colIndex, rowIndex);
                const preference = slotMap.get(slotId) || null;
                const key = coordKey(rowIndex, colIndex);
                const focused = focusedCoord.row === rowIndex && focusedCoord.col === colIndex;

                return (
                  <div
                    key={slotId}
                    className="w-[76px] sm:w-28 shrink-0 h-12 sm:h-14 border border-line"
                    onFocus={() => setFocusedCoord({ row: rowIndex, col: colIndex })}
                  >
                    <WriteCell
                      row={rowIndex}
                      col={colIndex}
                      rows={timeSlots.length}
                      cols={numDays}
                      focused={focused}
                      disabled={disabled}
                      preference={preference}
                      slotId={slotId}
                      onMove={handleCellMove}
                      onSelect={handleCellSelect}
                      onPointerDown={handlePointerDown}
                      onPointerEnter={handlePointerEnter}
                      cellRef={getCellRef(key)}
                      className="transition-colors duration-75"
                    />
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Selection summary */}
      <div className="mt-3 text-sm text-content-secondary">
        {value.length === 0 ? (
          <span>Click and drag to select your available times</span>
        ) : (
          <span>
            {value.filter((s) => s.preference === 'preferred').length} preferred,{' '}
            {value.filter((s) => s.preference === 'if-need-be').length} if-need-be slots selected
          </span>
        )}
      </div>
    </div>
  );
}

// Named export for flexibility
export { AvailabilityGrid };
