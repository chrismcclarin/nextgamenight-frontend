'use client';
import { useState, useEffect } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import GroupList from '../components/grouplist';
import EventCalendar from '../components/EventCalendar';
import FriendInvitePanel from '../components/FriendInvitePanel';

// List of all the groups for the logged in User
function UserHome({ GroupList: propGroupList, getGroupList, onCreateGroup, groupListRefreshKey, onMemberAdded: onMemberAddedProp }) {
    const { user } = Auth();
    const [selectedGroup, setSelectedGroup] = useState(null);
    const [invitePanelOpen, setInvitePanelOpen] = useState(false);
    const [refreshKey, setRefreshKey] = useState(0);

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
        // Refresh group list after adding a member
        if (getGroupList) {
            getGroupList();
        }
        // Trigger GroupList component refresh by incrementing refreshTrigger
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
        <div className="user-home-container flex flex-col md:flex-row gap-4 md:gap-6 p-4 md:p-6">
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

            {/* Hide calendar on mobile (smaller than md breakpoint) */}
            <div className="hidden md:block flex-1 min-w-0">
                <EventCalendar refreshKey={refreshKey} />
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
