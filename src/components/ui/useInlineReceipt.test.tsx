// Pins for useInlineReceipt (plan 88.9-24, save-feedback rule 3, owner pick O16a;
// owner ruling R-W3 2026-11-08: INLINE_RECEIPT_MS = 4000, the lifetime of the toast
// each receipt replaces). The hook owns only the text and its timer; the caller
// renders it in an always-mounted region (or speaks it through its own lane).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REGION_EMPTY_DWELL_MS } from './StatusRegion';
import { INLINE_RECEIPT_MS, useInlineReceipt } from './useInlineReceipt';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useInlineReceipt (88.9-24, save-feedback rule 3)', () => {
  it('showReceipt sets the text and clears it after INLINE_RECEIPT_MS (4000)', () => {
    expect(INLINE_RECEIPT_MS).toBe(4000);
    const { result } = renderHook(() => useInlineReceipt());
    expect(result.current.receipt).toBe('');
    act(() => result.current.showReceipt('Username updated'));
    expect(result.current.receipt).toBe('Username updated');
    act(() => vi.advanceTimersByTime(INLINE_RECEIPT_MS - 1));
    expect(result.current.receipt).toBe('Username updated');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.receipt).toBe('');
  });

  it('clearReceipt empties it at once and cancels the timer', () => {
    const { result } = renderHook(() => useInlineReceipt());
    act(() => result.current.showReceipt('Invite link reset'));
    act(() => result.current.clearReceipt());
    expect(result.current.receipt).toBe('');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a second showReceipt restarts the window', () => {
    const { result } = renderHook(() => useInlineReceipt());
    act(() => result.current.showReceipt('Email address changed'));
    act(() => vi.advanceTimersByTime(3000));
    act(() => result.current.showReceipt('Email change discarded'));
    act(() => vi.advanceTimersByTime(3000));
    expect(result.current.receipt).toBe('Email change discarded');
    act(() => vi.advanceTimersByTime(1000));
    expect(result.current.receipt).toBe('');
  });

  it('A-59 (88.9-52): the same receipt again is emptied first and returns after the empty dwell, with a full window', () => {
    // A live region speaks a change. The same words set again are no change, and words set less
    // than the dwell after a clear are dropped by WebKit, so a repeat goes through an empty spell.
    const { result } = renderHook(() => useInlineReceipt());
    act(() => result.current.showReceipt('Saved'));
    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.showReceipt('Saved'));
    expect(result.current.receipt, 'emptied at the second call').toBe('');
    act(() => vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 1));
    expect(result.current.receipt).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.receipt, 'back after the dwell').toBe('Saved');
    act(() => vi.advanceTimersByTime(INLINE_RECEIPT_MS - 1));
    expect(result.current.receipt, 'the window runs from the return').toBe('Saved');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.receipt).toBe('');
  });

  it('A-59 (88.9-52): a receipt shown sooner than the dwell after a clear waits out the rest of the dwell; later it is immediate', () => {
    const { result } = renderHook(() => useInlineReceipt());
    act(() => result.current.showReceipt('Saved'));
    act(() => result.current.clearReceipt());
    act(() => vi.advanceTimersByTime(40));
    act(() => result.current.showReceipt('Saved'));
    expect(result.current.receipt, 'the region has been empty for 40 ms only').toBe('');
    act(() => vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS - 40 - 1));
    expect(result.current.receipt).toBe('');
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.receipt).toBe('Saved');
    // A clear during the wait cancels the pending receipt.
    act(() => result.current.clearReceipt());
    act(() => result.current.showReceipt('Saved'));
    act(() => result.current.clearReceipt());
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(REGION_EMPTY_DWELL_MS));
    expect(result.current.receipt).toBe('');
    // Empty for the whole dwell: the next receipt is immediate.
    act(() => result.current.showReceipt('Saved'));
    expect(result.current.receipt).toBe('Saved');
    // Different words over a showing receipt are a change: no empty spell.
    act(() => result.current.showReceipt('Removed'));
    expect(result.current.receipt).toBe('Removed');
  });

  it('unmount cancels the pending timer', () => {
    const { result, unmount } = renderHook(() => useInlineReceipt());
    act(() => result.current.showReceipt('Username updated'));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('showReceipt and clearReceipt keep their identity across a rerender', () => {
    const { result, rerender } = renderHook(() => useInlineReceipt());
    const first = result.current;
    rerender();
    expect(result.current.showReceipt).toBe(first.showReceipt);
    expect(result.current.clearReceipt).toBe(first.clearReceipt);
  });
});
