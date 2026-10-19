// Phase 87.3-05 (PR-B): behavioral net proving every ManageMembers group-admin
// mutation targets the member's nested `id` (UUID) — NOT the flat `user_id`
// (Auth0 sub). This is the AF6/AF10 precondition for PR-C: once the roster
// aliases `user_id` to the UUID, any mutation still passing `user_id` would
// 404. The backend already dual-key-accepts UUID targets (plan 01 / AF6), so
// cutting the FE senders to `member.id` is safe now. Covers all five:
// updateUserRole, removeUserFromGroup, approveMember, rejectMember,
// transferOwnership.
import * as React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const OWNER_UUID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TARGET_UUID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const PENDING_UUID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Self resolves to the OWNER row's UUID by default, so canManageMembers is true
// and the admin affordances render.
//
// Phase 88.6-19: hoisted to a MUTABLE holder (the `h` idiom already used in
// `ManageMembers.modals.test.tsx`, its `const h = vi.hoisted(`) so a test can switch WHICH member the
// caller is before rendering. The leave-confirm flow this file now pins only
// exists on a non-owner's OWN row, and it is unreachable with a hardcoded owner.
// Every pre-existing test is byte-equivalent: `beforeEach` restores OWNER_UUID.
// Phase 88.6.1-42: `invitePanelProps` records the props the mocked FriendInvitePanel was last
// rendered with, so a test can call its `onMemberAdded` (the un-awaited fifth refresh).
const h = vi.hoisted(() => ({
  selfUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string | undefined,
  invitePanelProps: null as null | { onMemberAdded?: () => void },
}));

vi.mock('@/lib/hooks/useSelfIdentity', () => ({
  SELF_IDENTITY_KEY: ['users', 'self'],
  useSelfIdentity: () => ({
    selfUuid: h.selfUuid,
    self: h.selfUuid ? { id: h.selfUuid, user_id: 'auth0|self' } : undefined,
    query: { isError: false, error: null, refetch: vi.fn() },
    isPending: false,
  }),
}));

// AC-2 channel. `errCtx` is kept REAL (importOriginal) so the ctx assertions below
// exercise the shipped name-and-message shape rather than a fixture of it — the
// thing being pinned is that the raw `Error` never reaches `logger.info`'s second
// parameter, and a mocked helper could not show that.
vi.mock('@/lib/logger', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/logger')>();
  return {
    ...actual,
    logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

vi.mock('@/app/components/ClickableMemberName', () => ({
  default: ({ username }: { username?: string }) => <span>{username}</span>,
}));

vi.mock('@/app/components/FriendInvitePanel', () => ({
  default: (props: { onMemberAdded?: () => void }) => {
    h.invitePanelProps = props;
    return null;
  },
}));

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

import { toast } from 'sonner';

import ManageMembers from './ManageMembers';
// `ApiError` survives the partial mock above (the `importOriginal` spread), so the 403 arm
// exercises the REAL code-to-copy derivation in `useFetchErrorState` rather than a fixture.
import { ApiError, groupsAPI, invitesAPI } from '@/lib/api';
import { logger } from '@/lib/logger';
import { pressInStackedDialog } from '../../test-utils/stackedDialogPress';
// Plan 88.6.1-78 (C8 e): every expected register line is read through the shipped helper on the
// SAME error object, never typed.
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

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
  h.selfUuid = OWNER_UUID;
  h.invitePanelProps = null;
  (groupsAPI.getGroupMembers as Mock).mockResolvedValue(ROSTER);
  (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValue([]);
  (groupsAPI.updateUserRole as Mock).mockResolvedValue({});
  (groupsAPI.removeUserFromGroup as Mock).mockResolvedValue({});
  (groupsAPI.approveMember as Mock).mockResolvedValue({});
  (groupsAPI.rejectMember as Mock).mockResolvedValue({});
  (groupsAPI.transferOwnership as Mock).mockResolvedValue({});
  // [Rule 3 - Blocking, Phase 88.6-19] These two were the only mocked endpoints with no
  // default here, which was invisible while nothing rejected them. `vi.clearAllMocks()`
  // clears CALLS, not IMPLEMENTATIONS, and `vi.restoreAllMocks()` only reaches `vi.spyOn`
  // spies — so the first test to `mockRejectedValue` one of these leaked the rejection into
  // every later test in file order. Defaulting them here is what makes the failure arms below
  // order-independent.
  (groupsAPI.resetInviteToken as Mock).mockResolvedValue({});
  (groupsAPI.leaveGroup as Mock).mockResolvedValue({});
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

/**
 * Open a KebabMenu by its trigger's accessible label and return its OPEN item list.
 *
 * Plan 88.6-16 (D-12) dropped the ARIA menu pattern from `KebabMenu`: the items are
 * now plain `<button>`s in a `<ul role="list">`, and the trigger names that list
 * through `aria-controls` ONLY while it is open. Scoping the item queries through
 * that attribute keeps them inside the open list exactly as the old role scoping did,
 * and it additionally proves the relationship is live. No assertion below was dropped
 * or weakened in the re-target — only the selector moved.
 */
async function openKebabList(triggerLabel: string): Promise<HTMLElement> {
  const trigger = await screen.findByLabelText(triggerLabel);
  fireEvent.click(trigger);
  let list: HTMLElement | null = null;
  await waitFor(() => {
    const id = trigger.getAttribute('aria-controls');
    expect(id, `${triggerLabel}: no aria-controls while the menu is open`).toBeTruthy();
    list = document.getElementById(id as string);
    expect(list, `${triggerLabel}: aria-controls names no element in the document`).not.toBeNull();
  });
  return list as unknown as HTMLElement;
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
    fireEvent.click(await screen.findByText('Reset invite link'));

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
    fireEvent.click(await screen.findByText('Reset invite link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Reset the invite link?' })).not.toBeInTheDocument()
    );
    expect(groupsAPI.resetInviteToken as Mock).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByText('Reset invite link'));
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

  // 88.6.1 code review CR-5 / A-75 (owner ratified 2026-10-19): while the grant is in flight
  // the pressed confirm reads "Promoting…" (ConfirmDialog's pendingLabel) and stays focusable.
  it('promote: the pending confirm reads the ratified pending label until the grant settles (CR-5)', async () => {
    let settle!: () => void;
    (groupsAPI.updateUserRole as Mock).mockImplementationOnce(
      () => new Promise<void>((resolve) => { settle = resolve; })
    );
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });
    const dialog = await screen.findByRole('dialog', { name: 'Make Target an admin?' });

    fireEvent.click(within(dialog).getByRole('button', { name: 'Make admin' }));
    const pendingConfirm = await within(dialog).findByRole('button', { name: 'Promoting\u2026' });
    expect(pendingConfirm).toHaveAttribute('aria-disabled', 'true');
    expect(within(dialog).queryByRole('button', { name: 'Make admin' })).not.toBeInTheDocument();

    settle();
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Make Target an admin?' })).not.toBeInTheDocument()
    );
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

describe('ManageMembers Req 12 — success receipts for the two named silent mutations', () => {
  it('member removal produces "Member removed" on BOTH entry points', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member removed'));

    // The mobile kebab shares the same commit path, so it gets the same receipt.
    (toast.success as Mock).mockClear();
    const menu = await openKebabList('Member actions for Target');
    const removeItem = within(menu).getByRole('button', { name: 'Remove' });
    fireEvent.click(removeItem);
    fireEvent.click(removeItem);
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member removed'));
  });

  it('a role change produces "Role updated" on the escalation AND the demotion path', async () => {
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Make admin' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Role updated'));

    cleanup();
    (toast.success as Mock).mockClear();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([
      ROSTER[0],
      { ...ROSTER[1], UserGroup: { role: 'admin' } },
      ROSTER[2],
    ]);
    await openMembersModal();
    const demote = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(demote, { target: { value: 'member' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Role updated'));
  });

  it('no receipt on this surface uses "successfully" or an exclamation mark', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());

    for (const [message] of (toast.success as Mock).mock.calls) {
      expect(String(message)).not.toMatch(/successfully/i);
      expect(String(message)).not.toContain('!');
      expect(String(message).split(/\s+/).length).toBeLessThanOrEqual(4);
    }
  });
});

