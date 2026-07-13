// Phase 87.3-05 (PR-B): behavioral net proving every ManageMembers group-admin
// mutation targets the member's nested `id` (UUID) — NOT the flat `user_id`
// (Auth0 sub). This is the AF6/AF10 precondition for PR-C: once the roster
// aliases `user_id` to the UUID, any mutation still passing `user_id` would
// 404. The backend already dual-key-accepts UUID targets (plan 01 / AF6), so
// cutting the FE senders to `member.id` is safe now. Covers all five:
// updateUserRole, removeUserFromGroup, approveMember, rejectMember,
// transferOwnership.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PENDING_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Self resolves to the OWNER row's UUID, so canManageMembers is true and the
// admin affordances render.
vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: OWNER_UUID,
    self: { id: OWNER_UUID, user_id: 'auth0|owner' },
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/app/components/ClickableMemberName', () => ({
  default: ({ username }: { username?: string }) => <span>{username}</span>,
}));

vi.mock('@/app/components/FriendInvitePanel', () => ({ default: () => null }));

vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/api')>();
  return {
    ...actual,
    groupsAPI: {
      getGroupMembers: vi.fn(),
      updateUserRole: vi.fn(),
      removeUserFromGroup: vi.fn(),
      approveMember: vi.fn(),
      rejectMember: vi.fn(),
      transferOwnership: vi.fn(),
      resetInviteToken: vi.fn(),
      leaveGroup: vi.fn(),
    },
    invitesAPI: { getGroupPendingInvites: vi.fn() },
  };
});

import ManageMembers from './ManageMembers';
import { groupsAPI, invitesAPI } from '@/lib/api';

type Mock = ReturnType<typeof vi.fn>;

const GROUP_ID = 'grp-1';

const ROSTER = [
  { id: OWNER_UUID, user_id: 'auth0|owner', username: 'Owner', UserGroup: { role: 'owner' } },
  { id: TARGET_UUID, user_id: 'auth0|target', username: 'Target', UserGroup: { role: 'member' } },
  { id: PENDING_UUID, user_id: 'auth0|pending', username: 'Pend', UserGroup: { role: 'pending' } },
];

function renderManageMembers() {
  return render(
    <ManageMembers
      group_id={GROUP_ID}
      user={{ sub: 'auth0|owner' }}
      modal={true}
      modaltoggle={vi.fn()}
      onMembersUpdated={vi.fn()}
      group_name="G"
    />
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValue([]);
  (groupsAPI.updateUserRole as Mock).mockResolvedValue({});
  (groupsAPI.removeUserFromGroup as Mock).mockResolvedValue({});
  (groupsAPI.approveMember as Mock).mockResolvedValue({});
  (groupsAPI.rejectMember as Mock).mockResolvedValue({});
  (groupsAPI.transferOwnership as Mock).mockResolvedValue({});
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('ManageMembers group-admin mutations target member.id (UUID), not user_id (sub)', () => {
  it('approveMember is invoked with the member UUID', async () => {
    renderManageMembers();
    const approve = await screen.findByText('Approve');
    fireEvent.click(approve);
    await waitFor(() =>
      expect(groupsAPI.approveMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
  });

  it('rejectMember is invoked with the member UUID', async () => {
    renderManageMembers();
    const reject = await screen.findByText('Reject');
    fireEvent.click(reject);
    await waitFor(() =>
      expect(groupsAPI.rejectMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
  });

  it('updateUserRole is invoked with the member UUID', async () => {
    renderManageMembers();
    // The one role <select> belongs to the non-owner, non-self active member.
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });
    await waitFor(() =>
      expect(groupsAPI.updateUserRole as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID, 'admin')
    );
  });

  it('removeUserFromGroup is invoked with the member UUID', async () => {
    renderManageMembers();
    const remove = await screen.findByText('Remove');
    fireEvent.click(remove);
    await waitFor(() =>
      expect(groupsAPI.removeUserFromGroup as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID)
    );
  });

  it('transferOwnership is invoked with the member UUID', async () => {
    renderManageMembers();
    // Open the owner-only desktop transfer kebab for the target member.
    const kebab = await screen.findByLabelText('More actions for Target');
    fireEvent.click(kebab);
    fireEvent.click(await screen.findByText('Transfer ownership to this member'));
    // Confirm modal — click the final "Transfer ownership" action.
    const confirmBtn = await screen.findByText('Transfer ownership');
    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID)
    );
  });
});
