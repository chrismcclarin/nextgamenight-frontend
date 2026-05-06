'use client';

import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI } from '../../lib/api';

export const FriendshipContext = createContext({
  getStatus: () => 'unknown',
  sendRequest: async () => {},
  receivedRequests: [],
  acceptRequest: async () => ({ alreadyAccepted: false }),
  declineRequest: async () => ({ alreadyDeclined: false }),
  refreshFriendships: async () => {},
  loading: true,
  error: false,
});

// POLL-02: convenience hook so consumers (NotificationBell, friends/page)
// can pull the shared friend-request state without redeclaring useContext +
// FriendshipContext at every site.
export function useFriendshipStatus() {
  return useContext(FriendshipContext);
}

export function FriendshipStatusProvider({ children }) {
  const { user } = useUser();
  const [friends, setFriends] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  // POLL-02: extracted into a named function so the mount useEffect AND the
  // accept/decline mutators (and any future consumer) can re-pull friendship
  // state from a single source. `cancelled` ref pattern preserved for the
  // mount path; manual refreshes ignore cancellation since the caller owns
  // the lifecycle.
  const loadFriendshipData = useCallback(async () => {
    if (!user?.sub) return;
    try {
      const [friendsData, sentData, receivedData] = await Promise.all([
        friendshipsAPI.getFriends(),
        friendshipsAPI.getSentRequests(),
        friendshipsAPI.getReceivedRequests(),
      ]);
      setFriends(friendsData || []);
      setSentRequests(sentData || []);
      setReceivedRequests(receivedData || []);
    } catch (err) {
      console.error('FriendshipStatusProvider: failed to load friendship data', err);
      setLoadError(true);
    }
  }, [user?.sub]);

  useEffect(() => {
    if (!user?.sub) return;

    let cancelled = false;

    async function initialLoad() {
      try {
        const [friendsData, sentData, receivedData] = await Promise.all([
          friendshipsAPI.getFriends(),
          friendshipsAPI.getSentRequests(),
          friendshipsAPI.getReceivedRequests(),
        ]);

        if (cancelled) return;

        setFriends(friendsData || []);
        setSentRequests(sentData || []);
        setReceivedRequests(receivedData || []);
      } catch (err) {
        if (cancelled) return;
        console.error('FriendshipStatusProvider: failed to load friendship data', err);
        setLoadError(true);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    initialLoad();

    return () => {
      cancelled = true;
    };
  }, [user?.sub]);

  const getStatus = useCallback(
    (targetUserId) => {
      if (loadError) return 'unknown';
      if (!targetUserId) return 'unknown';
      if (targetUserId === user?.sub) return 'self';

      // Check accepted friends
      const isFriend = friends.some(
        (f) => f.friend?.user_id === targetUserId
      );
      if (isFriend) return 'accepted';

      // Check sent requests
      const isSent = sentRequests.some(
        (r) => r.Addressee?.user_id === targetUserId
      );
      if (isSent) return 'pending_sent';

      // Check received requests
      const isReceived = receivedRequests.some(
        (r) => r.Requester?.user_id === targetUserId
      );
      if (isReceived) return 'pending_received';

      return 'none';
    },
    [loadError, user?.sub, friends, sentRequests, receivedRequests]
  );

  const handleSendRequest = useCallback(
    async (targetUserId) => {
      try {
        const result = await friendshipsAPI.sendRequest(targetUserId);
        // Optimistically add to sentRequests so all tooltips update immediately
        setSentRequests((prev) => [
          ...prev,
          {
            ...result,
            Addressee: { user_id: targetUserId },
          },
        ]);
      } catch (err) {
        // 409 = duplicate request, silently ignore
        if (err?.message?.includes('409') || err?.status === 409) {
          return;
        }
        throw err;
      }
    },
    []
  );

  // POLL-02: accept a received friend request from a single source of truth.
  // Optimistically removes the request from receivedRequests so every
  // consumer (NotificationBell + friends/page) reflects the change in one
  // frame. On 404 (stale double-accept race — the same request was
  // accepted/declined elsewhere), the row is still removed locally and the
  // promise resolves with { alreadyAccepted: true } so callers can swallow
  // the benign error instead of surfacing a "Failed to accept" toast.
  // Refetches friends afterward (async, non-blocking) to fold the new
  // friend into the friends list and accepted-state tooltips.
  const handleAcceptRequest = useCallback(async (friendshipId) => {
    setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
    try {
      await friendshipsAPI.acceptRequest(friendshipId);
      // Refresh full state in the background — picks up the new friend
      // row + clears any stale received entry on the server side.
      loadFriendshipData();
      return { alreadyAccepted: false };
    } catch (err) {
      const is404 = err?.message?.includes('404') || err?.status === 404;
      if (is404) {
        // Benign stale click — the request was already resolved on another
        // surface. Pull fresh state to reconcile.
        loadFriendshipData();
        return { alreadyAccepted: true };
      }
      throw err;
    }
  }, [loadFriendshipData]);

  // POLL-02: decline mirror of handleAcceptRequest. Same stale-404 silencing.
  const handleDeclineRequest = useCallback(async (friendshipId) => {
    setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
    try {
      await friendshipsAPI.declineRequest(friendshipId);
      return { alreadyDeclined: false };
    } catch (err) {
      const is404 = err?.message?.includes('404') || err?.status === 404;
      if (is404) {
        loadFriendshipData();
        return { alreadyDeclined: true };
      }
      throw err;
    }
  }, [loadFriendshipData]);

  return (
    <FriendshipContext.Provider
      value={{
        getStatus,
        sendRequest: handleSendRequest,
        receivedRequests,
        acceptRequest: handleAcceptRequest,
        declineRequest: handleDeclineRequest,
        refreshFriendships: loadFriendshipData,
        loading,
        error: loadError,
      }}
    >
      {children}
    </FriendshipContext.Provider>
  );
}

export default FriendshipStatusProvider;
