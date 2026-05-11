'use client';
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from './FriendshipStatusProvider';

/**
 * Unread notification count — single source of truth (MOB-08, Plan 77-01).
 *
 * Owns the same `invitesAPI.getPendingInvites()` fetch that previously lived
 * inside NotificationBell, plus reads `receivedRequests` from
 * FriendshipStatusProvider. Exposes a shared `totalCount` so multiple
 * consumers (the in-menu bell badge AND the mobile hamburger dot) see the
 * exact same number — including optimistic updates after Accept/Decline.
 *
 * No new polling. Fetch-on-mount only, matching the pre-refactor bell
 * behavior. Optimistic updates from NotificationBell's Accept/Decline
 * handlers go through `setInvites` so the count drops immediately.
 */

const UnreadNotificationContext = createContext({
  invites: [],
  friendRequests: [],
  totalCount: 0,
  loading: true,
  setInvites: () => {},
  refetch: () => {},
});

export function useUnreadNotificationCount() {
  return useContext(UnreadNotificationContext);
}

export function UnreadNotificationProvider({ children }) {
  const { user } = useUser();
  const [invites, setInvites] = useState([]);
  const [loading, setLoading] = useState(true);

  // Friend requests come from the existing FriendshipStatusProvider context
  // (mounted as the parent of this provider in layout.js). Re-exposing here
  // gives consumers a single hook to read instead of needing both
  // useUnreadNotificationCount() AND useFriendshipStatus().
  const { receivedRequests: friendRequests } = useFriendshipStatus();

  const totalCount = invites.length + friendRequests.length;

  const fetchInvites = useCallback(async () => {
    if (!user?.sub) {
      setInvites([]);
      setLoading(false);
      return;
    }
    try {
      const data = await invitesAPI.getPendingInvites();
      setInvites(Array.isArray(data) ? data : data?.invites || []);
    } catch (err) {
      console.error('Failed to fetch invites:', err.message);
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, [user?.sub]);

  // Fetch on mount + whenever the user changes (login/logout). Matches the
  // pre-refactor NotificationBell behavior verbatim.
  useEffect(() => {
    fetchInvites();
  }, [fetchInvites]);

  const value = {
    invites,
    friendRequests,
    totalCount,
    loading,
    setInvites,
    refetch: fetchInvites,
  };

  return (
    <UnreadNotificationContext.Provider value={value}>
      {children}
    </UnreadNotificationContext.Provider>
  );
}

export default UnreadNotificationProvider;
