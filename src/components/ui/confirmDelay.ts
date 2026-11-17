/**
 * confirmDelay — the one timing module for the delayed-enable confirm (F9b).
 *
 * DECISION Phase 88.9-23 F9b: delayed enable — the confirm is inert for CONFIRM_DELAY_MS after
 * arming, then live — over a press-and-hold (F9a: fights scrolling on a phone and has no keyboard
 * analogue) and over a timer per tier (two numbers that drift apart). Owner pick F9b,
 * 88.9-PICKS-B5.json item F9, 2026-11-07; window = the Q4 default in 88.9-RULINGS.md (round 2).
 * Every confirm-window number in the app is written HERE and nowhere else.
 *
 * Consumers: src/components/ui/useConfirmAction.ts (the two-tap tier's countdown and the dialog
 * tier's wall-clock refusal), src/components/ui/ConfirmDialog.tsx (the dialog tier's visible
 * countdown) and src/app/components/KebabMenu.js (the kebab twoTap items).
 *
 * DECISION Phase 88.9-67 (X69, owner 2026-11-14: when a person sees a button and presses it, and
 * then nothing happens, they wonder what went wrong and try to press it again and they might not
 * notice the countdown or recognize that it's a countdown to begin with. Changing the wording to
 * wait makes people realize that pressing the button isn't an option at the moment): every gated
 * confirm reads Wait (n) in all three tiers, chosen OVER the action word with a number
 * (Tap again (n), Delete (n), R-W1's Remove (n)); the word lives only here. While waiting the name
 * is <action>, wait n seconds (owner 2026-11-14: first), chosen OVER Wait n seconds, then <action>
 * (the W3C best practice puts the visible word first; rejected because the control refuses every
 * press while waiting and the action tells a screen-reader user what it is); nothing is announced
 * per second.
 */
import * as React from 'react';

/** The gated part of the window: the confirm refuses every press for this long after arming. */
export const CONFIRM_DELAY_MS = 3000;

/** The live part of the window, two-tap tiers only: after the gate, the confirm works this long. */
export const CONFIRM_LIVE_MS = 3000;

/** One countdown step. The label counts whole seconds. */
const TICK_MS = 1000;

/** The first number the label shows (3 for a 3000 ms gate). */
const START_SECONDS = Math.ceil(CONFIRM_DELAY_MS / TICK_MS);

export type ConfirmArmKey = string | number | null;

export interface ConfirmCountdown {
  /** Whole seconds left in the gate; 0 when idle or live. */
  secondsLeft: number;
  /** True once the gate has run out for the current key. */
  live: boolean;
  /**
   * Synchronous read for event handlers (a ref, never stale state). Identity-stable for the
   * hook's lifetime. Given a key, true only when THAT key is the one that went live, so a
   * re-arm onto another target can never inherit the previous target's live state.
   */
  isLive: (key?: ConfirmArmKey) => boolean;
}

interface CountdownState {
  key: ConfirmArmKey;
  secondsLeft: number;
  live: boolean;
}

const IDLE: CountdownState = { key: null, secondsLeft: 0, live: false };

/**
 * Runs the gate for `armKey`. A non-null key (re)starts a chain of TICK_MS timeouts counting
 * START_SECONDS down to 0; reaching 0 makes the countdown live and calls `onLive` once. A null
 * key or an unmount clears the pending tick, so `onLive` never fires after either. The key is
 * compared with `=== null`, never by truthiness: KebabMenu's item index 0 is a real key.
 */
