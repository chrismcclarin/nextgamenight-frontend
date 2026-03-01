// src/components/GroupList.js
'use client'
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import '../../../public/GroupList.css';
import Link from 'next/link';
import GroupSettings from './GroupSettings';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { groupsAPI } from '../../lib/api';

// Helper function to get text style with outline for better visibility
const getTextStyleWithOutline = (hasBackgroundImage, backgroundColor) => {
  // If there's a background image, always use white text with dark outline
  if (hasBackgroundImage) {
    return {
      color: '#ffffff',
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8), 1px -1px 2px rgba(0, 0, 0, 0.8), -1px 1px 2px rgba(0, 0, 0, 0.8)',
      WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)',
      fontWeight: '600',
    };
  }
  
  // For solid colors, determine if we need light or dark text
  if (!backgroundColor || backgroundColor === '#ffffff') {
    return {
      color: '#1f2937',
      textShadow: 'none',
    };
  }
  
  // Calculate brightness
  const hex = backgroundColor.replace('#', '');
  const r = parseInt(hex.substr(0, 2), 16);
  const g = parseInt(hex.substr(2, 2), 16);
  const b = parseInt(hex.substr(4, 2), 16);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  
  if (brightness > 180) {
    // Very light background - use dark text with light outline
    return {
      color: '#1f2937',
      textShadow: '1px 1px 2px rgba(255, 255, 255, 0.8), -1px -1px 2px rgba(255, 255, 255, 0.8)',
      fontWeight: '600',
    };
  } else if (brightness > 128) {
    // Medium-light background - use dark text with subtle outline
    return {
      color: '#1f2937',
      textShadow: '1px 1px 3px rgba(255, 255, 255, 0.9)',
      fontWeight: '600',
    };
  } else {
    // Dark background - use white text with dark outline
    return {
      color: '#ffffff',
      textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8), -1px -1px 2px rgba(0, 0, 0, 0.8), 1px -1px 2px rgba(0, 0, 0, 0.8), -1px 1px 2px rgba(0, 0, 0, 0.8)',
      WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)',
      fontWeight: '600',
    };
  }
};

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

  const formatDate = (date) => {
    if (!date) return 'No games yet';
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
                            <img 
                              src={profilePic} 
                              alt={group.name}
                              className="w-full h-full object-cover"
                              onError={(e) => {
                                e.target.style.display = 'none';
                                if (e.target.nextSibling) {
                                  e.target.nextSibling.style.display = 'block';
                                }
                              }}
                            />
                          ) : (
                            <span>{profilePic}</span>
                          )}
                        </div>
                      )}
                      <h3 
                        className="group-name"
                        style={getTextStyleWithOutline(bgImage, bgColor)}
                      >
                        {group.name}
                      </h3>
                    </div>
                    <span 
                      className="player-count"
                      style={getTextStyleWithOutline(bgImage, bgColor)}
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
                        {member.username || member.email}
                      </span>
                    ))}
                  {groupUsers.filter((member) => member.user_id !== user?.sub).length > 4 && (
                    <span className="player-tag more">
                      +{groupUsers.length - 5} more
                    </span>
                  )}
                </div>

                <div className="last-game-info" style={getTextStyleWithOutline(bgImage, bgColor)}>
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
  );
};

export default GroupList;