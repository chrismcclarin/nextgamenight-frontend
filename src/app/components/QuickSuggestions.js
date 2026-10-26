'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { ApiError, suggestionsAPI } from '../../lib/api';
import { logger } from '../../lib/logger';
import BrowseMoreModal from './BrowseMoreModal';
import SafeImage from './SafeImage';
import { usePaintGestureHold } from './heatmap/paintGestureActiveStore';

/** Stable empty list, so the held slot descriptor compares by identity across commits. */
const NO_SUGGESTIONS = [];

/** Copy row H4 (88.6.1 D-30), ratified; the straight apostrophe per D-32 R8. Never interpolated. */
const SUGGESTIONS_FAILED_LINE = "We couldn't load suggestions.";

/**
 * The failure this catch reports, reduced to what is safe to egress.
 *
 * THE PAYLOAD IS PINNED, NOT DEFAULTED. `logger.error(msg, err)` is
 * `Sentry.captureException(err ?? new Error(msg), { extra: { msg } })` (`src/lib/logger.ts`), so
 * whatever object is handed to it goes WHOLE. The error this catch receives is an `ApiError`
 * whose FOURTH constructor argument is the entire parsed response body (`api.ts`, the single
 * `apiFetch` throw site; that file's own note spells out that `ApiError.details` carries the
 * whole body, which is why the envelope's own `details` is nested at `err.details.details`).
 * A group name, a member roster or a provider's prose body would ride along.
 *
 * This is the HOUSE idiom, not a second decision: `EmailAddressSection.tsx` already carries the
 * T-84-05 reduced-payload shape in terms — "a wrapped Error naming the failure, tags, and the
 * zod issues reduced to `{path, code}` … The raw ZodError is never forwarded" — for the same
 * reason, that a raw error object can carry the user's own input. Only the CODE (an enum) and
 * the HTTP STATUS (a number) survive here; neither can carry a value.
 *
 * `sentry.scrub.js`'s `beforeSend` is the SECOND layer, never the first — the scrub is
 * pattern-based, and a group name is not a pattern.
 */
function reducedSuggestionsFetchError(err) {
  const code = err instanceof ApiError ? err.code : 'unknown';
  const status = err instanceof ApiError ? err.status : 0;
  const reduced = new Error(`group suggestions fetch failed (code=${code}, status=${status})`);
  reduced.name = 'QuickSuggestionsFetchError';
  return reduced;
}

