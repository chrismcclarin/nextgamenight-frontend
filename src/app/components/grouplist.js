// src/components/GroupList.js
'use client'
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import GroupSettings from './GroupSettings';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { groupsAPI } from '../../lib/api';
import { getTextStyle } from '../../lib/colorUtils';
import { formatDate } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import FriendshipStatusProvider from './FriendshipStatusProvider';
import ClickableMemberName from './ClickableMemberName';

const GroupList = ({ onGroupSelect, onCreateGroup, user, onGroupSettingsUpdated, refreshTrigger }) => {
  const router = useRouter();
  const { user: authUser } = Auth();
  const { timezone } = useTimezone();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsGroup, setSettingsGroup] = useState(null);
  const [userRoles, setUserRoles] = useState({});

  useEffect(() => {
    if (user) {
      fetchGroups();
    }
  }, [user, refreshTrigger]); // Add refreshTrigger to dependencies

  const fetchGroups = async () => {
    if (!user?.sub) return;
    
    try {
      setLoading(true);
      // Use groupsAPI.getUserGroups which automatically includes Authorization header
      const groupsData = await groupsAPI.getUserGroups(user.sub);
      setGroups(groupsData || []);
      
      // Extract user roles from groups
      const roles = {};
      if (groupsData && Array.isArray(groupsData)) {
        groupsData.forEach(group => {
          if (group.Users && Array.isArray(group.Users)) {
            const userMember = group.Users.find(u => u.user_id === user?.sub);
            if (userMember) {
              // Role is in UserGroup object from the through relationship
              roles[group.id] = userMember.UserGroup?.role || 'member';
            }
          }
        });
      }
      setUserRoles(roles);
    } catch (error) {
      console.error('Error fetching groups:', error.message || 'Unknown error');
      setGroups([]);
    } finally {
      setLoading(false);
    }
  };


  const handleGroupClick = (group, e) => {
    // Navigate to group page instead of opening modal
    e?.preventDefault();
    router.push(`/groupHomePage?id=${encodeURIComponent(group.id)}`);
  };

  if (loading) {
    return (
      <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card p-4 flex flex-col overflow-hidden h-full">
        <div className="text-center py-8 px-4 text-content-muted">Loading groups...</div>
      </div>
    );
  }

  return (
    <FriendshipStatusProvider>
    <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card p-4 flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
        {onCreateGroup && (
          <button
            className="btn btn-primary text-sm whitespace-nowrap"
            onClick={onCreateGroup}
            aria-label="Create new group"
            data-tutorial="create-group-btn"
          >
            + Create New Group
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-4 pb-8 flex flex-col gap-4 max-md:max-h-[60vh] max-md:p-3">
        {groups.length === 0 ? (
          <div className="text-center py-8 px-4 text-content-muted">
            <p className="my-2">No groups yet!</p>
            <p className="my-2">Create your first group to get started.</p>
          </div>
        ) : (
          groups.map((group) => {
            // Get users from the group (Users array from backend)
            const groupUsers = group.Users || [];
            const lastEvent = group.Events?.[0]; // First event from the included events
            const lastGame = lastEvent?.Game;

            // Get user role - check both userRoles state and directly from group.Users
            let userRole = userRoles[group.id];
            if (!userRole && group.Users) {
              const userMember = group.Users.find(u => u.user_id === user?.sub);
              userRole = userMember?.UserGroup?.role || userMember?.role;
            }
            const canEdit = userRole === 'owner' || userRole === 'admin';
            const bgColor = group.background_color || '#ffffff';
            const bgImage = group.background_image_url;
            const profilePic = group.profile_picture_url;

            return (
              <div
                key={group.id}
                className="bg-surface-card rounded-card p-4 pl-5 shadow-theme-sm cursor-pointer transition-all duration-200 border border-line border-l-4 border-l-accent relative hover:-translate-y-0.5 hover:shadow-theme-md hover:border-l-accent-hover hover:bg-surface-card-hover focus:outline-none focus:border-focus-ring"
                onClick={(e) => handleGroupClick(group, e)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    handleGroupClick(group, e);
                  }
                }}
                style={{
                  backgroundColor: bgColor,
                  backgroundImage: bgImage ? `url(${bgImage})` : 'none',
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {bgImage && (
                  <div className="absolute inset-0 bg-white/85 z-0 rounded-card" />
                )}
                <div className="relative z-[1]">
                  <div className="flex justify-between items-center mb-3 max-[480px]:flex-col max-[480px]:items-start max-[480px]:gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {profilePic && (
                        <div className="w-10 h-10 rounded-full bg-surface-card-hover flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
                          {profilePic.startsWith('http') || profilePic.startsWith('/') ? (
                            <SafeImage
                              src={profilePic}
                              alt={group.name}
                              fallbackIcon="👥"
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <span>{profilePic}</span>
                          )}
                        </div>
                      )}
                      <h3
                        className="text-[1.1rem] font-semibold text-content-primary flex-1 min-w-0 break-words max-md:text-base"
                        style={getTextStyle(bgImage, bgColor)}
                      >
                        {group.name}
                      </h3>
                    </div>
                    <span
                      className="bg-btn-primary text-btn-primary-text px-2.5 py-0.5 rounded-xl text-xs font-semibold ml-2 flex-shrink-0 max-[480px]:self-end max-[480px]:ml-0"
                      style={getTextStyle(bgImage, bgColor)}
                    >
                      {groupUsers.length} {groupUsers.length === 1 ? 'player' : 'players'}
                    </span>
                  </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {groupUsers
                    .filter((member) => member.user_id !== user?.sub)
                    .slice(0, 4)
                    .map((member, index) => (
                      <span key={member.id || index} className="bg-surface-card-hover text-content-secondary px-2 py-1 rounded-md text-[0.8rem] border border-line">
                        <ClickableMemberName userId={member.user_id} username={member.username || member.email} />
                      </span>
                    ))}
                  {groupUsers.filter((member) => member.user_id !== user?.sub).length > 4 && (
                    <span className="bg-surface-card-hover text-content-muted px-2 py-1 rounded-md text-[0.8rem] border border-line font-medium">
                      +{groupUsers.length - 5} more
                    </span>
                  )}
                </div>

                <div className="border-t border-line pt-3" style={getTextStyle(bgImage, bgColor)}>
                  <div className="text-content-secondary text-sm mb-1">
                    <strong className="text-content-primary">Last Game:</strong> {lastGame?.name || 'None'}
                  </div>
                  <div className="text-content-muted text-xs">
                    {formatDate(lastEvent?.start_date || lastEvent?.createdAt, timezone)}
                  </div>
                </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-3 relative z-[2]">
                    {canEdit && (
                      <button
                        className="btn btn-primary text-sm flex-1 shadow-md hover:shadow-lg hover:-translate-y-px active:translate-y-0 transition-all"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onGroupSelect) {
                            onGroupSelect(group);
                          }
                        }}
                        aria-label="Invite member to group"
                      >
                        Invite Member
                      </button>
                    )}
                    {canEdit && (
                      <button
                        className="px-3 py-1 bg-surface-elevated text-content-primary rounded-btn hover:bg-surface-card-hover text-sm flex-shrink-0"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSettingsGroup(group);
                        }}
                        aria-label="Customize group"
                        title="Customize group"
                      >
                        ⚙️
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
      
      {settingsGroup && (
        <GroupSettings
          group={settingsGroup}
          user={authUser}
          userRole={userRoles[settingsGroup.id] || (settingsGroup.Users?.find(u => u.user_id === user?.sub)?.UserGroup?.role)}
          onClose={() => setSettingsGroup(null)}
          onUpdate={() => {
            fetchGroups();
            setSettingsGroup(null);
            // Notify parent to refresh calendar
            if (onGroupSettingsUpdated) {
              onGroupSettingsUpdated();
            }
          }}
          onGroupDeleted={() => {
            fetchGroups();
            setSettingsGroup(null);
            // Notify parent to refresh calendar
            if (onGroupSettingsUpdated) {
              onGroupSettingsUpdated();
            }
          }}
        />
      )}
    </div>
    </FriendshipStatusProvider>
  );
};

export default GroupList;