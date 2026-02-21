'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { availabilityAPI, groupsAPI, eventsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import HeatmapGrid from '../components/HeatmapGrid';
import ResponseDashboard from '../components/ResponseDashboard';
import { format, parseISO, subWeeks, addWeeks } from 'date-fns';

export default function GroupPlanningPage() {
    const { user } = Auth();
    const searchParams = useSearchParams();
    const groupId = searchParams.get('group_id');
    const promptId = searchParams.get('prompt_id');
    
    const [group, setGroup] = useState(null);
    const [loading, setLoading] = useState(false); // Start as false, will be set to true when fetching
    const [currentWeek, setCurrentWeek] = useState(new Date()); // Week view: current week start (Sunday)
    const [minAvailableMembers, setMinAvailableMembers] = useState(1);
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    const [groupEvents, setGroupEvents] = useState([]); // Store group events for busy time display
    const [busyBlocks, setBusyBlocks] = useState({}); // { memberName: [{ day, startHour, startMin, endHour, endMin, source }] } - explicit busy blocks only
    const [availabilityData, setAvailabilityData] = useState([]); // Full availability data for calculating busy counts
    
    // Drag state for creating events
    const [isDragging, setIsDragging] = useState(false);
    const [dragStart, setDragStart] = useState(null);
    const [dragEnd, setDragEnd] = useState(null);
    const [dragPreview, setDragPreview] = useState(null);
    
    // Modal state for CreateEvent
    const [eventModal, setEventModal] = useState(false);
    const [prefillDate, setPrefillDate] = useState(null);
    const [prefillTime, setPrefillTime] = useState(null);
    const [selectedSlotData, setSelectedSlotData] = useState(null);

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
        if (user?.sub && groupId) {
            fetchGroup();
            fetchGroupEvents();
            fetchHeatmapData();
            fetchUserRole();
        }
    }, [user, groupId]);

    useEffect(() => {
        if (!user?.sub || !groupId) {
            setLoading(false);
            return;
        }
        
        if (!group) {
            return;
        }
        
        if (!group?.Users || group.Users.length === 0) {
            setLoading(false);
            return;
        }
        
        fetchGroupBusyTimes();
    }, [user, groupId, currentWeek, timezone, group]);

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

    // Get week days starting from Sunday
    const getWeekDays = () => {
        const start = new Date(currentWeek);
        const weekStart = new Date(start.setDate(start.getDate() - start.getDay()));
        const days = [];
        for (let i = 0; i < 7; i++) {
            const day = new Date(weekStart);
            day.setDate(weekStart.getDate() + i);
            days.push(day);
        }
        return days;
    };

    // Fetch busy times for all group members
    const fetchGroupBusyTimes = async () => {
        if (!groupId) {
            setLoading(false);
            return;
        }
        
        // Use group from state, or fetch if not available
        let groupData = group;
        if (!groupData?.Users || groupData.Users.length === 0) {
            try {
                const members = await groupsAPI.getGroupMembers(groupId);
                
                if (!members || members.length === 0) {
                    setLoading(false);
                    return;
                }
                
                // If groupData exists, add members to it, otherwise create new object
                if (groupData) {
                    groupData.Users = members;
                } else {
                    // Fetch group data if we don't have it
                    groupData = await groupsAPI.getGroup(groupId);
                    groupData.Users = members;
                }
            } catch (error) {
                console.error('Error fetching group members for busy times:', error);
                setLoading(false);
                return;
            }
        }
        
        try {
            setLoading(true);
            const weekDays = getWeekDays();
            const startDate = format(weekDays[0], 'yyyy-MM-dd');
            const endDate = format(weekDays[6], 'yyyy-MM-dd');
            
            // Fetch availability for each member
            // NOTE: The API only allows users to view their own availability
            // For now, we'll only show the current user's busy times
            // TODO: Create a group-level endpoint that returns all members' busy times
            const memberBusyBlocks = {};
            
            // Only fetch for the current user (API restriction)
            if (user?.sub) {
                try {
                    const availability = await availabilityAPI.getUserAvailability(
                        user.sub,
                        startDate,
                        endDate,
                        timezone
                    );
                    
                    // Store full availability data for busy count calculation
                    if (availability && Array.isArray(availability)) {
                        setAvailabilityData(availability);
                    }
                    
                    if (availability && Array.isArray(availability)) {
                        // Filter for explicit busy times only (not unavailable_by_default)
                        // unavailable_by_default affects background color but shouldn't show as individual blocks
                        // Only show: Google Calendar events and specific overrides marked as busy
                        const busySlots = availability.filter(slot => 
                            slot.isAvailable === false &&
                            slot.startTime &&
                            typeof slot.startTime === 'string' &&
                            (slot.source === 'google_calendar' || slot.source === 'specific_override')
                        );
                        
                        // Transform to busyBlocks format
                        const blocks = [];
                        busySlots.forEach(slot => {
                            const slotDate = parseISO(slot.date);
                            const dayIndex = slotDate.getDay(); // 0 = Sunday, 6 = Saturday
                            
                            const [startHour, startMin] = slot.startTime.split(':').map(Number);
                            const endTime = slot.endTime || (() => {
                                // Default to 30 minutes if no endTime
                                const end = new Date(slotDate);
                                end.setHours(startHour, startMin + 30, 0, 0);
                                return format(end, 'HH:mm');
                            })();
                            const [endHour, endMin] = endTime.split(':').map(Number);
                            
                            blocks.push({
                                day: dayIndex,
                                startHour,
                                startMin,
                                endHour,
                                endMin,
                                source: slot.source || 'unknown',
                                date: slot.date
                            });
                        });
                        
                        if (blocks.length > 0) {
                            const userName = user.name || user.email || user.sub;
                            memberBusyBlocks[userName] = blocks;
                        }
                    }
                } catch (error) {
                    console.error(`Error fetching availability for user ${user.sub}:`, error);
                }
            }
            
            setBusyBlocks(memberBusyBlocks);
        } catch (error) {
            console.error('Error fetching group busy times:', error);
        } finally {
            setLoading(false);
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

    // Convert hour/minute to pixel position (60px per hour = 1px per minute)
    const timeToPixels = (hour, minute) => {
        return hour * 60 + minute;
    };

    // Get all members busy at a specific time
    // This uses the availability data to count ALL unavailable times (including unavailable_by_default)
    const getBusyCountAtTime = (dayIndex, hour, minute) => {
        if (!availabilityData || availabilityData.length === 0) {
            // Fallback: count explicit busy blocks only
            const timeInMinutes = hour * 60 + minute;
            let busyCount = 0;
            Object.values(busyBlocks).forEach(memberBlocks => {
                memberBlocks.forEach(block => {
                    if (block.day === dayIndex) {
                        const blockStart = block.startHour * 60 + block.startMin;
                        const blockEnd = block.endHour * 60 + block.endMin;
                        if (timeInMinutes >= blockStart && timeInMinutes < blockEnd) {
                            busyCount++;
                            return;
                        }
                    }
                });
            });
            return busyCount;
        }
        
        // Use availability data to count all unavailable times
        const weekDays = getWeekDays();
        const targetDate = format(weekDays[dayIndex], 'yyyy-MM-dd');
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
        
        // Count how many members are unavailable at this time
        // For now, we only have the current user's data, so count unavailable slots
        const unavailableSlots = availabilityData.filter(slot => 
            slot.date === targetDate &&
            slot.startTime === timeStr &&
            slot.isAvailable === false
        );
        
        return unavailableSlots.length;
    };

    // Get background color based on busy count
    const getOverlayColor = (count, totalMembers) => {
        if (totalMembers === 0) return 'rgba(229, 231, 235, 0.3)'; // Gray
        if (count === 0) return 'rgba(34, 197, 94, 0.15)'; // Light Green
        if (count === 1) return 'rgba(250, 204, 21, 0.4)'; // Yellow
        if (count === 2) return 'rgba(251, 146, 60, 0.5)'; // Orange
        return 'rgba(239, 68, 68, 0.6)'; // Red (3+)
    };

    // Format hour for display
    const formatHour = (hour) => {
        if (hour === 0) return '12 AM';
        if (hour < 12) return `${hour} AM`;
        if (hour === 12) return '12 PM';
        return `${hour - 12} PM`;
    };

    // Get day index from date (0 = Sunday, 6 = Saturday)
    const getDayIndex = (date) => {
        if (typeof date === 'string') {
            return parseISO(date).getDay();
        }
        return date.getDay();
    };

    // Drag handlers for creating events
    const handleMouseDown = (dayIndex, e) => {
        e.preventDefault();
        const rect = e.currentTarget.getBoundingClientRect();
        const minute = Math.floor(e.clientY - rect.top);
        setIsDragging(true);
        setDragStart({ day: dayIndex, minute });
        setDragEnd({ day: dayIndex, minute });
        setDragPreview({ day: dayIndex, startMinute: minute, endMinute: minute });
    };

    const handleMouseMove = (dayIndex, e) => {
        if (!isDragging || dragStart?.day !== dayIndex) return;
        e.preventDefault();
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        const minute = Math.max(0, Math.min(1439, Math.floor(e.clientY - rect.top)));
        setDragEnd({ day: dayIndex, minute });
        setDragPreview({ 
            day: dayIndex, 
            startMinute: Math.min(dragStart.minute, minute),
            endMinute: Math.max(dragStart.minute, minute)
        });
    };

    const handleMouseUp = (e) => {
        if (e) e.preventDefault();
        if (!isDragging || !dragStart || !dragEnd) {
            setIsDragging(false);
            setDragStart(null);
            setDragEnd(null);
            setDragPreview(null);
            return;
        }
        const startMinute = Math.min(dragStart.minute, dragEnd.minute);
        const endMinute = Math.max(dragStart.minute, dragEnd.minute);
        if (endMinute - startMinute >= 30) {
            const weekDays = getWeekDays();
            const selectedDay = weekDays[dragStart.day];
            const dateStr = format(selectedDay, 'yyyy-MM-dd');
            const startHour = Math.floor(startMinute / 60);
            const startMin = startMinute % 60;
            const timeStr = `${String(startHour).padStart(2, '0')}:${String(startMin).padStart(2, '0')}`;
            const durationMinutes = endMinute - startMinute;
            setPrefillDate(dateStr);
            setPrefillTime(timeStr);
            setSelectedSlotData({ durationMinutes });
            setEventModal(true);
        }
        setIsDragging(false);
        setDragStart(null);
        setDragEnd(null);
        setDragPreview(null);
    };

    // Handle event deletion
    const handleDeleteEvent = async (eventId) => {
        if (!window.confirm('Are you sure you want to delete this event?')) return;
        
        try {
            await eventsAPI.deleteEvent(eventId, user?.sub);
            // Refresh events
            fetchGroupEvents();
        } catch (error) {
            console.error('Error deleting event:', error);
            alert('Failed to delete event. Please try again.');
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

    // Get game events for a specific day
    const getGameEventsForDay = (dayIndex) => {
        const weekDays = getWeekDays();
        const day = weekDays[dayIndex];
        const dateStr = format(day, 'yyyy-MM-dd');
        
        return groupEvents
            .filter(event => {
                if (!event.start_date) return false;
                // Parse the date string - it's stored as UTC ISO string, but we need local time
                // Use parseISO for consistent parsing
                const eventDate = parseISO(event.start_date);
                // Format in local timezone
                const eventDateStr = format(eventDate, 'yyyy-MM-dd');
                return eventDateStr === dateStr;
            })
            .map(event => {
                // Parse the UTC date and get local time components
                // The start_date is stored as UTC ISO string, but we want to display it in local time
                const start = new Date(event.start_date);
                
                // Use local time methods to get hours and minutes
                // Round to nearest minute to avoid fractional second issues
                const startHour = start.getHours();
                const startMin = Math.floor(start.getMinutes()); // Ensure integer minutes
                const duration = event.duration_minutes || 180;
                
                // Calculate end time in minutes, then convert back to hours and minutes
                const startTotalMinutes = startHour * 60 + startMin;
                const endTotalMinutes = startTotalMinutes + duration;
                const endHour = Math.floor(endTotalMinutes / 60) % 24;
                const endMin = endTotalMinutes % 60;
                
                return {
                    id: event.id,
                    title: event.Game?.name || 'Game Session',
                    startHour,
                    startMin,
                    endHour,
                    endMin,
                    event
                };
            });
    };

    if (!user) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    if (!groupId) {
        return (
            <div className="p-6 max-w-4xl mx-auto">
                <p className="text-red-600">No group specified. Please navigate from a group page.</p>
                <Link href="/" className="text-blue-600 hover:underline">Go to Home</Link>
            </div>
        );
    }

    const weekDays = getWeekDays();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const totalMembers = group?.Users?.length || 0;
    const hours = Array.from({ length: 24 }, (_, i) => i);

    const isAdmin = ['owner', 'admin'].includes(userRole);
    const pollClosed = !heatmapPrompt ||
        heatmapPrompt.status === 'closed' ||
        heatmapPrompt.status === 'converted' ||
        (heatmapPrompt.deadline && new Date(heatmapPrompt.deadline) < new Date());

    // Debug logging

    return (
        <div className="p-3 md:p-6 max-w-7xl mx-auto" onMouseUp={handleMouseUp}>
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Home</Link>
                <span className="text-gray-400 mx-2">{'>'}</span>
                {group && (
                    <>
                        <Link href={`/groupHomePage?group_id=${groupId}`} className="text-blue-400 hover:text-blue-300 transition-colors font-medium">
                            {group.name}
                        </Link>
                        <span className="text-gray-400 mx-2">{'>'}</span>
                    </>
                )}
                <span className="text-white font-semibold">Plan Game Session</span>
            </nav>

            {/* Header */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-4">
                    <div>
                        <h1 className="text-2xl md:text-3xl font-bold text-gray-900">
                            {group ? `Plan Game Session - ${group.name}` : 'Plan Game Session'}
                        </h1>
                        <p className="text-sm text-gray-600 mt-1">
                            Click and drag on any day to create a game session
                        </p>
                    </div>
                </div>

                {/* Week Navigation */}
                <div className="flex items-center justify-between mb-4">
                    <button
                        onClick={() => setCurrentWeek(subWeeks(currentWeek, 1))}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                        ← Previous Week
                    </button>
                    <span className="text-lg font-medium text-gray-900">
                        {format(weekDays[0], 'MMM d')} - {format(weekDays[6], 'MMM d, yyyy')}
                    </span>
                    <button
                        onClick={() => setCurrentWeek(addWeeks(currentWeek, 1))}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                    >
                        Next Week →
                    </button>
                </div>
            </div>

            {/* Calendar View */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                {loading ? (
                    <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                ) : !group?.Users || group.Users.length === 0 ? (
                    <p className="text-center text-gray-600 py-8">No group members found. Please add members to the group.</p>
                ) : (
                    <div className="overflow-x-auto">
                        <div className="flex min-w-[900px]">
                            {/* Time labels column - sticky with absolute positioning */}
                            <div className="w-16 flex-shrink-0 bg-white border-r border-gray-300 sticky left-0 z-20">
                                <div className="h-10 border-b border-gray-200 bg-white" /> {/* Header spacer to match day headers */}
                                <div className="relative" style={{ height: '1440px' }}>
                                    {hours.map(hour => (
                                        <div
                                            key={hour}
                                            className="absolute right-0 pr-2 flex items-start justify-end"
                                            style={{ 
                                                top: `${hour * 60}px`,
                                                transform: 'translateY(-8px)'
                                            }}
                                        >
                                            <span className="text-xs text-gray-500 font-medium bg-white px-1">
                                                {formatHour(hour)}
                                            </span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            {/* Days columns */}
                            {weekDays.map((day, dayIndex) => {
                                const dateStr = format(day, 'yyyy-MM-dd');
                                const isToday = format(new Date(), 'yyyy-MM-dd') === dateStr;
                                
                                return (
                                    <div 
                                        key={dayIndex} 
                                        className="flex-1 border-r border-gray-200 relative last:border-r-0"
                                    >
                                        {/* Sticky Day Header - z-30 */}
                                        <div className={`sticky top-0 z-30 bg-white border-b border-gray-200 h-10 flex flex-col items-center justify-center ${isToday ? 'bg-blue-50' : ''}`}>
                                            <div className="text-xs font-semibold text-gray-700">{dayNames[dayIndex]}</div>
                                            <div className={`text-xs font-bold ${isToday ? 'text-blue-600' : 'text-gray-900'}`}>
                                                {format(day, 'd')}
                                            </div>
                                        </div>

                                        {/* Main Container - starts immediately after header, NO top offset */}
                                        <div className="relative" style={{ height: '1440px' }}>
                                            {/* z-0: Heatmap background - KEEP THIS ONE */}
                                            <div className="absolute inset-0 pointer-events-none z-0">
                                                {Array.from({ length: 1440 }, (_, minute) => {
                                                    const hour = Math.floor(minute / 60);
                                                    const min = minute % 60;
                                                    const busyCount = getBusyCountAtTime(dayIndex, hour, min);
                                                    const color = getOverlayColor(busyCount, totalMembers);
                                                    
                                                    return (
                                                        <div
                                                            key={minute}
                                                            style={{
                                                                position: 'absolute',
                                                                top: `${minute}px`,
                                                                left: 0,
                                                                right: 0,
                                                                height: '1px',
                                                                backgroundColor: color,
                                                            }}
                                                        />
                                                    );
                                                })}
                                            </div>

                                            {/* z-0: Hour grid lines */}
                                            <div className="absolute inset-0 pointer-events-none z-0">
                                                {hours.map(hour => (
                                                    <div
                                                        key={hour}
                                                        className="absolute left-0 right-0 border-t border-gray-400"
                                                        style={{ top: `${hour * 60}px` }}
                                                    />
                                                ))}
                                            </div>

                                            {/* z-5: Busy blocks - pointer-events-none */}
                                            <div className="absolute inset-0 pointer-events-none z-[5]">
                                                {Object.entries(busyBlocks).map(([memberName, memberBlocks]) => 
                                                    memberBlocks
                                                        .filter(block => block.day === dayIndex)
                                                        .map((block, blockIndex) => {
                                                            const top = timeToPixels(block.startHour, block.startMin);
                                                            const height = timeToPixels(block.endHour, block.endMin) - top;
                                                            
                                                            return (
                                                                <div
                                                                    key={`${memberName}-${blockIndex}`}
                                                                    className="absolute left-0 right-0 border-l-4 border-red-500 bg-red-100 bg-opacity-40 px-1 py-0.5 rounded-r"
                                                                    style={{
                                                                        top: `${top}px`,
                                                                        height: `${height}px`,
                                                                        minHeight: '20px',
                                                                    }}
                                                                >
                                                                    <div className="text-xs font-medium text-gray-900 truncate">
                                                                        {memberName}
                                                                    </div>
                                                                    <div className="text-xs text-gray-600">
                                                                        {block.source === 'google_calendar' ? 'Google Calendar' : 'Busy'}
                                                                    </div>
                                                                </div>
                                                            );
                                                        })
                                                )}
                                            </div>

                                            {/* z-20: Drag interaction layer - THIS CAPTURES CLICKS */}
                                            <div 
                                                className="absolute inset-0 z-20"
                                                style={{
                                                    cursor: isDragging && dragStart?.day === dayIndex ? 'ns-resize' : 'crosshair',
                                                    touchAction: 'none'
                                                }}
                                                onMouseDown={(e) => handleMouseDown(dayIndex, e)}
                                                onMouseMove={(e) => handleMouseMove(dayIndex, e)}
                                                onMouseUp={handleMouseUp}
                                            />

                                            {/* z-25: Game events - pointer-events-none except delete button */}
                                            <div className="absolute inset-0 pointer-events-none z-[25]">
                                                {getGameEventsForDay(dayIndex).map(event => {
                                                    const top = timeToPixels(event.startHour, event.startMin);
                                                    const height = timeToPixels(event.endHour, event.endMin) - top;
                                                    
                                                    return (
                                                        <div
                                                            key={event.id}
                                                            className="group absolute left-0 right-0 border-l-4 border-green-600 bg-green-600 bg-opacity-20 px-1 py-0.5"
                                                            style={{
                                                                top: `${top}px`,
                                                                height: `${height}px`,
                                                                minHeight: '40px',
                                                            }}
                                                        >
                                                            <div className="text-xs font-semibold text-gray-900 truncate">
                                                                {event.title}
                                                            </div>
                                                            <div className="text-xs text-gray-600">
                                                                {formatHour(event.startHour)} - {formatHour(event.endHour)}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleDeleteEvent(event.id);
                                                                }}
                                                                className="absolute top-1 right-1 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 hover:bg-red-600 flex items-center justify-center text-xs font-bold pointer-events-auto"
                                                            >
                                                                ×
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* z-30: Drag preview */}
                                            {dragPreview && dragPreview.day === dayIndex && (
                                                <div
                                                    className="absolute left-0 right-0 border-l-4 border-blue-600 bg-blue-600 bg-opacity-30 pointer-events-none z-30 rounded-r px-2 py-1"
                                                    style={{
                                                        top: `${dragPreview.startMinute}px`,
                                                        height: `${Math.max(20, dragPreview.endMinute - dragPreview.startMinute)}px`,
                                                    }}
                                                >
                                                    <div className="text-xs font-semibold text-gray-900">New Event</div>
                                                    <div className="text-xs text-gray-600">
                                                        {Math.floor((dragPreview.endMinute - dragPreview.startMinute) / 60)}h {(dragPreview.endMinute - dragPreview.startMinute) % 60}m
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Legend */}
                <div className="mt-6 flex flex-wrap gap-4 text-sm">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.15)' }}></div>
                        <span className="text-gray-900">Everyone Available (0 busy)</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgba(250, 204, 21, 0.4)' }}></div>
                        <span className="text-gray-900">1 Person Busy</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgba(251, 146, 60, 0.5)' }}></div>
                        <span className="text-gray-900">2 People Busy</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.6)' }}></div>
                        <span className="text-gray-900">3+ People Busy</span>
                    </div>
                </div>
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
