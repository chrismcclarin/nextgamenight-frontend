'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { groupsAPI, eventsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import ResponseDashboard from '../components/ResponseDashboard';
import PromptScheduleSection from '../components/PromptScheduleSection';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

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
    const [groupEvents, setGroupEvents] = useState([]);

    // Modal state for CreateEvent. When the URL carries prefill params we
    // open the modal automatically so the user lands directly on the event
    // form (matches the email-CTA expected behavior).
    const [eventModal, setEventModal] = useState(false);

    // Heatmap/prompt state (needed for ResponseDashboard)
    const [heatmapPrompt, setHeatmapPrompt] = useState(null);
    const [heatmapLoading, setHeatmapLoading] = useState(true);
    const [heatmapError, setHeatmapError] = useState(null);
    const [userRole, setUserRole] = useState(null);

    useEffect(() => {
        if (!authLoading && !user) {
            const returnTo = encodeURIComponent(window.location.pathname + window.location.search);
            window.location.href = `/api/auth/login?returnTo=${returnTo}`;
        }
    }, [authLoading, user]);

    useEffect(() => {
        if (user?.sub && groupId) {
            fetchGroup();
            fetchGroupEvents();
            fetchHeatmapData();
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
                    console.error('Error fetching group members:', memberError);
                }
            }

            setGroup(groupData);
        } catch (error) {
            console.error('Error fetching group:', error);
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

    const fetchGroupEvents = async () => {
        if (!groupId) return;
        try {
            const events = await eventsAPI.getGroupEvents(groupId);
            setGroupEvents(events || []);
        } catch (error) {
            console.error('Error fetching group events:', error);
            setGroupEvents([]);
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
        if (!groupId || !user?.sub || !selfUuid) return;
        try {
            const members = await groupsAPI.getGroupMembers(groupId);
            const me = (members || []).find(m => m.id === selfUuid);
            if (me?.UserGroup?.role) {
                setUserRole(me.UserGroup.role);
            }
        } catch (err) {
            console.error('Error fetching user role:', err);
        }
    };

    /* Adapters onto the shared fetch-error pair, matching the shipped 88-14/88-18 shape
       (friends/page.js, grouplist.js, GroupLibrary.js): the hook documents that it reads ONLY
       `isError`/`error`/`refetch` (useFetchErrorState.ts). `refetch` must be STABLE — the hook
       puts it in a useCallback dep AND in its refocus-recovery effect deps, so handing it a fresh
       function each render would re-subscribe that listener on every render while erroring.
       These two fetches are re-declared per render (they close over groupId/promptId), hence the
       ref hop rather than a useCallback on the fetch itself. */
    const fetchGroupRef = useRef(null);
    const fetchHeatmapRef = useRef(null);
    useEffect(() => {
        fetchGroupRef.current = fetchGroup;
        fetchHeatmapRef.current = fetchHeatmapData;
    });
    const retryGroup = useCallback(() => fetchGroupRef.current?.(), []);
    const retryHeatmap = useCallback(() => fetchHeatmapRef.current?.(), []);

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
        // Refresh events after creation
        fetchGroupEvents();
    };

    if (!user) {
        return <div className="flex items-center justify-center min-h-screen text-content-secondary">
            {authLoading ? 'Loading...' : 'Redirecting to login...'}
        </div>;
    }

    if (!groupId) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <p className="text-status-error">No group specified. Please navigate from a group page.</p>
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
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                <span className="text-content-muted mx-2">{'>'}</span>
                {group && (
                    <>
                        <Link href={`/groupHomePage?id=${groupId}`} className="text-content-link hover:text-content-link-hover transition-colors font-medium max-w-[200px] truncate inline-block align-bottom">
                            {group.name}
                        </Link>
                        <span className="text-content-muted mx-2">{'>'}</span>
                    </>
                )}
                <span className="text-content-primary font-semibold">Plan Game Session</span>
            </nav>

            {/* Header */}
            <div className="card p-3 md:p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="text-2xl md:text-3xl font-bold text-content-primary truncate">
                            {group ? `Plan Game Session - ${group.name}` : 'Plan Game Session'}
                        </h1>
                        <p className="text-sm text-content-secondary mt-1">
                            Send availability polls and manage responses
                        </p>
                    </div>
                </div>
            </div>

            {/* D-08: identity-resolution failure hides the self-role affordances
                (admin poll controls gated on userRole) — surface a compact,
                non-blocking degrade notice rather than fail silently (D-11). */}
            <FetchErrorBanner state={selfIdentityErrorState} compact />

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
                <h2 className="text-xl font-bold text-content-primary mb-4">Availability Polls</h2>
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
                                <h3 className="text-lg font-semibold text-content-primary mb-3">Poll Responses</h3>
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
                onEventCreated={(newEvent) => {
                    handleEventCreated(newEvent);
                    fetchGroupEvents();
                }}
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
