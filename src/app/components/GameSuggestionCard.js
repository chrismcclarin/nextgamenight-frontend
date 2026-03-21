'use client';

import SafeImage from './SafeImage';

/**
 * GameSuggestionCard - Displays a single game suggestion with metadata
 * Used in both the dedicated suggestions page and event detail recommendations.
 *
 * @param {object} game - Game suggestion object from the suggestions API
 * @param {function} onClick - Optional click handler; receives the game object
 */
export default function GameSuggestionCard({ game, onClick }) {
  const playerRange = game.max_players >= 99
    ? `${game.min_players}+ players`
    : `${game.min_players}-${game.max_players} players`;

  return (
    <div
      onClick={onClick ? () => onClick(game) : undefined}
      className={`bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 flex gap-4 ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {/* Thumbnail */}
      <SafeImage
        src={game.thumbnail_url}
        alt={game.name}
        className="w-16 h-16 rounded object-cover flex-shrink-0"
      />

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        <p className="font-semibold text-gray-900 truncate">{game.name}</p>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-gray-500">
          {game.min_players != null && game.max_players != null && (
            <span>{playerRange}</span>
          )}
          {game.playing_time != null && (
            <span>{game.playing_time} min</span>
          )}
          {game.weight != null && (
            <span>Weight {Number(game.weight).toFixed(1)}</span>
          )}
        </div>

        {/* Owners */}
        {game.owners && game.owners.length > 0 && (
          <p className="text-xs text-gray-400 truncate">
            Owned by {game.owners.join(', ')}
          </p>
        )}

        {/* Group rating */}
        {game.avg_group_rating != null && (
          <span className="inline-flex items-center gap-1 text-xs text-yellow-600 font-medium w-fit">
            <span className="text-yellow-500">&#9733;</span>
            {Number(game.avg_group_rating).toFixed(1)}
            {game.review_count != null && (
              <span className="text-gray-400">({game.review_count})</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