/**
 * THE SLOT. One container, one height, three swappable contents.
 * AMENDED Phase 88.6.1-14 (D-28): the slot now has FOUR contents — chips, the in-flight bar, the
 * empty hint and the failed line. The failed line reuses the hint's box (same element, same
 * classes); only its words and its test id differ. See the DECISION at the shared box below.
 *
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 * DECISION Phase 88.6-39 (D-18): `QuickSuggestions` renders ONE fixed-height slot for EVERY
 * member, with the hint INSIDE the slot on empty and no role gate — the owner's own design,
 * ruled 2026-09-14, OVER (a) retiring the placeholder, (b) a role-scoped slot with the hint
 * above an always-empty gap, and (c) accepting a 42px collapse where today there is none.
 * Costs he weighed: (a) loses the zero-delta chips entrance for groups that do have games;
 * (b) leaves permanent dead space under the first-run hint on a 375px phone; (c) creates a new
 * out-of-gesture collapse on the phone-primary surface.
 *
 * TWO EARLIER RECORDS ARE AMENDED BY THAT RULING, and are named here rather than quietly
 * dropped. AC-6 (owner, 2026-09-09) said "render the placeholder ONLY where a non-zero settle is
 * possible", implemented as the same role predicate the admin hint used — that role gate is GONE,
 * and the `userRole` prop with it. D-12's "a fixed chips-height slot stays REJECTED" is RETIRED:
 * its reason ("wrong at the hint outcome and at the nothing outcome") no longer reaches this
 * design, because the hint now renders inside the slot and every member gets the slot, so neither
 * of those outcomes survives.
 *
 * `!loaded` IS THE REJECTED GATE, for two measured reasons, both verified live 2026-09-14 on the
 * code this replaces. (1) It was UNREACHABLE as a pending signal: `createEvent.js`'s modal mount
 * is fresh per open and `participantCount` is 0 there, so the effect took its synchronous
 * invalid-params branch on the first passive commit and `loaded` latched `true` before any fetch
 * ran. (2) It was never RE-ENTERED: both of its writes set `true` and no `setLoaded(false)`
 * existed anywhere. A placeholder gated on it would paint where no settle was pending and could
 * never paint where one was. The state is gone; the in-flight content keys on an ACTUAL in-flight
 * fetch, derived from the same predicate the effect's early return uses.
 *
 * NO PX HEIGHT IS WRITTEN DOWN. The slot's floor is `min-h-11` — the chip's OWN 44px floor token,
 * not an independent constant — so raising the chip row re-derives the slot and there is no
 * number to renegotiate. (The plan's former "62" was an ancestor-child open→settle DELTA from
 * `e2e/event-scheduler-touch.spec.ts`'s own note, and its former "24" was a box height including
 * margins: two conventions, never comparable.)
 *
 * THE PLACEHOLDER BAR IS `aria-hidden` and the HINT BOX IS NOT. The bar is a decorative skeleton
 * conveying nothing, and the effect deps re-fire on every create-event form edit, so a live region
 * here would announce repeatedly while the user is still typing. REJECTED ALTERNATIVE: a
 * `StatusRegion politeness="polite"` mounted empty from first render, for that reason. The hint
 * box carries real copy a screen-reader user needs, exactly as the hint it replaces did.
 *
 * TWO DESIGNS STAY REJECTED, with their measured reasons. A strip BELOW the grid is off-screen at
 * 375px under a ~511px scheduler and its chip taps would mutate a field a screen away. An OVERLAY
 * breaks the gesture's `elementFromPoint` → `closest('[data-coord]')` resolution
 * (`heatmap/usePaintGesture.ts`, `pointResolver`), producing a silent paint dead zone.
 *
 * THE SECOND STALENESS IDIOM IS REJECTED TOO: a real abort. The cancelled-generation guard below
 * dominates it — the defect is a LATE response writing over a newer one, which needs a guard that
 * holds for a request that has already resolved — and an abort would also walk into this catch and
 * empty the list, the exact change this slot exists to keep still. `api.ts` is untouched.
 * ─────────────────────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS IS AN INNER COMPONENT AND NOT THE PARENT'S TOP LEVEL. The finger-up hold subscribes to
 * the paint-gesture store, and its flush lands at FINGER-UP — the frame the hold exists to
 * protect. `QuickSuggestions` renders `<BrowseMoreModal>` unconditionally as a sibling of this
 * slot, and `BrowseMoreModal` has NO closed-state short-circuit: its `if (!open) return;` sits
 * inside a `useEffect`, not in the render body, so a parent render runs its hooks and rebuilds the
 * whole `<Modal>` element tree open or closed. Keeping the subscription down here puts that tree
 * outside the notification's blast radius. Moving this hook up a level is a decision to rebuild a
 * closed modal at finger-up, not a simplification. (`BrowseMoreModal.js` is deliberately NOT
 * edited to add a render guard — it is not this plan's file and containment here costs nothing
 * outside it.)
 */
