'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { suggestionAPI } from '@/lib/api';

/**
 * SuggestionCard - Displays a single availability suggestion with action buttons
 *
 * @param {Object} props
 * @param {Object} props.suggestion - Suggestion data from API
 * @param {string} props.groupId - Group UUID for navigation
 * @param {boolean} props.isAdmin - Whether current user can create events
 * @param {boolean} props.pollClosed - Whether the poll deadline has passed
 * @param {function} props.onEventCreated - Callback after event creation
 */
export default function SuggestionCard({
  suggestion,
  groupId,
  isAdmin,
  pollClosed,
  onEventCreated
}) {
  const router = useRouter();
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState(null);

  const formatDateTime = (dateString) => {
    const date = new Date(dateString);
    return {
      date: date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric'
      }),
      time: date.toLocaleTimeString('en-US', {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
      })
    };
  };

  const start = formatDateTime(suggestion.suggested_start);
  const end = formatDateTime(suggestion.suggested_end);

  const handleCreateEvent = async () => {
    if (isConverting) return;

    setIsConverting(true);
    setError(null);

    try {
      const result = await suggestionAPI.convert(suggestion.id);

      if (result.success && result.event_id) {
        // Notify parent component
        if (onEventCreated) {
          onEventCreated(result.event_id);
        }

        // Navigate to the new event
        router.push(`/groups/${groupId}/events/${result.event_id}`);
      } else {
        setError(result.error || 'Failed to create event');
      }
    } catch (err) {
      setError(err.message || 'Failed to create event');
    } finally {
      setIsConverting(false);
    }
  };

  const isAlreadyConverted = !!suggestion.converted_to_event_id;
  const canCreateEvent = isAdmin && !isAlreadyConverted;

  // Color based on score/participant count
  const getScoreColor = () => {
    if (!suggestion.meets_minimum) return 'bg-gray-100 border-gray-300';
    if (suggestion.preferred_count === suggestion.participant_count) {
      return 'bg-green-50 border-green-300'; // All preferred
    }
    return 'bg-yellow-50 border-yellow-300'; // Mix of preferred and if-need-be
  };

  return (
    <div className={`rounded-lg border-2 p-4 ${getScoreColor()}`}>
      {/* Time slot header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-semibold text-gray-900">
            {start.date}
          </div>
          <div className="text-sm text-gray-600">
            {start.time} - {end.time}
          </div>
        </div>

        {/* Score badge */}
        <div className="text-right">
          <div className="text-2xl font-bold text-gray-900">
            {suggestion.participant_count}
          </div>
          <div className="text-xs text-gray-500">
            {suggestion.participant_count === 1 ? 'player' : 'players'}
          </div>
        </div>
      </div>

      {/* Participant breakdown */}
      <div className="text-sm text-gray-600 mb-3">
        {suggestion.preferred_count > 0 && (
          <span className="inline-flex items-center mr-3">
            <span className="w-2 h-2 rounded-full bg-green-500 mr-1"></span>
            {suggestion.preferred_count} preferred
          </span>
        )}
        {suggestion.participant_count - suggestion.preferred_count > 0 && (
          <span className="inline-flex items-center">
            <span className="w-2 h-2 rounded-full bg-yellow-500 mr-1"></span>
            {suggestion.participant_count - suggestion.preferred_count} if-need-be
          </span>
        )}
      </div>

      {/* Status indicators */}
      {!suggestion.meets_minimum && (
        <div className="text-sm text-gray-500 italic mb-3">
          Below minimum threshold
        </div>
      )}

      {isAlreadyConverted && (
        <div className="text-sm text-blue-600 mb-3">
          Already converted to event
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-sm text-red-600 mb-3">
          {error}
        </div>
      )}

      {/* Create Event button */}
      {canCreateEvent && (
        <button
          onClick={handleCreateEvent}
          disabled={isConverting}
          className={`w-full py-2 px-4 rounded-md font-medium transition-colors
            ${isConverting
              ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
              : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
        >
          {isConverting ? 'Creating...' : 'Create Event'}
        </button>
      )}

      {/* View event link if already converted */}
      {isAlreadyConverted && (
        <button
          onClick={() => router.push(`/groups/${groupId}/events/${suggestion.converted_to_event_id}`)}
          className="w-full py-2 px-4 rounded-md font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
        >
          View Event
        </button>
      )}
    </div>
  );
}
