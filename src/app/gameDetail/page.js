'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { eventsAPI, gameReviewsAPI, usersAPI, groupsAPI, gamesAPI, rsvpAPI, suggestionsAPI, invitesAPI, eventBringsAPI, API_BASE_URL } from '../../lib/api';
import CreateEvent from '../components/createEvent';
import RsvpSection from '../components/RsvpSection';
import BallotSection from '../components/BallotSection';
import BringGamePicker from '../components/BringGamePicker';
import BringSummary from '../components/BringSummary';
import GameSuggestionCard from '../components/GameSuggestionCard';
import QRCodeModal from '../components/QRCodeModal';
import { formatDate, formatDateTime, formatDuration, formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import TimezoneNudgeBanner from '../components/TimezoneNudgeBanner';
import SafeImage from '../components/SafeImage';
import FriendshipStatusProvider from '../components/FriendshipStatusProvider';
import ClickableMemberName from '../components/ClickableMemberName';

// Phase 65-02: small helper that renders a colored RSVP-status indicator.
// status is one of 'yes' | 'maybe' | 'no' | null/undefined (no response).
function RsvpStatusPill({ status }) {
    const map = {
        yes: { label: 'Going', cls: 'bg-status-success/15 text-status-success' },
        maybe: { label: 'Maybe', cls: 'bg-amber-100 text-amber-700' },
        no: { label: 'No', cls: 'bg-surface-card-hover text-content-muted' },
    };
    if (!status) {
        return (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-surface-card-hover text-content-muted">
                No reply
            </span>
        );
    }
    const m = map[status] || map.no;
    return (
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${m.cls}`}>
            {m.label}
        </span>
    );
}

// Phase 65-02: compact strip chip for the upcoming-event view. Shows the
// participant name (clickable for non-custom users), RSVP indicator, role
// badge, and a 🎲 if they're bringing a game. The full per-row Remove
// control lives in the See-all modal — chips never expose Remove.
function ParticipantChip({ participant, rsvpStatus, role, isBringing }) {
    const isCustom = !!participant.is_custom;
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded border border-line bg-surface-card text-xs max-w-full">
            <span className="font-medium text-content-primary truncate">
                {isCustom ? (
                    <>{participant.username || 'Guest'}<span className="text-content-muted ml-1">(Guest)</span></>
                ) : (
                    participant.username || 'Unknown'
                )}
            </span>
            <RsvpStatusPill status={rsvpStatus} />
            {role === 'owner' && (
                <span className="text-[10px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1 rounded font-semibold">Owner</span>
            )}
            {role === 'admin' && (
                <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1 rounded font-semibold">Admin</span>
            )}
            {isBringing && (
                <span title="Bringing a game" aria-label="Bringing a game">🎲</span>
            )}
        </span>
    );
}

function GuestInviteButton({ groupId, email }) {
    const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | 'error'

    const handleInvite = async () => {
        setStatus('sending');
        try {
            await invitesAPI.sendInvite(groupId, email);
            setStatus('sent');
        } catch (err) {
            setStatus('error');
        }
    };

    return (
        <button
            onClick={handleInvite}
            disabled={status === 'sending' || status === 'sent'}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                status === 'sent'
                    ? 'text-status-success border-status-success/30 bg-status-success/10'
                    : status === 'error'
                        ? 'text-status-error border-status-error/30 bg-status-error/10 hover:bg-status-error/20'
                        : 'text-content-link border-content-link/30 hover:bg-content-link/10'
            }`}
            title={status === 'sent' ? 'Invite sent!' : 'Invite this guest to join the group'}
        >
            {status === 'sending' && 'Sending...'}
            {status === 'sent' && 'Invite sent!'}
            {status === 'error' && 'Retry'}
            {!status && 'Invite to group'}
        </button>
    );
}

