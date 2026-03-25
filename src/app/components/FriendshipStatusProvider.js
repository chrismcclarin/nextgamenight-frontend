'use client';

import { createContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI } from '../../lib/api';

export const FriendshipContext = createContext({
  getStatus: () => 'unknown',
  sendRequest: async () => {},
  loading: true,
  error: false,
});

export function FriendshipStatusProvider({ children }) {
  const { user } = useUser();
  const [friends, setFriends] = useState([]);
  const [sentRequests, setSentRequests] = useState([]);
  const [receivedRequests, setReceivedRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!user?.sub) return;

    let cancelled = false;

    async function loadFriendshipData() {
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

    loadFriendshipData();

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

  return (
    <FriendshipContext.Provider
      value={{
        getStatus,
        sendRequest: handleSendRequest,
        loading,
        error: loadError,
      }}
    >
      {children}
    </FriendshipContext.Provider>
  );
}

export default FriendshipStatusProvider;
