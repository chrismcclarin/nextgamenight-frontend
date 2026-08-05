'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, invitesAPI, API_BASE_URL } from '../../lib/api';
import ClickableMemberName from './ClickableMemberName';
import KebabMenu from './KebabMenu';
import FriendInvitePanel from './FriendInvitePanel';
import { toast } from 'sonner';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Modal } from './Modal';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { SelectControl } from '../../components/ui/Input';

function ManageMembers({ group_id, user, modal, modaltoggle, onMembersUpdated, group_name }) {
    const router = useRouter();
    // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID once via the
    // shared identity primitive. The self-badge, current-member role derive, and
    // every group-admin mutation target key on the nested member.id (UUID) — not
    // the flat member.user_id vs sub compare (which flips value at PR-C). selfUuid resolves
    // ASYNC (D-04), so the current-member role derive re-runs when it resolves.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [error, setError] = useState(null);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingLoading, setPendingLoading] = useState(false);
    // Phase 69-02 GROUP-06: per-row Transfer Ownership confirm modal target.
    // Owner-only kebab on each non-owner active row sets this; null = closed.
    const [transferTarget, setTransferTarget] = useState(null); // { id (member UUID), name } or null
    const [transferring, setTransferring] = useState(false);
    // Invite modal + reset-link state — buttons live in the Manage Members header,
    // the actual invite UI is the existing FriendInvitePanel modal.
    const [inviteModalOpen, setInviteModalOpen] = useState(false);
    const [resettingInvite, setResettingInvite] = useState(false);
    // Phase 69-04 mirror: same confirm-modal Leave flow as GroupSettings,
    // so the in-row "Leave Group" button (non-owner self-row) gets the
    // canonical copy + inline error UX rather than window.confirm.
    const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
    const [leaving, setLeaving] = useState(false);
    const [leaveError, setLeaveError] = useState('');
    // Phase 88-12 (Req 11): the gates below are tiered via useConfirmAction, whose
    // config is re-read every render — so the TARGET each dialog is talking about
    // lives here, and the title interpolates from it. `{ id, name }` for remove and
    // reject; the promote target additionally carries `priorRole` (see the select
    // marker below for why).
    const [removeTarget, setRemoveTarget] = useState(null);
    const [rejectTarget, setRejectTarget] = useState(null);
    const [promoteTarget, setPromoteTarget] = useState(null);

    useEffect(() => {
        if (modal && group_id && user?.sub) {
            fetchMembers();
        }
        // selfUuid is in the deps so that when identity resolves on a cold
        // cache, fetchMembers re-runs and the current-member role derive (which
        // gates the pending-invites fetch + admin controls) recomputes against
        // the resolved UUID instead of sticking at a wrong "no role".
    }, [modal, group_id, user?.sub, selfUuid]);

    const fetchMembers = async () => {
        if (!group_id || !user?.sub) return;
        setLoading(true);
        setError(null);
        try {
            // Use groupsAPI.getGroupMembers which automatically includes Authorization header
            const data = await groupsAPI.getGroupMembers(group_id);

            // Ensure data is an array before processing
            if (!Array.isArray(data)) {
                console.warn('Members data is not an array:', data);
                setMembers([]);
                setLoading(false);
                return;
            }

            setMembers(data || []);

            // Find current user's role by the nested member.id (UUID) vs the
            // resolved selfUuid. Gated on identity resolution: while selfUuid is
            // undefined we skip the derive (loading), never store a wrong "no
            // role" — the effect re-runs when identity resolves (selfUuid in deps).
            if (!selfUuid) {
                setPendingInvites([]);
                return;
            }
            const currentUserMember = data.find(m => m.id === selfUuid);
            const role = currentUserMember?.UserGroup?.role || null;
            if (role) setUserRole(role);

            // Pending invites endpoint is owner/admin-only — gate the call so non-admins
            // don't trigger a 403 + console error every time they open the modal.
            if (role === 'owner' || role === 'admin') {
                try {
                    setPendingLoading(true);
                    const invites = await invitesAPI.getGroupPendingInvites(group_id);
                    setPendingInvites(Array.isArray(invites) ? invites : []);
                } catch (inviteErr) {
                    setPendingInvites([]);
                } finally {
                    setPendingLoading(false);
                }
            } else {
                setPendingInvites([]);
            }
        } catch (error) {
            console.error('Error fetching members:', error);
            setError('Failed to load members');
            setMembers([]);
        } finally {
            setLoading(false);
        }
    };

    // Runs ONLY after the escalation gate below has been confirmed, or directly for
    // an ungated (non-escalating) role change. Resolves true on success so the gate
    // can stay open on failure without this path having to throw at the mobile
    // kebab, which calls it outside any promise chain.
    const performRoleChange = async (target_user_id, newRole) => {
        try {
            await groupsAPI.updateUserRole(group_id, target_user_id, newRole);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
            // Req 12 receipt (UI-SPEC §6.2): `{Object} {past-tense verb}`, <=4 words,
            // no exclamation mark and no adverb — the shipped error-toast voice.
            // (The banned adverb is deliberately not spelled out here: Req 12's
            // acceptance is a plain grep over this file that does not exempt comments.)
            toast.success('Role updated');
            return true;
        } catch (error) {
            console.error('Error updating role:', error);
            toast.error(error.message || 'Failed to update user role. Please try again.');
            return false;
        }
    };

    /* DECISION Phase 88-12 (AR R2-M10, owner-ruled 2026-08-05): the role change is gated
       ONLY on ESCALATION to admin. Demotions and every other role change stay ungated and
       fire the API immediately, exactly as they shipped.

       REJECTED ALTERNATIVE — gating every role change, which is the symmetrical-looking
       thing to do. It loses because a demotion is self-correcting (re-promote and you are
       back where you were), so a gate there buys nothing and taxes routine management on
       the surface an admin uses most. Granting admin is the one direction that hands
       someone else power over other people's membership, which is a consequence the
       control's own label cannot convey — D-09's "does it need explaining?" rule.

       Un-gating the promotion, or extending the gate to demotions, is a decision. */
    const promoteAdminGate = useConfirmAction({
        tier: 'dialog',
        title: `Make ${promoteTarget?.name || 'this member'} an admin?`,
        body: 'Admins can edit events, manage members, and approve or remove people.',
        confirmLabel: 'Make admin',
        onConfirm: async (target_user_id) => {
            const ok = await performRoleChange(target_user_id, 'admin');
            // Rejecting keeps the gate open (useConfirmAction's contract) so the
            // person can retry or cancel rather than see it close on a failed grant.
            if (!ok) throw new Error('Role update failed');
            setPromoteTarget(null);
        },
    });

    const cancelPromoteAdmin = () => {
        promoteAdminGate.cancel();
        setPromoteTarget(null);
    };

    const handleRoleChange = (target_user_id, newRole, targetName, priorRole) => {
        if (!group_id || !user?.sub) return;
        if (newRole === 'admin') {
            setPromoteTarget({
                id: target_user_id,
                name: targetName || 'this member',
                priorRole: priorRole || 'member',
            });
            promoteAdminGate.trigger(target_user_id);
            return;
        }
        void performRoleChange(target_user_id, newRole);
    };

    // Phase 68-02, retained through 88-12: post-gate body factored out so the two
    // entry points can carry DIFFERENT gates and still share one commit path. The
    // mobile kebab's two-tap IS its confirmation and calls this directly; the
    // desktop Remove button routes through the dialog gate below and then calls
    // this. See the AR-DEC-3 marker at the kebab item for why they differ.
    const handleRemoveMemberConfirmed = async (target_user_id) => {
        if (!group_id || !user?.sub) return false;
        try {
            await groupsAPI.removeUserFromGroup(group_id, target_user_id);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
            // Req 12 receipt (UI-SPEC §6.2). Deliberately here and not at the two
            // call sites: the desktop dialog gate and the mobile kebab two-tap share
            // this commit path, so both surfaces get the same receipt from one line.
            toast.success('Member removed');
            return true;
        } catch (error) {
            console.error('Error removing member:', error);
            toast.error(error.message || 'Failed to remove user. Please try again.');
            return false;
        }
    };

    // Desktop Remove button — dialog tier (UI-SPEC §11.2). Copy verbatim.
    const removeMemberGate = useConfirmAction({
        tier: 'dialog',
        title: `Remove ${removeTarget?.name || 'this member'} from this group?`,
        body: "They'll lose access to events and planning. You can re-invite them.",
        confirmLabel: 'Remove',
        onConfirm: async (target_user_id) => {
            const ok = await handleRemoveMemberConfirmed(target_user_id);
            if (!ok) throw new Error('Remove failed');
        },
    });

    const handleRemoveMember = (target_user_id, targetName) => {
        if (!group_id || !user?.sub) return;
        setRemoveTarget({ id: target_user_id, name: targetName || 'this member' });
        removeMemberGate.trigger(target_user_id);
    };

    const handleApproveMember = async (target_user_id) => {
        if (!group_id) return;
        try {
            await groupsAPI.approveMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
        } catch (error) {
            console.error('Error approving member:', error);
            toast.error(error.message || 'Failed to approve member. Please try again.');
        }
    };

    const performRejectMember = async (target_user_id) => {
        try {
            await groupsAPI.rejectMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
            return true;
        } catch (error) {
            console.error('Error rejecting member:', error);
            toast.error(error.message || 'Failed to reject member. Please try again.');
            return false;
        }
    };

    /* DECISION Phase 88-12 (OI-7 owner-ratified 2026-08-04; body corrected per
       FND-88-12-02): reject-pending is the DIALOG tier, and its body says only
       "They'll be removed from the pending list."

       The ratified copy in 88-UI-SPEC.md:623 was "They'll be removed from the group and
       will need a new invite to rejoin." The second clause is FALSE against the shipped
       backend and was cut, not softened: `routes/groups.js:1237-1238` hard-deletes only the
       UserGroup row — it does not rotate the group's invite_token and writes no block-list
       entry — and `:738-744` still matches that STANDING token, with `:857-869` admitting
       the holder as a full `member` ("QR invites bypass pending"). So a rejected person
       reusing the same link does not need a new invite at all; they skip the pending queue
       entirely. The tier is unaffected and stands as ratified.

       Restoring the new-invite sentence is a decision that requires the BACKEND to change
       first (rotate the token or block the rejected user), not a copy cleanup. */
    const rejectMemberGate = useConfirmAction({
        tier: 'dialog',
        title: `Reject ${rejectTarget?.name || 'this member'}?`,
        body: "They'll be removed from the pending list.",
        confirmLabel: 'Reject',
        onConfirm: async (target_user_id) => {
            const ok = await performRejectMember(target_user_id);
            if (!ok) throw new Error('Reject failed');
        },
    });

    const handleRejectMember = (target_user_id, targetName) => {
        if (!group_id) return;
        setRejectTarget({ id: target_user_id, name: targetName || 'this member' });
        rejectMemberGate.trigger(target_user_id);
    };

    // Reset invite link — dialog tier (UI-SPEC §11.2). Copy verbatim.
    const performResetInviteToken = async () => {
        setResettingInvite(true);
        try {
            await groupsAPI.resetInviteToken(group_id);
            return true;
        } catch (err) {
            console.error('Failed to reset invite token:', err);
            toast.error(err.message || 'Failed to reset invite link. Please try again.');
            return false;
        } finally {
            setResettingInvite(false);
        }
    };

    const resetInviteGate = useConfirmAction({
        tier: 'dialog',
        title: 'Reset the invite link?',
        body: 'Every copy of the old link stops working — including printed QR codes.',
        confirmLabel: 'Reset link',
        onConfirm: async () => {
            const ok = await performResetInviteToken();
            if (!ok) throw new Error('Reset invite link failed');
        },
    });

    // Phase 69-04 mirror: in-row Leave Group button opens a sibling confirm
    // modal (same shape + copy as GroupSettings) instead of window.confirm.
    const handleLeaveGroup = () => {
        if (!group_id) return;
        setLeaveError('');
        setShowLeaveConfirm(true);
    };

    const handleLeaveGroupConfirmed = async () => {
        if (!group_id) return;
        setLeaving(true);
        setLeaveError('');
        try {
            await groupsAPI.leaveGroup(group_id);
            setShowLeaveConfirm(false);
            modaltoggle(); // Close the modal
            router.push('/');
        } catch (error) {
            console.error('Error leaving group:', error);
            setLeaveError(error.message || 'Failed to leave group. Please try again.');
        } finally {
            setLeaving(false);
        }
    };

    const getRoleBadge = (role) => {
        const roleStyles = {
            owner: 'bg-purple-100 text-purple-800 border-purple-300',
            admin: 'bg-surface-card-hover text-accent border-accent',
            member: 'bg-surface-card-hover text-content-secondary border-line',
            pending: 'bg-amber-100 text-amber-800 border-amber-300'
        };
        
        return (
            <span className={`px-2 py-1 rounded-sm text-xs font-semibold border ${roleStyles[role] || roleStyles.member}`}>
                {role?.charAt(0).toUpperCase() + role?.slice(1) || 'Member'}
            </span>
        );
    };

    if (!modal) return null;

    // Owner and admin can manage members
    const canManageMembers = userRole === 'owner' || userRole === 'admin';

    return (
        <>
        {/* DECISION Phase 88-12 (SPEC Req 9): all three of this file's overlays are hosted
            on the shared <Modal>, and their old hand-rolled `zIndex: 110` tiers are NOT
            re-created as bespoke z-index classes on the Radix content.

            RESOLVED STACKING (verified, not assumed — same reasoning 88-15 recorded on
            FriendInvitePanel): Radix portals every dialog to the END of <body>, so a
            later-opened dialog paints above an earlier one purely by DOM order. The
            transfer/leave confirms and the invite panel all open FROM this modal, so they
            mount after it and stack above it without any z-index of their own. The rejected
            alternative was porting `zIndex: 110` onto <Modal> via className — it
            re-introduces a bespoke tier the rest of the fleet does not have, for an
            ordering the portal already guarantees.

            The old sibling-overlay + stopPropagation dance is likewise gone rather than
            ported: it existed only so the parent's backdrop onClick could not fire through
            a child overlay, and Radix's outside-interaction handling makes it moot.
            Re-adding either is a decision, not a cleanup. */}
        <Modal open={modal} onClose={modaltoggle} className="max-w-2xl">
            <Modal.Header>
                {canManageMembers ? 'Manage Group Members' : 'Members'}
            </Modal.Header>
            <Modal.Body>
                {userRole && userRole !== 'pending' && (
                    <div className="mb-4 pb-4 border-b border-line flex flex-wrap gap-2">
                        <button
                            type="button"
                            onClick={() => setInviteModalOpen(true)}
                            className="btn btn-primary text-sm"
                        >
                            Invite members
                        </button>
                        {canManageMembers && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (resettingInvite) return;
                                    resetInviteGate.trigger();
                                }}
                                disabled={resettingInvite}
                                className="btn btn-secondary text-sm text-status-error"
                                title="Invalidate the current invite link and generate a new one"
                            >
                                {resettingInvite ? 'Resetting…' : 'Reset QR link'}
                            </button>
                        )}
                    </div>
                )}

                {!canManageMembers && (
                    <div className="bg-surface-card-hover border border-line rounded-lg p-4 mb-4">
                        <p className="text-content-secondary text-sm">
                            You're viewing the member list. Only owners and admins can change roles or remove members.
                        </p>
                    </div>
                )}

                {/* D-08: identity-resolution failure hides the self "(You)" badge
                    and the admin controls gated on the derived role — surface a
                    compact, non-blocking degrade notice rather than fail silently. */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />

                {loading ? (
                    <p className="text-content-secondary">Loading members...</p>
                ) : error ? (
                    <p className="text-red-600">{error}</p>
                ) : members.length === 0 ? (
                    <p className="text-content-secondary">No members found.</p>
                ) : (
                    <>
                        {/* Pending Members Section (admin/owner only) */}
                        {canManageMembers && members.filter(m => m.UserGroup?.role === 'pending').length > 0 && (
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="text-lg font-semibold text-content-primary">Pending Members</h3>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                        {members.filter(m => m.UserGroup?.role === 'pending').length}
                                    </span>
                                </div>
                                <p className="text-sm text-content-muted mb-3">Auto-approved after 24h</p>
                                <div className="space-y-3">
                                    {members.filter(m => m.UserGroup?.role === 'pending').map((member) => (
                                        <div key={member.id} className="flex items-center justify-between p-4 border border-amber-200 rounded-lg bg-amber-50">
                                            <div className="flex items-center gap-3 flex-1">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-semibold text-content-primary"><ClickableMemberName userId={member.id} username={member.username || member.email} /></p>
                                                        {getRoleBadge('pending')}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleApproveMember(member.id)}
                                                    className="btn btn-primary text-sm px-4 py-2"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleRejectMember(member.id, member.username || member.email)}
                                                    className="btn btn-danger text-sm px-4 py-2"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Active Members List */}
                        <div className="space-y-3">
                            {members.filter(m => m.UserGroup?.role !== 'pending').map((member) => {
                                const memberRole = member.UserGroup?.role || 'member';
                                const isCurrentUser = member.id === selfUuid;
                                const isOwner = memberRole === 'owner';

                                return (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 border border-line rounded-lg hover:bg-surface-card-hover"
                                    >
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-content-primary">
                                                        <ClickableMemberName userId={member.id} username={member.username || member.email} />
                                                    </p>
                                                    {isCurrentUser && (
                                                        <span className="text-xs text-accent font-medium">(You)</span>
                                                    )}
                                                    {/* Phase 69-02 GROUP-03: explicit Owner badge inline next to the
                                                        owner's name. Visible to ALL viewers (member/admin/owner) so
                                                        the role is always discoverable. Uses design-system tokens
                                                        for theme parity. The existing getRoleBadge() lookup also
                                                        renders the role pill on the right; this inline badge is
                                                        the canonical "this is the owner" indicator per CONTEXT. */}
                                                    {isOwner ? (
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-accent border">
                                                            Owner
                                                        </span>
                                                    ) : (
                                                        getRoleBadge(memberRole)
                                                    )}
                                                </div>
                                                {member.email && member.email !== member.username && (
                                                    <p className="text-sm text-content-secondary mt-1">{member.email}</p>
                                                )}
                                            </div>
                                        </div>

                                        {canManageMembers && !isCurrentUser && (
                                            <>
                                                {/* Phase 69-02 GROUP-03: owner row hides Remove + role-change controls
                                                    entirely (per CONTEXT, no disabled-with-tooltip — controls just
                                                    aren't rendered). Combined with the inline "Owner" badge above. */}
                                                {!isOwner && (
                                                    <>
                                                        {/* Desktop (≥768px) — role-select + Remove, both on the dialog tier */}
                                                        <div className="hidden md:flex items-center gap-2">
                                                            {/* Role Dropdown */}
                                                            {/* [Rule 2 - a11y] The role <select> shipped with no
                                                                accessible name — surfaced by the composed axe audit
                                                                added in 88-12 (axe `select-name`), which the
                                                                primitive's own suite could not see. The visible
                                                                member name is the only thing that distinguishes one
                                                                row's select from the next. */}
                                                            {/* DECISION Phase 88-12 (AR R2-M10): while an escalation gate is
                                                                OPEN for this member the select renders the PRIOR role
                                                                explicitly, so Cancel provably leaves it showing "Member".
                                                                Chosen OVER `value={memberRole}` alone, which is the obvious
                                                                shape and does revert — but only via React's implicit
                                                                controlled-input restore, an internal that no assertion in this
                                                                repo pins and that reads as an accident to anyone reviewing it.
                                                                The trap the AR named (select stuck showing "Admin" while the
                                                                backend still says "Member") is closed structurally here.
                                                                Collapsing this back to the bare `memberRole` is a decision. */}
                                                            <SelectControl
                                                                aria-label={`Role for ${member.username || member.email}`}
                                                                value={promoteTarget?.id === member.id ? promoteTarget.priorRole : memberRole}
                                                                onChange={(e) => handleRoleChange(
                                                                    member.id,
                                                                    e.target.value,
                                                                    member.username || member.email,
                                                                    memberRole
                                                                )}
                                                                className="w-auto"
                                                            >
                                                                <option value="member">Member</option>
                                                                <option value="admin">Admin</option>
                                                            </SelectControl>

                                                            {/* Remove Button — desktop entry point opens the dialog-tier
                                                                gate inside handleRemoveMember (Req 11, UI-SPEC §11.2). */}
                                                            <button
                                                                onClick={() => handleRemoveMember(member.id, member.username || member.email)}
                                                                className="btn btn-danger text-sm px-4 py-2"
                                                                title="Remove from group"
                                                            >
                                                                Remove
                                                            </button>

                                                            {/* Phase 69-02 GROUP-06: owner-only Transfer Ownership kebab on
                                                                desktop. Shown alongside admin controls so the owner has
                                                                surface parity with mobile. Admins do NOT see this kebab —
                                                                only the current owner can transfer (strict userRole check,
                                                                NOT canManageMembers which would include admins). */}
                                                            {userRole === 'owner' && (
                                                                <KebabMenu
                                                                    ariaLabel={`More actions for ${member.username || member.email}`}
                                                                    items={[
                                                                        {
                                                                            label: 'Transfer ownership to this member',
                                                                            danger: true,
                                                                            onClick: () => setTransferTarget({
                                                                                id: member.id,
                                                                                name: member.username || member.email || 'this member',
                                                                            }),
                                                                        },
                                                                    ]}
                                                                />
                                                            )}
                                                        </div>

                                                        {/* Mobile (<768px) — kebab collapses role swap + Remove (and
                                                            Transfer Ownership when viewer is owner) into one ⋮.
                                                            "Make member" is single-tap (a demotion is reversible and
                                                            ungated on both surfaces); "Make admin" routes to the same
                                                            escalation gate the desktop select uses. Transfer Ownership
                                                            opens its own modal (no twoTap — the modal IS the
                                                            confirmation). */}
                                                        <div className="md:hidden">
                                                            <KebabMenu
                                                                ariaLabel="Member actions"
                                                                items={[
                                                                    {
                                                                        label: memberRole === 'admin' ? 'Make member' : 'Make admin',
                                                                        onClick: () => handleRoleChange(
                                                                            member.id,
                                                                            memberRole === 'admin' ? 'member' : 'admin',
                                                                            member.username || member.email,
                                                                            memberRole
                                                                        ),
                                                                    },
                                                                    /* DECISION Phase 88 AR-DEC-3 (owner, 2026-08-05): keep
                                                                       KebabMenu-internal two-tap OVER routing through
                                                                       useConfirmAction — the hook tier cannot survive an
                                                                       auto-closing menu item (D-07). The arming tap at
                                                                       KebabMenu.js:76-86 is the ONLY tap that does not close
                                                                       the menu; hook-routing either arms without ever
                                                                       committing (silently breaking mobile remove) or closes
                                                                       on the arming tap. UI-SPEC §11.2 lists this gate as
                                                                       already shipped and tier-correct. Changing this is a
                                                                       decision, not a cleanup. */
                                                                    {
                                                                        label: 'Remove',
                                                                        danger: true,
                                                                        twoTap: true,
                                                                        confirmLabel: 'Tap again to remove',
                                                                        onClick: () => handleRemoveMemberConfirmed(member.id),
                                                                    },
                                                                    // Phase 69-02 GROUP-06: owner-only — admins don't see this item.
                                                                    ...(userRole === 'owner' ? [{
                                                                        label: 'Transfer ownership to this member',
                                                                        danger: true,
                                                                        onClick: () => setTransferTarget({
                                                                            id: member.id,
                                                                            name: member.username || member.email || 'this member',
                                                                        }),
                                                                    }] : []),
                                                                ]}
                                                            />
                                                        </div>
                                                    </>
                                                )}
                                            </>
                                        )}

                                        {isCurrentUser && !isOwner && (
                                            <button
                                                onClick={handleLeaveGroup}
                                                className="btn btn-danger text-sm px-4 py-2"
                                            >
                                                Leave Group
                                            </button>
                                        )}
                                        {isCurrentUser && isOwner && (
                                            <p className="text-sm text-content-muted italic">Your role</p>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </>
                )}

                {/* Pending Invites Section */}
                {pendingInvites.length > 0 && (
                    <div className="mt-6">
                        <div className="flex items-center gap-2 mb-3">
                            <h3 className="text-lg font-semibold text-content-primary">Pending Invites</h3>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                {pendingInvites.length}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {pendingInvites.map((invite) => (
                                <div
                                    key={invite.id}
                                    className="flex items-center justify-between p-4 border border-line rounded-lg bg-amber-50"
                                >
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-content-primary">
                                                    {invite.invited_email}
                                                </p>
                                                <span className="px-2 py-1 rounded-sm text-xs font-semibold border bg-amber-100 text-amber-800 border-amber-300">
                                                    Pending
                                                </span>
                                            </div>
                                            <div className="text-sm text-content-secondary mt-1">
                                                {invite.invited_by_name && (
                                                    <span>Invited by {invite.invited_by_name}</span>
                                                )}
                                                {invite.created_at && (
                                                    <span className="ml-2">
                                                        on {new Date(invite.created_at).toLocaleDateString('en-US', {
                                                            month: 'short',
                                                            day: 'numeric',
                                                            year: 'numeric'
                                                        })}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

            </Modal.Body>
            <Modal.Footer>
                <Modal.Action variant="secondary" onClick={modaltoggle} className="px-6">
                    Close
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Transfer Ownership confirmation — Phase 69 GROUP-06 frontend, migrated onto the
            shared <Modal> in Phase 88-12. Copy verbatim from CONTEXT D-XFER-02.

            DECISION Phase 88-12 (AR R2-M11): the shipped in-flight dismissal guard survives
            as `dismissable={!transferring}` — the primitive's OWN expression of "an
            accidental outside click must not discard this", which is exactly what the old
            `onClick={() => !transferring && ...}` backdrop guard bought. Esc and the header
            close affordance stay live while pending, per Modal.tsx's recorded contract
            ("the keyboard close path is never trapped" — WCAG 2.1.2). The rejected
            alternative was suppressing those too so the dialog is un-exitable in flight:
            that reopens a shipped a11y call to defend against an EXPLICIT close, where the
            guard was only ever about an accidental one. Changing this is a decision. */}
        <Modal
            open={!!transferTarget}
            onClose={() => setTransferTarget(null)}
            dismissable={!transferring}
            className="max-w-md"
        >
            <Modal.Header>
                Transfer ownership to {transferTarget?.name}?
            </Modal.Header>
            <Modal.Body>
                <p className="text-content-secondary">
                    You will become an admin. This cannot be undone.
                </p>
            </Modal.Body>
            <Modal.Footer>
                <Modal.Action
                    variant="secondary"
                    disabled={transferring}
                    onClick={() => setTransferTarget(null)}
                >
                    Cancel
                </Modal.Action>
                <Modal.Action
                    variant="primary"
                    disabled={transferring}
                    onClick={async () => {
                        if (!transferTarget) return;
                        setTransferring(true);
                        try {
                            await groupsAPI.transferOwnership(group_id, transferTarget.id);
                            setTransferTarget(null);
                            if (onMembersUpdated) onMembersUpdated();
                            if (modaltoggle) modaltoggle(); // close ManageMembers — caller refetches role
                        } catch (err) {
                            console.error('Transfer ownership failed:', err);
                            toast.error(err.message || 'Failed to transfer ownership. Please try again.');
                        } finally {
                            setTransferring(false);
                        }
                    }}
                >
                    {transferring ? 'Transferring…' : 'Transfer ownership'}
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Leave Group confirmation — Phase 69-04 mirror, migrated onto the shared <Modal>
            in Phase 88-12. Copy verbatim from CONTEXT D-LEAVE-04 / Plan 69-04.
            `dismissable={!leaving}` carries the same in-flight guard as the transfer
            confirm above — see the marker there for why Esc stays live. */}
        <Modal
            open={showLeaveConfirm}
            onClose={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
            dismissable={!leaving}
            className="max-w-md"
        >
            <Modal.Header>
                Leave <span className="text-accent">{group_name}</span>?
            </Modal.Header>
            <Modal.Body>
                <p className="text-content-secondary">
                    You will lose access to events, library, and member-only content.
                </p>
                {leaveError && (
                    <p className="text-status-error text-sm mt-4">{leaveError}</p>
                )}
            </Modal.Body>
            <Modal.Footer>
                <Modal.Action
                    variant="secondary"
                    disabled={leaving}
                    onClick={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
                >
                    Cancel
                </Modal.Action>
                <Modal.Action
                    variant="danger"
                    disabled={leaving}
                    onClick={handleLeaveGroupConfirmed}
                >
                    {leaving ? 'Leaving…' : 'Confirm Leave'}
                </Modal.Action>
            </Modal.Footer>
        </Modal>

        {/* Req 11 tiered gates. Each is rendered UNCONDITIONALLY and exactly ONCE for the
            whole roster — the hook owns which member is targeted, so a per-row copy would
            mount one dialog per member. `statusNode` is likewise mounted once and always: a
            conditionally-mounted live region announces nothing. All four are `dialog` tier
            today, which renders `statusNode` silent — it is still mounted so that
            retiering any of them to `two-tap` stays the one-word edit the primitive
            promises. */}
        <ConfirmDialog {...removeMemberGate.dialogProps} />
        {removeMemberGate.statusNode}
        <ConfirmDialog {...rejectMemberGate.dialogProps} />
        {rejectMemberGate.statusNode}
        <ConfirmDialog {...resetInviteGate.dialogProps} />
        {resetInviteGate.statusNode}
        {/* onCancel is overridden (and only here) so aborting also drops the pending
            escalation target — that is what makes the select revert. */}
        <ConfirmDialog {...promoteAdminGate.dialogProps} onCancel={cancelPromoteAdmin} />
        {promoteAdminGate.statusNode}

        {/* Invite members modal — sibling overlay so it stacks above ManageMembers
            and clicking inside it doesn't trigger the parent's backdrop close. */}
        <FriendInvitePanel
            group={{ id: group_id, name: group_name }}
            open={inviteModalOpen}
            onClose={() => setInviteModalOpen(false)}
            onMemberAdded={() => {
                if (onMembersUpdated) onMembersUpdated();
                fetchMembers();
            }}
        />
        </>
    );
}

export default ManageMembers;

