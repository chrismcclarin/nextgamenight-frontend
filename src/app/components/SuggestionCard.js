'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { suggestionAPI } from '@/lib/api';
import { formatDate, formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import { getFetchErrorMessage } from '@/components/ui/useFetchErrorState';

/* DECISION Phase 88.6-42 (D1, owner ruling 2026-09-13): this component was SWEPT but NOT
   DESIGNED FOR — chosen OVER deleting it, and OVER wiring it back up.

   FACT: it has no importer anywhere in `src/`. `git grep 'components/SuggestionCard'` returns
   test-roster lines only, there is no `dynamic(` or `React.lazy`, and `suggestionAPI` has
   exactly one caller — this component. Its last importer, `HeatmapGrid.js`, was deleted by
   `6129414` (88-31, 2026-08-05) — but that commit deleted an ALREADY-DEAD parent: at
   `6129414^` nothing imported `HeatmapGrid.js` except its own test, and `8050f32`
   (2026-07-25) had already written "NOTHING IMPORTS THIS FILE … The live read-side heatmap is
   MergedHeatmapGrid" into its header. So this file has been unreachable since `HeatmapGrid`
   was superseded by `MergedHeatmapGrid`, BEFORE 2026-07-25; the exact superseding commit was
   NOT traced and must not be guessed.

   WHY NOT DELETE: deleting it breaks three preservation floors in `statusTextSweep.test.ts`
   (BORDER / SUBTLE / SOLID — this file holds 2 of the app's exactly 4 solid `bg-status-*`
   glyphs), makes that suite's per-file pin throw ENOENT rather than fail an assertion, and
   removes the phase's only declared `groundInk` function-returned-ground blind-spot instance.

   WHY NOT WIRE IT UP: the backend half of availability-suggestion -> event is still live
   (`routes/availabilitySuggestion.js`, `services/eventCreationService.js`, the email path, the
   DB column). Whether that capability should exist is a PRODUCT question routed to the OWNER as
   a separate, non-88.6 decision — see `.planning/deferred/phase-88.6.md`.

   SO: the ink, size and weight fixes here are GATE HYGIENE. Do not design new user outcomes on
   this surface until the product question is answered. Deleting this file, or this comment, is a
   decision — not a cleanup.

   THE CENSUS LESSON, worth keeping on its own: 88-31's commit body records a census word-bounded
   on the names `intensityColor` and `HeatmapGrid` — the DELETED names only — so a delete census
   must also enumerate what the deleted file IMPORTED and RENDERED. */

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
        /* DECISION Phase 88.6-42 (A3): this ELSE ARM STAYS and its `result.error` READ GOES —
           chosen OVER converting that read to `result.code`/`result.message`, OVER rostering it
           as a domain field, and OVER deleting the arm outright as dead code.

           RESEARCH Assumptions Log A3 marked the backend shape UNVERIFIED and the plan offered a
           binary (legacy alias / domain field). Opening the route gives a THIRD answer, and it is
           the right one: `suggestionAPI.convert` goes through `apiFetch`, which THROWS on any
           non-ok response, and the route's success body is a 201
           `{ success, event_id, message, event }` (Sonnet/routes/availabilitySuggestion.js:110-115).
           No body that can reach this line carries an `error` field at all, so `result.error`
           could never be truthy — a DEAD read, not an alias.

           THE ARM ITSELF IS NOT DEAD, which is why deleting it would be the damaging cleanup: it
           is the guard for an UNPARSEABLE 2xx, which `apiFetch` hands back as RAW TEXT rather
           than throwing. That response satisfies neither `result.success` nor `result.event_id`,
           lands here, and without this arm the card would silently do nothing at all.

           The copy is the REGISTER's generic line, not an authored `Failed to` literal: there is
           no ratified §6.3 string for this action and P1 forbids minting one. Passing no error
           resolves the code to `unknown`, which is exactly what an unparseable body is. */
        setError(getFetchErrorMessage(undefined));
      }
    } catch (err) {
      // D-31 / R1: derived copy from `ApiError.code`, replacing `err.message || 'Failed to …'`.
      // A SEPARATE defect from the dead read above — two defects, one component, different fixes.
      // No `fallback` is passed: §6.3 ratifies no string for this action, so the register's own
      // line answers (the P1 precedent plans 25/32/33 already set).
      setError(getFetchErrorMessage(err));
    } finally {
      setIsConverting(false);
    }
  };

  const isAlreadyConverted = !!suggestion.converted_to_event_id;
  const canCreateEvent = isAdmin && !isAlreadyConverted;

  // Color based on score/participant count
  const getScoreColor = () => {
    if (!suggestion.meets_minimum) return 'bg-surface-muted border-line';
    if (suggestion.preferred_count === suggestion.participant_count) {
      return 'bg-status-success-subtle border-status-success'; // All preferred
    }
    return 'bg-status-warning-subtle border-status-warning'; // Mix of preferred and if-need-be
  };

  return (
    <div className={`rounded-card border-2 p-4 ${getScoreColor()}`}>
      {/* Time slot header */}
      <div className="flex justify-between items-start mb-3">
        <div>
          {/* §4.5 EMPHASIS outcome: `font-semibold` (600) DELETED rather than raised to 700.
              The colour token does the work — this line already carries `text-content-primary`
              against the `text-content-secondary` time line beneath it — and the card already
              has one 700 (the participant count below), which a second would compete with. */}
          <div className="text-content-primary">
            {startDate}
          </div>
          <div className="text-sm text-content-secondary">
            {startTime} - {endTime}
          </div>
        </div>

        {/* Score badge */}
        <div className="text-right">
          {/* §4.3: non-heading `text-2xl` residue, named at SuggestionCard.js:89 in the SPEC —
              a PSEUDO-HEADING, so `text-xl` / 700 and deliberately NOT a `<Heading>` (it is a
              number, not a section title, and would break the level sequence). */}
          <div className="text-xl font-bold text-content-primary">
            {suggestion.participant_count}
          </div>
          {/* D-16: `text-content-muted` on the `getScoreColor()` ground measures 4.3725, below
              AA. `text-content-secondary` is 6.9620. The SIZE stays `text-xs`: "counters" is an
              enumerated Caption role (§4.2) and this is the counter's unit label. */}
          <div className="text-xs text-content-secondary">
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
        /* D-16: LIVE text on the muted ground in exactly the branch that produces it —
            `!meets_minimum` is what makes `getScoreColor()` return `bg-surface-muted`. 4.3725
            -> 6.9620. This is the site the render-level assertion in SuggestionCard.test.tsx
            pins, because the grep-level walk cannot see a function-returned ground. */
        <div className="text-sm text-content-secondary italic mb-3">
          Below minimum threshold
        </div>
      )}

      {isAlreadyConverted && (
        /* D-16: text-content-link on the same ground is 3.9909, and this is NOT a link —
            zero of the app's `text-content-link` sites on this ground is. The TOKEN was wrong,
            not the ground (the same settlement plans 19 and 17 reached). 3.9909 -> 6.9620. */
        <div className="text-sm text-content-secondary mb-3">
          Already converted to event
        </div>
      )}

      {/* Error message */}
      {error && (
        <div className="text-sm text-content-status-error mb-3">
          {error}
        </div>
      )}

      {/* Create Event button */}
      {canCreateEvent && (
        <button
          onClick={handleCreateEvent}
          disabled={isConverting}
          /* §4.5 EMPHASIS outcome: `font-medium` (500) DELETED — the fill/ink pairing already
             carries the control, the FetchErrorBanner precedent the SPEC names. D-16: the
             disabled arm's `text-content-muted` (4.3725 on `bg-surface-muted`) takes
             `text-content-secondary` (6.9620) with the rest of the file. A disabled control is
             AA-EXEMPT, so this one is swept for consistency rather than compliance —
             `disabled` and `cursor-not-allowed` are what say "disabled", never the contrast. */
          className={`w-full py-2 px-4 rounded-btn transition-colors
            ${isConverting
              ? 'bg-surface-muted text-content-secondary cursor-not-allowed'
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
          /* §4.5 EMPHASIS outcome: `font-medium` DELETED, same reason as the sibling above. */
          className="w-full py-2 px-4 rounded-btn bg-surface-muted text-content-secondary hover:bg-surface-elevated transition-colors"
        >
          View Event
        </button>
      )}
    </div>
  );
}