/* Phase 88.6-19 task 1 (R1 / DEF-88-25-01). Everything below is NEW.
 *
 * WHAT THESE ARMS ARE FOR, so nobody "consolidates" them with the Req 11 gate pins above:
 * those prove the gates BLOCK until confirmed. These prove what happens when a confirmed
 * mutation FAILS — the arm the surface had no coverage of at all, which is why seven raw
 * upstream strings could reach users here for as long as they did. Each one was run against
 * the pre-fix component and failed; the red is recorded in `88.6-19-SUMMARY.md`. */
describe('ManageMembers R1 — a failed mutation shows ratified copy, never the upstream string', () => {
  /** A backend failure whose message is exactly what must NOT reach a person. */
  const upstream = () => new Error('HTTP error! status: 500 — pg: duplicate key user_groups_pkey');

  /** The ratified `unknown` copy (`useFetchErrorState.ts` MESSAGE_BY_CODE.unknown). */
  const RATIFIED_UNKNOWN = 'Something went wrong. Refresh the page to try again.';

  it('a failed remove toasts the ratified string and leaks no upstream text', async () => {
    (groupsAPI.removeUserFromGroup as Mock).mockRejectedValue(upstream());
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    const [message] = (toast.error as Mock).mock.calls[0];
    expect(message).toBe(RATIFIED_UNKNOWN);
    expect(String(message)).not.toMatch(/pg:|duplicate key|HTTP error/);
  });

  it('a failed remove leaves its confirm dialog OPEN — the catch still returns false', async () => {
    (groupsAPI.removeUserFromGroup as Mock).mockRejectedValue(upstream());
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    // POSITIVE settle signal first — the failure has to have LANDED before an
    // is-still-open claim means anything. `waitFor(expect(...).toBeInTheDocument())`
    // on the dialog alone is satisfied on the first tick, before the reject resolves.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(
      screen.getByRole('dialog', { name: 'Remove Target from this group?' })
    ).toBeInTheDocument();
  });

  it('a failed reset-invite leaves its confirm dialog OPEN', async () => {
    (groupsAPI.resetInviteToken as Mock).mockRejectedValue(upstream());
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reset invite link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset link' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(
      screen.getByRole('dialog', { name: 'Reset the invite link?' })
    ).toBeInTheDocument();
    expect((toast.error as Mock).mock.calls[0][0]).toBe(RATIFIED_UNKNOWN);
  });

  it('a failed role escalation leaves its confirm dialog OPEN', async () => {
    (groupsAPI.updateUserRole as Mock).mockRejectedValue(upstream());
    await openMembersModal();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    fireEvent.change(select, { target: { value: 'admin' } });
    fireEvent.click(await screen.findByRole('button', { name: 'Make admin' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(screen.getByRole('dialog', { name: 'Make Target an admin?' })).toBeInTheDocument();
  });

  it('a failed transfer-ownership toasts ratified copy', async () => {
    (groupsAPI.transferOwnership as Mock).mockRejectedValue(upstream());
    renderManageMembers();
    fireEvent.click(await screen.findByLabelText('More actions for Target'));
    fireEvent.click(await screen.findByText('Transfer ownership to this member'));
    fireEvent.click(await screen.findByRole('button', { name: 'Transfer ownership' }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(RATIFIED_UNKNOWN));
  });

  it('a 403 gets the ratified PERMISSION copy — no new string was authored for it', async () => {
    // D-31's explicit instruction: the kebab 403 needs NO new string, because
    // MESSAGE_BY_CODE.forbidden already carries the ratified permission line.
    // `ApiError(message, code, status)` — re-read at `api.ts`'s `export class ApiError`, not assumed.
    const forbidden = new ApiError('whatever the backend said', 'forbidden', 403);
    (groupsAPI.removeUserFromGroup as Mock).mockRejectedValue(forbidden);
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith(
        "You don't have access to this. Refresh the page to try again."
      )
    );
  });

  it('a failed member LOAD renders the shared banner, not a hand-rolled red line', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValue(upstream());
    renderManageMembers();

    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.queryByText(/Failed to load members/)).not.toBeInTheDocument();
  });
});

