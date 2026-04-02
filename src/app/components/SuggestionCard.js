'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { suggestionAPI } from '@/lib/api';
import { formatDate, formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';

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
  const { timezone } = useTimezone();
  const [isConverting, setIsConverting] = useState(false);
  const [error, setError] = useState(null);

  const startDate = formatDate(suggestion.suggested_start, timezone);
  const startTime = formatTime(suggestion.suggested_start, timezone);
  const endTime = formatTime(suggestion.suggested_end, timezone);

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
    if (!suggestion.meets_minimum) return 'bg-surface-card-hover border-line';
    if (suggestion.preferred_count === suggestion.participant_count) {
      return 'bg-status-success/10 border-status-success/30'; // All preferred
    }
    return 'bg-status-warning/10 border-status-warning/30'; // Mix of preferred and if-need-be
  };

  return (
    <div className={`rounded-card border-2 p-4 ${getScoreColor()}`}>
      {/* Time slot header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          <div className="font-semibold text-content-primary">
            {startDate}
          </div>
          <div className="text-sm text-content-secondary">
            {startTime} - {endTime}
          </div>
        </div>

        {/* Score badge */}
        <div className="text-right">
          <div className="text-2xl font-bold text-content-primary">
            {suggestion.participant_count}
          </div>
          <div className="text-xs text-content-muted">
            {suggestion.participant_count === 1 ? 'player' : 'players'}
          </div>
        </div>
      </div>

      {/* Participant breakdown */}
      <div className="text-sm text-content-secondary mb-3">
        {suggestion.preferred_count > 0 && (
          <span className="inline-flex items-center mr-3">
            <span className="w-2 h-2 rounded-full bg-status-success mr-1"></span>
            {suggestion.preferred_count} preferred
          </span>
        )}
        {suggestion.participant_count - suggestion.preferred_count > 0 && (
          <span className="inline-flex items-center">
            <span className="w-2 h-2 rounded-full bg-status-warning mr-1"></span>
            {suggestion.participant_count - suggestion.preferred_count} if-need-be
          </span>
        )}
      </div>

      {/* Status indicators */}
      {!suggestion.meets_minimum && (
        <div className="text-sm text-content-muted italic mb-3">
          Below minimum threshold
        </div>
      )}

      {isAlreadyConverted && (
        <div className="text-sm text-content-link mb-3">
          Already converted to event
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-sm text-status-error mb-3">
          {error}
        </div>
      )}

      {/* Create Event button */}
      {canCreateEvent && (
        <button
          onClick={handleCreateEvent}
          disabled={isConverting}
          className={`w-full py-2 px-4 rounded-btn font-medium transition-colors
            ${isConverting
              ? 'bg-surface-card-hover text-content-muted cursor-not-allowed'
              : 'bg-btn-primary text-btn-primary-text hover:bg-btn-primary-hover'
            }`}
        >
          {isConverting ? 'Creating...' : 'Create Event'}
        </button>
      )}

      {/* View event link if already converted */}
      {isAlreadyConverted && (
        <button
          onClick={() => router.push(`/groups/${groupId}/events/${suggestion.converted_to_event_id}`)}
          className="w-full py-2 px-4 rounded-btn font-medium bg-surface-card-hover text-content-secondary hover:bg-surface-elevated transition-colors"
        >
          View Event
        </button>
      )}
    </div>
  );
}
