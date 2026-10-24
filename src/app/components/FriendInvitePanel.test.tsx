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
import { act, render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { axe } from 'vitest-axe';
import { logger } from '@/lib/logger';

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
      getFriends: vi.fn(() => Promise.resolve([])),
      searchUserByEmail: vi.fn(() => Promise.resolve(null)),
      sendRequest: vi.fn(() => Promise.resolve({})),
      // The real FriendshipStatusProvider wraps every render (88.6.1 code review A-17): its load reads these.
      getSentRequests: vi.fn(() => Promise.resolve([])),
      getReceivedRequests: vi.fn(() => Promise.resolve([])),
    },
    groupsAPI: {
      ...actual.groupsAPI,
      getGroupMembers: vi.fn(() => Promise.resolve([])),
      getInviteToken: vi.fn(() => Promise.resolve({ invite_url: 'https://example.test/join/tok' })),
    },
    invitesAPI: {
      ...actual.invitesAPI,
      sendInvite: vi.fn(() => Promise.resolve({})),
      sendFriendInvite: vi.fn(() => Promise.resolve({})),
    },
  };
});

import FriendInvitePanel from './FriendInvitePanel';
import { FriendshipStatusProvider } from './FriendshipStatusProvider';
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
    open = true,
    group = GROUP,
    openedFrom = 'default',
  } = options;
  (friendshipsAPI.getFriends as Mock).mockResolvedValue(friends);
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(members);
  const onClose = vi.fn();
  const onMemberAdded = vi.fn();
  // Wrapped in the REAL app-wide provider, as layout.js mounts it: Add Friend sends through its
  // send-and-sync (88.6.1 code review A-17). `wrapper` survives a rerender.
  const utils = render(
    <FriendInvitePanel
      group={group}
      open={open}
      onClose={onClose}
      onMemberAdded={onMemberAdded}
      openedFrom={openedFrom}
    />,
    { wrapper: FriendshipStatusProvider as React.ComponentType<{ children: React.ReactNode }> }
  );
  return { onClose, onMemberAdded, ...utils };
}

