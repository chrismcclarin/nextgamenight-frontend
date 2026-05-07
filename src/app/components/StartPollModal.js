'use client';

import { useState, useMemo, useEffect } from 'react';
import { pollsAPI } from '../../lib/api';

/**
 * StartPollModal — POLL-01 create surface.
 *
 * Encodes the four creation-side D-POLL-CREATE decisions:
 *   D-POLL-CREATE-06: response_deadline defaults to 24h before earliest
 *                     day in the date_window. Creator can override but
 *                     deadline must remain BEFORE date_window_start.
 *   D-POLL-CREATE-09: 1-14 day window picker (default 7 days).
 *   D-POLL-CREATE-10: 409 conflict (one open poll per group) surfaces
 *                     inline as an error message; backend is the source
 *                     of truth via the partial unique index.
 *   D-POLL-CREATE-02: active-only is enforced server-side; the modal
 *                     should never be reachable from a pending member
 *                     because groupHomePage gates the trigger button.
 *
 * The modal is intentionally form-only — no in-modal preview of who
 * will be notified, no opt-out toggles. The plan reserves those for the
 * notification-prefs row in userProfile (Task 3).
 */
function defaultDeadline(dateWindowStart) {
  // 24 hours before midnight of date_window_start (start of day).
  // dateWindowStart is "YYYY-MM-DD". Build a Date at the user's local midnight,
  // then subtract 24h. Format back to "YYYY-MM-DDTHH:mm" for datetime-local input.
  if (!dateWindowStart) return '';
  const startMidnight = new Date(`${dateWindowStart}T00:00:00`);
  if (Number.isNaN(startMidnight.getTime())) return '';
  const dl = new Date(startMidnight.getTime() - 24 * 60 * 60 * 1000);
  const yyyy = dl.getFullYear();
  const mm = String(dl.getMonth() + 1).padStart(2, '0');
  const dd = String(dl.getDate()).padStart(2, '0');
  const hh = String(dl.getHours()).padStart(2, '0');
  const mi = String(dl.getMinutes()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
}

function todayLocalDateString() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysIso(dateStr, days) {
  const d = new Date(`${dateStr}T00:00:00`);
  d.setDate(d.getDate() + days);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export default function StartPollModal({ groupId, onCancel, onCreated }) {
  const [windowStart, setWindowStart] = useState(() => addDaysIso(todayLocalDateString(), 1));
  const [duration, setDuration] = useState(7); // D-POLL-CREATE-09 default
  const [deadline, setDeadline] = useState(() => defaultDeadline(addDaysIso(todayLocalDateString(), 1)));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  // Track whether the user has manually edited the deadline so we don't
  // clobber their override when they change windowStart/duration.
  const [deadlineDirty, setDeadlineDirty] = useState(false);

  const windowEnd = useMemo(() => {
    if (!windowStart) return '';
    return addDaysIso(windowStart, duration - 1);
  }, [windowStart, duration]);

  // Recompute the suggested deadline when windowStart changes UNLESS the
  // creator has manually overridden it. D-POLL-CREATE-06 default = 24h
  // before earliest day in window.
  useEffect(() => {
    if (!deadlineDirty) {
      setDeadline(defaultDeadline(windowStart));
    }
  }, [windowStart, deadlineDirty]);

  const validate = () => {
    if (!windowStart) return 'Pick a date for the start of the window';
    if (duration < 1 || duration > 14) return 'Window must be between 1 and 14 days';
    if (!deadline) return 'Pick a response deadline';
    const startDate = new Date(`${windowStart}T00:00:00`);
    const dl = new Date(deadline);
    if (Number.isNaN(dl.getTime())) return 'Response deadline is invalid';
    if (dl >= startDate) return 'Response deadline must be before the date window starts';
    return null;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    try {
      const poll = await pollsAPI.createPoll({
        group_id: groupId,
        date_window_start: windowStart,
        date_window_end: windowEnd,
        // Send as ISO datetime so backend Date parsing is timezone-explicit.
        response_deadline: new Date(deadline).toISOString(),
      });
      onCreated?.(poll);
    } catch (err) {
      // Backend throws 409 for D-POLL-CREATE-10 violation; the message comes
      // through verbatim from pollService ("There is already an open poll
      // for this group").
      setError(err?.message || 'Failed to create poll. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 100 }}
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel?.();
      }}
    >
      <div className="modal-content p-6 max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-content-primary">Start an availability poll</h2>
            <p className="text-sm text-content-secondary mt-1">
              Pick a date window and a response deadline. Members will be notified.
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            className="text-content-muted hover:text-content-primary text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-window-start">
              Window starts
            </label>
            <input
              id="poll-window-start"
              type="date"
              value={windowStart}
              min={todayLocalDateString()}
              onChange={(e) => setWindowStart(e.target.value)}
              className="w-full bg-surface-input border border-line rounded-btn px-3 py-2 text-content-primary"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-duration">
              Window length: {duration} day{duration === 1 ? '' : 's'}
            </label>
            <input
              id="poll-duration"
              type="range"
              min={1}
              max={14}
              value={duration}
              onChange={(e) => setDuration(parseInt(e.target.value, 10))}
              className="w-full"
            />
            <p className="text-xs text-content-muted mt-1">
              {windowStart && windowEnd ? (
                <>
                  Window: <span className="font-medium text-content-secondary">{windowStart}</span> &rarr;{' '}
                  <span className="font-medium text-content-secondary">{windowEnd}</span>
                </>
              ) : null}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-content-primary mb-1" htmlFor="poll-deadline">
              Responses close at
            </label>
            <input
              id="poll-deadline"
              type="datetime-local"
              value={deadline}
              onChange={(e) => {
                setDeadline(e.target.value);
                setDeadlineDirty(true);
              }}
              className="w-full bg-surface-input border border-line rounded-btn px-3 py-2 text-content-primary"
              required
            />
            <p className="text-xs text-content-muted mt-1">
              Defaults to 24 hours before the window starts. Must be before the window opens.
            </p>
          </div>

          {error && (
            <div className="bg-status-error/10 border border-status-error/30 rounded-btn p-3">
              <p className="text-sm text-status-error">{error}</p>
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="btn btn-secondary flex-1"
              disabled={submitting}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary flex-1"
              disabled={submitting}
            >
              {submitting ? 'Creating...' : 'Start poll'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
