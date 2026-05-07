'use client';

import { useMemo, useState } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { pollsAPI } from '../../lib/api';
import PollHeatmap from './PollHeatmap';
import PollResponseForm from './PollResponseForm';

/**
 * ActivePollCard — POLL-01 open-poll surface on the group home page.
 *
 * Implements:
 *   D-POLL-CREATE-11: running heatmap visible during poll (mirrors the
 *                     existing recurring-schedule heatmap visibility — all
 *                     active members see who has responded as votes stream in).
 *   D-POLL-CREATE-13: "End poll" button (verbatim label) visible only to
 *                     creator/admin/owner. Regular members do NOT see it
 *                     because they already see results per D-POLL-CREATE-11.
 *
 * Auto-close paths:
 *   - Manual: this component's End poll button.
 *   - Consensus: backend auto-closes inside submitResponse when 100% of
 *     active members have responded — handleResponseSubmitted refetches and
 *     calls onClosed if the poll came back as 'closed'.
 *   - Deadline: lazy-on-read inside GET /api/polls/group/:groupId — the
 *     parent groupHomePage's getActivePoll fetch returns null after deadline
 *     so the card unmounts naturally.
 */
function formatDeadlineRemaining(deadlineIso) {
  const ms = new Date(deadlineIso).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) return 'closing soon';
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hours = Math.floor((totalMin % (60 * 24)) / 60);
  const minutes = totalMin % 60;
  if (days >= 1) return `${days}d ${hours}h`;
  if (hours >= 1) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

export default function ActivePollCard({ poll, userRole, members, onUpdated, onClosed }) {
  const { user } = Auth();
  const [closing, setClosing] = useState(false);
  const [actionError, setActionError] = useState(null);

  const isCreator = !!user?.sub && user.sub === poll?.created_by_user_id;
  const isAdminOrOwner = userRole === 'admin' || userRole === 'owner';
  const canClose = isCreator || isAdminOrOwner;

  // Active members are the denominator for both the heatmap ratio and the
  // "X of N responded" caption. Pending (game-only) members don't count
  // toward consensus per D-POLL-CREATE-05 — they were invited to a single
  // game event, not the group's poll cadence.
  // Plan 71-05 manual-checkpoint Bug 2 (round 2) fix: explicitly exclude
  // role='pending' to match the backend's checkAutoClose denominator.
  const activeMembers = useMemo(() => {
    if (!Array.isArray(members)) return [];
    return members.filter((m) => {
      const ug = m?.UserGroup;
      if (!ug || ug.status !== 'active') return false;
      return ug.role === 'member' || ug.role === 'admin' || ug.role === 'owner';
    });
  }, [members]);
  const activeMemberCount = activeMembers.length;

  // The current user's existing response, if any — pre-fills the form.
  const myResponse = useMemo(() => {
    if (!user?.sub || !poll?.PollResponses) return null;
    return poll.PollResponses.find((r) => r.user_id === user.sub) || null;
  }, [poll, user?.sub]);

  const responseCount = poll?.PollResponses?.length ?? 0;

  const handleResponseSubmitted = async () => {
    setActionError(null);
    try {
      const fresh = await pollsAPI.getPoll(poll.id);
      if (!fresh) {
        // Poll vanished (deleted or returned 404) — treat as closed.
        onClosed?.(null);
        return;
      }
      // Backend may have auto-closed via consensus or lazy deadline check —
      // in either case, the parent should drop the active-poll surface.
      if (fresh.status !== 'open') {
        onClosed?.(fresh);
      } else {
        onUpdated?.(fresh);
      }
    } catch (err) {
      setActionError(err?.message || 'Could not refresh the poll. Try reloading.');
    }
  };

  const handleEndPoll = async () => {
    // Single-confirm pattern (Phase 69 transfer-ownership style); the
    // close-notification CTA in NotificationBell acts as a soft second
    // confirmation. Plan 71-05 leaves the confirmation pattern to Claude's
    // discretion — swap to a 2-tap KebabMenu confirm if user feedback at
    // the manual checkpoint asks for it.
    if (typeof window !== 'undefined' &&
        !window.confirm('End this poll now? Responses will stop being collected and the top slot will be surfaced.')) {
      return;
    }
    setClosing(true);
    setActionError(null);
    try {
      const closedPoll = await pollsAPI.closePoll(poll.id);
      onClosed?.(closedPoll);
    } catch (err) {
      setActionError(err?.message || 'Could not end the poll.');
    } finally {
      setClosing(false);
    }
  };

  if (!poll) return null;

  return (
    <div className="card-surface bg-surface-card border border-line rounded-lg p-4 md:p-6 mb-4">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-content-primary">Availability poll</h3>
          <p className="text-sm text-content-secondary mt-1">
            <span className="font-medium">{poll.date_window_start}</span>
            {' → '}
            <span className="font-medium">{poll.date_window_end}</span>
            {' · closes in '}
            <span className="font-medium">{formatDeadlineRemaining(poll.response_deadline)}</span>
          </p>
        </div>
        {canClose && (
          <button
            type="button"
            onClick={handleEndPoll}
            disabled={closing}
            className="btn btn-secondary text-sm whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {closing ? 'Ending...' : 'End poll'}
          </button>
        )}
      </div>

      {actionError && (
        <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3 mb-3">
          <p className="text-sm text-status-error">{actionError}</p>
        </div>
      )}

      <div className="mb-4">
        <h4 className="text-sm font-semibold text-content-primary mb-2">Your availability</h4>
        <PollResponseForm
          pollId={poll.id}
          dateWindowStart={poll.date_window_start}
          dateWindowEnd={poll.date_window_end}
          existingResponse={myResponse}
          onSuccess={handleResponseSubmitted}
        />
      </div>

      <div>
        <h4 className="text-sm font-semibold text-content-primary mb-2">
          Group availability ({responseCount} of {activeMemberCount} responded)
        </h4>
        <PollHeatmap poll={poll} activeMemberCount={activeMemberCount} />
      </div>
    </div>
  );
}
