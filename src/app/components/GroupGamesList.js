'use client';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import SafeImage from './SafeImage';
import { formatDate } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';

function GameCard({ game, groupId, sortBy, formatRating, formatPlayerCount, timezone }) {
    return (
        <Link
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
                            Last played: {formatDate(game.last_played, timezone)}
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
                        {(game.min_players || game.max_players || sortBy === 'player_count') && (
                            <p className="text-xs text-gray-500">
                                {formatPlayerCount(game)}
                            </p>
                        )}
                    </div>
                </div>
            </div>
        </Link>
    );
}

export default function GroupGamesList({ games, groupId, onAddEvent, userRole, members }) {
    const { timezone } = useTimezone();
    const [sortBy, setSortBy] = useState('name');
    const [sortOrder, setSortOrder] = useState('asc');
    const [filterOpen, setFilterOpen] = useState(false);
    const [filterWinner, setFilterWinner] = useState('');
    const [filterPicker, setFilterPicker] = useState('');

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

    const { winnerOptions, pickerOptions } = useMemo(() => {
        if (!games || games.length === 0) return { winnerOptions: [], pickerOptions: [] };

        const winnerMap = new Map();
        const pickerMap = new Map();

        games.forEach(game => {
            (game.winners || []).forEach(w => {
                const key = w.is_custom ? `custom:${w.username}` : w.user_id;
                const existing = winnerMap.get(key);
                if (existing) {
                    existing.totalCount += w.count;
                } else {
                    winnerMap.set(key, { key, username: w.username, user_id: w.user_id, totalCount: w.count, is_custom: w.is_custom });
                }
            });
            (game.pickers || []).forEach(p => {
                const key = p.is_custom ? `custom:${p.username}` : p.user_id;
                const existing = pickerMap.get(key);
                if (existing) {
                    existing.totalCount += p.count;
                } else {
                    pickerMap.set(key, { key, username: p.username, user_id: p.user_id, totalCount: p.count, is_custom: p.is_custom });
                }
            });
        });

        if (members && Array.isArray(members)) {
            members.forEach(m => {
                if (!winnerMap.has(m.user_id)) {
                    winnerMap.set(m.user_id, { key: m.user_id, username: m.username, user_id: m.user_id, totalCount: 0, is_custom: false });
                }
                if (!pickerMap.has(m.user_id)) {
                    pickerMap.set(m.user_id, { key: m.user_id, username: m.username, user_id: m.user_id, totalCount: 0, is_custom: false });
                }
            });
        }

        const sortByName = (a, b) => (a.username || '').localeCompare(b.username || '');
        return {
            winnerOptions: Array.from(winnerMap.values()).sort(sortByName),
            pickerOptions: Array.from(pickerMap.values()).sort(sortByName),
        };
    }, [games, members]);

    const filteredGames = useMemo(() => {
        let result = sortedGames;

        if (filterWinner) {
            result = result.filter(game => {
                return (game.winners || []).some(w => {
                    if (filterWinner.startsWith('custom:')) {
                        return w.is_custom && w.username === filterWinner.slice(7);
                    }
                    return w.user_id === filterWinner;
                });
            });
        }

        if (filterPicker) {
            result = result.filter(game => {
                return (game.pickers || []).some(p => {
                    if (filterPicker.startsWith('custom:')) {
                        return p.is_custom && p.username === filterPicker.slice(7);
                    }
                    return p.user_id === filterPicker;
                });
            });
        }

        return result;
    }, [sortedGames, filterWinner, filterPicker]);

    const groupedByTheme = useMemo(() => {
        if (sortBy !== 'theme' || filteredGames.length === 0) return [];

        const groups = [];
        let currentKey = null;
        let currentGroup = null;

        for (const game of filteredGames) {
            const hasTheme = !!game.theme && game.theme.trim() !== '';
            const key = hasTheme ? game.theme.trim().toLowerCase() : '__no_theme__';

            if (key !== currentKey) {
                currentGroup = {
                    theme: hasTheme ? game.theme.trim() : 'No Theme',
                    games: [],
                };
                groups.push(currentGroup);
                currentKey = key;
            }
            currentGroup.games.push(game);
        }

        return groups;
    }, [sortBy, filteredGames]);

    const formatRating = (rating) => {
        if (!rating) return 'No ratings';
        return `${parseFloat(rating).toFixed(1)}/5`;
    };

    const formatPlayerCount = (game) => {
        const min = game.min_players;
        const max = game.max_players;
        if (min && max) return `Players: ${min}-${max}`;
        if (min) return `Players: ${min}+`;
        if (max) return `Players: up to ${max}`;
        return 'Players: Unknown';
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
                <button
                    onClick={() => setFilterOpen(prev => !prev)}
                    className={`px-3 py-2 border rounded-md text-sm transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                        (filterWinner || filterPicker)
                            ? 'border-blue-500 bg-blue-50 text-blue-700 hover:bg-blue-100'
                            : 'border-gray-300 text-gray-700 hover:bg-gray-100'
                    }`}
                >
                    Filter{(filterWinner || filterPicker) ? ` (${(filterWinner ? 1 : 0) + (filterPicker ? 1 : 0)})` : ''}
                </button>
            </div>

            {filterOpen && (
                <div className="mb-6 bg-gray-50 p-3 md:p-4 rounded-lg border border-gray-200 -mt-3 rounded-t-none">
                    <div className="flex flex-col sm:flex-row gap-3">
                        <label className="flex-1">
                            <span className="text-sm font-medium text-gray-700 block mb-1">Winner</span>
                            <select
                                value={filterWinner}
                                onChange={(e) => setFilterWinner(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">All</option>
                                {winnerOptions.map(opt => (
                                    <option key={opt.key} value={opt.key}>
                                        {opt.username}{opt.is_custom ? ' (guest)' : ''} ({opt.totalCount} {opt.totalCount === 1 ? 'win' : 'wins'})
                                    </option>
                                ))}
                            </select>
                        </label>
                        <label className="flex-1">
                            <span className="text-sm font-medium text-gray-700 block mb-1">Picker</span>
                            <select
                                value={filterPicker}
                                onChange={(e) => setFilterPicker(e.target.value)}
                                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                            >
                                <option value="">All</option>
                                {pickerOptions.map(opt => (
                                    <option key={opt.key} value={opt.key}>
                                        {opt.username}{opt.is_custom ? ' (guest)' : ''} ({opt.totalCount} {opt.totalCount === 1 ? 'pick' : 'picks'})
                                    </option>
                                ))}
                            </select>
                        </label>
                    </div>
                </div>
            )}

            {/* Filtered count */}
            {(filterWinner || filterPicker) && filteredGames.length > 0 && (
                <p className="text-sm text-gray-500 mb-4">
                    Showing {filteredGames.length} of {games.length} {games.length === 1 ? 'game' : 'games'}
                </p>
            )}

            {/* Empty filter state */}
            {(filterWinner || filterPicker) && filteredGames.length === 0 && (
                <div className="text-center py-8 bg-gray-50 rounded-lg border border-gray-200">
                    <p className="text-gray-600 mb-3">No games match these filters</p>
                    <button
                        onClick={() => { setFilterWinner(''); setFilterPicker(''); }}
                        className="text-blue-600 hover:text-blue-800 text-sm font-medium"
                    >
                        Clear filters
                    </button>
                </div>
            )}

            {/* Games Display */}
            {(!(filterWinner || filterPicker) || filteredGames.length > 0) && (
                sortBy === 'theme' ? (
                    /* Theme-grouped layout with dividers */
                    <div>
                        {groupedByTheme.map((group, groupIndex) => (
                            <div key={group.theme}>
                                <div className={`text-sm font-semibold text-gray-600 uppercase tracking-wide border-b border-gray-200 pb-1 mb-3${groupIndex > 0 ? ' mt-6' : ''}`}>
                                    {group.theme}
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                    {group.games.map((game) => (
                                        <GameCard key={game.id} game={game} groupId={groupId} sortBy={sortBy} formatRating={formatRating} formatPlayerCount={formatPlayerCount} timezone={timezone} />
                                    ))}
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    /* Flat grid layout */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {filteredGames.map((game) => (
                            <GameCard key={game.id} game={game} groupId={groupId} sortBy={sortBy} formatRating={formatRating} formatPlayerCount={formatPlayerCount} timezone={timezone} />
                        ))}
                    </div>
                )
            )}
        </div>
    );
}