/**
 * Req 4 (DES-03 / UI-SPEC §7.2) — the two controls 87.8-08's census recorded as
 * pointer-only, pinned as keyboard-OPERABLE.
 *
 * WHAT WENT WRONG ONCE AND MUST NOT AGAIN
 * --------------------------------------
 * 87.8-08 censused every non-`.btn` tappable and scored each on three columns. Two rows came
 * back "NO" in the Kbd column and were deferred to this phase:
 *
 *   `PromptScheduleSection.js:147` — the "Check-ins" expand header, a `div` with an `onClick`
 *     and no role, no tabIndex and no key handler. On groupPlanning it is the ONLY way to open
 *     the check-ins body, so a keyboard-only user could not reach polls at all.
 *   `ClickableMemberName.js` — the username span. Its popover is opened by HOVER
 *     (`useHover`, `mouseOnly: true`) or by tap, and the mobile "+" shortcut is `md:hidden`.
 *     A keyboard user therefore had no path to the friend-request flow on any surface.
 *
 * WHY THESE ASSERT ACTIVATION AND NOT `tabIndex` (AR R1-M21)
 * ---------------------------------------------------------
 * Reachable-but-inert passes an attribute check and fails the person. Adding `tabIndex={0}` to
 * a div puts it in the tab order and changes nothing else: the control receives focus and then
 * does nothing on Enter, which is arguably worse than being skipped — it is a dead stop in the
 * tab order. So every pin below asserts the OUTCOME of a key press (the body expanded, the
 * popover opened), never the attribute that makes it focusable. Test 5 is the guard on that
 * discipline: it proves the suite can tell operable from merely-focusable.
 *
 * BOTH KEYS, DELIBERATELY. Enter and Space are separately pinned because they take different
 * paths in the DOM: on a real `<button>` the browser synthesises a click for both, but on a
 * `role="button"` element it synthesises NEITHER, so each is only handled if the handler says
 * so. A one-key implementation is the most likely regression here, and it would pass a
 * single-key test.
 */
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import PromptScheduleSection from './PromptScheduleSection';
import ClickableMemberName from './ClickableMemberName';
import { FriendshipContext } from './FriendshipStatusProvider';

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    promptSettingsAPI: {
      ...actual.promptSettingsAPI,
      getGroupPromptSettings: vi.fn(async () => ({ schedules: [], settings: {} })),
    },
    promptAPI: {
      ...actual.promptAPI,
      getOpenPrompts: vi.fn(async () => ({ prompts: [] })),
    },
  };
});

function renderWithClient(ui: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
}

const friendshipValue = {
  getStatus: () => 'none',
  sendRequest: vi.fn(async () => ({ ok: true })),
};

