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

    const handleRoleChange = async (target_user_id, newRole) => {
        if (!group_id || !user?.sub) return;
        
        try {
            await groupsAPI.updateUserRole(group_id, target_user_id, newRole);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
        } catch (error) {
            console.error('Error updating role:', error);
            toast.error(error.message || 'Failed to update user role. Please try again.');
        }
    };

    // Phase 68-02: post-confirm body factored out so mobile kebab two-tap can
    // skip the desktop window.confirm() (the kebab's two-tap IS the confirmation).
    // Desktop entry point (handleRemoveMember below) still gates on confirm()
    // and then calls this — desktop UX is byte-for-byte unchanged.
    const handleRemoveMemberConfirmed = async (target_user_id) => {
        if (!group_id || !user?.sub) return;
        try {
            await groupsAPI.removeUserFromGroup(group_id, target_user_id);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
        } catch (error) {
            console.error('Error removing member:', error);
            toast.error(error.message || 'Failed to remove user. Please try again.');
        }
    };

    // Desktop Remove button — unchanged. Browser confirm dialog gates the
    // destructive action exactly as it did before Phase 68-02.
    const handleRemoveMember = async (target_user_id) => {
        if (!group_id || !user?.sub) return;
        if (!window.confirm('Are you sure you want to remove this user from the group?')) {
            return;
        }
        await handleRemoveMemberConfirmed(target_user_id);
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

    const handleRejectMember = async (target_user_id) => {
        if (!group_id) return;
        if (!confirm('Are you sure you want to reject this member? They will be removed from the group and would need a new invite to rejoin.')) {
            return;
        }
        try {
            await groupsAPI.rejectMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
        } catch (error) {
            console.error('Error rejecting member:', error);
            toast.error(error.message || 'Failed to reject member. Please try again.');
        }
    };

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
            <span className={`px-2 py-1 rounded text-xs font-semibold border ${roleStyles[role] || roleStyles.member}`}>
                {role?.charAt(0).toUpperCase() + role?.slice(1) || 'Member'}
            </span>
        );
    };

    if (!modal) return null;

    // Owner and admin can manage members
    const canManageMembers = userRole === 'owner' || userRole === 'admin';

    return (
        <>
        <div className="modal-overlay" onClick={modaltoggle}>
            <div className="modal-content max-w-2xl w-full p-6 max-h-[90vh] overflow-y-auto relative" onClick={(e) => e.stopPropagation()}>
                <button
                    onClick={modaltoggle}
                    className="absolute top-3 right-3 text-content-muted hover:text-content-primary text-2xl"
                    aria-label="Close"
                >
                    &times;
                </button>

                <h2 className="text-2xl font-bold text-content-primary mb-4">
                    {canManageMembers ? 'Manage Group Members' : 'Members'}
                </h2>

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
                                onClick={async () => {
                                    if (resettingInvite) return;
                                    if (!window.confirm('Reset invite link? The current QR code and link will stop working.')) return;
                                    setResettingInvite(true);
                                    try {
                                        await groupsAPI.resetInviteToken(group_id);
                                    } catch (err) {
                                        console.error('Failed to reset invite token:', err);
                                        toast.error(err.message || 'Failed to reset invite link. Please try again.');
                                    } finally {
                                        setResettingInvite(false);
                                    }
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
                                                    onClick={() => handleRejectMember(member.id)}
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
                                                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-accent/10 text-accent border border-accent/20">
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
                                                        {/* Desktop (≥768px) — role-select + Remove + window.confirm() */}
                                                        <div className="hidden md:flex items-center gap-2">
                                                            {/* Role Dropdown */}
                                                            <select
                                                                value={memberRole}
                                                                onChange={(e) => handleRoleChange(member.id, e.target.value)}
                                                                className="px-3 py-2 border border-line rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring text-content-primary bg-surface-input"
                                                            >
                                                                <option value="member">Member</option>
                                                                <option value="admin">Admin</option>
                                                            </select>

                                                            {/* Remove Button — desktop entry point uses window.confirm() inside handleRemoveMember */}
                                                            <button
                                                                onClick={() => handleRemoveMember(member.id)}
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
                                                            Make admin/member is single-tap (reversible).
                                                            Remove uses twoTap=true (Phase 65-02 destructive-confirm
                                                            pattern) and routes to handleRemoveMemberConfirmed.
                                                            Transfer Ownership opens the confirm modal (no twoTap —
                                                            the modal IS the confirmation). */}
                                                        <div className="md:hidden">
                                                            <KebabMenu
                                                                ariaLabel="Member actions"
                                                                items={[
                                                                    {
                                                                        label: memberRole === 'admin' ? 'Make member' : 'Make admin',
                                                                        onClick: () => handleRoleChange(
                                                                            member.id,
                                                                            memberRole === 'admin' ? 'member' : 'admin'
                                                                        ),
                                                                    },
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
                                                <span className="px-2 py-1 rounded text-xs font-semibold border bg-amber-100 text-amber-800 border-amber-300">
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

                <div className="mt-6 flex justify-end">
                    <button
                        onClick={modaltoggle}
                        className="btn btn-secondary px-6"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>

        {/* Transfer Ownership confirmation — Phase 69 GROUP-06 frontend.
            Sibling overlay to ManageMembers (NOT nested inside it) so the
            parent's backdrop onClick={modaltoggle} cannot fire when the
            user clicks anywhere on the transfer confirm. zIndex: 110 stacks
            above the parent modal (default ~100). Copy verbatim from CONTEXT
            D-XFER-02. Backdrop click cancels (only when not in-flight). */}
        {transferTarget && (
            <div
                className="modal-overlay"
                style={{ zIndex: 110 }}
                onClick={() => !transferring && setTransferTarget(null)}
            >
                <div
                    className="modal-content max-w-md w-full mx-4 p-6"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className="text-lg font-bold text-content-primary mb-3">
                        Transfer ownership to {transferTarget.name}?
                    </h3>
                    <p className="text-content-secondary mb-6">
                        You will become an admin. This cannot be undone.
                    </p>
                    <div className="flex justify-end gap-3">
                        <button
                            className="btn btn-secondary"
                            disabled={transferring}
                            onClick={() => setTransferTarget(null)}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-primary"
                            disabled={transferring}
                            onClick={async () => {
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
                        </button>
                    </div>
                </div>
            </div>
        )}

        {/* Leave Group confirmation — Phase 69-04 mirror.
            Sibling overlay (NOT nested inside ManageMembers' modal-content) so
            the parent's backdrop onClick={modaltoggle} cannot fire when the
            user clicks anywhere on this confirm. zIndex 110 stacks above the
            parent modal. Copy verbatim from CONTEXT D-LEAVE-04 / Plan 69-04. */}
        {showLeaveConfirm && (
            <div
                className="modal-overlay"
                style={{ zIndex: 110 }}
                onClick={() => !leaving && setShowLeaveConfirm(false)}
            >
                <div
                    className="modal-content max-w-md w-full mx-4 p-6"
                    onClick={(e) => e.stopPropagation()}
                >
                    <h3 className="text-lg font-bold text-content-primary mb-3">
                        Leave <span className="text-accent">{group_name}</span>?
                    </h3>
                    <p className="text-content-secondary mb-4">
                        You will lose access to events, library, and member-only content.
                    </p>
                    {leaveError && (
                        <p className="text-status-error text-sm mb-4">{leaveError}</p>
                    )}
                    <div className="flex justify-end gap-3">
                        <button
                            className="btn btn-secondary"
                            disabled={leaving}
                            onClick={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
                        >
                            Cancel
                        </button>
                        <button
                            className="btn btn-danger"
                            disabled={leaving}
                            onClick={handleLeaveGroupConfirmed}
                        >
                            {leaving ? 'Leaving…' : 'Confirm Leave'}
                        </button>
                    </div>
                </div>
            </div>
        )}

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

