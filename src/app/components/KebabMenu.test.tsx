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
 * The split is the one UI-SPEC §9.3 already uses for E1/E5 (`88.6-UI-SPEC.md:800-801`):
 *   - SOURCE half (here): the class contract that makes the rendered behaviour possible, asserted
 *     in BOTH the disarmed and the ARMED states, and demonstrated able to fail.
 *   - GEOMETRY half: a planted 375px probe in `e2e/touch-targets.spec.ts`, wearing this
 *     component's own shipped class strings. Read a red here against a red there.
 */
import * as React from 'react';
import { render, screen, cleanup, fireEvent, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

import KebabMenu from './KebabMenu';

afterEach(cleanup);

// axe-core's `runOnly` takes ONE selector, so the two rules run as two explicit passes — the same
// shape `PromptScheduleManager.test.tsx:129-130` uses.
const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/**
 * The LARGEST authored item set that ships: `ManageMembers.js:595`'s mobile member kebab with the
 * owner-only transfer item spread in (`:625-632`) — role swap + two-tap Remove + Transfer. The
 * desktop `:571` kebab is the single-item subset of it.
 */
const LARGEST_SHIPPED_ITEMS = () => [
  { label: 'Make admin', onClick: vi.fn() },
  {
    label: 'Remove',
    danger: true,
    twoTap: true,
    confirmLabel: 'Tap again to remove',
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
    render(<KebabMenu ariaLabel="Member actions" items={LARGEST_SHIPPED_ITEMS()} />);
    const { list } = openMenu();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
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
    render(
      <KebabMenu
        ariaLabel="Member actions"
        items={[
          { label: LONG, danger: true, twoTap: true, confirmLabel: `${LONG} — tap again`, onClick: vi.fn() },
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
    const armed = within(list).getByRole('button', { name: `${LONG} — tap again` });
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
    expect('absolute right-0 top-full mt-1 z-20 min-w-[160px]').not.toMatch(
      /(^|\s)(w-\[|w-\d|left-0)/,
    );
    expect('w-full min-h-11 text-left px-3 py-2').not.toMatch(/(^|\s)h-\d/);
  });
});
