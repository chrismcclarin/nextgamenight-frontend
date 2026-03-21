'use client';

import GameComboInput from './GameComboInput';

export default function BallotOptionsEditor({ ballotOptions, setBallotOptions, ballotError, groupId, userId }) {
  return (
    <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-gray-900">Game Ballot (optional)</h3>
        <p className="text-xs text-gray-500">Add 2-10 games for your group to vote on</p>
      </div>

      {ballotError && (
        <p className="text-sm text-red-600 mb-2">{ballotError}</p>
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
              className="text-red-500 hover:text-red-700 text-lg px-2 py-1 flex-shrink-0"
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
          className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
        >
          + Add game option
        </button>
      )}

      {ballotOptions.length > 0 && ballotOptions.length < 2 && (
        <p className="text-xs text-amber-600 mt-2">Add at least 2 games to create a ballot</p>
      )}
    </div>
  );
}