describe('ManageMembers R1 third arm — the leave failure is RENDERED and ANNOUNCED in the open modal', () => {
  /** The Leave Group control only renders on a NON-owner's own row. */
  async function openLeaveConfirm() {
    h.selfUuid = TARGET_UUID;
    renderManageMembers();
    await screen.findByRole('dialog', { name: 'Members' });
    fireEvent.click(await screen.findByText('Leave Group'));
    return screen.findByRole('dialog', { name: /Leave G\?/ });
  }

  /** The polite live region the Confirm control names. */
  function liveRegion(dialog: HTMLElement): HTMLElement {
    const id = screen
      .getByRole('button', { name: 'Confirm Leave' })
      .getAttribute('aria-describedby');
    expect(id, 'Confirm Leave carries no aria-describedby').toBeTruthy();
    const node = dialog.querySelector(`#${CSS.escape(id as string)}`);
    expect(node, 'aria-describedby names no element inside the leave dialog').not.toBeNull();
    return node as HTMLElement;
  }

  it('the region is MOUNTED AND EMPTY before any failure — the empty-first contract', async () => {
    const dialog = await openLeaveConfirm();
    const region = liveRegion(dialog);
    // For THIS polite region, a conditionally-mounted region announces nothing, so its
    // presence BEFORE the failure is the whole mechanism. That is not a rule for alerts: an
    // inserted role="alert" that arrives with its text IS announced (ARIA 1.2; D-42, AT-4).
    // Both halves are asserted: it exists, and the ARIA contract on it is the polite one.
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('');
    // D-22 (88.6.1-50): the house empty shape, hidden only while it has nothing to say.
    expect(region).toHaveClass('sr-only');
  });

  it('the SAME region carries the ratified message after a failed leave', async () => {
    (groupsAPI.leaveGroup as Mock).mockRejectedValue(new Error('HTTP error! status: 500'));
    const dialog = await openLeaveConfirm();
    const before = liveRegion(dialog);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Leave' }));

    await waitFor(() =>
      expect(before).toHaveTextContent('Something went wrong. Refresh the page to try again.')
    );
    // Visible the moment it holds text, with the 16px gap (D-22; CONFIRM-ONLY: the old
    // conditional margin did this too when set).
    expect(before).not.toHaveClass('sr-only');
    expect(before).toHaveClass('mt-4');
    // The node did not remount — announcement depends on a CHANGE inside a region
    // that was already there, not on a new region appearing.
    expect(liveRegion(dialog)).toBe(before);
    // ...and the dialog is still open, which is why a toast would have been wrong here.
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText(/You will lose access to events/)).toBeInTheDocument();
  });

  it('the failed leave never paints the upstream string', async () => {
    (groupsAPI.leaveGroup as Mock).mockRejectedValue(
      new Error('HTTP error! status: 500 — pg: relation "user_groups" violates')
    );
    const dialog = await openLeaveConfirm();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm Leave' }));
    await waitFor(() => expect(liveRegion(dialog)).not.toHaveTextContent(''));
    expect(dialog).not.toHaveTextContent(/pg:|relation "user_groups"/);
  });

  const RATIFIED_UNKNOWN_LEAVE = 'Something went wrong. Refresh the page to try again.';

  it('LV1: two presses send one leave; the pressed Confirm Leave stays aria-disabled and focusable until it settles, then is released (W016 rows 14-15)', async () => {
    const held = deferred<unknown>();
    (groupsAPI.leaveGroup as Mock).mockReturnValueOnce(held.promise);
    const dialog = await openLeaveConfirm();
    const region = liveRegion(dialog);
    const confirm = screen.getByRole('button', { name: 'Confirm Leave' });

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // RED halves are the attributes and the request count (C-11); focus is CONFIRM-ONLY in jsdom.
    expect(confirm).toHaveTextContent('Leaving…');
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).not.toHaveAttribute('disabled');
    expect(confirm).toHaveClass('btn-danger');
    expect(confirm.getAttribute('aria-describedby')).toBe(region.id);
    // The sibling Cancel nobody pressed keeps its native gate (rule of POSITION).
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeDisabled();
    expect(cancel).not.toHaveAttribute('aria-disabled');
    expect(groupsAPI.leaveGroup as Mock).toHaveBeenCalledTimes(1);

    await act(async () => {
      held.reject(new Error('HTTP error! status: 500'));
    });
    // Positive signal first (CF-26): the failure line landed in the region.
    await waitFor(() => expect(region).toHaveTextContent(RATIFIED_UNKNOWN_LEAVE));
    expect(confirm).not.toHaveAttribute('aria-disabled');
    expect(cancel).not.toBeDisabled();

    fireEvent.click(confirm);
    await waitFor(() => expect(groupsAPI.leaveGroup as Mock).toHaveBeenCalledTimes(2));
  });

  it('LV2: two failed leaves are announced twice: the SAME region empties (sr-only) during the second request, then carries the line again (R8 idempotency backstop + adjacency)', async () => {
    const second = deferred<unknown>();
    (groupsAPI.leaveGroup as Mock)
      .mockRejectedValueOnce(new Error('HTTP error! status: 500'))
      .mockReturnValueOnce(second.promise);
    const dialog = await openLeaveConfirm();
    const region = liveRegion(dialog);
    const confirm = screen.getByRole('button', { name: 'Confirm Leave' });

    // Adjacency: exactly ONE live region in the leave dialog, polite, with no region inside it.
    const statuses = within(dialog).getAllByRole('status');
    expect(statuses).toHaveLength(1);
    expect(statuses[0]).toBe(region);
    expect(dialog.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(region.querySelector('[aria-live]')).toBeNull();

    fireEvent.click(confirm);
    await waitFor(() => expect(region).toHaveTextContent(RATIFIED_UNKNOWN_LEAVE));
    expect(region).not.toHaveClass('sr-only');

    fireEvent.click(confirm);
    // During the second request the handler has cleared the message: same node, empty, hidden.
    await waitFor(() => expect(groupsAPI.leaveGroup as Mock).toHaveBeenCalledTimes(2));
    // Mid-flight the confirm reads "Leaving…", so the region is read by its captured id here.
    expect(dialog.querySelector(`#${CSS.escape(region.id)}`)).toBe(region);
    expect(region.textContent).toBe('');
    expect(region).toHaveClass('sr-only');

    await act(async () => {
      second.reject(new Error('HTTP error! status: 500'));
    });
    await waitFor(() => expect(region).toHaveTextContent(RATIFIED_UNKNOWN_LEAVE));
    expect(liveRegion(dialog)).toBe(region);
    expect(region).not.toHaveClass('sr-only');
  });
});

describe('ManageMembers W11 receipt + AC-2 channel', () => {
  it('a successful invite-link reset fires the ratified "Invite link reset" receipt', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reset invite link'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset link' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invite link reset'));
  });

  it('a failed remove still reaches a LOG CHANNEL — the user-facing message is not one', async () => {
    (groupsAPI.removeUserFromGroup as Mock).mockRejectedValue(new Error('boom'));
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));

    await waitFor(() => expect(logger.info).toHaveBeenCalled());
    const [message, ctx] = (logger.info as Mock).mock.calls.at(-1) as [string, unknown];
    // The console message string is kept VERBATIM as the first argument...
    expect(message).toBe('Error removing member:');
    // ...and the caught error's NAME AND MESSAGE travel in the ctx OBJECT. The raw
    // `Error` is never the second argument: `logger.info(msg, ctx)`'s ctx is
    // `Record<string, unknown>`, and `checkJs: false` hides that mistake in a .js file.
    expect(ctx).toEqual({ name: 'Error', message: 'boom' });
    expect(ctx).not.toBeInstanceOf(Error);
  });

  it('no converted call is escalated — this file files no Sentry EVENT of its own', async () => {
    // The owner amended AC-2 to `info` on 2026-09-13 precisely so these conversions
    // stay breadcrumbs. `logger.error` and `logger.warn` are both events and are the
    // two rejected arms; a future "promotion" here is a decision, not a cleanup.
    (groupsAPI.approveMember as Mock).mockRejectedValue(new Error('boom'));
    renderManageMembers();
    fireEvent.click(await screen.findByText('Approve'));
    await waitFor(() => expect(logger.info).toHaveBeenCalled());
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('the non-array members payload reports a SHAPE DESCRIPTOR, never the payload (T-84-01)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue({
      members: [{ id: 'x', email: 'secret@example.test' }],
    });
    renderManageMembers();
    await waitFor(() => expect(logger.info).toHaveBeenCalled());
    const call = (logger.info as Mock).mock.calls.find(
      ([m]) => m === 'Members data is not an array:'
    );
    expect(call, 'the non-array branch filed no report').toBeTruthy();
    expect(call?.[1]).toEqual({ received: 'object' });
    expect(JSON.stringify(call?.[1])).not.toContain('secret@example.test');
  });
});

describe('ManageMembers D-12/D-40 — the mobile kebab names its own row', () => {
  const SECOND_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
  /** Two non-owner, non-self ACTIVE members — one row is not enough to show ambiguity. */
  const TWO_MEMBERS = [
    { id: OWNER_UUID, user_id: 'auth0|owner', username: 'Owner', UserGroup: { role: 'owner' } },
    { id: TARGET_UUID, user_id: 'auth0|target', username: 'Target', UserGroup: { role: 'member' } },
    { id: SECOND_UUID, user_id: 'auth0|second', username: 'Robin', UserGroup: { role: 'member' } },
  ];

  it('two rows produce two DISTINCT mobile kebab names, each carrying its member', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(TWO_MEMBERS);
    await openMembersModal();
    await screen.findByText('Robin');

    // Scoped to the `md:hidden` containers: jsdom loads NO CSS, so both breakpoint
    // trees are in the DOM and an unscoped query would also see the desktop twins.
    const mobileKebabs = Array.from(
      document.querySelectorAll('div.md\\:hidden button[aria-label]')
    ).map((el) => el.getAttribute('aria-label'));

    expect(mobileKebabs).toEqual([
      'Member actions for Target',
      'Member actions for Robin',
    ]);
    // The defect this closes: N identically-named buttons in one list.
    expect(new Set(mobileKebabs).size).toBe(mobileKebabs.length);
  });

  it('the mobile name is LEXICALLY DISTINCT from the desktop twin in the SAME row', async () => {
    // For an OWNER both kebabs render in one row, so "name the member" is not enough
    // on its own — copying the desktop wording verbatim would trade one defect for
    // another. Exact-match queries are what prove the two strings cannot collide.
    await openMembersModal();
    const desktop = await screen.findByLabelText('More actions for Target');
    const mobile = await screen.findByLabelText('Member actions for Target');
    expect(desktop).not.toBe(mobile);
    expect(desktop.getAttribute('aria-label')).not.toBe(mobile.getAttribute('aria-label'));
    // The desktop string is byte-unchanged — two live queries elsewhere key on it.
    expect(desktop).toHaveAttribute('aria-label', 'More actions for Target');
  });
});

