'use client';
import { useState, useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import * as Sentry from '@sentry/nextjs';
import { suggestionsAPI } from '../../lib/api';
import GameSuggestionCard from './GameSuggestionCard';
import { Modal } from './Modal';
import { Button } from '../../components/ui/Button';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { StatusRegion } from '../../components/ui/StatusRegion';

/**
 * BrowseMoreModal — In-app modal that replaces the legacy standalone
 * suggestions page (which opened in a new tab and had a broken back button).
 *
 * Mounted from inside QuickSuggestions, which is mounted from createEvent.
 * This is the ONLY entry point to the suggestions surface in Phase 67.
 *
 * Plan 67-02 (this file) populates the data-testid="browse-more-controls"
 * placeholder with a player-count input + complexity tier multi-select +
 * sort dropdown + asc/desc segmented toggle, and branches the empty state
 * into library-empty vs filters-yield-none variants.
 *
 * @param {boolean} open - When false, renders nothing
 * @param {function} onClose - Called when modal close X or backdrop tapped
 * @param {string} groupId - Group whose library populates the modal
 * @param {string} [eventId] - When present (editing existing event) AND user
 *   has not overridden player-count, uses event-scoped suggestion endpoint
 *   (player count is derived from RSVPs server-side).
 * @param {number} [defaultPlayerCount] - Defaults to event's participant count
 *   from createEvent. Initial value of the player-count stepper.
 * @param {function} onSelectGame - ({id, name}) => void — closes modal and
 *   sets event's primary game
 */

// Tier ranges per CONTEXT.md decision (Phase 67):
//   Light: 1–2, Medium: 2–3.5, Heavy: 3.5–5 (BGG weight scale)
// Tiers are CONTIGUOUS: any non-empty multi-select collapses to a single
//   {minWeight, maxWeight} envelope = {min(lows), max(highs)}.
// Backend already accepts a single min/max range, so no backend change needed.
const TIER_RANGES = {
  light: { min: 1, max: 2 },
  medium: { min: 2, max: 3.5 },
  heavy: { min: 3.5, max: 5 },
};

// Copy row E8 (D-09, hoisted per D-30): the refresh line, with the single ellipsis glyph.
const UPDATING_SUGGESTIONS = 'Updating suggestions…';

function mergeTierRange(tiers) {
  if (tiers.size === 0) return null; // no filter
  const arr = [...tiers];
  const lows = arr.map((t) => TIER_RANGES[t].min);
  const highs = arr.map((t) => TIER_RANGES[t].max);
  return {
    minWeight: String(Math.min(...lows)),
    maxWeight: String(Math.max(...highs)),
  };
}

export default function BrowseMoreModal({
  open,
  onClose,
  groupId,
  eventId = null,
  defaultPlayerCount,
  onSelectGame,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Filter / sort state added in Plan 67-02
  const [playerCount, setPlayerCount] = useState(defaultPlayerCount || 1);
  const [selectedTiers, setSelectedTiers] = useState(() => new Set());
  const [sortKey, setSortKey] = useState('rating');
  const [sortDirection, setSortDirection] = useState('desc');
  const [hasEverHadResults, setHasEverHadResults] = useState(false);
  // The first SUCCESSFUL load (D-09a's has-loaded rule). Never reset: the one mount keeps this
  // component alive across a close and reopen, so a reopen refreshes in place.
  const [hasLoaded, setHasLoaded] = useState(false);
  // Whether the request behind the list on screen carried a tier filter (D11 (a)); the empty
  // state's variant reads this settled value, never live tier state.
  const [settledFiltersActive, setSettledFiltersActive] = useState(false);
  // W006 latch: the class-plus-code key of the failure already reported in this episode.
  const lastReportedKeyRef = useRef(null);

  // If the parent updates defaultPlayerCount (e.g., RSVP confirms during the
  // modal's lifetime) and the user hasn't typed yet, sync the input. We only
  // sync when playerCount is null/empty — overriding a typed value would feel
  // like the input "snaps back" out from under the user.
  useEffect(() => {
    if (defaultPlayerCount && (playerCount === '' || playerCount == null)) {
      setPlayerCount(defaultPlayerCount);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultPlayerCount]);

  // A new open is a new failure episode (W006). Declared ABOVE the fetch effect on purpose:
  // effects run in declaration order, so the latch is re-armed before the open's fetch starts.
  useEffect(() => {
    if (open) lastReportedKeyRef.current = null;
  }, [open]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);
      try {
        const tierRange = mergeTierRange(selectedTiers);
        const baseParams = {
          sort: sortKey,
          ...(tierRange || {}),
        };
        let data;
        // Endpoint selection rule (per plan 67-02):
        //  - eventId present AND user hasn't overridden playerCount → event endpoint
        //  - otherwise → group endpoint with explicit playerCount
        const userOverrodePlayerCount =
          playerCount !== '' &&
          playerCount != null &&
          playerCount !== defaultPlayerCount;
        if (eventId && !userOverrodePlayerCount) {
          data = await suggestionsAPI.getEventSuggestions(eventId, baseParams);
        } else if (groupId) {
          data = await suggestionsAPI.getGroupSuggestions(groupId, {
            ...baseParams,
            playerCount: String(playerCount || 1),
          });
        } else {
          data = { suggestions: [] };
        }
        if (cancelled) return;
        const items = Array.isArray(data) ? data : data?.suggestions || [];
        setSuggestions(items);
        if (items.length > 0) setHasEverHadResults(true);
        // The closure's tiers are the ones this request was BUILT with; a superseded request
        // never reaches this line (the cancelled check above), so this stamps the answer shown.
        setSettledFiltersActive(selectedTiers.size > 0);
        setHasLoaded(true);
        // Recovery ends the failure episode (W006): the next failure files again.
        lastReportedKeyRef.current = null;
      } catch (err) {
        if (!cancelled) {
          /* DECISION Phase 88.6-32 (R1 / T-88.6-140): the copy is DERIVED from `ApiError.code`
             through the ratified register, and a CLASS-ONLY Sentry capture is added in the same
             edit — chosen OVER genericising the copy alone.

             WHY THE CAPTURE IS NOT OPTIONAL HERE: this file carries no `console.*`, no `logger`
             and no `Sentry` call anywhere else, so routing `err.message` off the screen without
             it would delete this surface's LAST diagnostic. It is hand-rolled rather than a
             `logger.error` because `BrowseMoreModal.js` is not on the `no-console` allowlist —
             and it is the only genuinely class-only capture in plan 32: its three siblings get
             theirs from the AC-2 `logger.error` conversion, whose `exception.values[0]` also
             carries the error's message and stack.

             CLASS-ONLY, matching src/app/components/FeedbackForm.js ("feedback submit failed"): a wrapped
             Error naming the class and, when present, the envelope code — never `err.message`,
             never the response body. Widening it is a decision, not a cleanup.

             AMENDED Phase 88.6.1-32 (W006, D-26): the capture is now LATCHED to one event per
             failure episode — keyed on class plus code (the `lastReportedKeyRef` idiom of
             src/app/components/QuickSuggestions.js ("if (lastReportedKeyRef.current !== reportKey)")), re-armed
             when the dialog opens and on a successful response — because this effect re-runs on
             every filter tap, and during an outage it filed one event per tap (WR-106,
             planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-REVIEW-2026-09-24-triaged.md ("### WR-106: BrowseMoreModal adds an unthrottled")). A different failure code is a
             new episode. REJECTED: demoting it to a `logger.info` breadcrumb (the review's
             first fix option and the research pick, DF-4) — this capture is an AC-16 (a)
             escalation (owner, 2026-09-09; planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-32-PLAN.md ("T-88.6-140")), and 88.6's D2
             ruling keeps escalations a plan ADDED at event level (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-CONTEXT.md ("where a plan ADDS an escalation"));
             a breadcrumb files nothing on its own, so an
             outage of this endpoint would reach no operator. REJECTED: `logger.error` — it
             forwards the error's message and stack, and this site is class-only.
             CORRECTION of WR-106's first objection (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-REVIEW-2026-09-24-triaged.md ("hand-rolled rather than a")):
             the allowlist sentence above gave the wrong reason — `logger` is not `console`, so
             the allowlist never mattered; the true reason this capture is hand-rolled is the
             class-only payload. WR-106's second objection (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-REVIEW-2026-09-24-triaged.md ("its three siblings get theirs from the AC-2")) does not hold: the three
             siblings did stay at `logger.error` as D2's AC-16 carve-out (planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-CONTEXT.md ("survives ONLY where an owner ruling requires a Sentry EVENT")).
             The sentences above
             are kept as history. */
          const cls = (err && err.name) || 'Error';
          const code = err && typeof err.code === 'string' ? ` ${err.code}` : '';
          const reportKey = `browse-more suggestions fetch failed: ${cls}${code}`;
          if (lastReportedKeyRef.current !== reportKey) {
            lastReportedKeyRef.current = reportKey;
            Sentry.captureException(new Error(reportKey), {
              tags: { feature: 'suggestions', op: 'browse-more-fetch' },
            });
          }
          /* NO `fallback:` OPTION, deliberately. UI-SPEC §6.3's register holds no ratified
             string for this site, and an executor never mints user-visible copy — so the
             code-less arm takes the register's own `unknown` copy
             (src/components/ui/useFetchErrorState.ts ("unknown: 'Something went wrong. Refresh the page to try again.',")) rather than a newly-authored sentence. Adding a
             fallback here means ratifying one first. */
          setError(getFetchErrorMessage(err));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetchSuggestions();
    return () => {
      cancelled = true;
    };
  }, [
    open,
    groupId,
    eventId,
    playerCount,
    selectedTiers,
    sortKey,
    defaultPlayerCount,
  ]);

  // Direction is applied client-side: backend returns canonical desc, we
  // reverse in-memory when user picks ascending. No re-fetch on direction
  // change — the dataset is identical.
  const displaySuggestions = useMemo(() => {
    if (sortDirection === 'asc') return [...suggestions].reverse();
    return suggestions;
  }, [suggestions, sortDirection]);

  const handleCardClick = (game) => {
    onSelectGame?.({ id: game.id, name: game.name });
    onClose?.();
  };

  const handleSortKeyChange = (e) => {
    const next = e.target.value;
    setSortKey(next);
    // Auto-flip default direction to the natural reading order for the chosen sort:
    //   rating → desc (highest fit first), complexity → desc (heaviest first), name → asc (A→Z)
    setSortDirection(next === 'name' ? 'asc' : 'desc');
  };

  const toggleTier = (tier) => {
    setSelectedTiers((prev) => {
      const copy = new Set(prev);
      if (copy.has(tier)) copy.delete(tier);
      else copy.add(tier);
      return copy;
    });
  };

  const resetFilters = () => {
    setSelectedTiers(new Set());
    setPlayerCount(defaultPlayerCount || 1);
    setSortKey('rating');
    setSortDirection('desc');
  };

  /* DECISION Phase 88.6.1-32 (D11, owner 2026-10-13): two rulings shape these values.

     D11 (b), OPTION 2 — the Browse Games exception to D-50. After a failed refresh over an
     EMPTY result the body shows the dialog's first-load failure sentence in the keyed alert
     paragraph, with no empty-state sentence and no empty-state button, and the slot stays
     empty; over kept cards the slot carries it instead (D-41). Never both: one alert.
     D-50 scope note: D-50 (a loaded-empty list keeps its empty sentence under the failure
     notice) stays as ruled for the RF1 sites; its retained key is "the same filters", and
     here the failed request usually carries DIFFERENT filters from the empty result, so it is
     a first load for that key. REJECTED: D-50 as written (option 1) — the filters sentence
     under the slot's register line states as fact something the server never answered (SPEC
     Prohibition 2), and nothing on screen says the sentence is old. REJECTED: a blank body
     with the slot alone carrying the line (option 3) — the body empties, the centred dialog
     shrinks and jumps (the look D-09 exists to remove), and it says nothing option 2 lacks.

     D11 (a) — the empty-state variant (library-empty vs the filters one) reads the filters of
     the last SUCCESSFUL response, chosen OVER live tier state: a tier tap would otherwise flip
     library-empty to the filters variant before the server answers, which breaks the
     same-node rule a refresh in place rests on. The tier buttons and the reset keep reading
     live tier state. Changing any of this is a decision, not a cleanup. */
  const refreshing = hasLoaded && loading;
  const isEmpty = displaySuggestions.length === 0;
  const refreshError = hasLoaded && !isEmpty ? error : null;
  const bodyError = error && (!hasLoaded || isEmpty) ? error : null;
  const libraryEmpty = isEmpty && !settledFiltersActive && !hasEverHadResults;
  const filtersYieldNone = isEmpty && (settledFiltersActive || hasEverHadResults);

  const decrementDisabled = (playerCount || 1) <= 1;

  // size="lg" maps to the legacy max-w-4xl width. Modal.Body owns the scroll
  // (p-0 so the toolbar can pin flush); the filter/sort toolbar is sticky top-0
  // over the scrollable grid. Focus-trap / Esc / aria-modal come from <Modal>.
  return (
    <Modal open={open} onClose={onClose} size="lg">
      <Modal.Header>Browse games</Modal.Header>
      <Modal.Body className="p-0 md:p-0">
        {/* Filter / sort row — pinned over the scrolling grid */}
        <div
          data-testid="browse-more-controls"
          className="sticky top-0 z-10 bg-card px-4 pt-3 pb-3 border-b border-line"
        >
          <div className="flex flex-wrap items-center gap-3">
            {/* Player-count stepper.

                DECISION Phase 88-17 (D-36, UI-SPEC §3.2 exception 2): these TWO
                buttons — and only these two in the whole app — carry
                `btn-compact`, the opt-out from the phone-width 44px `.btn` floor
                that plan 88-01 added at globals.css. They are square by design
                (32x32); under the floor they would stretch into 32x44 lozenges,
                and that deformation is the exact reason a blanket all-viewport
                floor was REJECTED in 87.8. Every other compact `.btn` row in the
                app deliberately takes the floor and grows ~7px: their
                `text-xs px-3 py-1` utilities were measured DEAD against the
                unlayered `.btn` rule, so they do not double in height.

                THE MECHANISM IS THE LOAD-BEARING PART. The opt-out is the
                unlayered `.btn-compact` class, chosen OVER a Tailwind
                minimum-height-zero utility at this call site. That utility
                CANNOT work here: `.btn` and its floor are unlayered author
                rules, and an unlayered rule beats every `@layer utilities` rule
                regardless of specificity — the utility would silently do
                nothing, which is the same cascade defect this repo has already
                hit twice (87.8 DEC-2 and DEC-3, both recorded in globals.css).
                Swapping this class for a Tailwind utility is a decision, not a
                cleanup, and it is a decision that loses.

                Phone geometry for this pair is covered by plan 88-30's e2e
                extension, not by a unit test — the floor only exists below
                48rem, and jsdom has no viewport.

                DECISION Phase 88.6-32 (D-10): these two stay RAW `.btn btn-compact`
                and are the phase's ONLY permanent `.btn` exemption — every other
                `.btn` element in the app is a `<Button>` after 88.6. They are not
                primary actions and 32x32 clears WCAG 2.2 2.5.8's 24px floor.

                REJECTED — a `compact` rung on the `Button` primitive: it would
                convert a CLOSED two-site exemption into an OPEN sub-44 API
                affordance any future call site could reach for, and it would
                silently add the cva base's `shadow-theme-sm
                enabled-hover:shadow-theme-md` elevation pair to two 32px squares.
                Neither gate decides this — `e2e/touch-targets.spec.ts` measures
                PLANTED probes, not these steppers, and `decisionMarkers.test.ts`
                matches marker PROSE — the API-surface argument does. Adding the
                rung is a decision, not a cleanup, and it is a decision that loses.

                DECISION Phase 88.6-32 (AC-10, owner ruling 2026-09-09 option 1):
                under plan 05's ARM A (`A-2-ARM: A`, planning:.planning/phases/88.6-fe-design-system-adoption-convergence-inserted-2026-08-06/88.6-05-SUMMARY.md ("## A-2 ruling — the greppable token")) the
                focus ring has exactly one home — `Button.tsx`'s cva base — and no
                global `.btn:focus-visible` rule exists. These two wear no `Button`,
                so without the string below they would be the only controls in the
                app left on the browser-default outline. They take the house ring in
                its `focus-visible:ring-inset` form, NEVER `ring-offset-2`: an
                offset ring on a 32x32 square in a tight toolbar paints outside the
                control and collides with its twin and the number box between them.
                REJECTED: leaving both on the UA outline — it satisfies 2.4.7, so
                there is no AA violation, but it strands the phase's only two
                un-standardised controls for the cost of one utility in a commit
                that already opens both lines. The exemption's `why` above is about
                SIZE, so a ring does not weaken it.

                DECISION Phase 88.6.1-32 (AC-13, D-35): the decrement's limit at 1 is
                aria-disabled plus a FIRST-LINE guard in its handler, chosen OVER the native
                disabled attribute — with that attribute the focused button left the focus
                order when it reached 1, and focus fell to the page body inside the Radix
                dialog (register MEDLOW-29) — and OVER relying on the clamp alone: with an
                EMPTY box the clamp writes 1, which the guard refuses. This is CT-3 census row
                22, a BOUNDARY, not an in-flight gate. The two utilities that carried the
                disabled-state variant (the half-opacity one and the not-allowed cursor one)
                are deleted as dead: the gated look now comes from the unlayered
                aria-disabled rules on the .btn and .btn-secondary classes in globals.css (the
                gated colour pair and the not-allowed cursor), so the 50% wash becomes the
                gated colour pair — a disclosed visible delta, the same shape as every other
                gated secondary button. No extra opacity utility is added (a double dim). The
                32x32 exemption and the inset ring above are unchanged (88.6-32 D-10, AC-10).
                Changing any of this is a decision, not a cleanup. */}
            <div className="flex items-center gap-1" title="Player count">
              <button
                type="button"
                onClick={() => {
                  if (decrementDisabled) return;
                  setPlayerCount((p) => Math.max(1, (p || 1) - 1));
                }}
                aria-disabled={decrementDisabled || undefined}
                className="btn btn-compact btn-secondary w-8 h-8 flex items-center justify-center focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                aria-label="Decrease player count"
              >
                −
              </button>
              <input
                id="bm-player-count"
                name="bm-player-count"
                type="number"
                min="1"
                value={playerCount === '' || playerCount == null ? '' : playerCount}
                onChange={(e) => {
                  const raw = e.target.value;
                  if (raw === '') {
                    setPlayerCount('');
                    return;
                  }
                  const v = parseInt(raw, 10);
                  setPlayerCount(Number.isNaN(v) ? '' : Math.max(1, v));
                }}
                /* DECISION Phase 88-21 (Req 1): `text-base` is added IN PLACE here rather than
                   adopting the `Input` primitive — the one deliberate non-adoption in this
                   sweep, and it applies to both controls in this toolbar. The primitive carries
                   `max-md:min-h-11`, and THESE ARE THE EXACT CONTROLS 87.8 CITED when it rejected
                   a blanket height floor: this box sits between two `w-8 h-8` (32px) stepper
                   buttons, so growing it to 44px at phone leaves a square-button/tall-box row
                   that reads as broken. planning:.planning/phases/88-fe-wave-3-design-system-a11y/88-SPEC.md ("never a blanket rule with no census") requires the height floor be decided
                   against a call-site census, "never a blanket rule with no census", and that
                   census is DEF-88-20-01's, not this plan's. Req 1 is the 16px TEXT floor, which
                   is what changes here; the touch-target question stays with its owner.
                   Swapping this for the bare primitive is a decision, not a cleanup. */
                className="w-16 text-center p-1 border border-line rounded-btn text-content-primary bg-surface-input text-base"
                aria-label="Player count"
              />
              <button
                type="button"
                onClick={() => setPlayerCount((p) => (p || 0) + 1)}
                /* btn-compact, the D-10 permanent exemption and the AC-10 inset ring: see the
                   markers on the decrement twin above. This pair migrates and stays together —
                   one standardised beside one un-standardised is the defect. */
                className="btn btn-compact btn-secondary w-8 h-8 flex items-center justify-center focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-inset"
                aria-label="Increase player count"
              >
                +
              </button>
              <span className="text-xs text-content-muted ml-1">players</span>
            </div>

            {/* Complexity tier multi-select */}
            <div className="flex gap-1" role="group" aria-label="Complexity">
              {[
                { key: 'light', label: 'Light', range: '1–2' },
                { key: 'medium', label: 'Medium', range: '2–3.5' },
                { key: 'heavy', label: 'Heavy', range: '3.5–5' },
              ].map(({ key, label, range }) => {
                const active = selectedTiers.has(key);
                return (
                  /* DECISION Phase 88.6-32 (R2): the active/inactive split becomes a COMPUTED
                     VARIANT, chosen OVER the plan's literal "keep the `bg-*` utilities on
                     `<Button className>`". Those utilities CANNOT paint on a `Button`:
                     `.btn-secondary` declares `background-color` and `color` UNLAYERED
                     (src/app/globals.css (".btn-secondary {")) and an unlayered author rule beats every
                     `@layer utilities` rule, so `bg-btn-primary text-btn-primary-text` would be
                     dead and every pressed tier would render as an unpressed one.
                     `.btn-primary` (src/app/globals.css (".btn-primary {")) sets exactly those two properties
                     off exactly those two tokens, so the variant is the same paint with the
                     cascade the right way round — the same substitution plan 88.6-23 made for a
                     computed `btn ${…}` template. */
                  <Button
                    key={key}
                    variant={active ? 'primary' : 'secondary'}
                    onClick={() => toggleTier(key)}
                    title={`Complexity ${range}`}
                    aria-pressed={active}
                  >
                    {label}
                  </Button>
                );
              })}
            </div>

            {/* Sort dropdown + direction toggle (right-aligned via ml-auto) */}
            <div className="flex items-center gap-2 ml-auto">
              <label
                htmlFor="bm-sort"
                /* Plan 88.6-32 (V-6 / §4.5): `font-medium` (500) DROPPED — 500 and 600 are
                   prohibitions outside the `Button` label. This is the EMPHASIS outcome, not
                   the hierarchy one: a field label beside its select is not a heading, so it
                   resolves to 400 plus the colour token it already carries. The file's other
                   three 500 sites took §4.5's THIRD outcome instead (dead on a `.btn`,
                   deleted with the migration). */
                className="text-sm text-content-secondary"
              >
                Sort:
              </label>
              <select
                id="bm-sort"
                name="bm-sort"
                value={sortKey}
                onChange={handleSortKeyChange}
                /* `text-base` in place, not the primitive — same reason as the player-count
                   box above: this select's row-mates are `px-2 py-1` toggles. See that marker. */
                className="p-2 border border-line rounded-btn text-content-primary bg-surface-input text-base"
              >
                <option value="rating">Best fit</option>
                <option value="complexity">Complexity</option>
                <option value="name">Game name</option>
              </select>
              {/* DECISION Phase 88.6-32 (R2): the pair's `rounded-l-btn` / `rounded-r-btn`
                  segmented shape is DELETED with the migration rather than carried onto
                  `<Button className>`. Those utilities are DEAD on any `.btn` element —
                  unlayered `.btn` sets the `border-radius` SHORTHAND (src/app/globals.css ("border-radius: 8px;"), in `.btn {`) and
                  beats the `@layer utilities` longhands — so today they paint only in the
                  ACTIVE state, which is the one state that carries no `.btn`. The pair has
                  therefore been rendering half-segmented and half-pill all along; the
                  migration settles it on the pill both ways, so the wrapper takes `gap-1` (the
                  butt-joint a segmented control needs is what the shared corner bought). A real
                  segmented rung would require layering `.btn` first and is a Phase 88.9 look
                  decision, not a cleanup. Same computed-variant reasoning as the tier row
                  above. */}
              <div className="flex gap-1" role="group" aria-label="Sort direction">
                <Button
                  variant={sortDirection === 'asc' ? 'primary' : 'secondary'}
                  onClick={() => setSortDirection('asc')}
                  aria-pressed={sortDirection === 'asc'}
                  aria-label="Ascending"
                >
                  ↑
                </Button>
                <Button
                  variant={sortDirection === 'desc' ? 'primary' : 'secondary'}
                  onClick={() => setSortDirection('desc')}
                  aria-pressed={sortDirection === 'desc'}
                  aria-label="Descending"
                >
                  ↓
                </Button>
              </div>
            </div>
          </div>

          {/* DECISION Phase 88.6.1-32 (D-09, D-41, copy row E8): after the first SUCCESSFUL load
              (hasLoaded) a refresh happens IN PLACE — the previous cards or the settled empty
              state stay as the same nodes, the results wrapper below is aria-busy, and copy
              row E8 goes into the polite region here. A failed refresh over kept cards puts the
              register's line (the failure code's own sentence, no fallback) into the assertive
              sibling region and keeps the cards. Both regions are always mounted, never nested,
              in one reserved line that is the LAST row of this sticky toolbar, so the busy line
              appears and clears without moving the dialog.
              REJECTED, each with its reason: the slot in the scrolling body (it scrolls out of
              view when the user has scrolled down the grid — exactly when they change a sort);
              dimming old rows (a look option, Phase 88.9 per
              D-09); a spinner (no house spinner primitive, SPEC amendment row 3); aria-busy on a
              live region (RESEARCH A3 — it sits on the results wrapper only); reserving two
              lines for a wrapped failure line (20px more permanent blank space on a 667px phone;
              at 375px a refresh FAILURE may grow the toolbar by one line, while the busy
              transition, which happens on every tap, never moves); counting a failed first load
              as settled (nothing to keep, and a stale failure beside the busy line contradicts
              itself — the D-09a has-loaded rule); clearing the list on a failed refresh (D-41).
              Also: the first-load failure paragraph in the body is an alert per D-42 (an alert
              inserted with its text is announced), and the assertive region here stays empty in
              that state so nothing is said twice. The two body paragraphs (the failure one and
              the first-load one) carry DISTINCT keys, and the keys are load-bearing for D-42:
              without them React reuses the first-load node and switches its role and text in
              place, which is not an inserted alert (r1 A3). In every state at most one alert
              element contains the failure line; whenever the body carries it, the assertive
              region here is empty (r1 D9).
              AMENDED Phase 88.6.1-64 (D-22): plan 32 first REJECTED D-22's srOnlyWhenEmpty prop
              here, believing it collapses an empty region to zero height so the dialog would move
              the instant E8 appears. The code shows otherwise: the reserved line is THIS wrapper's
              min-h-5, and StatusRegion adds only text-sm plus caller classes, so an sr-only empty
              region costs the line nothing and E8 / the failure line still appear without moving
              the dialog. Both regions now take the prop (AC-26 census findings AC26c-09/10, D-22's
              one empty-region shape). Containing block for the sr-only regions: the sticky
              (positioned) toolbar, inside the dialog's own clip. Changing any of this is a
              decision, not a cleanup. */}
          <div data-testid="browse-more-status" className="mt-2 min-h-5">
            <StatusRegion
              message={refreshing ? UPDATING_SUGGESTIONS : ''}
              className="text-content-muted"
              srOnlyWhenEmpty
            />
            <StatusRegion
              politeness="assertive"
              message={refreshError || ''}
              className="text-content-status-error"
              srOnlyWhenEmpty
            />
          </div>
        </div>

        <div
          data-testid="browse-more-results"
          aria-busy={loading || undefined}
          className="p-4"
        >
          {bodyError ? (
            <p
              key="browse-more-failure"
              role="alert"
              className="text-content-status-error text-center py-12"
            >
              {bodyError}
            </p>
          ) : !hasLoaded ? (
            <p key="browse-more-first-load" className="text-content-muted text-center py-12">Loading suggestions...</p>
          ) : libraryEmpty ? (
            <EmptyState
              variant="library-empty"
              onAddGames={() => onClose?.()}
            />
          ) : filtersYieldNone ? (
            <EmptyState
              variant="filters-yield-none"
              onResetFilters={resetFilters}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {displaySuggestions.map((game) => (
                <GameSuggestionCard
                  key={game.id}
                  game={game}
                  onClick={handleCardClick}
                />
              ))}
            </div>
          )}
        </div>
      </Modal.Body>
    </Modal>
  );
}

/**
 * EmptyState — Two context-aware variants per CONTEXT.md decisions:
 *   - library-empty:    group has no games yet → CTA to /userProfile
 *   - filters-yield-none: filters too narrow   → CTA to reset filters
 */
function EmptyState({ variant, onAddGames, onResetFilters }) {
  if (variant === 'library-empty') {
    return (
      <div className="text-center py-12">
        <p className="text-content-secondary mb-4">
          Your group hasn&apos;t added any games to its collections yet.
        </p>
        {/* `asChild` is load-bearing, not style: without it `Button` renders a real `<button>`
            and this CTA silently stops navigating to /userProfile. `inline-block px-4 py-2
            text-sm` are dead under unlayered `.btn` and are deleted; `Slot` concatenates the
            child's className WITHOUT tailwind-merge, so any surviving utility goes on
            `<Button className>`, never on the `<Link>`. Shipped precedent:
            src/app/components/GroupLibrary.js ("<Button asChild"). */}
        <Button asChild variant="primary">
          <Link href="/userProfile" onClick={onAddGames}>
            Add games to your collection
          </Link>
        </Button>
      </div>
    );
  }
  if (variant === 'filters-yield-none') {
    return (
      <div className="text-center py-12">
        <p className="text-content-secondary mb-4">
          No games match these filters. Try widening your selection.
        </p>
        <Button variant="primary" onClick={onResetFilters}>
          Reset filters
        </Button>
      </div>
    );
  }
  // Fallback — should rarely render now that variants cover the modal's empty cases
  return (
    <p className="text-content-muted text-center py-12">No matching games right now.</p>
  );
}
