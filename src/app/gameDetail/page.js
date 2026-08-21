'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { Modal } from '../components/Modal';
import { formatDate, formatDateTime, formatDuration, formatTime, formatLongDate } from '../../lib/datetime';
import { useTimezone } from '../components/TimezoneProvider';
import TimezoneNudgeBanner from '../components/TimezoneNudgeBanner';
import SafeImage from '../components/SafeImage';
import ClickableMemberName from '../components/ClickableMemberName';
import { useFriendshipStatus } from '../components/FriendshipStatusProvider';
import StarRatingPicker from '../components/StarRatingPicker';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { useFetchErrorState, getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { Button } from '../../components/ui/Button';
import { Input, Textarea, SelectControl } from '../../components/ui/Input';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import KebabMenu from '../components/KebabMenu';
import { toast } from 'sonner';

// Phase 65-02: small helper that renders a colored RSVP-status indicator.
// status is one of 'yes' | 'maybe' | 'no' | null/undefined (no response).
// DECISION Phase 88-27 (D-32 bucket A): `yes` is the censused row (its tint was stripped by 87.7);
// `maybe` was NOT, and was converged anyway. Chosen OVER touching only the censused branch, which
// would have left one map of three siblings speaking two vocabularies — and the branch left behind
// was `bg-amber-100 text-amber-700`, light-only raw-palette literals on a card that flips to
// `#232d3e` in dark mode, i.e. already broken there. Warning is how every other surface in the app
// renders an RSVP maybe (RsvpSection's statusConfig, rsvp/[token]'s config map). Reverting `maybe`
// to raw amber is a decision, not a cleanup.
function RsvpStatusPill({ status }) {
    const map = {
        yes: { label: 'Going', cls: 'bg-status-success-subtle text-status-success' },
        maybe: { label: 'Maybe', cls: 'bg-status-warning-subtle text-status-warning' },
        no: { label: 'No', cls: 'bg-surface-card-hover text-content-muted' },
    };
    if (!status) {
        return (
            <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-surface-card-hover text-content-muted">
                No reply
            </span>
        );
    }
    const m = map[status] || map.no;
    return (
        <span className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${m.cls}`}>
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
/* DECISION Phase 88-20 (Req 15): ONE exported gate for the guest-invite affordance,
   called from BOTH surfaces that render it — chosen OVER inlining the same three-part
   test at each call site, which is exactly how the two drift apart and how a leak on
   one surface survives a walkthrough of the other (the F-6d lesson from 88-11's split
   role gate, one screen over in this same file).

   The custom-guest branch is EXPLICIT rather than implicit: a participant with a null
   `user_id` is a name someone typed into a session, not an account, so there is nobody
   to send a group invite to. Falling through to a disabled button or a "Retry" would be
   worse than rendering nothing — it implies an action exists. Removing this check would
   dispatch an invite against a non-account record (T-88-20-02). */
function canInviteGuest(participant, viewerRole) {
    // Client-side gate only — mirrors the backend authz on the invite route, which is
    // what actually enforces it (T-88-20-01). No new endpoint, no new payload shape.
    if (viewerRole !== 'owner' && viewerRole !== 'admin') return false;
    if (!participant?.is_guest) return false;
    return !!participant.user_id;
}

// Phase 88-20 (Req 15): `canInvite` / `groupId` carry the guest-invite affordance
// onto the chip. The gate is computed by `canInviteGuest` at the call site rather
// than re-derived here, so the chip and the See-all row cannot disagree.
function ParticipantChip({ participant, rsvpStatus, role, isBringing, viewerScope, canInvite, groupId }) {
    const isCustom = !!participant.is_custom;
    return (
        <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border border-line bg-surface-card text-xs max-w-full">
            <span className="font-medium text-content-primary truncate">
                {isCustom ? (
                    <>{participant.username || 'Guest'}<span className="text-content-muted ml-1">(Guest)</span></>
                ) : (
                    participant.username || 'Unknown'
                )}
            </span>
            <RsvpStatusPill status={rsvpStatus} />
            {role === 'owner' && (
                <span className="text-[10px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1 rounded-sm font-semibold">Owner</span>
            )}
            {role === 'admin' && (
                <span className="text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1 rounded-sm font-semibold">Admin</span>
            )}
            {participant.is_guest && viewerScope === 'group-member' && (
                <span
                    className="text-[10px] uppercase tracking-wide rounded-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50 px-1 py-0.5"
                    title="Joined via game-invite QR (not a group member)"
                >
                    Guest
                </span>
            )}
            {isBringing && (
                <span title="Bringing a game" aria-label="Bringing a game">🎲</span>
            )}
            {canInvite && (
                <GuestInviteButton groupId={groupId} userId={participant.user_id} />
            )}
        </span>
    );
}

function GuestInviteButton({ groupId, userId }) {
    // null | 'sending' | 'sent' | 'pending' | 'member' | 'already' | 'error'
    const [status, setStatus] = useState(null);

    const handleInvite = async () => {
        setStatus('sending');
        try {
            // Invite by participant user_id — the guest's email is resolved
            // server-side (83-06 PII default-deny stripped it from the client). [83.3 SEAM-01]
            await invitesAPI.sendParticipantInvite(groupId, userId);
            setStatus('sent');
        } catch (err) {
            /* DECISION Phase 88-33 Task 2 step 4b (UAT row 614, Fork F): the two 409 outcomes are
               told APART — chosen OVER the shipped single "Already invited" collapse, which said
               the same thing whether the person was already a member (nothing to do, ever) or had
               an invite in flight (they just have not answered yet).

               Branches on the BE envelope `code` from 88-34's ERROR_REGISTRY, with a STRING
               fallback that stays live until that backend change merges — production will keep
               sending code-less 409s until then, so removing the string branch before the merge
               silently reverts this to the generic error state. The bare `status === 409` arm below
               remains the final safety net. */
            const code = err?.code;
            const message = String(err?.message || '').toLowerCase();
            if (code === 'already_member' || (!code && message.includes('already a member'))) {
                setStatus('member');
            } else if (code === 'invite_pending' || (!code && message.includes('pending invite'))) {
                setStatus('pending');
            } else if (err?.status === 409) {
                // 409 with no recognisable code — terminal either way, so never "Retry".
                setStatus('already');
            } else {
                setStatus('error');
            }
        }
    };
    const settled = status === 'sent' || status === 'pending' || status === 'member' || status === 'already';

    return (
        <button
            onClick={handleInvite}
            disabled={status === 'sending' || settled}
            /* DECISION Phase 88-27 (D-32 buckets A/B/C): base keeps the neutral, branches override
               it — same call, same measured cascade fact, as the marker at ParticipantRow.js:204.
               `.border-status-*` is emitted after `.border-line` in the built stylesheet, and there
               is no tailwind-merge on this template literal. */
            className={`text-xs px-2 py-0.5 rounded-sm border border-line transition-colors ${
                status === 'sent'
                    ? 'bg-status-success-subtle border-status-success text-status-success'
                    : status === 'pending' || status === 'member' || status === 'already'
                        ? 'text-content-muted border-line bg-surface-page'
                        : status === 'error'
                            ? 'bg-status-error-subtle border-status-error hover:bg-status-error-subtle-hover text-status-error'
                            : 'hover:bg-surface-card-hover text-content-link'
            }`}
            title={
                status === 'sent'
                    ? 'Invite sent!'
                    : status === 'pending'
                        ? 'They already have an invite waiting — nothing more to send'
                        : status === 'member'
                            ? 'They are already in this group'
                            : status === 'already'
                                ? 'This guest is already invited or a member'
                                : 'Invite this guest to join the group'
            }
        >
            {status === 'sending' && 'Sending...'}
            {status === 'sent' && 'Invite sent!'}
            {status === 'pending' && 'Invite pending'}
            {status === 'member' && 'Already a member'}
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
    const [gameError, setGameError] = useState(null);
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
    // 88-33 Task 5 (fork 7): the hand-rolled removeConfirmingId/timer pair that lived here
    // is gone — the see-all Remove now rides `removeParticipantGate` (useConfirmAction,
    // two-tap tier) below, which owns the armed id, the 3s revert timer, and its cleanup.
    // The 65-02 EVT-08 two-tap INTERACTION is unchanged; see the amended marker at the
    // handler site.

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

    // Tracks which entity the page last finished loading, so the selfUuid dep
    // re-run below (identity resolving AFTER the first fetch) refreshes data
    // WITHOUT flashing the whole page back to the full loading state. A real
    // param change (different game/event) still gets the full loading screen.
    const loadedEntityKeyRef = useRef(null);
    const entityKey = `${game_id}|${group_id}|${event_id}`;

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
        // Identity-only re-run (selfUuid resolved after first load of the SAME
        // event): refresh in place — no full-page loading flash (#1/#18).
        if (loadedEntityKeyRef.current !== entityKey) setLoading(true);
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
                // by the nested User.id UUID for the strip + See-all chips (D-04).
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
            loadedEntityKeyRef.current = entityKey;
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

    // (88-33 Task 5: the 65-02 "clean up the second-click confirm timer on unmount"
    // effect that lived here is gone with the hand-rolled timer — useConfirmAction
    // performs the same unmount cleanup internally, absorbed from KebabMenu.js:63-71.)

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
            /* DECISION Phase 88-25 (Req 14 / T-88-25-01): failure copy is DERIVED from
               `ApiError.code` via getFetchErrorMessage, chosen OVER the `err.message || '…'`
               idiom every toast on this page used. `ApiError.message` is whatever the backend
               sent — down to a literal `HTTP error! status: 500` when a route returns no body
               (api.ts extractErrorMessage) — so the shipped idiom painted raw upstream text at
               the user. Same ASVS V7 ruling 88-19 applied to `ErrorFallback`. See the marker on
               getFetchErrorMessage for why this is a mechanism and not a string sweep. */
            toast.error(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't cancel this event. Please try again.",
                    byCode: { forbidden: 'Only group owners and admins can cancel an event.' },
                })
            );
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
            toast.error(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't take you off this event. Please try again.",
                })
            );
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
            toast.error(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't build the share code. Please try again.",
                })
            );
        } finally {
            setQrLoading(false);
        }
    };

    /* DECISION Phase 88-33 Task 5 (fork 7, RULED 2026-08-17) — AMENDMENT, D-39 house style.
       The hand-rolled second-click handler below is CONVERGED onto `useConfirmAction`
       (two-tap tier): the hook now owns the armed id, the 3s revert window, cross-target
       re-arm safety and the SR announcement; the divergent click-again armed copy this
       control carried (deliberately not spelled out here, so a convergence gate cannot
       match this comment) converges onto the fleet default. The 65-02 EVT-08 INTERACTION — an inline
       second click, never a modal — is preserved exactly; only the implementation moved.
       Reopened by: owner walk 2026-08-13 (affordance-prominence rows) -> fork 7 ruling
       2026-08-17. ORIGINAL MARKER, verbatim: "Phase 65-02 EVT-08 frontend:
       second-click-confirm Remove handler. First click arms a 3s revert timer. Second
       click within the window calls eventsAPI.removeParticipation (Plan 65-01 backend)
       which hard-destroys the EventParticipation row and writes an audit-log row; a
       subsequent QR re-join is silent (no welcome email) per EVT-08."
       Re-hand-rolling this, or promoting it to a ConfirmDialog, is a decision, not a
       cleanup. */
    const performRemoveParticipation = async (targetUserDbId) => {
        // targetUserDbId is User.id (UUID) post-flatten — the value the DELETE
        // endpoint expects. Custom participants have user_id === null and the
        // Remove button is hidden for them at render time.
        if (!targetUserDbId) return;
        try {
            await eventsAPI.removeParticipation(singleEvent.id, targetUserDbId);
            // Optimistically drop the row. No toast (per CONTEXT decision).
            setParticipants(prev => prev.filter(p => p.user_id !== targetUserDbId));
        } catch (err) {
            console.error('Failed to remove participant:', err);
            toast.error(
                getFetchErrorMessage(err, {
                    fallback: "We couldn't remove them from this event. Please try again.",
                    byCode: { forbidden: 'Only group owners and admins can remove someone.' },
                })
            );
        }
    };

    // Two-tap tier (fork 7): persistent inline row button, so D-07's auto-closing-menu
    // limit does not bite. Dialog-tier copy authored anyway (superset config) so a
    // retier stays the one-word edit.
    const removeParticipantGate = useConfirmAction({
        tier: 'two-tap',
        title: 'Remove this participant?',
        body: 'They are removed from this event for everyone. A QR re-join is silent.',
        confirmLabel: 'Remove',
        onConfirm: (targetUserDbId) => performRemoveParticipation(targetUserDbId),
    });

    const fetchGameData = async () => {
        if (!game_id) return;
        setGameError(null);

        // Identity-only re-run (selfUuid resolved after first load of the SAME
        // game): refresh in place — no full-page loading flash (#1/#18).
        if (loadedEntityKeyRef.current !== entityKey) setLoading(true);
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
                //
                // 88-33 Task 7 step 1c (owner-ruled 2026-08-20): the fan-out is
                // scoped to the UPCOMING partition only — history cards render the
                // session record without RSVP/ballot UI (see the DECISION marker at
                // the history render), so fetching per-event RSVP for all history
                // was an N+1 over deep history with zero readers (r1#15/r3#18).
                // Same partition predicate as the render's useMemo split.
                const rsvpFanoutNow = new Date();
                const upcomingGameEvents = gameEvents.filter(evt =>
                    evt.status !== 'cancelled' &&
                    evt.start_date &&
                    new Date(evt.start_date) > rsvpFanoutNow
                );
                if (selfUuid && upcomingGameEvents.length > 0) {
                    const rsvpStatusMap = {};
                    await Promise.all(upcomingGameEvents.map(async (evt) => {
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
                // The 3rd arg is the caller's own identity (is-me review marker):
                // send selfUuid. This runs inside the selfUuid-keyed fetch effect
                // (deps at L303), so it re-fires with the resolved UUID once
                // identity lands; before then it sends null (is-me indeterminate).
                const reviewsData = await gameReviewsAPI.getGameReviews(game_id, group_id, selfUuid || null);
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
            /* DECISION Phase 88-25 (Req 14 / T-88-25-02): a failed load is TRACKED and rendered as
               the shared fetch-error treatment, chosen OVER the silent `console.error` this
               shipped with. `game` stays null after a swallowed failure, so the render fell
               through to the "Game not found" dead end below — a 500 or a dropped connection was
               reported to the person as a definitive statement that the game does not exist, with
               no retry and only a back-link. Empty and failed are different facts (UI-SPEC 9.2);
               a `not_found` code still reaches the not-found branch, which is the one case where
               that copy is TRUE.

               Keep the ERROR object, not a flattened string: useFetchErrorState reads
               `ApiError.code` off it. */
            setGameError(
                error instanceof Error ? error : new Error("The game request didn't complete.")
            );
        } finally {
            loadedEntityKeyRef.current = entityKey;
            setLoading(false);
        }
    };

    /* Adapter onto the shared fetch-error pair, matching the shipped 88-14/88-18 shape. `refetch`
       must be STABLE — the hook puts it in a useCallback dep AND in its refocus-recovery effect
       deps — and `fetchGameData` is re-declared every render, hence the ref hop. */
    const fetchGameDataRef = useRef(null);
    useEffect(() => {
        fetchGameDataRef.current = fetchGameData;
    });
    const retryGameData = useCallback(() => fetchGameDataRef.current?.(), []);
    const gameErrorState = useFetchErrorState({
        isError: Boolean(gameError),
        error: gameError,
        refetch: retryGameData,
    });

    // Runs ONLY after the dialog gate below has been explicitly confirmed.
    const performDeleteEvent = async (event_id) => {
        try {
            await eventsAPI.deleteEvent(event_id);
            // Refresh events after deletion
            fetchGameData();
        } catch (error) {
            console.error('Error deleting event:', error);
            // The shipped copy stated the owner/admin rule unconditionally, so a network blip
            // was reported as a permissions problem. It is now the `forbidden` branch only.
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't delete this session. Please try again.",
                    byCode: { forbidden: 'Only group owners and admins can delete a session.' },
                })
            );
            // Re-thrown so the gate stays OPEN on failure (useConfirmAction's
            // contract) — swallowing it here would close the dialog and read as
            // "deleted" when the DELETE was refused.
            throw error;
        }
    };

    /* DECISION Phase 88-11 (D-09/D-40, Req 11, UI-SPEC §11.2): session delete is on the
       DIALOG tier, replacing the native browser confirm that shipped here. (The literal
       call is not written out anywhere in this file, comment included — Req 11's CI gate is
       a plain grep and does not exempt comments.) Chosen OVER two-tap,
       which is the cheaper gate and is what the phone affordance's host (KebabMenu) already
       supports: a play record is SHARED data — the scores and who was there vanish for
       everyone, which is a consequence the label "Delete" cannot convey, and D-09's rule
       ("does it need explaining?") therefore puts it on a dialog. The kebab additionally
       cannot host two-tap at all (D-07: the menu unmounts the armed trigger). Retiering this
       is a one-word edit by design — but it is a decision, not a simplification. */
    const deleteSessionGate = useConfirmAction({
        tier: 'dialog',
        title: 'Delete this session?',
        body: 'The play record, scores and who was there are deleted for everyone.',
        confirmLabel: 'Delete',
        onConfirm: (event_id) => performDeleteEvent(event_id),
    });

    const handleDeleteEvent = (event_id) => {
        if (!user?.sub) return;
        deleteSessionGate.trigger(event_id);
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
        // D-02 guard-before-write: the review body sends selfUuid, so fail loud
        // (no send) if identity has not resolved rather than posting a stale sub.
        if (!user?.sub || !game_id || !group_id) return;
        if (!selfUuid) {
            // ML-02/ML-03 pattern: identity still resolving is user-recoverable —
            // tell them instead of silently swallowing the submit click.
            toast.error('Still loading your account — please try again in a moment.');
            return;
        }

        // CLIENT-side validation is checked BEFORE the try. It used to `throw` into the same
        // catch that handled the network failure, so its own message reached the user only via
        // the `error.message` interpolation this plan removed — moving it out is what lets the
        // catch stop interpolating without losing a real, locally-authored message.
        const ratingValue = parseFloat(reviewForm.rating);
        if (isNaN(ratingValue) || ratingValue < 0 || ratingValue > 5) {
            toast.error('Pick a rating between 0 and 5 stars.');
            return;
        }

        try {
            // Round to nearest 0.5 increment
            const roundedRating = Math.round(ratingValue * 2) / 2;

            // Use gameReviewsAPI.submitReview which automatically includes Authorization header
            const data = await gameReviewsAPI.submitReview({
                user_id: selfUuid,
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
            toast.error(
                getFetchErrorMessage(error, {
                    fallback: "We couldn't save your review. Please try again.",
                })
            );
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

    /* DECISION Phase 88-33 Task 7 step 1b (fork G, owner-ruled 2026-08-20; supersedes fork B's
       filter-out mechanism): the mixed-route events SPLIT into an Upcoming section (rendered
       ABOVE Game Sessions, RSVP/Ballot/BringSummary intact) and a history-only Game Sessions
       list — chosen OVER (a) filtering the shared per-event map down to history-only, which
       would have silently deleted the game view's ONLY interactive RSVP/voting/bring UI for
       future events (those components render inside this map; the only other mount is the
       event_id view), and OVER (b) a BE-side filter, rejected because the shared route also
       feeds RSVP/Ballot, which need future events. Owner's words: "upcoming games should be at
       the top in their own section, then a history section of all the previous games played."
       Memoized: this is a ~2500-line component — an inline sort/partition on every render is a
       churn hazard (r2/r3 triage). Partition contract matches 88-34 Task 2's BE sweep:
       upcoming = start_date > now && status !== 'cancelled'; history = start_date <= now &&
       status !== 'cancelled', sorted start_date DESC. Collapsing the two sections back into
       one filtered list is a decision, not a cleanup. */
    const { upcomingEvents, historyEvents } = useMemo(() => {
        const now = new Date();
        const upcoming = [];
        const history = [];
        for (const evt of events) {
            if (evt.status === 'cancelled') continue;
            if (evt.start_date && new Date(evt.start_date) > now) upcoming.push(evt);
            else history.push(evt);
        }
        upcoming.sort((a, b) => new Date(a.start_date) - new Date(b.start_date));
        history.sort((a, b) => new Date(b.start_date) - new Date(a.start_date));
        return { upcomingEvents: upcoming, historyEvents: history };
    }, [events]);

    // Filter and sort events — the user-facing filters apply to the HISTORY
    // partition only (Game Sessions is history-only post-split; the Upcoming
    // section has no filters).
    useEffect(() => {
        let filtered = [...historyEvents];
        
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
    }, [historyEvents, filters]);

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

    // Shared per-event card renderer for the Upcoming and Game Sessions sections
    // (88-33 Task 7 step 1b — the card is defined ONCE; `interactive` controls
    // whether the RSVP/Ballot/BringSummary surfaces mount, see the marker there).
    const renderSessionCard = (event, index, { interactive }) => (
                            <div key={event.id} className={`pl-4 py-2 ${index > 0 ? 'border-t-2 border-line-strong pt-4' : ''}`} style={{ borderLeft: '4px solid var(--color-btn-primary-bg)' }}>
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
                                                        <ClickableMemberName userId={event.Winner.id} username={event.Winner.username || 'Unknown'} />
                                                    )}
                                                </span>
                                            </p>
                                        )}
                                        {event.comments && (
                                            <p className="text-content-secondary mt-1 text-sm italic">{event.comments}</p>
                                        )}
                                    </div>
                                    {/* DECISION Phase 88-11 (D-40, F-6c/F-6d): ONE role gate wraps BOTH
                                        breakpoint renderings — chosen OVER duplicating the
                                        `userRole === 'owner' || userRole === 'admin'` test inside each
                                        branch. Splitting the gate is what lets the two drift, and a
                                        phone-only leak would be invisible to a desktop walkthrough; the
                                        gate must keep mirroring the backend's owner/admin 403 on
                                        PUT/DELETE /events/:id for both. Collapsing the two renderings
                                        back into one always-visible cluster is a decision, not a
                                        cleanup — the solid primary/danger pair is exactly the hierarchy
                                        inversion F-6c recorded. */}
                                    {(userRole === 'owner' || userRole === 'admin') && (
                                        <>
                                            {/* Phone: collapse both actions into the shipped kebab,
                                                matching ScheduleList/ManageMembers, so the date, winner
                                                and comment reclaim the full row width (F-6d). */}
                                            <div className="md:hidden">
                                                <KebabMenu
                                                    ariaLabel="Session actions"
                                                    items={[
                                                        {
                                                            label: 'Edit',
                                                            onClick: () => handleEditEvent(event),
                                                        },
                                                        {
                                                            label: 'Delete',
                                                            onClick: () => handleDeleteEvent(event.id),
                                                            danger: true,
                                                            // D-40 + D-07: explicitly NOT the two-tap tier.
                                                            // The menu unmounts the armed item on the first
                                                            // click, so the second tap could never reach it —
                                                            // this Delete routes to the dialog tier instead.
                                                            twoTap: false,
                                                        },
                                                    ]}
                                                />
                                            </div>
                                            {/* Desktop: still visible, demoted to ghost so they stop
                                                outranking the plain-text content they act on (F-6c). */}
                                            <div className="hidden md:flex gap-2 shrink-0">
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => handleEditEvent(event)}
                                                    className="px-3 py-1 text-sm"
                                                    title="Edit this session"
                                                >
                                                    Edit
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    onClick={() => handleDeleteEvent(event.id)}
                                                    className="px-3 py-1 text-sm"
                                                    title="Delete this session"
                                                >
                                                    Delete
                                                </Button>
                                            </div>
                                        </>
                                    )}
                                </div>
                                {event.EventParticipations && event.EventParticipations.length > 0 && (
                                    <div className="text-sm mt-3 pt-2 border-t border-line">
                                        <p className="font-semibold mb-2 text-content-primary">Participants:</p>
                                        <div className="space-y-2">
                                            {event.EventParticipations.map((participation, idx) => (
                                                <div key={idx} className="flex items-center gap-2 flex-wrap">
                                                    <span className="bg-surface-card-hover text-content-primary px-3 py-1 rounded-sm border border-line inline-flex items-center gap-2">
                                                        <span className="font-medium">
                                                            {participation.is_custom ? (
                                                                <>{participation.User?.username || participation.username || 'Unknown'}<span className="text-xs text-content-muted ml-1">(Guest)</span></>
                                                            ) : (
                                                                // Phase 87.3-06: SANCTIONED flat read. Past-events participation
                                                                // rows come through formatEventWithCustomParticipants (events.js),
                                                                // which replaces EventParticipations with flat entries
                                                                // `{ user_id: ep.User?.id }` — already the Users.id UUID, with NO
                                                                // nested User to source from. The dead `participation.User?.user_id`
                                                                // prefix is dropped; `participation.user_id` here is UUID-keyed
                                                                // (unlike every other flat user_id site) and is allowlisted in the
                                                                // plan-06 residue grep.
                                                                <ClickableMemberName userId={participation.user_id} username={participation.User?.username || participation.username || 'Unknown'} />
                                                            )}
                                                        </span>
                                                        {participation.is_guest && (
                                                            <span className="text-xs bg-orange-100 text-orange-800 px-1.5 py-0.5 rounded-full font-medium">
                                                                Guest
                                                            </span>
                                                        )}
                                                        {participation.is_new_player && (
                                                            <span className="text-xs bg-surface-card-hover text-content-link px-1.5 py-0.5 rounded-sm font-semibold">
                                                                New Player
                                                            </span>
                                                        )}
                                                        {participation.faction && (
                                                            <span className="text-xs bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-sm">
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
                                {/* DECISION Phase 88-33 Task 7 step 1c (owner-ruled 2026-08-20, resolving
                                    triage A2 as a FIX): HISTORY cards are pure session records —
                                    RsvpSection/BallotSection/BringSummary mount ONLY on
                                    Upcoming-partition cards (`interactive`). Chosen OVER rendering
                                    read-only RSVP/ballot strips on history: nobody consults RSVP
                                    intent after the night happened (owner: "I don't really care who
                                    RSVPed or not on games that has already happened. I only care who
                                    was there"), and fetching it for all history is the N+1 the
                                    scoped fan-out in fetchGameData kills at its cause. The event_id
                                    single-event view keeps its full record view (out of scope).
                                    Re-mounting these on history cards is a decision, not a
                                    consistency cleanup. */}
                                {interactive && (
                                    <>
                                        {/* RSVP Section - interactive for future events */}
                                        <RsvpSection
                                            key={`${event.id}-${rsvpRefreshKey}`}
                                            eventId={event.id}
                                            self={self}
                                            eventDate={event.start_date}
                                            onRsvpChange={(status) => {
                                                const prevStatus = eventRsvpStatuses[event.id];
                                                setEventRsvpStatuses(prev => ({ ...prev, [event.id]: status }));
                                                // NO rsvpByUserId patch here: that map is
                                                // single-event data (fetched/read only by the
                                                // event view's strip + See-all) — a per-user
                                                // write from the multi-event view would flatten
                                                // per-event state into a map with no event
                                                // dimension (plan-10 review #2).
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
                                    </>
                                )}
                            </div>
    );

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
            /* DECISION Phase 88 (DEF-88-24-01, owner ruling 2026-08-05): `p-3 md:p-6`, moved
               together with the game-view wrapper below — the full rationale lives at that
               site. Both branches of this ONE route were bare `p-6`; converging only the one
               the deferral happened to cite by line number would have made the phone gutter
               depend on whether the URL carried a game_id, which nobody would read as
               intentional. This is also the branch `/gameDetail?event_id=…&group_id=…`
               actually renders, so it is the one the padding-budget e2e loads. */
            <div className="p-3 md:p-6 max-w-6xl mx-auto">
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

                {/* DECISION Phase 88-24 (SPEC Req 2, owner ruling 2026-08-05 = option-a):
                    the `p-3 md:p-6` on the `.card` below — and on all 28 `.card` call sites
                    app-wide — is DELIBERATELY RETAINED, not leftover. Req 2's wording is
                    "`.card` padding overrides removed or promoted to explicit card variants";
                    read as "delete the `p-*`" it does the OPPOSITE of what it intends.

                    Why: `.card` is a layered `@utility` (globals.css, `DECISION Phase 87.8
                    (D-01)`) that declares its own `padding: 1.5rem`. 87.8 moved it to
                    `@utility` PRECISELY so a consumer's padding utility wins. So deleting the
                    `p-3 md:p-6` here does not "clean up" anything — it silently restores 24px
                    at phone width, DOUBLE the ratified 12px top-level-card rung, on every card
                    at once, and blows `e2e/padding-budget.spec.ts`'s <=75px phone budget.

                    Chosen OVER two alternatives: (a) deleting the overrides and re-tuning
                    `@utility card`'s own padding to `0.75rem` + a `md` variant — rejected
                    because `@utility` cannot express a breakpoint without duplicating the
                    block, and it would move every card in one unreviewable step; (b) leaving
                    the three shipped idioms (`p-3 md:p-6`, `p-4 md:p-6`, bare `p-6`) alone —
                    rejected by the owner on 2026-08-05, who accepted the visible ~12px phone
                    tightening on the bare-`p-6` cards in exchange for one idiom app-wide.

                    Removing this utility is a DECISION (it changes rendered padding), not a
                    cleanup. `padding-budget.spec.ts` now covers this surface so the regression
                    fails CI rather than shipping. */}
                <div className="card p-3 md:p-6 mb-6">
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
                            <div className="relative shrink-0" ref={actionsMenuRef}>
                                <button
                                    type="button"
                                    onClick={() => setShowActionsMenu(prev => !prev)}
                                    className="text-2xl text-content-muted hover:text-content-primary px-2 py-1 leading-none rounded-sm hover:bg-surface-card-hover transition-colors"
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
                    <div className="card p-3 md:p-6 mb-6">
                        <div className="flex items-center justify-between gap-3 mb-3">
                            <h2 className="text-xl font-bold text-content-primary">
                                Participants ({participants.length})
                            </h2>
                            {userScope === 'group-member' && (
                                <button
                                    type="button"
                                    onClick={handleShowGameQR}
                                    disabled={qrLoading}
                                    className="btn btn-secondary text-xs px-3 py-1.5 inline-flex items-center gap-1.5 shrink-0"
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
                            {participants.slice(0, 5).map((p, idx) => {
                                const member = p.user_id ? groupMembersByUserId[p.user_id] : null;
                                // Phase 87.3-04: derive the member DB UUID (not the
                                // sub) and look up the RSVP chip on the UUID-keyed map.
                                const memberUuid = member?.id;
                                const role = member?.UserGroup?.role;
                                const status = memberUuid ? rsvpByUserId[memberUuid] : null;
                                const isBringing = p.user_id && bringersSet.has(p.user_id);
                                return (
                                    /* DECISION Phase 88-33 Task 2 (UAT row 520): keyed on the
                                       EventParticipation row id, chosen OVER the shipped
                                       `p.user_id || custom-${p.username}` fallback. Two guests may
                                       legitimately share a display name (fork 3 RULED duplicates
                                       allowed, and the backend accepts them), and the name-derived
                                       key made React duplicate/omit rows outright. Reverting to a
                                       name key is a decision to re-break same-named guests. */
                                    <ParticipantChip
                                        key={p.id ?? p.user_id ?? `row-${idx}`}
                                        participant={p}
                                        rsvpStatus={status}
                                        role={role}
                                        isBringing={isBringing}
                                        viewerScope={userScope}
                                        /* Req 15: the invite lives on the STRIP as well as
                                           the See-all modal, deliberately. The modal alone
                                           would not close the dead end — "See all" only
                                           renders past 5 participants, so a 4-person game
                                           night with a guest would still have nowhere to
                                           click. The strip alone would strand guests 6+.
                                           Dropping either surface re-opens the gap for one
                                           half of the events on the app. */
                                        canInvite={canInviteGuest(p, userRole)}
                                        /* effectiveGroupId, NOT the URL group_id: this view
                                           is reachable as a bare /gameDetail?event_id=X (old
                                           QR "Go to event" links), where group_id is null and
                                           the id is derived from the event response. */
                                        groupId={effectiveGroupId}
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
                            // Keep the participant-strip / See-all chips in sync
                            // with the caller's own RSVP — rsvpByUserId is what
                            // they read, and it otherwise stays stale until a
                            // full refetch. Gate on selfUuid per the D-04 async-
                            // resolution rule: unresolved = indeterminate, skip;
                            // the next refetch reconciles.
                            if (selfUuid) {
                                setRsvpByUserId(prev => ({ ...prev, [selfUuid]: status }));
                            }
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
                    <div className="card p-3 md:p-6 mt-6">
                        <h2 className="text-xl font-bold text-content-primary mb-1">Recommended Games</h2>
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
                {/* DECISION Phase 88-20 (SPEC Req 9): hosted on the shared <Modal>. The
                    hand-rolled backdrop + `stopPropagation` pair is DELETED rather than
                    ported — Modal owns outside-dismiss, and with it this list finally gets
                    the focus trap, Esc and focus-restore it never had. The nameless close
                    glyph goes with it: <Modal.Header> renders its own labelled Close
                    (SPEC Req 4), so porting the old one would ship two.

                    The `{showAllParticipants && …}` guard is dropped rather than kept beside
                    `open=`: two sources of truth for one dialog's open-ness is how a later
                    edit changes one and not the other. Radix renders nothing when closed.

                    `max-h-[60vh]` on the inner scroller is DROPPED, not preserved: the
                    content surface is already capped at 90vh and <Modal.Body> is the fleet's
                    single scrolling region, so a second inner cap would leave this list
                    shorter than every other migrated modal for no reason. `space-y-2` moves
                    onto the Body; the `-mx-1 px-1` bleed went with the hand-padded shell it
                    was compensating for.

                    THE PHASE 65-02 EVT-08 TWO-TAP REMOVE RENDERS INSIDE THIS LIST AND IS
                    UNCHANGED — see its handler marker further up. It is now inside a focus
                    trap, which is where it always should have been. Promoting it to a
                    ConfirmDialog because it happens to sit in a dialog now would re-open an
                    owner ruling: the inline second click IS the friction, and a modal on top
                    of a modal is worse on a phone. That is a decision, not a cleanup.

                    88-33 Task 5 amendment (fork 7): "UNCHANGED" now refers to the
                    INTERACTION — the implementation converged onto useConfirmAction
                    (see the amended handler marker); it is still an inline second
                    click, never a modal. */}
                <Modal open={showAllParticipants} onClose={() => setShowAllParticipants(false)}>
                    <Modal.Header>Participants ({participants.length})</Modal.Header>
                    <Modal.Body className="space-y-2">
                        {participants.map((p, idx) => {
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
                            // Req 15: same gate object the strip chip uses, so the two
                            // surfaces cannot disagree about who is invitable.
                            const canInvite = canInviteGuest(p, userRole);
                            // 88-33 Task 5 (fork 7): armed state now comes from the gate.
                            const isConfirming = removeParticipantGate.isArmed(p.user_id);
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
                                    /* Row-id key — see the DECISION marker on the strip's
                                       ParticipantChip above (88-33 Task 2, UAT row 520). */
                                    key={p.id ?? p.user_id ?? `row-${idx}`}
                                    /* 88-33 Task 6 layout (fork 2 / UAT rows 390+573, folded per the
                                       row's own routing note): `flex-wrap` lets the action cluster
                                       DROP TO ITS OWN ROW when the name is long — so an armed
                                       two-tap's wider label pushes the buttons down instead of
                                       squeezing the name into truncation. */
                                    className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 rounded-sm border border-line bg-surface-card"
                                >
                                    {/* INLINE flow (not flex): pills ride after the LAST WORD of the
                                        name like text; the name wraps IN FULL — display never
                                        truncates a person's name (fork 2's agreed direction). */}
                                    <div className="min-w-0 flex-1 basis-48 space-x-1.5 break-words">
                                        <span className="font-medium text-content-primary">
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
                                            <span className="align-middle text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-200 px-1.5 py-0.5 rounded-sm font-semibold">
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
                                            <span className="hidden md:inline-flex items-center align-middle text-[10px] uppercase tracking-wide bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-200 px-1.5 py-0.5 rounded-sm font-semibold">
                                                Friend
                                            </span>
                                        )}
                                        {role === 'owner' && (
                                            <span className="align-middle text-[10px] uppercase tracking-wide bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-sm font-semibold">Owner</span>
                                        )}
                                        {role === 'admin' && (
                                            <span className="align-middle text-[10px] uppercase tracking-wide bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-sm font-semibold">Admin</span>
                                        )}
                                        {/* Phase 71.1 GAMP-12: render Guest badge for is_guest=true rows
                                            when viewer is a full group member. Skips render for game-only
                                            viewers (they are guests themselves; redundant on their own row,
                                            and on co-attendee rows the badge isn't load-bearing for their
                                            flow). Tells admins/owners who joined via game-invite QR so they
                                            can decide who to onboard via admin-initiated invite. */}
                                        {p.is_guest && userScope === 'group-member' && (
                                            <span
                                                className="inline-flex items-center align-middle px-1.5 py-0.5 text-[10px] uppercase tracking-wide rounded-sm bg-amber-100 dark:bg-amber-900/30 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-800/50"
                                                title="Joined via game-invite QR (not a group member)"
                                            >
                                                Guest
                                            </span>
                                        )}
                                        {isBringing && (
                                            <span title="Bringing a game" className="text-sm" aria-label="Bringing a game">🎲</span>
                                        )}
                                    </div>
                                    {(canInvite || canRemove) && (
                                    /* ml-auto: stays right-aligned when it drops to its own row. */
                                    <div className="flex items-center gap-2 shrink-0 ml-auto">
                                        {/* Req 15: the invite sits BEFORE Remove, not after.
                                            Both act on the same guest row, and putting the
                                            constructive action first keeps the destructive
                                            one at the outer edge where the two-tap expects
                                            it — swapping them puts "Remove" under the thumb
                                            that was reaching for "Invite". */}
                                        {canInvite && (
                                            <GuestInviteButton groupId={effectiveGroupId} userId={p.user_id} />
                                        )}
                                        {canRemove && (
                                            /* 88-33 Task 5 (fork 7): converged onto the gate —
                                               fleet armed copy via labelFor, 44px floor
                                               (min-h-11 — this control sat at ~26px), and
                                               destructive resting prominence (status-error
                                               box, was muted border-line). The accessible
                                               name names the TARGET, not a bare 'Remove'. */
                                            <button
                                                {...removeParticipantGate.triggerProps(
                                                    p.user_id,
                                                    p.username || 'this participant',
                                                    `Remove ${p.username || 'this participant'} from this event`
                                                )}
                                                className={`inline-flex min-h-11 items-center text-xs px-2 py-1 border rounded-sm transition-colors shrink-0 ${
                                                    isConfirming
                                                        ? 'bg-status-error-subtle border-status-error text-status-error font-semibold'
                                                        : 'border-status-error text-status-error hover:bg-status-error-subtle'
                                                }`}
                                            >
                                                {removeParticipantGate.labelFor(p.user_id, 'Remove')}
                                            </button>
                                        )}
                                    </div>
                                    )}
                                </div>
                            );
                        })}
                        {/* 88-33 Task 5: the armed-state live region MUST live INSIDE this
                            dialog — Radix aria-hides everything outside an open modal, so a
                            page-level mount would leave the two-tap arm silently
                            unannounced exactly where the control renders. Mounted after
                            the list, sr-only, empty-first (StatusRegion contract). */}
                        {removeParticipantGate.statusNode}
                    </Modal.Body>
                </Modal>

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
                    <p className="text-content-primary text-xl font-bold mb-2">Event not found</p>
                    <p className="text-content-secondary mb-6">This event no longer exists or has been cancelled.</p>
                    <Link href="/" className="text-content-link hover:underline">
                        ← Back to Home
                    </Link>
                </div>
            </div>
        );
    }

    /* DECISION Phase 88-25 (Req 14 / T-88-25-02): a FAILED game load is checked BEFORE the
       "Game not found" branch below. Ordering is load-bearing — a failed fetch also leaves `game`
       null, so flipping these tells someone whose request merely failed that the game does not
       exist, which is a false statement and a dead end with no retry. `not_found` is deliberately
       NOT routed here: a real 404 IS "Game not found", and that branch keeps the scope-aware
       back-link 71.1 GAMP-11 put there. */
    if (!game && gameErrorState.showError && gameErrorState.code !== 'not_found') {
        return (
            <div className="flex items-center justify-center min-h-screen">
                <div className="w-full max-w-md px-6">
                    <FetchErrorBanner
                        state={gameErrorState}
                        title="We couldn't load this game"
                        reportContext="Game detail page — game/session fetch"
                    />
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

        /* DECISION Phase 88 (DEF-88-24-01, owner ruling 2026-08-05): this page wrapper is
           `p-3 md:p-6`, NOT a bare `p-6`. Chosen OVER leaving the bare `p-6` that shipped
           here, and over loosening e2e/padding-budget.spec.ts's 75px ceiling.

           Why: at 375px a bare `p-6` spends 48px — 24 per side — before any card inside it
           has spent anything. With 88-24's `.card` convergence that put gameDetail's measured
           padding chain at a predicted 72 of the 75px budget, i.e. passing on 3px of headroom,
           on the app's busiest detail page. It was also the largest of four different page
           gutters shipping across four page wrappers (24 / 12 / 16 / 16). `p-3 md:p-6` is
           userProfile's wrapper verbatim and the ratified 12px phone / 24px desktop rung, so
           this converges rather than inventing a fifth value. Desktop geometry is unchanged.

           88-24 deliberately did NOT make this change — it is not a `.card` site, so it sat
           outside that plan's charter and outside the owner's Task 1 ruling, and it is a
           VISIBLE 12px phone change. It was escalated as DEF-88-24-01 and the owner ruled:
           "You can correct the padding." The sibling wrapper on the event-only branch above
           carries the same value for the same reason — the two must move together or one
           gameDetail URL renders a 24px gutter and another a 12px one.

           Restoring `p-6` is a DECISION (it re-tightens the budget to ~72/75 and re-splits the
           two branches), not a cleanup. */
        <div className="p-3 md:p-6 max-w-6xl mx-auto">
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

            {/* Game Details */}
            <div className="card p-3 md:p-6 mb-6">
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

                {/* Phase 65-03 EVT-05: "Plan a game night with this" CTA. Visible to
                    non-pending group members when group_id is in the URL. Opens the
                    CreateEvent modal pre-filled with the current game (and date if
                    ?date= is in the URL). */}
                {/* DECISION Phase 88-11 (D-38, F-6a): the CTA lives INSIDE the game card,
                    below BOTH the custom-game and BGG render branches — chosen OVER leaving
                    it right-aligned above the card (its shipped position), which read as an
                    unanchored floating control at 375px, and OVER a full-width-in-place fix,
                    which the owner rejected as the weaker of the two. Its placement AFTER
                    the `game.is_custom` ternary is load-bearing: moving it inside either
                    branch renders it twice for one game and never for the other. Relocating
                    it back above the card is a decision, not a cleanup. */}
                {group_id && userRole && userRole !== 'pending' && (
                    <div className="mt-6 pt-4 border-t border-line flex justify-end">
                        <button
                            type="button"
                            onClick={() => setShowCreateEvent(true)}
                            className="btn btn-primary min-h-11 w-full sm:w-auto px-6 py-2 text-base font-semibold"
                        >
                            Plan a game night with this
                        </button>
                    </div>
                )}
            </div>

            {/* Upcoming — fork G's split section (Task 7 step 1b): future events of this
                game render HERE with their interactive RSVP/Ballot/Bring surfaces; the
                Game Sessions card below is history-only. When the upcoming partition is
                empty the whole section is OMITTED rather than rendering an empty box
                (recorded choice — an "Upcoming (0)" shell would just push the history
                content down for nothing). */}
            {upcomingEvents.length > 0 && (
                <div className="card p-3 md:p-6 mb-6">
                    <h2 className="w-full text-xl leading-tight font-bold text-content-primary mb-4">
                        Upcoming ({upcomingEvents.length})
                    </h2>
                    <div className="space-y-0">
                        {upcomingEvents.map((event, index) => renderSessionCard(event, index, { interactive: true }))}
                    </div>
                </div>
            )}

            {/* Game Sessions */}
            <div className="card p-3 md:p-6 mb-6">
                {/* DECISION Phase 88-11 (D-39, F-6b): the count is CONDITIONAL — "(7)" at rest,
                    "(3 of 7)" only while a filter is actually hiding sessions. Chosen OVER the
                    shipped unconditional "N of M", which rendered "1 of 1" with no filter active
                    and spent ~10 characters of a 375px header line saying nothing. The "of" is
                    the signal that filtering is on; restoring it unconditionally removes that
                    signal. The header also stacks (`flex-col sm:flex-row`) so the title and the
                    ~150px filter button stop colliding at phone width. NOTE (updated 2026-08-05):
                    the Reviews header below has the same shape and WAS the one deliberate
                    non-convergence here. The owner reopened that exemption (DEF-88-24-02) and
                    converged it, so both headers are now 20/700 — the marker there records the
                    reopening. This marker's OWN subject (the conditional count and the stacking)
                    is untouched by that ruling and still stands. */}
                <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-4">
                    <h2 className="w-full text-xl leading-tight font-bold text-content-primary">
                        {/* Post-split (Task 7 step 1b): counts key on the HISTORY partition —
                            keying on raw `events` would show "3 of 5" with no filter active
                            whenever upcoming events exist. */}
                        Game Sessions ({filteredEvents.length === historyEvents.length
                            ? historyEvents.length
                            : `${filteredEvents.length} of ${historyEvents.length}`})
                    </h2>
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="btn btn-secondary min-h-11 w-full sm:w-auto px-4 py-2 text-sm font-medium flex items-center justify-center gap-2"
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
                        {/* DECISION Phase 88-24 (Req 2 / UI-SPEC §4.1): 16/700, NOT the
                            20/700 Heading role — chosen OVER the literal reading of Task 3's
                            "section headings and card titles -> text-xl", which is what a
                            later reader will "correct" this to. This h3 is nested INSIDE the
                            "Game Sessions" h2's card (:1742), so promoting it to 20px flattens
                            a real two-level hierarchy into one visual level. Same rung, same
                            reasoning, and deliberately the same VALUE as the sub-heading rung
                            88-19 established on userProfile (see that file's header marker) —
                            so the two busiest surfaces in the app agree. It had no explicit
                            size at all before this plan, which is why it reads as a
                            near-no-op diff; the WEIGHT is the change (§4.2 states 600 as a
                            prohibition and D-01 gives it exactly one home, the Button
                            primitive). */}
                        <h3 className="text-base font-bold text-content-primary">Filter & Sort Sessions</h3>
                        <button
                            onClick={clearFilters}
                            className="text-sm text-content-link hover:text-content-link-hover"
                        >
                            Clear All
                        </button>
                    </div>
                    
                    {/* DECISION Phase 88-20 (Req 1 / UI-SPEC §8.2 + DEF-88-10-01): all ten
                        session filters render through the `Input`/`SelectControl` PRIMITIVES
                        with NO size class of their own — chosen OVER swapping each shipped
                        `text-sm` for a local `text-base`, which reaches the same 16px today
                        and then drifts the moment someone "tidies" one control back down.
                        The primitive is the single place the iOS focus-zoom floor is written,
                        and it deliberately carries no breakpoint variant (see its own marker).
                        Ten controls at 12px on the app's busiest detail page were the
                        second-largest Req 1 cluster; every one of them zoomed the page on tap.

                        Each label is now `htmlFor`-associated to a matching control `id` —
                        these are the ten DEF-88-10-01 sites (a screen reader announced "edit
                        blank" for the whole panel, WCAG 4.1.2 A). Association is chosen OVER
                        an `aria-label` per control precisely because the visible text and the
                        accessible name then cannot drift apart. Do not re-inline a size class
                        here, and do not drop an `id`: both are decisions, not cleanups. */}
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                        {/* Date Range */}
                        <div>
                            <label htmlFor="session-filter-date-from" className="block text-xs font-medium text-content-secondary mb-1">From Date</label>
                            <Input
                                id="session-filter-date-from"
                                type="date"
                                value={filters.dateFrom}
                                onChange={(e) => handleFilterChange('dateFrom', e.target.value)}
                            />
                        </div>
                        <div>
                            <label htmlFor="session-filter-date-to" className="block text-xs font-medium text-content-secondary mb-1">To Date</label>
                            <Input
                                id="session-filter-date-to"
                                type="date"
                                value={filters.dateTo}
                                onChange={(e) => handleFilterChange('dateTo', e.target.value)}
                            />
                        </div>

                        {/* Player Filters */}
                        <div>
                            <label htmlFor="session-filter-player-won" className="block text-xs font-medium text-content-secondary mb-1">Player Won</label>
                            <Input
                                id="session-filter-player-won"
                                type="text"
                                value={filters.playerWon}
                                onChange={(e) => handleFilterChange('playerWon', e.target.value)}
                                placeholder="Player name..."
                            />
                        </div>
                        <div>
                            <label htmlFor="session-filter-player-picked" className="block text-xs font-medium text-content-secondary mb-1">Player Picked</label>
                            <Input
                                id="session-filter-player-picked"
                                type="text"
                                value={filters.playerPicked}
                                onChange={(e) => handleFilterChange('playerPicked', e.target.value)}
                                placeholder="Player name..."
                            />
                        </div>
                        <div>
                            <label htmlFor="session-filter-player-participated" className="block text-xs font-medium text-content-secondary mb-1">Player Participated</label>
                            <Input
                                id="session-filter-player-participated"
                                type="text"
                                value={filters.playerParticipated}
                                onChange={(e) => handleFilterChange('playerParticipated', e.target.value)}
                                placeholder="Player name..."
                            />
                        </div>

                        {/* Duration Filters */}
                        <div>
                            <label htmlFor="session-filter-min-duration" className="block text-xs font-medium text-content-secondary mb-1">Min Duration (min)</label>
                            <Input
                                id="session-filter-min-duration"
                                type="number"
                                value={filters.minDuration}
                                onChange={(e) => handleFilterChange('minDuration', e.target.value)}
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label htmlFor="session-filter-max-duration" className="block text-xs font-medium text-content-secondary mb-1">Max Duration (min)</label>
                            <Input
                                id="session-filter-max-duration"
                                type="number"
                                value={filters.maxDuration}
                                onChange={(e) => handleFilterChange('maxDuration', e.target.value)}
                                placeholder="∞"
                            />
                        </div>

                        {/* Player Count */}
                        <div>
                            <label htmlFor="session-filter-min-players" className="block text-xs font-medium text-content-secondary mb-1">Min Players</label>
                            <Input
                                id="session-filter-min-players"
                                type="number"
                                value={filters.minPlayers}
                                onChange={(e) => handleFilterChange('minPlayers', e.target.value)}
                                placeholder="0"
                            />
                        </div>

                        {/* Max Score */}
                        <div>
                            <label htmlFor="session-filter-min-score" className="block text-xs font-medium text-content-secondary mb-1">Min Score</label>
                            <Input
                                id="session-filter-min-score"
                                type="number"
                                step="0.01"
                                value={filters.maxScore}
                                onChange={(e) => handleFilterChange('maxScore', e.target.value)}
                                placeholder="0"
                            />
                        </div>

                        {/* Sort By */}
                        <div>
                            <label htmlFor="session-filter-sort-by" className="block text-xs font-medium text-content-secondary mb-1">Sort By</label>
                            <SelectControl
                                id="session-filter-sort-by"
                                value={filters.sortBy}
                                onChange={(e) => handleFilterChange('sortBy', e.target.value)}
                            >
                                <option value="date_desc">Date (Newest First)</option>
                                <option value="date_asc">Date (Oldest First)</option>
                                <option value="score_desc">Highest Score</option>
                                <option value="score_asc">Lowest Score</option>
                                <option value="duration_desc">Longest Duration</option>
                                <option value="duration_asc">Shortest Duration</option>
                            </SelectControl>
                        </div>
                    </div>
                </div>
                )}
                
                {displayedEvents.length > 0 ? (
                    <div className="space-y-0">
                        {/* DECISION Phase 87.7 (Plan 08, R5): the separator below carries NO top
                            margin, deliberately, and re-adding one is a visual change rather than a
                            fix. Under Tailwind v3 this className ended in an mt-4 that never
                            rendered: v3 emitted
                              .space-y-0>:not([hidden])~:not([hidden]) { margin-top: 0 }
                            at specificity (0,3,0), unlayered, which beat .mt-4's (0,1,0) and forced
                            the margin to 0 on every child after the first. v4 emits
                              :where(.space-y-0>:not(:last-child)) { margin-block: 0 }
                            — :where() contributes ZERO specificity, so the same .mt-4 now WINS and
                            each card after the first would gain 16px it never had. The mt-4 was
                            removed to keep this list rendering exactly as it did on v3 (R2). The
                            separator's visual weight comes from border-t-2 + pt-4, which is
                            unchanged and always did the work. Whether these cards SHOULD be spaced
                            further apart is a design question and belongs to Phase 88. */}
                        {displayedEvents.map((event, index) => renderSessionCard(event, index, { interactive: false }))}
                    </div>
                ) : (
                    /* D2 mini-formula (ruled 2026-08-15) + the r1 discriminator fix: the
                       empty-vs-filtered split keys on the HISTORY partition (pre-user-filters),
                       NEVER the raw fetch — a group with only a future event has events.length
                       > 0 but genuinely no history, and must get the ruled empty copy, not
                       'No sessions match your filters.'. */
                    <p className="text-content-muted text-sm">
                        {historyEvents.length === 0
                            ? "No game sessions yet — they'll show up here after your group plays this game."
                            : 'No sessions match your filters.'}
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
            <div className="card p-3 md:p-6">
                {/* D-08 (Phase 87.3-04): non-blocking degrade notice on PERMANENT
                    identity-resolution failure — own-review edit/delete gate on
                    selfUuid, so surface (never silently hide) when it can't resolve. */}
                <FetchErrorBanner state={selfIdentityErrorState} compact />
                {/* DECISION Phase 88-11 (D-39) — AMENDED 2026-08-05: the exemption this marker
                    created has been REOPENED BY THE OWNER and closed. The original ruling is
                    kept below verbatim, because a reopening has to be visible AS a reopening —
                    otherwise the next reader cannot tell a sanctioned convergence from a
                    bulldozed one, which is the exact failure this marker existed to prevent.

                    ORIGINAL RULING (88-11, superseded): this header was LEFT AS IT SHIPS — same
                    justify-between shape and same 24px heading as the sessions header above,
                    which WAS restacked and retyped that phase. The similarity was known and the
                    divergence was deliberate: the owner walked both at 375px and ruled Reviews
                    fine, because "Reviews (3)" plus a short "Add Review" button fits the line
                    that "Game Sessions (3 of 7)" plus a ~150px filter control did not. It closed
                    "A consistency sweep that converges this one onto the sessions treatment is
                    reopening an owner ruling, not tidying an oversight."

                    AMENDMENT — post-plan owner ruling, 2026-08-05, via DEF-88-24-02. The owner
                    reopened D-39 himself and converged it: "make it match the same size as all
                    other headings." So this h2 is now `text-xl font-bold` (20/700) — the same
                    rung as every other h2 on this surface (Participants, Recommended Games, Game
                    Sessions) and inside UI-SPEC §4.1's 14/16/20/30 working set. D-39's stated
                    reason was line-fitting at 375px, and the convergence moves that in the SAFE
                    direction: a 20px heading fits the line more easily than 24px, never less.

                    What this is NOT: a sweep overriding a ruling. 88-24's type sweep correctly
                    REFUSED to take it and escalated instead (see the amended 88-24 marker
                    below); the owner then ruled. Reverting to `text-2xl` now reopens HIS
                    convergence AND puts a fifth size back in a 4-size working set. Pinned in
                    src/app/typeScaleTouchedSurfaces.test.ts. */}
                {/* DECISION Phase 88-24 (Req 2) — CLOSED 2026-08-05 by the owner ruling above.
                    Kept as the evidence trail for how that ruling was reached. ORIGINAL: the
                    type-scale sweep SAW this heading and LEFT IT. `text-2xl` (24) is outside
                    §4.1's 4-size working set, so on the letter of Req 2 it should have been
                    `text-xl` — but converging it was precisely the "consistency sweep onto the
                    sessions treatment" the D-39 marker ruled out, and 88-24 had no mandate to
                    reopen an owner ruling from 88-11. It was recorded as DEF-88-24-02 so the
                    conflict carried an OWNER rather than being silently "fixed" away by a later
                    gate. That escalation is what produced the ruling above: the deferral worked
                    exactly as designed, and is now RESOLVED. */}
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-content-primary">Reviews ({reviews.length})</h2>
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
                                                        <span className="text-xs bg-surface-card-hover text-content-link px-2 py-1 rounded-sm">
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
                    // D2 mini-formula rider (Rule 2, same-class as the 4 ruled sites):
                    // muted + text-sm, no "!", state + path.
                    <p className="text-content-muted text-sm">No reviews yet. Be the first to review this game.</p>
                )}
            </div>

            {/* Review Modal */}
            {/* DECISION Phase 88-20 (SPEC Req 9): hosted on the shared <Modal>, the last of
                the phase's hand-rolled overlays. This one had the worst of the old shell:
                its close glyph carried NO accessible name at all (the participants modal at
                least had an `aria-label`), so a screen-reader user had no announced way out
                of a form. <Modal.Header> supplies a named Close, plus the focus trap, Esc
                and focus-restore this dialog never had.

                `className="max-w-md"` preserves the shipped width rather than snapping to
                the `default` (max-w-lg) preset — the same call BringGamePicker,
                FeedbackForm, FriendInvitePanel and ManageMembers already made, so this is
                the fleet's existing idiom for a max-w-md dialog, not a one-off. At 375px it
                changes nothing either way (the primitive's phone gutter governs).

                The submit button stays INSIDE the <form>, in the Body, rather than becoming
                a <Modal.Footer>: a footer button lives outside the form element and would
                need a `form="…"` association to submit at all. Trading working native
                submission for footer symmetry is a decision, not a cleanup. */}
            <Modal open={showReviewForm} onClose={() => setShowReviewForm(false)} className="max-w-md">
                <Modal.Header>{userReview ? 'Edit Your Review' : 'Write a Review'}</Modal.Header>
                <Modal.Body>
                    <form onSubmit={handleReviewSubmit} className="space-y-4">
                        <div>
                            {/* DECISION Phase 88-20 (DEF-88-10-01, site 11 of 11): this is a
                                plain <span>, NOT a <label> — chosen OVER `htmlFor`, which has
                                nothing to point at. StarRatingPicker renders a
                                `role="radiogroup"` of ten half-star radios, so a `htmlFor`
                                would have to name ONE radio and would mislabel it. The group's
                                accessible name already comes from its own `ariaLabel` below,
                                which is why this was the lowest-severity of the eleven sites:
                                the control was named, the <label> was redundant rather than
                                missing. Left as a <label> it is an orphan that axe reports and
                                that a reader "fixes" by wiring it to the wrong element.
                                Turning this back into a <label> is a decision, not a cleanup. */}
                            <span className="block text-sm font-medium text-content-primary mb-1">
                                Rating
                            </span>
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
                            <Textarea
                                id="review_text"
                                value={reviewForm.review_text}
                                onChange={(e) => setReviewForm({...reviewForm, review_text: e.target.value})}
                                rows="4"
                                placeholder="Share your thoughts about this game..."
                            />
                        </div>
                        <div className="flex items-center">
                            {/* DECISION Phase 88-20 (Req 1): the recommend checkbox stays a NATIVE
                                <input>, deliberately NOT routed through the `Input` primitive like
                                its ten filter siblings. The primitive carries `block w-full p-2`,
                                which would stretch a checkbox across the dialog. It is also outside
                                Req 1's actual charter: iOS focus-zoom fires on TEXT-ENTRY controls
                                below 16px, and a checkbox has no text to size. Sweeping this one
                                onto the primitive "for consistency" breaks the layout. */}
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
                </Modal.Body>
            </Modal>

            {/* Session-delete gate (D-09 dialog tier). Rendered UNCONDITIONALLY and
                exactly once for the whole list: the hook owns which session is armed, so
                a per-row copy would mount one dialog per visible session. `statusNode`
                is likewise mounted once and always — a conditionally-mounted live region
                announces nothing. */}
            <ConfirmDialog {...deleteSessionGate.dialogProps} />
            {deleteSessionGate.statusNode}

            {/* 88-33 Task 5 (fork 7): see-all Remove gate. Two-tap renders a null
                dialog by design (88-05) — mounted anyway so a retier stays the
                one-word edit. Its statusNode is deliberately NOT here: it must
                render INSIDE the participants Modal (see the mount there), because
                Radix aria-hides page-level content while that dialog is open. */}
            <ConfirmDialog {...removeParticipantGate.dialogProps} />

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
