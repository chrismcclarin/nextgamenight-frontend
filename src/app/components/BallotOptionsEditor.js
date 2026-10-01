'use client';

import GameComboInput from './GameComboInput';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';

export default function BallotOptionsEditor({ ballotOptions, setBallotOptions, ballotError, groupId, userId }) {
  return (
    <div className="bg-surface-elevated rounded-card p-4 border border-line">
      <div className="mb-3">
        <Heading level={3} size="label" className="text-content-primary">Game Ballot (optional)</Heading>
        <p className="text-xs text-content-muted">Add 2-10 games for your group to vote on</p>
      </div>

      {ballotError && (
        <p className="text-sm text-content-status-error mb-2">{ballotError}</p>
      )}

      <div className="space-y-2">
        {ballotOptions.map((option, index) => (
          <div key={index} className="flex items-center gap-2">
            <div className="flex-1">
              <GameComboInput
                value={{ game_id: option.game_id, game_name: option.game_name }}
                onChange={({ game_id, game_name }) => {
                  const updated = [...ballotOptions];
                  updated[index] = { game_id: game_id || null, game_name: game_name || '' };
                  setBallotOptions(updated);
                }}
                groupId={groupId}
                userId={userId}
                placeholder={`Game option ${index + 1}`}
              />
            </div>
            <button
              type="button"
              onClick={() => {
                setBallotOptions(ballotOptions.filter((_, i) => i !== index));
              }}
              /* DECISION Phase 88.6-22 (D-13): the 44x44 touch floor is DECLARED AT THE SITE
                 (`min-h-11 min-w-11 inline-flex items-center justify-center`), chosen OVER
                 migrating this control to `<Button size="icon">`.

                 WHY IT WAS SKIPPED UNTIL NOW, recorded so the class is closed on the record and
                 not just in this file: this button is NOT a `.btn`, so the "two `.btn` sites ->
                 `<Button>`" sweep instruction never reached it and plan 06's cva `min-h-11`
                 never applied. That is the same fall-through the deferred register names for
                 `gameDetail/page.js`'s two inline row actions and for the month tile / home-card
                 cog — a non-`.btn` control is invisible to the `.btn` census and has to be
                 DECLARED for the pass or it falls through again.

                 WHY NOT `size="icon"`: `Button` composes `.btn`, which is unlayered
                 `padding: .5rem 1rem` (globals.css:2202) plus the cva base's
                 `shadow-theme-sm enabled-hover:shadow-theme-md`. That would give a glyph-only
                 remove control 16px of horizontal padding and a resting elevation it does not
                 have, widening the option row at 375px — a LOOK change, i.e. Phase 88.9's, not
                 this phase's (P6). The site floor grows the touch box and changes nothing else.

                 The `aria-label` and the `title` below are carried VERBATIM: the
                 `DECISION Phase 88-28 (Req 4, UI-SPEC §7.3)` marker forbids dropping or
                 deduplicating either. */
              className="text-content-status-error hover:text-content-status-error text-lg px-2 py-1 shrink-0 min-h-11 min-w-11 inline-flex items-center justify-center focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
              /* DECISION Phase 88-28 (Req 4, UI-SPEC §7.3): the `aria-label` is the accessible
                 name and the `title` is KEPT only for the desktop tooltip — a bare `title` does
                 NOT satisfy §7.3 (not reliably exposed by screen readers, invisible on touch).
                 The name states the ACTION and its object, not the glyph. This was the ONLY
                 unnamed icon-only control left in the repo when 88-28 swept: the two `&times;`
                 buttons SPEC Req 4 enumerated (createEvent, PromptScheduleManager) had already
                 been removed by the 88-16/88-17 Modal migrations. Dropping either attribute —
                 or "deduplicating" them to one — is a decision, not a cleanup. */
              aria-label={`Remove game option ${index + 1}`}
              title="Remove option"
            >
              &times;
            </button>
          </div>
        ))}
      </div>

      {ballotOptions.length < 10 && (
        <Button
          variant="primary"
          size="default"
          onClick={() => setBallotOptions([...ballotOptions, { game_id: null, game_name: '' }])}
          className="mt-2"
        >
          + Add game option
        </Button>
      )}

      {ballotOptions.length > 0 && ballotOptions.length < 2 && (
        <p className="text-xs text-content-status-warning mt-2">Add at least 2 games to create a ballot</p>
      )}
    </div>
  );
}
