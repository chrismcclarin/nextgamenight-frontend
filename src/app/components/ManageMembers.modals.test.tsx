// Phase 88 plan 12 Task 1 — Req 9 MIGRATION PROOF for ManageMembers' three overlays.
//
// WHY THIS FILE EXISTS (read before extending):
// Req 9's acceptance is a `.modal-overlay` class census, and a class grep can
// only prove the old markup is GONE — never that what replaced it is a real
// dialog. `Modal.test.tsx` axe-audits the primitive with trivial children; it
// does not exercise THIS file's composed content (a roster, a role <select>, a
// kebab menu, an error banner), which is where a composed-content violation
// would actually live. So each of the three migrated overlays is pinned here
// directly: role=dialog, an accessible name taken from its title, Esc closes,
// and a zero-violation axe audit.
//
// It also carries the STACKED-OPEN pin that plan 88-15 deliberately left to this
// plan (BLK-88-12-01): the main members modal is the parent of the invite panel,
// and Radix inerts everything outside the topmost dialog. Before 88-15 that made
// the still-hand-rolled panel pointer-dead and SR-invisible; the pin below is
// what keeps that regression from coming back. FriendInvitePanel is therefore
// deliberately NOT mocked here (it IS mocked in ManageMembers.mutations.test.tsx,
// whose concern is mutation targeting).
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` components under test.
import * as React from 'react';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const OWNER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PENDING_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Hoisted so a test can switch WHICH member the caller is before rendering —
// the Leave-Group confirm only exists on a non-owner's own row.
const h = vi.hoisted(() => ({
  selfUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string | undefined,
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, isPending: false, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

// FriendInvitePanel calls `toast(...)` directly AND `toast.error/.success`.
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: { sub: 'auth0|self' }, isLoading: false }),
}));

vi.mock('@/app/components/ClickableMemberName', () => ({
  default: ({ username }: { username?: string }) => <span>{username}</span>,
}));

// The QR SVG is irrelevant here and noisy in an axe audit's colour-contrast pass.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-qr-value={value} />,
}));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupMembers: vi.fn(),
      updateUserRole: vi.fn(),
      removeUserFromGroup: vi.fn(),
      approveMember: vi.fn(),
      rejectMember: vi.fn(),
      transferOwnership: vi.fn(),
      resetInviteToken: vi.fn(),
      leaveGroup: vi.fn(),
      getInviteToken: vi.fn(),
    },
    invitesAPI: {
      ...actual.invitesAPI,
      getGroupPendingInvites: vi.fn(),
      sendInvite: vi.fn(),
      sendFriendInvite: vi.fn(),
    },
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn(),
      searchUserByEmail: vi.fn(),
      sendRequest: vi.fn(),
    },
  };
});

import ManageMembers from './ManageMembers';
import { groupsAPI, invitesAPI, friendshipsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const GROUP_ID = 'grp-1';

const ROSTER = [
  { id: OWNER_UUID, user_id: 'auth0|owner', username: 'Owner', UserGroup: { role: 'owner' } },
  { id: TARGET_UUID, user_id: 'auth0|target', username: 'Target', UserGroup: { role: 'member' } },
  { id: PENDING_UUID, user_id: 'auth0|pending', username: 'Pend', UserGroup: { role: 'pending' } },
];

function renderManageMembers(modaltoggle = vi.fn()) {
  render(
    <ManageMembers
      group_id={GROUP_ID}
      user={{ sub: 'auth0|self' }}
      modal={true}
      modaltoggle={modaltoggle}
      onMembersUpdated={vi.fn()}
      group_name="Tuesday Night Crew"
    />
  );
  return { modaltoggle };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = OWNER_UUID;
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (groupsAPI.getInviteToken as Mock).mockResolvedValue({
    invite_url: 'https://example.test/join/tok',
  });
  (groupsAPI.leaveGroup as Mock).mockResolvedValue({});
  (groupsAPI.transferOwnership as Mock).mockResolvedValue({});
  (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValue([]);
  (friendshipsAPI.getFriends as Mock).mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ManageMembers — Req 9 modal migration proof (main members modal)', () => {
  it('exposes role=dialog labelled by its title', async () => {
    renderManageMembers();
    expect(
      await screen.findByRole('dialog', { name: 'Manage Group Members' })
    ).toBeInTheDocument();
  });

  it('closes on Escape (Modal owns dismissal — nothing hand-rolled)', async () => {
    const user = userEvent.setup();
    const { modaltoggle } = renderManageMembers();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(modaltoggle).toHaveBeenCalled();
  });

  it('passes an axe audit with the full roster composed inside it', async () => {
    renderManageMembers();
    const dialog = await screen.findByRole('dialog');
    await screen.findByText('Target');
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe('ManageMembers — Req 9 modal migration proof (transfer-ownership confirm)', () => {
  async function openTransferConfirm() {
    const user = userEvent.setup();
    renderManageMembers();
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    fireEvent.click(await screen.findByLabelText('More actions for Target'));
    fireEvent.click(await screen.findByText('Transfer ownership to this member'));
    return user;
  }

  it('exposes role=dialog labelled by its title', async () => {
    await openTransferConfirm();
    expect(
      await screen.findByRole('dialog', { name: /Transfer ownership to Target\?/ })
    ).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = await openTransferConfirm();
    await screen.findByRole('dialog', { name: /Transfer ownership to Target\?/ });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Transfer ownership to Target\?/ })
      ).not.toBeInTheDocument()
    );
  });

  it('passes an axe audit', async () => {
    await openTransferConfirm();
    const dialog = await screen.findByRole('dialog', {
      name: /Transfer ownership to Target\?/,
    });
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe('ManageMembers — Req 9 modal migration proof (leave-group confirm)', () => {
  async function openLeaveConfirm() {
    // The Leave Group button only renders on a NON-owner's own row.
    h.selfUuid = TARGET_UUID;
    const user = userEvent.setup();
    renderManageMembers();
    await screen.findByRole('dialog', { name: 'Members' });
    fireEvent.click(await screen.findByText('Leave Group'));
    return user;
  }

  it('exposes role=dialog labelled by its title', async () => {
    await openLeaveConfirm();
    expect(
      await screen.findByRole('dialog', { name: /Leave Tuesday Night Crew\?/ })
    ).toBeInTheDocument();
  });

  it('closes on Escape', async () => {
    const user = await openLeaveConfirm();
    await screen.findByRole('dialog', { name: /Leave Tuesday Night Crew\?/ });
    await user.keyboard('{Escape}');
    await waitFor(() =>
      expect(
        screen.queryByRole('dialog', { name: /Leave Tuesday Night Crew\?/ })
      ).not.toBeInTheDocument()
    );
  });

  it('passes an axe audit', async () => {
    await openLeaveConfirm();
    const dialog = await screen.findByRole('dialog', {
      name: /Leave Tuesday Night Crew\?/,
    });
    expect(await axe(dialog)).toHaveNoViolations();
  });
});

describe('ManageMembers + FriendInvitePanel stacked open (BLK-88-12-01)', () => {
  // THE pin plan 88-15 left to this plan. The invite panel is reached from a
  // button INSIDE the members modal, so the two are open together by design.
  // While the panel was hand-rolled, an open Radix parent aria-hid it and set
  // body pointer-events:none — the panel's own controls were not resolvable by
  // role at all. Both are Radix dialogs now, so the topmost stays live.
  it('leaves the invite panel live and the parent modal aria-hidden', async () => {
    renderManageMembers();
    const parent = await screen.findByRole('dialog', { name: 'Manage Group Members' });

    fireEvent.click(await screen.findByText('Invite members'));

    // The panel's own controls resolve BY ROLE — the exact assertion that
    // failed against the hand-rolled panel.
    const panel = await screen.findByRole('dialog', { name: /Invite Members/ });
    expect(
      await screen.findByRole('button', { name: 'Send' })
    ).toBeInTheDocument();
    expect(panel).not.toHaveAttribute('aria-hidden', 'true');

    // ...and the parent is inerted rather than competing for focus.
    //
    // ASSERTION RESHAPED by plan 88.6-36 task 3 (2026-09-16), because the attribute it used to
    // read moved for a GOOD reason and the property it exists to protect did not.
    // WAS: `expect(parent).toHaveAttribute('aria-hidden', 'true')`.
    // WHY IT MOVED: this modal renders a `compact` `FetchErrorBanner`, whose live region plan
    // 88.6-36 made EMPTY-FIRST — so the parent subtree now always contains an `aria-live` node.
    // The `aria-hidden` package Radix uses deliberately does NOT hide an ancestor of a live
    // region (hiding it would silence announcements the user still needs); instead it descends
    // and hides every sibling subtree that does not contain one. Measured in this very run: the
    // parent dialog carries no `aria-hidden`, while its header, its button row and every other
    // child of its body carry `aria-hidden="true"` / `data-aria-hidden="true"`.
    // WHAT IS ASSERTED NOW: the thing the comment above always meant — not one focusable control
    // in the parent is still exposed to the a11y tree. That is STRICTLY STRONGER than the
    // attribute check (which would have passed over an exposed control inside a hidden ancestor's
    // sibling) and it survives the library changing where it puts the attribute. The Radix panel
    // is PORTALLED to `document.body`, so it is not a descendant of `parent` and its own Send
    // button is not swept up here — the `findByRole` above already proved the panel stays live.
    await waitFor(() => {
      const stillExposed = Array.from(
        parent.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea')
      ).filter((el) => el.closest('[aria-hidden="true"]') === null);
      expect(
        stillExposed.map((el) => el.outerHTML.slice(0, 120)),
        'every focusable control in the parent modal must be inerted while the panel is open'
      ).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6-45 (R7 / AC-7, UI-SPEC §7.5) — THE STACKED PAIR: a `ConfirmDialog` open OVER an open
// `Modal`, audited as ONE tree, after this surface's LAST migration commit (`git log -1 --
// ManageMembers.js` = `df94f68`, plan 88.6-19, confirmed 2026-09-22). No `matchMedia` fork:
// neither `ManageMembers.js` nor `KebabMenu`, `FriendInvitePanel`, `ConfirmDialog`, `Modal` nor
// `useConfirmAction` calls it (grep, 2026-09-22) — one tree, one run per rule set, no resize.
//
// SCOPING. Every dialog here is a Radix `DialogPrimitive.Content` PORTALLED to `document.body`
// (`dialog.tsx:59-60`), so the two open dialogs are SIBLINGS under body, not nested — a
// `getByRole('dialog')` would throw on two matches, and scoping to either one alone is exactly the
// per-dialog audit this test exists to go beyond. The audited container is therefore
// `document.body`: the smallest element that holds BOTH.
//
// THE ORACLES BELOW ARE PRE-DECIDED (88.6-45-PLAN.md task 2), never read off the shipped
// behaviour. A shipped behaviour that differs is a FAILING assertion recorded as an open finding.
// ---------------------------------------------------------------------------
const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

