// Helper function to create a participant object
// Note: user_id here is the User.id (UUID), not the Auth0 user_id string
export const createParticipant = (user_id = "", username = "", auth0_user_id = "", isFromGroup = false) => ({
  user_id: user_id, // User.id (UUID) for database
  username: username, // For display purposes
  auth0_user_id: auth0_user_id, // Auth0 identifier for reference
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
  // Participants array - auto-populated with all group members (read-only)
  // Use member.id (UUID) for user_id, not member.user_id (Auth0 string)
  participants: groupMembers.map(member =>
    createParticipant(member.id, member.username, member.user_id, true)
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
