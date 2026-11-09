// Pins for useInlineReceipt (plan 88.9-24, save-feedback rule 3, owner pick O16a;
// owner ruling R-W3 2026-11-08: INLINE_RECEIPT_MS = 4000, the lifetime of the toast
// each receipt replaces). The hook owns only the text and its timer; the caller
// renders it in an always-mounted region (or speaks it through its own lane).
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
