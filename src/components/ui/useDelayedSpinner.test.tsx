// Contract pins for useDelayedSpinner (plan 88.9-54, owner ruling R-C3b, 88.9-RULINGS.md
// 2026-11-10): the busy Spinner appears only after SPINNER_DELAY_MS (200) of busy and, once
// shown, stays SPINNER_MIN_MS (500) from its APPEARANCE while the host stays mounted. A busy
// that ends inside the delay shows nothing. Fake timers throughout (vitest fakes Date.now too,
// which the hold arithmetic reads).
import * as React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { SPINNER_DELAY_MS, SPINNER_MIN_MS, useDelayedSpinner } from './useDelayedSpinner';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

function renderSpinner(initialBusy: boolean, opts?: { delayMs?: number; minMs?: number }) {
  return renderHook(({ busy }: { busy: boolean }) => useDelayedSpinner(busy, opts), {
    initialProps: { busy: initialBusy },
  });
}

describe('useDelayedSpinner (88.9-54, R-C3b: 200 ms appear delay, 500 ms minimum hold)', () => {
  it('a busy that ends inside the delay shows nothing', () => {
    const { result, rerender } = renderSpinner(true);
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(150));
    expect(result.current).toBe(false);
    rerender({ busy: false });
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current).toBe(false);
  });

  it('a long busy shows the spinner at the delay and holds it from its appearance', () => {
    const { result, rerender } = renderSpinner(true);
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true); // 200 ms
    act(() => vi.advanceTimersByTime(50));
    rerender({ busy: false }); // 250 ms: busy drops inside the hold
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(350));
    expect(result.current).toBe(true); // 600 ms: still inside the hold
    act(() => vi.advanceTimersByTime(100));
    expect(result.current).toBe(false); // 700 ms = 200 + 500
  });

  it('unmount mid-hold clears every timer', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { result, rerender, unmount } = renderSpinner(true);
    act(() => vi.advanceTimersByTime(300));
    rerender({ busy: false });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    unmount(); // 400 ms, hide timer pending
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(1000));
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('unmount mid-delay clears the appear timer', () => {
    const { unmount } = renderSpinner(true);
    act(() => vi.advanceTimersByTime(100));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('busy returning during the hold keeps the spinner with no gap', () => {
    const { result, rerender } = renderSpinner(true);
    act(() => vi.advanceTimersByTime(200));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    rerender({ busy: false }); // 300 ms
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(100));
    rerender({ busy: true }); // 400 ms: re-busy inside the hold
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(400));
    expect(result.current).toBe(true); // 800 ms, still busy
    act(() => vi.advanceTimersByTime(100));
    rerender({ busy: false }); // 900 ms: the hold since the first appearance is spent
    expect(result.current).toBe(false);
  });

  it('the exported numbers are the ruled ones, and opts override them', () => {
    expect(SPINNER_DELAY_MS).toBe(200);
    expect(SPINNER_MIN_MS).toBe(500);
    const { result, rerender } = renderSpinner(true, { delayMs: 10, minMs: 20 });
    act(() => vi.advanceTimersByTime(9));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true); // shown at 10
    rerender({ busy: false }); // an early drop
    act(() => vi.advanceTimersByTime(19));
    expect(result.current).toBe(true); // 29
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false); // hidden at 30
  });

  it('under React.StrictMode the spinner still appears at the delay', () => {
    const { result } = renderHook(() => useDelayedSpinner(true), { wrapper: React.StrictMode });
    expect(vi.getTimerCount()).toBe(1); // the double mount leaves ONE appear timer pending
    act(() => vi.advanceTimersByTime(199));
    expect(result.current).toBe(false);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(true);
  });

  it('a busy that drops in the discrete event that fires the appear timer still hides after the hold', () => {
    const { result, rerender } = renderSpinner(true);
    act(() => {
      vi.advanceTimersByTime(SPINNER_DELAY_MS); // the appear timer fires, shown is queued
      rerender({ busy: false }); // busy drops before that render commits
    });
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(SPINNER_MIN_MS - 1));
    expect(result.current).toBe(true);
    act(() => vi.advanceTimersByTime(1));
    expect(result.current).toBe(false); // never stays up
  });
});
