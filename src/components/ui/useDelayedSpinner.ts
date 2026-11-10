'use client';

/**
 * useDelayedSpinner — the one home of the busy Spinner's appear delay and minimum hold
 * (plan 88.9-54, owner ruling R-C3b).
 *
 * `useDelayedSpinner(busy)` returns whether the spinner should be in the tree right now:
 * false for the first SPINNER_DELAY_MS of a busy, true from then on, and still true for
 * SPINNER_MIN_MS after its first appearance even when busy has already dropped. The only
 * consumer is {@link DelayedSpinner}; hosts mount that element, they do not call this hook.
 */
import * as React from 'react';

/** How long a busy must last before the spinner appears (the ruling's "about 200 ms"). */
export const SPINNER_DELAY_MS = 200;

/** How long the spinner stays once shown, counted from its appearance ("about 500 ms"). */
export const SPINNER_MIN_MS = 500;

export interface DelayedSpinnerOptions {
  /** Override of SPINNER_DELAY_MS (tests only; production hosts take the ruled value). */
  delayMs?: number;
  /** Override of SPINNER_MIN_MS (tests only; production hosts take the ruled value). */
  minMs?: number;
}

type Timer = ReturnType<typeof setTimeout>;

/* DECISION Phase 88.9-54 (owner ruling R-C3b, 88.9-RULINGS.md, 2026-11-10): the busy Spinner is a DELAYED, HELD indicator — it appears after SPINNER_DELAY_MS (200 ms) of busy and, once shown, stays SPINNER_MIN_MS (500 ms) from its appearance. The delay follows the Stripe Apps loading pattern (200-300 ms before a spinner) under NN/g's response-time limits (0.1 / 1 / 10 s: a write that returns inside 0.2 s needs no indicator at all), the hold follows Marigold's minimum-visible rule (a 20 ms flash reads as a glitch, not feedback); the owner ruled the two values as about 200 / about 500 and measures three preview-deploy writes at the 88.9-51 glance (R6: keep or adjust). The hold counts from the spinner's APPEARANCE, chosen OVER counting from busy's end (which would hold a 201 ms write's spinner for 700 ms). The effect also depends on shown, so a busy that drops in the very event the appear timer fires still gets its hold and its hide, chosen OVER a busy-only dependency that left the spinner up in that order. Cleanup clears the timers and nulls the refs, chosen OVER a mounted ref (StrictMode double-mounts effects; a cleared timer cannot fire). Changing either number is a decision, not a cleanup. */
export function useDelayedSpinner(busy: boolean, opts?: DelayedSpinnerOptions): boolean {
  const delayMs = opts?.delayMs ?? SPINNER_DELAY_MS;
  const minMs = opts?.minMs ?? SPINNER_MIN_MS;

  const [shown, setShown] = React.useState(false);

  // The pending appear timer, the pending hide timer, and when the spinner last appeared
  // (Date.now(), which fake timers also mock). Null means "none pending" / "not shown".
  const appearTimerRef = React.useRef<Timer | null>(null);
  const hideTimerRef = React.useRef<Timer | null>(null);
  const shownAtRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    if (busy) {
      // A re-busy during the hold: keep the spinner up, drop the pending hide.
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (!shown && appearTimerRef.current === null) {
        appearTimerRef.current = setTimeout(() => {
          appearTimerRef.current = null;
          shownAtRef.current = Date.now();
          setShown(true);
        }, delayMs);
      }
    } else {
      // Busy ended inside the delay: nothing ever shows.
      if (appearTimerRef.current !== null) {
        clearTimeout(appearTimerRef.current);
        appearTimerRef.current = null;
      }
      // Shown (including the case where `shown` flipped true after busy already dropped):
      // finish the hold from the appearance, then hide.
      if (shown && hideTimerRef.current === null) {
        const shownAt = shownAtRef.current ?? Date.now();
        const remaining = minMs - (Date.now() - shownAt);
        if (remaining > 0) {
          hideTimerRef.current = setTimeout(() => {
            hideTimerRef.current = null;
            shownAtRef.current = null;
            setShown(false);
          }, remaining);
        } else {
          shownAtRef.current = null;
          setShown(false);
        }
      }
    }

    return () => {
      if (appearTimerRef.current !== null) {
        clearTimeout(appearTimerRef.current);
        appearTimerRef.current = null;
      }
      if (hideTimerRef.current !== null) {
        clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
    };
  }, [busy, shown, delayMs, minMs]);

  return shown;
}