export default function GameDetailPage() {
    const { user } = Auth();
    const { timezone } = useTimezone();
    const searchParams = useSearchParams();
    const router = useRouter();
    const game_id = searchParams.get('game_id');
    const group_id = searchParams.get('group_id');
    const event_id = searchParams.get('event_id');

    const [game, setGame] = useState(null);
    const [events, setEvents] = useState([]);
    const [reviews, setReviews] = useState([]);
    const [userReview, setUserReview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [userRole, setUserRole] = useState(null);
    const [editEventModal, setEditEventModal] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);
    const [eventRsvpStatuses, setEventRsvpStatuses] = useState({});
    const [singleEvent, setSingleEvent] = useState(null);
    const [ballotRefreshKey, setBallotRefreshKey] = useState(0);
    const [showBringPicker, setShowBringPicker] = useState(false);
    const [bringPickerEventId, setBringPickerEventId] = useState(null);
    const [bringRefreshKey, setBringRefreshKey] = useState(0);
    const [eventSuggestions, setEventSuggestions] = useState([]);
    const [suggestionsPlayerCount, setSuggestionsPlayerCount] = useState(null);

    // Phase 65-02 single-event view state: kebab actions menu, participant
    // strip + See-all modal, Share-Game-QR modal, and Remove-with-confirm.
    const [showActionsMenu, setShowActionsMenu] = useState(false);
    const [cancellingEvent, setCancellingEvent] = useState(false);
    const actionsMenuRef = useRef(null);
    const [participants, setParticipants] = useState([]);
    const [groupMembersByUserId, setGroupMembersByUserId] = useState({}); // keyed by User.id (UUID)
    const [bringersSet, setBringersSet] = useState(new Set()); // set of User.id (UUID) bringing games
    const [rsvpByAuth0Id, setRsvpByAuth0Id] = useState({}); // { auth0_user_id: 'yes'|'no'|'maybe'|null }
    const [showAllParticipants, setShowAllParticipants] = useState(false);
    const [showGameQR, setShowGameQR] = useState(false);
    const [gameInviteUrl, setGameInviteUrl] = useState('');
    const [qrLoading, setQrLoading] = useState(false);
    const [removeConfirmingId, setRemoveConfirmingId] = useState(null); // participant.user_id of confirming row
    const removeConfirmTimerRef = useRef(null);

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
        if (game_id) {
            fetchGameData();
        } else if (event_id) {
            fetchEventOnly();
        }
    }, [game_id, group_id, event_id, user?.sub]);

    // Fetch game suggestions for event-only view
    useEffect(() => {
        if (!event_id || !group_id) return;
        const fetchSuggestions = async () => {
            try {
                const data = await suggestionsAPI.getEventSuggestions(event_id);
                if (Array.isArray(data)) {
                    setEventSuggestions(data);
                } else if (data && Array.isArray(data.suggestions)) {
                    setEventSuggestions(data.suggestions);
                    if (data.player_count) setSuggestionsPlayerCount(data.player_count);
                } else {
                    setEventSuggestions([]);
                }
            } catch {
                setEventSuggestions([]);
            }
        };
        fetchSuggestions();
    }, [event_id, group_id]);

    // Scroll to ballot section when #vote hash is in URL (from notification links)
    useEffect(() => {
        if (typeof window !== 'undefined' && window.location.hash === '#vote') {
            // Small delay to ensure BallotSection has rendered
            const timer = setTimeout(() => {
                const voteSection = document.getElementById('vote');
                if (voteSection) {
                    voteSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
            }, 500);
            return () => clearTimeout(timer);
        }
    }, []);

    // Phase 65-02 EVT-02 followup: refetch the bringers set so the 🎲
    // indicator on the participant strip + See-all modal stays in sync when
    // RSVP changes (backend hard-deletes EventBring rows when RSVP flips to
    // 'no' or 'maybe' — see routes/rsvp.js). Used both on initial mount and
    // from the RsvpSection onRsvpChange callback below.
    const refreshBringersSet = async (eventId) => {
        try {
            const brings = await eventBringsAPI.getEventBrings(eventId);
            if (Array.isArray(brings)) {
                const bSet = new Set();
                for (const b of brings) {
                    if (b?.User?.id) bSet.add(b.User.id);
                }
                setBringersSet(bSet);
            } else {
                setBringersSet(new Set());
            }
        } catch {
            setBringersSet(new Set());
        }
    };

    const fetchEventOnly = async () => {
        setLoading(true);
        try {
            const eventData = await eventsAPI.getEvent(event_id);
            setSingleEvent(eventData);

            // Backend GET /events/:event_id flattens EventParticipations via
            // formatEventWithCustomParticipants — each row is { user_id (UUID),
            // username, email, score, faction, is_new_player, placement,
            // is_guest, is_custom }. Custom participants have user_id === null.
            setParticipants(Array.isArray(eventData.EventParticipations) ? eventData.EventParticipations : []);

            if (group_id && user?.sub) {
                // Fetch group members — used for current-user role + per-row
                // role badge in the See-all modal. Members come back as User
                // objects with id (UUID), user_id (Auth0 string), and
                // UserGroup.role attached via the through-table.
                const groupMembers = await groupsAPI.getGroupMembers(group_id);
                if (Array.isArray(groupMembers)) {
                    const currentUserMember = groupMembers.find(m => m.user_id === user.sub);
                    if (currentUserMember && currentUserMember.UserGroup) {
                        setUserRole(currentUserMember.UserGroup.role);
                    }
                    // Build map keyed by User.id (UUID) since EventParticipation
                    // rows expose user_id-as-UUID after the flatten step.
                    const byId = {};
                    for (const m of groupMembers) {
                        if (m.id) byId[m.id] = m;
                    }
                    setGroupMembersByUserId(byId);
                }
                // Fetch RSVP status — both for the current viewer (already
                // wired into RsvpSection) and as a per-participant map keyed
                // by Auth0 user_id string for the strip + See-all chips.
                try {
                    const rsvpData = await rsvpAPI.getEventRsvps(event_id);
                    const myRsvp = (rsvpData.rsvps || []).find(r => r.user_id === user.sub);
                    setEventRsvpStatuses({ [event_id]: myRsvp?.status || null });
                    const byAuth0 = {};
                    for (const r of (rsvpData.rsvps || [])) {
                        if (r.user_id) byAuth0[r.user_id] = r.status;
                    }
                    setRsvpByAuth0Id(byAuth0);
                } catch {
                    setEventRsvpStatuses({ [event_id]: null });
                    setRsvpByAuth0Id({});
                }

                // Fetch event brings to flag participants who are bringing a
                // game (small bringersSet of User.id UUIDs).
                await refreshBringersSet(event_id);
            }
        } catch (error) {
            console.error('Error fetching event:', error);
        } finally {
            setLoading(false);
        }
    };

    // Phase 65-02: outside-click handler to close the kebab actions menu.
    useEffect(() => {
        if (!showActionsMenu) return;
        const handleClickOutside = (e) => {
            if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target)) {
                setShowActionsMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [showActionsMenu]);

    // Phase 65-02: clean up the second-click confirm timer on unmount.
    useEffect(() => {
        return () => {
            if (removeConfirmTimerRef.current) clearTimeout(removeConfirmTimerRef.current);
        };
    }, []);

    // Phase 65-02: cancel-event handler invoked from the kebab menu.
    // Single click cancels and redirects — no modal, no second confirm. The
    // kebab placement IS the friction. Phase 61 MAIL-05 handles the
    // cancellation email gate inside the backend DELETE handler.
    const handleCancelEvent = async () => {
        if (!user?.sub || !singleEvent?.id) return;
        setCancellingEvent(true);
        try {
            await eventsAPI.deleteEvent(singleEvent.id, user.sub);
            router.push(`/groupHomePage?id=${group_id}`);
        } catch (err) {
            console.error('Error cancelling event:', err);
            alert(err.message || 'Failed to cancel event.');
            setCancellingEvent(false);
            setShowActionsMenu(false);
        }
    };

    // Phase 65-02: open the Share-Game-QR modal. Mirrors the EventDayModal
    // handleShowGameQR pattern (loading state + error swallow).
    const handleShowGameQR = async () => {
        if (!singleEvent?.id) return;
        setQrLoading(true);
        try {
            const data = await eventsAPI.getEventInviteToken(singleEvent.id);
            setGameInviteUrl(data.invite_url);
            setShowGameQR(true);
        } catch (err) {
            console.error('Failed to get game invite token:', err);
            alert(err.message || 'Failed to load Share QR.');
        } finally {
            setQrLoading(false);
        }
    };

    // Phase 65-02 EVT-08 frontend: second-click-confirm Remove handler.
    // First click arms a 3s revert timer. Second click within the window
    // calls eventsAPI.removeParticipation (Plan 65-01 backend) which
    // hard-destroys the EventParticipation row and writes an audit-log row;
    // a subsequent QR re-join is silent (no welcome email) per EVT-08.
    const handleRemoveClick = async (participant) => {
        // participant.user_id is User.id (UUID) post-flatten — the value the
        // DELETE endpoint expects. Custom participants have user_id === null
        // and the Remove button is hidden for them at render time.
        const targetUserDbId = participant.user_id;
        if (!targetUserDbId) return;

        // First click: arm confirm + 3s revert timer.
        if (removeConfirmingId !== targetUserDbId) {
            if (removeConfirmTimerRef.current) clearTimeout(removeConfirmTimerRef.current);
            setRemoveConfirmingId(targetUserDbId);
            removeConfirmTimerRef.current = setTimeout(() => {
                setRemoveConfirmingId(null);
                removeConfirmTimerRef.current = null;
            }, 3000);
            return;
        }

        // Second click within 3s — actually remove.
        clearTimeout(removeConfirmTimerRef.current);
        removeConfirmTimerRef.current = null;
        setRemoveConfirmingId(null);
        try {
            await eventsAPI.removeParticipation(singleEvent.id, targetUserDbId);
            // Optimistically drop the row. No toast (per CONTEXT decision).
            setParticipants(prev => prev.filter(p => p.user_id !== targetUserDbId));
        } catch (err) {
            console.error('Failed to remove participant:', err);
            alert(err.message || 'Failed to remove participant.');
        }
    };

    const fetchGameData = async () => {
        if (!game_id) return;

        setLoading(true);
        try {
            // Fetch game details using gamesAPI which includes proper API URL and auth
            const gameData = await gamesAPI.getGame(game_id);
            setGame(gameData);

            // Only fetch events, reviews, and role when group_id is available
            if (group_id) {
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

                // Fetch RSVP statuses for each event (for BallotSection)
                if (user?.sub && gameEvents.length > 0) {
                    const rsvpStatusMap = {};
                    await Promise.all(gameEvents.map(async (evt) => {
                        try {
                            const rsvpData = await rsvpAPI.getEventRsvps(evt.id);
                            const myRsvp = (rsvpData.rsvps || []).find(r => r.user_id === user.sub);
                            rsvpStatusMap[evt.id] = myRsvp?.status || null;
                        } catch {
                            rsvpStatusMap[evt.id] = null;
                        }
                    }));
                    setEventRsvpStatuses(rsvpStatusMap);
                }

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

    if (!game_id && !event_id) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <p className="text-content-secondary mb-4">No game selected</p>
                    <Link href="/" className="text-content-link hover:underline">
                        ← Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    // Event-only view (no game_id, e.g. events with ballot voting)
    if (!game_id && singleEvent) {
        return (
            <div className="p-6 max-w-6xl mx-auto">
                <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                    <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                    {group_id && (
                        <>
                            <span className="text-content-muted mx-2">{'>'}</span>
                            <Link href={`/groupHomePage?id=${group_id}`} className="text-content-link hover:text-content-link-hover transition-colors font-medium">Group</Link>
                        </>
                    )}
                    <span className="text-content-muted mx-2">{'>'}</span>
                    <span className="text-content-primary font-semibold">{singleEvent.title || 'Game Night'}</span>
                </nav>

                {/* Phase 62-02: nudge banner so users without a profile TZ
                    notice before they read or edit the event time. */}
                <TimezoneNudgeBanner />

                <div className="card p-6 mb-6">
                    {/* Phase 65-02 EVT-01: header row with title + kebab actions
                        menu (owner/admin only). Single-click "Cancel event"
                        inside the dropdown destroys the event and redirects;
                        the kebab placement IS the friction (no second modal,
                        no typed confirm — see CONTEXT decisions). */}
                    <div className="flex justify-between items-start gap-3 mb-2">
                        <h1 className="text-3xl font-bold text-content-primary">{singleEvent.title || 'Game Night'}</h1>
                        {(userRole === 'owner' || userRole === 'admin') && (
                            <div className="relative flex-shrink-0" ref={actionsMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setShowActionsMenu(prev => !prev)}
                                    className="text-2xl text-content-muted hover:text-content-primary px-2 py-1 leading-none rounded hover:bg-surface-card-hover transition-colors"
                                    aria-haspopup="menu"
                                    aria-expanded={showActionsMenu}
                                    aria-label="Event actions"
                                    title="Event actions"
                                >
                                    {/* Use the unicode vertical-ellipsis glyph
                                        (⋮) — readable at text-2xl, no extra
                                        SVG import needed. */}
                                    ⋮
                                </button>
                                {showActionsMenu && (
                                    <div
                                        role="menu"
                                        className="absolute right-0 top-full mt-1 z-20 min-w-[160px] bg-surface-card border border-line rounded-md shadow-lg py-1"
                                    >
                                        <button
                                            type="button"
                                            role="menuitem"
                                            onClick={handleCancelEvent}
                                            disabled={cancellingEvent}
                                            className="w-full text-left px-3 py-2 text-sm text-status-error hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {cancellingEvent ? 'Cancelling…' : 'Cancel event'}
                                        </button>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="text-content-secondary space-y-1">
                        {/* Phase 62-02: render event start in viewer's profile TZ
                            with TZ abbreviation. Was: toLocaleDateString/Time
                            without timezone, which silently used browser TZ. */}
                        <p>
                            {new Date(singleEvent.start_date).toLocaleDateString('en-US', {
                                weekday: 'long',
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric',
                                ...(timezone ? { timeZone: timezone } : {}),
                            })}
                            {' at '}
                            {formatTime(singleEvent.start_date, timezone)}
                        </p>
                        {singleEvent.duration_minutes && <p>Duration: {singleEvent.duration_minutes} minutes</p>}
                        {singleEvent.location && <p>Location: {singleEvent.location}</p>}
                        {singleEvent.notes && <p className="mt-2 text-content-muted">{singleEvent.notes}</p>}
                    </div>
                </div>

                {/* Phase 65-02 EVT-02 + EVT-03: participant compact strip +
                    Share Game QR button. Visible to ALL group members
                    (userRole truthy and not 'pending'). The compact strip
                    shows the first 5 participants; "See all (N)" opens a
                    modal with the full list and the Remove control (admins
                    only). */}
                {userRole && userRole !== 'pending' && participants.length > 0 && (
                    <div className="card p-6 mb-6">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-lg font-semibold text-content-primary">
                                Participants ({participants.length})
                            </h2>
                            <button
                                type="button"
                                onClick={handleShowGameQR}
                                disabled={qrLoading}
                                className="btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 flex-shrink-0"
                                title="Share Game QR"
                            >
                                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 0113.5 9.375v-4.5z" />
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 6.75h.75v.75h-.75v-.75zM6.75 16.5h.75v.75h-.75v-.75zM16.5 6.75h.75v.75H16.5v-.75zM13.5 13.5h.75v.75h-.75v-.75zM13.5 19.5h.75v.75h-.75v-.75zM19.5 13.5h.75v.75h-.75v-.75zM19.5 19.5h.75v.75h-.75v-.75zM16.5 16.5h.75v.75H16.5v-.75z" />
                                </svg>
                                {qrLoading ? 'Loading...' : 'Share Game QR'}
                            </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {participants.slice(0, 5).map((p) => {
                                const member = p.user_id ? groupMembersByUserId[p.user_id] : null;
                                const auth0Id = member?.user_id;
                                const role = member?.UserGroup?.role;
                                const status = auth0Id ? rsvpByAuth0Id[auth0Id] : null;
                                const isBringing = p.user_id && bringersSet.has(p.user_id);
                                return (
                                    <ParticipantChip
                                        key={p.user_id || `custom-${p.username}`}
                                        participant={p}
                                        rsvpStatus={status}
                                        role={role}
                                        isBringing={isBringing}
                                    />
                                );
                            })}
                        </div>
                        {participants.length > 5 && (
                            <button
                                type="button"
                                onClick={() => setShowAllParticipants(true)}
                                className="mt-3 text-sm text-content-link hover:text-content-link-hover font-medium"
                            >
                                See all ({participants.length}) →
                            </button>
                        )}
                    </div>
                )}

                <div className="space-y-4">
                    <RsvpSection
                        eventId={singleEvent.id}
                        currentUserId={user?.sub}
                        eventDate={singleEvent.start_date}
                        onRsvpChange={(status) => {
                            const prevStatus = eventRsvpStatuses[singleEvent.id];
                            setEventRsvpStatuses(prev => ({ ...prev, [singleEvent.id]: status }));
                            if (status === 'yes' && prevStatus !== 'yes') {
                                setBringPickerEventId(singleEvent.id);
                                setShowBringPicker(true);
                            }
                            setBringRefreshKey(k => k + 1);
                            // Phase 65-02 EVT-02 followup: keep the 🎲
                            // indicator on the strip + See-all modal in sync.
                            // Backend deletes EventBring rows when RSVP flips
                            // to 'no'/'maybe', so the local set must refresh.
                            refreshBringersSet(singleEvent.id);
                        }}
                    />
                    <BallotSection
                        key={ballotRefreshKey}
                        eventId={singleEvent.id}
                        currentUserId={user?.sub}
                        eventDate={singleEvent.start_date}
                        userRole={userRole}
                        userRsvpStatus={eventRsvpStatuses[singleEvent.id] || null}
                    />
                    <BringSummary
                        eventId={singleEvent.id}
                        groupId={group_id}
                        currentUserId={user?.sub}
                        refreshKey={bringRefreshKey}
                        onEditClick={() => { setBringPickerEventId(singleEvent.id); setShowBringPicker(true); }}
                    />
                </div>

                {/* Recommended Games Section */}
                {eventSuggestions.length > 0 && (
                    <div className="card p-6 mt-6">
                        <h2 className="text-lg font-semibold text-content-primary mb-1">Recommended Games</h2>
                        {suggestionsPlayerCount && (
                            <p className="text-sm text-content-muted mb-4">
                                Games from your group that work for {suggestionsPlayerCount} players
                            </p>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {eventSuggestions.slice(0, 6).map((game) => (
                                <GameSuggestionCard
                                    key={game.id}
                                    game={game}
                                    onClick={() => router.push(`/gameDetail?game_id=${game.id}&group_id=${group_id}`)}
                                />
                            ))}
                        </div>
                        <div className="mt-4 text-center">
                            <button
                                onClick={() => router.push(`/gameSuggestions?eventId=${event_id}&groupId=${group_id}`)}
                                className="text-content-link hover:text-content-link-hover text-sm font-medium"
                            >
                                Browse all suggestions &rarr;
                            </button>
                        </div>
                    </div>
                )}

                {(userRole === 'owner' || userRole === 'admin') && (
                    <div className="mt-4 flex gap-2">
                        <button
                            onClick={() => { setEditingEvent(singleEvent); setEditEventModal(true); }}
                            className="btn btn-primary px-4 py-2 text-sm"
                        >
                            Edit Event
                        </button>
                    </div>
                )}

                {editEventModal && editingEvent && (
                    <CreateEvent
                        group_id={group_id}
                        modal={editEventModal}
                        modaltoggle={() => { setEditEventModal(false); setEditingEvent(null); }}
                        onEventCreated={() => { setEditEventModal(false); setEditingEvent(null); fetchEventOnly(); setBallotRefreshKey(k => k + 1); }}
                        editingEvent={editingEvent}
                        user={user}
                    />
                )}

                {/* Phase 65-02 EVT-02: See-all participants modal. Renders the
                    full participant list with role badge, RSVP status, and
                    bringing-game indicator. Owner/admin sees a Remove button
                    on each row (other than themselves) wired to the EVT-08
                    second-click confirm flow. */}
                {showAllParticipants && (
                    <div
                        className="modal-overlay"
                        onClick={() => setShowAllParticipants(false)}
                    >
                        <div
                            className="modal-content w-full max-w-lg relative p-6"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <button
                                type="button"
                                onClick={() => setShowAllParticipants(false)}
                                className="absolute top-4 right-4 text-content-muted hover:text-content-primary text-2xl leading-none"
                                aria-label="Close"
                            >
                                &times;
                            </button>
                            <h3 className="text-xl font-semibold mb-4 pr-8 text-content-primary">
                                Participants ({participants.length})
                            </h3>
                            <div className="max-h-[60vh] overflow-y-auto space-y-2 -mx-1 px-1">
                                {participants.map((p) => {
                                    const member = p.user_id ? groupMembersByUserId[p.user_id] : null;
                                    const auth0Id = member?.user_id;
                                    const role = member?.UserGroup?.role;
                                    const status = auth0Id ? rsvpByAuth0Id[auth0Id] : null;
                                    const isBringing = p.user_id && bringersSet.has(p.user_id);
                                    const isCurrentUser = auth0Id && auth0Id === user?.sub;
                                    const canRemove = (userRole === 'owner' || userRole === 'admin')
                                        && !!p.user_id // hide for custom guests (no DB user)
                                        && !isCurrentUser;
                                    const isConfirming = removeConfirmingId === p.user_id;
                                    return (
                                        <div
                                            key={p.user_id || `custom-${p.username}`}
                                            className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-line bg-surface-card"
                                        >
                                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                                                <span className="font-medium text-content-primary truncate">
                                                    {p.is_custom ? (
                                                        <>{p.username || 'Guest'}<span className="text-xs text-content-muted ml-1">(Guest)</span></>
                                                    ) : (
                                                        auth0Id ? (
                                                            <ClickableMemberName userId={auth0Id} username={p.username || 'Unknown'} />
                                                        ) : (
                                                            p.username || 'Unknown'
                                                        )
                                                    )}
                                                </span>
                                                <RsvpStatusPill status={status} />
                                                {role === 'owner' && (
                                                    <span className="text-[10px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold">Owner</span>
                                                )}
                                                {role === 'admin' && (
                                                    <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">Admin</span>
                                                )}
                                                {isBringing && (
                                                    <span title="Bringing a game" className="text-sm" aria-label="Bringing a game">🎲</span>
                                                )}
                                            </div>
                                            {canRemove && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveClick(p)}
                                                    className={`text-xs px-2 py-1 border rounded transition-colors flex-shrink-0 ${
                                                        isConfirming
                                                            ? 'bg-status-error/10 border-status-error text-status-error font-semibold'
                                                            : 'border-line text-content-muted hover:bg-surface-card-hover'
                                                    }`}
                                                >
                                                    {isConfirming ? 'Click again to remove' : 'Remove'}
                                                </button>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    </div>
                )}

                {/* Phase 65-02 EVT-03: Share Game QR modal — same component +
                    contract used by EventDayModal. Open to all members. */}
                <QRCodeModal
                    isOpen={showGameQR}
                    onClose={() => setShowGameQR(false)}
                    url={gameInviteUrl}
                    title="Game Night Invite QR"
                    showReset={false}
                />

                {/* Phase 65-02 EVT-07: BringGamePicker mount fix. Previously
                    only mounted in the BGG-game branch — clicking RSVP=Yes in
                    the single-event view set state but no modal existed in
                    the DOM, so it never opened. Now mounted alongside the
                    edit-event modal and the Share-QR modal. */}
                <BringGamePicker
                    isOpen={showBringPicker}
                    onClose={() => { setShowBringPicker(false); setBringPickerEventId(null); }}
                    eventId={bringPickerEventId}
                    currentUserId={user?.sub}
                    onSave={() => {
                        setBringRefreshKey(k => k + 1);
                        // Phase 65-02 EVT-02 followup: show 🎲 immediately
                        // after picking a game without waiting for a remount.
                        if (bringPickerEventId) refreshBringersSet(bringPickerEventId);
                    }}
                />
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <p className="text-content-secondary">Loading game details...</p>
            </div>
        );
    }

    if (!game) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <p className="text-status-error mb-4">Game not found</p>
                    {group_id ? (
                        <Link href={`/groupHomePage?id=${group_id}`} className="text-content-link hover:underline">
                            ← Back to Group
                        </Link>
                    ) : (
                        <Link href="/" className="text-content-link hover:underline">
                            ← Back to Home
                        </Link>
                    )}
                </div>
            </div>
        );
    }

    return (
        <FriendshipStatusProvider>
        <div className="p-6 max-w-6xl mx-auto">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                {group_id && (
                    <>
                        <span className="text-content-muted mx-2">{'>'}</span>
                        <Link href={`/groupHomePage?id=${group_id}`} className="text-content-link hover:text-content-link-hover transition-colors font-medium">Group</Link>
                    </>
                )}
                <span className="text-content-muted mx-2">{'>'}</span>
                <span className="text-content-primary font-semibold">{game.name}</span>
            </nav>

            {/* Game Details */}
            <div className="card p-6 mb-6">
                {game.is_custom ? (
                    /* Custom game: show available details */
                    <div>
                        <h1 className="text-3xl font-bold text-content-primary mb-2">{game.name}</h1>
                        {game.theme && (
                            <p className="text-content-secondary mb-2">Theme: {game.theme}</p>
                        )}
                        <p className="text-sm text-content-muted">Custom Game</p>
                    </div>
                ) : (
                    /* BGG game: show full detail view */
                    <div className="flex gap-6">
                        <SafeImage
                            src={game.image_url}
                            alt={game.name}
                            className="w-48 h-48 object-cover rounded-lg"
                        />
                        <div className="flex-1">
                            <h1 className="text-3xl font-bold text-content-primary mb-2">{game.name}</h1>
                            {game.year_published && (
                                <p className="text-content-secondary mb-2">Published: {game.year_published}</p>
                            )}
                            {game.theme && (
                                <p className="text-content-secondary mb-2">Theme: {game.theme}</p>
                            )}
                            {game.min_players && game.max_players && (
                                <p className="text-content-secondary mb-2">
                                    Players: {game.min_players} - {game.max_players}
                                </p>
                            )}
                            {game.playing_time && (
                                <p className="text-content-secondary mb-2">Playing Time: {game.playing_time} minutes</p>
                            )}
                            {game.description && (
                                <p className="text-content-secondary mt-4">{game.description}</p>
                            )}
                        </div>
                    </div>
                )}
            </div>

            {/* Game Sessions */}
            <div className="card p-6 mb-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-content-primary">
                        Game Sessions ({filteredEvents.length} of {events.length})
                    </h2>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="btn btn-secondary px-4 py-2 text-sm font-medium flex items-center gap-2"
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
                <div className="mb-6 p-4 bg-surface-page rounded-lg border border-line">
                    <div className="flex justify-between items-center mb-3">
                        <h3 className="font-semibold text-content-primary">Filter & Sort Sessions</h3>
                        <button
                            onClick={clearFilters}
                            className="text-sm text-content-link hover:text-content-link-hover"
                        >
                            Clear All
                        </button>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Date Range */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">From Date</label>
                            <input
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">To Date</label>
                            <input
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        
                        {/* Player Filters */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Player Won</label>
                            <input
                                type="text"
                                value={filters.playerWon}
                                onChange={(e) => handleFilterChange('playerWon', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Player Picked</label>
                            <input
                                type="text"
                                value={filters.playerPicked}
                                onChange={(e) => handleFilterChange('playerPicked', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Player Participated</label>
                            <input
                                type="text"
                                value={filters.playerParticipated}
                                onChange={(e) => handleFilterChange('playerParticipated', e.target.value)}
                                placeholder="Player name..."
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        
                        {/* Duration Filters */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Min Duration (min)</label>
                            <input
                                type="number"
                                value={filters.minDuration}
                                onChange={(e) => handleFilterChange('minDuration', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Max Duration (min)</label>
                            <input
                                type="number"
                                value={filters.maxDuration}
                                onChange={(e) => handleFilterChange('maxDuration', e.target.value)}
                                placeholder="∞"
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        
                        {/* Player Count */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Min Players</label>
                            <input
                                type="number"
                                value={filters.minPlayers}
                                onChange={(e) => handleFilterChange('minPlayers', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        
                        {/* Max Score */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Min Score</label>
                            <input
                                type="number"
                                step="0.01"
                                value={filters.maxScore}
                                onChange={(e) => handleFilterChange('maxScore', e.target.value)}
                                placeholder="0"
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
                            />
                        </div>
                        
                        {/* Sort By */}
                        <div>
                            <label className="block text-xs font-medium text-content-secondary mb-1">Sort By</label>
                            <select
                                value={filters.sortBy}
                                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                                className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input text-sm"
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
                            <div key={event.id} className={`pl-4 py-2 ${index > 0 ? 'border-t-2 border-line-strong pt-4 mt-4' : ''}`} style={{ borderLeft: '4px solid var(--color-btn-primary-bg)' }}>
                                <div className="flex justify-between items-start gap-4">
                                    <div className="flex-1">
                                        <div className="flex items-start justify-between gap-4 mb-2">
                                            <div className="flex-1">
                                                <div className="flex items-center gap-3 mb-2">
                                                    <p className="font-semibold text-content-primary">
                                                        {formatDate(event.start_date, timezone)}
                                                    </p>
                                                    {event.duration_minutes && (
                                                        <span className="text-sm text-content-secondary">
                                                            • {formatDuration(event.duration_minutes)}
                                                        </span>
                                                    )}
                                                </div>
                                                {event.is_group_win ? (
                                                    <p className="text-sm text-status-success font-semibold mb-1">
                                                        ✓ Group Win
                                                    </p>
                                                ) : event.Winner && (
                                                    <p className="text-sm text-content-secondary mb-1">
                                                        Winner: <span className="font-semibold text-content-link">
                                                            {event.Winner.is_custom ? (
                                                                <>{event.Winner.username || event.Winner.name || 'Unknown'}<span className="text-xs text-content-muted ml-1">(Guest)</span></>
                                                            ) : (
                                                                <ClickableMemberName userId={event.Winner.user_id} username={event.Winner.username || 'Unknown'} />
                                                            )}
                                                        </span>
                                                    </p>
                                                )}
                                                {event.comments && (
                                                    <p className="text-content-secondary mt-1 text-sm italic">{event.comments}</p>
                                                )}
                                            </div>
                                            {(userRole === 'owner' || userRole === 'admin') && (
                                                <div className="flex gap-2 flex-shrink-0">
                                                    <button
                                                        onClick={() => handleEditEvent(event)}
                                                        className="btn btn-primary px-3 py-1 text-sm"
                                                        title="Edit this session"
                                                    >
                                                        Edit
                                                    </button>
                                                    <button
                                                        onClick={() => handleDeleteEvent(event.id)}
                                                        className="btn btn-danger px-3 py-1 text-sm"
                                                        title="Delete this session"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                        {event.EventParticipations && event.EventParticipations.length > 0 && (
                                            <div className="text-sm mt-3 pt-2 border-t border-line">
                                                <p className="font-semibold mb-2 text-content-primary">Participants:</p>
                                                <div className="space-y-2">
                                                    {event.EventParticipations.map((participation, idx) => (
                                                        <div key={idx} className="flex items-center gap-2 flex-wrap">
                                                            <span className="bg-surface-card-hover text-content-primary px-3 py-1 rounded border border-line inline-flex items-center gap-2">
                                                                <span className="font-medium">
                                                                    {participation.is_custom ? (
                                                                        <>{participation.User?.username || participation.username || 'Unknown'}<span className="text-xs text-content-muted ml-1">(Guest)</span></>
                                                                    ) : (
                                                                        <ClickableMemberName userId={participation.User?.user_id || participation.user_id} username={participation.User?.username || participation.username || 'Unknown'} />
                                                                    )}
                                                                </span>
                                                                {participation.is_guest && (
                                                                    <span className="text-xs bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-full font-medium">
                                                                        Guest
                                                                    </span>
                                                                )}
                                                                {participation.is_new_player && (
                                                                    <span className="text-xs bg-surface-card-hover text-content-link px-1.5 py-0.5 rounded font-semibold">
                                                                        New Player
                                                                    </span>
                                                                )}
                                                                {participation.faction && (
                                                                    <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded">
                                                                        {participation.faction}
                                                                    </span>
                                                                )}
                                                                {participation.score !== null && (
                                                                    <span className="text-xs font-semibold text-content-secondary">
                                                                        Score: {participation.score}
                                                                    </span>
                                                                )}
                                                                {participation.placement && (
                                                                    <span className="text-xs text-content-muted">
                                                                        #{participation.placement}
                                                                    </span>
                                                                )}
                                                            </span>
                                                            {participation.is_guest && (userRole === 'owner' || userRole === 'admin') && participation.email && (
                                                                <GuestInviteButton groupId={group_id} email={participation.email} />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {/* RSVP Section - interactive for future events, read-only for past */}
                                        <RsvpSection
                                            eventId={event.id}
                                            currentUserId={user?.sub}
                                            eventDate={event.start_date}
                                            onRsvpChange={(status) => {
                                                const prevStatus = eventRsvpStatuses[event.id];
                                                setEventRsvpStatuses(prev => ({ ...prev, [event.id]: status }));
                                                if (status === 'yes' && prevStatus !== 'yes') {
                                                    setBringPickerEventId(event.id);
                                                    setShowBringPicker(true);
                                                }
                                                setBringRefreshKey(k => k + 1);
                                            }}
                                        />
                                        {/* Ballot Section - game voting */}
                                        <BallotSection
                                            eventId={event.id}
                                            currentUserId={user?.sub}
                                            eventDate={event.start_date}
                                            userRole={userRole}
                                            userRsvpStatus={eventRsvpStatuses[event.id] || null}
                                        />
                                        {/* Bring Summary - who is bringing which games */}
                                        <BringSummary
                                            eventId={event.id}
                                            groupId={group_id}
                                            currentUserId={user?.sub}
                                            refreshKey={bringRefreshKey}
                                            onEditClick={() => { setBringPickerEventId(event.id); setShowBringPicker(true); }}
                                        />
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                ) : (
                    <p className="text-content-muted">
                        {events.length === 0 ? 'No game sessions recorded yet.' : 'No sessions match your filters.'}
                    </p>
                )}
                
                {/* Show More Button */}
                {filteredEvents.length > visibleSessions && (
                    <div className="mt-4 text-center">
                        <button
                            onClick={showMoreSessions}
                            className="btn btn-primary px-6 py-2"
                        >
                            Show {Math.min(3, filteredEvents.length - visibleSessions)} More Sessions
                        </button>
                    </div>
                )}
            </div>

            {/* Reviews Section */}
            <div className="card p-6">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-2xl font-bold text-content-primary">Reviews ({reviews.length})</h2>
                    {user && !userReview && userRole && userRole !== 'pending' && (
                        <button
                            onClick={() => setShowReviewForm(true)}
                            className="btn btn-primary px-4 py-2"
                        >
                            Add Review
                        </button>
                    )}
                </div>

                {/* User's Review (if exists) */}
                {userReview && (
                    <div className="border-l-4 border-btn-primary pl-4 py-2 mb-4 relative">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <p className="font-semibold text-content-primary">
                                    {userReview.User?.user_id ? (
                                        <ClickableMemberName userId={userReview.User.user_id} username={userReview.User.username || 'You'} />
                                    ) : (
                                        userReview.User?.username || 'You'
                                    )} <span className="text-xs text-content-link ml-1">(You)</span>
                                </p>
                                <p className="text-sm text-content-secondary">
                                    {formatDate(userReview.createdAt, timezone)}
                                </p>
                            </div>
                            <div className="text-right">
                                <p className="text-yellow-500 text-xl">
                                    {renderStars(userReview.rating)}
                                </p>
                                {userReview.is_recommended && (
                                    <p className="text-sm text-status-success font-semibold">✓ Recommended</p>
                                )}
                                <button
                                    onClick={() => setShowReviewForm(true)}
                                    className="text-content-link hover:text-content-link-hover text-sm mt-1"
                                >
                                    Edit
                                </button>
                            </div>
                        </div>
                        {userReview.review_text && (
                            <p className="text-content-secondary mt-2">{userReview.review_text}</p>
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
                                    <div key={review.id} className="border-l-4 border-line pl-4 py-2">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-content-primary">
                                                        {review.User?.user_id ? (
                                                            <ClickableMemberName userId={review.User.user_id} username={review.User.username || 'Unknown'} />
                                                        ) : (
                                                            <span>{review.User?.username || 'Unknown'}</span>
                                                        )}
                                                    </p>
                                                    {isUserReview && (
                                                        <span className="text-xs bg-surface-card-hover text-content-link px-2 py-1 rounded">
                                                            You
                                                        </span>
                                                    )}
                                                </div>
                                                <p className="text-sm text-content-secondary">
                                                    {formatDate(review.createdAt, timezone)}
                                                </p>
                                            </div>
                                            <div className="text-right">
                                                <p className="text-yellow-500 text-xl">
                                                    {renderStars(review.rating)}
                                                </p>
                                                {review.is_recommended && (
                                                    <p className="text-sm text-status-success font-semibold">✓ Recommended</p>
                                                )}
                                            </div>
                                        </div>
                                        {review.review_text && (
                                            <p className="text-content-secondary mt-2">{review.review_text}</p>
                                        )}
                                    </div>
                                );
                            })}
                    </div>
                ) : (
                    <p className="text-content-muted">No reviews yet. Be the first to review this game!</p>
                )}
            </div>

            {/* Review Modal */}
            {showReviewForm && (
                <div className="modal-overlay"
                     onClick={() => setShowReviewForm(false)}>
                    <div className="modal-content w-full max-w-md relative"
                         onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setShowReviewForm(false)}
                            className="absolute top-3 right-3 text-content-muted hover:text-content-primary text-2xl"
                        >
                            &times;
                        </button>
                        <h3 className="text-xl font-semibold mb-4 text-content-primary">
                            {userReview ? 'Edit Your Review' : 'Write a Review'}
                        </h3>
                        <form onSubmit={handleReviewSubmit} className="space-y-4">
                            <div>
                                <label htmlFor="rating" className="block text-sm font-medium text-content-primary mb-1">
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
                                    className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input"
                                    required
                                />
                            </div>
                            <div>
                                <label htmlFor="review_text" className="block text-sm font-medium text-content-primary mb-1">
                                    Review
                                </label>
                                <textarea
                                    id="review_text"
                                    value={reviewForm.review_text}
                                    onChange={(e) => setReviewForm({...reviewForm, review_text: e.target.value})}
                                    rows="4"
                                    className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input"
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
                                <label htmlFor="recommended" className="text-sm text-content-secondary cursor-pointer">
                                    ✓ Mark as recommended (shows a "Recommended" badge on your review)
                                </label>
                            </div>
                            <button
                                type="submit"
                                className="btn btn-primary px-6 py-2"
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

            {/* Bring Game Picker Modal */}
            <BringGamePicker
                isOpen={showBringPicker}
                onClose={() => { setShowBringPicker(false); setBringPickerEventId(null); }}
                eventId={bringPickerEventId}
                currentUserId={user?.sub}
                onSave={() => setBringRefreshKey(k => k + 1)}
            />
        </div>
        </FriendshipStatusProvider>
    );
}
