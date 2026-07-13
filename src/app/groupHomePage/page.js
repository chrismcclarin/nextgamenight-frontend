'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import CreateEvent from '../components/createEvent';
import ManageMembers from '../components/ManageMembers';
import { listsAPI, groupsAPI, eventsAPI, API_BASE_URL } from '../../lib/api';
import GroupGamesList from '../components/GroupGamesList';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { getTextStyle, getSubtitleStyle } from '../../lib/colorUtils';
import SafeImage from '../components/SafeImage';
import EventCalendar from '../components/EventCalendar';
import PendingMemberBanner from '../components/PendingMemberBanner';
import GroupLibrary from '../components/GroupLibrary';
import KebabMenu from '../components/KebabMenu';
import GroupSettings from '../components/GroupSettings';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

// A groups home page
function GroupHomePage(){
    const { user } = Auth();
    const router = useRouter();
    // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID via the
    // shared identity primitive. The membership/removal gate keys on the nested
    // member.id (UUID) vs selfUuid. CRITICAL: selfUuid resolves ASYNC, so the
    // removal redirect must NOT run until identity resolves — an unresolved
    // selfUuid makes the find miss and would bounce an active member off their
    // own group. Identity-unresolved is a LOADING state, never "removed".
    const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const [Group, setGroup] = useState(null);
    const [UserList, setUserList] = useState(null);
    const [gamesList, setGamesList] = useState([]);
    const [eventModal, setEventModal] = useState(false);
    const [memberModal, setMemberModal] = useState(false);
    const [showGroupSettings, setShowGroupSettings] = useState(false);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [activeTab, setActiveTab] = useState('home');
    // Phase 69-04 paint gate: blocks page render until the membership check
    // resolves. Without this, getGroup()/games/events fetches race the
    // membership lookup and the page paints with partial data before the
    // redirect fires for removed users.
    const [membershipChecked, setMembershipChecked] = useState(false);

    // Calendar state
    const [groupEvents, setGroupEvents] = useState([]);
    const [calendarPrefillDate, setCalendarPrefillDate] = useState(null);
    // CAL-05: track the visual entry mode for the create-event modal.
    // 'day' is set when the user taps an empty day cell or the modal's
    // "+ New event on this day" button — the EventScheduler then opens
    // in react-big-calendar's day view focused on the tapped date.
    // The "Add New Game Event" header button leaves this at 'week'.
    const [calendarEntryMode, setCalendarEntryMode] = useState('week');
    // Defensive cache-bust key — bumped after a fresh fetch so EventCalendar
    // re-renders even if React batches/dedupes the state update by accident.
    // Mirrors the pattern already used in UserHomePage.
    const [eventsRefreshKey, setEventsRefreshKey] = useState(0);

    const searchParams = useSearchParams();
    const Router = searchParams.get('id');
    const prefillDate = searchParams.get('date');
    const prefillTime = searchParams.get('time');
    const shouldCreateEvent = searchParams.get('create_event') === 'true';

    // GROUP-05 (Plan 69-04): detect "user is no longer a member" signals and
    // redirect to the home banner consumer at `/?removedFrom=<name>`.
    //
    // apiFetch (src/lib/api.js) throws Error(message) only — there's no
    // exposed `.status`, so we match on common 403/404/membership phrases.
    // Defensive: also accepts a `.status` field if a future helper exposes it.
    const isRemovedFromGroupError = (error) => {
        const status = error?.status || error?.response?.status;
        if (status === 403 || status === 404) return true;
        const msg = (error?.message || '').toLowerCase();
        return (
            msg.includes('not a member') ||
            msg.includes('forbidden') ||
            msg.includes('access denied') ||
            msg.includes('403') ||
            msg.includes('404') ||
            msg.includes('group not found')
        );
    };

    const redirectToHomeAsRemoved = (groupName) => {
        const name = groupName || Group?.name || 'this group';
        router.push(`/?removedFrom=${encodeURIComponent(name)}`);
    };

    const getGroup = async () => {
        if (!Router) return;
        try {
            // Use groupsAPI.getGroup which automatically includes Authorization header
            const data = await groupsAPI.getGroup(Router);
            setGroup(data);
        } catch (error) {
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            console.error('Error fetching group:', error);
        }
    };

    const getGroupMembers = async () => {
        // Gate the membership derive on identity resolution. Until selfUuid is
        // resolved the find below would miss and the redirect-as-removed branch
        // would fire on an active member — so we wait. membershipChecked stays
        // false (page shows "Loading group…"); when selfUuid resolves the effect
        // re-runs (selfUuid is in its deps) and the derive recomputes.
        if (!Router || !user?.sub || !selfUuid) return;
        try {
            // Use groupsAPI.getGroupMembers which automatically includes Authorization header
            const data = await groupsAPI.getGroupMembers(Router);

            // Ensure data is an array before processing
            if (!Array.isArray(data)) {
                console.warn('Group members data is not an array:', data);
                setUserList([]);
                return;
            }

            // GROUP-05: backend's `/groups/:id/users` returns 200 even for
            // non-members (just omits them from the list), so in-list
            // absence is the real removal signal. Redirect BEFORE any
            // setState that would paint the group view, so removed users
            // never see a flash of group content.
            const currentUserMember = data.find(m => m.id === selfUuid);
            if (!currentUserMember || !currentUserMember.UserGroup) {
                redirectToHomeAsRemoved();
                return;
            }

            // Confirmed member — safe to commit member list + role + open
            // the paint gate so the rest of the page renders.
            setUserList(data);
            setUserRole(currentUserMember.UserGroup.role);
            setMembershipChecked(true);
        } catch (error) {
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            console.error('Error fetching group members:', error);
            setUserList([]);
        }
    };

    const fetchGroupEvents = async () => {
        if (!Router || !user?.sub) return;
        try {
            const data = await eventsAPI.getGroupEvents(Router, { includeRsvpSummary: true });
            setGroupEvents(data || []);
        } catch (error) {
            console.error('Error fetching group events:', error);
            setGroupEvents([]);
        }
    };

    const getGamesForGroup = useCallback(async () => {
        if (!Router || !user?.sub) return;
        try {
            setLoading(true);
            const games = await listsAPI.getGroupGames(Router, user.sub);
            setGamesList(games || []);
        } catch (error) {
            // /api/lists/games/:groupId/:userId 403s non-members — treat
            // it as a removal signal and redirect, same as the member-list
            // absence path in getGroupMembers.
            if (isRemovedFromGroupError(error)) {
                redirectToHomeAsRemoved();
                return;
            }
            console.error('Error fetching games:', error);
            setGamesList([]);
        } finally {
            setLoading(false);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [Router, user?.sub]);

    useEffect(() => {
        if (Router && user?.sub) {
            getGroup();
            // getGroupMembers self-gates on selfUuid (see its guard); selfUuid is
            // in the deps so the membership derive re-runs once identity resolves.
            getGroupMembers();
            fetchGroupEvents();
        }
        // Auto-open event modal if coming from planning page
        if (shouldCreateEvent && prefillDate && prefillTime) {
            setEventModal(true);
        }
    }, [Router, user?.sub, selfUuid, shouldCreateEvent, prefillDate, prefillTime]);

    // Defer the games fetch until the membership check has confirmed the
    // user belongs to the group. The games endpoint 403s non-members
    // (correctly), but firing it before redirect produces noisy console
    // errors. The redirect-on-403 fallback in getGamesForGroup is still
    // there as a safety net — this gate just prevents the noise on the
    // happy path of "removed user opens a stale URL".
    useEffect(() => {
        if (Router && user?.sub && membershipChecked) {
            getGamesForGroup();
        }
    }, [Router, user?.sub, membershipChecked, getGamesForGroup]);

    const handleEventCreated = async (newEvent) => {
        // Refresh games list and calendar events after creating new event
        getGamesForGroup();
        await fetchGroupEvents();
        // Bump the defensive refresh key AFTER the fetch resolves so the
        // calendar grid + Upcoming Events card both re-render with the new
        // data, even if groupEvents reference equality is preserved.
        setEventsRefreshKey(prev => prev + 1);
    };

    const toggleEventModal = () => {
        if (eventModal) {
            setCalendarPrefillDate(null); // Clear when closing
            setCalendarEntryMode('week'); // CAL-05: reset to default for next open
        }
        setEventModal(!eventModal);
    };


    // Phase 69-04 paint gate: don't render the group page until the
    // membership check has confirmed the current user belongs here. This
    // covers two cases — (a) `getGroup` resolves before `getGroupMembers`
    // and `setGroup(data)` would otherwise flash group content for a
    // removed user, (b) the games endpoint 403s in the brief window
    // between mount and redirect.
    if (!membershipChecked) {
        return (
            <div className="p-6 flex flex-col items-center justify-center gap-3 min-h-screen">
                <p className="text-content-secondary">Loading group…</p>
                {/* D-08: if identity resolution permanently fails, the membership
                    check can never complete — surface a compact, non-blocking
                    degrade notice instead of an indefinite silent spinner (D-11). */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen">
                <p className="text-content-secondary">Loading games...</p>
            </div>
        );
    }

    return (
        // POLL-02: FriendshipStatusProvider lifted to root layout — see
        // src/app/layout.js. Nested mount removed so NotificationBell +
        // friends/page consume the same receivedRequests state.
        <div className="p-3 md:p-6">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                <span className="text-content-muted mx-2">{'>'}</span>
                <span className="text-content-primary font-semibold break-words">{Group?.name || 'Group'}</span>
            </nav>

            {/* Header — Phase 69-04 layout: ALWAYS stack title row above
                button row (no md:flex-row). Kebab moves into the title row
                so it sits beside the group name at every breakpoint instead
                of wrapping awkwardly under the buttons at narrow widths. */}
            <div
                className="mb-6 flex flex-col gap-4 p-4 md:p-6 rounded-lg relative overflow-visible"
                style={{
                    backgroundColor: Group?.background_color || '#111418',
                    ...safeBgImageStyle(Group?.background_image_url),
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    minHeight: '120px',
                }}
            >
                <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: Group?.background_image_url ? 'rgba(0, 0, 0, 0.4)' : 'rgba(0, 0, 0, 0.15)',
                    zIndex: 0,
                    borderRadius: 'inherit',
                }} />
                <div className="flex items-center gap-3 md:gap-4 relative z-10 flex-1 min-w-0">
                    {Group?.profile_picture_url && (
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-surface-card flex items-center justify-center text-2xl md:text-4xl flex-shrink-0 overflow-hidden border-2 md:border-4 border-surface-card shadow-theme-lg">
                            {Group.profile_picture_url.startsWith('http') || Group.profile_picture_url.startsWith('/') ? (
                                <SafeImage
                                    src={Group.profile_picture_url}
                                    alt={Group.name}
                                    fallbackIcon="👥"
                                    className="w-full h-full object-cover"
                                />
                            ) : (
                                <span>{Group.profile_picture_url}</span>
                            )}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <h1
                            className="text-2xl md:text-3xl font-bold break-words"
                            style={getTextStyle(!!Group?.background_image_url, Group?.background_color || '#1f2937')}
                        >
                            {Group?.name || 'Group'}
                        </h1>
                        <p
                            className="mt-1"
                            style={getSubtitleStyle(!!Group?.background_image_url, Group?.background_color || '#1f2937')}
                        >
                            {gamesList.length} {gamesList.length === 1 ? 'game' : 'games'} played
                            {UserList && UserList.length > 0 && (
                                <span className="ml-2">• {UserList.length} {UserList.length === 1 ? 'member' : 'members'}</span>
                            )}
                        </p>
                    </div>
                    {/* Kebab lives in the title row at every breakpoint so it
                        sits beside the group name (CONTEXT D-LEAVE-01 entry to
                        GroupSettings). Active members only. */}
                    {userRole && userRole !== 'pending' && (
                        <div className="flex-shrink-0 relative z-20">
                            <KebabMenu
                                ariaLabel="Group actions"
                                items={[
                                    { label: 'Group settings', onClick: () => setShowGroupSettings(true) },
                                ]}
                            />
                        </div>
                    )}
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 relative z-20 w-full flex-shrink-0 items-stretch sm:items-center md:justify-end">
                    {userRole && userRole !== 'pending' && (
                        <button
                            onClick={() => setMemberModal(true)}
                            className="btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap text-white border-2 border-white/30 rounded-btn backdrop-blur-sm hover:bg-white/20 transition-all"
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                            }}
                        >
                            Manage Members
                        </button>
                    )}
                    <Link
                        href={`/groupPlanning?group_id=${Router}`}
                        className="btn btn-primary px-4 py-2 md:px-6 md:py-3 font-semibold shadow-theme-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white/20 text-center"
                        style={{
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.15)',
                        }}
                    >
                        Plan Game Session
                    </Link>
                    {userRole && userRole !== 'pending' && (
                        <button
                            onClick={toggleEventModal}
                            className="btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap rounded-btn transition-all border-2 border-amber-400/40 hover:border-amber-400/60"
                            style={{
                                backgroundColor: 'var(--amber-600)',
                                color: 'white',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.15)',
                            }}
                        >
                            Add New Game Event
                        </button>
                    )}
                </div>
            </div>

            {userRole === 'pending' && <PendingMemberBanner groupId={Router} />}

            {/* Tab bar */}
            <div className="flex border-b border-line mb-4">
                <button
                    onClick={() => setActiveTab('home')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'home'
                            ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
                            : 'text-content-secondary hover:text-content-primary'
                    }`}
                >
                    Overview
                </button>
                <button
                    onClick={() => setActiveTab('library')}
                    className={`px-4 py-2 text-sm font-medium transition-colors ${
                        activeTab === 'library'
                            ? 'text-btn-primary-text bg-btn-primary border-b-2 border-btn-primary rounded-btn'
                            : 'text-content-secondary hover:text-content-primary'
                    }`}
                >
                    Library
                </button>
            </div>

            {activeTab === 'home' && (
              <>
                {/* Group Calendar */}
                <EventCalendar
                    refreshKey={eventsRefreshKey}
                    events={groupEvents}
                    variant="compact"
                    title="Calendar"
                    showListView={true}
                    scope={Router ? `group:${Router}` : 'group'}
                    onEmptyDayClick={userRole && userRole !== 'pending' ? (dateStr) => {
                        // CAL-05: empty-day tap (or EventDayModal's
                        // "+ New event on this day") opens create-event in
                        // visual day-mode focused on the tapped day.
                        setCalendarPrefillDate(dateStr);
                        setCalendarEntryMode('day');
                        setEventModal(true);
                    } : undefined}
                />

                {/* Group Games Section */}
                <GroupGamesList
                    games={gamesList}
                    groupId={Router}
                    onAddEvent={toggleEventModal}
                    userRole={userRole}
                    members={UserList}
                />
              </>
            )}

            {activeTab === 'library' && (
                <GroupLibrary groupId={Router} />
            )}

            <CreateEvent
                group_id={Router}
                modal={eventModal}
                modaltoggle={() => {
                    setEventModal(false);
                    setCalendarPrefillDate(null); // Clear calendar prefill on close
                    setCalendarEntryMode('week'); // CAL-05: reset to default
                }}
                onEventCreated={handleEventCreated}
                user={user}
                prefillDate={calendarPrefillDate || prefillDate}
                prefillTime={prefillTime}
                userRole={userRole}
                initialVisualView={calendarEntryMode}
            />

            <ManageMembers
                group_id={Router}
                user={user}
                modal={memberModal}
                modaltoggle={() => setMemberModal(false)}
                onMembersUpdated={getGroupMembers}
                group_name={Group?.name || 'this group'}
            />

            {showGroupSettings && Group && (
                <GroupSettings
                    group={Group}
                    user={user}
                    userRole={userRole}
                    onClose={() => setShowGroupSettings(false)}
                    onUpdate={() => {
                        // Re-fetch group settings + members so Settings edits
                        // (profile picture, background, etc.) reflect immediately.
                        getGroup();
                        getGroupMembers();
                        setShowGroupSettings(false);
                    }}
                    onGroupDeleted={() => {
                        setShowGroupSettings(false);
                        router.push('/');
                    }}
                    onOpenManageMembers={() => {
                        setShowGroupSettings(false);
                        setMemberModal(true);
                    }}
                />
            )}
        </div>
    );
}

export default GroupHomePage;
