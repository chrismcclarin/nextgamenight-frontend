'use client';

import { useState, useEffect, useRef } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { eventsAPI, gameReviewsAPI, groupsAPI, gamesAPI, rsvpAPI, suggestionsAPI, invitesAPI, eventBringsAPI, API_BASE_URL } from '../../lib/api';
import CreateEvent from '../components/createEvent';
import RsvpSection from '../components/RsvpSection';
import BallotSection from '../components/BallotSection';
import BringGamePicker from '../components/BringGamePicker';
import BringSummary from '../components/BringSummary';
import GameSuggestionCard from '../components/GameSuggestionCard';
import QRCodeModal from '../components/QRCodeModal';
import { formatDate, formatDateTime, formatDuration, formatTime, formatLongDate } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import TimezoneNudgeBanner from '../components/TimezoneNudgeBanner';
import SafeImage from '../components/SafeImage';
import ClickableMemberName from '../components/ClickableMemberName';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';
import StarRatingPicker from '../components/StarRatingPicker';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { toast } from 'sonner';

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
// Phase 71.1-02 Blocker 3 fix: also render Guest pill on chips when the
// participant is_guest=true AND the viewer is a group member (so organizers
// can see at-a-glance who joined via game-invite QR vs full membership).
// Mirror the See-all modal's Guest pill gating (suppressed for game-only
// viewers — redundant on their own row, not load-bearing for co-attendee
// rows in their flow).
function ParticipantChip({ participant, rsvpStatus, role, isBringing, viewerScope }) {
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
            {participant.is_guest && viewerScope === 'group-member' && (
                <span
                    className="text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50 px-1 py-0.5"
                    title="Joined via game-invite QR (not a group member)"
                >
                    Guest
                </span>
            )}
            {isBringing && (
                <span title="Bringing a game" aria-label="Bringing a game">🎲</span>
            )}
        </span>
    );
}

