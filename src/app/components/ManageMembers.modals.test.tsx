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
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
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
    await waitFor(() => expect(parent).toHaveAttribute('aria-hidden', 'true'));
  });
});
