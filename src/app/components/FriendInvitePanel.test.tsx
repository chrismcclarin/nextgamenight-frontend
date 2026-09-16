// Phase 88 plan 06 Task 3 — RENDER HARNESS for FriendInvitePanel.
// Phase 88 plan 15 — MIGRATION PROOF (the tripwire below is now armed positive).
//
// WHY THIS FILE EXISTS (read before extending):
// SPEC Req 9 audits the modal fleet by grepping for `.modal-overlay`.
// FriendInvitePanel is INVISIBLE to that grep. Before plan 88-15 it was bespoke
// via its OWN hand-rolled `fixed inset-0 bg-black/50` backdrop (never
// `.modal-overlay`), so the census would have passed with it unmigrated; after
// 88-15 it is hosted on the shared <Modal>, whose Radix content carries no
// `.modal-overlay` class either. Either way the class census structurally
// cannot see this component, so Req 9's acceptance demands an EXPLICIT check —
// this file is it. The pins live in
// `describe('FriendInvitePanel — Req 9 migration proof')` below: dialog role,
// Esc-to-close and a focus trap. They started life as plan 88-06's inverse
// tripwire (asserting NO dialog existed) precisely so the 88-15 swap could not
// land without visiting this file.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` component under test.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';

const SELF_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const FRIEND_UUID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const MEMBER_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const GROUP_ID = '99999999-9999-4999-8999-999999999999';

// Hoisted so the mock factories (evaluated on the hoisted `./FriendInvitePanel`
// import) can read them, and so a test can vary identity before render.
// The literal is repeated here rather than referencing SELF_UUID: `vi.hoisted`
// runs before module-level consts are initialised.
const h = vi.hoisted(() => ({
  selfUuid: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as string | undefined,
  user: { sub: 'auth0|self' },
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, isPending: !h.selfUuid, refetch: vi.fn() },
    isPending: !h.selfUuid,
  }),
}));

// Stable object identity: the panel keys its friends fetch on `[open, user]`.
vi.mock('@auth0/nextjs-auth0/client', () => ({
  useUser: () => ({ user: h.user, isLoading: false }),
}));

// `toast` is callable AND carries .success/.error — the reset-link flow uses both.
vi.mock('sonner', () => {
  const toast = Object.assign(vi.fn(), { error: vi.fn(), success: vi.fn() });
  return { toast };
});

// qrcode.react draws a canvas-free SVG, but its output is irrelevant here and
// noisy in snapshots — stub to a recognisable marker so the QR BRANCH is still
// provably reached.
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <svg data-qr-value={value} />,
}));

// `importOriginal` spread: only the network surfaces are replaced, so a REMOVED
// export still fails loudly rather than silently resolving to a mock
// (T-88-06-01). UserChip is deliberately kept REAL — it is a shipped primitive
// with its own suite and stubbing it would hide a composition break.
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    friendshipsAPI: {
      ...actual.friendshipsAPI,
      getFriends: vi.fn().mockResolvedValue([]),
      searchUserByEmail: vi.fn().mockResolvedValue(null),
      sendRequest: vi.fn().mockResolvedValue({}),
    },
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupMembers: vi.fn().mockResolvedValue([]),
      getInviteToken: vi.fn().mockResolvedValue({ invite_url: 'https://example.test/join/tok' }),
      resetInviteToken: vi.fn().mockResolvedValue({ invite_url: 'https://example.test/join/new' }),
    },
    invitesAPI: {
      ...actual.invitesAPI,
      sendInvite: vi.fn().mockResolvedValue({}),
      sendFriendInvite: vi.fn().mockResolvedValue({}),
    },
  };
});