describe('ManageMembers AR-DEC-3 — the mobile kebab two-tap COMMIT path', () => {
  // No pin covered this before 88-12, so a wiring regression on the phone
  // surface (the primary surface) would have shipped green. The kebab keeps
  // KebabMenu's INTERNAL two-tap rather than routing through useConfirmAction —
  // see the AR-DEC-3 marker in ManageMembers.js for why.
  it('a second tap on Remove within 3s calls removeUserFromGroup with the member UUID', async () => {
    await openMembersModal();

    const menu = await openKebabList('Member actions for Target');
    const removeItem = within(menu).getByRole('button', { name: 'Remove' });
    fireEvent.click(removeItem);

    // Armed: the SAME node swaps its label rather than the menu closing. Re-query
    // through the same open list node — it is the element `aria-controls` names, and
    // it survives the re-render, which is what makes the node-identity claim below
    // mean "the item did not remount" (plan 88.6-16 keys the item map on POSITION
    // precisely so a label swap cannot remount it).
    expect(
      within(menu).getByRole('button', {
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
    const menu = await openKebabList('Member actions for Target');
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove' }));
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();
  });

  it('"Make admin" from the kebab routes to the SAME escalation gate as the desktop select', async () => {
    await openMembersModal();
    const menu = await openKebabList('Member actions for Target');
    fireEvent.click(within(menu).getByRole('button', { name: 'Make admin' }));

    expect(
      await screen.findByRole('dialog', { name: 'Make Target an admin?' })
    ).toBeInTheDocument();
    expect(groupsAPI.updateUserRole as Mock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-42 shared helpers (file scope; plan 88.6.1-78's RF-9 / RF-10 reuse them).
// ---------------------------------------------------------------------------

/** A promise the test settles by hand: queue it as one API answer to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

type ManageMembersProps = React.ComponentProps<typeof ManageMembers>;

/**
 * Render with `renderManageMembers`'s props merged with `overrides`; `rerender(next)` re-renders
 * the SAME element with those base props merged with `next` (`{ modal: false }`,
 * `{ group_id: 'grp-2' }`, or nothing), so callbacks such as `modaltoggle` keep their identity.
 */
function renderWithRerender(overrides: Partial<ManageMembersProps> = {}) {
  const base: ManageMembersProps = {
    group_id: GROUP_ID,
    user: { sub: 'auth0|owner' },
    modal: true,
    modaltoggle: vi.fn(),
    onMembersUpdated: vi.fn(),
    group_name: 'G',
    ...overrides,
  };
  const result = render(<ManageMembers {...base} />);
  return {
    ...result,
    rerender: (next: Partial<ManageMembersProps> = {}) =>
      result.rerender(<ManageMembers {...base} {...next} />),
  };
}

describe('ManageMembers D-09a — a refresh never blanks the roster (88.6.1-42)', () => {
  // The viewer's own row marker: unique on screen (the harness viewer is the owner). Never
  // `Owner`, which matches both the mocked username and the owner badge.
  async function loadRosterAndCaptureSelf() {
    await openMembersModal();
    await screen.findByText('Target');
    return screen.getByText('(You)');
  }

  // Synchronous: run only after a POSITIVE signal that the refresh request was made.
  function expectRosterKept(selfMarker: HTMLElement) {
    expect(screen.getByText('(You)')).toBe(selfMarker);
    expect(selfMarker.isConnected).toBe(true);
    expect(screen.queryByText('Loading members...')).toBeNull();
  }

  function holdNextMembersGet() {
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    return held;
  }

  async function refreshRequested() {
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(2));
  }

  const WITHOUT_TARGET = ROSTER.filter((m) => m.id !== TARGET_UUID);
  const TARGET_AS_ADMIN = [ROSTER[0], { ...ROSTER[1], UserGroup: { role: 'admin' } }, ROSTER[2]];

  it('T1: the first load names what is loading; a remove refresh keeps the rows painted (AC-28 remove)', async () => {
    const first = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(first.promise);
    renderManageMembers();
    // Confirm-only half: the first-load line is byte-unchanged (D-33 row 20).
    expect(screen.getByText('Loading members...')).toBeInTheDocument();
    await act(async () => {
      first.resolve(ROSTER);
    });
    await screen.findByText('Target');
    const self = screen.getByText('(You)');

    const held = holdNextMembersGet();
    fireEvent.click(screen.getAllByTitle('Remove from group')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await refreshRequested();
    expectRosterKept(self);

    await act(async () => {
      held.resolve(WITHOUT_TARGET);
    });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member removed'));
    expect(screen.queryByText('Target')).toBeNull();
  });

  it('T2: a role change refresh keeps the rows painted (AC-28 role change)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(TARGET_AS_ADMIN);
    const self = await loadRosterAndCaptureSelf();
    const select = (await screen.findAllByRole('combobox'))[0] as HTMLSelectElement;
    const held = holdNextMembersGet();
    fireEvent.change(select, { target: { value: 'member' } });
    await refreshRequested();
    expectRosterKept(self);
    await act(async () => {
      held.resolve(ROSTER);
    });
  });

  it('T3: an approve refresh keeps the rows painted (AC-28 approve; Phase 91.1 deletes this control)', async () => {
    const self = await loadRosterAndCaptureSelf();
    const held = holdNextMembersGet();
    fireEvent.click(screen.getByText('Approve'));
    await refreshRequested();
    expectRosterKept(self);
    await act(async () => {
      held.resolve([ROSTER[0], ROSTER[1], { ...ROSTER[2], UserGroup: { role: 'member' } }]);
    });
  });

  it('T4: a reject refresh keeps the rows painted (AC-28 reject; Phase 91.1 deletes this control)', async () => {
    const self = await loadRosterAndCaptureSelf();
    const held = holdNextMembersGet();
    fireEvent.click(screen.getByText('Reject'));
    fireEvent.click(await screen.findByRole('button', { name: 'Reject' }));
    await refreshRequested();
    // getByText ignores Radix's aria-hide, so the roster behind the open dialog is queryable.
    expectRosterKept(self);
    await act(async () => {
      held.resolve(ROSTER.filter((m) => m.id !== PENDING_UUID));
    });
  });

  it('T5: the un-awaited fifth refresh (a member added from the invite panel) keeps the rows painted', async () => {
    const self = await loadRosterAndCaptureSelf();
    const held = holdNextMembersGet();
    act(() => {
      h.invitePanelProps?.onMemberAdded?.();
    });
    await refreshRequested();
    expectRosterKept(self);
    await act(async () => {
      held.resolve(ROSTER);
    });
  });

  it('T6: a failed refresh keeps the rows and never covers them with the full banner', async () => {
    const self = await loadRosterAndCaptureSelf();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new Error('HTTP error! status: 500'));
    fireEvent.click(screen.getAllByTitle('Remove from group')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith('Error fetching members:', expect.anything())
    );
    await act(async () => {});
    expect(screen.getByText('(You)')).toBe(self);
    expect(self.isConnected).toBe(true);
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(screen.queryByText('No members found.')).toBeNull();
    expect(screen.queryByText('Loading members...')).toBeNull();
  });

  it('T7: a reopen shows the last roster at once and refreshes behind it', async () => {
    const view = renderWithRerender();
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await screen.findByText('Target');
    view.rerender({ modal: false });
    holdNextMembersGet();
    view.rerender({ modal: true });
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    // The Modal remounted, so the node is new: presence, not identity.
    expect(screen.getByText('(You)')).toBeInTheDocument();
    expect(screen.queryByText('Loading members...')).toBeNull();
  });

  it('T8: a role change keeps focus on the role select', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(TARGET_AS_ADMIN);
    await loadRosterAndCaptureSelf();
    const select = screen.getByLabelText('Role for Target') as HTMLSelectElement;
    select.focus();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(ROSTER);
    fireEvent.change(select, { target: { value: 'member' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Role updated'));
    expect(document.activeElement).toBe(select);
    expect(select.isConnected).toBe(true);
  });

  it('T8b: a role change whose refresh MOVES the focused row keeps focus on its select', async () => {
    const ROBIN_UUID = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
    const robin = {
      id: ROBIN_UUID,
      user_id: 'auth0|second',
      username: 'Robin',
      UserGroup: { role: 'member' },
    };
    const before = [ROSTER[0], { ...ROSTER[1], UserGroup: { role: 'admin' } }, robin];
    // The members GET has no order: the rewritten row comes back LATER, so React re-inserts it.
    const after = [ROSTER[0], robin, { ...ROSTER[1], UserGroup: { role: 'member' } }];
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue(before);
    await loadRosterAndCaptureSelf();
    const select = screen.getByLabelText('Role for Target') as HTMLSelectElement;
    select.focus();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(after);
    fireEvent.change(select, { target: { value: 'member' } });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Role updated'));
    // The move committed: Target's row now follows Robin's.
    await waitFor(() =>
      expect(
        screen.getByText('Robin').compareDocumentPosition(screen.getByText('Target')) &
          Node.DOCUMENT_POSITION_FOLLOWING
      ).toBeTruthy()
    );
    await act(async () => {});
    // Never a waitFor on the focus itself: focus sat on the select before the move committed.
    expect(document.activeElement).toBe(select);
    expect(select.isConnected).toBe(true);
  });

  it('T9: a failed FIRST load shows the full banner, never the empty sentence (confirm-only)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new Error('HTTP error! status: 500'));
    renderManageMembers();
    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryByText('No members found.')).toBeNull();
    expect(screen.queryByText('Loading members...')).toBeNull();
  });

  it('T10: a roster that loaded EMPTY keeps its sentence through a failed refresh, never under the full banner (D-50)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce([]);
    // Not openMembersModal: with no row for the viewer the title reads `Members`.
    renderManageMembers();
    await screen.findByText('No members found.');
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new Error('HTTP error! status: 500'));
    act(() => {
      h.invitePanelProps?.onMemberAdded?.();
    });
    await waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith('Error fetching members:', expect.anything())
    );
    await act(async () => {});
    expect(screen.getByText('No members found.')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(screen.queryByText('Loading members...')).toBeNull();
  });
});

describe('ManageMembers W027 + honest failures (88.6.1-42)', () => {
  const NEWBIE = {
    id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    user_id: 'auth0|newbie',
    username: 'Newbie',
    UserGroup: { role: 'member' },
  };

  it('W1: a run started before the identity resolved lands last and cannot wipe the pending invites (IN-208)', async () => {
    h.selfUuid = undefined;
    const d1 = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(d1.promise);
    (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValue([
      { id: 'inv-1', invited_email: 'pending-invite@example.test' },
    ]);
    const view = renderWithRerender();
    h.selfUuid = OWNER_UUID;
    // The effect re-runs on `selfUuid`: a second run starts while the first is still held.
    view.rerender();
    await screen.findByText('pending-invite@example.test');
    await act(async () => {
      d1.resolve(ROSTER);
    });
    await act(async () => {});
    expect(screen.getByText('pending-invite@example.test')).toBeInTheDocument();
  });

  it('W2: two handler refreshes resolving in reverse order — the newer roster wins', async () => {
    await openMembersModal();
    await screen.findByText('Target');
    const dA = deferred<unknown>();
    const dB = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(dA.promise);
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(dB.promise);
    act(() => {
      h.invitePanelProps?.onMemberAdded?.();
      h.invitePanelProps?.onMemberAdded?.();
    });
    await act(async () => {
      dB.resolve([...ROSTER, NEWBIE]);
    });
    await screen.findByText('Newbie');
    await act(async () => {
      dA.resolve(ROSTER);
    });
    await act(async () => {});
    expect(screen.getByText('Newbie')).toBeInTheDocument();
  });

  it('W3: a non-array FIRST load is a failure — the banner, never the empty sentence', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce({ members: [] });
    renderManageMembers();
    expect(await screen.findByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryByText('No members found.')).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('Members data is not an array:', { received: 'object' });
  });

  it('W4: a non-array REFRESH keeps the rows', async () => {
    await openMembersModal();
    await screen.findByText('Target');
    const self = screen.getByText('(You)');
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce({ members: [] });
    fireEvent.click(screen.getAllByTitle('Remove from group')[0]);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() =>
      expect(logger.info).toHaveBeenCalledWith('Members data is not an array:', { received: 'object' })
    );
    await act(async () => {});
    expect(screen.getByText('(You)')).toBe(self);
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(screen.queryByText('No members found.')).toBeNull();
  });

  it('W5: the banner and its Try again stay mounted until the retry succeeds', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new Error('HTTP error! status: 500'));
    renderManageMembers();
    await screen.findByText("Couldn't load members");
    const tryAgain = screen.getByRole('button', { name: /try again/i });
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    fireEvent.click(tryAgain);
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(2));
    expect(tryAgain.isConnected).toBe(true);
    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryByText('Loading members...')).toBeNull();
    await act(async () => {
      held.resolve(ROSTER);
    });
    await screen.findByText('Target');
    expect(screen.queryByText("Couldn't load members")).toBeNull();
  });

  it('W6: after a group change, the previous group\'s failure never stands in for the new group\'s first load', async () => {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(new Error('HTTP error! status: 500'));
    const view = renderWithRerender();
    await screen.findByText("Couldn't load members");
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    view.rerender({ group_id: 'grp-2' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenLastCalledWith('grp-2'));
    expect(screen.getByText('Loading members...')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    await act(async () => {
      held.resolve(ROSTER);
    });
    await screen.findByText('Target');
  });

  it('W6b: after a group change, the previous group\'s pending invites and the caller\'s role are dropped', async () => {
    (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValueOnce([
      { id: 'inv-a', invited_email: 'group-a-invite@example.test' },
    ]);
    const view = renderWithRerender();
    await screen.findByText('group-a-invite@example.test');
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    view.rerender({ group_id: 'grp-2' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenLastCalledWith('grp-2'));
    expect(screen.queryByText('group-a-invite@example.test')).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Manage Group Members' })).toBeNull();
    await act(async () => {
      held.resolve(ROSTER);
    });
    expect(await screen.findByRole('heading', { name: 'Manage Group Members' })).toBeInTheDocument();
  });
});

describe('ManageMembers Req 5 — focus after a row leaves (88.6.1-42, H1-H3)', () => {
  const ROBIN = {
    id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    user_id: 'auth0|second',
    username: 'Robin',
    UserGroup: { role: 'member' },
  };

  const title = () => screen.getByRole('heading', { name: 'Manage Group Members' });

  // Never `<body>`, never the dialog container.
  function expectFocusNotLost() {
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('role')).not.toBe('dialog');
  }

  async function phoneRemoveTarget() {
    const menu = await openKebabList('Member actions for Target');
    const removeItem = within(menu).getByRole('button', { name: 'Remove' });
    fireEvent.click(removeItem);
    fireEvent.click(removeItem);
  }

  it('F1: a phone remove lands on the NEXT row\'s member-actions trigger, only after the refresh commits (H1, R5 ordering backstop)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValue([ROSTER[0], ROSTER[1], ROBIN]);
    await openMembersModal();
    await screen.findByText('Robin');
    const next = screen.getByLabelText('Member actions for Robin');
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    await phoneRemoveTarget();
    await waitFor(() =>
      expect(groupsAPI.removeUserFromGroup as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID)
    );
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(2));
    // The R5 ordering backstop: focus has not moved early; KebabMenu put it back on its trigger.
    expect(document.activeElement).toBe(screen.getByLabelText('Member actions for Target'));
    await act(async () => {
      held.resolve([ROSTER[0], ROBIN]);
    });
    await waitFor(() => expect(document.activeElement).toBe(next));
    expectFocusNotLost();
  });

  it('F5: when the only removable row is removed, focus lands on the dialog title', async () => {
    await openMembersModal();
    await screen.findByText('Target');
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    await phoneRemoveTarget();
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(2));
    await act(async () => {
      held.resolve(ROSTER.filter((m) => m.id !== TARGET_UUID));
    });
    await waitFor(() => expect(document.activeElement).toBe(title()));
    expectFocusNotLost();
  });

  it('F2: an approve pressed without focusing the button (the Safari click) lands on the title (H3; Phase 91.1 deletes this control)', async () => {
    await openMembersModal();
    const approve = await screen.findByText('Approve');
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    // Radix ignores a focusout with a null relatedTarget, so the blur leaves focus on <body>.
    expect(document.activeElement).toBe(document.body);
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce([
      ROSTER[0],
      ROSTER[1],
      { ...ROSTER[2], UserGroup: { role: 'member' } },
    ]);
    fireEvent.click(approve);
    await waitFor(() => expect(document.activeElement).toBe(title()));
    expectFocusNotLost();
  });

  it('F3: a desktop dialog-tier remove lands on the still-open Manage Members title (H2, confirm-only on plan 20\'s floor)', async () => {
    const user = userEvent.setup();
    await openMembersModal();
    await screen.findByText('Target');
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(
      ROSTER.filter((m) => m.id !== TARGET_UUID)
    );
    const opener = screen.getAllByTitle('Remove from group')[0] as HTMLElement;
    opener.focus();
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Remove Target from this group?' });
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member removed'));
    await waitFor(() => expect(document.activeElement).toBe(title()));
    expect(
      screen.getByRole('dialog', { name: 'Manage Group Members' }).contains(document.activeElement)
    ).toBe(true);
    expectFocusNotLost();
  });

  // 88.6.1 code review follow-up (contract (1) audit of performRejectMember's bare arm()): the
  // confirm runs from inside the reject dialog, so the arm seeds from the dialog's own focus and the
  // hook follows the dialog's close restore (useFocusRecovery.ts contract (5)); no `from` is needed.
  it('F4b: a reject whose opener and confirm are pressed WITHOUT focus (the Safari tap) still lands on the title (confirm-only; Phase 91.1 deletes this control)', async () => {
    await openMembersModal();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(
      ROSTER.filter((m) => m.id !== PENDING_UUID)
    );
    const opener = (await screen.findByText('Reject')).closest('button') as HTMLElement;
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(opener);
    await screen.findByRole('dialog', { name: 'Reject Pend?' });
    const confirm = screen.getByRole('button', { name: 'Reject' });
    act(() => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(groupsAPI.rejectMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
    await waitFor(() => expect(document.activeElement).toBe(title()));
    expectFocusNotLost();
  });

  it('F4: a dialog-tier reject lands on the still-open Manage Members title (confirm-only; Phase 91.1 deletes this control)', async () => {
    const user = userEvent.setup();
    await openMembersModal();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(
      ROSTER.filter((m) => m.id !== PENDING_UUID)
    );
    const opener = (await screen.findByText('Reject')).closest('button') as HTMLElement;
    opener.focus();
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Reject Pend?' });
    await user.click(screen.getByRole('button', { name: 'Reject' }));
    await waitFor(() =>
      expect(groupsAPI.rejectMember as Mock).toHaveBeenCalledWith(GROUP_ID, PENDING_UUID)
    );
    await waitFor(() => expect(document.activeElement).toBe(title()));
    expect(
      screen.getByRole('dialog', { name: 'Manage Group Members' }).contains(document.activeElement)
    ).toBe(true);
    expectFocusNotLost();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-50 (W016 rows 12-13; D-35): the pressed Transfer ownership stays focusable.
// ---------------------------------------------------------------------------

describe('ManageMembers 88.6.1-50 — the pressed Transfer ownership stays focusable (W016 rows 12-13; D-35)', () => {
  const TRANSFER_DIALOG = /Transfer ownership to Target\?/;

  // The owner-only desktop kebab is the transfer path jsdom can reach (no CSS, so both
  // breakpoint trees render; the desktop one is the one the existing pins use).
  async function openTransferConfirm() {
    fireEvent.click(await screen.findByLabelText('More actions for Target'));
    fireEvent.click(await screen.findByText('Transfer ownership to this member'));
    const dialog = await screen.findByRole('dialog', { name: TRANSFER_DIALOG });
    const confirm = await screen.findByRole('button', { name: 'Transfer ownership' });
    return { dialog, confirm };
  }

  it('TR1: two presses send one transfer; the pressed confirm stays aria-disabled and focusable until it settles (R4 idempotency + concurrency)', async () => {
    const held = deferred<unknown>();
    (groupsAPI.transferOwnership as Mock).mockReturnValue(held.promise);
    renderManageMembers();
    const { dialog, confirm } = await openTransferConfirm();

    fireEvent.click(confirm);
    fireEvent.click(confirm);

    // RED halves are the attributes and the request count (C-11): jsdom never blurs a natively
    // disabled element, so focus is CONFIRM-ONLY here and is proven in the phone spec.
    expect(confirm).toHaveAttribute('aria-disabled', 'true');
    expect(confirm).not.toHaveAttribute('disabled');
    expect(confirm).toHaveClass('btn-primary');
    expect(confirm).toHaveTextContent('Transferring…');
    // The sibling Cancel nobody pressed keeps its native gate (rule of POSITION).
    const cancel = within(dialog).getByRole('button', { name: 'Cancel' });
    expect(cancel).toBeDisabled();
    expect(cancel).not.toHaveAttribute('aria-disabled');
    expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledTimes(1);
    expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledWith(GROUP_ID, TARGET_UUID);
    expect(screen.getByRole('dialog', { name: TRANSFER_DIALOG })).toBeInTheDocument();

    await act(async () => {
      held.resolve({});
    });
    // The dialog was asserted present above, so this absence follows a positive state.
    expect(screen.queryByRole('dialog', { name: TRANSFER_DIALOG })).toBeNull();
    expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledTimes(1);
  });

  it('TR2: a failed transfer releases the latch, so the same confirm sends a second request', async () => {
    (groupsAPI.transferOwnership as Mock)
      .mockRejectedValueOnce(new Error('HTTP error! status: 500'))
      .mockResolvedValueOnce({});
    renderManageMembers();
    const { confirm } = await openTransferConfirm();

    fireEvent.click(confirm);
    // Positive signal first (CF-26): the failure landed.
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(confirm).toHaveTextContent('Transfer ownership');
    expect(confirm).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('dialog', { name: TRANSFER_DIALOG })).toBeInTheDocument();

    fireEvent.click(confirm);
    await waitFor(() => expect(groupsAPI.transferOwnership as Mock).toHaveBeenCalledTimes(2));
  });

  // TR3 pins the wave 5 CI gate fix (Modal.tsx, preventStackedDialogDismiss) at this surface:
  // the roster Modal has seven React-sibling dialogs stacked on it, and before that fix a Cancel
  // press in any of them also dismissed the roster in production (Next's vendored React). A
  // plain fireEvent.click is green on both trees; pressInStackedDialog replays production's
  // commit order (its header says why). The roster Modal is open by prop, so a dismissal shows
  // as a call to modaltoggle, not as the dialog leaving the DOM.
  it('TR3: a pointer press on the transfer Cancel closes ONLY the transfer dialog, and focus returns to the kebab that opened it', async () => {
    const modaltoggle = vi.fn();
    renderWithRerender({ modaltoggle });
    const trigger = await screen.findByLabelText('More actions for Target');
    const { dialog } = await openTransferConfirm();

    pressInStackedDialog(within(dialog).getByRole('button', { name: 'Cancel' }));
    // Positive signals first (CF-26): the transfer dialog closed and focus reached its opener.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: TRANSFER_DIALOG })).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(trigger));
    expect(modaltoggle).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'Manage Group Members' })).toBeInTheDocument();
    expect(groupsAPI.transferOwnership as Mock).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-50 (D-30 copy row G1; W016 row 20 / W014 case 1): the reset opener.
// ---------------------------------------------------------------------------

describe('ManageMembers 88.6.1-50 — copy row G1 and the reset opener (D-30, W016 row 20)', () => {
  it('G1-1: the header opener says what its dialog and receipt say, and its tooltip is unchanged', async () => {
    await openMembersModal();
    const opener = await screen.findByRole('button', { name: 'Reset invite link' });
    expect(opener).toHaveAttribute('title', 'Invalidate the current invite link and generate a new one');
    expect(screen.queryByRole('button', { name: /QR link/ })).toBeNull();
  });

  it('RS1: while a reset runs the opener reads "Resetting…", aria-disabled and still focusable, then rests again', async () => {
    const held = deferred<unknown>();
    (groupsAPI.resetInviteToken as Mock).mockReturnValueOnce(held.promise);
    await openMembersModal();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset invite link' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Reset link' }));

    // RED half is the attribute (C-11); the focus claim (the dialog's close restore can land
    // on it) is CONFIRM-ONLY in jsdom.
    const opener = (await screen.findByText('Resetting…')).closest('button') as HTMLElement;
    expect(opener).toHaveAttribute('aria-disabled', 'true');
    expect(opener).not.toHaveAttribute('disabled');

    await act(async () => {
      held.resolve({});
    });
    // Positive signal first (CF-26): the receipt fired.
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Invite link reset'));
    expect(screen.getByRole('button', { name: 'Reset invite link' })).not.toHaveAttribute('aria-disabled');
  });
});

// ---------------------------------------------------------------------------
// Phase 88.6.1-78: the shared RF1 notice over the roster plan 42 keeps through a failed refresh.
// The suite renders the REAL banner module and the real useFetchErrorState (contract C9 is not
// engaged here: neither is mocked).
// ---------------------------------------------------------------------------

// Copy row RF1 / D-47 (plan 88.6.1-70's notice sentence): written once in this file, expected
// TWICE while the notice shows (its visible line and its polite region).
const RF1 = "Couldn't refresh. Showing what loaded earlier.";
const ERR_500 = new ApiError('Internal error', 'internal', 500);
const ERR_NETWORK = new ApiError('Network error', 'network', 0);

describe('ManageMembers refresh notice (88.6.1-78: AC-29, RF1, D-50, 88.6.1-70 contract C2-C10)', () => {
  const title = () => screen.getByRole('heading', { name: 'Manage Group Members' });

  // The un-awaited fifth refresh (plan 42's `h.invitePanelProps`): no dialog in the way.
  function triggerRefresh() {
    act(() => {
      h.invitePanelProps?.onMemberAdded?.();
    });
  }

  async function rf1Shown() {
    await waitFor(() => expect(screen.getAllByText(RF1)).toHaveLength(2));
  }

  // The visible RF1 line (outside any status region) and the polite region carrying RF1.
  function rf1Line(): HTMLElement {
    const line = screen.getAllByText(RF1).find((el) => el.closest('[role="status"]') === null);
    expect(line, 'no visible RF1 line').toBeTruthy();
    return line as HTMLElement;
  }
  function rf1Region(): HTMLElement {
    const region = screen
      .getAllByRole('status')
      .find((el) => el.textContent === RF1);
    expect(region, 'no polite region carrying RF1').toBeTruthy();
    return region as HTMLElement;
  }

  function precedes(a: Node, b: Node) {
    return Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  // The viewer's own row marker, `(You)` — never `Owner`, which matches two nodes.
  async function loadRoster() {
    await openMembersModal();
    await screen.findByText('Target');
    return screen.getByText('(You)');
  }

  it('RF-1. a failed refresh keeps the rows and shows RF1 + Retry in a region that was already there, pinned outside the scrolling body (C8 a + b, C6, #242)', async () => {
    const ownerName = await loadRoster();
    const regionsBefore = screen.getAllByRole('status');
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();

    expect(regionsBefore).toContain(rf1Region());
    expect(screen.getByText('(You)')).toBe(ownerName);
    expect(ownerName.isConnected).toBe(true);
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(screen.queryByText('No members found.')).toBeNull();
    expect(screen.getAllByRole('button', { name: 'Retry' })).toHaveLength(1);
    const line = rf1Line();
    expect(precedes(line, ownerName)).toBe(true);

    // Placement (owner ruling #242, 2026-10-14): the dialog's scroll container is Modal.Body
    // (`flex-1 overflow-y-auto`); the notice and its region sit outside it, inside the dialog.
    const scrollBody = ownerName.closest('.overflow-y-auto');
    expect(scrollBody).not.toBeNull();
    expect((scrollBody as HTMLElement).contains(line)).toBe(false);
    expect((scrollBody as HTMLElement).contains(rf1Region())).toBe(false);
    const dialog = screen.getByRole('dialog');
    expect(dialog.contains(line)).toBe(true);
    expect(dialog.contains(rf1Region())).toBe(true);
  });

  it('RF-2. Retry holds Retrying… while the GET is held, then lands focus on the dialog title (C8 c, C2, C4; Req 5)', async () => {
    await loadRoster();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();
    const heading = title();
    const retry = screen.getByRole('button', { name: 'Retry' });
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    const user = userEvent.setup();
    await user.click(retry);
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(3));

    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).not.toHaveAttribute('disabled');
    expect(retry).toHaveTextContent('Retrying…');
    expect(document.activeElement).toBe(retry);
    expect(rf1Line()).toBeTruthy();
    expect(screen.getByText('(You)')).toBeInTheDocument();

    await act(async () => {
      held.resolve(ROSTER);
    });
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('role')).not.toBe('dialog');
  });

  it('RF-3. a refresh that answers with something other than a list is a failure: RF1 over the kept rows (W4)', async () => {
    const ownerName = await loadRoster();
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce({ members: [] });
    triggerRefresh();
    await rf1Shown();
    expect(screen.getByText('(You)')).toBe(ownerName);
    expect(screen.queryByText('No members found.')).toBeNull();
    expect(screen.queryByText("Couldn't load members")).toBeNull();
  });

  it('RF-4. a network failure on a refresh keeps the rows under RF1 (C8 e, the network half)', async () => {
    const ownerName = await loadRoster();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_NETWORK);
    triggerRefresh();
    await rf1Shown();
    expect(screen.getByText('(You)')).toBe(ownerName);
    expect(screen.queryByText("Couldn't load members")).toBeNull();
  });

  it('RF-5. a roster that loaded EMPTY keeps its sentence under RF1 through a failed refresh (D-50, ruling Y)', async () => {
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce([]);
    // Not openMembersModal: with no row for the viewer the title reads `Members`.
    renderManageMembers();
    const sentence = await screen.findByText('No members found.');
    const regionsBefore = screen.getAllByRole('status');
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();

    expect(regionsBefore).toContain(rf1Region());
    expect(screen.getByText('No members found.')).toBe(sentence);
    expect(sentence.isConnected).toBe(true);
    expect(screen.queryByText("Couldn't load members")).toBeNull();
    expect(precedes(rf1Line(), sentence)).toBe(true);
  });

  // The house idiom (`useFetchErrorState.test.tsx`, `function fireVisibility(`): the hook's
  // tab-return re-attempt listens only while an error shows.
  function fireVisibility(state: 'visible' | 'hidden') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
  }

  // Never `<body>`, never the dialog container.
  function expectFocusNotLost() {
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement?.getAttribute('role')).not.toBe('dialog');
  }

  it('RF-6. a 403 on a refresh withdraws the rows, the pending invites and the Invite / Reset row for the full banner, never RF1 (C10, C8 e, #127)', async () => {
    (invitesAPI.getGroupPendingInvites as Mock).mockResolvedValue([
      { id: 'inv-1', invited_email: 'pending-invite@example.test' },
    ]);
    await openMembersModal();
    await screen.findByText('pending-invite@example.test');
    expect(screen.getByRole('button', { name: 'Invite members' })).toBeInTheDocument();
    // Copy row G1 (plan 88.6.1-50).
    expect(screen.getByRole('button', { name: 'Reset invite link' })).toBeInTheDocument();
    const err = new ApiError('Access denied', 'forbidden', 403);
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
    triggerRefresh();
    await screen.findByText(getFetchErrorMessage(err));

    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('(You)')).toBeNull();
    expect(screen.queryByText('Target')).toBeNull();
    expect(screen.queryByText('pending-invite@example.test')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Invite members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reset invite link' })).toBeNull();
  });

  it('RF-7. a 401 on a refresh is the full banner with the sign-in line, never RF1 (C10, C8 e)', async () => {
    await loadRoster();
    const err = new ApiError('Session expired', 'unauthorized', 401);
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
    triggerRefresh();
    await screen.findByText(getFetchErrorMessage(err));
    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('(You)')).toBeNull();
  });

  it('RF-8. a 403 answering the notice\'s own Retry withdraws the rows and lands focus on the dialog title (C10; Req 5)', async () => {
    await loadRoster();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();
    const heading = title();
    const err = new ApiError('Access denied', 'forbidden', 403);
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByText(getFetchErrorMessage(err));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.queryByText('(You)')).toBeNull();
    expectFocusNotLost();
  });

  it('RF-9. a close and reopen after a transient failure starts the notice clean, and the reopen\'s own failure fills a region that was already there (R8 empty)', async () => {
    const view = renderWithRerender();
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await screen.findByText('Target');
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();

    view.rerender({ modal: false });
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    view.rerender({ modal: true });
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(3));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    // D-09a: the reopen shows the last roster (the Modal remounted: presence, not identity).
    expect(screen.getByText('(You)')).toBeInTheDocument();

    const regionsAtReopen = screen.getAllByRole('status');
    await act(async () => {
      held.reject(ERR_500);
    });
    await rf1Shown();
    expect(regionsAtReopen).toContain(rf1Region());
  });

  // Reaches the withheld state: a 403 refresh, then the full banner's Try again failing with a
  // 500 (the stored code is now transient while the roster is still withheld).
  async function withholdThenFailTryAgain() {
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(
      new ApiError('Access denied', 'forbidden', 403)
    );
    triggerRefresh();
    await screen.findByText("Couldn't load members");
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await screen.findByText(getFetchErrorMessage(ERR_500));
    expect(screen.queryByText('(You)')).toBeNull();
  }

  it('RF-10. a withheld roster stays withheld across a close and reopen until a refresh succeeds (C10 memory)', async () => {
    const view = renderWithRerender();
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await screen.findByText('Target');
    await withholdThenFailTryAgain();

    view.rerender({ modal: false });
    const held = deferred<unknown>();
    (groupsAPI.getGroupMembers as Mock).mockReturnValueOnce(held.promise);
    view.rerender({ modal: true });
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await waitFor(() => expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(4));
    expect(screen.getByText("Couldn't load members")).toBeInTheDocument();
    expect(screen.queryByText('(You)')).toBeNull();
    expect(screen.queryAllByText(RF1)).toHaveLength(0);

    await act(async () => {
      held.resolve(ROSTER);
    });
    await screen.findByText('(You)');
    expect(screen.queryByText("Couldn't load members")).toBeNull();
  });

  it('RF-11. an access answer to a refresh nobody pressed withdraws the rows while a row control holds focus, and focus lands on the dialog title (C12 a, C8 f1; 403 and 401 legs)', async () => {
    for (const err of [
      new ApiError('Access denied', 'forbidden', 403),
      new ApiError('Session expired', 'unauthorized', 401),
    ]) {
      cleanup();
      (groupsAPI.getGroupMembers as Mock).mockClear();
      await loadRoster();
      (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
      triggerRefresh();
      await rf1Shown();
      const heading = title();
      const kebab = await screen.findByLabelText('More actions for Target');
      act(() => kebab.focus());
      expect(document.activeElement).toBe(kebab);

      (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(err);
      // No press and no onMemberAdded: the hook's tab-return re-attempt is the refresh.
      act(() => fireVisibility('visible'));
      await screen.findByText(getFetchErrorMessage(err));
      await waitFor(() => expect(document.activeElement).toBe(heading));
      expect(kebab.isConnected).toBe(false);
      expect(screen.queryByText('(You)')).toBeNull();
      expectFocusNotLost();
      expect(groupsAPI.getGroupMembers as Mock).toHaveBeenCalledTimes(3);
    }
  });

  it('RF-12. a refresh nobody pressed that SUCCEEDS while Retry holds focus lands focus on the dialog title (C12 b, C8 f2)', async () => {
    await loadRoster();
    (groupsAPI.getGroupMembers as Mock).mockRejectedValueOnce(ERR_500);
    triggerRefresh();
    await rf1Shown();
    const heading = title();
    const retry = screen.getByRole('button', { name: 'Retry' });
    act(() => retry.focus());
    (groupsAPI.getGroupMembers as Mock).mockResolvedValueOnce(ROSTER);
    act(() => fireVisibility('visible'));
    await waitFor(() => expect(document.activeElement).toBe(heading));
    expect(screen.queryAllByText(RF1)).toHaveLength(0);
    expect(screen.getByText('(You)')).toBeInTheDocument();
    expect(retry.isConnected).toBe(false);
    expectFocusNotLost();
  });

  it('RF-13. a withheld roster\'s kept error starts no members request while the dialog is closed (#155)', async () => {
    const view = renderWithRerender();
    await screen.findByRole('dialog', { name: 'Manage Group Members' });
    await screen.findByText('Target');
    await withholdThenFailTryAgain();
    view.rerender({ modal: false });
    await act(async () => {});
    const callsAtClose = (groupsAPI.getGroupMembers as Mock).mock.calls.length;
    act(() => fireVisibility('visible'));
    await act(async () => {});
    expect((groupsAPI.getGroupMembers as Mock).mock.calls.length).toBe(callsAtClose);
  });
});
