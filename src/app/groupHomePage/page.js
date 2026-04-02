'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import CreateEvent from '../components/createEvent';
import ManageMembers from '../components/ManageMembers';
import FriendInvitePanel from '../components/FriendInvitePanel';
import { listsAPI, groupsAPI, eventsAPI, API_BASE_URL } from '../../lib/api';
import GroupGamesList from '../components/GroupGamesList';
import { getTextStyle, getSubtitleStyle } from '../../lib/colorUtils';
import SafeImage from '../components/SafeImage';
import EventCalendar from '../components/EventCalendar';
import PendingMemberBanner from '../components/PendingMemberBanner';
import FriendshipStatusProvider from '../components/FriendshipStatusProvider';
import UpcomingEventsCard from '../components/UpcomingEventsCard';
import GroupLibrary from '../components/GroupLibrary';

// A groups home page
function GroupHomePage(){
    const { user } = Auth();
    const [Group, setGroup] = useState(null);
    const [UserList, setUserList] = useState(null);
    const [gamesList, setGamesList] = useState([]);
    const [eventModal, setEventModal] = useState(false);
    const [memberModal, setMemberModal] = useState(false);
    const [inviteModal, setInviteModal] = useState(false);
    const [loading, setLoading] = useState(true);
    const [userRole, setUserRole] = useState(null);
    const [activeTab, setActiveTab] = useState('home');

    // Calendar state
    const [groupEvents, setGroupEvents] = useState([]);
    const [calendarPrefillDate, setCalendarPrefillDate] = useState(null);

    const searchParams = useSearchParams();
    const Router = searchParams.get('id');
    const prefillDate = searchParams.get('date');
    const prefillTime = searchParams.get('time');
    const shouldCreateEvent = searchParams.get('create_event') === 'true';

    const getGroup = async () => {
        if (!Router) return;
        try {
            // Use groupsAPI.getGroup which automatically includes Authorization header
            const data = await groupsAPI.getGroup(Router);
            setGroup(data);
        } catch (error) {
            console.error('Error fetching group:', error);
        }
    };

    const getGroupMembers = async () => {
        if (!Router || !user?.sub) return;
        try {
            // Use groupsAPI.getGroupMembers which automatically includes Authorization header
            const data = await groupsAPI.getGroupMembers(Router);

            // Ensure data is an array before processing
            if (!Array.isArray(data)) {
                console.warn('Group members data is not an array:', data);
                setUserList([]);
                return;
            }

            setUserList(data);

            // Find current user's role
            const currentUserMember = data.find(m => m.user_id === user.sub);
            if (currentUserMember && currentUserMember.UserGroup) {
                setUserRole(currentUserMember.UserGroup.role);
            }
        } catch (error) {
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
            console.error('Error fetching games:', error);
            setGamesList([]);
        } finally {
            setLoading(false);
        }
    }, [Router, user?.sub]);

    useEffect(() => {
        if (Router && user?.sub) {
            getGroup();
            getGroupMembers();
            fetchGroupEvents();
        }
        // Auto-open event modal if coming from planning page
        if (shouldCreateEvent && prefillDate && prefillTime) {
            setEventModal(true);
        }
    }, [Router, user?.sub, shouldCreateEvent, prefillDate, prefillTime]);

    useEffect(() => {
        if (Router && user?.sub) {
            getGamesForGroup();
        }
    }, [Router, user?.sub, getGamesForGroup]);

    const handleEventCreated = (newEvent) => {
        // Refresh games list and calendar events after creating new event
        getGamesForGroup();
        fetchGroupEvents();
    };

    const toggleEventModal = () => {
        if (eventModal) {
            setCalendarPrefillDate(null); // Clear when closing
        }
        setEventModal(!eventModal);
    };


    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen">
                <p className="text-content-secondary">Loading games...</p>
            </div>
        );
    }

    return (
        <FriendshipStatusProvider>
        <div className="p-3 md:p-6">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                <span className="text-content-muted mx-2">{'>'}</span>
                <span className="text-content-primary font-semibold max-w-[200px] truncate inline-block align-bottom">{Group?.name || 'Group'}</span>
            </nav>

            {/* Header */}
            <div
                className="mb-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4 p-4 md:p-6 rounded-lg relative overflow-visible"
                style={{
                    backgroundColor: Group?.background_color || '#111418',
                    backgroundImage: Group?.background_image_url ? `url(${Group.background_image_url})` : 'none',
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
                            className="text-2xl md:text-3xl font-bold truncate"
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
                </div>
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 relative z-20 w-full md:w-auto flex-shrink-0">
                    {(userRole === 'owner' || userRole === 'admin') && (
                        <button
                            onClick={() => setInviteModal(true)}
                            className="btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap text-white border-2 border-white/30 rounded-btn backdrop-blur-sm hover:bg-white/20 transition-all"
                            style={{
                                backgroundColor: 'rgba(255, 255, 255, 0.1)',
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
                            }}
                        >
                            Invite Member
                        </button>
                    )}
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
                {/* Upcoming Events */}
                <UpcomingEventsCard events={groupEvents} />

                {/* Group Calendar */}
                <EventCalendar
                    events={groupEvents}
                    variant="compact"
                    title="Calendar"
                    showListView={false}
                    onEmptyDayClick={userRole && userRole !== 'pending' ? (dateStr) => {
                        setCalendarPrefillDate(dateStr);
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
                }}
                onEventCreated={handleEventCreated}
                user={user}
                prefillDate={calendarPrefillDate || prefillDate}
                prefillTime={prefillTime}
                userRole={userRole}
            />

            <ManageMembers
                group_id={Router}
                user={user}
                modal={memberModal}
                modaltoggle={() => setMemberModal(false)}
                onMembersUpdated={getGroupMembers}
                group_name={Group?.name || 'this group'}
            />

            <FriendInvitePanel
                group={Group}
                open={inviteModal}
                onClose={() => setInviteModal(false)}
                onMemberAdded={getGroupMembers}
            />
        </div>
        </FriendshipStatusProvider>
    );
}

export default GroupHomePage;
