// X69 (88.9-67, owner 2026-11-14): a gated confirm says Wait (n) in every tier, and the one
// countdown word lives in confirmDelay.ts. These pin the two string helpers and the list the
// width reserve reads; the timing half is pinned in useConfirmAction.test.ts.
import { describe, expect, it } from 'vitest';

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
