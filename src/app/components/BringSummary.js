'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { eventBringsAPI } from '../../lib/api';
import { Heading } from '../../components/ui/Heading';
import { logger, errCtx } from '@/lib/logger';

// Owner-ruled copy (2026-10-21, quick-261021-ffb; copy-gate rows GB1 / GB2 in copyTable886_1.test.ts).
const ADD_GAMES_LABEL = 'Add games';
const NOBODY_BRINGING_LINE = "No one has said what they're bringing yet.";

/**
 * BringSummary - Displays who is bringing which games, grouped by person.
 * Renders once a read for THIS event has succeeded, including when nobody brings anything (the
 * heading plus "No one has said what they're bringing yet."); renders nothing before the first
 * read settles and after a failed read. (Until quick-261021-ffb it was hidden entirely when
 * nobody had marked any games — see the DECISION at the render guard.)
 *
 * @param {string} eventId - UUID of the event
 * @param {string} groupId - UUID of the group (for game detail links)
 * @param {object} self - Resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, ... }). Phase 87.3-04: brings are grouped by the
 *   nested `bring.User.id` UUID and the own-brings check keys on `self.id` (D-04)
 *   — never the flat `user_id` (a sub through the PR-C window).
 * @param {number|string} refreshKey - Changes to trigger refetch
 * @param {Function} onEditClick - Callback to open BringGamePicker for editing
 * @param {'yes'|'maybe'|'no'|null} [userRsvpStatus] - The viewer's RSVP for this event, from
 *   the page's eventRsvpStatuses map; null / undefined when not known (never loaded).
 */