import FriendInvitePanel from './FriendInvitePanel';
import { friendshipsAPI, groupsAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

export const GROUP = { id: GROUP_ID, name: 'Tuesday Night Crew' };

/** A friend NOT yet in the group — selectable for a bulk invite. */
export const FRIENDSHIP = { id: 'fr-1', friend: { id: FRIEND_UUID, username: 'Dana' } };

/** A friend who IS already a group member — rendered disabled, "In group". */
export const MEMBER_FRIENDSHIP = {
  id: 'fr-2',
  friend: { id: MEMBER_UUID, username: 'Robin' },
};

export interface RenderPanelOptions {
  /** Accepted friendships returned for the caller. */
  friends?: Array<Record<string, unknown>>;
  /** Group roster; every `id` here counts as already-in-group. */
  members?: Array<Record<string, unknown>>;
  /** Admin-only affordances (the reset-invite-link control). */
  isAdmin?: boolean;
  /** Panel visibility — `false` renders nothing at all (early return). */
  open?: boolean;
  /** Pass `null` to render without group context (no QR section). */
  group?: Record<string, unknown> | null;
  /** Entry point — `'create'` selects the post-creation context copy (§6.3). */
  openedFrom?: 'default' | 'create';
}

/** Render the invite panel open, with a group and a resolved identity. */
export function renderPanel(options: RenderPanelOptions = {}) {
  const {
    friends = [FRIENDSHIP],
    members = [],
    isAdmin = false,
    open = true,
    group = GROUP,
    openedFrom = 'default',
  } = options;
  (friendshipsAPI.getFriends as Mock).mockResolvedValue(friends);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(members);
  const onClose = vi.fn();
  const onMemberAdded = vi.fn();
  const utils = render(
    <FriendInvitePanel
      group={group}
      open={open}
      onClose={onClose}
      onMemberAdded={onMemberAdded}
      isAdmin={isAdmin}
      openedFrom={openedFrom}
    />
  );
  return { onClose, onMemberAdded, ...utils };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfUuid = SELF_UUID;
});

afterEach(cleanup);