/** Open the members Modal, then the dialog-tier Remove gate for Target OVER it. */
async function openRemoveOverMembers() {
  const user = userEvent.setup();
  (groupsAPI.removeUserFromGroup as Mock).mockResolvedValue({});
  renderManageMembers();
  const outer = await screen.findByRole('dialog', { name: 'Manage Group Members' });
  await screen.findByText('Target');
  // The desktop entry point (`ManageMembers.js:636-641`, `title="Remove from group"`) — the one
  // that opens the DIALOG tier; the phone kebab's Remove is KebabMenu-internal two-tap (AR-DEC-3).
  const opener = screen.getAllByTitle('Remove from group')[0] as HTMLElement;
  opener.focus();
  await user.click(opener);
  const top = await screen.findByRole('dialog', { name: /Remove Target from this group\?/ });
  return { user, outer, top, opener };
}

/** Open the members Modal, then the transfer-ownership Modal OVER it (Modal over Modal). */
async function openTransferOverMembers() {
  const user = userEvent.setup();
  renderManageMembers();
  const outer = await screen.findByRole('dialog', { name: 'Manage Group Members' });
  const kebab = await screen.findByLabelText('More actions for Target');
  kebab.focus();
  await user.click(kebab);
  await user.click(await screen.findByText('Transfer ownership to this member'));
  const top = await screen.findByRole('dialog', { name: /Transfer ownership to Target\?/ });
  return { user, outer, top, opener: kebab as HTMLElement };
}

