'use client';
import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import CreateEvent from '../components/createEvent';
import ManageMembers from '../components/ManageMembers';
import AddMember from '../components/addMember';
import { listsAPI, groupsAPI, eventsAPI, API_BASE_URL } from '../../lib/api';

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
    
    // Calendar state
    const [groupEvents, setGroupEvents] = useState([]);
    const [calendarDate, setCalendarDate] = useState(new Date());
    const [calendarPrefillDate, setCalendarPrefillDate] = useState(null);

    // Sorting state
    const [sortBy, setSortBy] = useState('last_played');
    const [sortOrder, setSortOrder] = useState('desc');

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
            const data = await eventsAPI.getGroupEvents(Router);
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
            const games = await listsAPI.getGroupGames(Router, user.sub, sortBy, sortOrder);
            setGamesList(games || []);
        } catch (error) {
            console.error('Error fetching games:', error);
            setGamesList([]);
        } finally {
            setLoading(false);
        }
    }, [Router, user?.sub, sortBy, sortOrder]);

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
        setEventModal(!eventModal);
    };

    const handleSortChange = (e) => {
        setSortBy(e.target.value);
    };

    const handleOrderChange = (e) => {
        setSortOrder(e.target.value);
    }; 

    const formatDate = (date) => {
        if (!date) return 'Never';
        try {
            return new Date(date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return 'Invalid date';
        }
    };

    const formatRating = (rating) => {
        if (!rating) return 'No ratings';
        return `${parseFloat(rating).toFixed(1)}/5`;
    };

    // Calendar helpers
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    const getDaysInMonth = (date) => {
        const year = date.getFullYear();
        const month = date.getMonth();
        const firstDay = new Date(year, month, 1);
        const lastDay = new Date(year, month + 1, 0);
        const daysInMonth = lastDay.getDate();
        const startingDayOfWeek = firstDay.getDay();

        const days = [];
        for (let i = 0; i < startingDayOfWeek; i++) {
            days.push(null);
        }
        for (let day = 1; day <= daysInMonth; day++) {
            days.push(new Date(year, month, day));
        }
        return days;
    };

    const getEventsForDate = (date) => {
        if (!date) return [];
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateStr = `${year}-${month}-${day}`;

        return groupEvents.filter(event => {
            if (!event.start_date) return false;
            const eventDate = new Date(event.start_date);
            const eventYear = eventDate.getFullYear();
            const eventMonth = String(eventDate.getMonth() + 1).padStart(2, '0');
            const eventDay = String(eventDate.getDate()).padStart(2, '0');
            const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`;
            return eventDateStr === dateStr;
        });
    };

    const isToday = (date) => {
        if (!date) return false;
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const navigateCalendarMonth = (direction) => {
        setCalendarDate(prev => {
            const newDate = new Date(prev);
            newDate.setMonth(prev.getMonth() + direction);
            return newDate;
        });
    };

    if (loading) {
        return (
            <div className="p-6 flex items-center justify-center min-h-screen">
                <p className="text-gray-600">Loading games...</p>
            </div>
        );
    }

    return (
        <div className="p-3 md:p-6">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Home</Link>
                <span className="text-gray-400 mx-2">{'>'}</span>
                <span className="text-white font-semibold max-w-[200px] truncate inline-block align-bottom">{Group?.name || 'Group'}</span>
            </nav>

            {/* Header */}
            <div 
                className="mb-6 flex flex-col md:flex-row md:justify-between md:items-center gap-4 p-4 md:p-6 rounded-lg relative overflow-visible"
                style={{
                    backgroundColor: Group?.background_color || '#1f2937',
                    backgroundImage: Group?.background_image_url ? `url(${Group.background_image_url})` : 'none',
                    backgroundSize: 'cover',
                    backgroundPosition: 'center',
                    minHeight: '120px',
                }}
            >
                {Group?.background_image_url && (
                    <div style={{
                        position: 'absolute',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(0, 0, 0, 0.4)',
                        zIndex: 0,
                    }} />
                )}
                <div className="flex items-center gap-3 md:gap-4 relative z-10 flex-1 min-w-0">
                    {Group?.profile_picture_url && (
                        <div className="w-16 h-16 md:w-20 md:h-20 rounded-full bg-white flex items-center justify-center text-2xl md:text-4xl flex-shrink-0 overflow-hidden border-2 md:border-4 border-white shadow-lg">
                            {Group.profile_picture_url.startsWith('http') || Group.profile_picture_url.startsWith('/') ? (
                                <img 
                                    src={Group.profile_picture_url} 
                                    alt={Group.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        e.target.style.display = 'none';
                                        if (e.target.nextSibling) {
                                            e.target.nextSibling.style.display = 'block';
                                        }
                                    }}
                                />
                            ) : (
                                <span>{Group.profile_picture_url}</span>
                            )}
                        </div>
                    )}
                    <div className="flex-1 min-w-0">
                        <h1 
                            className="text-2xl md:text-3xl font-bold truncate"
                            style={(() => {
                                const hasBgImage = !!Group?.background_image_url;
                                const bgColor = Group?.background_color || '#1f2937';
                                
                                if (hasBgImage) {
                                    return {
                                        color: '#ffffff',
                                        textShadow: '3px 3px 6px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.9), 1px -1px 3px rgba(0, 0, 0, 0.9), -1px 1px 3px rgba(0, 0, 0, 0.9)',
                                        WebkitTextStroke: '1px rgba(0, 0, 0, 0.95)',
                                    };
                                }
                                
                                const hex = bgColor.replace('#', '');
                                const r = parseInt(hex.substr(0, 2), 16);
                                const g = parseInt(hex.substr(2, 2), 16);
                                const b = parseInt(hex.substr(4, 2), 16);
                                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                
                                if (brightness > 180) {
                                    return {
                                        color: '#1f2937',
                                        textShadow: '2px 2px 4px rgba(255, 255, 255, 0.9), -1px -1px 2px rgba(255, 255, 255, 0.9)',
                                    };
                                } else if (brightness > 128) {
                                    return {
                                        color: '#1f2937',
                                        textShadow: '1px 1px 3px rgba(255, 255, 255, 0.95)',
                                    };
                                } else {
                                    return {
                                        color: '#ffffff',
                                        textShadow: '3px 3px 6px rgba(0, 0, 0, 0.9), -1px -1px 3px rgba(0, 0, 0, 0.9), 1px -1px 3px rgba(0, 0, 0, 0.9), -1px 1px 3px rgba(0, 0, 0, 0.9)',
                                        WebkitTextStroke: '1px rgba(0, 0, 0, 0.95)',
                                    };
                                }
                            })()}
                        >
                            {Group?.name || 'Group'}
                        </h1>
                        <p 
                            className="mt-1"
                            style={(() => {
                                const hasBgImage = !!Group?.background_image_url;
                                const bgColor = Group?.background_color || '#1f2937';
                                
                                if (hasBgImage) {
                                    return {
                                        color: 'rgba(255, 255, 255, 0.95)',
                                        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)',
                                        WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)',
                                    };
                                }
                                
                                const hex = bgColor.replace('#', '');
                                const r = parseInt(hex.substr(0, 2), 16);
                                const g = parseInt(hex.substr(2, 2), 16);
                                const b = parseInt(hex.substr(4, 2), 16);
                                const brightness = (r * 299 + g * 587 + b * 114) / 1000;
                                
                                if (brightness > 180) {
                                    return {
                                        color: '#374151',
                                        textShadow: '1px 1px 2px rgba(255, 255, 255, 0.8)',
                                    };
                                } else if (brightness > 128) {
                                    return {
                                        color: '#4b5563',
                                        textShadow: '1px 1px 2px rgba(255, 255, 255, 0.9)',
                                    };
                                } else {
                                    return {
                                        color: 'rgba(255, 255, 255, 0.95)',
                                        textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8)',
                                        WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)',
                                    };
                                }
                            })()}
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
                            className="bg-emerald-600 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg font-semibold hover:bg-emerald-700 transition-colors shadow-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white"
                            style={{
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.3)',
                            }}
                        >
                            Invite Member
                        </button>
                    )}
                    {(userRole === 'owner' || userRole === 'admin') && (
                        <button
                            onClick={() => setMemberModal(true)}
                            className="bg-purple-600 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg font-semibold hover:bg-purple-700 transition-colors shadow-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white"
                            style={{
                                boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.3)',
                            }}
                        >
                            Manage Members
                        </button>
                    )}
                    <Link
                        href={`/groupPlanning?group_id=${Router}`}
                        className="bg-green-600 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg font-semibold hover:bg-green-700 transition-colors shadow-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white text-center"
                        style={{
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.3)',
                        }}
                    >
                        Plan Game Session
                    </Link>
                    <button
                        onClick={toggleEventModal}
                        className="bg-blue-600 text-white px-4 py-2 md:px-6 md:py-3 rounded-lg font-semibold hover:bg-blue-700 transition-colors shadow-lg hover:shadow-xl text-sm md:text-base whitespace-nowrap border-2 border-white"
                        style={{
                            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.4), 0 0 0 2px rgba(255, 255, 255, 0.3)',
                        }}
                    >
                        Add New Game Event
                    </button>
                </div>
            </div>

            {/* Group Calendar */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-gray-900">Calendar</h2>
                </div>

                {/* Month Navigation */}
                <div className="flex justify-between items-center mb-4">
                    <button onClick={() => navigateCalendarMonth(-1)} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm">
                        Prev
                    </button>
                    <h3 className="text-lg font-semibold text-gray-900">
                        {monthNames[calendarDate.getMonth()]} {calendarDate.getFullYear()}
                    </h3>
                    <button onClick={() => navigateCalendarMonth(1)} className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors text-sm">
                        Next
                    </button>
                </div>

                {/* Day headers */}
                <div className="grid grid-cols-7 gap-1 mb-1">
                    {dayNames.map(day => (
                        <div key={day} className="text-center font-semibold text-gray-700 py-1 text-xs">
                            {day}
                        </div>
                    ))}
                </div>

                {/* Calendar grid */}
                <div className="grid grid-cols-7 gap-1">
                    {getDaysInMonth(calendarDate).map((date, index) => {
                        const dayEvents = getEventsForDate(date);
                        const isCurrentDay = isToday(date);
                        return (
                            <div
                                key={index}
                                className={`min-h-[80px] border border-gray-200 rounded p-1 ${
                                    !date ? 'bg-gray-50' :
                                    isCurrentDay ? 'bg-blue-50 border-blue-300' :
                                    dayEvents.length === 0 ? 'bg-white hover:bg-blue-50 hover:border-blue-200 cursor-pointer transition-colors' :
                                    'bg-white'
                                }`}
                            >
                                {date && (
                                    <>
                                        <div className={`text-xs font-medium mb-1 ${isCurrentDay ? 'text-blue-700' : 'text-gray-900'}`}>
                                            {date.getDate()}
                                        </div>
                                        <div className="space-y-0.5">
                                            {dayEvents.slice(0, 2).map(event => (
                                                <div key={event.id} className="text-xs p-0.5 bg-blue-100 text-blue-800 rounded truncate font-medium">
                                                    {event.Game?.name || 'Game Night'}
                                                </div>
                                            ))}
                                            {dayEvents.length > 2 && (
                                                <div className="text-xs text-blue-600 font-medium">+{dayEvents.length - 2} more</div>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* Sorting Controls */}
            {gamesList.length > 0 && (
                <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center bg-gray-50 p-3 md:p-4 rounded-lg">
                    <label className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Sort by:</span>
                        <select
                            value={sortBy}
                            onChange={handleSortChange}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
                        >
                            <option value="last_played">Last Played</option>
                            <option value="name">Name</option>
                            <option value="play_count">Play Count</option>
                            <option value="rating">Rating</option>
                        </select>
                    </label>
                    
                    <label className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Order:</span>
                        <select
                            value={sortOrder}
                            onChange={handleOrderChange}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
                        >
                            <option value="desc">Descending</option>
                            <option value="asc">Ascending</option>
                        </select>
                    </label>
                </div>
            )}

            {/* Games List */}
            {gamesList.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {gamesList.map((game) => (
                        <Link
                            key={game.id}
                            href={`/gameDetail?game_id=${encodeURIComponent(game.id)}&group_id=${encodeURIComponent(Router)}`}
                            className="block bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow hover:border-blue-300"
                        >
                            <div className="flex items-start gap-4">
                                {game.image_url && (
                                    <img
                                        src={game.image_url}
                                        alt={game.name}
                                        className="w-16 h-16 object-cover rounded"
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                        }}
                                    />
                                )}
                                <div className="flex-1 min-w-0">
                                    <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">
                                        {game.name}
                                    </h3>
                                    <div className="text-sm text-gray-600 space-y-1">
                                        <p>
                                            Played <span className="font-semibold">{game.play_count}</span> {game.play_count === 1 ? 'time' : 'times'}
                                        </p>
                                        <p>
                                            Last played: {formatDate(game.last_played)}
                                        </p>
                                        {game.avg_rating && (
                                            <p>
                                                Rating: <span className="font-semibold text-yellow-600">{formatRating(game.avg_rating)}</span>
                                                {game.review_count > 0 && (
                                                    <span className="text-gray-500"> ({game.review_count} {game.review_count === 1 ? 'review' : 'reviews'})</span>
                                                )}
                                            </p>
                                        )}
                                        {game.theme && (
                                            <p className="text-xs text-gray-500">
                                                Theme: {game.theme}
                                            </p>
                                        )}
                                    </div>
                                </div>
                            </div>
                        </Link>
                    ))}
                </div>
            ) : (
                <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                    <p className="text-gray-600 text-lg mb-2">No games played yet</p>
                    <p className="text-gray-500 mb-4">Start tracking your game sessions!</p>
                    <button
                        onClick={toggleEventModal}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    >
                        Add Your First Game Event
                    </button>
                </div>
            )}

            <CreateEvent
                group_id={Router}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                onEventCreated={handleEventCreated}
                user={user}
                prefillDate={prefillDate}
                prefillTime={prefillTime}
            />
            
            <ManageMembers
                group_id={Router}
                user={user}
                modal={memberModal}
                modaltoggle={() => setMemberModal(false)}
                onMembersUpdated={getGroupMembers}
            />

            <AddMember
                group={Group}
                modal={inviteModal}
                modaltoggle={() => setInviteModal(false)}
                onMemberAdded={getGroupMembers}
            />
        </div>
    );
}

export default GroupHomePage;