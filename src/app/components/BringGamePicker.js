'use client';

import { useState, useEffect } from 'react';
import { userGamesAPI, eventBringsAPI } from '../../lib/api';
import SafeImage from './SafeImage';

/**
 * BringGamePicker - Modal overlay for selecting games to bring to an event
 *
 * @param {boolean} isOpen - Controls modal visibility
 * @param {Function} onClose - Called when user closes or skips
 * @param {string} eventId - UUID of the event
 * @param {object} self - Resolved self-identity row from useSelfIdentity
 *   ({ id: <Users.id UUID>, user_id: <sub>, ... }). Phase 87.3-04: my-brings
 *   preselect keys on `self.id` vs the nested `bring.User.id` UUID (D-04). The
 *   getOwnedGames server call keeps the SUB (`self.user_id`) — that route
 *   enforces `param === req.user.user_id` (the sub), so its arg shape is
 *   unchanged per the plan-wide "is-me is render-gating only" rule.
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
          // Server-call ARG keeps the SUB (self.user_id) — the owned-games route
          // enforces `param === req.user.user_id` (the sub); not an is-me compare.
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
        console.error('BringGamePicker: failed to load data', err);
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
      console.error('BringGamePicker: failed to save', err);
    } finally {
      setSaving(false);
    }
  };

  const handleBackdropClick = (e) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  // Filter games by search query (case-insensitive)
  const filteredGames = ownedGames.filter(item => {
    const game = item.Game || item;
    const name = game.name || game.title || '';
    return name.toLowerCase().includes(searchQuery.toLowerCase());
  });

  return (
    <div
      className="modal-overlay p-4"
      onClick={handleBackdropClick}
    >
      <div className="modal-content max-w-md w-full max-h-[80vh]">
        {/* Header */}
        <div className="modal-header">
          <h3 className="text-lg font-semibold text-content-primary">Games to Bring</h3>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-content-secondary text-2xl leading-none"
            aria-label="Close"
          >
            &times;
          </button>
        </div>

        {/* Search */}
        <div className="p-4 pb-2">
          <input
            type="text"
            placeholder="Search your games..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 border border-line rounded-lg text-sm text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent"
          />
        </div>

        {/* Game List */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
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
                      isSelected ? 'bg-surface-card-hover border border-accent' : 'hover:bg-surface-card-hover border border-transparent'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-surface-card-hover">
                      {thumbnail ? (
                        <SafeImage
                          src={thumbnail}
                          alt={gameName}
                          width={32}
                          height={32}
                          className="w-8 h-8 object-cover rounded"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-surface-card-hover rounded flex items-center justify-center">
                          <span className="text-content-muted text-xs">?</span>
                        </div>
                      )}
                    </div>

                    {/* Name + others indicator */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-content-primary truncate">{gameName}</p>
                      {othersCount > 0 && (
                        <p className="text-xs text-content-muted">
                          {othersCount} {othersCount === 1 ? 'other' : 'others'} bringing this
                        </p>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
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

        {/* Footer */}
        <div className="modal-footer justify-between">
          <button
            onClick={onClose}
            className="text-sm text-content-muted hover:text-content-secondary transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary text-sm"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
