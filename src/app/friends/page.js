'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, groupsAPI, invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
// 88-33 Task 1 (r3 triage): this page's fetchers run through a raw
// Promise.allSettled, NOT react-query, so they bypass the global
// QueryCache.onError hook entirely and their failures never reached Sentry.
// Reporting through the SAME exported function keeps the entity/scope tagging
// and the T-84-05 PII rules identical to every query-driven report.
import { queryCacheOnError } from '../../lib/queryClient';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input, SelectControl } from '../../components/ui/Input';

function FriendsPage() {
    const { user, isLoading: authLoading } = useUser();

    // D-09 (Pitfall 5 / D-07 window rule): the friends page GATES on identity.
    // Incoming-vs-outgoing request classification, the admin-group derive, and
    // the is-self search guard all need the caller's own Users.id UUID, so the
    // whole page waits on `selfUuid` (full loading) and shows a standard error
    // state on permanent failure — it never degrades to a mixed-keyspace render.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);

    // POLL-02: receivedRequests + accept/decline mutators come from the
    // shared FriendshipStatusProvider (mounted at root). NotificationBell
    // and this page now read the same array — accepting in one surface
    // immediately removes the row from the other.
    const {
        receivedRequests,
        acceptRequest: ctxAcceptRequest,
        declineRequest: ctxDeclineRequest,
        loading: friendshipCtxLoading,
        // 88-33 Task 9 (UAT row 553): the provider-wide refresh — called after a
        // successful unfriend so friend pills EVERYWHERE update without a manual
        // reload (the local optimistic filter below only fixes THIS page's list).
        refreshFriendships,
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

    // Error state. `friendsLoadError` is the FETCH failure (the whole list is
    // unavailable); `removeError` is an ACTION failure with the list still
    // intact. They render as different things — see the DECISION marker on the
    // Friends tab below.
    const [friendsLoadError, setFriendsLoadError] = useState(null);
    const [removeError, setRemoveError] = useState(null);
    const [sentError, setSentError] = useState(null);
    // 88-33 Task 1: the groups fetch used to swallow its failure into
    // `setRawGroups([])`, which silently emptied the invite bar and read as
    // "you administer no groups". Same empty-vs-failed split as the two above.
    const [groupsError, setGroupsError] = useState(null);

    // Action loading state
    const [actionLoading, setActionLoading] = useState({});

    // Group invite shortcut state
    const [selectedFriends, setSelectedFriends] = useState(new Set());
    const [selectedGroupId, setSelectedGroupId] = useState('');
    const [rawGroups, setRawGroups] = useState([]);
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
        // fetch here. fetchUserGroups is NOT in this list: it sends the caller's
        // own UUID (selfUuid) and runs in its own selfUuid-gated effect below, so
        // it never re-fires fetchFriends/fetchSentRequests when identity resolves.
        await Promise.allSettled([
            fetchFriends(),
            fetchSentRequests(),
        ]);
    };

    // fetchUserGroups is split into its own effect (mirroring the admin-group
    // derive effect below, keyed [rawGroups, selfUuid]). Its getUserGroups sender
    // sends selfUuid, which resolves ASYNC after mount, so this effect gates on
    // it AND keys on it — the fetch fires once identity resolves. Keeping it out
    // of the [user]-keyed fetchAllData effect avoids re-firing fetchFriends /
    // fetchSentRequests every time selfUuid resolves (a NEW double-fetch).
    useEffect(() => {
        if (!selfUuid) return;
        fetchUserGroups();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selfUuid]);

    const fetchUserGroups = async () => {
        if (!selfUuid) return;
        setGroupsError(null);
        try {
            const groups = await groupsAPI.getUserGroups(selfUuid);
            setRawGroups(Array.isArray(groups) ? groups : []);
        } catch (err) {
            console.error('Error fetching user groups:', err);
            queryCacheOnError(err, { queryKey: ['groups', 'user'] });
            // Keep the ERROR object (88-14 idiom): useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            setGroupsError(
                err instanceof Error ? err : new Error("The groups request didn't complete.")
            );
            setRawGroups([]);
        }
    };

    /* Adapter onto the shared fetch-error pair, identical in shape to
       `friendsErrorState` below (88-14). `refetch` must be STABLE. */
    const fetchGroupsRef = useRef(null);
    useEffect(() => {
        fetchGroupsRef.current = fetchUserGroups;
    });
    const retryGroups = useCallback(() => fetchGroupsRef.current?.(), []);
    const groupsErrorState = useFetchErrorState({
        isError: Boolean(groupsError),
        error: groupsError,
        refetch: retryGroups,
    });

    // Admin-group derive runs in its own effect keyed on [rawGroups, selfUuid]
    // (grouplist.js pattern): the mount fetch fires before selfUuid resolves,
    // so filtering inline would race and permanently empty the invite bar for
    // admins. selfUuid is in the dependency array per the async-resolution rule.
    useEffect(() => {
        if (!selfUuid) return;
        const adminGroups = rawGroups.filter(g => {
            const currentUser = g.Users?.find(u => u.id === selfUuid);
            const role = currentUser?.UserGroup?.role;
            return role === 'owner' || role === 'admin';
        });
        setUserGroups(adminGroups);
    }, [rawGroups, selfUuid]);

    const fetchFriends = async () => {
        setLoadingFriends(true);
        setFriendsLoadError(null);
        try {
            const data = await friendshipsAPI.getFriends();
            setFriends(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching friends:', err);
            queryCacheOnError(err, { queryKey: ['friendships', 'accepted'] });
            // Keep the ERROR, not a flattened string: useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            // Wording matches the 88-18 register ("The X request didn't complete.") used by
            // grouplist.js / GroupLibrary.js. This string is never shown — a non-ApiError
            // resolves to code `unknown` and useFetchErrorState renders the designed copy for
            // that code — but Req 14's negative gate is a plain grep, so the phrasing matters.
            setFriendsLoadError(
                err instanceof Error ? err : new Error("The friends request didn't complete.")
            );
        } finally {
            setLoadingFriends(false);
        }
    };

    /* DECISION Phase 88-14 (Req 6 / Req 14, UI-SPEC §9.2): the friends-list fetch failure is
       ADAPTED onto the shipped `useFetchErrorState` + `FetchErrorBanner` pair by handing the hook
       a minimal query-shaped object, chosen OVER the two alternatives.

       REJECTED 1 — migrating `fetchFriends` to TanStack so a real `UseQueryResult` exists. That is
       a data-layer change on a surface this phase is only re-skinning; it would also move the
       friends list out from under the page's own D-09 identity gate. Out of scope by size, not by
       merit — if the page is ever migrated, delete this adapter and pass the query.
       REJECTED 2 — hand-rolling a second error look on this one tab. That is precisely the
       divergence Req 14 exists to remove; the identity gate a few lines up already uses the banner.

       The adapter is contract-backed, not a shim around a private API: `useFetchErrorState`
       documents that it reads ONLY `isError`/`error`/`refetch` (useFetchErrorState.ts:89). */
    const fetchFriendsRef = useRef(null);
    useEffect(() => {
        fetchFriendsRef.current = fetchFriends;
    });
    // Stable identity: the hook puts `refetch` in a useCallback dep AND in the
    // refocus-recovery effect's deps, so handing it a fresh function each render
    // would re-subscribe that listener on every render while erroring.
    const retryFriends = useCallback(() => fetchFriendsRef.current?.(), []);
    const friendsErrorState = useFetchErrorState({
        isError: Boolean(friendsLoadError),
        error: friendsLoadError,
        refetch: retryFriends,
    });

    const fetchSentRequests = async () => {
        setLoadingSent(true);
        setSentError(null);
        try {
            const data = await friendshipsAPI.getSentRequests();
            setSentRequests(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error fetching sent requests:', err);
            queryCacheOnError(err, { queryKey: ['friendships', 'sent'] });
            // Keep the ERROR object, not a flattened string: useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            setSentError(
                err instanceof Error ? err : new Error("The sent-requests request didn't complete.")
            );
        } finally {
            setLoadingSent(false);
        }
    };

    /* Adapter onto the shared pair, identical in shape to `friendsErrorState` above (88-14).
       `refetch` must be STABLE — the hook puts it in a useCallback dep AND in its
       refocus-recovery effect deps. */
    const fetchSentRef = useRef(null);
    useEffect(() => {
        fetchSentRef.current = fetchSentRequests;
    });
    const retrySent = useCallback(() => fetchSentRef.current?.(), []);
    const sentErrorState = useFetchErrorState({
        isError: Boolean(sentError),
        error: sentError,
        refetch: retrySent,
    });

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
                /* DECISION Phase 88-25 (Req 14 / T-88-25-01): derived copy, chosen OVER
                   `err.message || '…'`. The two branches above deliberately KEEP their prose
                   match — "no user found" is a legitimate SEARCH OUTCOME the person can act on
                   (check the address), not a failure, and there is no ApiError code that carries
                   it. This branch is the genuine failure and no longer paints upstream text. */
                setSearchError(
                    getFetchErrorMessage(err, {
                        fallback: "We couldn't run that search. Please try again.",
                    })
                );
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
            setSearchError(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't send that request. Please try again.",
                    // 88-CODE-REVIEW D2: the already-friends/already-pending outcomes are
                    // code-less 409s -> 'conflict'. The old copy here keyed them on
                    // 'validation', which a 409 never produced — so it never fired, and the
                    // one case validation DOES catch (400 self-request) showed the wrong
                    // message. Copy owner-ratified 2026-08-06.
                    byCode: {
                        conflict: "You're already friends, or a request is already pending.",
                        validation: "That request couldn't be sent. Check who you're sending it to.",
                    },
                })
            );
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

    // Remove friend — the COMMIT half only. It is unreachable except through the
    // gate below, which is what makes the first tap non-destructive.
    const performRemoveFriend = async (friendshipId) => {
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'remove' }));
        setRemoveError(null);
        try {
            await friendshipsAPI.removeFriend(friendshipId);
            // 88-CODE-REVIEW MED#1: resolve the ex-friend's userId BEFORE filtering,
            // and prune them from the bulk-invite selection too — otherwise the
            // "N selected" count keeps counting them and handleBulkInvite still
            // dispatches a group invite on behalf of a just-severed relationship
            // (the relationship-exit-pruning class, 2026-07-31).
            const removedUserId = friends.find(f => f.id === friendshipId)?.friend?.id;
            // Optimistically update: remove from friends list
            setFriends(prev => prev.filter(f => f.id !== friendshipId));
            if (removedUserId) {
                setSelectedFriends(prev => {
                    if (!prev.has(removedUserId)) return prev;
                    const next = new Set(prev);
                    next.delete(removedUserId);
                    return next;
                });
            }
            // 88-33 Task 9 (row 553): refresh the shared provider so friendship
            // pills on every other surface reflect the removal immediately.
            refreshFriendships?.();
        } catch (err) {
            console.error('Error removing friend:', err);
            setRemoveError(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't remove that friend. Please try again.",
                })
            );
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
        }
    };

    /* DECISION Phase 88-14 (Req 11 / OI-7, owner-ratified 2026-08-04): remove-friend is the
       TWO-TAP tier, chosen OVER the `dialog` tier this surface's neighbours use and OVER the
       native browser prompt that shipped here before. Removing a friend is personal and re-addable
       by the search field directly above the list — the same class as "remove game from
       collection" — so per D-09's tier rule ("does it need explaining?") the label already says
       everything a dialog body could, and a misclick is the only real risk.

       Two-tap is viable HERE and not everywhere: D-07's recorded limit is that the armed trigger
       must SURVIVE the first click. This is a persistent inline row button, not an auto-closing
       menu item (which is exactly why D-40 keeps the gameDetail kebab's Delete on `dialog`).

       Retiering this to `dialog` is a one-word edit and a decision about friction, not a cleanup. */
    const removeFriendGate = useConfirmAction({
        tier: 'two-tap',
        // `title` is dialog-tier copy, accepted and ignored by two-tap (superset config).
        // It is authored anyway so a retier is genuinely the one-word edit above.
        title: 'Remove this friend?',
        body: "They'll drop off your friends list. You can send a new request by email any time.",
        confirmLabel: 'Remove',
        onConfirm: (friendshipId) => performRemoveFriend(friendshipId),
    });

    // Check if a user is already a friend. `userId` is the SEARCHED user's
    // Users.id UUID (not the caller's) — both sides of the join key on the
    // nested `.id` UUID keyspace so it stays correct pre- and post-PR-C.
    const isAlreadyFriend = (userId) => {
        return friends.some(f => f.friend?.id === userId);
    };

    // Check if a request is already pending with a user. Same target-parameter
    // shape as isAlreadyFriend — classifies the SEARCHED user via `userId`,
    // both join sides on the nested `.id` UUID.
    const isPendingRequest = (userId) => {
        return sentRequests.some(r => r.Addressee?.id === userId) ||
               receivedRequests.some(r => r.Requester?.id === userId);
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
                // Roster side of the already-in-group join keys on the Users.id
                // UUID (member.id). The friend side (friend.id below) keys on the
                // same keyspace, so the membership check is UUID-vs-UUID pre- and
                // post-PR-C (roster user_id aliases to the UUID / friend user_id
                // is dropped — a flat-keyed join would silently mismatch, D-07).
                const memberUserIds = memberList.map(m => m.id);
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
            // Skip anyone already in the group; otherwise invite by user_id.
            // The friend's email is resolved server-side (83-06 PII default-deny).
            if (groupMembers.includes(friendUserId)) continue;
            try {
                await invitesAPI.sendFriendInvite(selectedGroupId, friendUserId);
                successCount++;
            } catch (err) {
                failCount++;
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
        // Presence-guard the whole affordance on the Users.id UUID (present in
        // the GET /friendships/search response both pre- and post-PR-C). A
        // missing `id` is a missing-identity state — never fall back to the flat
        // `user_id`, which PR-C drops from this response (BE-12 / D-07).
        if (!foundUser || !foundUser.id) return null;

        if (foundUser.id === selfUuid) {
            return { type: 'self', label: "That's you!" };
        }
        if (isAlreadyFriend(foundUser.id)) {
            return { type: 'already-friends', label: 'Already friends' };
        }
        // `requestSent` ranks ABOVE isPendingRequest: handleSendRequest refetches
        // the sent list immediately, and once it lands the same request also
        // classifies as pending — which raced the "Request sent" confirmation
        // out after ~hundreds of ms. requestSent resets on the next search, so
        // the just-sent confirmation persists for THIS result without going
        // stale (owner UAT 2026-07-13, rode plan 10).
        if (requestSent) {
            return { type: 'sent', label: 'Request sent' };
        }
        if (isPendingRequest(foundUser.id)) {
            return { type: 'pending', label: 'Request pending' };
        }
        return { type: 'send', label: 'Send Request' };
    };

    // Loading / not logged in
    if (authLoading) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                <div role="status" aria-label="Signing you in" className="flex items-center gap-2 text-content-secondary">
                    <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-btn-primary" />
                    <span className="sr-only">Signing you in...</span>
                </div>
            </div>
        );
    }

    if (!user) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                <div className="text-center">
                    <h1 className="text-3xl font-bold text-content-primary mb-4">Friends</h1>
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

    // D-09 identity GATE. The friend↔friend classification (already-friends,
    // pending, is-self) IS the page content, so we do NOT render a mixed/partial
    // list before the caller's UUID resolves. Permanent identity failure shows
    // the standard (non-compact) error surface — not the compact degrade notice
    // other surfaces use — because there is no meaningful partial view here.
    if (selfIdentityErrorState.showError) {
        return (
            <div className="min-h-screen bg-surface-page">
                <div className="max-w-3xl mx-auto px-4 py-8">
                    <h1 className="text-3xl font-bold text-content-primary mb-6">Friends</h1>
                    <FetchErrorBanner
                        state={selfIdentityErrorState}
                        title="Couldn't load your friends"
                        reportContext="friends page — self-identity resolution"
                    />
                </div>
            </div>
        );
    }

    /* DECISION Phase 88-33 Task 1 (M1, walk 2026-08-13 test 9): while identity is still
       UNRESOLVED, a page-data failure that has ALREADY happened outranks the identity spinner —
       chosen OVER leaving the `!selfUuid` spinner as the unconditional gate (the shipped shape),
       and OVER dropping the D-09 gate altogether.

       THE BUG THIS FIXES: the friends + sent fetchers fire on `[user]`, not on identity, so with
       the backend unreachable they fail within a tick and `friendsErrorState.showError` is already
       true — but the bare `!selfUuid` spinner rendered above them, so nothing that already knew
       the backend was down could reach the screen. The window is not milliseconds: every attempt
       goes through the BFF proxy, whose own PROXY_TIMEOUT_MS is 30_000
       (app/api/[...path]/route.ts:22), and `shouldRetry` grants one retry — which is the walk's
       "observed 30-60s" / "60+s" of blank page, not a missing terminal state.

       D-09 IS PRESERVED, not weakened: this branch renders NO friend↔friend classification — no
       list, no tabs, no search results — only the shell plus the error surface. The gate's rule is
       "never render a mixed/partial list before the caller's UUID resolves"; telling someone the
       load failed is not a partial list. Re-collapsing this into the spinner is a decision to
       restore a silent blank page, not a simplification. */
    if (!selfUuid && (friendsErrorState.showError || sentErrorState.showError)) {
        return (
            <div className="min-h-screen bg-surface-page">
                <div className="max-w-3xl mx-auto px-4 py-8">
                    <h1 className="text-3xl font-bold text-content-primary mb-6">Friends</h1>
                    <FetchErrorBanner
                        state={friendsErrorState.showError ? friendsErrorState : sentErrorState}
                        title="Couldn't load your friends"
                        reportContext="friends page — page data failed while identity was still resolving"
                    />
                </div>
            </div>
        );
    }

    if (!selfUuid) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                <div role="status" aria-label="Loading your friends" className="flex items-center gap-2 text-content-secondary">
                    <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-btn-primary" />
                    <span className="sr-only">Loading your friends...</span>
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

                {/* The remove-friend gate's live region. Mounted HERE — once, outside the
                    tab conditional and outside the row map — because a live region that
                    mounts with the armed row announces nothing (empty-first contract,
                    StatusRegion.tsx:8-11). Moving it inside the Friends tab or into the
                    row is a silent a11y regression, not a tidy-up. */}
                {removeFriendGate.statusNode}

                {/* Search Section */}
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="text-xl font-bold text-content-primary mb-3">Add Friend</h2>
                    <form onSubmit={handleSearch} className="flex gap-3">
                        {/* 88-33 Task 8 (fork 5): id/name + explicit name — the section
                            heading ("Add Friend") names the card, not the field. */}
                        <Input
                            id="add-friend-email"
                            name="add-friend-email"
                            aria-label="Friend's email address"
                            type="email"
                            value={searchEmail}
                            onChange={(e) => setSearchEmail(e.target.value)}
                            placeholder="Enter friend's email address"
                            className="flex-1"
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
                        <div role="status" aria-label="Searching for that email address" className="mt-4 flex items-center gap-2 text-content-secondary">
                            <div aria-hidden="true" className="animate-spin rounded-full h-4 w-4 border-b-2 border-btn-primary" />
                            <span>Searching...</span>
                        </div>
                    )}

                    {/* role="alert": submit-time search feedback, including the legitimate
                        "no user found" outcome — either way the person pressed Search and is
                        waiting to be told what happened. */}
                    {searchError && (
                        <div role="alert" className="mt-4 p-3 bg-surface-page border border-line rounded-lg">
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
                                                    onClick={() => handleSendRequest(searchResult.id)}
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
                        {/* An ACTION failure (a remove that did not go through) is a line above
                            an otherwise intact list — deliberately NOT one of the branches below,
                            which would blank the list the person is still looking at. */}
                        {/* role="alert": this is a submit-time failure on a destructive action,
                            so it must interrupt. Same DEF-88-19-04 gap as userProfile's phone
                            flow — a screen-reader user was told nothing when a Remove failed. */}
                        {removeError && (
                            <p role="alert" className="text-status-error text-sm mb-4">{removeError}</p>
                        )}
                        {/* 88-33 Task 1: the groups fetch feeds ONLY the invite-to-group bar, which is
                            itself gated on `userGroups.length > 0` — so a swallowed failure was
                            indistinguishable from "you administer no groups". Compact degrade notice:
                            the friends list beside it is intact, so this must not blank it. */}
                        {groupsErrorState.showError && (
                            <div className="mb-4">
                                <FetchErrorBanner state={groupsErrorState} compact />
                            </div>
                        )}
                        {/* DECISION Phase 88-14 (Req 6 / Req 14, UI-SPEC §9.2): empty and failed-to-load
                            are SEPARATE, mutually exclusive branches here. Before this, a failed fetch
                            left `friends` at [] and fell through to the empty copy, so a network failure
                            told the person they had no friends — the shipped walkthrough finding §9.2
                            folds in. EmptyState means "nothing here yet" and nothing else; a fetch
                            failure gets the error banner with its retry. Collapsing these back into one
                            branch is a decision to re-introduce that lie, not a simplification. */}
                        {loadingFriends ? (
                            <div role="status" aria-label="Loading your friends" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading friends...</span>
                            </div>
                        ) : friendsErrorState.showError ? (
                            <FetchErrorBanner
                                state={friendsErrorState}
                                title="Couldn't load your friends"
                                reportContext="friends page — friends list fetch"
                            />
                        ) : friends.length === 0 ? (
                            /* No CTA: the search field directly above IS the action (§9.2). */
                            <EmptyState
                                icon="UsersRound"
                                heading="No friends yet"
                                body="Search by email above to find the people you play with."
                            />
                        ) : (
                            <div>
                                {/* Group Invite Bulk Action Bar */}
                                {userGroups.length > 0 && (
                                    <div className="mb-4 p-3 md:p-6 card">
                                        <div className="flex flex-wrap items-center gap-3">
                                            <label htmlFor="group-invite-select" className="text-sm font-medium text-content-secondary">
                                                Invite to Group:
                                            </label>
                                            <SelectControl
                                                id="group-invite-select"
                                                aria-label="Invite to group"
                                                value={selectedGroupId}
                                                onChange={(e) => setSelectedGroupId(e.target.value)}
                                                className="flex-1 min-w-[180px] max-w-xs"
                                            >
                                                <option value="" disabled>Select a group...</option>
                                                {userGroups.map(group => (
                                                    <option key={group.id} value={group.id}>
                                                        {group.name}
                                                    </option>
                                                ))}
                                            </SelectControl>
                                            <button
                                                onClick={handleBulkInvite}
                                                disabled={!selectedGroupId || selectedFriends.size === 0 || bulkInviteLoading}
                                                aria-busy={bulkInviteLoading || undefined}
                                                className="btn btn-primary px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                            >
                                                {bulkInviteLoading && (
                                                    <>
                                                        <div aria-hidden="true" className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                                        <span className="sr-only">Sending invites...</span>
                                                    </>
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
                                            <div role="status" aria-label="Loading group members" className="mt-2 flex items-center gap-2 text-xs text-content-muted">
                                                <div aria-hidden="true" className="animate-spin rounded-full h-3 w-3 border-b-2 border-content-muted" />
                                                <span>Loading group members...</span>
                                            </div>
                                        )}
                                        {/* Bulk invite result feedback */}
                                        {bulkInviteResult && (
                                            <div className={`mt-3 p-3 rounded-lg text-sm font-medium ${
                                                bulkInviteResult.failCount === 0
                                                    ? 'bg-status-success-subtle text-status-success border border-status-success'
                                                    : bulkInviteResult.successCount > 0
                                                        ? 'bg-status-warning-subtle text-status-warning border border-status-warning'
                                                        : 'bg-status-error-subtle text-status-error border border-status-error'
                                            }`}>
                                                {bulkInviteResult.failCount === 0
                                                    ? `Invited ${bulkInviteResult.successCount} friend(s) to ${getSelectedGroupName()}!`
                                                    : bulkInviteResult.successCount > 0
                                                        ? `Invited ${bulkInviteResult.successCount} friend(s), ${bulkInviteResult.failCount} failed`
                                                        : "We couldn't send those invites. Please try again."
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

                                        // Friend side of the already-in-group join + the bulk-invite
                                        // write arg both key on the Users.id UUID (friend.id), matching
                                        // the roster side (member.id) above — single keyspace end-to-end.
                                        const friendUserId = friend.id;
                                        const isInGroup = selectedGroupId && groupMembers.includes(friendUserId);
                                        const checkboxDisabled = !selectedGroupId || isInGroup;

                                        return (
                                            <div
                                                key={friendship.id}
                                                className="flex items-center justify-between p-4 border border-line rounded-card hover:bg-surface-card-hover"
                                            >
                                                <div className="flex items-center gap-3 flex-1">
                                                    <input
                                                        id={`bulk-invite-${friendship.id}`}
                                                        name={`bulk-invite-${friendship.id}`}
                                                        type="checkbox"
                                                        aria-label={`Select ${friend.username}`}
                                                        checked={isInGroup || selectedFriends.has(friendUserId)}
                                                        disabled={checkboxDisabled}
                                                        onChange={() => toggleFriendSelection(friendUserId)}
                                                        className={`h-4 w-4 rounded-sm border-line text-btn-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
                                                            checkboxDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                                        }`}
                                                    />
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <p className="font-semibold text-content-primary">
                                                                {friend.username}
                                                            </p>
                                                            {isInGroup && (
                                                                <span className="text-xs text-content-muted italic">(already in group)</span>
                                                            )}
                                                        </div>
                                                        {/* Friend email is no longer exposed in the friends payload (Phase 83-06 PII default-deny); invites resolve it server-side by user_id. */}
                                                    </div>
                                                </div>
                                                {(() => {
                                                    const friendName = friend.username || 'this friend';
                                                    const removing = actionLoading[friendship.id] === 'remove';
                                                    const armed = removeFriendGate.isArmed(friendship.id);
                                                    return (
                                                        <button
                                                            // targetId is the FRIENDSHIP id (what the API takes) and
                                                            // targetLabel is the person — the live region names them,
                                                            // so switching rows is a guaranteed re-announcement.
                                                            {...removeFriendGate.triggerProps(
                                                                friendship.id,
                                                                friendName,
                                                                `Remove ${friendName}`
                                                            )}
                                                            // Label-in-Name (WCAG 2.5.3) during the commit: the
                                                            // visible label is "Removing...", so the accessible name
                                                            // must contain it. The hook only owns resting-vs-armed.
                                                            {...(removing ? { 'aria-label': `Removing ${friendName}` } : {})}
                                                            disabled={removing}
                                                            // DECISION Phase 88-27 (D-32 bucket D): the hover affordance
                                                            // 87.7 stripped from here was a TEXT alpha (error text at
                                                            // 80% on hover). It comes back as a subtle SURFACE, chosen
                                                            // OVER re-adding the text alpha — that is the forbidden
                                                            // mechanism — and OVER leaving the control with no hover
                                                            // state at all, which would have been a silent downgrade
                                                            // dressed up as a decision. A background cannot collide with
                                                            // the armed state below it, which speaks in border and
                                                            // weight. Same treatment on the two delete-pattern gates in
                                                            // userProfile and on ParticipantRow's Remove, which reaches
                                                            // it by the ordinary bucket-C rule.
                                                            className={`min-h-11 px-3 rounded-btn border text-sm transition-colors disabled:opacity-50 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring text-status-error hover:bg-status-error-subtle ${
                                                                armed
                                                                    ? 'border-status-error font-semibold'
                                                                    : 'border-transparent font-medium'
                                                            }`}
                                                        >
                                                            {removing
                                                                ? 'Removing...'
                                                                : removeFriendGate.labelFor(friendship.id, 'Remove')}
                                                        </button>
                                                    );
                                                })()}
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
                            <div role="status" aria-label="Loading your friend requests" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading requests...</span>
                            </div>
                        ) : receivedRequests.length === 0 ? (
                            <div className="text-center py-12">
                                {/* D2 mini-formula rider (88-33 Task 7, Rule 2 — same class as the
                                    sent-requests sibling below): + text-sm. */}
                                <p className="text-content-muted text-sm">No pending friend requests.</p>
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
                        {/* DECISION Phase 88-25 (Req 14 / T-88-25-02, UI-SPEC 9.2): the Sent tab now
                            splits empty from failed, the same way 88-14 split the Friends tab above.
                            Before this, a failed fetch printed a bare red line AND fell through to
                            "No sent friend requests." — so the person was told, in the same breath,
                            that something went wrong and that they had sent nothing. The error branch
                            is checked BEFORE the empty branch and that order is load-bearing: an
                            errored fetch also has zero requests. */}
                        {loadingSent ? (
                            <div role="status" aria-label="Loading your sent requests" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading sent requests...</span>
                            </div>
                        ) : sentErrorState.showError ? (
                            <FetchErrorBanner
                                state={sentErrorState}
                                title="Couldn't load your sent requests"
                                reportContext="friends page — sent requests fetch"
                            />
                        ) : sentRequests.length === 0 ? (
                            <div className="text-center py-12">
                                {/* D2 mini-formula rider (88-33 Task 7, Rule 2): + text-sm. */}
                                <p className="text-content-muted text-sm">No sent friend requests.</p>
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
                                            <span className="px-3 py-1 rounded-full text-xs font-semibold bg-status-warning-subtle text-status-warning border border-status-warning">
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
