/**
 * API Configuration and Utility Functions
 * Centralized API base URL and common fetch patterns
 */

// API Base URL - can be moved to environment variable in production
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api';

/**
 * Get Auth0 access token for API calls
 * This function should be called from client components that have access to Auth0
 */
export async function getAccessToken() {
  try {
    // Get token from Auth0 session
    const response = await fetch('/api/auth/token');
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    return data.accessToken || null;
  } catch (error) {
    console.error('Error getting access token:', error.message);
    return null;
  }
}

/**
 * Generic fetch wrapper with error handling and Auth0 token injection
 */
export async function apiFetch(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  
  // Try to get access token if available (for client-side calls)
  let accessToken = null;
  if (typeof window !== 'undefined') {
    try {
      const tokenResponse = await fetch('/api/auth/token');
      if (tokenResponse.ok) {
        const tokenData = await tokenResponse.json();
        accessToken = tokenData.accessToken;
      }
    } catch (error) {
      // Silently fail if token can't be retrieved
    }
  }
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken && { 'Authorization': `Bearer ${accessToken}` }),
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });
    
    // Read response as text first (can only be read once)
    const responseText = await response.text();
    
    // Check if response is HTML (means we're hitting the wrong endpoint)
    if (responseText.trim().startsWith('<!DOCTYPE') || responseText.trim().startsWith('<html')) {
      console.error(`API Error: Received HTML instead of JSON. This usually means NEXT_PUBLIC_API_URL is incorrect.`);
      console.error(`Attempted URL: ${url}`);
      console.error(`Current API_BASE_URL: ${API_BASE_URL}`);
      throw new Error(`API configuration error: Backend URL appears to be incorrect. Check NEXT_PUBLIC_API_URL environment variable. Current: ${API_BASE_URL}`);
    }
    
    if (!response.ok) {
      let errorData;
      try {
        // Try to parse as JSON
        errorData = JSON.parse(responseText);
      } catch (jsonError) {
        // If not JSON, use the text as error message
        errorData = { error: responseText || `HTTP error! status: ${response.status}` };
      }
      
      // If there are validation errors, format them nicely
      if (errorData.errors && Array.isArray(errorData.errors) && errorData.errors.length > 0) {
        const errorMessages = errorData.errors.map(err => err.message || `${err.field}: ${err.msg}`).join('. ');
        throw new Error(errorMessages || errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    
    // Parse successful response as JSON
    try {
      return JSON.parse(responseText);
    } catch (jsonError) {
      // If response is not JSON, return the text
      return responseText;
    }
  } catch (error) {
    console.error(`API Error (${endpoint}):`, error.message || 'Unknown error');
    console.error(`API URL: ${url}`);
    // Re-throw with more context if it's a network error
    if (error.name === 'TypeError' && error.message.includes('fetch')) {
      throw new Error('Network error: Could not connect to the server. Please check if the backend is running and NEXT_PUBLIC_API_URL is set correctly.');
    }
    throw error;
  }
}

/**
 * API functions for Groups
 */
export const groupsAPI = {
  // Get all groups for a user
  getUserGroups: (user_id) => 
    apiFetch(`/groups/user/${encodeURIComponent(user_id)}`),
  
  // Get a single group by ID
  getGroup: (group_id) => 
    apiFetch(`/groups/${group_id}`),
  
  // Get all users in a group
  getGroupMembers: (group_id) => 
    apiFetch(`/groups/${group_id}/users`),
  
  // Create a new group
  createGroup: (groupData) => 
    apiFetch('/groups', {
      method: 'POST',
      body: JSON.stringify(groupData),
    }),
  
  // Add user to group
  addUserToGroup: (group_id, user_id) => 
    apiFetch(`/groups/${group_id}/users`, {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
  
  // Update user role in group (owner only)
  updateUserRole: (group_id, target_user_id, requesting_user_id, role) => 
    apiFetch(`/groups/${group_id}/users/${target_user_id}/role`, {
      method: 'PUT',
      body: JSON.stringify({ requesting_user_id, role }),
    }),
  
  // Remove user from group (owner or admin)
  removeUserFromGroup: (group_id, target_user_id, requesting_user_id) => 
    apiFetch(`/groups/${group_id}/users/${target_user_id}`, {
      method: 'DELETE',
      body: JSON.stringify({ requesting_user_id }),
    }),
  
  // Update group settings (profile picture, background)
  updateGroupSettings: (group_id, requesting_user_id, settings) => 
    apiFetch(`/groups/${group_id}/settings`, {
      method: 'PUT',
      body: JSON.stringify({ 
        requesting_user_id,
        ...settings 
      }),
    }),
  
  // Delete group (owner only)
  deleteGroup: (group_id, requesting_user_id) => 
    apiFetch(`/groups/${group_id}`, {
      method: 'DELETE',
      body: JSON.stringify({ requesting_user_id }),
    }),
};

/**
 * API functions for Events
 */
export const eventsAPI = {
  // Get all events for a user across all groups
  getUserEvents: (user_id) => 
    apiFetch(`/events/user/${encodeURIComponent(user_id)}`),
  
  // Get all events for a group
  getGroupEvents: (group_id) => 
    apiFetch(`/events/group/${group_id}`),
  
  // Get a single event by ID
  getEvent: (event_id) => 
    apiFetch(`/events/${event_id}`),
  
  // Create a new event
  createEvent: (eventData) => 
    apiFetch('/events', {
      method: 'POST',
      body: JSON.stringify(eventData),
    }),
  
  // Update an event (requires owner/admin)
  updateEvent: (event_id, eventData, requesting_user_id) => 
    apiFetch(`/events/${event_id}`, {
      method: 'PUT',
      body: JSON.stringify({ ...eventData, requesting_user_id }),
    }),
  
  // Delete an event (requires owner/admin)
  deleteEvent: (event_id, requesting_user_id) => 
    apiFetch(`/events/${event_id}`, {
      method: 'DELETE',
      body: JSON.stringify({ requesting_user_id }),
    }),
};

/**
 * API functions for Users
 */
export const usersAPI = {
  // Get user by user_id (Auth0 identifier)
  getUser: (user_id) => 
    apiFetch(`/users/${encodeURIComponent(user_id)}`),
  
  // Update user's username
  updateUsername: (user_id, username) =>
    apiFetch(`/users/${encodeURIComponent(user_id)}/username`, {
      method: 'PUT',
      body: JSON.stringify({ username }),
    }),
  
  // Search user by email
  searchUserByEmail: (email) => 
    apiFetch(`/users/search/email/${encodeURIComponent(email)}`),
  
  // Create or update user
  createOrUpdateUser: (userData) => 
    apiFetch('/users', {
      method: 'POST',
      body: JSON.stringify(userData),
    }),
};

/**
 * API functions for Games
 */
export const gamesAPI = {
  // Get all games (with optional search)
  getGames: (params = {}) => {
    const queryString = new URLSearchParams(params).toString();
    return apiFetch(`/games${queryString ? `?${queryString}` : ''}`);
  },
  
  // Get a single game by ID
  getGame: (game_id) => 
    apiFetch(`/games/${game_id}`),
  
  // Create a custom game
  createGame: (gameData) => 
    apiFetch('/games', {
      method: 'POST',
      body: JSON.stringify(gameData),
    }),
  
  // Search BGG for games
  searchBGG: (query) => 
    apiFetch(`/games/bgg/search?query=${encodeURIComponent(query)}`),
  
  // Import game from BGG
  importFromBGG: (bgg_id) => 
    apiFetch(`/games/import-bgg/${bgg_id}`, {
      method: 'POST',
    }),
  
  // Get games for event form (group played + user owned)
  getGamesForEvent: (group_id, user_id) =>
    apiFetch(`/games/for-event/${group_id}/${encodeURIComponent(user_id)}`),

  // Search all games (local custom + BGG) for combo input
  searchAll: (query, groupId, userId) => {
    const params = new URLSearchParams({ query });
    if (groupId) params.append('group_id', groupId);
    if (userId) params.append('user_id', userId);
    return apiFetch(`/games/search-all?${params.toString()}`);
  },

  // Resolve a game name to an existing or new custom game
  resolveGame: (name) =>
    apiFetch('/games/resolve', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
};

/**
 * API functions for User Owned Games
 */
export const userGamesAPI = {
  // Get all games owned by a user
  getOwnedGames: (user_id) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}`),
  
  // Add game to user's collection
  addOwnedGame: (user_id, game_id) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'POST',
    }),
  
  // Remove game from user's collection
  removeOwnedGame: (user_id, game_id) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/game/${game_id}`, {
      method: 'DELETE',
    }),
  
  // Import entire BGG collection
  importBGGCollection: (user_id, bgg_username) => 
    apiFetch(`/user-games/user/${encodeURIComponent(user_id)}/import-bgg-collection`, {
      method: 'POST',
      body: JSON.stringify({ bgg_username }),
    }),
};

/**
 * API functions for Lists (sorted/filtered game lists)
 */
export const listsAPI = {
  // Get games for a group with sorting options
  // sort: 'name' | 'play_count' | 'last_played' | 'rating'
  // order: 'asc' | 'desc'
  getGroupGames: (group_id, user_id, sort = 'last_played', order = 'desc') => {
    const params = new URLSearchParams({ sort, order });
    return apiFetch(`/lists/games/${group_id}/${encodeURIComponent(user_id)}?${params.toString()}`);
  },
  
  // Get most played games
  getMostPlayed: (group_id, user_id) => 
    apiFetch(`/lists/most-played/${group_id}/${encodeURIComponent(user_id)}`),
  
  // Get least played games
  getLeastPlayed: (group_id, user_id) => 
    apiFetch(`/lists/least-played/${group_id}/${encodeURIComponent(user_id)}`),
  
  // Get games alphabetically
  getAlphabetical: (group_id, user_id) => 
    apiFetch(`/lists/alphabetical/${group_id}/${encodeURIComponent(user_id)}`),
  
  // Get games by theme
  getByTheme: (group_id, theme, user_id) => 
    apiFetch(`/lists/by-theme/${group_id}/${encodeURIComponent(theme)}/${encodeURIComponent(user_id)}`),
};

/**
 * API functions for Game Reviews
 */
export const gameReviewsAPI = {
  // Get reviews for a game in a group
  getGameReviews: (game_id, group_id, user_id = null) => {
    const params = user_id ? `?user_id=${encodeURIComponent(user_id)}` : '';
    return apiFetch(`/game-reviews/game/${game_id}/group/${group_id}${params}`);
  },
  
  // Get all reviews by a user in a group
  getUserReviews: (target_user_id, group_id, requesting_user_id = null) => {
    const params = requesting_user_id ? `?user_id=${encodeURIComponent(requesting_user_id)}` : '';
    return apiFetch(`/game-reviews/user/${encodeURIComponent(target_user_id)}/group/${group_id}${params}`);
  },
  
  // Create or update a review
  submitReview: (reviewData) => 
    apiFetch('/game-reviews', {
      method: 'POST',
      body: JSON.stringify(reviewData),
    }),
  
  // Update a review
  updateReview: (review_id, reviewData) => 
    apiFetch(`/game-reviews/${review_id}`, {
      method: 'PUT',
      body: JSON.stringify(reviewData),
    }),
  
  // Delete a review
  deleteReview: (review_id) => 
    apiFetch(`/game-reviews/${review_id}`, {
      method: 'DELETE',
    }),
};

/**
 * API functions for Feedback
 */
export const feedbackAPI = {
  // Submit bug report or suggestion
  submitFeedback: (feedbackData) => 
    apiFetch('/feedback', {
      method: 'POST',
      body: JSON.stringify(feedbackData),
    }),
};

/**
 * API functions for Google Calendar
 */
export const googleCalendarAPI = {
  // Get Google Calendar connection status
  getStatus: (user_id) => 
    apiFetch(`/auth/google/status/${encodeURIComponent(user_id)}`),
  
  // Disconnect Google Calendar
  disconnect: (user_id) => 
    apiFetch('/auth/google/disconnect', {
      method: 'POST',
      body: JSON.stringify({ user_id }),
    }),
};

/**
 * API functions for Availability and Planning
 */
export const availabilityAPI = {
  // Get user's availability for a date range
  getUserAvailability: (user_id, startDate = null, endDate = null, timezone = 'UTC') => {
    const params = new URLSearchParams({ timezone });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return apiFetch(`/availability/user/${encodeURIComponent(user_id)}?${params.toString()}`);
  },
  
  // Get user's availability patterns (for editing/deleting)
  getUserPatterns: (user_id) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/patterns`),
  
  // Create recurring availability pattern
  createRecurringPattern: (user_id, patternData) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/recurring`, {
      method: 'POST',
      body: JSON.stringify(patternData),
    }),
  
  // Create specific date/time override
  createOverride: (user_id, overrideData) => 
    apiFetch(`/availability/user/${encodeURIComponent(user_id)}/override`, {
      method: 'POST',
      body: JSON.stringify(overrideData),
    }),
  
  // Delete availability pattern/override
  deleteAvailability: (availability_id) => 
    apiFetch(`/availability/${availability_id}`, {
      method: 'DELETE',
    }),
  
  // Get overlapping free time for all group members
  getGroupOverlaps: (group_id, startDate = null, endDate = null, timezone = 'UTC') => {
    const params = new URLSearchParams({ timezone });
    if (startDate) params.append('start_date', startDate);
    if (endDate) params.append('end_date', endDate);
    return apiFetch(`/availability/group/${group_id}/overlaps?${params.toString()}`);
  },

  // Submit weekly availability response
  submitWeeklyAvailability: (group_id, data) =>
    apiFetch(`/availability/groups/${group_id}/weekly`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // Get weekly availability for a group
  getWeeklyAvailability: (group_id, week_start) =>
    apiFetch(`/availability/groups/${group_id}/week/${week_start}`),
};

/**
 * API functions for Magic Auth (no Auth0 required)
 * These use direct fetch without Auth0 token injection
 */
export const magicAuthAPI = {
  // Validate a magic token (returns user info, prompt_id, expiry)
  validateToken: (token, formLoadedAt = null) =>
    fetch(`${API_BASE_URL}/magic-auth/validate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, formLoadedAt }),
    }).then(res => res.json()),

  // Request a new magic link (stub - returns 501 currently)
  requestNew: (promptId) =>
    fetch(`${API_BASE_URL}/magic-auth/request-new`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt_id: promptId }),
    }).then(res => res.json()),
};

/**
 * API functions for Availability Form submission (magic token auth, no Auth0)
 * These use direct fetch without Auth0 token injection
 */
export const availabilityFormAPI = {
  // Submit availability response via magic token
  submitResponse: (data) =>
    fetch(`${API_BASE_URL}/availability-responses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }).then(res => res.json()),

  // Get existing response for pre-fill (if user returns to edit)
  getExistingResponse: (promptId, token) =>
    fetch(`${API_BASE_URL}/availability-responses/${promptId}?magic_token=${encodeURIComponent(token)}`, {
      headers: { 'Content-Type': 'application/json' },
    }).then(res => res.ok ? res.json() : null),
};

/**
 * API functions for Prompt Settings
 */
export const promptSettingsAPI = {
  // Get prompt settings for a group (includes schedules array)
  getGroupPromptSettings: (group_id) =>
    apiFetch(`/groups/${group_id}/prompt-settings`),

  // Create a new schedule
  createSchedule: (group_id, scheduleData) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules`, {
      method: 'POST',
      body: JSON.stringify(scheduleData),
    }),

  // Update an existing schedule
  updateSchedule: (group_id, schedule_id, scheduleData) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'PATCH',
      body: JSON.stringify(scheduleData),
    }),

  // Soft delete a schedule
  deleteSchedule: (group_id, schedule_id) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}`, {
      method: 'DELETE',
    }),

  // Toggle schedule active status (pause/resume)
  toggleSchedule: (group_id, schedule_id) =>
    apiFetch(`/groups/${group_id}/prompt-settings/schedules/${schedule_id}/toggle`, {
      method: 'PATCH',
    }),
};

