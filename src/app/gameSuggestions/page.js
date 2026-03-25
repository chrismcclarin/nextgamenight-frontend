'use client';

import { useState, useEffect, useCallback } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { suggestionsAPI } from '../../lib/api';
import GameSuggestionCard from '../components/GameSuggestionCard';

const COMPLEXITY_PRESETS = [
  { label: 'All', minWeight: null, maxWeight: null },
  { label: 'Light (1-2)', minWeight: '1', maxWeight: '2' },
  { label: 'Medium (2-3)', minWeight: '2', maxWeight: '3' },
  { label: 'Heavy (3-5)', minWeight: '3', maxWeight: '5' },
];

export default function GameSuggestionsPage() {
  const { user, isLoading: authLoading } = Auth();
  const searchParams = useSearchParams();
  const router = useRouter();

  const eventId = searchParams.get('eventId');
  const groupId = searchParams.get('groupId');
  const urlPlayerCount = searchParams.get('playerCount');
  const duration = searchParams.get('duration');

  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [playerCount, setPlayerCount] = useState(urlPlayerCount || null);

  // Filter state
  const [maxPlayTime, setMaxPlayTime] = useState(duration || '');
  const [complexityIdx, setComplexityIdx] = useState(0); // index into COMPLEXITY_PRESETS
  const [sort, setSort] = useState('rating');

  const fetchSuggestions = useCallback(async () => {
    if (!groupId && !eventId) return;
    setLoading(true);
    try {
      const preset = COMPLEXITY_PRESETS[complexityIdx];
      const params = {
        ...(maxPlayTime ? { maxPlayTime } : {}),
        ...(preset.minWeight ? { minWeight: preset.minWeight } : {}),
        ...(preset.maxWeight ? { maxWeight: preset.maxWeight } : {}),
        sort,
      };

      let data;
      if (eventId) {
        data = await suggestionsAPI.getEventSuggestions(eventId, params);
      } else {
        data = await suggestionsAPI.getGroupSuggestions(groupId, {
          ...params,
          ...(playerCount ? { playerCount } : {}),
        });
      }

      // The API may return { suggestions, player_count } or an array
      if (Array.isArray(data)) {
        setSuggestions(data);
      } else if (data && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
        if (data.player_count) setPlayerCount(data.player_count);
      } else {
        setSuggestions([]);
      }
    } catch (err) {
      console.warn('Game suggestions fetch failed:', err.message);
      console.error('Error fetching suggestions:', err);
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, groupId, playerCount, maxPlayTime, complexityIdx, sort]);

  // Fetch on mount and when filters change
  useEffect(() => {
    if (!authLoading && user) {
      fetchSuggestions();
    }
  }, [fetchSuggestions, authLoading, user]);

  // Auth guard
  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/api/auth/login');
    }
  }, [authLoading, user, router]);

  if (authLoading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-600">Loading...</p>
      </div>
    );
  }

  const handleCardClick = (game) => {
    router.push(`/gameDetail?game_id=${game.id}&group_id=${groupId}`);
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button
            onClick={() => router.back()}
            className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block"
          >
            &larr; Back
          </button>
          <h1 className="text-2xl font-bold text-gray-900">Game Suggestions</h1>
          {playerCount && (
            <p className="text-gray-500 mt-1">
              Games from your group&apos;s collections that work for {playerCount} players
            </p>
          )}
        </div>

        {/* Filter bar */}
        <div className="bg-white rounded-lg p-4 shadow-sm mb-6">
          <div className="flex flex-wrap items-center gap-4">
            {/* Play time filter */}
            <div className="flex items-center gap-2">
              <label htmlFor="maxPlayTime" className="text-sm font-medium text-gray-700 whitespace-nowrap">
                Max play time (min)
              </label>
              <input
                id="maxPlayTime"
                type="number"
                min="0"
                value={maxPlayTime}
                onChange={(e) => setMaxPlayTime(e.target.value)}
                placeholder="Any"
                className="w-24 p-2 border rounded text-gray-900 bg-white text-sm"
              />
            </div>

            {/* Complexity presets */}
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-gray-700">Complexity:</span>
              <div className="flex gap-1">
                {COMPLEXITY_PRESETS.map((preset, idx) => (
                  <button
                    key={preset.label}
                    onClick={() => setComplexityIdx(idx)}
                    className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                      complexityIdx === idx
                        ? 'bg-blue-600 text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Sort dropdown */}
            <div className="flex items-center gap-2 ml-auto">
              <label htmlFor="sort" className="text-sm font-medium text-gray-700">Sort:</label>
              <select
                id="sort"
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                className="p-2 border rounded text-gray-900 bg-white text-sm"
              >
                <option value="rating">Group Rating</option>
                <option value="play_time">Play Time</option>
                <option value="complexity">Complexity</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
        </div>

        {/* Results */}
        {loading ? (
          <p className="text-gray-500 text-center py-12">Loading suggestions...</p>
        ) : suggestions.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {suggestions.map((game) => (
              <GameSuggestionCard
                key={game.id}
                game={game}
                onClick={handleCardClick}
              />
            ))}
          </div>
        ) : (
          /* Empty state: clean and silent per product philosophy */
          <div />
        )}
      </div>
    </div>
  );
}
