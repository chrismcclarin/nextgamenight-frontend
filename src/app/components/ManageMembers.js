'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, invitesAPI, API_BASE_URL } from '../../lib/api';

function ManageMembers({ group_id, user, modal, modaltoggle, onMembersUpdated, group_name }) {
    const router = useRouter();
    const [members, setMembers] = useState([]);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [error, setError] = useState(null);
    const [pendingInvites, setPendingInvites] = useState([]);
    const [pendingLoading, setPendingLoading] = useState(false);

    useEffect(() => {
        if (modal && group_id && user?.sub) {
            fetchMembers();
        }
    }, [modal, group_id, user?.sub]);

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

            // Find current user's role
            const currentUserMember = data.find(m => m.user_id === user.sub);
            if (currentUserMember && currentUserMember.UserGroup) {
                setUserRole(currentUserMember.UserGroup.role);
            }

            // Fetch pending invites (only succeeds for owner/admin)
            try {
                setPendingLoading(true);
                const invites = await invitesAPI.getGroupPendingInvites(group_id);
                setPendingInvites(Array.isArray(invites) ? invites : []);
            } catch (inviteErr) {
                // 403 means user is not owner/admin -- that's expected
                setPendingInvites([]);
            } finally {
                setPendingLoading(false);
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
            await groupsAPI.updateUserRole(group_id, target_user_id, user.sub, newRole);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
        } catch (error) {
            console.error('Error updating role:', error);
            alert(error.message || 'Failed to update user role. Please try again.');
        }
    };

    const handleRemoveMember = async (target_user_id) => {
        if (!group_id || !user?.sub) return;
        
        if (!confirm('Are you sure you want to remove this user from the group?')) {
            return;
        }
        
        try {
            await groupsAPI.removeUserFromGroup(group_id, target_user_id, user.sub);
            await fetchMembers(); // Refresh the list
            if (onMembersUpdated) {
                onMembersUpdated();
            }
        } catch (error) {
            console.error('Error removing member:', error);
            alert(error.message || 'Failed to remove user. Please try again.');
        }
    };

    const handleApproveMember = async (target_user_id) => {
        if (!group_id) return;
        try {
            await groupsAPI.approveMember(group_id, target_user_id);
            await fetchMembers();
            if (onMembersUpdated) onMembersUpdated();
        } catch (error) {
            console.error('Error approving member:', error);
            alert(error.message || 'Failed to approve member. Please try again.');
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
            alert(error.message || 'Failed to reject member. Please try again.');
        }
    };

    const handleLeaveGroup = async () => {
        if (!group_id) return;
        if (!confirm(`Are you sure you want to leave ${group_name}?`)) {
            return;
        }
        try {
            await groupsAPI.leaveGroup(group_id);
            modaltoggle(); // Close the modal
            router.push('/');
        } catch (error) {
            console.error('Error leaving group:', error);
            alert(error.message || 'Failed to leave group. Please try again.');
        }
    };

    const getRoleBadge = (role) => {
        const roleStyles = {
            owner: 'bg-purple-100 text-purple-800 border-purple-300',
            admin: 'bg-blue-100 text-blue-800 border-blue-300',
            member: 'bg-gray-100 text-gray-800 border-gray-300',
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
        <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
            <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
                <button
                    onClick={modaltoggle}
                    className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl"
                    aria-label="Close"
                >
                    &times;
                </button>

                <h2 className="text-2xl font-bold text-gray-900 mb-4">Manage Group Members</h2>

                {!canManageMembers && (
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4 mb-4">
                        <p className="text-yellow-800 text-sm">
                            Only the group owner or admins can manage member roles and remove members.
                        </p>
                    </div>
                )}

                {loading ? (
                    <p className="text-gray-600">Loading members...</p>
                ) : error ? (
                    <p className="text-red-600">{error}</p>
                ) : members.length === 0 ? (
                    <p className="text-gray-600">No members found.</p>
                ) : (
                    <>
                        {/* Pending Members Section (admin/owner only) */}
                        {canManageMembers && members.filter(m => m.UserGroup?.role === 'pending').length > 0 && (
                            <div className="mb-6">
                                <div className="flex items-center gap-2 mb-2">
                                    <h3 className="text-lg font-semibold text-gray-900">Pending Members</h3>
                                    <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                        {members.filter(m => m.UserGroup?.role === 'pending').length}
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500 mb-3">Auto-approved after 24h</p>
                                <div className="space-y-3">
                                    {members.filter(m => m.UserGroup?.role === 'pending').map((member) => (
                                        <div key={member.id} className="flex items-center justify-between p-4 border border-amber-200 rounded-lg bg-amber-50">
                                            <div className="flex items-center gap-3 flex-1">
                                                <div className="flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <p className="font-semibold text-gray-900">{member.username || member.email}</p>
                                                        {getRoleBadge('pending')}
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleApproveMember(member.user_id)}
                                                    className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 transition-colors text-sm"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleRejectMember(member.user_id)}
                                                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm"
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
                                const isCurrentUser = member.user_id === user?.sub;
                                const isOwner = memberRole === 'owner';

                                return (
                                    <div
                                        key={member.id}
                                        className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                                    >
                                        <div className="flex items-center gap-3 flex-1">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-gray-900">
                                                        {member.username || member.email}
                                                    </p>
                                                    {isCurrentUser && (
                                                        <span className="text-xs text-blue-600 font-medium">(You)</span>
                                                    )}
                                                    {getRoleBadge(memberRole)}
                                                </div>
                                                {member.email && member.email !== member.username && (
                                                    <p className="text-sm text-gray-600 mt-1">{member.email}</p>
                                                )}
                                            </div>
                                        </div>

                                        {canManageMembers && !isCurrentUser && (
                                            <div className="flex items-center gap-2">
                                                {/* Role Dropdown */}
                                                <select
                                                    value={memberRole}
                                                    onChange={(e) => handleRoleChange(member.user_id, e.target.value)}
                                                    className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 text-gray-900 bg-white"
                                                    disabled={isOwner}
                                                >
                                                    <option value="member">Member</option>
                                                    <option value="admin">Admin</option>
                                                    {isOwner && <option value="owner">Owner</option>}
                                                </select>

                                                {/* Remove Button */}
                                                <button
                                                    onClick={() => handleRemoveMember(member.user_id)}
                                                    className="bg-red-600 text-white px-4 py-2 rounded-lg hover:bg-red-700 transition-colors text-sm"
                                                    disabled={isOwner}
                                                    title={isOwner ? 'Cannot remove group owner' : 'Remove from group'}
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        )}

                                        {isCurrentUser && !isOwner && (
                                            <button
                                                onClick={handleLeaveGroup}
                                                className="bg-red-100 text-red-700 px-4 py-2 rounded-lg hover:bg-red-200 transition-colors text-sm border border-red-300"
                                            >
                                                Leave Group
                                            </button>
                                        )}
                                        {isCurrentUser && isOwner && (
                                            <p className="text-sm text-gray-500 italic">Your role</p>
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
                            <h3 className="text-lg font-semibold text-gray-900">Pending Invites</h3>
                            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
                                {pendingInvites.length}
                            </span>
                        </div>
                        <div className="space-y-3">
                            {pendingInvites.map((invite) => (
                                <div
                                    key={invite.id}
                                    className="flex items-center justify-between p-4 border border-gray-200 rounded-lg bg-amber-50"
                                >
                                    <div className="flex items-center gap-3 flex-1">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2">
                                                <p className="font-semibold text-gray-900">
                                                    {invite.invited_email}
                                                </p>
                                                <span className="px-2 py-1 rounded text-xs font-semibold border bg-amber-100 text-amber-800 border-amber-300">
                                                    Pending
                                                </span>
                                            </div>
                                            <div className="text-sm text-gray-600 mt-1">
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
                        className="bg-gray-200 text-gray-800 px-6 py-2 rounded-lg hover:bg-gray-300 transition-colors"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
}

export default ManageMembers;

