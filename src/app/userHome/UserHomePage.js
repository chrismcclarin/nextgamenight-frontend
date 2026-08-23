'use client';
import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import GroupList from '../components/grouplist';
import EventCalendar from '../components/EventCalendar';
import FriendInvitePanel from '../components/FriendInvitePanel';
import UpcomingEventsCard from '../components/UpcomingEventsCard';
// Req 11a (88.1-08): the phone-only Upcoming Events surface — a bottom bar plus
// the bottom sheet it opens. The desktop right column below is untouched.
import PhoneEventBar from '../components/PhoneEventBar';
// Req 11b (88.1-10): the phone calendar surface hosts the BARE list view — see
// the DECISION marker at its mount for why it is not the calendar component.
import CalendarListView from '../components/CalendarListView';
import { BottomSheet } from '../../components/ui/BottomSheet';
import { Button } from '../../components/ui/Button';
import { Icon } from '../../components/ui/Icon';
import { eventsAPI } from '../../lib/api';
// Phase 87.3-07 (D-02): the viewer's User.id UUID resolves via the shared
// ['users','self'] query instead of an ad-hoc getUser self-fetch.
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
// ML-17 (87.5 review): WR-03 identity-failure degrade for the upcoming-events
// zone — without it, terminal identity failure renders a lying "no upcoming
// events" empty state (its siblings grouplist/EventCalendar already degrade).
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

