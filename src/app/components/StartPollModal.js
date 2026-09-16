'use client';

import { useState, useMemo, useEffect, useRef } from 'react';
import { apiFetch } from '../../lib/api';
import { Modal } from './Modal';
import { Input, Textarea, SelectControl } from '@/components/ui/Input';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';

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
  // 88-33 Task 4 (UAT row 291): initial-focus target.
  const deadlineInputRef = useRef(null);

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
      /* DECISION Phase 88.6-22 (C1a — X1/D16/D54/D15): this catch keys on the HTTP STATUS, not
         on the backend's PROSE. Chosen OVER the two `/already has an open poll/i` and
         `/active group member/i` regexes it shipped with, and over rendering `err.message` raw.

         WHAT WAS REJECTED AND WHY. The regexes couple this modal to backend copy: the
         D-ADAPT-02 comment that stood here said "keep frontend mirror in sync if backend copy
         ever changes", which is a maintenance contract nobody can enforce across two repos. The
         raw `setError(msg)` else arm was worse — `ApiError.message` is
         `body.message ?? body.error ?? 'HTTP error! status: N'` (api.ts:308-310), so an
         unhandled 500 painted a raw status string at the user (T-88-25-01).

         THE PRECONDITION THE CODE ARMS REST ON, confirmed by reading the handler rather than
         assumed: `POST /prompts` emits EXACTLY ONE 403
         (`availabilityPrompt.js:446`, the not-an-active-member gate) and EXACTLY ONE 409
         (`:480`, the one-open-manual-poll partial unique index) across its whole body
         (`:396-539`). `statusToCode` already maps 403 -> `forbidden` and 409 -> `conflict`
         (api.ts:278, :285), so the two overrides below are unambiguous. STATUS IS THE CONTRACT;
         the prose is not. This is FE-only — no backend edit, and none is needed.

         NO `fallback` IS PASSED, deliberately. `getFetchErrorMessage` applies `fallback` only
         when the derived code is `unknown` (useFetchErrorState.ts:171), so a fallback here would
         keep an authored string alive on the very surface this sweep converges. A code-less
         failure resolves to the register's `unknown` line instead.

         THIS IS ALSO WHAT KEEPS THE MODAL CORRECT AFTER PLAN 42 drops api.ts:309's `body?.error`
         alias: `POST /prompts` returns raw `{ error }` bodies, so `ApiError.message` becomes
         `HTTP error! status: N` — which the old regexes would miss and the old else arm would
         have painted at the user verbatim.

         The two override strings are this modal's OWN shipped copy moved across, not new copy.
         Going back to prose matching is a decision, not a cleanup. */
      setError(
        getFetchErrorMessage(err, {
          byCode: {
            conflict: 'This group already has an open poll. Close it before starting another.',
            forbidden: 'You must be an active group member to start a poll.',
          },
        })
      );
    } finally {
      setSubmitting(false);
    }
  };

  // dismissable={false} defeats overlay/outside-click dismissal so an accidental
  // click can't discard the in-progress form (D-09). Esc + the explicit Close /
  // Cancel still close. The submit button lives in <Modal.Footer> (outside the
  // <form>) but stays wired to it via the `form="start-poll-form"` attribute.
  return (
    /* 88-33 Task 4 (UAT row 291, fleet initial-focus policy): form-bearing modal —
       focus opens on the first meaningful input (the deadline field). */
    <Modal open={isOpen} onClose={onClose} dismissable={false} initialFocusRef={deadlineInputRef}>
      <Modal.Header>Start a check-in</Modal.Header>
      <Modal.Body>
        {/* UI-SPEC §4.5: the four `<label>`s below moved 500 -> 400, matching the shipped
            field primitive byte-for-byte — `FormField.tsx:98` renders
            `block text-sm font-normal text-content-primary mb-1`. Chosen OVER 700 (these are
            field labels, not hierarchy) and OVER simply deleting the utility (the explicit
            `font-normal` is what makes the convergence onto FormField's spelling visible). */}
        <p className="text-sm text-content-secondary mb-4">
          Send a check-in to your group asking when they&apos;re free — they tap, paint their availability, you find the night.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-status-error-subtle border border-status-error rounded-btn">
            <p className="text-content-status-error text-sm">{error}</p>
          </div>
        )}

        <form id="start-poll-form" onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-normal text-content-primary mb-1" htmlFor="poll-deadline">
              Deadline
            </label>
            <Input
              ref={deadlineInputRef}
              id="poll-deadline"
              name="poll-deadline"
              type="datetime-local"
              value={deadlineLocal}
              onChange={(e) => setDeadlineLocal(e.target.value)}
              required
            />
            <p className="text-xs text-content-muted mt-1">
              Default is 72 hours from now &mdash; the same as recurring schedules.
            </p>
          </div>

          <div>
            <label className="block text-sm font-normal text-content-primary mb-1" htmlFor="poll-week">
              Week
            </label>
            {/* DECISION Phase 88-21 (Req 1): adopts `Input` but KEEPS the read-only skin as an
                override — `bg-surface-muted` (named `bg-surface-card-hover` when 88-21 took this
                decision; renamed in 88.6-02 (D-15), value byte-equal) + `text-content-secondary`
                + `cursor-not-allowed`
                are the only thing telling a sighted user this field is auto-computed and not
                editable (it carries no visible disabled affordance otherwise). Chosen OVER
                dropping the overrides for a "clean" bare primitive, which would render it
                identically to the editable Deadline field above it. Same idiom 88-19 used for the
                saving-state phone field. */}
            <Input
              id="poll-week"
              name="poll-week"
              type="text"
              value={weekDisplay ? `Week of ${weekDisplay} (${weekIdentifier})` : ''}
              readOnly
              className="bg-surface-muted text-content-secondary cursor-not-allowed"
            />
            <p className="text-xs text-content-muted mt-1">
              Auto-computed from the deadline using ISO weeks.
            </p>
          </div>

          {availableGames.length > 0 && (
            <div>
              <label className="block text-sm font-normal text-content-primary mb-1" htmlFor="poll-game">
                Game (optional)
              </label>
              <SelectControl
                id="poll-game"
                name="poll-game"
                value={gameId}
                onChange={(e) => setGameId(e.target.value)}
              >
                <option value="">No specific game</option>
                {availableGames.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name || g.title || 'Unnamed game'}
                  </option>
                ))}
              </SelectControl>
            </div>
          )}

          <div>
            <label className="block text-sm font-normal text-content-primary mb-1" htmlFor="poll-message">
              Custom message (optional)
            </label>
            <Textarea
              id="poll-message"
              name="poll-message"
              value={customMessage}
              onChange={(e) => setCustomMessage(e.target.value)}
              maxLength={280}
              rows={3}
              placeholder="e.g. Let's try to lock in a date for the campaign next session."
              className="resize-none"
            />
            <p className="text-xs text-content-muted mt-1">
              {customMessage.length}/280 characters
            </p>
          </div>
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Modal.Action
          variant="secondary"
          onClick={onClose}
          disabled={submitting}
        >
          Cancel
        </Modal.Action>
        <Modal.Action
          variant="primary"
          type="submit"
          form="start-poll-form"
          disabled={submitting}
        >
          {submitting ? 'Starting...' : 'Start poll'}
        </Modal.Action>
      </Modal.Footer>
    </Modal>
  );
}
