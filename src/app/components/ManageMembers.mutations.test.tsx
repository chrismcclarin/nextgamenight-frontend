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

// Self resolves to the OWNER row's UUID by default, so canManageMembers is true
// and the admin affordances render.
//
// Phase 88.6-19: hoisted to a MUTABLE holder (the `h` idiom already used in
// `ManageMembers.modals.test.tsx:34-37`) so a test can switch WHICH member the
// caller is before rendering. The leave-confirm flow this file now pins only
// exists on a non-owner's OWN row, and it is unreachable with a hardcoded owner.
// Every pre-existing test is byte-equivalent: `beforeEach` restores OWNER_UUID.
const h = vi.hoisted(() => ({
  selfUuid: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as string | undefined,
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

import { toast } from 'sonner';

import ManageMembers from './ManageMembers';
// `ApiError` survives the partial mock above (the `importOriginal` spread), so the 403 arm
// exercises the REAL code-to-copy derivation in `useFetchErrorState` rather than a fixture.
import { ApiError, groupsAPI, invitesAPI } from '@/lib/api';
import { logger } from '@/lib/logger';

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

describe('ManageMembers Req 12 — success receipts for the two named silent mutations', () => {
  it('member removal produces "Member removed" on BOTH entry points', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Remove'));
    fireEvent.click(await screen.findByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Member removed'));

    // The mobile kebab shares the same commit path, so it gets the same receipt.
    (toast.success as Mock).mockClear();
    const menu = await openKebabList('Member actions');
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
    fireEvent.click(await screen.findByText('Reset QR link'));
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
    // `ApiError(message, code, status)` — re-read at `api.ts:155`, not assumed.
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
    // A conditionally-mounted region announces nothing, so its presence BEFORE the
    // failure is the whole mechanism. Both halves are asserted: it exists, and the
    // ARIA contract on it is the polite one.
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveAttribute('aria-atomic', 'true');
    expect(region).toHaveTextContent('');
  });

  it('the SAME region carries the ratified message after a failed leave', async () => {
    (groupsAPI.leaveGroup as Mock).mockRejectedValue(new Error('HTTP error! status: 500'));
    const dialog = await openLeaveConfirm();
    const before = liveRegion(dialog);

    fireEvent.click(screen.getByRole('button', { name: 'Confirm Leave' }));

    await waitFor(() =>
      expect(before).toHaveTextContent('Something went wrong. Refresh the page to try again.')
    );
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
});

describe('ManageMembers W11 receipt + AC-2 channel', () => {
  it('a successful invite-link reset fires the ratified "Invite link reset" receipt', async () => {
    await openMembersModal();
    fireEvent.click(await screen.findByText('Reset QR link'));
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

describe('ManageMembers AR-DEC-3 — the mobile kebab two-tap COMMIT path', () => {
  // No pin covered this before 88-12, so a wiring regression on the phone
  // surface (the primary surface) would have shipped green. The kebab keeps
  // KebabMenu's INTERNAL two-tap rather than routing through useConfirmAction —
  // see the AR-DEC-3 marker in ManageMembers.js for why.
  it('a second tap on Remove within 3s calls removeUserFromGroup with the member UUID', async () => {
    await openMembersModal();

    const menu = await openKebabList('Member actions');
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
    const menu = await openKebabList('Member actions');
    fireEvent.click(within(menu).getByRole('button', { name: 'Remove' }));
    expect(groupsAPI.removeUserFromGroup as Mock).not.toHaveBeenCalled();
  });

  it('"Make admin" from the kebab routes to the SAME escalation gate as the desktop select', async () => {
    await openMembersModal();
    const menu = await openKebabList('Member actions');
    fireEvent.click(within(menu).getByRole('button', { name: 'Make admin' }));

    expect(
      await screen.findByRole('dialog', { name: 'Make Target an admin?' })
    ).toBeInTheDocument();
    expect(groupsAPI.updateUserRole as Mock).not.toHaveBeenCalled();
  });
});
