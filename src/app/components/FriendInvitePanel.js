'use client';
import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, invitesAPI, groupsAPI } from '../../lib/api';
import { QRCodeSVG } from 'qrcode.react';

function FriendInvitePanel({ group, open, onClose, onMemberAdded, isAdmin = false }) {
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

    // Add friend prompt state
    const [friendPrompt, setFriendPrompt] = useState(null); // { user_id, username, email }
    const [addingFriend, setAddingFriend] = useState(false);
    const [friendRequestSent, setFriendRequestSent] = useState(false);

    // QR code invite state
    const [inviteUrl, setInviteUrl] = useState(null);
    const [tokenLoading, setTokenLoading] = useState(false);
    const [copied, setCopied] = useState(false);
    const [resetting, setResetting] = useState(false);

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

    // Fetch invite token for QR code when panel opens
    useEffect(() => {
        if (open && group?.id) {
            setTokenLoading(true);
            groupsAPI.getInviteToken(group.id)
                .then(data => setInviteUrl(data.invite_url))
                .catch(() => setInviteUrl(null))
                .finally(() => setTokenLoading(false));
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
            setFriendPrompt(null);
            setFriendRequestSent(false);
            setInviteUrl(null);
            setCopied(false);
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
            // Skip anyone already in the group; otherwise invite by user_id.
            // The friend's email is resolved server-side (83-06 PII default-deny).
            if (groupMemberIds.includes(friendUserId)) continue;
            try {
                await invitesAPI.sendFriendInvite(group.id, friendUserId);
                successCount++;
            } catch {
                failCount++;
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

        const invitedEmail = email.trim();
        setEmailLoading(true);
        setEmailError('');
        setEmailSuccess('');
        setFriendPrompt(null);
        setFriendRequestSent(false);

        try {
            await invitesAPI.sendInvite(group.id, invitedEmail);
            setEmailSuccess(`Invite sent to ${invitedEmail}`);
            setEmail('');
            if (onMemberAdded) onMemberAdded();

            // Check if this person is a registered user and not already a friend
            const isAlreadyFriend = friends.some(f => f.friend?.email === invitedEmail);
            if (!isAlreadyFriend) {
                try {
                    const foundUser = await friendshipsAPI.searchUserByEmail(invitedEmail);
                    if (foundUser && foundUser.user_id && foundUser.user_id !== user?.sub) {
                        setFriendPrompt({
                            user_id: foundUser.user_id,
                            username: foundUser.username,
                            email: foundUser.email,
                        });
                    }
                } catch {
                    // User not found or search failed — no prompt, that's fine
                }
            }
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

    const handleAddFriend = async () => {
        if (!friendPrompt?.user_id) return;
        setAddingFriend(true);
        try {
            await friendshipsAPI.sendRequest(friendPrompt.user_id);
            setFriendRequestSent(true);
        } catch {
            // Silently fail — they may already have a pending request
            setFriendRequestSent(true);
        } finally {
            setAddingFriend(false);
        }
    };

    const handleCopyLink = async () => {
        if (!inviteUrl) return;
        try {
            await navigator.clipboard.writeText(inviteUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy link:', err);
        }
    };

    const handleResetInviteLink = async () => {
        if (!group?.id || resetting) return;
        if (!window.confirm('Reset invite link? The current QR code and link will stop working.')) return;
        setResetting(true);
        try {
            const data = await groupsAPI.resetInviteToken(group.id);
            setInviteUrl(data.invite_url);
        } catch (err) {
            console.error('Failed to reset invite token:', err);
            alert(err.message || 'Failed to reset invite link. Please try again.');
        } finally {
            setResetting(false);
        }
    };

    if (!open) return null;

    const availableFriends = friends.filter(f => f.friend);
    const selectableCount = availableFriends.filter(f => !groupMemberIds.includes(f.friend.user_id)).length;

    const body = (
        <>
                    {/* Friends section */}
                    <div className="p-5">
                        <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
                            Your Friends
                        </h3>

                        {loadingFriends || loadingMembers ? (
                            <div className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                <span>Loading...</span>
                            </div>
                        ) : availableFriends.length === 0 ? (
                            <div className="text-center py-6">
                                <p className="text-content-muted text-sm">No friends yet.</p>
                                <a href="/friends" className="text-content-link text-sm hover:underline mt-1 inline-block">
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
                                                    ? 'border-line bg-surface-page cursor-default'
                                                    : selectedFriends.has(friend.user_id)
                                                        ? 'border-accent bg-surface-card-hover cursor-pointer'
                                                        : 'border-line hover:bg-surface-card-hover cursor-pointer'
                                            }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={isInGroup || selectedFriends.has(friend.user_id)}
                                                disabled={isInGroup}
                                                onChange={() => toggleFriend(friend.user_id)}
                                                className="h-4 w-4 rounded border-line text-accent focus:ring-focus-ring disabled:opacity-40"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <p className={`font-medium truncate ${isInGroup ? 'text-content-muted' : 'text-content-primary'}`}>
                                                    {friend.username}
                                                </p>
                                                {/* Friend email is no longer exposed in the friends payload (Phase 83-06 PII default-deny); invites resolve it server-side by user_id. */}
                                            </div>
                                            {isInGroup && (
                                                <span className="text-xs text-content-muted italic flex-shrink-0">
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
                                    className="w-full btn btn-primary py-2.5 flex items-center justify-center gap-2"
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
                                            ? 'bg-status-success/10 text-status-success border border-line'
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
                            <div className="flex-1 border-t border-line" />
                            <span className="text-xs text-content-muted uppercase tracking-wide">or</span>
                            <div className="flex-1 border-t border-line" />
                        </div>
                    </div>

                    {/* Email invite section */}
                    <div className="p-5">
                        <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
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
                                className="flex-1 px-3 py-2.5 border border-line rounded-lg text-sm text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-accent disabled:opacity-50"
                            />
                            <button
                                type="submit"
                                disabled={emailLoading || !email.trim()}
                                className="btn btn-primary text-sm py-2.5 flex-shrink-0"
                            >
                                {emailLoading ? 'Sending...' : 'Send'}
                            </button>
                        </form>
                        {emailError && (
                            <p className="text-red-500 text-sm mt-2">{emailError}</p>
                        )}
                        {emailSuccess && (
                            <p className="text-status-success text-sm mt-2">{emailSuccess}</p>
                        )}
                        {friendPrompt && !friendRequestSent && (
                            <div className="mt-3 p-3 bg-surface-card-hover border border-line rounded-lg flex items-center justify-between gap-3">
                                <p className="text-sm text-content-primary">
                                    Add <span className="font-medium">{friendPrompt.username || friendPrompt.email}</span> as a friend?
                                </p>
                                <button
                                    onClick={handleAddFriend}
                                    disabled={addingFriend}
                                    className="btn btn-primary text-xs px-3 py-1.5 flex-shrink-0"
                                >
                                    {addingFriend ? 'Sending...' : 'Add Friend'}
                                </button>
                            </div>
                        )}
                        {friendRequestSent && (
                            <p className="text-status-success text-sm mt-2">Friend request sent!</p>
                        )}
                    </div>

                    {/* QR Code invite section -- only when group context exists */}
                    {group?.id && (
                        <>
                            {/* Divider */}
                            <div className="px-5">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 border-t border-line" />
                                    <span className="text-xs text-content-muted uppercase tracking-wide">or</span>
                                    <div className="flex-1 border-t border-line" />
                                </div>
                            </div>

                            {/* QR Code section */}
                            <div className="p-5">
                                <h3 className="text-sm font-semibold text-content-muted uppercase tracking-wide mb-3">
                                    Share QR Code
                                </h3>
                                {tokenLoading ? (
                                    <div className="flex items-center gap-2 text-content-muted py-6 justify-center">
                                        <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-accent" />
                                        <span>Loading...</span>
                                    </div>
                                ) : inviteUrl ? (
                                    <div className="flex flex-col items-center">
                                        <QRCodeSVG value={inviteUrl} size={160} level="M" marginSize={2} />
                                        <p className="text-xs text-content-muted mt-2 text-center">
                                            Scan to join group
                                        </p>
                                        <button
                                            onClick={handleCopyLink}
                                            className="mt-3 w-full btn btn-primary py-2.5 text-center text-sm"
                                        >
                                            {copied ? 'Copied!' : 'Copy Invite Link'}
                                        </button>
                                        {/* Reset invite link — admin-only per Phase 69 CONTEXT D-INV-02.
                                            Rendered (not just disabled) only for owner/admin so non-admins
                                            don't see the button at all. */}
                                        {isAdmin && (
                                            <button
                                                onClick={handleResetInviteLink}
                                                disabled={resetting}
                                                className="mt-2 w-full btn btn-secondary py-2 text-xs text-status-error"
                                                title="Invalidate the current invite link and generate a new one"
                                            >
                                                {resetting ? 'Resetting…' : 'Reset invite link'}
                                            </button>
                                        )}
                                    </div>
                                ) : (
                                    <p className="text-content-muted text-sm text-center py-4">
                                        Unable to generate QR code
                                    </p>
                                )}
                            </div>
                        </>
                    )}
        </>
    );

    return (
        <>
            {/* Backdrop — z-[60] so it stacks above .modal-overlay (z-50) when
                opened from inside another modal (e.g. ManageMembers). Clicking
                the backdrop closes only this panel; the parent modal's overlay
                no longer receives the click. */}
            <div
                className="fixed inset-0 bg-black bg-opacity-50 z-[60] transition-opacity"
                onClick={onClose}
            />

            {/* Sliding panel — z-[70] above its own backdrop. */}
            <div className="fixed inset-y-0 right-0 w-full max-w-md bg-surface-card shadow-xl z-[70] flex flex-col animate-slide-in-right">
                {/* Header */}
                <div className="flex items-center justify-between p-5 border-b border-line">
                    <div>
                        <h2 className="text-xl font-bold text-content-primary">Invite Members</h2>
                        {group?.name && (
                            <p className="text-sm text-content-muted mt-0.5">to {group.name}</p>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        className="text-content-muted hover:text-content-secondary text-2xl leading-none p-1"
                    >
                        &times;
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto">
                    {body}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-line">
                    <button
                        onClick={onClose}
                        className="w-full btn btn-secondary py-2.5"
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
