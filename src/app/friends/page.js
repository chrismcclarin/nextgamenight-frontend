'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, groupsAPI, invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import {
    FetchErrorBanner,
    RefreshFailedNotice,
    RetainedContentFocusGuard,
    useRetainedContent,
} from '../../components/ui/FetchErrorBanner';
// Copy rows N5 / N6 (D-30): the bell's own constants for the same provider call, never retyped.
import { ACCEPT_FRIEND_FAILED_COPY, DECLINE_FRIEND_FAILED_COPY } from '../components/NotificationBell';
// 88-33 Task 1 (r3 triage): this page's fetchers run through a raw
// Promise.allSettled, NOT react-query, so they bypass the global
// QueryCache.onError hook entirely and their failures never reached Sentry.
// Reporting through the SAME exported function keeps the entity/scope tagging
// and the T-84-05 PII rules identical to every query-driven report.
import { queryCacheOnError } from '../../lib/queryClient';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { EmptyState } from '../../components/ui/EmptyState';
import { Input, SelectControl } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { logger, errCtx } from '../../lib/logger';

// D-32 R2 (R8: straight apostrophe), byte-identical to the line this page already showed; the
// same name as the FriendInvitePanel twin's constant.
const BATCH_INVITE_FAILED_MESSAGE = "We couldn't send those invites. Please try again.";

// Copy row FR1 (owner ruling 2026-10-05, D-47; D-32 R8 straight apostrophe): the Requests tab's
// full-banner title when the provider's load failed and nothing is retained.
const FRIEND_REQUESTS_LOAD_FAILED_TITLE = "Couldn't load your friend requests";

// The row among the elements carrying `attribute` whose value is `id` (compared as strings).
function rowElementFor(attribute, id) {
    const rows = document.querySelectorAll('[' + attribute + ']');
    for (const row of rows) {
        if (row.getAttribute(attribute) === String(id)) return row;
    }
    return null;
}

