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

  // Latest-callback ref: the tick that reaches 0 calls the newest onLive.
  const onLiveRef = React.useRef(onLive);
  React.useEffect(() => {
    onLiveRef.current = onLive;
  });

  React.useEffect(() => {
    liveRef.current = false;
    liveKeyRef.current = null;
    if (armKey === null) {
      setState((prev) => (prev === IDLE ? prev : IDLE));
      return undefined;
    }

    let remaining = START_SECONDS;
    let timer: ReturnType<typeof setTimeout> | null = null;
    setState({ key: armKey, secondsLeft: remaining, live: false });

    const tick = () => {
      remaining -= 1;
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

/** The gated label: `${base} (${secondsLeft})`, e.g. "Tap again (3)" or "Delete (2)". */
export function countdownLabel(base: string, secondsLeft: number): string {
  return `${base} (${secondsLeft})`;
}
