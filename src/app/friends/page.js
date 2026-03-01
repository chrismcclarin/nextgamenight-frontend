'use client';

import { useState, useEffect } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI } from '../../lib/api';

function FriendsPage() {
    const { user, isLoading: authLoading } = useUser();

    // Tab state
    const [activeTab, setActiveTab] = useState('friends');

    // Data state
    const [friends, setFriends] = useState([]);
    const [receivedRequests, setReceivedRequests] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);

    // Loading state per tab
    const [loadingFriends, setLoadingFriends] = useState(true);
    const [loadingReceived, setLoadingReceived] = useState(true);
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
    const [receivedError, setReceivedError] = useState(null);
    const [sentError, setSentError] = useState(null);

    // Action loading state
    const [actionLoading, setActionLoading] = useState({});

    // Fetch all data on mount
    useEffect(() => {
        if (user) {
            fetchAllData();
        }
    }, [user]);

    const fetchAllData = async () => {
        const [friendsResult, receivedResult, sentResult] = await Promise.allSettled([
            fetchFriends(),
            fetchReceivedRequests(),
            fetchSentRequests(),
        ]);
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

    const fetchReceivedRequests = async () => {
        setLoadingReceived(true);
        setReceivedError(null);
        try {
            const data = await friendshipsAPI.getReceivedRequests();
            setReceivedRequests(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching received requests:', err);
            setReceivedError('Failed to load friend requests.');
        } finally {
            setLoadingReceived(false);
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

    // Accept friend request
    const handleAccept = async (friendshipId) => {
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'accept' }));
        try {
            await friendshipsAPI.acceptRequest(friendshipId);
            // Optimistically update: remove from received, refresh friends
            setReceivedRequests(prev => prev.filter(r => r.id !== friendshipId));
            fetchFriends();
        } catch (err) {
            console.error('Error accepting request:', err);
            setReceivedError(err.message || 'Failed to accept request.');
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
        }
    };

    // Decline friend request
    const handleDecline = async (friendshipId) => {
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'decline' }));
        try {
            await friendshipsAPI.declineRequest(friendshipId);
            // Optimistically update: remove from received
            setReceivedRequests(prev => prev.filter(r => r.id !== friendshipId));
        } catch (err) {
            console.error('Error declining request:', err);
            setReceivedError(err.message || 'Failed to decline request.');
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
        return sentRequests.some(r => r.addressee?.user_id === userId) ||
               receivedRequests.some(r => r.requester?.user_id === userId);
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
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-gray-50 flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-2xl font-bold text-gray-900 mb-4">Friends</h1>
                    <p className="text-gray-600 mb-6">Please log in to view your friends.</p>
                    <a
                        href="/api/auth/login"
                        className="inline-block bg-emerald-600 text-white px-6 py-2 rounded-lg hover:bg-emerald-700 transition-colors"
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
        <div className="min-h-screen bg-gray-50">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold text-gray-900 mb-6">Friends</h1>

                {/* Search Section */}
                <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
                    <h2 className="text-lg font-semibold text-gray-900 mb-3">Add Friend</h2>
                    <form onSubmit={handleSearch} className="flex gap-3">
                        <input
                            type="email"
                            value={searchEmail}
                            onChange={(e) => setSearchEmail(e.target.value)}
                            placeholder="Enter friend's email address"
                            className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 text-gray-900"
                            required
                        />
                        <button
                            type="submit"
                            disabled={searching || !searchEmail.trim()}
                            className="px-6 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {searching ? 'Searching...' : 'Search'}
                        </button>
                    </form>

                    {/* Search Result */}
                    {searching && (
                        <div className="mt-4 flex items-center gap-2 text-gray-600">
                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-emerald-600" />
                            <span>Searching...</span>
                        </div>
                    )}

                    {searchError && (
                        <div className="mt-4 p-3 bg-gray-50 border border-gray-200 rounded-lg">
                            <p className="text-gray-600">{searchError}</p>
                        </div>
                    )}

                    {searchResult && !searching && (
                        <div className="mt-4 p-4 border border-gray-200 rounded-lg flex items-center justify-between">
                            <div>
                                <p className="font-semibold text-gray-900">
                                    {searchResult.username || searchResult.email}
                                </p>
                                {searchResult.username && searchResult.email && (
                                    <p className="text-sm text-gray-500">{searchResult.email}</p>
                                )}
                            </div>
                            <div>
                                {(() => {
                                    const action = getSearchResultAction(searchResult);
                                    if (!action) return null;

                                    switch (action.type) {
                                        case 'self':
                                            return (
                                                <span className="text-sm text-gray-500 italic">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'already-friends':
                                            return (
                                                <span className="text-sm text-gray-500">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'pending':
                                            return (
                                                <span className="text-sm text-gray-500">
                                                    {action.label}
                                                </span>
                                            );
                                        case 'sent':
                                            return (
                                                <span className="flex items-center gap-1 text-sm text-emerald-600 font-medium">
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
                                                    className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
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
                <div className="border-b border-gray-200 mb-6">
                    <div className="flex gap-8">
                        {tabs.map(({ key, label, count }) => (
                            <button
                                key={key}
                                onClick={() => setActiveTab(key)}
                                className={`pb-3 text-sm font-medium transition-colors relative ${
                                    activeTab === key
                                        ? 'border-b-2 border-blue-600 text-blue-600'
                                        : 'text-gray-600 hover:text-gray-900'
                                }`}
                            >
                                {label}
                                {count > 0 && (
                                    <span className={`ml-2 px-2 py-0.5 rounded-full text-xs ${
                                        activeTab === key
                                            ? 'bg-blue-100 text-blue-700'
                                            : 'bg-gray-100 text-gray-600'
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
                            <p className="text-red-600 text-sm mb-4">{friendsError}</p>
                        )}
                        {loadingFriends ? (
                            <div className="flex items-center gap-2 text-gray-600 py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
                                <span>Loading friends...</span>
                            </div>
                        ) : friends.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-500">No friends yet. Search for friends by email above!</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {friends.map((friendship) => {
                                    const friend = friendship.friend;
                                    if (!friend) return null;

                                    return (
                                        <div
                                            key={friendship.id}
                                            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                                        >
                                            <div className="flex-1">
                                                <p className="font-semibold text-gray-900">
                                                    {friend.username || friend.email}
                                                </p>
                                                {friend.email && friend.email !== friend.username && (
                                                    <p className="text-sm text-gray-500 mt-0.5">{friend.email}</p>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleRemove(friendship.id)}
                                                disabled={actionLoading[friendship.id] === 'remove'}
                                                className="text-red-600 hover:text-red-700 text-sm font-medium transition-colors disabled:opacity-50"
                                            >
                                                {actionLoading[friendship.id] === 'remove' ? 'Removing...' : 'Remove'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {/* Requests Tab */}
                {activeTab === 'requests' && (
                    <div>
                        {receivedError && (
                            <p className="text-red-600 text-sm mb-4">{receivedError}</p>
                        )}
                        {loadingReceived ? (
                            <div className="flex items-center gap-2 text-gray-600 py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
                                <span>Loading requests...</span>
                            </div>
                        ) : receivedRequests.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-500">No pending friend requests.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {receivedRequests.map((request) => {
                                    const requester = request.requester;
                                    if (!requester) return null;

                                    return (
                                        <div
                                            key={request.id}
                                            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg hover:bg-gray-50"
                                        >
                                            <div className="flex-1">
                                                <p className="font-semibold text-gray-900">
                                                    {requester.username || requester.email}
                                                </p>
                                                {requester.email && requester.email !== requester.username && (
                                                    <p className="text-sm text-gray-500 mt-0.5">{requester.email}</p>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => handleAccept(request.id)}
                                                    disabled={!!actionLoading[request.id]}
                                                    className="px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
                                                >
                                                    {actionLoading[request.id] === 'accept' ? 'Accepting...' : 'Accept'}
                                                </button>
                                                <button
                                                    onClick={() => handleDecline(request.id)}
                                                    disabled={!!actionLoading[request.id]}
                                                    className="px-4 py-2 bg-gray-200 text-gray-700 text-sm rounded-lg hover:bg-gray-300 transition-colors disabled:opacity-50"
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
                            <p className="text-red-600 text-sm mb-4">{sentError}</p>
                        )}
                        {loadingSent ? (
                            <div className="flex items-center gap-2 text-gray-600 py-8 justify-center">
                                <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-emerald-600" />
                                <span>Loading sent requests...</span>
                            </div>
                        ) : sentRequests.length === 0 ? (
                            <div className="text-center py-12">
                                <p className="text-gray-500">No sent friend requests.</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {sentRequests.map((request) => {
                                    const addressee = request.addressee;
                                    if (!addressee) return null;

                                    return (
                                        <div
                                            key={request.id}
                                            className="flex items-center justify-between p-4 border border-gray-200 rounded-lg"
                                        >
                                            <div className="flex-1">
                                                <p className="font-semibold text-gray-900">
                                                    {addressee.username || addressee.email}
                                                </p>
                                                {addressee.email && addressee.email !== addressee.username && (
                                                    <p className="text-sm text-gray-500 mt-0.5">{addressee.email}</p>
                                                )}
                                            </div>
                                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 border border-amber-300">
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
