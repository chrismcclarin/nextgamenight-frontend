'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { gamesAPI, eventsAPI, groupsAPI, ballotAPI, API_BASE_URL } from '../../lib/api';
import { format, parseISO, differenceInMinutes } from 'date-fns';
import EventScheduler from './EventScheduler';
import GameComboInput from './GameComboInput';

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

function CreateEvent({ group_id, modal, modaltoggle, onEventCreated, editingEvent = null, user, prefillDate = null, prefillTime = null, prefillDuration = null, hideVisualCalendar = false }) {
  const authUser = user || Auth().user;
  const [groupMembers, setGroupMembers] = useState([]);
  const [newEvent, setNewEvent] = useState(createEventForm(group_id, []));
  const [loading, setLoading] = useState(true);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [useVisualCalendar, setUseVisualCalendar] = useState(true);
  const [ballotOptions, setBallotOptions] = useState([]);
  const [ballotError, setBallotError] = useState(null);

  // Fetch group members and games when component mounts or group_id changes
  useEffect(() => {
    if (group_id && modal) {
      fetchGroupMembers();
    }
  }, [group_id, modal]);

  // Load existing ballot options when editing an event
  useEffect(() => {
    if (editingEvent && modal) {
      const loadBallot = async () => {
        try {
          const ballot = await ballotAPI.getBallot(editingEvent.id);
          if (ballot && ballot.ballot_status !== null && ballot.options && ballot.options.length > 0) {
            setBallotOptions(ballot.options.map(o => ({ game_id: o.game_id || null, game_name: o.game_name })));
          } else {
            setBallotOptions([]);
          }
        } catch (err) {
          // No ballot exists or error fetching -- that's fine
          setBallotOptions([]);
        }
      };
      loadBallot();
    } else if (!editingEvent) {
      setBallotOptions([]);
    }
  }, [editingEvent, modal]);

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

      // Format rsvp_deadline for datetime-local input
      const rsvpDeadline = editingEvent.rsvp_deadline
        ? new Date(editingEvent.rsvp_deadline).toISOString().slice(0, 16)
        : '';

      setNewEvent({
        group_id: editingEvent.group_id,
        game_id: editingEvent.game_id,
        game_name: editingEvent.Game?.name || '',
        start_date: startDate,
        duration_minutes: editingEvent.duration_minutes || null,
        rsvp_deadline: rsvpDeadline,
        winner_id: winner_id,
        picked_by_id: picked_by_id,
        is_group_win: editingEvent.is_group_win || false,
        comments: editingEvent.comments || '',
        participants: finalParticipants
      });

      // Set selected time slot for visual calendar
      if (editingEvent.start_date) {
        const eventStartDate = new Date(editingEvent.start_date);
        const eventEndDate = editingEvent.duration_minutes 
          ? new Date(eventStartDate.getTime() + editingEvent.duration_minutes * 60000)
          : new Date(eventStartDate.getTime() + 180 * 60000); // Default 3 hours
        
        setSelectedTimeSlot({
          start: eventStartDate,
          end: eventEndDate
        });
      }
    } else if (!editingEvent && groupMembers.length > 0) {
      // Reset to empty form when not editing
      const form = createEventForm(group_id, groupMembers);
      // Pre-fill date and time if provided from planning page
      if (prefillDate && prefillTime) {
        // Combine date and time into datetime-local format (YYYY-MM-DDTHH:mm)
        form.start_date = `${prefillDate}T${prefillTime}`;
      }
      if (prefillDuration) {
        form.duration_minutes = prefillDuration;
      }
      setNewEvent(form);
    }
  }, [editingEvent, groupMembers, group_id, prefillDate, prefillTime, prefillDuration]);

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
        if (prefillDuration) {
          form.duration_minutes = prefillDuration;
        }
        setNewEvent(form);
      }
    } catch (error) {
      console.error('Error fetching group members:', error);
    } finally {
      setLoading(false);
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
      let gameId = newEvent.game_id || null;

      // If user typed a custom game name (no game_id selected), resolve it
      if (!gameId && newEvent.game_name && newEvent.game_name.trim()) {
        try {
          const resolvedGame = await gamesAPI.resolveGame(newEvent.game_name.trim());
          gameId = resolvedGame.id;
        } catch (resolveError) {
          console.error('Error resolving game:', resolveError);
          alert('Failed to create custom game. Please try again.');
          return;
        }
      }

      const eventDataToSubmit = prepareEventData({
        ...newEvent,
        game_id: gameId || null,
      });
      // Remove game_name from submission data (backend doesn't expect it on events)
      delete eventDataToSubmit.game_name;
      
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
      
      // Validate ballot options: if any are provided, need at least 2
      const validBallotOptions = ballotOptions.filter(o => o.game_name && o.game_name.trim());
      if (validBallotOptions.length > 0 && validBallotOptions.length < 2) {
        alert('A ballot requires at least 2 game options. Please add more or remove all options.');
        return;
      }

      // Include rsvp_deadline in the submission data (convert to ISO or null)
      if (newEvent.rsvp_deadline) {
        const rsvpDate = new Date(newEvent.rsvp_deadline);
        eventDataToSubmit.rsvp_deadline = rsvpDate.toISOString();
      } else {
        eventDataToSubmit.rsvp_deadline = null;
      }

      if (editingEvent) {
        // Update existing event
        await eventsAPI.updateEvent(editingEvent.id, eventDataToSubmit, authUser?.sub);

        // Update ballot options if we have valid ones
        if (validBallotOptions.length >= 2) {
          try {
            await ballotAPI.updateBallotOptions(editingEvent.id, validBallotOptions.map(o => ({
              game_id: o.game_id || null,
              game_name: o.game_name.trim()
            })));
          } catch (ballotErr) {
            console.error('Error updating ballot options:', ballotErr);
            setBallotError('Event updated but ballot options could not be saved.');
          }
        }

        if (onEventCreated) {
          onEventCreated(null); // Signal that event was updated
        }
      } else {
        // Create new event using eventsAPI which automatically includes Authorization header
        const data = await eventsAPI.createEvent(eventDataToSubmit);

        // Create ballot options if we have valid ones
        if (validBallotOptions.length >= 2 && data?.id) {
          try {
            await ballotAPI.setBallotOptions(data.id, validBallotOptions.map(o => ({
              game_id: o.game_id || null,
              game_name: o.game_name.trim()
            })));
          } catch (ballotErr) {
            console.error('Error creating ballot options:', ballotErr);
            setBallotError('Event created but ballot options could not be saved.');
          }
        }

        if (onEventCreated) {
          onEventCreated(data);
        }
      }

      modaltoggle();
      // Reset form
      setNewEvent(createEventForm(group_id, groupMembers));
      setBallotOptions([]);
      setBallotError(null);
      setSelectedTimeSlot(null);
      setUseVisualCalendar(true);
    } catch (error) {
      console.error(`Error ${editingEvent ? 'updating' : 'creating'} event:`, error);
      alert(`Failed to ${editingEvent ? 'update' : 'create'} event. ${error.message || 'Please try again.'}`);
    }
  };

  // Memoize initialDate so it doesn't create a new object on every render.
  // A new object reference causes EventScheduler's useEffect to fire and clear
  // the drag selection immediately after the user picks a time slot.
  const calendarInitialDate = useMemo(() => {
    if (prefillDate) return parseISO(prefillDate);
    if (editingEvent?.start_date) return new Date(editingEvent.start_date);
    return new Date();
  }, [prefillDate, editingEvent?.start_date]);

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
          <h2 className="text-2xl font-bold">{editingEvent ? 'Edit Event' : 'Create Event'}</h2>
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
            <label className="block text-sm font-medium text-gray-900 mb-1">
              Game
            </label>
            <GameComboInput
              value={{ game_id: newEvent.game_id, game_name: newEvent.game_name }}
              onChange={({ game_id, game_name }) => {
                setNewEvent(prev => ({ ...prev, game_id: game_id || '', game_name: game_name || '' }));
              }}
              groupId={group_id}
              userId={authUser?.sub}
              placeholder="Search for a game or type a name"
            />
          </div>

          {/* Time Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-900">
                Date & Time <span className="text-red-500">*</span>
              </label>
              {!hideVisualCalendar && (
                <button
                  type="button"
                  onClick={() => setUseVisualCalendar(!useVisualCalendar)}
                  className="text-xs text-blue-600 hover:text-blue-700 underline"
                >
                  {useVisualCalendar ? 'Switch to Manual Entry' : 'Switch to Visual Calendar'}
                </button>
              )}
            </div>

            {useVisualCalendar && !hideVisualCalendar ? (
              <EventScheduler
                onTimeSelected={(start, end) => {
                  setSelectedTimeSlot({ start, end });
                  const dateStr = format(start, 'yyyy-MM-dd');
                  const timeStr = format(start, 'HH:mm');
                  const duration = differenceInMinutes(end, start);
                  
                  setNewEvent({
                    ...newEvent,
                    start_date: `${dateStr}T${timeStr}`,
                    duration_minutes: duration
                  });
                }}
                initialDate={calendarInitialDate}
                initialStart={prefillTime || (editingEvent?.start_date ? format(new Date(editingEvent.start_date), 'HH:mm') : null)}
                initialEnd={editingEvent?.start_date && editingEvent?.duration_minutes 
                  ? format(new Date(new Date(editingEvent.start_date).getTime() + editingEvent.duration_minutes * 60000), 'HH:mm')
                  : null}
              />
            ) : (
              <div className="space-y-4">
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
              </div>
            )}
          </div>

          {/* RSVP Deadline */}
          {newEvent.start_date && new Date(newEvent.start_date) > new Date() && (
            <div>
              <label htmlFor="rsvp_deadline" className="block text-sm font-medium mb-1 text-gray-900">
                RSVP Deadline
              </label>
              <p className="text-xs text-gray-500 mb-1">Required for game voting ballot</p>
              <input
                type="datetime-local"
                id="rsvp_deadline"
                value={newEvent.rsvp_deadline || ''}
                onChange={handleChange}
                className="w-full p-2 border rounded text-gray-900 bg-white"
                max={newEvent.start_date}
              />
            </div>
          )}

          {/* Game Ballot Section */}
          {newEvent.rsvp_deadline && (
            <div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
              <div className="mb-3">
                <h3 className="text-sm font-semibold text-gray-900">Game Ballot (optional)</h3>
                <p className="text-xs text-gray-500">Add 2-10 games for your group to vote on</p>
              </div>

              {ballotError && (
                <p className="text-sm text-red-600 mb-2">{ballotError}</p>
              )}

              <div className="space-y-2">
                {ballotOptions.map((option, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <div className="flex-1">
                      <GameComboInput
                        value={{ game_id: option.game_id, game_name: option.game_name }}
                        onChange={({ game_id, game_name }) => {
                          const updated = [...ballotOptions];
                          updated[index] = { game_id: game_id || null, game_name: game_name || '' };
                          setBallotOptions(updated);
                        }}
                        groupId={group_id}
                        userId={authUser?.sub}
                        placeholder={`Game option ${index + 1}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setBallotOptions(ballotOptions.filter((_, i) => i !== index));
                      }}
                      className="text-red-500 hover:text-red-700 text-lg px-2 py-1 flex-shrink-0"
                      title="Remove option"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>

              {ballotOptions.length < 10 && (
                <button
                  type="button"
                  onClick={() => setBallotOptions([...ballotOptions, { game_id: null, game_name: '' }])}
                  className="mt-2 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 text-sm font-medium"
                >
                  + Add game option
                </button>
              )}

              {ballotOptions.length > 0 && ballotOptions.length < 2 && (
                <p className="text-xs text-amber-600 mt-2">Add at least 2 games to create a ballot</p>
              )}
            </div>
          )}

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

