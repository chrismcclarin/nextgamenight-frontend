// Quick task 261025-dzo, 88.6.2 ledger C-50: the 1500 ms auto-close timer that a successful
// friend-request send schedules must not outlive the component. Before the fix the timer was
// fire-and-forget, so after unmount it still called setIsOpen; in CI that ran after jsdom
// teardown and threw "window is not defined" (quality run 40148582905).
//
// Fake-timer rules for this file:
// - vi.useFakeTimers() at the start of each test; afterEach restores the spies BEFORE real
//   timers come back, so no spy is left wrapping the fake setTimeout over the real one.
// - Sends are flushed with an empty async act. No waitFor and no findBy queries: Testing
//   Library only advances jest's fake timers, so those polls never resolve under vitest's.
// - Timer handles are objects under fake timers, so they are compared by identity.
import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';

import ClickableMemberName from './ClickableMemberName';
import { FriendshipContext } from './FriendshipStatusProvider';

const AUTO_CLOSE_MS = 1500;

function renderName(sendRequest: (id: string) => Promise<unknown>) {
  return render(
    <FriendshipContext.Provider value={{ getStatus: () => 'none', sendRequest } as never}>
      <ClickableMemberName userId="u1" username="ada" />
    </FriendshipContext.Provider>,
  );
}

// Every handle the setTimeout spy returned for a call scheduled with the auto-close delay.
function autoCloseHandles(setSpy: { mock: { calls: unknown[][]; results: { value: unknown }[] } }) {
  return setSpy.mock.calls
    .map((args, i) => (args[1] === AUTO_CLOSE_MS ? setSpy.mock.results[i].value : undefined))
    .filter((h) => h !== undefined);
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('ClickableMemberName auto-close timer (quick-261025-dzo, 88.6.2 ledger C-50)', () => {
  it('TM1. phone + path: after a successful send, unmount leaves no pending timer', async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(async () => ({ ok: true }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const { unmount } = renderName(sendRequest);

    fireEvent.click(screen.getByRole('button', { name: 'Add ada as a friend' }));
    await act(async () => {});

    expect(sendRequest).toHaveBeenCalledWith('u1');
    // Anti-vacuity: the success branch ran and scheduled the auto-close.
    expect(autoCloseHandles(setSpy)).toHaveLength(1);

    unmount();
    // Baseline with no send is 0 after unmount, so 0 is the clean target.
    expect(vi.getTimerCount()).toBe(0);
  });

  it('TM2. popover Add friend path: unmount clears the auto-close timer by its handle', async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(async () => ({ ok: true }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const { unmount } = renderName(sendRequest);

    fireEvent.keyDown(screen.getByRole('button', { name: 'ada' }), { key: 'Enter' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    await act(async () => {});

    expect(sendRequest).toHaveBeenCalledWith('u1');
    const handles = autoCloseHandles(setSpy);
    expect(handles).toHaveLength(1);

    // No timer-count assertion on this path: the popover's focus manager queues its own
    // animation-frame focus call at keyboard open, which is not this component's timer.
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    unmount();
    expect(clearSpy).toHaveBeenCalledWith(handles[0]);
  });

  it('TM3. a second send clears the first send pending auto-close before scheduling its own', async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(async () => ({ ok: true }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    renderName(sendRequest);

    fireEvent.click(screen.getByRole('button', { name: 'Add ada as a friend' }));
    await act(async () => {});
    const [first] = autoCloseHandles(setSpy);
    expect(first).toBeDefined();

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    fireEvent.click(screen.getByRole('button', { name: 'Add ada as a friend' }));
    await act(async () => {});

    expect(sendRequest).toHaveBeenCalledTimes(2);
    expect(autoCloseHandles(setSpy)).toHaveLength(2);
    expect(clearSpy).toHaveBeenCalledWith(first);
  });

  // Review round 1 WR-01: the unmount clear runs once, so a send still in flight at unmount
  // resolved into a success branch that scheduled a fresh 1500 ms timer nothing cleared.
  it('TM4. a send that resolves after unmount schedules no auto-close', async () => {
    vi.useFakeTimers();
    let resolveSend: (v: unknown) => void = () => {};
    const sendRequest = vi.fn(
      () =>
        new Promise((resolve) => {
          resolveSend = resolve;
        }),
    );
    const errorSpy = vi.spyOn(console, 'error');
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const { unmount } = renderName(sendRequest);

    fireEvent.click(screen.getByRole('button', { name: 'Add ada as a friend' }));
    await act(async () => {});
    expect(sendRequest).toHaveBeenCalledWith('u1');

    unmount();
    expect(vi.getTimerCount()).toBe(0);

    resolveSend({ ok: true });
    await act(async () => {});

    expect(autoCloseHandles(setSpy)).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  // Review round 1 IN-03: closing the popover left the pending auto-close armed, so a popover
  // reopened inside the 1500 ms window snapped shut on its own.
  it('TM5. closing the popover cancels the pending auto-close, so a reopened popover stays open', async () => {
    vi.useFakeTimers();
    const sendRequest = vi.fn(async () => ({ ok: true }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    renderName(sendRequest);
    const name = screen.getByRole('button', { name: 'ada' });

    fireEvent.keyDown(name, { key: 'Enter' });
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Add friend' }));
    await act(async () => {});
    // Anti-vacuity: the send scheduled the auto-close this test expects the close to cancel.
    expect(autoCloseHandles(setSpy)).toHaveLength(1);

    // Close through the trigger toggle, then reopen well inside the 1500 ms window.
    fireEvent.keyDown(name, { key: 'Enter' });
    await act(async () => {});
    expect(name.getAttribute('aria-expanded')).toBe('false');
    fireEvent.keyDown(name, { key: 'Enter' });
    await act(async () => {});
    expect(name.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(AUTO_CLOSE_MS);
    });
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-member-popover]')).not.toBeNull();
  });

  it('TM6. phone + path: a popover opened inside the window after an inline send stays open', async () => {
    // Scoped check round 1 (quick-261025-dzo): the auto-close is scheduled while the popover is
    // CLOSED (the inline "+" never opens it), so a clear that runs only on close never cancels
    // it, and a tap on the name inside the 1500 ms window opened a popover that snapped shut.
    vi.useFakeTimers();
    const sendRequest = vi.fn(async () => ({ ok: true }));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    renderName(sendRequest);
    const name = screen.getByRole('button', { name: 'ada' });

    fireEvent.click(screen.getByRole('button', { name: 'Add ada as a friend' }));
    await act(async () => {});
    // Anti-vacuity: the inline send scheduled the auto-close while the popover was closed.
    expect(autoCloseHandles(setSpy)).toHaveLength(1);
    expect(name.getAttribute('aria-expanded')).toBe('false');

    // Open inside the window, as a tap on the name does on a phone.
    fireEvent.keyDown(name, { key: 'Enter' });
    await act(async () => {});
    expect(name.getAttribute('aria-expanded')).toBe('true');

    await act(async () => {
      vi.advanceTimersByTime(AUTO_CLOSE_MS);
    });
    expect(name.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('[data-member-popover]')).not.toBeNull();
  });
});