/**
 * API functions for Availability Prompts (respondent tracking, reminders)
 */
export const promptAPI = {
  // Get respondent list for a prompt
  getRespondents: (promptId) =>
    apiFetch(`/prompts/${promptId}/respondents`),

  // Send reminder to non-respondent (admin only)
  sendReminder: (promptId, userId) =>
    apiFetch(`/prompts/${promptId}/remind/${userId}`, {
      method: 'POST',
    }),

  // Fetch the most recent active/pending prompt for a group
  getActivePrompt: (groupId) =>
    apiFetch(`/groups/${groupId}/prompts/active`),

  // Fetch a specific prompt by ID regardless of status (used for closed prompts from email links)
  getPromptById: (promptId) =>
    apiFetch(`/prompts/${promptId}`),

  // Fetch heatmap suggestions for a prompt
  getSuggestions: (promptId) =>
    apiFetch(`/prompts/${promptId}/suggestions`),
};

/**
 * API functions for Availability Suggestions (event creation from suggestions)
 */
export const suggestionAPI = {
  /**
   * Convert a suggestion to an event
   * @param {string} suggestionId - UUID of the suggestion
   * @returns {Promise<{success: boolean, event_id: string}>}
   */
  convert: (suggestionId) =>
    apiFetch(`/suggestions/${suggestionId}/convert`, {
      method: 'POST',
    }),
};

