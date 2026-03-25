// src/components/GroupList.js
'use client'
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import '../../../public/GroupList.css';
import Link from 'next/link';
import GroupSettings from './GroupSettings';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { groupsAPI } from '../../lib/api';
import { getTextStyle } from '../../lib/colorUtils';
import { formatDate } from '../../lib/dateUtils';
import SafeImage from './SafeImage';
import FriendshipStatusProvider from './FriendshipStatusProvider';
import ClickableMemberName from './ClickableMemberName';

const GroupList = ({ onGroupSelect, onCreateGroup, user, onGroupSettingsUpdated, refreshTrigger }) => {
  const router = useRouter();
  const { user: authUser } = Auth();
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
      <div className="group-list-sidebar">
        <div className="loading">Loading groups...</div>
      </div>
    );
  }

  return (
    <FriendshipStatusProvider>
    <div className="group-list-sidebar">
      <div className="sidebar-header">
        <h2>Your Groups</h2>
        {onCreateGroup && (
          <button 
            className="create-group-btn"
            onClick={onCreateGroup}
            aria-label="Create new group"
          >
            + Create New Group
          </button>
        )}
      </div>

      <div className="groups-container">
        {groups.length === 0 ? (
          <div className="no-groups">
            <p>No groups yet!</p>
            <p>Create your first group to get started.</p>
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
                className="group-card"
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
                  position: 'relative',
                  zIndex: 1,
                }}
              >
                {bgImage && (
                  <div style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    right: 0,
                    bottom: 0,
                    backgroundColor: 'rgba(255, 255, 255, 0.85)',
                    zIndex: 0,
                  }} />
                )}
                <div style={{ position: 'relative', zIndex: 1 }}>
                  <div className="group-header">
                    <div className="flex items-center gap-2">
                      {profilePic && (
                        <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-2xl flex-shrink-0 overflow-hidden">
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
                        className="group-name"
                        style={getTextStyle(bgImage, bgColor)}
                      >
                        {group.name}
                      </h3>
                    </div>
                    <span 
                      className="player-count"
                      style={getTextStyle(bgImage, bgColor)}
                    >
                      {groupUsers.length} {groupUsers.length === 1 ? 'player' : 'players'}
                    </span>
                  </div>

                <div className="group-players">
                  {groupUsers
                    .filter((member) => member.user_id !== user?.sub)
                    .slice(0, 4)
                    .map((member, index) => (
                      <span key={member.id || index} className="player-tag">
                        <ClickableMemberName userId={member.user_id} username={member.username || member.email} />
                      </span>
                    ))}
                  {groupUsers.filter((member) => member.user_id !== user?.sub).length > 4 && (
                    <span className="player-tag more">
                      +{groupUsers.length - 5} more
                    </span>
                  )}
                </div>

                <div className="last-game-info" style={getTextStyle(bgImage, bgColor)}>
                  <div className="last-game">
                    <strong>Last Game:</strong> {lastGame?.name || 'None'}
                  </div>
                  <div className="last-game-date">
                    {formatDate(lastEvent?.start_date || lastEvent?.createdAt)}
                  </div>
                </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-3" style={{ position: 'relative', zIndex: 2 }}>
                    {canEdit && (
                      <button
                        className="add-member-btn flex-1"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (onGroupSelect) {
                            onGroupSelect(group);
                          }
                        }}
                        aria-label="Invite member to group"
                        style={{
                          backgroundColor: '#28a745',
                          color: '#ffffff',
                          fontWeight: '600',
                          boxShadow: '0 2px 6px rgba(0, 0, 0, 0.3)',
                          border: '2px solid rgba(255, 255, 255, 0.3)',
                        }}
                      >
                        Invite Member
                      </button>
                    )}
                    {canEdit && (
                      <button
                        className="px-3 py-1 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm flex-shrink-0"
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