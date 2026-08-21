import { parseISO, startOfWeek } from 'date-fns';

/**
 * Resolve which week the create-event heatmap should FETCH when the modal opens.
 *
 * Returns a Monday `Date` to anchor the fetch to, or `null` meaning "use today's
 * Monday" (the sentinel the fetch effect already understands).
 *
 * DECISION 2026-07-25 (bugfix, owner repro): extracted here as a pure function so the
 * week-anchor rule is unit-testable — the same reason Phase 82 pulled out
 * `availabilityColor` / `tzUtils` / `datetime`. The bug it fixes was invisible to tests
 * because nothing exercised the prefill path.
 *
 * The bug: `calendarInitialDate` follows `prefillDate` to the TAPPED day's week, but this
 * anchor used to always be `null`, so the CALENDAR showed the tapped week while the FETCH
 * asked for today's. `heatmapLookup` is keyed `${dateStr}_${hour}`, so a different week
 * matched ZERO slots and every cell rendered untinted. `onWeekChange` fires only on user
 * navigation, never on mount — hence the tint appearing only after clicking Next/Prev.
 *
 * @param prefillDate - 'YYYY-MM-DD' of the tapped day, or null
 * @param promptId - when set, the poll path anchors to the prompt's own weekStart and the
 *   fetch effect returns early without reading this anchor at all — so always null here
 * @param minWeek - earliest allowed Monday (todayMonday - 3 weeks)
 * @param maxWeek - latest allowed Monday (todayMonday + 12 weeks)
 * @returns Monday Date to fetch, or null for "today's Monday"
 */
export const resolveInitialHeatmapWeek = ({ prefillDate, promptId, minWeek, maxWeek }) => {
  if (promptId || !prefillDate) return null;

  const prefillMonday = startOfWeek(parseISO(prefillDate), { weekStartsOn: 1 });

  // Clamp to the SAME bounds the nav handlers enforce. Load-bearing: an out-of-range tap
  // must fall back to today rather than send a weekStart the backend rejects. The tint is
  // a nice-to-have; a 400 is not.
  if (minWeek && prefillMonday < minWeek) return null;
  if (maxWeek && prefillMonday > maxWeek) return null;

  return prefillMonday;
};

// Helper function to create a participant object
// Note: user_id here is the User.id (UUID), not the Auth0 user_id string.
// (87.3-10 #16: the old auth0_user_id "reference" field was dead — never read
// or transmitted — and post-PR-C would have stored a UUID under a name
// claiming it was the sub. Deleted.)
/* DECISION Phase 88-33 Task 2 (WI-F2, UAT rows 510/520): every DRAFT participant row carries a
   generated `_rowId`, and the list keys on it — chosen OVER `key={index}` (the shipped shape) and
   OVER `custom-${username}` (the shape that shipped on gameDetail and collided outright for two
   same-named guests).

   Index keys mis-associate typed state when a MIDDLE row is removed: React reuses the DOM/state of
   index N for what is now a different person, so a removed row donates its score/faction to its
   neighbour. Name keys collide the moment duplicates are allowed — and fork 3 RULED that duplicates
   ARE allowed.

   `_rowId` is DRAFT-ONLY and never crosses the wire: `prepareEventData` builds its payloads by
   picking fields explicitly, so a new draft-local field cannot leak into a request body. The
   SUBMIT-side `custom_${index}_${username}` identifier is a SEPARATE contract and deliberately
   still derives from array position at submit time (eventFormUtils.js's regex extracts only the
   NAME, and createEvent's edit-form re-link matches by name) — do not "unify" the two. */
let rowIdCounter = 0;
export const nextRowId = () => `prow-${++rowIdCounter}`;

/** Assign a stable draft id to any row that does not already have one. */
export const withRowIds = (participants = []) =>
  participants.map((p) => (p && p._rowId ? p : { ...p, _rowId: nextRowId() }));

export const createParticipant = (user_id = "", username = "", isFromGroup = false) => ({
  _rowId: nextRowId(), // draft-only stable identity (see the marker above)
  user_id: user_id, // User.id (UUID) for database
  username: username, // For display purposes
  score: null,
  faction: "",
  is_new_player: false,
  placement: null,
  isFromGroup: isFromGroup // Track if this is an auto-filled group member
});

