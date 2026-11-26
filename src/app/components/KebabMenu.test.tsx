/**
 * Phase 88.6-16 (D-12) — `KebabMenu`'s composed audit and the SOURCE halves of its two
 * UI-SPEC §9.3 E6 backstops.
 *
 * WHY THIS FILE EXISTS ALONGSIDE `keyboardOperability.test.tsx`
 * ------------------------------------------------------------
 * That file owns the CONTRACT (what the markup claims and what the keyboard does). This one owns
 * the two things that are not contract assertions: an axe audit of the OPEN menu — the surface the
 * ARIA change actually lands on, so an audit of the open state is the direct evidence that the
 * disclosure is now honest — and the source halves of the §9.3 E6 overflow and long-text
 * backstops. There was no `KebabMenu` suite before this plan; this is the file, checked first.
 *
 * WHY THE TWO §9.3 E6 BACKSTOPS ARE SPLIT, AND WHERE THEIR GEOMETRY HALF LIVES
 * ---------------------------------------------------------------------------
 * jsdom performs NO layout. Every box it reports is zero — measured in this file by the
 * `jsdom measures nothing` guard below, which asserts that fact rather than assuming it. So a
 * jsdom `scrollWidth <= clientWidth` assertion on the popover would be `0 <= 0`: green forever,
 * for a menu that clips every item. This repo's gate ledger already carries twelve backstops that
 * cannot fail, and adding two more is worse than adding none.
 *
 * The split is the one UI-SPEC §9.3 already uses for E1/E5 (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-UI-SPEC.md ("### 9.2 Resolutions")):
 *   - SOURCE half (here): the class contract that makes the rendered behaviour possible, asserted
 *     in BOTH the disarmed and the ARMED states, and demonstrated able to fail.
 *   - GEOMETRY half: a planted 375px probe in `e2e/touch-targets.spec.ts`, wearing this
 *     component's own shipped class strings. Read a red here against a red there.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within, act, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { CONFIRM_DELAY_MS } from '@/components/ui/confirmDelay';
import { SPINNER_DELAY_MS, SPINNER_MIN_MS } from '@/components/ui/useDelayedSpinner'; // AMENDED Phase 88.9-56 (R-C3b reach): the appear and hold budgets
import KebabMenu from './KebabMenu';
import { expectFocusRing, expectRingGround } from '@/test-utils/focusRingAssert';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

// axe-core's `runOnly` takes ONE selector, so the two rules run as two explicit passes — the same
// shape src/app/components/PromptScheduleManager.test.tsx ("const WCAG_412 = { runOnly: { type: 'tag' as const") uses.
const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/**
 * The LARGEST authored item set that ships: src/app/components/ManageMembers.js ("Mobile (<768px) — kebab collapses role swap + Remove (and")'s mobile member kebab with the
 * owner-only transfer item spread in (src/app/components/ManageMembers.js ("...(userRole === 'owner' ? [{")) — role swap + two-tap Remove + Transfer. The
 * desktop src/app/components/ManageMembers.js ("owner-only Transfer Ownership kebab on") kebab is the single-item subset of it.
 */
const LARGEST_SHIPPED_ITEMS = () => [
  { label: 'Make admin', onClick: vi.fn() },
  {
    label: 'Remove',
    danger: true,
    twoTap: true,
    armedName: 'Tap again to remove',
    onClick: vi.fn(),
  },
  { label: 'Transfer ownership to this member', danger: true, onClick: vi.fn() },
];

function openMenu(name = 'Member actions') {
  const trigger = screen.getByRole('button', { name });
  fireEvent.click(trigger);
  const list = document.getElementById(trigger.getAttribute('aria-controls') as string);
  expect(list, 'the trigger names its open list through aria-controls').not.toBeNull();
  return { trigger, list: list as HTMLElement };
}

