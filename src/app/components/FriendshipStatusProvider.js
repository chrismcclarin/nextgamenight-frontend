'use client';

import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI } from '../../lib/api';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';

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
  // FE-17 cutover: self-classification keys on the resolved Users.id UUID, not
  // the Auth0 sub. `selfUuid` resolves ASYNCHRONOUSLY (react-query) — see the
  // async-gating rule inside getStatus below.
  const { selfUuid } = useSelfIdentity();
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

      // Friend / pending classifications key on the nested Users.id UUID and do
      // NOT depend on the async self-identity — resolve them FIRST so friend and
      // pending pills render immediately, even before `selfUuid` lands.
      const isFriend = friends.some(
        (f) => f.friend?.id === targetUserId
      );
      if (isFriend) return 'accepted';

      const isSent = sentRequests.some(
        (r) => r.Addressee?.id === targetUserId
      );
      if (isSent) return 'pending_sent';

      const isReceived = receivedRequests.some(
        (r) => r.Requester?.id === targetUserId
      );
      if (isReceived) return 'pending_received';

      // Not a friend/pending — the row is either the viewer themself or an
      // addable stranger. Distinguishing them needs the async-resolved self
      // UUID. ASYNC-GATING (same rule as plans 04/05/11): while `selfUuid` is
      // unresolved (loading) or has permanently errored (it stays undefined),
      // we cannot rule out that this row is self — withhold the addable
      // conclusion ('unknown' → ClickableMemberName renders the plain name, no
      // "Add friend") rather than falling through to 'none' and offering a
      // self-request that 400s. `selfUuid` is in the dep array so classification
      // updates the instant identity resolves.
      if (!selfUuid) return 'unknown';
      if (targetUserId === selfUuid) return 'self';

      return 'none';
    },
    [loadError, selfUuid, friends, sentRequests, receivedRequests]
  );

  const handleSendRequest = useCallback(
    async (targetUserId) => {
      try {
        const result = await friendshipsAPI.sendRequest(targetUserId);
        // Optimistically add to sentRequests so all tooltips update immediately.
        // `targetUserId` is now the Users.id UUID (ClickableMemberName prop /
        // foundUser.id), so the optimistic Addressee keys on `id` to match the
        // isSent lookup (`r.Addressee?.id === targetUserId`) above.
        setSentRequests((prev) => [
          ...prev,
          {
            ...result,
            Addressee: { id: targetUserId },
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
  // AMENDED Phase 88.6.1-66 (Req 11): the first two sentences above no longer hold. The
  // row now leaves receivedRequests when the server confirms (after the request resolves,
  // or in the 404 arm), never before the request. Every consumer still sees the change in
  // one frame, because they all read this one state. A non-404 failure keeps the row where
  // it was, reconciles that one row with the server, and rethrows.

  // DECISION Phase 88.6.1-66 (Req 11, Prohibition 2). CHOSEN: the row leaves the list only
  // when the server confirms, and every confirm (success or 404, accept or decline) then
  // pulls a fresh load, so the newest load always postdates the confirm. A non-404 failure
  // keeps the row in place and still rejects with the same error; the failure then reads
  // the received list ONCE and removes only that row, if the server no longer lists it.
  // The backend refuses a no-longer-pending request with 400, not 404 (routes/friendships.js,
  // the accept and decline handlers, anchor `Friend request is not pending`).
  // REJECTED (a): removing the row at the start and restoring it on failure (the 2026-10-05
  // brief's shape). The row vanishes then reappears, a jump at 375px; the hosts' focus
  // recovery has already moved the person to the next row, away from the row they must
  // retry; a refresh landing mid-flight makes the restore duplicate the row or bring back
  // one the server already dropped; and the hosts' in-flight labels could never paint.
  // REJECTED (b): today's removal with no restore. A failed request reads as handled until
  // a reload (SPEC Prohibition 2).
  // REJECTED (c): resolving a stale request as already handled, like the 404 arm. The
  // backend answers 400 for accepted and declined requests alike, so the bell would
  // confirm an accept for a request that was declined elsewhere.
  // REJECTED (d): reconciling by replacing the whole list from the read, or by pulling the
  // full loader on every failure. A replace can bring back another row that changed after
  // the read was sent (RA-9). The loader's failure path sets the load-error flag, so one
  // network blip would turn every friendship affordance in the app to 'unknown', and raise
  // the friend-request error banners, until a later load succeeds.
  // POLL-02's double-press concern is still met: by the provider's per-row in-flight gate
  // below (no second request for a row whose request is running, from either surface), the
  // 404 arm and this reconcile. Not by the hosts' own gates: each covers only its own copy
  // of the row. When this reconcile removes the row it marks the error it rethrows
  // (requestRowRemoved), so a caller knows the row is gone whatever the status: a 500 can
  // follow a committed accept.
  // Moving the removal back before the request, or widening the reconcile to the whole
  // list, is a decision, not a cleanup.
  const reconcileFailedRequest = useCallback(async (friendshipId, err) => {
    try {
      const list = await friendshipsAPI.getReceivedRequests();
      const stillListed = (list || []).some((r) => r.id === friendshipId);
      if (stillListed) return;
      setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
      loadFriendshipData();
      // The provider's own record of what it did: the row is gone, whatever the status
      // code (a 500 can follow a committed accept). The SAME object the handler rethrows
      // carries it; plan 88.6.1-44's bell arms its focus recovery on it.
      if (err && typeof err === 'object') err.requestRowRemoved = true;
    } catch {
      // Best-effort read: the caller has already received the request's own failure. A
      // write here (the load-error flag included) would turn every friendship affordance
      // in the app to 'unknown' because one background read failed, so nothing is written.
    }
  }, [loadFriendshipData]);

  // DECISION Phase 88.6.1-66 (one request per row). CHOSEN: one in-flight record per
  // request id, shared by accept and decline. A same-kind repeat joins the running call
  // (it returns that call's promise); the other kind is refused (it rejects and sends
  // nothing) and is never joined; the record is exposed read-only (isRequestActionPending)
  // so both surfaces disable both of the row's buttons. The record lives in a ref, so a
  // second call in the same tick sees it before any re-render; a state mirror re-renders
  // the consumers. An entry clears when its call settles, so a retry after a failure sends
  // a new request.
  // REJECTED: relying on the hosts' gates (per surface: the bell and the Friends page each
  // hold their own); joining an other-kind call (it would report the wrong action's
  // outcome as its own); sending it (a second request for a row already being answered
  // earns a 400 for a request that succeeded).
  // Removing the gate or joining across kinds is a decision, not a cleanup.
  const requestsInFlightRef = useRef(new Map());
  const [pendingRequestIds, setPendingRequestIds] = useState(() => new Set());
  const runOncePerRow = useCallback((friendshipId, kind, send) => {
    const running = requestsInFlightRef.current.get(friendshipId);
    if (running) {
      return running.kind === kind ? running.promise : Promise.reject(new Error());
    }
    const promise = (async () => {
      try {
        return await send();
      } finally {
        requestsInFlightRef.current.delete(friendshipId);
        setPendingRequestIds((prev) => {
          const next = new Set(prev);
          next.delete(friendshipId);
          return next;
        });
      }
    })();
    requestsInFlightRef.current.set(friendshipId, { kind, promise });
    setPendingRequestIds((prev) => new Set(prev).add(friendshipId));
    return promise;
  }, []);
  const isRequestActionPending = useCallback(
    (friendshipId) => pendingRequestIds.has(friendshipId),
    [pendingRequestIds]
  );

  const handleAcceptRequest = useCallback(
    (friendshipId) => runOncePerRow(friendshipId, 'accept', async () => {
      try {
        await friendshipsAPI.acceptRequest(friendshipId);
        setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
        // Refresh full state in the background — picks up the new friend
        // row + clears any stale received entry on the server side.
        loadFriendshipData();
        return { alreadyAccepted: false };
      } catch (err) {
        const is404 = err?.message?.includes('404') || err?.status === 404;
        if (is404) {
          setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
          // Benign stale click — the request was already resolved on another
          // surface. Pull fresh state to reconcile.
          loadFriendshipData();
          return { alreadyAccepted: true };
        }
        await reconcileFailedRequest(friendshipId, err);
        throw err;
      }
    }),
    [loadFriendshipData, reconcileFailedRequest, runOncePerRow]
  );

  // POLL-02: decline mirror of handleAcceptRequest. Same stale-404 silencing.
  // Since Phase 88.6.1-66: the same remove-on-confirm, and the same reconcile after a non-404 failure.
  const handleDeclineRequest = useCallback(
    (friendshipId) => runOncePerRow(friendshipId, 'decline', async () => {
      try {
        await friendshipsAPI.declineRequest(friendshipId);
        setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
        loadFriendshipData();
        return { alreadyDeclined: false };
      } catch (err) {
        const is404 = err?.message?.includes('404') || err?.status === 404;
        if (is404) {
          setReceivedRequests((prev) => prev.filter((r) => r.id !== friendshipId));
          loadFriendshipData();
          return { alreadyDeclined: true };
        }
        await reconcileFailedRequest(friendshipId, err);
        throw err;
      }
    }),
    [loadFriendshipData, reconcileFailedRequest, runOncePerRow]
  );

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
        isRequestActionPending,
      }}
    >
      {children}
    </FriendshipContext.Provider>
  );
}

export default FriendshipStatusProvider;
