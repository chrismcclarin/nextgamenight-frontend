'use client';
import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { invitesAPI, pollsAPI } from '../../lib/api';
import { useFriendshipStatus } from './FriendshipStatusProvider';

/**
 * Compute the top-availability slots from a closed poll's PollResponses.
 *
 * Mirrors the backend tally in pollService.notifyPollClosed so the bell-side
 * "Schedule it?" CTA surfaces the SAME slots the close email surfaced. Both
 * surfaces consume the locked URL contract from notifyPollClosed:
 *   ${FRONTEND_URL}/groupHomePage?groupId=X&pollId=Y&prefillStart=ISO
 *
 * Returns an array of slot keys `${date}|${slotIso}` tied for the max
 * availability count. D-POLL-CREATE-12: surface ALL tied slots; do NOT
 * auto-pick.
 */
function computeTopSlots(poll) {
  if (!poll?.PollResponses) return [];
  const tally = new Map();
  for (const r of poll.PollResponses) {
    if (!r.slot_data || !Array.isArray(r.slot_data)) continue;
    for (const s of r.slot_data) {
      if (!s || !s.available || !s.slot || !s.date) continue;
      const key = `${s.date}|${s.slot}`;
      tally.set(key, (tally.get(key) || 0) + 1);
    }
  }
  let max = 0;
  let top = [];
  for (const [key, count] of tally) {
    if (count > max) { max = count; top = [key]; }
    else if (count === max) top.push(key);
  }
  return { slots: top, maxCount: max };
}