// DECISION Phase 88.6.2-17 (reset): reset every mock before each arm, with the api defaults written as vi.fn(impl) so the reset restores them, over clearing call history only — which kept one-shot queues and standing implementations across arms, so one failing arm poisoned the next (88.6.1-27, RT-40) — and over draining queues arm by arm, which every arm would have to remember. Other suites that only clear are not changed here (plan 30 hand-off).
beforeEach(() => {
  vi.resetAllMocks();
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
// StatusRegion.test.tsx:25-34 already uses (`expect(after).toBe(before)` at :32). Presence alone is satisfied by a
// CONDITIONALLY-mounted region, which is precisely the bug: a screen reader
// announces a CHANGE to a live region, never the conditional mount of a new one.
// CORRECTED by 88.6.1-27 (D-42): that rule holds for polite / status regions; an
// inserted alert region that arrives with its text IS announced. The regions here
// stay always-mounted for node identity and the one house shape (D-22), and node
// identity is what these arms pin.
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
  // 88.6.1-27: the send lane, the action region the Send button names (copy row G2, D-30).
  const sendLane = () => document.getElementById('invite-email-send-error');
  const G2 = "We couldn't send that invite. Please try again.";
  const NETWORK_LINE = "We couldn't reach the server. Check your connection and try again.";
  const INVALID_EMAIL = "That doesn't look like a valid email address. Check it and try again.";

  // 88.6.1-27 arm F (D-22, the house empty shape) — rewritten in place over the 88.6-22 pin
  // that asserted NO margin while empty. The four email-section regions now carry an
  // unconditional mt-2 and are out of flow (sr-only) while empty, so the margin costs nothing.
  it('mounts the four email-section regions EMPTY on the D-22 house shape (sr-only + mt-2), and a success fills the SAME node (88.6.1-27 arm F)', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    const ids = [
      ['invite-email-error', 'alert', 'assertive'],
      ['invite-email-send-error', 'alert', 'assertive'],
      ['invite-email-status', 'status', 'polite'],
      ['invite-friend-request-status', 'status', 'polite'],
    ] as const;
    for (const [id, role, live] of ids) {
      const node = document.getElementById(id);
      expect(node, id).not.toBeNull();
      expect(node).toHaveAttribute('role', role);
      expect(node).toHaveAttribute('aria-live', live);
      expect(node).toHaveAttribute('aria-atomic', 'true');
      expect(node?.textContent).toBe('');
      expect(node).toHaveClass('sr-only');
      expect(node).toHaveClass('mt-2');
    }

    const before = statusRegion();
    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());
    await waitFor(() =>
      expect(statusRegion()).toHaveTextContent('Invite sent to newcomer@example.test')
    );
    expect(statusRegion()).toBe(before);
    expect(statusRegion()).not.toHaveClass('sr-only');
    expect(statusRegion()).toHaveClass('mt-2');
  });

  // 88.6.1-27 arm A (tracer) — rewritten in place over the 88.6-22 arm that pinned the
  // register's unknown line in the FIELD lane. A code-less failure is about the SEND, not the
  // address: it now reads G2 from the send lane, the field stays valid and keeps the address.
  it('a code-less failure lands G2 in the SEND lane on the same node, leaving the field valid and still holding the address (88.6.1-27 arm A)', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    const before = sendLane();
    expect(before).not.toBeNull();
    expect(before).toHaveAttribute('role', 'alert');
    expect(before).toHaveAttribute('aria-live', 'assertive');
    expect(before?.textContent).toBe('');
    expect(before).toHaveClass('sr-only');
    // The field carries NO description while there is no error (FormField's contract).
    expect(emailField()).not.toHaveAttribute('aria-describedby');
    expect(emailField()).not.toHaveAttribute('aria-invalid');

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(sendLane()?.textContent).toBe(G2));
    const after = sendLane();
    expect(after).toBe(before); // node identity — the region was never remounted
    expect(after).not.toHaveClass('sr-only');
    expect(after).toHaveClass('mt-2');
    expect(after).toHaveClass('text-content-status-error');

    // The field is NOT marked invalid and still holds what was typed.
    const field = emailField();
    expect(field).not.toHaveAttribute('aria-invalid');
    expect(field).not.toHaveAttribute('aria-describedby');
    expect(field).toHaveValue('newcomer@example.test');
    expect(errorRegion()?.textContent).toBe('');

    // RESOLVE the description from the Send button, then read it back.
    const send = sendButton();
    const describedBy = send.getAttribute('aria-describedby');
    expect(describedBy).toBe('invite-email-send-error');
    const described = describedBy!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
      .join(' ');
    expect(described).toBe(G2);
    expect(screen.getByRole('dialog').textContent).not.toMatch(/refresh the page/i);
  });

  // 88.6.1-27 arm B: a CODED non-field failure keeps its register line, in the send lane.
  it('a coded non-field failure (network) reads its register line from the send lane, and the field stays valid (88.6.1-27 arm B)', async () => {
    const { invitesAPI, ApiError } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(new ApiError('Network down', 'network', 0));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(sendLane()?.textContent).toBe(NETWORK_LINE));
    expect(emailField()).not.toHaveAttribute('aria-invalid');
    expect(errorRegion()?.textContent).toBe('');
  });

  // 88.6.1-27 arm C: a verdict about the typed ADDRESS stays on the field lane.
  it('a `validation` rejection stays on the field lane and leaves the send lane empty (88.6.1-27 arm C)', async () => {
    const { invitesAPI, ApiError } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 400', 'validation', 400)
    );
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    const lane = sendLane();

    fireEvent.change(emailField(), { target: { value: 'bob@gmail' } });
    fireEvent.click(sendButton());

    // Positive wait first, then the absence synchronously (never inside a waitFor).
    await waitFor(() => expect(errorRegion()?.textContent).toBe(INVALID_EMAIL));
    expect(sendLane()).toBe(lane);
    expect(sendLane()?.textContent).toBe('');
    expect(sendLane()).toHaveClass('sr-only');
    expect(emailField()).toHaveAttribute('aria-invalid', 'true');
  });

  // 88.6.1-27 arm D: typing a new address clears the send lane on the same node.
  it('typing clears the send lane back to its empty shape on the same node (88.6.1-27 arm D)', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendLane()?.textContent).toBe(G2));
    const lane = sendLane();

    fireEvent.change(emailField(), { target: { value: 'newcomer2@example.test' } });
    expect(sendLane()).toBe(lane);
    expect(sendLane()?.textContent).toBe('');
    expect(sendLane()).toHaveClass('sr-only');
  });

  // 88.6.1-27 arm E (SPEC Edge R8 idempotency, backstop): the same failure twice is a change
  // the send lane reports twice.
  it('a repeat code-less failure mutates the same send-lane node again (88.6.1-27 arm E)', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock)
      .mockRejectedValueOnce(new Error('nope'))
      .mockRejectedValueOnce(new Error('nope'));
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(emailField(), { target: { value: 'newcomer@example.test' } });
    fireEvent.click(sendButton());
    await waitFor(() => expect(sendLane()?.textContent).toBe(G2));
    const lane = sendLane()!;

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(lane, { childList: true, characterData: true, subtree: true });

    fireEvent.click(sendButton());
    await waitFor(() => expect(invitesAPI.sendInvite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(records.length).toBeGreaterThan(0));
    await waitFor(() => expect(sendLane()?.textContent).toBe(G2));
    observer.disconnect();
    expect(sendLane()).toBe(lane);
  });

  // ADDED by plan 88.6-58 task 2 (2026-09-28, /code-adversarial-review 88.6 H3, owner rulings
  // `H3-RULING` + `H3-COPY-RULING`). `noValidate` (88.6-22) sends a malformed address to the
  // server, whose `isEmail` verdict is a raw `{ errors }` 400 (Sonnet/routes/invites.js:206,
  // :216) — `apiFetch` maps it to `validation`, whose register line says "Refresh the page",
  // which cannot fix a typo. RED on FE d03f728, GREEN after the local byCode override.
  it('a malformed address (the server isEmail 400 → `validation`) renders the ratified field message on the SAME node', async () => {
    const { invitesAPI, ApiError } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 400', 'validation', 400, {
        errors: [{ msg: 'Valid email is required', path: 'email' }],
      })
    );
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    const before = errorRegion();

    fireEvent.change(emailField(), { target: { value: 'bob@gmail' } });
    fireEvent.click(sendButton());

    await waitFor(() => expect(errorRegion()).not.toHaveTextContent(''));
    const after = errorRegion();
    expect(after).toBe(before); // node identity kept
    expect(after).toHaveTextContent(
      "That doesn't look like a valid email address. Check it and try again."
    );
    expect(after?.textContent).not.toMatch(/refresh the page/i);
    expect(after?.textContent).not.toMatch(/valid email is required/i); // no upstream text
    const field = emailField();
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAttribute('aria-describedby', 'invite-email-error');
  });

  it('NEGATIVE: the `validation` override does not disturb the `already_member` code arm', async () => {
    const { invitesAPI, ApiError } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(
      new ApiError('Already a member', 'already_member', 409)
    );
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    fireEvent.change(emailField(), { target: { value: 'member@example.test' } });
    fireEvent.click(sendButton());

    await waitFor(() =>
      expect(errorRegion()).toHaveTextContent('This person is already a member of the group')
    );
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
    // 88.6.1-27: found by its id — the empty D-22 regions are sr-only too now, so the
    // old sr-only status query no longer finds exactly one.
    const before = document.getElementById('invite-link-copied-status');
    expect(before).not.toBeNull();
    expect(before).toHaveTextContent('');

    await user.click(copy);

    await waitFor(() => expect(before).toHaveTextContent('Invite link copied to the clipboard.'));
    // The visible label swap is PRESERVED, not replaced by the announcement.
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
    expect(document.getElementById('invite-link-copied-status')).toBe(before);
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

// Phase 88.6.1 plan 27 Task 2 — W016 row 17 (the field while sending), the newly found Req 5
// case (Add Friend unmounts itself on settle), and plan 12's cross-plan note (the copy timer).
describe('FriendInvitePanel — pressed controls, focus and the copy timer (88.6.1-27)', () => {
  const emailField = () => screen.getByRole('textbox', { name: 'Invite by Email' });
  const copyRegion = () => document.getElementById('invite-link-copied-status');
  const COPIED = 'Invite link copied to the clipboard.';

  // The handles of every 2000 ms timer the spy saw — Radix, user-event and the focus hook
  // schedule their own timers, so the copy label's is picked out by its delay.
  function copyTimerHandles(spy: { mock: { calls: unknown[][]; results: Array<{ value: unknown }> } }) {
    return spy.mock.calls
      .map((call, i) => ({ delay: call[1], handle: spy.mock.results[i]?.value }))
      .filter((entry) => entry.delay === 2000)
      .map((entry) => entry.handle);
  }

  function stubClipboard(writeText: Mock) {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  }

  // Prompts Add Friend for Dana after a successful email invite.
  async function openAddFriendPrompt() {
    const { friendshipsAPI: api, invitesAPI } = await import('@/lib/api');
    (api.searchUserByEmail as Mock).mockResolvedValue({
      id: FRIEND_UUID,
      username: 'Dana',
      email: 'dana@example.test',
    });
    (invitesAPI.sendInvite as Mock).mockResolvedValue({});
    renderPanel({ friends: [] });
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(emailField(), { target: { value: 'dana@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    return screen.findByRole('button', { name: 'Add Friend' });
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('R: an Enter send from the field keeps the field focusable (read-only + aria-disabled, never native disabled) and sends once (W016 row 17, AC-12)', async () => {
    const { invitesAPI, friendshipsAPI: api } = await import('@/lib/api');
    (api.searchUserByEmail as Mock).mockResolvedValue(null);
    let release: (value: unknown) => void = () => {};
    (invitesAPI.sendInvite as Mock).mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );
    const user = userEvent.setup();
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });

    const field = emailField();
    await user.type(field, 'newcomer@example.test{Enter}');
    await screen.findByRole('button', { name: 'Sending...' });

    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(field).not.toHaveAttribute('disabled');
    // CONFIRM-ONLY in jsdom (C-11): jsdom never blurs a disabled element, so the RED half of
    // this arm is the attribute above, not this focus line.
    expect(document.activeElement).toBe(field);
    expect(screen.getByRole('button', { name: 'Sending...' })).toHaveAttribute('aria-disabled', 'true');

    await user.keyboard('{Enter}');
    expect(invitesAPI.sendInvite).toHaveBeenCalledTimes(1);
    expect(field).toHaveAttribute('readonly');
    expect(field).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('button', { name: 'Sending...' })).toHaveAttribute('aria-disabled', 'true');

    release({});
    await screen.findByRole('button', { name: 'Send' });
    expect(field).not.toHaveAttribute('readonly');
    expect(field).not.toHaveAttribute('aria-disabled');
  });

  it('F1: when Add Friend succeeds and its prompt unmounts, focus lands on the Invite by Email heading (Req 5, D-04/D-05)', async () => {
    const { friendshipsAPI: api } = await import('@/lib/api');
    (api.sendRequest as Mock).mockResolvedValue({});
    const user = userEvent.setup();
    const add = await openAddFriendPrompt();

    await user.click(add);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invite by Email' }))
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(document.getElementById('invite-friend-request-status')).toHaveTextContent('Friend request sent!');
  });

  it('F1b: an UNFOCUSED tap (the iOS Safari shape: focus stays on body) still lands focus on the heading (88.6.1 code review A-16)', async () => {
    const { friendshipsAPI: api } = await import('@/lib/api');
    (api.sendRequest as Mock).mockResolvedValue({});
    const add = await openAddFriendPrompt();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);

    // fireEvent.click does not focus the button, as a WebKit tap does not.
    fireEvent.click(add);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invite by Email' }))
    );
  });

  it('F1c: a sent request goes through the app-wide provider, which re-reads the friendship lists; a failure does not (88.6.1 code review A-17)', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock)
      .mockRejectedValueOnce(new ApiError('Network down', 'network', 0))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    const add = await openAddFriendPrompt();
    await waitFor(() => expect(api.getSentRequests).toHaveBeenCalledTimes(1));

    await user.click(add);
    await waitFor(() => expect(document.getElementById('invite-friend-request-error')?.textContent).not.toBe(''));
    expect(api.getSentRequests).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole('button', { name: 'Add Friend' }));
    await waitFor(() =>
      expect(document.getElementById('invite-friend-request-status')).toHaveTextContent('Friend request sent!')
    );
    expect(api.sendRequest).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(api.getSentRequests).toHaveBeenCalledTimes(2));
    expect(api.getFriends).toHaveBeenCalledTimes(3);
  });

  it('F2: the already-pending answer (a 409 the client maps to conflict) also lands focus on the heading (Req 5)', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 409', 'conflict', 409)
    );
    const user = userEvent.setup();
    const add = await openAddFriendPrompt();

    await user.click(add);

    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invite by Email' }))
    );
    expect(document.getElementById('invite-friend-request-status')).toHaveTextContent('Friend request sent!');
  });

  it('K1: a repeat copy is announced again on the same node, and the first 2 s timer is cleared on re-arm (Req 8 R8, Req 11)', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard(writeText);
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    renderPanel();
    const copy = await screen.findByRole('button', { name: 'Copy Invite Link' });

    await user.click(copy);
    await screen.findByRole('button', { name: 'Copied!' });
    const region = copyRegion()!;
    expect(region.textContent).toBe(COPIED);
    const [firstHandle] = copyTimerHandles(setSpy);
    expect(firstHandle).toBeDefined();

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(region, { childList: true, characterData: true, subtree: true });

    await user.click(screen.getByRole('button', { name: 'Copied!' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(records.length).toBeGreaterThan(0));
    observer.disconnect();
    expect(copyRegion()).toBe(region);
    expect(region.textContent).toBe(COPIED);
    expect(clearSpy).toHaveBeenCalledWith(firstHandle);
  });

  it('K2: closing the panel clears the pending 2 s timer, and a reopen starts fresh (SPEC Edge R11)', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { rerender, onClose, onMemberAdded } = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const [pending] = copyTimerHandles(setSpy);
    expect(pending).toBeDefined();

    rerender(
      <FriendInvitePanel group={GROUP} open={false} onClose={onClose} onMemberAdded={onMemberAdded} />
    );
    expect(clearSpy).toHaveBeenCalledWith(pending);

    rerender(
      <FriendInvitePanel group={GROUP} open onClose={onClose} onMemberAdded={onMemberAdded} />
    );
    expect(await screen.findByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
    expect(copyRegion()?.textContent).toBe('');
  });

  it('K3: unmounting the panel clears the pending 2 s timer (Req 11)', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockResolvedValue(undefined));
    const setSpy = vi.spyOn(globalThis, 'setTimeout');
    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    const { unmount } = renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    const [pending] = copyTimerHandles(setSpy);
    expect(pending).toBeDefined();

    unmount();
    expect(clearSpy).toHaveBeenCalledWith(pending);
  });

  // AMENDED 2026-10-19 (88.6.1 code review CR-1 / A-25, owner ratified): K4 pinned the silent
  // failure as a guard; the failure is now shown and announced, with the link as text.
  const failRegion = () => document.getElementById('invite-link-copy-failed-status');
  const COPY_FAILED = "Couldn't copy the link. Press and hold the link to copy it.";
  const INVITE_LINK = 'https://example.test/join/tok';

  it('K4: a rejected clipboard write shows and announces the failure sentence, with the link as text', async () => {
    const user = userEvent.setup();
    stubClipboard(vi.fn().mockRejectedValue(new Error('denied')));
    const info = vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    renderPanel();

    await screen.findByRole('button', { name: 'Copy Invite Link' });
    const before = failRegion();
    expect(before?.textContent).toBe('');
    expect(screen.queryByRole('link', { name: INVITE_LINK })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(info).toHaveBeenCalledTimes(1));
    expect(info.mock.calls[0][0]).toBe('Failed to copy link:');
    expect(failRegion()).toBe(before);
    expect(before?.textContent).toBe(COPY_FAILED);
    expect(before).toHaveAttribute('role', 'status');
    expect(before).not.toHaveClass('sr-only');
    expect(screen.getByRole('link', { name: INVITE_LINK })).toHaveAttribute('href', INVITE_LINK);
    expect(copyRegion()?.textContent).toBe('');
    expect(screen.getByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
  });

  it('K5: the next successful copy clears the failure sentence and the link', async () => {
    const user = userEvent.setup();
    stubClipboard(
      vi.fn().mockRejectedValueOnce(new Error('denied')).mockResolvedValueOnce(undefined)
    );
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    renderPanel();

    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(failRegion()?.textContent).toBe(COPY_FAILED));
    await user.click(screen.getByRole('button', { name: 'Copy Invite Link' }));
    await screen.findByRole('button', { name: 'Copied!' });
    expect(failRegion()?.textContent).toBe('');
    expect(screen.queryByRole('link', { name: INVITE_LINK })).toBeNull();
    expect(copyRegion()?.textContent).toBe(COPIED);
  });

  it('K6: closing clears the failure, and a rejection that settles after the close stays silent', async () => {
    const user = userEvent.setup();
    vi.spyOn(logger, 'info').mockImplementation(() => undefined);
    let rejectWrite: (e: Error) => void = () => {};
    const writeText = vi
      .fn()
      .mockRejectedValueOnce(new Error('denied'))
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          })
      );
    stubClipboard(writeText);
    const { rerender, onClose, onMemberAdded } = renderPanel();
    const at = (open: boolean) => (
      <FriendInvitePanel group={GROUP} open={open} onClose={onClose} onMemberAdded={onMemberAdded} />
    );

    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    await waitFor(() => expect(failRegion()?.textContent).toBe(COPY_FAILED));
    rerender(at(false));
    rerender(at(true));
    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    expect(writeText).toHaveBeenCalledTimes(2);
    expect(failRegion()?.textContent).toBe('');

    rerender(at(false));
    await act(async () => {
      rejectWrite(new Error('late'));
    });
    rerender(at(true));
    await screen.findByRole('button', { name: 'Copy Invite Link' });
    expect(failRegion()?.textContent).toBe('');
    expect(screen.queryByRole('link', { name: INVITE_LINK })).toBeNull();
  });

  it('K7: a copy that RESOLVES after the close sets nothing on the reopened panel (the success twin of K6)', async () => {
    const user = userEvent.setup();
    let resolveWrite: () => void = () => {};
    const writeText = vi.fn().mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveWrite = resolve;
        })
    );
    stubClipboard(writeText);
    const { rerender, onClose, onMemberAdded } = renderPanel();
    const at = (open: boolean) => (
      <FriendInvitePanel group={GROUP} open={open} onClose={onClose} onMemberAdded={onMemberAdded} />
    );

    await user.click(await screen.findByRole('button', { name: 'Copy Invite Link' }));
    expect(writeText).toHaveBeenCalledTimes(1);
    rerender(at(false));
    await act(async () => {
      resolveWrite();
    });
    rerender(at(true));
    // Without the generation check the late resolve flips the label to Copied! and announces on the closed
    // panel, and the reopened panel shows that stale state.
    expect(await screen.findByRole('button', { name: 'Copy Invite Link' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Copied!' })).toBeNull();
    expect(document.getElementById('invite-link-copied-status')?.textContent).toBe('');
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

  // DECISION Phase 88.6.2-17 (R7-M1): pin min-w-0 beside the wrap class on the column, src/app/components/FriendInvitePanel.js ("min-w-0 wrap-break-word"), over switching the column to wrap-anywhere — that is a production className change this phase does not make (SPEC R11), and it would replace the device-checked UAT3-D2 fix with an unchecked one.
  it("the post-creation header wraps a long unbroken group name instead of running under the close button (UAT3-D2, 2026-09-30)", async () => {
    // Owner device check 2026-09-30: a 40-character name with no spaces overflowed the dialog and
    // painted under the ×. jsdom has no layout, so the pin is the wrap class on the header's shared
    // text column (overflow-wrap inherits into the title AND the lead-in); the geometry half is the
    // owner's re-check on preview after CI. min-w-0 is the load-bearing half: overflow-wrap does not
    // shrink a flex item's min-content, so without it the column cannot narrow below the unbroken
    // word and the overflow returns (R7-M1/M4).
    renderPanel({ openedFrom: 'create', group: { ...GROUP, name: 'M'.repeat(40) } });
    const heading = await screen.findByRole('heading', { name: `${'M'.repeat(40)} is live — who's in?` });
    expect(heading.closest('div')?.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'wrap-break-word']));
  });

  it("the default-path header's 'to <group>' lead-in wraps a long unbroken group name too (code review round 6 HIGH, 2026-09-30)", async () => {
    // Round 6 caught the half the device check missed: opened from Manage Members / the home page
    // (no openedFrom), the user-supplied name is in the LEAD-IN, a sibling of the title, which
    // inherits nothing from a class on the title. Pinned on the shared column for the same reason.
    // min-w-0 is the load-bearing half here too: overflow-wrap does not shrink a flex item's
    // min-content, so without it the column cannot narrow below the unbroken word (R7-M1/M4).
    renderPanel({ group: { ...GROUP, name: 'M'.repeat(40) } });
    const leadIn = await screen.findByText(`to ${'M'.repeat(40)}`);
    expect(leadIn.closest('div')?.className.split(/\s+/)).toEqual(expect.arrayContaining(['min-w-0', 'wrap-break-word']));
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

  // Arm 2 audited the admin-only reset surface, which 88.6.1-27 deleted (W015): no host ever
  // passed the flag that rendered it, and the working reset lives in Manage Members.

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
    // 88.6.1-27 arm G: a code-less failure fills the SEND lane now, not the field lane.
    await waitFor(() =>
      expect(document.getElementById('invite-email-send-error')).not.toHaveTextContent('')
    );
    let dialog = screen.getByRole('dialog');
    expect(await axe(dialog, WCAG_412)).toHaveNoViolations();
    expect(await axe(dialog, HEADING_ORDER)).toHaveNoViolations();
    cleanup();

    // ...and the FIELD lane's errored branch (a `validation` rejection) is audited too.
    const { ApiError } = await import('@/lib/api');
    (invitesAPI.sendInvite as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 400', 'validation', 400)
    );
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite by Email' }), {
      target: { value: 'bob@gmail' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() =>
      expect(document.getElementById('invite-email-error')).not.toHaveTextContent('')
    );
    dialog = screen.getByRole('dialog');
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

// Phase 88.6.1 plan 27 Task 3 — the friend-batch outcome is HEARD (Req 8; it was a
// conditionally mounted block with no role), an all-failed code-less batch says R2 (D-32), and
// the header row sits on the Modal header's phone-first scale (R7-M5).
describe('FriendInvitePanel — the friend batch is heard, and the header scale (88.6.1-27)', () => {
  const batchStatus = () => document.getElementById('invite-batch-status');
  const batchError = () => document.getElementById('invite-batch-error');
  const R2 = "We couldn't send those invites. Please try again.";
  const NETWORK_LINE = "We couldn't reach the server. Check your connection and try again.";
  const OTHER_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  const OTHER_FRIENDSHIP = { id: 'fr-3', friend: { id: OTHER_UUID, username: 'Eli' } };

  async function inviteSelected() {
    fireEvent.click(screen.getByRole('button', { name: /^Invite \d+ Friends?$/ }));
  }

  it('B1: an all-failed batch whose first failure has no code says R2 from the alert region (D-32 R2)', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(new Error('x'));
    renderPanel();
    await screen.findByText('Dana');
    fireEvent.click(screen.getByRole('checkbox'));
    await inviteSelected();

    await waitFor(() => expect(batchError()?.textContent).toBe(R2));
    expect(screen.getByRole('dialog').textContent).not.toMatch(/refresh the page/i);
    expect(batchStatus()?.textContent).toBe('');
  });

  it('B2: both batch regions are mounted EMPTY with the bulk block, and a success fills the SAME polite node with the success tint (Req 8, D-22)', async () => {
    renderPanel();
    await screen.findByText('Dana');
    const status = batchStatus();
    const error = batchError();
    expect(status).not.toBeNull();
    expect(error).not.toBeNull();
    expect(status).toHaveAttribute('role', 'status');
    expect(error).toHaveAttribute('role', 'alert');
    expect(status?.textContent).toBe('');
    expect(error?.textContent).toBe('');
    expect(status).toHaveClass('sr-only');
    expect(error).toHaveClass('sr-only');

    fireEvent.click(screen.getByRole('checkbox'));
    await inviteSelected();

    await waitFor(() => expect(batchStatus()?.textContent).toBe('Invited 1 friend!'));
    const after = batchStatus();
    expect(after).toBe(status);
    expect(after).not.toHaveClass('sr-only');
    for (const cls of ['p-3', 'rounded-lg', 'bg-status-success-subtle', 'text-content-status-success', 'border-status-success']) {
      expect(after).toHaveClass(cls);
    }
  });

  it('B3: a coded first failure keeps its register line in the alert region', async () => {
    const { invitesAPI, ApiError } = await import('@/lib/api');
    (invitesAPI.sendFriendInvite as Mock).mockRejectedValueOnce(new ApiError('Network down', 'network', 0));
    renderPanel();
    await screen.findByText('Dana');
    fireEvent.click(screen.getByRole('checkbox'));
    await inviteSelected();

    await waitFor(() => expect(batchError()?.textContent).toBe(NETWORK_LINE));
  });

  it('B4: two identical successful batches in a row mutate the same polite node again (SPEC Edge R8 idempotency, backstop)', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendFriendInvite as Mock).mockResolvedValue({});
    renderPanel();
    await screen.findByText('Dana');
    fireEvent.click(screen.getByRole('checkbox'));
    await inviteSelected();
    await waitFor(() => expect(batchStatus()?.textContent).toBe('Invited 1 friend!'));
    const node = batchStatus()!;

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(node, { childList: true, characterData: true, subtree: true });

    fireEvent.click(screen.getByRole('checkbox'));
    await inviteSelected();
    await waitFor(() => expect(invitesAPI.sendFriendInvite).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(records.length).toBeGreaterThan(0));
    await waitFor(() => expect(batchStatus()?.textContent).toBe('Invited 1 friend!'));
    observer.disconnect();
    expect(batchStatus()).toBe(node);
  });

  it('B5: a partial batch reads its sentence from the SAME polite node with the warning tint, and the alert region stays empty', async () => {
    const { invitesAPI } = await import('@/lib/api');
    (invitesAPI.sendFriendInvite as Mock).mockImplementation((_group: string, friendId: string) =>
      friendId === FRIEND_UUID ? Promise.resolve({}) : Promise.reject(new Error('x'))
    );
    renderPanel({ friends: [FRIENDSHIP, OTHER_FRIENDSHIP] });
    await screen.findByText('Eli');
    const status = batchStatus();
    for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
    await inviteSelected();

    await waitFor(() => expect(batchStatus()?.textContent).toBe('Invited 1, 1 failed'));
    const after = batchStatus();
    expect(after).toBe(status);
    expect(after).not.toHaveClass('sr-only');
    for (const cls of ['bg-status-warning-subtle', 'text-content-status-warning', 'border-status-warning']) {
      expect(after).toHaveClass(cls);
    }
    expect(batchError()?.textContent).toBe('');
    expect(batchError()).toHaveClass('sr-only');
  });

  it('P1. a terminal 409 reads as already invited — the panel shipped lines (88.6.1-72 GUARD)', async () => {
    // Pins the panel's two shipped 409 lines before plan 88.6.1-72 moves them into
    // friendBatchInviteOutcome.ts (no test pinned them). The suite's beforeEach now resets every
    // mock before each arm (the reset DECISION at the top-level beforeEach), and this arm still
    // re-arms the invite mock itself because its second half needs a different answer mid-arm.
    const { invitesAPI, ApiError } = await import('@/lib/api');
    const send = invitesAPI.sendFriendInvite as Mock;
    try {
      send.mockReset().mockImplementation((_group: string, friendId: string) =>
        friendId === FRIEND_UUID
          ? Promise.resolve({})
          : Promise.reject(new ApiError('This person already has a pending invite', 'invite_pending', 409))
      );
      renderPanel({ friends: [FRIENDSHIP, OTHER_FRIENDSHIP] });
      await screen.findByText('Eli');
      for (const box of screen.getAllByRole('checkbox')) fireEvent.click(box);
      await inviteSelected();
      await waitFor(() => expect(batchStatus()?.textContent).toBe('Invited 1 \u2014 1 already invited or a member'));
      expect(batchError()?.textContent).toBe('');
      cleanup();

      send.mockReset().mockRejectedValue(
        new ApiError('This person is already a member of the group', 'already_member', 409)
      );
      renderPanel();
      await screen.findByText('Dana');
      fireEvent.click(screen.getByRole('checkbox'));
      await inviteSelected();
      await waitFor(() => expect(batchStatus()?.textContent).toBe('Everyone selected was already invited or a member'));
      expect(batchError()?.textContent).toBe('');
    } finally {
      send.mockReset().mockResolvedValue({});
    }
  });

  it('H: the header row is on the Modal header phone-first scale (R7-M5), keeping items-start and gap-3', async () => {
    renderPanel();
    const column = (await screen.findByRole('heading', { name: 'Invite Members' })).closest('div');
    const tokens = column?.parentElement?.className.split(/\s+/) ?? [];
    for (const cls of ['px-3', 'py-2', 'md:px-6', 'md:py-3', 'items-start', 'gap-3']) {
      expect(tokens).toContain(cls);
    }
    expect(tokens).not.toContain('px-6');
    expect(tokens).not.toContain('py-5');
  });
});

