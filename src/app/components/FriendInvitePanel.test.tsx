// Phase 88 plan 06 Task 3 — RENDER HARNESS for FriendInvitePanel.
//
// WHY THIS FILE EXISTS (read before extending):
// SPEC Req 9 audits the modal fleet by grepping for `.modal-overlay`.
// FriendInvitePanel is INVISIBLE to that grep: verified this session at
// `FriendInvitePanel.js:491`, its backdrop is a hand-rolled
// `fixed inset-0 bg-black/50 z-60` div (the source comment explains the z-60
// stacks it above `.modal-overlay`'s z-50 when opened from inside
// ManageMembers), and the panel at `:501` is a hand-rolled slide-in with a
// plain `<h2>Invite Members</h2>` at `:505`. No `.modal-overlay`, no dialog
// role, no focus trap, no Esc handler. The class census structurally cannot see
// it, so Req 9's acceptance demands an EXPLICIT check — this file is it.
//
// `.tsx` is mandatory: vitest.config.mts only includes `.ts`/`.tsx`, and the
// config's `jsx-in-js` pre-transform handles the `.js` component under test.
//
// ---------------------------------------------------------------------------
// EXTENSION POINT — plan 88-15
// ---------------------------------------------------------------------------
// Plan 88-15 replaces the hand-rolled backdrop + panel with the shared <Modal>
// primitive. At that point it fills in the three `it.todo` entries at the bottom
// of this file and DELETES the inverse pin in
// `describe('current: hand-rolled, not a dialog')` — that pin exists precisely
// so 88-15 cannot land the swap without visiting this file.
import * as React from 'react';
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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
}

/** Render the invite panel open, with a group and a resolved identity. */
export function renderPanel(options: RenderPanelOptions = {}) {
  const {
    friends = [FRIENDSHIP],
    members = [],
    isAdmin = false,
    open = true,
    group = GROUP,
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

describe('FriendInvitePanel current: hand-rolled, not a dialog', () => {
  // THE Req 9 CHECK. The `.modal-overlay` census cannot see this component, so
  // its non-dialog status is asserted directly. Plan 88-15 flips this file to
  // the it.todo pins below and DELETES this block — it is the tripwire that
  // makes the swap impossible to land silently.
  it('exposes no dialog to assistive technology today', async () => {
    renderPanel();
    await screen.findByRole('heading', { name: 'Invite Members' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes only through its explicit Done / dismiss affordances today', async () => {
    const { onClose } = renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Done' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe('FriendInvitePanel — pins plan 88-15 turns on', () => {
  it.todo('exposes role=dialog once the panel is composed on <Modal> (Req 9 dialog-role check)');
  it.todo('closes on Escape once <Modal> owns dismissal (Req 9 Esc check)');
  it.todo('keeps its create-path copy intact through the <Modal> swap (Req 9 create-copy check)');
});