/**
 * Framework-sourced classification for an `aria-hidden-focus` node in the stacked tree. Two Radix
 * mechanisms, both composed UNMODIFIED by `dialog.tsx`: (a) the outer dialog's content, marked
 * `aria-hidden` by the `aria-hidden` package without `inert`/`tabindex=-1`; (b) the FocusScope's
 * tab-loop sentinels — `<span data-radix-focus-guard tabindex="0" aria-hidden="true">` mounted at
 * both edges of `document.body` (measured 2026-09-22: the first flagged node was
 * `span[data-radix-focus-guard=""]…:nth-child(1)`). Anything else is a call-site defect.
 */
const isFrameworkSourced = (outer: HTMLElement, el: Element | null) =>
  !!el && (outer.contains(el) || el.matches('[data-radix-focus-guard]'));

const focusables = (root: HTMLElement) =>
  Array.from(root.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea'));

describe('ManageMembers — THE STACKED PAIR, ConfirmDialog over Modal (88.6-45, AC-7)', () => {
  it('1. both dialogs are in the tree at once, each role=dialog + aria-modal, each with its OWN accessible name', async () => {
    const { outer, top } = await openRemoveOverMembers();
    expect(outer).not.toBe(top);
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
    for (const d of [outer, top]) expect(d).toHaveAttribute('aria-modal', 'true');
    expect(outer).toHaveAccessibleName('Manage Group Members');
    expect(top).toHaveAccessibleName(/Remove Target from this group\?/);
  });

  /* OPEN FINDING (88.6-45, routed to the primitive path — see 88.6-45-SUMMARY.md and its WINDOWS
     entry). The oracle below is the PRE-DECIDED expectation and is left as the assertion body;
     `it.fails` records that the shipped tree does NOT meet it and keeps the run green WITHOUT
     pinning the defect as expected: the day a primitive change inerts the outer dialog, this test
     reds ("expected to fail") — flip it to `it` and close the WINDOWS entry in the same commit.

     MEASURED 2026-09-22: outer aria-hidden=null, inert=false, on BOTH stacked instances. CAUSE:
     Radix hides "others" through the `aria-hidden` package (1.2.6), whose live-region carve-out
     (its issue #10) refuses to hide any ANCESTOR of an `[aria-live]` node and descends to hide the
     siblings instead — and the members Modal ALWAYS contains one (the compact `FetchErrorBanner`,
     empty-first since plan 88.6-36, `ManageMembers.js:492`). So the outer `role=dialog`
     `aria-modal=true` container and its live region stay exposed while every focusable under it
     is hidden (test 2b, green). FRAMEWORK-sourced: `dialog.tsx:47-80` composes
     `DialogPrimitive.Content` unmodified. Not patched at this call site by the plan's own rule. */
  it.fails('2. OPEN FINDING — PRE-DECIDED: while the top dialog is open, the OUTER dialog carries aria-hidden="true" or inert', async () => {
    const { outer } = await openRemoveOverMembers();
    await waitFor(() => {
      const hidden = outer.getAttribute('aria-hidden') === 'true' || outer.hasAttribute('inert');
      expect(
        hidden,
        `the outer dialog must be inerted while a dialog stacks over it — measured aria-hidden=${JSON.stringify(
          outer.getAttribute('aria-hidden')
        )} inert=${outer.hasAttribute('inert')}`
      ).toBe(true);
    });
  });

  it('2b. the property behind the oracle: NO focusable control of the outer dialog is exposed while the top is open', async () => {
    const { outer } = await openRemoveOverMembers();
    await waitFor(() => {
      const exposed = focusables(outer).filter((el) => el.closest('[aria-hidden="true"], [inert]') === null);
      expect(exposed.map((el) => el.outerHTML.slice(0, 100))).toEqual([]);
    });
  });

  it('3. focus is INSIDE the top dialog when it opens — on its Cancel (ConfirmDialog initialFocusRef, button-only tier)', async () => {
    const { top } = await openRemoveOverMembers();
    const cancel = within(top).getByRole('button', { name: 'Cancel' });
    await waitFor(() => expect(document.activeElement).toBe(cancel));
    expect(top.contains(document.activeElement)).toBe(true);
  });

  it('4. dismissing the top dialog returns focus INTO the underlying Modal — to the NAMED opener, never <body>', async () => {
    const { user, outer, top, opener } = await openRemoveOverMembers();
    await user.click(within(top).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Remove Target from this group\?/ })).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(outer.contains(document.activeElement)).toBe(true);
    expect(outer).not.toHaveAttribute('aria-hidden');
    // ...and the outer is live again: its controls are no longer under an aria-hidden ancestor.
    expect(focusables(outer).some((el) => el.closest('[aria-hidden="true"]') === null)).toBe(true);
  });

  it('5. the WHOLE stacked tree passes heading-order', async () => {
    await openRemoveOverMembers();
    expect(await axe(document.body, HEADING_ORDER)).toHaveNoViolations();
  });

  it('6. the WHOLE stacked tree: WCAG 4.1.2 reports zero VIOLATIONS, and the FRAMEWORK-sourced aria-hidden-focus report is present as INCOMPLETE with every node inside the OUTER dialog', async () => {
    const { outer } = await openRemoveOverMembers();
    const result = await axe(document.body, WCAG_412);
    // Every violation reds — nothing is disabled and nothing is filtered out of this list.
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(' | ')}`)).toEqual([]);

    // THE FRAMEWORK-SOURCED REPORT, kept VISIBLE. MEASURED 2026-09-22 (axe-core 4.12.1): in jsdom
    // `aria-hidden-focus` never reaches `violations` — it lands in `incomplete` (needs review),
    // because its `focusable-modal-open` check (`axe.js:26423`) defers to `isModalOpen`, which
    // filters dialogs through `_isVisibleOnScreen` (`axe.js:17666`) and jsdom has no layout.
    // `toHaveNoViolations` is therefore structurally SILENT on this rule here (test 6b proves the
    // rule IS evaluated), so the report is read from the bucket it actually lands in.
    // CLASSIFICATION, not silencing: it is framework-sourced ONLY if every flagged node is inside
    // the OUTER dialog or a Radix focus guard (`isFrameworkSourced` above). A flagged node anywhere
    // else is a call-site defect and reds.
    const report = result.incomplete.find((v) => v.id === 'aria-hidden-focus');
    expect(
      report,
      'the framework-sourced aria-hidden-focus report is GONE from the stacked tree — the outer content is inert now; close the routed finding (88.6-45 WINDOWS entry) and delete this pin'
    ).toBeDefined();
    for (const n of report!.nodes) {
      const el = document.querySelector(n.target.join(' '));
      expect(isFrameworkSourced(outer, el), `aria-hidden-focus on a node that is NEITHER the outer dialog's content NOR a Radix focus guard: ${n.target.join(' ')}`).toBe(true);
    }
    expect(report!.nodes.length).toBeGreaterThan(0);
  });

  it('6b. POSITIVE CONTROL — axe evaluates aria-hidden-focus in this environment (it reaches INCOMPLETE on a planted fragment, never a verdict)', async () => {
    // Without this, test 6 could be reading a rule that never runs here. A planted fragment with a
    // tabbable button under `aria-hidden="true"` and NO open dialog: the rule is evaluated and, in
    // jsdom, can only end INCOMPLETE — which is exactly why a browser-side axe is the instrument
    // that can turn this report into a verdict (routed, 88.6-45-SUMMARY.md).
    const host = document.createElement('div');
    host.innerHTML = '<div aria-hidden="true"><button type="button">planted</button></div>';
    document.body.appendChild(host);
    try {
      const result = await axe(host, WCAG_412);
      expect(result.violations.map((v) => v.id)).toEqual([]);
      expect(result.incomplete.map((v) => v.id)).toContain('aria-hidden-focus');
    } finally {
      host.remove();
    }
  });
});

