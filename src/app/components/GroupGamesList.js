'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import SafeImage from './SafeImage';
import { formatDate } from '../../lib/dateUtils';

export default function GroupGamesList({ games, groupId, onAddEvent, userRole }) {
    const [sortBy, setSortBy] = useState('name');
    const [sortOrder, setSortOrder] = useState('asc');

    const sortedGames = useMemo(() => {
        if (!games || games.length === 0) return [];

        const sorted = [...games].sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name':
                    cmp = (a.name || '').localeCompare(b.name || '');
                    break;
                case 'theme': {
                    const aTheme = (a.theme || '').trim().toLowerCase();
                    const bTheme = (b.theme || '').trim().toLowerCase();
                    const aHasTheme = !!a.theme && a.theme.trim() !== '';
                    const bHasTheme = !!b.theme && b.theme.trim() !== '';

                    // Games with no theme always sort last
                    if (!aHasTheme && !bHasTheme) {
                        cmp = (a.name || '').localeCompare(b.name || '');
                        return cmp; // No theme games: always alphabetical, skip direction flip
                    }
                    if (!aHasTheme) return 1;  // a goes last
                    if (!bHasTheme) return -1; // b goes last

                    // Primary: theme name alphabetically
                    cmp = aTheme.localeCompare(bTheme);
                    // Secondary: game name within same theme
                    if (cmp === 0) {
                        cmp = (a.name || '').localeCompare(b.name || '');
                    }
                    return sortOrder === 'asc' ? cmp : -cmp;
                }
                case 'player_count': {
                    const aPlayers = a.min_players;
                    const bPlayers = b.min_players;
                    const aHasPlayers = aPlayers != null && aPlayers > 0;
                    const bHasPlayers = bPlayers != null && bPlayers > 0;

                    // Games with no player data always sort last
                    if (!aHasPlayers && !bHasPlayers) {
                        cmp = (a.name || '').localeCompare(b.name || '');
                        return cmp; // No data games: always alphabetical, skip direction flip
                    }
                    if (!aHasPlayers) return 1;  // a goes last
                    if (!bHasPlayers) return -1; // b goes last

                    // Primary: min_players
                    cmp = aPlayers - bPlayers;
                    // Secondary: game name within same player count
                    if (cmp === 0) {
                        cmp = (a.name || '').localeCompare(b.name || '');
                    }
                    return sortOrder === 'asc' ? cmp : -cmp;
                }
                default:
                    cmp = (a.name || '').localeCompare(b.name || '');
                    break;
            }
            return sortOrder === 'asc' ? cmp : -cmp;
        });

        return sorted;
    }, [games, sortBy, sortOrder]);

    const formatRating = (rating) => {
        if (!rating) return 'No ratings';
        return `${parseFloat(rating).toFixed(1)}/5`;
    };

    if (!games || games.length === 0) {
        return (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
                <p className="text-gray-600 text-lg mb-2">No games played yet</p>
                <p className="text-gray-500 mb-4">Start tracking your game sessions!</p>
                {userRole && userRole !== 'pending' && (
                    <button
                        onClick={onAddEvent}
                        className="bg-blue-600 text-white px-6 py-2 rounded-lg font-semibold hover:bg-blue-700 transition-colors"
                    >
                        Add Your First Game Event
                    </button>
                )}
            </div>
        );
    }

    return (
        <div>
            <h2 className="text-2xl font-bold text-gray-900 mt-8 mb-4">Group Games</h2>

            {/* Sorting Controls */}
            <div className="mb-6 flex items-center justify-between bg-gray-50 p-3 md:p-4 rounded-lg">
                <div className="flex items-center gap-2">
                    <label className="flex items-center gap-2">
                        <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Sort by:</span>
                        <select
                            value={sortBy}
                            onChange={(e) => setSortBy(e.target.value)}
                            className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="name">Name</option>
                            <option value="theme">Theme</option>
                            <option value="player_count">Player Count</option>
                        </select>
                    </label>
                    <button
                        onClick={() => setSortOrder(prev => prev === 'asc' ? 'desc' : 'asc')}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
                        title={sortOrder === 'asc' ? 'Ascending (click to reverse)' : 'Descending (click to reverse)'}
                    >
                        {sortOrder === 'asc' ? '\u2191' : '\u2193'}
                    </button>
                </div>
                {/* Right side reserved for future Phase 47 filter controls */}
            </div>

            {/* Games Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {sortedGames.map((game) => (
                    <Link
                        key={game.id}
                        href={`/gameDetail?game_id=${encodeURIComponent(game.id)}&group_id=${encodeURIComponent(groupId)}`}
                        className="block bg-white border border-gray-200 rounded-lg p-4 hover:shadow-lg transition-shadow hover:border-blue-300"
                    >
                        <div className="flex items-start gap-4">
                            <SafeImage
                                src={game.image_url}
                                alt={game.name}
                                className="w-16 h-16 object-cover rounded"
                            />
                            <div className="flex-1 min-w-0">
                                <h3 className="text-lg font-semibold text-gray-900 mb-1 truncate">
                                    {game.name}
                                </h3>
                                <div className="text-sm text-gray-600 space-y-1">
                                    <p>
                                        Played <span className="font-semibold">{game.play_count}</span> {game.play_count === 1 ? 'time' : 'times'}
                                    </p>
                                    <p>
                                        Last played: {formatDate(game.last_played)}
                                    </p>
                                    {game.avg_rating && (
                                        <p>
                                            Rating: <span className="font-semibold text-yellow-600">{formatRating(game.avg_rating)}</span>
                                            {game.review_count > 0 && (
                                                <span className="text-gray-500"> ({game.review_count} {game.review_count === 1 ? 'review' : 'reviews'})</span>
                                            )}
                                        </p>
                                    )}
                                    {game.theme && (
                                        <p className="text-xs text-gray-500">
                                            Theme: {game.theme}
                                        </p>
                                    )}
                                </div>
                            </div>
                        </div>
                    </Link>
                ))}
            </div>
        </div>
    );
}