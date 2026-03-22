'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import SafeImage from './SafeImage';
import { formatDate } from '../../lib/dateUtils';

export default function GroupGamesList({ games, groupId, onAddEvent, userRole }) {
    const [sortBy, setSortBy] = useState('last_played');
    const [sortOrder, setSortOrder] = useState('desc');

    const sortedGames = useMemo(() => {
        if (!games || games.length === 0) return [];

        const sorted = [...games].sort((a, b) => {
            let cmp = 0;
            switch (sortBy) {
                case 'name':
                    cmp = (a.name || '').localeCompare(b.name || '');
                    break;
                case 'play_count':
                    cmp = (a.play_count || 0) - (b.play_count || 0);
                    break;
                case 'rating':
                    cmp = (parseFloat(a.avg_rating) || 0) - (parseFloat(b.avg_rating) || 0);
                    break;
                case 'last_played':
                default:
                    cmp = new Date(a.last_played || 0) - new Date(b.last_played || 0);
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
            <div className="mb-6 flex flex-col sm:flex-row gap-3 sm:gap-4 items-stretch sm:items-center bg-gray-50 p-3 md:p-4 rounded-lg">
                <label className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Sort by:</span>
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
                    >
                        <option value="last_played">Last Played</option>
                        <option value="name">Name</option>
                        <option value="play_count">Play Count</option>
                        <option value="rating">Rating</option>
                    </select>
                </label>

                <label className="flex flex-col sm:flex-row sm:items-center gap-2">
                    <span className="text-sm font-medium text-gray-700 whitespace-nowrap">Order:</span>
                    <select
                        value={sortOrder}
                        onChange={(e) => setSortOrder(e.target.value)}
                        className="px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full sm:w-auto"
                    >
                        <option value="desc">Descending</option>
                        <option value="asc">Ascending</option>
                    </select>
                </label>
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