describe('KebabMenu composed axe audit — the OPEN menu, where the ARIA change lands', () => {
  it('1. the open menu with the largest shipped item set reports zero WCAG 4.1.2 violations', async () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();

    // Settle on a BRANCH-specific element, never on chrome: the trigger renders in both states,
    // so asserting on it would audit a closed menu and score the wrong tree (88.6-15's recorded
    // trap). The item list only exists in the open branch.
    expect(within(list).getAllByRole('listitem')).toHaveLength(3);

    // `document.body`, not the render container: the sr-only StatusRegion is PORTALED there, so
    // the container alone is not the composed surface (see the portal DECISION marker in
    // KebabMenu.js). Both rules are scoped by runOnly, so no page-level rule fires on body.
    expect(await axe(document.body, WCAG_412)).toHaveNoViolations();
    expect(await axe(document.body, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the ARMED state is audited too — that is where the new ARIA actually is', async () => {
    // `aria-pressed` on a plain button is the attribute D-12 traded the item role FOR (it is
    // illegal on the old role: axe-core 4.12.1's allowed-attrs list is posinset/setsize/expanded).
    // Auditing only the disarmed menu would never exercise it.
    // F9b (88.9-23): the armed item is first GATED (aria-pressed + aria-disabled, the countdown
    // label), then live. Both armed states are audited.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    const gated = within(list).getByRole('button', { name: 'Remove, wait 3 seconds' });
    expect(gated).toHaveAttribute('aria-pressed', 'true');
    expect(gated).toHaveAttribute('aria-disabled', 'true');
    expect(await axe(document.body, WCAG_412)).toHaveNoViolations();
    expect(await axe(document.body, HEADING_ORDER)).toHaveNoViolations();

    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(within(list).getByRole('button', { name: 'Tap again to remove' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    expect(await axe(document.body, WCAG_412)).toHaveNoViolations();
    expect(await axe(document.body, HEADING_ORDER)).toHaveNoViolations();
  });

  it('3. ANTI-VACUITY: the same audit DOES catch a name-less control on this surface', async () => {
    // Without this, tests 1 and 2 also pass for an audit that was scoped to an empty subtree or
    // for a rule selector that matches nothing. A button with no accessible name is the canonical
    // 4.1.2 failure, planted on the same body the audits above scan.
    render(
      <>
        <KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />
        <button type="button" />
      </>,
    );
    openMenu();
    const results = await axe(document.body, WCAG_412);
    expect(
      (results.violations ?? []).map((v) => v.id),
      'the 4.1.2 pass reported no `button-name` violation for a name-less button — it is not actually auditing this tree, and tests 1 and 2 prove nothing',
    ).toContain('button-name');
  });
});

describe('UI-SPEC §9.3 E6 backstops — SOURCE halves (geometry is in e2e/touch-targets.spec.ts)', () => {
  it('0. jsdom measures NOTHING — the fact that routes both geometry halves to Playwright', () => {
    // Asserted, not asserted-about. If jsdom ever grows layout, this reds and the routing
    // decision below should be revisited rather than inherited.
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const item = within(list).getAllByRole('button')[0];
    expect(
      [list.clientWidth, list.scrollWidth, item.clientWidth, item.scrollWidth, item.offsetHeight],
      'jsdom reported a non-zero box — a `scrollWidth <= clientWidth` backstop would no longer be vacuous here',
    ).toEqual([0, 0, 0, 0, 0]);
  });

  /* UI-SPEC §9.3 E6 · overflow — "the open popover stays within the 375px viewport for the largest
     authored item set with no clipping".
     SOURCE half: the popover is width-BOUNDED-BELOW and right-anchored, never width-FIXED. A
     `min-w-[160px]` floor plus `absolute right-0` is what lets it grow leftwards inside a 375px
     viewport instead of pushing past the right edge; a `w-[…]` or a `left-0` would break exactly
     that and are the two edits a future reader is most likely to make.
     GEOMETRY half: `e2e/touch-targets.spec.ts`, the §9.3 E6 planted 375px probe. */
  it('E6-overflow (source half). The popover is right-anchored and min-width bounded, never width-fixed', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const cls = list.className;

    expect(cls, 'the popover is anchored to the row\'s right edge, so it grows LEFTWARDS').toContain(
      'right-0',
    );
    expect(cls, 'and it is absolutely positioned, so its width is content-driven').toContain(
      'absolute',
    );
    expect(cls, 'a min-width FLOOR, not a fixed width').toContain('min-w-[160px]');
    // X67 (88.9-67): the menu is content-sized, so its longest item sits on one line, and it is
    // capped at the viewport, so a longer label still wraps inside it (the long-text half below).
    // Without the content size an absolute right-0 box shrinks to its 44px trigger wrapper and the
    // floor becomes the width of every menu.
    expect(cls.split(/\s+/), 'content-sized: as wide as the longest item').toContain('w-max');
    expect(cls.split(/\s+/), 'capped at the viewport less a margin').toContain('max-w-[calc(100vw-2rem)]');
    expect(
      cls,
      'a fixed `w-` or a `left-0` would pin the popover to a width or an edge it cannot grow away from at 375px — the geometry half in e2e/touch-targets.spec.ts is what would then red',
    ).not.toMatch(/(^|\s)(w-\[|w-\d|left-0)/);
  });

  /* UI-SPEC §9.3 E6 · long-text — "long item labels wrap inside the popover at 375px and are never
     clipped; the armed label swap keeps the item at min-h-11".
     SOURCE half: no clipping utility on the item, in EITHER state, and a min-height floor rather
     than a fixed height. The armed branch is asserted separately because it is a DIFFERENT class
     string (`bg-status-error-subtle font-semibold`), so a clipping utility could be added to one
     branch and not the other.
     GEOMETRY half: `e2e/touch-targets.spec.ts`, the §9.3 E6 planted 375px probe. */
  it('E6-long-text (source half). No clipping utility on the item, disarmed OR armed, and the height is a FLOOR', () => {
    const LONG =
      'Transfer ownership of this group to this member right now, permanently and irreversibly';
    // F9b (88.9-23): the armed, live branch shows once the gate has run out. R13 (88.9-52): its
    // visible words are always Tap again, so the LONG text is the resting label only.
    vi.useFakeTimers();
    render(
      <KebabMenu
        ariaLabel="Member actions"
        items={[
          { label: LONG, danger: true, twoTap: true, onClick: vi.fn() },
        ]}
      />,
    );
    const { list } = openMenu();
    const CLIPPERS = /(^|\s)(truncate|text-ellipsis|whitespace-nowrap|overflow-hidden|line-clamp-\d)/;

    const disarmed = within(list).getByRole('button', { name: LONG });
    expect(
      disarmed.className,
      'a clipping utility on the item is what turns a long label into an unreadable one at 375px',
    ).not.toMatch(CLIPPERS);
    expect(disarmed.className, 'min-h-11 is a FLOOR, so a wrapped label grows the row').toContain(
      'min-h-11',
    );
    expect(
      disarmed.className,
      'a fixed `h-` would cap the row and clip the second line the wrap creates',
    ).not.toMatch(/(^|\s)h-\d/);

    fireEvent.click(disarmed);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    const armed = within(list).getByRole('button', { name: 'Tap again to confirm' });
    expect(armed, 'the armed label swap must not remount the item').toBe(disarmed);
    expect(
      armed.className,
      'the ARMED branch is a different class string — a clipper added to it alone would pass a disarmed-only assertion',
    ).not.toMatch(CLIPPERS);
    expect(armed.className, 'and the armed swap must not shrink the target below 44px').toContain(
      'min-h-11',
    );
  });

  it('E6 (source halves) ANTI-VACUITY: the same matchers DO fire on the shapes they forbid', () => {
    // The four `not.toMatch` / `not.toContain` expectations above are the most vacuous shape there
    // is — they also pass for a className that was never read, for an element that was never
    // found, and for a regex that matches nothing. These are the same matchers against the exact
    // strings they exist to catch.
    const CLIPPERS = /(^|\s)(truncate|text-ellipsis|whitespace-nowrap|overflow-hidden|line-clamp-\d)/;
    expect('w-full min-h-11 text-left truncate px-3').toMatch(CLIPPERS);
    expect('w-full min-h-11 text-left line-clamp-2 px-3').toMatch(CLIPPERS);
    expect('absolute left-0 top-full w-[160px]').toMatch(/(^|\s)(w-\[|w-\d|left-0)/);
    expect('w-full h-11 text-left px-3').toMatch(/(^|\s)h-\d/);
    // and the ones the shipped strings must NOT trip
    expect('w-full min-h-11 text-left px-3 py-2').not.toMatch(CLIPPERS);
    expect('absolute right-0 top-full mt-1 z-20 w-max min-w-[160px] max-w-[calc(100vw-2rem)]').not.toMatch(
      /(^|\s)(w-\[|w-\d|left-0)/,
    );
    expect('w-full min-h-11 text-left px-3 py-2').not.toMatch(/(^|\s)h-\d/);
  });
});

// F9b (88.9-23, owner pick F9b, 88.9-PICKS-B5.json item F9; window = the Q4 ruling in
// 88.9-RULINGS.md round 2): a twoTap item is inert for CONFIRM_DELAY_MS after arming, then
// live; the gated look is a muted ink, never an opacity wash (O-17).
describe('KebabMenu F9b delayed enable and the O-17 gated look (88.9-23)', () => {
  it('F9b (88.9): a twoTap item stays inert 3 s then commits', async () => {
    // shouldAdvanceTime: user-event's keyboard waits on a timeout of its own.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const user = userEvent.setup({ advanceTimers: (ms) => vi.advanceTimersByTime(ms) });
    const onClose = vi.fn();
    render(
      <KebabMenu
        ariaLabel="Poll actions"
        items={[{ label: 'Close poll', danger: true, twoTap: true, onClick: onClose }]}
      />
    );
    const { list } = openMenu('Poll actions');
    const item = within(list).getByRole('button', { name: 'Close poll' });

    fireEvent.click(item);
    expect(item).toHaveTextContent('Wait (3)');
    // X69 (88.9-67): the gated item is named for its action, then the wait.
    expect(item).toHaveAccessibleName('Close poll, wait 3 seconds');
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAttribute('aria-pressed', 'true');
    // DEC-5: nothing is announced while pressing would do nothing.
    expect(screen.getByRole('status').textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    fireEvent.click(item);
    expect(onClose).not.toHaveBeenCalled();
    expect(item).toHaveTextContent('Wait (2)');
    expect(item).toHaveAccessibleName('Close poll, wait 2 seconds');
    expect(item).toHaveAttribute('aria-pressed', 'true');

    act(() => {
      vi.advanceTimersByTime(1500);
    });
    item.focus();
    await user.keyboard('{Enter}');
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('status').textContent).toBe('');

    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS - 2500);
    });
    expect(item.textContent).toBe('Tap again');
    expect(item).toHaveAccessibleName('Tap again to confirm');
    expect(item).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('status').textContent).toBe('Press again to confirm: Close poll');

    fireEvent.click(item);
    expect(onClose).toHaveBeenCalledTimes(1);
    // No keepOpen: the commit closes the menu as before.
    expect(list).not.toBeInTheDocument();
  });

  it('F9b: gated look is colour, no opacity class', () => {
    vi.useFakeTimers();
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[
          // The in-flight shape since rule 1 (88.9-46): the label kept, busy + the heard suffix.
          { label: 'Cancel event', danger: true, ariaDisabled: true, busy: true, busySuffix: ', cancelling', onClick: vi.fn() },
          { label: 'Leave event', danger: true, twoTap: true, onClick: vi.fn() },
        ]}
      />
    );
    const { list } = openMenu('Event actions');
    const inFlight = within(list).getByRole('button', { name: 'Cancel event, cancelling' });
    const twoTap = within(list).getByRole('button', { name: 'Leave event' });
    const expectGatedLook = (button: HTMLElement) => {
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button.className, 'the gated state changes INK').toContain(
        'aria-disabled:text-content-muted',
      );
      expect(button.className, 'and never dims the row (O-17)').not.toMatch(
        /aria-disabled:opacity/,
      );
    };

    // The in-flight item (Cancel event, busy) first, then a twoTap item inside its gate.
    expectGatedLook(inFlight);
    fireEvent.click(twoTap);
    expectGatedLook(twoTap);
  });

  // X69 width (88.9-67): a twoTap item holds the widest of its countdown labels and its armed
  // words from the moment the menu opens, so neither the item nor the menu changes size when it
  // arms or goes live. The reserve is attribute text painted by a pseudo-element
  // (src/components/ui/ReservedLabel.tsx ("DECISION Phase 88.9-67 (X69 width)")), so the item's own text stays its label.
  it('X69 (88.9): a twoTap item reserves the countdown and its armed words from open; a plain item reserves nothing', () => {
    const reserved = (el: HTMLElement) =>
      Array.from(el.querySelectorAll('[data-reserve]')).map((span) => span.getAttribute('data-reserve'));

    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    expect(reserved(remove)).toEqual(['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again']);
    expect(remove.textContent).toBe('Remove');
    expect(reserved(within(list).getByRole('button', { name: 'Make admin' }))).toEqual([]);
    expect(reserved(within(list).getByRole('button', { name: 'Transfer ownership to this member' }))).toEqual([]);
    cleanup();

    // R13 (88.9-52): every item holds the same short armed words, whatever its spoken sentence.
    render(
      <KebabMenu
        ariaLabel="Poll actions"
        items={[{ label: 'Close poll', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const poll = openMenu('Poll actions');
    expect(reserved(within(poll.list).getByRole('button', { name: 'Close poll' }))).toEqual([
      'Wait (3)',
      'Wait (2)',
      'Wait (1)',
      'Tap again',
    ]);
  });

  // X13-7 (88.9-67): a keepOpen activation closes nothing, so focus has to be ON the item — a
  // host's focus recovery watches the focused control, and a tap does not focus a button on
  // WebKit. fireEvent.click never focuses either, which is what makes this pin fail on the old
  // code: focus stayed wherever it was.
  it('X13-7 (88.9): a keepOpen twoTap commit leaves focus on the item it committed, even when the tap never focused it', () => {
    vi.useFakeTimers();
    const onRemove = vi.fn();
    const onLeave = vi.fn();
    render(
      <KebabMenu
        ariaLabel="Member actions"
        items={[
          { label: 'Remove', danger: true, twoTap: true, keepOpen: true, armedName: 'Tap again to remove', onClick: onRemove },
          { label: 'Leave event', keepOpen: true, onClick: onLeave },
        ]}
      />
    );
    const { list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    const leave = within(list).getByRole('button', { name: 'Leave event' });

    fireEvent.click(remove);
    expect(document.activeElement, 'arming does not move focus').not.toBe(remove);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(list, 'keepOpen: the commit closes nothing').toBeInTheDocument();
    expect(document.activeElement).toBe(remove);

    // The single-tap keepOpen exit makes the same promise.
    fireEvent.click(leave);
    expect(onLeave).toHaveBeenCalledTimes(1);
    expect(list).toBeInTheDocument();
    expect(document.activeElement).toBe(leave);
  });
});

// Rule 1 (88.9-46, owner pick O16a + the Q3 ruling): a per-item `busy` flag. The item keeps its
// label, renders the house Spinner (data-slot spinner, plan 88.9-24) and the same sr-only suffix
// span Button renders, so it is NAMED label plus suffix. busy never refuses on its own — the
// caller's `ariaDisabled` stays the gate (the 88.6-16 D-12 split).
describe('KebabMenu busy item (rule 1, 88.9-46)', () => {
  it('rule 1 (88.9): a busy item keeps its label, shows the spinner and is named label plus suffix', async () => {
    const onClick = vi.fn();
    const { rerender } = render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[
          { label: 'Cancel event', danger: true, ariaDisabled: true, busy: true, busySuffix: ', cancelling', onClick },
        ]}
      />
    );
    const { list } = openMenu('Event actions');
    const item = within(list).getByRole('button', { name: 'Cancel event, cancelling' });
    expect(item).toHaveTextContent(/^Cancel event/);
    await waitFor(() => expect(item.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1)); // AMENDED Phase 88.9-56 (R-C3b reach): waits for the 200 ms appear
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).not.toHaveAttribute('disabled');
    fireEvent.click(item);
    expect(onClick).not.toHaveBeenCalled();
    // The item stays mounted when busy drops, so its spinner keeps the hold, then leaves.
    rerender(
      <KebabMenu
        ariaLabel="Event actions"
        items={[
          { label: 'Cancel event', danger: true, ariaDisabled: true, busy: false, busySuffix: ', cancelling', onClick },
        ]}
      />
    );
    expect(item).toHaveAccessibleName('Cancel event');
    expect(item.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1); // AMENDED Phase 88.9-56 (R-C3b reach): the 500 ms hold
    await waitFor(() => expect(item.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0), { timeout: SPINNER_MIN_MS + 1500 }); // AMENDED Phase 88.9-56 (R-C3b reach): the 500 ms hold
    cleanup();

    // At rest the same item carries neither the spinner nor the suffix (anti-vacuity for the
    // busy branch), and a press reaches the handler.
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[{ label: 'Cancel event', danger: true, busy: false, busySuffix: ', cancelling', onClick }]}
      />
    );
    const resting = within(openMenu('Event actions').list).getByRole('button', { name: 'Cancel event' });
    await act(() => new Promise<void>((resolve) => setTimeout(resolve, SPINNER_DELAY_MS + 300))); // AMENDED Phase 88.9-56 (R-C3b reach): read after the appear window
    expect(resting.querySelectorAll('[data-slot="spinner"]')).toHaveLength(0); // AMENDED Phase 88.9-56 (R-C3b reach): read after the appear window
    expect(resting.textContent).toBe('Cancel event');
    fireEvent.click(resting);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  // 88.9-52 W31: a twoTap item's label sits in a cell as wide as its longest armed words, so a
  // spinner placed after that cell sat about 90px right of a short word (measured on the member
  // menu's Remove). jsdom has no layout, so the pin is the spinner's place in the tree: inside the
  // label's own cell, straight after the word.
  it('W31 (88.9-52): a busy twoTap item shows its spinner straight after the word, inside the label cell; a plain busy item keeps it after the label', async () => {
    render(
      <KebabMenu
        ariaLabel="Member actions"
        items={[
          { label: 'Remove', danger: true, twoTap: true, keepOpen: true, armedName: 'Tap again to remove', ariaDisabled: true, busy: true, busySuffix: ', removing', onClick: vi.fn() },
          { label: 'Leave event', ariaDisabled: true, busy: true, busySuffix: ', leaving', onClick: vi.fn() },
        ]}
      />
    );
    const { list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove, removing' });
    const leave = within(list).getByRole('button', { name: 'Leave event, leaving' });
    await waitFor(() => expect(remove.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));
    await waitFor(() => expect(leave.querySelectorAll('[data-slot="spinner"]')).toHaveLength(1));

    const spinner = remove.querySelector('[data-slot="spinner"]') as HTMLElement;
    const cell = spinner.parentElement as HTMLElement;
    expect(cell.tagName, 'the spinner sits in the visible label cell, not after the reserved width').toBe('SPAN');
    expect(cell).not.toHaveAttribute('aria-hidden');
    expect(cell).not.toHaveAttribute('data-reserve');
    expect(cell.parentElement?.querySelectorAll('[data-reserve]').length, 'the cell is the reserved label\'s own').toBe(4);
    expect(cell.firstChild?.textContent, 'the word comes first').toBe('Remove');
    expect(spinner.previousSibling?.textContent).toBe('Remove');
    // The name and the text order are unchanged: label, then the heard suffix.
    expect(remove.textContent).toBe('Remove, removing');

    // A plain item has no reserved cell: its spinner stays a child of the button, after the label.
    const plainSpinner = leave.querySelector('[data-slot="spinner"]') as HTMLElement;
    expect(plainSpinner.parentElement).toBe(leave);
    expect(plainSpinner.previousSibling?.textContent).toBe('Leave event');
  });

  // 88.9-52 W32 (width half): the armed and gated labels paint at 600 while the reserve was
  // measured at the resting 400, so the Cancel event menu grew 1.4px (160 to 161.4) on the first tap.
  it('W32 (88.9-52): every reserved string of a twoTap item is measured at the armed weight', () => {
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[{ label: 'Cancel event', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const item = within(openMenu('Event actions').list).getByRole('button', { name: 'Cancel event' });
    const reserves = Array.from(item.querySelectorAll('[data-reserve]'));
    expect(reserves).toHaveLength(4);
    for (const span of reserves) expect(span).toHaveClass('font-semibold');
    // The armed item paints that same weight (the class the reserve has to match).
    fireEvent.click(item);
    expect(item).toHaveClass('font-semibold');
  });
});

// Plan 88.9-35 (owner pick B2a, 88.9-PICKS-B1.json) gave the trigger the halo of the ground its
// HOST paints, passed as a typed key. AMENDED Phase 89.6-38 (host-ground): owner pick O-1 = B (2026-11-22) made the halo inert and plan 89.6-38 retired the host-ground key,
// so the trigger takes no ground from any host.
describe('KebabMenu trigger host halo (88.9-35)', () => {
  // RE-PINNED by Phase 89.6-26 (O-M4-icons, owner pick O-M4 = Fixed+): the box is held at 44px in px
  // and the glyph's size is inline (iconTextSize; jsdom drops an inline min(), so the e2e sweep row
  // O04 reads the computed size). The rem floor and the text-2xl glyph are gone.
  const SHIPPED = [
    'min-h-[44px]',
    'min-w-[44px]',
    'leading-none',
    'focus:outline-hidden',
  ];
  const GONE = ['min-h-11', 'min-w-11', 'text-2xl'];
  const trigger = () => screen.getByRole('button', { name: 'Member actions' });

  // 89.6-38 (O-1 B): this it once read which halo each host key selected (card by default, the
  // page and the group halo when passed, nothing for an unknown key); with the key retired it
  // guards the same trigger for the ring and for the absence of any halo token.
  it('89.6-38 (O-1 B): the trigger carries the two-tone ring and no halo token', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    for (const token of SHIPPED) expect(trigger()).toHaveClass(token);
    for (const token of GONE) expect(trigger()).not.toHaveClass(token);
    expectFocusRing(trigger(), 'the kebab trigger');
    expectRingGround(trigger(), 'card', 'the kebab trigger carries no halo token');
  });

  // R033's desktop arm was a census false positive (88.9-50): the check-in kebab's nearest painting
  // ancestor is OpenPollCard's li, which paints card at every width, so the mount passes no host
  // prop and keeps the default card halo. Read with fs and a local comment strip, not the
  // sourceScan import (that would register this file as a drift gate).
  it('R033 mount pin (88.9-50): the check-in kebab passes no host ground — its li paints card at every width', () => {
    const stripComments = (src: string) =>
      src.replace(/\/\*[\s\S]*?\*\/|(^|[^:])\/\/[^\n]*/g, (m, lead) =>
        m.startsWith('/*') ? m.replace(/[^\n]/g, ' ') : (lead ?? ''),
      );
    const kebabTags = (src: string) => {
      const tags: string[] = [];
      const open = /<KebabMenu\b/g;
      let hit: RegExpExecArray | null;
      while ((hit = open.exec(src)) !== null) {
        const end = src.indexOf('/>', hit.index);
        tags.push(src.slice(hit.index, end === -1 ? src.length : end + 2));
      }
      return tags;
    };
    const HOST_PROP = /\bhostGround\w*=/;

    const source = stripComments(
      readFileSync(resolve(process.cwd(), 'src/app/components/OpenPollsList.js'), 'utf8'),
    );
    const tags = kebabTags(source);
    expect(tags, 'OpenPollsList mounts exactly one KebabMenu').toHaveLength(1);
    expect(tags[0]).toContain('ariaLabel="Check-in actions"');
    expect(tags[0], 'the check-in kebab must not pass a host ground: its li paints card').not.toMatch(HOST_PROP);

    // AMENDED Phase 89.6-38 (host-ground): the key is retired, so no KebabMenu mount anywhere in
    // src passes a host ground (the walk finds at least the check-in kebab above).
    const offenders: string[] = [];
    let mountCount = 0;
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(js|jsx|ts|tsx)$/.test(entry.name) && !/\.(test|spec)\./.test(entry.name)) {
          for (const tag of kebabTags(stripComments(readFileSync(full, 'utf8')))) {
            mountCount += 1;
            if (HOST_PROP.test(tag)) offenders.push(`${full}: ${tag.slice(0, 80)}`);
          }
        }
      }
    };
    walk(resolve(process.cwd(), 'src'));
    expect(mountCount, 'the walk read KebabMenu mounts').toBeGreaterThan(0);
    expect(offenders, 'KebabMenu mounts that pass a host ground').toEqual([]);

    // Anti-vacuity: the same matcher sees a host prop when one is there.
    const probe = kebabTags('<KebabMenu ariaLabel="Check-in actions" hostGroundFromMd="page" />');
    expect(probe).toHaveLength(1);
    expect(probe[0]).toMatch(HOST_PROP);
  });
});

