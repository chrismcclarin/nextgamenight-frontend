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
  error: null,
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
  const [error, setError] = useState(null);

  // Friend requests come from the existing FriendshipStatusProvider context
  // (mounted as the parent of this provider in layout.js). Re-exposing here
  // gives consumers a single hook to read instead of needing both
  // useUnreadNotificationCount() AND useFriendshipStatus().
  const { receivedRequests: friendRequests } = useFriendshipStatus();

  const totalCount = invites.length + friendRequests.length;

  // DECISION Phase 88.6.1-44 (N7 provider half, Req 11): CHOSEN — error is the caught error object,
  // null while healthy, cleared only by a successful load and never at the START of one (a banner
  // keyed on it must stay mounted through its own Retry); the load resolves { isError } so a retry
  // can report its outcome (plan 88.6.1-21 announces a failed retry only from that value); refetch,
  // already exposed, is the retry (one reference per signed-in user). The shape mirrors plan
  // 88.6.1-66's friendship provider.
  // REJECTED: a boolean (no code, so every failure would show the register's generic line); a
  // second retry function; clearing at the start; keeping the old list on failure (a user switch
  // would show the previous user's invites).
  // The bell's N7 banner that consumes this is mounted by plan 88.6.1-80, through one adapter in
  // this provider over this error and the friendship provider's (owner ruling 2026-10-05, D-48).
  // Clearing it at the start, or dropping the { isError } result, is a decision, not a cleanup.
  const fetchInvites = useCallback(async () => {
    if (!user?.sub) {
      setInvites([]);
      setLoading(false);
      return;
    }
    try {
      const data = await invitesAPI.getPendingInvites();
      setInvites(Array.isArray(data) ? data : data?.invites || []);
      setError(null);
      return { isError: false };
    } catch (err) {
      console.error('Failed to fetch invites:', err.message);
      setInvites([]);
      setError(err instanceof Error ? err : new Error());
      return { isError: true };
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
    error,
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
