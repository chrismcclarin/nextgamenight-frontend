'use client';
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from './FriendshipStatusProvider';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '../../lib/logger';

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
 * AMENDED Phase 88.6.1-80: the one refetch trigger added is `useFetchErrorState`'s error-only
 * tab-return re-attempt (the house D-02 recovery) inside `loadErrorState`, active only while the
 * bell's load has failed with nothing to show; it re-runs only the failed source(s). Still no
 * polling.
 */

const UnreadNotificationContext = createContext({
  invites: [],
  friendRequests: [],
  totalCount: 0,
  loading: true,
  error: null,
  loadErrorState: null,
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
  const { receivedRequests: friendRequests, error: friendsError, retryFriendships } = useFriendshipStatus();

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
      // 88.6.1 code review A-38 / WR-07 (convert-on-touch, ROADMAP :28): a breadcrumb, not logger.error — the bell's
      // N7 banner report path files the event, and a tab-return retry would otherwise file one event per return.
      logger.info('Failed to fetch invites:', errCtx(err));
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

  // DECISION Phase 88.6.1-80 (N7 adapter): CHOSEN — the bell's load-error state lives HERE, once:
  // both bells and the hamburger dot already read this provider. `isError` needs a failed source
  // (the invites error above, or the friendship provider's) AND nothing to show; `error` is the
  // invites error, else the friendship error, each passed through as stored (never wrapped in a new
  // Error: a wrapped 401 / 403 would read as unknown, plan 88.6.1-70's C10); the retry re-runs only
  // the source(s) whose error is set at the press and resolves { isError }.
  // The owner's recorded limit: a PARTIAL failure (one list failed, the other has rows) shows the
  // rows and says nothing this phase; there is no refresh-failed notice in the bell.
  // REJECTED: (a) the adapter in NotificationBell.js — the bell is mounted twice at all times (the
  // header's icon bell and the hamburger's row bell), so two memories of a failed retry (the report
  // link would vanish when the viewport crosses md) and two tab-return re-attempts; (b) re-running
  // both sources on every retry (a source that is fine is re-fetched for nothing); (c) the refresh-
  // failed notice over partial rows (owner: not covered this phase); (d) the friendship provider's
  // always-fresh reload as the re-run (review #149: it starts a new load per call, so on /friends
  // this adapter and the Requests tab's would send two loads on one tab return; the joining retry
  // sends one).
  // Moving this into the bell is a decision, not a cleanup.
  const latestSourcesRef = useRef({ invitesError: error, friendsError, fetchInvites, retryFriendships });
  useEffect(() => {
    latestSourcesRef.current = { invitesError: error, friendsError, fetchInvites, retryFriendships };
  });

  const retryFailedSources = useCallback(async () => {
    const sources = latestSourcesRef.current;
    // Both re-runs start before the first await, so the friendship re-run joins a load the
    // Requests tab started on the same tab return instead of starting a second one after it.
    const runs = [];
    if (sources.invitesError) runs.push(sources.fetchInvites());
    if (sources.friendsError) runs.push(sources.retryFriendships?.());
    if (runs.length === 0) return { isError: false };
    const results = await Promise.all(runs);
    return { isError: results.some((result) => result?.isError === true) };
  }, []);

  const loadErrorState = useFetchErrorState({
    isError: Boolean(error || friendsError) && totalCount === 0,
    error: error ?? friendsError ?? null,
    refetch: retryFailedSources,
  });

  const value = {
    invites,
    friendRequests,
    totalCount,
    loading,
    error,
    loadErrorState,
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