describe('ManageMembers — the SECOND stacked instance in this file: the transfer-ownership Modal over the members Modal (88.6-45)', () => {
  it('1. two dialogs, distinct names, and focus lands INSIDE the top on open (header Close — the transfer Modal passes no initialFocusRef)', async () => {
    const { outer, top } = await openTransferOverMembers();
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2);
    expect(outer).toHaveAccessibleName('Manage Group Members');
    expect(top).toHaveAccessibleName(/Transfer ownership to Target\?/);
    const close = within(top).getByRole('button', { name: 'Close' });
    await waitFor(() => expect(document.activeElement).toBe(close));
  });

  // Same OPEN FINDING as the remove instance above (same outer dialog, same carve-out).
  it.fails('2. OPEN FINDING — PRE-DECIDED: the outer dialog carries aria-hidden or inert while the transfer Modal is open', async () => {
    const { outer } = await openTransferOverMembers();
    await waitFor(() =>
      expect(outer.getAttribute('aria-hidden') === 'true' || outer.hasAttribute('inert')).toBe(true)
    );
  });

  it('3. dismissing the transfer Modal returns focus into the members Modal — to the NAMED kebab trigger', async () => {
    const { user, outer, top, opener } = await openTransferOverMembers();
    await user.click(within(top).getByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Transfer ownership to Target\?/ })).toBeNull()
    );
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(outer.contains(document.activeElement)).toBe(true);
  });

  it('4. the whole stacked tree: heading-order clean; WCAG 4.1.2 zero violations, with the same framework-sourced INCOMPLETE report confined to the outer dialog', async () => {
    const { outer } = await openTransferOverMembers();
    expect(await axe(document.body, HEADING_ORDER)).toHaveNoViolations();
    const result = await axe(document.body, WCAG_412);
    expect(result.violations.map((v) => v.id)).toEqual([]);
    const report = result.incomplete.find((v) => v.id === 'aria-hidden-focus');
    expect(report, 'see the remove-instance test 6 — the same routed finding').toBeDefined();
    for (const n of report!.nodes) {
      const el = document.querySelector(n.target.join(' '));
      expect(isFrameworkSourced(outer, el), `flagged node that is neither the outer dialog's content nor a Radix focus guard: ${n.target.join(' ')}`).toBe(true);
    }
  });
});
