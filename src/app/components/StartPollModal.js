'use client';

import { useState, useMemo, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

/**
 * StartPollModal — Phase 71.2 (POLL-01 / D-UI-01)
 *
 * Modal form for creating a manual availability poll. Submits POST /api/prompts
 * with active-member-gated body. Surfaces backend errors inline (409 conflict
 * on duplicate open poll, 403 not-active, 400 validation, 5xx).
 *
 * Defaults:
 *   - deadline: now + 72 hours, matches the recurring-schedule worker default
 *     (workers/promptWorker.js: effectiveDeadlineHours = 72).
 *   - week_identifier: ISO-week of the deadline (computed via getISOWeek below,
 *     ported from workers/promptWorker.js:54-61).
 *   - auto_schedule_enabled: false — D-ADAPT-04 removed auto-event-creation
 *     entirely; explicit-false avoids ambiguity in the persisted row.
 *   - blind_voting_enabled: false.
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group  - Full group object (for game dropdown)
 * @param {boolean} props.isOpen - Modal visibility
 * @param {Function} props.onClose - Close callback
 * @param {Function} props.onSuccess - Called after successful create with the new prompt
 */

// ISO-week identifier (e.g. "2026-W19"). Ported from workers/promptWorker.js:54-61
// so the frontend default matches the format the recurring-schedule worker
// stores. See the source comment for context — kept in lockstep deliberately.
function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
}

// "Week of YYYY-MM-DD" — the Monday of the ISO week containing `date`.
// Display-only (the wire payload uses the ISO-week id).
function formatWeekOf(date) {
  const d = new Date(date);
  const day = d.getDay();
  // Distance to ISO-Monday: getDay() returns 0 (Sun)..6 (Sat). Monday is 1.
  const diff = (day === 0 ? -6 : 1 - day);
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return monday.toISOString().slice(0, 10);
}

// Default deadline = now + 72h, formatted for <input type="datetime-local">.
function defaultDeadlineLocal() {
  const future = new Date(Date.now() + 72 * 60 * 60 * 1000);
  // datetime-local wants YYYY-MM-DDTHH:mm (no seconds, no Z) in LOCAL time.
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}` +
    `T${pad(future.getHours())}:${pad(future.getMinutes())}`
  );
}

export default function StartPollModal({ groupId, group, isOpen, onClose, onSuccess }) {
  const [deadlineLocal, setDeadlineLocal] = useState(defaultDeadlineLocal);
  const [customMessage, setCustomMessage] = useState('');
  const [gameId, setGameId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Reset form whenever the modal is re-opened — without this a closed-then-
  // re-opened modal would carry stale state (especially errors from a prior
  // failed submit).
  useEffect(() => {
    if (isOpen) {
      setDeadlineLocal(defaultDeadlineLocal());
      setCustomMessage('');
      setGameId('');
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Computed: ISO week of deadline + display "Week of YYYY-MM-DD"
  const { weekIdentifier, weekDisplay } = useMemo(() => {
    if (!deadlineLocal) return { weekIdentifier: '', weekDisplay: '' };
    const d = new Date(deadlineLocal);
    if (Number.isNaN(d.getTime())) return { weekIdentifier: '', weekDisplay: '' };
    return {
      weekIdentifier: getISOWeek(d),
      weekDisplay: formatWeekOf(d),
    };
  }, [deadlineLocal]);

  // Available games for the dropdown — fall back to empty list. Server reads
  // game_id as optional.
  const availableGames = useMemo(() => {
    if (Array.isArray(group?.games)) return group.games;
    return [];
  }, [group]);

  if (!isOpen) return null;

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (!deadlineLocal) {
      setError('Please pick a deadline.');
      return;
    }
    const deadlineDate = new Date(deadlineLocal);
    if (Number.isNaN(deadlineDate.getTime())) {
      setError('Deadline is not a valid date.');
      return;
    }
    if (deadlineDate.getTime() <= Date.now()) {
      setError('Deadline must be in the future.');
      return;
    }
    if (customMessage.length > 280) {
      setError('Custom message must be 280 characters or fewer.');
      return;
    }

    setSubmitting(true);
    try {
      const body = {
        group_id: groupId,
        deadline: deadlineDate.toISOString(),
        week_identifier: weekIdentifier,
        // Optional fields — backend ignores when absent:
        custom_message: customMessage.trim() || null,
        game_id: gameId || null,
        // D-ADAPT-04: never auto-schedule manual polls.
        auto_schedule_enabled: false,
        blind_voting_enabled: false,
      };
      const result = await apiFetch('/prompts', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      onSuccess?.(result?.prompt || result);
    } catch (err) {
      // apiFetch throws Error(message) on non-2xx; map common backend messages
      // to friendlier copy. The 409 string is the backend's canonical message
      // (D-ADAPT-02 — keep frontend mirror in sync if backend copy ever changes).
      const msg = (err && err.message) || 'Something went wrong. Try again.';
      if (/already has an open poll/i.test(msg)) {
        setError('This group already has an open poll. Close it before starting another.');
      } else if (/active group member/i.test(msg)) {
        setError('You must be an active group member to start a poll.');
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 100 }}
      onClick={onClose}
    >
      <div
        className="modal-content p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header mb-4 flex items-center justify-between">
          <h2 className="text-2xl font-bold text-content-primary">Start a check-in</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-content-muted hover:text-content-primary text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <p className="text-sm text-content-secondary mb-4">
          Send a check-in to your group asking when they&apos;re free — they tap, paint their availability, you find the night.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-btn">
            <p className="text-status-error text-sm">{error}</p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-deadline">
              Deadline
            </label>
            <input
              id="poll-deadline"
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              className="w-full px-3 py-2 bg-surface-card border border-line rounded-btn text-content-primary focus:outline-none focus:border-line-accent"
              required
            />
            <p className="text-xs text-content-muted mt-1">
              Default is 72 hours from now &mdash; the same as recurring schedules.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1">
              Week
            </label>
            <input
              type="text"
              value={weekDisplay ? `Week of ${weekDisplay} (${weekIdentifier})` : ''}
              readOnly
              className="w-full px-3 py-2 bg-surface-card-hover border border-line rounded-btn text-content-secondary cursor-not-allowed"
            />
            <p className="text-xs text-content-muted mt-1">
              Auto-computed from the deadline using ISO weeks.
            </p>
          </div>

          {availableGames.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-game">
                Game (optional)
              </label>
              <select
                id="poll-game"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
                className="w-full px-3 py-2 bg-surface-card border border-line rounded-btn text-content-primary focus:outline-none focus:border-line-accent"
              >
                <option value="">No specific game</option>
                {availableGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.title || 'Unnamed game'}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-message">
              Custom message (optional)
            </label>
            <textarea
              id="poll-message"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="e.g. Let's try to lock in a date for the campaign next session."
              className="w-full px-3 py-2 bg-surface-card border border-line rounded-btn text-content-primary focus:outline-none focus:border-line-accent resize-none"
            />
            <p className="text-xs text-content-muted mt-1">
              {customMessage.length}/280 characters
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="btn btn-primary"
            >
              {submitting ? 'Starting...' : 'Start poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