/**
 * Re-derive a `custom_<index>_<name>` winner/picked-by reference after the
 * participant array has changed (a removal or an undo).
 *
 * The stored value embeds the position the row had in the SELECT's own list
 * (EventResultFields filters to named participants), so removing an earlier row
 * leaves the reference pointing at a position that no longer exists — the select
 * falls back to blank and the attribution is silently lost. Returns the rebuilt
 * reference, or null when the referenced name is no longer in the list.
 *
 * ACCEPTED-WITH-REASON (triage A1, owner-ruled 2026-08-20): with two same-named
 * guests this matches the FIRST occurrence, exactly as the edit-form re-link
 * (createEvent.js findIndex by username) already does. Duplicates are
 * deliberately allowed and the display is name-based, so the ambiguity mirrors
 * what the person sees; identity-keyed attribution is future schema work.
 */
export const remapCustomParticipantRef = (ref, participants = []) => {
  if (typeof ref !== 'string' || !ref.startsWith('custom_')) return ref;
  const match = ref.match(/^custom_\d+_(.+)$/);
  if (!match) return ref;
  const name = match[1];
  const named = participants.filter(p => p.username && p.username.trim() !== '');
  const idx = named.findIndex(p => !p.user_id && p.username === name);
  return idx >= 0 ? `custom_${idx}_${name}` : null;
};

// Helper function to create initial event form
export const createEventForm = (group_id, groupMembers = []) => ({
  // Event fields
  group_id: group_id,
  game_id: "",
  game_name: "",
  start_date: "",
  duration_minutes: null,
  rsvp_deadline: "",
  winner_id: null,
  picked_by_id: null,
  is_group_win: false,
  comments: "",
  // Participants array - auto-populated with all group members (read-only).
  // member.id is the Users.id UUID (post-PR-C member.user_id is the same UUID
  // via the roster alias; keep keying on the canonical `id`).
  participants: groupMembers.map(member =>
    createParticipant(member.id, member.username, true)
  )
});

// Prepare participants for submission
// Separate group members (with user_id) and custom participants (without user_id)
export const prepareEventData = (eventData) => {
  // Group members with user_id
  const groupMemberParticipants = eventData.participants
    .filter(p => p.username && p.username.trim() !== "" && p.user_id && p.user_id.trim() !== "")
    .map(p => ({
      user_id: p.user_id,
      score: p.score || null,
      faction: p.faction || null,
      is_new_player: p.is_new_player || false,
      placement: p.placement || null
    }));

  // Custom participants without user_id
  const customParticipants = eventData.participants
    .filter(p => p.username && p.username.trim() !== "" && (!p.user_id || p.user_id.trim() === ""))
    .map(p => ({
      username: p.username,
      score: p.score || null,
      faction: p.faction || null,
      is_new_player: p.is_new_player || false,
      placement: p.placement || null
    }));

  // Handle winner_id and picked_by_id - extract custom participant names if needed
  let winner_id = eventData.winner_id || null;
  let winner_name = null;
  let picked_by_id = eventData.picked_by_id || null;
  let picked_by_name = null;

  if (winner_id && winner_id.startsWith('custom_')) {
    // Extract username from custom identifier (format: custom_index_username)
    const match = winner_id.match(/^custom_\d+_(.+)$/);
    if (match) {
      winner_name = match[1];
      winner_id = null; // Clear user_id for custom participants
    }
  }

  if (picked_by_id && picked_by_id.startsWith('custom_')) {
    // Extract username from custom identifier (format: custom_index_username)
    const match = picked_by_id.match(/^custom_\d+_(.+)$/);
    if (match) {
      picked_by_name = match[1];
      picked_by_id = null; // Clear user_id for custom participants
    }
  }

  return {
    ...eventData,
    participants: groupMemberParticipants, // Group members with user_id
    custom_participants: customParticipants, // Custom participants without user_id
    // Convert empty strings to null for optional fields
    duration_minutes: eventData.duration_minutes || null,
    winner_id: winner_id,
    winner_name: winner_name,
    picked_by_id: picked_by_id,
    picked_by_name: picked_by_name,
  };
};
