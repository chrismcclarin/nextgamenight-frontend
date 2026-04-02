'use client';

import { useState, useEffect } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { useSearchParams } from 'next/navigation';
import { groupsAPI, eventsAPI, promptAPI } from '../../lib/api';
import Link from 'next/link';
import CreateEvent from '../components/createEvent';
import ResponseDashboard from '../components/ResponseDashboard';
import PromptScheduleSection from '../components/PromptScheduleSection';

export default function GroupPlanningPage() {
    const { user, isLoading: authLoading } = Auth();
    const searchParams = useSearchParams();
    const groupId = searchParams.get('group_id');
    const promptId = searchParams.get('prompt_id');

    const [group, setGroup] = useState(null);
    const [groupEvents, setGroupEvents] = useState([]);

    // Modal state for CreateEvent
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
            fetchUserRole();
        }
    }, [user, groupId]);

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
            setHeatmapError(err.message || 'Failed to load poll data');
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
        <div className="p-3 md:p-6 max-w-7xl mx-auto">
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
                <span className="text-content-inverse font-semibold">Plan Game Session</span>
            </nav>

            {/* Header */}
            <div className="card p-4 md:p-6 mb-6">
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

            {/* Availability Polls + Response Dashboard in one card */}
            <div className="card p-4 md:p-6 mb-6">
                <h2 className="text-xl font-bold text-content-primary mb-4">Availability Polls</h2>
                <div className="bg-surface-page rounded-lg p-4">
                    <PromptScheduleSection
                        groupId={groupId}
                        group={group}
                        userRole={userRole}
                        defaultExpanded={true}
                    />

                    {/* Response Dashboard */}
                    <div className="mt-4 pt-4 border-t border-line">
                        {heatmapLoading ? (
                            <p className="text-center text-content-secondary py-4">Loading poll data...</p>
                        ) : heatmapError ? (
                            <p className="text-center text-status-error py-4">{heatmapError}</p>
                        ) : heatmapPrompt ? (
                            <>
                                <h3 className="text-lg font-semibold text-content-primary mb-3">Poll Responses</h3>
                                <ResponseDashboard
                                    promptId={heatmapPrompt.id}
                                    isAdmin={isAdmin}
                                    currentUserId={user?.sub}
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

            {/* Create Event Modal */}
            <CreateEvent
                group_id={groupId}
                modal={eventModal}
                modaltoggle={toggleEventModal}
                onEventCreated={(newEvent) => {
                    handleEventCreated(newEvent);
                    fetchGroupEvents();
                }}
                user={user}
                hideVisualCalendar={true}
            />
        </div>
    );
}
