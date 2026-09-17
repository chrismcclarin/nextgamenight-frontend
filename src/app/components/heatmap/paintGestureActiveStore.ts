// src/app/components/heatmap/paintGestureActiveStore.ts
//
// The paint-gesture ACTIVE flag, and the finger-up hold built on it (Plan 88.6-39, W52 / D-18).
//
// WHAT THIS IS FOR. A block that appears or resizes ABOVE the scheduler grid while a finger is
// painting moves every row under that finger, so the user paints the wrong hours and is never
// told. `usePaintGesture` now reports engage/disengage through `onActiveChange`;
// `EventScheduler` forwards it; `createEvent` WRITES it here; the two height sources above the
// grid — `QuickSuggestions` and `TimezoneNudgeBanner` — READ it here, each from inside its own
// component.
//
// ─────────────────────────────────────────────────────────────────────────────────────────────
// DECISION Phase 88.6-39 (D-18): this is a LEAF MODULE, chosen OVER a ref or store living in
// `createEvent.js`, and OVER parent `useState` in `createEvent`. All three were on the table.
//
//   1. NOT parent `useState`. A state update at gesture ENGAGE re-renders `createEvent`, and
//      `EventScheduler` is rendered INLINE and unmemoized there (`createEvent.js:1096`), so that
//      re-render reconciles ~196 memoized scheduler cells (`EventScheduler.tsx:807-819` is the
//      cache that exists because of it). The fix would cause a smaller copy of the bug it fixes,
//      in the exact frame the user's finger goes down.
//   2. NOT a store inside `createEvent.js`. `createEvent.js:10` imports `QuickSuggestions` and
//      `:18` imports `TimezoneNudgeBanner`, and BOTH consumers have to read the flag from inside
//      themselves (see 1 — `createEvent` must never subscribe). They would therefore have to
//      import back FROM `createEvent.js`: a module cycle, and a `const`-exported store read
//      through one hits TDZ on first access. Independently of the cycle, it could not satisfy
//      requirement 3 below at all.
//   3. IMPORT-SAFE WITH AN INACTIVE DEFAULT. `TimezoneNudgeBanner` has three mount sites and
//      only one of them has a scheduler (`createEvent.js:994`; the other two are
//      `EventDayModal.js:77` and `gameDetail/page.js:1474`). Those two must render exactly as
//      they do today and must not pull the create-event module into their bundle. A leaf module
//      that imports nothing from the component tree is the only shape that gives them that.
//
// DECISION Phase 88.6-39 (D-18): the read seam is an IMPERATIVE `isPaintGestureActive()` plus
// `subscribePaintGestureActive()`, chosen OVER `useSyncExternalStore` at a consumer's top level.
// `useSyncExternalStore` re-renders EVERY subscriber on the `true` edge — which is precisely the
// frame this module exists to keep quiet. So consumers READ the flag at the moment they would
// commit a height change, and their listener sets state ONLY on the FALSE edge and only when a
// change is actually being held. That is what `usePaintGestureHold` below implements once.
//
// The setter is IDEMPOTENT: a redundant value notifies nobody. That is load-bearing rather than
// tidy — `usePaintGesture` installs `pointerup`/`pointercancel` on `document` for the whole
// mount, so a settle can arrive with nothing in flight.
// ─────────────────────────────────────────────────────────────────────────────────────────────

import { useEffect, useRef, useState } from 'react';

type ActiveListener = (active: boolean) => void;

let paintGestureActive = false;
const listeners = new Set<ActiveListener>();

/** Imperative read. Call it where a height change would COMMIT, never at a render top level. */
export function isPaintGestureActive(): boolean {
  return paintGestureActive;
}

/** Idempotent setter. `createEvent` is the only writer; nothing else may call this. */
export function setPaintGestureActive(next: boolean): void {
  if (next === paintGestureActive) return;
  paintGestureActive = next;
  // Copied before iteration: a listener that unsubscribes itself must not skip a sibling.
  for (const listener of Array.from(listeners)) listener(paintGestureActive);
}

/** Subscribe to edges. Returns the unsubscribe, so it can be an effect body verbatim. */
export function subscribePaintGestureActive(listener: ActiveListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * TEST SEAM ONLY. Resets module state between cases so one suite's gesture cannot leak into the
 * next. Never called from application code.
 */
export function __resetPaintGestureActiveStore(): void {
  paintGestureActive = false;
  listeners.clear();
}

/**
 * Hold `value`'s CHANGES while a paint gesture is active; apply them on finger-up.
 *
 * The returned value equals `value` whenever no gesture is running, so this is inert on every
 * surface with no scheduler in the tree (the inactive default above). While a gesture IS running
 * the last committed value keeps being returned, and the pending one is applied on the FALSE
 * edge — the only edge that sets state here.
 *
 * SCOPE, stated so no summary line over-claims it: this holds changes that land WHILE a gesture
 * is active, and nothing else. A height change that lands outside a gesture is unaffected by it.
 */
export function usePaintGestureHold<T>(value: T): T {
  const [held, setHeld] = useState<T>(value);
  const desiredRef = useRef<T>(value);
  desiredRef.current = value;

  // COMMIT-TIME READ. This is the `isPaintGestureActive()` call the decision block above
  // describes: the change is applied now if no finger is down, and parked if one is.
  useEffect(() => {
    if (isPaintGestureActive()) return;
    setHeld((prev) => (Object.is(prev, value) ? prev : value));
  }, [value]);

  // FALSE-EDGE FLUSH. The listener runs on both edges — the store has one notification channel —
  // but it returns immediately on `true` and therefore sets NO state at gesture engage, which is
  // the whole point of not using `useSyncExternalStore` here. On the false edge it applies the
  // held value, and `Object.is` makes the no-held-change case a React bail-out rather than a
  // re-render.
  useEffect(
    () =>
      subscribePaintGestureActive((active) => {
        if (active) return;
        setHeld((prev) => (Object.is(prev, desiredRef.current) ? prev : desiredRef.current));
      }),
    []
  );

  return held;
}
