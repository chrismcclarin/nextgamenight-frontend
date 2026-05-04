'use client';

import { useState, useEffect, useMemo } from 'react';
import { useUser as Auth } from '@auth0/nextjs-auth0/client';
import { gamesAPI, eventsAPI, groupsAPI, ballotAPI, availabilityAPI, API_BASE_URL } from '../../lib/api';
import { format, parseISO, differenceInMinutes, startOfWeek } from 'date-fns';
import EventScheduler from './EventScheduler';
import EventHeatmapBackground from './EventHeatmapBackground';
import GameComboInput from './GameComboInput';
import QuickSuggestions from './QuickSuggestions';
import { createParticipant, createEventForm, prepareEventData } from '../../lib/eventFormUtils';
import ParticipantRow from './ParticipantRow';
import BallotOptionsEditor from './BallotOptionsEditor';
import EventResultFields from './EventResultFields';
import { useTimezone } from './TimezoneProvider';
import { utcToWallClock, wallClockToUtc } from '../../lib/tzUtils';
import TimezoneNudgeBanner from './TimezoneNudgeBanner';

function CreateEvent({ group_id, modal, modaltoggle, onEventCreated, editingEvent = null, user, prefillDate = null, prefillTime = null, prefillDuration = null, prefillGameId = null, prefillGameName = null, hideVisualCalendar = false, userRole, initialVisualView = 'week' }) {
  const authUser = user || Auth().user;
  const { timezone, browserTimezone } = useTimezone();
  const effectiveTz = timezone || browserTimezone || 'UTC';
  const [groupMembers, setGroupMembers] = useState([]);
  const [newEvent, setNewEvent] = useState(createEventForm(group_id, []));
  const [loading, setLoading] = useState(true);
  const [selectedTimeSlot, setSelectedTimeSlot] = useState(null);
  const [useVisualCalendar, setUseVisualCalendar] = useState(true);
  const [ballotOptions, setBallotOptions] = useState([]);
  const [ballotError, setBallotError] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapWeekStart, setHeatmapWeekStart] = useState(null);

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
      // Format start_date for datetime-local input (YYYY-MM-DDTHH:mm) using
      // the viewer's PROFILE timezone (not browser TZ). This is the headline
      // TZ-01 fix — see Phase 62-02. utcToWallClock returns wall-clock parts
      // in `timezone`, never in browser-local.
      const startDate = editingEvent.start_date
        ? (() => {
            const wc = utcToWallClock(editingEvent.start_date, timezone);
            if (!wc) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${wc.year}-${pad(wc.month)}-${pad(wc.day)}T${pad(wc.hours)}:${pad(wc.minutes)}`;
          })()
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

      // Format rsvp_deadline for datetime-local input using the viewer's
      // PROFILE timezone — same TZ-01 fix as start_date above.
      const rsvpDeadline = editingEvent.rsvp_deadline
        ? (() => {
            const wc = utcToWallClock(editingEvent.rsvp_deadline, timezone);
            if (!wc) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${wc.year}-${pad(wc.month)}-${pad(wc.day)}T${pad(wc.hours)}:${pad(wc.minutes)}`;
          })()
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
      } else if (prefillDate) {
        // Phase 65-03 EVT-05: date-only prefill from game-detail "Plan a
        // game night with this" CTA (?date=YYYY-MM-DD). Default the time
        // to 19:00 (a reasonable game-night start) so the datetime-local
        // input has a complete value.
        form.start_date = `${prefillDate}T19:00`;
      }
      if (prefillDuration) {
        form.duration_minutes = prefillDuration;
      }
      // Phase 65-03 EVT-05: pre-select the game when launched from the
      // game-detail page. prefillGameName fills the GameComboInput's
      // visible label so users immediately see the game is selected.
      if (prefillGameId) {
        form.game_id = prefillGameId;
        if (prefillGameName) form.game_name = prefillGameName;
      }
      setNewEvent(form);
    }
  }, [editingEvent, groupMembers, group_id, prefillDate, prefillTime, prefillDuration, prefillGameId, prefillGameName, timezone]);

  // Fetch heatmap data when modal opens or effective timezone changes.
  // HEAT-01: week-start MUST be Monday-of-week as observed in the user's
  // profile TZ (not browser TZ) so that users near midnight or with profile
  // TZ != browser TZ see the correct week. Re-fetches on effectiveTz change
  // (e.g. profile TZ updated mid-session via TimezoneProvider).
  useEffect(() => {
    if (!modal || !group_id) return;
    const fetchHeatmap = async () => {
      try {
        setHeatmapLoading(true);
        // Resolve "today" as observed in the user's effective TZ, then snap to Monday.
        // Build a Date at noon UTC of that wall-clock date so date-only ops are TZ-safe.
        const nowWall = utcToWallClock(new Date(), effectiveTz);
        const localToday = new Date(Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day, 12, 0, 0));
        const monday = startOfWeek(localToday, { weekStartsOn: 1 });
        const weekStartStr = format(monday, 'yyyy-MM-dd');
        const data = await availabilityAPI.getGroupHeatmap(group_id, weekStartStr, effectiveTz);
        setHeatmapData(data);
        setHeatmapWeekStart(monday);
      } catch (err) {
        console.error('Failed to load heatmap:', err);
        // Silently fail -- heatmap is a nice-to-have visual, not critical
      } finally {
        setHeatmapLoading(false);
      }
    };
    fetchHeatmap();
  }, [modal, group_id, effectiveTz]);

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
        } else if (prefillDate) {
          // Phase 65-03 EVT-05: date-only prefill (e.g. ?date=YYYY-MM-DD
          // from game-detail page) — default time to 19:00.
          form.start_date = `${prefillDate}T19:00`;
        }
        if (prefillDuration) {
          form.duration_minutes = prefillDuration;
        }
        // Phase 65-03 EVT-05: pre-select game from game-detail page CTA.
        if (prefillGameId) {
          form.game_id = prefillGameId;
          if (prefillGameName) form.game_name = prefillGameName;
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

  // Derive participant count for QuickSuggestions
  const participantCount = newEvent.participants.length;

  // Handle suggestion selection — fill game field in form
  const handleSuggestionSelect = (game) => {
    setNewEvent(prev => ({ ...prev, game_id: game.id, game_name: game.name }));
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
      
      // Use the viewer's PROFILE timezone (with browser-TZ fallback handled
      // inside TimezoneProvider) for converting wall-clock back to UTC.
      // This is the headline TZ-01 save-side fix — see Phase 62-02. We never
      // call Intl.DateTimeFormat().resolvedOptions().timeZone here, because
      // that would leak browser TZ when the user's profile TZ is different
      // (e.g., traveling).
      const userTimezone = timezone;

      if (eventDataToSubmit.start_date) {
        // datetime-local input value is "YYYY-MM-DDTHH:mm" — interpret it as
        // a wall-clock in the viewer's profile TZ and convert to UTC.
        const utc = wallClockToUtc(eventDataToSubmit.start_date, userTimezone);
        if (!utc) {
          alert('Invalid start date/time. Please re-enter and try again.');
          return;
        }
        eventDataToSubmit.start_date = utc.toISOString();
      }

      // Add timezone to event data for Google Calendar creation
      eventDataToSubmit.timezone = userTimezone;
      
      // Validate ballot options: if any are provided, need at least 2
      const validBallotOptions = ballotOptions.filter(o => o.game_name && o.game_name.trim());
      if (validBallotOptions.length > 0 && validBallotOptions.length < 2) {
        alert('A ballot requires at least 2 game options. Please add more or remove all options.');
        return;
      }

      // Include rsvp_deadline in the submission data — same TZ-01 wall-clock
      // → profile-TZ → UTC conversion as start_date above.
      if (newEvent.rsvp_deadline) {
        const utc = wallClockToUtc(newEvent.rsvp_deadline, userTimezone);
        if (!utc) {
          alert('Invalid RSVP deadline. Please re-enter and try again.');
          return;
        }
        eventDataToSubmit.rsvp_deadline = utc.toISOString();
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
        // Include ballot options in the event creation payload for atomic creation
        // This ensures ballot exists BEFORE notifications fire (so ballot link is included)
        if (validBallotOptions.length >= 2) {
          eventDataToSubmit.ballot_options = validBallotOptions.map(o => ({
            game_id: o.game_id || null,
            game_name: o.game_name.trim()
          }));
        }

        // Create new event (with ballot options atomically if provided)
        const data = await eventsAPI.createEvent(eventDataToSubmit);

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
      <div className="modal-overlay">
        <div className="modal-content p-6">Loading group members...</div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={modaltoggle}>
      <div className="modal-content max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-content-primary">{editingEvent ? 'Edit Event' : 'Create Event'}</h2>
          <button
            onClick={modaltoggle}
            className="text-content-muted hover:text-content-primary text-2xl"
          >
            ×
          </button>
        </div>

        {/* Phase 62-02: nudge user to set profile TZ before editing/creating
            so saved start_date is stamped against a stable canonical TZ. */}
        <TimezoneNudgeBanner />

        <form onSubmit={onSubmit} className="space-y-4">
          {/* Game Selection */}
          <div>
            <label className="block text-sm font-medium text-content-primary mb-1">
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
            <QuickSuggestions
              groupId={group_id}
              playerCount={participantCount}
              duration={newEvent.duration_minutes}
              onSelectGame={handleSuggestionSelect}
              eventId={editingEvent?.id}
              userRole={userRole}
            />
          </div>

          {/* Time Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-content-primary">
                Date & Time <span className="text-red-500">*</span>
              </label>
              {!hideVisualCalendar && (
                <button
                  type="button"
                  onClick={() => setUseVisualCalendar(!useVisualCalendar)}
                  className="text-xs text-content-link hover:text-content-link-hover underline"
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
                initialStart={prefillTime || (() => {
                  if (!editingEvent?.start_date) return null;
                  const wc = utcToWallClock(editingEvent.start_date, timezone);
                  if (!wc) return null;
                  return `${String(wc.hours).padStart(2, '0')}:${String(wc.minutes).padStart(2, '0')}`;
                })()}
                initialEnd={(() => {
                  if (!editingEvent?.start_date || !editingEvent?.duration_minutes) return null;
                  const endUtc = new Date(new Date(editingEvent.start_date).getTime() + editingEvent.duration_minutes * 60000);
                  const wc = utcToWallClock(endUtc, timezone);
                  if (!wc) return null;
                  return `${String(wc.hours).padStart(2, '0')}:${String(wc.minutes).padStart(2, '0')}`;
                })()}
                heatmapData={heatmapData}
                defaultView={initialVisualView}
              />
            ) : (
              <div className="space-y-4">
                {/* Heatmap reference for manual entry mode */}
                {(heatmapData || heatmapLoading) && (
                  <div className="bg-surface-page rounded-lg p-3 border border-line">
                    <p className="text-xs font-medium text-content-muted mb-2">
                      {heatmapWeekStart && !heatmapLoading
                        ? `Week of ${format(heatmapWeekStart, 'EEE MMM d')}`
                        : 'Group Availability This Week'}
                    </p>
                    <EventHeatmapBackground heatmapData={heatmapData} loading={heatmapLoading} />
                  </div>
                )}
                {/* Start Date */}
                <div>
                  <label htmlFor="start_date" className="block text-sm font-medium mb-1 text-content-primary">
                    Start Date & Time {!editingEvent && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="datetime-local"
                    id="start_date"
                    value={newEvent.start_date}
                    onChange={handleChange}
                    required={!editingEvent}
                    className="w-full p-2 border rounded text-content-primary bg-surface-input"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label htmlFor="duration_minutes" className="block text-sm font-medium mb-1 text-content-primary">
                    Duration (minutes) {!editingEvent && <span className="text-red-500">*</span>}
                  </label>
                  <input
                    type="number"
                    id="duration_minutes"
                    value={newEvent.duration_minutes || ''}
                    onChange={handleChange}
                    className="w-full p-2 border rounded text-content-primary bg-surface-input"
                    placeholder="Enter duration in minutes"
                    required={!editingEvent}
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
              <label htmlFor="rsvp_deadline" className="block text-sm font-medium mb-1 text-content-primary">
                RSVP Deadline
              </label>
              <p className="text-xs text-content-muted mb-1">Required for game voting ballot</p>
              <input
                type="datetime-local"
                id="rsvp_deadline"
                value={newEvent.rsvp_deadline || ''}
                onChange={handleChange}
                className="w-full p-2 border rounded text-content-primary bg-surface-input"
                max={newEvent.start_date}
              />
            </div>
          )}

          {/* Game Ballot Section */}
          {newEvent.rsvp_deadline && (
            <BallotOptionsEditor
              ballotOptions={ballotOptions}
              setBallotOptions={setBallotOptions}
              ballotError={ballotError}
              groupId={group_id}
              userId={authUser?.sub}
            />
          )}

          {/* Participants Section */}
          <div>
            <label className="block text-sm font-medium mb-2 text-content-primary">
              Participants <span className="text-red-500">*</span>
            </label>
            <div className="space-y-2 max-h-60 overflow-y-auto border border-line p-2 rounded bg-surface-input">
              {newEvent.participants.map((participant, index) => (
                <ParticipantRow
                  key={index}
                  participant={participant}
                  index={index}
                  groupMembers={groupMembers}
                  onParticipantChange={handleParticipantChange}
                  onToggleParticipant={toggleParticipant}
                />
              ))}
            </div>
            <button
              type="button"
              onClick={addParticipant}
              className="mt-2 btn btn-primary text-sm"
            >
              + Add Participant
            </button>
          </div>

          {/* Winner, Picked By, and Group Win - only show for past events */}
          {newEvent.start_date && new Date(newEvent.start_date) <= new Date() && (
            <EventResultFields newEvent={newEvent} handleChange={handleChange} />
          )}

          {/* Comments */}
          <div>
            <label htmlFor="comments" className="block text-sm font-medium mb-1 text-content-primary">
              Comments
            </label>
            <textarea
              id="comments"
              value={newEvent.comments}
              onChange={handleChange}
              rows="3"
              className="w-full p-2 border rounded text-content-primary bg-surface-input"
              placeholder="Optional notes about this game session"
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-2 justify-end">
            <button
              type="button"
              onClick={modaltoggle}
              className="btn btn-secondary"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn btn-primary"
            >
              {editingEvent ? 'Update Event' : 'Create Event'}
            </button>
          </div>
        </form>
        </div>
      </div>
    </div>
  );
}

export default CreateEvent;

