'use client';

import { useState, useEffect } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { gamesAPI, eventsAPI, groupsAPI, API_BASE_URL } from '../../lib/api';

// Helper function to create a participant object
// Note: user_id here is the User.id (UUID), not the Auth0 user_id string
const createParticipant = (user_id = "", username = "", auth0_user_id = "", isFromGroup = false) => ({
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
const createEventForm = (group_id, groupMembers = []) => ({
  // Event fields
  group_id: group_id,
  game_id: "",
  start_date: "",
  duration_minutes: null,
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

function CreateEvent({ group_id, modal, modaltoggle, onEventCreated, editingEvent = null, user, prefillDate = null, prefillTime = null }) {
  const authUser = user || Auth().user;
  const [groupMembers, setGroupMembers] = useState([]);
  const [newEvent, setNewEvent] = useState(createEventForm(group_id, []));
  const [loading, setLoading] = useState(true);
  const [games, setGames] = useState([]); // For game selection dropdown
  const [bggSearchQuery, setBggSearchQuery] = useState('');
  const [bggSearchResults, setBggSearchResults] = useState([]);
  const [bggSearching, setBggSearching] = useState(false);
  const [showBggSearch, setShowBggSearch] = useState(false);

  // Fetch group members and games when component mounts or group_id changes
  useEffect(() => {
    if (group_id && modal) {
      fetchGroupMembers();
      fetchGames();
    }
  }, [group_id, modal]);

  // Populate form when editingEvent changes
  useEffect(() => {
    if (editingEvent && groupMembers.length > 0) {
      // Format start_date for datetime-local input (YYYY-MM-DDTHH:mm)
      const startDate = editingEvent.start_date 
        ? new Date(editingEvent.start_date).toISOString().slice(0, 16)
        : '';
      
      // Map EventParticipations to participants format
      // Handle both regular participants (with user_id) and custom participants (is_custom: true)
      const participants = editingEvent.EventParticipations?.map(ep => {
        // Check if this is explicitly marked as a custom participant
        // Custom participants have is_custom: true OR (no user_id AND username exists)
        const isCustom = ep.is_custom === true || (ep.user_id === null || ep.user_id === '' || !ep.user_id);
        
        if (isCustom) {
          // Custom participant - editable
          return {
            user_id: '',
            username: ep.username || '',
            auth0_user_id: '',
            score: ep.score,
            faction: ep.faction || '',
            is_new_player: ep.is_new_player || false,
            placement: ep.placement,
            isFromGroup: false // Custom participants are not from group
          };
        } else {
          // Regular participant with user_id - they're always from group (read-only)
          const matchingGroupMember = groupMembers.find(m => {
            // Compare UUIDs as strings
            return String(m.id) === String(ep.user_id);
          });
          
          return {
            user_id: ep.user_id,
            username: ep.username || matchingGroupMember?.username || '',
            auth0_user_id: matchingGroupMember?.user_id || '',
            score: ep.score,
            faction: ep.faction || '',
            is_new_player: ep.is_new_player || false,
            placement: ep.placement,
            isFromGroup: true // Participants with user_id are always from group (read-only)
          };
        }
      }) || [];
      
      // If no participants from event, use all group members
      const finalParticipants = participants.length > 0 
        ? participants 
        : groupMembers.map(member => 
            createParticipant(member.id, member.username, member.user_id, true)
          );

      // Handle winner and picked_by - check if they're custom (no id, just username)
      let winner_id = null;
      let picked_by_id = null;
      
      if (editingEvent.Winner) {
        if (editingEvent.Winner.is_custom || (!editingEvent.Winner.id && editingEvent.Winner.username)) {
          // Custom winner - create a custom identifier
          const winnerIndex = finalParticipants.findIndex(p => p.username === editingEvent.Winner.username && !p.user_id);
          if (winnerIndex >= 0) {
            winner_id = `custom_${winnerIndex}_${editingEvent.Winner.username}`;
          }
        } else {
          winner_id = editingEvent.Winner.id || null;
        }
      }
      
      if (editingEvent.PickedBy) {
        if (editingEvent.PickedBy.is_custom || (!editingEvent.PickedBy.id && editingEvent.PickedBy.username)) {
          // Custom picked_by - create a custom identifier
          const pickedByIndex = finalParticipants.findIndex(p => p.username === editingEvent.PickedBy.username && !p.user_id);
          if (pickedByIndex >= 0) {
            picked_by_id = `custom_${pickedByIndex}_${editingEvent.PickedBy.username}`;
          }
        } else {
          picked_by_id = editingEvent.PickedBy.id || null;
        }
      }

      setNewEvent({
        group_id: editingEvent.group_id,
        game_id: editingEvent.game_id,
        start_date: startDate,
        duration_minutes: editingEvent.duration_minutes || null,
        winner_id: winner_id,
        picked_by_id: picked_by_id,
        is_group_win: editingEvent.is_group_win || false,
        comments: editingEvent.comments || '',
        participants: finalParticipants
      });
    } else if (!editingEvent && groupMembers.length > 0) {
      // Reset to empty form when not editing
      const form = createEventForm(group_id, groupMembers);
      // Pre-fill date and time if provided from planning page
      if (prefillDate && prefillTime) {
        // Combine date and time into datetime-local format (YYYY-MM-DDTHH:mm)
        form.start_date = `${prefillDate}T${prefillTime}`;
      }
      setNewEvent(form);
    }
  }, [editingEvent, groupMembers, group_id, prefillDate, prefillTime]);

  const fetchGroupMembers = async () => {
    try {
      setLoading(true);
      // Use groupsAPI.getGroupMembers which automatically includes Authorization header
      const data = await groupsAPI.getGroupMembers(group_id);
      setGroupMembers(data);
      // Only initialize form if not editing (editing form is set by the useEffect above)
      if (!editingEvent) {
        const form = createEventForm(group_id, data);
        // Pre-fill date and time if provided from planning page
        if (prefillDate && prefillTime) {
          // Combine date and time into datetime-local format (YYYY-MM-DDTHH:mm)
          form.start_date = `${prefillDate}T${prefillTime}`;
        }
        setNewEvent(form);
      }
    } catch (error) {
      console.error('Error fetching group members:', error);
    } finally {
      setLoading(false);
    }
  };

  const fetchGames = async () => {
    if (!group_id || !authUser?.sub) return;
    try {
      const data = await gamesAPI.getGamesForEvent(group_id, authUser.sub);
      setGames(data || []);
    } catch (error) {
      console.error('Error fetching games:', error);
      setGames([]);
    }
  };

  const searchBGG = async () => {
    if (!bggSearchQuery.trim()) return;
    try {
      setBggSearching(true);
      const results = await gamesAPI.searchBGG(bggSearchQuery);
      setBggSearchResults(results || []);
      if (results.length === 0) {
        alert('No games found. Try a different search term.');
      }
    } catch (error) {
      console.error('Error searching BGG:', error);
      setBggSearchResults([]);
      const errorMessage = error.message || 'Failed to search BoardGameGeek';
      if (errorMessage.includes('401') || errorMessage.includes('403') || errorMessage.includes('rate limiting')) {
        alert('BoardGameGeek API is currently unavailable or rate-limited. Please try again in a few moments, or manually add the game to your collection from your profile page.');
      } else {
        alert(`Error searching BoardGameGeek: ${errorMessage}`);
      }
    } finally {
      setBggSearching(false);
    }
  };

  const importBGGGame = async (result) => {
    try {
      let gameId;
      let gameData;
      
      // If the game already exists in database (from CSV), use db_id directly
      if (result.db_id) {
        gameId = result.db_id;
        // Fetch the full game data to add to the list
        try {
          gameData = await gamesAPI.getGame(gameId);
        } catch (err) {
          // Create a game object from the search result
          gameData = {
            id: result.db_id,
            name: result.name,
            year_published: result.year_published,
            is_group_game: false,
            is_owned: false
          };
        }
      } else {
        // Game not in database yet, import from BGG API
        gameData = await gamesAPI.importFromBGG(result.bgg_id);
        gameId = gameData.id;
      }
      
      // Add the game to the games list if it's not already there
      setGames(prevGames => {
        const exists = prevGames.some(g => g.id === gameId);
        if (!exists) {
          return [...prevGames, {
            ...gameData,
            is_group_game: false,
            is_owned: false
          }];
        }
        return prevGames;
      });
      
      // Select the game
      setNewEvent(prev => ({
        ...prev,
        game_id: gameId
      }));
      setShowBggSearch(false);
      setBggSearchQuery('');
      setBggSearchResults([]);
    } catch (error) {
      console.error('Error importing BGG game:', error.message || 'Unknown error');
      alert(`Failed to import game from BGG: ${error.message || 'Please try again.'}`);
    }
  };

  const handleChange = (event) => {
    const { id, value, type, checked } = event.target;
    setNewEvent({
      ...newEvent,
      [id]: type === 'checkbox' ? checked : (value === '' ? null : value)
    });
  };

  const handleParticipantChange = (index, field, value) => {
    const updatedParticipants = [...newEvent.participants];
    updatedParticipants[index] = {
      ...updatedParticipants[index],
      [field]: field === 'is_new_player' ? value : (value === '' ? null : value)
    };
    setNewEvent({...newEvent, participants: updatedParticipants});
  };

  const toggleParticipant = (index) => {
    // Instead of removing, we'll mark them as not participating
    // Or we could remove them - let's remove for now
    const updatedParticipants = newEvent.participants.filter((_, i) => i !== index);
    // Keep at least one participant
    if (updatedParticipants.length > 0) {
      setNewEvent({...newEvent, participants: updatedParticipants});
    }
  };

  const addParticipant = () => {
    setNewEvent({
      ...newEvent,
      participants: [...newEvent.participants, createParticipant("", "", "", false)]
    });
  };

  // Prepare participants for submission
  // Separate group members (with user_id) and custom participants (without user_id)
  const prepareEventData = (eventData) => {
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

  const onSubmit = async (e) => {
    e.preventDefault();
    try {
      const eventDataToSubmit = prepareEventData(newEvent);
      
      // Get user's timezone and ensure start_date is properly formatted with timezone
      const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      
      // Convert datetime-local string to ISO string with timezone awareness
      // datetime-local gives us "YYYY-MM-DDTHH:mm" which is in user's local time
      // We need to treat this as local time and convert to UTC for storage
      if (eventDataToSubmit.start_date) {
        // The datetime-local value is in user's local timezone
        // Create a Date object treating it as local time
        const localDate = new Date(eventDataToSubmit.start_date);
        
        // Check if the string doesn't have timezone info (datetime-local format)
        if (eventDataToSubmit.start_date && !eventDataToSubmit.start_date.includes('Z') && !eventDataToSubmit.start_date.includes('+') && !eventDataToSubmit.start_date.includes('-', 10)) {
          // It's a datetime-local string (YYYY-MM-DDTHH:mm), treat as local time
          // The Date constructor will interpret it as local time
          // Convert to ISO string (UTC) for storage
          eventDataToSubmit.start_date = localDate.toISOString();
        } else {
          // Already has timezone info, use as-is
          eventDataToSubmit.start_date = localDate.toISOString();
        }
      }
      
      // Add timezone to event data for Google Calendar creation
      eventDataToSubmit.timezone = userTimezone;
      
      if (editingEvent) {
        // Update existing event
        await eventsAPI.updateEvent(editingEvent.id, eventDataToSubmit, authUser?.sub);
        if (onEventCreated) {
          onEventCreated(null); // Signal that event was updated
        }
      } else {
        // Create new event using eventsAPI which automatically includes Authorization header
        const data = await eventsAPI.createEvent(eventDataToSubmit);
        if (onEventCreated) {
          onEventCreated(data);
        }
      }
      
      modaltoggle();
      // Reset form
      setNewEvent(createEventForm(group_id, groupMembers));
    } catch (error) {
      console.error(`Error ${editingEvent ? 'updating' : 'creating'} event:`, error);
      alert(`Failed to ${editingEvent ? 'update' : 'create'} event. ${error.message || 'Please try again.'}`);
    }
  };

  if (!modal) return null;

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
        <div className="bg-white p-6 rounded">Loading group members...</div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-white p-6 rounded-lg max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold">Create New Game Event</h2>
          <button
            onClick={modaltoggle}
            className="text-gray-500 hover:text-gray-700 text-2xl"
          >
            ×
          </button>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Game Selection */}
          <div>
            <div className="flex justify-between items-center mb-1">
              <label htmlFor="game_id" className="block text-sm font-medium text-gray-900">
                Game <span className="text-red-500">*</span>
              </label>
              <button
                type="button"
                onClick={() => setShowBggSearch(!showBggSearch)}
                className="text-sm text-blue-600 hover:text-blue-800 underline"
              >
                {showBggSearch ? 'Hide BGG Search' : 'Search BoardGameGeek'}
              </button>
            </div>
            
            <select
              id="game_id"
              value={newEvent.game_id || ''}
              onChange={handleChange}
              required
              className="w-full p-2 border rounded text-gray-900 bg-white mb-2"
            >
              <option value="">Select a game...</option>
              {games.filter(g => g.is_group_game).length > 0 && (
                <optgroup label="Games Played by Group">
                  {games.filter(g => g.is_group_game).map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name} {game.year_published ? `(${game.year_published})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
              {games.filter(g => g.is_owned && !g.is_group_game).length > 0 && (
                <optgroup label="Your Owned Games">
                  {games.filter(g => g.is_owned && !g.is_group_game).map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name} {game.year_published ? `(${game.year_published})` : ''} ⭐
                    </option>
                  ))}
                </optgroup>
              )}
              {games.filter(g => !g.is_owned && !g.is_group_game).length > 0 && (
                <optgroup label="Other Games">
                  {games.filter(g => !g.is_owned && !g.is_group_game).map((game) => (
                    <option key={game.id} value={game.id}>
                      {game.name} {game.year_published ? `(${game.year_published})` : ''}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            
            {/* BGG Search */}
            {showBggSearch && (
              <div className="mt-3 p-3 border rounded bg-gray-50">
                <div className="flex gap-2 mb-2">
                  <input
                    type="text"
                    value={bggSearchQuery}
                    onChange={(e) => setBggSearchQuery(e.target.value)}
                    onKeyPress={(e) => e.key === 'Enter' && searchBGG()}
                    placeholder="Search BoardGameGeek..."
                    className="flex-1 p-2 border rounded text-gray-900 bg-white"
                  />
                  <button
                    type="button"
                    onClick={searchBGG}
                    disabled={bggSearching || !bggSearchQuery.trim()}
                    className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400"
                  >
                    {bggSearching ? 'Searching...' : 'Search'}
                  </button>
                </div>
                
                {bggSearchResults.length > 0 && (
                  <div className="max-h-40 overflow-y-auto space-y-1">
                    {bggSearchResults.map((result) => (
                      <div key={result.bgg_id} className="flex items-center justify-between p-2 bg-white border rounded">
                        <span className="text-sm text-gray-900">
                          {result.name} {result.year_published ? `(${result.year_published})` : ''}
                        </span>
                        <button
                          type="button"
                          onClick={() => importBGGGame(result)}
                          className="text-xs px-2 py-1 bg-green-600 text-white rounded hover:bg-green-700"
                        >
                          Add & Select
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
            
            {games.length === 0 && !showBggSearch && (
              <p className="text-xs text-gray-500 mt-1">No games found. Search BoardGameGeek to add games.</p>
            )}
          </div>

          {/* Start Date */}
          <div>
            <label htmlFor="start_date" className="block text-sm font-medium mb-1 text-gray-900">
              Start Date & Time <span className="text-red-500">*</span>
            </label>
            <input
              type="datetime-local"
              id="start_date"
              value={newEvent.start_date}
              onChange={handleChange}
              required
              className="w-full p-2 border rounded text-gray-900 bg-white"
            />
          </div>

          {/* Duration */}
          <div>
            <label htmlFor="duration_minutes" className="block text-sm font-medium mb-1 text-gray-900">
              Duration (minutes) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              id="duration_minutes"
              value={newEvent.duration_minutes || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded text-gray-900 bg-white"
              placeholder="Enter duration in minutes"
              required
              min="1"
              max="1440"
            />
          </div>

          {/* Participants Section */}
          <div>
            <label className="block text-sm font-medium mb-2 text-gray-900">
              Participants <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2 max-h-60 overflow-y-auto border p-2 rounded bg-white">
              {newEvent.participants.map((participant, index) => (
                <div key={index} className="flex items-center gap-4 p-2 border-b">
                  <div className="flex-1">
                    <label className="text-xs text-gray-700 mb-1 block">Participant Name</label>
                    {participant.isFromGroup ? (
                      // Read-only display for group members
                      <div className="p-2 border rounded bg-gray-50 text-gray-900 text-sm">
                        {participant.username || `Participant ${index + 1}`}
                      </div>
                    ) : (
                      // Editable input for custom participants
                      <input
                        type="text"
                        value={participant.username || ''}
                        onChange={(e) => {
                          const value = e.target.value;
                          // Allow typing any name (group member or custom)
                          handleParticipantChange(index, 'username', value);
                          
                          // Try to find matching group member
                          const matchingMember = groupMembers.find(m => 
                            m.username?.toLowerCase() === value.toLowerCase() || 
                            m.email?.toLowerCase() === value.toLowerCase()
                          );
                          
                          if (matchingMember) {
                            // If it matches a group member, set the user_id and mark as from group
                            handleParticipantChange(index, 'user_id', matchingMember.id);
                            handleParticipantChange(index, 'auth0_user_id', matchingMember.user_id);
                            // Note: We can't change isFromGroup here, but the user_id will be set
                          } else {
                            // If it doesn't match, clear user_id (custom participant)
                            if (participant.user_id) {
                              handleParticipantChange(index, 'user_id', '');
                              handleParticipantChange(index, 'auth0_user_id', '');
                            }
                          }
                        }}
                        placeholder="Type name (group member or custom)"
                        className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
                      />
                    )}
                  </div>
                  
                  <div className="flex gap-2 items-center">
                    <div>
                      <label className="text-xs text-gray-900">Score</label>
                      <input
                        type="number"
                        step="0.01"
                        value={participant.score || ''}
                        onChange={(e) => handleParticipantChange(index, 'score', e.target.value)}
                        className="w-20 p-1 border rounded text-gray-900 bg-white"
                        placeholder="0"
                      />
                    </div>
                    
                    <div>
                      <label className="text-xs text-gray-900">Faction</label>
                      <input
                        type="text"
                        value={participant.faction || ''}
                        onChange={(e) => handleParticipantChange(index, 'faction', e.target.value)}
                        className="w-24 p-1 border rounded text-gray-900 bg-white"
                        placeholder="Optional"
                      />
                    </div>
                    
                    <div className="flex items-center">
                      <input
                        type="checkbox"
                        checked={participant.is_new_player || false}
                        onChange={(e) => handleParticipantChange(index, 'is_new_player', e.target.checked)}
                        className="mr-1"
                      />
                      <label className="text-xs text-gray-900">New Player</label>
                    </div>
                    
                    <button
                      type="button"
                      onClick={() => toggleParticipant(index)}
                      className="text-red-500 hover:text-red-700 text-sm px-2 py-1 border border-red-300 rounded hover:bg-red-50"
                      title="Remove participant"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addParticipant}
              className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
            >
              + Add Participant
            </button>
          </div>

          {/* Winner Selection */}
          <div>
            <label htmlFor="winner_id" className="block text-sm font-medium mb-1 text-gray-900">
              Winner
            </label>
            <select
              id="winner_id"
              value={newEvent.winner_id || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded text-gray-900 bg-white"
            >
              <option value="">Select winner (optional)</option>
              {newEvent.participants
                .filter(p => p.username && p.username.trim() !== "")
                .map((participant, index) => {
                  // Use user_id if available, otherwise use a custom identifier
                  const value = participant.user_id || `custom_${index}_${participant.username}`;
                  return (
                    <option key={index} value={value}>
                      {participant.username}
                    </option>
                  );
                })}
            </select>
          </div>

          {/* Picked By Selection */}
          <div>
            <label htmlFor="picked_by_id" className="block text-sm font-medium mb-1 text-gray-900">
              Picked By
            </label>
            <select
              id="picked_by_id"
              value={newEvent.picked_by_id || ''}
              onChange={handleChange}
              className="w-full p-2 border rounded text-gray-900 bg-white"
            >
              <option value="">Select who picked the game (optional)</option>
              {newEvent.participants
                .filter(p => p.username && p.username.trim() !== "")
                .map((participant, index) => {
                  // Use user_id if available, otherwise use a custom identifier
                  const value = participant.user_id || `custom_${index}_${participant.username}`;
                  return (
                    <option key={index} value={value}>
                      {participant.username}
                    </option>
                  );
                })}
            </select>
          </div>

          {/* Group Win Checkbox */}
          <div className="flex items-center">
            <input
              type="checkbox"
              id="is_group_win"
              checked={newEvent.is_group_win}
              onChange={handleChange}
              className="mr-2"
            />
            <label htmlFor="is_group_win" className="text-sm font-medium text-gray-900">
              Group Win
            </label>
          </div>

          {/* Comments */}
          <div>
            <label htmlFor="comments" className="block text-sm font-medium mb-1 text-gray-900">
              Comments
            </label>
            <textarea
              id="comments"
              value={newEvent.comments}
              onChange={handleChange}
              rows="3"
              className="w-full p-2 border rounded text-gray-900 bg-white"
              placeholder="Optional notes about this game session"
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={modaltoggle}
              className="px-4 py-2 border border-gray-300 rounded hover:bg-gray-100 text-gray-900 bg-white"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
            >
              {editingEvent ? 'Update Event' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default CreateEvent;