// List of all the groups for the logged in User
function UserHome({ GroupList: propGroupList, getGroupList, onCreateGroup, groupListRefreshKey, onMemberAdded: onMemberAddedProp }) {
    const { user } = Auth();
    const router = useRouter();
    const searchParams = useSearchParams();
    // Phase 71.1 GAMP-07: viewer's User.id UUID (NOT Auth0 string), used by
    // UpcomingEventsCard to match EventParticipations rows for game-only-event
    // Guest-pill distinction. Phase 87.3-07 (D-02): resolved via the shared
    // ['users','self'] query instead of a per-page getUser self-fetch.
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [invitePanelOpen, setInvitePanelOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [upcomingEvents, setUpcomingEvents] = useState([]);
    const [upcomingLoading, setUpcomingLoading] = useState(false);
    /* DECISION Phase 88-18 (Req 6 / T-88-18-01): the getUserEvents failure is tracked instead of
       being left in the `console.error` it used to stop at. The unhandled rejection left
       `upcomingEvents` at [], so UpcomingEventsCard rendered its empty state — telling someone
       their calendar was clear when the request had failed. This is NOT the same as
       `selfIdentityErrorState` a few lines up (ML-17), which covers the case where the fetch never
       fires at all; both are needed and they are checked in that order at the render site. */
    const [upcomingError, setUpcomingError] = useState(null);
    const [upcomingRetryKey, setUpcomingRetryKey] = useState(0);
    // Req 11a: the phone sheet's open state. The page owns it because the bar
    // (the invoker) and the sheet are siblings, not parent/child.
    const [upcomingSheetOpen, setUpcomingSheetOpen] = useState(false);
    // Req 11b: the phone calendar sheet's open state, owned here for the same
    // reason as the 11a sheet above — the button and the sheet are siblings.
    const [calendarSheetOpen, setCalendarSheetOpen] = useState(false);

    // GROUP-05 (display half): show soft acknowledgment banner when arriving from
    // a 403 redirect set by Plan 69-04 (router.push('/?removedFrom=...')).
    const removedFromName = searchParams?.get('removedFrom') || null;
    const [removedBannerVisible, setRemovedBannerVisible] = useState(false);
    useEffect(() => {
        if (removedFromName) setRemovedBannerVisible(true);
    }, [removedFromName]);

    // Phase 71.1 GAMP-07: fetch upcoming events for the user.
    // GET /events/user/:user_id was UNIONed in Plan 71.1-01 to include
    // EventParticipation events (game-only). Re-runs when refreshKey changes
    // (mirrors the existing EventCalendar refresh pattern).
    useEffect(() => {
        // Mount-fire gate: wait for the caller's own Users.id UUID. selfUuid is
        // in the dep array (async-resolution rule) so the fetch fires once
        // identity resolves, not only at initial mount.
        if (!selfUuid) return;
        let cancelled = false;
        setUpcomingLoading(true);
        setUpcomingError(null);
        eventsAPI.getUserEvents(selfUuid).then(evts => {
            if (cancelled) return;
            const list = Array.isArray(evts) ? evts : [];
            // UpcomingEventsCard does its own filter+sort; pass the raw list.
            setUpcomingEvents(list);
        }).catch(err => {
            console.error('[UserHomePage] The upcoming-events request did not complete:', err);
            if (cancelled) return;
            // Keep the ERROR object: useFetchErrorState reads `ApiError.code` off
            // it to pick the right user-facing copy.
            setUpcomingError(
                err instanceof Error ? err : new Error("The upcoming-events request didn't complete.")
            );
        }).finally(() => {
            if (!cancelled) setUpcomingLoading(false);
        });
        return () => { cancelled = true; };
    }, [user?.sub, refreshKey, selfUuid, upcomingRetryKey]);

    // Adapter onto the shared fetch-error pair (88-14 friends pattern): the hook
    // documents that it reads ONLY isError/error/refetch (useFetchErrorState.ts:89),
    // and `retry` must be stable — it sits in a useCallback dep AND in the hook's
    // refocus-recovery effect deps. Bumping the key re-runs the effect above rather
    // than duplicating the fetch body.
    const upcomingRetryRef = useRef(null);
    upcomingRetryRef.current = () => setUpcomingRetryKey(k => k + 1);
    const retryUpcoming = useCallback(() => {
        upcomingRetryRef.current?.();
        return Promise.resolve();
    }, []);
    const upcomingErrorState = useFetchErrorState({
        isError: Boolean(upcomingError),
        error: upcomingError,
        refetch: retryUpcoming,
    });

    /* DECISION Phase 88-33 Task 1 (M2, walk 2026-08-13 test 9): an UNRESOLVED identity counts as
       an in-flight upcoming-events load, chosen OVER passing the raw `upcomingLoading` (the
       shipped shape) and OVER giving the card its own identity awareness.

       THE BUG THIS FIXES: `upcomingLoading` initialises to false and the fetch effect above
       early-returns at `if (!selfUuid) return;` BEFORE it ever calls setUpcomingLoading(true) —
       so for the whole identity-resolution window the card was handed
       `loading=false, events=[], showError=false` and rendered "Nothing on the calendar" at
       someone whose calendar had not been fetched at all. With the backend up that lie lasts a
       few hundred ms; with it unreachable the window is ~60s (two BFF proxy attempts, each
       bounded by PROXY_TIMEOUT_MS=30_000 in app/api/[...path]/route.ts, plus shouldRetry's one
       retry) — the walk's "60+s". Same class as grouplist's WR-03 stuck spinner, one state over:
       that one HUNG on terminal failure, this one LIED while pending.

       ML-17's terminal branch below is deliberately checked FIRST and is unaffected: a resolved
       identity FAILURE degrades to the banner, an unresolved identity reads as loading. Passing
       `upcomingLoading` back in is a decision to restore the lie, not a simplification. */
    const upcomingPending = upcomingLoading || (!selfUuid && !selfIdentityErrorState.showError);

    /* Req 11b event tap. The CLOSE ORDERING IS THE POINT and is not incidental style:
       `setCalendarSheetOpen(false)` runs on the line BEFORE `router.push`, copying
       `EventCalendar.js:241-243` (`setSelectedDay(null)` then `onEmptyDayClick(dateStr)`).

       Chosen OVER the navigate-then-close order that its own sibling handler eleven lines up
       (`EventCalendar.js:233-236`) ships. Navigating first leaves an open Radix dialog — overlay,
       focus trap and all — mounted across the route transition, so the destination page renders
       behind a scrim the person has to dismiss before they can use it. Reversing these two lines
       is a decision, not a tidy-up. (That the two shipped calendar handlers disagree with each
       other is a real divergence; resolving it is NOT this phase's job and is recorded in this
       plan's SUMMARY instead of being fixed here.)

       The destination logic mirrors `EventCalendar.js:94-101` so a tap from the phone sheet and a
       tap from the desktop calendar land on the same screen: a FUTURE event (or one with no game)
       opens by event id, a past event with a game opens by game id. */
    const handleCalendarSheetEventClick = (event) => {
        setCalendarSheetOpen(false);
        const isFutureEvent = event?.start_date && new Date(event.start_date) >= new Date();
        if (isFutureEvent || !event?.game_id) {
            router.push(`/gameDetail?event_id=${event?.id}&group_id=${event?.group_id}`);
        } else {
            router.push(`/gameDetail?game_id=${event.game_id}&group_id=${event.group_id}`);
        }
    };

    const handleGroupSelect = (group) => {
        setSelectedGroup(group);
        setInvitePanelOpen(true);
    };

    const handleCreateGroup = () => {
        // This is handled by the parent component (page.js)
        if (onCreateGroup) {
            onCreateGroup();
        }
    };

    const handleMemberAdded = () => {
        if (getGroupList) {
            getGroupList();
        }
        if (onMemberAddedProp) {
            onMemberAddedProp();
        }
    };

    const handleGroupSettingsUpdated = () => {
        // Trigger refresh of both group list and calendar
        if (getGroupList) {
            getGroupList();
        }
        setRefreshKey(prev => prev + 1); // Increment to trigger calendar refresh
    };

    return (
        /* Req 11a bottom clearance for THIS page's own content: `pb-14` (56px) below `md`
           clears the fixed bar. The desktop override is `md:pb-6` and must NEVER be zeroed:
           Tailwind emits `padding-bottom` utilities AFTER the `md:p-6` shorthand, so a
           zeroed desktop bottom-padding override would win the cascade
           and silently drop desktop bottom padding from 1.5rem to 0, contradicting this
           plan's own "at >=768px the layout is pixel-identical" acceptance with no gate to
           catch it (padding-budget.spec.ts is phone-only). The FOOTER's clearance is a
           separate problem solved in Footer.js — Footer is a sibling of <main>, so no amount
           of padding here can reach it. */
        <div className="user-home-container p-4 md:p-6 pb-14 md:pb-6">
            {removedBannerVisible && removedFromName && (
                <div
                    role="status"
                    className="mb-4 px-4 py-3 rounded-card bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800/50 text-amber-900 dark:text-amber-100 flex items-center justify-between gap-3"
                >
                    <span className="text-sm">
                        You&apos;re no longer a member of <strong>{removedFromName}</strong>.
                    </span>
                    <button
                        onClick={() => setRemovedBannerVisible(false)}
                        className="text-amber-700 dark:text-amber-200 hover:underline text-xs shrink-0"
                        aria-label="Dismiss"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                {/* Req 11b (UI-SPEC S4): the phone-only entry point to the calendar, above the
                    group list. It lives HERE and not inside `grouplist.js`, because desktop
                    renders that component too and its header already carries a CTA.

                    DECISION Phase 88.1 (plan 10, Req 11b): `variant="secondary"`, chosen OVER
                    `variant="primary"`. UI-SPEC's one-anchor rule gives a 375px viewport exactly
                    one accent element, and this page already spends it on "+ Create New Group"
                    (`grouplist.js:133,177`) — a second accent here makes the page fail the rule.
                    "Making it stand out more" re-opens that rule. The explicit `min-h-11 min-w-11`
                    pair is the 44px touch floor in BOTH dimensions: `.btn`'s phone floor (88-01
                    D-36) sets height only, so a narrow control would pass at full height and still
                    fail R4. */}
                <div className="md:hidden">
                    <Button
                        variant="secondary"
                        onClick={() => setCalendarSheetOpen(true)}
                        aria-haspopup="dialog"
                        className="min-h-11 min-w-11 gap-2"
                    >
                        {/* Decorative — the visible label below is the accessible name. */}
                        <Icon name="CalendarDays" size={20} />
                        Calendar
                    </Button>
                </div>

                <div className="w-full md:w-auto md:shrink-0 md:flex-[0_0_400px] md:relative">
                    <div className="md:absolute md:inset-0">
                    <GroupList
                        onGroupSelect={handleGroupSelect}
                        onCreateGroup={handleCreateGroup}
                        user={user}
                        onGroupSettingsUpdated={handleGroupSettingsUpdated}
                        refreshTrigger={groupListRefreshKey}
                    />
                    </div>
                </div>

                {/* Hide calendar on mobile (smaller than md breakpoint).
                    Phase 71.1 GAMP-07: UpcomingEventsCard mounts below the
                    calendar in the right column with viewerDbUserId so
                    game-only events render with a dashed border + Guest pill. */}
                <div className="hidden md:flex md:flex-col md:flex-1 md:min-w-0 md:gap-4">
                    <EventCalendar refreshKey={refreshKey} />
                    {/* ML-17: the upcoming-events fetch gates on selfUuid, so on
                        TERMINAL identity failure it never fires — degrade with the
                        compact banner instead of the misleading empty state. */}
                    {selfIdentityErrorState.showError ? (
                        <FetchErrorBanner state={selfIdentityErrorState} compact />
                    ) : (
                        /* DECISION Phase 88-18 (Req 6, UI-SPEC 9.2): NO `action` is passed, so this
                           card's empty state ships without the contract row's "Plan Game Session"
                           CTA. That omission is deliberate, not an oversight. Every planning route
                           needs a group: `groupPlanning/page.js:59-68` gates fetchGroup /
                           fetchGroupEvents / fetchHeatmapData / fetchUserRole on `groupId` (guard at
                           :60, and each of those four self-gates on `!groupId` as well), and the
                           two shipped "Plan Game Session" entry points
                           (`groupHomePage/page.js:420` and the groupPlanning breadcrumb) both carry
                           `?group_id=`. UserHome has no group in scope — the group list to the left
                           fetches its own — so a CTA here could only link to a group-less
                           groupPlanning page that renders empty sections. The body copy carries the
                           next step instead. If a group picker ever lands on this surface, pass the
                           CTA in as `action` — do NOT wire a bare /groupPlanning link. Raised with
                           the owner at 88-18's checkpoint. */
                        <UpcomingEventsCard
                            events={upcomingEvents}
                            loading={upcomingPending}
                            showGroupName={true}
                            viewerDbUserId={selfUuid ?? null}
                            errorState={upcomingErrorState}
                        />
                    )}
                </div>
            </div>

            {/* Req 11a (UI-SPEC S3): the phone-only Upcoming Events surface. `PhoneEventBar`
                carries its own `md:hidden` gate on its root, so the viewport gate lives with
                the element it hides. The sheet deliberately does NOT carry one: `BottomSheet`
                portals to <body>, so a hidden wrapper would not reach it anyway, and hiding an
                OPEN Radix dialog's content leaves a visible overlay plus a focus trap on
                invisible content. It can only ever be opened by the bar, which is phone-only.

                The bar is wired to the SAME pending/error values the desktop card gets. That
                wiring is load-bearing, not boilerplate: per DECISION Phase 88-33 below, the
                identity-resolution window is indistinguishable from a truthful zero unless the
                caller tells the bar which one it is. Dropping `pending` here makes the bar
                claim "none in the next 7 days" before the fetch has fired. */}
            <PhoneEventBar
                events={upcomingEvents}
                pending={upcomingPending}
                identityErrorState={selfIdentityErrorState}
                eventsErrorState={upcomingErrorState}
                onOpen={() => setUpcomingSheetOpen(true)}
            />
            <BottomSheet
                open={upcomingSheetOpen}
                onClose={() => setUpcomingSheetOpen(false)}
                /* Matches the bar's visible label so the tap has an obvious destination. */
                title="Upcoming events"
                height="content"
            >
                {/* ML-17, re-hosted verbatim: the upcoming-events fetch gates on selfUuid, so
                    on TERMINAL identity failure it never fires — degrade with the compact
                    banner instead of the misleading empty state. Checked FIRST, exactly as in
                    the desktop column; flipping this with the card's own branches silently
                    restores a shipped bug (DECISION Phase 88-18, UpcomingEventsCard.js:154-160). */}
                {selfIdentityErrorState.showError ? (
                    <FetchErrorBanner state={selfIdentityErrorState} compact />
                ) : (
                    /* DECISION Phase 88-18, CARRIED INTO THE SHEET (Req 11a): like the desktop
                       call site above, this card is deliberately given NO CTA prop, so its empty
                       state ships without the contract row's "Plan Game Session" button. Every
                       planning route needs a group_id (`groupPlanning/page.js:59-68`) and
                       UserHome has none in scope, so a CTA here could only link to a group-less
                       groupPlanning page that renders empty sections. Do NOT "complete" this by
                       wiring a bare /groupPlanning link — if a group picker ever lands on this
                       surface, pass the CTA in from here. */
                    <UpcomingEventsCard
                        events={upcomingEvents}
                        loading={upcomingPending}
                        showGroupName={true}
                        viewerDbUserId={selfUuid ?? null}
                        errorState={upcomingErrorState}
                    />
                )}
            </BottomSheet>

            {/* Req 11b (UI-SPEC S4): the phone calendar sheet.

                DECISION Phase 88.1 (plan 10, D-06) — FOUR choices are recorded here, three of
                them owner-accepted cons that would otherwise read as oversights:

                1. IT HOSTS THE BARE LIST VIEW, chosen OVER mounting the calendar component that
                   the desktop column mounts. The calendar persists its view preference through a
                   `saveCalendarPrefs(scope, …)` effect that fires ON MOUNT
                   (`EventCalendar.js:64-66`), so a SECOND mount at the same `scope='home'` would
                   silently overwrite the user's saved desktop view (month vs list, and the month
                   they were looking at) every time this phone sheet rendered. "Simplifying" this
                   into a second calendar mount is the pitfall, not the cleanup.

                2. ERROR AND EMPTY ARE WIRED BY HAND, in that ORDER, because the bare list view
                   does not bring the calendar's built-in WR-03 banner along with it. Identity
                   failure first (ML-17), then the events-fetch failure, then the list. An errored
                   fetch ALSO has zero events, so flipping any of these branches shows "No events"
                   at someone whose request failed — the exact `DECISION Phase 88-18` bug in a new
                   host (T-88.1-27).

                3. PHONE ROWS CARRY NO RSVP COUNTS, BY CONSTRUCTION. This page's fetch omits
                   `includeRsvpSummary` (the calendar's own fetch sets it), so the counts would be
                   empty if shown. Inert today because the row's RSVP block is md-gated and this
                   sheet is phone-only — un-gating one without the other is what makes it visible.

                4. THERE IS NO MONTH/LIST TOGGLE INSIDE THE SHEET. Its only destination at 375px is
                   the ~49px-per-cell month grid that truncates game names to 3-5 characters, which
                   is the rendering Req 11b exists to avoid.

                Two mount paths for the list view now exist — desktop through the calendar
                component, phone through this sheet. That is accepted, not accidental.

                Like the 11a sheet above, this mount deliberately carries NO `md:hidden`: it
                portals to <body>, and hiding an OPEN dialog's content leaves a visible overlay
                plus a focus trap on invisible content. The BUTTON carries the viewport gate. */}
            <BottomSheet
                open={calendarSheetOpen}
                onClose={() => setCalendarSheetOpen(false)}
                /* Matches the button label so the tap has an obvious destination. */
                title="Calendar"
                height="full"
                /* The list view manages its own scroll region; the sheet body only
                   needs to hand it the full height to flex into. */
                bodyClassName="flex min-h-0 flex-col overflow-hidden"
            >
                {selfIdentityErrorState.showError ? (
                    <FetchErrorBanner state={selfIdentityErrorState} compact />
                ) : upcomingErrorState.showError ? (
                    <FetchErrorBanner
                        state={upcomingErrorState}
                        title="We couldn't load your calendar"
                        reportContext="Calendar sheet (home page, phone)"
                    />
                ) : (
                    <CalendarListView
                        events={upcomingEvents}
                        onEventClick={handleCalendarSheetEventClick}
                        loading={upcomingPending}
                        variant="sheet"
                    />
                )}
            </BottomSheet>

            <FriendInvitePanel
                group={selectedGroup}
                open={invitePanelOpen}
                onClose={() => setInvitePanelOpen(false)}
                onMemberAdded={handleMemberAdded}
            />
        </div>
    );
}

export default UserHome;