function GuestInviteButton({ groupId, userId }) {
    const [status, setStatus] = useState(null); // null | 'sending' | 'sent' | 'already' | 'error'

    const handleInvite = async () => {
        setStatus('sending');
        try {
            // Invite by participant user_id — the guest's email is resolved
            // server-side (83-06 PII default-deny stripped it from the client). [83.3 SEAM-01]
            await invitesAPI.sendParticipantInvite(groupId, userId);
            setStatus('sent');
        } catch (err) {
            // 409 = already a pending invite / already a member — not a failure to
            // retry, so surface it as "Already invited" rather than "Retry". [83.3 SEAM-01]
            setStatus(err?.status === 409 ? 'already' : 'error');
        }
    };

    return (
        <button
            onClick={handleInvite}
            disabled={status === 'sending' || status === 'sent' || status === 'already'}
            className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                status === 'sent'
                    ? 'text-status-success border-status-success/30 bg-status-success/10'
                    : status === 'already'
                        ? 'text-content-muted border-line bg-surface-page'
                        : status === 'error'
                            ? 'text-status-error border-status-error/30 bg-status-error/10 hover:bg-status-error/20'
                            : 'text-content-link border-content-link/30 hover:bg-content-link/10'
            }`}
            title={
                status === 'sent'
                    ? 'Invite sent!'
                    : status === 'already'
                        ? 'This guest is already invited or a member'
                        : 'Invite this guest to join the group'
            }
        >
            {status === 'sending' && 'Sending...'}
            {status === 'sent' && 'Invite sent!'}
            {status === 'already' && 'Already invited'}
            {status === 'error' && 'Retry'}
            {!status && 'Invite to group'}
        </button>
    );
}

export default function GameDetailPage() {
    const { user } = Auth();
    // Phase 87.3-04 (D-01/D-04): the caller's resolved Users.id UUID from the
    // shared self-identity hook. Every is-me/is-mine derive on this page keys on
    // this UUID vs the nested `User.id` (never the flat `user_id`/`user.sub`),
    // so the PR-C flat-field flip cannot silently break them. selfUuid resolves
    // ASYNCHRONOUSLY (react-query) — is-me derives are gated on it (unresolved =
    // loading/indeterminate, never "not me") and re-run when it resolves.
    const { selfUuid, self, query: selfIdentityQuery } = useSelfIdentity();
    // D-08: permanent identity-resolution failure degrades is-me affordances
    // loudly-but-small via the compact FetchErrorBanner (never silently — D-11).
    const selfIdentityErrorState = useFetchErrorState(selfIdentityQuery);
    const { timezone } = useTimezone();
    // Phase 76 SOCL-06: compute friendship status at the participants-modal
    // call site so the trailing-slot affordance branches per relationship.
    // ClickableMemberName already handles its own status internally; this
    // hook is just for the modal's pill rendering and Self-row short-circuit.
    const { getStatus: getFriendshipStatus } = useFriendshipStatus();
    const searchParams = useSearchParams();
    const router = useRouter();
    const game_id = searchParams.get('game_id');
    const group_id = searchParams.get('group_id');
    const event_id = searchParams.get('event_id');
    // Phase 65-03 EVT-05: optional date prefill for the "Plan a game night
    // with this" CTA (e.g. /gameDetail?game_id=X&group_id=Y&date=2026-05-15
    // — used when the user lands here from a planning surface).
    const dateParam = searchParams.get('date');

    const [game, setGame] = useState(null);
    const [events, setEvents] = useState([]);
    const [reviews, setReviews] = useState([]);
    const [userReview, setUserReview] = useState(null);
    const [loading, setLoading] = useState(true);
    const [showReviewForm, setShowReviewForm] = useState(false);
    const [userRole, setUserRole] = useState(null);
    // Phase 71.1 GAMP-09: scope detection for two-QR model.
    // Resolved in fetchEvent based on whether caller is in groupMembers
    // (presence + UserGroup non-null = group-member; presence + UserGroup
    // null = game-only; absence = none — defensive only since the backend
    // returns 403 for unauthorized callers anyway).
    const [userScope, setUserScope] = useState('none'); // 'group-member' | 'pending' | 'game-only' | 'none'
    const [leavingEvent, setLeavingEvent] = useState(false);
    // Phase 71.1-02 Blocker 1 fix (defense in depth): some entry paths land
    // on /gameDetail?event_id=X without group_id (e.g. older QR-join "Go to
    // event" links). We derive group_id from the event response and store it
    // here so all downstream renders/hooks have a non-null value to key off.
    // The URL group_id (from searchParams) takes precedence; falls back to
    // the event response only when the URL omits it.
    const [effectiveGroupId, setEffectiveGroupId] = useState(group_id || null);
    // Phase 71.1: cached group members roster — needed by handleLeaveEvent
    // to resolve the caller's own row via Plan 71.1-01's caller-self-row
    // contract. Phase 87.3-04: the match now keys on the nested member UUID
    // (`groupMembers.find(m => m.id === selfUuid)`), never the flat sub.
    const [groupMembers, setGroupMembers] = useState([]);
    const [editEventModal, setEditEventModal] = useState(false);
    const [editingEvent, setEditingEvent] = useState(null);
    // Phase 65-03 EVT-05: separate state for the "Plan a game night with
    // this" CTA modal — distinct from editEventModal which is for editing
    // existing past sessions inline.
    const [showCreateEvent, setShowCreateEvent] = useState(false);
    const [eventRsvpStatuses, setEventRsvpStatuses] = useState({});
    const [singleEvent, setSingleEvent] = useState(null);
    const [ballotRefreshKey, setBallotRefreshKey] = useState(0);
    const [showBringPicker, setShowBringPicker] = useState(false);
    const [bringPickerEventId, setBringPickerEventId] = useState(null);
    const [bringRefreshKey, setBringRefreshKey] = useState(0);
    // Phase 71.1-02: rsvpRefreshKey forces RsvpSection to remount + refetch
    // after Edit Event removes a participant (RsvpSection holds private state
    // that only refetches on eventId change, so a parent-side bump is the
    // simplest signal — same pattern as ballotRefreshKey on BallotSection).
    const [rsvpRefreshKey, setRsvpRefreshKey] = useState(0);
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
    // Phase 87.3-04 (D-07): per-participant RSVP status map keyed by the nested
    // User.id UUID (renamed off "Auth0Id"). Built from rsvp rows' nested User.id
    // and looked up by roster member.id — a UUID-to-UUID join, so the PR-C
    // flat-field flip cannot silently zero out the participant RSVP chips.
    const [rsvpByUserId, setRsvpByUserId] = useState({}); // { user_uuid: 'yes'|'no'|'maybe'|null }
    const [showAllParticipants, setShowAllParticipants] = useState(false);
    const [showGameQR, setShowGameQR] = useState(false);
    const [gameInviteUrl, setGameInviteUrl] = useState('');
    const [qrLoading, setQrLoading] = useState(false);
    const [removeConfirmingId, setRemoveConfirmingId] = useState(null); // participant.user_id of confirming row
    const removeConfirmTimerRef = useRef(null);

    // Phase 76 EVT-09: mobile-only inline expand for title (2-line clamp) and
    // description (3-line clamp). Two independent pieces per CONTEXT D-EVT-09
    // (title tap-toggle is a separate UX from description Show More/Less).
    // Desktop (md: ≥768px) renders untouched via `md:line-clamp-none` overrides;
    // a media-query check inside the title onClick keeps the BGG <a> link
    // navigating on touch-laptops at desktop widths.
    const [titleExpanded, setTitleExpanded] = useState(false);
    const [descExpanded, setDescExpanded] = useState(false);

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

    // Phase 71.1 GAMP-09: unified scope resolver. Plan 01's backend caller-self-row
    // contract guarantees that for a game-only caller, `groupMembers` includes
    // their own row with UserGroup === null. For group members, the row's
    // UserGroup contains { role, joined_at }. For 'none', the caller never
    // reaches the success path — backend returns 403 — but we keep the branch
    // defensively.
    const resolveUserScope = (rosterArray, callerUuid) => {
        if (!Array.isArray(rosterArray) || !callerUuid) return { role: null, scope: 'none' };
        // Phase 87.3-04 (D-04): key on the nested member UUID, not the sub. The
        // caller-self-row contract guarantees the caller's `id` (UUID) is present.
        const caller = rosterArray.find(m => m.id === callerUuid);
        if (!caller) return { role: null, scope: 'none' };
        if (caller.UserGroup && caller.UserGroup.role) {
            const r = caller.UserGroup.role;
            return { role: r, scope: r === 'pending' ? 'pending' : 'group-member' };
        }
        // caller present but UserGroup is null → game-only
        return { role: null, scope: 'game-only' };
    };

    useEffect(() => {
        if (game_id) {
            fetchGameData();
        } else if (event_id) {
            fetchEventOnly();
        }
        // Phase 87.3-04: selfUuid is in the dep array so the is-me/scope derives
        // inside fetchGameData/fetchEventOnly re-run once identity resolves (they
        // are gated on selfUuid and skipped while it is still undefined).
    }, [game_id, group_id, event_id, user?.sub, selfUuid]);

    // Fetch game suggestions for event-only view.
    // Phase 71.1-02 Blocker 1 fix: gate on effectiveGroupId (URL-or-derived)
    // so game-only callers loading /gameDetail?event_id=X without a URL
    // group_id still get suggestions once the event response loads.
    useEffect(() => {
        if (!event_id || !effectiveGroupId) return;
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
    }, [event_id, effectiveGroupId]);

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

            // Phase 71.1-02 Blocker 1 fix (defense in depth): if the URL didn't
            // include group_id (e.g. a stale QR-join "Go to event" link from
            // before the landing-page fix shipped), derive it from the event
            // response. The URL group_id is a hint, not the source of truth.
            // Without this, game-only callers loading a bare /gameDetail?event_id=X
            // URL would skip the groupMembers fetch entirely and render with
            // userScope='none' (no participants strip, no Leave kebab).
            const derivedGroupId = group_id || eventData?.group_id || eventData?.Group?.id;
            if (derivedGroupId && !group_id) {
                console.log('[gameDetail] derived group_id from event response:', derivedGroupId);
            }
            setEffectiveGroupId(derivedGroupId || null);

            if (derivedGroupId && user?.sub) {
                // Fetch group members — used for current-user role + per-row
                // role badge in the See-all modal. Members come back as User
                // objects with id (UUID), user_id (Auth0 string), and
                // UserGroup.role attached via the through-table.
                const fetchedGroupMembers = await groupsAPI.getGroupMembers(derivedGroupId);
                if (Array.isArray(fetchedGroupMembers)) {
                    // Phase 71.1 GAMP-09: derive both userRole + userScope via
                    // unified resolver. Plan 71.1-01's caller-self-row contract
                    // guarantees the caller's row is present (with UserGroup=null
                    // for game-only callers).
                    // Phase 87.3-04: gate the is-me scope derive on identity
                    // resolution — while selfUuid is unresolved leave userScope
                    // at its prior/default value (loading/indeterminate), NEVER
                    // downgrade to 'none'. The fetch effect's selfUuid dep re-runs
                    // this flow once identity resolves.
                    if (selfUuid) {
                        const { role, scope } = resolveUserScope(fetchedGroupMembers, selfUuid);
                        setUserRole(role);
                        setUserScope(scope);
                    }
                    // Cache the roster so handleLeaveEvent can resolve the
                    // caller's User.id UUID without a second fetch.
                    setGroupMembers(fetchedGroupMembers);
                    // Build map keyed by User.id (UUID) since EventParticipation
                    // rows expose user_id-as-UUID after the flatten step.
                    const byId = {};
                    for (const m of fetchedGroupMembers) {
                        if (m.id) byId[m.id] = m;
                    }
                    setGroupMembersByUserId(byId);
                }
                // Fetch RSVP status — both for the current viewer (already
                // wired into RsvpSection) and as a per-participant map keyed
                // by Auth0 user_id string for the strip + See-all chips.
                try {
                    const rsvpData = await rsvpAPI.getEventRsvps(event_id);
                    // Phase 87.3-04: my-RSVP derive gated on identity resolution
                    // (nested User.id vs selfUuid). Re-runs when selfUuid resolves.
                    if (selfUuid) {
                        const myRsvp = (rsvpData.rsvps || []).find(r => r.User?.id === selfUuid);
                        setEventRsvpStatuses({ [event_id]: myRsvp?.status || null });
                    }
                    // Phase 87.3-04 (D-07): key on the nested User.id UUID (build
                    // side) so the modal lookup (roster member.id, also a UUID) is
                    // a UUID-to-UUID join — no sub/UUID mixed key anywhere.
                    const byUserId = {};
                    for (const r of (rsvpData.rsvps || [])) {
                        if (r.User?.id) byUserId[r.User.id] = r.status;
                    }
                    setRsvpByUserId(byUserId);
                } catch {
                    setEventRsvpStatuses({ [event_id]: null });
                    setRsvpByUserId({});
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
            await eventsAPI.deleteEvent(singleEvent.id);
            router.push(`/groupHomePage?id=${group_id}`);
        } catch (err) {
            console.error('Error cancelling event:', err);
            toast.error(err.message || 'Failed to cancel event.');
            setCancellingEvent(false);
            setShowActionsMenu(false);
        }
    };

    // Phase 71.1 GAMP-04: game-only-participant self-leave handler.
    // Single click commits (kebab placement IS the friction, matching the
    // cancel-event pattern). Resolves caller's User.id UUID from groupMembers
    // — Plan 71.1-01's caller-self-row contract guarantees the row is in the
    // response with UserGroup=null for game-only callers. Backend authz
    // (Plan 01 widening) accepts self-leave when caller's User.id matches
    // participationUserId.
    const handleLeaveEvent = async () => {
        if (!user?.sub || !singleEvent?.id) return;
        // Phase 87.3-04: identity must be resolved before we can resolve the
        // caller's own roster row. Unresolved = indeterminate (try again), never
        // a wrong "not in roster" that would swallow the leave action.
        if (!selfUuid) {
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }

        const myDbUser = (groupMembers || []).find(m => m.id === selfUuid);
        if (!myDbUser?.id) {
            console.error('[handleLeaveEvent] Caller row missing from groupMembers — backend contract violation. Plan 71.1-01 should always inject caller-self row for game-only scope.', {
                callerUuid: selfUuid,
                groupMembersLength: (groupMembers || []).length,
            });
            toast.error("Couldn't leave event. Please refresh and try again.");
            return;
        }

        setLeavingEvent(true);
        try {
            await eventsAPI.leaveEvent(singleEvent.id, myDbUser.id);
            // Redirect to home — the event is gone from their UpcomingEvents anyway.
            router.push('/');
        } catch (err) {
            console.error('[handleLeaveEvent] DELETE failed:', err);
            toast.error(err?.message || "Couldn't leave event. Please try again.");
            setLeavingEvent(false);
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
            toast.error(err.message || 'Failed to load Share QR.');
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
            toast.error(err.message || 'Failed to remove participant.');
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

                // Fetch RSVP statuses for each event (for BallotSection).
                // Phase 87.3-04: gate on identity resolution — this whole
                // per-event my-RSVP derive keys on selfUuid vs nested User.id.
                // While selfUuid is unresolved, skip it (indeterminate); the
                // fetch effect's selfUuid dep re-runs this once identity resolves.
                if (selfUuid && gameEvents.length > 0) {
                    const rsvpStatusMap = {};
                    await Promise.all(gameEvents.map(async (evt) => {
                        try {
                            const rsvpData = await rsvpAPI.getEventRsvps(evt.id);
                            const myRsvp = (rsvpData.rsvps || []).find(r => r.User?.id === selfUuid);
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

                // Find current user's review + derive role.
                // Phase 87.3-04 (D-01): the per-page usersAPI.getUser(user.sub)
                // self-fetch is REMOVED — selfUuid now comes from the shared
                // useSelfIdentity() hook. `user?.sub` here only gates "logged in".
                if (user?.sub) {
                    // Get user's role in the group
                    // Use groupsAPI.getGroupMembers which automatically includes Authorization header
                    const fetchedGroupMembers = await groupsAPI.getGroupMembers(group_id);
                    if (Array.isArray(fetchedGroupMembers)) {
                        setGroupMembers(fetchedGroupMembers);
                        // Phase 87.3-04: gate the scope derive on identity —
                        // unresolved selfUuid stays indeterminate (never 'none').
                        if (selfUuid) {
                            const { role, scope } = resolveUserScope(fetchedGroupMembers, selfUuid);
                            setUserRole(role);
                            setUserScope(scope);
                        }
                    }

                    // Phase 87.3-04 (:1892 sibling / Req 4): own-review detection
                    // keys on nested User.id vs selfUuid. Gated on resolution so an
                    // unresolved identity reads as "no own review yet" (loading),
                    // never mislabels someone else's review as mine.
                    if (selfUuid) {
                        const myReview = Array.isArray(reviewsData) ? reviewsData.find(r => r.User?.id === selfUuid) : null;
                        if (myReview) {
                            setUserReview(myReview);
                            setReviewForm({
                                rating: myReview.rating || 2.5,
                                review_text: myReview.review_text || '',
                                is_recommended: myReview.is_recommended !== false
                            });
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
            await eventsAPI.deleteEvent(event_id);
            // Refresh events after deletion
            fetchGameData();
        } catch (error) {
            console.error('Error deleting event:', error);
            toast.error(error.message || 'Failed to delete event. Only group owners and admins can delete events.');
        }
    };

    const handleEditEvent = (event) => {
        setEditingEvent(event);
        setEditEventModal(true);
    };

    const handleEventUpdated = () => {
        // Capture editingEvent.id before clearing — needed for refreshBringersSet
        // so the 🎲 indicators on the strip + See-all modal drop the removed
        // user immediately (same pattern as Phase 65-02 RSVP-flip-deletes-brings).
        const updatedEventId = editingEvent?.id;
        setEditEventModal(false);
        setEditingEvent(null);
        fetchGameData(); // Refresh the event data
        // Phase 71.1-02: bump every per-event refresh signal so child
        // components that hold private state (RsvpSection, BallotSection) and
        // parent-owned derived state (bringersSet) all reflect the cascade.
        setBallotRefreshKey(k => k + 1);
        setRsvpRefreshKey(k => k + 1);
        setBringRefreshKey(k => k + 1);
        if (updatedEventId) refreshBringersSet(updatedEventId);
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
            toast.error(errorMessage);
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
                    {effectiveGroupId && singleEvent?.Group?.name && (
                        /* Phase 71.1-02 Blocker 2 fix: only render the group
                           segment when we actually have a group name. The
                           previous fallback to the literal word "group"
                           rendered as "Game night with group" — confusing UI.
                           Backend GET /:event_id now includes Group eagerly
                           (Plan 71.1-02 Blocker 2 backend fix), so this should
                           always populate; the truthy check here is defense-
                           in-depth so old data paths can never display the
                           literal-word fallback. */
                        <>
                            <span className="text-content-muted mx-2">{'>'}</span>
                            {(userScope === 'group-member' || userScope === 'pending') ? (
                                <Link href={`/groupHomePage?id=${effectiveGroupId}`} className="text-content-link hover:text-content-link-hover transition-colors font-medium">
                                    {singleEvent.Group.name}
                                </Link>
                            ) : (
                                /* Phase 71.1 GAMP-11: game-only / none — render group
                                   name as static text (no link). Per CONTEXT: "Group
                                   name is shown as context but is not a link — they
                                   can't navigate to a group page they don't belong
                                   to." */
                                <span className="text-content-secondary font-medium">
                                    Game night with {singleEvent.Group.name}
                                </span>
                            )}
                        </>
                    )}
                    <span className="text-content-muted mx-2">{'>'}</span>
                    <span className="text-content-primary font-semibold">{singleEvent.title || 'Game Night'}</span>
                </nav>

                {/* Phase 62-02: nudge banner so users without a profile TZ
                    notice before they read or edit the event time. */}
                <TimezoneNudgeBanner />

                {/* D-08 (Phase 87.3-04): non-blocking degrade notice on PERMANENT
                    identity-resolution failure. Placed above the scope-gated
                    Participants/RSVP surface (userScope defaults to 'none' when
                    selfUuid can't resolve, hiding those sections) so the failure
                    surfaces loudly-but-small instead of silently. */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />

                <div className="card p-6 mb-6">
                    {/* Phase 65-02 EVT-01 + Phase 71.1 GAMP-10: header row with
                        title + scope-aware kebab actions menu. Single-click
                        commits inside the dropdown — kebab placement IS the
                        friction (no second modal, no typed confirm).
                        - owner/admin (group-member scope): Cancel event
                        - game-only scope: Leave event
                        - pending or none: no kebab at all (matches prior pending behavior) */}
                    <div className="flex justify-between items-start gap-3 mb-2">
                        <h1 className="text-3xl font-bold text-content-primary">{singleEvent.title || 'Game Night'}</h1>
                        {((userScope === 'group-member' && (userRole === 'owner' || userRole === 'admin')) || userScope === 'game-only') && (
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
                                        {userScope === 'group-member' && (userRole === 'owner' || userRole === 'admin') && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={handleCancelEvent}
                                                disabled={cancellingEvent}
                                                className="w-full text-left px-3 py-2 text-sm text-status-error hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {cancellingEvent ? 'Cancelling…' : 'Cancel event'}
                                            </button>
                                        )}
                                        {userScope === 'game-only' && (
                                            <button
                                                type="button"
                                                role="menuitem"
                                                onClick={handleLeaveEvent}
                                                disabled={leavingEvent}
                                                className="w-full text-left px-3 py-2 text-sm text-status-error hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {leavingEvent ? 'Leaving…' : 'Leave event'}
                                            </button>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="text-content-secondary space-y-1">
                        {/* Phase 84 PRIM-05: render event start in the viewer's
                            profile TZ via the consolidated datetime layer.
                            formatLongDate is golden-pinned byte-for-byte against
                            the prior bespoke long-form header call. */}
                        <p>
                            {formatLongDate(singleEvent.start_date, timezone)}
                            {' at '}
                            {formatTime(singleEvent.start_date, timezone)}
                        </p>
                        {singleEvent.duration_minutes && <p>Duration: {singleEvent.duration_minutes} minutes</p>}
                        {singleEvent.location && <p>Location: {singleEvent.location}</p>}
                        {singleEvent.notes && <p className="mt-2 text-content-muted">{singleEvent.notes}</p>}
                    </div>
                </div>

                {/* Phase 65-02 EVT-02 + EVT-03 + Phase 71.1 GAMP-02/10:
                    participant compact strip + Share Game QR button. Visible
                    to all group members AND game-only participants (the
                    co-attendee read is part of GAMP-02). The compact strip
                    shows the first 5 participants; "See all (N)" opens a
                    modal with the full list and the Remove control (admins
                    only). The Share Game QR button stays group-member-only
                    per CONTEXT (admin/owner-initiated invites only — not
                    surfaced to game-only callers). */}
                {(userScope === 'group-member' || userScope === 'game-only') && userRole !== 'pending' && participants.length > 0 && (
                    <div className="card p-6 mb-6">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-lg font-semibold text-content-primary">
                                Participants ({participants.length})
                            </h2>
                            {userScope === 'group-member' && (
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
                            )}
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {participants.slice(0, 5).map((p) => {
                                const member = p.user_id ? groupMembersByUserId[p.user_id] : null;
                                // Phase 87.3-04: derive the member DB UUID (not the
                                // sub) and look up the RSVP chip on the UUID-keyed map.
                                const memberUuid = member?.id;
                                const role = member?.UserGroup?.role;
                                const status = memberUuid ? rsvpByUserId[memberUuid] : null;
                                const isBringing = p.user_id && bringersSet.has(p.user_id);
                                return (
                                    <ParticipantChip
                                        key={p.user_id || `custom-${p.username}`}
                                        participant={p}
                                        rsvpStatus={status}
                                        role={role}
                                        isBringing={isBringing}
                                        viewerScope={userScope}
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
                        key={`rsvp-${rsvpRefreshKey}`}
                        eventId={singleEvent.id}
                        self={self}
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
                        groupId={effectiveGroupId}
                        self={self}
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
                        onEventCreated={() => {
                            // Phase 71.1-02: bump RSVP / brings refresh signals in
                            // addition to the existing ballot bump so the cascade
                            // (Edit Event removing a participant deletes their
                            // RSVP / EventBring / EventBallotVote rows on the
                            // backend) is visible without a manual page refresh.
                            const updatedEventId = singleEvent?.id;
                            setEditEventModal(false);
                            setEditingEvent(null);
                            fetchEventOnly();
                            setBallotRefreshKey(k => k + 1);
                            setRsvpRefreshKey(k => k + 1);
                            setBringRefreshKey(k => k + 1);
                            if (updatedEventId) refreshBringersSet(updatedEventId);
                        }}
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
                                    // Phase 87.3-04: the per-member identity is the DB
                                    // UUID (member.id) — feeds ALL FOUR downstream uses
                                    // (chip lookup, isCurrentUser, getFriendshipStatus
                                    // arg, ClickableMemberName userId) so none is left
                                    // sub-shaped against the UUID-keyed provider/routes.
                                    const memberUuid = member?.id;
                                    const role = member?.UserGroup?.role;
                                    const status = memberUuid ? rsvpByUserId[memberUuid] : null;
                                    const isBringing = p.user_id && bringersSet.has(p.user_id);
                                    const isCurrentUser = !!memberUuid && memberUuid === selfUuid;
                                    const canRemove = (userRole === 'owner' || userRole === 'admin')
                                        && !!p.user_id // hide for custom guests (no DB user)
                                        && !isCurrentUser;
                                    const isConfirming = removeConfirmingId === p.user_id;
                                    // Phase 76 SOCL-06: compute friendship status at the modal call site so the
                                    // trailing-slot affordance matches the per-row relationship. SOCL-06 is a
                                    // DESKTOP-ONLY bug per CONTEXT — mobile participants modal is already correct
                                    // (no hover model; existing inline indicators from ClickableMemberName stay
                                    // intact). The Self "You" pill is the one dual-viewport exception CONTEXT
                                    // calls out: "visible on both mobile and desktop, not just hover".
                                    //
                                    // Per-state behavior:
                                    //   Self      → 'You' pill on BOTH viewports + route name through plain <span>
                                    //               (ClickableMemberName already renders plain <span> for self, so
                                    //               the short-circuit is byte-equivalent and avoids a context lookup).
                                    //   accepted  → 'Friend' pill on DESKTOP ONLY (hidden md:inline-flex) + keep
                                    //               name rendering through ClickableMemberName so the existing
                                    //               'md:hidden ✓ Friend' mobile inline indicator stays preserved.
                                    //   pending_* → unchanged. ClickableMemberName provides desktop hover popover +
                                    //               mobile inline indicator.
                                    //   none      → unchanged. ClickableMemberName provides 'Add friend' on hover.
                                    const friendStatus = memberUuid ? getFriendshipStatus(memberUuid) : 'unknown';
                                    const isSelfRow = friendStatus === 'self' || isCurrentUser;
                                    return (
                                        <div
                                            key={p.user_id || `custom-${p.username}`}
                                            className="flex items-center justify-between gap-3 px-3 py-2 rounded border border-line bg-surface-card"
                                        >
                                            <div className="flex items-center gap-2 flex-wrap min-w-0">
                                                <span className="font-medium text-content-primary truncate">
                                                    {p.is_custom ? (
                                                        <>{p.username || 'Guest'}<span className="text-xs text-content-muted ml-1">(Guest)</span></>
                                                    ) : isSelfRow ? (
                                                        // Self renders as a plain span on both viewports.
                                                        // ClickableMemberName already returns a plain <span> for
                                                        // status === 'self' (no popover, no indicator) so this
                                                        // short-circuit is byte-equivalent on both mobile + desktop.
                                                        <span>{p.username || 'Unknown'}</span>
                                                    ) : memberUuid ? (
                                                        // Stranger / pending / accepted all route through
                                                        // ClickableMemberName. For accepted on mobile this preserves
                                                        // the existing md:hidden ✓ Friend indicator (pre-phase
                                                        // affordance). For accepted on desktop ClickableMemberName
                                                        // renders only the plain name — the desktop-only 'Friend'
                                                        // pill below gives desktop its read-only indicator.
                                                        <ClickableMemberName userId={memberUuid} username={p.username || 'Unknown'} />
                                                    ) : (
                                                        // memberUuid couldn't be resolved through groupMembersByUserId
                                                        // (game-only viewer or missing-from-group edge case).
                                                        // Render plain text — same fallback as before.
                                                        <span>{p.username || 'Unknown'}</span>
                                                    )}
                                                </span>
                                                <RsvpStatusPill status={status} />
                                                {isSelfRow && (
                                                    // Phase 76 SOCL-06: "You" pill — visible on BOTH viewports per
                                                    // CONTEXT D-SOCL-06: "visible on both mobile and desktop, not
                                                    // just hover". Blue fill matches the existing role-pill family
                                                    // (Owner=purple, Admin=blue) while staying distinguishable from
                                                    // Owner's purple. Self is a viewer-perspective indicator, not a
                                                    // role, but the visual family is the closest existing pattern.
                                                    <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-1.5 py-0.5 rounded font-semibold">
                                                        You
                                                    </span>
                                                )}
                                                {!isSelfRow && friendStatus === 'accepted' && (
                                                    // Phase 76 SOCL-06: "Friend" pill — DESKTOP ONLY
                                                    // (hidden md:inline-flex) per CONTEXT: "SOCL-06 is desktop-only".
                                                    // Mobile already shows the existing md:hidden ✓ Friend indicator
                                                    // from ClickableMemberName, preserved by routing accepted rows
                                                    // through ClickableMemberName above. Emerald color echoes the
                                                    // text-status-success used by that mobile inline indicator for
                                                    // visual continuity across viewports.
                                                    <span className="hidden md:inline-flex items-center text-[10px] uppercase tracking-wide bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 rounded font-semibold">
                                                        Friend
                                                    </span>
                                                )}
                                                {role === 'owner' && (
                                                    <span className="text-[10px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded font-semibold">Owner</span>
                                                )}
                                                {role === 'admin' && (
                                                    <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded font-semibold">Admin</span>
                                                )}
                                                {/* Phase 71.1 GAMP-12: render Guest badge for is_guest=true rows
                                                    when viewer is a full group member. Skips render for game-only
                                                    viewers (they are guests themselves; redundant on their own row,
                                                    and on co-attendee rows the badge isn't load-bearing for their
                                                    flow). Tells admins/owners who joined via game-invite QR so they
                                                    can decide who to onboard via admin-initiated invite. */}
                                                {p.is_guest && userScope === 'group-member' && (
                                                    <span
                                                        className="inline-flex items-center px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50"
                                                        title="Joined via game-invite QR (not a group member)"
                                                    >
                                                        Guest
                                                    </span>
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
                    self={self}
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

    // POLL-04 (D-SMS-LINK-04): friendly "Event not found" state for SMS
    // links whose event_id was cancelled/deleted between text-send and
    // tap. Distinct from the "Game not found" branch below — the user
    // arrived via /gameDetail?event_id=X expecting an event, so we tell
    // them the event is gone (not the game) and link back to userHome.
    if (event_id && !singleEvent) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center max-w-md mx-auto px-6">
                    <p className="text-content-primary text-lg font-semibold mb-2">Event not found</p>
                    <p className="text-content-secondary mb-6">This event no longer exists or has been cancelled.</p>
                    <Link href="/" className="text-content-link hover:underline">
                        ← Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    if (!game) {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="text-center">
                    <p className="text-status-error mb-4">Game not found</p>
                    {/* Phase 71.1 GAMP-11: scope-aware fallback — game-only/none
                        callers fall through to "← Back to Home" since the group
                        page would 403. Group-member/pending see the group link
                        as before. */}
                    {group_id ? (
                        (userScope === 'group-member' || userScope === 'pending') ? (
                            <Link href={`/groupHomePage?id=${group_id}`} className="text-content-link hover:underline">
                                ← Back to Group
                            </Link>
                        ) : (
                            <Link href="/" className="text-content-link hover:underline">
                                ← Back to Home
                            </Link>
                        )
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
        // POLL-02: FriendshipStatusProvider lifted to root layout — no longer
        // mounted here. The shared receivedRequests / accept/decline mutators
        // come from the root provider so NotificationBell + friends/page +
        // ClickableMemberName all read from one source of truth.
        <div className="p-6 max-w-6xl mx-auto">
            {/* Breadcrumbs */}
            <nav className="mb-4 text-sm bg-surface-elevated px-3 py-2 rounded-lg inline-block">
                <Link href="/" className="text-content-link hover:text-content-link-hover transition-colors font-medium">Home</Link>
                {group_id && (
                    <>
                        <span className="text-content-muted mx-2">{'>'}</span>
                        {(userScope === 'group-member' || userScope === 'pending') ? (
                            /* Group-context (game_id present) view: group-members
                               see the link with the group name (or generic "Group"
                               while loading — graceful, not load-bearing for the
                               game-only flow). */
                            <Link href={`/groupHomePage?id=${group_id}`} className="text-content-link hover:text-content-link-hover transition-colors font-medium">
                                {singleEvent?.Group?.name || 'Group'}
                            </Link>
                        ) : singleEvent?.Group?.name ? (
                            /* Phase 71.1 GAMP-11 + Blocker 2 fix: render the
                               static-text breadcrumb only when we have an actual
                               group name. Suppress the literal "group" word
                               fallback to avoid "Game night with group" UI. */
                            <span className="text-content-secondary font-medium">
                                Game night with {singleEvent.Group.name}
                            </span>
                        ) : null}
                    </>
                )}
                <span className="text-content-muted mx-2">{'>'}</span>
                <span className="text-content-primary font-semibold">{game.name}</span>
            </nav>

            {/* Phase 65-03 EVT-05: "Plan a game night with this" CTA. Visible to
                non-pending group members when group_id is in the URL. Opens the
                CreateEvent modal pre-filled with the current game (and date if
                ?date= is in the URL). */}
            {group_id && userRole && userRole !== 'pending' && (
                <div className="mb-4 flex justify-end">
                    <button
                        type="button"
                        onClick={() => setShowCreateEvent(true)}
                        className="btn btn-primary px-6 py-2 text-base font-semibold"
                    >
                        Plan a game night with this
                    </button>
                </div>
            )}

            {/* Game Details */}
            <div className="card p-6 mb-6">
                {game.is_custom ? (
                    /* Custom game: show available details */
                    <div>
                        {/* Phase 65-03 EVT-04: BGG link on game name. Custom games
                            almost always have null bgg_id — fallback renders plain text. */}
                        {/* Phase 76 EVT-09: mobile-only line-clamp + one-shot expand.
                            First mobile tap expands; subsequent taps fall through to
                            the BGG <a> (when bgg_id present). */}
                        <h1
                            onClick={(e) => {
                                if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches && !titleExpanded) {
                                    e.preventDefault();
                                    setTitleExpanded(true);
                                }
                            }}
                            className={`text-3xl font-bold text-content-primary mb-2 ${titleExpanded ? '' : 'line-clamp-2 md:line-clamp-none'} ${titleExpanded ? 'md:cursor-auto' : 'cursor-pointer md:cursor-auto'}`}
                        >
                            {game.bgg_id ? (
                                <a
                                    href={`https://boardgamegeek.com/boardgame/${game.bgg_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-content-primary hover:text-content-link hover:underline"
                                >
                                    {game.name}
                                </a>
                            ) : (
                                game.name
                            )}
                        </h1>
                        {game.theme && (
                            <p className="text-content-secondary mb-2">Theme: {game.theme}</p>
                        )}
                        <p className="text-sm text-content-muted">Custom Game</p>
                    </div>
                ) : (
                    /* BGG game: show full detail view */
                    <div className="flex flex-col md:flex-row gap-6">
                        <SafeImage
                            src={game.image_url}
                            alt={game.name}
                            className="w-full max-w-xs mx-auto h-auto md:mx-0 md:w-48 md:h-48 md:max-w-none object-cover rounded-lg"
                        />
                        <div className="flex-1 min-w-0">
                            {/* Phase 65-03 EVT-04: BGG link on game name. Subtle —
                                link color + underline only on hover; no separate button,
                                no chip, no external-link icon. Fallback to plain text
                                when bgg_id is null (rare on this branch). */}
                            {/* Phase 76 EVT-09: mobile-only line-clamp + one-shot expand.
                                First mobile tap expands; subsequent taps fall through to
                                the BGG <a>. Desktop renders full text + native link click. */}
                            <h1
                                onClick={(e) => {
                                    if (typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches && !titleExpanded) {
                                        e.preventDefault();
                                        setTitleExpanded(true);
                                    }
                                }}
                                className={`text-3xl font-bold text-content-primary mb-2 ${titleExpanded ? '' : 'line-clamp-2 md:line-clamp-none'} ${titleExpanded ? 'md:cursor-auto' : 'cursor-pointer md:cursor-auto'}`}
                            >
                                {game.bgg_id ? (
                                    <a
                                        href={`https://boardgamegeek.com/boardgame/${game.bgg_id}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-content-primary hover:text-content-link hover:underline"
                                    >
                                        {game.name}
                                    </a>
                                ) : (
                                    game.name
                                )}
                            </h1>
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
                                /* Phase 76 EVT-09: mobile-only line-clamp + inline expand. Desktop (md:) renders full text exactly as before. */
                                <div className="mt-4">
                                    <p className={`text-content-secondary ${descExpanded ? '' : 'line-clamp-3 md:line-clamp-none'}`}>
                                        {game.description}
                                    </p>
                                    <button
                                        type="button"
                                        onClick={() => setDescExpanded((v) => !v)}
                                        className="md:hidden mt-1 text-sm text-content-link hover:text-content-link-hover font-medium"
                                    >
                                        {descExpanded ? 'Show Less' : 'Show More'}
                                    </button>
                                </div>
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
                                                            {participation.is_guest && (userRole === 'owner' || userRole === 'admin') && participation.user_id && (
                                                                <GuestInviteButton groupId={group_id} userId={participation.user_id} />
                                                            )}
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                        {/* RSVP Section - interactive for future events, read-only for past */}
                                        <RsvpSection
                                            key={`${event.id}-${rsvpRefreshKey}`}
                                            eventId={event.id}
                                            self={self}
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
                                            self={self}
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
                {/* D-08 (Phase 87.3-04): non-blocking degrade notice on PERMANENT
                    identity-resolution failure — own-review edit/delete gate on
                    selfUuid, so surface (never silently hide) when it can't resolve. */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />
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
                                    {userReview.User?.id ? (
                                        <ClickableMemberName userId={userReview.User.id} username={userReview.User.username || 'You'} />
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
                                // Phase 87.3-04 (Req 4 — THE :1892 bug fix): compare
                                // the nested review author UUID to the resolved self
                                // UUID. Previously `=== user?.sub` (UUID-vs-sub) was
                                // ALWAYS false, so own-review affordances never rendered.
                                const isUserReview = !!selfUuid && review.User?.id === selfUuid;
                                return (
                                    <div key={review.id} className="border-l-4 border-line pl-4 py-2">
                                        <div className="flex justify-between items-start mb-2">
                                            <div>
                                                <div className="flex items-center gap-2">
                                                    <p className="font-semibold text-content-primary">
                                                        {review.User?.id ? (
                                                            <ClickableMemberName userId={review.User.id} username={review.User.username || 'Unknown'} />
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
                    <div className="modal-content w-full max-w-md relative p-6"
                         onClick={(e) => e.stopPropagation()}>
                        <button
                            onClick={() => setShowReviewForm(false)}
                            className="absolute top-4 right-4 text-content-muted hover:text-content-primary text-2xl leading-none"
                        >
                            &times;
                        </button>
                        <h3 className="text-xl font-semibold mb-4 pr-8 text-content-primary">
                            {userReview ? 'Edit Your Review' : 'Write a Review'}
                        </h3>
                        <form onSubmit={handleReviewSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-content-primary mb-1">
                                    Rating
                                </label>
                                <StarRatingPicker
                                    value={reviewForm.rating || 0}
                                    onChange={(newRating) => setReviewForm({...reviewForm, rating: newRating})}
                                    ariaLabel="Game rating"
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

            {/* Phase 65-03 EVT-05: "Plan a game night with this" Create Event Modal.
                Distinct from editEventModal above (which targets editingEvent). This
                instance always launches in create mode with the current game and
                (optionally) the ?date= URL param pre-filled. */}
            {showCreateEvent && (
                <CreateEvent
                    group_id={group_id}
                    modal={showCreateEvent}
                    modaltoggle={() => setShowCreateEvent(false)}
                    onEventCreated={() => {
                        setShowCreateEvent(false);
                        // Refresh sessions list so the brand-new event shows up.
                        fetchGameData();
                    }}
                    editingEvent={null}
                    user={user}
                    prefillDate={dateParam}
                    prefillGameId={game?.id}
                    prefillGameName={game?.name}
                    userRole={userRole}
                    /* Phase 65-03 EVT-05 fix: when ?date= is in the URL,
                       open the visual picker in day-mode focused on that
                       date so the prefill is immediately obvious. Without
                       a date, omit the prop and let CreateEvent default
                       to week-mode (the original behavior). */
                    initialVisualView={dateParam ? 'day' : undefined}
                />
            )}

            {/* Bring Game Picker Modal */}
            <BringGamePicker
                isOpen={showBringPicker}
                onClose={() => { setShowBringPicker(false); setBringPickerEventId(null); }}
                eventId={bringPickerEventId}
                self={self}
                onSave={() => setBringRefreshKey(k => k + 1)}
            />
        </div>
    );
}
