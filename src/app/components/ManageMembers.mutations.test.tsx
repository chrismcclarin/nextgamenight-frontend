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
  // Req 11 RUNTIME tripwire (88-12). This used to auto-approve the two native
  // browser confirms this file gated on; every gate is now a `useConfirmAction`
  // dialog, so reaching the native one at all is the regression. Throwing here
  // catches it through any indirection the plan's plain grep gate cannot see.
  vi.spyOn(window, 'confirm').mockImplementation(() => {
    throw new Error('native browser confirm reached — Req 11 forbids it on this surface');
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/**
 * Phase 88-12 (Req 11): the four gates below are `useConfirmAction` dialogs, so
 * every mutation pin now has to travel THROUGH the dialog. `getByRole` is
 * deliberate throughout — while a confirm dialog is open Radix aria-hides the
 * members modal behind it, so a role query resolves the DIALOG's button and can
 * never accidentally re-click the row control that opened it (a `getByText`
 * would match both).
 */
async function openMembersModal() {
  renderManageMembers();
  await screen.findByRole('dialog', { name: 'Manage Group Members' });
}

/** The confirm control of whichever gate dialog is currently open. */
function confirmButton(name: string) {
  return screen.getByRole('button', { name });
}

describe('ManageMembers group-admin mutations target member.id (UUID), not user_id (sub)', () => {
  it('approveMember is invoked with the member UUID', async () => {
    renderManageMembers();
    const approve = await screen.findByText('Approve');
    fireEvent.click(approve);
    await waitFor(() =>
      expect(groupsAPI.approveMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
  });

  it('rejectMember is invoked with the member UUID once the gate is confirmed', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reject'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(groupsAPI.rejectMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
  });

  it('updateUserRole is invoked with the member UUID once the escalation gate is confirmed', async () => {
    await openMembersModal();
    // The one role <select> belongs to the non-owner, non-self active member.
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Make admin' }));
    await waitFor(() =>
      expect(groupsAPI.updateUserRole as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID, 'admin')
    );
  });

  it('removeUserFromGroup is invoked with the member UUID once the gate is confirmed', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
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
    const confirmBtn = await screen.findByRole('button', { name: 'Transfer ownership' });
    fireEvent.click(confirmBtn);
    await waitFor(() =>
      expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID)
    );
  });
});

describe('ManageMembers Req 11 gates — blocking semantics (no API call until confirmed)', () => {
  it('remove member: opens a dialog with the SPEC copy and calls nothing yet', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));

    expect(
      await screen.findByRole('dialog', { name: 'Remove Target from this group?' })
    ).toBeInTheDocument();
    expect(
      screen.getByText("They'll lose access to events and planning. You can re-invite them.")
    ).toBeInTheDocument();
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();
  });

  it('remove member: cancel aborts', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Remove Target/ })).not.toBeInTheDocument()
    );
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();
  });

  it('reject pending member: dialog copy matches UI-SPEC 11.2 as corrected by FND-88-12-02', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reject'));

    expect(await screen.findByRole('dialog', { name: 'Reject Pend?' })).toBeInTheDocument();
    // The ratified second sentence ("will need a new invite to rejoin") is FALSE
    // against the backend reject handler and was cut — see the DECISION marker in
    // ManageMembers.js. This pin is what stops it being "restored".
    expect(
      screen.getByText("They'll be removed from the pending list.")
    ).toBeInTheDocument();
    expect(screen.queryByText(/new invite to rejoin/i)).not.toBeInTheDocument();
    expect(groupsAPI.rejectMember as Mock).not.toHaveBeenCalled();
  });

  it('reject pending member: cancel aborts', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reject'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: /Reject Pend/ })).not.toBeInTheDocument()
    );
    expect(groupsAPI.rejectMember as Mock).not.toHaveBeenCalled();
  });

  it('reset invite link: dialog copy matches UI-SPEC 11.2 and calls nothing yet', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reset QR link'));

    expect(
      await screen.findByRole('dialog', { name: 'Reset the invite link?' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Every copy of the old link stops working — including printed QR codes.')
    ).toBeInTheDocument();
    expect(groupsAPI.resetInviteToken as Mock).not.toHaveBeenCalled();
  });

  it('reset invite link: confirming commits, cancelling aborts', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reset QR link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reset the invite link?' })).not.toBeInTheDocument()
    );
    expect(groupsAPI.resetInviteToken as Mock).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText('Reset QR link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset link' }));
    await waitFor(() =>
      expect(groupsAPI.resetInviteToken as Mock).toHaveBeenCalledWith(GROUP_ID)
    );
  });
});

