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
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { CONFIRM_DELAY_MS, CONFIRM_LIVE_MS } from '@/components/ui/confirmDelay';
import { SPINNER_DELAY_MS, SPINNER_MIN_MS } from '@/components/ui/useDelayedSpinner'; // AMENDED Phase 88.9-56 (R-C3b reach): the appear and hold budgets
import KebabMenu from './KebabMenu';

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

// Plan 88.9-35 (owner pick B2a, 88.9-PICKS-B1.json): the trigger's focus halo is the ground its
// HOST paints, passed as a typed hostGround key, card by default (every live phone host is a card).
describe('KebabMenu trigger host halo (88.9-35)', () => {
  const SHIPPED = [
    'min-h-11',
    'min-w-11',
    'text-2xl',
    'leading-none',
    'focus:outline-hidden',
    'focus-visible:ring-2',
    'focus-visible:ring-focus-ring',
    'focus-visible:ring-offset-2',
  ];
  const trigger = () => screen.getByRole('button', { name: 'Member actions' });

  it('R033 (88.9): the trigger halo comes from hostGround — card by default, the host\'s ground when passed', () => {
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    for (const token of SHIPPED) expect(trigger()).toHaveClass(token);
    expect(trigger()).toHaveClass('focus-visible:ring-offset-surface-card');
    cleanup();

    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} hostGround="page" />);
    for (const token of SHIPPED) expect(trigger()).toHaveClass(token);
    expect(trigger()).toHaveClass('focus-visible:ring-offset-surface-page');
    expect(trigger()).not.toHaveClass('focus-visible:ring-offset-surface-card');
    cleanup();

    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} hostGround="group" />);
    expect(trigger()).toHaveClass('focus-visible:ring-offset-surface-group-halo');
    expect(trigger()).not.toHaveClass('focus-visible:ring-offset-surface-card');
    cleanup();

    const unknown = 'not-a-ground' as unknown as 'card';
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} hostGround={unknown} />);
    expect(trigger()).toHaveClass('focus-visible:ring-offset-surface-card');
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
    // The window ends: the item is named by its own text again.
    act(() => {
      vi.advanceTimersByTime(CONFIRM_LIVE_MS);
    });
    expect(remove.textContent).toBe('Remove');
    expect(remove).not.toHaveAttribute('aria-label');
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
    expect(trailing[0].getAttribute('aria-hidden')).toBe('true');
    expect(trailing[0].textContent).toBe('');
    expect(remove.textContent).toBe('Remove');
    // A plain item holds nothing.
    const plain = within(list).getByRole('button', { name: 'Make admin' });
    expect(plain.querySelectorAll('[data-reserve], [data-reserve-trailing]')).toHaveLength(0);
  });
});
