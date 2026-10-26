'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useSelfIdentity } from '../../lib/hooks/useSelfIdentity';
import { gamesAPI, eventsAPI, groupsAPI, ballotAPI, availabilityAPI, promptAPI, API_BASE_URL } from '../../lib/api';
import { format, parseISO, differenceInMinutes, startOfWeek, addWeeks, subWeeks, isSameWeek } from 'date-fns';
import EventScheduler from './EventScheduler';
import EventHeatmapBackground from './EventHeatmapBackground';
import GameComboInput from './GameComboInput';
import QuickSuggestions from './QuickSuggestions';
import useSwipeNavigation from './useSwipeNavigation';
import { createParticipant, createEventForm, prepareEventData, resolveInitialHeatmapWeek, resolveWeekNav, withRowIds, remapCustomParticipantRef } from '../../lib/eventFormUtils';
import ParticipantRow from './ParticipantRow';
import BallotOptionsEditor from './BallotOptionsEditor';
import EventResultFields from './EventResultFields';
import { useTimezone } from './TimezoneProvider';
import { utcToWallClock, wallClockToUtc } from '../../lib/tzUtils';
import TimezoneNudgeBanner from './TimezoneNudgeBanner';
import { setPaintGestureActive } from './heatmap/paintGestureActiveStore';
import { Modal } from './Modal';
import { toast } from 'sonner';
import { Input, Textarea } from '@/components/ui/Input';
import { StatusRegion } from '@/components/ui/StatusRegion';
import { Button } from '../../components/ui/Button';
import { getFetchErrorMessage } from '../../components/ui/useFetchErrorState';
import { logger, errCtx } from '@/lib/logger';
import { isUuid } from '../../lib/isUuid';

const REQUIRED_SR_LABEL = '(required)';
// The two required section titles' visible words. One source for the visible text AND the
// heading's accessible name (WCAG 2.5.3 label-in-name) — quick-261020-tz3, VO-P2-4.
const DATE_TIME_SECTION_TITLE = 'Date & Time';
const PARTICIPANTS_SECTION_TITLE = 'Participants';
const CREATING_EVENT_LABEL = 'Creating...';
const UPDATING_EVENT_LABEL = 'Updating...';
// Copy row E4 (ratified, D-30), reused for the Edit dialog's loading line — owner ruling 2026-10-05; see DECISION Phase 88.6.1-68 (edit reads the event fresh).
const LOADING_GAME_NIGHT_LABEL = 'Loading game night...';
/* DECISION Phase 88.6.1-81 (one payload in flight): a module-level map from a write's key (the
   mode, the event id when editing, and the serialised payload it sends, plus the trimmed ballot
   list an update saves after it) to that write's in-flight promise and the time it started. A
   submit whose key is in flight and younger than JOIN_WINDOW_MS JOINS it: it sends nothing, shows
   its own press, on success calls its OWN `onEventCreated` and ends only its own dialog session
   with the shared outcome, and on failure calls nothing. The originator alone toasts, so one write
   gives one receipt. Past the window a submit sends as a new originator and replaces the entry;
   an originator's `finally` frees only an entry that is still its own, so a hung request can never
   free a newer one's key. The window is a start-time comparison made at submit (both reads are
   `Date.now()`), never a timer that rejects or aborts the first request. MODULE scope because a
   conditional host (gameDetail) mounts a fresh instance per open, which no per-instance latch can
   see across. CHOSEN over: a per-instance latch alone (blind across instances); blocking every
   write while any is in flight (a different event would wait with no words to say why); comparing
   what is on screen (the payload is what the server receives); a key-sorting serialiser (each mode
   builds its payload through one code path, createEventForm then prepareEventData, so key order is
   fixed; a second payload shape would need one); an unbounded join (a hung request disabled the
   close-reopen-retry recovery until a reload, because `apiFetch` has no timeout); a window that
   rejects or aborts the first request (it would report a failure for a write that may still
   succeed); and a joiner that skips its own `onEventCreated` (the originator's may belong to a page
   that has since unmounted, since this map outlives a page instance on a client-side navigation,
   leaving the visible page stale). The key holds participant names and comments: it is never
   logged, sent or kept past its request. Removing the join or its window is a decision, not a
   cleanup. */
// 30 seconds: longer than a healthy create on slow game-night wifi, short enough that a hung one
// stops blocking an identical retry.
const JOIN_WINDOW_MS = 30 * 1000;
const pendingEventWrites = new Map();
/* DECISION Phase 88.6.1-68 (edit reads the event fresh): in edit mode the form is built from the
   event AS THE SERVER HOLDS IT, read when the dialog opens and only after every edit write this
   device still has in flight for that event has settled. The host's copy of the event gives only
   its id (and tells the dialog it is in edit mode). The loading line shows until the read lands,
   and in edit mode it reads copy row E4 through LOADING_GAME_NIGHT_LABEL (owner ruling 2026-10-05:
   the dialog is waiting on the game night itself, not only the members); create mode keeps its
   members line. Rejected for the line: keeping the members line in edit mode (it no longer names
   what is loading) and any new sentence (D-31). A failed or mismatched read shows the register
   line as an error toast and closes the dialog if its session is still open — no form is ever
   built from an older copy. And no edit form opens until the populate has filled it from that
   read: a failed members read in edit mode ends the opening the same way (once per opening),
   because a blank edit form's Update sends an empty participant list, which the server takes as
   the new set and cascades to every removed participant's RSVP, brought games and ballot votes
   (the Phase 71.1-02 comment at gameDetail's event-view Edit mount records that cascade).
   REJECTED: the host's copy (what shipped: closing an Edit dialog mid-update and reopening it, or
   reopening before the host's refresh landed, showed the pre-update values, and an unchanged
   Update silently reverted the person's own edit, which plan 88.6.1-81's payload join cannot catch
   because the payload differs); disabling Edit while an update runs (a silent dead button with no
   ratified words; misses the window between a success and the host's refresh; the host cannot see
   these writes); populating from the in-flight payload (covers only the in-flight window, needs a
   payload-to-form mapping, and a second, different update would race the first on the server);
   the host refreshing an open dialog (overwrites what the person is typing); falling back to the
   host's copy on a failed read (the one path that could still revert a just-made edit). NOTE: an
   edit made on ANOTHER device between this read and the Update is not detected; a server-side
   version check is the complete answer and is outside this frontend phase. The map holds settle
   promises keyed by event id, never a payload, and is never logged or sent. Removing the wait or
   the read is a decision, not a cleanup.
   AMENDED 2026-10-19 (88.6.1 code review A-36 / REVIEW WR-06): the wait is BOUNDED by
   JOIN_WINDOW_MS, for the reason DECISION Phase 88.6.1-81 bounds its join: `apiFetch` has no
   timeout, so an unbounded wait let one hung update hold every later Edit dialog for the event on
   its loading line until a reload. Each write records when it started; the wait gives each one at
   most what is left of its own window, never rejects, and then the read goes ahead. The read still
   comes from the server, so no form is ever built from the host's copy. REJECTED: an unbounded wait
   (the lockout above); a window that rejects or ends the opening (it would report a failure for an
   update that may still succeed). Removing the bound is a decision, not a cleanup. */
