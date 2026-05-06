'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, groupsAPI, invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';

function FriendsPage() {
    const { user, isLoading: authLoading } = useUser();

    // POLL-02: receivedRequests + accept/decline mutators come from the
    // shared FriendshipStatusProvider (mounted at root). NotificationBell
    // and this page now read the same array — accepting in one surface
    // immediately removes the row from the other.
    const {
        receivedRequests,
        acceptRequest: ctxAcceptRequest,
        declineRequest: ctxDeclineRequest,
        loading: friendshipCtxLoading,
    } = useFriendshipStatus();

    // Tab state
    const [activeTab, setActiveTab] = useState('friends');

    // Data state — local copies kept for friends + sent (still owned here)
    const [friends, setFriends] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);

    // Loading state per tab
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [loadingSent, setLoadingSent] = useState(true);

    // Search state
    const [searchEmail, setSearchEmail] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searchError, setSearchError] = useState(null);
    const [searching, setSearching] = useState(false);
    const [requestSent, setRequestSent] = useState(false);
    const [sendingRequest, setSendingRequest] = useState(false);

    // Error state
    const [friendsError, setFriendsError] = useState(null);
    const [sentError, setSentError] = useState(null);

    // Action loading state
    const [actionLoading, setActionLoading] = useState({});

    // Group invite shortcut state
    const [selectedFriends, setSelectedFriends] = useState(new Set());
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [userGroups, setUserGroups] = useState([]);
    const [groupMembers, setGroupMembers] = useState([]);
    const [groupMembersLoading, setGroupMembersLoading] = useState(false);
    const [bulkInviteLoading, setBulkInviteLoading] = useState(false);
    const [bulkInviteResult, setBulkInviteResult] = useState(null);

    // Fetch all data on mount
    useEffect(() => {
        if (user) {
            fetchAllData();
        }
    }, [user]);

    const fetchAllData = async () => {
        // receivedRequests now lives in FriendshipStatusProvider — no local
        // fetch here.
        await Promise.allSettled([
            fetchFriends(),
            fetchSentRequests(),
            fetchUserGroups(),
        ]);
    };

    const fetchUserGroups = async () => {
        try {
            const groups = await groupsAPI.getUserGroups(user.sub);
            const adminGroups = (Array.isArray(groups) ? groups : []).filter(g => {
                const currentUser = g.Users?.find(u => u.user_id === user.sub);
                const role = currentUser?.UserGroup?.role;
                return role === 'owner' || role === 'admin';
            });
            setUserGroups(adminGroups);
        } catch (err) {
            console.error('Error fetching user groups:', err);
            setUserGroups([]);
        }
    };

    const fetchFriends = async () => {
        setLoadingFriends(true);
        setFriendsError(null);
        try {
            const data = await friendshipsAPI.getFriends();
            setFriends(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching friends:', err);
            setFriendsError('Failed to load friends.');
        } finally {
            setLoadingFriends(false);
        }
    };

    const fetchSentRequests = async () => {
        setLoadingSent(true);
        setSentError(null);
        try {
            const data = await friendshipsAPI.getSentRequests();
            setSentRequests(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching sent requests:', err);
            setSentError('Failed to load sent requests.');
        } finally {
            setLoadingSent(false);
        }
    };

    // Search handler
    const handleSearch = async (e) => {
        e.preventDefault();
        if (!searchEmail.trim()) return;

        setSearching(true);
        setSearchResult(null);
        setSearchError(null);
        setRequestSent(false);

        try {
            const result = await friendshipsAPI.searchUserByEmail(searchEmail.trim());
            setSearchResult(result);
        } catch (err) {
            if (err.message && err.message.includes('404')) {
                setSearchError('No user found with that email.');
            } else if (err.message && err.message.includes('No user found')) {
                setSearchError('No user found with that email.');
            } else {
                setSearchError(err.message || 'Search failed. Please try again.');
            }
        } finally {
            setSearching(false);
        }
    };

    // Send friend request
    const handleSendRequest = async (addresseeUserId) => {
        setSendingRequest(true);
        try {
            await friendshipsAPI.sendRequest(addresseeUserId);
            setRequestSent(true);
            // Refresh sent requests list
            fetchSentRequests();
        } catch (err) {
            setSearchError(err.message || 'Failed to send friend request.');
        } finally {
            setSendingRequest(false);
        }
    };

    // Accept friend request — provider handles optimistic removal,
    // 404-stale silencing, and friends-list refresh. Local fetchFriends()
    // still kept since the friends-tab list is owned here (not in the
    // provider's getStatus-only consumer surface).
    const handleAccept = async (friendshipId) => {
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'accept' }));
        try {
            await ctxAcceptRequest(friendshipId);
            fetchFriends();
        } catch (err) {
            console.error('Error accepting request:', err);
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
        }
    };

    // Decline friend request — provider handles optimistic removal +
    // 404-stale silencing. No friends-list refresh needed.
    const handleDecline = async (friendshipId) => {
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'decline' }));
        try {
            await ctxDeclineRequest(friendshipId);
        } catch (err) {
            console.error('Error declining request:', err);
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
        }
    };

    // Remove friend
    const handleRemove = async (friendshipId) => {
        if (!confirm('Are you sure you want to remove this friend?')) return;

        setActionLoading(prev => ({ ...prev, [friendshipId]: 'remove' }));
        try {
            await friendshipsAPI.removeFriend(friendshipId);
            // Optimistically update: remove from friends list
            setFriends(prev => prev.filter(f => f.id !== friendshipId));
        } catch (err) {
            console.error('Error removing friend:', err);
            setFriendsError(err.message || 'Failed to remove friend.');
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
        }
    };

    // Check if a user is already a friend
    const isAlreadyFriend = (userId) => {
        return friends.some(f => f.friend?.user_id === userId);
    };

    // Check if a request is already pending with a user
    const isPendingRequest = (userId) => {
        return sentRequests.some(r => r.Addressee?.user_id === userId) ||
               receivedRequests.some(r => r.Requester?.user_id === userId);
    };

    // Fetch group members when selected group changes
    useEffect(() => {
        if (!selectedGroupId) {
            setGroupMembers([]);
            return;
        }
        setGroupMembersLoading(true);
        setSelectedFriends(new Set());
        groupsAPI.getGroupMembers(selectedGroupId)
            .then(members => {
                const memberList = Array.isArray(members) ? members : members?.members || [];
                const memberUserIds = memberList.map(m => m.user_id);
                setGroupMembers(memberUserIds);
            })
            .catch(() => setGroupMembers([]))
            .finally(() => setGroupMembersLoading(false));
    }, [selectedGroupId]);

    // Toggle a friend in the selectedFriends set
    const toggleFriendSelection = (friendUserId) => {
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

    // Bulk invite handler
    const handleBulkInvite = async () => {
        if (!selectedGroupId || selectedFriends.size === 0) return;
        setBulkInviteLoading(true);
        setBulkInviteResult(null);

        let successCount = 0;
        let failCount = 0;

        for (const friendUserId of selectedFriends) {
            const friendship = friends.find(f => {
                return f.friend?.user_id === friendUserId ||
                       f.Requester?.user_id === friendUserId ||
                       f.Addressee?.user_id === friendUserId;
            });
            const email = friendship?.friend?.email ||
                          friendship?.Requester?.email ||
                          friendship?.Addressee?.email;
            if (email && !groupMembers.includes(friendUserId)) {
                try {
                    await invitesAPI.sendInvite(selectedGroupId, email);
                    successCount++;
                } catch (err) {
                    failCount++;
                }
            }
        }

        setBulkInviteResult({ successCount, failCount });
        setSelectedFriends(new Set());
        setBulkInviteLoading(false);

        // Clear result after 5 seconds
        setTimeout(() => setBulkInviteResult(null), 5000);
    };

    // Get selected group name for feedback messages
    const getSelectedGroupName = () => {
        const group = userGroups.find(g => String(g.id) === String(selectedGroupId));
        return group?.name || 'group';
    };

    // Determine search result display state
    const getSearchResultAction = (foundUser) => {
        if (!foundUser || !foundUser.user_id) return null;

        if (foundUser.user_id === user?.sub) {
            return { type: 'self', label: "That's you!" };
        }
        if (isAlreadyFriend(foundUser.user_id)) {
            return { type: 'already-friends', label: 'Already friends' };
        }
        if (isPendingRequest(foundUser.user_id)) {
            return { type: 'pending', label: 'Request pending' };
        }
        if (requestSent) {
            return { type: 'sent', label: 'Request sent' };
        }
        return { type: 'send', label: 'Send Request' };
    };

    // Loading / not logged in
    if (authLoading) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-btn-primary" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-content-primary mb-4">Friends</h1>
                    <p className="text-content-secondary mb-6">Please log in to view your friends.</p>
                    <a
                        href="/api/auth/login"
                        className="btn btn-primary px-6 py-2 inline-block"
                    >
                        Log In
                    </a>
                </div>
            </div>
        );
    }

    const tabs = [
        { key: 'friends', label: 'Friends', count: friends.length },
        { key: 'requests', label: 'Requests', count: receivedRequests.length },
        { key: 'sent', label: 'Sent', count: sentRequests.length },
    ];

    return (
        <div className="min-h-screen bg-surface-page">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold text-content-primary mb-6">Friends</h1>

                {/* Search Section */}
                <div className="card p-6 mb-6">
                    <h2 className="text-lg font-semibold text-content-primary mb-3">Add Friend</h2>
                    <form onSubmit={handleSearch} className="flex gap-3">
                        <input
                            type="email"
                            value={searchEmail}
                            onChange={(e) => setSearchEmail(e.target.value)}
                            placeholder="Enter friend's email address"
                            className="flex-1 px-4 py-2 border border-line rounded-btn focus:outline-none focus:ring-2 focus:ring-focus-ring text-content-primary bg-surface-input"
                            required
                        />
                        <button
                            type="submit"
                            disabled={searching || !searchEmail.trim()}
                            className="btn btn-primary px-6 py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {searching ? 'Searching...' : 'Search'}
                        </button>
                    </form>

                    {/* Search Result */}
                    {searching && (
                        <div className="mt-4 flex items-center gap-2 text-content-secondary">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-btn-primary" />
                            <span>Searching...</span>
                        </div>
                    )}

                    {searchError && (
                        <div className="mt-4 p-3 bg-surface-page border border-line rounded-lg">
                            <p className="text-content-secondary">{searchError}</p>
                        </div>
                    )}

                    {searchResult && !searching && (
                        <div className="mt-4 p-4 border border-line rounded-lg flex items-center justify-between">
                            <div>
                                <p className="font-semibold text-content-primary">
                                    {searchResult.username || searchResult.email}
                                </p>
                                {searchResult.username && searchResult.email && (
                                    <p className="text-sm text-content-muted">{searchResult.email}</p>
                                )}
                            </div>
                            <div>
                                {(() => {
                                    const action = getSearchResultAction(searchResult);
                                    if (!action) return null;

                                    switch (action.type) {
                                        case 'self':
                                            return (
                                                <span className="text-sm text-content-muted italic">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'already-friends':
                                            return (
                                                <span className="text-sm text-content-muted">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'pending':
                                            return (
                                                <span className="text-sm text-content-muted">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'sent':
                                            return (
                                                <span className="flex items-center gap-1 text-sm text-status-success font-medium">
                                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    {action.label}
                                                </span>
                                            );
                                        case 'send':
                                            return (
                                                <button
                                                    onClick={() => handleSendRequest(searchResult.user_id)}
                                                    disabled={sendingRequest}
                                                    className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50"
                                                >
                                                    {sendingRequest ? 'Sending...' : 'Send Request'}
                                                </button>
                                            );
                                        default:
                                            return null;
                                    }
                                })()}
                            </div>
                        </div>
                    )}
                </div>

                {/* Tabs */}
                <div className="border-b border-line mb-6">
                    <div className="flex gap-8">
                        {tabs.map(({ key, label, count }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`pb-3 text-sm font-medium transition-colors relative ${
                                    activeTab === key
                                        ? 'border-b-2 border-btn-primary text-btn-primary'
                                        : 'text-content-secondary hover:text-content-primary'
                                }`}
                            >
                                {label}
                                {count > 0 && (
                                    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                                        activeTab === key
                                            ? 'bg-surface-card-hover text-content-link'
                                            : 'bg-surface-card-hover text-content-secondary'
                                    }`}>
                                        {count}
                                    </span>
                                )}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Friends Tab */}
                {activeTab === 'friends' && (
                    <div>
                        {friendsError && (
                            <p className="text-status-error text-sm mb-4">{friendsError}</p>
                        )}
                        {loadingFriends ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading friends...</span>
                            </div>
                        ) : friends.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-content-muted">No friends yet. Search for friends by email above!</p>
                            </div>
                        ) : (
                            <div>
                                {/* Group Invite Bulk Action Bar */}
                                {userGroups.length > 0 && (
                                    <div className="mb-4 p-4 card">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label htmlFor="group-invite-select" className="text-sm font-medium text-content-secondary">
                                                Invite to Group:
                                            </label>
                                            <select
                                                id="group-invite-select"
                                                value={selectedGroupId}
                                                onChange={(e) => setSelectedGroupId(e.target.value)}
                                                className="flex-1 min-w-[180px] max-w-xs px-3 py-2 border border-line rounded-btn text-sm text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
                                            >
                                                <option value="" disabled>Select a group...</option>
                                                {userGroups.map(group => (
                                                    <option key={group.id} value={group.id}>
                                                        {group.name}
                                                    </option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={handleBulkInvite}
                                                disabled={!selectedGroupId || selectedFriends.size === 0 || bulkInviteLoading}
                                                className="btn btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {bulkInviteLoading && (
                                                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                                )}
                                                Invite to Group
                                            </button>
                                            {selectedFriends.size > 0 && (
                                                <span className="text-sm text-content-muted">
                                                    {selectedFriends.size} selected
                                                </span>
                                            )}
                                        </div>
                                        {groupMembersLoading && (
                                            <div className="mt-2 flex items-center gap-2 text-xs text-content-muted">
                                                <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-content-muted" />
                                                <span>Loading group members...</span>
                                            </div>
                                        )}
                                        {/* Bulk invite result feedback */}
                                        {bulkInviteResult && (
                                            <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${
                                                bulkInviteResult.failCount === 0
                                                    ? 'bg-status-success/10 text-status-success border border-status-success/20'
                                                    : bulkInviteResult.successCount > 0
                                                        ? 'bg-status-warning/10 text-status-warning border border-status-warning/20'
                                                        : 'bg-status-error/10 text-status-error border border-status-error/20'
                                            }`}>
                                                {bulkInviteResult.failCount === 0
                                                    ? `Invited ${bulkInviteResult.successCount} friend(s) to ${getSelectedGroupName()}!`
                                                    : bulkInviteResult.successCount > 0
                                                        ? `Invited ${bulkInviteResult.successCount} friend(s), ${bulkInviteResult.failCount} failed`
                                                        : 'Failed to send invites. Please try again.'
                                                }
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Friend rows with checkboxes */}
                                <div className="space-y-3">
                                    {friends.map((friendship) => {
                                        const friend = friendship.friend;
                                        if (!friend) return null;

                                        const friendUserId = friend.user_id;
                                        const isInGroup = selectedGroupId && groupMembers.includes(friendUserId);
                                        const checkboxDisabled = !selectedGroupId || isInGroup;

                                        return (
                                            <div
                                                key={friendship.id}
                                                className="flex items-center justify-between p-4 border border-line rounded-card hover:bg-surface-card-hover"
                                            >
                                                <div className="flex items-center gap-3 flex-1">
                                                    <input
                                                        type="checkbox"
                                                        checked={isInGroup || selectedFriends.has(friendUserId)}
                                                        disabled={checkboxDisabled}
                                                        onChange={() => toggleFriendSelection(friendUserId)}
                                                        className={`h-4 w-4 rounded border-line text-btn-primary focus:ring-focus-ring ${
                                                            checkboxDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                                        }`}
                                                    />
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-semibold text-content-primary">
                                                                {friend.username || friend.email}
                                                            </p>
                                                            {isInGroup && (
                                                                <span className="text-xs text-content-muted italic">(already in group)</span>
                                                            )}
                                                        </div>
                                                        {friend.email && friend.email !== friend.username && (
                                                            <p className="text-sm text-content-muted mt-0.5">{friend.email}</p>
                                                        )}
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => handleRemove(friendship.id)}
                                                    disabled={actionLoading[friendship.id] === 'remove'}
                                                    className="text-status-error hover:text-status-error/80 text-sm font-medium transition-colors disabled:opacity-50"
                                                >
                                                    {actionLoading[friendship.id] === 'remove' ? 'Removing...' : 'Remove'}
                                                </button>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Requests Tab — receivedRequests + loading flag come
                    from FriendshipStatusProvider context (POLL-02). The
                    provider's `error` flag is intentionally not surfaced
                    here since the global provider handles transient
                    failures (loadError stays internal — getStatus returns
                    'unknown' to consumers). If the provider fails to load
                    receivedRequests will be [] and the empty-state copy
                    renders, which is the correct UX for a transient
                    network blip on this surface. */}
                {activeTab === 'requests' && (
                    <div>
                        {friendshipCtxLoading ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading requests...</span>
                            </div>
                        ) : receivedRequests.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-content-muted">No pending friend requests.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {receivedRequests.map((request) => {
                                    const requester = request.Requester;
                                    if (!requester) return null;

                                    return (
                                        <div
                                            key={request.id}
                                            className="flex items-center justify-between p-4 border border-line rounded-card hover:bg-surface-card-hover"
                                        >
                                            <div className="flex-1">
                                                <p className="font-semibold text-content-primary">
                                                    {requester.username || requester.email}
                                                </p>
                                                {requester.email && requester.email !== requester.username && (
                                                    <p className="text-sm text-content-muted mt-0.5">{requester.email}</p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleAccept(request.id)}
                                                    disabled={!!actionLoading[request.id]}
                                                    className="btn btn-primary px-4 py-2 text-sm disabled:opacity-50"
                                                >
                                                    {actionLoading[request.id] === 'accept' ? 'Accepting...' : 'Accept'}
                                                </button>
                                                <button
                                                    onClick={() => handleDecline(request.id)}
                                                    disabled={!!actionLoading[request.id]}
                                                    className="btn btn-secondary px-4 py-2 text-sm disabled:opacity-50"
                                                >
                                                    {actionLoading[request.id] === 'decline' ? 'Declining...' : 'Decline'}
                                                </button>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Sent Tab */}
                {activeTab === 'sent' && (
                    <div>
                        {sentError && (
                            <p className="text-status-error text-sm mb-4">{sentError}</p>
                        )}
                        {loadingSent ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading sent requests...</span>
                            </div>
                        ) : sentRequests.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-content-muted">No sent friend requests.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {sentRequests.map((request) => {
                                    const addressee = request.Addressee;
                                    if (!addressee) return null;

                                    return (
                                        <div
                                            key={request.id}
                                            className="flex items-center justify-between p-4 border border-line rounded-card"
                                        >
                                            <div className="flex-1">
                                                <p className="font-semibold text-content-primary">
                                                    {addressee.username || addressee.email}
                                                </p>
                                                {addressee.email && addressee.email !== addressee.username && (
                                                    <p className="text-sm text-content-muted mt-0.5">{addressee.email}</p>
                                                )}
                                            </div>
                                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-status-warning/10 text-status-warning border border-status-warning/30">
                                                Pending
                                            </span>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}

export default FriendsPage;
