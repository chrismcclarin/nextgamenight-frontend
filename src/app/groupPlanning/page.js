'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { availabilityAPI, groupsAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addDays, addMonths, subMonths, isSameDay, parseISO, startOfWeek, endOfWeek } from 'date-fns';

export default function GroupPlanningPage() {
    const { user } = Auth();
    const searchParams = useSearchParams();
    const groupId = searchParams.get('group_id');
    
    const [group, setGroup] = useState(null);
    const [overlaps, setOverlaps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(null); // Selected date for day view
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [minAvailableMembers, setMinAvailableMembers] = useState(1);
    const [timeFilter, setTimeFilter] = useState('all'); // 'all', 'morning', 'afternoon', 'evening'
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
    
    // Modal state for CreateEvent
    const [eventModal, setEventModal] = useState(false);
    const [prefillDate, setPrefillDate] = useState(null);
    const [prefillTime, setPrefillTime] = useState(null);
    const [selectedSlotData, setSelectedSlotData] = useState(null); // Store availability data for selected slot

    useEffect(() => {
        if (user?.sub && groupId) {
            fetchGroup();
            fetchOverlaps();
        }
    }, [user, groupId, currentMonth, timezone]);

    const fetchGroup = async () => {
        if (!groupId) return;
        try {
            const groupData = await groupsAPI.getGroup(groupId);
            setGroup(groupData);
        } catch (error) {
            console.error('Error fetching group:', error);
            alert('Failed to load group. Please try again.');
        }
    };

    const fetchOverlaps = async () => {
        if (!groupId) return;
        try {
            setLoading(true);
            const startDate = startOfMonth(currentMonth);
            const endDate = endOfMonth(currentMonth);
            
            const overlapsData = await availabilityAPI.getGroupOverlaps(
                groupId,
                startDate.toISOString().split('T')[0],
                endDate.toISOString().split('T')[0],
                timezone
            );
            
            setOverlaps(overlapsData || []);
        } catch (error) {
            console.error('Error fetching overlaps:', error);
            alert('Failed to load availability data. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    const getSlotAvailability = (date, timeSlot) => {
        const slot = overlaps.find(
            o => o.date === date && o.timeSlot === timeSlot
        );
        return slot || { availableCount: 0, totalMembers: 0, availableMembers: [] };
    };

    const getSlotColor = (availableCount, totalMembers) => {
        if (totalMembers === 0) return 'bg-gray-200';
        const percentage = (availableCount / totalMembers) * 100;
        if (percentage === 100) return 'bg-green-500';
        if (percentage >= 50) return 'bg-yellow-400';
        if (percentage > 0) return 'bg-orange-400';
        return 'bg-red-400';
    };

    // Calculate daily availability (aggregate all time slots for each day)
    const dailyAvailability = useMemo(() => {
        const daily = {};
        overlaps.forEach(slot => {
            if (!daily[slot.date]) {
                daily[slot.date] = {
                    date: slot.date,
                    totalMembers: slot.totalMembers,
                    maxAvailable: 0,
                    minAvailable: slot.totalMembers,
                    totalSlots: 0,
                    availableSlots: 0
                };
            }
            const day = daily[slot.date];
            day.maxAvailable = Math.max(day.maxAvailable, slot.availableCount);
            day.minAvailable = Math.min(day.minAvailable, slot.availableCount);
            day.totalSlots++;
            if (slot.availableCount > 0) {
                day.availableSlots++;
            }
        });
        
        // Calculate average availability percentage for the day
        Object.keys(daily).forEach(date => {
            const day = daily[date];
            // Use max available count for the day as the primary indicator
            day.averagePercentage = day.totalMembers > 0 
                ? (day.maxAvailable / day.totalMembers) * 100 
                : 0;
        });
        
        return daily;
    }, [overlaps]);

    const getDayColor = (dateStr) => {
        const day = dailyAvailability[dateStr];
        if (!day || day.totalMembers === 0) return 'bg-gray-200';
        const percentage = day.averagePercentage;
        if (percentage === 100) return 'bg-green-500';
        if (percentage >= 50) return 'bg-yellow-400';
        if (percentage > 0) return 'bg-orange-400';
        return 'bg-red-400';
    };

    const getTimeSlots = () => {
        const slots = [];
        for (let hour = 0; hour < 24; hour++) {
            for (let minute = 0; minute < 60; minute += 30) {
                const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
                if (timeFilter === 'all') {
                    slots.push(timeStr);
                } else if (timeFilter === 'morning' && hour < 12) {
                    slots.push(timeStr);
                } else if (timeFilter === 'afternoon' && hour >= 12 && hour < 17) {
                    slots.push(timeStr);
                } else if (timeFilter === 'evening' && hour >= 17) {
                    slots.push(timeStr);
                }
            }
        }
        return slots;
    };

    // Get calendar grid days (including empty cells for alignment)
    const getCalendarDays = () => {
        const start = startOfMonth(currentMonth);
        const startWeek = startOfWeek(start, { weekStartsOn: 0 }); // Sunday = 0
        const end = endOfMonth(currentMonth);
        const endWeek = endOfWeek(end, { weekStartsOn: 0 });
        
        return eachDayOfInterval({ start: startWeek, end: endWeek });
    };

    const handleDateClick = (date) => {
        if (!date) return;
        const dateStr = format(date, 'yyyy-MM-dd');
        // Check if this date has any availability data
        if (dailyAvailability[dateStr] || overlaps.some(o => o.date === dateStr)) {
            setSelectedDate(dateStr);
        }
    };

    const handleTimeSlotClick = (dateStr, timeSlot) => {
        const slotData = getSlotAvailability(dateStr, timeSlot);
        if (slotData.availableCount >= minAvailableMembers) {
            setPrefillDate(dateStr);
            setPrefillTime(timeSlot);
            setSelectedSlotData(slotData);
            setEventModal(true);
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
        // Optionally refresh overlaps after event creation
        // For now, just close the modal
        toggleEventModal();
    };

    const isToday = (date) => {
        if (!date) return false;
        const today = new Date();
        return date.toDateString() === today.toDateString();
    };

    const isSelected = (date) => {
        if (!date || !selectedDate) return false;
        return format(date, 'yyyy-MM-dd') === selectedDate;
    };

    const isCurrentMonth = (date) => {
        if (!date) return false;
        return date.getMonth() === currentMonth.getMonth() && date.getFullYear() === currentMonth.getFullYear();
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

    const calendarDays = getCalendarDays();
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const selectedDaySlots = selectedDate ? overlaps.filter(o => o.date === selectedDate) : [];

    return (
        <div className="p-3 md:p-6 max-w-7xl mx-auto">
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
                            Click on a date to see detailed availability for that day
                        </p>
                    </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                            Minimum Available Members
                        </label>
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min="1"
                                max={group?.Users?.length || 10}
                                step="1"
                                value={minAvailableMembers}
                                onChange={(e) => {
                                    const inputValue = e.target.value;
                                    if (inputValue === '') {
                                        return;
                                    }
                                    const val = parseInt(inputValue);
                                    if (!isNaN(val)) {
                                        const max = group?.Users?.length || 10;
                                        const clampedValue = Math.min(Math.max(1, val), max);
                                        setMinAvailableMembers(clampedValue);
                                    }
                                }}
                                onBlur={(e) => {
                                    const val = parseInt(e.target.value);
                                    if (isNaN(val) || val < 1) {
                                        setMinAvailableMembers(1);
                                    } else {
                                        const max = group?.Users?.length || 10;
                                        const clampedValue = Math.min(val, max);
                                        setMinAvailableMembers(clampedValue);
                                    }
                                }}
                                className="w-20 p-2 border rounded text-gray-900 bg-white text-center focus:outline-none focus:ring-2 focus:ring-blue-500"
                            />
                            <span className="text-sm text-gray-600 whitespace-nowrap">
                                of {group?.Users?.length || '?'} members
                            </span>
                        </div>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Month</label>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setCurrentMonth(subMonths(currentMonth, 1))}
                                className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                            >
                                ←
                            </button>
                            <span className="flex-1 text-center font-medium text-black">
                                {format(currentMonth, 'MMMM yyyy')}
                            </span>
                            <button
                                onClick={() => setCurrentMonth(addMonths(currentMonth, 1))}
                                className="px-3 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                            >
                                →
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* Calendar View */}
            <div className="bg-white rounded-lg shadow-md p-4 md:p-6 mb-6">
                {loading ? (
                    <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                ) : (
                    <>
                        {/* Calendar Grid */}
                        <div className="mb-6">
                            {/* Day Headers */}
                            <div className="grid grid-cols-7 gap-1 mb-1">
                                {dayNames.map(day => (
                                    <div key={day} className="text-center text-sm font-semibold text-gray-700 p-2">
                                        {day}
                                    </div>
                                ))}
                            </div>

                            {/* Calendar Days */}
                            <div className="grid grid-cols-7 gap-1">
                                {calendarDays.map((day, index) => {
                                    const dateStr = day ? format(day, 'yyyy-MM-dd') : null;
                                    const dayData = dateStr ? dailyAvailability[dateStr] : null;
                                    const color = dateStr ? getDayColor(dateStr) : 'bg-gray-100';
                                    const inCurrentMonth = day ? isCurrentMonth(day) : false;
                                    const today = day ? isToday(day) : false;
                                    const selected = day ? isSelected(day) : false;

                                    return (
                                        <div
                                            key={index}
                                            onClick={() => handleDateClick(day)}
                                            className={`
                                                aspect-square p-1 rounded cursor-pointer transition-all
                                                ${inCurrentMonth ? color : 'bg-gray-100'}
                                                ${!day || !inCurrentMonth ? 'opacity-30' : 'hover:opacity-80'}
                                                ${selected ? 'ring-2 ring-blue-500 ring-offset-2' : ''}
                                                ${today ? 'ring-1 ring-gray-400' : ''}
                                            `}
                                            title={dayData ? `${dayData.maxAvailable}/${dayData.totalMembers} max available` : ''}
                                        >
                                            <div className="flex flex-col h-full justify-center items-center">
                                                {day && (
                                                    <span className={`
                                                        text-sm font-medium
                                                        ${inCurrentMonth && dayData && dayData.maxAvailable > 0 ? 'text-white' : 'text-gray-900'}
                                                    `}>
                                                        {format(day, 'd')}
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Legend */}
                        <div className="flex flex-wrap gap-4 text-sm mb-4">
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-green-500 rounded"></div>
                                <span className="text-gray-900">All Available</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-yellow-400 rounded"></div>
                                <span className="text-gray-900">50%+ Available</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-orange-400 rounded"></div>
                                <span className="text-gray-900">Some Available</span>
                            </div>
                            <div className="flex items-center gap-2">
                                <div className="w-4 h-4 bg-red-400 rounded"></div>
                                <span className="text-gray-900">None Available</span>
                            </div>
                        </div>
                    </>
                )}
            </div>

            {/* Day Detail View (Time Grid) */}
            {selectedDate && (
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-gray-900">
                            {format(parseISO(selectedDate), 'EEEE, MMMM d, yyyy')}
                        </h2>
                        <button
                            onClick={() => setSelectedDate(null)}
                            className="text-gray-500 hover:text-gray-700 px-3 py-1 rounded hover:bg-gray-100"
                        >
                            Close
                        </button>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium text-gray-700 mb-1">Time of Day</label>
                        <select
                            value={timeFilter}
                            onChange={(e) => setTimeFilter(e.target.value)}
                            className="w-full md:w-auto p-2 border rounded text-gray-900 bg-white"
                        >
                            <option value="all">All Day</option>
                            <option value="morning">Morning (Before 12 PM)</option>
                            <option value="afternoon">Afternoon (12 PM - 5 PM)</option>
                            <option value="evening">Evening (After 5 PM)</option>
                        </select>
                    </div>

                    {loading ? (
                        <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <div className="inline-block min-w-full">
                                {/* Time Grid */}
                                <div className="space-y-1">
                                    {getTimeSlots().map(timeSlot => {
                                        const slotData = getSlotAvailability(selectedDate, timeSlot);
                                        const color = getSlotColor(slotData.availableCount, slotData.totalMembers);
                                        const isClickable = slotData.availableCount >= minAvailableMembers;

                                        return (
                                            <div
                                                key={timeSlot}
                                                onClick={() => handleTimeSlotClick(selectedDate, timeSlot)}
                                                className={`
                                                    grid grid-cols-[80px_1fr] gap-2 p-2 rounded
                                                    ${isClickable ? 'cursor-pointer hover:bg-gray-50' : 'opacity-50'}
                                                `}
                                            >
                                                <div className="text-sm text-gray-600 font-medium">
                                                    {timeSlot}
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <div className={`
                                                        flex-1 h-8 rounded flex items-center justify-center
                                                        ${color} text-white text-sm font-medium
                                                    `}>
                                                        {slotData.availableCount > 0 && (
                                                            <span>{slotData.availableCount}/{slotData.totalMembers}</span>
                                                        )}
                                                    </div>
                                                    {isClickable && (
                                                        <span className="text-xs text-gray-500">Click to create event</span>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>

                                {/* Legend for Day View */}
                                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 bg-green-500 rounded"></div>
                                        <span className="text-gray-900">All Available</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 bg-yellow-400 rounded"></div>
                                        <span className="text-gray-900">50%+ Available</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 bg-orange-400 rounded"></div>
                                        <span className="text-gray-900">Some Available</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <div className="w-4 h-4 bg-red-400 rounded"></div>
                                        <span className="text-gray-900">None Available</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Create Event Modal */}
            <CreateEvent
                group_id={groupId}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                onEventCreated={handleEventCreated}
                user={user}
                prefillDate={prefillDate}
                prefillTime={prefillTime}
            />
        </div>
    );
}
