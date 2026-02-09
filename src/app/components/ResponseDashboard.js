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

      // Handle 429 rate limit error
      if (err.message && err.message.includes('24 hours')) {
        setReminderError('Cannot remind this user more than once per 24 hours');
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
      <div className="bg-white rounded-lg border border-gray-200 p-4">
        <div className="animate-pulse">
          <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
          <div className="space-y-3">
            <div className="h-10 bg-gray-100 rounded"></div>
            <div className="h-10 bg-gray-100 rounded"></div>
            <div className="h-10 bg-gray-100 rounded"></div>
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="bg-white rounded-lg border border-red-200 p-4">
        <div className="flex items-center gap-2 text-red-600">
          <ExclamationIcon className="w-5 h-5" />
          <span>{error}</span>
        </div>
        <button
          onClick={fetchRespondents}
          className="mt-3 text-sm text-blue-600 hover:text-blue-800"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4">
      <h3 className="text-lg font-semibold text-gray-900 mb-3">
        Responses: {responseCount}/{totalCount} responded
      </h3>

      {/* Reminder error message */}
      {reminderError && (
        <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded text-sm text-red-600">
          {reminderError}
        </div>
      )}

      {/* Blind voting notice */}
      {blindVotingEnabled && !pollClosed && !userHasResponded && !isAdmin && (
        <div className="mb-3 p-2 bg-yellow-50 border border-yellow-200 rounded text-sm text-yellow-700">
          Slot counts are hidden until you submit your response or the poll closes.
        </div>
      )}

      {/* Empty state */}
      {respondents.length === 0 ? (
        <p className="text-gray-500 text-sm">No group members found.</p>
      ) : (
        /* Respondent list */
        <ul className="space-y-1">
          {respondents.map(r => (
            <li
              key={r.user_id}
              className="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 border-b border-gray-100 last:border-b-0"
            >
              <div className="flex items-center gap-2 min-w-0">
                {r.has_responded ? (
                  <CheckIcon className="w-5 h-5 text-green-500 flex-shrink-0" />
                ) : (
                  <ClockIcon className="w-5 h-5 text-gray-400 flex-shrink-0" />
                )}

                <span className="text-gray-900 truncate">
                  {r.username}
                  {r.user_id === currentUserId && (
                    <span className="text-gray-400 text-sm ml-1">(you)</span>
                  )}
                </span>

                {r.has_responded && showSlotCounts && r.slot_count !== null && (
                  <span className="text-sm text-gray-500 flex-shrink-0">
                    - {r.slot_count} slot{r.slot_count !== 1 ? 's' : ''} available
                  </span>
                )}

                {r.has_responded && (!showSlotCounts || r.slot_count === null) && (
                  <span className="text-sm text-gray-500 flex-shrink-0">
                    - responded
                  </span>
                )}

                {!r.has_responded && (
                  <span className="text-sm text-gray-400 flex-shrink-0">
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
        className="mt-4 text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
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
        <span className="text-sm text-gray-400 flex-shrink-0">
          Reminded {timeAgo}
        </span>
      );
    }
  }

  return (
    <button
      onClick={() => onRemind(userId)}
      disabled={isReminding}
      className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded disabled:opacity-50 flex-shrink-0 transition-colors"
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
