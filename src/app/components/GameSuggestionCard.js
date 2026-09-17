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
      className={`card p-3 md:p-6 flex gap-4 hover:shadow-theme-md transition-shadow ${
        onClick ? 'cursor-pointer' : ''
      }`}
    >
      {/* Thumbnail */}
      <SafeImage
        src={game.thumbnail_url}
        alt={game.name}
        className="w-16 h-16 rounded-sm object-cover shrink-0"
      />

      {/* Details */}
      <div className="flex-1 min-w-0 flex flex-col gap-1">
        {/* DECISION Phase 88.6-33 (§4.5 HIERARCHY): `font-bold` (700) over the EMPHASIS outcome
            (400 + colour). This is the card's TITLE — the one string that identifies the card —
            and 400 would leave it reading as prose beside its own metadata. It stays a `<p>` and
            is NOT converted to `<Heading>`: P4 preserves levels and does not permit inventing
            one, so the swept sibling treatment (`GroupGamesList.js`'s card title, which WAS an
            `<h3>` and became `<Heading size="heading">`) is unavailable here.
            The RUNG is already correct and unchanged: this element carries no size utility, so
            it renders at Body 16 — §4.3's "the ONE primary string per row or card" row. */}
        <p className="font-bold text-content-primary truncate">{game.name}</p>

        {/* Metadata row */}
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-content-muted">
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
          <p className="text-xs text-content-muted truncate">
            Owned by {game.owners.join(', ')}
          </p>
        )}

        {/* Group rating */}
        {game.avg_group_rating != null && (
          /* DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over 700 on the group-rating
             annotation. §4.5's pill/chip row routes chip INK at 600 to 700 because a fill/ink
             pairing needs the weight — that row does NOT apply here: this element has no fill,
             it is an inline annotation, and it already carries `text-yellow-600`, the only
             yellow on the card. The colour is doing the work, which is precisely §4.5's
             emphasis condition. */
          <span className="inline-flex items-center gap-1 text-xs text-yellow-600 font-normal w-fit">
            <span className="text-yellow-500">&#9733;</span>
            {Number(game.avg_group_rating).toFixed(1)}
            {game.review_count != null && (
              <span className="text-content-muted">({game.review_count})</span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
