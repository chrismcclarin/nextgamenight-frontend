/**
 * SPEC Req 5 — the member-initials chips that replace the home group card's name-pill row.
 *
 * WHAT THIS EXISTS TO CATCH
 * -------------------------
 * The collapsed overlapping stack has NO analog anywhere in `src/` — PATTERNS CORRECTION 3
 * verified a repo-wide negative for `-ml-2`, `-space-x-*`, `ring-surface-card` and
 * `ring-2 ring-white`. Nothing else in the suite can see this geometry, so every property the
 * design contract calls load-bearing is pinned here or it is pinned nowhere.
 *
 * THE FOUR THINGS THAT WOULD SHIP GREEN WITHOUT A PIN
 * --------------------------------------------------
 * 1. THE DASH. Friend and pending chips are told apart by ring COLOUR and by SOLID-vs-DASHED.
 *    The two colours measure 1.04:1 apart in light and 1.06:1 in dark — luminance-identical,
 *    so under red-green CVD two SOLID rings are ONE ring. A test that asserts only the colour
 *    passes for both statuses and is vacuous; test 7 is the guard proving this suite can tell
 *    solid from dashed at all.
 *
 * 2. THE FILL. `UserChip`'s own chip fill is `bg-surface-elevated`, which resolves to `#ffffff`
 *    in light — byte-identical to the card it sits on. That was MEASURED and REJECTED in 88-27.
 *    Inheriting it renders an invisible chip that no render assertion notices, so the pin is a
 *    source pin.
 *
 * 3. KEYBOARD ACTIVATION. The collapsed control and `Show less` are `role="button"` SPANs, not
 *    native `<button>`s (they live inside `grouplist.js`'s own `role="button"` card, where a
 *    real button is the axe `nested-interactive` rule). A span gets NO free Enter/Space — each
 *    key is only handled if the handler says so, and a one-key implementation would pass a
 *    single-key test. Enter and Space are therefore pinned SEPARATELY for both controls, and
 *    each pin also asserts the enclosing card's handler did not fire (the tap-stealing twin).
 *
 * 4. THE ACCESSIBLE NAME (UI-SPEC A-8, WCAG 1.4.1). Owner ruling D-15 suppresses the inline
 *    `✓ Friend` / `⏳ Pending` text on chips, which leaves the ring — a COLOUR — as the only
 *    status carrier a sighted user gets, and initials carry no status at all. So each expanded
 *    chip's accessible NAME must state identity plus relationship in words. That is invisible
 *    to a visible-text assertion, so the A-8 pins query by accessible name on purpose.
 *
 * `+N` ARITHMETIC. Derived from the SELF-FILTERED array, never from `groupUsers.length - 5`.
 * The shipped arithmetic carries an unstated "the viewer is a member of this list" premise and
 * understates by one in the window where `selfUuid` has not resolved yet.
 */
import fs from 'node:fs';
import path from 'node:path';

import * as React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';

import { MemberChip, MemberChipStack } from './MemberChipStack';
import { FriendshipContext } from './FriendshipStatusProvider';

const COMPONENT_SRC = fs.readFileSync(path.join(__dirname, 'MemberChipStack.tsx'), 'utf8');

afterEach(cleanup);