export function useConfirmCountdown(
  armKey: ConfirmArmKey,
  onLive?: () => void
): ConfirmCountdown {
  const [state, setState] = React.useState<CountdownState>(IDLE);

  // The key that reached live, read synchronously by isLive; null while gated or idle.
  const liveKeyRef = React.useRef<ConfirmArmKey>(null);
  const liveRef = React.useRef(false);
  // True once a tick has written the state, so the reset below runs only when there is
  // something to reset (A-56).
  const wroteStateRef = React.useRef(false);

  // Latest-callback ref: the tick that reaches 0 calls the newest onLive.
  const onLiveRef = React.useRef(onLive);
  React.useEffect(() => {
    onLiveRef.current = onLive;
  });

  React.useEffect(() => {
    liveRef.current = false;
    liveKeyRef.current = null;
    // AMENDED Phase 88.9-52 (S-A2): the reset runs on EVERY key change that follows a written
    // tick, not only on a disarm. KebabMenu keys on the item index and arms another item with no
    // null in between; with a disarm-only reset the state kept the old key as live, and coming
    // back to that key inside a second painted and announced the live confirm on an item that
    // refused the press. Chosen OVER a ref read during render that marks the state stale (no
    // extra render, but a ref read in render is the shape React's rules forbid) and OVER going
    // back to a state write on every arm (A-56 removed it). Cost, measured: one extra host
    // render on a direct key-to-key move after a tick; an arm that follows a disarm still costs
    // none. Pinned by src/components/ui/confirmDelay.test.ts ("S-A2 (88.9-52): key 0 goes live").
    if (wroteStateRef.current) {
      wroteStateRef.current = false;
      setState(IDLE);
    }
    if (armKey === null) return undefined;

    let remaining = START_SECONDS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    // AMENDED Phase 88.9-52 (A-56): no state write on arm. The view below already reports the
    // starting state for a key the state does not hold yet, so writing it here only cost every
    // host one extra render per arm. The reset to IDLE above STAYS, chosen OVER dropping
    // both: without it the state would keep the last key as live, and arming that same key again
    // would paint the live label on its first render (AMENDED S-A2: that holds for a re-arm
    // after a disarm AND for a key that comes back after a direct move to another key, which is
    // why the reset now runs on every key change). The reset is skipped when no tick has
    // written the state (measured: an unconditional updater that returns the same state, run on
    // mount, still made React call the host once more on the next arm).
    const tick = () => {
      remaining -= 1;
      wroteStateRef.current = true;
      if (remaining > 0) {
        setState({ key: armKey, secondsLeft: remaining, live: false });
        timer = setTimeout(tick, TICK_MS);
        return;
      }
      timer = null;
      liveRef.current = true;
      liveKeyRef.current = armKey;
      setState({ key: armKey, secondsLeft: 0, live: true });
      onLiveRef.current?.();
    };
    timer = setTimeout(tick, TICK_MS);

    return () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      liveRef.current = false;
      liveKeyRef.current = null;
    };
  }, [armKey]);

  const isLive = React.useCallback(
    (key?: ConfirmArmKey) =>
      key === undefined ? liveRef.current : liveRef.current && liveKeyRef.current === key,
    []
  );

  // Until the effect for a new key has run, report that key's starting state rather than the
  // previous key's, so the first armed render already reads (3) and never flashes a stale value.
  const view: CountdownState =
    state.key === armKey
      ? state
      : armKey === null
        ? IDLE
        : { key: armKey, secondsLeft: START_SECONDS, live: false };

  return { secondsLeft: view.secondsLeft, live: view.live, isLive };
}

/**
 * The gated label, the same in every tier: "Wait (3)", "Wait (2)", "Wait (1)". It takes no base
 * word on purpose, so no caller can count down on another word (the X69 marker above).
 */
export function countdownLabel(secondsLeft: number): string {
  return `Wait (${secondsLeft})`;
}

/**
 * The heard name of a gated confirm: "<action>, wait 3 seconds" ("second" at 1). `action` is the
 * control's resting name, so the name says what the button does while pressing it does nothing,
 * and it contains the visible word and number (Label in Name, WCAG 2.5.3).
 */
export function countdownName(action: string, secondsLeft: number): string {
  return `${action}, wait ${secondsLeft} ${secondsLeft === 1 ? 'second' : 'seconds'}`;
}

/**
 * Every label the countdown can paint, from the first number down to 1. Proportional digits make
 * the three widths differ, so a width reserve holds all of them, not only the first.
 */
export const COUNTDOWN_LABELS: readonly string[] = Array.from(
  { length: START_SECONDS },
  (_, index) => countdownLabel(START_SECONDS - index)
);