export default function BringSummary({ eventId, groupId, self, refreshKey, onEditClick, userRsvpStatus }) {
  const [bringsByUser, setBringsByUser] = useState({});
  // The eventId whose read last SUCCEEDED (null before the first success and after a failure).
  const [loadedFor, setLoadedFor] = useState(null);

  useEffect(() => {
    if (!eventId) return;

    let cancelled = false;

    async function fetchBrings() {
      try {
        const res = await eventBringsAPI.getEventBrings(eventId);
        if (cancelled) return;

        const brings = Array.isArray(res) ? res : (res?.brings || []);

        if (brings.length === 0) {
          setBringsByUser({});
          setLoadedFor(eventId);
          return;
        }

        // Group by user. Phase 87.3-04 (D-04/D-07): key on the nested User.id
        // UUID so the own-brings check below (self.id) is a UUID-to-UUID match —
        // no flat `user_id` (sub) key that the PR-C flip would silently break.
        const grouped = {};
        for (const bring of brings) {
          // Rows missing the nested User include are still SHOWN (grouped under
          // a single 'Unknown' bucket) — silently dropping them would hide a
          // game someone is bringing just because attribution failed.
          const userId = bring.User?.id || 'unknown';
          if (!grouped[userId]) {
            grouped[userId] = {
              username: bring.User?.username || bring.username || 'Unknown',
              games: [],
            };
          }
          grouped[userId].games.push({
            id: bring.game_id,
            name: bring.Game?.name || bring.Game?.title || 'Unknown Game',
          });
        }

        setBringsByUser(grouped);
        setLoadedFor(eventId);
      } catch (err) {
        /* 88.6-33 (AC-2 WIDENED 2026-09-09; level AMENDED by the D2 ruling 2026-09-13):
           `logger.info` + `errCtx(err)` — a Sentry BREADCRUMB, over `logger.error`, AC-2's
           original uniform arm. Rejected because an event here buys Session Replay volume the
           `no-console` milestone gate never asked for; `logger.warn` is not a cheaper arm
           (`Sentry.captureMessage` is also an event). Egress delta versus today: NIL — this was
           already a breadcrumb with no `captureConsoleIntegration` in the Sentry config.
           `errCtx(err)` and never the raw `Error` (`ctx?: Record<string, unknown>`,
           `src/lib/logger.ts:24`; `checkJs: false` cannot catch that at a `.js` call site).
           Converted IN PLACE — a catch inside an async effect, not a render body. */
        logger.info('BringSummary: failed to fetch brings', errCtx(err));
        // A superseded read's failure must not hide the answer of the read that replaced it.
        if (cancelled) return;
        setLoadedFor(null);
        setBringsByUser({});
      }
    }

    fetchBrings();
    return () => { cancelled = true; };
  }, [eventId, refreshKey]);

  // DECISION quick-261021-ffb (loading and failure): renders only after a read for THIS event
  // succeeded; during a refetch the last loaded content stays, CHOSEN over hiding it (the section
  // is now always present, so hiding it on every RSVP tap made the card jump and unmounted the
  // control the picker returns focus to); on failure nothing, CHOSEN over the empty line (it would
  // say no one when we do not know) and over the 'Couldn't load who's bringing games.' notice here
  // (the event page already shows it for the same endpoint, page.js anchor refreshBringersSet; the
  // picker behind the control fails on the same read; 403/404 are not failures to report). The
  // game page's silent failure is routed to Phase 91.3 (.planning/deferred/phase-91.3.md).
  // Changing this is a decision, not a cleanup.
  if (loadedFor !== eventId) return null;

  // Sort users alphabetically by username
  const sortedUsers = Object.entries(bringsByUser).sort((a, b) =>
    a[1].username.localeCompare(b[1].username)
  );

  // Phase 87.3-04: own-brings check keys on the resolved self UUID vs the
  // UUID-keyed grouping. Falsy while identity is unresolved (indeterminate —
  // Edit affordance simply stays hidden until `self` resolves, never a wrong
  // "not mine"); recomputes on the next render once `self` lands.
  // AMENDED quick-261021-ffb: the same rule now gates both labels; a Yes whose identity is
  // unresolved sees no control rather than a possibly-wrong W1 (`Add games`).
  const currentUserHasBrings = Boolean(self?.id && bringsByUser[self.id]);
  const showControl = Boolean(self?.id) && Boolean(onEditClick) && (
    userRsvpStatus === 'yes' || (userRsvpStatus == null && currentUserHasBrings)
  );

  return (
    <div className="card p-3 md:p-6">
      <div className="flex items-center justify-between mb-3">
        {/* 88.6-33 (D-04 size-less-heading row, §4.4): this is one of the four class-less
            headings that actually migrate. It carries NO size utility, so it renders at body
            size today — `size="body"` (16) reproduces that exactly, and the LEVEL is PRESERVED
            (P4): it was an `<h3>` and it stays one. The 600 goes because §4.2 gives 600 exactly
            one home, the `Button` primitive; the 700 now comes from `Heading`'s `font-bold`
            base rather than a stated utility, and the COLOUR rides on `className`. */}
        <Heading level={3} size="body" className="text-content-primary">Bringing</Heading>
        {/* DECISION quick-261021-ffb (owner 2026-10-21, deferred/phase-91.3.md 'Games to Bring has no
            visible way back in'): one persistent control for the viewer — W1 (`Add games`) with no
            brings, Edit with brings — opening the SAME picker through onEditClick, CHOSEN over opening
            the picker on every Yes tap (REJECTED: a re-tap of the selected Yes is a no-op today and not
            discoverable, and it would throw a modal at anyone merely confirming). The first change to
            Yes still auto-opens (page.js onRsvpChange, both views). Hidden for a known Maybe or Can't
            (the backend deletes their brings, rsvp.js anchor EventBring.destroy, and refuses the save,
            eventBrings.js anchor Must RSVP yes); an unknown RSVP keeps today's Edit for someone with
            brings; no control while identity is unresolved (87.3-04). One element so one 44px floor
            subject (controlSizeFloor.test.tsx bringSummaryControl), on the house pair min-h-11
            md:min-h-0 min-w-11 md:min-w-0; justify-end keeps the word where Edit sits today. Changing
            this is a decision, not a cleanup. */}
        {showControl && (
          <button
            type="button"
            onClick={onEditClick}
            className="inline-flex items-center justify-end min-h-11 md:min-h-0 min-w-11 md:min-w-0 text-sm text-content-link hover:text-content-link-hover active:opacity-75 transition-colors focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            {currentUserHasBrings ? 'Edit' : ADD_GAMES_LABEL}
          </button>
        )}
      </div>

      {sortedUsers.length === 0 ? (
        <p className="text-sm text-content-muted">{NOBODY_BRINGING_LINE}</p>
      ) : (
        <div className="space-y-2">
          {sortedUsers.map(([userId, { username, games }]) => (
            <div key={userId}>
              {/* DECISION Phase 88.6-33 (§4.5 EMPHASIS): `font-normal` over `font-bold` on the
                  person's name. 400 is correct because the distinction is already carried by
                  COLOUR — `text-content-secondary` here against the `text-content-link` game
                  links that follow on the same line. 700 was rejected: it would make every row's
                  name compete with the "Bringing" heading directly above. Stated as `font-normal`
                  rather than dropped, following the shipped `createEvent.js:1290` idiom this plan
                  converges its weight sites on. */}
              <span className="text-sm font-normal text-content-secondary">{username}: </span>
              {games.map((game, idx) => (
                <span key={game.id}>
                  <Link
                    href={`/gameDetail?game_id=${game.id}&group_id=${groupId}`}
                    className="text-sm text-content-link hover:underline"
                  >
                    {game.name}
                  </Link>
                  {idx < games.length - 1 && <span className="text-content-muted">, </span>}
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
