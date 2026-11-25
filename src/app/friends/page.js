'use client';

import { Fragment, useState, useEffect, useRef, useCallback } from 'react';
import { useUser } from '@auth0/nextjs-auth0/client';
import { friendshipsAPI, groupsAPI, invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { selfIdentityErrorSource } from '../../lib/hooks/selfIdentityErrorSource';
import { useSignInRedirect } from '../../lib/hooks/useSignInRedirect';
import { useScrollEdges } from '../../lib/hooks/useScrollEdges';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import {
    FetchErrorBanner,
    RefreshFailedNotice,
    RetainedContentFocusGuard,
    useRetainedContent,
} from '../../components/ui/FetchErrorBanner';
// Copy rows N5 / N6 (D-30): the bell's own constants for the same provider call, never retyped.
import { ACCEPT_FRIEND_FAILED_COPY, DECLINE_FRIEND_FAILED_COPY } from '../components/NotificationBell';
// The friend batch's terminal-409 rule and the invite panel's two shipped lines (one source).
import {
    isAlreadyInvitedOrMember,
    isPermanentInviteRefusal,
    ALL_ALREADY_INVITED_MESSAGE,
    invitedWithAlreadyMessage,
    allFailedBatchLine,
} from '../components/friendBatchInviteOutcome';
// 88-33 Task 1 (r3 triage): this page's fetchers run through a raw
// Promise.allSettled, NOT react-query, so they bypass the global
// QueryCache.onError hook entirely and their failures never reached Sentry.
// Reporting through the SAME exported function keeps the entity/scope tagging
// and the T-84-05 PII rules identical to every query-driven report.
import { queryCacheOnError } from '../../lib/queryClient';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { EmptyState } from '../../components/ui/EmptyState';
import { ErrorFallback } from '../../components/ui/ErrorFallback';
import { CentredPageFrame } from '../../components/ui/CentredPageFrame';
import { Input, SelectControl } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { DelayedSpinner } from '../../components/ui/DelayedSpinner';
import { ReservedLabel } from '../../components/ui/ReservedLabel';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { logger, errCtx } from '../../lib/logger';

// Copy row FR1 (owner ruling 2026-10-05, D-47; D-32 R8 straight apostrophe): the Requests tab's
// full-banner title when the provider's load failed and nothing is retained. AMENDED Phase 88.9-49 (owner ruling BANNER-01 short, register 51.13, 2026-11-07): the constant holds the thing; the composed title is unchanged, chosen OVER typing the whole title.
const FRIEND_REQUESTS_LOAD_FAILED_THING = 'your friend requests';
// DECISION Phase 88.9-52 (R3, owner 2026-11-16: we have to remember to update the hidden headings if we modify the title): the page's name is ONE constant, read by the screen-reader-only heading on the banner-only screens (the frame's srHeading; marker at src/components/ui/CentredPageFrame.tsx ("DECISION Phase 88.9-52 (A-04 / A-38)")) and by the three visible level-1 titles, chosen OVER the same word typed at each site, which drifts silently. Renaming the page is one edit here.
const FRIENDS_PAGE_TITLE = 'Friends';

// Copy row F7 (owner ruling 2026-10-05, D-47): the found result, heard and not seen; `name` is
// what the result row shows.
function foundAnnouncement(name) {
    return `Found ${name}.`;
}

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
    const { user, error: authError, isLoading: authLoading } = useUser();

    // D-09 (Pitfall 5 / D-07 window rule): the friends page GATES on identity.
    // Incoming-vs-outgoing request classification, the admin-group derive, and
    // the is-self search guard all need the caller's own Users.id UUID, so the
    // whole page waits on `selfUuid` (full loading) and shows a standard error
    // state on permanent failure — it never degrades to a mixed-keyspace render.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    // AC-29 (88.6.1-63): an identity failure counts only with no row held; an access answer over a held row is told by this view's own data requests instead, deliberately; the rule and its reasons live in selfIdentityErrorSource.ts.
    const selfIdentityErrorState = useFetchErrorState(selfIdentityErrorSource(selfIdentityQuery, selfUuid));

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
       settle empties the ids whose outcome is final (AMENDED Phase 88.9-56, R-C1 twin), and a
       native gate would then blur the very button the user pressed. AMENDED Phase 88.9-56 (R-C3b reach):
       its in-flight glyph is Button's busy now (the delayed, held house spinner, heard as Invite to Group,
       sending), replacing the hand-rolled spinning div and its sr-only words. Disclosed visible delta: at rest with nothing selected (and while a group's
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
    // CI-01g (89.6-21): the tab strip's scroll box, and which of its ends hide tabs (the strip-cue marker at the strip).
    const tabStripRef = useRef(null);
    const stripEdges = useScrollEdges(tabStripRef);
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
       documents that it reads ONLY `isError`/`error`/`refetch` (src/components/ui/useFetchErrorState.ts ("@param query a"), the
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
    // DECISION Phase 88.9-40 (SESSION-01): a signed-out visitor goes straight to sign-in and back here,
    // chosen OVER the prompt as the first screen (one more tap, and its bare login link returned the
    // person to the home page, not here); the prompt remains for a return with the latch set, its Log
    // In link now carrying returnTo. A 401 on identity or the friends / sent lists redirects once too
    // (SPEC A8). A useUser() error shows Reload, not the log-in prompt. See
    // src/lib/hooks/useSignInRedirect.ts ("DECISION Phase 88.9-40 (SESSION-01, owner ruling").
    // AMENDED Phase 88.9-66 (X70b): the declined return is the shared banner with Sign in (returnTo kept).
    // AMENDED Phase 88.9-52 (A-31): the session is proven only once identity, the friends list and the
    // sent list have each SETTLED (answered or failed) with no 401 among them and at least one answered,
    // chosen OVER the friends list's success alone (it cleared the latch while the sent or identity read
    // was still out, so that read's 401 redirected again on every return) and OVER all three SUCCEEDING
    // (a sent list that failed with a 500 would hold the latch set, and the next real expiry would show
    // a banner where it should go to sign-in). Each read fetches its own token, so one can 401 alone.
    const signInUnauthorized = [selfIdentityErrorState, friendsErrorState, sentErrorState].some(
        (s) => s.showError && s.code === 'unauthorized'
    );
    const identitySettled = Boolean(selfUuid) || selfIdentityErrorState.showError;
    const friendsSettled = friendsLoaded || Boolean(friendsLoadError);
    const sentSettled = sentLoaded || Boolean(sentError);
    const signIn = useSignInRedirect({
        authLoading,
        signedOut: !user,
        authError,
        unauthorized: signInUnauthorized,
        sessionProven:
            identitySettled &&
            friendsSettled &&
            sentSettled &&
            !signInUnauthorized &&
            (Boolean(selfUuid) || friendsLoaded || sentLoaded),
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
                   backend:Sonnet/routes/friendships.js ("No user found with that email"), a RAW 404 with no `code` and no
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
                // The provider's own mark: its reconcile removed this row inside the failing call (A-54).
                rowRemoved: Boolean(err?.requestRowRemoved),
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
                rowRemoved: Boolean(err?.requestRowRemoved),
            });
        } finally {
            requestActionInFlightRef.current.delete(friendshipId);
            setActionLoading(prev => ({ ...prev, [friendshipId]: null }));
            settle();
        }
    };

    // Remove friend — the COMMIT half only. It is unreachable except through the
    // gate below, which is what makes the first tap non-destructive.
    // `opts.from` (88.6.1 code review A-74 follow-up): the pressed Remove, handed over by the
    // two-tap gate — iOS Safari does not focus a tapped button, so the arm below needs it as its seed.
    const performRemoveFriend = async (friendshipId, opts) => {
        // Runs synchronously inside the second tap, so this arms before the first await.
        const settle = removeRecovery.arm({
            preferred: neighbourControl(rowElementFor('data-friend-row', friendshipId)),
            from: opts?.from ?? null,
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
        onConfirm: (friendshipId, ctx) => performRemoveFriend(friendshipId, ctx),
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
                /* DECISION 88.6.1 code review A-55: the write below natively disables the checkbox of
                   every friend the group already holds (the rule of KIND, DECISION Phase 88.6.1-40), and
                   a browser drops a focused control that becomes disabled to <body>. So, BEFORE the write,
                   a focused checkbox whose friend is a member hands focus to its own row's Remove button,
                   the next control in that row. CHOSEN OVER aria-disabled on the checkbox (it would overturn
                   the rule-of-KIND marker for every gated checkbox to fix one transition) and OVER the
                   shared focus-recovery hook (it recovers a REMOVED control; a disabled one stays
                   connected, so the hook reads the user as having moved on). Dropping this hand-off is a
                   decision, not a cleanup. */
                const focused = typeof document !== 'undefined' ? document.activeElement : null;
                const focusedMemberId = focused?.getAttribute?.('data-bulk-invite-friend');
                if (focusedMemberId && memberUserIds.includes(focusedMemberId)) {
                    focused.closest('[data-friend-row]')?.querySelector('button')?.focus();
                }
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
        let alreadyCount = 0;
        let firstFailure = null;
        // R-C1 (88.9-56): the ids whose outcome is FINAL, removed from the selection after the batch.
        const finalIds = new Set();

        try {
            for (const friendUserId of selectedFriends) {
                // Skip anyone already in the group; otherwise invite by user_id.
                // The friend's email is resolved server-side (83-06 PII default-deny).
                // A friend already in at the press leaves the selection with no request (final).
                if (groupMembers.includes(friendUserId)) {
                    finalIds.add(friendUserId);
                    continue;
                }
                try {
                    await invitesAPI.sendFriendInvite(selectedGroupId, friendUserId);
                    successCount++;
                    finalIds.add(friendUserId);
                } catch (err) {
                    // 88.6.1-72 (owner ruling 2026-10-05): a terminal 409 is already invited,
                    // never a failure; the panel's rule, from the shared module.
                    if (isAlreadyInvitedOrMember(err)) {
                        alreadyCount++;
                        finalIds.add(friendUserId);
                    } else {
                        failCount++;
                        if (!firstFailure) firstFailure = err;
                        logger.info('Error sending friend invite:', errCtx(err));
                        // A permanent refusal is final; a transient failure stays ticked for the retry.
                        if (isPermanentInviteRefusal(err)) finalIds.add(friendUserId);
                    }
                }
            }

            setBulkInviteResult({ successCount, failCount, alreadyCount, groupName, firstFailure });
            // DECISION Phase 88.9-56 (R-C1): final-outcome clear over clearing the whole selection and over a sent-only clear — the twin of the invite panel's B08 amendment.
            setSelectedFriends((prev) => {
                const next = new Set(prev);
                for (const id of finalIds) next.delete(id);
                return next;
            });
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

    // Loading / not logged in. 88.9-40: the same hold is the redirect frame (signIn.holding), so no
    // prompt or banner paints for a frame before the browser navigates.
    if (authLoading || signIn.holding) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                {/* DECISION Phase 88.9-66 (X35, once-over R13): busy lines speak from always-mounted sr-only settleOnMount regions, the visible rows at 0 ms (the two-node shape of DECISION Phase 88.6-37 (W38), as 65's loader), chosen OVER labelled rows mounted with their words (not announced) and OVER the visible row as the region (its words would wait the dwell); words are the former aria-labels, OVER the visible ones (VoiceOver reads three dots aloud). */}
                <StatusRegion settleOnMount className="sr-only" message="Signing you in" />
                <div className="flex items-center gap-2 text-content-secondary">
                    <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-btn-primary" />
                </div>
            </div>
        );
    }

    // 88.9-40 (SESSION-01): useUser() itself failed (offline, or /api/auth/me answered 5xx) — Reload,
    // never the prompt and never a redirect. The title is this page's banner title; the body is
    // userProfile's 88-19 sentence (no new copy).
    if (signIn.sessionError) {
        return <ErrorFallback title="Couldn't load your friends" body="Your session didn't come back. Reload the page, and sign in again if it keeps happening." />;
    }

    // Reached only on the DECLINED arm (back from sign-in with the latch set, or storage failed).
    // DECISION Phase 88.9-66 (X70b, owner 2026-11-14: yes): the shared centred banner, chosen OVER the older prompt 88.9-40 kept with no recorded reason; 88.6-19's rule holds through the banner's own Sign in anchor.
    if (!user) {
        return (
            <CentredPageFrame srHeading={FRIENDS_PAGE_TITLE}>
                <FetchErrorBanner state={signIn.signedOutErrorState} thing="your friends" reportContext="Friends page — signed out" />
            </CentredPageFrame>
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
                    <Heading level={1} size="display" className="text-content-primary mb-6">{FRIENDS_PAGE_TITLE}</Heading>
                    <FetchErrorBanner
                        state={selfIdentityErrorState}
                        thing="your friends"
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
       (src/app/api/[...path]/route.ts ("const PROXY_TIMEOUT_MS = 30_000;")), and `shouldRetry` grants one retry — which is the walk's
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
                    <Heading level={1} size="display" className="text-content-primary mb-6">{FRIENDS_PAGE_TITLE}</Heading>
                    <FetchErrorBanner
                        state={friendsErrorState.showError ? friendsErrorState : sentErrorState}
                        thing="your friends"
                        reportContext="friends page — page data failed while identity was still resolving"
                    />
                </div>
            </div>
        );
    }

    if (!selfUuid) {
        return (
            <div className="min-h-screen bg-surface-page flex items-center justify-center">
                {/* X35: see the DECISION Phase 88.9-66 marker on the sign-in hold above. */}
                <StatusRegion settleOnMount className="sr-only" message="Loading your friends" />
                <div className="flex items-center gap-2 text-content-secondary">
                    <div aria-hidden="true" className="animate-spin rounded-full h-8 w-8 border-b-2 border-btn-primary" />
                </div>
            </div>
        );
    }

    // The friend batch's outcome, split between the two result regions in the bulk-invite bar
    // (see the marker there): the all-failed outcome is the alert region's, every other outcome
    // the polite region's. A batch that sent nothing, failed nothing and found nobody already
    // invited claims nothing (so the bar never says "Invited 0"). 88.6.1-72: with no failure, a
    // batch that met anyone already invited or already a member says so in the invite panel's
    // own lines, with the success tint (the panel's rule: success while nothing failed).
    // 88.6.1-90 (close ruling P-92): the all-failed line is the first failure's register line, R2
    // when it has no code — the panel's rule, from the shared module.
    let batchStatusText = '';
    let batchErrorText = '';
    if (
        bulkInviteResult &&
        (bulkInviteResult.successCount > 0 || bulkInviteResult.failCount > 0 || bulkInviteResult.alreadyCount > 0)
    ) {
        if (bulkInviteResult.failCount > 0 && bulkInviteResult.successCount === 0) {
            batchErrorText = allFailedBatchLine(bulkInviteResult.firstFailure);
        } else if (bulkInviteResult.failCount === 0 && bulkInviteResult.alreadyCount > 0) {
            batchStatusText = bulkInviteResult.successCount > 0
                ? invitedWithAlreadyMessage(bulkInviteResult.successCount, bulkInviteResult.alreadyCount)
                : ALL_ALREADY_INVITED_MESSAGE;
        } else if (bulkInviteResult.failCount === 0) {
            batchStatusText = `Invited ${bulkInviteResult.successCount} friend(s) to ${bulkInviteResult.groupName}!`;
        } else {
            batchStatusText = `Invited ${bulkInviteResult.successCount} friend(s), ${bulkInviteResult.failCount} failed`;
        }
    }

    // The F7 region's subject: the name the result row shows, while a result is shown.
    // DECISION Phase 88.9-52 (Q66): the found row, the request rows and the sent rows read the other
    // person's username ONLY, chosen OVER the email fallback and second line they carried: the backend
    // never sends that field (backend:Sonnet/routes/friendships.js, the search's literal id-and-username
    // projection and the PUBLIC_USER_ATTRS includes on Requester and Addressee; username is NOT NULL),
    // so those branches drew nothing, and a branch that would print another person's address must not
    // wait for a payload to widen. Re-adding one is a privacy decision, not a cleanup.
    const searchFoundName = searchResult && !searching ? searchResult.username || '' : '';

    // X35 (88.9-66): each tab's loading line is on screen exactly while this is true; the visible
    // row and the tab's polite region both read it, so they cannot disagree.
    const friendsListLoading = !(!friendsRetained && friendsErrorState.showError) && !friendsLoaded;
    const requestsListLoading = friendshipCtxLoading;
    const sentListLoading = !(!sentRetained && sentErrorState.showError) && !sentLoaded;

    const tabs = [
        { key: 'friends', label: 'Friends', count: friends.length },
        { key: 'requests', label: 'Requests', count: receivedRequests.length },
        { key: 'sent', label: 'Sent', count: sentRequests.length },
    ];

    return (
        <div className="min-h-screen bg-surface-page">
            <div className="max-w-3xl mx-auto px-4 py-8">
                <Heading level={1} size="display" className="text-content-primary mb-6">{FRIENDS_PAGE_TITLE}</Heading>

                {/* The remove-friend gate's live region. Mounted HERE — once, outside the
                    tab conditional and outside the row map — because a live region that
                    mounts with the armed row announces nothing (empty-first contract,
                    src/components/ui/StatusRegion.tsx ("EMPTY-FIRST: the live container is always mounted"), its EMPTY-FIRST bullet). Moving it inside the
                    Friends tab or into the row is a silent a11y regression, not a tidy-up. That
                    premise holds because this gate's region is POLITE; an inserted alert would
                    be announced (D-42). */}
                {removeFriendGate.statusNode}

                {/* Search Section */}
                <div className="card p-edge-card md:p-edge-wide mb-6">
                    <Heading ref={addFriendHeadingRef} level={2} size="heading" className="text-content-primary mb-3">Add Friend</Heading>
                    {/* DECISION Phase 88.9-52 (R4 B1b, the round-4 re-shoot: at 375 with text at 200% the
                        field was squeezed to about 80px beside the Search button and showed three
                        letters of what was typed): the row may wrap, and the field asks for 8rem
                        before it shares a line (grow basis-32 in place of flex-1), so when 8rem,
                        the gap and the button no longer fit, the button drops under a full-width
                        field. CHOSEN OVER stacking from a screen width (a breakpoint knows the
                        screen, not the text size, and the squeeze comes from the text size) and
                        OVER a larger basis (10rem and up would drop the button at 320 with
                        ordinary text while its spinner shows: 160 + 12 + about 104 against 262).
                        At ordinary text nothing moves: 128 + 12 + about 104 fits 262. */}
                    <form onSubmit={handleSearch} className="flex flex-wrap gap-3">
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
                            className="grow basis-32"
                            required
                        />
                        {/* DECISION Phase 88.9-46 (rule 1 B21-B25): every in-flight friends button keeps its
                            resting label with the house spinner and a heard suffix that re-uses its shipped
                            in-flight word (Search, searching / Send Request, sending / Remove <name>, removing /
                            Accept, accepting / Decline, declining), chosen OVER the shipped label swaps (five
                            sites, 88.6.1 era — a swap replaced the whole accessible name and changed the
                            control's width under the finger) and OVER minting new suffix words (Q6(b)). Owner
                            pick O16a extended by the Q3 ruling (88.9-RULINGS.md, 2026-11-08); B25's word
                            confirmed at R-W4. Each site's own latch stays the refusal. The search status line
                            below the form is a status caption, not a button, and keeps its text. */}
                        <Button
                            type="submit"
                            variant="primary"
                            size="default"
                            disabled={!searching && !searchEmail.trim()}
                            aria-disabled={searching ? 'true' : undefined}
                            busy={searching}
                            busySuffix=", searching"
                        >
                            Search
                        </Button>
                    </form>

                    {/* Search Result */}
                    <StatusRegion settleOnMount className="sr-only" message={searching ? 'Searching for that email address' : ''} />
                    {/* DECISION Phase 88.9-56 (R-C3b reach): this row IS the busy indicator — it mounts with its words and role=status the instant the flag turns true and unmounts the instant it turns false — so its glyph stays at 0 ms, chosen OVER a DelayedSpinner inside the guarded row (200 ms of words beside a hole) and OVER holding the row mounted past busy (a stale status on screen); the delay belongs to CONTROLS that stay mounted, not to a row that is itself the signal. AMENDED Phase 88.9-66 (X35): role and heard words moved to the region above; this row keeps its timing as plain text. */}
                    {searching && (
                        <div className="mt-4 flex items-center gap-2 text-content-secondary">
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
                        <div role="alert" className="mt-4 p-edge-card bg-surface-page border border-line rounded-lg">
                            <p className="text-content-secondary">{searchError}</p>
                        </div>
                    )}

                    {/* DECISION Phase 88.6.1-72 (F7): a found result is announced, screen-reader only,
                        from a polite region that is always mounted and always visually hidden (owner
                        ruling 2026-10-05, copy row F7; the gate's shape, not D-22's visible-when-set
                        prop), chosen OVER moving focus to the result (the person may still be
                        correcting the address in the field) and OVER a visible line (the row itself is
                        the visible outcome). Polite, because a found result is not an alert; the miss
                        stays in the D-42 alert above, unchanged. handleSearch empties the result at its
                        start, which empties this region, so the same result found twice is announced
                        twice. Changing this is a decision, not a cleanup. */}
                    <StatusRegion
                        id="friends-search-status"
                        className="sr-only"
                        message={searchFoundName ? foundAnnouncement(searchFoundName) : ''}
                    />

                    {/* DECISION Phase 88.9-66 (X13-1, owner at the round-2 glance): a long address wraps (wrap-anywhere, the house rule for unbroken user text) and the action column never shrinks, chosen OVER truncating it (an ellipsis hides the address the person is checking); the same on the request, sent and friend rows. Matches FriendInvitePanel's found-person row. AMENDED Phase 88.9-52 (Q66): the long text these rows can hold is the NAME (the backend sends no address for another person, so the address line is gone); the wrap rule is unchanged.
                        AMENDED Phase 88.9-52 (R4 B1, the round-4 re-shoot: with text at 200% the
                        request card was wider than a 375 or 320 screen, 438 and 437px, its name
                        one letter per line and Decline off the right edge): the four rows may
                        now WRAP (flex-wrap), so the action drops under the name when the two no
                        longer fit on one line, and it keeps to the right (ml-auto). The name
                        breaks between words, and inside a word only when that one word is wider
                        than the whole row: wrap-break-word in place of wrap-anywhere, and the
                        text column's floor is its longest word (min-width auto) capped at the
                        row (max-w-full) in place of min-w-0. This SUPERSEDES two parts of X13-1
                        above: wrap-anywhere (it let the column shrink to one letter) and the
                        action column that never shrinks (alone on a line it is now capped at
                        the row, Accept and Decline may sit one above the other, and a button's
                        own words may wrap as the last resort). REJECTED: a fixed rem floor for
                        the name (any value that helps at 200% also drops the buttons at 320
                        with ordinary text); flex-basis auto on the name (a two-word name that
                        fits on two lines beside the buttons would push them down at ordinary
                        text). A 50-character unbroken name still breaks inside the row; held by
                        e2e/friends-long-address.spec.ts ("a friend request from a long name keeps Accept and Decline inside a 375 screen").
                        At ordinary text with an ordinary name nothing moves.
                        AMENDED Phase 89.6-21 (friends-row): the floor-is-the-longest-word intent kept, now on bb-row; the pair also wraps and the action never shrinks. The friend row and the found row are bb-rows (the 89.6-21 friends-row marker sits on the friend row); the request and sent rows keep the shape above. */}
                    {searchResult && !searching && (
                        <div data-found-row="" className="mt-4 p-edge-page border border-line rounded-lg bb-row items-center gap-3">
                            <div className="bb-row-text">
                                <p className="font-bold text-content-primary wrap-break-word">
                                    {searchResult.username}
                                </p>
                            </div>
                            <div className="bb-row-end ml-auto">
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
                                                    busy={sendingRequest}
                                                    busySuffix=", sending"
                                                >
                                                    Send Request
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

                {/* Tabs. relative: the strip's edge cues (89.6-21, strip-cue) sit over the scroll box, inside the strip line. */}
                <div className="relative border-b border-line mb-6">
                    {/* DECISION Phase 88.9-52 (R4 S3, the round-3 capture: at 200% text the three
                        tabs were 549px in a 311px strip, the PAGE scrolled sideways, 581px on a
                        375px screen, and Sent was off screen): this row scrolls inside itself.
                        CHOSEN because it is the house rule for a tab strip
                        (src/components/ui/Tabs.tsx ("the strip SCROLLS at 375px, it does not wrap")): a wrapped strip turns a one-line
                        control into a block that reflows the page under the thumb. The group
                        page's own tab row has two short tabs and neither wraps nor scrolls, so it
                        decides nothing here. AMENDED Phase 89.6-21 (strip-cue): true at normal text only; at large text plan 89.6-17 makes the group page's tab row scroll too, with the same edge cue (useScrollEdges). REJECTED: letting the tabs shrink (R11's marker
                        below: the count pill drops under its word); wrapping the row. The strip
                        line stays on the parent, outside the scroll box, and the tabs fill the
                        row's height, so there is nothing to scroll up or down. A pressed tab is
                        brought fully into view (the click handler below); a tab reached by
                        keyboard is scrolled to by the browser. AMENDED Phase 89.6-21 (strip-cue): measured, the browser scrolls a focused tab only when it is wholly hidden; a focus handler now brings a partly hidden tab into view, past the edge cue (scroll-px-8). At ordinary text the three tabs
                        fit and nothing scrolls. */}
                    <div ref={tabStripRef} className="flex overflow-x-auto scroll-px-8">
                        {tabs.map(({ key, label, count }, index) => (
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
                               this is a decision, not a cleanup.
                               AMENDED Phase 88.9-10 (owner picks A7a + O3a, 2026-10-31): the strip
                               geometry routed here is ruled — every tab is at least 44 x 44
                               (min-h-11 and min-w-11, unprefixed); the outset ring stays and
                               its halo takes the page ground (owner option (a)).
                               AMENDED Phase 88.9-52 (PIX-8, picture pass: the active label read as a
                               dim slate blue on the dark page): the ACTIVE label takes the primary
                               text ink (text-content-primary: 13.76 on the light page, 15.95 on the
                               dark page), the Tabs primitive's active ink and this strip's own hover
                               ink, chosen OVER text-btn-primary, the primary button FILL used as ink:
                               4.34 light and 2.99 dark on the page, both under the 4.5 text floor.
                               REJECTED: the link ink (4.60 light, 10.13 dark: a tab is not a link, and
                               in dark it is the amber accent). The underline keeps border-btn-primary
                               (4.34 light, 2.99 dark against the page; its dark number is a hair under
                               the 3.0 edge floor and is reported to the owner, not changed here). The
                               active tab is still told apart by more than colour: the 2px underline
                               and aria-current. Held by src/app/tokenContrast.test.ts ("PIX-8 (88.9-52): the Friends tab labels on the page").
                               AMENDED Phase 89.6-09 (U1, owner pick O-3 = U1+E1, 2026-11-22: "So I'll follow
                               recommendation to make it follow the rule."): the underline now reads the
                               tab-indicator token (border-tab-indicator): light 4.3366 against the page,
                               unchanged, and dark 4.1790 (purple-500; it was 2.99). The dark miss is
                               CLOSED, no longer "reported to the owner, not changed here"; the sentence
                               above is kept as the 88.9-52 record. Chosen OVER keeping
                               border-btn-primary and OVER re-tuning the primary fill for every button
                               (src/app/globals.css ("DECISION Phase 89.6-09 (U1)")). The active tab is
                               still told apart by more than colour: the 2px underline and aria-current.
                               Held by src/app/tokenContrast.test.ts ("89.6 R7 U1").
                               AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred; his words: make it like
                               a padding, the same distance below the word as above): the ring is INSIDE the
                               tab (ring-inset, 2px, the group-home tabs' form) and the label is padded clear
                               of it: 12px at each side (px-3) and 3px under it (pb-[3px]) in place of the
                               12px bottom-only padding. The 3px is a measured value, not a guess: the count
                               pill sits 1.5px under the middle of its line, so 3px of bottom padding puts the
                               word and its pill in the middle of the 44px tab. The ring now ends on the
                               strip line (on the active tab, on top of its 2px underline) and no longer
                               crosses it. This SUPERSEDES the outset ring above (88.6.1-40) and its page
                               halo (88.9-10 owner option (a)): with no offset there is no halo to colour.
                               REJECTED: the outset ring as built (the word sat high in the box, 10px above
                               and 19px below, and the box crossed the strip line by 4px); the inset ring
                               with no padding (painted under the first and last glyphs, the reason 88.6.1-40
                               gave); pb-0.5 or pb-1, the nearest steps on the scale (the label would sit
                               half a pixel off the middle). The 44 x 44 floor (A7a), the underline and
                               aria-current stand.
                               The gaps between the tabs are their own elements (w-8, may shrink) and the
                               tabs never shrink or wrap, chosen OVER the row's former fixed gap-8: with the
                               padding the three tabs and two 32px gaps come to about 338px of the 343px a
                               375px phone gives the strip, so one more digit in a count, or a 320px screen,
                               would otherwise squeeze a tab and wrap its count pill under its word. Putting
                               gap-8 back, or dropping shrink-0, brings that wrap back.
                               AMENDED Phase 88.9-52 (R4 S3, the round-3 capture measured R11 as built):
                               the 3px bottom padding did not centre the label. From the word-and-pill
                               box to the tab's edges it measured 11.5 above and 12.5 below on Requests,
                               10.5 and 13.5 on Friends (the active tab: its 2px underline lifted the
                               label a pixel, so the word also jumped when a tab was chosen), 11.5 and
                               14.5 on Sent (no pill: the pill hangs 1px under the word's line, so no
                               one padding suits a tab with a pill and a tab without). Now each tab is
                               a centring flex box (inline-flex items-center justify-center) with no
                               padding up or down: the word's line and the pill are both 20px tall at
                               ordinary text and share one centre line, the middle of the tab. The
                               active tab alone has the 2px underline, and alone has 2px of top padding
                               (pt-[2px]) to balance it, so its label sits where the other labels sit.
                               Computed: 12 above and 12 below with a pill, 13 and 13 without, in every
                               tab, at any text size. Left and right stay 12 and 12 (px-3). This
                               SUPERSEDES pb-[3px] above. REJECTED: a transparent 2px border on every
                               tab in place of the top padding (the ring is drawn inside the border,
                               so every focused tab would show 10 above the label and 8 below);
                               another fixed padding (see Sent). On the focused ACTIVE tab the ring
                               stops at the underline, so inside the ring it is 10 above and 8 below,
                               with the underline directly under the ring: reported, not hidden.
                               AMENDED Phase 88.9-52 (R4 D7, owner page pick S3 = Merge, 2026-11-18): on the
                               focused ACTIVE tab the underline is now drawn OVER the ring's bottom edge,
                               so inside the ring the label has 10 above and 10 below (it was 10 / 8).
                               HOW, on the active tab only and only under focus-visible: the 2px bottom
                               border goes (border-b-0), 2px of bottom padding takes its place (so the
                               label does not move by a pixel when focus arrives), and the underline is
                               painted as an inset band, 2px at the bottom edge, in the border's own
                               colour (--color-btn-primary), through the inset-shadow slot. That slot
                               is listed before the ring in the composed box-shadow, so the band is
                               painted on top of the ring's bottom edge; the ring is a full 2px box
                               again and reads as a ring on its top, left and right sides, in its own
                               colour (its contrast against the strip is unchanged: nothing about the
                               ring's colour or the ground moved). Without focus the tab is exactly as
                               it was (a real border). CHOSEN OVER the ring stopping at the underline
                               (as built: 10 / 8, the label visibly low in the box), OVER the ring
                               drawn over the underline (the selected cue would vanish while focused)
                               and OVER an underline on every tab. The band must stay in the
                               inset-shadow slot: moved to the plain shadow slot it is painted UNDER
                               the ring and the selected cue disappears on focus.
                               e2e/friends-page.spec.ts ("R4 D7: while focused the underline is a band") is the rendered proof.
                               AMENDED Phase 89.6-09 (U1, owner pick O-3 = U1+E1, 2026-11-22: "So I'll follow
                               recommendation to make it follow the rule."): the band reads the same
                               token as the underline it stands in for, the runtime property
                               --color-tab-indicator-line (it was --color-btn-primary), so the focused
                               underline clears 3:1 in dark too (4.1790 on the page, it was 2.99).
                               The runtime property is named, not the theme key, chosen OVER
                               var(--color-tab-indicator): the property is declared in the light and
                               the dark block whatever Tailwind emits for a theme key. Everything
                               else about the band (its slot, its order over the ring) stands.
                               e2e/contrast.spec.ts ("89.6 R7 U1") measures it. */
                            <Fragment key={key}>
                            {index > 0 && <span aria-hidden="true" className="w-8 shrink min-w-0" />}
                            <button
                                ref={tabRefs[key]}
                                // 89.6-21 (strip-cue): a tab reached by keyboard is brought clear of the edge cue,
                                // as a pressed one is below (the scroll padding keeps it past the fade).
                                onFocus={(e) => {
                                    const focused = e.currentTarget;
                                    if (typeof focused.scrollIntoView === 'function') {
                                        focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                                    }
                                }}
                                onClick={() => {
                                    // A tab change clears both action lines: DECISION Phase 88.6.1-72 (N5 / N6; D-33 row 22; D-42).
                                    if (key !== activeTab) {
                                        setRequestActionError(null);
                                        setRemoveError(null);
                                    }
                                    setActiveTab(key);
                                    // 88.9-52 R4 S3: a pressed tab that is partly outside the strip's
                                    // scroll box is brought fully into view. Nearest both ways, so a
                                    // tab already in view moves nothing. Guarded as at
                                    // src/app/components/ParticipantRow.js ("if (typeof node.scrollIntoView === 'function') {").
                                    const pressed = tabRefs[key].current;
                                    if (pressed && typeof pressed.scrollIntoView === 'function') {
                                        pressed.scrollIntoView({ block: 'nearest', inline: 'nearest' });
                                    }
                                }}
                                aria-current={activeTab === key ? 'true' : undefined}
                                className={`inline-flex items-center justify-center shrink-0 whitespace-nowrap px-3 text-sm transition-colors relative focus:outline-hidden focus-visible:focus-ring-inset min-h-11 min-w-11 ${
                                    activeTab === key
                                        ? 'border-b-2 border-tab-indicator pt-[2px] text-content-primary focus-visible:border-b-0 focus-visible:pb-[2px] focus-visible:inset-shadow-[0_-2px_0_0_var(--color-tab-indicator-line)]'
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
                                       cue, and it is the cue that was below AA.
                                       AMENDED Phase 88.9-52 (PIX-8): the active label's ink is the
                                       primary text ink now; the bottom border and aria-current stand. */
                                    <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-surface-muted text-content-secondary">
                                        {count}
                                    </span>
                                )}
                            </button>
                            </Fragment>
                        ))}
                    </div>
                    {/* DECISION Phase 89.6-21 (strip-cue): at large text the scrolling strip fades its hidden end toward the page ground, chosen OVER wrapping the strip (the R4 S3 marker above) and OVER chevron buttons (two more tab stops). Shown at look 2. Nothing renders while every tab fits, so normal text is unchanged. Changing this is a decision, not a cleanup. */}
                    {stripEdges.start && (
                        <span aria-hidden="true" data-strip-cue="start" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-linear-to-r from-surface-page to-transparent" />
                    )}
                    {stripEdges.end && (
                        <span aria-hidden="true" data-strip-cue="end" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-linear-to-l from-surface-page to-transparent" />
                    )}
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
                        <StatusRegion settleOnMount className="sr-only" message={friendsListLoading ? 'Loading your friends' : ''} />
                        {!friendsRetained && friendsErrorState.showError ? (
                            <FetchErrorBanner
                                state={friendsErrorState}
                                thing="your friends"
                                reportContext="friends page — friends list fetch"
                                focusTarget={friendsTabRef}
                            />
                        ) : friendsListLoading ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
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
                                            <div className="mb-4 p-edge-card md:p-edge-wide card">
                                                <div className="flex flex-wrap items-center gap-3">
                                                    <label htmlFor="group-invite-select" className="text-sm text-content-secondary">
                                                        Invite to Group:
                                                    </label>
                                                    {/* DECISION Phase 89.6-21 (invite-select): the group select's floor is 180px or 8rem, whichever is wider, never wider than the row, chosen OVER the fixed min-w-[180px] (at 200% text its placeholder Select a group... needs 246px and was cut to 178px at 320 and 375: CI run 45676181366, R04) and OVER the select's own content width as the floor (a long group name would then push it under the label at normal text). At normal text 180px governs, so nothing moves; at 200% 8rem (256px) holds the placeholder whole and the select wraps under its label. Changing this is a decision, not a cleanup. */}
                                                    <SelectControl
                                                        id="group-invite-select"
                                                        aria-label="Invite to group"
                                                        value={selectedGroupId}
                                                        onChange={(e) => setSelectedGroupId(e.target.value)}
                                                        className="flex-1 min-w-[min(100%,max(180px,8rem))] max-w-xs"
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
                                                        (padding), `text-sm` (font-size),
                                                        `font-medium` (font-weight 600), `flex items-center
                                                        gap-2` (`display: inline-flex` / `align-items` / `gap`,
                                                        all of them in the one block marked at src/app/globals.css ("UNLAYERED with every other declaration it has today")) and the `disabled:` pair (`.btn:disabled`,
                                                        src/app/globals.css (".btn:disabled { opacity: .5 }")). Re-adding any of them changes no pixel.
                                                        (Cites re-pointed 88.6.1-40 to the `.btn {` block
                                                        and its `.btn:disabled {` block.) */}
                                                    <Button
                                                        variant="primary"
                                                        size="default"
                                                        onClick={handleBulkInvite}
                                                        aria-disabled={!selectedGroupId || selectedFriends.size === 0 || bulkInviteLoading || groupMembersLoading ? 'true' : undefined}
                                                        aria-busy={bulkInviteLoading || undefined}
                                                        busy={bulkInviteLoading}
                                                        busySuffix=", sending"
                                                    >
                                                        Invite to Group
                                                    </Button>
                                                    {selectedFriends.size > 0 && (
                                                        <span className="text-sm text-content-muted">
                                                            {selectedFriends.size} selected
                                                        </span>
                                                    )}
                                                </div>
                                                <StatusRegion settleOnMount className="sr-only" message={groupMembersLoading ? 'Loading group members' : ''} />
                                                {/* DECISION Phase 88.9-56 (R-C3b reach): this row IS the busy indicator — it mounts with its words and role=status the instant the flag turns true and unmounts the instant it turns false — so its glyph stays at 0 ms, chosen OVER a DelayedSpinner inside the guarded row (200 ms of words beside a hole) and OVER holding the row mounted past busy (a stale status on screen); the delay belongs to CONTROLS that stay mounted, not to a row that is itself the signal. AMENDED Phase 88.9-66 (X35): role and heard words moved to the region above; this row keeps its timing as plain text. */}
                                                {groupMembersLoading && (
                                                    <div className="mt-2 flex items-center gap-2 text-xs text-content-muted">
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
                                                        ? `mt-3 p-edge-card rounded-lg text-sm ${bulkInviteResult.failCount === 0
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
                                                        ? 'mt-3 p-edge-card rounded-lg text-sm bg-status-error-subtle text-content-status-error border border-status-error'
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
                                                // DECISION Phase 89.6-21 (friend-fallback): a friend with no username is shown and named 'Member', the house fallback (src/app/components/MemberSelector.js ("a username-less member falls back to 'Member', not their UUID."), 87.4 PR2-L5), chosen OVER an empty name read as 'Select undefined' and OVER 'this friend' (the Remove label's sentence fallback, which does not read as a name). Changing this is a decision, not a cleanup.
                                                const friendDisplayName = friend.username || 'Member';

                                                // DECISION Phase 88.9-58 (X14 family): Friends rows are white cards with no hover (owner 2026-11-14: Why not just turn them into white cards?), chosen OVER the unfilled bordered row with a hover wash (page-coloured at rest, a reaction on a row that is not clickable); row composition kept over the card utility (p-4 suits a list row).
                                                // AMENDED Phase 89.6-39 (O-M1-bare): the row's 16px padding is the page edge token, the same 16px at normal text and held at 16px at 200% text (owner pick O-M1 = D, 2026-11-22: 'Edges stay thin'); still a list row, not the card utility.
                                                // DECISION Phase 89.6-21 (friends-row): GR, the governing rule (owner, 2026-11-22: 'A row stays a row while everything in it fits whole. When it does not, items stack. Nothing is squeezed, shrunk, cut or broken to avoid stacking. Scrolling down is fine; scrolling sideways is not.'): the friend row is a bb-row; the action moves under the name, then the name moves under its checkbox, before any word breaks, chosen OVER a shrinkable name column (the letter-stack 'Weeken / d / Warriors' at 320 / 200%) and OVER a fixed name width. Changing this is a decision, not a cleanup.
                                                return (
                                                    <div
                                                        key={friendship.id}
                                                        data-friend-row={friendship.id}
                                                        className="bb-row items-center gap-3 p-edge-page bg-surface-card border border-line rounded-card"
                                                    >
                                                        {/* 88.9-52 R4 B1 (marker above the found-person row): the column's floor is the checkbox plus the longest word, capped at the row. AMENDED Phase 89.6-21 (friends-row): the floor-is-the-longest-word intent kept, now on bb-row; the pair also wraps and the action never shrinks. */}
                                                        <div className="bb-row-text flex flex-wrap items-center gap-3">
                                                            <input
                                                                id={`bulk-invite-${friendship.id}`}
                                                                name={`bulk-invite-${friendship.id}`}
                                                                type="checkbox"
                                                                aria-label={`Select ${friendDisplayName}`}
                                                                // Read by the members load's focus hand-off (A-55).
                                                                data-bulk-invite-friend={friendUserId}
                                                                checked={isInGroup || selectedFriends.has(friendUserId)}
                                                                disabled={checkboxDisabled}
                                                                onChange={() => toggleFriendSelection(friendUserId)}
                                                                // DECISION Phase 89.6-12 (O-1b): the browser's own focus ring, chosen OVER the app ring, under the written exception for checkboxes (owner pick O-1b = c); same as the invite panel.
                                                                className={`h-4 w-4 shrink-0 rounded-sm border-line text-btn-primary ${
                                                                    checkboxDisabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'
                                                                }`}
                                                            />
                                                            <div className="flex-1 max-w-full">
                                                                <div className="flex flex-wrap items-center gap-x-2">
                                                                    <p className="font-bold text-content-primary max-w-full wrap-break-word">
                                                                        {friendDisplayName}
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
                                                                    // visible label stays Remove (rule 1, 88.9-46 B23) and
                                                                    // the name adds the removing suffix — the aria-label
                                                                    // overrides content, so it carries the person AND the
                                                                    // suffix. The hook only owns resting-vs-armed.
                                                                    {...(removing ? { 'aria-label': `Remove ${friendName}, removing` } : {})}
                                                                    // F9b (88.9-23): a conditional spread, the house form
                                                                    // (src/components/ui/useConfirmAction.ts ("'aria-pressed': true as const")),
                                                                    // so the hook's gated aria-disabled is not overwritten by an
                                                                    // explicit undefined while the request is idle.
                                                                    {...(removing ? { 'aria-disabled': 'true' } : {})}
                                                                    // DECISION Phase 88-27 (D-32 bucket D): the hover affordance
                                                                    // 87.7 stripped from here was a TEXT alpha (error text at
                                                                    // 80% on hover). It comes back as a subtle SURFACE, chosen
                                                                    // OVER re-adding the text alpha — that is the forbidden
                                                                    // mechanism — and OVER leaving the control with no hover
                                                                    // state at all, which would have been a silent downgrade
                                                                    // dressed up as a decision. A background cannot collide with
                                                                    // the armed state below it, which speaks in border and
                                                                    // weight (AMENDED Phase 88.9-52, W38: in weight only now). Same treatment on the two delete-pattern gates in
                                                                    // userProfile and on ParticipantRow's Remove, which reaches
                                                                    // it by the ordinary bucket-C rule.
                                                                    // AMENDED Phase 88.9-52 (W38, owner ruling 2026-11-16: the inline
                                                                    // two-tap controls take ONE look at rest, armed and busy; the
                                                                    // schedule Delete and the phone Remove on Profile are the model):
                                                                    // this host now carries the schedule Delete's class string plus
                                                                    // shrink-0, with NO border in any state, so the armed state speaks
                                                                    // in weight alone. REJECTED: the outlined box it drew when armed
                                                                    // (the only one of the three with a box).
                                                                    className={`bb-row-end gap-0 flex-nowrap ml-auto inline-flex min-h-11 shrink-0 items-center whitespace-nowrap rounded-btn px-2 text-sm text-content-status-error hover:bg-status-error-subtle focus:outline-hidden focus-visible:focus-ring ${
                                                                        armed ? 'font-semibold' : ''
                                                                    }`}
                                                                >
                                                                    {/* DECISION Phase 88.9-52 (W38): the busy spinner sits BEFORE the word
                                                                        (mr-2), chosen OVER after it (ml-2, the raw-host idiom): this
                                                                        control is anchored to the row's right edge, so a spinner after
                                                                        the word pushed Remove 24px left of the other rows' Remove while
                                                                        the write ran; before it, the control grows to the left and the
                                                                        word stays put. REJECTED too: a spinner slot reserved at rest
                                                                        (every row's Remove would sit 24px in from the edge for good).
                                                                        The delayed, held element is unchanged (AMENDED Phase 88.9-56,
                                                                        R-C3b reach: the row leaves with the friend on success, so the
                                                                        hold ends with the host); the suffix rides the aria-label above.
                                                                        Moving it back after the word is a decision, not a cleanup. */}
                                                                    <DelayedSpinner busy={removing} className="mr-2" />
                                                                    {/* X69 width (88.9-67): from the arm the label holds the widest of
                                                                        Wait (3), (2), (1) and Tap again (R13, 88.9-52: the short visible words), so the row does not
                                                                        move when the wait ends; at rest nothing is reserved.
                                                                        AMENDED Phase 88.9-52 (PIX-2, W38 one look, picture pass): the label is
                                                                        anchored to the RIGHT end of that reserve (justify-items-end), the schedule
                                                                        Delete's form on Profile (W37), chosen OVER the default cell, where the
                                                                        button's centred text set Wait (3) in the middle of the 151px reserve (left
                                                                        edge 240 at 375) while the schedule Delete's ended at the edge (330). Both
                                                                        are right-anchored controls, so the short label now ends where Remove ended. */}
                                                                    <ReservedLabel className="justify-items-end" reserve={removeFriendGate.reserveFor(friendship.id)}>
                                                                        {removeFriendGate.labelFor(friendship.id, 'Remove')}
                                                                    </ReservedLabel>
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
                            is a decision, not a cleanup.
                            AMENDED 2026-10-19 (88.6.1 code review A-54): a request the provider reconciled
                            away INSIDE the failing call (its requestRowRemoved mark: someone handled it
                            elsewhere, or a 500 followed a committed accept) keeps its line, as the bell does
                            for the same call; otherwise the row vanished, focus moved on and the failure read
                            as success. It still clears on the next press, on a tab change and when FR1 shows;
                            a row a LATER load removes still takes its line with it. */}
                        {requestActionError &&
                            !requestsFullBannerShown &&
                            (requestActionError.rowRemoved ||
                                receivedRequests.some((r) => r.id === requestActionError.id)) && (
                                <p role="alert" className="text-content-status-error text-sm mb-4">{requestActionError.message}</p>
                            )}
                        <StatusRegion settleOnMount className="sr-only" message={requestsListLoading ? 'Loading your friend requests' : ''} />
                        {requestsListLoading ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
                                <div aria-hidden="true" className="animate-spin rounded-full h-5 w-5 border-b-2 border-btn-primary" />
                                <span>Loading requests...</span>
                            </div>
                        ) : requestsFullBannerShown ? (
                            <FetchErrorBanner
                                state={requestsErrorState}
                                thing={FRIEND_REQUESTS_LOAD_FAILED_THING}
                                reportContext="friends page — friend requests fetch"
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

                                            // DECISION Phase 88.9-58 (X14 family): Friends rows are white cards with no hover (owner 2026-11-14: Why not just turn them into white cards?), chosen OVER the unfilled bordered row with a hover wash (page-coloured at rest, a reaction on a row that is not clickable); row composition kept over the card utility (p-4 suits a list row).
                                            // AMENDED Phase 89.6-39 (O-M1-bare): the row's 16px padding is the page edge token, the same 16px at normal text and held at 16px at 200% text (owner pick O-M1 = D, 2026-11-22: 'Edges stay thin'); still a list row, not the card utility.
                                            return (
                                                <div
                                                    key={request.id}
                                                    data-request-row={request.id}
                                                    className="flex flex-wrap items-center justify-between gap-3 p-edge-page bg-surface-card border border-line rounded-card"
                                                >
                                                    <div className="flex-1 max-w-full">
                                                        <p className="font-bold text-content-primary wrap-break-word">
                                                            {requester.username}
                                                        </p>
                                                    </div>
                                                    {/* 88.9-52 R4 B1 (marker above the found-person row): on a line of its own this pair is capped at the row and may stack. */}
                                                    <div className="ml-auto flex max-w-full flex-wrap items-center justify-end gap-2">
                                                        <Button
                                                            variant="primary"
                                                            size="default"
                                                            onClick={(e) => handleAccept(request.id, e)}
                                                            aria-disabled={actionLoading[request.id] === 'accept' ? 'true' : undefined}
                                                            disabled={actionLoading[request.id] === 'decline' || (!actionLoading[request.id] && isRequestActionPending(request.id))}
                                                            busy={actionLoading[request.id] === 'accept'}
                                                            busySuffix=", accepting"
                                                        >
                                                            Accept
                                                        </Button>
                                                        <Button
                                                            variant="secondary"
                                                            size="default"
                                                            onClick={(e) => handleDecline(request.id, e)}
                                                            aria-disabled={actionLoading[request.id] === 'decline' ? 'true' : undefined}
                                                            disabled={actionLoading[request.id] === 'accept' || (!actionLoading[request.id] && isRequestActionPending(request.id))}
                                                            busy={actionLoading[request.id] === 'decline'}
                                                            busySuffix=", declining"
                                                        >
                                                            Decline
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
                        <StatusRegion settleOnMount className="sr-only" message={sentListLoading ? 'Loading your sent requests' : ''} />
                        {!sentRetained && sentErrorState.showError ? (
                            <FetchErrorBanner
                                state={sentErrorState}
                                thing="your sent requests"
                                reportContext="friends page — sent requests fetch"
                                focusTarget={sentTabRef}
                            />
                        ) : sentListLoading ? (
                            <div className="flex items-center gap-2 text-content-secondary py-8 justify-center">
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

                                            // DECISION Phase 88.9-58 (X14 family): Friends rows are white cards with no hover (owner 2026-11-14: Why not just turn them into white cards?), chosen OVER the unfilled bordered row with a hover wash (page-coloured at rest, a reaction on a row that is not clickable); row composition kept over the card utility (p-4 suits a list row).
                                            // AMENDED Phase 89.6-39 (O-M1-bare): the row's 16px padding is the page edge token, the same 16px at normal text and held at 16px at 200% text (owner pick O-M1 = D, 2026-11-22: 'Edges stay thin'); still a list row, not the card utility.
                                            return (
                                                <div
                                                    key={request.id}
                                                    data-sent-row={request.id}
                                                    className="flex flex-wrap items-center justify-between gap-3 p-edge-page bg-surface-card border border-line rounded-card"
                                                >
                                                    <div className="flex-1 max-w-full">
                                                        <p className="font-bold text-content-primary wrap-break-word">
                                                            {addressee.username}
                                                        </p>
                                                    </div>
                                                    <span className="ml-auto shrink-0 px-3 py-1 rounded-full text-xs font-bold bg-status-warning-subtle text-content-status-warning border border-status-warning">
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
