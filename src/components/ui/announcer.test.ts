// Pins for the root announcer's module store (plan 88.9-24; owner ruling 88.9-RULINGS.md R-F1,
// 2026-11-08, DEC-3 option A). A save whose result is in view shows no toast (save-feedback
// rule 2) and is still spoken once, by the ONE always-mounted region RootAnnouncer renders from
// this store. Every assert reads the exported snapshot getter or a subscribe() listener log.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { announceStatus, getServerSnapshot, getSnapshot, subscribe } from './announcer';
import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { INLINE_RECEIPT_MS } from './useInlineReceipt';

let log: string[] = [];
let unsubscribe: () => void = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  log = [];
  unsubscribe = subscribe(() => log.push(getSnapshot()));
});

afterEach(() => {
  // Run every pending timer so the module store ends empty between tests.
  vi.runAllTimers();
  unsubscribe();
  vi.useRealTimers();
});

describe('announcer store (88.9-24, R-F1)', () => {
  it('announceStatus clears the region at once, then sets the text after REGION_EMPTY_DWELL_MS (100 ms)', () => {
    expect(REGION_EMPTY_DWELL_MS).toBe(100);
    expect(getServerSnapshot()).toBe('');
    announceStatus('Prior words');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Prior words');

    announceStatus('Settings saved');
    // The prior text is gone synchronously.
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1);
    expect(getSnapshot()).toBe('');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('Settings saved');
  });

  it('a second announceStatus inside the dwell replaces the first', () => {
    announceStatus('A');
    vi.advanceTimersByTime(50);
    announceStatus('B');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('B');
    expect(log).not.toContain('A');
    expect(log).toContain('B');
  });

  it('the text is cleared again after INLINE_RECEIPT_MS', () => {
    expect(INLINE_RECEIPT_MS).toBe(4000);
    announceStatus('Role updated');
    vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS);
    expect(getSnapshot()).toBe('Role updated');
    vi.advanceTimersByTime(INLINE_RECEIPT_MS - 1);
    expect(getSnapshot()).toBe('Role updated');
    vi.advanceTimersByTime(1);
    expect(getSnapshot()).toBe('');
    expect(log.at(-1)).toBe('');
  });
});
