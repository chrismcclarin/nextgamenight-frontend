'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { ApiError, groupsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import ResponseDashboard from '../components/ResponseDashboard';
import PromptScheduleSection from '../components/PromptScheduleSection';
import { pollChipLabels, pollTitle } from '../components/OpenPollsList';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { selfIdentityErrorSource } from '../../lib/hooks/selfIdentityErrorSource';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { logger, errCtx } from '../../lib/logger';
import { isUuid } from '../../lib/isUuid';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
    openPromptsSchema,
    softFailPromptQueryFn,
    EMPTY_OPEN_PROMPTS,
} from '../../lib/schemas/prompts';

// The role read's resolved outcome: the shape plan 88.6.1-21's banner reads from a retry's own
// result to tell a failed Retry (copy row B1). `undefined` means unknown (skipped or superseded).
const LOAD_OK = Object.freeze({ isError: false });
const LOAD_FAILED = Object.freeze({ isError: true });

// Copy row G5 (D-30): byte-equal to the route fallback label (groupPlanning/loading.tsx), so the
// wording does not change when the route boundary hands over to the page.
const AUTH_LOADING_MESSAGE = "Getting your group's plans...";

// quick-261026-pi6 (owner R3): the lead word of the line that names the poll the dashboard shows,
// and the chip row's group name (read by screen readers; the row has no visible label).
const SHOWING_LABEL = 'Showing';
const SWITCH_POLL_LABEL = 'Switch poll';
// The poll-data loading line, and the Showing line's in-flight fallback when the poll has no
// label yet (quick-261026-pi6-fix F10: one literal, two uses).
const POLL_DATA_LOADING_LABEL = 'Loading poll data...';
// The spoken notice after a selected poll fell back to the active one (F10).
const POLL_OPEN_FAILED_NOTICE = "That poll couldn't be opened.";
// The answers that mean a selected poll is gone or not this person's to read: a stale link.
const STALE_POLL_STATUSES = [400, 403, 404];

// DECISION quick-261026-pi6-fix (F7): ids are compared case-insensitively, OVER a strict ===,
// because isUuid and Postgres both accept a UUID in any case, so an uppercase id in a link names
// the same row the lowercase one from the API does. Changing this is a decision, not a cleanup.
function sameId(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
}

