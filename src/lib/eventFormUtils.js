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
export const createParticipant = (user_id = "", username = "", isFromGroup = false) => ({
  user_id: user_id, // User.id (UUID) for database
  username: username, // For display purposes
  score: null,
  faction: "",
  is_new_player: false,
  placement: null,
  isFromGroup: isFromGroup // Track if this is an auto-filled group member
});

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
