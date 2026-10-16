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
  error: null,
  hasLoaded: false,
  isRequestActionPending: () => false,
  retryFriendships: async () => {},
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
  const [loadError, setLoadError] = useState(null);
  const [hasLoaded, setHasLoaded] = useState(false);

  // POLL-02: extracted into a named function so the mount useEffect AND the
  // accept/decline mutators (and any future consumer) can re-pull friendship
  // state from a single source. `cancelled` ref pattern preserved for the
  // mount path; manual refreshes ignore cancellation since the caller owns
  // the lifecycle.
  // AMENDED Phase 88.6.1-66: the mount effect now calls this same loader (the twin mount loader is gone), and the
  // generation guard below replaces the `cancelled` flag: a newer load, including the next user's or a sign-out's call, supersedes an older one.
  // DECISION Phase 88.6.1-66 (one guarded load + load-error recovery): ONE loader serves the mount effect,
  // refreshFriendships, retryFriendships and every post-action load. Each call takes the next generation, and only
  // the LATEST may write the three lists, the load-error flag, the has-loaded flag and `loading`, and record that it
  // settled. An older load that lands later writes nothing and resolves to the latest load's outcome, so a banner's
  // Retry still learns the truth. Every server-confirmed list edit starts a load (accept, decline, either 404 arm,
  // the reconcile finding a row gone, a sent request), so no snapshot taken before the edit can land last and undo it.
  // A load that SUCCEEDS clears the flag and resolves { isError: false }; one that FAILS stores the caught error
  // object and resolves { isError: true }. The flag is never cleared at the START of a load: a banner keyed on it
  // (FR1 / N7, plans 88.6.1-40 / -44) must stay mounted through its own Retry.
  // REJECTED: twin mount and refresh loaders (the old pair had already drifted); a superseded load resolving
  // undefined (a banner's failed retry would go silent); a boolean flag (no error code to pick the message); a banner
  // retry that always starts a new load (see the retryFriendships marker). Restoring a second loader, letting a superseded load write, or clearing the flag at the start is a decision, not a cleanup.
  const loadSeqRef = useRef(0);
  const latestLoadRef = useRef(null);
  const settledSeqRef = useRef(0);
  const loadFriendshipData = useCallback(() => {
    const seq = ++loadSeqRef.current;
    const load = (async () => {
      if (!user?.sub) return;
      try {
        const [friendsData, sentData, receivedData] = await Promise.all([
          friendshipsAPI.getFriends(),
          friendshipsAPI.getSentRequests(),
          friendshipsAPI.getReceivedRequests(),
        ]);
        if (seq !== loadSeqRef.current) return latestLoadRef.current;
        setFriends(friendsData || []);
        setSentRequests(sentData || []);
        setReceivedRequests(receivedData || []);
        setLoadError(null);
        setHasLoaded(true);
        return { isError: false };
      } catch (err) {
        console.error('FriendshipStatusProvider: failed to load friendship data', err);
        if (seq !== loadSeqRef.current) return latestLoadRef.current;
        setLoadError(err instanceof Error ? err : new Error());
        return { isError: true };
      } finally {
        if (seq === loadSeqRef.current) setLoading(false);
        if (seq === loadSeqRef.current) settledSeqRef.current = seq;
      }
    })();
    latestLoadRef.current = load;
    return load;
  }, [user?.sub]);

  useEffect(() => {
    setHasLoaded(false);
    setFriends([]);
    setSentRequests([]);
    setReceivedRequests([]);
    loadFriendshipData();
  }, [loadFriendshipData]);

  const getStatus = useCallback(
    (targetUserId) => {
      if (loadError) return 'unknown';
      // DECISION Phase 88.6.1-66 (getStatus): 'unknown' until the first load settles, chosen OVER classifying against the still-empty lists (which offered + to an existing friend); FE-17's withhold rule
      // applied to the lists — every consumer renders 'unknown' as the plain name, no ring or an inert chip. It ends when the newest load settles and never comes back on a refresh.
      if (loading) return 'unknown';
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
    [loadError, loading, selfUuid, friends, sentRequests, receivedRequests]
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

  // DECISION Phase 88.6.1-66 (retryFriendships): the banners' retry joins the newest load while it is still running and starts one only when none is, so several erroring banners refocusing at once share one load.
  // CHOSEN OVER making refreshFriendships join (the post-unfriend sync and every confirmed edit need a NEW load, or a snapshot taken before the edit can land last and undo it) and over an always-fresh retry
  // (one three-read load per banner, each superseding the last). Pointing the banners back at refreshFriendships, or making refreshFriendships join, is a decision, not a cleanup.
  const retryFriendships = useCallback(() => {
    if (settledSeqRef.current !== loadSeqRef.current) return latestLoadRef.current;
    return loadFriendshipData();
  }, [loadFriendshipData]);

  // DECISION Phase 88.6.1-66: a send that does not throw (its 409 included) starts the newest load, chosen over a load inside handleSendRequest, because this wrapper covers the 409 arm that returns early, in one place.
  // Known limit, ROUTED to Phase 93 (.planning/deferred/phase-93.md, the code-less 409 split): a swallowed 409 resolves like a success, so the member-name popover shows its sent line for an
  // already-friends 409 until this load lands, and for a request the other person sent until the popover closes; telling the 409s apart needs the backend's codes (reading the 409's text is the
  // raw-message read the house forbids). REJECTED: awaiting this load before resolving, which still mislabels the reverse-pending case and delays every successful send's confirmation by a full load.
  // Changing this before Phase 93 lands the codes is a decision, not a cleanup.
  const sendRequestAndSync = useCallback(
    async (targetUserId) => {
      await handleSendRequest(targetUserId);
      loadFriendshipData();
    },
    [handleSendRequest, loadFriendshipData]
  );

  return (
    <FriendshipContext.Provider
      value={{
        getStatus,
        sendRequest: sendRequestAndSync,
        receivedRequests,
        acceptRequest: handleAcceptRequest,
        declineRequest: handleDeclineRequest,
        refreshFriendships: loadFriendshipData,
        retryFriendships,
        loading,
        error: loadError,
        // DECISION Phase 88.6.1-66 (hasLoaded, D-50 / contract C3): true when the newest load that SUCCEEDED ran for the user signed in now; a failure never clears it (a list that loaded
        // empty is still what loaded). The mount effect's reset (it re-runs exactly on a change of signed-in user) makes it false until that user's first success and empties the three lists it
        // describes, so no previous-user row stays on screen; a sign-out's call takes a generation, so no late load sets it back. Plan 88.6.1-72's RF1 reads it. CHOSEN OVER: a row count (D-50);
        // the loading flag (a failed first load ends it too); a flag the page observes after mounting; storing the sub a load ran for and comparing it with the signed-in one (same-source, but the
        // FE CI gate against comparing the sub reads every code line, and an alias of the sub only hides the same compare); the resolved self UUID (it can resolve after the lists land); clearing it on a failure.
        // Turning this into a count, storing a sub here, dropping the effect's reset or its list clears, or clearing it on a failure is a decision, not a cleanup.
        hasLoaded,
        isRequestActionPending,
      }}
    >
      {children}
    </FriendshipContext.Provider>
  );
}

export default FriendshipStatusProvider;
