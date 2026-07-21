'use client';
import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import GroupList from '../components/grouplist';
import EventCalendar from '../components/EventCalendar';
import FriendInvitePanel from '../components/FriendInvitePanel';
import UpcomingEventsCard from '../components/UpcomingEventsCard';
import { eventsAPI } from '../../lib/api';
// Phase 87.3-07 (D-02): the viewer's User.id UUID resolves via the shared
// ['users','self'] query instead of an ad-hoc getUser self-fetch.
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';

// List of all the groups for the logged in User
function UserHome({ GroupList: propGroupList, getGroupList, onCreateGroup, groupListRefreshKey, onMemberAdded: onMemberAddedProp }) {
    const { user } = Auth();
    const searchParams = useSearchParams();
    // Phase 71.1 GAMP-07: viewer's User.id UUID (NOT Auth0 string), used by
    // UpcomingEventsCard to match EventParticipations rows for game-only-event
    // Guest-pill distinction. Phase 87.3-07 (D-02): resolved via the shared
    // ['users','self'] query instead of a per-page getUser self-fetch.
    const { selfUuid } = useSelfIdentity();
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [invitePanelOpen, setInvitePanelOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);
    const [upcomingEvents, setUpcomingEvents] = useState([]);
    const [upcomingLoading, setUpcomingLoading] = useState(false);

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
        eventsAPI.getUserEvents(selfUuid).then(evts => {
            if (cancelled) return;
            const list = Array.isArray(evts) ? evts : [];
            // UpcomingEventsCard does its own filter+sort; pass the raw list.
            setUpcomingEvents(list);
        }).catch(err => {
            console.error('[UserHomePage] Failed to fetch upcoming events:', err);
        }).finally(() => {
            if (!cancelled) setUpcomingLoading(false);
        });
        return () => { cancelled = true; };
    }, [user?.sub, refreshKey, selfUuid]);

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
        <div className="user-home-container p-4 md:p-6">
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
                        className="text-amber-700 dark:text-amber-200 hover:underline text-xs flex-shrink-0"
                        aria-label="Dismiss"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                <div className="w-full md:w-auto md:flex-shrink-0 md:flex-[0_0_400px] md:relative">
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
                    <UpcomingEventsCard
                        events={upcomingEvents}
                        loading={upcomingLoading}
                        showGroupName={true}
                        viewerDbUserId={selfUuid ?? null}
                    />
                </div>
            </div>

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