// Captures the row's next and previous siblings NOW and returns a resolver for the focus
// recovery hook: when it runs, the first of them that is still connected, is not a row the
// caller reports as still in flight, and holds a button or input carrying neither the native
// disabled attribute nor aria-disabled="true" yields that control; else nothing, so the hook
// takes its fallback (see the Req 5 marker on the hook instances).
function neighbourControl(row, isRowInFlight) {
    const candidates = row ? [row.nextElementSibling, row.previousElementSibling] : [];
    return () => {
        for (const candidate of candidates) {
            if (!candidate || !candidate.isConnected) continue;
            if (isRowInFlight && isRowInFlight(candidate)) continue;
            const control = Array.from(candidate.querySelectorAll('button, input')).find(
                (el) => !el.hasAttribute('disabled') && el.getAttribute('aria-disabled') !== 'true'
            );
            if (control) return control;
        }
        return null;
    };
}

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
        // 88.6.1-66's read-only fact: an accept or decline for that request id is in flight on
        // ANY surface (the bell included). Its context default is a function, never undefined.
        isRequestActionPending,
        // 88.6.1-66's load-error object (null while healthy, never cleared at the start of a load),
        // its has-loaded fact (the Requests tab's C3 input) and its JOINING retry (the Requests
        // adapter's refetch, review finding #149).
        error: friendshipLoadError,
        hasLoaded: friendshipHasLoaded,
        retryFriendships,
    } = useFriendshipStatus();

    // Tab state
    const [activeTab, setActiveTab] = useState('friends');

    // Data state — local copies kept for friends + sent (still owned here)
    const [friends, setFriends] = useState([]);
    const [sentRequests, setSentRequests] = useState([]);

    // Has each list loaded successfully at least once (see the AC-29 marker on fetchFriends)?
    const [friendsLoaded, setFriendsLoaded] = useState(false);
    const [sentLoaded, setSentLoaded] = useState(false);
    const friendsFetchGenRef = useRef(0);
    const sentFetchGenRef = useRef(0);

    // Search state
    const [searchEmail, setSearchEmail] = useState('');
    const [searchResult, setSearchResult] = useState(null);
    const [searchError, setSearchError] = useState(null);
    const [searching, setSearching] = useState(false);
    // The person the last successful send went to (review r2 #47): the confirmation belongs
    // to them, not to whatever result is shown when the send settles.
    const [sentToId, setSentToId] = useState(null);
    const [sendingRequest, setSendingRequest] = useState(false);

    // Error state. `friendsLoadError` is the FETCH failure (the whole list is
    // unavailable); `removeError` is an ACTION failure with the list still
    // intact. They render as different things — see the DECISION marker on the
    // Friends tab below.
    const [friendsLoadError, setFriendsLoadError] = useState(null);
    const [removeError, setRemoveError] = useState(null);
    // A failed Accept / Decline on the Requests tab: `{ id, message }`, the request it describes and
    // its line (see the N5 / N6 marker on the Requests tab), never a bare string.
    const [requestActionError, setRequestActionError] = useState(null);
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

    /* DECISION Phase 88.6.1-40 (D-35, rule of POSITION): the control the user just pressed keeps
       focus while its request runs: `aria-disabled` plus a SYNCHRONOUS first-line ref latch
       released in a `finally`, chosen OVER the native `disabled` attribute it shipped with (the
       FriendInvitePanel twin, DECISION 88.6-22). A natively disabled element leaves the focus
       order, so a keyboard or switch user is stranded mid-submit. The latch is a ref, not the
       state flag, because a state write does not land before a second synchronous press.

       Invite to Group is such a control. Its VALIDITY half (no group, no friend selected, the
       group's members still loading) moves to `aria-disabled` as well, because the batch's own
       settle empties the selection, and a native gate would then blur the very button the user
       pressed. Disclosed visible delta: at rest with nothing selected (and while a group's
       members load) it shows the gated colour pair instead of the 50% wash; pressing it then
       sends nothing.

       The other pressed controls on this page, the same rule: Search, Send Request, Remove (its
       latch is the confirm hook's own re-entry refusal), Accept and Decline. The SIBLING of a
       pressed request-row button keeps the native attribute (Accept while Decline runs, and the
       reverse), and so does the friend checkbox: both are the rule of KIND, gates on controls
       nobody pressed. Search's empty-field half stays native too (rule of KIND): a press never
       empties the field, and Tab past it reaches the tab strip, so it is no dead end, unlike the
       invite panel's dialog. A request row whose request runs from the BELL is natively
       disabled on both buttons here (plan 88.6.1-66's in-flight fact, read only while this page
       has no press of its own for the row), chosen OVER leaving them live (the provider refuses
       an other-kind press with no request sent, and the page would report a decline that was
       never sent as failed) and OVER an aria-disabled pair (neither button was pressed on this
       surface, so no focus has to be kept). Disclosed visible delta: Remove no longer dims
       while removing; its label carries the state, and the 88.8 rule forbids an opacity look on
       a gated control. REJECTED for every pressed control: native disabling (a natively
       disabled element leaves the focus order). */
    const bulkInviteInFlightRef = useRef(false);
    // Newest wins for the group-members load: bumped on every run of the members effect below.
    const membersLoadGenRef = useRef(0);
    const searchInFlightRef = useRef(false);
    const sendRequestInFlightRef = useRef(false);
    // Request ids whose accept or decline THIS page pressed and is still waiting on.
    const requestActionInFlightRef = useRef(new Set());
    const addFriendHeadingRef = useRef(null);
    const sentChipRef = useRef(null);
    const friendsTabRef = useRef(null);
    const requestsTabRef = useRef(null);
    const sentTabRef = useRef(null);
    const tabRefs = { friends: friendsTabRef, requests: requestsTabRef, sent: sentTabRef };
    // The id of the search result shown now (written beside every write of the result, in
    // handleSearch): a send that settles later reads it to decide whether its outcome still
    // belongs on screen.
    const shownResultIdRef = useRef(null);

    /* DECISION Phase 88.6.1-40 (Req 5, D-04/D-05, D-06 shape): four controls now keep focus
       while they work and are then unmounted by their own success (Send Request by the chip,
       Remove with its row, Accept and Decline with theirs), so each host arms the ONE shared
       recovery hook (plan 88.6.1-04) at the press. Targets: the "Request sent" chip itself,
       programmatic only and out of the Tab order (the shape the owner ruled for the guest-invite
       chip, D-06), because focusing it is also what makes the outcome heard, and only for the
       person the request went to; the neighbouring row's first enabled control (adjacency),
       never a control still in flight, because one recovery per host covers only the latest
       press (a re-arm replaces the earlier one), chosen OVER one recovery per request row (a
       structural split of the row for a case the skip already lands on the tab); else the
       section's own tab button (no heading is minted, D-05). REJECTED: the page heading (far
       from where the user stood), the Add Friend heading for a successful send (the outcome
       would stay unheard), a polite region plus the heading (plan 88.6.1-27's panel shape,
       needed there because its success line IS a live region; here the chip is plain text), and
       a fallback prop on any primitive (D-04). The two-tap confirm still guards a destructive
       press on a Remove that focus lands on. Changing this is a decision, not a cleanup. */
    const sendRecovery = useFocusRecovery({ fallback: addFriendHeadingRef });
    const removeRecovery = useFocusRecovery({ fallback: friendsTabRef });
    const requestRecovery = useFocusRecovery({ fallback: requestsTabRef });
    // A request row is "in flight" for the neighbour resolver while THIS page waits on it.
    const isRequestRowInFlight = (row) => {
        const id = row.getAttribute('data-request-row');
        if (id === null) return false;
        return Array.from(requestActionInFlightRef.current).some((inFlight) => String(inFlight) === id);
    };

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
            logger.info('Error fetching user groups:', errCtx(err));
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

    /* DECISION Phase 88.6.1-40 (AC-29, Req 9): the loading line replaces a list on its FIRST
       load only, a has-loaded flag (friendsLoaded / sentLoaded) and never a length, because a
       true zero would otherwise re-show the loading line (D-09a / D-37); a refresh after an
       accept or a send keeps the rows on screen. The newest response wins: a generation bumped
       at call start and checked before every state write (the phase's one staleness idiom, the
       generation of QuickSuggestions.js), because two of the three callers are handlers with no
       effect cleanup to cancel them. Every failure is still logged and reported once, before the
       check. REJECTED: a visible "Updating" line or aria-busy on the list (D-09 gave that line
       to Browse Games only). The failed-refresh treatment (rows kept beside a notice) is plan
       88.6.1-72's. Changing this is a decision, not a cleanup.
       AMENDED Phase 88.6.1-72 (88.6.1-70 contract C2 / C4): the error is cleared only by the
       newest success, never at the start of a run, so the notice and the full banner stay mounted
       through their own retry; each run resolves { isError } for the retry that ran (undefined when
       a newer run superseded it), which is what lets a failed retry be announced and a success be
       told apart from a lagging commit. The loading line now reads the has-loaded flag alone, so
       the per-run loading state it used is gone. */
    const fetchFriends = async () => {
        const gen = ++friendsFetchGenRef.current;
        try {
            const data = await friendshipsAPI.getFriends();
            if (gen !== friendsFetchGenRef.current) return undefined;
            setFriends(Array.isArray(data) ? data : []);
            setFriendsLoaded(true);
            setFriendsLoadError(null);
            return { isError: false };
        } catch (err) {
            logger.info('Error fetching friends:', errCtx(err));
            queryCacheOnError(err, { queryKey: ['friendships', 'accepted'] });
            if (gen !== friendsFetchGenRef.current) return undefined;
            // Keep the ERROR, not a flattened string: useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            // Wording matches the 88-18 register ("The X request didn't complete.") used by
            // grouplist.js / GroupLibrary.js. This string is never shown — a non-ApiError
            // resolves to code `unknown` and useFetchErrorState renders the designed copy for
            // that code — but Req 14's negative gate is a plain grep, so the phrasing matters.
            setFriendsLoadError(
                err instanceof Error ? err : new Error("The friends request didn't complete.")
            );
            return { isError: true };
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
       documents that it reads ONLY `isError`/`error`/`refetch` (useFetchErrorState.ts:261, the
       @param line ending "are read"; re-pointed 88.6.1-40). */
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

    // The same first-load-only line and newest-wins generation as fetchFriends (its marker).
    // Contract C2 / C4 as well (the amendment on that marker).
    const fetchSentRequests = async () => {
        const gen = ++sentFetchGenRef.current;
        try {
            const data = await friendshipsAPI.getSentRequests();
            if (gen !== sentFetchGenRef.current) return undefined;
            setSentRequests(Array.isArray(data) ? data : []);
            setSentLoaded(true);
            setSentError(null);
            return { isError: false };
        } catch (err) {
            logger.info('Error fetching sent requests:', errCtx(err));
            queryCacheOnError(err, { queryKey: ['friendships', 'sent'] });
            if (gen !== sentFetchGenRef.current) return undefined;
            // Keep the ERROR object, not a flattened string: useFetchErrorState reads
            // `ApiError.code` off it to pick the right user-facing copy.
            setSentError(
                err instanceof Error ? err : new Error("The sent-requests request didn't complete.")
            );
            return { isError: true };
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

    // The Requests tab over the shared provider (88.6.1-70 contract C5): the refetch is plan
    // 88.6.1-66's JOINING retry, so this adapter's tab-return re-attempt and the bell's share one
    // load; the always-fresh refreshFriendships stays the post-unfriend sync only.
    const requestsErrorState = useFetchErrorState({ isError: Boolean(friendshipLoadError), error: friendshipLoadError, refetch: retryFriendships });
    /* DECISION Phase 88.6.1-72 (RF1 retained, Requests tab): what has loaded is the PROVIDER's own
       has-loaded fact for the signed-in user (plan 88.6.1-66's hasLoaded: set by the newest
       successful load, never cleared by a transient failure, cleared with the lists by an access
       or gone answer (this plan's Task 4, owner ruling #11), reset when the signed-in user
       changes), chosen OVER a flag this page sets by watching the provider settle (a provider that
       loaded before this page opened, empty, and failed since would read as never loaded and show
       the full banner where the owner's ruling of 2026-10-05 wants the small notice above the
       empty line) and OVER a row count (a list that loaded empty would read as never loaded,
       88.6.1-70 contract C3). Compared with true, so a provider without the field reads as not
       loaded. That value goes through plan 70's shared hook, never a code list written here, so an
       answer saying access was lost or the content is gone is never kept (contract C10); the
       memory of such an answer is the provider's (Task 4), because the provider outlives this
       page. Changing this is a decision, not a cleanup. */
    const requestsRetained = useRetainedContent(friendshipHasLoaded === true, requestsErrorState);
    // The Friends and Sent tabs the same way (88.6.1-70 contract C10): the has-loaded flag (C3)
    // through the shared hook, which withdraws on an access or gone answer until the next success.
    const friendsRetained = useRetainedContent(friendsLoaded, friendsErrorState);
    const sentRetained = useRetainedContent(sentLoaded, sentErrorState);
    // FR1, the Requests tab's full banner: an error with nothing retained.
    const requestsFullBannerShown = requestsErrorState.showError && !requestsRetained;
    // FR1 showing CLEARS the request-action line (a clear, not a hide; the N5 / N6 marker), so a
    // recovery never brings back a line about a session or access state that may no longer hold.
    if (requestsFullBannerShown && requestActionError !== null) setRequestActionError(null);

    // Search handler
    const handleSearch = async (e) => {
        // FIRST, always: a refused submit must never fall through to a native form post.
        e.preventDefault();
        // The in-flight refusal (the rule-of-POSITION marker above): Search stays focusable.
        if (searchInFlightRef.current) return;
        if (!searchEmail.trim()) return;

        searchInFlightRef.current = true;
        setSearching(true);
        setSearchResult(null);
        shownResultIdRef.current = null;
        setSearchError(null);
        setSentToId(null);

        try {
            const result = await friendshipsAPI.searchUserByEmail(searchEmail.trim());
            setSearchResult(result);
            shownResultIdRef.current = result?.id ?? null;
        } catch (err) {
            if (err?.status === 404) {
                setSearchError('No user found with that email.');
            } else {
                /* DECISION Phase 88-25 (Req 14 / T-88-25-01): derived copy, chosen OVER
                   the `err.message || '…'` idiom. "No user found" is a legitimate SEARCH
                   OUTCOME the person can act on (check the address), not a failure, and there
                   is no ApiError code that carries it — so it keeps its own branch and its own
                   string. This branch is the genuine failure and does not paint upstream text.

                   AMENDED Phase 88.6-42 (2026-09-17): the two branches above USED to be a
                   PROSE match on `ApiError.message` — `.includes('404')` and
                   `.includes('No user found')` — and this block sanctioned them. That prose
                   match is RETIRED, and it was retired BECAUSE Phase 88.6 dropped the
                   `body.error` legacy alias from `extractErrorMessage` (api.ts), not tidied
                   away as cleanup. The string the second arm matched came from
                   Sonnet/routes/friendships.js:251, a RAW 404 with no `code` and no
                   `message`, so after the drop `ApiError.message` is the bare
                   "HTTP error! status: 404" template and that arm could never match again.
                   The user-visible outcome survived only INCIDENTALLY, because the sibling
                   arm tested `.includes('404')` and the fallback string happens to contain
                   "404" — luck, not a design. The outcome is now STATUS-KEYED off
                   `err.status`, which apiFetch sets on every ApiError it throws, and the
                   visible string is byte-identical. Re-introducing a message-content match
                   here is a decision, not a cleanup. Pinned in friends/page.test.tsx. */
                setSearchError(
                    getFetchErrorMessage(err, {
                        fallback: "We couldn't run that search. Please try again.",
                    })
                );
            }
        } finally {
            searchInFlightRef.current = false;
            setSearching(false);
        }
    };

    // Send friend request
    const handleSendRequest = async (addresseeUserId, event) => {
        // The in-flight refusal, synchronous and FIRST (the rule-of-POSITION marker above).
        if (sendRequestInFlightRef.current) return;
        sendRequestInFlightRef.current = true;
        // Clear-then-set (D-32 R8): a repeated failure is removed here and re-inserted below,
        // so it is announced again.
        setSearchError(null);
        // Armed before the first await (plan 88.6.1-04 consumer contract). The chip is the
        // target only while the result shown is still the person this request went to.
        const settle = sendRecovery.arm({
            preferred: () => (shownResultIdRef.current === addresseeUserId ? sentChipRef.current : null),
            from: event?.currentTarget,
        });
        setSendingRequest(true);
        try {
            await friendshipsAPI.sendRequest(addresseeUserId);
            setSentToId(addresseeUserId);
            // Refresh sent requests list
            fetchSentRequests();
        } catch (err) {
            // Only while the result shown NOW (not the one at the press) is still the addressee.
            if (shownResultIdRef.current !== addresseeUserId) return;
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
            sendRequestInFlightRef.current = false;
            setSendingRequest(false);
            settle();
        }
    };

    // Accept: the provider removes the row when the server confirms (plan 88.6.1-66); a failure keeps the row and is shown here.
    // Since 88.6.1-66 the provider drops the row inside the awaited call, the moment the
    // server confirms, so the recovery is armed and the neighbour captured before that await.
    const handleAccept = async (friendshipId, event) => {
        if (requestActionInFlightRef.current.has(friendshipId)) return;
        requestActionInFlightRef.current.add(friendshipId);
        // Clear-first (D-42): a repeated failure is removed here and inserted again below.
        setRequestActionError(null);
        const settle = requestRecovery.arm({
            preferred: neighbourControl(rowElementFor('data-request-row', friendshipId), isRequestRowInFlight),
            from: event?.currentTarget,
        });
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'accept' }));
        try {
            await ctxAcceptRequest(friendshipId);
            fetchFriends();
        } catch (err) {
            logger.info('Error accepting request:', errCtx(err));
            setRequestActionError({
                id: friendshipId,
                message: getFetchErrorMessage(err, { fallback: ACCEPT_FRIEND_FAILED_COPY }),
            });
        } finally {
            requestActionInFlightRef.current.delete(friendshipId);
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
            settle();
        }
    };

    // Decline: the provider removes the row when the server confirms (plan 88.6.1-66); a failure keeps the row and is shown here.
    const handleDecline = async (friendshipId, event) => {
        if (requestActionInFlightRef.current.has(friendshipId)) return;
        requestActionInFlightRef.current.add(friendshipId);
        // Clear-first (D-42), as in handleAccept.
        setRequestActionError(null);
        const settle = requestRecovery.arm({
            preferred: neighbourControl(rowElementFor('data-request-row', friendshipId), isRequestRowInFlight),
            from: event?.currentTarget,
        });
        setActionLoading(prev => ({ ...prev, [friendshipId]: 'decline' }));
        try {
            await ctxDeclineRequest(friendshipId);
        } catch (err) {
            logger.info('Error declining request:', errCtx(err));
            setRequestActionError({
                id: friendshipId,
                message: getFetchErrorMessage(err, { fallback: DECLINE_FRIEND_FAILED_COPY }),
            });
        } finally {
            requestActionInFlightRef.current.delete(friendshipId);
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
            settle();
        }
    };

    // Remove friend — the COMMIT half only. It is unreachable except through the
    // gate below, which is what makes the first tap non-destructive.
    const performRemoveFriend = async (friendshipId) => {
        // Runs synchronously inside the second tap, so this arms before the first await.
        const settle = removeRecovery.arm({
            preferred: neighbourControl(rowElementFor('data-friend-row', friendshipId)),
        });
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
            logger.info('Error removing friend:', errCtx(err));
            setRemoveError(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't remove that friend. Please try again.",
                })
            );
        } finally {
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
            settle();
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
    // 88.6.1-40 (Req 11, review r2 #49 and r3 L-05): only the CURRENT group's answer writes (a
    // generation, the house staleness idiom — see the batch-regions marker below), and when it
    // lands every selected friend who is already a member leaves the selection.
    useEffect(() => {
        const gen = ++membersLoadGenRef.current;
        if (!selectedGroupId) {
            setGroupMembers([]);
            // An older answer's settle no longer clears the loading flag, so this branch does.
            setGroupMembersLoading(false);
            return;
        }
        setGroupMembersLoading(true);
        setSelectedFriends(new Set());
        groupsAPI.getGroupMembers(selectedGroupId)
            .then(members => {
                if (gen !== membersLoadGenRef.current) return;
                const memberList = Array.isArray(members) ? members : members?.members || [];
                // Roster side of the already-in-group join keys on the Users.id
                // UUID (member.id). The friend side (friend.id below) keys on the
                // same keyspace, so the membership check is UUID-vs-UUID pre- and
                // post-PR-C (roster user_id aliases to the UUID / friend user_id
                // is dropped — a flat-keyed join would silently mismatch, D-07).
                const memberUserIds = memberList.map(m => m.id);
                setGroupMembers(memberUserIds);
                // Read the selection as it is NOW (an updater), not as it was when the load
                // started, so a check made during the load for a non-member survives.
                setSelectedFriends(prev => {
                    if (!memberUserIds.some(id => prev.has(id))) return prev;
                    const next = new Set(prev);
                    memberUserIds.forEach(id => next.delete(id));
                    return next;
                });
            })
            .catch(() => {
                if (gen !== membersLoadGenRef.current) return;
                setGroupMembers([]);
            })
            .finally(() => {
                if (gen !== membersLoadGenRef.current) return;
                setGroupMembersLoading(false);
            });
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
        // The in-flight refusal, synchronous and FIRST (the rule-of-POSITION marker above).
        if (bulkInviteInFlightRef.current) return;
        // Refused while the chosen group's members load: the selection is pruned when they land.
        if (!selectedGroupId || selectedFriends.size === 0 || groupMembersLoading) return;
        bulkInviteInFlightRef.current = true;
        // Captured BEFORE the loop: the outcome names the group this batch was sent to.
        const groupName = getSelectedGroupName();
        setBulkInviteLoading(true);
        // The ONLY place the outcome is cleared: it stays until the next batch starts.
        setBulkInviteResult(null);

        let successCount = 0;
        let failCount = 0;

        try {
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

            setBulkInviteResult({ successCount, failCount, groupName });
            setSelectedFriends(new Set());
        } finally {
            bulkInviteInFlightRef.current = false;
            setBulkInviteLoading(false);
        }
    };

    // Get selected group name for feedback messages (captured once, when a batch starts)
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
        // DECISION Phase 88.6.1-40 (carry-in from plan 88.6.1-66's planner): while a list this
        // classification reads is still on its first load (this page's friends or sent list, or
        // the provider's received requests), the result shows no action at all, the way plan
        // 88.6.1-66's provider answers 'unknown' and the member "+" is withheld. Chosen OVER
        // offering Send Request (a press on a friend earns the backend's 409), OVER a gated
        // Send Request (a button that refuses with no reason given) and OVER a loading line
        // (new words, D-31). A FAILED load does not hold it: the request's own 409 copy still
        // answers that case, and a failure that held the action would block every request.
        const friendsFirstLoadPending = !friendsLoaded && !friendsLoadError;
        const sentFirstLoadPending = !sentLoaded && !sentError;
        if (friendsFirstLoadPending || sentFirstLoadPending || friendshipCtxLoading) return null;
        if (isAlreadyFriend(foundUser.id)) {
            return { type: 'already-friends', label: 'Already friends' };
        }
        // The sent state ranks ABOVE isPendingRequest: handleSendRequest refetches
        // the sent list immediately, and once it lands the same request also
        // classifies as pending — which raced the "Request sent" confirmation
        // out after ~hundreds of ms. The sent-to id resets on the next search, so
        // the just-sent confirmation persists for THIS result without going
        // stale (owner UAT 2026-07-13, rode plan 10).
        // AMENDED Phase 88.6.1-40 (review r2 #47): the confirmation is now keyed to the
        // person it was sent to (`sentToId`), replacing the id-less flag, because a send that
        // settled after a new search used to mark the person found next as sent. The rank
        // above isPendingRequest and its reason are unchanged.
        if (sentToId !== null && sentToId === foundUser.id) {
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
                    <Heading level={1} size="display" className="text-content-primary mb-4">Friends</Heading>
                    <p className="text-content-secondary mb-6">Please log in to view your friends.</p>
                    {/* DECISION Phase 88.6-19 (UI-SPEC §3.2 asChild row): the element stays an
                        `<a>` and is NEVER rewritten to `<Link>`. Auth0's login handler needs a
                        hard navigation; a client-router push to it is a behaviour change, not a
                        cleanup, and the repo carries zero `<Link href="/api/auth…">`. Any
                        surviving utility goes on `<Button className>` and not on the child,
                        because Radix `Slot` concatenates the child's className WITHOUT
                        tailwind-merge, so a utility left there cannot win a conflict. Here
                        nothing survives: `px-6 py-2` and `inline-block` are all dead under
                        unlayered `.btn` (padding at `globals.css:2349`, `padding: 0.5rem 1rem;`;
                        `display: inline-flex` at `:2342`; re-pointed 88.6.1-40). */}
                    <Button asChild variant="primary" size="default">
                        <a href="/api/auth/login">Log In</a>
                    </Button>
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
                    <Heading level={1} size="display" className="text-content-primary mb-6">Friends</Heading>
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
                    <Heading level={1} size="display" className="text-content-primary mb-6">Friends</Heading>
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

    // The friend batch's outcome, split between the two result regions in the bulk-invite bar
    // (see the marker there): the all-failed outcome is the alert region's, every other outcome
    // the polite region's. A batch that sent nothing and failed nothing claims nothing.
    let batchStatusText = '';
    let batchErrorText = '';
    if (bulkInviteResult && (bulkInviteResult.successCount > 0 || bulkInviteResult.failCount > 0)) {
        if (bulkInviteResult.failCount > 0 && bulkInviteResult.successCount === 0) {
            batchErrorText = BATCH_INVITE_FAILED_MESSAGE;
        } else if (bulkInviteResult.failCount === 0) {
            batchStatusText = `Invited ${bulkInviteResult.successCount} friend(s) to ${bulkInviteResult.groupName}!`;
        } else {
            batchStatusText = `Invited ${bulkInviteResult.successCount} friend(s), ${bulkInviteResult.failCount} failed`;
        }
    }

    const tabs = [
        { key: 'friends', label: 'Friends', count: friends.length },
        { key: 'requests', label: 'Requests', count: receivedRequests.length },
        { key: 'sent', label: 'Sent', count: sentRequests.length },
    ];

    return (
        <div className="min-h-screen bg-surface-page">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <Heading level={1} size="display" className="text-content-primary mb-6">Friends</Heading>

                {/* The remove-friend gate's live region. Mounted HERE — once, outside the
                    tab conditional and outside the row map — because a live region that
                    mounts with the armed row announces nothing (empty-first contract,
                    StatusRegion.tsx:9-17, its EMPTY-FIRST bullet). Moving it inside the
                    Friends tab or into the row is a silent a11y regression, not a tidy-up. That
                    premise holds because this gate's region is POLITE; an inserted alert would
                    be announced (D-42). */}
                {removeFriendGate.statusNode}

                {/* Search Section */}
                <div className="card p-3 md:p-6 mb-6">
                    <Heading ref={addFriendHeadingRef} level={2} size="heading" className="text-content-primary mb-3">Add Friend</Heading>
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
                        <Button
                            type="submit"
                            variant="primary"
                            size="default"
                            disabled={!searching && !searchEmail.trim()}
                            aria-disabled={searching ? 'true' : undefined}
                        >
                            {searching ? 'Searching...' : 'Search'}
                        </Button>
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
                        waiting to be told what happened.
                        AMENDED Phase 88.6.1-40 (D-42): stays a conditionally mounted alert, chosen
                        OVER an always-mounted empty assertive region. An alert inserted with its
                        text is announced (ARIA 1.2), and every path that sets it clears it first
                        (each search, and each send as of this plan), so a repeat is removed and
                        re-inserted and is announced again; an empty always-mounted alert would add
                        a second assertive region to the surface for no listener gain. */}
                    {searchError && (
                        <div role="alert" className="mt-4 p-3 bg-surface-page border border-line rounded-lg">
                            <p className="text-content-secondary">{searchError}</p>
                        </div>
                    )}

                    {searchResult && !searching && (
                        <div className="mt-4 p-4 border border-line rounded-lg flex items-center justify-between">
                            <div>
                                <p className="font-bold text-content-primary">
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
                                                <span ref={sentChipRef} tabIndex={-1} className="flex items-center gap-1 text-sm text-content-status-success">
                                                    <svg aria-hidden="true" className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                    </svg>
                                                    {action.label}
                                                </span>
                                            );
                                        case 'send':
                                            return (
                                                <Button
                                                    variant="primary"
                                                    size="default"
                                                    onClick={(e) => handleSendRequest(searchResult.id, e)}
                                                    aria-disabled={sendingRequest ? 'true' : undefined}
                                                >
                                                    {sendingRequest ? 'Sending...' : 'Send Request'}
                                                </Button>
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
                            /* DECISION Phase 88.6-19, two calls at this one control.

                               (1) D-16 RE-INK: the count pill's ACTIVE arm carried
                               `text-content-link` on `bg-surface-muted` — measured 3.9909,
                               below AA — and it takes `text-content-secondary` (6.9620), the
                               same token its inactive twin already used. It is a COUNT inside a
                               pill, not a link: zero of the 61 `text-content-link` sites on this
                               ground is a link, so the TOKEN was wrong, not the ground. This is
                               the site `tokenContrast.test.ts` test 49 names as its hand-verified
                               example and `groundInk.test.ts` holds as its known-live positive
                               fixture. Restoring the link token here is a decision.

                               (2) `aria-current` GAINED. The active tab was announced
                               identically to the inactive ones: its state lived only in an ink
                               swap plus a bottom border, and neither is exposed to an assistive
                               technology. The weight was NOT the differentiator — `font-medium`
                               sat on both arms and carried nothing, which is why it simply drops
                               to 400 rather than being traded for a cue. Removing the attribute
                               is a silent a11y regression, not a tidy-up. */
                            /* DECISION Phase 88.6.1-40 (Req 7, AC-23): the tab buttons take the
                               house OUTSET focus ring (the string on the Home breadcrumb link in
                               groupPlanning/page.js, its first `ring-offset-2` class string), chosen OVER the
                               group-home twin's INSET form: those tabs carry horizontal padding
                               (groupHomePage/page.js, its `px-4 py-2 text-sm active:opacity-75`
                               tab class) and these carry none, so an inset ring would be painted
                               under the label's first and last glyphs and the count pill, and
                               Req 7 asks for a ring drawn clear of text. Chosen OVER inset plus
                               padding too: strip geometry is Phase 88.9's. The browser outline
                               this replaces is outset as well, so nothing moves at rest. Changing
                               this is a decision, not a cleanup. */
                            <button
                                key={key}
                                ref={tabRefs[key]}
                                onClick={() => {
                                    // A tab change clears both action lines: DECISION Phase 88.6.1-72 (N5 / N6; D-33 row 22; D-42).
                                    if (key !== activeTab) {
                                        setRequestActionError(null);
                                        setRemoveError(null);
                                    }
                                    setActiveTab(key);
                                }}
                                aria-current={activeTab === key ? 'true' : undefined}
                                className={`pb-3 text-sm transition-colors relative focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
                                    activeTab === key
                                        ? 'border-b-2 border-btn-primary text-btn-primary'
                                        : 'text-content-secondary hover:text-content-primary'
                                }`}
                            >
                                {label}
                                {count > 0 && (
                                    /* The active/inactive ternary that used to wrap this
                                       className is COLLAPSED, not overlooked: after the re-ink
                                       above both arms resolved to the same pair, and a ternary
                                       whose branches are byte-identical reads as an unfinished
                                       edit. The tab's own active state is unchanged and is
                                       carried by `text-btn-primary` + the bottom border + the
                                       `aria-current` above — the pill was a redundant second
                                       cue, and it is the cue that was below AA. */
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-surface-muted text-content-secondary">
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
                            flow — a screen-reader user was told nothing when a Remove failed.
                            AMENDED Phase 88.6.1-40 (D-42): stays a conditionally mounted alert,
                            chosen OVER an always-mounted empty assertive region. An alert inserted
                            with its text is announced (ARIA 1.2), and every path that sets it
                            clears it first (each remove), so a repeat is removed and re-inserted
                            and is announced again; an empty always-mounted alert would add a
                            second assertive region to the surface for no listener gain. */}
                        {removeError && (
                            <p role="alert" className="text-content-status-error text-sm mb-4">{removeError}</p>
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
                            branch is a decision to re-introduce that lie, not a simplification.
                            AMENDED Phase 88.6.1-72 (RF1; 88.6.1-70 contract C1-C6): empty and failed stay separate for a
                            list that never loaded; the full banner owns that case and is checked before the
                            loading line, so it survives its own Try again (C2). Once a load has succeeded, a
                            failed refresh keeps what was shown (rows, or the empty line of a list that loaded
                            empty; owner ruling 2026-10-05: a list that loaded empty is retained content) under
                            the shared RF1 notice, which labels it as what loaded earlier, so the empty line
                            beside it no longer states the present as fact. An answer saying access was lost or
                            the content is gone is never kept: the full banner takes the list's place until a
                            load succeeds (contract C10, through plan 70's shared hook). This is one treatment
                            for the page's three lists (orchestrator decision 2026-10-05). REJECTED: the full
                            banner above retained rows (two treatments on one page; the owner's
                            retained-content ruling gives a refresh failure the small notice) and a row count
                            as the retained flag (contract C3). */}
                        {!friendsRetained && friendsErrorState.showError ? (
                            <FetchErrorBanner
                                state={friendsErrorState}
                                title="Couldn't load your friends"
                                reportContext="friends page — friends list fetch"
                                focusTarget={friendsTabRef}
                            />
                        ) : !friendsLoaded ? (
                            <div role="status" aria-label="Loading your friends" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading friends...</span>
                            </div>
                        ) : (
                            <>
                                {/* 88.6.1-70 contract C6: above the content, outside the rows' stack. */}
                                <RefreshFailedNotice
                                    state={friendsErrorState}
                                    retained={friendsRetained}
                                    focusTarget={friendsTabRef}
                                    className="mb-4"
                                />
                                {friends.length === 0 ? (
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
                                                    <label htmlFor="group-invite-select" className="text-sm text-content-secondary">
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
                                                    {/* Every utility this control used to carry was DEAD under
                                                        unlayered `.btn` and is deleted rather than moved: `px-4 py-2`
                                                        (padding, `globals.css:2349`), `text-sm` (font-size, `:2348`),
                                                        `font-medium` (font-weight 600, `:2347`), `flex items-center
                                                        gap-2` (`display: inline-flex` / `align-items` / `gap`,
                                                        `:2342-2345`) and the `disabled:` pair (`.btn:disabled`,
                                                        `:2397-2400`). Re-adding any of them changes no pixel.
                                                        (Cites re-pointed 88.6.1-40 to the `.btn {` block
                                                        and its `.btn:disabled {` block.) */}
                                                    <Button
                                                        variant="primary"
                                                        size="default"
                                                        onClick={handleBulkInvite}
                                                        aria-disabled={!selectedGroupId || selectedFriends.size === 0 || bulkInviteLoading || groupMembersLoading ? 'true' : undefined}
                                                        aria-busy={bulkInviteLoading || undefined}
                                                    >
                                                        {bulkInviteLoading && (
                                                            <>
                                                                <div aria-hidden="true" className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
                                                                <span className="sr-only">Sending invites...</span>
                                                            </>
                                                        )}
                                                        Invite to Group
                                                    </Button>
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
                                                {/* DECISION Phase 88.6.1-40 (Req 8, D-22, D-32 R2; Req 11): the batch
                                                    result was a conditionally mounted block with no role, so a
                                                    screen-reader user who pressed Invite to Group heard no outcome at
                                                    all. It is now TWO regions mounted empty with the bar and hidden
                                                    while empty (the D-22 house shape): a polite region for the
                                                    all-succeeded and partial outcomes, and an alert region for the
                                                    all-failed one. Chosen OVER one polite region for every outcome (a
                                                    total failure would queue behind other speech; the invite panel twin
                                                    is split the same way) and OVER the alert role for all of them (a
                                                    success is not an alert). The words are the block's own (D-31); the
                                                    88-27 tint per branch is unchanged.

                                                    The line stays until the next batch starts: the old 5 s self-clear
                                                    is REMOVED, chosen OVER holding and clearing it (a line that
                                                    vanishes on its own can be gone before a sighted user looks back,
                                                    and a first batch's clear could wipe a second batch's line), the
                                                    twin's shape (the invite panel never self-clears). Disclosed visible
                                                    delta, for the owner to confirm: the success, partial and all-failed
                                                    lines no longer disappear after 5 s (if a fade is wanted, only the
                                                    all-success line fades, never under 20 s).

                                                    The group is captured when the batch starts, so a later change of
                                                    the group select cannot re-word (and re-announce) the line. A
                                                    selection is pruned of anyone the newly loaded group already holds,
                                                    and only the CURRENT group's members answer writes (a generation:
                                                    an older group's late answer neither prunes nor ends the load);
                                                    Invite to Group refuses while the members load, so the bar never
                                                    claims "Invited 0". Chosen OVER emptying the member list at the
                                                    change (every checkbox would be enabled during the load) and OVER
                                                    natively disabling the checkboxes during the load (a focused one
                                                    would drop focus). Changing any of this is a decision, not a
                                                    cleanup. */}
                                                <StatusRegion
                                                    id="friends-batch-status"
                                                    srOnlyWhenEmpty
                                                    message={batchStatusText}
                                                    className={batchStatusText
                                                        ? `mt-3 p-3 rounded-lg text-sm ${bulkInviteResult.failCount === 0
                                                            ? 'bg-status-success-subtle text-content-status-success border border-status-success'
                                                            : 'bg-status-warning-subtle text-content-status-warning border border-status-warning'}`
                                                        : 'mt-3'}
                                                />
                                                <StatusRegion
                                                    id="friends-batch-error"
                                                    politeness="assertive"
                                                    srOnlyWhenEmpty
                                                    message={batchErrorText}
                                                    className={batchErrorText
                                                        ? 'mt-3 p-3 rounded-lg text-sm bg-status-error-subtle text-content-status-error border border-status-error'
                                                        : 'mt-3'}
                                                />
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
                                                        data-friend-row={friendship.id}
                                                        className="flex items-center justify-between p-4 border border-line rounded-card hover:bg-surface-hover"
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
                                                                    <p className="font-bold text-content-primary">
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
                                                                    aria-disabled={removing ? 'true' : undefined}
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
                                                                    className={`min-h-11 px-3 rounded-btn border text-sm transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring text-content-status-error hover:bg-status-error-subtle ${
                                                                        armed
                                                                            ? 'border-status-error font-semibold'
                                                                            : 'border-transparent'
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
                            </>
                        )}
                        {/* C12 (a): the Friends panel's guard, last child, outside every arm; see DECISION Phase 88.6.1-72 (C12, focus when content leaves). */}
                        <RetainedContentFocusGuard retained={friendsRetained} focusTarget={friendsTabRef} />
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
                    network blip on this surface.
                    AMENDED Phase 88.6.1-72 (FR1 / RF1; owner ruling 2026-10-05): the premise above
                    was false. Until plan 88.6.1-66 the provider set its load-error flag and never
                    cleared or retried it, so after a failed load the empty line said there were no
                    pending requests as fact, until a reload (SPEC Prohibition 2). Now a failure with
                    nothing retained shows the FR1 banner with a Retry that re-runs the provider's
                    load; a failure over content loaded earlier (an empty list included, owner ruling
                    2026-10-05) keeps it under the shared RF1 notice (88.6.1-70); an answer saying
                    access was lost or the content is gone shows the FR1 banner instead (88.6.1-70
                    contract C10); and the empty line renders as current fact only while the provider
                    holds no error. REJECTED: keeping the empty line (the false statement), and the
                    full banner above retained rows (the owner's retained-content ruling gives a
                    refresh failure the small notice). */}
                {activeTab === 'requests' && (
                    <div>
                        {/* DECISION Phase 88.6.1-72 (N5 / N6; D-33 row 22; D-42): a failed Accept or
                            Decline shows the bell's mechanism for the same provider call, the N-line as
                            the fallback of getFetchErrorMessage, so a coded failure keeps its register
                            line, chosen OVER a fixed N-line (the bell and this page would then say
                            different things for one failure). A conditionally mounted alert cleared at
                            the start of every accept and decline, chosen OVER an always-mounted empty
                            assertive region (D-42: an alert inserted with its text is announced, and
                            clear-first makes a repeat re-insert). Its lifetime is bound to its subject:
                            rendered only while the request it names is still listed and FR1 is not
                            showing, cleared when FR1 shows and on a tab change (with the remove line),
                            chosen OVER a line cleared only by the next press (it outlived the row it
                            named, repeated FR1's line above a list no longer shown, and was announced
                            again as new on every return to the tab; review #83, #238). Changing this
                            is a decision, not a cleanup. */}
                        {requestActionError &&
                            !requestsFullBannerShown &&
                            receivedRequests.some((r) => r.id === requestActionError.id) && (
                                <p role="alert" className="text-content-status-error text-sm mb-4">{requestActionError.message}</p>
                            )}
                        {friendshipCtxLoading ? (
                            <div role="status" aria-label="Loading your friend requests" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading requests...</span>
                            </div>
                        ) : requestsFullBannerShown ? (
                            <FetchErrorBanner
                                state={requestsErrorState}
                                title={FRIEND_REQUESTS_LOAD_FAILED_TITLE}
                                focusTarget={requestsTabRef}
                            />
                        ) : (
                            <>
                                {/* 88.6.1-70 contract C6: mounted whenever this branch renders, above
                                    the content and outside the rows' stack; no title, no report
                                    context (C7). */}
                                <RefreshFailedNotice
                                    state={requestsErrorState}
                                    retained={requestsRetained}
                                    focusTarget={requestsTabRef}
                                    className="mb-4"
                                />
                                {receivedRequests.length === 0 ? (
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
                                                    data-request-row={request.id}
                                                    className="flex items-center justify-between p-4 border border-line rounded-card hover:bg-surface-hover"
                                                >
                                                    <div className="flex-1">
                                                        <p className="font-bold text-content-primary">
                                                            {requester.username || requester.email}
                                                        </p>
                                                        {requester.email && requester.email !== requester.username && (
                                                            <p className="text-sm text-content-muted mt-0.5">{requester.email}</p>
                                                        )}
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Button
                                                            variant="primary"
                                                            size="default"
                                                            onClick={(e) => handleAccept(request.id, e)}
                                                            aria-disabled={actionLoading[request.id] === 'accept' ? 'true' : undefined}
                                                            disabled={actionLoading[request.id] === 'decline' || (!actionLoading[request.id] && isRequestActionPending(request.id))}
                                                        >
                                                            {actionLoading[request.id] === 'accept' ? 'Accepting...' : 'Accept'}
                                                        </Button>
                                                        <Button
                                                            variant="secondary"
                                                            size="default"
                                                            onClick={(e) => handleDecline(request.id, e)}
                                                            aria-disabled={actionLoading[request.id] === 'decline' ? 'true' : undefined}
                                                            disabled={actionLoading[request.id] === 'accept' || (!actionLoading[request.id] && isRequestActionPending(request.id))}
                                                        >
                                                            {actionLoading[request.id] === 'decline' ? 'Declining...' : 'Decline'}
                                                        </Button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                        {/* DECISION Phase 88.6.1-72 (C12, focus when content leaves): CHOSEN, plan 70's
                            one shared guard per tab panel, the panel's last child, outside every arm,
                            given the tab's own button (outside the panel, so it survives the
                            withdrawal), the same target the tab's notice and banner use. It renders
                            nothing and must stay even though it draws nothing. REJECTED: (a) no guard,
                            because a refresh nobody pressed (the tab-return re-attempt) that withdraws
                            the rows drops focus to the page body, since nothing was armed; (b) a
                            heading as the target (the panels have none; the page heading is a screen
                            away on a phone); (c) focus code of this page's own (D-04). The Friends and
                            Sent guards point here. Changing this is a decision, not a cleanup. */}
                        <RetainedContentFocusGuard retained={requestsRetained} focusTarget={requestsTabRef} />
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
                            errored fetch also has zero requests.
                            AMENDED Phase 88.6.1-72 (RF1; 88.6.1-70 contract C1-C6): empty and failed stay separate for a
                            list that never loaded; the full banner owns that case and is checked before the
                            loading line, so it survives its own Try again (C2). Once a load has succeeded, a
                            failed refresh keeps what was shown (rows, or the empty line of a list that loaded
                            empty; owner ruling 2026-10-05: a list that loaded empty is retained content) under
                            the shared RF1 notice, which labels it as what loaded earlier, so the empty line
                            beside it no longer states the present as fact. An answer saying access was lost or
                            the content is gone is never kept: the full banner takes the list's place until a
                            load succeeds (contract C10, through plan 70's shared hook). This is one treatment
                            for the page's three lists (orchestrator decision 2026-10-05). REJECTED: the full
                            banner above retained rows (two treatments on one page; the owner's
                            retained-content ruling gives a refresh failure the small notice) and a row count
                            as the retained flag (contract C3). */}
                        {!sentRetained && sentErrorState.showError ? (
                            <FetchErrorBanner
                                state={sentErrorState}
                                title="Couldn't load your sent requests"
                                reportContext="friends page — sent requests fetch"
                                focusTarget={sentTabRef}
                            />
                        ) : !sentLoaded ? (
                            <div role="status" aria-label="Loading your sent requests" className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading sent requests...</span>
                            </div>
                        ) : (
                            <>
                                {/* 88.6.1-70 contract C6: above the content, outside the rows' stack. */}
                                <RefreshFailedNotice
                                    state={sentErrorState}
                                    retained={sentRetained}
                                    focusTarget={sentTabRef}
                                    className="mb-4"
                                />
                                {sentRequests.length === 0 ? (
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
                                                        <p className="font-bold text-content-primary">
                                                            {addressee.username || addressee.email}
                                                        </p>
                                                        {addressee.email && addressee.email !== addressee.username && (
                                                            <p className="text-sm text-content-muted mt-0.5">{addressee.email}</p>
                                                        )}
                                                    </div>
                                                    <span className="px-3 py-1 rounded-full text-xs font-bold bg-status-warning-subtle text-content-status-warning border border-status-warning">
                                                        Pending
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </>
                        )}
                        {/* C12 (a): the Sent panel's guard, last child, outside every arm; see DECISION Phase 88.6.1-72 (C12, focus when content leaves). */}
                        <RetainedContentFocusGuard retained={sentRetained} focusTarget={sentTabRef} />
                    </div>
                )}
            </div>
        </div>
    );
}

export default FriendsPage;
