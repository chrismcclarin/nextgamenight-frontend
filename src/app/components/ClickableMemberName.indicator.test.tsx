/**
 * SPEC Req 5 / D-15 — `showInlineIndicator`, the opt-out that lets a member CHIP render
 * without the inline `md:hidden` indicator that every member ROW keeps.
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * `ClickableMemberName` renders `renderMobileIndicator()` as a SIBLING of the trigger span,
 * outside the element `children` renders into. Every branch of it is `md:hidden`, i.e. VISIBLE
 * at 375px: `✓ Friend` for `accepted`, `⏳ Pending` for either pending direction, an assertive
 * failure line, copy row X3 (plus the `+` again, for a retry) when the `+` send fails (plan
 * 88.6-63; a popover-origin failure keeps the bare `Failed`), and
 * for `none` a 24px `+` button carrying a 10px horizontal hit extension
 * (`after:-inset-x-2.5`). Phase 88.5's member chips sit in a `gap-3` (12px) flex-wrap, so
 * shipping them WITHOUT an opt-out would do two bad things at once:
 *
 *   1. every expanded chip would read `[MK] ✓ Friend` instead of the ruled chip row, and
 *   2. the `+` sibling's 10px extension plus the next chip's 6px extension is 16px reaching
 *      into a 12px gap — a 4px overlap, which is exactly the tap-stealing failure mode
 *      `DECISION Phase 87.8 D-13` exists to prevent. A mis-tap there is not a recoverable UI
 *      action: it sends a stranger a friend request.
 *
 * TWO REGRESSIONS ARE PINNED, AND THEY PULL IN OPPOSITE DIRECTIONS
 * ---------------------------------------------------------------
 * The prop DEFAULTS TO TRUE, and that default is the whole reason it is an opt-out rather than
 * an opt-in: it keeps the ~9 shipped member-row render sites byte-unchanged. So the "default
 * still renders it" arms below are load-bearing regression pins, not smoke tests — deleting the
 * indicator outright would satisfy the `false` arms and silently strip touch users on
 * groupHomePage, ManageMembers and gameDetail of their friend affordance.
 *
 * WHY THE POPOVER IS PINNED TOO
 * -----------------------------
 * Under D-15 the popover is the chips' ONLY add-friend path (a deliberate two-tap flow on
 * phone). The opt-out therefore suppresses the INLINE indicator and NOTHING ELSE: if it ever
 * grew to gate the popover's `Add friend` button as well, the chips would have no add-friend
 * path at all and the suppression would read as "add friend was removed on mobile". Test 6 is
 * the guard on that.
 *
 * ANTI-VACUITY (test 7, in the shape of keyboardOperability.test.tsx's test 5)
 * ---------------------------------------------------------------------------
 * Tests 3 and 4 are `not.toBeInTheDocument()` assertions, and a negative assertion passes
 * for the wrong reason whenever the QUERY is broken — a typo'd `aria-label`, or text split
 * across elements so `queryByText` can never match. Test 7 runs those exact queries against a
 * fixture that DOES contain the nodes, proving the suite can tell presence from absence.
 */
import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';

import ClickableMemberName from './ClickableMemberName';
import { FriendshipContext } from './FriendshipStatusProvider';

type Status = 'none' | 'accepted' | 'pending_sent' | 'pending_received' | 'self' | 'unknown';

// Copy row X3 (D-30), byte-equal to the ratified row with the straight apostrophe (D-32 R8).
const X3 = "We couldn't send that request.";

const sendRequest = vi.fn<(id: string) => Promise<unknown>>(async () => ({ ok: true }));

/** Mirrors keyboardOperability.test.tsx's harness: the name renders INSIDE a role="button"
 *  card, which is the nesting the component's stopPropagation decision is about. */
function renderName(status: Status, props?: { showInlineIndicator?: boolean }) {
  const value = { getStatus: () => status, sendRequest };
  return render(
    <FriendshipContext.Provider value={value as never}>
      {/* aria-label is on the CARD deliberately: without it the card's accessible name is
          computed from its contents, which is "ada ✓ Friend" while the indicator renders and
          bare "ada" once it is suppressed — so `getByRole('button', {name: 'ada'})` would
          match the trigger in one arm and BOTH nodes in the other. Labelling the card keeps
          the trigger query unambiguous in every arm without weakening it. */}
      <div role="button" tabIndex={0} aria-label="open group">
        <ClickableMemberName userId="u1" username="ada" {...props} />
      </div>
    </FriendshipContext.Provider>,
  );
}

