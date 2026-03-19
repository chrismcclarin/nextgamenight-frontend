'use client';

import { useState, useEffect, useRef } from 'react';
import { suggestionsAPI } from '../../lib/api';

export default function QuickSuggestions({ groupId, playerCount, duration, onSelectGame, eventId }) {
  const [suggestions, setSuggestions] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const debounceRef = useRef(null);

  useEffect(() => {
    // Cleanup debounce on unmount
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  useEffect(() => {
    // Clear previous debounce
    if (debounceRef.current) clearTimeout(debounceRef.current);

    // Only fetch if we have a valid groupId and playerCount >= 1
    if (!groupId || !playerCount || playerCount < 1) {
      setSuggestions([]);
      setLoaded(true);
      return;
    }

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
          // Take top 5 results — API returns { suggestions: [...] }
          const raw = Array.isArray(data) ? data : (data?.suggestions || []);
          const items = raw.slice(0, 5);
          setSuggestions(items);
        } catch (err) {
          // Silently fail - suggestions are helpful but not critical
          setSuggestions([]);
        }
        setLoaded(true);
      };
      fetchSuggestions();
    }, 500);
  }, [groupId, playerCount, duration]);

  // Render nothing if no suggestions or not yet loaded
  if (!loaded || suggestions.length === 0) {
    return null;
  }

  const browseMoreUrl = `/gameSuggestions?groupId=${groupId}&playerCount=${playerCount}${eventId ? '&eventId=' + eventId : ''}${duration ? '&duration=' + duration : ''}`;

  return (
    <div className="mt-1 mb-1">
      <div className="text-xs text-gray-400 uppercase tracking-wide mb-1">Suggestions</div>
      <div className="flex items-center gap-2 overflow-x-auto flex-nowrap pb-1">
        {suggestions.map((game) => (
          <button
            key={game.id}
            type="button"
            onClick={() => onSelectGame({ id: game.id, name: game.name })}
            className="flex items-center gap-1.5 px-2 py-1 border border-gray-200 rounded-full bg-white hover:bg-blue-50 transition-colors cursor-pointer flex-shrink-0"
            title={game.name}
          >
            {game.thumbnail_url ? (
              <img
                src={game.thumbnail_url}
                alt=""
                className="w-6 h-6 rounded object-cover flex-shrink-0"
              />
            ) : (
              <div className="w-6 h-6 rounded bg-gray-200 flex-shrink-0" />
            )}
            <span className="text-sm text-gray-900 truncate max-w-[120px]">
              {game.name}
            </span>
            {(game.min_players || game.max_players) && (
              <span className="text-xs text-gray-400 flex-shrink-0">
                {game.min_players === game.max_players
                  ? `${game.min_players}p`
                  : `${game.min_players || '?'}-${game.max_players || '?'}p`}
              </span>
            )}
          </button>
        ))}
        <a
          href={browseMoreUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-blue-600 hover:underline whitespace-nowrap flex-shrink-0 px-1"
        >
          Browse more
        </a>
      </div>
    </div>
  );
}
