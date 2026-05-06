'use client';
import { useState, useEffect, useRef } from 'react';
import { invitesAPI } from '../../lib/api';
import { useFriendshipStatus } from './FriendshipStatusProvider';

function NotificationBell({ user, variant = 'icon', label }) {
  const [invites, setInvites] = useState([]);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const dropdownRef = useRef(null);

  // POLL-02: friend-request state pulled from the shared context so the
  // bell and the friends page reflect the same receivedRequests array.
  // The provider is mounted at root (src/app/layout.js).
  const {
    receivedRequests: friendRequests,
    acceptRequest: ctxAcceptFriend,
    declineRequest: ctxDeclineFriend,
  } = useFriendshipStatus();

  const totalCount = invites.length + friendRequests.length;

  // Fetch pending GROUP invites only — friend requests now come from
  // FriendshipStatusProvider context.
  useEffect(() => {
    if (!user?.sub) return;

    async function fetchInvites() {
      try {
        const data = await invitesAPI.getPendingInvites();
        setInvites(
          Array.isArray(data) ? data : data?.invites || []
        );
      } catch (err) {
        console.error('Failed to fetch invites:', err.message);
        setInvites([]);
      } finally {
        setLoading(false);
      }
    }

    fetchInvites();
  }, [user?.sub]);

  // Click-outside detection to close dropdown
  useEffect(() => {
    function handleClickOutside(e) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Clear confirmation after 3 seconds
  useEffect(() => {
    if (!confirmation) return;
    const timer = setTimeout(() => setConfirmation(null), 3000);
    return () => clearTimeout(timer);
  }, [confirmation]);

  async function handleAccept(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.acceptInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
      const groupName = invite.Group?.name || invite.group_name || 'the group';
      setConfirmation(`Joined ${groupName}!`);
      // GROUP-08: signal the home page to refresh its groups list. sessionStorage
      // covers a later navigation; window event covers the in-place case where the
      // user is already on / when they click Accept in the bell.
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('nggroups:refresh', '1');
        window.dispatchEvent(new CustomEvent('nggroups:refresh'));
      }
    } catch (err) {
      console.error('Failed to accept invite:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDecline(invite) {
    setActionLoading(invite.id);
    try {
      await invitesAPI.declineInvite(invite.id);
      setInvites((prev) => prev.filter((i) => i.id !== invite.id));
    } catch (err) {
      console.error('Failed to decline invite:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleAcceptFriend(request) {
    setActionLoading(request.id);
    try {
      // Provider handles optimistic removal + 404-stale silencing.
      // alreadyAccepted means the row was already resolved on another
      // surface (friends page) — we still show the success confirmation
      // since from the user's POV the action they wanted is done.
      await ctxAcceptFriend(request.id);
      setConfirmation('Accepted friend request!');
    } catch (err) {
      console.error('Failed to accept friend request:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  async function handleDeclineFriend(request) {
    setActionLoading(request.id);
    try {
      await ctxDeclineFriend(request.id);
    } catch (err) {
      console.error('Failed to decline friend request:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

  if (!user) return null;

  // Bell SVG — shared between icon and row variants. Decorative inside row variant
  // (the surrounding button is the actual hit target per CONTEXT D-02 "bell + row
  // are one combined target; bell becomes purely decorative").
  const bellIcon = (
    <svg
      className="w-6 h-6"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      strokeWidth={1.5}
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0"
      />
    </svg>
  );

  const countBadge = totalCount > 0 ? (
    <span className="bg-red-500 text-white text-xs font-bold rounded-full h-5 min-w-[1.25rem] px-1 flex items-center justify-center">
      {totalCount > 9 ? '9+' : totalCount}
    </span>
  ) : null;

  return (
    <div className="relative" ref={dropdownRef}>
      {variant === 'row' ? (
        // Full-width row hit area — entire surface is one tap target.
        // hover:bg-surface-card-hover + active:bg-surface-card-hover for
        // desktop hover + mobile tap-down feedback (subtle press-state per
        // CONTEXT D-02). text-left so the label aligns with surrounding rows.
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="w-full text-left flex items-center gap-3 px-4 py-3 text-white text-sm hover:bg-surface-card-hover active:bg-surface-card-hover transition-colors"
          aria-label={label ? `${label} notifications` : 'Notifications'}
        >
          {bellIcon}
          <span className="text-content-muted flex-1">{label || 'Notifications'}</span>
          {countBadge}
        </button>
      ) : (
        // Icon-only trigger — desktop nav. Visual unchanged from pre-Plan-68-01.
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="relative text-white hover:text-amber-400 transition-colors p-1"
          aria-label="Notifications"
        >
          {bellIcon}

          {/* Red badge with count — absolute-positioned over the bell */}
          {totalCount > 0 && (
            <span className="absolute -top-1 -right-1 bg-red-500 text-white text-xs font-bold rounded-full h-5 w-5 flex items-center justify-center">
              {totalCount > 9 ? '9+' : totalCount}
            </span>
          )}
        </button>
      )}

      {/* Dropdown panel — positioning differs by variant:
          - row variant (mobile hamburger): render inline so the panel expands
            within the menu naturally (no fixed/absolute escape from flow).
          - icon variant (desktop nav): fixed/absolute overlay near the bell. */}
      {isOpen && (
        <div className={
          variant === 'row'
            ? "bg-surface-card border-t border-line-header"
            : "fixed right-2 left-2 sm:left-auto sm:absolute sm:right-0 mt-2 sm:w-80 bg-surface-card rounded-lg shadow-theme-lg border border-line z-50"
        }>
          {/* Header */}
          <div className="px-4 py-3 border-b border-line">
            <h3 className="text-sm font-bold text-content-primary">Notifications</h3>
          </div>

          {/* Confirmation banner */}
          {confirmation && (
            <div className="px-4 py-2 bg-status-success/10 border-b border-line">
              <p className="text-sm text-status-success font-medium">{confirmation}</p>
            </div>
          )}

          {/* Content */}
          <div className="max-h-80 overflow-y-auto">
            {loading ? (
              <div className="px-4 py-8 text-center">
                <div className="inline-block w-5 h-5 border-2 border-line border-t-accent rounded-full animate-spin" />
              </div>
            ) : totalCount === 0 ? (
              <div className="px-4 py-8 text-center">
                <p className="text-sm text-content-muted">No pending notifications</p>
              </div>
            ) : (
              <>
                {/* Group Invites section */}
                {invites.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Group Invites
                    </p>
                    <ul>
                      {invites.map((invite) => {
                        const groupName = invite.Group?.name || invite.group_name || 'Unknown Group';
                        const inviterName = invite.Inviter?.username || invite.inviter_name || 'Someone';
                        const memberCount = invite.Group?.memberCount || invite.member_count || null;
                        const isLoading = actionLoading === invite.id;

                        return (
                          <li
                            key={invite.id}
                            className="px-4 py-3 border-b border-line last:border-b-0"
                          >
                            <p className="text-sm font-semibold text-content-primary">{groupName}</p>
                            <p className="text-xs text-content-muted mt-0.5">
                              {inviterName} invited you
                            </p>
                            {memberCount && (
                              <p className="text-xs text-content-muted mt-0.5">
                                {memberCount} member{memberCount !== 1 ? 's' : ''}
                              </p>
                            )}

                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleAccept(invite)}
                                disabled={isLoading}
                                className="flex-1 btn btn-primary text-xs px-3 py-1.5"
                              >
                                {isLoading ? (
                                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  'Accept'
                                )}
                              </button>
                              <button
                                onClick={() => handleDecline(invite)}
                                disabled={isLoading}
                                className="flex-1 btn btn-secondary text-xs px-3 py-1.5"
                              >
                                Decline
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                {/* Friend Requests section */}
                {friendRequests.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Friend Requests
                    </p>
                    <ul>
                      {friendRequests.map((request) => {
                        const requesterName = request.Requester?.username || 'Someone';
                        const isLoading = actionLoading === request.id;

                        return (
                          <li
                            key={request.id}
                            className="px-4 py-3 border-b border-line last:border-b-0"
                          >
                            <p className="text-sm font-semibold text-content-primary">{requesterName}</p>
                            <p className="text-xs text-content-muted mt-0.5">
                              wants to be your friend
                            </p>

                            <div className="flex gap-2 mt-2">
                              <button
                                onClick={() => handleAcceptFriend(request)}
                                disabled={isLoading}
                                className="flex-1 btn btn-primary text-xs px-3 py-1.5"
                              >
                                {isLoading ? (
                                  <span className="inline-block w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                ) : (
                                  'Accept'
                                )}
                              </button>
                              <button
                                onClick={() => handleDeclineFriend(request)}
                                disabled={isLoading}
                                className="flex-1 btn btn-secondary text-xs px-3 py-1.5"
                              >
                                Decline
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default NotificationBell;
