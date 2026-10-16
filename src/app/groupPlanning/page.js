'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { groupsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import ResponseDashboard from '../components/ResponseDashboard';
import PromptScheduleSection from '../components/PromptScheduleSection';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '../../lib/logger';

// The role read's resolved outcome: the shape plan 88.6.1-21's banner reads from a retry's own
// result to tell a failed Retry (copy row B1). `undefined` means unknown (skipped or superseded).
const LOAD_OK = Object.freeze({ isError: false });
const LOAD_FAILED = Object.freeze({ isError: true });

// Copy row G5 (D-30): byte-equal to the route fallback label (groupPlanning/loading.tsx), so the
// wording does not change when the route boundary hands over to the page.
const AUTH_LOADING_MESSAGE = "Getting your group's plans...";

export default function GroupPlanningPage() {
    const { user, isLoading: authLoading } = Auth();
    // Phase 87.3-05 (D-02): resolve the caller's own Users.id UUID via the
    // shared identity primitive, collapsing the former per-page usersAPI
    // self-fetch (getUser by sub). selfUuid feeds the self-role derive
    // (UUID vs nested member.id) and PromptScheduleSection's currentUserDbId.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const searchParams = useSearchParams();
    const router = useRouter();
    const pathname = usePathname();
    const groupId = searchParams.get('group_id');
    const promptId = searchParams.get('prompt_id');

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
    // The caller's role, stamped with the group it was read for. `userRole` / `roleError` are
    // DERIVED at render and read null for any other group, so the render in which `groupId`
    // changes already passes null to the gated controls (DECISION Phase 88.6.1-16 at the compact
    // notice below).
    const [roleRecord, setRoleRecord] = useState({ groupId: null, role: null, error: null });
    const userRole = roleRecord.groupId === groupId ? roleRecord.role : null;
    const roleError = roleRecord.groupId === groupId ? roleRecord.error : null;
    const groupIdRef = useRef(groupId);
    const roleRunRef = useRef(0);

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

    const fetchHeatmapData = async () => {
        if (!groupId) return;
        setHeatmapLoading(true);
        setHeatmapError(null);
        try {
            let prompt;
            if (promptId) {
                // Navigating from a no-consensus email -- load specific prompt by ID
                const data = await promptAPI.getPromptById(promptId);
                prompt = data.prompt;
            } else {
                const data = await promptAPI.getActivePrompt(groupId);
                prompt = data.prompt;
            }
            setHeatmapPrompt(prompt);
        } catch (err) {
            // Keep the ERROR object, not `err.message`: the raw upstream string used to be
            // painted straight into the page below (T-88-25-01 / ASVS V7). The hook derives
            // designed copy from `ApiError.code` instead.
            setHeatmapError(err instanceof Error ? err : new Error("The poll request didn't complete."));
        } finally {
            setHeatmapLoading(false);
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
        }
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
    useEffect(() => {
        fetchGroupRef.current = fetchGroup;
        fetchHeatmapRef.current = fetchHeatmapData;
        fetchUserRoleRef.current = fetchUserRole;
        groupIdRef.current = groupId;
    });
    const retryGroup = useCallback(() => fetchGroupRef.current?.(), []);
    const retryHeatmap = useCallback(() => fetchHeatmapRef.current?.(), []);
    const retryRole = useCallback(() => fetchUserRoleRef.current?.(), []);

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

    const handleEventCreated = (newEvent) => {
        toggleEventModal();
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
                            (88.6-15-PLAN.md:122-131, applied at GroupGamesList.js): clipping is kept
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
                Changing this is a decision, not a cleanup. */}
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
                <Heading level={2} size="heading" className="text-content-primary mb-4">Availability Polls</Heading>
                <div className="bg-surface-page rounded-lg surface-flat-phone md:p-4">
                    <PromptScheduleSection
                        groupId={groupId}
                        group={group}
                        userRole={userRole}
                        currentUserDbId={selfUuid}
                        defaultExpanded={true}
                    />

                    {/* Response Dashboard */}
                    <div className="mt-4 pt-4 border-t border-line">
                        {heatmapLoading ? (
                            <p className="text-center text-content-secondary py-4">Loading poll data...</p>
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
                                <Heading level={3} size="heading" className="text-content-primary mb-3">Poll Responses</Heading>
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
            <CreateEvent
                group_id={groupId}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                onEventCreated={handleEventCreated}
                user={user}
                // Phase 71.2 / Plan 03 hotfix — when arriving via the email CTA
                // (prompt_id present), surface the visual heatmap so the user
                // can pick from the poll's response data. Other entry points
                // into groupPlanning's CreateEvent stay heatmap-hidden.
                hideVisualCalendar={!promptId}
                promptId={promptId}
                prefillDate={prefillDate}
                prefillTime={prefillTime}
                prefillDuration={prefillDuration ? Number(prefillDuration) : null}
                prefillGameId={prefillGameId}
            />
        </div>
    );
}