// 88.9-52 R20 (owner 2026-11-17, pick Rule; his words: "When it's by itself, it should fill the
// box."): a menu with ONE item paints the item's band over the whole menu, to its rounded corners;
// a menu with SEVERAL items paints an evenly inset rounded band, the same on a first, middle or
// last item. The rule is the item COUNT, never the armed state, so no menu changes size when an
// item arms. jsdom performs no layout, so these pin the classes the two shapes are made of; the
// rendered numbers are the capture's (5px inset on every side; 1px inside the border when alone).
describe('R20 (88.9-52): the item band fills a one-item menu and is an inset rounded band in a longer one', () => {
  const tokens = (el: Element) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const GEOMETRY = /^(p[xytblr]?-|m[xytblr]?-|min-h-|min-w-|w-|rounded|overflow-)/;
  const geometry = (el: Element) => tokens(el).filter((t) => GEOMETRY.test(t)).sort();

  it('R20 one item: the list has no vertical padding and clips to its corners, and the item keeps its 12px text inset', () => {
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[{ label: 'Cancel event', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const { list } = openMenu('Event actions');
    const item = within(list).getByRole('button', { name: 'Cancel event' });
    expect(tokens(list)).toContain('py-0');
    expect(tokens(list)).toContain('overflow-hidden');
    expect(tokens(list)).not.toContain('py-1');
    expect(tokens(list)).toContain('rounded-md');
    expect(tokens(item.parentElement as Element)).toEqual([]);
    expect(tokens(item)).toContain('px-3');
    expect(tokens(item)).not.toContain('rounded-sm');

    // Arming changes ink, fill and weight only: every size class on the list and the item stays.
    const listBefore = list.className;
    const itemBefore = geometry(item);
    fireEvent.click(item);
    expect(item).toHaveClass('bg-status-error-subtle');
    expect(list.className).toBe(listBefore);
    expect(geometry(item)).toEqual(itemBefore);
  });

  it('R20 several items: every item is the same inset rounded band, first, middle and last, armed or not', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const items = within(list).getAllByRole('button');
    expect(items).toHaveLength(3);
    // 4px of list padding above the first and below the last, 4px of row padding at the sides:
    // with the 1px border, 5px on every side of the band.
    expect(tokens(list)).toContain('py-1');
    expect(tokens(list)).not.toContain('py-0');
    expect(tokens(list)).not.toContain('overflow-hidden');
    for (const item of items) {
      expect(tokens(item.parentElement as Element)).toEqual(['px-1']);
      expect(tokens(item)).toContain('px-2');
      expect(tokens(item)).toContain('rounded-sm');
      expect(tokens(item)).not.toContain('px-3');
      expect(geometry(item)).toEqual(geometry(items[0]));
    }
    // The text starts where it did: 4px (row) + 8px (item) is the 12px the item used to carry alone.
    expect(1 * 4 + 2 * 4).toBe(3 * 4);

    // The middle item is the one that arms (Remove): the band is the item's own box.
    const listBefore = list.className;
    const before = items.map(geometry);
    fireEvent.click(items[1]);
    expect(items[1]).toHaveClass('bg-status-error-subtle');
    expect(list.className).toBe(listBefore);
    expect(within(list).getAllByRole('button').map(geometry)).toEqual(before);
  });

  // G3 (88.9-52 round 4): the after-build capture (r3-l) found two neighbouring bands touching (0px
  // between an armed band and a hovered one) and the light hover band near invisible (#faf8f5 on
  // the white menu, 1.06). Rows are now 2px apart, and an item hovers on the owner-ruled ghost
  // wash (R8c: #e3dad1 on the card 1.38 in light; dark is the shared wash, as before). jsdom lays
  // nothing out and has no hover: these pin the classes.
  it('G3 several items: neighbouring bands are 2px apart, the 44px tap height stays, and a one-item menu takes no gap', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    expect(tokens(list)).toContain('space-y-0.5');
    for (const item of within(list).getAllByRole('button')) {
      // The gap is the ROW's, outside the item: every item keeps its own 44px floor.
      expect(tokens(item)).toContain('min-h-11');
      expect(tokens(item).filter((t) => /^m[ytb]?-/.test(t))).toEqual([]);
      expect(tokens(item.parentElement as Element)).toEqual(['px-1']);
    }
    cleanup();
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[{ label: 'Cancel event', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const solo = openMenu('Event actions').list;
    expect(tokens(solo).filter((t) => t.startsWith('space-y-'))).toEqual([]);
  });

  it('G3 hover: every resting item hovers on the ghost wash and only while it can be pressed; an armed item keeps its red band', () => {
    const WASH = 'enabled-hover:bg-surface-ghost-hover';
    const anyHoverFill = (el: Element) => tokens(el).filter((t) => /hover:bg-/.test(t));
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const [plain, remove, transfer] = within(list).getAllByRole('button');
    // A plain item, a resting two-tap danger item and a plain danger item: one wash, nothing else.
    for (const item of [plain, remove, transfer]) expect(anyHoverFill(item)).toEqual([WASH]);
    fireEvent.click(remove);
    expect(remove).toHaveClass('bg-status-error-subtle');
    expect(anyHoverFill(remove)).toEqual([]);
    expect(anyHoverFill(plain)).toEqual([WASH]);
    cleanup();
    render(
      <KebabMenu
        ariaLabel="Event actions"
        items={[{ label: 'Cancel event', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const solo = openMenu('Event actions').list;
    expect(anyHoverFill(within(solo).getByRole('button', { name: 'Cancel event' }))).toEqual([WASH]);
  });
});

// OW-2a (89.6-07, owner 2026-11-22: Keep; the pick card: Stays armed while the menu is open;
// closing the menu disarms it). A live twoTap item has no revert timer: it stays armed while its
// menu is open, however long and while focus moves between the items of the menu, and the menu
// closing is what disarms it and says the revert words. The marker is at
// src/app/components/KebabMenu.js ("DECISION Phase 89.6-07 (OW-2a, owner"). Every test runs on a
// fake clock (the afterEach above restores the real one) over the largest shipped item set.
describe('OW-2a (89.6-07): an armed kebab item stays armed while its menu is open; closing the menu is what disarms it', () => {
  const ONE_MINUTE_MS = 60_000;

  // Open the member menu, press Remove and step past the 3 s wait: the item is live.
  function armLiveRemove() {
    const { trigger, list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    return { trigger, list, remove };
  }

  it('OW-2a (89.6-07): a live item is still armed 60 s later with its menu open, and no timer is pending once live', () => {
    vi.useFakeTimers();
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list, remove } = armLiveRemove();
    // Once live nothing is left on the clock (before 89.6-07 the revert timer was: 1).
    expect(vi.getTimerCount()).toBe(0);

    act(() => {
      vi.advanceTimersByTime(ONE_MINUTE_MS);
    });
    expect(remove.textContent).toBe('Tap again');
    expect(remove).toHaveAttribute('aria-label', 'Tap again to remove');
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(remove).not.toHaveAttribute('aria-disabled');
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('Press again to confirm: Remove');
  });

  it('OW-2a (89.6-07): focus moving between the items of the open menu keeps the item armed and says nothing', () => {
    vi.useFakeTimers();
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list, remove } = armLiveRemove();
    act(() => {
      vi.advanceTimersByTime(ONE_MINUTE_MS);
    });
    const makeAdmin = within(list).getByRole('button', { name: 'Make admin' });

    // Focus leaves the armed item for the item above it, then comes back: both moves stay inside
    // the menu, so the dismissal hook ignores them.
    fireEvent.focusOut(remove, { relatedTarget: makeAdmin });
    fireEvent.focusOut(makeAdmin, { relatedTarget: remove });

    expect(remove.textContent).toBe('Tap again');
    expect(remove).toHaveAccessibleName('Tap again to remove');
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(list).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toBe('Press again to confirm: Remove');
  });

  it('OW-2a (89.6-07): closing the menu a minute after the arm disarms the item and says Confirmation cancelled., by an outside press and by the trigger', () => {
    vi.useFakeTimers();
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const first = armLiveRemove();
    act(() => {
      vi.advanceTimersByTime(ONE_MINUTE_MS);
    });
    // Still armed a minute on (before 89.6-07 the item had reverted on its own).
    expect(first.remove.textContent).toBe('Tap again');
    expect(first.remove).toHaveAttribute('aria-pressed', 'true');
    const status = screen.getByRole('status');

    // A press outside the menu closes it: the same region says the revert words.
    fireEvent.mouseDown(document.body);
    expect(first.list).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toBe(status);
    expect(status.textContent).toBe('Confirmation cancelled.');

    // Reopened, the item is at rest: its own label, no pressed state, no name of its own.
    const second = openMenu();
    const removeAtRest = within(second.list).getByRole('button', { name: 'Remove' });
    expect(removeAtRest.textContent).toBe('Remove');
    expect(removeAtRest).not.toHaveAttribute('aria-pressed');
    expect(removeAtRest).not.toHaveAttribute('aria-label');

    // Armed again, it goes live as before.
    fireEvent.click(removeAtRest);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(removeAtRest).toHaveAttribute('aria-pressed', 'true');
    expect(status.textContent).toBe('Press again to confirm: Remove');
    act(() => {
      vi.advanceTimersByTime(ONE_MINUTE_MS);
    });

    // The trigger closes it too, with the same words.
    fireEvent.click(second.trigger);
    expect(second.list).not.toBeInTheDocument();
    expect(status.textContent).toBe('Confirmation cancelled.');
  });
});

// R13 (88.9-52, owner 2026-11-17, pick Everywhere): an armed, live item SHOWS Tap again and is
// NAMED by the full sentence (its own armedName, else the menu's default), and the width it holds
// from open follows the short words. The marker is at src/app/components/KebabMenu.js ("DECISION Phase 88.9-52 (R13)").
describe('R13 (88.9-52): an armed kebab item shows Tap again and is named by its sentence', () => {
  const reserved = (el: HTMLElement) =>
    Array.from(el.querySelectorAll('[data-reserve]')).map((span) => span.getAttribute('data-reserve'));

  it('R13 words: live, the item shows Tap again and is named Tap again to remove; with no sentence of its own, Tap again to confirm', () => {
    vi.useFakeTimers();
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(remove.textContent).toBe('Tap again');
    expect(remove).toHaveAttribute('aria-label', 'Tap again to remove');
    expect(remove).toHaveAccessibleName('Tap again to remove');
    expect(remove).toHaveAttribute('aria-pressed', 'true');
    expect(remove).not.toHaveAttribute('aria-disabled');
    // OW-2a (89.6-07): the window no longer ends; closing the menu returns the item to its own text.
    act(() => {
      vi.advanceTimersByTime(60_000);
    });
    expect(remove.textContent).toBe('Tap again');
    expect(remove).toHaveAttribute('aria-label', 'Tap again to remove');
    fireEvent.mouseDown(document.body);
    const removeAtRest = within(openMenu().list).getByRole('button', { name: 'Remove' });
    expect(removeAtRest.textContent).toBe('Remove');
    expect(removeAtRest).not.toHaveAttribute('aria-label');
    cleanup();

    render(
      <KebabMenu
        ariaLabel="Poll actions"
        items={[{ label: 'Close poll', danger: true, twoTap: true, onClick: vi.fn() }]}
      />
    );
    const poll = openMenu('Poll actions');
    const close = within(poll.list).getByRole('button', { name: 'Close poll' });
    fireEvent.click(close);
    act(() => {
      vi.advanceTimersByTime(CONFIRM_DELAY_MS);
    });
    expect(close.textContent).toBe('Tap again');
    expect(close).toHaveAccessibleName('Tap again to confirm');
  });

  it('R13 width: from open the item holds Wait (3), (2), (1) and Tap again, never the spoken sentence, and room for its busy spinner after its own word', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    expect(reserved(remove)).toEqual(['Wait (3)', 'Wait (2)', 'Wait (1)', 'Tap again']);
    // The busy look is the resting word plus the spinner (its ml-2 and its w-4 are 1.5rem, pr-6):
    // the short words above no longer cover that width by themselves, so it is held by name.
    const trailing = Array.from(remove.querySelectorAll('[data-reserve-trailing]'));
    expect(trailing.map((span) => span.getAttribute('data-reserve-trailing'))).toEqual(['Remove']);
    const classes = trailing[0].className.split(/\s+/);
    expect(classes).toContain('pr-6');
    expect(classes).toContain('invisible');
    expect(classes).toContain('before:content-[attr(data-reserve-trailing)]');
    expect(classes).not.toContain('font-semibold');
    // G2 (88.9-52 round 4): the busy width is held at the RESTING weight by name, not by
    // inheritance. An armed item paints font-semibold on the button, and a reserve with no weight
    // of its own inherits it: the one-item End check-in menu measured 273.23px at rest and
    // 277.34px at Wait (3) and Tap again at 200% text (capture r3-m), the bold form of its own
    // word. jsdom lays nothing out, so this pins the class that fixes the weight, armed or not.
    expect(classes).toContain('font-normal');
    expect(trailing[0].getAttribute('aria-hidden')).toBe('true');
    expect(trailing[0].textContent).toBe('');
    expect(remove.textContent).toBe('Remove');
    // A plain item holds nothing.
    const plain = within(list).getByRole('button', { name: 'Make admin' });
    expect(plain.querySelectorAll('[data-reserve], [data-reserve-trailing]')).toHaveLength(0);
    // G2: armed, the button is bold and the busy reserve still names the resting weight.
    fireEvent.click(remove);
    expect(remove).toHaveClass('font-semibold');
    const armedTrailing = (remove.querySelector('[data-reserve-trailing]') as HTMLElement).className.split(/\s+/);
    expect(armedTrailing).toContain('font-normal');
    expect(armedTrailing).not.toContain('font-semibold');
  });
});

// G4 (88.9-52 round 4): in Manage Members at 200% text the member menu opened 24px off the left of
// the screen, and at every text size its last item was cut by the dialog's footer line (capture
// r3-m). The menu is an absolute box hung from the right edge of its trigger: it knows nothing of
// the box that clips it. On open it now measures that box, caps its width to it, moves right until
// its left edge is inside, and scrolls itself into view. jsdom lays nothing out, so the boxes are
// supplied here; the rendered proof is e2e/manage-members-refresh.spec.ts.
describe('G4 (88.9-52): an open menu stays inside the box that clips it', () => {
  const rect = (left: number, top: number, width: number, height: number) =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) }) as DOMRect;

  const withBoxes = (clip: DOMRect, list: DOMRect) => {
    const scrolled: Array<{ el: Element; arg: unknown }> = [];
    const original = Element.prototype.getBoundingClientRect;
    const rectSpy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this instanceof HTMLElement && this.dataset.testid === 'clip') return clip;
      if (this.getAttribute('role') === 'list') return list;
      return original.call(this);
    });
    const proto = Element.prototype as unknown as { scrollIntoView?: (arg?: unknown) => void };
    const had = proto.scrollIntoView;
    proto.scrollIntoView = function (this: Element, arg?: unknown) {
      scrolled.push({ el: this, arg });
    };
    return {
      scrolled,
      restore: () => {
        rectSpy.mockRestore();
        proto.scrollIntoView = had;
      },
    };
  };

  it('G4: a menu that would start left of its scroll box is capped to the box and moved inside it, then scrolled into view', () => {
    // The dialog body at 375 with 200% text: x 12..363. The menu, hung from its trigger: x -24..287.
    const boxes = withBoxes(rect(12, 100, 351, 400), rect(-24, 300, 311, 306));
    try {
      render(
        <div data-testid="clip" style={{ overflowY: 'auto' }}>
          <KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />
        </div>
      );
      const { list } = openMenu();
      // 351px of box less an 8px gap each side.
      expect(list.style.maxWidth).toBe('min(calc(100vw - 2rem), 335px)');
      // From -24 to 12 + 8.
      expect(list.style.translate).toBe('44px 0');
      expect(boxes.scrolled).toEqual([{ el: list, arg: { block: 'nearest', inline: 'nearest' } }]);
      // The reveal keeps 8px clear of the box's edges.
      expect(list.className.split(/\s+/)).toContain('scroll-m-2');
    } finally {
      boxes.restore();
    }
  });

  it('G4: a menu already inside its box is not moved, and with no clipping box the screen is the box', () => {
    const boxes = withBoxes(rect(12, 100, 351, 400), rect(80.8, 300, 252.23, 142));
    try {
      render(
        <div data-testid="clip" style={{ overflowY: 'auto' }}>
          <KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />
        </div>
      );
      const { list } = openMenu();
      expect(list.style.translate).toBe('');
      expect(list.style.maxWidth).toBe('min(calc(100vw - 2rem), 335px)');
      expect(boxes.scrolled).toHaveLength(1);
    } finally {
      boxes.restore();
    }
    cleanup();

    // No clipping ancestor: the screen (375 wide here) is the box.
    const width = vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(375);
    const page = withBoxes(rect(0, 0, 0, 0), rect(-5, 300, 311, 306));
    try {
      render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
      const { list } = openMenu();
      expect(list.style.maxWidth).toBe('min(calc(100vw - 2rem), 359px)');
      expect(list.style.translate).toBe('13px 0');
    } finally {
      page.restore();
      width.mockRestore();
    }
  });

  // R4 B3 (88.9-52, CI run 44381640391 and the round-4 re-shoot): G4's fit knew the clipping box's
  // width only. At 200% text the Manage Members body is 262px tall on a 375 phone and 173px on a
  // 320 one while the member menu is 314 and 354px, so Transfer ownership sat under the footer
  // line and could not be reached. A menu taller than the room it has now takes that room as its
  // max height and scrolls inside itself; a menu that fits is not touched.
  // The marker is at src/app/components/KebabMenu.js ("AMENDED Phase 88.9-52 (R4 B3, round 4").
  it('R4 B3: a menu taller than the box that clips it takes the box less 8px each end as its height and scrolls inside itself', () => {
    // The dialog body at 320 with 200% text (CI): x 25..295, y 217..390 (173 tall). The menu: 354 tall.
    const boxes = withBoxes(rect(25, 217, 270, 173), rect(33, 233, 254, 354));
    try {
      render(
        <div data-testid="clip" style={{ overflowY: 'auto' }}>
          <KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />
        </div>
      );
      const { list } = openMenu();
      // 173px of box less an 8px gap above and below.
      expect(list.style.maxHeight).toBe('157px');
      expect(list.style.overflowY).toBe('auto');
      expect(list.style.overflowX).toBe('hidden');
      // Capped first, then brought into view: the reveal moves the capped box.
      expect(boxes.scrolled).toEqual([{ el: list, arg: { block: 'nearest', inline: 'nearest' } }]);
      // Still the same list in the same place in the document: three items, in order.
      expect(within(list).getAllByRole('button').map((b) => b.textContent)).toEqual([
        'Make admin',
        expect.stringContaining('Remove'),
        'Transfer ownership to this member',
      ]);
    } finally {
      boxes.restore();
    }
  });

  it('R4 B3: a menu that fits the box that clips it keeps its own height and does not scroll', () => {
    // The dialog body at 375 with ordinary text: 400 tall. The menu: 142 tall.
    const boxes = withBoxes(rect(12, 100, 351, 400), rect(80.8, 300, 252.23, 142));
    try {
      render(
        <div data-testid="clip" style={{ overflowY: 'auto' }}>
          <KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />
        </div>
      );
      const { list } = openMenu();
      expect(list.style.maxHeight).toBe('');
      expect(list.style.overflowY).toBe('');
      expect(list.style.overflowX).toBe('');
    } finally {
      boxes.restore();
    }
  });

  it('G4: with no layout to measure (a box of no width) the menu is left exactly as it is', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    expect(list.getAttribute('style')).toBeNull();
  });
});