/* The two queries the negative arms depend on, named once so test 7 can exercise the SAME
   ones it is vouching for. A divergent copy would defeat the anti-vacuity guard. */
const friendIndicator = () => screen.queryByText('✓ Friend');
const addFriendPlus = () => screen.queryByRole('button', { name: 'Add ada as a friend' });

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('ClickableMemberName showInlineIndicator (88.5 D-15 / SPEC Req 5)', () => {
  it('1. DEFAULT (prop omitted), accepted: the inline ✓ Friend indicator is still rendered', () => {
    renderName('accepted');
    // Regression pin for the ~9 shipped member ROWS, not a smoke test — see the preamble.
    expect(friendIndicator()).toBeInTheDocument();
    expect(friendIndicator()).toHaveClass('md:hidden');
  });

  it('2. DEFAULT (prop omitted), none: the inline + add-friend button is still rendered', () => {
    renderName('none');
    expect(addFriendPlus()).toBeInTheDocument();
  });

  it('3. showInlineIndicator={false}, accepted: no ✓ Friend node in the output', () => {
    renderName('accepted', { showInlineIndicator: false });
    expect(friendIndicator()).not.toBeInTheDocument();
    // the name itself is untouched — the opt-out removes the SIBLING, not the trigger
    expect(screen.getByRole('button', { name: 'ada' })).toBeInTheDocument();
  });

  it('4. showInlineIndicator={false}, none: no + button, so nothing reaches into the chip gap', () => {
    renderName('none', { showInlineIndicator: false });
    expect(addFriendPlus()).not.toBeInTheDocument();
    // and no stray hit-extension survives on any node in the row
    expect(document.querySelector('[class*="after:-inset-x-2.5"]')).toBeNull();
  });

  it('5. showInlineIndicator={false}: the trigger is still a keyboard-operable popover control', async () => {
    renderName('none', { showInlineIndicator: false });
    const name = screen.getByRole('button', { name: 'ada' });
    expect(name).toHaveAttribute('tabindex', '0');
    expect(name).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(name, { key: 'Enter' });
    // the popover's own control is the proof the flow is REACHED, not just that a flag flipped
    await screen.findByRole('button', { name: 'Add friend' });
    expect(screen.getByRole('button', { name: 'ada' })).toHaveAttribute('aria-expanded', 'true');
  });

  it('6. showInlineIndicator={false}: the popover still offers Add friend (D-15 two-tap path)', async () => {
    renderName('none', { showInlineIndicator: false });
    fireEvent.keyDown(screen.getByRole('button', { name: 'ada' }), { key: 'Enter' });
    const addFriend = await screen.findByRole('button', { name: 'Add friend' });
    fireEvent.click(addFriend);
    // Under D-15 this is the chips' ONLY add-friend path; if the opt-out ever gated the
    // popover too, "suppress the inline indicator" would silently become "remove add friend".
    expect(sendRequest).toHaveBeenCalledWith('u1');
  });

  it('7. ANTI-VACUITY: the queries tests 3 and 4 rely on really can find these nodes', () => {
    // Demonstrated on a fixture rather than asserted. If `queryByText('✓ Friend')` were broken
    // (text split across elements) or the aria-label string had drifted, tests 3 and 4 would
    // pass against markup that still renders the indicator. Here the nodes ARE present, so
    // both queries MUST hit — and then, with nothing rendered, both MUST miss.
    render(
      <>
        <span className="md:hidden ml-1 text-xs">✓ Friend</span>
        <button type="button" aria-label="Add ada as a friend">
          +
        </button>
      </>,
    );
    expect(friendIndicator()).toBeInTheDocument();
    expect(addFriendPlus()).toBeInTheDocument();

    cleanup();
    expect(friendIndicator()).not.toBeInTheDocument();
    expect(addFriendPlus()).not.toBeInTheDocument();
  });
});

