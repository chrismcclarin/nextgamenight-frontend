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
import { render, screen, fireEvent, cleanup, waitFor, within, act } from '@testing-library/react';
// 88.6-16: `userEvent` is imported ALONGSIDE `fireEvent`, for exactly one thing — `user.tab()`,
// the only way to prove NATIVE tab order in jsdom. Every other arm stays on this file's existing
// `fireEvent` idiom, including the explicit `.focus()`-before-the-synthetic-event shape, because a
// synthetic click does not move focus in jsdom.
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { axe } from 'vitest-axe';

import PromptScheduleSection from './PromptScheduleSection';
import ClickableMemberName from './ClickableMemberName';
import MemberChipStack from './MemberChipStack';
import KebabMenu from './KebabMenu';
import GroupList from './grouplist';
import CalendarMonthView from './CalendarMonthView';
import { Modal } from './Modal';
import { FriendshipContext } from './FriendshipStatusProvider';

// 88.6-21 (W42): the whole `grouplist.js` card is rendered here, so the module graph this file
// mounts now reaches the router, the Auth0 session hook, the timezone provider and the groups
// endpoint. Every one of these is a LEAF stub — none of the pre-existing describes above imports
// any of them (measured 2026-09-16: only `FriendshipStatusProvider` touches `@auth0/nextjs-auth0`,
// and every arm in this file supplies `FriendshipContext` directly rather than mounting the
// provider), so adding them cannot change what those arms exercise.
const gl = vi.hoisted(() => ({
  push: vi.fn(),
  getUserGroups: vi.fn(async () => [] as unknown[]),
}));

