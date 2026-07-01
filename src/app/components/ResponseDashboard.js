'use client';

import { useState, useEffect, useCallback } from 'react';
import { promptAPI } from '@/lib/api';

/**
 * ResponseDashboard - Shows who has/hasn't responded to an availability prompt
 *
 * Features:
 * - Displays respondent/pending status for all group members
 * - Admins can send reminder emails (24-hour cooldown)
 * - Blind voting: hides slot counts until user submits or poll closes
 *
 * @param {string} promptId - The availability prompt ID
 * @param {boolean} isAdmin - Whether the current user is admin/owner
 * @param {string} currentUserId - The current user's ID
 * @param {boolean} blindVotingEnabled - Whether blind voting is enabled for this prompt
 * @param {boolean} pollClosed - Whether the poll has closed (deadline passed)
 */
export default function ResponseDashboard({
  promptId,
  isAdmin = false,
  currentUserId,
  blindVotingEnabled = false,
  pollClosed = false,
}) {
  const [respondents, setRespondents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [remindingUserId, setRemindingUserId] = useState(null);
  const [reminderError, setReminderError] = useState(null);

  // Fetch respondents on mount
  const fetchRespondents = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await promptAPI.getRespondents(promptId);
      setRespondents(data);
    } catch (err) {
      console.error('Failed to fetch respondents:', err);
      setError(err.message || 'Failed to load respondents');
    } finally {
      setLoading(false);
    }
  }, [promptId]);

  useEffect(() => {
    if (promptId) {
      fetchRespondents();
    }
  }, [promptId, fetchRespondents]);

  // Handle sending reminder
  const handleRemind = async (userId) => {
    setRemindingUserId(userId);
    setReminderError(null);

    try {
      await promptAPI.sendReminder(promptId, userId);

      // Update local state with new last_reminded_at
      setRespondents(prev => prev.map(r =>
        r.user_id === userId
          ? { ...r, last_reminded_at: new Date().toISOString() }
          : r
      ));
    } catch (err) {
      console.error('Failed to send reminder:', err);

      // Cooldown is code-driven, not prose-matched (the BE rewrote the old
      // cooldown-duration wording to the generic registry message). Branch on the
      // machine code `reminder_cooldown` and surface the exact reopen time from
      // the envelope. NOTE: ApiError.details carries the WHOLE response body, so
      // the envelope's own `details` is nested one level deeper —
      // err.details.details.next_reminder_available (verified against the BE
      // sendError('reminder_cooldown', { next_reminder_available }) shape).
      if (err?.code === 'reminder_cooldown') {
        const nextAvailable = err?.details?.details?.next_reminder_available;
        if (nextAvailable) {
          const when = new Date(nextAvailable).toLocaleString([], {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
          });
          setReminderError(`You reminded this user recently. You can remind them again after ${when}.`);
        } else {
          setReminderError('You reminded this user recently. Please wait before reminding them again.');
        }
      } else {
        setReminderError(err.message || 'Failed to send reminder');
      }
    } finally {
      setRemindingUserId(null);
    }
  };

  // Calculate if user has responded (for blind voting visibility)
  const userHasResponded = respondents.find(
    r => r.user_id === currentUserId
  )?.has_responded;

  // Determine visibility level for slot counts
  const showSlotCounts = !blindVotingEnabled || pollClosed || userHasResponded;

  // Calculate response counts
  const responseCount = respondents.filter(r => r.has_responded).length;
  const totalCount = respondents.length;

  // Loading state
  if (loading) {
    return (
      <div className="bg-surface-card rounded-card border border-line p-4">
        <div className="animate-pulse">
          <div className="h-6 bg-surface-elevated rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-10 bg-surface-elevated rounded"></div>
            <div className="h-10 bg-surface-elevated rounded"></div>
            <div className="h-10 bg-surface-elevated rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-surface-card rounded-card border border-status-error/30 p-4">
        <div className="flex items-center gap-2 text-status-error">
          <ExclamationIcon className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchRespondents}
          className="mt-3 text-sm text-content-link hover:text-content-link-hover"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-surface-card rounded-card border border-line p-4">
      <h3 className="text-lg font-semibold text-content-primary mb-3">
        Responses: {responseCount}/{totalCount} responded
      </h3>

      {/* Reminder error message */}
      {reminderError && (
        <div className="mb-3 p-2 bg-status-error/10 border border-status-error/30 rounded text-sm text-status-error">
          {reminderError}
        </div>
      )}

      {/* Blind voting notice */}
      {blindVotingEnabled && !pollClosed && !userHasResponded && !isAdmin && (
        <div className="mb-3 p-2 bg-status-warning/10 border border-status-warning/30 rounded text-sm text-status-warning">
          Slot counts are hidden until you submit your response or the poll closes.
        </div>
      )}

      {/* Empty state */}
      {respondents.length === 0 ? (
        <p className="text-content-muted text-sm">No group members found.</p>
      ) : (
        /* Respondent list */
        <ul className="space-y-1">
          {respondents.map(r => (
            <li
              key={r.user_id}
              className="flex items-center justify-between py-2 px-2 rounded hover:bg-surface-card-hover border-b border-line last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                {r.has_responded ? (
                  <CheckIcon className="w-5 h-5 text-status-success flex-shrink-0" />
                ) : (
                  <ClockIcon className="w-5 h-5 text-content-muted flex-shrink-0" />
                )}

                <span className="text-content-primary truncate">
                  {r.username}
                  {r.user_id === currentUserId && (
                    <span className="text-content-muted text-sm ml-1">(you)</span>
                  )}
                </span>

                {r.has_responded && showSlotCounts && r.slot_count !== null && (
                  <span className="text-sm text-content-muted flex-shrink-0">
                    - {r.slot_count} slot{r.slot_count !== 1 ? 's' : ''} available
                  </span>
                )}

                {r.has_responded && (!showSlotCounts || r.slot_count === null) && (
                  <span className="text-sm text-content-muted flex-shrink-0">
                    - responded
                  </span>
                )}

                {!r.has_responded && (
                  <span className="text-sm text-content-muted flex-shrink-0">
                    - pending
                  </span>
                )}
              </div>

              {/* Remind button for admins on non-respondents */}
              {isAdmin && !r.has_responded && r.user_id !== currentUserId && (
                <RemindButton
                  userId={r.user_id}
                  lastRemindedAt={r.last_reminded_at}
                  isReminding={remindingUserId === r.user_id}
                  onRemind={handleRemind}
                />
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Refresh button */}
      <button
        onClick={fetchRespondents}
        className="mt-4 text-sm text-content-muted hover:text-content-secondary flex items-center gap-1"
      >
        <RefreshIcon className="w-4 h-4" />
        Refresh
      </button>
    </div>
  );
}

/**
 * RemindButton - Button to send reminder with 24-hour cooldown display
 */
function RemindButton({ userId, lastRemindedAt, isReminding, onRemind }) {
  // Check if within 24-hour cooldown
  if (lastRemindedAt) {
    const hoursSince = (Date.now() - new Date(lastRemindedAt)) / (1000 * 60 * 60);
    if (hoursSince < 24) {
      const hoursAgo = Math.floor(hoursSince);
      const minutesAgo = Math.floor((hoursSince % 1) * 60);

      let timeAgo;
      if (hoursAgo === 0) {
        timeAgo = `${minutesAgo}m ago`;
      } else {
        timeAgo = `${hoursAgo}h ago`;
      }

      return (
        <span className="text-sm text-content-muted flex-shrink-0">
          Reminded {timeAgo}
        </span>
      );
    }
  }

  return (
    <button
      onClick={() => onRemind(userId)}
      disabled={isReminding}
      className="px-3 py-1 text-sm text-content-link hover:bg-accent/10 rounded disabled:opacity-50 flex-shrink-0 transition-colors"
    >
      {isReminding ? 'Sending...' : 'Remind'}
    </button>
  );
}


// Icon Components

function CheckIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  );
}

function ClockIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  );
}

function ExclamationIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
    </svg>
  );
}

function RefreshIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  );
}
