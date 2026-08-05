'use client';
import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { suggestionsAPI } from '../../lib/api';
import GameSuggestionCard from './GameSuggestionCard';
import { Modal } from './Modal';

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
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Failed to load suggestions');
          setSuggestions([]);
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

  const isEmpty = !loading && !error && displaySuggestions.length === 0;
  const filtersActive = selectedTiers.size > 0;
  const libraryEmpty = isEmpty && !filtersActive && !hasEverHadResults;
  const filtersYieldNone = isEmpty && (filtersActive || hasEverHadResults);

  const decrementDisabled = (playerCount || 1) <= 1;

  // size="lg" maps to the legacy max-w-4xl width. Modal.Body owns the scroll
  // (p-0 so the toolbar can pin flush); the filter/sort toolbar is sticky top-0
  // over the scrollable grid. Focus-trap / Esc / aria-modal come from <Modal>.
  return (
    <Modal open={open} onClose={onClose} size="lg">
      <Modal.Header>Browse games</Modal.Header>
      <Modal.Body className="p-0">
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
                48rem, and jsdom has no viewport. */}
            <div className="flex items-center gap-1" title="Player count">
              <button
                type="button"
                onClick={() =>
                  setPlayerCount((p) => Math.max(1, (p || 1) - 1))
                }
                disabled={decrementDisabled}
                className="btn btn-compact btn-secondary w-8 h-8 flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                aria-label="Decrease player count"
              >
                −
              </button>
              <input
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
                   that reads as broken. 88-SPEC.md:111 requires the height floor be decided
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
                /* btn-compact: see the D-36 marker on the decrement twin above. */
                className="btn btn-compact btn-secondary w-8 h-8 flex items-center justify-center"
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
                  <button
                    key={key}
                    type="button"
                    onClick={() => toggleTier(key)}
                    title={`Complexity ${range}`}
                    aria-pressed={active}
                    className={`px-3 py-1 rounded-btn text-sm font-medium transition-colors ${
                      active
                        ? 'bg-btn-primary text-btn-primary-text'
                        : 'btn btn-secondary'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>

            {/* Sort dropdown + direction toggle (right-aligned via ml-auto) */}
            <div className="flex items-center gap-2 ml-auto">
              <label
                htmlFor="bm-sort"
                className="text-sm font-medium text-content-secondary"
              >
                Sort:
              </label>
              <select
                id="bm-sort"
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
              <div className="flex" role="group" aria-label="Sort direction">
                <button
                  type="button"
                  onClick={() => setSortDirection('asc')}
                  aria-pressed={sortDirection === 'asc'}
                  aria-label="Ascending"
                  className={`px-2 py-1 rounded-l-btn text-sm font-medium transition-colors ${
                    sortDirection === 'asc'
                      ? 'bg-btn-primary text-btn-primary-text'
                      : 'btn btn-secondary'
                  }`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => setSortDirection('desc')}
                  aria-pressed={sortDirection === 'desc'}
                  aria-label="Descending"
                  className={`px-2 py-1 rounded-r-btn text-sm font-medium transition-colors ${
                    sortDirection === 'desc'
                      ? 'bg-btn-primary text-btn-primary-text'
                      : 'btn btn-secondary'
                  }`}
                >
                  ↓
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="p-4">
          {loading ? (
            <p className="text-content-muted text-center py-12">Loading suggestions...</p>
          ) : error ? (
            <p className="text-status-error text-center py-12">{error}</p>
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
        <Link
          href="/userProfile"
          onClick={onAddGames}
          className="btn btn-primary inline-block px-4 py-2 text-sm"
        >
          Add games to your collection
        </Link>
      </div>
    );
  }
  if (variant === 'filters-yield-none') {
    return (
      <div className="text-center py-12">
        <p className="text-content-secondary mb-4">
          No games match these filters. Try widening your selection.
        </p>
        <button
          type="button"
          onClick={onResetFilters}
          className="btn btn-primary px-4 py-2 text-sm"
        >
          Reset filters
        </button>
      </div>
    );
  }
  // Fallback — should rarely render now that variants cover the modal's empty cases
  return (
    <p className="text-content-muted text-center py-12">No matching games right now.</p>
  );
}
