'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { groupsAPI } from '../../lib/api';
import SafeImage from './SafeImage';

export default function GroupLibrary({ groupId }) {
  const router = useRouter();
  const [games, setGames] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedOwner, setSelectedOwner] = useState(null);
  const [sortBy, setSortBy] = useState('name');
  const [showAllOwners, setShowAllOwners] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (!groupId || loaded.current) return;
    let cancelled = false;

    async function fetchLibrary() {
      try {
        setLoading(true);
        const data = await groupsAPI.getGroupLibrary(groupId);
        if (!cancelled) {
          setGames(data.games || []);
          setMembers(data.members || []);
          loaded.current = true;
        }
      } catch (error) {
        console.error('Error fetching group library:', error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchLibrary();
    return () => { cancelled = true; };
  }, [groupId]);

  // Filtering + sorting (derived, not modifying source data)
  const filteredGames = useMemo(() => {
    let result = [...games];

    // Filter by owner
    if (selectedOwner) {
      result = result.filter(game =>
        game.owners.some(o => o.user_id === selectedOwner)
      );
    }

    // Filter by search
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter(game =>
        game.name.toLowerCase().includes(q)
      );
    }

    // Sort
    result.sort((a, b) => {
      switch (sortBy) {
        case 'name':
          return (a.name || '').localeCompare(b.name || '');
        case 'players': {
          const aVal = a.min_players;
          const bVal = b.min_players;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        case 'time': {
          const aVal = a.playing_time;
          const bVal = b.playing_time;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        case 'complexity': {
          const aVal = a.weight;
          const bVal = b.weight;
          if (aVal == null && bVal == null) return (a.name || '').localeCompare(b.name || '');
          if (aVal == null) return 1;
          if (bVal == null) return -1;
          return aVal - bVal || (a.name || '').localeCompare(b.name || '');
        }
        default:
          return 0;
      }
    });

    return result;
  }, [games, selectedOwner, searchQuery, sortBy]);

  const clearFilters = () => {
    setSearchQuery('');
    setSelectedOwner(null);
    setSortBy('name');
  };

  const hasActiveFilters = searchQuery.trim() || selectedOwner || sortBy !== 'name';

  // Loading skeleton
  if (loading) {
    return (
      <div className="mt-4 space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-3 bg-surface-page rounded-card animate-pulse">
            <div className="w-10 h-10 bg-surface-card-hover rounded" />
            <div className="flex-1 space-y-2">
              <div className="h-4 bg-surface-card-hover rounded w-1/3" />
              <div className="h-3 bg-surface-card-hover rounded w-1/2" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  // Empty library (no games at all)
  if (games.length === 0) {
    return (
      <div className="mt-4 text-center py-12 bg-surface-page rounded-card border-2 border-dashed border-line">
        <p className="text-content-secondary text-lg mb-2">No games in this group&apos;s library yet.</p>
        <p className="text-content-muted">
          Add games to your collection on{' '}
          <Link href="/userProfile" className="text-accent hover:underline font-medium">your profile</Link>{' '}
          and they&apos;ll appear here.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-4">
      {/* Search bar */}
      <div className="mb-3">
        <input
          type="text"
          placeholder="Search games..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full px-4 py-2 border border-line rounded-btn text-sm bg-surface-input text-content-primary focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent"
        />
      </div>

      {/* Sort dropdown + game count */}
      <div className="mb-3 flex items-center justify-between">
        <label className="flex items-center gap-2">
          <span className="text-sm font-medium text-content-secondary">Sort:</span>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-3 py-1.5 border border-line rounded-btn text-sm bg-surface-input text-content-primary focus:outline-none focus:ring-2 focus:ring-focus-ring"
          >
            <option value="name">Name (A-Z)</option>
            <option value="players">Player Count</option>
            <option value="time">Play Time</option>
            <option value="complexity">Complexity</option>
          </select>
        </label>
        <span className="text-sm text-content-muted">
          {filteredGames.length} {filteredGames.length === 1 ? 'game' : 'games'}
        </span>
      </div>

      {/* Owner chip bar */}
      <div className="mb-4 overflow-x-auto flex gap-2 pb-1 -mx-1 px-1">
        <button
          onClick={() => setSelectedOwner(null)}
          className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
            selectedOwner === null
              ? 'bg-btn-primary text-btn-primary-text'
              : 'bg-surface-card-hover text-content-secondary hover:text-content-primary'
          }`}
        >
          All
        </button>
        {members.map((member) => (
          <button
            key={member.user_id}
            onClick={() => setSelectedOwner(member.user_id === selectedOwner ? null : member.user_id)}
            className={`flex-shrink-0 px-3 py-1 rounded-full text-sm font-medium transition-colors ${
              selectedOwner === member.user_id
                ? 'bg-btn-primary text-btn-primary-text'
                : 'bg-surface-card-hover text-content-secondary hover:text-content-primary'
            }`}
          >
            {member.username}
          </button>
        ))}
      </div>

      {/* Filter/search returns 0 results */}
      {filteredGames.length === 0 && hasActiveFilters && (
        <div className="text-center py-8 bg-surface-page rounded-card border border-line">
          <p className="text-content-secondary mb-3">No games found</p>
          <button
            onClick={clearFilters}
            className="text-content-link hover:text-content-link-hover text-sm font-medium"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Game list */}
      <div className="space-y-1">
        {filteredGames.map((game) => {
          const isExpanded = expandedId === game.id;
          const ownerCount = game.owners?.length || 0;

          // Build metadata segments, skipping nulls
          const metaParts = [];
          if (game.min_players != null || game.max_players != null) {
            if (game.min_players != null && game.max_players != null) {
              metaParts.push(`${game.min_players}-${game.max_players} players`);
            } else if (game.min_players != null) {
              metaParts.push(`${game.min_players}+ players`);
            } else {
              metaParts.push(`Up to ${game.max_players} players`);
            }
          }
          if (game.playing_time != null) {
            metaParts.push(`${game.playing_time} min`);
          }
          if (game.weight != null) {
            metaParts.push(`${game.weight.toFixed(1)} weight`);
          }

          return (
            <div key={game.id} className="border border-line rounded-card overflow-hidden">
              {/* Collapsed row */}
              <button
                onClick={() => setExpandedId(isExpanded ? null : game.id)}
                className="w-full flex items-center gap-3 p-3 hover:bg-surface-card-hover transition-colors text-left"
                style={{ minHeight: '56px' }}
              >
                <SafeImage
                  src={game.thumbnail_url || game.image_url}
                  alt={game.name}
                  className="w-10 h-10 rounded object-cover flex-shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-content-primary truncate text-sm">{game.name}</p>
                  {metaParts.length > 0 && (
                    <p className="text-xs text-content-muted truncate">{metaParts.join(' \u00B7 ')}</p>
                  )}
                </div>
                <span className="text-xs text-content-muted flex-shrink-0 whitespace-nowrap">
                  {ownerCount} {ownerCount === 1 ? 'owner' : 'owners'}
                </span>
              </button>

              {/* Expanded section */}
              <div
                className={`overflow-hidden transition-all duration-200 ease-in-out ${
                  isExpanded ? 'max-h-40 opacity-100' : 'max-h-0 opacity-0'
                }`}
              >
                <div className="px-3 pb-3 pt-2 border-t border-line bg-surface-page">
                  <OwnerList
                    owners={game.owners || []}
                    showAll={showAllOwners && expandedId === game.id}
                    onToggleShowAll={() => setShowAllOwners(prev => !prev)}
                    onSelectOwner={(userId) => setSelectedOwner(userId)}
                  />
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      router.push(`/gameDetail?game_id=${encodeURIComponent(game.id)}&group_id=${encodeURIComponent(groupId)}`);
                    }}
                    className="mt-2 text-sm text-content-link hover:text-content-link-hover font-medium"
                  >
                    View game
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OwnerList({ owners, showAll, onToggleShowAll, onSelectOwner }) {
  if (!owners || owners.length === 0) return null;

  const VISIBLE_LIMIT = 3;
  const hasMore = owners.length > VISIBLE_LIMIT;
  const visibleOwners = showAll ? owners : owners.slice(0, VISIBLE_LIMIT);
  const remaining = owners.length - VISIBLE_LIMIT;

  return (
    <p className="text-sm text-content-secondary">
      <span className="text-content-muted">Owned by </span>
      {visibleOwners.map((owner, i) => (
        <span key={owner.user_id}>
          {i > 0 && ', '}
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSelectOwner(owner.user_id);
            }}
            className="text-content-link hover:text-content-link-hover hover:underline"
          >
            {owner.username}
          </button>
        </span>
      ))}
      {hasMore && !showAll && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleShowAll();
          }}
          className="text-content-link hover:text-content-link-hover hover:underline ml-1"
        >
          and {remaining} more
        </button>
      )}
    </p>
  );
}
