'use client';
import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, invitesAPI, groupsAPI } from '../../lib/api';

function FriendInvitePanel({ group, open, onClose, onMemberAdded }) {
    const { user } = useUser();

    const [friends, setFriends] = useState([]);
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [groupMemberIds, setGroupMemberIds] = useState([]);
    const [loadingMembers, setLoadingMembers] = useState(false);

    const [selectedFriends, setSelectedFriends] = useState(new Set());
    const [inviting, setInviting] = useState(false);
    const [inviteResult, setInviteResult] = useState(null);

    // Email invite state
    const [email, setEmail] = useState('');
    const [emailLoading, setEmailLoading] = useState(false);
    const [emailError, setEmailError] = useState('');
    const [emailSuccess, setEmailSuccess] = useState('');

    // Fetch friends on open
    useEffect(() => {
        if (open && user) {
            setLoadingFriends(true);
            friendshipsAPI.getFriends()
                .then(data => setFriends(Array.isArray(data) ? data : []))
                .catch(() => setFriends([]))
                .finally(() => setLoadingFriends(false));
        }
    }, [open, user]);

    // Fetch group members when group changes
    useEffect(() => {
        if (open && group?.id) {
            setLoadingMembers(true);
            setSelectedFriends(new Set());
            setInviteResult(null);
            groupsAPI.getGroupMembers(group.id)
                .then(members => {
                    const memberList = Array.isArray(members) ? members : members?.members || [];
                    setGroupMemberIds(memberList.map(m => m.user_id));
                })
                .catch(() => setGroupMemberIds([]))
                .finally(() => setLoadingMembers(false));
        } else {
            setGroupMemberIds([]);
        }
    }, [open, group?.id]);

    // Reset state when panel closes
    useEffect(() => {
        if (!open) {
            setSelectedFriends(new Set());
            setInviteResult(null);
            setEmail('');
            setEmailError('');
            setEmailSuccess('');
        }
    }, [open]);

    const toggleFriend = (friendUserId) => {
        setSelectedFriends(prev => {
            const next = new Set(prev);
            if (next.has(friendUserId)) {
                next.delete(friendUserId);
            } else {
                next.add(friendUserId);
            }
            return next;
        });
    };

    const handleBulkInvite = async () => {
        if (!group?.id || selectedFriends.size === 0) return;
        setInviting(true);
        setInviteResult(null);

        let successCount = 0;
        let failCount = 0;

        for (const friendUserId of selectedFriends) {
            const friendship = friends.find(f => f.friend?.user_id === friendUserId);
            const friendEmail = friendship?.friend?.email;
            if (friendEmail && !groupMemberIds.includes(friendUserId)) {
                try {
                    await invitesAPI.sendInvite(group.id, friendEmail);
                    successCount++;
                } catch {
                    failCount++;
                }
            }
        }

        setInviteResult({ successCount, failCount });
        setSelectedFriends(new Set());
        setInviting(false);

        if (successCount > 0 && onMemberAdded) {
            onMemberAdded();
        }
    };

    const handleEmailInvite = async (e) => {
        e.preventDefault();
        if (!email.trim() || !group?.id) return;

        setEmailLoading(true);
        setEmailError('');
        setEmailSuccess('');

        try {
            await invitesAPI.sendInvite(group.id, email.trim());
            setEmailSuccess(`Invite sent to ${email.trim()}`);
            setEmail('');
            if (onMemberAdded) onMemberAdded();
            setTimeout(() => setEmailSuccess(''), 5000);
        } catch (err) {
            const message = err.message || '';
            if (message.includes('already a member')) {
                setEmailError('This person is already a member of the group');
            } else if (message.includes('pending invite') || message.includes('already been invited')) {
                setEmailError('This person already has a pending invite');
            } else {
                setEmailError('Failed to send invite');
            }
        } finally {
            setEmailLoading(false);
        }
    };

    if (!open) return null;

    const availableFriends = friends.filter(f => f.friend);
    const selectableCount = availableFriends.filter(f => !groupMemberIds.includes(f.friend.user_id)).length;

    return (
        <>
            {/* Backdrop */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity"
                onClick={onClose}
            />

            {/* Sliding panel */}
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-white shadow-xl z-50 flex flex-col animate-slide-in-right">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-gray-200">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900">Invite Members</h2>
                        {group?.name && (
                            <p className="text-sm text-gray-500 mt-0.5">to {group.name}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="text-gray-400 hover:text-gray-600 text-2xl leading-none p-1"
                    >
                        &times;
                    </button>
                </div>

                {/* Friends list */}
                <div className="flex-1 overflow-y-auto">
                    {/* Friends section */}
                    <div className="p-5">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Your Friends
                        </h3>

                        {loadingFriends || loadingMembers ? (
                            <div className="flex items-center gap-2 text-gray-500 py-6 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
                                <span>Loading...</span>
                            </div>
                        ) : availableFriends.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-gray-500 text-sm">No friends yet.</p>
                                <a href="/friends" className="text-emerald-600 text-sm hover:underline mt-1 inline-block">
                                    Add friends
                                </a>
                            </div>
                        ) : (
                            <div className="space-y-2">
                                {availableFriends.map(friendship => {
                                    const friend = friendship.friend;
                                    const isInGroup = groupMemberIds.includes(friend.user_id);

                                    return (
                                        <label
                                            key={friendship.id}
                                            className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                                                isInGroup
                                                    ? 'border-gray-100 bg-gray-50 cursor-default'
                                                    : selectedFriends.has(friend.user_id)
                                                        ? 'border-emerald-300 bg-emerald-50 cursor-pointer'
                                                        : 'border-gray-200 hover:bg-gray-50 cursor-pointer'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isInGroup || selectedFriends.has(friend.user_id)}
                                                disabled={isInGroup}
                                                onChange={() => toggleFriend(friend.user_id)}
                                                className="h-4 w-4 rounded border-gray-300 text-emerald-600 focus:ring-emerald-500 disabled:opacity-40"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-medium truncate ${isInGroup ? 'text-gray-400' : 'text-gray-900'}`}>
                                                    {friend.username || friend.email}
                                                </p>
                                                {friend.email && friend.email !== friend.username && (
                                                    <p className={`text-xs truncate ${isInGroup ? 'text-gray-300' : 'text-gray-500'}`}>
                                                        {friend.email}
                                                    </p>
                                                )}
                                            </div>
                                            {isInGroup && (
                                                <span className="text-xs text-gray-400 italic flex-shrink-0">
                                                    In group
                                                </span>
                                            )}
                                        </label>
                                    );
                                })}
                            </div>
                        )}

                        {/* Bulk invite button */}
                        {selectableCount > 0 && (
                            <div className="mt-4">
                                <button
                                    onClick={handleBulkInvite}
                                    disabled={selectedFriends.size === 0 || inviting}
                                    className="w-full px-4 py-2.5 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                                >
                                    {inviting && (
                                        <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                    )}
                                    {inviting
                                        ? 'Sending...'
                                        : selectedFriends.size > 0
                                            ? `Invite ${selectedFriends.size} Friend${selectedFriends.size !== 1 ? 's' : ''}`
                                            : 'Select friends to invite'}
                                </button>

                                {inviteResult && (
                                    <div className={`mt-2 p-3 rounded-lg text-sm font-medium ${
                                        inviteResult.failCount === 0
                                            ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                                            : inviteResult.successCount > 0
                                                ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                                : 'bg-red-50 text-red-700 border border-red-200'
                                    }`}>
                                        {inviteResult.failCount === 0
                                            ? `Invited ${inviteResult.successCount} friend${inviteResult.successCount !== 1 ? 's' : ''}!`
                                            : inviteResult.successCount > 0
                                                ? `Invited ${inviteResult.successCount}, ${inviteResult.failCount} failed`
                                                : 'Failed to send invites. Please try again.'}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Divider */}
                    <div className="px-5">
                        <div className="flex items-center gap-3">
                            <div className="flex-1 border-t border-gray-200" />
                            <span className="text-xs text-gray-400 uppercase tracking-wide">or</span>
                            <div className="flex-1 border-t border-gray-200" />
                        </div>
                    </div>

                    {/* Email invite section */}
                    <div className="p-5">
                        <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-3">
                            Invite by Email
                        </h3>
                        <form onSubmit={handleEmailInvite} className="flex gap-2">
                            <input
                                type="email"
                                value={email}
                                onChange={(e) => {
                                    setEmail(e.target.value);
                                    setEmailError('');
                                    setEmailSuccess('');
                                }}
                                placeholder="user@example.com"
                                required
                                disabled={emailLoading}
                                className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={emailLoading || !email.trim()}
                                className="px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex-shrink-0"
                            >
                                {emailLoading ? 'Sending...' : 'Send'}
                            </button>
                        </form>
                        {emailError && (
                            <p className="text-red-500 text-sm mt-2">{emailError}</p>
                        )}
                        {emailSuccess && (
                            <p className="text-emerald-600 text-sm mt-2">{emailSuccess}</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-gray-200">
                    <button
                        onClick={onClose}
                        className="w-full px-4 py-2.5 text-gray-700 font-medium rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
                    >
                        Done
                    </button>
                </div>
            </div>

            {/* Slide-in animation */}
            <style jsx>{`
                @keyframes slideInRight {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                .animate-slide-in-right {
                    animation: slideInRight 0.25s ease-out;
                }
            `}</style>
        </>
    );
}

export default FriendInvitePanel;
