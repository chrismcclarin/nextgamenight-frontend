'use client';

import { useState, useEffect } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { eventsAPI, gameReviewsAPI, usersAPI, groupsAPI, gamesAPI, API_BASE_URL } from '../../lib/api';
import CreateEvent from '../components/createEvent';

export default function GameDetailPage() {
    const { user } = Auth();
    const searchParams = useSearchParams();
    const game_id = searchParams.get('game_id');
    const group_id = searchParams.get('group_id');
    
    const [game, setGame] = useState(null);
    const [events, setEvents] = useState([]);
    const [reviews, setReviews] = useState([]);
    const [userReview, setUserReview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [userRole, setUserRole] = useState(null);
    const [editEventModal, setEditEventModal] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);
    
    // Session filtering and pagination state
    const [visibleSessions, setVisibleSessions] = useState(3);
    const [filteredEvents, setFilteredEvents] = useState([]);
    const [showFilters, setShowFilters] = useState(false);
    const [filters, setFilters] = useState({
        dateFrom: '',
        dateTo: '',
        playerWon: '',
        playerPicked: '',
        playerParticipated: '',
        minDuration: '',
        maxDuration: '',
        minPlayers: '',
        maxScore: '',
        sortBy: 'date_desc' // date_desc, date_asc, score_desc, score_asc, duration_desc, duration_asc
    });
    
    // Review form state
    const [reviewForm, setReviewForm] = useState({
        rating: 2.5, // Default to 2.5 (middle of 0-5 scale)
        review_text: '',
        is_recommended: true
    });

    useEffect(() => {
        if (game_id && group_id) {
            fetchGameData();
        }
    }, [game_id, group_id]);

    const fetchGameData = async () => {
        if (!game_id || !group_id) return;
        
        setLoading(true);
        try {
            // Fetch game details using gamesAPI which includes proper API URL and auth
            const gameData = await gamesAPI.getGame(game_id);
            setGame(gameData);

            // Fetch events for this game in this group
            // Use eventsAPI.getGroupEvents which automatically includes Authorization header
            let eventsData;
            try {
                eventsData = await eventsAPI.getGroupEvents(group_id);
            } catch (error) {
                console.error('Error fetching events:', error);
                eventsData = [];
            }
            
            // Ensure eventsData is an array before filtering
            if (!Array.isArray(eventsData)) {
                console.warn('Events data is not an array:', eventsData);
                eventsData = [];
            }
            
            const gameEvents = eventsData.filter(event => event.game_id === game_id);
            setEvents(gameEvents);

            // Fetch reviews for this game in this group
            // Use gameReviewsAPI.getGameReviews which automatically includes Authorization header
            const reviewsData = await gameReviewsAPI.getGameReviews(game_id, group_id, user?.sub || null);
            setReviews(Array.isArray(reviewsData) ? reviewsData : []);

            // Find current user's review
            if (user?.sub) {
                // Use usersAPI.getUser which automatically includes Authorization header
                const currentUserData = await usersAPI.getUser(user.sub);
                const myReview = Array.isArray(reviewsData) ? reviewsData.find(r => r.User?.id === currentUserData.id) : null;
                if (myReview) {
                    setUserReview(myReview);
                    setReviewForm({
                        rating: myReview.rating || 2.5,
                        review_text: myReview.review_text || '',
                        is_recommended: myReview.is_recommended !== false
                    });
                }
                
                // Get user's role in the group
                // Use groupsAPI.getGroupMembers which automatically includes Authorization header
                const groupMembers = await groupsAPI.getGroupMembers(group_id);
                if (Array.isArray(groupMembers)) {
                    const currentUserMember = groupMembers.find(m => m.user_id === user.sub);
                    if (currentUserMember && currentUserMember.UserGroup) {
                        setUserRole(currentUserMember.UserGroup.role);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching game data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteEvent = async (event_id) => {
        if (!user?.sub) return;
        
        if (!confirm('Are you sure you want to delete this game session? This action cannot be undone.')) {
            return;
        }
        
        try {
            await eventsAPI.deleteEvent(event_id, user.sub);
            // Refresh events after deletion
            fetchGameData();
        } catch (error) {
            console.error('Error deleting event:', error);
            alert(error.message || 'Failed to delete event. Only group owners and admins can delete events.');
        }
    };

    const handleEditEvent = (event) => {
        setEditingEvent(event);
        setEditEventModal(true);
    };

    const handleEventUpdated = () => {
        setEditEventModal(false);
        setEditingEvent(null);
        fetchGameData(); // Refresh the event data
    };

    const handleReviewSubmit = async (e) => {
        e.preventDefault();
        if (!user?.sub || !game_id || !group_id) return;

        try {
            // Ensure rating is a number and within valid range (0-5, increments of 0.5)
            const ratingValue = parseFloat(reviewForm.rating);
            if (isNaN(ratingValue) || ratingValue < 0 || ratingValue > 5) {
                throw new Error('Rating must be between 0 and 5');
            }
            // Round to nearest 0.5 increment
            const roundedRating = Math.round(ratingValue * 2) / 2;
            
            // Use gameReviewsAPI.submitReview which automatically includes Authorization header
            const data = await gameReviewsAPI.submitReview({
                user_id: user.sub,
                group_id: group_id,
                game_id: game_id,
                rating: roundedRating,
                review_text: reviewForm.review_text,
                is_recommended: reviewForm.is_recommended
            });
            
            // Update user review state
            setUserReview(data);
            setShowReviewForm(false);
            
            // Refresh reviews
            fetchGameData();
        } catch (error) {
            console.error('Error submitting review:', error);
            const errorMessage = error.message || 'Failed to submit review. Please try again.';
            alert(errorMessage);
        }
    };

    const formatDate = (date) => {
        if (!date) return 'Never';
        try {
            return new Date(date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        } catch {
            return 'Invalid date';
        }
    };

    const formatDateTime = (date) => {
        if (!date) return '';
        try {
            return new Date(date).toLocaleString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch {
            return '';
        }
    };

    const formatDuration = (minutes) => {
        if (!minutes || minutes === 0) return '';
        if (minutes < 60) {
            return `${minutes} min`;
        }
        const hours = minutes / 60;
        // If it's exactly a whole number, show without decimal
        if (hours % 1 === 0) {
            return `${hours} hour${hours !== 1 ? 's' : ''}`;
        }
        // Otherwise, show with one decimal place
        return `${hours.toFixed(1)} hours`;
    };

    const renderStars = (rating) => {
        // Ratings are stored on a 0-5 scale, display directly
        const ratingValue = Number(rating) || 0;
        const validRating = Math.max(0, Math.min(5, ratingValue));
        const fullStars = Math.floor(validRating);
        const hasHalfStar = validRating % 1 >= 0.5;
        const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);
        return '★'.repeat(fullStars) + (hasHalfStar ? '½' : '') + '☆'.repeat(emptyStars);
    };

    // Filter and sort events
    useEffect(() => {
        let filtered = [...events];
        
        // Date range filter
        if (filters.dateFrom) {
            const fromDate = new Date(filters.dateFrom);
            filtered = filtered.filter(event => new Date(event.start_date) >= fromDate);
        }
        if (filters.dateTo) {
            const toDate = new Date(filters.dateTo);
            toDate.setHours(23, 59, 59, 999); // Include entire end date
            filtered = filtered.filter(event => new Date(event.start_date) <= toDate);
        }
        
        // Player won filter
        if (filters.playerWon) {
            filtered = filtered.filter(event => 
                event.Winner && event.Winner.username?.toLowerCase().includes(filters.playerWon.toLowerCase())
            );
        }
        
        // Player picked filter
        if (filters.playerPicked) {
            filtered = filtered.filter(event => 
                event.PickedBy && event.PickedBy.username?.toLowerCase().includes(filters.playerPicked.toLowerCase())
            );
        }
        
        // Player participated filter
        if (filters.playerParticipated) {
            filtered = filtered.filter(event => 
                event.EventParticipations?.some(p => 
                    p.User?.username?.toLowerCase().includes(filters.playerParticipated.toLowerCase())
                )
            );
        }
        
        // Duration filters
        if (filters.minDuration) {
            const minDur = parseInt(filters.minDuration);
            filtered = filtered.filter(event => event.duration_minutes >= minDur);
        }
        if (filters.maxDuration) {
            const maxDur = parseInt(filters.maxDuration);
            filtered = filtered.filter(event => event.duration_minutes <= maxDur);
        }
        
        // Player count filter
        if (filters.minPlayers) {
            const minPlayers = parseInt(filters.minPlayers);
            filtered = filtered.filter(event => 
                event.EventParticipations?.length >= minPlayers
            );
        }
        
        // Max score filter (sessions with at least one player scoring >= this value)
        if (filters.maxScore) {
            const minScore = parseFloat(filters.maxScore);
            filtered = filtered.filter(event => 
                event.EventParticipations?.some(p => p.score !== null && parseFloat(p.score) >= minScore)
            );
        }
        
        // Sorting
        switch (filters.sortBy) {
            case 'date_desc':
                filtered.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
                break;
            case 'date_asc':
                filtered.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
                break;
            case 'score_desc':
                filtered.sort((a, b) => {
                    const maxScoreA = Math.max(...(a.EventParticipations?.map(p => parseFloat(p.score) || 0) || [0]));
                    const maxScoreB = Math.max(...(b.EventParticipations?.map(p => parseFloat(p.score) || 0) || [0]));
                    return maxScoreB - maxScoreA;
                });
                break;
            case 'score_asc':
                filtered.sort((a, b) => {
                    const maxScoreA = Math.max(...(a.EventParticipations?.map(p => parseFloat(p.score) || 0) || [0]));
                    const maxScoreB = Math.max(...(b.EventParticipations?.map(p => parseFloat(p.score) || 0) || [0]));
                    return maxScoreA - maxScoreB;
                });
                break;
            case 'duration_desc':
                filtered.sort((a, b) => (b.duration_minutes || 0) - (a.duration_minutes || 0));
                break;
            case 'duration_asc':
                filtered.sort((a, b) => (a.duration_minutes || 0) - (b.duration_minutes || 0));
                break;
        }
        
        setFilteredEvents(filtered);
        setVisibleSessions(3); // Reset visible count when filters change
    }, [events, filters]);

    const handleFilterChange = (key, value) => {
        setFilters(prev => ({ ...prev, [key]: value }));
    };

    const clearFilters = () => {
        setFilters({
            dateFrom: '',
            dateTo: '',
            playerWon: '',
            playerPicked: '',
            playerParticipated: '',
            minDuration: '',
            maxDuration: '',
            minPlayers: '',
            maxScore: '',
            sortBy: 'date_desc'
        });
    };

    const showMoreSessions = () => {
        setVisibleSessions(prev => prev + 3);
    };

    const displayedEvents = filteredEvents.slice(0, visibleSessions);

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-gray-600">Loading game details...</p>
            </div>
        );
    }

    if (!game) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <p className="text-red-600 mb-4">Game not found</p>
                    <Link href={`/groupHomePage?id=${group_id}`} className="text-blue-600 hover:underline">
                        ← Back to Group
                    </Link>
                </div>
            </div>
        );
    }

    return (
        <div className="p-6 max-w-6xl mx-auto">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-gray-800 px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Home</Link>
                <span className="text-gray-400 mx-2">{'>'}</span>
                <Link href={`/groupHomePage?id=${group_id}`} className="text-blue-400 hover:text-blue-300 transition-colors font-medium">Group</Link>
                <span className="text-gray-400 mx-2">{'>'}</span>
                <span className="text-white font-semibold">{game.name}</span>
            </nav>

            {/* Game Details */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex gap-6">
                    {game.image_url && (
                        <img
                            src={game.image_url}
                            alt={game.name}
                            className="w-48 h-48 object-cover rounded-lg"
                            onError={(e) => {
                                e.target.style.display = 'none';
                            }}
                        />
                    )}
                    <div className="flex-1">
                        <h1 className="text-3xl font-bold text-gray-900 mb-2">{game.name}</h1>
                        {game.year_published && (
                            <p className="text-gray-600 mb-2">Published: {game.year_published}</p>
                        )}
                        {game.theme && (
                            <p className="text-gray-600 mb-2">Theme: {game.theme}</p>
                        )}
                        {game.min_players && game.max_players && (
                            <p className="text-gray-600 mb-2">
                                Players: {game.min_players} - {game.max_players}
                            </p>
                        )}
                        {game.playing_time && (
                            <p className="text-gray-600 mb-2">Playing Time: {game.playing_time} minutes</p>
                        )}
                        {game.description && (
                            <p className="text-gray-700 mt-4">{game.description}</p>
                        )}
                    </div>
                </div>
            </div>

            {/* Game Sessions */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-gray-900">
                        Game Sessions ({filteredEvents.length} of {events.length})
                    </h2>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300 transition-colors text-sm font-medium flex items-center gap-2"
                    >
                        {showFilters ? (
                            <>
                                <span>Hide Filters</span>
                                <span>▲</span>
                            </>
                        ) : (
                            <>
                                <span>Show Filters & Sort</span>
                                <span>▼</span>
                            </>
                        )}
                    </button>
                </div>
                
                {/* Filters and Sorting */}
                {showFilters && (
                <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-gray-900">Filter & Sort Sessions</h3>
                        <button
                            onClick={clearFilters}
                            className="text-sm text-blue-600 hover:text-blue-800"
                        >
                            Clear All
                        </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Date Range */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">From Date</label>
                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">To Date</label>
                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        
                        {/* Player Filters */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Player Won</label>
                            <input
                                type="text"
                                value={filters.playerWon}
                                onChange={(e) => handleFilterChange('playerWon', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Player Picked</label>
                            <input
                                type="text"
                                value={filters.playerPicked}
                                onChange={(e) => handleFilterChange('playerPicked', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Player Participated</label>
                            <input
                                type="text"
                                value={filters.playerParticipated}
                                onChange={(e) => handleFilterChange('playerParticipated', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        
                        {/* Duration Filters */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Min Duration (min)</label>
                            <input
                                type="number"
                                value={filters.minDuration}
                                onChange={(e) => handleFilterChange('minDuration', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Max Duration (min)</label>
                            <input
                                type="number"
                                value={filters.maxDuration}
                                onChange={(e) => handleFilterChange('maxDuration', e.target.value)}
                                placeholder="∞"
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        
                        {/* Player Count */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Min Players</label>
                            <input
                                type="number"
                                value={filters.minPlayers}
                                onChange={(e) => handleFilterChange('minPlayers', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        
                        {/* Max Score */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Min Score</label>
                            <input
                                type="number"
                                step="0.01"
                                value={filters.maxScore}
                                onChange={(e) => handleFilterChange('maxScore', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            />
                        </div>
                        
                        {/* Sort By */}
                        <div>
                            <label className="block text-xs font-medium text-gray-700 mb-1">Sort By</label>
                            <select
                                value={filters.sortBy}
                                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                                className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                            >
                                <option value="date_desc">Date (Newest First)</option>
                                <option value="date_asc">Date (Oldest First)</option>
                                <option value="score_desc">Highest Score</option>
                                <option value="score_asc">Lowest Score</option>
                                <option value="duration_desc">Longest Duration</option>
                                <option value="duration_asc">Shortest Duration</option>
                            </select>
                        </div>
                    </div>
                </div>
                )}
                
                {displayedEvents.length > 0 ? (
                    <div className="space-y-0">
                        {displayedEvents.map((event, index) => (
                            <div key={event.id} className={`pl-4 py-2 ${index > 0 ? 'border-t-2 border-gray-600 pt-4 mt-4' : ''}`} style={{ borderLeft: '4px solid #3b82f6' }}>
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-start justify-between gap-4 mb-2">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <p className="font-semibold text-gray-900">
                                                        {formatDate(event.start_date)}
                                                    </p>
                                                    {event.duration_minutes && (
                                                        <span className="text-sm text-gray-600">
                                                            • {formatDuration(event.duration_minutes)}
                                                        </span>
                                                    )}
                                                </div>
                                                {event.is_group_win ? (
                                                    <p className="text-sm text-green-600 font-semibold mb-1">
                                                        ✓ Group Win
                                                    </p>
                                                ) : event.Winner && (
                                                    <p className="text-sm text-gray-600 mb-1">
                                                        Winner: <span className="font-semibold text-blue-600">
                                                            {event.Winner.username || event.Winner.name || 'Unknown'}
                                                            {event.Winner.is_custom && <span className="text-xs text-gray-500 ml-1">(Guest)</span>}
                                                        </span>
                                                    </p>
                                                )}
                                                {event.comments && (
                                                    <p className="text-gray-600 mt-1 text-sm italic">{event.comments}</p>
                                                )}
                                            </div>
                                            {(userRole === 'owner' || userRole === 'admin') && (
                                                <div className="flex gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleEditEvent(event)}
                                                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700 transition-colors"
                                                        title="Edit this session"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteEvent(event.id)}
                                                        className="bg-red-600 text-white px-3 py-1 rounded text-sm hover:bg-red-700 transition-colors"
                                                        title="Delete this session"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {event.EventParticipations && event.EventParticipations.length > 0 && (
                                            <div className="text-sm mt-3 pt-2 border-t border-gray-200">
                                                <p className="font-semibold mb-2 text-gray-900">Participants:</p>
                                                <div className="space-y-2">
                                                    {event.EventParticipations.map((participation, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 flex-wrap">
                                                            <span className="bg-gray-200 text-gray-800 px-3 py-1 rounded border border-gray-300 inline-flex items-center gap-2">
                                                                <span className="font-medium">
                                                                    {participation.User?.username || participation.username || 'Unknown'}
                                                                    {participation.is_custom && <span className="text-xs text-gray-500 ml-1">(Guest)</span>}
                                                                </span>
                                                                {participation.is_new_player && (
                                                                    <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">
                                                                        New Player
                                                                    </span>
                                                                )}
                                                                {participation.faction && (
                                                                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                                                        {participation.faction}
                                                                    </span>
                                                                )}
                                                                {participation.score !== null && (
                                                                    <span className="text-xs font-semibold text-gray-700">
                                                                        Score: {participation.score}
                                                                    </span>
                                                                )}
                                                                {participation.placement && (
                                                                    <span className="text-xs text-gray-500">
                                                                        #{participation.placement}
                                                                    </span>
                                                                )}
                                                            </span>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-gray-600">
                        {events.length === 0 ? 'No game sessions recorded yet.' : 'No sessions match your filters.'}
                    </p>
                )}
                
                {/* Show More Button */}
                {filteredEvents.length > visibleSessions && (
                    <div className="mt-4 text-center">
                        <button
                            onClick={showMoreSessions}
                            className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Show {Math.min(3, filteredEvents.length - visibleSessions)} More Sessions
                        </button>
                    </div>
                )}
            </div>

            {/* Reviews Section */}
            <div className="bg-white rounded-lg shadow-md p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-gray-900">Reviews ({reviews.length})</h2>
                    {user && !userReview && (
                        <button
                            onClick={() => setShowReviewForm(true)}
                            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                        >
                            Add Review
                        </button>
                    )}
                </div>

                {/* User's Review (if exists) */}
                {userReview && (
                    <div className="border-l-4 border-blue-500 pl-4 py-2 mb-4 relative">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <p className="font-semibold text-gray-900">
                                    {userReview.User?.username || 'You'} <span className="text-xs text-blue-600 ml-1">(You)</span>
                                </p>
                                <p className="text-sm text-gray-600">
                                    {formatDate(userReview.createdAt)}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-yellow-500 text-xl">
                                    {renderStars(userReview.rating)}
                                </p>
                                {userReview.is_recommended && (
                                    <p className="text-sm text-green-600 font-semibold">✓ Recommended</p>
                                )}
                                <button
                                    onClick={() => setShowReviewForm(true)}
                                    className="text-blue-500 hover:text-blue-700 text-sm mt-1"
                                >
                                    Edit
                                </button>
                            </div>
                        </div>
                        {userReview.review_text && (
                            <p className="text-gray-700 mt-2">{userReview.review_text}</p>
                        )}
                    </div>
                )}

                {/* Other Reviews */}
                {reviews.length > 0 ? (
                    <div className="space-y-4">
                        {reviews
                            .filter(r => !userReview || r.id !== userReview.id)
                            .map((review) => {
                                const isUserReview = review.User?.id === user?.sub;
                                return (
                                    <div key={review.id} className="border-l-4 border-gray-300 pl-4 py-2">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-gray-900">
                                                        {review.User?.username || 'Unknown'}
                                                    </p>
                                                    {isUserReview && (
                                                        <span className="text-xs bg-blue-100 text-blue-800 px-2 py-1 rounded">
                                                            You
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-gray-600">
                                                    {formatDate(review.createdAt)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-yellow-500 text-xl">
                                                    {renderStars(review.rating)}
                                                </p>
                                                {review.is_recommended && (
                                                    <p className="text-sm text-green-600 font-semibold">✓ Recommended</p>
                                                )}
                                            </div>
                                        </div>
                                        {review.review_text && (
                                            <p className="text-gray-700 mt-2">{review.review_text}</p>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                ) : (
                    <p className="text-gray-600">No reviews yet. Be the first to review this game!</p>
                )}
            </div>

            {/* Review Modal */}
            {showReviewForm && (
                <div className="fixed inset-0 bg-gray-900 bg-opacity-75 flex items-center justify-center z-50">
                    <div className="bg-white p-6 rounded-lg shadow-xl w-full max-w-md relative">
                        <button
                            onClick={() => setShowReviewForm(false)}
                            className="absolute top-3 right-3 text-gray-500 hover:text-gray-800 text-2xl"
                        >
                            &times;
                        </button>
                        <h3 className="text-xl font-semibold mb-4 text-gray-900">
                            {userReview ? 'Edit Your Review' : 'Write a Review'}
                        </h3>
                        <form onSubmit={handleReviewSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="rating" className="block text-sm font-medium text-gray-900 mb-1">
                                    Rating (0-5, increments of 0.5)
                                </label>
                                <input
                                    type="number"
                                    id="rating"
                                    min="0"
                                    max="5"
                                    step="0.5"
                                    value={reviewForm.rating}
                                    onChange={(e) => setReviewForm({...reviewForm, rating: parseFloat(e.target.value)})}
                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="review_text" className="block text-sm font-medium text-gray-900 mb-1">
                                    Review
                                </label>
                                <textarea
                                    id="review_text"
                                    value={reviewForm.review_text}
                                    onChange={(e) => setReviewForm({...reviewForm, review_text: e.target.value})}
                                    rows="4"
                                    className="w-full p-2 border rounded text-gray-900 bg-white"
                                    placeholder="Share your thoughts about this game..."
                                />
                            </div>
                            <div className="flex items-center">
                                <input
                                    type="checkbox"
                                    id="recommended"
                                    checked={reviewForm.is_recommended}
                                    onChange={(e) => setReviewForm({...reviewForm, is_recommended: e.target.checked})}
                                    className="mr-2"
                                />
                                <label htmlFor="recommended" className="text-sm text-gray-700 cursor-pointer">
                                    ✓ Mark as recommended (shows a "Recommended" badge on your review)
                                </label>
                            </div>
                            <button
                                type="submit"
                                className="bg-blue-600 text-white px-6 py-2 rounded-lg hover:bg-blue-700 transition-colors"
                            >
                                {userReview ? 'Update Review' : 'Submit Review'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
            
            {/* Edit Event Modal */}
            {editEventModal && (
                <CreateEvent
                    group_id={group_id}
                    URL={API_BASE_URL}
                    modal={editEventModal}
                    modaltoggle={() => {
                        setEditEventModal(false);
                        setEditingEvent(null);
                    }}
                    onEventCreated={handleEventUpdated}
                    editingEvent={editingEvent}
                    user={user}
                />
            )}
        </div>
    );
}