describe('FriendInvitePanel render harness', () => {
  it('renders its header and the group it is inviting to', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Invite Members' })).toBeInTheDocument();
    expect(screen.getByText('to Tuesday Night Crew')).toBeInTheDocument();
  });

  it('renders nothing at all while closed', () => {
    const { container } = renderPanel({ open: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders all three invite routes: friends list, email and QR', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Your Friends' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Invite by Email' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Share QR Code' })).toBeInTheDocument();
  });

  it('drops the QR route when there is no group context', async () => {
    renderPanel({ group: null });
    expect(await screen.findByRole('heading', { name: 'Invite by Email' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Share QR Code' })).not.toBeInTheDocument();
  });
});

describe('FriendInvitePanel invite list', () => {
  it('lists an invitable friend with an enabled checkbox', async () => {
    renderPanel();
    expect(await screen.findByText('Dana')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeDisabled();
  });

  it('renders an already-in-group friend as a disabled, checked row', async () => {
    renderPanel({
      friends: [MEMBER_FRIENDSHIP],
      members: [{ id: MEMBER_UUID, username: 'Robin' }],
    });
    expect(await screen.findByText('Robin')).toBeInTheDocument();
    expect(await screen.findByText('In group')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('checkbox')).toBeDisabled());
  });

  it('offers the empty state with a route to the friends page', async () => {
    renderPanel({ friends: [] });
    expect(await screen.findByText('No friends yet.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Add friends' })).toHaveAttribute('href', '/friends');
  });

  it('sends an email invite through the invites API', async () => {
    const { invitesAPI } = await import('@/lib/api');
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(screen.getByPlaceholderText('user@example.com'), {
      target: { value: 'newcomer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(invitesAPI.sendInvite).toHaveBeenCalledWith(GROUP_ID, 'newcomer@example.test')
    );
  });
});

describe('FriendInvitePanel — Req 9 migration proof', () => {
  // THE Req 9 CHECK, now armed positive (plan 88-15). The `.modal-overlay`
  // census cannot see this component either before or after the swap, so its
  // dialog status is asserted directly here. Plan 88-06 shipped the inverse of
  // these three pins (`queryByRole('dialog')` is null) so that the migration
  // could not land silently; 88-15 flipped them.

  it('exposes role=dialog once the panel is composed on <Modal>', async () => {
    renderPanel();
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('takes its accessible name from the panel title (aria-labelledby via DialogTitle)', async () => {
    renderPanel();
    expect(
      await screen.findByRole('dialog', { name: /Invite Members/ })
    ).toBeInTheDocument();
  });

  it('closes on Escape now that <Modal> owns dismissal', async () => {
    const user = userEvent.setup();
    const { onClose } = renderPanel();
    await screen.findByRole('dialog');
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('traps focus inside the dialog', async () => {
    const user = userEvent.setup();
    renderPanel();
    const dialog = await screen.findByRole('dialog');
    // Radix moves focus into the content on open, then cycles within it.
    await waitFor(() => expect(dialog.contains(document.activeElement)).toBe(true));
    for (let i = 0; i < 12; i += 1) {
      await user.tab();
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('keeps its header copy intact through the <Modal> swap', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Invite Members' })).toBeInTheDocument();
    expect(screen.getByText('to Tuesday Night Crew')).toBeInTheDocument();
  });

  it('still closes through its explicit Done affordance', async () => {
    const { onClose } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6 plan 22 task 1 — the a11y arms.
//
// These are BEHAVIORAL, not markup checks, and the shape is deliberate. Every
// announcement arm captures the live region BEFORE the outcome fires and asserts
// on THAT SAME NODE afterwards (`expect(after).toBe(before)`) — the idiom
// StatusRegion.test.tsx:20-29 already uses. Presence alone is satisfied by a
// CONDITIONALLY-mounted region, which is precisely the bug: a screen reader
// announces a CHANGE to a live region, never the conditional mount of a new one.
//
// The description arm RESOLVES the description from the email <Input> — a
// focusable element — and reads the text back. An `aria-describedby` attribute
// string asserted anywhere on the tree would pass while producing zero
// AT-observable effect.
//
// axe has NO rule for an unassociated error message, so task 3's composed audit
// is not the catch for any of this.
// ---------------------------------------------------------------------------
describe('FriendInvitePanel — error and success are announced (88.6-22)', () => {
  const emailField = () => screen.getByRole('textbox', { name: 'Invite by Email' });
  const sendButton = () => screen.getByRole('button', { name: 'Send' });
  const errorRegion = () => document.getElementById('invite-email-error');
  const statusRegion = () => document.getElementById('invite-email-status');

  it('mounts both live regions EMPTY before anything happens, with no margin', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    const err = errorRegion();
    const ok = statusRegion();
    expect(err).not.toBeNull();
    expect(ok).not.toBeNull();
    expect(err).toHaveAttribute('role', 'alert');
    expect(err).toHaveAttribute('aria-live', 'assertive');
    expect(err).toHaveAttribute('aria-atomic', 'true');
    expect(ok).toHaveAttribute('role', 'status');
    expect(ok).toHaveAttribute('aria-live', 'polite');
    expect(err).toHaveTextContent('');
    expect(ok).toHaveTextContent('');
    // The always-mounted EMPTY region must add no visible space: `mt-2` applies
    // only when filled (the shipped `<p>` carried it unconditionally).
    expect(err).not.toHaveClass('mt-2');
    expect(ok).not.toHaveClass('mt-2');
  });

  it('injects the failure into the SAME assertive node, and the email field resolves it', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    const before = errorRegion();
    expect(before).toHaveTextContent('');
    // The field carries NO description while there is no error (FormField's contract).
    expect(emailField()).not.toHaveAttribute('aria-describedby');
    expect(emailField()).not.toHaveAttribute('aria-invalid');

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(errorRegion()).not.toHaveTextContent(''));
    const after = errorRegion();
    expect(after).toBe(before); // node identity — the region was never remounted
    expect(after).toHaveClass('mt-2');
    expect(after).toHaveClass('text-content-status-error');
    // The register's `unknown` line, not an authored 'Failed to …' string.
    expect(after).toHaveTextContent('Something went wrong. Refresh the page to try again.');

    // RESOLVE the description from the FOCUSABLE control, then read it back.
    const field = emailField();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    const describedBy = field.getAttribute('aria-describedby');
    expect(describedBy).toBe('invite-email-error');
    const described = describedBy!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(described).toContain('Something went wrong. Refresh the page to try again.');
  });

  it('announces the SUCCESS on the same node — the outcome that was silent before', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    const before = statusRegion();
    expect(before).toHaveTextContent('');

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(statusRegion()).toHaveTextContent('Invite sent to newcomer@example.test')
    );
    expect(statusRegion()).toBe(before);
    expect(errorRegion()).toHaveTextContent('');
  });

  it('announces the clipboard copy, keeping the visible label swap', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });
    renderPanel();
    const copy = await screen.findByRole('button', { name: 'Copy Invite Link' });
    // Captured BEFORE the copy: the sr-only region is already mounted and empty.
    const regions = Array.from(document.querySelectorAll('[role="status"].sr-only'));
    expect(regions).toHaveLength(1);
    const before = regions[0];
    expect(before).toHaveTextContent('');

    await user.click(copy);

    await waitFor(() => expect(before).toHaveTextContent('Invite link copied to the clipboard.'));
    // The visible label swap is PRESERVED, not replaced by the announcement.
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(document.querySelectorAll('[role="status"].sr-only')[0]).toBe(before);
  });
});

describe('FriendInvitePanel — gated controls stay in the focus order (88.6-22)', () => {
  const emailField = () => screen.getByRole('textbox', { name: 'Invite by Email' });

  it('reports a fixed app-authored error when Send is pressed with an empty field', async () => {
    const { invitesAPI } = await import('@/lib/api');
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    const send = screen.getByRole('button', { name: 'Send' });
    // The gate is ARIA, not the native attribute — so the press arrives at all.
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toHaveAttribute('disabled');

    await user.click(send);

    expect(document.getElementById('invite-email-error')).toHaveTextContent(
      'Enter an email address to send an invite.'
    );
    expect(invitesAPI.sendInvite).not.toHaveBeenCalled();
    // Not the browser's `required` bubble: the form opts out of native validation.
    expect(emailField().closest('form')).toHaveAttribute('novalidate');
  });

  it('refuses a second Send while the first is in flight, and keeps focus on the control', async () => {
    const { invitesAPI } = await import('@/lib/api');
    let release: (value: unknown) => void = () => {};
    (invitesAPI.sendInvite as Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    const send = screen.getByRole('button', { name: 'Send' });
    await user.click(send);

    // In flight: the pressed control is STILL in the document and STILL focused —
    // the whole point of `aria-disabled` over the native attribute (DR-C).
    const inFlight = screen.getByRole('button', { name: 'Sending...' });
    expect(inFlight).toBeInTheDocument();
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(inFlight);

    // A second activation while the request is open must be refused by the HANDLER.
    fireEvent.click(inFlight);
    fireEvent.click(inFlight);
    expect(invitesAPI.sendInvite).toHaveBeenCalledTimes(1);

    release({});
    await waitFor(() => expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument());
  });

  it('refuses a second Add Friend press while the first is in flight', async () => {
    const { friendshipsAPI: api } = await import('@/lib/api');
    let release: (value: unknown) => void = () => {};
    (api.searchUserByEmail as Mock).mockResolvedValue({
      id: FRIEND_UUID,
      username: 'Dana',
      email: 'dana@example.test',
    });
    (api.sendRequest as Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );
    const user = userEvent.setup();
    renderPanel({ friends: [] });
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(
      screen.getByRole('textbox', { name: 'Invite by Email' }),
      { target: { value: 'dana@example.test' } }
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const add = await screen.findByRole('button', { name: 'Add Friend' });
    await user.click(add);

    const inFlight = screen.getByRole('button', { name: 'Sending...' });
    expect(inFlight).toHaveAttribute('aria-disabled', 'true');
    expect(inFlight).not.toHaveAttribute('disabled');
    expect(document.activeElement).toBe(inFlight);

    fireEvent.click(inFlight);
    fireEvent.click(inFlight);
    expect(api.sendRequest).toHaveBeenCalledTimes(1);

    release({});
    await waitFor(() =>
      expect(document.getElementById('invite-friend-request-status') ?? document.body)
        .toHaveTextContent('Friend request sent!')
    );
  });
});

describe('FriendInvitePanel create-path context copy (Req 7 / §6.3)', () => {
  // The create path is the auto-open straight after group creation
  // (createGroup.js). Without the context copy the generic header reads as an
  // accidental click-through — the owner himself misread it that way.

  it('names the freshly created group in the header and explains why it opened', async () => {
    renderPanel({ openedFrom: 'create' });
    expect(
      await screen.findByRole('heading', { name: "Tuesday Night Crew is live — who's in?" })
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Invite the people you actually play with. You can always add more later.'
      )
    ).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Invite Members' })).not.toBeInTheDocument();
  });

  it('leaves every other entry point on the generic header', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Invite Members' })).toBeInTheDocument();
    expect(screen.getByText('to Tuesday Night Crew')).toBeInTheDocument();
    expect(
      screen.queryByText(/is live — who's in\?/)
    ).not.toBeInTheDocument();
  });

  it('renders a group name with markup characters as inert text (T-88-15-01)', async () => {
    const dialog = renderPanel({
      openedFrom: 'create',
      group: { id: GROUP_ID, name: '<img src=x onerror=alert(1)>' },
    });
    const heading = await screen.findByRole('heading', {
      name: "<img src=x onerror=alert(1)> is live — who's in?",
    });
    expect(heading.querySelector('img')).toBeNull();
    expect(dialog.container.ownerDocument.querySelector('img')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6 plan 22 task 3 — R7 composed axe audit, surface #4 of the nine.
//
// ORDERING (UI-SPEC §7.5): this audit runs AFTER this surface's LAST migration
// commit — i.e. after tasks 1 and 2 of plan 88.6-22. That is the difference
// between auditing the migrated surface and auditing a half-migrated one, and it
// is stated here rather than left to commit order.
//
// WHAT THIS AUDIT DOES NOT COVER, said plainly so a zero-violation result is not
// over-read:
//   - axe has NO rule for an unassociated error message. A clean run here is NOT
//     evidence that task 1's `:477` association or task 2's three BallotSection
//     associations landed; those are proven by their own behavioural arms above
//     and in `BallotSection.test.tsx`.
//   - It is not the catch for the `id` on the "Invite by Email" heading either.
//     Task 1 owns that contract outright; a WCAG 4.1.2 violation surfacing here
//     would mean task 1 had already shipped a regression this plan knew about.
//
// VIEWPORT (D65): jsdom performs no layout and has no viewport, so "run it at
// phone width and at desktop" is not a thing this audit can do — claiming it would
// be a vacuous assertion. The substitute §7.5 asks for is to audit each
// MEDIA-QUERY FORK of the audited tree by stubbing `matchMedia`. Measured
// 2026-09-16: `grep -rn matchMedia` over the whole audited tree —
// `FriendInvitePanel.js`, `Modal.tsx`, `ui/dialog.tsx`, `ui/UserChip.tsx`,
// `ui/Input.tsx`, `ui/Button.tsx`, `ui/Heading.tsx`, `ui/StatusRegion.tsx` —
// returns ZERO hits. This surface has no media-query fork; its only responsive
// behaviour is Tailwind `md:` classes, which jsdom neither applies nor branches
// on. So ONE composed pass per rendered branch is the whole of what is
// measurable here, and that is recorded rather than dressed up as a width run.
// ---------------------------------------------------------------------------

// WCAG 4.1.2 is a TAG; `heading-order` is a RULE carrying no wcag412 tag, so both
// are needed. `as const` is applied to `type` ONLY — axe-core's `RunOnly.values`
// is a mutable `string[]` and a fully-readonly literal fails `tsc --noEmit`.
// (Same two constants as `PromptScheduleManager.test.tsx:129-130`, the phase's
// first composed audit; deliberately not extracted into a shared helper, which
// would be a third file for two object literals.)
const WCAG_412 = { runOnly: { type: 'tag' as const, values: ['wcag412'] } };
const HEADING_ORDER = { runOnly: { type: 'rule' as const, values: ['heading-order'] } };

describe('FriendInvitePanel — R7 composed axe audit (UI-SPEC §7.5, surface #4)', () => {
  it('1. the POPULATED surface passes WCAG 4.1.2 and heading-order', async () => {
    renderPanel();
    // Settle on a BRANCH-SPECIFIC element, never on the header. The header renders
    // above every branch, so awaiting it returns while the friends section still
    // says "Loading your friends..." and the audit would score a nearly-empty tree
    // (the trap plan 15 recorded after hitting it).
    await screen.findByText('Dana');
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('2. the ADMIN surface — the extra reset control — passes both rules', async () => {
    renderPanel({ isAdmin: true });
    await screen.findByRole('button', { name: 'Reset invite link' });
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('3. the EMPTY-friends and NO-GROUP branches are audited too', async () => {
    // An audit of one branch is an audit of one branch. The empty branch swaps the
    // list for a link, and the no-group branch drops the whole QR section — both
    // change the named-control population, which is what 4.1.2 is about.
    renderPanel({ friends: [] });
    await screen.findByText('No friends yet.');
    let dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
    cleanup();

    renderPanel({ group: null });
    await screen.findByRole('heading', { name: 'Invite by Email' });
    dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('4. the ERRORED surface — the branch this plan added markup to — passes both rules', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite by Email' }), {
      target: { value: 'newcomer@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(document.getElementById('invite-email-error')).not.toHaveTextContent('')
    );
    const dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });

  it('5. the ADD-FRIEND prompt branch passes both rules, and UserChip still gets no avatar', async () => {
    // D-22 companion (plan 37): `FriendInvitePanel.js` is `UserChip`'s only importer
    // and passes `user={{ name }}` with NO `avatarUrl` and NO `picture`, so
    // UserChip's `<img>` branch never renders from this surface and plan 37's
    // `referrerPolicy="no-referrer"` addition is unobservable here. Confirmed by
    // asserting the absence of an `<img>` in the rendered prompt rather than by
    // reading the call site.
    const { friendshipsAPI: api, invitesAPI } = await import('@/lib/api');
    (api.searchUserByEmail as Mock).mockResolvedValue({
      id: FRIEND_UUID,
      username: 'Dana',
      email: 'dana@example.test',
    });
    (invitesAPI.sendInvite as Mock).mockResolvedValue({});
    renderPanel({ friends: [] });
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite by Email' }), {
      target: { value: 'dana@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));

    const add = await screen.findByRole('button', { name: 'Add Friend' });
    expect(add).toBeInTheDocument();
    const dialog = screen.getByRole('dialog');
    expect(dialog.querySelector('img')).toBeNull();
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
  });
});
