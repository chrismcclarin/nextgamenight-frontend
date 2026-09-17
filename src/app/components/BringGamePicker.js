'use client';

import { useState, useEffect } from 'react';
import { userGamesAPI, eventBringsAPI } from '../../lib/api';
import SafeImage from './SafeImage';
import { Modal } from './Modal';
import { Input } from '../../components/ui/Input';
import { Button } from '../../components/ui/Button';
import { logger, errCtx } from '@/lib/logger';

/**
 * BringGamePicker - Modal overlay for selecting games to bring to an event
 *
 * @param {boolean} isOpen - Controls modal visibility
 * @param {Function} onClose - Called when user closes or skips
 * @param {string} eventId - UUID of the event
 * @param {object} self - Resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, user_id: <the SAME UUID via the PR-C toSelfWire
 *   alias>, ... }). Phase 87.3-04: my-brings preselect keys on `self.id` vs
 *   the nested `bring.User.id` UUID (D-04). The getOwnedGames server call
 *   passes `self.user_id` (now the UUID) — the owned-games route's self-gate
 *   accepts EITHER of the caller's own identifiers (sub OR Users.id UUID,
 *   both JWT-resolved; dual-armed in PR-C), so the arg shape stays valid.
 * @param {Function} onSave - Called after successful save (triggers BringSummary refetch)
 */
