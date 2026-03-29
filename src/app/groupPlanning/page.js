'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { availabilityAPI, groupsAPI, eventsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import MergedHeatmap from '../components/MergedHeatmap';
import HeatmapGrid from '../components/HeatmapGrid';
import ResponseDashboard from '../components/ResponseDashboard';
import { format, startOfWeek } from 'date-fns';

export default function GroupPlanningPage() {
    const { user, isLoading: authLoading } = Auth();
    const searchParams = useSearchParams();
    const groupId = searchParams.get('group_id');
    const promptId = searchParams.get('prompt_id');
    
    const [group, setGroup] = useState(null);
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [groupEvents, setGroupEvents] = useState([]);

    // Modal state for CreateEvent
    const [eventModal, setEventModal] = useState(false);
    const [prefillDate, setPrefillDate] = useState(null);
    const [prefillTime, setPrefillTime] = useState(null);
    const [selectedSlotData, setSelectedSlotData] = useState(null);

    // Merged heatmap state
    const [heatmapSlots, setHeatmapSlots] = useState(null);
    const [heatmapMeta, setHeatmapMeta] = useState(null);
    const [mergedHeatmapLoading, setMergedHeatmapLoading] = useState(true);
    const [mergedHeatmapError, setMergedHeatmapError] = useState(null);
    const [selectedWeek, setSelectedWeek] = useState(() =>
      startOfWeek(new Date(), { weekStartsOn: 1 })
    );
    const [selectedHeatmapSlot, setSelectedHeatmapSlot] = useState(null);

    // Heatmap state
    const [heatmapPrompt, setHeatmapPrompt] = useState(null);
    const [suggestions, setSuggestions] = useState([]);
    const [heatmapLoading, setHeatmapLoading] = useState(true);
    const [heatmapError, setHeatmapError] = useState(null);
    const [userRole, setUserRole] = useState(null);

    // Derived heatmap data (memos must be before any early returns)
    const memberMap = useMemo(() => {
        const map = new Map();
        (group?.Users || []).forEach(u => map.set(u.user_id, u.username || u.user_id));
        return map;
    }, [group]);

    const enrichedSuggestions = useMemo(() => {
        return suggestions.map(s => ({
            ...s,
            participants: (s.participant_user_ids || []).map(uid => ({
                user_id: uid,
                username: memberMap.get(uid) || uid,
                preference: 'if-need-be',
            })),
        }));
    }, [suggestions, memberMap]);

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
            fetchUserRole();
        }
    }, [user, groupId]);

    // Fetch merged heatmap data when week or group changes
    useEffect(() => {
        if (user?.sub && groupId) {
            fetchMergedHeatmap();
        }
    }, [user, groupId, selectedWeek, timezone]);

    const fetchGroup = async () => {
        if (!groupId) return;
        try {
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
            alert('Failed to load group. Please try again.');
        }
    };

    const fetchMergedHeatmap = async () => {
        if (!groupId) return;
        try {
            setMergedHeatmapLoading(true);
            setMergedHeatmapError(null);
            const weekStartStr = format(selectedWeek, 'yyyy-MM-dd');
            const data = await availabilityAPI.getGroupHeatmap(groupId, weekStartStr, timezone);
            setHeatmapSlots(data.slots);
            setHeatmapMeta({
                weekStart: data.weekStart,
                weekEnd: data.weekEnd,
                totalMembers: data.totalMembers,
                membersWithData: data.membersWithData,
                membersWithoutData: data.membersWithoutData,
            });
        } catch (err) {
            console.error('Error fetching merged heatmap:', err);
            setMergedHeatmapError(err.message || 'Failed to load availability heatmap');
        } finally {
            setMergedHeatmapLoading(false);
        }
    };

    const handleWeekChange = (newWeek) => {
        setSelectedWeek(newWeek);
        setSelectedHeatmapSlot(null);
    };

    const handleSlotSelect = (slot) => {
        if (selectedHeatmapSlot?.date === slot.date && selectedHeatmapSlot?.hour === slot.hour) {
            setSelectedHeatmapSlot(null);
            setPrefillDate(null);
            setPrefillTime(null);
        } else {
            setSelectedHeatmapSlot(slot);
            setPrefillDate(slot.date);
            setPrefillTime(`${String(slot.hour).padStart(2, '0')}:00`);
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
                // Navigating from a no-consensus email — load specific prompt by ID
                const data = await promptAPI.getPromptById(promptId);
                prompt = data.prompt;
            } else {
                const data = await promptAPI.getActivePrompt(groupId);
                prompt = data.prompt;
            }
            setHeatmapPrompt(prompt);
            if (prompt) {
                const data = await promptAPI.getSuggestions(prompt.id);
                setSuggestions(data.suggestions || []);
            }
        } catch (err) {
            setHeatmapError(err.message || 'Failed to load heatmap data');
        } finally {
            setHeatmapLoading(false);
        }
    };

    const fetchUserRole = async () => {
        if (!groupId || !user?.sub) return;
        try {
            const members = await groupsAPI.getGroupMembers(groupId);
            const me = (members || []).find(m => m.user_id === user.sub);
            if (me?.UserGroup?.role) {
                setUserRole(me.UserGroup.role);
            }
        } catch (err) {
            console.error('Error fetching user role:', err);
        }
    };

    const toggleEventModal = () => {
        setEventModal(!eventModal);
        if (eventModal) {
            // Clear prefill data when closing modal
            setPrefillDate(null);
            setPrefillTime(null);
            setSelectedSlotData(null);
        }
    };

    const handleEventCreated = (newEvent) => {
        toggleEventModal();
        // Refresh events after creation
        fetchGroupEvents();
    };

    if (!user) {
        return <div className="flex items-center justify-center min-h-screen">
            {authLoading ? 'Loading...' : 'Redirecting to login...'}
        </div>;
    }

    if (!groupId) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <p className="text-red-600">No group specified. Please navigate from a group page.</p>
                <Link href="/" className="text-blue-600 hover:underline">Go to Home</Link>
            </div>
        );
    }

    const totalMembers = group?.Users?.length || 0;

    const isAdmin = ['owner', 'admin'].includes(userRole);
    const pollClosed = !heatmapPrompt ||
        heatmapPrompt.status === 'closed' ||
        heatmapPrompt.status === 'converted' ||
        (heatmapPrompt.deadline && new Date(heatmapPrompt.deadline) < new Date());

    // Debug logging

    return (
        <div className="p-3 md:p-6 max-w-7xl mx-auto">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Home</Link>
                <span className="text-gray-400 mx-2">{'>'}</span>
                {group && (
                    <>
                        <Link href={`/groupHomePage?id=${groupId}`} className="text-blue-400 hover:text-blue-300 transition-colors font-medium max-w-[200px] truncate inline-block align-bottom">
                            {group.name}
                        </Link>
                        <span className="text-gray-400 mx-2">{'>'}</span>
                    </>
                )}
                <span className="text-white font-semibold">Plan Game Session</span>
            </nav>

            {/* Header */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                    <div className="min-w-0">
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 truncate">
                            {group ? `Plan Game Session - ${group.name}` : 'Plan Game Session'}
                        </h1>
                        <p className="text-sm text-gray-600 mt-1">
                            See when your group is available and pick a time to play
                        </p>
                    </div>
                </div>
            </div>

            {/* Merged Availability Heatmap */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Group Availability</h2>
                <MergedHeatmap
                    groupId={groupId}
                    heatmapData={heatmapMeta ? { ...heatmapMeta, slots: heatmapSlots } : null}
                    loading={mergedHeatmapLoading}
                    error={mergedHeatmapError}
                    selectedWeek={selectedWeek}
                    onWeekChange={handleWeekChange}
                    selectedSlot={selectedHeatmapSlot}
                    onSlotSelect={handleSlotSelect}
                />
            </div>


            {/* Availability Heatmap Section */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                <h2 className="text-xl font-bold text-gray-900 mb-4">Group Availability Heatmap</h2>
                {heatmapLoading ? (
                    <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                ) : heatmapError ? (
                    <p className="text-center text-red-600 py-8">{heatmapError}</p>
                ) : !heatmapPrompt ? (
                    <p className="text-center text-gray-500 py-8">
                        No active availability poll found. Use Prompt Schedules to send one.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2">
                            <HeatmapGrid
                                suggestions={enrichedSuggestions}
                                totalMembers={group?.Users?.length || 0}
                                timezone={timezone}
                                groupId={groupId}
                                isAdmin={isAdmin}
                                pollClosed={pollClosed}
                                onEventCreated={fetchGroupEvents}
                            />
                        </div>
                        <div>
                            <ResponseDashboard
                                promptId={heatmapPrompt.id}
                                isAdmin={isAdmin}
                                currentUserId={user?.sub}
                                blindVotingEnabled={heatmapPrompt.blind_voting_enabled}
                                pollClosed={pollClosed}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* Create Event Modal */}
            <CreateEvent
                group_id={groupId}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                onEventCreated={(newEvent) => {
                    handleEventCreated(newEvent);
                    // Refresh events after creation
                    fetchGroupEvents();
                }}
                user={user}
                prefillDate={prefillDate}
                prefillTime={prefillTime}
                prefillDuration={selectedSlotData?.durationMinutes || null}
                hideVisualCalendar={true}
            />
        </div>
    );
}
