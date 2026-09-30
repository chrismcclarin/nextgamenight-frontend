/**
 * SPEC Req 5 / D-15 — `showInlineIndicator`, the opt-out that lets a member CHIP render
 * without the inline `md:hidden` indicator that every member ROW keeps.
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * `ClickableMemberName` renders `renderMobileIndicator()` as a SIBLING of the trigger span,
 * outside the element `children` renders into. Every branch of it is `md:hidden`, i.e. VISIBLE
 * at 375px: `✓ Friend` for `accepted`, `⏳ Pending` for either pending direction, an assertive
 * `Failed to send request` (plus the `+` again, for a retry) when the `+` send fails (plan
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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import ClickableMemberName from './ClickableMemberName';
import { FriendshipContext } from './FriendshipStatusProvider';

type Status = 'none' | 'accepted' | 'pending_sent' | 'pending_received' | 'self' | 'unknown';

const sendRequest = vi.fn(async () => ({ ok: true }));

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
// the "+" was, and the "+" is back beside it. The copy is REUSED from the popover's own alert
// ("Failed to send request") — no new string (P1).
describe('88.6-63 (review round 2 #22) — a failed "+" keeps focus, announces, and offers a retry', () => {
  it('a failed send leaves focus on an alert reading "Failed to send request", with the + restored', async () => {
    sendRequest.mockRejectedValueOnce(new Error('boom'));
    renderName('none');

    const plus = addFriendPlus()!;
    plus.focus();
    expect(document.activeElement).toBe(plus);
    fireEvent.click(plus);

    // Settle on the failure outcome in EITHER shape (the old bare "Failed" span or the fix), so the
    // focus assertion below is what fails first on a tree that drops focus.
    await screen.findByText(/^Failed/);
    await waitFor(() => expect(document.activeElement).not.toBe(document.body));
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Failed to send request');
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
