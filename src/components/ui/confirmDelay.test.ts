// X69 (88.9-67, owner 2026-11-14): a gated confirm says Wait (n) in every tier, and the one
// countdown word lives in confirmDelay.ts. These pin the two string helpers and the list the
// width reserve reads; the timing half is pinned in useConfirmAction.test.ts, and the hook's own
// key-to-key move (S-A2) at the end of this file.
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import * as confirmDelay from './confirmDelay';

// Read through the namespace so a missing export fails as an assertion here, not as an import
// error for the whole file.
const helpers = confirmDelay as unknown as {
  countdownLabel?: (secondsLeft: number) => string;
  countdownName?: (action: string, secondsLeft: number) => string;
  COUNTDOWN_LABELS?: readonly string[];
};

describe('confirmDelay — the one countdown word (X69, 88.9-67)', () => {
  it('X69 (88.9): countdownLabel reads Wait (3), Wait (2), Wait (1) and COUNTDOWN_LABELS holds all three', () => {
    expect(helpers.countdownLabel?.(3)).toBe('Wait (3)');
    expect(helpers.countdownLabel?.(2)).toBe('Wait (2)');
    expect(helpers.countdownLabel?.(1)).toBe('Wait (1)');
    // The list runs from the first number the gate shows down to 1, so a reserve built from it
    // holds every label the countdown can paint.
    expect(helpers.COUNTDOWN_LABELS).toEqual(['Wait (3)', 'Wait (2)', 'Wait (1)']);
    expect(helpers.COUNTDOWN_LABELS?.[0]).toBe(
      helpers.countdownLabel?.(Math.ceil(confirmDelay.CONFIRM_DELAY_MS / 1000))
    );
  });

  it('X69 (88.9): countdownName names the action and the wait, second at 1', () => {
    expect(helpers.countdownName, 'countdownName is exported').toBeTypeOf('function');
    expect(helpers.countdownName?.('Delete', 3)).toBe('Delete, wait 3 seconds');
    expect(helpers.countdownName?.('Remove Dana', 2)).toBe('Remove Dana, wait 2 seconds');
    expect(helpers.countdownName?.('Delete', 1)).toBe('Delete, wait 1 second');
  });
});

describe('useConfirmCountdown — a key that moves straight to another key (S-A2, 88.9-52)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it('S-A2 (88.9-52): key 0 goes live, the key moves to 1 and back to 0 inside a second, and 0 starts gated at the full seconds', () => {
    // KebabMenu keys the countdown on the item index and arms another item with no disarm in
    // between, so the hook must not hand a returning key the live state it held last time.
    let renders = 0;
    const { result, rerender } = renderHook(
      ({ armKey }: { armKey: confirmDelay.ConfirmArmKey }) => {
        renders += 1;
        return confirmDelay.useConfirmCountdown(armKey);
      },
      { initialProps: { armKey: 0 as confirmDelay.ConfirmArmKey } }
    );
    const start = Math.ceil(confirmDelay.CONFIRM_DELAY_MS / 1000);
    expect(result.current.live).toBe(false);
    expect(result.current.secondsLeft).toBe(start);

    // One act per second, as a real clock would deliver the ticks.
    for (let second = 0; second < start; second += 1) {
      act(() => {
        vi.advanceTimersByTime(1000);
      });
    }
    expect(result.current.live, 'key 0 is live after the gate').toBe(true);

    const beforeMove = renders;
    rerender({ armKey: 1 });
    expect(result.current.live, 'key 1 starts gated').toBe(false);
    expect(result.current.secondsLeft).toBe(start);
    const moveCost = renders - beforeMove;

    act(() => {
      vi.advanceTimersByTime(400);
    });
    rerender({ armKey: 0 });
    expect(result.current.live, 'key 0 does not come back live').toBe(false);
    expect(result.current.secondsLeft, 'key 0 starts again at the full seconds').toBe(start);
    expect(result.current.isLive(0)).toBe(false);

    // And the returning key still runs its own full gate.
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.live).toBe(false);
    expect(result.current.secondsLeft).toBe(start - 1);

    // The move costs the render that carries the new key plus one for the reset of the old state.
    expect(moveCost, 'a direct move after a tick costs one render beyond its own').toBe(2);
  });
});