function formatSlotLabel(slotKey) {
  const [, slotIso] = slotKey.split('|');
  if (!slotIso) return slotKey;
  const d = new Date(slotIso);
  if (Number.isNaN(d.getTime())) return slotKey;
  // e.g. "Mon 5/12 at 7:00 PM"
  return d.toLocaleString(undefined, {
    weekday: 'short',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function NotificationBell({ user, variant = 'icon', label }) {
  const router = useRouter();
  const [invites, setInvites] = useState([]);
  // POLL-01 (Plan 71-05): bell-side poll feeds.
  //   pendingPolls = open polls in groups where the caller is an active
  //                  member AND has not yet responded (consume /pending-for-me)
  //   closedPollsForMe = closed polls the caller created where the close
  //                  notification has not yet been dismissed (consume
  //                  /closed-awaiting-me — Plan 71-05 backend addition)
  const [pendingPolls, setPendingPolls] = useState([]);
  const [closedPollsForMe, setClosedPollsForMe] = useState([]);
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

  const totalCount = invites.length + friendRequests.length + pendingPolls.length + closedPollsForMe.length;

  // Fetch pending GROUP invites + poll feeds. Friend requests come from
  // FriendshipStatusProvider context. Each fetch is independent — a single
  // failure (e.g. polls 500) shouldn't black out the whole dropdown.
  useEffect(() => {
    if (!user?.sub) return;

    async function fetchAll() {
      try {
        const [invitesData, pendingPollsData, closedPollsData] = await Promise.all([
          invitesAPI.getPendingInvites().catch((err) => {
            console.error('Failed to fetch invites:', err.message);
            return [];
          }),
          // /pending-for-me runs lazy-on-read deadline auto-close server-side
          // (D-POLL-CREATE-04 deadline path REQUIRED) so a poll that just
          // tipped past its deadline drops out here without a worker.
          pollsAPI.getPendingForMe().catch((err) => {
            console.error('Failed to fetch pending polls:', err.message);
            return [];
          }),
          // Plan 71-05 backend addition — server-side filter for closed polls
          // where caller is creator AND closed_notification_dismissed_at is
          // NULL. Avoids the per-group N+1 the plan body called out as v1.
          pollsAPI.getClosedAwaitingMe().catch((err) => {
            console.error('Failed to fetch closed-awaiting polls:', err.message);
            return [];
          }),
        ]);
        setInvites(Array.isArray(invitesData) ? invitesData : invitesData?.invites || []);
        setPendingPolls(Array.isArray(pendingPollsData) ? pendingPollsData : []);
        setClosedPollsForMe(Array.isArray(closedPollsData) ? closedPollsData : []);
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
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

  // POLL-01 (Plan 71-05): consumes the locked URL contract from
  // pollService.notifyPollClosed:
  //   ${FRONTEND_URL}/groupHomePage?groupId=X&pollId=Y&prefillStart=ISO
  // Same shape as the close email's CTA so behavior is identical whether
  // the creator arrives via email or via the bell. createEvent's existing
  // prefillDate + prefillTime params (Phase 65-03 EVT-05 contract) read
  // from the URL via groupHomePage's existing search-param plumbing — the
  // create modal opens auto-prefilled to the chosen slot.
  function openCreateEventPrefilled(poll, slotKey) {
    const [, slotIso] = slotKey.split('|');
    const start = new Date(slotIso);
    if (Number.isNaN(start.getTime())) return;
    // groupHomePage reads `date` (YYYY-MM-DD) + `time` (HH:mm) from search
    // params and auto-opens the createEvent modal. Build them from the
    // chosen slot's local time so the modal lands on the user-visible slot.
    const yyyy = start.getFullYear();
    const mm = String(start.getMonth() + 1).padStart(2, '0');
    const dd = String(start.getDate()).padStart(2, '0');
    const hh = String(start.getHours()).padStart(2, '0');
    const mi = String(start.getMinutes()).padStart(2, '0');
    const params = new URLSearchParams({
      id: poll.group_id,
      date: `${yyyy}-${mm}-${dd}`,
      time: `${hh}:${mi}`,
      create_event: 'true',
      // Locked URL contract param — kept for parity with pollService's
      // notifyPollClosed email body even though groupHomePage's existing
      // prefill plumbing reads from `date`+`time`. Future flows can
      // consume `prefillStart` directly.
      prefillStart: start.toISOString(),
      pollId: poll.id,
    });
    setIsOpen(false);
    router.push(`/groupHomePage?${params.toString()}`);
  }

  async function handleDismissClosedPoll(pollId) {
    setActionLoading(pollId);
    try {
      // Server-side state per D-POLL-CREATE-07 cross-device guarantee —
      // dismissing here also dismisses on every other device the creator
      // is signed in on. (No client-side persistence is used for this row;
      // the server-side closed_notification_dismissed_at column is the
      // single source of truth.)
      await pollsAPI.dismissNotification(pollId);
      setClosedPollsForMe((prev) => prev.filter((p) => p.id !== pollId));
    } catch (err) {
      console.error('Failed to dismiss poll notification:', err.message);
    } finally {
      setActionLoading(null);
    }
  }

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

                {/* POLL-01 (Plan 71-05): pending poll rows — open polls in
                    groups where the caller is an active member AND has not
                    yet responded. D-POLL-CREATE-03 in-app channel. */}
                {pendingPolls.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Polls
                    </p>
                    <ul>
                      {pendingPolls.map((poll) => {
                        const groupName = poll.Group?.name || 'a group';
                        const deadlineLabel = (() => {
                          try { return new Date(poll.response_deadline).toLocaleString(undefined, { dateStyle: 'short', timeStyle: 'short' }); }
                          catch { return ''; }
                        })();
                        return (
                          <li key={`poll-pending-${poll.id}`} className="px-4 py-3 border-b border-line last:border-b-0">
                            <p className="text-sm font-semibold text-content-primary">New poll in {groupName}</p>
                            <p className="text-xs text-content-muted mt-0.5">
                              {poll.date_window_start} → {poll.date_window_end}
                              {deadlineLabel && ` · respond by ${deadlineLabel}`}
                            </p>
                            <button
                              onClick={() => {
                                setIsOpen(false);
                                router.push(`/groupHomePage?id=${encodeURIComponent(poll.group_id)}&pollId=${encodeURIComponent(poll.id)}`);
                              }}
                              className="mt-2 btn btn-primary text-xs px-3 py-1.5"
                            >
                              Respond
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </>
                )}

                {/* POLL-01 (Plan 71-05): closed-poll "Schedule it?" CTA.
                    D-POLL-CREATE-07 close-notification + D-POLL-CREATE-12
                    multi-tied-slot surface. computeTopSlots mirrors the
                    backend tally in pollService.notifyPollClosed so the
                    bell-side and email-side surface the SAME slots. */}
                {closedPollsForMe.length > 0 && (
                  <>
                    <p className="text-xs font-semibold text-content-muted uppercase tracking-wider px-4 pt-3 pb-1">
                      Poll Results
                    </p>
                    <ul>
                      {closedPollsForMe.map((poll) => {
                        const groupName = poll.Group?.name || 'your group';
                        const { slots: topSlots, maxCount } = computeTopSlots(poll);
                        const tied = topSlots.length > 1;
                        const isLoading = actionLoading === poll.id;
                        return (
                          <li key={`poll-closed-${poll.id}`} className="px-4 py-3 border-b border-line last:border-b-0">
                            <p className="text-sm font-semibold text-content-primary">Poll closed for {groupName}</p>
                            {topSlots.length === 0 && (
                              <p className="text-xs text-content-muted mt-0.5">
                                No availability submitted — open the group to plan manually.
                              </p>
                            )}
                            {topSlots.length === 1 && (
                              <p className="text-xs text-content-muted mt-0.5">
                                Top slot ({maxCount} available): {formatSlotLabel(topSlots[0])}
                              </p>
                            )}
                            {tied && (
                              <p className="text-xs text-content-muted mt-0.5">
                                {topSlots.length} slots tied for top ({maxCount} each):
                              </p>
                            )}
                            <div className="flex flex-wrap gap-2 mt-2">
                              {topSlots.length === 1 && (
                                <button
                                  onClick={() => openCreateEventPrefilled(poll, topSlots[0])}
                                  className="btn btn-primary text-xs px-3 py-1.5"
                                >
                                  Schedule it?
                                </button>
                              )}
                              {tied && topSlots.map((slotKey) => (
                                <button
                                  key={slotKey}
                                  onClick={() => openCreateEventPrefilled(poll, slotKey)}
                                  className="btn btn-primary text-xs px-3 py-1.5"
                                >
                                  Schedule {formatSlotLabel(slotKey)}
                                </button>
                              ))}
                              <button
                                onClick={() => handleDismissClosedPoll(poll.id)}
                                disabled={isLoading}
                                className="btn btn-secondary text-xs px-3 py-1.5"
                              >
                                {isLoading ? 'Dismissing...' : 'Dismiss'}
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
