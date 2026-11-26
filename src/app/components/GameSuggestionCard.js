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
  // reasoning at src/app/components/UpcomingEventsCard.js ("DECISION Phase 88.1-20 (WR-02/WR-03)"): a native button is Enter AND Space by
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
  // AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the card may WRAP and its words column keeps
  // its longest word, the Friends-row form (src/app/friends/page.js ("AMENDED Phase 88.9-52 (R4 B1, the round-4 re-shoot")).
  // The column is flex-1 with the automatic minimum, capped at the card by max-w-full, in place of
  // min-w-0; when the 4rem picture, the gap and that word no longer share a line, the words drop
  // UNDER the picture and take the card's full width. The sum at 320 wide with text at 200% on the
  // event page: the card's inside is 172px (320 - 48 page - 48 section - 2 - 48 card - 2), the
  // picture and its gap take 160, which left the words 12px; Weekend at 32px bold is about 155px.
  // REJECTED: keeping min-w-0 with the cut removed (one letter per line, the owner's
  // We/eke/nd W/arr/iors); shrinking the picture; a fixed rem floor (it stacks a short title at
  // ordinary text). NOT DECIDED HERE, the owner's call: not drawing the picture at large text, his
  // ruling for the Play history card (R4 C3), in place of stacking it above the words.
  // At ordinary text with an ordinary title nothing moves.
  // AMENDED Phase 89.6-18 (S2): the question NOT DECIDED HERE above is decided, "Drop" (the owner's
  // first look, 2026-11-22): at large text the picture is not drawn (the marker at the picture).
  // DECISION Phase 89.6-18 (S2): the picture is dropped at large text by a container query on the
  // card (the card is the container, its width given by its grid cell or the night page's grid), the
  // owner's S2 "Drop" (first look, 2026-11-22; the Play history rule HR-5, the name is its text twin),
  // chosen OVER the picture on its own line above the words (as built since 88.9-52) and OVER
  // shrinking it. The drop is at 14rem, not the shared block's 15rem for a 4rem picture: the card's
  // inside at 320 wide with ordinary text in the Browse grid is about 238px (296 - 2 x 16 gutter - 2 x
  // 12 card edge - 2 border), under 15rem, so 15rem would drop the picture at normal text. The words
  // column keeps its R4 D2 form (no 10rem basis: that would move the words under the picture at 320 /
  // 100%, an unpicked look change). The alt stays; the wrapper is aria-hidden. The picture loads
  // lazily, so one hidden by the drop is not downloaded. Changing this is a decision, not a cleanup.
  // DECISION Phase 88.9-58 (X14): this whole-card control keeps its own hover wash; the card utility has none (owner 2026-11-11).
  return (
    <button
      type="button"
      onClick={() => onClick(game)}
      aria-labelledby={nameId}
      aria-describedby={describedBy}
      className={`card p-edge-card md:p-edge-wide hover:bg-surface-hover flex gap-4 flex-wrap gap-y-2 hover:shadow-theme-md transition-shadow cursor-pointer w-full text-left focus:outline-hidden focus-visible:focus-ring bb-media`}
    >
      {/* Thumbnail.
          DECISION Phase 88.6.1-03 (D-38): the thumbnail is hidden from assistive tech by this
          aria-hidden wrapper ALONE, and SafeImage keeps alt set to the game name and its default
          dice fallback. Chosen OVER the recorded three-part fix (an empty alt plus an empty
          fallback icon plus a wrapper, planning:.planning/deferred/phase-88.6.1.md ("### R126 findings 3-4")), which would turn
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
      <span aria-hidden="true" className="shrink-0 @max-[14rem]:hidden">
        <SafeImage
          src={game.thumbnail_url}
          alt={game.name}
          className="w-16 h-16 rounded-sm object-cover shrink-0"
          loading="lazy"
        />
      </span>

      {/* Details */}
      <span className="flex-1 max-w-full flex flex-col gap-1">
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
            aria-labelledby points at, so this span's text IS the card's accessible name.

            AMENDED Phase 88.9-52 (R4 D2, owner 2026-11-18): the title wraps in full, by whole
            words, with no line limit; truncate is REMOVED (it hid the end of the name the card
            is for). wrap-break-word breaks inside a word only when that one word is wider than
            the whole card. REJECTED: a line clamp (still a cut) and wrap-anywhere (it lets the
            title shrink to one letter per line). The room it keeps comes from the card row
            (the marker above the button). */}
        <span id={nameId} className="block font-bold text-content-primary wrap-break-word">{game.name}</span>

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

        {/* Owners.
            AMENDED Phase 88.9-52 (R4 D2, the second cut on this card, routed under the same
            ruling): the Owned by line wraps in full; truncate is REMOVED. It is the only place
            the owners are named (it is also the card's description), so the cut hid people,
            not decoration. A long unbroken username breaks only when wider than the card. */}
        {hasOwners && (
          <span id={ownersId} className="block text-xs text-content-muted wrap-break-word">
            Owned by {game.owners.join(', ')}
          </span>
        )}

        {/* Group rating */}
        {hasRating && (
          /* DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over 700 on the group-rating
             annotation. §4.5's pill/chip row routes chip INK at 600 to 700 because a fill/ink
             pairing needs the weight — that row does NOT apply here: this element has no fill,
             it is an inline annotation, and it already carries the rating ink,
             `text-yellow-800 dark:text-yellow-500` (AMENDED Phase 88.9-44, D15b-rating,
             2026-11-08: was `text-yellow-600`, which also left the star its own yellow-500), the
             only yellow-family ink on the card; the star inherits it. The colour is doing the
             work, which is precisely §4.5's emphasis condition.

             DECISION Phase 88.9-44 D15b-rating (owner ruling 88.9-RULINGS.md R-P2, 2026-11-08):
             the rating span takes text-yellow-800 dark:text-yellow-500 and the star inherits it
             (6.85 / 4.84 light at rest / through the 85% Browse Games refresh dim, 7.22 / 5.63
             dark). Chosen OVER keeping text-yellow-600 (2.94 light at rest, 3.80 dark through
             85%; the star's own yellow-500 read 1.92 light at rest), and OVER dark:text-yellow-400
             (more headroom, 6.94 at 85%, shown to the owner and not taken: yellow-500 is the
             nearest passing step on the same hue). In light this ink is the same value as the
             status-warning ink. Changing this is a decision, not a cleanup. */
          <span id={ratingId} className="inline-flex items-center gap-1 text-xs text-yellow-800 dark:text-yellow-500 font-normal w-fit">
            <span>&#9733;</span>
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
