'use client';
import { useState, useEffect, useCallback } from 'react';
import { ballotAPI } from '../../lib/api';

/**
 * BallotSection - Game voting ballot for an event
 */
export default function BallotSection({ eventId, currentUserId, eventDate, userRole, userRsvpStatus }) {
  const [ballot, setBallot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votingOptionId, setVotingOptionId] = useState(null);

  const isOrganizer = userRole === 'owner' || userRole === 'admin';
  const canVote = userRsvpStatus === 'yes' || userRsvpStatus === 'maybe';

  const fetchBallot = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const data = await ballotAPI.getBallot(eventId);
      setBallot(data);
    } catch (err) {
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
      await fetchBallot();
    } catch (err) {
      console.error('Error toggling vote:', err);
      setError('Could not save your vote. Please try again.');
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
      <div className="mt-4 p-4 bg-surface-elevated rounded-card">
        <p className="text-sm text-content-muted">Loading ballot...</p>
      </div>
    );
  }

  if (!ballot || ballot.ballot_status === null) {
    return null;
  }

  const { ballot_status, rsvp_deadline, options, winner, needs_tie_break, needs_fallback_pick, tied_options } = ballot;

  // --- CLOSED BALLOT STATES ---
  if (ballot_status === 'closed') {
    if (winner) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <div className="bg-status-success/10 border border-status-success/30 rounded-card p-4 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-status-success">Winner</span>
              </div>
              <p className="text-lg font-semibold text-content-primary mt-1">{winner.game_name}</p>
            </div>
            {options && options.filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name).length > 0 && (
              <div className="space-y-1">
                {options
                  .filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name)
                  .map(opt => (
                    <div key={opt.id} className="px-3 py-2 text-sm text-content-muted bg-surface-elevated rounded">
                      {opt.game_name}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (needs_tie_break && isOrganizer) {
      return (
        <div className="mt-4 border border-status-warning rounded-card overflow-hidden">
          <div className="bg-status-warning/10 px-4 py-3 border-b border-status-warning/30">
            <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-status-warning mb-3">
              Voting ended in a tie! Pick the winning game:
            </p>
            {error && <p className="text-sm text-status-error mb-2">{error}</p>}
            <div className="space-y-2">
              {(tied_options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleResolveTie(opt.id)}
                  className="w-full text-left px-4 py-3 rounded-card border-2 border-status-warning/30 bg-status-warning/10 hover:bg-status-warning/20 transition-colors text-sm font-medium text-content-primary cursor-pointer"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (needs_tie_break && !isOrganizer) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-content-secondary">
              Voting has closed. The organizer is choosing the winning game.
            </p>
          </div>
        </div>
      );
    }

    if (needs_fallback_pick && isOrganizer) {
      return (
        <div className="mt-4 border border-status-warning rounded-card overflow-hidden">
          <div className="bg-status-warning/10 px-4 py-3 border-b border-status-warning/30">
            <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm font-medium text-status-warning mb-3">
              No votes were cast. Pick a game for this event:
            </p>
            {error && <p className="text-sm text-status-error mb-2">{error}</p>}
            <div className="space-y-2">
              {(options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => handleResolveTie(opt.id)}
                  className="w-full text-left px-4 py-3 rounded-card border-2 border-status-warning/30 bg-status-warning/10 hover:bg-status-warning/20 transition-colors text-sm font-medium text-content-primary cursor-pointer"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (needs_fallback_pick && !isOrganizer) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
          </div>
          <div className="p-4">
            <p className="text-sm text-content-secondary">
              Voting has closed. The organizer is choosing the game.
            </p>
          </div>
        </div>
      );
    }

    return null;
  }

  // --- OPEN BALLOT ---
  return (
    <div id="vote" className="mt-4 border border-line rounded-card overflow-hidden">
      <div className="bg-surface-elevated px-4 py-3 border-b border-line">
        <h3 className="font-semibold text-content-primary text-sm">Game Vote</h3>
        <p className="text-xs text-content-muted mt-0.5">Tap games you'd enjoy playing</p>
      </div>

      <div className="p-4 space-y-3">
        {error && <p className="text-sm text-status-error">{error}</p>}

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
                  className={`w-full text-left px-4 py-3 rounded-card border-2 transition-colors text-sm font-medium cursor-pointer
                    ${isVoted
                      ? 'border-accent bg-accent/10 text-content-primary'
                      : 'border-line bg-surface-card text-content-primary hover:bg-surface-card-hover hover:border-line-strong'
                    }
                    ${isToggling ? 'opacity-70' : ''}
                    ${votingOptionId && !isToggling ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span>{opt.game_name}</span>
                    {isVoted && (
                      <span className="text-accent text-xs font-semibold">Voted</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          // POLL-06 (D-BALLOT-07): defense-in-depth gated state.
          // The backend gate at routes/ballot.js:325-348 also rejects
          // votes from non-yes/maybe-RSVPed users; this UI prevents the
          // user from bouncing off a 403 by hiding vote buttons entirely.
          <div role="region" aria-label="Vote gated until RSVP">
            <div className="space-y-2 mb-3">
              {(options || []).map(opt => (
                <div
                  key={opt.id}
                  className="px-4 py-3 rounded-card border border-line bg-surface-elevated text-sm text-content-secondary"
                >
                  {opt.game_name}
                </div>
              ))}
            </div>
            <p className="text-sm text-content-muted italic">
              RSVP Yes or Maybe to vote on the game
            </p>
          </div>
        )}

        {rsvp_deadline && (
          <p className="text-xs text-content-muted mt-2">
            Voting closes {getRelativeTime(rsvp_deadline)}
          </p>
        )}
      </div>
    </div>
  );
}