// Plan 88.6-63 (review round 2 #22). Before this, a failed mobile "+" replaced the FOCUSED button
// with a bare "Failed" span: focus dropped to <body>, nothing was announced, and there was no way to
// retry. The two cases below pin the fix: the failure is an assertive alert that holds focus where
// the "+" was, and the "+" is back beside it. The line reads copy row X3, from the same constant
// as the popover's own alert (Phase 88.6.1-37, D-30).
describe('88.6-63 (review round 2 #22) — a failed "+" keeps focus, announces, and offers a retry', () => {
  it('a failed send leaves focus on an alert reading copy row X3, with the + restored', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    renderName('none');

    const plus = addFriendPlus()!;
    plus.focus();
    expect(document.activeElement).toBe(plus);
    fireEvent.click(plus);

    // Settle on the X3 line itself (Phase 88.6.1-37), then the focus assertion below.
    await screen.findByText(X3);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(X3);
    expect(document.activeElement).toBe(alert);
    // The retry affordance is back, in the next tab stop after the announcement.
    expect(addFriendPlus()).toBeInTheDocument();
  });

  it('the restored + retries: a second send is made, the alert clears, and focus stays on the +', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    renderName('none');

    fireEvent.click(addFriendPlus()!);
    await screen.findByRole('alert');

    const retry = addFriendPlus()!;
    retry.focus();
    fireEvent.click(retry);

    await waitFor(() => expect(sendRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    // The + is the SAME node across the alert's removal (the branch keeps one shape), so a retry
    // that succeeds without a status flip does not drop focus to <body> either.
    expect(document.activeElement).toBe(retry);
  });
});

// ---------------------------------------------------------------------------------------------
// Phase 88.6.1-37 (Req 4 / D-35, R3-M2, Req 5 / D-04, copy row X3). The same harness as
// renderName, with a setStatus(next) that re-renders the SAME tree with a new provider value, so
// the component keeps its state across a status change (the provider after its first load; plan
// 66's loading arm is pinned through the real provider in ClickableMemberName.provider.test.tsx).
// An outside control sits after the card so a test can move focus away from the row.
// ---------------------------------------------------------------------------------------------
function renderWithStatus(initial: Status, props?: { children?: React.ReactNode }) {
  const tree = (s: Status) => (
    <FriendshipContext.Provider value={{ getStatus: () => s, sendRequest } as never}>
      <div role="button" tabIndex={0} aria-label="open group">
        <ClickableMemberName userId="u1" username="ada" {...props} />
      </div>
      <button type="button">outside</button>
    </FriendshipContext.Provider>
  );
  const utils = render(tree(initial));
  const setStatus = (next: Status) => {
    act(() => {
      utils.rerender(tree(next));
    });
  };
  return { ...utils, setStatus };
}

function deferred<T = unknown>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const nameTrigger = () => screen.getByRole('button', { name: 'ada' });
const pendingSpan = () => screen.getByText('⏳ Pending');
const bareMarker = () => screen.queryByText('Failed', { exact: true });
const flushMacrotask = () => act(() => new Promise<void>((r) => setTimeout(r, 0)));

// Records every Element attached under document.body. A failure attachment is an added element
// that is, or contains, a node with the `alert` role, or whose text is exactly the bare marker.
function watchAttachments() {
  const added: Element[] = [];
  const take = (records: MutationRecord[]) => {
    for (const r of records) r.addedNodes.forEach((n) => n instanceof Element && added.push(n));
  };
  const observer = new MutationObserver(take);
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    stop() {
      take(observer.takeRecords());
      observer.disconnect();
      const failures = added.filter(
        (el) =>
          el.matches('[role="alert"]') ||
          el.querySelector('[role="alert"]') !== null ||
          el.textContent === 'Failed',
      );
      return { all: added.length, failures: failures.length };
    },
  };
}

async function openPopoverByKeyboard() {
  const name = nameTrigger();
  name.focus();
  fireEvent.keyDown(name, { key: 'Enter' });
  const addFriend = await screen.findByRole('button', { name: 'Add friend' });
  await waitFor(() => expect(addFriend).toHaveFocus());
  return addFriend;
}