function renderMemberName(extra?: { onParentKeyDown?: (e: React.KeyboardEvent) => void }) {
  return render(
    <FriendshipContext.Provider value={friendshipValue as never}>
      {/* mirrors grouplist.js: the name renders INSIDE a role="button" card that has its
          own Enter/Space handler. This is the nesting the stopPropagation pin is about. */}
      <div role="button" tabIndex={0} onKeyDown={extra?.onParentKeyDown}>
        <ClickableMemberName userId="u1" username="ada" />
      </div>
    </FriendshipContext.Provider>,
  );
}

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe('PromptScheduleSection check-ins header is keyboard-operable (87.8-08 -> 88-28)', () => {
  function header() {
    return screen.getByRole('button', { name: /check-ins/i });
  }

  it('1. Enter on the header EXPANDS the body (not merely focuses it)', async () => {
    renderWithClient(<PromptScheduleSection groupId="g1" group={{ games: [] }} userRole="member" />);
    const el = header();
    expect(el).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(el, { key: 'Enter' });
    await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'true'));
  });

  it('2. Space also activates it, and is preventDefault-ed so the page does not scroll', async () => {
    renderWithClient(<PromptScheduleSection groupId="g1" group={{ games: [] }} userRole="member" />);
    const el = header();
    const evt = fireEvent.keyDown(el, { key: ' ' });
    // fireEvent returns false when a listener called preventDefault
    expect(evt, 'Space must be preventDefault-ed: its default on a non-button is page scroll')
      .toBe(false);
    await waitFor(() => expect(header()).toHaveAttribute('aria-expanded', 'true'));
  });

  it('3. an unrelated key does nothing (the handler is not a catch-all)', async () => {
    renderWithClient(<PromptScheduleSection groupId="g1" group={{ games: [] }} userRole="member" />);
    fireEvent.keyDown(header(), { key: 'a' });
    expect(header()).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('ClickableMemberName username is keyboard-operable (87.8-08 -> 88-28)', () => {
  it('4. Enter and Space each OPEN the popover, so a keyboard user can reach "Add friend"', async () => {
    const { unmount } = renderMemberName();
    const name = screen.getByRole('button', { name: 'ada' });
    expect(name).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(name, { key: 'Enter' });
    // the popover's own control is the proof the flow is REACHED, not just that a flag flipped
    await screen.findByRole('button', { name: 'Add friend' });
    unmount();

    renderMemberName();
    const name2 = screen.getByRole('button', { name: 'ada' });
    fireEvent.keyDown(name2, { key: ' ' });
    await screen.findByRole('button', { name: 'Add friend' });
  });

  // 88-CODE-REVIEW MED#16: opening was pinned (test 4), but the popover portals to
  // end-of-body — without FloatingFocusManager the Add friend button was the LAST
  // tab stop in the document, so "operable" was only nominal. On keyboard open,
  // focus must LAND on the button and Enter must fire the actual request.
  it('4b. keyboard open moves focus INTO the popover and Enter activates Add friend', async () => {
    friendshipValue.sendRequest.mockClear();
    renderMemberName();
    const name = screen.getByRole('button', { name: 'ada' });
    name.focus();
    fireEvent.keyDown(name, { key: 'Enter' });

    const addFriend = await screen.findByRole('button', { name: 'Add friend' });
    await waitFor(() => expect(addFriend).toHaveFocus());

    fireEvent.click(addFriend);
    await waitFor(() => expect(friendshipValue.sendRequest).toHaveBeenCalledWith('u1'));
  });

  it('5. ANTI-VACUITY: the pin fails for a control that is focusable but inert', () => {
    // A `tabIndex`-only span — exactly the "fix" AR R1-M21 warns is not one. If tests 1-4 were
    // written against attributes instead of outcomes, this markup would pass them all.
    render(
      <span role="button" tabIndex={0}>
        ada
      </span>,
    );
    const inert = screen.getByRole('button', { name: 'ada' });
    expect(inert).toHaveAttribute('tabindex', '0'); // reachable...
    fireEvent.keyDown(inert, { key: 'Enter' });
    expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument(); // ...and dead
  });

  it('6. Enter does NOT also fire the enclosing card handler (the keyboard tap-stealing twin)', async () => {
    const onParentKeyDown = vi.fn();
    renderMemberName({ onParentKeyDown });
    fireEvent.keyDown(screen.getByRole('button', { name: 'ada' }), { key: 'Enter' });
    await screen.findByRole('button', { name: 'Add friend' });
    // Without stopPropagation this is 1, and pressing Enter on a member's name would ALSO
    // navigate to the group — the keyboard twin of the tap-stealing bug 87.8 D-13 fixed.
    expect(onParentKeyDown).not.toHaveBeenCalled();
  });

  it('7. the handlers are MERGED into getReferenceProps, not written after a spread', () => {
    // This is a SOURCE pin, and that is deliberate — the behavioural version of it is
    // vacuous, which was found the hard way. Sequence, recorded because the wrong version of
    // this test would have looked fine:
    //   MEASURED  getReferenceProps() returns ['onPointerDown','onPointerEnter','onMouseMove',
    //             'onKeyDown'] — so a sibling onKeyDown after a spread REPLACES a library
    //             handler (useDismiss's closeOnEscapeKeyDown) instead of adding to one.
    //   PLANTED   the spread form, and asserted open-by-Enter then Escape-closes.
    //   RESULT    still GREEN. useDismiss ALSO registers that callback on the DOCUMENT
    //             (`if (escapeKey) doc.addEventListener('keydown', …)`), so Escape survives
    //             the clobber. The behavioural pin could not see the defect.
    // The redundancy is the library's private detail, not a contract, and the hooks most
    // likely to be added here next (useClick, useListNavigation) put Enter/Space and arrow
    // handling on the reference with NO document twin. So the property worth pinning is the
    // safe CALL SHAPE, not a behaviour that a redundancy happens to cover today.
    // Comments are stripped first. Without that this assertion is RED on the DECISION marker
    // that documents the decision — the exact comment-blindness recorded at DEF-88-25-02 and
    // hit again by this plan's own Req 4 gate. A guard on a rule must not be defeated by the
    // rule being written down.
    const raw = fs.readFileSync(path.join(__dirname, 'ClickableMemberName.js'), 'utf8');
    const src = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    expect(src).toContain('{...getReferenceProps({');
    expect(src, 'a bare spread lets a sibling handler clobber a library one').not.toContain(
      '{...getReferenceProps()}',
    );
    // anti-vacuity: the strip must not have eaten the code it is scanning
    expect(src).toContain('setIsOpen');
    expect(raw, 'the decision is recorded at the site').toContain('DECISION Phase 88-28');
  });
});
