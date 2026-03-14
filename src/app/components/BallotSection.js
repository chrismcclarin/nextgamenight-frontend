'use client';
import { useState, useEffect, useCallback } from 'react';
import { ballotAPI } from '../../lib/api';

/**
 * BallotSection - Game voting ballot for an event
 * Shows ballot options for voting (open), winner display (closed),
 * tie-break prompt (organizer), and fallback pick (no votes).
 *
 * @param {string} eventId - UUID of the event
 * @param {string} currentUserId - Auth0 user ID (user.sub)
 * @param {string|Date} eventDate - Event start date
 * @param {string} userRole - 'owner' | 'admin' | 'member'
 * @param {string|null} userRsvpStatus - 'yes' | 'maybe' | 'no' | null
 */
export default function BallotSection({ eventId, currentUserId, eventDate, userRole, userRsvpStatus }) {
  const [ballot, setBallot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votingOptionId, setVotingOptionId] = useState(null); // tracks which option is being toggled

  const isOrganizer = userRole === 'owner' || userRole === 'admin';
  const canVote = userRsvpStatus === 'yes' || userRsvpStatus === 'maybe';

  const fetchBallot = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const data = await ballotAPI.getBallot(eventId);
      setBallot(data);
    } catch (err) {
      // 404 or other error means no ballot -- render nothing
      setBallot(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchBallot();
  }, [fetchBallot]);

  const handleToggleVote = async (optionId) => {
    if (votingOptionId || !canVote) return;
    setVotingOptionId(optionId);
    setError(null);

    // Optimistic update
    setBallot(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        options: prev.options.map(opt =>
          opt.id === optionId
            ? { ...opt, user_voted: !opt.user_voted }
            : opt
        )
      };
    });

    try {
      await ballotAPI.toggleVote(eventId, optionId);
      // Refetch to ensure consistency
      await fetchBallot();
    } catch (err) {
      console.error('Error toggling vote:', err);
      setError('Could not save your vote. Please try again.');
      // Revert optimistic update
      await fetchBallot();
    } finally {
      setVotingOptionId(null);
    }
  };

  const handleResolveTie = async (optionId) => {
    if (!isOrganizer) return;
    setError(null);
    try {
      await ballotAPI.resolveTie(eventId, optionId);
      await fetchBallot();
    } catch (err) {
      console.error('Error resolving tie:', err);
      setError('Could not set the winner. Please try again.');
    }
  };

  // Relative time helper
  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const target = new Date(dateStr);
    const now = new Date();
    const diffMs = target - now;
    if (diffMs <= 0) return 'soon';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    if (diffHours > 0) return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="mt-4 p-4 bg-gray-50 rounded-lg">
        <p className="text-sm text-gray-500">Loading ballot...</p>
      </div>
    );
  }

  // No ballot exists
  if (!ballot || ballot.ballot_status === null) {
    return null;
  }

  const { ballot_status, rsvp_deadline, options, winner, needs_tie_break, needs_fallback_pick, tied_options } = ballot;

  // --- CLOSED BALLOT STATES ---
  if (ballot_status === 'closed') {
    // Winner determined
    if (winner) {
      return (
        <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            {/* Winner card */}
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-green-800">Winner</span>
              </div>
              <p className="text-lg font-semibold text-green-900 mt-1">{winner.game_name}</p>
            </div>
            {/* Other options (muted, no counts) */}
            {options && options.filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name).length > 0 && (
              <div className="space-y-1">
                {options
                  .filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name)
                  .map(opt => (
                    <div key={opt.id} className="px-3 py-2 text-sm text-gray-400 bg-gray-50 rounded">
                      {opt.game_name}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Tie -- organizer picks winner
    if (needs_tie_break && isOrganizer) {
      return (
        <div className="mt-4 border border-amber-300 rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
            <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-amber-800 mb-3">
              Voting ended in a tie! Pick the winning game:
            </p>
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="space-y-2">
              {(tied_options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleResolveTie(opt.id)}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition-colors text-sm font-medium text-gray-900 cursor-pointer"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // Tie -- non-organizer view
    if (needs_tie_break && !isOrganizer) {
      return (
        <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600">
              Voting has closed. The organizer is choosing the winning game.
            </p>
          </div>
        </div>
      );
    }

    // No votes -- organizer fallback pick
    if (needs_fallback_pick && isOrganizer) {
      return (
        <div className="mt-4 border border-amber-300 rounded-lg overflow-hidden">
          <div className="bg-amber-50 px-4 py-3 border-b border-amber-200">
            <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-amber-800 mb-3">
              No votes were cast. Pick a game for this event:
            </p>
            {error && <p className="text-sm text-red-600 mb-2">{error}</p>}
            <div className="space-y-2">
              {(options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleResolveTie(opt.id)}
                  className="w-full text-left px-4 py-3 rounded-lg border-2 border-amber-200 bg-amber-50 hover:bg-amber-100 hover:border-amber-400 transition-colors text-sm font-medium text-gray-900 cursor-pointer"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    // No votes -- non-organizer view
    if (needs_fallback_pick && !isOrganizer) {
      return (
        <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-gray-600">
              Voting has closed. The organizer is choosing the game.
            </p>
          </div>
        </div>
      );
    }

    // Fallback closed state (shouldn't normally reach here)
    return null;
  }

  // --- OPEN BALLOT ---
  return (
    <div className="mt-4 border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-900 text-sm">Game Vote</h3>
        <p className="text-xs text-gray-500 mt-0.5">Tap games you'd enjoy playing</p>
      </div>

      <div className="p-4 space-y-3">
        {error && <p className="text-sm text-red-600">{error}</p>}

        {/* Voting options */}
        {canVote ? (
          <div className="space-y-2">
            {(options || []).map(opt => {
              const isVoted = opt.user_voted;
              const isToggling = votingOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleToggleVote(opt.id)}
                  disabled={!!votingOptionId}
                  className={`w-full text-left px-4 py-3 rounded-lg border-2 transition-colors text-sm font-medium cursor-pointer
                    ${isVoted
                      ? 'border-blue-500 bg-blue-50 text-blue-900'
                      : 'border-gray-200 bg-white text-gray-900 hover:bg-gray-50 hover:border-gray-300'
                    }
                    ${isToggling ? 'opacity-70' : ''}
                    ${votingOptionId && !isToggling ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span>{opt.game_name}</span>
                    {isVoted && (
                      <span className="text-blue-600 text-xs font-semibold">Voted</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div>
            {/* Read-only option list for non-voters */}
            <div className="space-y-2 mb-3">
              {(options || []).map(opt => (
                <div
                  key={opt.id}
                  className="px-4 py-3 rounded-lg border border-gray-200 bg-gray-50 text-sm text-gray-700"
                >
                  {opt.game_name}
                </div>
              ))}
            </div>
            <p className="text-sm text-gray-500 italic">
              RSVP Yes or Maybe to vote on the game
            </p>
          </div>
        )}

        {/* Voting closes footer */}
        {rsvp_deadline && (
          <p className="text-xs text-gray-400 mt-2">
            Voting closes {getRelativeTime(rsvp_deadline)}
          </p>
        )}
      </div>
    </div>
  );
}
