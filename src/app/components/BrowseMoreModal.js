'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import { suggestionsAPI } from '../../lib/api';
import GameSuggestionCard from './GameSuggestionCard';

/**
 * BrowseMoreModal — In-app modal that replaces the legacy /gameSuggestions
 * standalone page (which opened in a new tab and had a broken back button).
 *
 * Mounted from inside QuickSuggestions, which is mounted from createEvent.
 * This is the ONLY entry point to the suggestions surface in Phase 67.
 *
 * Plan 67-02 will fill the data-testid="browse-more-controls" placeholder
 * with player-count input + complexity tier buttons + sort dropdown +
 * asc/desc toggle.
 *
 * @param {boolean} open - When false, renders nothing
 * @param {function} onClose - Called when modal close X or backdrop tapped
 * @param {string} groupId - Group whose library populates the modal
 * @param {string} [eventId] - When present (editing existing event), uses event-scoped suggestion endpoint
 * @param {number} [defaultPlayerCount] - Defaults to event's participant count from createEvent
 * @param {function} onSelectGame - ({id, name}) => void — closes modal and sets event's primary game
 */
export default function BrowseMoreModal({
  open,
  onClose,
  groupId,
  eventId,
  defaultPlayerCount,
  onSelectGame,
}) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const fetchSuggestions = async () => {
      setLoading(true);
      setError(null);
      try {
        const params = { sort: 'rating' };
        let data;
        if (eventId) {
          data = await suggestionsAPI.getEventSuggestions(eventId, params);
        } else if (groupId) {
          data = await suggestionsAPI.getGroupSuggestions(groupId, {
            ...params,
            ...(defaultPlayerCount ? { playerCount: defaultPlayerCount } : {}),
          });
        } else {
          data = { suggestions: [] };
        }
        if (cancelled) return;
        const items = Array.isArray(data) ? data : (data?.suggestions || []);
        setSuggestions(items);
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
  }, [open, groupId, eventId, defaultPlayerCount]);

  if (!open) return null;

  const handleCardClick = (game) => {
    onSelectGame?.({ id: game.id, name: game.name });
    onClose?.();
  };

  const isEmpty = !loading && !error && suggestions.length === 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content max-w-4xl w-full mx-4 max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h3 className="text-xl font-bold text-content-primary">Browse games</h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-content-muted hover:text-content-primary text-2xl leading-none px-2"
          >
            ×
          </button>
        </div>

        {/*
          Filter/sort row — Plan 67-02 will fill this with player-count input +
          complexity tier buttons + sort dropdown + asc/desc toggle. Leave a
          stable test-id placeholder so 02 can drop controls in without
          restructuring the modal shell.
        */}
        <div
          data-testid="browse-more-controls"
          className="px-4 pt-3 pb-2 border-b border-line"
        />

        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <p className="text-content-muted text-center py-12">Loading suggestions...</p>
          ) : error ? (
            <p className="text-status-error text-center py-12">{error}</p>
          ) : isEmpty ? (
            <EmptyState
              variant="library-empty"
              onAddGames={() => onClose?.()}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {suggestions.map((game) => (
                <GameSuggestionCard
                  key={game.id}
                  game={game}
                  onClick={handleCardClick}
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * EmptyState — Three context-aware variants per CONTEXT.md decisions.
 *
 * Plan 01 wires only "library-empty" (the simple heuristic: zero results
 * returned with no active filters). Plan 02 will add the "filters-yield-none"
 * variant once filter state is wired into the modal.
 */
function EmptyState({ variant, onAddGames }) {
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
  // Default — generic no-matches (Plan 02 wires the filter-active variant)
  return (
    <p className="text-content-muted text-center py-12">No matching games right now.</p>
  );
}
