'use client';

export default function EventResultFields({ newEvent, handleChange }) {
  return (
    <>
      {/* Winner Selection */}
      <div>
        <label htmlFor="winner_id" className="block text-sm font-medium mb-1 text-content-primary">
          Winner
        </label>
        <select
          id="winner_id"
          value={newEvent.winner_id || ''}
          onChange={handleChange}
          className="w-full p-2 border border-line rounded text-content-primary bg-surface-input"
        >
          <option value="">Select winner (optional)</option>
          {newEvent.participants
            .filter(p => p.username && p.username.trim() !== "")
            .map((participant, index) => {
              // Use user_id if available, otherwise use a custom identifier
              const value = participant.user_id || `custom_${index}_${participant.username}`;
              return (
                <option key={index} value={value}>
                  {participant.username}
                </option>
              );
            })}
        </select>
      </div>

      {/* Picked By Selection */}
      <div>
        <label htmlFor="picked_by_id" className="block text-sm font-medium mb-1 text-content-primary">
          Picked By
        </label>
        <select
          id="picked_by_id"
          value={newEvent.picked_by_id || ''}
          onChange={handleChange}
          className="w-full p-2 border border-line rounded text-content-primary bg-surface-input"
        >
          <option value="">Select who picked the game (optional)</option>
          {newEvent.participants
            .filter(p => p.username && p.username.trim() !== "")
            .map((participant, index) => {
              // Use user_id if available, otherwise use a custom identifier
              const value = participant.user_id || `custom_${index}_${participant.username}`;
              return (
                <option key={index} value={value}>
                  {participant.username}
                </option>
              );
            })}
        </select>
      </div>

      {/* Group Win Checkbox */}
      <div className="flex items-center">
        <input
          type="checkbox"
          id="is_group_win"
          checked={newEvent.is_group_win}
          onChange={handleChange}
          className="mr-2"
        />
        <label htmlFor="is_group_win" className="text-sm font-medium text-content-primary">
          Group Win
        </label>
      </div>
    </>
  );
}