describe('MemberChip — fills and ring cues (D-10, D-11, D-12, D-12b)', () => {
  it('1. renders the uppercase initials of the username', () => {
    render(<MemberChip label="ada lovelace" />);
    expect(screen.getByText('AL')).toBeInTheDocument();
  });

  it('1b. a single-token username yields TWO characters (the D-10 branch)', () => {
    render(<MemberChip label="boardgamer" />);
    expect(screen.getByText('BO')).toBeInTheDocument();
  });

  it('2. falls back to the email when there is no username, and to `?` with neither', () => {
    render(<MemberChip label="rita@example.com" />);
    expect(screen.getByText('RI')).toBeInTheDocument();
    cleanup();
    render(<MemberChip label={null} />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('3. `accepted` draws a SOLID success outline — and NOT the dash', () => {
    render(<MemberChip label="ada" status="accepted" />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('outline-status-success');
    expect(chip.className).toContain('outline-2');
    expect(chip.className).not.toContain('outline-dashed');
  });

  it('4. `pending_sent` draws a DASHED warning outline', () => {
    render(<MemberChip label="rita" status="pending_sent" />);
    const chip = screen.getByText('RI');
    expect(chip.className).toContain('outline-dashed');
    expect(chip.className).toContain('outline-status-warning');
    expect(chip.className).not.toContain('outline-status-success');
  });

  it('5. `pending_received` draws the SAME dashed warning outline as `pending_sent`', () => {
    render(<MemberChip label="rita" status="pending_received" />);
    const chip = screen.getByText('RI');
    expect(chip.className).toContain('outline-dashed');
    expect(chip.className).toContain('outline-status-warning');
  });

  it('6. `none` and `unknown` draw NO outline utility at all (absence of a claim)', () => {
    render(<MemberChip label="ada" status="none" />);
    expect(screen.getByText('AD').className).not.toContain('outline-');
    cleanup();
    render(<MemberChip label="ada" status="unknown" />);
    expect(screen.getByText('AD').className).not.toContain('outline-');
  });

  it('7. ANTI-VACUITY: the dash, not the width, is what separates friend from pending', () => {
    // Both statuses carry `outline-2`. A pin written against the WIDTH — or against
    // "has an outline" — passes for both and would let a solid amber ring ship, which is
    // exactly the version the owner rejected on the 1.04:1 luminance measurement.
    render(<MemberChip label="ada" status="accepted" />);
    render(<MemberChip label="rita" status="pending_sent" />);
    const friend = screen.getByText('AD');
    const pending = screen.getByText('RI');
    expect(friend.className).toContain('outline-2');
    expect(pending.className).toContain('outline-2');
    const dashed = [friend, pending].filter((el) => el.className.includes('outline-dashed'));
    expect(dashed).toEqual([pending]);
  });

  it('8. the NEUTRAL arm is the card-hover fill with secondary ink', () => {
    render(<MemberChip label="ada" />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('bg-surface-card-hover');
    expect(chip.className).toContain('text-content-secondary');
    expect(chip.className).not.toContain('bg-white/85');
  });

  it('9. the TINTED arm swaps to the white wash, the neutral hairline and the card ink', () => {
    render(<MemberChip label="ada" tinted />);
    const chip = screen.getByText('AD');
    expect(chip.className).toContain('bg-white/85');
    expect(chip.className).toContain('ring-1');
    expect(chip.className).toContain('ring-black/25');
    expect(chip.className).toContain('--group-ink-l');
    expect(chip.className).toContain('--group-ink,');
    // The neutral fill measures 1.11:1 on the blue preset tint — invisible. It must be GONE,
    // not merely overridden by a later utility (source order is not a contract).
    expect(chip.className).not.toContain('bg-surface-card-hover');
    expect(chip.className).not.toContain('text-content-secondary');
  });

  it('10. the collapsed cut-out separation ring is neutral-arm ONLY', () => {
    render(<MemberChip label="ada" separated />);
    expect(screen.getByText('AD').className).toContain('ring-surface-card');
    cleanup();
    // On a tinted card the ground is NOT `surface-card`, so a cut-out ring in that token
    // would draw a stray white outline. The tinted hairline does the separating instead.
    render(<MemberChip label="ada" separated tinted />);
    expect(screen.getByText('AD').className).not.toContain('ring-surface-card');
  });

  it('11. the `+N` variant renders the literal plus-number with muted ink on the same fill', () => {
    render(<MemberChip overflow={3} />);
    const chip = screen.getByText('+3');
    expect(chip.className).toContain('text-content-muted');
    expect(chip.className).toContain('bg-surface-card-hover');
    expect(chip.className).not.toContain('outline-');
  });

  it('12. every chip is `aria-hidden` — it is a glyph, never the identity carrier', () => {
    render(<MemberChip label="ada" status="accepted" />);
    expect(screen.getByText('AD')).toHaveAttribute('aria-hidden', 'true');
  });

  it('13. SOURCE: the file never inherits `UserChip`\'s invisible-in-light chip fill (88-27)', () => {
    expect(COMPONENT_SRC).not.toContain('bg-surface-elevated');
  });

  it('14. SOURCE: no raw hex colour, and no bare border WIDTH utility', () => {
    // Both are repo-wide gates (`rawColorValues.test.ts`, `borderExplicitness.test.ts`);
    // pinning them here too makes the failure land on THIS file rather than in a sweep.
    const code = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/#[0-9a-fA-F]{6}/);
    expect(code).not.toMatch(/\bborder-\d\b/);
  });
});

/* ============================================================================================
 * MemberChipStack — the disclosure (D-09, D-13, D-15, A-8, RESEARCH B-5)
 * ========================================================================================== */

const SELF = 'u-self';

const MEMBERS = [
  { id: SELF, username: 'me' },
  { id: 'u1', username: 'mary kay' },
  { id: 'u2', username: 'rita' },
  { id: 'u3', username: 'ada' },
  { id: 'u4', username: 'grace' },
  { id: 'u5', username: 'hedy' },
  { id: 'u6', username: 'joan' },
];

const STATUSES: Record<string, string> = {
  u1: 'accepted',
  u2: 'pending_sent',
  u3: 'none',
  u4: 'pending_received',
  u5: 'unknown',
  u6: 'none',
};

function friendshipValue(overrides: Record<string, string> = {}) {
  const table = { ...STATUSES, ...overrides };
  return {
    getStatus: (id?: string | null) => (id ? (table[id] ?? 'none') : 'unknown'),
    sendRequest: vi.fn(async () => ({ ok: true })),
  };
}

/**
 * Mirrors `grouplist.js`: the stack renders INSIDE a `role="button"` card that has its own
 * Enter/Space handler. Every activation pin below re-uses this wrapper, because "the control
 * works" and "the control does not ALSO navigate to the group" are different properties and
 * only the second one is the tap-stealing regression.
 */
function renderStack(opts: {
  members?: typeof MEMBERS;
  selfUuid?: string | null;
  tinted?: boolean;
  onCardActivate?: (e: React.SyntheticEvent) => void;
  statuses?: Record<string, string>;
} = {}) {
  const onCardActivate = opts.onCardActivate ?? vi.fn();
  const utils = render(
    <FriendshipContext.Provider value={friendshipValue(opts.statuses) as never}>
      <div
        role="button"
        tabIndex={0}
        onClick={onCardActivate}
        onKeyDown={onCardActivate}
        className="relative"
      >
        <MemberChipStack
          members={opts.members ?? MEMBERS}
          selfUuid={opts.selfUuid === undefined ? SELF : opts.selfUuid}
          tinted={opts.tinted}
        />
      </div>
    </FriendshipContext.Provider>,
  );
  return { ...utils, onCardActivate };
}

const COLLAPSED_NAME = 'Members: mary kay, rita, ada, grace and 2 more. Show all members.';

const collapsed = () => screen.getByRole('button', { name: COLLAPSED_NAME });

describe('MemberChipStack — collapsed stack', () => {
  it('15. shows four member chips plus a `+2`, and never the viewer', () => {
    renderStack();
    // 'mary kay' is two tokens -> 'MK'; the other three are single tokens -> the D-10
    // two-character branch.
    for (const initials of ['MK', 'RI', 'AD', 'GR']) {
      expect(screen.getByText(initials)).toBeInTheDocument();
    }
    expect(screen.getByText('+2')).toBeInTheDocument();
    // `me` -> `ME`. The viewer is filtered out BEFORE the slice, so they can never occupy one
    // of the four visible slots.
    expect(screen.queryByText('ME')).not.toBeInTheDocument();
  });

  it('16. `+N` derives from the FILTERED array, not from the raw member count', () => {
    // The shipped row computed `groupUsers.length - 5`, which is only correct on the premise
    // that the viewer is a member of the list. With `selfUuid` unresolved — a real transient
    // window, `FriendshipStatusProvider` gates on it — the filter excludes nobody and that
    // arithmetic understates by one. 7 members, none filtered out, 4 shown => `+3`, not `+2`.
    renderStack({ selfUuid: null });
    expect(screen.getByText('+3')).toBeInTheDocument();
  });

  it('17. is ONE control with `aria-expanded="false"` and an `aria-controls` that resolves', () => {
    renderStack();
    const control = collapsed();
    expect(control).toHaveAttribute('aria-expanded', 'false');
    const target = control.getAttribute('aria-controls');
    expect(target).toBeTruthy();
    expect(document.getElementById(target as string)).not.toBeNull();
  });

  it('18. is a `role="button"` SPAN, not a nested native button (axe nested-interactive)', () => {
    renderStack();
    const control = collapsed();
    expect(control.tagName).toBe('SPAN');
    expect(control).toHaveAttribute('tabindex', '0');
  });

  it('19. names its members and its overflow, with `and 1 more` in the singular', () => {
    renderStack({ members: MEMBERS.slice(0, 6) });
    expect(
      screen.getByRole('button', {
        name: 'Members: mary kay, rita, ada, grace and 1 more. Show all members.',
      }),
    ).toBeInTheDocument();
  });

  it('20. drops the overflow clause entirely when nothing overflows', () => {
    renderStack({ members: MEMBERS.slice(0, 4) });
    expect(
      screen.getByRole('button', { name: 'Members: mary kay, rita, ada. Show all members.' }),
    ).toBeInTheDocument();
  });

  it('21. renders NOTHING for a group whose only member is the viewer', () => {
    const { container } = renderStack({ members: [MEMBERS[0]] });
    expect(screen.queryByRole('button', { name: /Show all members/ })).not.toBeInTheDocument();
    // Not an empty container either (UI-SPEC section 8) — the card row must collapse.
    expect(container.querySelector('[aria-controls]')).toBeNull();
  });
});

describe('MemberChipStack — activation (click, Enter and Space are wired independently)', () => {
  it('22. a CLICK expands, and does not fire the enclosing card handler', () => {
    const { onCardActivate } = renderStack();
    fireEvent.click(collapsed());
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('23. ENTER expands, does not fire the card handler, and does not scroll', () => {
    const { onCardActivate } = renderStack();
    const control = collapsed();
    control.focus();
    // `fireEvent` returns false when the handler called `preventDefault` — the page-scroll
    // assertion, made mechanically rather than by eye.
    expect(fireEvent.keyDown(control, { key: 'Enter' })).toBe(false);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('24. SPACE expands, does not fire the card handler, and does not scroll', () => {
    const { onCardActivate } = renderStack();
    const control = collapsed();
    control.focus();
    expect(fireEvent.keyDown(control, { key: ' ' })).toBe(false);
    expect(screen.getByRole('button', { name: 'Show less' })).toBeInTheDocument();
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('25. ANTI-VACUITY: an unhandled key does NOT expand', () => {
    // Without this, a handler that toggled on every keydown would pass tests 23 and 24 while
    // making Tab, Escape and every arrow key open the row.
    renderStack();
    const control = collapsed();
    control.focus();
    fireEvent.keyDown(control, { key: 'a' });
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
  });
});

describe('MemberChipStack — expanded row', () => {
  it('26. renders one trigger per NON-SELF member and moves focus to the first', async () => {
    renderStack();
    fireEvent.click(collapsed());
    const first = screen.getByRole('button', { name: 'mary kay, friend' });
    await waitFor(() => expect(first).toHaveFocus());
    // Six non-self members: five interactive triggers plus the inert `unknown` chip (u5).
    for (const name of [
      'mary kay, friend',
      'rita, friend request pending',
      'ada',
      'grace, friend request pending',
      'joan',
    ]) {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    }
    expect(screen.queryByText('ME')).not.toBeInTheDocument();
  });

  it('27. A-8: an accepted chip states identity AND "friend" in its accessible name', () => {
    // The ring is a COLOUR (WCAG 1.4.1) and the initials carry no status at all, so this is
    // the only status carrier an assistive-tech user gets once D-15 suppresses the inline
    // indicator. Queried by ACCESSIBLE NAME, deliberately not by visible text.
    renderStack();
    fireEvent.click(collapsed());
    const chip = screen.getByRole('button', { name: 'mary kay, friend' });
    // ...and the visible glyph is excluded from that name: it is the sr-only carrier talking.
    expect(chip.textContent).toContain('MK');
  });

  it('28. A-8: a pending chip states identity AND "friend request pending"', () => {
    renderStack();
    fireEvent.click(collapsed());
    expect(
      screen.getByRole('button', { name: 'rita, friend request pending' }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'grace, friend request pending' }),
    ).toBeInTheDocument();
  });

  it('29. A-8: a `none` chip carries the bare name with no status suffix', () => {
    renderStack();
    fireEvent.click(collapsed());
    expect(screen.getByRole('button', { name: 'ada' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^ada,/ })).not.toBeInTheDocument();
  });

  it('30. D-15: no Friend text, no Pending text and no add-friend `+` anywhere in the row', () => {
    renderStack();
    fireEvent.click(collapsed());
    expect(screen.queryByText(/✓ Friend/)).not.toBeInTheDocument();
    expect(screen.queryByText(/⏳ Pending/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /as a friend$/ })).not.toBeInTheDocument();
  });

  it('31. activating a chip opens the shipped popover — by Enter and by Space alike', async () => {
    renderStack();
    fireEvent.click(collapsed());
    const chip = screen.getByRole('button', { name: 'ada' });
    chip.focus();
    fireEvent.keyDown(chip, { key: 'Enter' });
    expect(await screen.findByRole('button', { name: 'Add friend' })).toBeInTheDocument();
    fireEvent.keyDown(chip, { key: ' ' });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Add friend' })).not.toBeInTheDocument(),
    );
  });

  it('32. an `unknown`-status member gets an INERT chip that still carries their name', () => {
    // RESEARCH B-5: routing `unknown` through `ClickableMemberName` would produce an inert
    // chip BY ACCIDENT (its early return drops role, tabIndex and handler), which a future
    // reader would reasonably "fix" into something focusable. Focusable-but-inert is exactly
    // what `keyboardOperability.test.tsx` test 5 exists to fail.
    renderStack();
    fireEvent.click(collapsed());
    expect(screen.queryByRole('button', { name: /^hedy/ })).not.toBeInTheDocument();
    const carrier = screen.getByText('hedy');
    expect(carrier.className).toContain('sr-only');
    // Scoped to the chip's OWN wrapper: `closest()` would otherwise walk out to the enclosing
    // group card, which is legitimately a `role="button"` with a tabindex.
    const wrapper = carrier.parentElement as HTMLElement;
    expect(wrapper.getAttribute('role')).toBeNull();
    expect(wrapper.getAttribute('tabindex')).toBeNull();
    expect(wrapper.getAttribute('aria-expanded')).toBeNull();
    // Identity is never initials-only — today's degraded state still renders the username.
    expect(screen.getByText('HE')).toBeInTheDocument();
  });

  it('33. the chip row is a 12px wrap in BOTH axes', () => {
    renderStack();
    const control = collapsed();
    const rowId = control.getAttribute('aria-controls') as string;
    fireEvent.click(control);
    const row = document.getElementById(rowId);
    // The row is the panel `aria-controls` points at, so this cannot drift onto some other div.
    expect(row?.className).toContain('flex-wrap');
    expect(row?.className).toContain('gap-3');
  });
});

describe('MemberChipStack — collapsing', () => {
  const expandThen = () => {
    const r = renderStack();
    fireEvent.click(collapsed());
    return r;
  };

  it('34. `Show less` CLICK collapses and restores focus to the stack control', async () => {
    const { onCardActivate } = expandThen();
    fireEvent.click(screen.getByRole('button', { name: 'Show less' }));
    await waitFor(() => expect(collapsed()).toHaveFocus());
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('35. `Show less` ENTER collapses, restores focus, does not scroll or hit the card', async () => {
    const { onCardActivate } = expandThen();
    const less = screen.getByRole('button', { name: 'Show less' });
    less.focus();
    expect(fireEvent.keyDown(less, { key: 'Enter' })).toBe(false);
    await waitFor(() => expect(collapsed()).toHaveFocus());
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('36. `Show less` SPACE collapses, restores focus, does not scroll or hit the card', async () => {
    const { onCardActivate } = expandThen();
    const less = screen.getByRole('button', { name: 'Show less' });
    less.focus();
    expect(fireEvent.keyDown(less, { key: ' ' })).toBe(false);
    await waitFor(() => expect(collapsed()).toHaveFocus());
    expect(onCardActivate).not.toHaveBeenCalled();
  });

  it('37. expansion is PER INSTANCE and does not survive an unmount', () => {
    render(
      <FriendshipContext.Provider value={friendshipValue() as never}>
        <MemberChipStack members={MEMBERS} selfUuid={SELF} />
        <MemberChipStack members={MEMBERS} selfUuid={SELF} />
      </FriendshipContext.Provider>,
    );
    const controls = screen.getAllByRole('button', { name: COLLAPSED_NAME });
    expect(controls).toHaveLength(2);
    fireEvent.click(controls[0]);
    // One expanded, one still collapsed — no module-level or shared state.
    expect(screen.getAllByRole('button', { name: 'Show less' })).toHaveLength(1);
    expect(screen.getAllByRole('button', { name: COLLAPSED_NAME })).toHaveLength(1);
    cleanup();
    renderStack();
    expect(screen.queryByRole('button', { name: 'Show less' })).not.toBeInTheDocument();
  });
});

describe('MemberChipStack — source properties the render cannot see', () => {
  it('38. every hit-extension pseudo sits on an element that also carries `relative`', () => {
    // T-88.5-22. `after:absolute` resolves against the nearest POSITIONED ancestor, and
    // `grouplist.js` already puts `relative` on the group card. An un-anchored pseudo would
    // stretch the invisible hit target over the ENTIRE card, and combined with the chips'
    // `stopPropagation` every tap on the card would open a member popover instead of
    // navigating. The shipped pairing at `ClickableMemberName.js:333` is the precedent.
    // Comments are blanked first: the DECISION marker explaining this pairing necessarily
    // NAMES the utility it is about, and a comment-blind gate would red on the explanation —
    // the DEF-88-25-02 / DEF-88-27-01 failure shape, whose pressure is to delete the why.
    const code = COMPONENT_SRC.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    const lines = code.split('\n').filter((l) => l.includes('after:absolute'));
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toContain('relative');
    expect(code).toContain('after:-inset-1.5');
    // Anti-vacuity: the detector must be able to SEE an un-anchored pseudo.
    expect(
      "after:absolute after:-inset-1.5".split('\n').filter((l) => l.includes('after:absolute')),
    ).toHaveLength(1);
  });

  it('39. propagation is stopped on BOTH handlers of BOTH span controls', () => {
    const hits = COMPONENT_SRC.match(/stopPropagation/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(4);
  });

  it('40. the shipped `length - 5` arithmetic is not carried over', () => {
    expect(COMPONENT_SRC).not.toContain('groupUsers.length - 5');
  });

  it('41. the chip trigger opts OUT of the inline indicator (D-15)', () => {
    expect(COMPONENT_SRC).toContain('showInlineIndicator={false}');
  });

  it('42. the deliberate choices in this file carry `DECISION Phase 88.5` markers', () => {
    // The Evidence Rule: a decision with no marker is invisible to every future phase.
    const markers = COMPONENT_SRC.match(/DECISION Phase 88\.5/g) ?? [];
    expect(markers.length).toBeGreaterThanOrEqual(9);
  });

  it('43. no per-component reduced-motion override (the global contract owns it)', () => {
    expect(COMPONENT_SRC).not.toContain('motion-reduce:');
  });
});
