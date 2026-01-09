'use client';

import { useState, useEffect } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams, useRouter } from 'next/navigation';
import { availabilityAPI, groupsAPI } from '../../lib/api';
import Link from 'next/link';
import { format, startOfMonth, endOfMonth, eachDayOfInterval, addDays, addMonths, subMonths, isSameDay, parseISO } from 'date-fns';

export default function GroupPlanningPage() {
    const { user } = Auth();
    const searchParams = useSearchParams();
    const router = useRouter();
    const groupId = searchParams.get('group_id');
    
    const [group, setGroup] = useState(null);
    const [overlaps, setOverlaps] = useState([]);
    const [loading, setLoading] = useState(true);
    const [selectedSlot, setSelectedSlot] = useState(null);
    const [viewMode, setViewMode] = useState('calendar'); // 'calendar' or 'list'
    const [currentMonth, setCurrentMonth] = useState(new Date());
    const [minAvailableMembers, setMinAvailableMembers] = useState(1);
    const [timeFilter, setTimeFilter] = useState('all'); // 'all', 'morning', 'afternoon', 'evening'
    const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');

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

    const getDaysInMonth = () => {
        const start = startOfMonth(currentMonth);
        const end = endOfMonth(currentMonth);
        return eachDayOfInterval({ start, end });
    };

    const filteredOverlaps = overlaps.filter(slot => {
        const slotData = getSlotAvailability(slot.date, slot.timeSlot);
        return slotData.availableCount >= minAvailableMembers;
    });

    const handleSlotClick = (date, timeSlot) => {
        const slotData = getSlotAvailability(date, timeSlot);
        if (slotData.availableCount > 0) {
            setSelectedSlot({ date, timeSlot, ...slotData });
        }
    };

    const handleCreateEvent = () => {
        if (!selectedSlot) return;
        const dateTime = `${selectedSlot.date}T${selectedSlot.timeSlot}`;
        router.push(`/groupHomePage?group_id=${groupId}&create_event=true&date=${selectedSlot.date}&time=${selectedSlot.timeSlot}`);
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
                            Find the best time when all group members are available
                        </p>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setViewMode(viewMode === 'calendar' ? 'list' : 'calendar')}
                            className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 text-sm"
                        >
                            {viewMode === 'calendar' ? 'List View' : 'Calendar View'}
                        </button>
                    </div>
                </div>

                {/* Filters */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                                        // Allow empty input temporarily while typing
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
                        <label className="block text-sm font-medium text-gray-700 mb-1">Time of Day</label>
                        <select
                            value={timeFilter}
                            onChange={(e) => setTimeFilter(e.target.value)}
                            className="w-full p-2 border rounded text-gray-900 bg-white"
                        >
                            <option value="all">All Day</option>
                            <option value="morning">Morning (Before 12 PM)</option>
                            <option value="afternoon">Afternoon (12 PM - 5 PM)</option>
                            <option value="evening">Evening (After 5 PM)</option>
                        </select>
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
            {viewMode === 'calendar' && (
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
                    {loading ? (
                        <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                    ) : (
                        <div className="overflow-x-auto" style={{ WebkitOverflowScrolling: 'touch' }}>
                            <div style={{ display: 'inline-block', width: 'max-content' }}>
                            {/* Day Headers */}
                            <div className="grid gap-1 mb-2" style={{ gridTemplateColumns: `60px repeat(${getDaysInMonth().length}, minmax(60px, 1fr))`, width: 'max-content' }}>
                                <div className="font-semibold text-gray-700 text-sm p-2 z-20 border-r shadow-sm" style={{ position: 'sticky', left: 0, backgroundColor: 'white', minWidth: '60px', zIndex: 20, boxShadow: '2px 0 4px rgba(0,0,0,0.1)' }}>Time</div>
                                {getDaysInMonth().map(day => (
                                    <div key={day.toISOString()} className="font-semibold text-gray-700 text-sm p-2 text-center border-b">
                                        {format(day, 'EEE')}<br />
                                        <span className="text-xs">{format(day, 'd')}</span>
                                    </div>
                                ))}
                            </div>

                            {/* Time Slots */}
                            <div className="space-y-1">
                                {getTimeSlots().map(timeSlot => (
                                    <div key={timeSlot} className="grid gap-1" style={{ gridTemplateColumns: `60px repeat(${getDaysInMonth().length}, minmax(60px, 1fr))`, width: 'max-content' }}>
                                        <div className="text-xs text-gray-600 p-1 text-right z-10 border-r shadow-sm" style={{ position: 'sticky', left: 0, backgroundColor: 'white', minWidth: '60px', zIndex: 10, boxShadow: '2px 0 4px rgba(0,0,0,0.1)' }}>
                                            {timeSlot}
                                        </div>
                                        {getDaysInMonth().map(day => {
                                            const dateStr = format(day, 'yyyy-MM-dd');
                                            const slotData = getSlotAvailability(dateStr, timeSlot);
                                            const color = getSlotColor(slotData.availableCount, slotData.totalMembers);
                                            const isClickable = slotData.availableCount >= minAvailableMembers;
                                            
                                            return (
                                                <div
                                                    key={`${dateStr}-${timeSlot}`}
                                                    onClick={() => isClickable && handleSlotClick(dateStr, timeSlot)}
                                                    className={`${color} ${isClickable ? 'cursor-pointer hover:opacity-80' : 'opacity-50'} p-1 rounded text-xs text-center text-white font-medium min-h-[24px] flex items-center justify-center`}
                                                    title={`${slotData.availableCount}/${slotData.totalMembers} available`}
                                                >
                                                    {slotData.availableCount > 0 && slotData.availableCount}
                                                </div>
                                            );
                                        })}
                                    </div>
                                ))}
                            </div>

                            {/* Legend */}
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

            {/* List View */}
            {viewMode === 'list' && (
                <div className="bg-white rounded-lg shadow-md p-4 md:p-6">
                    {loading ? (
                        <p className="text-center text-gray-600 py-8">Loading availability data...</p>
                    ) : filteredOverlaps.length > 0 ? (
                        <div className="space-y-2">
                            {filteredOverlaps.map((slot, index) => (
                                <div
                                    key={`${slot.date}-${slot.timeSlot}-${index}`}
                                    onClick={() => handleSlotClick(slot.date, slot.timeSlot)}
                                    className="p-4 border rounded-lg hover:bg-gray-50 cursor-pointer"
                                >
                                    <div className="flex justify-between items-center">
                                        <div>
                                            <p className="font-semibold text-gray-900">
                                                {format(parseISO(slot.date), 'EEEE, MMMM d, yyyy')} at {slot.timeSlot}
                                            </p>
                                            <p className="text-sm text-gray-600">
                                                {slot.availableCount} of {slot.totalMembers} members available
                                            </p>
                                        </div>
                                        <div className="text-right">
                                            <div className={`inline-block px-3 py-1 rounded text-white text-sm font-medium ${
                                                getSlotColor(slot.availableCount, slot.totalMembers)
                                            }`}>
                                                {Math.round((slot.availableCount / slot.totalMembers) * 100)}%
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    ) : (
                        <p className="text-center text-gray-600 py-8">
                            No time slots found matching your criteria. Try adjusting the filters.
                        </p>
                    )}
                </div>
            )}

            {/* Slot Detail Modal */}
            {selectedSlot && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[90vh] overflow-hidden flex flex-col">
                        <div className="flex justify-between items-center p-4 border-b">
                            <h3 className="text-lg font-semibold text-gray-900">
                                {format(parseISO(selectedSlot.date), 'EEEE, MMMM d, yyyy')} at {selectedSlot.timeSlot}
                            </h3>
                            <button
                                onClick={() => setSelectedSlot(null)}
                                className="text-gray-500 hover:text-gray-700 text-2xl"
                            >
                                &times;
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto space-y-4">
                            <div>
                                <p className="font-semibold text-gray-900 mb-2">
                                    {selectedSlot.availableCount} of {selectedSlot.totalMembers} members available
                                </p>
                                <div className="space-y-2">
                                    <div>
                                        <p className="text-sm font-medium text-gray-700 mb-1">Available Members:</p>
                                        <div className="flex flex-wrap gap-2">
                                            {selectedSlot.availableMembers.map(member => (
                                                <span
                                                    key={member.user_id}
                                                    className="px-2 py-1 bg-green-100 text-green-800 rounded text-sm"
                                                >
                                                    {member.username || member.email}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                    {selectedSlot.unavailableCount > 0 && (
                                        <div>
                                            <p className="text-sm font-medium text-gray-700 mb-1">
                                                Unavailable Members ({selectedSlot.unavailableCount}):
                                            </p>
                                            <p className="text-sm text-gray-600">
                                                Check individual member availability for details
                                            </p>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                        <div className="p-4 border-t flex gap-2">
                            <button
                                onClick={handleCreateEvent}
                                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                            >
                                Create Event at This Time
                            </button>
                            <button
                                onClick={() => setSelectedSlot(null)}
                                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                            >
                                Close
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