export default function GroupPlanningPage() {
    const { user, isLoading: authLoading } = Auth();
    // Phase 87.3-05 (D-02): resolve the caller's own Users.id UUID via the
    // shared identity primitive, collapsing the former per-page usersAPI
    // self-fetch (getUser by sub). selfUuid feeds the self-role derive
    // (UUID vs nested member.id) and PromptScheduleSection's currentUserDbId.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    // AC-29 (88.6.1-63): an identity failure counts only with no row held; an access answer over a held row is told by this view's own data requests instead, deliberately; the rule and its reasons live in selfIdentityErrorSource.ts.
    const selfIdentityErrorState = useFetchErrorState(selfIdentityErrorSource(selfIdentityQuery, selfUuid));
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    /* DECISION quick-261026-pi6 (coordinator ruling 1, 2026-10-26): a prompt_id that is not a UUID
       is treated as ABSENT (no request, the active poll shows, the Create Event dialog does not
       auto-open), chosen OVER passing it through to the backend's 400 or 404 and OVER a visible
       error, because a malformed email link should not read as "the poll request failed", and
       because the id is interpolated into request paths here and in CreateEvent (the CSPT rule of
       src/lib/isUuid.ts ("DECISION Phase 88.6.1-07 (D-03 / AC-6 / CSPT)")); a real email link
       carries the poll's UUID and behaves exactly as before. Changing this is a decision, not a
       cleanup.
       AMENDED quick-261026-pi6-fix (F4): group_id gets the same check for the same CSPT reason (it
       is interpolated into every group and poll request on this page): a group_id that is not a
       UUID is treated as ABSENT, so the page shows its no-group state and sends no request, OVER
       sending it on and showing the backend's failure. Every later use reads the checked value. */
    const groupIdParam = searchParams.get('group_id');
    const groupId = isUuid(groupIdParam) ? groupIdParam : null;
    const promptIdParam = searchParams.get('prompt_id');
    const promptId = isUuid(promptIdParam) ? promptIdParam : null;
    /* DECISION quick-261026-pi6 (owner R4/R5, 2026-10-26): the dashboard selection lives in its
       own URL parameter, poll, OVER reusing prompt_id, which is the email link's contract and
       auto-opens the Create Event dialog on mount,
       this file ("Auto-open the createEvent modal when the URL carries prefill params");
       resolution is poll, then prompt_id, then the active poll. A selection writes the URL
       through the native history pushState, OVER router push or replace, because Next 14.2.35
       turns it into a router restore that reuses the cache and fetches nothing,
       node_modules:next/dist/client/components/app-router.js ("Patch pushState to ensure external changes"),
       so back steps through selections and a reload or a shared link opens the same poll. The id
       passes the CSPT check of src/lib/isUuid.ts ("DECISION Phase 88.6.1-07 (D-03 / AC-6 / CSPT)")
       before any request, and a malformed, failed or other-group id falls back to the active poll
       and the parameter is dropped with replaceState, never an error banner for a stale link.
       Changing any of this is a decision, not a cleanup. */
    const selectedPollParam = searchParams.get('poll');
    const requestedPollId = isUuid(selectedPollParam) ? selectedPollParam : null;

    // Phase 71.2 — "Schedule it?" email CTA pre-fills the createEvent modal
    // via these query params. createEvent.js already accepts the props
    // (prefillDate/prefillTime/prefillDuration/prefillGameId); this page just
    // needs to forward them. Plan 02 ships the email links shaped this way.
    const prefillDate = searchParams.get('prefillDate');
    const prefillTime = searchParams.get('prefillTime');
    const prefillDuration = searchParams.get('prefillDuration');
    const prefillGameId = searchParams.get('prefillGameId');

    const [group, setGroup] = useState(null);
    const [groupError, setGroupError] = useState(null);

    // Modal state for CreateEvent. When the URL carries prefill params we
    // open the modal automatically so the user lands directly on the event
    // form (matches the email-CTA expected behavior).
    const [eventModal, setEventModal] = useState(false);

    // Heatmap/prompt state (needed for ResponseDashboard)
    const [heatmapPrompt, setHeatmapPrompt] = useState(null);
    const [heatmapLoading, setHeatmapLoading] = useState(true);
    const [heatmapError, setHeatmapError] = useState(null);
    // The swap announcement (quick-261026-pi6-fix F10): empty until a swap commits.
    const [selectionStatus, setSelectionStatus] = useState('');
    // The poll the dashboard shows, or is about to show: the URL's selection, then the loaded poll
    // (quick-261026-pi6). The cards and the chips mark it.
    const selectedPollId = requestedPollId ?? heatmapPrompt?.id ?? null;
    // Newest wins for the poll load (the role read's shape below); the last poll parameter the
    // selection effect acted on, stamped with its group.
    const heatmapRunRef = useRef(0);
    const lastSelectionRef = useRef({ groupId, poll: selectedPollParam });
    const availabilityPollsHeadingRef = useRef(null);
    const pollResponsesHeadingRef = useRef(null);
    const dashboardRef = useRef(null);
    // The caller's role, stamped with the group it was read for. `userRole` / `roleError` are
    // DERIVED at render and read null for any other group, so the render in which `groupId`
    // changes already passes null to the gated controls (DECISION Phase 88.6.1-16 at the compact
    // notice below).
    const [roleRecord, setRoleRecord] = useState({ groupId: null, role: null, error: null });
    const userRole = roleRecord.groupId === groupId ? roleRecord.role : null;
    const roleError = roleRecord.groupId === groupId ? roleRecord.error : null;
    const groupIdRef = useRef(groupId);
    const roleRunRef = useRef(0);
    // The open role read's promise, or null (see `retryRole`).
    const roleInFlightRef = useRef(null);
    // If a failed swap removes the chip or heading a person stood on, focus goes to the
    // Availability Polls heading, never to the page body (quick-261026-pi6).
    const focusRecovery = useFocusRecovery({ fallback: availabilityPollsHeadingRef });
    // The open polls for the chips and the Showing line, on the shared key, so this reads the
    // same cache entry as the Check-ins section and its list (one request, Phase 84 PRIM-07). It
    // renders no failure surface of its own: OpenPollsList owns the one banner for this key.
    const { data: openPollsData } = useQuery({
        queryKey: promptKeys.openPolls(groupId),
        queryFn: softFailPromptQueryFn(
            openPromptsSchema,
            () => promptAPI.getOpenPrompts(groupId),
            promptKeys.openPolls(groupId),
            EMPTY_OPEN_PROMPTS,
        ),
        enabled: Boolean(groupId) && Boolean(userRole) && userRole !== 'pending',
    });
    const openPolls = Array.isArray(openPollsData?.prompts) ? openPollsData.prompts : [];

    useEffect(() => {
        if (!authLoading && !user) {
            const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/api/auth/login?returnTo=${returnTo}`;
        }
    }, [authLoading, user]);

    /* DECISION Phase 88.6.1-16 (W060 double fetch): the group and poll loads run ONCE per user
       and group; only the role re-derive follows identity. Two effects, chosen OVER the single
       shared effect that Phase 87.3-05 (FE dabb4a6) gave the identity dependency so the role
       would re-run once identity resolved — which also re-ran BOTH loads at that moment, fetching
       each twice on a cold visit, blanking the poll responses to their loading line mid-view and
       remounting them, and letting a failed second poll fetch hide a good first result behind the
       error banner (the AC-29 shape). The loads key on the user's sub, following EventCalendar's
       fetch effect and UserHomePage's upcoming-events effect (a fresh user object per render
       must not re-fetch); the role effect keeps the user object, unchanged since 87.3-05.
       Merging them back is a decision, not a cleanup. */
    useEffect(() => {
        if (user?.sub && groupId) {
            fetchGroup();
            fetchHeatmapData();
        }
        // The fetches are re-declared per render; the deps above are the reload triggers on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user?.sub, groupId]);

    /* DECISION quick-261026-pi6 (owner R4): a swap runs from its OWN effect keyed on the poll
       parameter, OVER a new dependency on the load effect, whose deps are a recorded decision,
       this file ("DECISION Phase 88.6.1-16 (W060 double fetch)"); a swap keeps the dashboard that
       is showing mounted until the next poll lands, OVER the loading line, for the reason that
       marker gives; the newest load wins, so a late answer for an earlier tap writes nothing.
       Changing this is a decision, not a cleanup. */
    useEffect(() => {
        const last = lastSelectionRef.current;
        if (last.groupId !== groupId) {
            // A group change: the load effect owns it.
            lastSelectionRef.current = { groupId, poll: selectedPollParam };
            return;
        }
        if (last.poll === selectedPollParam) {
            // DECISION quick-261026-pi6-fix (F1): the drop record below is honoured for ONE
            // render, the one that still carries the dropped value, and cleared on the next
            // settled render, OVER keeping it until the parameter changes again, which skipped a
            // re-tap of the same poll forever while its card said Viewing. Changing this is a
            // decision, not a cleanup.
            if (last.dropped !== undefined && selectedPollParam !== last.dropped) {
                lastSelectionRef.current = { groupId, poll: selectedPollParam };
            }
            return;
        }
        // A render that still carries the value this page just dropped as stale: the drop's own
        // re-render follows with the parameter gone, so loading here would fetch the fallback
        // twice. A malformed id drops with no await, inside the same commit as this effect.
        if (last.dropped === selectedPollParam) return;
        lastSelectionRef.current = { groupId, poll: selectedPollParam };
        if (user?.sub && groupId) {
            fetchHeatmapData({ keepShown: true });
        }
        // The fetch is re-declared per render; the poll parameter is the swap trigger on purpose.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedPollParam, groupId, user?.sub]);

    useEffect(() => {
        if (user?.sub && groupId) {
            // fetchUserRole self-gates on selfUuid; selfUuid is in the deps so
            // the self-role derive re-runs once identity resolves (D-04).
            fetchUserRole();
        }
    }, [user, groupId, selfUuid]);

    // Auto-open the createEvent modal when the URL carries prefill params OR
    // a prompt_id (Plan 03 single-CTA model: email links to ?prompt_id=X with
    // no per-slot prefill; the modal renders a poll-restricted heatmap and
    // the user picks visually).
    useEffect(() => {
        if ((prefillDate && prefillTime) || promptId) {
            setEventModal(true);
        }
        // Only run on initial mount when params are present; subsequent toggles
        // are user-driven via the existing buttons.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const fetchGroup = async () => {
        if (!groupId) return;
        try {
            setGroupError(null);
            const groupData = await groupsAPI.getGroup(groupId);

            // If Users are not included, fetch them separately
            if (!groupData?.Users || groupData.Users.length === 0) {
                try {
                    const members = await groupsAPI.getGroupMembers(groupId);
                    groupData.Users = members || [];
                } catch (memberError) {
                    logger.info('Error fetching group members:', errCtx(memberError));
                }
            }

            setGroup(groupData);
        } catch (error) {
            logger.info('Error fetching group:', errCtx(error));
            /* DECISION Phase 88-25 (Req 14 / Req 11, DEF-88-16-01): a failed group load renders
               the shared fetch-error treatment with a retry, chosen OVER the native browser alert
               this shipped with. A browser alert is unstyled, un-dismissable by keyboard
               convention, blocks the whole page for a READ failure, and offers no way to retry —
               the person's only recourse was a manual reload. It was also one of the six
               native-alert sites DEF-88-16-01 censused, invisible to Req 11's confirm-only gate.
               (The literal call is not written out here, comment included — that gate is a plain
               grep and does not exempt comments. Same convention as 88-11's marker in gameDetail.)

               Keep the ERROR object, not a flattened string: useFetchErrorState reads
               `ApiError.code` off it to pick the right user-facing copy. */
            setGroupError(
                error instanceof Error ? error : new Error("The group request didn't complete.")
            );
        }
    };

    // A stale selection (malformed, failed to load, or another group's poll): drop the poll
    // parameter in place, every other parameter kept, and record the drop so the selection
    // effect does not load again for it (quick-261026-pi6, owner R5).
    // DECISION quick-261026-pi6-fix (F3): the URL is rebuilt from the LIVE location, OVER this
    // render's searchParams, because the drop runs after an await and a parameter removed in the
    // meantime (the dialog's close clears prompt_id) must not be written back. Changing this is
    // a decision, not a cleanup.
    const dropStaleSelection = (forGroup, stalePoll) => {
        lastSelectionRef.current = { groupId: forGroup, poll: null, dropped: stalePoll };
        const next = new URLSearchParams(window.location.search);
        next.delete('poll');
        const qs = next.toString();
        window.history.replaceState(null, '', qs ? `${window.location.pathname}?${qs}` : window.location.pathname);
    };

    // The name the Showing line and the swap announcement give a poll (quick-261026-pi6).
    const pollNameFor = (prompt) =>
        pollChipLabels(openPolls, group).get(prompt.id) ?? pollTitle(prompt, group);

    const fetchHeatmapData = async ({ keepShown = false, skipCache = false } = {}) => {
        if (!groupId) return;
        const run = ++heatmapRunRef.current;
        const forGroup = groupId;
        // Superseded: a newer poll load started, or the page moved to another group.
        const superseded = () => run !== heatmapRunRef.current || groupIdRef.current !== forGroup;
        // A swap keeps the dashboard that is showing until the next poll lands (the swap marker
        // above); with nothing shown yet, the loading line is the honest state.
        if (!keepShown || !heatmapPrompt) setHeatmapLoading(true);
        setHeatmapError(null);
        try {
            let prompt = null;
            let fellBack = false;
            if (selectedPollParam) {
                let selected = null;
                /* DECISION quick-261026-pi6-fix (F9): a selection the open-polls cache already
                   holds is shown from that cache with no request, OVER a by-id fetch per swap
                   (a round trip before the respondents fetch could even start). The cache is
                   this group's by construction (the shared key) and carries every field this
                   page reads. The by-id read stays for everything else: a cold load or a shared
                   link before the open list lands, a closed poll, and a reload after the shown
                   poll was ended (skipCache, F8), when the cached row may still say active.
                   Changing this is a decision, not a cleanup. */
                const cached = requestedPollId && !skipCache
                    ? openPolls.find((p) => sameId(p.id, requestedPollId))
                    : null;
                if (cached) {
                    selected = cached;
                } else if (requestedPollId) {
                    try {
                        const data = await promptAPI.getPromptById(requestedPollId);
                        // Only this group's poll: a member of two groups could otherwise open another
                        // group's poll here through a crafted link.
                        if (data?.prompt && sameId(data.prompt.group_id, forGroup)) selected = data.prompt;
                    } catch (err) {
                        /* DECISION quick-261026-pi6-fix (F2): a failed selected-poll load is split
                           in two, OVER one silent fallback for both. A stale answer (400, 403 or
                           404: a malformed, deleted or other-group poll) keeps the quiet path, a
                           breadcrumb, the parameter dropped and the active poll shown. Anything
                           else (a 5xx, a network failure) is a real failure: it reaches Sentry,
                           the parameter and its history entry are KEPT, and it is rethrown so the
                           poll-data banner and its Retry render, and Retry loads the same poll.
                           A silent fallback for a transient failure showed another poll with no
                           word of why and left a dead history entry. Changing this is a
                           decision, not a cleanup. */
                        if (!(err instanceof ApiError && STALE_POLL_STATUSES.includes(err.status))) {
                            logger.error('Selected poll failed to load', err);
                            throw err;
                        }
                        logger.info('Selected poll did not load; showing the active poll:', errCtx(err));
                    }
                }
                if (superseded()) return;
                if (selected) {
                    prompt = selected;
                } else {
                    dropStaleSelection(forGroup, selectedPollParam);
                    fellBack = true;
                }
            }
            if (!prompt && promptId) {
                // Navigating from a no-consensus email -- load specific prompt by ID
                const data = await promptAPI.getPromptById(promptId);
                // DECISION quick-261026-pi6-fix (F5): only this group's poll, the poll arm's rule,
                // OVER showing whatever the id names; another group's poll falls through to the
                // active poll, so a link built for group B cannot fill group A's dashboard.
                // Changing this is a decision, not a cleanup.
                if (data?.prompt && sameId(data.prompt.group_id, forGroup)) prompt = data.prompt;
            }
            if (!prompt) {
                const data = await promptAPI.getActivePrompt(groupId);
                prompt = data.prompt;
            }
            if (superseded()) return;
            setHeatmapPrompt(prompt);
            // A swap is announced once it commits; the first load is not (F10). The name is read
            // through the ref, so it comes from the open list as of the commit, the list the
            // Showing line renders from, not the one this load started under.
            const nameOf = pollNameForRef.current ?? pollNameFor;
            if (keepShown && fellBack) {
                setSelectionStatus(prompt
                    ? `${POLL_OPEN_FAILED_NOTICE} ${SHOWING_LABEL} ${nameOf(prompt)}.`
                    : POLL_OPEN_FAILED_NOTICE);
            } else if (keepShown && prompt) {
                setSelectionStatus(`${SHOWING_LABEL} ${nameOf(prompt)}`);
            }
        } catch (err) {
            if (superseded()) return;
            // Keep the ERROR object, not `err.message`: the raw upstream string used to be
            // painted straight into the page below (T-88-25-01 / ASVS V7). The hook derives
            // designed copy from `ApiError.code` instead.
            setHeatmapError(err instanceof Error ? err : new Error("The poll request didn't complete."));
        } finally {
            if (run === heatmapRunRef.current) setHeatmapLoading(false);
        }
    };

    const fetchUserRole = async () => {
        // Gate on identity resolution — the self-role find keys on the nested
        // member.id vs selfUuid, so we wait until selfUuid resolves rather than
        // storing a wrong "no role". Re-runs when selfUuid lands (in effect deps).
        // A gated call asked nothing, so it resolves undefined (unknown, never announced).
        // Every read that settles stores what it learned: the found role, null when the
        // caller is absent, null plus the error when the read failed — never a stale role.
        if (!groupId || !user?.sub || !selfUuid) return undefined;
        const run = ++roleRunRef.current;
        const forGroup = groupId;
        // Superseded: a newer role read started, or the page moved to another group.
        const superseded = () => run !== roleRunRef.current || groupIdRef.current !== forGroup;
        // The run's promise is published SYNCHRONOUSLY, before its await, so a Retry pressed while
        // it is open joins it (`retryRole` below; A-60, 88.6.1 code review).
        const thisRun = (async () => {
            try {
                const members = await groupsAPI.getGroupMembers(forGroup);
                if (superseded()) return undefined;
                const me = (members || []).find(m => m.id === selfUuid);
                setRoleRecord({ groupId: forGroup, role: me?.UserGroup?.role ?? null, error: null });
                return LOAD_OK;
            } catch (err) {
                // LOG FIRST, then the superseded return: an overtaken read that really failed is
                // still a failed request (the house order, plan 88.6.1-71's members/events catches).
                logger.info('Error fetching user role:', errCtx(err));
                if (superseded()) return undefined;
                setRoleRecord({
                    groupId: forGroup,
                    role: null,
                    error: err instanceof Error ? err : new Error("The role request didn't complete."),
                });
                return LOAD_FAILED;
            } finally {
                if (roleInFlightRef.current === thisRun) roleInFlightRef.current = null;
            }
        })();
        roleInFlightRef.current = thisRun;
        return thisRun;
    };

    /* Adapters onto the shared fetch-error pair, matching the shipped 88-14/88-18 shape
       (friends/page.js, grouplist.js, GroupLibrary.js): the hook documents that it reads ONLY
       `isError`/`error`/`refetch` (useFetchErrorState.ts). `refetch` must be STABLE — the hook
       puts it in a useCallback dep AND in its refocus-recovery effect deps, so handing it a fresh
       function each render would re-subscribe that listener on every render while erroring.
       These three fetches are re-declared per render (they close over groupId/promptId/selfUuid),
       hence the ref hop rather than a useCallback on the fetch itself. Each retry RETURNS the
       fetch's promise, so the hook's retry resolves whatever the fetch resolves (the role read's
       LOAD_OK / LOAD_FAILED outcome above). */
    const fetchGroupRef = useRef(null);
    const fetchHeatmapRef = useRef(null);
    const fetchUserRoleRef = useRef(null);
    const pollNameForRef = useRef(null);
    useEffect(() => {
        pollNameForRef.current = pollNameFor;
        fetchGroupRef.current = fetchGroup;
        fetchHeatmapRef.current = fetchHeatmapData;
        fetchUserRoleRef.current = fetchUserRole;
        groupIdRef.current = groupId;
    });
    const retryGroup = useCallback(() => fetchGroupRef.current?.(), []);
    const retryHeatmap = useCallback(() => fetchHeatmapRef.current?.(), []);
    // DECISION 88.6.1 code review A-60: a role Retry (the person's press OR the hook's tab-return
    // re-attempt) JOINS a role read already in flight — groupHomePage's idiom
    // (`membersInFlightRef.current ?? …`) — OVER starting a second members request that newest-wins
    // would only throw away. The identity-keyed effect calls `fetchUserRole` directly and never
    // joins, so a new identity still supersedes the open read. Changing this is a decision, not a cleanup.
    const retryRole = useCallback(() => roleInFlightRef.current ?? fetchUserRoleRef.current?.(), []);

    const groupErrorState = useFetchErrorState({
        isError: Boolean(groupError),
        error: groupError,
        refetch: retryGroup,
    });
    const heatmapErrorState = useFetchErrorState({
        isError: Boolean(heatmapError),
        error: heatmapError,
        refetch: retryHeatmap,
    });
    const roleErrorState = useFetchErrorState({
        isError: Boolean(roleError),
        error: roleError,
        refetch: retryRole,
    });
    // ONE compact notice for the caller's personal controls: identity first (see the marker at
    // the mount below).
    const personalControlsErrorState = selfIdentityErrorState.showError
        ? selfIdentityErrorState
        : roleErrorState;

    // Phase 71.2 / Plan 03 hotfix — clear the email-CTA query params (prompt_id,
    // prefillDate, etc.) when the modal closes for any reason. Without this, a
    // page refresh after submit auto-reopens the modal because the auto-open
    // useEffect re-fires on mount whenever those params are still in the URL.
    const clearEventModalParams = () => {
        if (!searchParams) return;
        const ctaParams = ['prompt_id', 'prefillDate', 'prefillTime', 'prefillDuration', 'prefillGameId'];
        const hasAny = ctaParams.some((k) => searchParams.has(k));
        if (!hasAny) return;
        const next = new URLSearchParams(searchParams.toString());
        ctaParams.forEach((k) => next.delete(k));
        const qs = next.toString();
        router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    };

    const toggleEventModal = () => {
        const willClose = eventModal;
        setEventModal(!eventModal);
        if (willClose) clearEventModalParams();
    };

    // quick-261026-pi6 (owner R4/R5): a selection is one history entry, pushed only when it
    // changes the poll; the selection effect then loads it in place.
    const selectPoll = (id) => {
        if (!id || id === selectedPollId) return;
        const next = new URLSearchParams(searchParams.toString());
        next.set('poll', id);
        window.history.pushState(null, '', `${pathname}?${next.toString()}`);
    };

    // A card tap (owner R3): select, bring the Poll Responses heading to the top below the sticky
    // header, and move focus there, so a screen reader lands on what changed.
    const handleSelectPoll = (id) => {
        selectPoll(id);
        const target = pollResponsesHeadingRef.current ?? dashboardRef.current;
        // jsdom has no scrollIntoView (ParticipantRow's guard).
        if (target && typeof target.scrollIntoView === 'function') {
            const reduceMotion = typeof window.matchMedia === 'function'
                && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            target.scrollIntoView({ block: 'start', behavior: reduceMotion ? 'auto' : 'smooth' });
        }
        const heading = pollResponsesHeadingRef.current;
        if (heading) {
            heading.focus({ preventScroll: true });
            // Armed from the focused heading, then settled (the hook's contract (8)).
            const settle = focusRecovery.arm();
            settle();
        }
    };

    // quick-261026-pi6-fix F8: ending the poll the dashboard shows reloads it in place. With the
    // poll in the URL the by-id read returns it closed (the dashboard then reads it as closed);
    // with none, the active-poll read picks the next open poll or none.
    const handlePollClosed = (id) => {
        if (sameId(id, heatmapPrompt?.id)) fetchHeatmapRef.current?.({ keepShown: true, skipCache: true });
    };

    // A chip press swaps in place: no scroll, no focus move; armed from the pressed chip in case
    // a failed swap removes it (the hook's contract (1) and (2)).
    const handleChipSelect = (event, id) => {
        const settle = focusRecovery.arm({ from: event.currentTarget });
        try {
            selectPoll(id);
        } finally {
            settle();
        }
    };


    if (!user) {
        return <div className="flex items-center justify-center min-h-screen text-content-secondary">
            {authLoading ? AUTH_LOADING_MESSAGE : 'Redirecting to login...'}
        </div>;
    }

    if (!groupId) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <p className="text-content-status-error">No group specified. Please navigate from a group page.</p>
                <Link href="/" className="text-content-link hover:underline">Go to Home</Link>
            </div>
        );
    }

    const isAdmin = ['owner', 'admin'].includes(userRole);
    const chipLabels = pollChipLabels(openPolls, group);
    const shownPollName = heatmapPrompt ? pollNameFor(heatmapPrompt) : null;
    // A selection whose poll is still loading (the network path; a cached swap is synchronous).
    const swapPending = Boolean(requestedPollId)
        && !sameId(requestedPollId, heatmapPrompt?.id)
        && !heatmapError;
    const pendingPollName = swapPending ? chipLabels.get(requestedPollId) : undefined;
    const pollClosed = !heatmapPrompt ||
        heatmapPrompt.status === 'closed' ||
        heatmapPrompt.status === 'converted' ||
        (heatmapPrompt.deadline && new Date(heatmapPrompt.deadline) < new Date());

    return (
        <div className="p-4 md:p-6 max-w-7xl mx-auto">
            {/* Breadcrumbs */}
            {/* DECISION Phase 88.6-21 (#175, owner ruling 2026-09-14, option 2 — label all five
                breadcrumb navs). THIS ATTRIBUTE IS THE ONLY EDIT PLAN 21 MAKES TO THIS FILE. The
                file is not swept, not migrated, and its `no-console` allowlist entry
                (the `no-console` override list in `.eslintrc.json`) is deliberately untouched: AC-2's convert-on-touch rule is
                scoped to plans that convert LOGGING, and an `aria-label` converts none — so plan
                43's census is undisturbed. The ruling is assigned ONCE per nav; the other four
                belong to plans 17 and 18 and are already done.
                AMENDED Phase 88.6-53 (2026-09-28): the "not swept, not migrated" half is STALE —
                plan 88.6-53 swept this file (headings onto Heading, off-scale weights, body text,
                aria-current on the current crumb). What still stands is the no-console allowlist
                entry (the same override list; the line number first cited above had drifted): its
                four console calls are untouched by 53 too, and the entry belongs to the ROADMAP :28
                milestone-close sweep (ledger P08), not to a type sweep.
                AMENDED Phase 88.6.1-16 (W060, ROADMAP :28 convert-on-touch): the file's four raw
                console calls are gone — one deleted with the unread events fetch, three moved to
                the house breadcrumb logger at info with errCtx — and the file's entry in that
                override list was removed in the same change. ROADMAP :28's convert-on-touch rule
                applies to a file this phase edits, so the milestone-close sweep (ledger P08) has
                nothing left here, and lint now guards the file. BOOKKEEPING: nothing breaks. */}
            {/* DECISION Phase 88.6-53 (D-03 / UI-SPEC §4.5; R2 #171): the two links are 400 (the
                emphasis is carried by the link colour token) and the current crumb is 700 with
                aria-current="page" — chosen to MATCH this page's parent, the groupHomePage
                breadcrumb, OVER userProfile's 400 current crumb (DECISION Phase 88.6-17). The five
                breadcrumbs disagree on that weight (userProfile 400, the other four 700); settling
                it is a look call routed to Phase 88.9 — plan 88.6-56 writes the pointer.
                The links also carry the project focus ring, DECISION Phase 88.3-17 (DEF-88.3-13-04,
                owner ruling A: the browser default outline is unreadable on some surfaces) — they
                are the page's FIRST tab stops. The separators are aria-hidden so a screen reader
                does not read "greater than" between crumbs. Still open elsewhere at FE 2f3d4c4: five
                breadcrumb links lacked the ring (userProfile's Home link, both gameDetail Home links
                and both gameDetail group-name links) and 6 separator spans were not hidden.
                AMENDED Phase 88.6.1-16 (D-46): as first written this sentence counted three (Home
                links only); the Phase 88.6.1 research re-count found five, which is D-46. The ring
                and the six exposed separators are no longer an 88.9 pointer — Phase 88.6.1
                Requirement 7 fixes them in each page's own plan, and plan 88.6.1-55 pins every
                breadcrumb link's ring and separator in the shared breadcrumb scan. The crumb-weight
                question above stays with Phase 88.9. */}
            {/* DECISION Phase 88.6.1-16 (R7-M7): the nav carries min-w-0 beside its inline-block
                max-w-full pill. The token is inert today (the nav's parent is a block box) and is
                KEPT on purpose: if the nav ever becomes a flex item, a minimum width of auto would
                beat the max-width cap and re-open UAT3-D1 (a long unbroken group name running off a
                375px screen). Chosen OVER omitting it as inert — the reasoning the groupHomePage
                breadcrumb marker records (its "deliberately NOT added" sentence), which plan
                88.6.1-55 amends while it adds the token to the shared breadcrumb scan. Removing it
                is a decision, not a cleanup. */}
            <nav aria-label="Breadcrumb" className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block max-w-full wrap-break-word min-w-0">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2">Home</Link>
                <span aria-hidden="true" className="text-content-muted mx-2">{'>'}</span>
                {group && (
                    <>
                        <Link href={`/groupHomePage?id=${groupId}`} className="text-content-link hover:text-content-link-hover transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 max-w-[200px] truncate inline-block align-bottom">
                            {group.name}
                        </Link>
                        <span aria-hidden="true" className="text-content-muted mx-2">{'>'}</span>
                    </>
                )}
                <span aria-current="page" className="text-content-primary font-bold">Plan Game Session</span>
            </nav>

            {/* Header */}
            <div className="card p-3 md:p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="min-w-0">
                        {/* DECISION Phase 88.6-53 (D-04 §4.4 row 1; A1): the page title is Display 30
                            at EVERY width, chosen OVER keeping the breakpoint-grown 24 -> 30 pair (a
                            heading that changes size at a breakpoint is a second type scale), and it
                            WRAPS, chosen OVER keeping the old ellipsis clip — A1, the tracer's ruling
                            (applied at GroupGamesList.js; recorded at
                            planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-15-PLAN.md ("-on-a-heading ruling (A1) — decided here")
                            ): clipping is kept
                            only where it is load-bearing, and here it would hide the group NAME, the
                            one thing this title exists to show. Nothing needs the clip: the parent is
                            min-w-0 and the card has no fixed height. Disclosed phone delta (V-5): at
                            375px the title moves 24 -> 30 and wraps instead of ellipsising; the
                            primitive's wrap-anywhere base breaks an unbroken name, guarded at 375px
                            by e2e/padding-budget.spec.ts. Re-adding the clip is a decision, not a
                            cleanup. */}
                        <Heading level={1} size="display" className="text-content-primary">
                            {group ? `Plan Game Session - ${group.name}` : 'Plan Game Session'}
                        </Heading>
                        <p className="text-base text-content-secondary mt-1">
                            Send availability polls and manage responses
                        </p>
                    </div>
                </div>
            </div>

            {/* D-08: identity-resolution failure hides the self-role affordances
                (admin poll controls gated on userRole) — surface a compact,
                non-blocking degrade notice rather than fail silently (D-11). */}
            {/* DECISION Phase 88.6.1-16 (D-25, copy row G6; W060(i)): this compact notice now also
                tells a failed ROLE read, with the existing sentence (the shipped COMPACT_NOTICE, no
                new string). Before this, a failed members read was swallowed and every admin
                control simply vanished with no word to the user.
                ONE mount serves both causes, identity first: identity is the upstream failure and
                its Retry is the one that can restore both. Chosen OVER a second compact mount, which
                would add a second polite region and print the same sentence twice when both fail —
                and both can, because a failed identity refetch keeps its cached row, so the role
                read still runs.
                The role error is cleared only when a read SETTLES, chosen OVER the clear-at-start
                shape the group load uses, so the pressed Retry stays mounted with its in-flight
                label and the error state stays true through a failed retry.
                An unknown role is null — fail closed: the admin-gated controls hide while this
                notice says why. The role and its error are stamped with the group they were read
                for and DERIVED at render, chosen OVER resetting them in an effect or after the next
                read settles — both leave renders in which another group's role reaches the
                admin-gated controls.
                Newest wins: a read that settles after the page moved to another group, or after a
                newer role read started, writes nothing (no role, no error), chosen OVER dropping only
                on a group change — the hook's error-only refocus refetch can start a second read of
                the SAME group while a Retry is in flight, and the older answer landing last would
                put a stale failure (or a stale role) over a newer result. A superseded failure is
                still LOGGED before it is dropped (the house log-first order), chosen OVER dropping
                it silently, which would make an outage look smaller than it was.
                Every read RESOLVES its outcome — LOAD_OK, LOAD_FAILED, or nothing when it was
                skipped or superseded — because plan 88.6.1-21's banner tells a failed Retry (copy
                row B1, owner 2026-10-05) only from the retry's own result. Chosen OVER resolving
                nothing (what the read did first), which would leave this page re-speaking the
                first-failure sentence after every failed Retry and never saying "still"; a
                superseded read resolves nothing rather than a failure, so a stale answer is never
                reported as the outcome of the press.
                Changing this is a decision, not a cleanup.
                AMENDED Phase 88.6.1-63 (AC-29): identity counts as failed only with no row held;
                with a held row the role read runs and, if it fails, it is the failure this notice
                tells and the request its Retry repeats; the two can no longer show at once. */}
            <FetchErrorBanner state={personalControlsErrorState} compact />

            {/* A failed GROUP load — the page keeps its generic "Plan Game Session" title and the
                poll tooling below still works, so this is a banner rather than a dead-end page. */}
            {groupErrorState.showError && (
                <div className="mb-6">
                    <FetchErrorBanner
                        state={groupErrorState}
                        title="We couldn't load this group"
                        reportContext="Group planning page — group details fetch"
                    />
                </div>
            )}

            {/* Availability Polls + Response Dashboard in one card */}
            <div className="card p-3 md:p-6 mb-6">
                <Heading
                    ref={availabilityPollsHeadingRef}
                    tabIndex={-1}
                    level={2}
                    size="heading"
                    className="text-content-primary mb-4"
                >
                    Availability Polls
                </Heading>
                <div className="bg-surface-page rounded-lg surface-flat-phone md:p-4">
                    <PromptScheduleSection
                        groupId={groupId}
                        group={group}
                        userRole={userRole}
                        currentUserDbId={selfUuid}
                        defaultExpanded={true}
                        selectedPollId={selectedPollId}
                        onSelectPoll={handleSelectPoll}
                        onPollClosed={handlePollClosed}
                    />

                    {/* Response Dashboard */}
                    {/* DECISION quick-261026-pi6-fix (F10, WCAG 4.1.3): a swap is told to screen
                        readers by ONE always-mounted polite region (empty first, the StatusRegion
                        contract), OVER a live attribute on the Showing line, which re-renders on
                        every swap and would also speak the first load; the wrapper is aria-busy
                        and the Showing line reads Loading while a selected poll is on the network.
                        Changing this is a decision, not a cleanup. */}
                    <div
                        ref={dashboardRef}
                        aria-busy={swapPending ? 'true' : undefined}
                        className="mt-4 pt-4 border-t border-line scroll-mt-20"
                    >
                        <StatusRegion
                            message={selectionStatus}
                            className="sr-only"
                            data-testid="poll-selection-status"
                        />
                        {heatmapLoading ? (
                            <p className="text-center text-content-secondary py-4">{POLL_DATA_LOADING_LABEL}</p>
                        ) : heatmapErrorState.showError ? (
                            /* DECISION Phase 88-25 (Req 14 / T-88-25-01): the poll-data failure gets the
                               shared error treatment with a retry, checked BEFORE the "no active poll"
                               branch below. Ordering is load-bearing: a failed request also leaves
                               `heatmapPrompt` null, so flipping these branches tells someone whose
                               request merely failed that their group has no poll running. This node
                               previously rendered `err.message` verbatim — a raw upstream string in the
                               DOM (ASVS V7). */
                            <div className="py-4">
                                <FetchErrorBanner
                                    state={heatmapErrorState}
                                    title="We couldn't load the poll responses"
                                    reportContext="Group planning page — availability poll fetch"
                                />
                            </div>
                        ) : heatmapPrompt ? (
                            <>
                                <Heading
                                    ref={pollResponsesHeadingRef}
                                    tabIndex={-1}
                                    level={3}
                                    size="heading"
                                    className="text-content-primary mb-1 scroll-mt-20"
                                >
                                    Poll Responses
                                </Heading>
                                <p className="text-sm text-content-secondary mb-3">
                                    {swapPending ? (
                                        pendingPollName ? (
                                            <>Loading <span className="text-content-primary">{pendingPollName}</span>…</>
                                        ) : POLL_DATA_LOADING_LABEL
                                    ) : (
                                        <>{SHOWING_LABEL} <span className="text-content-primary">{shownPollName}</span></>
                                    )}
                                </p>
                                {/* DECISION quick-261026-pi6 (owner R3, 2026-10-26): the chips render only at
                                    two or more open polls, OVER always (with one poll a chip changes
                                    nothing); they read the open-polls cache through the shared key, OVER a
                                    fetch or a prop chain of their own (one request, Phase 84 PRIM-07); they
                                    wear the pressed-chip idiom of
                                    src/app/components/GroupLibrary.js ("DECISION Phase 88.6.1-48 (D-21 / D-44)")
                                    and wrap instead of scrolling sideways, OVER the brief's link-colour fill
                                    (white text on the dark theme's amber link colour fails contrast); a chip
                                    swaps in place without scrolling, and a card tap scrolls to and focuses
                                    the Poll Responses heading (instantly under reduced motion, read once at
                                    the tap OVER a subscription that would re-render the page for a value read
                                    only then; an explicit smooth scroll overrides the global CSS rule), which
                                    clears the sticky header,
                                    src/app/Header.js ("h-16 bg-surface-header border-b border-line-strong sticky top-0 z-50");
                                    if a failed swap removes the control a person stood on, focus goes to the
                                    Availability Polls heading. Changing any of this is a decision, not a
                                    cleanup. */}
                                {openPolls.length >= 2 && (
                                    <div role="group" aria-label={SWITCH_POLL_LABEL} className="mb-3 flex flex-wrap gap-2">
                                        {openPolls.map((p) => {
                                            const pressed = p.id === selectedPollId;
                                            return (
                                                <button
                                                    key={p.id}
                                                    type="button"
                                                    aria-pressed={pressed}
                                                    onClick={(event) => handleChipSelect(event, p.id)}
                                                    className={pressed
                                                        ? 'max-w-full px-3 py-1 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-full text-sm font-bold active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 bg-btn-primary text-btn-primary-text'
                                                        : 'max-w-full px-3 py-1 min-h-11 md:min-h-0 min-w-11 md:min-w-0 rounded-full text-sm font-bold active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 bg-surface-muted text-content-secondary hover:text-content-primary'}
                                                >
                                                    <span className="block truncate">{chipLabels.get(p.id)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                )}
                                <ResponseDashboard
                                    promptId={heatmapPrompt.id}
                                    isAdmin={isAdmin}
                                    currentUserId={selfUuid}
                                    blindVotingEnabled={heatmapPrompt.blind_voting_enabled}
                                    pollClosed={pollClosed}
                                />
                            </>
                        ) : (
                            <p className="text-center text-content-muted py-4">
                                No active availability poll found. Use the schedule manager above to send one.
                            </p>
                        )}
                    </div>
                </div>
            </div>

            {/* Create Event Modal — Phase 71.2 wires the email-CTA prefill
                query params (group_id, prompt_id, prefillDate, prefillTime,
                prefillDuration, prefillGameId) through to createEvent.js.
                createEvent already accepts these props; we just need to
                forward them. The modal auto-opens when prefillDate+Time are
                present (see useEffect above). */}
            {/* DECISION Phase 88.6.1-68 (one close owner): chosen — this page passes CreateEvent no
                created-callback; the dialog's close after a create is CreateEvent's own modaltoggle()
                alone (plan 88.6.1-81 calls it only while the press's session is open), and it still
                runs toggleEventModal, so the Phase 71.2 email-link parameters are still cleared on
                that close. REJECTED — the host closing it too (what shipped: a second call to a TRUE
                toggle, safe only because both calls ran from closures captured while the dialog was
                open — a call from a fresh closure reopens it — and a host-side close cannot tell a
                late success from the current one, the case that reopened dialogs at the other
                hosts). Nothing on this page renders events (plan 16), so the callback had no other
                job; this page's dialog opens only from the email link, so no late-success reopen is
                reachable here today — the change makes all five mounts follow one rule. Re-adding a
                callback that closes is a decision, not a cleanup. */}
            <CreateEvent
                group_id={groupId}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                user={user}
                // Phase 71.2 / Plan 03 hotfix — when arriving via the email CTA
                // (prompt_id present), surface the visual heatmap so the user
                // can pick from the poll's response data. Other entry points
                // into groupPlanning's CreateEvent stay heatmap-hidden.
                hideVisualCalendar={!promptId}
                // DECISION quick-261026-pi6-fix (F5): the dialog still receives the link's
                // prompt_id as it is, OVER passing only a same-group poll, because the dialog's
                // own heatmap read is membership-gated by the backend and the link can only be
                // self-made. The residual (a member of both groups can open group B's poll heatmap
                // inside group A's dialog through a link they built) is reported to the owner, not
                // fixed here. Changing this is a decision, not a cleanup.
                promptId={promptId}
                prefillDate={prefillDate}
                prefillTime={prefillTime}
                prefillDuration={prefillDuration ? Number(prefillDuration) : null}
                prefillGameId={prefillGameId}
            />
        </div>
    );
}