describe('Phase 88.6.1-37 — one request per press, no stale failure, focus kept on the row', () => {
  it('T1a. a failed + then a flip to pending_sent: Pending renders, no failure line, focus on Pending', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    const { setStatus } = renderWithStatus('none');
    fireEvent.click(addFriendPlus()!);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(X3);
    setStatus('pending_sent');
    expect(pendingSpan()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bareMarker()).toBeNull();
    await waitFor(() => expect(document.activeElement).toBe(pendingSpan()));
  });

  it('T1b. three presses of the + inside one act send ONE request; the + stays focused and aria-disabled', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    const { setStatus } = renderWithStatus('none');
    const plus = addFriendPlus()!;
    plus.focus();
    act(() => {
      fireEvent.click(plus);
      fireEvent.click(plus);
      fireEvent.click(plus);
    });
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(plus).toHaveAttribute('aria-disabled', 'true');
    expect(plus).not.toHaveAttribute('disabled');
    expect(plus).toBeInTheDocument();
    expect(document.activeElement).toBe(plus);
    expect(plus.className).toContain('aria-disabled:text-content-muted');
    await act(async () => {
      held.resolve({ ok: true });
    });
    setStatus('pending_sent');
    // This half is green before the fix too (the 87.8 D-13 handoff); kept as the success guard.
    await waitFor(() => expect(document.activeElement).toBe(pendingSpan()));
  });

  it('T1e. three presses of Add friend send ONE request; the + is natively disabled for the flight; the latch releases', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    renderWithStatus('none');
    const addFriend = await openPopoverByKeyboard();
    act(() => {
      fireEvent.click(addFriend);
      fireEvent.click(addFriend);
      fireEvent.click(addFriend);
    });
    expect(sendRequest).toHaveBeenCalledTimes(1);
    expect(addFriend).toHaveAttribute('aria-disabled', 'true');
    expect(addFriend).not.toHaveAttribute('disabled');
    expect(addFriendPlus()).toBeDisabled();
    await act(async () => {
      held.reject(new Error('boom'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent(X3);
    expect(bareMarker()).toBeInTheDocument();
    expect(addFriendPlus()).toBeNull();
    fireEvent.keyDown(nameTrigger(), { key: 'Escape' });
    await waitFor(() => expect(addFriendPlus()).toBeInTheDocument());
    expect(addFriendPlus()).not.toHaveAttribute('aria-disabled');
    act(() => {
      fireEvent.click(addFriendPlus()!);
    });
    expect(sendRequest).toHaveBeenCalledTimes(2);
  });

  it('T1f. a held send from the +: the popover Add friend is natively disabled and sends nothing', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    renderWithStatus('none');
    act(() => {
      fireEvent.click(addFriendPlus()!);
    });
    const name = nameTrigger();
    name.focus();
    fireEvent.keyDown(name, { key: 'Enter' });
    const addFriend = await screen.findByRole('button', { name: 'Add friend' });
    expect(addFriend).toBeDisabled();
    expect(addFriend).not.toHaveAttribute('aria-disabled');
    act(() => {
      fireEvent.click(addFriend);
    });
    expect(sendRequest).toHaveBeenCalledTimes(1);
    await act(async () => {
      held.resolve({ ok: true });
    });
  });

  it('T1c. fail, flip to pending_sent, flip back to none: the + is back and no failure line resurfaces', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    const { setStatus } = renderWithStatus('none');
    fireEvent.click(addFriendPlus()!);
    await screen.findByRole('alert');
    setStatus('pending_sent');
    setStatus('none');
    expect(addFriendPlus()).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bareMarker()).toBeNull();
  });

  it('T1d. a popover failure then a flip to pending_sent: Request pending shows and no failure remains', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    const { setStatus } = renderWithStatus('none');
    const addFriend = await openPopoverByKeyboard();
    fireEvent.click(addFriend);
    expect(await screen.findByRole('alert')).toHaveTextContent(X3);
    setStatus('pending_sent');
    expect(screen.getByRole('button', { name: 'Request pending' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(bareMarker()).toBeNull();
  });

  it('T1g. a swallowed 409 (the send resolves) then pending_received: no X3, focus follows to Pending', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    const { setStatus } = renderWithStatus('none');
    const plus = addFriendPlus()!;
    plus.focus();
    fireEvent.click(plus);
    await act(async () => {
      held.resolve(undefined);
    });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(X3)).toBeNull();
    expect(document.activeElement).toBe(plus);
    expect(plus).not.toHaveAttribute('aria-disabled');
    setStatus('pending_received');
    await waitFor(() => expect(document.activeElement).toBe(pendingSpan()));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('T1h. a swallowed 409 then accepted: no X3, focus follows to the Friend indicator', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    const { setStatus } = renderWithStatus('none');
    const plus = addFriendPlus()!;
    plus.focus();
    fireEvent.click(plus);
    await act(async () => {
      held.resolve(undefined);
    });
    setStatus('accepted');
    await waitFor(() => expect(document.activeElement).toBe(screen.getByText('✓ Friend')));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(X3)).toBeNull();
  });

  it('T1i. a later failed load and the way back: focus lands on the node that REPLACED the focused one', async () => {
    // Arm 1: Pending -> unknown lands on a NEW plain-name node.
    {
      const { setStatus } = renderWithStatus('none');
      const plus = addFriendPlus()!;
      plus.focus();
      await act(async () => {
        fireEvent.click(plus);
      });
      setStatus('pending_sent');
      await waitFor(() => expect(document.activeElement).toBe(pendingSpan()));
      const oldPending = pendingSpan();
      const oldTrigger = nameTrigger();
      setStatus('unknown');
      const plain = screen.getByText('ada');
      expect(plain).not.toBe(oldPending);
      expect(plain).not.toBe(oldTrigger);
      expect(plain.getAttribute('role')).not.toBe('button');
      await waitFor(() => expect(document.activeElement).toBe(plain));
      cleanup();
    }
    // Arm 2: the name trigger -> unknown, without and with children; then arm 3 continues it.
    for (const withChildren of [false, true]) {
      const props = withChildren ? { children: <span data-testid="kid">ada</span> } : undefined;
      const { setStatus } = renderWithStatus('none', props);
      const trigger = nameTrigger();
      trigger.focus();
      setStatus('unknown');
      expect(trigger.isConnected).toBe(false);
      const plain = withChildren ? screen.getByTestId('kid').parentElement! : screen.getByText('ada');
      expect(plain).not.toBe(trigger);
      await waitFor(() => expect(document.activeElement).toBe(plain));
      cleanup();
    }
    // Arm 3: from the parked plain name back to none / self lands on the trigger, which keeps
    // its tabindex 0 after focus has really left (one macrotask, plan 04's tabindex rule).
    for (const back of ['none', 'self'] as const) {
      const { setStatus } = renderWithStatus('none');
      nameTrigger().focus();
      setStatus('unknown');
      const plain = screen.getByText('ada');
      await waitFor(() => expect(document.activeElement).toBe(plain));
      setStatus(back);
      await waitFor(() => expect(document.activeElement).toBe(nameTrigger()));
      screen.getByRole('button', { name: 'outside' }).focus();
      await flushMacrotask();
      expect(nameTrigger()).toHaveAttribute('tabindex', '0');
      cleanup();
    }
    // Arm 4: a viewport crossing 768px — every indicator is display none, so a hidden Friend
    // indicator is not a target and focus lands on the name trigger.
    const style = document.createElement('style');
    style.textContent = '.md\\:hidden { display: none; }';
    document.head.appendChild(style);
    try {
      const { setStatus } = renderWithStatus('pending_sent');
      pendingSpan().focus();
      expect(document.activeElement).toBe(pendingSpan());
      setStatus('accepted');
      await waitFor(() => expect(document.activeElement).toBe(nameTrigger()));
    } finally {
      style.remove();
    }
  });

  it('T1j. a failure that lands AFTER the status moved is never attached, now or on the return', async () => {
    // Arm 1: the inline +.
    {
      const held = deferred();
      sendRequest.mockReturnValueOnce(held.promise);
      const { setStatus } = renderWithStatus('none');
      const plus = addFriendPlus()!;
      plus.focus();
      fireEvent.click(plus);
      const watch = watchAttachments();
      setStatus('pending_received');
      await act(async () => {
        held.reject(new Error('boom'));
      });
      setStatus('none');
      expect(addFriendPlus()).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(bareMarker()).toBeNull();
      const seen = watch.stop();
      expect(seen.failures).toBe(0);
      expect(seen.all).toBeGreaterThan(0);
      cleanup();
    }
    // Arm 2: the popover's Add friend.
    {
      const held = deferred();
      sendRequest.mockReturnValueOnce(held.promise);
      const { setStatus } = renderWithStatus('none');
      const addFriend = await openPopoverByKeyboard();
      fireEvent.click(addFriend);
      const watch = watchAttachments();
      setStatus('pending_received');
      expect(screen.getByRole('button', { name: 'Request pending' })).toBeInTheDocument();
      await act(async () => {
        held.reject(new Error('boom'));
      });
      expect(screen.getByRole('button', { name: 'Request pending' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      setStatus('none');
      expect(screen.getByRole('button', { name: 'Add friend' })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).toBeNull();
      expect(bareMarker()).toBeNull();
      const seen = watch.stop();
      expect(seen.failures).toBe(0);
      expect(seen.all).toBeGreaterThan(0);
    }
  });

  it('T1k. a retry tap that does not move focus (the iPhone shape): focus goes from the alert to the +', async () => {
    const held = deferred();
    sendRequest.mockRejectedValueOnce(new Error('boom')).mockReturnValueOnce(held.promise);
    renderWithStatus('none');
    fireEvent.click(addFriendPlus()!);
    const alert = await screen.findByRole('alert');
    await waitFor(() => expect(document.activeElement).toBe(alert));
    const plus = addFriendPlus()!;
    fireEvent.click(plus);
    await waitFor(() => expect(document.activeElement).toBe(plus));
    await act(async () => {
      held.resolve({ ok: true });
    });
  });

  it('T1l. focus inside the popover when the status turns unknown: focus lands on the NEW plain name', async () => {
    const { setStatus } = renderWithStatus('none');
    await openPopoverByKeyboard();
    const trigger = nameTrigger();
    setStatus('unknown');
    const plain = screen.getByText('ada');
    expect(plain).not.toBe(trigger);
    await waitFor(() => expect(document.activeElement).toBe(plain));
  });

  it('T1o. a node inside the still-open popover goes away: focus stays on the floating element', async () => {
    const held = deferred();
    sendRequest.mockReturnValueOnce(held.promise);
    renderWithStatus('none');
    const addFriend = await openPopoverByKeyboard();
    const trigger = nameTrigger();
    const floating = document.querySelector('[data-member-popover]');
    expect(floating).not.toBeNull();
    fireEvent.click(addFriend);
    await act(async () => {
      held.resolve({ ok: true });
    });
    await waitFor(() => expect(document.activeElement).toBe(floating));
    expect(document.activeElement).not.toBe(trigger);
    expect(floating!.isConnected).toBe(true);
  });

  it('T1m. the 87.8 D-13 handoff fires once per inline success: a later cycle never pulls focus back', async () => {
    const { setStatus } = renderWithStatus('none');
    const plus = addFriendPlus()!;
    plus.focus();
    await act(async () => {
      fireEvent.click(plus);
    });
    setStatus('pending_sent');
    await waitFor(() => expect(document.activeElement).toBe(pendingSpan()));
    const outside = screen.getByRole('button', { name: 'outside' });
    outside.focus();
    setStatus('unknown');
    setStatus('pending_sent');
    expect(await screen.findByText('⏳ Pending')).toBeInTheDocument();
    await flushMacrotask();
    expect(document.activeElement).toBe(outside);
  });

  it('T1n. a status that falls back to none never lands on the +: Pending and Friend recover to the name', async () => {
    for (const via of ['pending_sent', 'accepted'] as const) {
      const { setStatus } = renderWithStatus('none');
      const plus = addFriendPlus()!;
      plus.focus();
      await act(async () => {
        fireEvent.click(plus);
      });
      setStatus(via);
      const indicator = via === 'pending_sent' ? pendingSpan() : screen.getByText('✓ Friend');
      await waitFor(() => expect(document.activeElement).toBe(indicator));
      setStatus('none');
      await waitFor(() => expect(document.activeElement).toBe(nameTrigger()));
      cleanup();
    }
  });
});
