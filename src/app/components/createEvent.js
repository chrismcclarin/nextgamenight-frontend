'use client';

import { useState, useEffect, useMemo } from 'react';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { gamesAPI, eventsAPI, groupsAPI, ballotAPI, availabilityAPI, promptAPI, API_BASE_URL } from '../../lib/api';
import { format, parseISO, differenceInMinutes, startOfWeek, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import EventScheduler from './EventScheduler';
import EventHeatmapBackground from './EventHeatmapBackground';
import GameComboInput from './GameComboInput';
import QuickSuggestions from './QuickSuggestions';
import useSwipeNavigation from './useSwipeNavigation';
import { createParticipant, createEventForm, prepareEventData } from '../../lib/eventFormUtils';
import ParticipantRow from './ParticipantRow';
import BallotOptionsEditor from './BallotOptionsEditor';
import EventResultFields from './EventResultFields';
import { useTimezone } from './TimezoneProvider';
import { utcToWallClock, wallClockToUtc } from '../../lib/tzUtils';
import TimezoneNudgeBanner from './TimezoneNudgeBanner';
import { toast } from 'sonner';

function CreateEvent({ group_id, modal, modaltoggle, onEventCreated, editingEvent = null, user, prefillDate = null, prefillTime = null, prefillDuration = null, prefillGameId = null, prefillGameName = null, hideVisualCalendar = false, userRole, initialVisualView = 'week', promptId = null }) {
  // Identity: send the caller's resolved Users.id UUID to searchAll (via the two
  // GameComboInput userId props below), not the Auth0 sub (87.5 BINT-02). searchAll
  // fires only on user typing, and GameComboInput's search useCallback already
  // deps on userId, so the resolved UUID re-binds the moment identity settles.
  const { selfUuid } = useSelfIdentity();
  const { timezone, browserTimezone } = useTimezone();
  const effectiveTz = timezone || browserTimezone || 'UTC';
  const [groupMembers, setGroupMembers] = useState([]);
  const [newEvent, setNewEvent] = useState(createEventForm(group_id, []));
  const [loading, setLoading] = useState(true);
  const [useVisualCalendar, setUseVisualCalendar] = useState(true);
  const [ballotOptions, setBallotOptions] = useState([]);
  const [ballotError, setBallotError] = useState(null);
  const [heatmapData, setHeatmapData] = useState(null);
  const [heatmapLoading, setHeatmapLoading] = useState(false);
  const [heatmapWeekStart, setHeatmapWeekStart] = useState(null);
  // Phase 72 HUX-04: user-controlled week navigation for the manual-entry
  // heatmap. null sentinel = "use today's Monday in effective TZ" (page-load
  // / modal-open default). Reset back to null on modal open / promptId change
  // so reopening always centers on today (CONTEXT — no localStorage).
  const [currentWeekStart, setCurrentWeekStart] = useState(null);
  // (hover: none) detection for gating swipe gestures.
  const [isHoverNone, setIsHoverNone] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia('(hover: none)');
    const update = () => setIsHoverNone(mq.matches);
    update();
    mq.addEventListener('change', update);
    return () => mq.removeEventListener('change', update);
  }, []);

  // Phase 66-01: derive the visual scheduler's `selectedSlot` from the
  // canonical date/time fields. This is the single source of truth — both
  // manual mode (datetime-local input + duration input) and visual mode
  // (drag-to-select) read/write through `newEvent.start_date` and
  // `newEvent.duration_minutes`. The slot highlight is a pure projection.
  // Round-trips (visual → manual → visual) preserve the highlight because
  // the parent state never resets across mode toggles.
  const derivedSelectedSlot = useMemo(() => {
    if (!newEvent.start_date || !newEvent.duration_minutes) return null;
    try {
      const start = parseISO(newEvent.start_date);
      if (isNaN(start.getTime())) return null;
      const end = new Date(start.getTime() + newEvent.duration_minutes * 60000);
      return { start, end };
    } catch {
      return null;
    }
  }, [newEvent.start_date, newEvent.duration_minutes]);

  // Phase 66-03 CREVT-06: scroll the visual scheduler to the peak-availability
  // slot whenever heatmapData is loaded. Scope to prefillDate's day if set
  // (day-tap path), otherwise the full week. Tie-break: earliest of top tier.
  // Returns a Date whose time-of-day is what scrollToTime reads (date portion
  // ignored by react-big-calendar). No auto-scroll when totalMembers is 0
  // or no slots have any availability — calendar uses its default scroll.
  const peakScrollTime = useMemo(() => {
    if (!heatmapData?.slots || heatmapData.slots.length === 0) return null;
    if (!heatmapData.totalMembers || heatmapData.totalMembers === 0) return null;

    // Build candidate set: filter to prefillDate's day if present, else all slots.
    // slot.date is "YYYY-MM-DD" in UTC; slot.hour is 0-23 UTC. Convert to the
    // user's effective TZ (matches what EventScheduler displays — same idiom
    // as EventScheduler.heatmapLookup so peak hour aligns visually with tints).
    const candidates = heatmapData.slots
      .map(s => {
        const utcDate = new Date(`${s.date}T${String(s.hour).padStart(2, '0')}:00:00Z`);
        const localDateStr = format(utcDate, 'yyyy-MM-dd');
        const localHour = utcDate.getHours();
        return {
          localDateStr,
          localHour,
          availableCount: s.availableCount || 0,
        };
      })
      .filter(c => {
        if (!prefillDate) return true;
        return c.localDateStr === prefillDate;
      });

    if (candidates.length === 0) return null;

    // Find max availableCount; tie-break by earliest (date asc, then hour asc)
    const maxCount = Math.max(...candidates.map(c => c.availableCount));
    if (maxCount === 0) return null; // no data → no scroll

    const winner = candidates
      .filter(c => c.availableCount === maxCount)
      .sort((a, b) => {
        if (a.localDateStr !== b.localDateStr) return a.localDateStr < b.localDateStr ? -1 : 1;
        return a.localHour - b.localHour;
      })[0];

    // Return a Date whose hour-of-day is the peak hour. react-big-calendar's
    // scrollToTime only uses time-of-day; date portion is irrelevant.
    const t = new Date();
    t.setHours(winner.localHour, 0, 0, 0);
    return t;
  }, [heatmapData, prefillDate]);

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
            createParticipant(member.id, member.username, true)
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

      // Phase 66-01: visual-calendar slot highlight is now derived from
      // newEvent.start_date + duration_minutes via `derivedSelectedSlot`
      // (useMemo above). No separate setSelectedTimeSlot call needed —
      // setting start_date + duration_minutes above is sufficient.
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

        // Phase 71.2 / Plan 03 hotfix — when arriving via a poll-closed CTA
        // (promptId in URL), the heatmap shows ONLY this poll's submitted
        // responses, not the group's standard availability. Same shape, so
        // EventHeatmapBackground renders unchanged. Week anchor is the
        // earliest response date so the picker centers on the poll's window.
        if (promptId) {
          const data = await promptAPI.getPromptHeatmap(promptId);
          setHeatmapData(data);
          if (data?.weekStart) {
            // weekStart is YYYY-MM-DD UTC; snap a noon-UTC Date for stable date-only ops.
            const [y, m, d] = data.weekStart.split('-').map(Number);
            const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
            setHeatmapWeekStart(startOfWeek(anchor, { weekStartsOn: 1 }));
          }
          return;
        }

        // Resolve "today" as observed in the user's effective TZ, then snap to Monday.
        // Build a Date at noon UTC of that wall-clock date so date-only ops are TZ-safe.
        const nowWall = utcToWallClock(new Date(), effectiveTz);
        const localToday = new Date(Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day, 12, 0, 0));
        const todayMondayLocal = startOfWeek(localToday, { weekStartsOn: 1 });
        // Phase 72 HUX-04 — user-navigated week overrides the "today" default.
        // null currentWeekStart means "show today" (page-load / modal-open).
        const effectiveMonday = currentWeekStart || todayMondayLocal;
        const weekStartStr = format(effectiveMonday, 'yyyy-MM-dd');
        const data = await availabilityAPI.getGroupHeatmap(group_id, weekStartStr, effectiveTz);
        setHeatmapData(data);
        setHeatmapWeekStart(effectiveMonday);
      } catch (err) {
        console.error('Failed to load heatmap:', err);
        // Silently fail -- heatmap is a nice-to-have visual, not critical
      } finally {
        setHeatmapLoading(false);
      }
    };
    fetchHeatmap();
  }, [modal, group_id, effectiveTz, promptId, currentWeekStart]);

  // Phase 72 HUX-04: reset to current week on modal open / promptId change.
  // CONTEXT — no localStorage / no URL state; page-load reset semantics.
  useEffect(() => {
    setCurrentWeekStart(null);
  }, [modal, promptId]);

  // Phase 72 HUX-04 — week-nav range / handlers for the manual-entry heatmap.
  // Only used when !promptId (poll-restricted path stays anchored).
  // todayMonday is computed from the user's effective TZ so users near
  // midnight or with profile TZ ≠ browser TZ see the correct "today".
  const todayMonday = useMemo(() => {
    const nowWall = utcToWallClock(new Date(), effectiveTz);
    const localToday = new Date(Date.UTC(nowWall.year, nowWall.month - 1, nowWall.day, 12, 0, 0));
    return startOfWeek(localToday, { weekStartsOn: 1 });
  }, [effectiveTz]);
  const minWeek = useMemo(() => subWeeks(todayMonday, 3), [todayMonday]);
  const maxWeek = useMemo(() => addWeeks(todayMonday, 12), [todayMonday]);
  const effectiveMondayForUI = currentWeekStart || todayMonday;
  const canGoBack = effectiveMondayForUI > minWeek;
  const canGoForward = effectiveMondayForUI < maxWeek;
  const handlePrevWeek = () => {
    if (canGoBack) setCurrentWeekStart(subWeeks(effectiveMondayForUI, 1));
  };
  const handleNextWeek = () => {
    if (canGoForward) setCurrentWeekStart(addWeeks(effectiveMondayForUI, 1));
  };
  // null sentinel = "use today's Monday" (page-load reset). Today button
  // returns to the null-state which the fetch effect resolves to today's
  // actual Monday — label-accurate semantics consistent with HeatmapGrid
  // and MergedHeatmap.
  const handleToday = () => setCurrentWeekStart(null);
  const isOnTodayMonday = isSameWeek(effectiveMondayForUI, todayMonday, { weekStartsOn: 1 });

  // CONTEXT note: the long-press-drag-to-select gesture from Phase 68 MOB-07
  // lives on EventScheduler (visual-calendar mode). EventHeatmapBackground
  // is only rendered in manual-entry mode — these two modes are mutually
  // exclusive (toggled via `useVisualCalendar`). The swipe handler here
  // therefore cannot collide with the EventScheduler drag-select gesture.
  const swipeHandlers = useSwipeNavigation({
    onSwipeLeft: handleNextWeek,
    onSwipeRight: handlePrevWeek,
    enabled: !promptId && isHoverNone,
  });

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
      participants: [...newEvent.participants, createParticipant("", "", false)]
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
          toast.error('Failed to create custom game. Please try again.');
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
          toast.error('Invalid start date/time. Please re-enter and try again.');
          return;
        }
        eventDataToSubmit.start_date = utc.toISOString();
      }

      // Add timezone to event data for Google Calendar creation
      eventDataToSubmit.timezone = userTimezone;
      
      // Validate ballot options: if any are provided, need at least 2
      const validBallotOptions = ballotOptions.filter(o => o.game_name && o.game_name.trim());
      if (validBallotOptions.length > 0 && validBallotOptions.length < 2) {
        toast.error('A ballot requires at least 2 game options. Please add more or remove all options.');
        return;
      }
      // Phase 87 (adversarial review #6/#7): the backend de-dups ballot options
      // by trimmed game_name, so two options with the same name collapse to one
      // and the ballot would be rejected server-side (400). Block it here with a
      // clear inline message so duplicate names never reach submit.
      if (validBallotOptions.length >= 2) {
        const distinctNames = new Set(validBallotOptions.map(o => o.game_name.trim()));
        if (distinctNames.size < 2) {
          toast.error('Ballot options must have at least 2 different games. Please give each option a distinct name.');
          return;
        }
      }

      // Include rsvp_deadline in the submission data — same TZ-01 wall-clock
      // → profile-TZ → UTC conversion as start_date above.
      if (newEvent.rsvp_deadline) {
        const utc = wallClockToUtc(newEvent.rsvp_deadline, userTimezone);
        if (!utc) {
          toast.error('Invalid RSVP deadline. Please re-enter and try again.');
          return;
        }
        eventDataToSubmit.rsvp_deadline = utc.toISOString();
      } else {
        eventDataToSubmit.rsvp_deadline = null;
      }

      if (editingEvent) {
        // Update existing event
        await eventsAPI.updateEvent(editingEvent.id, eventDataToSubmit);

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
      // Reset form. Phase 66-01: derivedSelectedSlot resets automatically
      // when newEvent.start_date is cleared by createEventForm — no separate
      // selectedTimeSlot reset needed.
      setNewEvent(createEventForm(group_id, groupMembers));
      setBallotOptions([]);
      setBallotError(null);
      setUseVisualCalendar(true);
    } catch (error) {
      console.error(`Error ${editingEvent ? 'updating' : 'creating'} event:`, error);
      toast.error(`Failed to ${editingEvent ? 'update' : 'create'} event. ${error.message || 'Please try again.'}`);
    }
  };

  // Memoize initialDate so it doesn't create a new object on every render.
  // A new object reference causes EventScheduler's useEffect to fire and clear
  // the drag selection immediately after the user picks a time slot.
  const calendarInitialDate = useMemo(() => {
    if (prefillDate) return parseISO(prefillDate);
    if (editingEvent?.start_date) return new Date(editingEvent.start_date);
    // Phase 71.2 / Plan 03 hotfix — when arriving from a poll-closed CTA the
    // user has no prefilled slot, but the heatmap response carries weekStart
    // (earliest viable slot date). Anchor the calendar there so the rendered
    // week actually contains the poll's slots; otherwise the calendar opens
    // on the current week and no green tiles appear.
    if (promptId && heatmapData?.weekStart) {
      return parseISO(heatmapData.weekStart);
    }
    // Keep the visual calendar synced to the heatmap-navigated week so that
    // backend slot data (keyed for the navigated week) lines up with the
    // calendar's rendered week. Without this, navigating weeks updated the
    // heatmap data but left the calendar showing today's week, producing a
    // blank grid in next/prior-week views.
    if (heatmapWeekStart) return heatmapWeekStart;
    return new Date();
  }, [prefillDate, editingEvent?.start_date, promptId, heatmapData?.weekStart, heatmapWeekStart]);

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
              userId={selfUuid}
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
              <>
                <EventScheduler
                onWeekChange={(date) => {
                  // Bubble react-big-calendar nav into currentWeekStart so the
                  // heatmap fetch re-fires for the navigated week. Skip the
                  // update when the date is in the same week we already have
                  // (day-view nav within a week shouldn't trigger a refetch),
                  // and clamp to the same -3/+12 bounds the manual-mode nav
                  // buttons enforce so the backend doesn't 400 on out-of-range
                  // weeks.
                  const navMonday = startOfWeek(date, { weekStartsOn: 1 });
                  if (isSameWeek(navMonday, effectiveMondayForUI, { weekStartsOn: 1 })) return;
                  if (navMonday < minWeek || navMonday > maxWeek) return;
                  setCurrentWeekStart(navMonday);
                }}
                onTimeSelected={(start, end) => {
                  // Phase 66-01: write canonical fields only. The visual
                  // highlight will round-trip back via derivedSelectedSlot
                  // → selectedSlot prop, so no separate selectedTimeSlot
                  // local state is needed.
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
                selectedSlot={derivedSelectedSlot}
                heatmapData={heatmapData}
                defaultView={initialVisualView}
                scrollToTime={peakScrollTime}
              />
              </>
            ) : (
              <div className="space-y-4">
                {/* Heatmap reference for manual entry mode.
                    Phase 72 HUX-04 — group-availability path (`!promptId`)
                    gets full week navigation (Prev / Today / Week label /
                    Next + mobile swipe). Poll-restricted path (promptId set)
                    stays anchored to the poll's weekStart; no nav UI. */}
                {(heatmapData || heatmapLoading) && (
                  <div
                    className="bg-surface-page rounded-lg p-3 border border-line"
                    onTouchStart={!promptId ? swipeHandlers.onTouchStart : undefined}
                    onTouchMove={!promptId ? swipeHandlers.onTouchMove : undefined}
                    onTouchEnd={!promptId ? swipeHandlers.onTouchEnd : undefined}
                    onTouchCancel={!promptId ? swipeHandlers.onTouchCancel : undefined}
                  >
                    {!promptId && (
                      <div className="flex items-center justify-between mb-2 gap-2">
                        <button
                          type="button"
                          onClick={handlePrevWeek}
                          disabled={!canGoBack}
                          aria-label="Previous week"
                          className="px-2 py-1 text-sm rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary"
                        >
                          &lt;
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-content-muted">
                            Week of {format(effectiveMondayForUI, 'EEE MMM d')}
                          </span>
                          <button
                            type="button"
                            onClick={handleToday}
                            disabled={isOnTodayMonday}
                            aria-label="Jump to current week"
                            className="px-2 py-1 text-xs rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary"
                          >
                            Today
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleNextWeek}
                          disabled={!canGoForward}
                          aria-label="Next week"
                          className="px-2 py-1 text-sm rounded bg-surface-elevated hover:bg-surface-card-hover disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary"
                        >
                          &gt;
                        </button>
                      </div>
                    )}
                    {promptId && (
                      <p className="text-xs font-medium text-content-muted mb-2">
                        {heatmapWeekStart && !heatmapLoading
                          ? `Week of ${format(heatmapWeekStart, 'EEE MMM d')}`
                          : 'Poll Availability'}
                      </p>
                    )}
                    <EventHeatmapBackground
                      heatmapData={heatmapData}
                      loading={heatmapLoading}
                      anchorDate={
                        promptId
                          ? heatmapData?.weekStart
                          : (heatmapWeekStart ? format(heatmapWeekStart, 'yyyy-MM-dd') : null)
                      }
                    />
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
                    max="9999-12-31T23:59"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label htmlFor="duration_minutes" className="block text-sm font-medium mb-1 text-content-primary">
                    Duration (minutes) {!editingEvent && <span className="text-red-500">*</span>}
                  </label>
                  {(() => {
                    // Phase 66-03 CREVT-02 polish: inline error + red border when
                    // user types a value over the 720-minute (12h) cap. Native
                    // browser validation still blocks submit via max="720"; this
                    // is added user feedback, not a replacement.
                    const durationOverMax = newEvent.duration_minutes && Number(newEvent.duration_minutes) > 720;
                    return (
                      <>
                        <input
                          type="number"
                          id="duration_minutes"
                          value={newEvent.duration_minutes || ''}
                          onChange={handleChange}
                          className={`w-full p-2 border rounded text-content-primary bg-surface-input ${durationOverMax ? 'border-status-error' : ''}`}
                          placeholder="Enter duration in minutes"
                          required={!editingEvent}
                          min="1"
                          max="720"
                        />
                        {durationOverMax && (
                          <p className="text-status-error text-xs mt-1">Maximum 12 hours (720 minutes)</p>
                        )}
                      </>
                    );
                  })()}
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
                max={newEvent.start_date && newEvent.start_date < '9999-12-31T23:59' ? newEvent.start_date : '9999-12-31T23:59'}
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
              userId={selfUuid}
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
              data-testid="create-event-submit"
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