function QuickSuggestionsSlot({ desired, onSelectGame, onBrowseMore }) {
  const shown = usePaintGestureHold(desired);

  return (
    <div data-testid="quick-suggestions-slot" className="flex items-stretch gap-2 min-h-11 pb-1">
      {shown.kind === 'chips' ? (
        <>
          <div className="flex items-center gap-2 overflow-x-auto flex-nowrap flex-1 min-w-0">
            {shown.suggestions.map((game) => (
              <button
                key={game.id}
                type="button"
                onClick={() => onSelectGame({ id: game.id, name: game.name })}
                /* 44px FLOOR (round-3 #179, UI-SPEC §3.5). This chip is the surface's PRIMARY
                   action and measured 34px — 24 (thumbnail) + 8 (`py-1` x2) + 2 (border) — against
                   the phone-forward tenet's "44x44 is a floor, not a target, and it applies to
                   primary CTAs". `min-h-11` with `inline-flex items-center`; the content is
                   unchanged and just gains leading. This token is ALSO the slot's own floor
                   above, so raising it re-derives the slot and breaks no height constant. */
                className="inline-flex items-center gap-1.5 min-h-11 px-2 py-1 border border-line rounded-full bg-surface-card hover:bg-surface-hover transition-colors cursor-pointer shrink-0"
                title={game.name}
              >
                {/* DECISION Phase 88.6-39 (T-88.6-111): the BGG thumbnail moves to `SafeImage` —
                    the app's last BGG-thumbnail sink on a bare `<img src>`, and the house rule at
                    `CalendarListView.js` says an untrusted remote URL MUST stay on `SafeImage`.
                    Two call-shape choices here are decisions, not defaults:

                    (1) The `aria-hidden` WRAPPER, chosen OVER passing `aria-hidden` as a PROP.
                        `SafeImage` spreads `{...rest}` onto the `<img>` ONLY, so the prop never
                        reaches the fallback branch — which renders `role="img"` with an
                        `aria-label`. Sizing the 24px box at the wrapper rather than relying on
                        `SafeImage`'s internals is also what keeps this slot's height structural.

                    (2) `alt=""`, chosen OVER `alt={game.name}` — the shape the sibling
                        `GameSuggestionCard.js` uses, which is the OPPOSITE of what this site
                        needs: the same button already renders the name and the player count in
                        adjacent spans, so the thumbnail is DECORATIVE. Note the empty alt alone
                        would be WORSE than nothing, because `''` is falsy and the fallback's
                        `aria-label={alt || 'Image placeholder'}` falls through to that literal —
                        it is the wrapper that closes it. Both halves or neither.

                    `fallbackIcon=""` suppresses the default die glyph (which fires only on
                    `undefined`); `SafeImage`'s own fallback role/`aria-label` semantics are
                    unchanged, because thirteen other production sites pass a real alt and rely on
                    the labelled placeholder. `alt=""` also routes `getColorFromText` to
                    `var(--color-surface-muted)`
                    (src/app/components/SafeImage.js ("if (!text) return 'var(--color-surface-muted)';"))
                    — the token 88.6-02 (D-15) renamed from the card-hover fill with its value
                    unchanged, i.e. exactly the hand-rolled fallback colour this replaces — the
                    swap is colour-neutral by construction. */}
                <span aria-hidden="true" className="block w-6 h-6 shrink-0">
                  <SafeImage
                    src={game.thumbnail_url}
                    alt=""
                    fallbackIcon=""
                    className="w-full h-full rounded-sm"
                    imgClassName="object-cover"
                  />
                </span>
                <span className="text-sm text-content-primary truncate max-w-[120px]">
                  {game.name}
                </span>
                {(game.min_players || game.max_players) && (
                  <span className="text-xs text-content-muted shrink-0">
                    {game.min_players === game.max_players
                      ? `${game.min_players}p`
                      : `${game.min_players || '?'}-${game.max_players || '?'}p`}
                  </span>
                )}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={onBrowseMore}
            /* 44px FLOOR (round-3 #179). MEASURED 2026-09-16 at 20px, not the plan text's 16px:
               plan 88.6-26 retyped this control from `text-xs` to `text-sm`, so its line box is
               1.25rem. It still FAILED WCAG 2.2 SC 2.5.8 (AA), whose binding minimum here is
               24px — the "inline" exception does not apply, because this is not inside a sentence
               or block of text, it is a standalone sibling of the chip strip. A CONSEQUENCE
               constraint, not a preference. `px-1` and the link ink are unchanged.
               RECORDED REJECTED (minimum compliance): `min-h-6` here alone, which satisfies AA but
               would need a declared sub-44 exemption, would leave the two controls in one flex row
               at mismatched heights, and would leave the chips — the primary action — at 34px. */
            className="text-sm text-content-link hover:underline whitespace-nowrap shrink-0 px-1 min-h-11 inline-flex items-center"
          >
            Browse more
          </button>
        </>
      ) : shown.kind === 'pending' ? (
        <div
          aria-hidden="true"
          data-testid="quick-suggestions-placeholder"
          className="flex-1 min-w-0 self-center h-6 rounded-full bg-surface-muted"
        />
      ) : (
        /* DECISION Phase 88.6.1-14 (D-28, copy row H4): a failed fetch shows the H4 line in the
           SAME box the empty hint uses — same element, same classes; only the words and the test
           id change — chosen OVER a new failure look (Phase 88.9 owns the section-failure look:
           `.planning/deferred/phase-88.9.md`, "QuickSuggestions has no rendered §6.2
           section-failure treatment"), OVER leaving the empty hint on a failure (the false
           sentence D-28 retires: it tells someone to add games they may already own), and OVER
           a live region (the 88.6-39 rejected alternative above still holds — the deps re-fire on
           every form edit, so no role, no aria-live and no aria-hidden here). A failed REFRESH
           replaces chips with H4, chosen OVER keeping the old chips beside a failure line (the
           Browse Games rule, D-41): this slot is one fixed-height row that cannot hold both
           without a look change, and the old chips were fetched for a different player count or
           duration, one tap from being written into the form. Changing this is a decision, not a
           cleanup. */
        <div
          data-testid={shown.kind === 'failed' ? 'quick-suggestions-failed' : 'quick-suggestions-empty'}
          className="flex-1 min-w-0 flex items-center border-2 border-dashed border-line rounded-card px-2"
        >
          <p className="text-xs text-content-muted italic">
            {shown.kind === 'failed'
              ? SUGGESTIONS_FAILED_LINE
              : 'Add games to your collection to enable suggestions'}
          </p>
        </div>
      )}
    </div>
  );
}

export default function QuickSuggestions({ groupId, playerCount, duration, onSelectGame, eventId }) {
  const [suggestions, setSuggestions] = useState(NO_SUGGESTIONS);
  const [pending, setPending] = useState(false);
  // 88.6.1-14: the failed flag (D-28) and the first-settle flag (W030). Both are written only
  // behind the generation guard; see the DECISION at the derived kind below.
  const [failed, setFailed] = useState(false);
  const [hasSettled, setHasSettled] = useState(false);
  const [browseModalOpen, setBrowseModalOpen] = useState(false);
  const debounceRef = useRef(null);
  /* THE PHASE'S ONE STALENESS IDIOM — the cancelled-generation guard plan 88.6-27 shipped and
     plans 29/30/32 reuse. Bumped in the effect's CLEANUP, so both a dep change and unmount
     supersede an in-flight run, and every post-await write is guarded: the success, the catch,
     AND the pending clear. A superseded run emptying the list or clearing the bar would itself be
     a content change inside the slot this component exists to keep still. */
  const generationRef = useRef(0);
  /* THE REPORT'S LATCH. The effect deps re-fire on EVERY create-event form edit, so an unlatched
     report would file one Sentry event per debounced cycle for the life of the mount — and the
     first one flushes a full Session Replay. One report per mount, or per distinct dep key. */
  const lastReportedKeyRef = useRef(null);

  /* THE ONE SHARED PREDICATE. The effect's early return and the in-flight content read the SAME
     expression, which is what keeps the bar tied to a real fetch. Never `!loaded` — see the
     DECISION block above for the two measured reasons that gate is rejected. */
  const paramsValid = Boolean(groupId && playerCount && playerCount >= 1);

  useEffect(() => {
    // Cleanup debounce on unmount
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const generation = generationRef.current;

    // Only fetch if we have a valid groupId and playerCount >= 1
    if (!paramsValid) {
      setSuggestions(NO_SUGGESTIONS);
      setPending(false);
      setFailed(false);
      return () => {
        generationRef.current += 1;
      };
    }

    setPending(true);
    // Debounce the API call by 500ms
    debounceRef.current = setTimeout(() => {
      const fetchSuggestions = async () => {
        try {
          const params = {
            playerCount,
            sort: 'rating',
          };
          if (duration) {
            params.maxPlayTime = duration;
          }
          const data = await suggestionsAPI.getGroupSuggestions(groupId, params);
          if (generation !== generationRef.current) return;
          // Take top 5 results — API returns { suggestions: [...] }
          const raw = Array.isArray(data) ? data : (data?.suggestions || []);
          setSuggestions(raw.slice(0, 5));
          setFailed(false);
        } catch (err) {
          /* THE GENERATION GUARD IS CHECKED FIRST: a superseded run reports nothing. What follows
             is the AC-16 (a) escalation the owner ruled on 2026-09-09 — this path's only
             diagnostic used to be NOTHING AT ALL (a silent catch, no Sentry import in the file),
             so a real failure was invisible to an operator while the user-facing rendering stayed,
             and stays, silent. `logger.error` is deliberate and is a decision, not a cleanup:
             AC-16 (a)'s "class-only" was amended to "a Sentry capture" by the owner on 2026-09-13
             (D7 arm A), and AC-2's `logger.info` amendment of the same day governs CONVERSIONS of
             an existing `console.*` — there is no `console.*` here to convert, and `logger.info`
             is `Sentry.addBreadcrumb`, which files nothing on its own. Demoting this delivers no
             telemetry on a path that has none.
             AMENDED Phase 88.6.1-14 (D-28): the user-facing rendering is no longer silent in the
             false sense — the slot now shows the H4 line instead of the empty-collection hint,
             which stated something the app does not know. It is still announced by nothing: no
             live region was added (see the slot's DECISION). The report below is unchanged. */
          if (generation !== generationRef.current) return;
          const reportKey = `${groupId}|${playerCount}|${duration ?? ''}`;
          if (lastReportedKeyRef.current !== reportKey) {
            lastReportedKeyRef.current = reportKey;
            logger.error(
              'QuickSuggestions: group suggestions fetch failed',
              reducedSuggestionsFetchError(err)
            );
          }
          setSuggestions(NO_SUGGESTIONS);
          setFailed(true);
        }
        if (generation !== generationRef.current) return;
        setPending(false);
        setHasSettled(true);
      };
      fetchSuggestions();
    }, 500);

    return () => {
      generationRef.current += 1;
    };
  }, [groupId, playerCount, duration, paramsValid]);

  /* THE SLOT'S DESIRED CONTENT. Memoized so it compares by IDENTITY inside the finger-up hold —
     a fresh object every render would defeat the hold's bail-out and re-render the slot on every
     parent render. Exactly one of three, and the slot's box is the same in all three.

     RE-FIRES NEED NO HELP HERE and the slot must not be credited with fixing them: the fetch path
     writes no state before its awaited `setSuggestions`, so the previously rendered content stays
     mounted through the 500ms debounce. The hold's real subject is the FIRST settle landing under
     a finger.
     AMENDED Phase 88.6.1-14 (W030 / WR-302): "exactly one of three" is now one of FOUR (the
     failed line, D-28), and "re-fires need no help" was false for the empty outcome — the effect
     sets the in-flight flag synchronously on every valid dep change, so a settled hint flipped to
     the bar on every participant or duration change. The first-settle rule below is the help it
     needed. */

  /* DECISION Phase 88.6.1-14 (W030, D-09b): the in-flight bar shows only until the FIRST fetch
     settles (success or failure); after that a re-fire keeps the last settled content (chips,
     empty hint or failed line) until the next settle. `hasSettled` is STATE, chosen OVER the ref
     WR-302 suggested: a ref is not a render input, so the memo could not depend on it. The
     invalid-params branch is NOT a settle — 88.6-39's measured reason 1 for rejecting `!loaded`
     (the create-event modal's fresh mount takes that branch before any fetch, so counting it
     would hide the first real fetch's bar). The memo keys on the DERIVED kind (and the chip list
     only while chips show), chosen OVER adding each new state to its deps, so a re-fire that
     keeps the same outcome hands the finger-up hold the SAME object. Changing this is a
     decision, not a cleanup. */
  let kind;
  if (suggestions.length > 0) kind = 'chips';
  else if (failed) kind = 'failed';
  else if (pending && !hasSettled) kind = 'pending';
  else kind = 'empty';
  const chipList = kind === 'chips' ? suggestions : NO_SUGGESTIONS;
  const desired = useMemo(() => ({ kind, suggestions: chipList }), [kind, chipList]);

  return (
    <div className="mt-1 mb-1">
      <div className="text-xs font-bold text-content-muted uppercase tracking-wide mb-1">Suggestions</div>
      <QuickSuggestionsSlot
        desired={desired}
        onSelectGame={onSelectGame}
        onBrowseMore={() => setBrowseModalOpen(true)}
      />
      <BrowseMoreModal
        open={browseModalOpen}
        onClose={() => setBrowseModalOpen(false)}
        groupId={groupId}
        eventId={eventId}
        defaultPlayerCount={playerCount}
        onSelectGame={(game) => {
          onSelectGame(game);
          setBrowseModalOpen(false);
        }}
      />
    </div>
  );
}