describe('ManageMembers AR R2-M10 — only ESCALATION to admin is gated', () => {
  it('promote: the dialog carries the ratified copy and updateUserRole is not called yet', async () => {
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });

    expect(
      await screen.findByRole('dialog', { name: 'Make Target an admin?' })
    ).toBeInTheDocument();
    expect(
      screen.getByText('Admins can edit events, manage members, and approve or remove people.')
    ).toBeInTheDocument();
    expect(confirmButton('Make admin')).toBeInTheDocument();
    expect(groupsAPI.updateUserRole as Mock).not.toHaveBeenCalled();
  });

  it('promote: Cancel aborts AND reverts the select to the prior value', async () => {
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    expect(select.value).toBe('member');

    fireEvent.change(select, { target: { value: 'admin' } });
    await screen.findByRole('dialog', { name: 'Make Target an admin?' });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Make Target an admin?' })).not.toBeInTheDocument()
    );
    expect(groupsAPI.updateUserRole as Mock).not.toHaveBeenCalled();
    // The AR-named trap: a naive gate leaves the select showing "Admin" while the
    // backend still says "member".
    const after = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    expect(after.value).toBe('member');
  });

  it('demotion stays UNGATED — an admin->member change calls the API directly', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
      ROSTER[0],
      { ...ROSTER[1], UserGroup: { role: 'admin' } },
      ROSTER[2],
    ]);
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    expect(select.value).toBe('admin');

    fireEvent.change(select, { target: { value: 'member' } });
    await waitFor(() =>
      expect(groupsAPI.updateUserRole as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID, 'member')
    );
    expect(screen.queryByRole('dialog', { name: /an admin\?/ })).not.toBeInTheDocument();
  });
});

describe('ManageMembers AR-DEC-3 — the mobile kebab two-tap COMMIT path', () => {
  // No pin covered this before 88-12, so a wiring regression on the phone
  // surface (the primary surface) would have shipped green. The kebab keeps
  // KebabMenu's INTERNAL two-tap rather than routing through useConfirmAction —
  // see the AR-DEC-3 marker in ManageMembers.js for why.
  it('a second tap on Remove within 3s calls removeUserFromGroup with the member UUID', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByLabelText('Member actions'));

    const menu = await screen.findByRole('menu');
    const removeItem = within(menu).getByRole('menuitem', { name: 'Remove' });
    fireEvent.click(removeItem);

    // Armed: the SAME node swaps its label rather than the menu closing.
    expect(
      within(await screen.findByRole('menu')).getByRole('menuitem', {
        name: 'Tap again to remove',
      })
    ).toBe(removeItem);
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();

    fireEvent.click(removeItem);
    await waitFor(() =>
      expect(groupsAPI.removeUserFromGroup as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID)
    );
    // No dialog is involved on this path — the two-tap IS the gate.
    expect(screen.queryByRole('dialog', { name: /Remove Target/ })).not.toBeInTheDocument();
  });

  it('a single tap alone never commits', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByLabelText('Member actions'));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Remove' }));
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();
  });

  it('"Make admin" from the kebab routes to the SAME escalation gate as the desktop select', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByLabelText('Member actions'));
    const menu = await screen.findByRole('menu');
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Make admin' }));

    expect(
      await screen.findByRole('dialog', { name: 'Make Target an admin?' })
    ).toBeInTheDocument();
    expect(groupsAPI.updateUserRole as Mock).not.toHaveBeenCalled();
  });
});
