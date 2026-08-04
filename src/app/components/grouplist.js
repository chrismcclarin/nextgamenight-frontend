// src/components/GroupList.js
'use client'
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import GroupSettings from './GroupSettings';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { groupsAPI } from '../../lib/api';
import { getTextStyle } from '../../lib/colorUtils';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { formatDate } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import SafeImage from './SafeImage';
import ClickableMemberName from './ClickableMemberName';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

const GroupList = ({ onGroupSelect, onCreateGroup, user, onGroupSettingsUpdated, refreshTrigger }) => {
  const router = useRouter();
  const { user: authUser } = Auth();
  const { timezone } = useTimezone();
  // Phase 87.3-05 (PR-B): resolve the caller's own Users.id UUID via the shared
  // identity primitive. Every is-me compare below keys on the nested member.id
  // (UUID) vs selfUuid — never the flat member.user_id vs sub compare (which
  // flips value at PR-C). selfUuid resolves ASYNC, so role derivation runs in its own effect
  // gated on resolution (D-04 async-resolution constraint).
  const { selfUuid, query: selfIdentityQuery } = useSelfIdentity();
  const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [settingsGroup, setSettingsGroup] = useState(null);
  const [userRoles, setUserRoles] = useState({});

  // selfUuid resolves ASYNC after this mount effect's first run, so it is in the
  // dependency array per the async-resolution rule — the fetch re-fires (and the
  // list populates) once identity resolves, instead of silently no-oping forever.
  useEffect(() => {
    if (user) {
      fetchGroups();
    }
  }, [user, refreshTrigger, selfUuid]); // selfUuid gates the getUserGroups sender below

  // Derive per-group self role reactively off the resolved UUID. Kept separate
  // from the group fetch so an unresolved selfUuid never stores a wrong "no
  // role" derive — the effect re-runs (and roles populate) once identity
  // resolves. selfUuid is in the dependency array per the async-resolution rule.
  useEffect(() => {
    if (!selfUuid) return;
    const roles = {};
    groups.forEach(group => {
      if (group.Users && Array.isArray(group.Users)) {
        const userMember = group.Users.find(u => u.id === selfUuid);
        if (userMember) {
          // Role is in UserGroup object from the through relationship
          roles[group.id] = userMember.UserGroup?.role || 'member';
        }
      }
    });
    setUserRoles(roles);
  }, [groups, selfUuid]);

  const fetchGroups = async () => {
    // Mount-fire gate: wait for the caller's own Users.id UUID to resolve. This
    // guard IS the resolution gate (paired with selfUuid in the effect deps).
    if (!selfUuid) return;

    try {
      setLoading(true);
      // Use groupsAPI.getUserGroups which automatically includes Authorization header
      const groupsData = await groupsAPI.getUserGroups(selfUuid);
      setGroups(groupsData || []);
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

  // WR-03: on TERMINAL identity-resolution failure, fetchGroups early-returns on
  // `!selfUuid` BEFORE its try/finally, so `loading` never clears — the spinner
  // below would hang forever and the in-list degrade banner further down is
  // unreachable beneath that loading return. Surface the compact degrade notice
  // HERE instead (banner where the list would be), mirroring the
  // groupHomePage/friends identity-error pattern. The header shell is kept so the
  // error state looks intentional, not a broken half-render.
  if (selfIdentityErrorState.showError) {
    return (
      <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
        <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
          <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
          {onCreateGroup && (
            /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the home surface's primary CTA (error-state render branch of the same CTA below). Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` floor (rejected, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text button. */
            <button
              className="btn btn-primary text-sm whitespace-nowrap min-h-11"
              onClick={onCreateGroup}
              aria-label="Create new group"
              data-tutorial="create-group-btn"
            >
              + Create New Group
            </button>
          )}
        </div>
        <div className="py-8 px-4">
          <FetchErrorBanner state={selfIdentityErrorState} compact />
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
        <div className="text-center py-8 px-4 text-content-muted">Loading groups...</div>
      </div>
    );
  }

  return (
    // POLL-02: FriendshipStatusProvider lifted to root layout — no longer
    // mounted here, since the nested instance was shadowing root state and
    // breaking friend-state sync between NotificationBell and friends page.
    //
    // DECISION Phase 87.8 (D-02/D-03): level assignment for the home chain — this
    // wrapper and the scrolling list div below are STRUCTURAL WRAPPERS (scroll
    // plumbing), flattened at phone via surface-flat-phone; the group card inside
    // is the depth-2 surface and the only element the user perceives as a surface.
    // Chosen OVER giving each nesting level its own ladder value, which would have
    // kept the chain at 44px per side and defeated the 75px budget. The same
    // flatten is applied to the loading/error-state renders of this wrapper so the
    // surface does not jump 16px when it transitions states. That is a decision,
    // not a cleanup.
    <div className="w-full max-w-[400px] md:max-w-[400px] max-md:max-w-full bg-surface-page rounded-card surface-flat-phone md:p-4 flex flex-col overflow-hidden h-full">
      <div className="flex items-center justify-between mb-4 pb-3 border-b border-line">
        <h2 className="text-xl font-bold text-content-primary">Your Groups</h2>
        {onCreateGroup && (
          /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the home surface's primary CTA. Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text button. */
          <button
            className="btn btn-primary text-sm whitespace-nowrap min-h-11"
            onClick={onCreateGroup}
            aria-label="Create new group"
            data-tutorial="create-group-btn"
          >
            + Create New Group
          </button>
        )}
      </div>

      {/* D-08: if identity resolution permanently fails, per-group role
          affordances (Invite / settings) silently vanish — surface a compact,
          non-blocking degrade notice instead of failing silently (D-11). */}
      <FetchErrorBanner state={selfIdentityErrorState} compact />

      <div className="flex-1 overflow-y-auto surface-flat-phone md:p-4 pb-8 flex flex-col gap-4 max-md:max-h-[60vh]">
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
            if (!userRole && group.Users && selfUuid) {
              const userMember = group.Users.find(u => u.id === selfUuid);
              userRole = userMember?.UserGroup?.role || userMember?.role;
            }
            const canEdit = userRole === 'owner' || userRole === 'admin';
            const bgColor = group.background_color || '#ffffff';
            const bgImage = group.background_image_url;
            const profilePic = group.profile_picture_url;

            return (
              <div
                key={group.id}
                className="bg-surface-card rounded-card p-3 pl-4 md:p-6 md:pl-7 shadow-theme-sm cursor-pointer transition-all duration-200 border border-line border-l-4 border-l-accent relative hover:-translate-y-0.5 hover:shadow-theme-md hover:border-l-accent-hover hover:bg-surface-card-hover active:opacity-75 focus:outline-hidden focus:border-focus-ring"
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
                  ...safeBgImageStyle(bgImage),
                  backgroundSize: 'cover',
                  backgroundPosition: 'center',
                }}
              >
                {bgImage && (
                  // This overlay currently paints NOTHING — placeholder, kept
                  // deliberately. Phase 73-02 gave it a semantic surface tint at
                  // 85% so the bg image dims and text stays readable in both
                  // themes; that slash-opacity was inert on v3's var()-backed
                  // tokens and 87.7 D-18 stripped it rather than let v4 start
                  // rendering it (a new visual). Do NOT re-add a dim here ad
                  // hoc — Phase 88 owns the real treatment via its opacity
                  // mechanism (census: 87.7-OPACITY-CENSUS.md). The div stays
                  // so 88's fix is a class edit, not a structure change.
                  <div className="absolute inset-0 z-0 rounded-card" />
                )}
                <div className="relative z-1">
                  {/* 87.8-13 walkthrough F-8: single row at ALL widths — the old
                      max-[480px] column-stack dropped the players pill to its own
                      right-justified line under a left-aligned card (owner call).
                      Long names still coexist with the pill: min-w-0 + wrap. */}
                  <div className="flex justify-between items-center mb-3">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      {profilePic && (
                        <div className="w-10 h-10 rounded-full bg-surface-card-hover flex items-center justify-center text-2xl shrink-0 overflow-hidden">
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
                        className="text-[1.1rem] font-semibold text-content-primary flex-1 min-w-0 wrap-break-word max-md:text-base"
                        style={getTextStyle(bgImage, bgColor)}
                      >
                        {group.name}
                      </h3>
                    </div>
                    <span
                      className="bg-btn-primary text-btn-primary-text px-2.5 py-0.5 rounded-xl text-xs font-semibold ml-2 shrink-0"
                      style={getTextStyle(bgImage, bgColor)}
                    >
                      {groupUsers.length} {groupUsers.length === 1 ? 'player' : 'players'}
                    </span>
                  </div>

                <div className="flex flex-wrap gap-2 mb-3">
                  {groupUsers
                    .filter((member) => member.id !== selfUuid)
                    .slice(0, 4)
                    .map((member, index) => (
                      <span key={member.id || index} className="bg-surface-card-hover text-content-secondary px-2 py-1 rounded-md text-[0.8rem] border border-line">
                        <ClickableMemberName userId={member.id} username={member.username || member.email} />
                      </span>
                    ))}
                  {groupUsers.filter((member) => member.id !== selfUuid).length > 4 && (
                    <span className="bg-surface-card-hover text-content-muted px-2 py-1 rounded-md text-[0.8rem] border border-line font-medium">
                      +{groupUsers.length - 5} more
                    </span>
                  )}
                </div>

                {/* 87.8-13 walkthrough F-9: name + date on ONE line (owner call —
                    the stacked date read as a stray row). flex-wrap keeps long
                    game names graceful: the date wraps as a unit, never mid-text. */}
                <div className="border-t border-line pt-3" style={getTextStyle(bgImage, bgColor)}>
                  <div className="flex flex-wrap items-baseline gap-x-2 text-content-secondary text-sm">
                    <span><strong className="text-content-primary">Last Game:</strong> {lastGame?.name || 'None'}</span>
                    <span className="text-content-muted text-xs">
                      {formatDate(lastEvent?.start_date || lastEvent?.createdAt, timezone)}
                    </span>
                  </div>
                </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-3 relative z-2">
                    {/* Phase 69 CONTEXT D-INV-03: any active member can invite
                        (FriendInvitePanel exposes QR + link to all roles); only
                        the Reset invite link button inside FriendInvitePanel is
                        admin-only (D-INV-02). The settings cog below stays
                        admin-gated via `canEdit`. */}
                    {userRole && userRole !== 'pending' && (
                      /* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census — per-card primary CTA on the walked home surface. Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` floor (rejected, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: `flex-1` full-row width. */
                      <button
                        className="btn btn-primary text-sm flex-1 shadow-md hover:shadow-lg transition-all min-h-11"
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
                        className="px-3 py-1 bg-surface-elevated text-content-primary rounded-btn hover:bg-surface-card-hover active:opacity-75 text-sm shrink-0"
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
          userRole={userRoles[settingsGroup.id] || (selfUuid && settingsGroup.Users?.find(u => u.id === selfUuid)?.UserGroup?.role)}
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
          // DECISION Phase 88.2 AF-6: navigate to the group's home page, chosen
          // OVER mounting a second ManageMembers instance here (that modal is
          // imported in exactly one place — duplicating 650 lines and its member
          // refetch lifecycle onto a surface this phase does not otherwise touch),
          // and OVER leaving the prop absent, which renders BOTH transfer
          // affordances in GroupSettings permanently greyed out and leaves
          // SPEC-REQ-5's route-to-transfer unmet on the home page. Cost, weighed
          // and accepted: one extra tap — the owner lands on the group page and
          // opens Manage Members there instead of going straight into the modal.
          // This also revives the pre-existing "Open Manage Members to transfer"
          // button, dead on this surface since it shipped for the same reason.
          onOpenManageMembers={() => {
            // Read the id BEFORE clearing the state — the setter and the push are
            // in the same handler, and reading settingsGroup.id after it is the
            // kind of thing that survives review and breaks on a refactor.
            const id = settingsGroup.id;
            setSettingsGroup(null);
            router.push(`/groupHomePage?id=${id}`);
          }}
        />
      )}
    </div>
  );
};

export default GroupList;