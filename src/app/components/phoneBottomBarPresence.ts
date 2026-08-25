'use client';

/**
 * phoneBottomBarPresence — "is a fixed phone bottom bar currently mounted?",
 * shared between `PhoneEventBar` (the producer) and `Footer` (the consumer).
 *
 * WHY THIS EXISTS: `PhoneEventBar` is `fixed`, so it is out of flow and the page
 * lays out as if it were absent. On a short page the sticky-footer wrapper
 * (`layout.js:86-91`) puts the `<Footer />` at the viewport bottom — exactly
 * where the bar sits — and the bar's stacking tier beats the Footer (which sets
 * no z-index), occluding the `/Privacy` link that CLAUDE.md records as
 * load-bearing for Google auth. The Footer therefore has to reserve its own
 * 56px, and only when the bar is actually on screen.
 *
 * DECISION Phase 88.1 (plan 08, Task 2): a module-level external store read
 * through `useSyncExternalStore`, chosen OVER a React context provider — which
 * is what the plan text calls this and what a future reader will "convert" it
 * back into. A context provider has to be an ANCESTOR of both `<main>` and
 * `<Footer />`, and the only such ancestor is `layout.js:86-91`, which this plan
 * is explicitly forbidden to touch (the D-05 deviation: the wrapper must stay a
 * plain div with no transform/filter so it never becomes a containing block for
 * fixed-position overlays, and no global page may reserve 56px for a bar that
 * renders on one page). A module store needs no ancestor at all. Converting this
 * to context means editing `layout.js`; that is a decision, not a cleanup.
 *
 * Mount count rather than a boolean: two bars are never expected, but a
 * remount-before-unmount ordering (React StrictMode double-invoke, route
 * transitions) would otherwise leave the flag stuck false.
 */
import * as React from 'react';

let mountCount = 0;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return mountCount > 0;
}

/**
 * Server snapshot is always `false` — the bar registers from an effect, which
 * never runs during SSR, so a `true` server snapshot would be a hydration
 * mismatch. The spacer appears on the client render that follows the bar's
 * mount effect.
 */
function getServerSnapshot(): boolean {
  return false;
}

/** Call from the bar itself: registers presence for its mounted lifetime. */
export function usePhoneBottomBarPresence(): void {
  React.useEffect(() => {
    mountCount += 1;
    emit();
    return () => {
      mountCount -= 1;
      emit();
    };
  }, []);
}

/** Call from the Footer: true while a phone bottom bar is mounted. */
export function usePhoneBottomBarMounted(): boolean {
  return React.useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
