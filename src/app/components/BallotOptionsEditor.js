'use client';

import GameComboInput from './GameComboInput';

export default function BallotOptionsEditor({ ballotOptions, setBallotOptions, ballotError, groupId, userId }) {
  return (
    <div className="bg-surface-elevated rounded-card p-4 border border-line">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-content-primary">Game Ballot (optional)</h3>
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
              className="text-content-status-error hover:text-content-status-error text-lg px-2 py-1 shrink-0 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
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
        <button
          type="button"
          onClick={() => setBallotOptions([...ballotOptions, { game_id: null, game_name: '' }])}
          className="btn btn-primary mt-2 text-sm"
        >
          + Add game option
        </button>
      )}

      {ballotOptions.length > 0 && ballotOptions.length < 2 && (
        <p className="text-xs text-content-status-warning mt-2">Add at least 2 games to create a ballot</p>
      )}
    </div>
  );
}