/**
 * API functions for Group Invites
 */
export const invitesAPI = {
  // Send a group invite by email
  sendInvite: (group_id, email) =>
    apiFetch('/invites/send', {
      method: 'POST',
      body: JSON.stringify({ group_id, email }),
    }),

  // Get current user's pending invites
  getPendingInvites: () =>
    apiFetch('/invites/pending'),

  // Accept a pending invite by invite ID
  acceptInvite: (invite_id) =>
    apiFetch(`/invites/${invite_id}/accept`, { method: 'POST' }),

  // Decline a pending invite by invite ID
  declineInvite: (invite_id) =>
    apiFetch(`/invites/${invite_id}/decline`, { method: 'POST' }),

  // Accept invite by token (from email link)
  acceptInviteByToken: (token) =>
    apiFetch('/invites/accept-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    }),

  // Get pending invites for a group (admin view)
  getGroupPendingInvites: (group_id) =>
    apiFetch(`/invites/group/${group_id}/pending`),

  // Get invite info by token (public, no auth required)
  getInviteInfo: (token) =>
    apiFetch(`/invites/info/${token}`),
};

/**
 * API functions for Friendships (Social Graph)
 */
export const friendshipsAPI = {
  // Get accepted friends for current user
  getFriends: () =>
    apiFetch('/friendships?status=accepted'),

  // Get received pending friend requests
  getReceivedRequests: () =>
    apiFetch('/friendships?status=pending&direction=received'),

  // Get sent pending friend requests
  getSentRequests: () =>
    apiFetch('/friendships?status=pending&direction=sent'),

  // Search for a user by exact email (local DB only, no auto-create)
  searchUserByEmail: (email) =>
    apiFetch(`/friendships/search?email=${encodeURIComponent(email)}`),

  // Send a friend request by user_id
  sendRequest: (addressee_user_id) =>
    apiFetch('/friendships/request', {
      method: 'POST',
      body: JSON.stringify({ addressee_user_id }),
    }),

  // Accept a pending friend request
  acceptRequest: (friendship_id) =>
    apiFetch(`/friendships/${friendship_id}/accept`, { method: 'POST' }),

  // Decline a pending friend request
  declineRequest: (friendship_id) =>
    apiFetch(`/friendships/${friendship_id}/decline`, { method: 'POST' }),

  // Remove a friend (unfriend - hard delete)
  removeFriend: (friendship_id) =>
    apiFetch(`/friendships/${friendship_id}`, { method: 'DELETE' }),
};