const eventWritesInFlight = new Map();
// Resolves once every edit write this device has in flight for the event right now has settled,
// or once that write's JOIN_WINDOW_MS has run out, whichever is first (each entry's promise only
// ever resolves, and so does this one).
function whenEventWritesSettle(eventId) {
  const writes = eventWritesInFlight.get(eventId);
  if (!writes || writes.size === 0) return Promise.resolve();
  const now = Date.now();
  const bounded = [...writes]
    .filter((write) => now - write.startedAt < JOIN_WINDOW_MS)
    .map((write) => {
      let timer;
      const windowLeft = new Promise((resolve) => {
        timer = setTimeout(resolve, JOIN_WINDOW_MS - (now - write.startedAt));
      });
      return Promise.race([write.written, windowLeft]).then(() => clearTimeout(timer));
    });
  return Promise.all(bounded).then(() => undefined);
}
// Registers one edit write for the event and returns the function that settles and removes it.
function registerEventWrite(eventId) {
  let settle = () => {};
  const written = new Promise((resolve) => {
    settle = resolve;
  });
  const entry = { written, startedAt: Date.now() };
  if (!eventWritesInFlight.has(eventId)) eventWritesInFlight.set(eventId, new Set());
  eventWritesInFlight.get(eventId).add(entry);
  return () => {
    settle();
    const writes = eventWritesInFlight.get(eventId);
    if (!writes) return;
    writes.delete(entry);
    if (writes.size === 0) eventWritesInFlight.delete(eventId);
  };
}
function CreateEvent({ group_id, modal, modaltoggle, onEventCreated, editingEvent = null, user, prefillDate = null, prefillTime = null, prefillDuration = null, prefillGameId = null, prefillGameName = null, hideVisualCalendar = false, userRole, initialVisualView = 'week', promptId: rawPromptId = null }) {
  // DECISION quick-261026-pi6 (coordinator ruling 1, 2026-10-26): a promptId that is not a UUID is
  // treated as absent (no poll-heatmap request; the group heatmap path runs), chosen OVER passing
  // it through to the backend's 400 or 404 and OVER a visible error, because a malformed email link
  // should not read as "the poll request failed" and the id is interpolated into the request path
  // (src/lib/isUuid.ts ("DECISION Phase 88.6.1-07 (D-03 / AC-6 / CSPT)")); the prop is renamed in
  // the signature so no later read can see the unchecked value. Changing this is a decision, not a
  // cleanup.
  const promptId = isUuid(rawPromptId) ? rawPromptId : null;
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
  // Plan 88.6.1-26 (D-35): the submit's in-flight latch (a REF, read on the first statement after
  // `e.preventDefault()` in `onSubmit`) and the state behind its `aria-disabled` and its C7 label.
  // The reasoning is the DECISION marker at the submit button.
  const eventSubmitInFlightRef = useRef(false);
  const [eventSubmitting, setEventSubmitting] = useState(false);
  /* DECISION Phase 88.6.1-81 (dialog session): a dialog SESSION ends when the dialog closes
     (`modal` true to false at the always-mounted hosts, groupHomePage and groupPlanning, where the
     SAME instance comes back on reopen) or when the component unmounts (the conditional gameDetail
     hosts, a fresh instance per open). The `[modal]` effect's cleanup is the one mechanism for both:
     it bumps `dialogSessionRef`, clears `dialogOpenRef` and releases plan 26's latch and
     `eventSubmitting`, because the latch belongs to the session. `onSubmit` captures the session it
     started in. A write that settles after its session ended still calls `onEventCreated` (the host
     refresh) and still fires its receipt toast, but never calls `modaltoggle()`, and touches the
     form (the resets, the edit-mode ballot notice) only if no NEWER session is open; its `finally`
     releases nothing, since a newer session may hold its own press. CHOSEN over: blocking close
     while creating (owner ruling 2026-10-05, D-55 (b): closable is fine; and `apiFetch` has no
     timeout, so a hung request would trap the person in the dialog); a latch that survives the
     close (a reopened dialog read `Creating...` for a press it never had and refused a different
     event); skipping `onEventCreated` for a stale write (the host page would never refresh); and
     running the resets unconditionally (they wiped what was typed into a reopened dialog).
     Removing the session check is a decision, not a cleanup. */
  const dialogSessionRef = useRef(0);
  const dialogOpenRef = useRef(false);
  useEffect(() => {
    if (!modal) return undefined;
    dialogOpenRef.current = true;
    return () => {
      dialogSessionRef.current += 1;
      dialogOpenRef.current = false;
      eventSubmitInFlightRef.current = false;
      setEventSubmitting(false);
    };
  }, [modal]);
  // Plan 88.6.1-68 (see DECISION Phase 88.6.1-68 (edit reads the event fresh)): the event as the
  // server holds it, the id the populate last built the form for, and the per-opening record that
  // a failed read already ended this opening (one toast, one close, whichever read fails first).
  const editId = editingEvent ? editingEvent.id : null;
  const [editSourceEvent, setEditSourceEvent] = useState(null);
  const [populatedEditId, setPopulatedEditId] = useState(null);
  const editOpeningEndedRef = useRef(-1);
  const endEditOpening = (error, session) => {
    if (dialogSessionRef.current !== session || editOpeningEndedRef.current === session) return;
    editOpeningEndedRef.current = session;
    toast.error(getFetchErrorMessage(error));
    modaltoggle();
  };
  // see DECISION Phase 88.6.1-68 (edit reads the event fresh)
  useEffect(() => {
    setEditSourceEvent(null);
    setPopulatedEditId(null);
    if (!modal || !editId) return undefined;
    const session = dialogSessionRef.current;
    let cancelled = false;
    (async () => {
      try {
        await whenEventWritesSettle(editId);
        if (cancelled) return;
        const answer = await eventsAPI.getEvent(editId);
        if (cancelled) return;
        if (!answer || typeof answer !== 'object' || answer.id !== editId) {
          throw new Error('The event read answered for a different event');
        }
        setEditSourceEvent(answer);
      } catch (error) {
        if (cancelled) return;
        logger.info('Error reading event for edit:', errCtx(error));
        endEditOpening(error, session);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `endEditOpening` is a fresh closure every render; listing it would re-read on every render.
    // The run's own session check is what keeps a stale closure from closing a newer opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, editId]);
  /* DECISION Phase 88.1-21 (H1): the fetched week anchor is stored as ONE object,
     `{ monday, fromNavigation }`, chosen OVER a bare `Date` plus reading `currentWeekStart`
     back out at the consumer. The two facts — WHICH week landed, and whether it landed because
     the user navigated or because it is the page-load default — must move together or they
     desynchronise for exactly one render, and that one render is enough to re-anchor the
     scheduler (see the amended marker on `calendarInitialDate`). Rejected: adding
     `currentWeekStart` to that memo's deps, which recomputes it the instant the nav handler
     writes, while `monday` is still the PREVIOUS fetch's week — a stale anchor handed to the
     child. A companion `useState` boolean was rejected for the same reason at half the odds.
     `heatmapWeekStart` below stays a plain `Date` for the two manual-mode display consumers. */
  const [heatmapWeekAnchor, setHeatmapWeekAnchor] = useState(null);
  const heatmapWeekStart = heatmapWeekAnchor?.monday ?? null;
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
  // ignored by the outgoing calendar library, and still ignored by WeekGrid — plan 88.1-16
  // removed react-big-calendar; the prop's date half stayed inert across the swap). No
  // auto-scroll when totalMembers is 0
  // or no slots have any availability — calendar uses its default scroll.
  //
  // DECISION Phase 88.1-18 (SPEC Req 13): the `prefillDate` scoping just below is KEPT, chosen
  // OVER deleting it as now-redundant. Req 13 moved the DAY arm's landing into EventScheduler
  // (it derives the displayed day's own peak from `heatmapLookup` via `peakHourForDay`), so the
  // only consumer of THIS value is now the WEEK arm — and on the CAL-05 day-tap path the user
  // arrived from a specific day, so scoping the week view's landing to that day remains the
  // intended Phase 66-03 CREVT-06 behaviour. Req 13 holds week view unchanged, so removing the
  // scoping would be a behaviour change this requirement explicitly rules out.
  //
  // WHERE TO LOOK INSTEAD: this value no longer reaches day view. A day-view landing bug lives in
  // `EventScheduler.tsx`'s scrollToTime effect (and `heatmap/dayAggregate.ts`'s `peakHourForDay`),
  // not here. The max-count / earliest tie-break below is mirrored there ON PURPOSE — the two must
  // keep agreeing about what "peak" means; change them together or not at all.
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

    // Return a Date whose hour-of-day is the peak hour. The outgoing react-big-calendar's
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
    let cancelled = false;
    if (editingEvent && modal) {
      const loadBallot = async () => {
        try {
          // see DECISION Phase 88.6.1-68 (edit reads the event fresh) — a ballot read before this device's update lands would hand Update the old options.
          await whenEventWritesSettle(editingEvent.id);
          if (cancelled) return;
          const ballot = await ballotAPI.getBallot(editingEvent.id);
          if (cancelled) return;
          if (ballot && ballot.ballot_status !== null && ballot.options && ballot.options.length > 0) {
            setBallotOptions(ballot.options.map(o => ({ game_id: o.game_id || null, game_name: o.game_name })));
          } else {
            setBallotOptions([]);
          }
        } catch (err) {
          // No ballot exists or error fetching -- that's fine
          if (cancelled) return;
          setBallotOptions([]);
        }
      };
      loadBallot();
    } else if (!editingEvent) {
      setBallotOptions([]);
    }
    return () => {
      cancelled = true;
    };
  }, [editingEvent, modal]);

  // Populate form when editingEvent changes
  useEffect(() => {
    if (editingEvent && editSourceEvent && groupMembers.length > 0) {
      // Plan 88.6.1-68: every field comes from the event as the server holds it, never the host's
      // copy (see DECISION Phase 88.6.1-68 (edit reads the event fresh)).
      // Format start_date for datetime-local input (YYYY-MM-DDTHH:mm) using
      // the viewer's PROFILE timezone (not browser TZ). This is the headline
      // TZ-01 fix — see Phase 62-02. utcToWallClock returns wall-clock parts
      // in `timezone`, never in browser-local.
      const startDate = editSourceEvent.start_date
        ? (() => {
            const wc = utcToWallClock(editSourceEvent.start_date, timezone);
            if (!wc) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${wc.year}-${pad(wc.month)}-${pad(wc.day)}T${pad(wc.hours)}:${pad(wc.minutes)}`;
          })()
        : '';
      
      // Map EventParticipations to participants format
      // Handle both regular participants (with user_id) and custom participants (is_custom: true)
      const participants = editSourceEvent.EventParticipations?.map(ep => {
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
      // withRowIds: the inline objects built above from EventParticipations do
      // NOT come from createParticipant, so they carry no draft id — assign one
      // here or the list silently falls back to index keys (88-33 Task 2).
      const finalParticipants = withRowIds(
        participants.length > 0
          ? participants
          : groupMembers.map(member =>
              createParticipant(member.id, member.username, true)
            )
      );

      // Handle winner and picked_by - check if they're custom (no id, just username)
      let winner_id = null;
      let picked_by_id = null;
      
      if (editSourceEvent.Winner) {
        if (editSourceEvent.Winner.is_custom || (!editSourceEvent.Winner.id && editSourceEvent.Winner.username)) {
          // Custom winner - create a custom identifier
          const winnerIndex = finalParticipants.findIndex(p => p.username === editSourceEvent.Winner.username && !p.user_id);
          if (winnerIndex >= 0) {
            winner_id = `custom_${winnerIndex}_${editSourceEvent.Winner.username}`;
          }
        } else {
          winner_id = editSourceEvent.Winner.id || null;
        }
      }
      
      if (editSourceEvent.PickedBy) {
        if (editSourceEvent.PickedBy.is_custom || (!editSourceEvent.PickedBy.id && editSourceEvent.PickedBy.username)) {
          // Custom picked_by - create a custom identifier
          const pickedByIndex = finalParticipants.findIndex(p => p.username === editSourceEvent.PickedBy.username && !p.user_id);
          if (pickedByIndex >= 0) {
            picked_by_id = `custom_${pickedByIndex}_${editSourceEvent.PickedBy.username}`;
          }
        } else {
          picked_by_id = editSourceEvent.PickedBy.id || null;
        }
      }

      // Format rsvp_deadline for datetime-local input using the viewer's
      // PROFILE timezone — same TZ-01 fix as start_date above.
      const rsvpDeadline = editSourceEvent.rsvp_deadline
        ? (() => {
            const wc = utcToWallClock(editSourceEvent.rsvp_deadline, timezone);
            if (!wc) return '';
            const pad = (n) => String(n).padStart(2, '0');
            return `${wc.year}-${pad(wc.month)}-${pad(wc.day)}T${pad(wc.hours)}:${pad(wc.minutes)}`;
          })()
        : '';

      setNewEvent({
        group_id: editSourceEvent.group_id,
        game_id: editSourceEvent.game_id,
        game_name: editSourceEvent.Game?.name || '',
        start_date: startDate,
        duration_minutes: editSourceEvent.duration_minutes || null,
        rsvp_deadline: rsvpDeadline,
        winner_id: winner_id,
        picked_by_id: picked_by_id,
        is_group_win: editSourceEvent.is_group_win || false,
        comments: editSourceEvent.comments || '',
        participants: finalParticipants
      });
      // Plan 88.6.1-68: the form is now built from the read for THIS event; the body gate opens on it.
      setPopulatedEditId(editSourceEvent.id);

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
  }, [editingEvent, editSourceEvent, groupMembers, group_id, prefillDate, prefillTime, prefillDuration, prefillGameId, prefillGameName, timezone]);

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
            // fromNavigation: true — the poll's own week is never a "show today" default, so
            // the today-substitution must not fire for it under any circumstances.
            setHeatmapWeekAnchor({
              monday: startOfWeek(anchor, { weekStartsOn: 1 }),
              fromNavigation: true,
            });
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
        // Capture WHY this week was fetched at the same instant as WHICH week it was — a
        // navigated week and a page-load default are indistinguishable downstream otherwise.
        setHeatmapWeekAnchor({
          monday: effectiveMonday,
          fromNavigation: Boolean(currentWeekStart),
        });
      } catch (err) {
        logger.info('Failed to load heatmap:', errCtx(err));
        // Silently fail -- heatmap is a nice-to-have visual, not critical
      } finally {
        setHeatmapLoading(false);
      }
    };
    fetchHeatmap();
  }, [modal, group_id, effectiveTz, promptId, currentWeekStart]);

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

  // Phase 72 HUX-04: reset the heatmap week on modal open / promptId change.
  // CONTEXT — no localStorage / no URL state; page-load reset semantics.
  //
  // DECISION 2026-07-25 (bugfix, owner repro): seed from `prefillDate` instead of
  // resetting unconditionally to null. This effect used to always
  // `setCurrentWeekStart(null)` — but `calendarInitialDate` (below) follows
  // `prefillDate` to the TAPPED day's week, so opening create-event from an
  // empty-day tap on the group calendar left the CALENDAR on the tapped week while
  // the heatmap FETCH still asked for today's week (null resolves to
  // `todayMondayLocal` in the fetch effect). `heatmapLookup` is keyed
  // `${dateStr}_${hour}` (EventScheduler.js), so a different week matched ZERO
  // slots and every cell rendered untinted. `onWeekChange` only fires on user
  // navigation, never on mount, so it did not self-correct until the user clicked
  // Next/Prev — which is why the tint appeared to "come back" after navigating.
  //
  // The promptId path already carried the mirror of this fix; see
  // `calendarInitialDate`'s comment: "otherwise the calendar opens on the current
  // week and no green tiles appear." The prefillDate path never got it.
  //
  // Moved BELOW the todayMonday/minWeek/maxWeek memos on purpose so the clamp can
  // reuse them rather than recomputing the TZ-safe "today". Clamping to the SAME
  // -3/+12 bounds the nav handlers enforce is load-bearing: an out-of-range tap
  // must fall back to today rather than send a weekStart the backend rejects. The
  // tint is a nice-to-have; a 400 is not.
  // The rule itself lives in `resolveInitialHeatmapWeek` (lib/eventFormUtils) as a pure
  // function so it is unit-testable — this bug shipped precisely because nothing
  // exercised the prefill path.
  useEffect(() => {
    if (!modal) {
      setCurrentWeekStart(null);
      return;
    }
    setCurrentWeekStart(
      resolveInitialHeatmapWeek({ prefillDate, promptId, minWeek, maxWeek })
    );
  }, [modal, promptId, prefillDate, minWeek, maxWeek]);
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
  // actual Monday — label-accurate semantics, matching the convention the (now-deleted)
  // MergedHeatmap grid used. (A second grid was named here until plan 88-31 deleted it as dead
  // code; MergedHeatmap itself went in plan 88.1-16. The convention is what survives, not the
  // component — see `dayAggregate.ts` / `WeekGrid` for where the week now starts on Monday.)
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
    const session = dialogSessionRef.current;
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
      logger.info('Error fetching group members:', errCtx(error));
      // Plan 88.6.1-68 (#79): in edit mode a failed members read ends the opening like a failed
      // event read — a blank edit form's Update would send an empty participant list. Create mode
      // only logs (a blank create form loses nothing). See DECISION Phase 88.6.1-68 (edit reads
      // the event fresh).
      if (editingEvent) endEditOpening(error, session);
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

  /* DECISION Phase 88-33 Task 2 (M5, UAT row 497): participant edits go through FUNCTIONAL
     setState AND accept a whole-object PATCH — chosen OVER the shipped
     `(index, field, value)` + closure-read shape, and OVER "just" adding the updater form.

     THE BUG THIS FIXES: ParticipantRow's name onChange fired TWO calls in one tick (username,
     then user_id) and each rebuilt from the same STALE `newEvent` closure, so the second
     clobbered the first — you could never type the last character of a member's name, and the
     designed member re-link path was unusable. The updater form alone fixes the staleness; the
     PATCH is what removes the two-calls-one-tick shape at its source, on BOTH branches (the
     no-match branch double-fired too: set username + clear user_id). Reverting either half
     re-opens M5. */
  const handleParticipantChange = (index, fieldOrPatch, value) => {
    const patch =
      fieldOrPatch && typeof fieldOrPatch === 'object'
        ? fieldOrPatch
        : { [fieldOrPatch]: value };
    setNewEvent(prev => {
      const updatedParticipants = [...prev.participants];
      const normalized = {};
      for (const [key, raw] of Object.entries(patch)) {
        normalized[key] = key === 'is_new_player' ? raw : (raw === '' ? null : raw);
      }
      updatedParticipants[index] = { ...updatedParticipants[index], ...normalized };
      return { ...prev, participants: updatedParticipants };
    });
  };

  /* DECISION Phase 88-33 Task 2 (fork 4, owner-ruled 2026-08-17): removing a draft row offers
     UNDO — chosen OVER the two-tap gate the owner originally proposed (fork 4 explicitly rules
     NO two-tap here) and OVER a 3-second auto-vanishing toast.

     The placeholder is PERSISTENT, not timed: WCAG 2.2.1 (Timing Adjustable) is not satisfied by
     an affordance that is only reachable inside a countdown, and the whole point is the owner's
     "accidentally removed Bob, had to restart the modal" complaint. It clears when undone, when
     another removal replaces it, or when the modal closes. Replacing it with a timed toast is a
     decision, not a tidy-up. */
  const [removedParticipant, setRemovedParticipant] = useState(null);
  const undoButtonRef = useRef(null);
  const pendingUndoFocus = useRef(false);
  // 88-33 Task 4 (UAT row 291): initial-focus target — the game combo's text input.
  const gameInputRef = useRef(null);

  useEffect(() => {
    if (pendingUndoFocus.current && undoButtonRef.current) {
      pendingUndoFocus.current = false;
      undoButtonRef.current.focus();
    }
  }, [removedParticipant]);

  const toggleParticipant = (index) => {
    // Wave-12 review MED #3: side effects (setRemovedParticipant, the focus
    // ref) are hoisted OUT of the setNewEvent updater — updaters must be pure
    // (StrictMode double-invokes them). Reading render-scope state here is
    // consistent: this only runs from a user event.
    const removed = newEvent.participants[index];
    const remaining = newEvent.participants.filter((_, i) => i !== index);
    // Keep at least one participant. This guard returns WITHOUT removing, so
    // the undo affordance must not fire either — announcing an undo for a
    // removal that never happened is a false affordance (r3 triage).
    if (remaining.length === 0) return;

    // Wave-12 review MED #1: capture the pre-removal attribution so Undo can
    // restore it — removing the winner/picked-by nulls the ref below, and
    // without the capture Undo brought the person back with attribution gone.
    setRemovedParticipant({
      row: removed,
      index,
      name: removed?.username || 'Participant',
      priorWinnerId: newEvent.winner_id,
      priorPickedById: newEvent.picked_by_id,
    });
    setUndoAnnouncement('');
    pendingUndoFocus.current = true;
    setNewEvent(prev => {
      const updatedParticipants = prev.participants.filter((_, i) => i !== index);
      if (updatedParticipants.length === 0) return prev;
      return {
        ...prev,
        participants: updatedParticipants,
        // Keep winner / picked-by attribution pointing at the same PERSON: the
        // stored `custom_<index>_<name>` embeds a position that just shifted.
        winner_id: remapCustomParticipantRef(prev.winner_id, updatedParticipants),
        picked_by_id: remapCustomParticipantRef(prev.picked_by_id, updatedParticipants),
      };
    });
  };

  // Wave-12 review MED #21: a successful Undo was silent (the live region just
  // emptied) and both Undo/Dismiss unmount the focused control, dropping
  // keyboard focus to body. Announce the restore, and hand focus to the
  // restored row's name input (Undo — the existing focusRowId mechanism) or
  // the Add Participant button (Dismiss).
  const [undoAnnouncement, setUndoAnnouncement] = useState('');
  const addParticipantButtonRef = useRef(null);

  const undoRemoveParticipant = () => {
    const pending = removedParticipant;
    if (!pending) return;
    setNewEvent(prev => {
      const restored = [...prev.participants];
      // CLAMP to the current bounds — adds/removes may have happened since.
      const at = Math.max(0, Math.min(pending.index, restored.length));
      restored.splice(at, 0, pending.row);
      // Wave-12 review MED #1: a ref the removal CLEARED (now null) is
      // restored from the captured prior value; a ref the user re-pointed in
      // the meantime is left alone — Undo must not clobber a newer choice.
      const winnerRef = prev.winner_id == null && pending.priorWinnerId != null
        ? pending.priorWinnerId : prev.winner_id;
      const pickedByRef = prev.picked_by_id == null && pending.priorPickedById != null
        ? pending.priorPickedById : prev.picked_by_id;
      return {
        ...prev,
        participants: restored,
        winner_id: remapCustomParticipantRef(winnerRef, restored),
        picked_by_id: remapCustomParticipantRef(pickedByRef, restored),
      };
    });
    setRemovedParticipant(null);
    setUndoAnnouncement(`${pending.name} restored.`);
    if (pending.row?._rowId != null) setFocusRowId(pending.row._rowId);
  };

  // 88-33 Task 4 (UAT row 542): after Add Participant, focus moves to the NEW row's
  // name input (keyed on the draft `_rowId`, so it survives reorders) and the row is
  // scrolled into view within Modal.Body. State, not a ref: the row must have RENDERED
  // before ParticipantRow's focus effect can run against it.
  const [focusRowId, setFocusRowId] = useState(null);
  const handleRowFocusHandled = () => setFocusRowId(null);

  // Wave-12 review MED #10/#12: FE counterpart to the BE
  // MAX_CUSTOM_PARTICIPANTS=50 reject (middleware/validators.js) — guests are
  // the rows WITHOUT a user_id; without this cap the 51st guest surfaced as a
  // raw 400 on submit.
  const MAX_GUEST_PARTICIPANTS = 50;
  const guestCount = newEvent.participants.filter(
    (p) => !p.user_id || String(p.user_id).trim() === ''
  ).length;
  const guestCapReached = guestCount >= MAX_GUEST_PARTICIPANTS;

  const addParticipant = () => {
    if (guestCapReached) return;
    const row = createParticipant("", "", false);
    setFocusRowId(row._rowId);
    setNewEvent(prev => ({
      ...prev,
      participants: [...prev.participants, row]
    }));
  };

  // Clear a stale undo offer whenever the modal opens/closes or the edited
  // event changes — the row it would restore belongs to a different draft.
  useEffect(() => {
    setRemovedParticipant(null);
    setUndoAnnouncement('');
  }, [modal, editingEvent]);

  /* DECISION Phase 88-33 Task 2 step 3b (triage A1, owner-ruled 2026-08-20): a duplicate
     participant name shows a NON-BLOCKING inline hint — chosen OVER blocking submit and OVER
     forced differentiation (the owner's original fork-3 proposal (b)). Fork 3 RULED that
     duplicates are allowed: an all-Garys game night is legitimate, and the backend accepts it.
     The hint is informational only; it never gates typing or submit. Turning it into a validation
     error is a decision, not a hardening. */
  const duplicateNameByIndex = useMemo(() => {
    const seen = new Map(); // lowercased name -> count
    for (const p of newEvent.participants) {
      const name = (p.username || '').trim().toLowerCase();
      if (!name) continue;
      seen.set(name, (seen.get(name) || 0) + 1);
    }
    return newEvent.participants.map(p => {
      if (p.isFromGroup) return null; // read-only rows have no input to hint under
      const raw = (p.username || '').trim();
      const name = raw.toLowerCase();
      if (!name) return null;
      return (seen.get(name) || 0) > 1 ? raw : null;
    });
  }, [newEvent.participants]);

  // Derive participant count for QuickSuggestions
  const participantCount = newEvent.participants.length;

  // Handle suggestion selection — fill game field in form
  const handleSuggestionSelect = (game) => {
    setNewEvent(prev => ({ ...prev, game_id: game.id, game_name: game.name }));
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    if (eventSubmitInFlightRef.current) return;
    // Plan 88.6.1-81: the dialog session this submit belongs to (DECISION Phase 88.6.1-81
    // (dialog session), at the refs). CURRENT: no close or unmount since this press. NO NEWER
    // SESSION OPEN: current, or the dialog is closed and was not reopened.
    const session = dialogSessionRef.current;
    const sessionIsCurrent = () => dialogSessionRef.current === session;
    const noNewerSessionOpen = () => sessionIsCurrent() || !dialogOpenRef.current;
    // Plan 88.6.1-81 (one payload in flight): set when this press joins a write already in flight.
    let joinedWrite = null;
    // Plan 88.6.1-68: settles this press's edit write in `eventWritesInFlight` (the originator only).
    let releaseEditWrite = null;
    eventSubmitInFlightRef.current = true;
    setEventSubmitting(true);
    try {
      try {
        let gameId = newEvent.game_id || null;

        // If user typed a custom game name (no game_id selected), resolve it
        if (!gameId && newEvent.game_name && newEvent.game_name.trim()) {
          try {
            const resolvedGame = await gamesAPI.resolveGame(newEvent.game_name.trim());
            gameId = resolvedGame.id;
          } catch (resolveError) {
            logger.info('Error resolving game:', errCtx(resolveError));
            toast.error(getFetchErrorMessage(resolveError));
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

        // The ballot options this write carries: in create mode they ride in the event creation
        // payload for atomic creation (so the ballot exists BEFORE notifications fire and the
        // ballot link is included); in edit mode the update saves them after the event PUT.
        const trimmedBallotOptions = validBallotOptions.length >= 2
          ? validBallotOptions.map(o => ({
            game_id: o.game_id || null,
            game_name: o.game_name.trim()
          }))
          : null;
        if (!editingEvent && trimmedBallotOptions) {
          eventDataToSubmit.ballot_options = trimmedBallotOptions;
        }

        // Plan 88.6.1-81 (one payload in flight; the reasoning is the DECISION marker at
        // `pendingEventWrites`): the key is the mode, the event id when editing, and everything
        // this write sends. It stays in memory for one request and is never logged or sent.
        const writeKey = (editingEvent ? 'update:' + editingEvent.id : 'create')
          + JSON.stringify(editingEvent ? [eventDataToSubmit, trimmedBallotOptions] : eventDataToSubmit);
        const inFlight = pendingEventWrites.get(writeKey);
        if (inFlight && Date.now() - inFlight.startedAt < JOIN_WINDOW_MS) {
          joinedWrite = inFlight;
        }

        let data;
        // 88.6.1 code review A-37: set when an update's ballot step fails, so the receipt says so.
        let ballotSaveFailed = false;
        if (joinedWrite) {
          // A JOINER: the same write is already in flight, so this press sends nothing.
          try {
            data = await joinedWrite.promise;
          } catch {
            // A joined write that fails calls nothing: its originator shows the one error notice,
            // and this press only releases (the finally below) and keeps its form.
            return;
          }
        } else {
          // The ORIGINATOR: send, and keep the request in flight under its key (replacing an entry
          // past the join window) until it settles. Only an entry that is still its own is freed.
          // Plan 88.6.1-68: register the update (its PUT and the ballot step after it) so a reopened
          // Edit dialog reads the event only after it settles. See DECISION Phase 88.6.1-68 (edit
          // reads the event fresh). A create registers nothing.
          if (editingEvent) releaseEditWrite = registerEventWrite(editingEvent.id);
          const writePromise = editingEvent
            ? eventsAPI.updateEvent(editingEvent.id, eventDataToSubmit)
            : eventsAPI.createEvent(eventDataToSubmit);
          const entry = { promise: writePromise, startedAt: Date.now() };
          pendingEventWrites.set(writeKey, entry);
          try {
            data = await writePromise;
          } finally {
            if (pendingEventWrites.get(writeKey) === entry) {
              pendingEventWrites.delete(writeKey);
            }
          }
        }

        if (editingEvent) {
          // Update ballot options if we have valid ones (the originator only; a joiner's write is
          // its originator's, ballot update included)
          if (!joinedWrite && trimmedBallotOptions) {
            try {
              await ballotAPI.updateBallotOptions(editingEvent.id, trimmedBallotOptions);
            } catch (ballotErr) {
              // 88.6.1 code review A-37: stays a breadcrumb; the user-facing fix is the toast receipt.
              // Whether this failure class earns a Sentry event belongs to Phase 88.9's reporting inventory.
              logger.info('Error updating ballot options:', errCtx(ballotErr));
              ballotSaveFailed = true;
              if (noNewerSessionOpen()) {
                setBallotError('Event updated but ballot options could not be saved.');
              }
            }
          }

          if (onEventCreated) {
            onEventCreated(null); // Signal that event was updated
          }
        } else if (onEventCreated) {
          // Created (with ballot options atomically if provided)
          onEventCreated(data);
        }

        /* DECISION Phase 88-16 (CONTEXT D-13, Req 12): the receipt fires HERE —
           one statement BEFORE `modaltoggle()` — not after it. Sonner's <Toaster>
           lives in the root layout and survives the SPA re-render/navigation that
           closing this modal kicks off; queueing the toast on the far side of the
           close is what loses it. The ORDER is the decision, not a formatting
           choice: swapping these two lines is a regression, not a cleanup.
           Copy is the D-12 terse-utility register ("{Object} {past-tense verb}"),
           verbatim from the UI-SPEC §6.2 register — do not warm it up.
           Verified this session that nothing between the API success and this line
           can eat it: all five shipped `onEventCreated` consumers
           (groupHomePage:509, groupPlanning:286, gameDetail:1221/2243/2258, and the
           legacy read-grid at its :518 -> its parent) refetch or unmount; none
           navigates. NOTE: that fifth consumer was deleted by plan 88-31's dead-code
           gate, so the live count is now four — the claim is unaffected, but do not
           re-verify it expecting five. RE-VERIFIED Phase 88.6.1-15 (2026-10-15): the
           line numbers above are history; the mounts are found by
           `grep -rn 'onEventCreated=' src --include='*.js'` (five JSX mounts in
           `groupPlanning/page.js`, `gameDetail/page.js` x3, `groupHomePage/page.js`),
           and every handler they name refetches, toggles or bumps a refresh key —
           none navigates. AMENDED Phase 88.6.1-68: `groupPlanning/page.js` no longer passes
           the callback, so that grep now finds four (`gameDetail/page.js` x3,
           `groupHomePage/page.js`); the five mounts remain (`grep -rn '<CreateEvent' src/app`).
           ——— AMENDED Phase 88.6.1-81 (dialog session), original reasoning above KEPT AS HISTORY:
           the order toast, then `modaltoggle()`, then the resets is unchanged for a write whose
           dialog session is still open. For a write whose session ended mid-request (the dialog was
           closed, or unmounted at a conditional host) the toast still fires here, `modaltoggle()` is
           skipped (the person's own close already ran it; a second call is what closed a REOPENED
           dialog) and the resets run only if no newer session is open. See
           DECISION Phase 88.6.1-81 (dialog session) at the refs. A joined write's receipt is its
           originator's toast: the joiner adds none, but on success calls its own `onEventCreated`
           (above) so its own page refreshes. See DECISION Phase 88.6.1-81 (one payload in flight).
           ——— AMENDED Phase 88.6.1-68 (one close owner), original reasoning above KEPT AS HISTORY:
           every host's created-callback now only refreshes (gameDetail's three, groupHomePage's) and
           groupPlanning passes none, so the close after a success is this component's
           `modaltoggle()` alone. "Refetch or unmount; none navigates" is still true. */
        /* AMENDED 2026-10-19 (88.6.1 code review A-37): when an update's ballot step failed, the
           receipt is that failure (the existing ballot-notice sentence) through `toast.error`, IN
           PLACE OF 'Event updated', at the same position (toast, then close). The inline
           `ballotError` notice could never show: it is set and then cleared by the reset below in
           the same run, and the dialog closes. REJECTED: keeping the dialog open on a ballot
           failure (the event itself DID update, so the close and the host's refresh stay). */
        if (!joinedWrite) {
          if (ballotSaveFailed) {
            toast.error('Event updated but ballot options could not be saved.');
          } else {
            toast.success(editingEvent ? 'Event updated' : 'Event created');
          }
        }
        if (sessionIsCurrent()) {
          modaltoggle();
        }
        if (noNewerSessionOpen()) {
          // Reset form. Phase 66-01: derivedSelectedSlot resets automatically
          // when newEvent.start_date is cleared by createEventForm — no separate
          // selectedTimeSlot reset needed.
          setNewEvent(createEventForm(group_id, groupMembers));
          setBallotOptions([]);
          setBallotError(null);
          setUseVisualCalendar(true);
        }
      } catch (error) {
        logger.info(`Error ${editingEvent ? 'updating' : 'creating'} event:`, errCtx(error));
        // Plan 88.6.1-81: one write, one notice. A joiner's failed write is its originator's to report.
        if (!joinedWrite) {
          toast.error(getFetchErrorMessage(error));
        }
      }
    } finally {
      // Plan 88.6.1-68: settle this press's edit write. Everything between the ballot step and here
      // runs synchronously, so this finally is the one that wraps the PUT and the ballot step.
      if (releaseEditWrite) releaseEditWrite();
      // Plan 88.6.1-81: release only the session this press belongs to. After a close the cleanup
      // already released it, and a newer session may hold its own press.
      if (sessionIsCurrent()) {
        eventSubmitInFlightRef.current = false;
        setEventSubmitting(false);
      }
    }
  };

  // Memoize initialDate so it doesn't create a new object on every render.
  // A new object reference causes EventScheduler's useEffect to fire and clear
  // the drag selection immediately after the user picks a time slot.
  const calendarInitialDate = useMemo(() => {
    if (prefillDate) return parseISO(prefillDate);
    if (editSourceEvent?.start_date) return new Date(editSourceEvent.start_date);
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
    //
    /* DECISION Phase 88.1-20 (CR-01, seed half): when the fetched week is the week CONTAINING
       TODAY, hand the scheduler TODAY rather than that week's Monday. `heatmapWeekStart` is a
       WEEK anchor (the group-path `setHeatmapWeekAnchor({`, snapped to Monday by the fetch
       effect's `startOfWeek(localToday, { weekStartsOn: 1 })`) and this fallthrough was handing it over
       as a DAY anchor. Below `md` the scheduler renders a single-day column, so that opened the
       modal on Monday for a user sitting on any other weekday — CR-01.
       Chosen OVER fixing it in the scheduler (rejected: at mount a Monday from this fetch and a
       Monday from `prefillDate` are indistinguishable there, so a child-side default-to-today
       would break "tap Monday -> create an event on Monday"; only THIS site knows which producer
       won). Chosen OVER stabilising this memo's identity (rejected: identity churn is the
       re-sync half, closed in `EventScheduler.tsx`; it leaves the VALUE wrong, and the value is
       what seeds `currentDate` when the scheduler mounts after the fetch has landed).
       BOTH halves are needed and neither subsumes the other: the render's `{!bodyGateOpen ? null : (` gates the
       form on the group-members fetch while the heatmap fetch `useEffect` runs independently, so seeding vs
       re-syncing is a race between two network calls, and a navigated-away week still needs the
       scheduler-side guard. Week view is unaffected — Monday and today render the same week.
       Reverting this to a bare `return heatmapWeekStart` re-opens CR-01; it is a decision, not
       a redundant branch. Pinned: `createEvent.integration.test.tsx` "the phone arm opens on
       TODAY, not the week Monday, on a non-Monday".

       AMENDED BY PHASE 88.1-21 (H1, 88.1-CODE-REVIEW.md) — the substitution is now additionally
       gated on the fetched anchor NOT coming from a navigation (`!heatmapWeekAnchor
       .fromNavigation`). Everything above still stands: a WEEK anchor was being handed over as a
       DAY anchor, and this is still the only site that can tell the two producers apart. What
       changed is WHEN the substitution is allowed to fire.

       THE DEFECT THAT FORCED IT: in day view, Next past Sunday and then Back once landed on
       TODAY instead of on the Sunday the user had just navigated to — silently, with no
       feedback, on the only arm that exists below `md`. Back re-emits a week anchor for the week
       CONTAINING TODAY, `isSameWeek` was therefore true, and today (a Wednesday, say) went over
       as the day anchor. The scheduler-side guard suppresses only the displayed week's MONDAY,
       and a Wednesday is not a Monday, so it landed.

       WHY "DID A NAVIGATION CAUSE THIS FETCH" IS EXACTLY THE DISCRIMINATOR: the fetch effect
       resolves `effectiveMonday = currentWeekStart || todayMondayLocal`, and `currentWeekStart`
       is this file's existing null sentinel for "show today" — written by the modal-open effect
       when there is no `prefillDate` and no `promptId` (`eventFormUtils.js:28`) and by the Today
       button. EVERY other value was written by a navigation — `handlePrevWeek`, `handleNextWeek`,
       the `onWeekChange` body, or a `prefillDate` clamp — and in all of those the user has
       expressed a day/week intent that today must not override. That fact is captured AT THE
       FETCH and carried on the anchor, not re-read here; see the marker on `heatmapWeekAnchor`
       for why reading `currentWeekStart` at this site is a stale-anchor bug rather than a
       simplification.

       REJECTED: widening the SCHEDULER-side guard from "the displayed week's Monday" to a bare
       `isSameWeek`. Plan 20 already tried precisely that and it turned plan 18's two Req-13 pins
       red ("starts at the TOP on a day with no availability" and "RE-DERIVES the landing when the
       displayed day changes") — the guard's own marker in `EventScheduler.tsx` (paragraph "WHY THAT SHAPE AND NOT PLAIN
       `isSameWeek`") records
       that attempt in its own words. A same-week different-day hand-over is a real day intent
       there; the discrimination this defect needs is not available in the child.
       Pinned: `createEvent.integration.test.tsx` "H1: Next past Sunday then Back lands on
       Sunday, not on today". */
    if (heatmapWeekAnchor?.monday) {
      const { monday, fromNavigation } = heatmapWeekAnchor;
      const now = new Date();
      return !fromNavigation && isSameWeek(now, monday, { weekStartsOn: 1 }) ? now : monday;
    }
    return new Date();
  }, [
    prefillDate,
    editSourceEvent?.start_date,
    promptId,
    heatmapData?.weekStart,
    heatmapWeekAnchor,
  ]);

  // Plan 88.6.1-68: the body gate. Edit mode waits until the populate has built the form from the
  // fresh read for THIS event (#79), never on the read's arrival alone.
  const bodyGateOpen = !loading && (!editingEvent || populatedEditId === editId);
  // Plan 88.6.1-68 (#233): once per opening, when the gate opens, move focus to the game input if
  // it is still on the dialog's default target (the header Close or the dialog surface). Focus a
  // person put anywhere else is never taken. See the AMENDED 88-33 Task 4 note at the return.
  const gateFocusDoneRef = useRef(false);
  useEffect(() => {
    if (!modal) {
      gateFocusDoneRef.current = false;
      return;
    }
    if (!bodyGateOpen || gateFocusDoneRef.current) return;
    gateFocusDoneRef.current = true;
    const input = gameInputRef.current;
    const dialog = input ? input.closest('[role="dialog"]') : null;
    if (!input || !dialog) return;
    const active = document.activeElement;
    const onDefaultTarget =
      // 88.6.1 code review A-44: matched by Modal's stable `data-modal-close` hook, never by its
      // 'Close' label text (a rename would silently end this focus policy).
      active === dialog || (dialog.contains(active) && active.hasAttribute('data-modal-close'));
    if (onDefaultTarget) input.focus();
  }, [modal, bodyGateOpen]);

  if (!modal) return null;

  /* DECISION Phase 88-16 (SPEC Req 9 / Req 4): this component's TWO legacy
     overlay wrappers — the pre-roster "Loading group members..." one and the
     main form one — collapse onto ONE <Modal> host with a conditional body,
     chosen OVER two sibling <Modal> elements that mirror the old early-return
     shape. Two Modals would unmount one Radix dialog and mount another the
     instant `loading` flips false: focus escapes back to the launcher, the open
     animation replays, and a screen reader hears the dialog close and reopen —
     none of which the pre-migration plain <div>s did, because they were not
     dialogs. The two STATES are both still here and still distinct; only the
     host is shared. Splitting them back apart is a decision, not a cleanup.

     The loading state deliberately carries the SAME accessible name as the
     loaded one ("Create Event" / "Edit Event") rather than a "Loading" title:
     a dialog whose accessible name mutates underneath the user announces twice
     for one open. Radix also REQUIRES a DialogTitle, so a title-less loading
     dialog is not an option — leaving it unlabelled is what the old markup did.

     Gone rather than ported: the backdrop `onClick`/`stopPropagation` pair
     (Modal owns outside-dismiss) and the NAMELESS `×` button at the old `:674`
     — one of the two nameless close glyphs SPEC Req 4 names. It carried neither
     text nor `aria-label`, so screen readers announced "button". <Modal.Header>
     supplies a close affordance with a real `aria-label="Close"`, so no close
     glyph survives here that needs one. The header also drops from `text-2xl`
     (24px) to the dialog-title contract (20px/700, UI-SPEC §4.2) because it is
     now the DialogTitle — same call 88-17 made for PromptScheduleManager. */
  /* 88-33 Task 4 (UAT row 291, fleet initial-focus policy): the game field is this
     form's first meaningful input — focus lands there on open so the person can just
     start typing. While the members fetch is still loading the input is not mounted;
     applyInitialFocus then declines and Radix's default stands (graceful, recorded).
     AMENDED Phase 88.6.1-68: the dialog now also waits on a network read in edit mode (this
     device's update, then the fresh event read) as well as the members, so when the body gate
     opens the same target is focused late, if focus is still where the dialog put it (the header
     Close or the dialog surface), and the waiting region is marked busy while it waits. This
     overrides the 88.6-44 "accepted by record" fallback (Close keeps focus), which was not an
     owner ruling. Removing the late move is a decision, not a cleanup. */
  return (
    <Modal open onClose={modaltoggle} size="lg" initialFocusRef={gameInputRef}>
      <Modal.Header>{editingEvent ? 'Edit Event' : 'Create Event'}</Modal.Header>
      {/* DECISION Phase 87.8 DEC-3, re-based by 88-16: `p-3` at phone / `p-6` at
          desktop, now carried by <Modal.Body> (whose own default WAS a flat `p-6`
          until 88-32 ruling 6 — see the AMENDED paragraph at the end)
          instead of by a plain inner div. The 12px-per-side phone value is the
          SAME number DEC-3 chose and for the same reason — it keeps the Create
          Event chain under the SPEC R2 75px budget: 12 (this) + 12 (the phone
          gutter that DEF-88-17-01 restored to Modal.tsx) = 24/side = 48px total,
          exactly the pre-migration figure, with the nested heatmap `p-3` box
          adding 12/side -> 72px, still under. DEC-3's original cascade caveat is
          now MOOT and is deliberately not repeated: it warned that the padding
          could not live on the overlay div because the unlayered legacy overlay
          block would beat a layered utility. There is no such block in this
          file's chain any more — Radix's content surface takes utilities
          normally. Flattening this to the primitive's default `p-6` would put
          24+12 = 36/side on a 375px phone and is a decision, not a cleanup.
          AMENDED 2026-08-06 (Phase 88-32 owner ruling 6, DEF-88-30-03): that
          decision was then made, the other way around — the PRIMITIVE's default
          became `p-3 md:p-6` (see the marker in Modal.tsx), i.e. the fleet
          converged onto DEC-3's value rather than DEC-3 flattening onto the
          fleet's. The explicit className here was removed as redundant, NOT as
          a rejection of DEC-3 — the rendered padding is byte-identical. If the
          primitive default ever changes again, this modal must re-assert
          `p-3 md:p-6` or the R2 75px budget arithmetic above breaks. */}
      <Modal.Body>
        {/* Plan 88.6.1-68 (#233): a layout-neutral region this component owns (Modal.Body forwards
            className only), marked busy while the gate is closed.
            AMENDED 2026-10-19 (88.6.1 code review A-45): the loading line now renders BEFORE the busy
            region, not inside it. ARIA lets assistive tech hold back a busy subtree until it
            settles, so the one sentence saying why the dialog is empty could be the one a
            screen-reader user cannot reach (ResponseDashboard's loading line, DECISION
            Phase 88.6.1-86, already sits outside its busy area). The region stays busy, and empty,
            until the form arrives in it. */}
        {!bodyGateOpen && (
          <p className="text-content-primary">{editingEvent ? LOADING_GAME_NIGHT_LABEL : 'Loading group members...'}</p>
        )}
        <div aria-busy={!bodyGateOpen || undefined}>
        {!bodyGateOpen ? null : (
          <>
        {/* Phase 62-02: nudge user to set profile TZ before editing/creating
            so saved start_date is stamped against a stable canonical TZ. */}
        <TimezoneNudgeBanner />

        {/* Phase 87.7 Plan 10 (this attribute) populates the
            data-testid="tw4-space-y-exemplar" hook consumed by
            e2e/tailwind-v4-styles.spec.ts — D-10 layer 2, the computed-style spot check
            for the two render-only hazards no grep can see. This form is the exemplar
            because its direct children are five unconditional <div> wrappers (no <p> or
            heading, whose UA default margins RESEARCH's probe run tripped over), and
            because e2e/create-event.spec.ts already proves this modal reachable in green
            CI.

            DECISION Phase 87.7 Plan 10: exactly ONE test id was added here, on a
            structural form element that has no usable accessible role, so no role locator
            exists for it. REJECTED: adding a SECOND test id for the bare border-utility
            exemplar (the start_date input below, site 8 on the border audit's unpaired
            list). That input is already located by getByLabel(/start date & time/i) inside
            the green create-event journey — a stronger reachability guarantee than a fresh
            attribute, and a second hook would imply that label locator was insufficient
            when it is in fact the better-evidenced of the two. Adding one, or replacing
            this attribute with a role locator, is a decision and not a cleanup.

            Audit site list:
            .planning/phases/87.7-tailwind-v4-migration-inserted-2026-07-25/87.7-STYLE-AUDIT.md */}
        <form onSubmit={onSubmit} data-testid="tw4-space-y-exemplar" className="space-y-4">
          {/* Game Selection */}
          <div>
            {/* 88-33 Task 8 (fork 5 / census class C): htmlFor associates this visible
                label with the combobox's text input (id forwarded via GameComboInput). */}
            <label htmlFor="event-game-name" className="block text-sm font-normal text-content-primary mb-1">
              Game
            </label>
            <GameComboInput
              id="event-game-name"
              name="event-game-name"
              inputRef={gameInputRef}
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
              /* `userRole` was DROPPED here by plan 88.6-39: the owner's D4 ruling removed
                 QuickSuggestions' role gate, so the component no longer reads it. Left as a
                 removal rather than a dead prop — it is not a contract. */
            />
          </div>

          {/* Time Selection */}
          <div>
            <div className="flex items-center justify-between mb-2">
              {/* 88-33 Task 8 (census class C): a SPAN, not a <label> — this titles the
                  whole date/time SECTION (mode toggle + calendar or manual fields), so
                  there is no single control to point htmlFor at; the manual inputs below
                  carry their own real labels. Same treatment as the Participants section
                  title (88-21). */}
              {/* DECISION Phase 88.6-25 (R2): this required-field asterisk stays EXPOSED to a
                  screen reader — chosen OVER the `aria-hidden="true"` the shipped house idiom
                  puts on it (`app/components/form/FormField.tsx:118`,
                  `{required && <span aria-hidden="true"> *</span>}`) and OVER the treatment this
                  same commit gave the Start-Date and Duration asterisks below.

                  WHY THE TWO ARE TREATED DIFFERENTLY, so this does not read as a missed site.
                  FormField's idiom is safe because the CONTROL carries the requiredness: those
                  two asterisks sit inside real `<label htmlFor>` elements whose `<Input>` has
                  `required={!editingEvent}`, so hiding the glyph loses nothing. THIS span is a
                  SECTION TITLE — the 88-33 note below says so — and the section it titles has no
                  single required control to carry the meaning: in visual-calendar mode there is
                  no form control here at all, only `EventScheduler`. Hiding the glyph would
                  therefore delete the ONLY requiredness signal a screen-reader user gets on this
                  section, and replace it with nothing.

                  ALSO REJECTED: an `sr-only` "(required)" beside the glyph, which reads better
                  but AUTHORS NEW COPY — forbidden by the phase's P1 contract (UI-SPEC §6.1). If a
                  later phase lifts P1, that is the better answer and should be taken then.
                  The COLOUR is not part of this decision: the raw `red-500` palette step measured
                  3.7631:1 light / 3.6801:1 dark on the card and was moved to the shipped error-ink
                  token in this same commit at all four sites.

                  The twin of this decision is the "Participants" section title further down.
                  Adding `aria-hidden` here is a decision, not a cleanup.

                  ——— AMENDED Phase 88.6.1-15 (copy row C2, D-30), original reasoning above KEPT AS
                  HISTORY: the glyph is now `aria-hidden="true"` and the requiredness is SPOKEN by
                  the sr-only span right after it, whose text is the module constant
                  `REQUIRED_SR_LABEL` ("(required)"). That is the "better answer" the ALSO REJECTED
                  paragraph above named and declined ONLY under P1 (no new copy); the owner's copy
                  ratification (D-30, 2026-10-04, copy row C2) lifted P1 for exactly this string, so
                  it is taken now. The paragraph on WHY this title differs from the two manual
                  labels still holds and still decides the split: those two labels hide their glyph
                  and gain NO "(required)", because their `<Input required>` already speaks it — a
                  second one there would double it. REJECTED: `aria-required` on a wrapper or on
                  the Participants `role="group"` (not a supported attribute for that role, so it
                  would announce nothing), and leaving the star exposed (VoiceOver reads the glyph
                  as "star", never "required"). The star's colour token and position are untouched,
                  so it looks the same. Removing the sr-only span, or re-exposing the star, is a
                  decision, not a cleanup.

                  ——— AMENDED quick-261020-tz3 (VO-P2-4, owner VoiceOver walk 2026-10-20), the
                  reasoning above KEPT AS HISTORY: on the owner's iPhone, VoiceOver spoke only the
                  title and treated the sr-only node as its own stop, with a phantom 1px box — on
                  the Participants twin that stop scrolled the dialog to a blank region. WebKit's
                  iOS rule is that VoiceOver lands only on accessibility elements, and a heading
                  that has a label and no child elements is one (no focusability needed). So this
                  title is now a level-3 heading named "Date & Time (required)" — the constants
                  DATE_TIME_SECTION_TITLE + REQUIRED_SR_LABEL, so the visible words and the name
                  come from one source — with its visible content aria-hidden, matching the
                  dialog's existing level-3 section title (BallotOptionsEditor, "Game Ballot
                  (optional)"). The "(required)" now lives in the heading's NAME; no separate
                  node renders it. REJECTED: the sr-only node (a separate iOS stop — the trap);
                  `aria-label` on a role-less span (ARIA 1.2 prohibits naming a generic, and it
                  fails this dialog's axe `aria-prohibited-attr` audit, measured); `role="group"`
                  plus a label (an empty group — desktop screen readers may skip it);
                  `aria-required` (unsupported on that role); the `Heading` primitive (it renders
                  at 700 weight — a look change that needs the owner and a mockup). The class
                  string and the star are untouched, so it looks the same. Removing the heading
                  role, the label or the aria-hidden wrapper is a decision, not a cleanup. */}
              <span
                role="heading"
                aria-level={3}
                aria-label={`${DATE_TIME_SECTION_TITLE} ${REQUIRED_SR_LABEL}`}
                className="block text-sm font-normal text-content-primary"
              >
                <span aria-hidden="true">
                  {DATE_TIME_SECTION_TITLE} <span aria-hidden="true" className="text-content-status-error">*</span>
                </span>
              </span>
              {!hideVisualCalendar && (
                <button
                  type="button"
                  onClick={() => setUseVisualCalendar(!useVisualCalendar)}
                  className="text-sm text-content-link hover:text-content-link-hover active:opacity-75 underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {useVisualCalendar ? 'Switch to Manual Entry' : 'Switch to Visual Calendar'}
                </button>
              )}
            </div>

            {useVisualCalendar && !hideVisualCalendar ? (
              <>
                <EventScheduler
                /* PLAN 88.6-39 (W52 / D-18): THIS COMPONENT IS A WRITER OF THE PAINT-GESTURE
                   ACTIVE FLAG AND NEVER A READER OF IT. The flag goes straight into the leaf
                   module store (`heatmap/paintGestureActiveStore.ts`); it is deliberately NOT
                   held in `useState` here and this component never subscribes.

                   THE REASON IS MEASURED, NOT STYLISTIC. A state update at gesture ENGAGE
                   re-renders `createEvent`, and `EventScheduler` is rendered INLINE and
                   unmemoized right here — so that one update reconciles the ~196 memoized
                   scheduler cells whose per-coordinate payload cache exists precisely because
                   of it (`EventScheduler.tsx`, DECISION Phase 88.1-11). The fix would cause a
                   smaller copy of the bug it fixes, in the exact frame the user's finger goes
                   down. Both height sources above the grid — `QuickSuggestions` and
                   `TimezoneNudgeBanner` — read the flag from inside themselves for the same
                   reason. Hoisting this into parent state is a decision to reintroduce that
                   reconcile, not a simplification. */
                onActiveChange={setPaintGestureActive}
                onWeekChange={(date) => {
                  // The skip + clamp rule lives in `resolveWeekNav` (lib/eventFormUtils)
                  // as a pure, unit-tested function — null means "no-op". See its doc
                  // block for why (88.1-01 D-08 Layer 1).
                  const next = resolveWeekNav({
                    date,
                    currentMonday: effectiveMondayForUI,
                    minWeek,
                    maxWeek,
                  });
                  if (next) setCurrentWeekStart(next);
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
                          className="px-2 py-1 text-sm rounded-sm bg-surface-elevated hover:bg-surface-hover active:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                        >
                          &lt;
                        </button>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-content-muted">
                            Week of {format(effectiveMondayForUI, 'EEE MMM d')}
                          </span>
                          <button
                            type="button"
                            onClick={handleToday}
                            disabled={isOnTodayMonday}
                            aria-label="Jump to current week"
                            className="px-2 py-1 text-xs rounded-sm bg-surface-elevated hover:bg-surface-hover active:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                          >
                            Today
                          </button>
                        </div>
                        <button
                          type="button"
                          onClick={handleNextWeek}
                          disabled={!canGoForward}
                          aria-label="Next week"
                          className="px-2 py-1 text-sm rounded-sm bg-surface-elevated hover:bg-surface-hover active:opacity-75 disabled:opacity-50 disabled:cursor-not-allowed text-content-secondary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                        >
                          &gt;
                        </button>
                      </div>
                    )}
                    {promptId && (
                      <p className="text-xs text-content-muted mb-2">
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
                  <label htmlFor="start_date" className="block text-sm font-normal mb-1 text-content-primary">
                    Start Date & Time {!editingEvent && <span aria-hidden="true" className="text-content-status-error">*</span>}
                  </label>
                  {/* Phase 88.6-44 (T-88.6-124): `name` added on this and the three controls
                      below (duration, RSVP deadline, comments) — the house rule requires id +
                      name (`Input.tsx:11-19`, autofill heuristic); `handleChange` keys on `id`,
                      so `name` is inert to behaviour. Measured by the composed audit: four
                      "missing name attribute" failures on this surface before the fix. */}
                  <Input
                    type="datetime-local"
                    id="start_date"
                    name="start_date"
                    value={newEvent.start_date}
                    onChange={handleChange}
                    required={!editingEvent}
                    max="9999-12-31T23:59"
                  />
                </div>

                {/* Duration */}
                <div>
                  <label htmlFor="duration_minutes" className="block text-sm font-normal mb-1 text-content-primary">
                    Duration (minutes) {!editingEvent && <span aria-hidden="true" className="text-content-status-error">*</span>}
                  </label>
                  {(() => {
                    // Phase 66-03 CREVT-02 polish: inline error + red border when
                    // user types a value over the 720-minute (12h) cap. Native
                    // browser validation still blocks submit via max="720"; this
                    // is added user feedback, not a replacement.
                    const durationOverMax = newEvent.duration_minutes && Number(newEvent.duration_minutes) > 720;
                    return (
                      <>
                        <Input
                          type="number"
                          id="duration_minutes"
                          name="duration_minutes"
                          value={newEvent.duration_minutes || ''}
                          onChange={handleChange}
                          className={durationOverMax ? 'border-status-error' : ''}
                          placeholder="Enter duration in minutes"
                          required={!editingEvent}
                          min="1"
                          max="720"
                        />
                        {durationOverMax && (
                          <p className="text-content-status-error text-xs mt-1">Maximum 12 hours (720 minutes)</p>
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
              <label htmlFor="rsvp_deadline" className="block text-sm font-normal mb-1 text-content-primary">
                RSVP Deadline
              </label>
              <p className="text-xs text-content-muted mb-1">Required for game voting ballot</p>
              <Input
                type="datetime-local"
                id="rsvp_deadline"
                name="rsvp_deadline"
                value={newEvent.rsvp_deadline || ''}
                onChange={handleChange}
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
            {/* DECISION Phase 88-21 (DEF-88-10-01, site 3 of 3): this became a `<span id>` +
                `role="group" aria-labelledby`, NOT a `<label htmlFor>` like the other two sites
                this plan closed in `ParticipantRow.js`. It names a SECTION of participant rows —
                each row carries three controls of its own — so `htmlFor` would have had to point
                at exactly one of them and would have announced "Participants" over (say) the
                first row's Score box while leaving the section itself unnamed. Same treatment
                88-10 gave "Days of Week" in `userProfile/page.js`. Converting this to `htmlFor`
                to "match the other two" is a decision, not a cleanup. */}
            <span
              id="participants-section-label"
              role="heading"
              aria-level={3}
              aria-label={`${PARTICIPANTS_SECTION_TITLE} ${REQUIRED_SR_LABEL}`}
              className="block text-sm font-normal mb-2 text-content-primary"
            >
              {/* DECISION Phase 88.6-25 (R2), the twin of the "Date & Time" marker above: this
                  asterisk stays EXPOSED, chosen OVER `aria-hidden="true"`. This `<span>` names a
                  role="group" of participant ROWS, each carrying three controls of its own and
                  none of them `required` — so there is nothing under it to carry the
                  requiredness once the glyph is hidden. Same rejected alternatives as above.

                  ——— AMENDED Phase 88.6.1-15 (copy row C2, D-30), original reasoning above KEPT AS
                  HISTORY: the glyph is now hidden and the sr-only `REQUIRED_SR_LABEL` right after
                  it speaks "(required)", so the group below is named "Participants (required)".
                  Same reasoning as the amended "Date & Time" marker above: the sr-only words were
                  the better answer, declined only under P1, which the owner's D-30 ratification
                  (2026-10-04) lifted. REJECTED: `aria-required` on the `role="group"` (not a
                  supported attribute for that role, so it would announce nothing) and leaving the
                  star exposed ("star", never "required"). Removing the sr-only span or re-exposing
                  the star is a decision, not a cleanup.

                  ——— AMENDED quick-261020-tz3 (VO-P2-4, owner VoiceOver walk 2026-10-20), the
                  reasoning above KEPT AS HISTORY: VoiceOver on the owner's iPhone spoke only
                  "Participants" and then made the sr-only node its own stop, with a phantom 1px
                  box, and landing on it scrolled the dialog to a blank region. WebKit lands only
                  on accessibility elements, and a heading with a label and no child elements is
                  one. So this title is a level-3 heading named "Participants (required)"
                  (PARTICIPANTS_SECTION_TITLE + REQUIRED_SR_LABEL) with its visible content
                  aria-hidden, matching the dialog's existing level-3 section title
                  (BallotOptionsEditor). The group below still reads its name through
                  aria-labelledby, which takes this heading's aria-label, so it stays "Participants
                  (required)". REJECTED: the sr-only node (a separate iOS stop — the trap);
                  `aria-label` on a role-less span (ARIA 1.2 prohibits naming a generic; fails the
                  dialog's axe `aria-prohibited-attr`, measured); `role="group"` plus a label (an
                  empty group — desktop screen readers may skip it); `aria-required` (unsupported on
                  that role); the `Heading` primitive (700 weight — a look change, owner + mockup).
                  The id, the class string and the star are untouched, so it looks the same.
                  Removing the heading role, the label or the aria-hidden wrapper is a decision,
                  not a cleanup. */}
              <span aria-hidden="true">
                {PARTICIPANTS_SECTION_TITLE} <span aria-hidden="true" className="text-content-status-error">*</span>
              </span>
            </span>
            <div
              role="group"
              aria-labelledby="participants-section-label"
              className="space-y-2 max-h-60 overflow-y-auto border border-line p-2 rounded-sm bg-surface-input"
            >
              {newEvent.participants.map((participant, index) => (
                <ParticipantRow
                  key={participant._rowId ?? index}
                  participant={participant}
                  index={index}
                  groupMembers={groupMembers}
                  onParticipantChange={handleParticipantChange}
                  onToggleParticipant={toggleParticipant}
                  duplicateOfName={duplicateNameByIndex[index] ?? null}
                  requestNameFocus={participant._rowId != null && participant._rowId === focusRowId}
                  onNameFocusHandled={handleRowFocusHandled}
                />
              ))}
            </div>

            {/* Undo-on-remove (fork 4). Persistent, not timed — see the marker on
                toggleParticipant. Mounted right under the list so focus lands next to
                where the row was. */}
            <StatusRegion politeness="polite" className="sr-only">
              {removedParticipant
                ? `${removedParticipant.name} removed. Undo is available.`
                : undoAnnouncement}
            </StatusRegion>
            {removedParticipant && (
              <div className="mt-2 flex flex-wrap items-center gap-2 rounded-sm border border-line bg-surface-page px-2 py-1.5 text-sm text-content-secondary">
                <span>{removedParticipant.name} removed</span>
                <button
                  type="button"
                  ref={undoButtonRef}
                  onClick={undoRemoveParticipant}
                  className="min-h-11 px-2 text-content-link underline hover:no-underline focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  Undo
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRemovedParticipant(null);
                    // #21: this bar unmounts on dismiss — hand focus to the
                    // Add Participant button instead of dropping it to body.
                    addParticipantButtonRef.current?.focus();
                  }}
                  className="min-h-11 px-2 text-content-muted hover:text-content-primary focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring"
                  aria-label={`Dismiss undo for ${removedParticipant.name}`}
                >
                  Dismiss
                </button>
              </div>
            )}
            <Button
              ref={addParticipantButtonRef}
              onClick={addParticipant}
              disabled={guestCapReached}
              className="mt-2"
            >
              + Add Participant
            </Button>
            {guestCapReached && (
              <p className="mt-1 text-sm text-content-secondary">
                Guest limit reached ({MAX_GUEST_PARTICIPANTS} per event).
              </p>
            )}
          </div>

          {/* Winner, Picked By, and Group Win - only show for past events */}
          {newEvent.start_date && new Date(newEvent.start_date) <= new Date() && (
            <EventResultFields newEvent={newEvent} handleChange={handleChange} />
          )}

          {/* Comments */}
          <div>
            <label htmlFor="comments" className="block text-sm font-normal mb-1 text-content-primary">
              Comments
            </label>
            <Textarea
              id="comments"
              name="comments"
              value={newEvent.comments}
              onChange={handleChange}
              rows="3"
              placeholder="Optional notes about this game session"
            />
          </div>

          {/* Submit Buttons */}
          <div className="flex gap-2 justify-end">
            {/* DECISION Phase 88.6.1-26 (closable mid-create): the dialog stays closable while a
                create or update is in flight — Cancel, the header close, Escape and an outside press
                (the last three reach `onClose` through `Modal`'s `handleOpenChange`) are NOT gated;
                the request finishes and its toast appears after the dialog is gone (owner ruling,
                2026-10-05: fine). REJECTED: blocking close while creating (createGroup's shape,
                88.6.1-15). A late success cannot reopen a closed dialog, because every host's
                `modaltoggle` closes (groupPlanning's toggle runs from the closure captured while the
                dialog was open). Gating any close path here is a decision, not a cleanup.
                AMENDED Phase 88.6.1-81: a request that outlives its dialog never closes, resets or
                latches a reopened one — see DECISION Phase 88.6.1-81 (dialog session); the hosts'
                own `onEventCreated` closes are the hosts'. And the same payload in flight is sent
                once — see DECISION Phase 88.6.1-81 (one payload in flight).
                AMENDED Phase 88.6.1-68: the hosts' own closes are gone, so a request that outlives
                its dialog never closes a reopened one at any host. */}
            <Button variant="secondary" onClick={modaltoggle}>
              Cancel
            </Button>
            {/* DECISION Phase 87.8 (D-13/D-14/AF-2): SPEC R4 re-census names this the Create Event surface's primary CTA. Per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor (rejected — would distort ~15 compact/icon `.btn` sites, AF-2); 44px OVER Material's 48dp (declined, D-14). Global `.btn` sizing is Phase 88's (DEF-1). No `min-w-11`: wide text button.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup.  ——— AMENDED Phase 88.6 (D-09), original reasoning above KEPT AS HISTORY: the desktop half is now ANSWERED, and again by a split. TAKEN: `min-h-11` on the `Button` primitive's cva base (`src/components/ui/Button.tsx`), which reaches every viewport width. STILL REJECTED: the ALL-VIEWPORT floor on the `.btn` CLASS — `globals.css`'s `@media (width < 48rem)` rule is unwidened (`globals.css`, the `.btn` floor inside `@media (width < 48rem)`, with its reasoning in the comment directly above it), because square-by-design controls wear `.btn` and a class-level floor would deform them. That is why both halves of this marker are still literally true: the rejection is about a rule on the CLASS; the new floor is on the PRIMITIVE, which only opted-in elements get. CONSEQUENCE: this per-CTA `min-h-11` becomes redundant ONLY once this element is a `<Button>`. Until this file's own migration sweep lands, deleting it still shrinks this control on desktop. When the sweep does land, dropping it is correct and is part of that commit — not a separate cleanup, and not something to do from here. */}
            {/* DECISION Phase 88.6.1-26 (D-35, rule of POSITION): this submit is the PRESSED control,
                so its in-flight gate is `aria-disabled` plus a first-line REF latch in `onSubmit`
                (`eventSubmitInFlightRef`, read right after `e.preventDefault()`, released in the
                `finally` that wraps the whole body) — the createGroup shape (88.6.1-15) — plus the
                owner-ratified in-flight label (copy row C7, 2026-10-05: `Creating...` /
                `Updating...`, the same working cue as ScheduleForm's `Saving...` and
                AvailabilityForm's `Submitting...`). The label is SEEN on screen, and it is the
                button's accessible name, read when focus arrives or the user re-reads it; whether a
                screen reader speaks the in-flight rename by itself is NOT measured by this plan
                (plan 88.6.1-57's VoiceOver check measures it). REJECTED: no gate (a double tap
                created two events and sent two rounds of notifications — CT-3's census missed it
                because it searched for `disabled=` tags), the native attribute (it drops a keyboard
                user to <body> mid-create) and a label that stays put while working (only the gated
                colour would show the press registered; the name would never say so). The gated
                look is the shipped primary pair; no new token. VISIBLE DELTA, disclosed: while in
                flight the text is shorter, so the button narrows slightly inside this right-aligned
                row; its 44px floor is unchanged. Removing the latch, the attribute or the label
                swap is a decision, not a cleanup. */}
            <Button type="submit" data-testid="create-event-submit" aria-disabled={eventSubmitting || undefined}>
              {eventSubmitting
                ? (editingEvent ? UPDATING_EVENT_LABEL : CREATING_EVENT_LABEL)
                : (editingEvent ? 'Update Event' : 'Create Event')}
            </Button>
          </div>
        </form>
          </>
        )}
        </div>
      </Modal.Body>
    </Modal>
  );
}

export default CreateEvent;