// Phase 88.6.1 plan 27 Task 4 (owner ruling 2026-10-05, copy row X3 reused at Add Friend): the
// already-pending answer (the request route's code-less 409, which the client maps to conflict)
// keeps the sent line; every other failure shows X3 from its own alert lane and keeps the prompt.
describe('FriendInvitePanel — Add Friend tells the truth when the request fails (88.6.1-27)', () => {
  const lane = () => document.getElementById('invite-friend-request-error');
  const sentLine = () => document.getElementById('invite-friend-request-status');
  const X3 = "We couldn't send that request.";

  async function openPrompt() {
    const { friendshipsAPI: api, invitesAPI } = await import('@/lib/api');
    (api.searchUserByEmail as Mock).mockResolvedValue({
      id: FRIEND_UUID,
      username: 'Dana',
      email: 'dana@example.test',
    });
    (invitesAPI.sendInvite as Mock).mockResolvedValue({});
    const utils = renderPanel({ friends: [] });
    await screen.findByRole('heading', { name: 'Invite by Email' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Invite by Email' }), {
      target: { value: 'dana@example.test' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const add = await screen.findByRole('button', { name: 'Add Friend' });
    return { add, ...utils };
  }

  it('AF1: a network failure shows X3 from the SAME alert lane, keeps the prompt and focus on Add Friend, and claims no success', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock).mockRejectedValueOnce(new ApiError('Network down', 'network', 0));
    const user = userEvent.setup();
    const { add } = await openPrompt();

    const before = lane();
    expect(before).not.toBeNull();
    expect(before).toHaveAttribute('role', 'alert');
    expect(before).toHaveAttribute('aria-live', 'assertive');
    expect(before?.textContent).toBe('');
    expect(before).toHaveClass('sr-only');

    await user.click(add);

    await waitFor(() => expect(lane()?.textContent).toBe(X3));
    const after = lane();
    expect(after).toBe(before);
    expect(after).not.toHaveClass('sr-only');
    expect(after).toHaveClass('mt-2');
    expect(after).toHaveClass('text-content-status-error');
    expect(sentLine()?.textContent).toBe('');
    expect(screen.getByRole('dialog').textContent).not.toContain('Friend request sent!');

    const again = screen.getByRole('button', { name: 'Add Friend' });
    expect(again).toBe(add);
    expect(again).not.toHaveAttribute('aria-disabled');
    expect(again).toHaveAttribute('aria-describedby', 'invite-friend-request-error');
    expect(document.activeElement).toBe(again);
    expect(await axe(screen.getByRole('dialog'), WCAG_412)).toHaveNoViolations();
  });

  it('AF2: the already-pending answer (conflict) keeps "Friend request sent!" and leaves the lane empty', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock).mockRejectedValueOnce(
      new ApiError('HTTP error! status: 409', 'conflict', 409)
    );
    const user = userEvent.setup();
    const { add } = await openPrompt();
    const before = lane();

    await user.click(add);

    await waitFor(() => expect(sentLine()).toHaveTextContent('Friend request sent!'));
    expect(lane()).not.toBeNull();
    expect(lane()).toBe(before);
    expect(lane()?.textContent).toBe('');
    expect(lane()).toHaveClass('sr-only');
    expect(screen.queryByRole('button', { name: 'Add Friend' })).toBeNull();
  });

  it('AF3: a code-less failure is X3 too, and a repeat failure mutates the same lane again (SPEC Edge R8, backstop)', async () => {
    const { friendshipsAPI: api } = await import('@/lib/api');
    (api.sendRequest as Mock)
      .mockRejectedValueOnce(new Error('nope'))
      .mockRejectedValueOnce(new Error('nope'));
    const user = userEvent.setup();
    const { add } = await openPrompt();

    await user.click(add);
    await waitFor(() => expect(lane()?.textContent).toBe(X3));
    const node = lane()!;

    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(node, { childList: true, characterData: true, subtree: true });

    await user.click(screen.getByRole('button', { name: 'Add Friend' }));
    await waitFor(() => expect(api.sendRequest).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(records.length).toBeGreaterThan(0));
    await waitFor(() => expect(lane()?.textContent).toBe(X3));
    observer.disconnect();
    expect(lane()).toBe(node);
  });

  it('AF4: a retry that succeeds clears the lane on the same node and lands focus on the heading', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock)
      .mockRejectedValueOnce(new ApiError('Network down', 'network', 0))
      .mockResolvedValueOnce({});
    const user = userEvent.setup();
    const { add } = await openPrompt();

    await user.click(add);
    await waitFor(() => expect(lane()?.textContent).toBe(X3));
    const node = lane();

    await user.click(screen.getByRole('button', { name: 'Add Friend' }));
    await waitFor(() => expect(sentLine()).toHaveTextContent('Friend request sent!'));
    expect(lane()).toBe(node);
    expect(lane()?.textContent).toBe('');
    expect(lane()).toHaveClass('sr-only');
    await waitFor(() =>
      expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Invite by Email' }))
    );
  });

  it('AF5: closing the panel clears the lane and the prompt', async () => {
    const { friendshipsAPI: api, ApiError } = await import('@/lib/api');
    (api.sendRequest as Mock).mockRejectedValueOnce(new ApiError('Network down', 'network', 0));
    const user = userEvent.setup();
    const { add, rerender, onClose, onMemberAdded } = await openPrompt();

    await user.click(add);
    await waitFor(() => expect(lane()?.textContent).toBe(X3));

    rerender(
      <FriendInvitePanel group={GROUP} open={false} onClose={onClose} onMemberAdded={onMemberAdded} />
    );
    rerender(
      <FriendInvitePanel group={GROUP} open onClose={onClose} onMemberAdded={onMemberAdded} />
    );
    await screen.findByRole('heading', { name: 'Invite by Email' });
    expect(lane()?.textContent).toBe('');
    expect(screen.queryByRole('button', { name: 'Add Friend' })).toBeNull();
  });
});
