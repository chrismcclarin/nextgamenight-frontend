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
 * @param {string} currentUserId - Auth0 user ID (user.sub)
 * @param {Function} onSave - Called after successful save (triggers BringSummary refetch)
 */
export default function BringGamePicker({ isOpen, onClose, eventId, currentUserId, onSave }) {
  const [ownedGames, setOwnedGames] = useState([]);
  const [selectedGameIds, setSelectedGameIds] = useState(new Set());
  const [othersBringing, setOthersBringing] = useState({});
  const [searchQuery, setSearchQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !eventId || !currentUserId) return;

    let cancelled = false;

    async function fetchData() {
      setLoading(true);
      try {
        const [gamesRes, bringsRes] = await Promise.all([
          userGamesAPI.getOwnedGames(currentUserId),
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
          if (bring.user_id === currentUserId) {
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
  }, [isOpen, eventId, currentUserId]);

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
      className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900">Games to Bring</h3>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
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
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        {/* Game List */}
        <div className="flex-1 overflow-y-auto px-4 pb-2">
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
            </div>
          ) : ownedGames.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500 text-sm">You haven&apos;t added any games to your collection yet</p>
            </div>
          ) : filteredGames.length === 0 ? (
            <div className="text-center py-4">
              <p className="text-gray-400 text-sm">No games match your search</p>
            </div>
          ) : (
            <div className="space-y-1">
              {filteredGames.map(item => {
                const game = item.Game || item;
                const gameId = game.id;
                const gameName = game.name || game.title || 'Unknown Game';
                const thumbnail = game.thumbnail || game.image_url;
                const isSelected = selectedGameIds.has(gameId);
                const othersCount = othersBringing[gameId] || 0;

                return (
                  <button
                    key={gameId}
                    type="button"
                    onClick={() => toggleGame(gameId)}
                    className={`w-full flex items-center gap-3 p-2 rounded-lg text-left transition-colors ${
                      isSelected ? 'bg-blue-50 border border-blue-200' : 'hover:bg-gray-50 border border-transparent'
                    }`}
                  >
                    {/* Thumbnail */}
                    <div className="w-8 h-8 rounded flex-shrink-0 overflow-hidden bg-gray-100">
                      {thumbnail ? (
                        <SafeImage
                          src={thumbnail}
                          alt={gameName}
                          width={32}
                          height={32}
                          className="w-8 h-8 object-cover rounded"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center">
                          <span className="text-gray-400 text-xs">?</span>
                        </div>
                      )}
                    </div>

                    {/* Name + others indicator */}
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{gameName}</p>
                      {othersCount > 0 && (
                        <p className="text-xs text-gray-400">
                          {othersCount} {othersCount === 1 ? 'other' : 'others'} bringing this
                        </p>
                      )}
                    </div>

                    {/* Checkbox */}
                    <div className={`w-5 h-5 rounded border-2 flex-shrink-0 flex items-center justify-center transition-colors ${
                      isSelected ? 'bg-blue-600 border-blue-600' : 'border-gray-300'
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
        <div className="flex items-center justify-between p-4 border-t border-gray-200">
          <button
            onClick={onClose}
            className="text-sm text-gray-500 hover:text-gray-700 transition-colors"
          >
            Skip for now
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
