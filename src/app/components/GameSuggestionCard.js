'use client';

import { useId } from 'react';
import SafeImage from './SafeImage';

/**
 * GameSuggestionCard - Displays a single game suggestion with metadata, as one control.
 * Used in the Browse Games dialog (`BrowseMoreModal.js`, where choosing a card selects the game)
 * and in the event page's Recommended Games section (`gameDetail/page.js`, where it opens the game).
 *
 * @param {object} game - Game suggestion object from the suggestions API
 * @param {function} onClick - REQUIRED click handler; receives the game object. Both consumers
 *   pass one, and the card is always a focusable control, so a card without a handler would be
 *   a control that does nothing.
 */
export default function GameSuggestionCard({ game, onClick }) {
  const uid = useId();
  const nameId = `${uid}-name`;
  const metaId = `${uid}-meta`;
  const ownersId = `${uid}-owners`;
  const ratingId = `${uid}-rating`;
  const hasOwners = Boolean(game.owners && game.owners.length > 0);
  const hasRating = game.avg_group_rating != null;
  // The description names only the spans that actually render, so it never points at a
  // missing id. It reuses the card's own visible text and adds no words.
  const describedBy = [metaId, hasOwners ? ownersId : null, hasRating ? ratingId : null]
    .filter(Boolean)
    .join(' ');

  const playerRange = game.max_players >= 99
    ? `${game.min_players}+ players`
    : `${game.min_players}-${game.max_players} players`;

  // DECISION Phase 88.6.1-03 (D-26, Req 2, copy row E7): the whole card is a native button,
  // chosen OVER role="button" + tabIndex + an Enter/Space handler on the old div (88.1-20's
  // reasoning at `UpcomingEventsCard.js:139-146`: a native button is Enter AND Space by
  // construction, nothing to hand-roll). It is a button ALWAYS, OVER keeping a static
  // no-handler mode: that mode is dead in production (both consumers pass a handler), and a
  // switch would either hide the control from the repo's source-scan suites behind a variable
  // tag name or duplicate the class list. It is a button OVER a link for the event page's
  // navigating consumer: this is one shared component, and the Browse Games consumer selects
  // rather than navigates. The accessible name is the title alone, through aria-labelledby,
  // OVER the content-derived name (the whole card text, which copy row E7 does not ratify).
  // The children are spans OVER paragraphs and divs, because a button holds phrasing content
  // only, so 88-28's content-model concern (a paragraph breaking out of a button,
  // src/app/components/PromptScheduleSection.js ("bg-surface-muted text-content-secondary rounded-full px-2 py-0.5 text-xs font-bold"), plan 88.6.1-29's site) never arises here. The class
  // list stays ONE inline template literal because `cardPaddingIdiom.test.ts` needs at least
  // one template-literal card site and this is the only one.
  // Changing any of this is a decision, not a cleanup.
  return (
    <button
      type="button"
      onClick={() => onClick(game)}
      aria-labelledby={nameId}
      aria-describedby={describedBy}
      className={`card p-3 md:p-6 flex gap-4 hover:shadow-theme-md transition-shadow cursor-pointer w-full text-left focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2`}
    >
      {/* Thumbnail.
          DECISION Phase 88.6.1-03 (D-38): the thumbnail is hidden from assistive tech by this
          aria-hidden wrapper ALONE, and SafeImage keeps alt set to the game name and its default
          dice fallback. Chosen OVER the recorded three-part fix (an empty alt plus an empty
          fallback icon plus a wrapper, `.planning/deferred/phase-88.6.1.md:30`), which would turn
          every missing or failed thumbnail into a blank muted tile: the alt is what SafeImage
          derives the fallback colour from, so that is a look change in a non-look phase. Chosen
          OVER changing SafeImage itself, which has 15 mounts. The card's name comes from the
          title span, so the thumbnail no longer repeats it and "Image placeholder" is never
          heard. Recorded rather than fixed: SafeImage's fallback is a div inside this button, not
          phrasing content; browsers do not restructure it (unlike a paragraph) and this wrapper
          hides it, so it is harmless here. The rating star further down is NOT hidden: it is the
          only cue that the number is a rating, and replacing it would need words the owner has
          not ratified (D-31), so it stays as it is heard today.
          Changing any of this is a decision, not a cleanup. */}
      <span aria-hidden="true" className="shrink-0">
        <SafeImage
          src={game.thumbnail_url}
          alt={game.name}
          className="w-16 h-16 rounded-sm object-cover shrink-0"
        />
      </span>

      {/* Details */}
      <span className="flex-1 min-w-0 flex flex-col gap-1">
        {/* DECISION Phase 88.6-33 (§4.5 HIERARCHY): `font-bold` (700) over the EMPHASIS outcome
            (400 + colour). This is the card's TITLE — the one string that identifies the card —
            and 400 would leave it reading as prose beside its own metadata. It stays a `<p>` and
            is NOT converted to `<Heading>`: P4 preserves levels and does not permit inventing
            one, so the swept sibling treatment (`GroupGamesList.js`'s card title, which WAS an
            `<h3>` and became `<Heading size="heading">`) is unavailable here.
            The RUNG is already correct and unchanged: this element carries no size utility, so
            it renders at Body 16 — §4.3's "the ONE primary string per row or card" row.

            AMENDED Phase 88.6.1-03 (D-26), every sentence above KEPT AS HISTORY: the title is
            now a block span, not a paragraph, because the card is a native button and a button
            holds phrasing content only. It is still NOT a Heading, for the same P4 reason, and
            its weight and rung are unchanged. It also carries the id the button's
            aria-labelledby points at, so this span's text IS the card's accessible name. */}
        <span id={nameId} className="block font-bold text-content-primary truncate">{game.name}</span>

        {/* Metadata row */}
        <span id={metaId} className="flex flex-wrap gap-x-3 gap-y-1 text-sm text-content-muted">
          {game.min_players != null && game.max_players != null && (
            <span>{playerRange}</span>
          )}
          {game.playing_time != null && (
            <span>{game.playing_time} min</span>
          )}
          {game.weight != null && (
            <span>Weight {Number(game.weight).toFixed(1)}</span>
          )}
        </span>

        {/* Owners */}
        {hasOwners && (
          <span id={ownersId} className="block text-xs text-content-muted truncate">
            Owned by {game.owners.join(', ')}
          </span>
        )}

        {/* Group rating */}
        {hasRating && (
          /* DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over 700 on the group-rating
             annotation. §4.5's pill/chip row routes chip INK at 600 to 700 because a fill/ink
             pairing needs the weight — that row does NOT apply here: this element has no fill,
             it is an inline annotation, and it already carries `text-yellow-600`, the only
             yellow on the card. The colour is doing the work, which is precisely §4.5's
             emphasis condition. */
          <span id={ratingId} className="inline-flex items-center gap-1 text-xs text-yellow-600 font-normal w-fit">
            <span className="text-yellow-500">&#9733;</span>
            {Number(game.avg_group_rating).toFixed(1)}
            {game.review_count != null && (
              <span className="text-content-muted">({game.review_count})</span>
            )}
          </span>
        )}
      </span>
    </button>
  );
}