export default function BringGamePicker({ isOpen, onClose, eventId, self, onSave }) {
  const [ownedGames, setOwnedGames] = useState([]);
  const [selectedGameIds, setSelectedGameIds] = useState(new Set());
  const [othersBringing, setOthersBringing] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Phase 87.3-04: gate the fetch on identity resolution — `self` is undefined
    // while useSelfIdentity is still resolving; the effect re-runs when it lands
    // (self in the dep array), so my-brings preselect never evaluates against an
    // unresolved identity (indeterminate, never "not mine").
    if (!isOpen || !eventId || !self?.user_id) return;

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        const [gamesRes, bringsRes] = await Promise.all([
          // Server-call ARG is self.user_id — post-PR-C the Users.id UUID
          // (toSelfWire alias). The owned-games route's self-gate accepts both
          // of the caller's own identifiers (sub OR UUID); not an is-me compare.
          userGamesAPI.getOwnedGames(self.user_id),
          eventBringsAPI.getEventBrings(eventId),
        ]);

        if (cancelled) return;

        // Extract games from the owned games response
        const games = Array.isArray(gamesRes) ? gamesRes : (gamesRes?.games || []);
        setOwnedGames(games);

        // Process brings to find what this user already has and what others are bringing
        const brings = Array.isArray(bringsRes) ? bringsRes : (bringsRes?.brings || []);

        // Pre-select games the user already has marked
        const myGameIds = new Set();
        const othersCount = {};

        for (const bring of brings) {
          // Phase 87.3-04 (D-04): "mine" = nested User.id UUID === self.id UUID.
          if (bring.User?.id === self.id) {
            myGameIds.add(bring.game_id);
          } else {
            othersCount[bring.game_id] = (othersCount[bring.game_id] || 0) + 1;
          }
        }

        setSelectedGameIds(myGameIds);
        setOthersBringing(othersCount);
      } catch (err) {
        /* DECISION Phase 88.6-33 (AC-2 WIDENED 2026-09-09; level AMENDED by the D2 ruling
           2026-09-13): `logger.info` — a Sentry BREADCRUMB — over `logger.error`, AC-2's
           original uniform arm, which was rejected because it buys Session Replay volume the
           `no-console` milestone gate never asked for. `logger.warn` is not a cheaper arm
           (`Sentry.captureMessage`, `src/lib/logger.ts:31-32`, is also an event). Egress delta
           versus today: NIL — with no `captureConsoleIntegration` in `sentry.client.config.js`
           this was already a breadcrumb and stays one.
           `errCtx(err)` and never the raw `Error`: `info`'s second parameter is
           `ctx?: Record<string, unknown>` (`src/lib/logger.ts:24`) and `checkJs: false` hides
           that mistake at a `.js` call site. Converted IN PLACE — a catch inside an async
           effect, not a render body, so no latch is required.
           RECORDED, NOT FIXED (this commit's scope is the channel and the sweep): this path
           reports NOTHING to the person. The picker is left showing an empty selection as
           though nothing were bringable. Routed to `.planning/deferred/phase-88.6.md`. */
        logger.info('BringGamePicker: failed to load data', errCtx(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [isOpen, eventId, self?.user_id, self?.id]);

  if (!isOpen) return null;

  const toggleGame = (gameId) => {
    setSelectedGameIds(prev => {
      const next = new Set(prev);
      if (next.has(gameId)) {
        next.delete(gameId);
      } else {
        next.add(gameId);
      }
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await eventBringsAPI.updateMyBrings(eventId, Array.from(selectedGameIds));
      onSave?.();
      onClose();
    } catch (err) {
      /* 88.6-33 (AC-2 WIDENED / D2 level ruling): `logger.info` + `errCtx(err)` — the same
         call as the load path above, for the same reasons. Converted IN PLACE (a catch inside
         an async handler).
         RECORDED, NOT FIXED: this catch is reached with `onSave?.()` and `onClose()` SKIPPED —
         they sit above it inside the `try` — so the modal simply stays open with no error
         state, no toast and no live region, and the person cannot tell whether their brings
         were saved. Routed to `.planning/deferred/phase-88.6.md` together with the load path;
         changing the failure BEHAVIOUR is work this commit does not own. */
      logger.info('BringGamePicker: failed to save', errCtx(err));
    } finally {
      setSaving(false);
    }
  };

  // Filter games by search query (case-insensitive)
  const filteredGames = ownedGames.filter(item => {
    const game = item.Game || item;
    const name = game.name || game.title || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    /* DECISION Phase 88-17 (Req 9): hosted on the shared <Modal>; the hand-rolled
       backdrop + `handleBackdropClick` target-compare are gone rather than ported
       (Radix owns outside-dismiss, Esc and the focus trap).

       The overlay's `p-4` is DELETED, not relocated: it was ALWAYS dead. The
       unlayered `.modal-overlay` block in globals.css (:1075) declares
       `padding: 1rem` and an unlayered author rule beats every `@layer utilities`
       rule — the 87.8 DEC-3 marker at globals.css:1086 cites THIS call site by
       name as its live proof. So removing it is not a spacing change and must not
       be read as one.

       The search row stays PINNED above the scrolling list (Modal.Body is `p-0` +
       flex column, the list owns the scroll with `min-h-0`). Collapsing it into a
       single scrolling body would push the search field off-screen as soon as the
       list scrolls — that is a decision, not a cleanup. */
    <Modal open onClose={onClose} className="max-w-md max-h-[80vh]">
      <Modal.Header>Games to Bring</Modal.Header>
      <Modal.Body className="flex flex-col p-0 md:p-0">
        {/* Search */}
        <div className="shrink-0 p-4 pb-2">
          <Input
            type="text"
            placeholder="Search your games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        {/* Game List */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-accent"></div>
            </div>
          ) : ownedGames.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-content-muted text-sm">You haven&apos;t added any games to your collection yet</p>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-content-muted text-sm">No games match your search</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGames.map(item => {
                const game = item.Game || item;
                const gameId = game.id;
                const gameName = game.name || game.title || 'Unknown Game';
                const thumbnail = game.thumbnail_url || game.thumbnail || game.image_url;
                const isSelected = selectedGameIds.has(gameId);
                const othersCount = othersBringing[gameId] || 0;

                return (
                  <button
                    key={gameId}
                    type="button"
                    onClick={() => toggleGame(gameId)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                      isSelected ? 'bg-surface-muted border border-accent' : 'hover:bg-surface-hover border border-transparent'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-8 h-8 rounded-sm shrink-0 overflow-hidden bg-surface-muted">
                      {thumbnail ? (
                        <SafeImage
                          src={thumbnail}
                          alt={gameName}
                          width={32}
                          height={32}
                          className="w-8 h-8 object-cover rounded-sm"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-surface-muted rounded-sm flex items-center justify-center">
                          {/* DECISION Phase 88.6-33 (D-16, owner ruling ARM A 2026-09-16):
                              `text-content-secondary` (6.9620) over `text-content-muted`
                              (4.3725) — this glyph sits on a CERTAIN `bg-surface-muted` ground
                              (the thumbnail well one line above), where 4.3725 is below the AA
                              4.5 floor. Re-inking the INK rather than moving the GROUND, the
                              same disposition plans 88.6-20 and 88.6-27 took at their own D-16
                              sites: the well's muted ground is what distinguishes a missing
                              thumbnail from a present one, so lightening it would erase the
                              affordance to fix the contrast.
                              The `?` is ICON sizing (D-02) — `text-xs` stays and is never
                              converged onto the type scale. Going back to `text-content-muted`
                              is a decision, not a cleanup. */}
                          <span className="text-content-secondary text-xs">?</span>
                        </div>
                      )}
                    </div>

                    {/* Name + others indicator.
                        DECISION Phase 88.6-33 (§4.5 EMPHASIS): the game name takes `font-normal`
                        over `font-bold`. 400 is correct because the distinction is already
                        carried by COLOUR and SIZE — `text-content-primary` at 14 against the
                        annotation's `text-content-secondary` at 12 directly below. 700 was
                        rejected: this is a dense scrolling picker row, not a card title, and
                        bolding every row in a list makes none of them read as emphasised.
                        The rung STAYS at 14: §4.3's primary-string clause reads to 16, but the
                        shipped fleet keeps compact list-row names at 14 (`CalendarListView.js`,
                        `BallotSection.js`), and folding this one row to 16 would be an
                        unowned look change on a phone-primary dense list. Recorded for plan 46.

                        DECISION Phase 88.6-33 (D-16, owner ruling ARM A 2026-09-16): the
                        annotation below is `text-content-secondary` (6.9620), NOT
                        `text-content-muted` (4.3725). Its ground is the selected-row arm's
                        `bg-surface-muted` on the wrapping button, against which 4.3725 is below
                        the AA 4.5 floor. Ink moved rather than ground, same as the thumbnail
                        well above. Going back is a decision, not a cleanup. */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-normal text-content-primary truncate">{gameName}</p>
                      {othersCount > 0 && (
                        <p className="text-xs text-content-secondary">
                          {othersCount} {othersCount === 1 ? 'other' : 'others'} bringing this
                        </p>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded-sm border-2 shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-accent border-accent' : 'border-line'
                    }`}>
                      {isSelected && (
                        <svg className="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </Modal.Body>

      {/* Footer */}
      <Modal.Footer className="justify-between">
        <button
          onClick={onClose}
          className="text-sm text-content-muted hover:text-content-secondary transition-colors"
        >
          Skip for now
        </button>
        {/* 88.6-33 (§3.2/§3.3): `<Button variant="primary" size="default">`. `text-sm` was DEAD
            under unlayered `.btn`'s `font-size` (globals.css:2201) and is deleted rather than
            moved onto the className. The control KEEPS its NATIVE `disabled={saving}` — the
            plans 17-24 `aria-disabled` conversion is not this plan's work. */}
        <Button
          variant="primary"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? 'Saving...' : 'Save'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