const GL_SELF = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: gl.push }),
}));

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/app/components/TimezoneProvider', () => ({
  useTimezone: () => ({ timezone: 'America/New_York', setTimezone: vi.fn() }),
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: GL_SELF,
    self: { id: GL_SELF, user_id: 'auth0|self' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

// Rendered rather than nulled: activating the cog is otherwise unobservable, and
// `expect(push).not.toHaveBeenCalled()` alone is the vacuous shape this file's own test 12
// exists to forbid. The stub gives the cog arm a POSITIVE signal to settle on.
vi.mock('@/app/components/GroupSettings', () => ({
  default: ({ group }: { group?: { name?: string } }) => (
    <div data-testid="group-settings-open">{group?.name}</div>
  ),
}));

vi.mock('@/app/components/SafeImage', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      getUserGroups: gl.getUserGroups,
    },
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

    // Delta review 2026-08-06: the success swap UNMOUNTS the focused button —
    // the outcome must be announced (role=status). The focus half of the fix
    // (FloatingFocusManager restoreFocus) is NOT assertable here: jsdom fires
    // no focusout when a focused element is REMOVED, which is the exact signal
    // restoreFocus listens for — activeElement lands on <body> in jsdom no
    // matter what the manager does. Browser behavior; UAT-walk territory.
    const receipt = await screen.findByText('Request sent');
    expect(receipt.closest('[role="status"]')).not.toBeNull();
  });

  it('4c. a FAILED send is announced as an alert (focus half untestable in jsdom — see 4b)', async () => {
    friendshipValue.sendRequest.mockRejectedValueOnce(new Error('boom'));
    renderMemberName();
    const name = screen.getByRole('button', { name: 'ada' });
    name.focus();
    fireEvent.keyDown(name, { key: 'Enter' });

    const addFriend = await screen.findByRole('button', { name: 'Add friend' });
    await waitFor(() => expect(addFriend).toHaveFocus());
    fireEvent.click(addFriend);

    const failure = await screen.findByText('Failed to send request');
    expect(failure.closest('[role="alert"]')).not.toBeNull();
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

/* ============================================================================================
 * Phase 88.5 (SPEC Req 5) — the THREE new interactive descendants inside `grouplist.js`'s
 * `role="button"` card.
 *
 * WHY THIS FILE GREW RATHER THAN A NEW ONE BEING WRITTEN
 * -----------------------------------------------------
 * The property pinned above is "a control inside the group card is operable by keyboard AND
 * does not also activate the card". 88.5-09 replaces that card's member NAME-PILL row — whose
 * only interactive descendant was the `ClickableMemberName` span tests 4-6 cover — with
 * `MemberChipStack`, which adds a collapsed stack trigger and a `Show less` control beside the
 * per-member triggers. Same card, same property, same failure mode: this is the file that owns
 * it.
 *
 * WHY THE `not.toHaveBeenCalled()` HALF NEEDS A CONTROL, AND TEST 12 IS IT
 * -----------------------------------------------------------------------
 * `expect(spy).not.toHaveBeenCalled()` is the most vacuous assertion shape there is — it also
 * passes when the wrapper was never wired, when the event never reached the descendant, and
 * when the query silently matched nothing. Test 12 fires the SAME key on an UNGUARDED
 * descendant of the same wrapper and requires the spy to fire, which is the only thing that
 * makes tests 8-11 mean "stopPropagation is doing this" rather than "nothing happened".
 *
 * NESTED-INTERACTIVE IS NOT WHAT THESE PIN. The card being a `role="button"` with focusable
 * descendants is a KNOWN, pre-existing defect owned by Phase 88.6
 * (`.planning/deferred/phase-88.6.md`), and 88.5 makes it worse by adding descendants to it.
 * These tests pin the per-descendant floor that phase committed to instead; they are not a
 * substitute for the structural fix, and they must NOT be read as closing that item.
 * ========================================================================================== */

const CHIP_MEMBERS = [
  { id: 'self', username: 'me' },
  { id: 'u1', username: 'ada' },
  { id: 'u2', username: 'grace' },
];

const CHIP_STACK_NAME = 'Members: ada, grace. Show all members.';

/**
 * Mirrors `grouplist.js:359-370`: the stack renders inside a `role="button"` card carrying its
 * own click AND key handler. One spy behind both, because "expanding also navigated to the
 * group" is the same defect whichever handler fired.
 */
function renderChipStack() {
  const onCardActivate = vi.fn();
  const utils = render(
    <FriendshipContext.Provider value={friendshipValue as never}>
      <div role="button" tabIndex={0} onClick={onCardActivate} onKeyDown={onCardActivate}>
        <MemberChipStack members={CHIP_MEMBERS} selfUuid="self" />
        {/* test 12's control: a descendant of the SAME wrapper that guards nothing */}
        <span role="button" tabIndex={0} data-testid="unguarded">
          unguarded
        </span>
      </div>
    </FriendshipContext.Provider>,
  );
  return { ...utils, onCardActivate };
}

const chipStackTrigger = () => screen.getByRole('button', { name: CHIP_STACK_NAME });

describe('MemberChipStack descendants are keyboard-operable inside the card (88.5 SPEC Req 5)', () => {
  it('8. ENTER on the collapsed stack EXPANDS it and does not fire the card handler', () => {
    const { onCardActivate } = renderChipStack();
    const trigger = chipStackTrigger();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(trigger, { key: 'Enter' });
    // the OUTCOME, not the attribute: `Show less` only exists in the expanded row
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('9. SPACE also expands it, is preventDefault-ed, and does not fire the card handler', () => {
    const { onCardActivate } = renderChipStack();
    // fireEvent returns false when a listener called preventDefault. Space's default on a
    // `role="button"` SPAN is PAGE SCROLL — a span synthesises no click for either key, so
    // both are only handled because the handler says so, and a one-key implementation would
    // pass test 8 alone.
    expect(
      fireEvent.keyDown(chipStackTrigger(), { key: ' ' }),
      'Space must be preventDefault-ed: its default on a non-button is page scroll',
    ).toBe(false);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('10. ENTER on an expanded chip OPENS the popover and does not fire the card handler', async () => {
    const { onCardActivate } = renderChipStack();
    fireEvent.keyDown(chipStackTrigger(), { key: 'Enter' });
    // the expansion itself is not what is under test here
    onCardActivate.mockClear();

    const chip = screen.getByRole('button', { name: 'ada' });
    fireEvent.keyDown(chip, { key: 'Enter' });
    // the popover's own control is the proof the friend flow is REACHED — D-15 suppresses the
    // inline indicator on chips, so the popover is the ONLY path to it from this row.
    await screen.findByRole('button', { name: 'Add friend' });
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('11. ENTER on `Show less` COLLAPSES and does not fire the card handler', () => {
    const { onCardActivate } = renderChipStack();
    fireEvent.keyDown(chipStackTrigger(), { key: 'Enter' });
    onCardActivate.mockClear();

    fireEvent.keyDown(screen.getByRole('button', { name: 'Show less' }), { key: 'Enter' });
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
    expect(chipStackTrigger()).toHaveAttribute('aria-expanded', 'false');
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('12. ANTI-VACUITY: the card handler DOES fire for an unguarded descendant', () => {
    // Without this, tests 8-11 pass for a wrapper that was never wired, for a key that never
    // reached anything, and for a `stopPropagation` that was deleted along with the handler
    // that called it. Same wrapper, same key, one descendant that guards nothing.
    const { onCardActivate } = renderChipStack();
    fireEvent.keyDown(screen.getByTestId('unguarded'), { key: 'Enter' });
    expect(
      onCardActivate,
      'the card handler cannot fire at all — every not.toHaveBeenCalled() above is vacuous',
    ).toHaveBeenCalledTimes(1);
  });
});

/* ============================================================================================
 * Phase 88.6-16 (D-12 / D24, SPEC AC-5, UI-SPEC §7.3) — `KebabMenu`'s CHOSEN contract.
 *
 * WHY THESE ASSERT THE CONTRACT THAT WAS CHOSEN, NOT THE ONE THAT WAS REJECTED
 * ---------------------------------------------------------------------------
 * D-12 dropped the ARIA menu pattern rather than implementing it. So an arrow-key-navigation
 * assertion here would be asserting the REJECTED design and would red correctly. Every arm below
 * is about honest disclosure: the menu semantics are gone (negative assertions), real LIST
 * semantics are there in their place (the positive twin), Tab walks the items natively, and the
 * armed destructive state is finally announceable.
 *
 * THE POSITIVE TWIN IS NOT DECORATION. `KebabMenu.test.tsx`'s axe audit cannot see it — axe does
 * not model the Safari/VoiceOver behaviour that makes the explicit `role="list"` necessary
 * (Tailwind's preflight sets `list-style: none` on every `ul`, which strips the IMPLICIT list
 * role). The list/listitem arm below is the ONLY gate on the compensation D-12 trades for.
 *
 * `userEvent` IS IMPORTED HERE, ALONGSIDE `fireEvent`, FOR EXACTLY ONE THING: `user.tab()`, which
 * is the only way to prove NATIVE tab order in jsdom. Everything else stays on this file's
 * existing `fireEvent` idiom, including the explicit `.focus()`-before-the-synthetic-event shape
 * tests 4b/4c already use — a synthetic click does not move focus in jsdom, which is precisely
 * what makes an unfocused focus assertion pass for the wrong reason.
 * ========================================================================================== */

const KEBAB_LABEL = 'Row actions';

function kebabTrigger(name: string = KEBAB_LABEL) {
  return screen.getByRole('button', { name });
}

/** The OPEN item list, resolved the way a consumer must resolve it: through the trigger's own
 *  `aria-controls`. Resolving it this way is itself part of the contract under test. */
function openList(trigger: HTMLElement): HTMLElement {
  const id = trigger.getAttribute('aria-controls');
  expect(id, 'the trigger exposes aria-controls while its menu is open').toBeTruthy();
  const list = document.getElementById(id as string);
  expect(list, 'aria-controls names an element that is in the document').not.toBeNull();
  return list as HTMLElement;
}

function openKebab(name: string = KEBAB_LABEL) {
  const trigger = kebabTrigger(name);
  fireEvent.click(trigger);
  return { trigger, list: openList(trigger) };
}

const SINGLE_TAP_ITEMS = () => [
  { label: 'Edit', onClick: vi.fn() },
  { label: 'Pause', onClick: vi.fn() },
];

describe('KebabMenu exposes the CHOSEN contract, not the menu pattern (88.6-16 D-12)', () => {
  it('KM-1. the trigger reflects open state, names its open list, and claims no popup role', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />);
    const trigger = kebabTrigger();

    // The accessible name is the shipped `ariaLabel`.
    expect(trigger).toHaveAccessibleName(KEBAB_LABEL);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    // Absence OUTRIGHT, not "not equal to menu": ARIA maps the value "true" to the menu role, so
    // a `!== 'menu'` assertion would pass for markup that re-asserts exactly what D-12 removed.
    expect(trigger).not.toHaveAttribute('aria-haspopup');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const list = openList(trigger);
    expect(trigger.getAttribute('aria-controls')).toBe(list.id);
  });

  it('KM-2. CLOSED state: the trigger exposes NO aria-controls at all (the dangling-reference half)', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />);
    const trigger = kebabTrigger();

    // Its own assertion, because the OPEN-state check above cannot see a dangling reference — a
    // permanently-present `aria-controls` names an element that is not in the document for most
    // of this component's life, and that is the failure the open-only rule exists to prevent.
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-controls');
    fireEvent.click(trigger);
    expect(trigger).not.toHaveAttribute('aria-controls');
  });

  it('KM-3. the open dropdown exposes NO menu or menuitem role (the mechanical half of "honest")', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />);
    openKebab();
    expect(screen.queryAllByRole('menu')).toHaveLength(0);
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('KM-4. the POSITIVE twin: exactly one list role, one listitem per authored item', () => {
    const items = SINGLE_TAP_ITEMS();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={items} />);
    const { list } = openKebab();

    const lists = screen.getAllByRole('list');
    expect(lists, 'the open dropdown is exactly ONE list').toHaveLength(1);
    expect(lists[0]).toBe(list);
    expect(within(list).getAllByRole('listitem')).toHaveLength(items.length);
    // The compensation is set-AND-count: one item per listitem, each a plain button.
    expect(within(list).getAllByRole('button')).toHaveLength(items.length);
  });

  it('KM-5. Tab walks the items NATIVELY from the trigger, with no roving tabindex', async () => {
    const user = userEvent.setup();
    const items = SINGLE_TAP_ITEMS();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={items} />);
    const { trigger, list } = openKebab();

    const buttons = within(list).getAllByRole('button');
    for (const b of buttons) {
      // A roving tabindex would put -1 on every item but one. Plain buttons carry no tabindex
      // at all, which is the whole reason dropping the menu pattern buys native traversal.
      expect(b).not.toHaveAttribute('tabindex');
      b.focus();
      expect(b).toHaveFocus();
    }

    trigger.focus();
    await user.tab();
    expect(document.activeElement, 'Tab from the trigger lands on the FIRST item').toBe(buttons[0]);
    await user.tab();
    expect(document.activeElement, 'and then on the second, in DOM order').toBe(buttons[1]);
  });
});

describe('KebabMenu Escape — the STANDALONE composition (four of the six render sites)', () => {
  // Scoped deliberately. The next describe measures the dialog-hosted composition, where this
  // contract does NOT hold, and the two must not be read as one claim.
  it('KM-6. Escape from an item closes the dropdown AND returns focus to the trigger', () => {
    const ancestorKeyDown = vi.fn();
    render(
      <div onKeyDown={ancestorKeyDown}>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />
      </div>,
    );
    const { trigger, list } = openKebab();
    const first = within(list).getAllByRole('button')[0];
    first.focus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    // BOTH halves. Closing without restoring focus drops the user to <body>, which is the defect
    // class this phase fixes elsewhere (W44, W45).
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
    // The handler CLAIMED the key: an ancestor listener does not also see it. That claim is what
    // stops one Escape from both closing this menu and collapsing gameDetail's expanded
    // description (`gameDetail/page.js:384-402`, which bails only on `event.defaultPrevented`).
    expect(ancestorKeyDown).not.toHaveBeenCalled();
  });

  it('KM-6b. ANTI-VACUITY: the ancestor listener DOES see an Escape the menu does not claim', () => {
    // Without this, KM-6's `not.toHaveBeenCalled()` also passes for a wrapper that was never
    // wired and for an event that never reached anything. Same wrapper, same key, menu CLOSED.
    const ancestorKeyDown = vi.fn();
    render(
      <div onKeyDown={ancestorKeyDown}>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />
      </div>,
    );
    const trigger = kebabTrigger();
    trigger.focus();
    fireEvent.keyDown(trigger, { key: 'Escape' });
    expect(ancestorKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe('KebabMenu Escape INSIDE the shipped Modal — the two ManageMembers sites, MEASURED', () => {
  /* 2 of the 6 render sites are the `ManageMembers` menus inside a dialog (`:571`, `:595` under
     the `Modal` at `:378`), and that is the destructive row-action path D-40 makes the sole phone
     entry point. The standalone arm above cannot see this composition, so it is measured here
     rather than assumed.

     MEASURED 2026-09-15, and it CORRECTS the plan text and the first draft of the code marker:
     Radix's capture-phase document Escape (`Modal.tsx:149-150` ->
     `@radix-ui/react-use-escape-keydown`) does run FIRST and dismisses the dialog — but it does
     NOT stop propagation, so the event still reaches this component's container handler in the
     bubble phase and that handler DOES run. What is true is the OUTCOME the user gets: the whole
     dialog closes and takes the menu with it, and this component's focus restore is a no-op
     because its trigger unmounts with the dialog, so where focus lands is the dialog's own
     close-focus behaviour. Recorded, not fixed — see the KebabMenu Escape marker. */
  function DialogHostedKebab({
    onDismiss,
    onAncestorKeyDown,
  }: {
    onDismiss: () => void;
    onAncestorKeyDown: (e: React.KeyboardEvent) => void;
  }) {
    const [open, setOpen] = React.useState(true);
    return (
      <Modal
        open={open}
        onClose={() => {
          onDismiss();
          setOpen(false);
        }}
      >
        <Modal.Header>Manage Group Members</Modal.Header>
        <Modal.Body>
          {/* the same ancestor-spy discriminator KM-6 uses, so "did this component's handler
              run?" is MEASURED here rather than asserted from the standalone arm */}
          <div onKeyDown={onAncestorKeyDown}>
            <KebabMenu ariaLabel={KEBAB_LABEL} items={[{ label: 'Edit', onClick: vi.fn() }]} />
          </div>
        </Modal.Body>
      </Modal>
    );
  }

  it('KM-7. the DIALOG dismisses and the kebab goes with it; the kebab trigger never receives focus', async () => {
    const onDismiss = vi.fn();
    const onAncestorKeyDown = vi.fn();
    render(<DialogHostedKebab onDismiss={onDismiss} onAncestorKeyDown={onAncestorKeyDown} />);
    await screen.findByRole('dialog');

    const { trigger, list } = openKebab();
    const first = within(list).getAllByRole('button')[0];
    first.focus();

    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(onDismiss, 'the ancestor dialog claimed the dismissal').toHaveBeenCalledTimes(1);
    // The trigger left the document with the dialog, so the guarded restore is a no-op — the
    // honest statement of what this component's contract does at these two sites.
    expect(trigger.isConnected).toBe(false);
    expect(document.activeElement).not.toBe(trigger);
    // THE MEASUREMENT that corrects the plan text: the kebab's own container handler still RAN
    // (Radix preventDefaults but does not stopPropagation, so the event reaches the React tree in
    // the bubble phase) and claimed the key, so the in-dialog ancestor spy never fires. What the
    // dialog composition actually costs is the OUTCOME, not the handler: the dialog closes and
    // the focus restore has no trigger left to restore to.
    expect(
      onAncestorKeyDown,
      'measured: the kebab handler still claims the key inside a dialog — see the KebabMenu Escape marker',
    ).not.toHaveBeenCalled();
  });
});

describe('KebabMenu focusout — the keyboard half beside the shipped mousedown close', () => {
  const TWO_TAP_ITEMS = (onRemove = vi.fn()) => [
    { label: 'Make admin', onClick: vi.fn() },
    {
      label: 'Remove',
      danger: true,
      twoTap: true,
      confirmLabel: 'Tap again to remove',
      onClick: onRemove,
    },
  ];

  it('KM-8 (i). a focusout with an OUTSIDE relatedTarget closes the menu', () => {
    render(
      <>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />
        <button type="button">outside</button>
      </>,
    );
    const { list } = openKebab();
    const outside = screen.getByRole('button', { name: 'outside' });
    fireEvent.focusOut(within(list).getAllByRole('button')[0], { relatedTarget: outside });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('KM-8 (ii). a focusout with relatedTarget NULL does NOT close it', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={SINGLE_TAP_ITEMS()} />);
    const { list } = openKebab();
    fireEvent.focusOut(within(list).getAllByRole('button')[0], { relatedTarget: null });
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('KM-8 (iii). and an ARMED twoTap item is still armed after that null focusout', () => {
    // The case the null rule exists for: a pointer press over the list's own non-focusable
    // chrome, or over a disabled item, produces a null relatedTarget. Closing on it would
    // silently disarm a live two-tap gate (`ManageMembers.js:620`, `OpenPollsList.js:282`).
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={TWO_TAP_ITEMS()} />);
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    const armed = within(list).getByRole('button', { name: 'Tap again to remove' });

    fireEvent.focusOut(armed, { relatedTarget: null });

    // Asserted on the RENDERED confirm label, never on internal state.
    expect(within(list).getByRole('button', { name: 'Tap again to remove' })).toBeInTheDocument();
  });

  it('KM-8 (iv). a first tap on a real item ARMS rather than closing (the shipped 65-02 pattern)', () => {
    const onRemove = vi.fn();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={TWO_TAP_ITEMS(onRemove)} />);
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(onRemove).not.toHaveBeenCalled();
  });

  it('KM-9. the two-tap item still requires TWO activations to fire its action', () => {
    const onRemove = vi.fn();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={TWO_TAP_ITEMS(onRemove)} />);
    const { list } = openKebab();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    expect(onRemove).not.toHaveBeenCalled();
    fireEvent.click(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('KM-10. activation returns focus to the trigger on the single-tap AND the two-tap commit path', () => {
    const onRemove = vi.fn();
    const { unmount } = render(
      <KebabMenu ariaLabel={KEBAB_LABEL} items={TWO_TAP_ITEMS(onRemove)} />,
    );
    // single-tap
    let opened = openKebab();
    let item = within(opened.list).getByRole('button', { name: 'Make admin' });
    item.focus();
    fireEvent.click(item);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(opened.trigger).toHaveFocus();
    unmount();

    // two-tap COMMIT — `handleItemClick` unmounts the focused button on this path too
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={TWO_TAP_ITEMS(onRemove)} />);
    opened = openKebab();
    item = within(opened.list).getByRole('button', { name: 'Remove' });
    item.focus();
    fireEvent.click(item);
    fireEvent.click(within(opened.list).getByRole('button', { name: 'Tap again to remove' }));
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(opened.trigger).toHaveFocus();
  });
});

describe('KebabMenu aria-pressed — present only while armed (legal only once the item role is gone)', () => {
  it('KM-11. armed exposes aria-pressed=true; at rest the attribute is ABSENT on both item kinds', () => {
    render(
      <KebabMenu
        ariaLabel={KEBAB_LABEL}
        items={[
          // a twoTap item, unarmed
          { label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: vi.fn() },
          // a NON-toggle action: `aria-pressed="false"` here would announce a plain action as an
          // unpressed toggle, which is the inverse of the house idiom (`gameDetail/page.js:1274`).
          { label: 'Delete', danger: true, twoTap: false, onClick: vi.fn() },
        ]}
      />,
    );
    const { list } = openKebab();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    const del = within(list).getByRole('button', { name: 'Delete' });

    expect(remove).not.toHaveAttribute('aria-pressed');
    expect(del).not.toHaveAttribute('aria-pressed');

    fireEvent.click(remove);
    expect(within(list).getByRole('button', { name: 'Tap again to remove' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(del, 'the untouched non-toggle stays attribute-free').not.toHaveAttribute('aria-pressed');
  });
});

describe('KebabMenu StatusRegion — mounted at PROP time, never on arm', () => {
  const announcingItems = () => [
    { label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: vi.fn() },
  ];

  it('KM-12. the region is in the DOM BEFORE any arming, and its content changes on arm', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={announcingItems()} />);

    // Its OWN expectation: a region that appears at the moment of the announcement does not
    // announce, which is the entire reason for the idiom.
    const region = screen.getByRole('status');
    expect(region).toHaveTextContent('');

    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: Remove');
  });

  it('KM-13. the PROP-TIME gate: an instance that can never announce carries no region', () => {
    // The shipped example is the desktop owner-only transfer kebab (`ManageMembers.js:571`),
    // whose single item has no twoTap (`:573-583`).
    //
    // LABELLED, because it matters when reading the red-then-green record: this arm is one of the
    // three in this section that ALSO pass against the pre-88.6-16 component — trivially, because
    // no instance had a region at all then. It is the NEGATIVE half of the prop-time gate and only
    // means anything paired with KM-12 and KM-14, which are both red pre-fix.
    render(
      <KebabMenu
        ariaLabel="Transfer actions"
        items={[{ label: 'Transfer ownership to this member', danger: true, onClick: vi.fn() }]}
      />,
    );
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('KM-14. the per-surface region COUNT is the gate\'s measured yield, asserted not summarised', () => {
    // Shaped like the surface the gate was argued from: N member-row kebabs that each carry a
    // twoTap item (`ManageMembers.js:595`) plus one that carries none (`:571`). The predicate is
    // TRUE for every row, so the region IS per row — that is the accepted design, and it is
    // exactly what makes the item-label announcement below sound.
    const N = 3;
    render(
      <div>
        {Array.from({ length: N }, (_, i) => (
          <KebabMenu
            key={`row-${i}`}
            ariaLabel={`Member actions ${i}`}
            items={[
              { label: 'Make admin', onClick: vi.fn() },
              { label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: vi.fn() },
            ]}
          />
        ))}
        <KebabMenu
          ariaLabel="Transfer actions"
          items={[{ label: 'Transfer ownership to this member', danger: true, onClick: vi.fn() }]}
        />
      </div>,
    );
    expect(screen.getAllByRole('status')).toHaveLength(N);
  });

  it('KM-15. the armed message NAMES THE ITEM, so arming a different item changes the text', () => {
    render(
      <KebabMenu
        ariaLabel={KEBAB_LABEL}
        items={[
          { label: 'End check-in', danger: true, twoTap: true, confirmLabel: 'Tap again to end', onClick: vi.fn() },
          { label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: vi.fn() },
        ]}
      />,
    );
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'End check-in' }));
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: End check-in');

    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    expect(screen.getByRole('status')).toHaveTextContent('Press again to confirm: Remove');
  });

  it('KM-16. committing an armed item emits NO revert message', () => {
    // `armedIndex -> null` has three producers and one of them is a SUCCESSFUL commit.
    // Announcing the revert there would tell a screen-reader user the destructive action was
    // cancelled at the exact moment it fired.
    const onRemove = vi.fn();
    render(
      <KebabMenu
        ariaLabel={KEBAB_LABEL}
        items={[{ label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: onRemove }]}
      />,
    );
    const { list } = openKebab();
    const remove = within(list).getByRole('button', { name: 'Remove' });
    fireEvent.click(remove);
    fireEvent.click(within(list).getByRole('button', { name: 'Tap again to remove' }));

    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('KM-17. Escape while ARMED DOES emit the revert copy (the discriminator, from the other side)', () => {
    // KM-16 alone passes for a component that never emits a revert at all. This is the paired
    // control that makes the commit-path silence mean something.
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={announcingItems()} />);
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
    fireEvent.keyDown(within(list).getByRole('button', { name: 'Tap again to remove' }), {
      key: 'Escape',
    });
    expect(screen.getByRole('status')).toHaveTextContent('Confirmation cancelled.');
  });
});

describe('KebabMenu keepOpen — RULED D24 (c), and inert until asked for', () => {
  it('KM-18 (i). INERTNESS: with no item passing the flag, a single-tap activation still closes', () => {
    // This is what makes all 6 shipped render sites unaffected by the flag existing.
    const onEdit = vi.fn();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={[{ label: 'Edit', onClick: onEdit }]} />);
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Edit' }));
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('KM-18 (ii). the twoTap path is UNCHANGED with the flag in the module: arm, timeout-revert, commit', () => {
    vi.useFakeTimers();
    try {
      const onRemove = vi.fn();
      render(
        <KebabMenu
          ariaLabel={KEBAB_LABEL}
          items={[
            { label: 'Remove', danger: true, twoTap: true, confirmLabel: 'Tap again to remove', onClick: onRemove },
          ]}
        />,
      );
      const { list } = openKebab();
      fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
      expect(within(list).getByRole('button', { name: 'Tap again to remove' })).toBeInTheDocument();

      // the 3s revert timer still reverts, and still announces for itself
      act(() => {
        vi.advanceTimersByTime(3100);
      });
      expect(within(list).getByRole('button', { name: 'Remove' })).toBeInTheDocument();
      expect(screen.getByRole('status')).toHaveTextContent('Confirmation cancelled.');
      expect(onRemove).not.toHaveBeenCalled();

      // and the commit path still commits AND closes — a twoTap item never consults the flag
      fireEvent.click(within(list).getByRole('button', { name: 'Remove' }));
      fireEvent.click(within(list).getByRole('button', { name: 'Tap again to remove' }));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(screen.queryByRole('list')).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  it('KM-18 (iii). a flagged item stays open AND re-renders from the parent\'s NEW props', () => {
    // Asserting "the menu did not close" is not enough: the point of the flag is that an
    // in-flight label such as "Cancelling…" becomes VISIBLE on the item the user just activated,
    // which only happens if the parent's next props reach the still-mounted item.
    const onCancel = vi.fn();
    const items = (label: string) => [{ label, onClick: onCancel, keepOpen: true, danger: true }];
    const { rerender } = render(<KebabMenu ariaLabel={KEBAB_LABEL} items={items('Cancel event')} />);
    const { list } = openKebab();
    fireEvent.click(within(list).getByRole('button', { name: 'Cancel event' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('list'), 'the flagged item suppressed the close').toBeInTheDocument();

    rerender(<KebabMenu ariaLabel={KEBAB_LABEL} items={items('Cancelling…')} />);
    expect(within(list).getByRole('button', { name: 'Cancelling…' })).toBeInTheDocument();
  });

  it('KM-19. a menu left open by the flag is still dismissible by Escape and by an outside focusout', () => {
    // The flag opts an item out of one close TRIGGER, never out of dismissal.
    const items = [{ label: 'Cancel event', onClick: vi.fn(), keepOpen: true, ariaDisabled: false }];
    const { unmount } = render(
      <>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={items} />
        <button type="button">outside</button>
      </>,
    );
    let opened = openKebab();
    fireEvent.click(within(opened.list).getByRole('button', { name: 'Cancel event' }));
    fireEvent.keyDown(within(opened.list).getByRole('button', { name: 'Cancel event' }), {
      key: 'Escape',
    });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(opened.trigger).toHaveFocus();
    unmount();

    render(
      <>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={[{ label: 'Cancel event', onClick: vi.fn(), keepOpen: true, ariaDisabled: true }]} />
        <button type="button">outside</button>
      </>,
    );
    opened = openKebab();
    fireEvent.focusOut(within(opened.list).getByRole('button', { name: 'Cancel event' }), {
      relatedTarget: screen.getByRole('button', { name: 'outside' }),
    });
    expect(
      screen.queryByRole('list'),
      'dismissal must work while the item is in its in-flight aria-disabled state too',
    ).not.toBeInTheDocument();
  });
});

describe('KebabMenu ariaDisabled — the flag that makes keepOpen\'s focus promise true', () => {
  const inFlightItems = (label: string, busy: boolean, onClick = vi.fn()) => [
    { label, onClick, danger: true, keepOpen: true, ariaDisabled: busy },
  ];

  it('KM-20 (i). the flag renders aria-disabled="true" and NEVER the native disabled attribute', () => {
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancelling…', true)} />);
    const { list } = openKebab();
    const item = within(list).getByRole('button', { name: 'Cancelling…' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item, 'a natively disabled element leaves the focus order').not.toHaveAttribute('disabled');
    expect((item as HTMLButtonElement).disabled).toBe(false);
    // and the press is refused in the HANDLER
    const onClick = vi.fn();
    cleanup();
    render(<KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancelling…', true, onClick)} />);
    const reopened = openKebab();
    fireEvent.click(within(reopened.list).getByRole('button', { name: 'Cancelling…' }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('KM-20 (ii). focus stays on the SAME item node across the parent\'s in-flight label swap', () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancel event', false, onCancel)} />,
    );
    const { list } = openKebab();
    const item = within(list).getByRole('button', { name: 'Cancel event' });

    // (a) focus is established EXPLICITLY — a synthetic click does not move focus in jsdom, so
    // without this the assertions below would pass with focus on <body>.
    item.focus();
    // (b) its own expectation, BEFORE the re-render
    expect(item, 'focus is on the item before the parent re-renders').toHaveFocus();

    fireEvent.click(item);
    expect(onCancel).toHaveBeenCalledTimes(1);

    // (c) the parent flips the label to the in-flight string and gates the item — what plan 18
    // actually does, and the only way the remount hazard is reachable.
    rerender(<KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancelling…', true, onCancel)} />);

    // (d) BOTH halves. Node identity alone passes with focus on <body>, and a focus assertion
    // alone passes against an item that never re-rendered — so neither is sufficient on its own.
    expect(document.activeElement, 'the SAME node, not a remounted twin').toBe(item);
    expect(item).toHaveTextContent('Cancelling…');
  });

  it('KM-20 (iii). Escape from that state closes the menu and restores focus to the trigger', () => {
    const { rerender } = render(
      <KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancel event', false)} />,
    );
    const { trigger, list } = openKebab();
    const item = within(list).getByRole('button', { name: 'Cancel event' });
    item.focus();
    fireEvent.click(item);
    rerender(<KebabMenu ariaLabel={KEBAB_LABEL} items={inFlightItems('Cancelling…', true)} />);

    // Delivered at document.activeElement, NEVER at a node fetched by query: a keydown dispatched
    // at the item bubbles to the container regardless of where focus actually is, so a queried
    // target would make this pass with focus on <body> — the exact state the flag exists to
    // prevent.
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('KM-20 (iv). ANTI-VACUITY CONTROL — the same-node + focus pair FAILS for a label-derived key', () => {
    /* A NAMED guard, so the file's jsdom-downgrade precedent (the titles at tests 4b and 4c) has
       to DELETE something rather than quietly weaken KM-20 (ii). This replica maps its items with
       the label-derived key `KebabMenu` used to carry; everything else is the same shape. If the
       component ever regains a label-derived key, KM-20 (ii) reds and this control still passes —
       which is what tells the two apart. */
    function LabelKeyedList({ labels }: { labels: string[] }) {
      return (
        <ul>
          {labels.map((label, index) => (
            <li key={`${label}-${index}`}>
              <button type="button">{label}</button>
            </li>
          ))}
        </ul>
      );
    }
    const { rerender } = render(<LabelKeyedList labels={['Cancel event']} />);
    const item = screen.getByRole('button', { name: 'Cancel event' });
    item.focus();
    expect(item).toHaveFocus();

    rerender(<LabelKeyedList labels={['Cancelling…']} />);

    const after = screen.getByRole('button', { name: 'Cancelling…' });
    expect(after, 'a label-derived key produces a FRESH element at the same position').not.toBe(item);
    expect(document.activeElement, 'and focus lands on <body>').not.toBe(after);
  });
});

describe('KebabMenu edge coverage — SPEC E6 empty / zero-one-many (R5)', () => {
  it('KM-21. ZERO items renders no trigger at all', () => {
    const { container } = render(<KebabMenu ariaLabel="Empty actions" items={[]} />);
    expect(screen.queryByRole('button', { name: 'Empty actions' })).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement();
  });

  it('KM-22. ONE item still honours the full contract: Tab, Escape, focusout', async () => {
    const user = userEvent.setup();
    render(
      <>
        <KebabMenu ariaLabel={KEBAB_LABEL} items={[{ label: 'Group settings', onClick: vi.fn() }]} />
        <button type="button">outside</button>
      </>,
    );
    const { trigger, list } = openKebab();
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);

    trigger.focus();
    await user.tab();
    const only = within(list).getByRole('button', { name: 'Group settings' });
    expect(document.activeElement).toBe(only);

    // focusout, outside relatedTarget
    fireEvent.focusOut(only, { relatedTarget: screen.getByRole('button', { name: 'outside' }) });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    // and Escape, from a fresh open
    fireEvent.click(trigger);
    const reopened = openList(trigger);
    within(reopened).getByRole('button', { name: 'Group settings' }).focus();
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Escape' });
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

/* ============================================================================================
 * Phase 88.6-21 (W42/W62b) — the group CARD itself, not just its descendants.
 *
 * WHAT THE DESCRIBES ABOVE COULD NOT SEE. Tests 4-12 mount a SYNTHETIC `role="button"` wrapper
 * around one descendant at a time. That harness is the right shape for the per-descendant
 * stopPropagation floor 88.5 committed to, and it is structurally unable to see the two defects
 * this block closes, because the wrapper is hand-written here rather than read from
 * `grouplist.js`:
 *
 *   1. the card's OWN `onKeyDown` stealing Enter/Space from the two NATIVE `<button>`
 *      descendants — "Invite Member" and the settings cog. Both call `stopPropagation` in their
 *      `onClick`, which stops the synthetic CLICK; the KEYDOWN bubbles first and nothing stopped
 *      it, so Enter on Invite NAVIGATED to the group instead of opening the invite panel;
 *   2. children-presentational. `role="button"` flattens its accessible subtree, so none of the
 *      four descendants was exposed to assistive technology at all (WCAG 4.1.2).
 *
 * So these arms mount the REAL `<GroupList>` at the render where every descendant is present —
 * `userRole` active AND `canEdit` true — because a render that omits them cannot show a nesting
 * violation. The axe pin is the independent half: the 88.5 marker at `grouplist.js` recorded
 * that "there is no axe pin on the home group list today to catch either", which is precisely
 * why a hand-written suite by the executor who wrote the fix is not sufficient on its own.
 * ========================================================================================== */

// Two explicit `runOnly` passes would also work; axe-core's rule selector takes an ARRAY, so the
// two rules run as one pass here. Both are named rather than implied: `nested-interactive` is the
// focusable-descendant half and `aria-allowed-role` is the "is this role legal on this element"
// half, and a ruleset of `wcag412` alone runs neither.
const NESTED_INTERACTIVE = {
  runOnly: { type: 'rule' as const, values: ['nested-interactive', 'aria-allowed-role'] },
};

const GL_GROUP = {
  id: 'g1',
  name: 'Alpha Crew',
  Users: [
    { id: GL_SELF, username: 'me', UserGroup: { role: 'owner' } },
    { id: 'u1', username: 'ada', UserGroup: { role: 'member' } },
  ],
  Events: [],
};

async function renderGroupCard(overrides?: Record<string, unknown>) {
  gl.getUserGroups.mockResolvedValue([{ ...GL_GROUP, ...overrides }]);
  const onGroupSelect = vi.fn();
  const utils = render(
    <FriendshipContext.Provider value={friendshipValue as never}>
      {/* GroupList is untyped JS; a typed-any bag keeps JSX from demanding unrelated props —
          the same shape `grouplist.identity.test.tsx:87` uses.

          [Rule 3 fix, plan 88.6-40] The `eslint-disable-next-line
          @typescript-eslint/no-explicit-any` line that used to sit here named a rule this
          project does not load: `.eslintrc.json` extends `next` only, with no
          `@typescript-eslint` plugin, so ESLint raised `Definition for rule … was not found`
          as an ERROR and `npm run lint` — and therefore `npm run build` — exited 1 TREE-WIDE.
          The comment suppressed nothing, because the rule it named was never running. Deleted
          rather than replaced: `grouplist.identity.test.tsx:87` writes the identical `any` cast
          with no disable comment at all, which is the house shape here. */}
      <GroupList {...({ user: { sub: 'auth0|self' }, onGroupSelect } as any)} />
    </FriendshipContext.Provider>,
  );
  // Settle on a BRANCH-SPECIFIC element, never on chrome: the "Your Groups" header renders above
  // every branch including the loading one (88.6-15's recipe, trap 1).
  await screen.findByRole('button', { name: 'Invite member to group' });
  return { ...utils, onGroupSelect };
}

const glTitleBlock = () => screen.getByRole('button', { name: GL_GROUP.name });
const glInvite = () => screen.getByRole('button', { name: 'Invite member to group' });
const glCog = () => screen.getByRole('button', { name: 'Customize group' });
const glChipStack = () =>
  screen.getByRole('button', { name: 'Members: ada. Show all members.' });

describe('grouplist row — the card and every control inside it are independently operable (88.6-21 W42)', () => {
  beforeEach(() => {
    gl.push.mockClear();
    gl.getUserGroups.mockReset();
  });

  it('GL-1. Enter on "Invite Member" opens the invite panel and does NOT navigate to the group', async () => {
    const user = userEvent.setup();
    const { onGroupSelect } = await renderGroupCard();

    glInvite().focus();
    await user.keyboard('{Enter}');

    // POSITIVE first — the descendant's own action really fired ...
    expect(onGroupSelect).toHaveBeenCalledTimes(1);
    // ... and only then the absence, which is meaningless without it.
    expect(gl.push, 'Enter on Invite must not navigate to the group page').not.toHaveBeenCalled();
  });

  it('GL-2. Space on "Invite Member" behaves the same way', async () => {
    const user = userEvent.setup();
    const { onGroupSelect } = await renderGroupCard();

    glInvite().focus();
    await user.keyboard('[Space]');

    expect(onGroupSelect).toHaveBeenCalledTimes(1);
    expect(gl.push).not.toHaveBeenCalled();
  });

  it('GL-3. Enter on the settings cog opens GroupSettings and does NOT navigate', async () => {
    const user = userEvent.setup();
    await renderGroupCard();

    glCog().focus();
    await user.keyboard('{Enter}');

    expect(await screen.findByTestId('group-settings-open')).toHaveTextContent(GL_GROUP.name);
    expect(gl.push).not.toHaveBeenCalled();
  });

  it('GL-4. Enter on the chip stack EXPANDS it in the real card and does NOT navigate', async () => {
    await renderGroupCard();

    const trigger = glChipStack();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.keyDown(trigger, { key: 'Enter' });

    // the OUTCOME, not the attribute: `Show less` only exists in the expanded row
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(gl.push).not.toHaveBeenCalled();
  });

  it('GL-5. the ROW keeps its own keyboard path — Enter and Space on the title block navigate', async () => {
    await renderGroupCard();

    fireEvent.keyDown(glTitleBlock(), { key: 'Enter' });
    expect(gl.push).toHaveBeenCalledWith('/groupHomePage?id=g1');

    gl.push.mockClear();
    const spaceEvent = fireEvent.keyDown(glTitleBlock(), { key: ' ' });
    expect(gl.push).toHaveBeenCalledWith('/groupHomePage?id=g1');
    // Space's default on a non-button is PAGE SCROLL; it must be suppressed.
    expect(spaceEvent, 'Space must be preventDefault-ed on a role="button" element').toBe(false);
  });

  it('GL-6. focus is visible on the row AND on each descendant', async () => {
    await renderGroupCard();

    // §5.7's house ring, per element. The row's target is the TITLE BLOCK after the W42 remedy —
    // the card itself is no longer focusable, so a ring on it would be dead.
    for (const el of [glTitleBlock(), glInvite(), glCog(), glChipStack()]) {
      expect(
        el.className,
        `${el.getAttribute('aria-label') ?? el.textContent} carries no focus-visible ring`,
      ).toContain('focus-visible:ring-');
    }
  });

  it('GL-7. every interactive descendant is reachable by ROLE and NAME on the fully-mounted card', async () => {
    await renderGroupCard();

    // The render the axe pin below audits: all four present at once. A render that omits any of
    // them cannot show a nesting violation, so this is the precondition for GL-8 rather than an
    // independent claim.
    expect(glInvite()).toBeInTheDocument();
    expect(glCog()).toBeInTheDocument();
    expect(glChipStack()).toBeInTheDocument();
    expect(glTitleBlock()).toBeInTheDocument();
  });

  it('GL-8. axe: no `nested-interactive` / `aria-allowed-role` violation on that same render', async () => {
    const { container } = await renderGroupCard();
    // Sanity: the audit subject really contains the four controls, so a green result is not
    // green-by-emptiness.
    expect(container.querySelectorAll('[role="button"], button').length).toBeGreaterThanOrEqual(4);
    expect(await axe(container, NESTED_INTERACTIVE)).toHaveNoViolations();
  });

  it('GL-9. a QUOTE-BEARING group name is the card control\'s COMPUTED accessible name (AC-5)', async () => {
    const quoted = 'Bob\'s "Board" Crew';
    await renderGroupCard({ id: 'g2', name: quoted });

    // By ROLE plus NAME, never by reading an attribute — the name is COMPUTED from the subtree
    // and there is deliberately no `aria-label` to read (EventDayModal.js:343-347).
    const block = screen.getByRole('button', { name: quoted });
    expect(block).not.toHaveAttribute('aria-label');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(quoted);
  });
});

/*
 * AC-5 / SPEC R5 (W39 + W41) — THE CALENDAR DAY CELL'S KEYBOARD PATH, plan 88.6-40.
 *
 * WHAT THIS SUITE ASSERTS AND WHY IT IS SHAPED THIS WAY
 * ----------------------------------------------------
 * The month grid was pointer-only: the day cell was a bare `<div onClick>` with no role, no
 * tabIndex and no key handler, so a keyboard user could not open a day at all. The fix does NOT
 * promote the cell — the cell WRAPS two `role="button" tabIndex={0}` event tiles, and promoting
 * a wrapper over interactive descendants is axe `nested-interactive` (WCAG 4.1.2) and is the
 * verbatim 88.3 run-3 H1 regression recorded at `groupColourRendering.test.ts`'s test 8. The
 * keyboard target is the EXISTING day-number element INSIDE the cell — the EventDayModal H1
 * remedy, the same one plan 88.6-21 applied to the group card's title block.
 *
 * BOTH POLARITIES, AND THE 1-EVENT NARROWING. A tab stop is added only where the action has no
 * stop already. `cellClickable` alone is the WRONG gate: on a 1-event day the cell's own
 * dispatch IS the tile's, so gating on it would ship a second tab stop for one action under a
 * name promising a day modal the user never gets. Every polarity below is asserted by RENDER.
 */
const CAL_MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A fixed, far-future day so no arm here accidentally coincides with today. */
const CAL_DAY = new Date(2031, 8, 15, 12, 0, 0, 0); // 15 September 2031

function calEvent(id: string, on: Date, game: string, groupName: string) {
  const y = on.getFullYear();
  const m = String(on.getMonth() + 1).padStart(2, '0');
  const d = String(on.getDate()).padStart(2, '0');
  return {
    id,
    start_date: `${y}-${m}-${d}T19:00:00`,
    Game: { name: game },
    Group: { name: groupName, background_color: null },
    rsvp_summary: null,
  };
}

function renderMonth(opts: {
  date?: Date;
  events?: unknown[];
  showEmptyDayHint?: boolean;
  variant?: string;
} = {}) {
  const date = opts.date ?? CAL_DAY;
  const onDayClick = vi.fn();
  const onEventClick = vi.fn();
  const utils = render(
    <CalendarMonthView
      days={[{ date, isCurrentMonth: true }]}
      activeEvents={opts.events ?? []}
      currentDate={date}
      variant={opts.variant ?? 'compact'}
      onDayClick={onDayClick}
      onEventClick={onEventClick}
      onNavigateMonth={vi.fn()}
      onGoToday={vi.fn()}
      showEmptyDayHint={opts.showEmptyDayHint ?? false}
      monthNames={CAL_MONTHS}
      tzLegend={null}
    />,
  );
  return { ...utils, onDayClick, onEventClick, date };
}

/** The day CELL — the element that carries the pointer `onClick`, located via its day number. */
function cellOf(date: Date): HTMLElement {
  const dayNumber = screen.getByText(String(date.getDate()));
  // The day number is a DIRECT child of the cell (`{date && (<>` is a fragment, no DOM node).
  return dayNumber.parentElement as HTMLElement;
}

describe('Phase 88.6-40 AC-5 / R5 (W39): the calendar day cell has a keyboard path INSIDE it', () => {
  afterEach(cleanup);

  const MULTI = [
    calEvent('e1', CAL_DAY, 'Catan', 'Tuesday Crew'),
    calEvent('e2', CAL_DAY, 'Wingspan', 'Plain Group'),
  ];
  const OPEN_DAY_NAME = 'September 15, 2 games. Open this day.';
  const ADD_EVENT_NAME = 'September 15. Add an event on this day.';

  it('DC-1. a MULTI-EVENT day exposes a focusable day-number target naming the date AND the action', () => {
    renderMonth({ events: MULTI });
    const target = screen.getByRole('button', { name: OPEN_DAY_NAME });
    expect(target).toHaveAttribute('tabindex', '0');
    // The name carries BOTH halves — a bare date is not an action name.
    expect(target.getAttribute('aria-label')).toContain('September 15');
    expect(target.getAttribute('aria-label')).toContain('Open this day');
  });

  it('DC-2. a NON-ACTIONABLE day gets NO tab stop (42 empty stops is worse than none)', () => {
    renderMonth({ events: [], showEmptyDayHint: false });
    expect(screen.queryByRole('button', { name: /Open this day/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Add an event/ })).toBeNull();
    // And the day number is still rendered — the cell is unchanged, only un-promoted.
    const dayNumber = screen.getByText('15');
    expect(dayNumber).not.toHaveAttribute('role');
    expect(dayNumber).not.toHaveAttribute('tabindex');
  });

  it('DC-3. a 1-EVENT day exposes exactly ONE role="button" — the TILE — and no day-number stop', () => {
    // THE NARROWING. `cellClickable` is TRUE here, so a `cellClickable`-only gate would put a
    // SECOND stop on this cell for the SAME action: `EventCalendar.js`'s `handleDayClick`
    // forwards a single-event day straight into `handleEventClick`, the handler the tile's
    // `onEventClick` is already bound to — and the tile is already `role="button" tabIndex={0}`.
    renderMonth({ events: [calEvent('e1', CAL_DAY, 'Catan', 'Tuesday Crew')] });
    const cell = cellOf(CAL_DAY);
    const inCell = within(cell).getAllByRole('button');
    expect(
      inCell,
      'a 1-event day must expose exactly one role="button" inside the cell — its tile',
    ).toHaveLength(1);
    expect(inCell[0].getAttribute('aria-label')).toContain('Catan');
    // …and nothing in the grid names a day modal the user would never be taken to.
    expect(screen.queryByRole('button', { name: /Open this day/ })).toBeNull();
  });

  it('DC-4. an EMPTY day WITH the create hint is actionable and names the create action', () => {
    renderMonth({ events: [], showEmptyDayHint: true });
    const target = screen.getByRole('button', { name: ADD_EVENT_NAME });
    expect(target).toHaveAttribute('tabindex', '0');
  });

  it('DC-5. Enter on the day target calls onDayClick ONCE and onEventClick NEVER', () => {
    const { onDayClick, onEventClick, date } = renderMonth({ events: MULTI });
    const target = screen.getByRole('button', { name: OPEN_DAY_NAME });
    target.focus();
    const defaultNotPrevented = fireEvent.keyDown(target, { key: 'Enter' });
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onDayClick.mock.calls[0][0]).toEqual(date);
    expect(onDayClick.mock.calls[0][1]).toHaveLength(2);
    expect(onEventClick).not.toHaveBeenCalled();
    expect(defaultNotPrevented, 'Enter must be preventDefault-ed').toBe(false);
  });

  it('DC-6. Space likewise fires exactly once (Space default is PAGE SCROLL and must be suppressed)', () => {
    const { onDayClick, onEventClick } = renderMonth({ events: MULTI });
    const target = screen.getByRole('button', { name: OPEN_DAY_NAME });
    target.focus();
    const defaultNotPrevented = fireEvent.keyDown(target, { key: ' ' });
    expect(onDayClick).toHaveBeenCalledTimes(1);
    expect(onEventClick).not.toHaveBeenCalled();
    expect(defaultNotPrevented, 'Space must be preventDefault-ed').toBe(false);
  });

  it('DC-7. a POINTER click on the day number fires onDayClick exactly ONCE (it bubbles, it does not double)', () => {
    // The target deliberately carries no `onClick` of its own: the click bubbles to the cell's
    // existing handler. A native <button> was rejected for the mirror-image reason — it
    // SYNTHESISES a bubbling click on Enter/Space, which would fire the cell handler twice.
    const { onDayClick } = renderMonth({ events: MULTI });
    fireEvent.click(screen.getByRole('button', { name: OPEN_DAY_NAME }));
    expect(onDayClick).toHaveBeenCalledTimes(1);
  });

  it('DC-8. the day target carries a VISIBLE focus ring, inset like this file\'s two tiles', () => {
    renderMonth({ events: MULTI });
    const target = screen.getByRole('button', { name: OPEN_DAY_NAME });
    expect(target.className).toContain('focus-visible:ring-focus-ring');
    expect(target.className).toContain('focus-visible:ring-2');
    // `ring-inset`, NOT `ring-offset-2`: both event tiles in this file use inset for the
    // recorded reason (a dense grid cell has no room for an offset ring).
    expect(target.className).toContain('focus-visible:ring-inset');
  });

  it('DC-9. a QUOTE-BEARING group name survives into the grid, and the day label stays intact (AC-5)', () => {
    const quoted = 'Bob\'s "Board" Crew';
    renderMonth({
      events: [
        calEvent('e1', CAL_DAY, 'Catan', quoted),
        calEvent('e2', CAL_DAY, 'Wingspan', 'Plain Group'),
      ],
    });
    // React sets `aria-label` as a DOM property, so there is no escaping question to get wrong —
    // this pins that, rather than asserting it.
    expect(screen.getByRole('button', { name: `Catan - ${quoted}` })).toBeTruthy();
    expect(screen.getByRole('button', { name: OPEN_DAY_NAME })).toBeTruthy();
  });

  it('DC-10. the empty-day "+" hint follows FOCUS as well as hover, and focus lands on the inner target', () => {
    const { container } = renderMonth({ events: [], showEmptyDayHint: true });
    const target = screen.getByRole('button', { name: ADD_EVENT_NAME });
    target.focus();
    expect(document.activeElement).toBe(target);

    // The wrapper carries the `group` marker UNCONDITIONALLY now — it used to sit in the
    // `cellClickable` arm of the cell's ground ternary, which `isCurrentDay` and the past-date
    // arm are reached BEFORE, so today's empty cell never revealed the hint on HOVER either.
    const cell = cellOf(CAL_DAY);
    expect(cell.className.split(/\s+/)).toContain('group');

    const hint = container.querySelector('[class*="group-focus-within:opacity-40"]');
    expect(hint, 'the "+" hint has no group-focus-within reveal').not.toBeNull();
    expect((hint as HTMLElement).className).toContain('group-hover:opacity-40');
    // THE REVEAL ITSELF IS A CSS VARIANT jsdom CANNOT EVALUATE — no stylesheet is applied here,
    // so this arm pins the class pair and the focus target only. The rendered opacity is
    // asserted in the `phone` Playwright project (`e2e/contrast.spec.ts`), which is the only
    // place `group-focus-within:` can actually go red.
  });

  it('DC-11. axe: the rendered month grid has NO nested-interactive violation, and no control nests', () => {
    const { container } = renderMonth({ events: MULTI });
    // Anti-vacuity: the audited tree really does hold the day target plus both tiles.
    const controls = container.querySelectorAll('button, [role="button"]');
    expect(controls.length).toBeGreaterThanOrEqual(3);
    for (const outer of Array.from(controls)) {
      expect(
        outer.querySelector('button, [role="button"]'),
        `${outer.getAttribute('aria-label') ?? outer.textContent} CONTAINS another control`,
      ).toBeNull();
    }
  });

  it('DC-11b. axe agrees (nested-interactive / aria-allowed-role)', async () => {
    const { container } = renderMonth({ events: MULTI });
    expect(await axe(container, NESTED_INTERACTIVE)).toHaveNoViolations();
  });

});
