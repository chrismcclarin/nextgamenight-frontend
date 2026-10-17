'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import * as Sentry from '@sentry/nextjs';
import { ballotAPI } from '../../lib/api';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { logger, errCtx } from '@/lib/logger';

/**
 * BallotSection - Game voting ballot for an event
 */

// Copy rows E12, E13 and E14 (D-30, ratified by the owner 2026-10-04) and E15 (ratified by the
// owner 2026-10-05, WORDING BATCH 3 item J; manifest key E15, recorded as D-47), hoisted so each
// ratified string lives in ONE source line for the AC-33 scan. E12, E13 and E15 ship with the
// straight apostrophe (D-32 R8). E13 serves both pick lists. E14 is heard only: the pick's
// accessible name while it saves. E15 is the load-failure banner's title.
const VOTE_SAVE_FAILED_MESSAGE = "We couldn't save your vote. Please try again.";
const WINNER_SAVE_FAILED_MESSAGE = "We couldn't set the winner. Please try again.";
const BALLOT_LOAD_FAILED_TITLE = "Couldn't load the game vote";
function savingPickLabel(gameName) {
  return `${gameName}, saving`;
}

// The ballot with one option's `user_voted` set: flipped when `voted` is omitted (the
// optimistic flip and its local reversal), or set to the server's own boolean answer.
function toggleOptionVote(ballot, optionId, voted) {
  if (!ballot) return ballot;
  return {
    ...ballot,
    options: (ballot.options || []).map(opt =>
      opt.id === optionId
        ? { ...opt, user_voted: typeof voted === 'boolean' ? voted : !opt.user_voted }
        : opt
    ),
  };
}

/* DECISION Phase 88.6-22 (R3 #146): the three action-failure messages announce through the
   shared `StatusRegion` primitive, mounted UNCONDITIONALLY and fed an empty string when there is
   no error — chosen OVER the bare conditional `<p>`s that shipped, and OVER a hand-rolled
   `role="status"` div.

   WHY ALWAYS-MOUNTED: a screen reader announces a CHANGE to a live region, not the conditional
   mount of a new one. `{error && <StatusRegion …>}` would pass a presence check and announce
   nothing.
   AMENDED Phase 88.6.1-31 (D-42): that reason holds HERE because all three regions are polite
   (`role="status"`). An inserted `role="alert"` that arrives with its text IS announced (ARIA
   1.2; corrected in StatusRegion.tsx's EMPTY-FIRST bullet, `StatusRegion.tsx:9`, by Phase
   88.6.1-06), so the reason does not carry over to an assertive alert. The always-mounted shape
   still earns its place there for two other reasons: node identity stays assertable, and a
   clear-then-set re-announces a repeat.

   WHY THE PRIMITIVE and not a div: `88.6-UI-SPEC.md:189` (§2's StatusRegion row) and §14 A-29
   ratify "No new hand-rolled `role=\"status\"` / `aria-live` markup in 88.6" — the ad-hoc
   sites that survive (`StarRatingPicker.js:134`,
   `ErrorFallback.tsx:109-110`) are a CLOSED residual (the UI-SPEC row itself still carries its
   2026-09-13 line numbers; these are re-read 2026-10-16). A hand-rolled div also silently drops
   `aria-atomic="true"` (StatusRegion.tsx:101).
   AMENDED Phase 88.6.1-82: the third site this paragraph named was dead code and was deleted; the
   full live-region count is the R3-A29 census (plan 88.6.1-64, CENSUS.md §4).

   NO `aria-invalid` ANYWHERE HERE, and the reason is NOT an attribute-support limit. These
   controls are native `<button type="button">` elements and `aria-invalid` is a GLOBAL ARIA
   attribute permitted on every role, so there is no support objection to inherit. It is omitted
   because all three report an ACTION failure over a group of choice buttons — a tie-break that
   would not save, a fallback pick that would not save, a vote that would not save — rather than
   field validation. `FriendInvitePanel.js`'s email error IS field validation and DOES take
   `aria-invalid`, assertively; these stay polite. Adding it here is a decision, not a cleanup.

   THE DESCRIPTION LANDS ON THE FOCUSABLE CONTROL. `aria-describedby` on the role-less
   `<div className="space-y-2">` wrapper that holds the choice buttons would never be surfaced by
   assistive technology — an attribute string with zero AT-observable effect. Chosen arm: each
   choice `<button>` carries the error's id directly. REJECTED — `role="group"` on the wrapper
   with a name drawn from the prompt copy: it works, but it mints a container role on a plain
   list of buttons to carry one description, where the buttons can carry it themselves.

   VISIBLE-SPACE RULE, AMENDED Phase 88.6.1-31 (D-22): the margins are now UNCONDITIONAL
   (`mb-2`, `mb-2`, `mb-3`). While a region is empty it takes plan 88.6.1-06's
   `srOnlyWhenEmpty`, so it is out of flow and still adds no space; once it holds a message it is
   visible on the same node with the same 8px and 12px gaps as before. The per-site class
   ternary this replaced is the duplication D-22 retires. The open-ballot region stays hoisted OUT
   of the `space-y-3` container: Tailwind 4.3.3's `space-y-3` is `:where(& > :not(:last-child))`
   setting `margin-block-end`, so an empty FIRST child inside the stack would itself have carried
   a 12px bottom margin (the v4 mechanism; the v3 one this paragraph first named, a top margin on
   the next sibling, is not what this build emits). Each region's containing block was checked
   for the plan 06 caveat: its static position is ABOVE the picks inside the card body, so the
   1px `sr-only` box can never extend the page's scrollable overflow. */
export default function BallotSection({ eventId, eventDate, userRole, userRsvpStatus }) {
  const [ballot, setBallot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // E15: null, or `{ eventId, caught }` for the current event's failed load (`caught` is the
  // caught error object). Cleared ONLY by a successful load, never at the start of one, so the
  // banner stays through its own retry. The field is deliberately NOT named after the error
  // itself: errorEnvelopeReads.test.ts reads any property of that name as a response-body read,
  // and this is local state (the rename keeps the envelope gate free of a new exclusion).
  const [loadError, setLoadError] = useState(null);
  const [votingOptionId, setVotingOptionId] = useState(null);
  const [resolvingOptionId, setResolvingOptionId] = useState(null);
  /* DECISION Phase 88.6.1-82 (carry-in, the register entry "BallotSection shows the PREVIOUS
     event's ballot"): when the `eventId` prop changes, the previous event's ballot is dropped and
     the first-load loader shows IN THE SAME RENDER (React's adjust-state-on-a-prop-change pattern,
     a set during render that re-renders before anything commits), so no frame ever shows the old
     event's picks under the new eventId, where a press would send the NEW eventId with an OLD
     option id. A same-event refresh (a post-action refetch, E15's retry) never takes this branch,
     so plan 31's keep-last-good and its two supersede guards are unchanged. REJECTED: (a) a reset
     in an effect, which commits one frame of the old ballot under the new eventId first; (b)
     rendering only a ballot whose loaded eventId matches the prop while keeping the old one in
     state, which leaves a stale ballot for every setBallot updater to edit; (c) keeping the old
     card until the new GET answers (the bug). Accepted: a pick focused at the moment of a switch
     is removed with the card, and the switch is a navigation the user started elsewhere.
     Changing this is a decision, not a cleanup. */
  const [ballotEventId, setBallotEventId] = useState(eventId);
  if (ballotEventId !== eventId) {
    setBallotEventId(eventId);
    setBallot(null);
    setError(null);
    setLoading(true);
  }
  const resolveInFlightRef = useRef(false);
  const voteInFlightRef = useRef(false);
  const gameVoteHeadingRef = useRef(null);
  const winnerCardRef = useRef(null);

  /* DECISION Phase 88.6.1-31 (Req 5 / D-04, D-05): a successful pick swaps the tie-break or
     fallback branch for the winner card, and a vote whose refetch shows the ballot closed swaps
     the open branch for another one; both REMOVE the control the user pressed. The shared
     `useFocusRecovery` is armed synchronously at the press and settled in `finally`, with
     `preferred` = the winner card (it reads "Winner" and the game, which is what the pick
     produced) and `fallback` = the "Game Vote" heading (D-05), else the page floor; never
     `<body>`. Each arm also passes `from` = the pressed control, per the hook's consumer
     contract (1) (`useFocusRecovery.ts`, CONSUMER CONTRACT (1), anchor `event.currentTarget`):
     Safari does not focus a clicked button, so the activeElement seed alone would watch nothing.
     REJECTED: (a) per-host inline focus code (D-04, tenet); (b) focusing at settle time, which
     runs before the branch swap commits; (c) minting a heading or a status line to land on.
     Changing this is a decision, not a cleanup. */
  const recovery = useFocusRecovery({ fallback: gameVoteHeadingRef });

  // W005 bookkeeping (see the DECISION marker at `fetchBallot`). `currentEventIdRef` holds the
  // committed `eventId` prop; it is assigned in the render body so it is current before any
  // awaited answer for the previous event can land.
  const currentEventIdRef = useRef(eventId);
  currentEventIdRef.current = eventId;
  const loadSeqRef = useRef(0);
  const loadedEventIdRef = useRef(null);
  const loadedStatusRef = useRef(null);
  // E15: the class-only capture's latch (one event per failure episode) and the load a retry or
  // refocus re-attempt shares while it is in flight.
  const lastReportedKeyRef = useRef(null);
  const pendingLoadRef = useRef(null);

  const isOrganizer = userRole === 'owner' || userRole === 'admin';
  const canVote = userRsvpStatus === 'yes' || userRsvpStatus === 'maybe';

  /* DECISION Phase 88.6.1-31 (W005 / D-26): `fetchBallot` resolves one of THREE outcomes —
     'loaded', 'failed' (a still-current request genuinely failed) or 'superseded' (a newer load
     started, or its eventId is no longer current) — and a superseded request touches no state at
     all, success or failure. A failed load keeps the ballot already on screen ONLY when it was
     loaded for the SAME eventId (`loadedEventIdRef`); otherwise it clears it. Two guards make that
     safe: a request-sequence counter (`loadSeqRef`, review #141: an older request settling last
     neither wipes nor replaces the current ballot) and the current-eventId ref (review r3 M-23:
     the counter alone is latest-request-wins, and a handler's refetch from the closure of an
     earlier event would become the latest and write that event's ballot under the new one; a call
     issued for a non-current eventId sends no GET and bumps no counter). When a post-pick refetch
     FAILS, the server's returned winner is applied only when its `game_id` is non-null — the only
     case `routes/ballot.js` stores (anchor `if (option.game_id) {`); a free-text winner is
     answered 200 but stored nowhere (`.planning/deferred/phase-91.md`, owned by Phase 91), so the
     picks stay (review #129).
     REJECTED: (a) the review's keep-any-previous-value one-liner (WR-105): the single-event mount
     can keep one instance across eventId changes (`gameDetail/page.js`, anchor
     `key={ballotRefreshKey}`) and would show the previous event's ballot; (b) refetch-only
     rollback, which is the bug this replaces (a phone with no network fails the refetch too, and
     the whole card vanished); (c) keep-last-good without the sequence guard, because a late answer
     for the previous event would then wipe or replace the current one; (d) painting any returned
     winner, because it shows a free-text winner the server never kept; (e) one boolean `false`
     for both "failed" and "superseded", because the handlers would read it as a failed refetch and
     paint a fallback onto whatever ballot is now on screen.
     Changing this is a decision, not a cleanup. */
  const fetchBallot = useCallback(async () => {
    if (!eventId) return 'failed';
    if (currentEventIdRef.current !== eventId) return 'superseded';
    loadSeqRef.current += 1;
    const seq = loadSeqRef.current;
    const isSuperseded = () => seq !== loadSeqRef.current || currentEventIdRef.current !== eventId;
    setError(null);
    try {
      const data = await ballotAPI.getBallot(eventId);
      if (isSuperseded()) return 'superseded';
      loadedEventIdRef.current = eventId;
      loadedStatusRef.current = data?.ballot_status ?? null;
      // A successful load ends the failure episode: the next failure files again.
      lastReportedKeyRef.current = null;
      setLoadError(null);
      setBallot(data);
      return 'loaded';
    } catch (err) {
      logger.info('Error loading ballot:', errCtx(err));
      if (isSuperseded()) return 'superseded';
      // The class-only capture (plan 88.6.1-32's W006 shape, BrowseMoreModal.js anchor
      // `lastReportedKeyRef.current !== reportKey`): a wrapped Error naming only the class and
      // the code, literal tags, latched to one event per failure episode. Never `logger.error`,
      // which captures the error object and forwards its upstream string (logger.ts). This is
      // the ONE place the code is read, and it decides nothing that renders.
      const cls = (err && err.name) || 'Error';
      const code = err && typeof err.code === 'string' ? ` ${err.code}` : '';
      const reportKey = `ballot load failed: ${cls}${code}`;
      if (lastReportedKeyRef.current !== reportKey) {
        lastReportedKeyRef.current = reportKey;
        Sentry.captureException(new Error(reportKey), {
          tags: { feature: 'ballot', op: 'ballot-load' },
        });
      }
      setLoadError({ eventId, caught: err });
      if (loadedEventIdRef.current !== eventId) {
        loadedEventIdRef.current = null;
        loadedStatusRef.current = null;
        setBallot(null);
      }
      return 'failed';
    } finally {
      if (!isSuperseded()) setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchBallot();
  }, [fetchBallot]);

  // E15's retry (the banner's Try again and the hook's refocus re-attempt). Stable per eventId,
  // never rejects (fetchBallot catches everything), and resolves `{ isError }` so plan 21's ONE
  // retry-outcome rule can tell a failed retry from a success: only 'loaded' is a success, and
  // 'superseded' counts as not loaded. A load already in flight for the SAME eventId is reused
  // instead of starting a second GET (review #142); a different eventId never reuses it, and the
  // sequence guard discards the old one's answer.
  const retryLoad = useCallback(async () => {
    let pending = pendingLoadRef.current;
    if (!pending || pending.eventId !== eventId) {
      const started = { eventId, promise: fetchBallot() };
      pendingLoadRef.current = started;
      started.promise.finally(() => {
        if (pendingLoadRef.current === started) pendingLoadRef.current = null;
      });
      pending = started;
    }
    const outcome = await pending.promise;
    return { isError: outcome !== 'loaded' };
  }, [eventId, fetchBallot]);

  // The banner shows only for the CURRENT event, and only while no ballot for it is on screen: a
  // failed follow-up refetch over a kept ballot never shows it (LF-6), and one event's failure is
  // never shown for another (LF-5). The house adapter for a hand-rolled fetch
  // (ResponseDashboard.js, anchor `const errorState =`), called above every
  // early return.
  const showLoadFailure = !ballot && loadError?.eventId === eventId;
  const loadErrorState = useFetchErrorState({
    isError: showLoadFailure,
    error: showLoadFailure ? loadError.caught : null,
    refetch: retryLoad,
  });

  const handleToggleVote = async (optionId, from) => {
    if (voteInFlightRef.current || !canVote) return;
    voteInFlightRef.current = true;
    const settle = recovery.arm({ preferred: () => winnerCardRef.current, from });
    setVotingOptionId(optionId);
    setError(null);
    // Every write after an await runs only while this press's event is still current (r3 H2-02).
    const voteEventId = eventId;
    const stillCurrent = () => currentEventIdRef.current === voteEventId;

    setBallot(prev => toggleOptionVote(prev, optionId));

    try {
      const result = await ballotAPI.toggleVote(eventId, optionId);
      const outcome = await fetchBallot();
      // Review #131: the vote saved but the refetch failed. Show the vote the SERVER took, never
      // the optimistic guess; a body with no boolean `voted` keeps the optimistic flip (r3 M-24).
      if (outcome === 'failed' && stillCurrent() && typeof result?.voted === 'boolean') {
        setBallot(prev => toggleOptionVote(prev, optionId, result.voted));
      }
    } catch (err) {
      logger.info('Error toggling vote:', errCtx(err));
      /* FIXED Phase 88.6-22 (deviation, Rule 1): the `setError` and the rollback refetch were
         in the OPPOSITE order, so this message never reached the user. `fetchBallot` opens with
         `setError(null)` (see it above), which wiped the failure on the very next line — the
         optimistic vote rolled back and the surface reported nothing at all. Found by writing
         the announcement assertion this plan commissions, not by re-reading: the message the
         plan asks to associate and announce was unreachable.
         Restoring the old order is a decision, not a cleanup — the rollback must still happen,
         and it must happen BEFORE the message is set, not after.
         AMENDED Phase 88.6.1-31 (W005, D-26), 2026-10-16: the order stands, and the optimistic
         flip is now ALSO reversed LOCALLY before the refetch, because on a phone the refetch
         fails too (no network) and a failed refetch now keeps the card, which would otherwise
         show the failed vote as cast. E12 is now set only while the ballot on screen after the
         refetch is still the OPEN ballot (review #193): when the refetch shows it closed, the
         branch change is itself the outcome, and E12 would land in the tie-break region and
         describe its picks. */
      if (!stillCurrent()) return;
      setBallot(prev => toggleOptionVote(prev, optionId));
      const outcome = await fetchBallot();
      if (
        outcome !== 'superseded' &&
        stillCurrent() &&
        loadedEventIdRef.current === voteEventId &&
        loadedStatusRef.current === 'open'
      ) {
        setError(VOTE_SAVE_FAILED_MESSAGE);
      }
    } finally {
      voteInFlightRef.current = false;
      setVotingOptionId(null);
      settle();
    }
  };

  /* DECISION Phase 88.6.1-31 (W013 / D-35): ONE synchronous first-line REF latch,
     `resolveInFlightRef`, for BOTH pick lists (the tie-break picks and the fallback picks both
     call this handler), released in `finally`, plus a `resolvingOptionId` state that drives the
     attributes: the pressed pick takes `aria-disabled` and stays in the focus order, its siblings
     take native `disabled` (the rule of POSITION, `DECISION Phase 88.6-22`, FriendInvitePanel.js
     anchor `The latch is a REF`; the in-file twin is the vote options below).
     REJECTED: (a) the review's state-only first-line check (IN-106): two presses dispatched before
     a re-render both run the same stale closure, so the second is not refused (T1c pins it);
     (b) native `disabled` on the pressed pick, which drops it from the focus order and strands a
     keyboard or switch user mid-pick; (c) a separate latch per list, because both lists share
     this one handler and the two lists never render together.
     STATED EDGE: the latch is per instance, not per event. If the single-event mount switches
     `eventId` while a pick is saving, the new event's picks stay gated until that request
     settles (about one round trip); the old pick's outcome never paints onto the new event (the
     still-current checks in this handler, T2i).
     Changing this is a decision, not a cleanup. */
  const handleResolveTie = async (optionId, from) => {
    if (!isOrganizer || resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    setResolvingOptionId(optionId);
    const settle = recovery.arm({ preferred: () => winnerCardRef.current, from });
    setError(null);
    const pickEventId = eventId;
    const stillCurrent = () => currentEventIdRef.current === pickEventId;
    try {
      const result = await ballotAPI.resolveTie(eventId, optionId);
      const outcome = await fetchBallot();
      // Review #129: the pick saved but the refetch failed. Show the winner the server STORED
      // (non-null `game_id`); a free-text winner was stored nowhere, so the picks stay and no
      // error is claimed for a request that succeeded. Never on 'superseded' (T2i).
      const winner = result?.winner;
      if (outcome === 'failed' && stillCurrent() && winner && winner.game_id != null) {
        setBallot(prev =>
          prev ? { ...prev, winner, needs_tie_break: false, needs_fallback_pick: false } : prev
        );
      }
    } catch (err) {
      logger.info('Error resolving tie:', errCtx(err));
      if (stillCurrent()) setError(WINNER_SAVE_FAILED_MESSAGE);
    } finally {
      resolveInFlightRef.current = false;
      setResolvingOptionId(null);
      settle();
    }
  };

  const getRelativeTime = (dateStr) => {
    if (!dateStr) return '';
    const target = new Date(dateStr);
    const now = new Date();
    const diffMs = target - now;
    if (diffMs <= 0) return 'soon';
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);
    if (diffDays > 0) return `in ${diffDays} day${diffDays !== 1 ? 's' : ''}`;
    if (diffHours > 0) return `in ${diffHours} hour${diffHours !== 1 ? 's' : ''}`;
    const diffMins = Math.floor(diffMs / (1000 * 60));
    return `in ${diffMins} minute${diffMins !== 1 ? 's' : ''}`;
  };

  if (loading) {
    return (
      <div className="mt-4 p-4 bg-surface-elevated rounded-card">
        <p className="text-sm text-content-muted">Loading ballot...</p>
      </div>
    );
  }

  /* DECISION Phase 88.6.1-31 (E15 / Req 9): a failed load for the current event renders the
     house full banner titled `BALLOT_LOAD_FAILED_TITLE` (copy row E15, owner ruling 2026-10-05),
     with the register line the hook derives from the error's code and its own Try again, IN PLACE
     of the card, inside a `mt-4` wrapper (the card's own top gap; the same slot the first-load
     loader takes above).
     WHY IT IS SAFE TO KEY ON A REJECTION: the server's only "this event has no vote" answer is a
     200 whose body is `{ ballot_status: null }` (`periodictabletopbackend_v2/Sonnet/routes/
     ballot.js`, anchor `return res.json({ ballot_status: null });`), which RESOLVES and reaches
     the unchanged early return below; every way the load can fail rejects. So no status, code or
     message is read to decide it. The banner must never show on an event that simply has no vote
     (owner, 2026-10-05). The error is cleared only by a successful load, so the banner and its
     focused Try again stay mounted through their own retry.
     REJECTED: (a) a card shell with the Game Vote heading above the banner: at 375px it nests the
     banner's bordered, padded box inside the card's bordered, padded body under a header row, on
     every failing card, and its heading asserts a vote exists on an event whose load failed and
     may have none; heading navigation was its one gain, and the inserted banner alert is
     announced (D-42); (b) the compact notice: its text is fixed and is not E15; (c) keying on the
     stored error alone: it would cover a kept ballot after a failed follow-up refetch and show one
     event's failure for the next; (d) reading the status or the code to decide "no vote": not
     needed, and the server gives no code for it; (e) a report-context value: none was ratified
     for this banner (D-31, D-32 R5; plan 88.6.1-55 made the same call) — owed to the owner as a
     wording item.
     FOCUS: after a successful Try again the banner (plan 88.6.1-21's hook, plan 88.6.1-70's
     `focusTarget`) moves focus to the Game Vote heading of the card that replaced it, so a phone
     reader keeps their place on the card; when the success renders no card (an event with no
     vote) the ref is empty and the page floor applies. REJECTED: the floor alone (on a phone
     `main h1` is a screen or more above the card); a per-host focus call (D-04). No per-host focus
     code here.
     PER INSTANCE (review #38): a failed load files one class-only Sentry event per failure episode
     PER INSTANCE, so N failing cards on one page (the Upcoming list mounts one per event,
     `gameDetail/page.js:3093`, anchor `upcomingEvents.map`) file N events.
     MULTI-MOUNT (owner ruling #192, OPTION A, owner 2026-10-13): the Upcoming list mounts one
     instance per upcoming session card (`gameDetail/page.js:1922`, anchor `Ballot Section - game
     voting`), so a route-wide failure shows N banners and a screen reader hears N assertive
     announcements (the warning-tone region is assertive, `Banner.tsx`, anchor `const assertive`).
     CHOSEN: one banner per card, N announcements accepted — the banner's position says which
     session's vote failed, each Try again retries that vote, and N is small. REJECTED: (B) one
     list-level report — new words, and it loses the per-session retry; (C) the compact notice —
     its fixed text is not E15. LF-10 pins two regions for two failing instances.
     Collapsing these into one report is a decision, not a cleanup. */
  if (showLoadFailure) {
    return (
      <div className="mt-4">
        <FetchErrorBanner
          state={loadErrorState}
          title={BALLOT_LOAD_FAILED_TITLE}
          focusTarget={gameVoteHeadingRef}
        />
      </div>
    );
  }

  if (!ballot || ballot.ballot_status === null) {
    return null;
  }

  const { ballot_status, rsvp_deadline, options, winner, needs_tie_break, needs_fallback_pick, tied_options } = ballot;

  // --- CLOSED BALLOT STATES ---
  if (ballot_status === 'closed') {
    if (winner) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
          </div>
          <div className="p-4">
            <div ref={winnerCardRef} className="bg-status-success-subtle border border-status-success rounded-card p-4 mb-3">
              <div className="flex items-center gap-2">
                {/* UI-SPEC §4.3: non-heading `text-lg` residue. Resolves to `text-xl` (20) under rule
                    R2's primary-string clause. NOT a `<Heading>` — P4 forbids inventing a semantic
                    level for an element that never had one, and Phase 92 owns the outline review. */}
                <span className="text-xl font-bold text-content-status-success">Winner</span>
              </div>
              {/* Same §4.3 residue pair as the "Winner" label above; 600 -> 700 with it. */}
              <p className="text-xl font-bold text-content-primary mt-1">{winner.game_name}</p>
            </div>
            {options && options.filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name).length > 0 && (
              <div className="space-y-1">
                {options
                  .filter(o => o.game_id !== winner.game_id || o.game_name !== winner.game_name)
                  .map(opt => (
                    <div key={opt.id} className="px-3 py-2 text-sm text-content-muted bg-surface-elevated rounded-sm">
                      {opt.game_name}
                    </div>
                  ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    if (needs_tie_break && isOrganizer) {
      return (
        /* DECISION Phase 88-27 (D-32 bucket B): the header's `border-b` stays NEUTRAL, chosen
           OVER re-pointing it to `border-status-warning` like the other 20 status containers this
           plan converted. Two reasons, both local: the WRAPPER one line up already carries the
           full-strength warning border, so the semantic is stated once; and the two structurally
           identical "Game Vote" headers in this same component (the winner branch and the
           non-organizer branch) both use `border-b border-line`, so colouring only this one would
           split one header across two tokens. That is the inconsistency 88-26 refused to create
           at these exact lines. The BACKGROUND does take the warning tint — it replaces the
           siblings' `bg-surface-elevated`, which is where the state difference belongs. */
        <div className="mt-4 border border-status-warning rounded-card overflow-hidden">
          <div className="bg-status-warning-subtle px-4 py-3 border-b border-line">
            <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
          </div>
          <div className="p-4">
            {/* UI-SPEC §4.5 EMPHASIS outcome: `font-medium` deleted, the emphasis carried by
                the status colour token this copy already had. */}
            <p className="text-sm text-content-status-warning mb-3">
              Voting ended in a tie! Pick the winning game:
            </p>
            <StatusRegion
              id="ballot-tiebreak-error"
              message={error ?? ''}
              srOnlyWhenEmpty
              className="mb-2 text-content-status-error"
            />
            <div className="space-y-2">
              {/* DECISION Phase 88.6.1-31 (E14): while a pick saves, its accessible NAME is
                  `{game name}, saving`, set as an `aria-label` only while saving, from the ONE
                  hoisted template `savingPickLabel` (copy row E14, D-30, ratified heard-only).
                  At rest the pick has no `aria-label` and its name is the game name. The name
                  keeps the visible label at its start (WCAG 2.5.3). WHAT IS PROVEN (review #191):
                  this is the name a screen reader reads when focus arrives on the pick or the
                  user re-reads it. Whether a screen reader speaks the rename UNPROMPTED while focus
                  already sits on the pick is not measured by this plan's tests; if plan 88.6.1-57's
                  VoiceOver walk finds it silent, the owner rules on placing the ratified E14 text
                  in this branch's existing polite region (no new words). A region is never added
                  here without that ruling.
                  REJECTED: (a) an sr-only suffix span, which splits the template across a JSX text
                  node and a constant and puts an extra node inside the control; (b) a visible
                  "Saving" label, because E14 is ratified heard-only (the missing visible cue is
                  routed to Phase 88.9); (c) `aria-busy`, which is not a name.
                  The fallback pick list below takes the same three attributes for the same
                  reasons. Changing this is a decision, not a cleanup. */}
              {(tied_options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(event) => handleResolveTie(opt.id, event.currentTarget)}
                  disabled={!!resolvingOptionId && resolvingOptionId !== opt.id}
                  aria-disabled={resolvingOptionId === opt.id ? 'true' : undefined}
                  aria-label={resolvingOptionId === opt.id ? savingPickLabel(opt.game_name) : undefined}
                  aria-describedby={error ? 'ballot-tiebreak-error' : undefined}
                  className="w-full text-left px-4 py-3 rounded-card border-2 border-status-warning bg-status-warning-subtle hover:bg-status-warning-subtle-hover transition-colors text-sm text-content-primary cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (needs_tie_break && !isOrganizer) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
          </div>
          <div className="p-4">
            <p className="text-sm text-content-secondary">
              Voting has closed. The organizer is choosing the winning game.
            </p>
          </div>
        </div>
      );
    }

    if (needs_fallback_pick && isOrganizer) {
      return (
        /* DECISION Phase 88-27 (D-32 bucket B): neutral `border-b` on the header, same call and
           same reasons as the tie-break branch ~50 lines above — see that marker. */
        <div className="mt-4 border border-status-warning rounded-card overflow-hidden">
          <div className="bg-status-warning-subtle px-4 py-3 border-b border-line">
            <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
          </div>
          <div className="p-4">
            {/* UI-SPEC §4.5 EMPHASIS outcome, same call as the tie-break branch above. */}
            <p className="text-sm text-content-status-warning mb-3">
              No votes were cast. Pick a game for this event:
            </p>
            <StatusRegion
              id="ballot-fallback-error"
              message={error ?? ''}
              srOnlyWhenEmpty
              className="mb-2 text-content-status-error"
            />
            <div className="space-y-2">
              {(options || []).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(event) => handleResolveTie(opt.id, event.currentTarget)}
                  disabled={!!resolvingOptionId && resolvingOptionId !== opt.id}
                  aria-disabled={resolvingOptionId === opt.id ? 'true' : undefined}
                  aria-label={resolvingOptionId === opt.id ? savingPickLabel(opt.game_name) : undefined}
                  aria-describedby={error ? 'ballot-fallback-error' : undefined}
                  className="w-full text-left px-4 py-3 rounded-card border-2 border-status-warning bg-status-warning-subtle hover:bg-status-warning-subtle-hover transition-colors text-sm text-content-primary cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
                >
                  {opt.game_name}
                </button>
              ))}
            </div>
          </div>
        </div>
      );
    }

    if (needs_fallback_pick && !isOrganizer) {
      return (
        <div className="mt-4 border border-line rounded-card overflow-hidden">
          <div className="bg-surface-elevated px-4 py-3 border-b border-line">
            <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
          </div>
          <div className="p-4">
            <p className="text-sm text-content-secondary">
              Voting has closed. The organizer is choosing the game.
            </p>
          </div>
        </div>
      );
    }

    return null;
  }

  // --- OPEN BALLOT ---
  return (
    <div id="vote" className="mt-4 border border-line rounded-card overflow-hidden">
      <div className="bg-surface-elevated px-4 py-3 border-b border-line">
        <Heading ref={gameVoteHeadingRef} level={3} size="label" className="text-content-primary">Game Vote</Heading>
        <p className="text-xs text-content-muted mt-0.5">Tap games you'd enjoy playing</p>
      </div>

      <div className="p-4">
        {/* HOISTED OUT of the `space-y-3` container below. Tailwind 4.3.3's `space-y-3` is
            `:where(& > :not(:last-child))` setting `margin-block-end`, so an always-mounted first
            child inside it would itself have carried a 12px bottom margin (corrected Phase
            88.6.1-31: the v3 top-margin mechanism this first named is not what v4 emits) — the
            empty region must cost no visible space. AMENDED Phase 88.6.1-31 (D-22): the region
            now takes `srOnlyWhenEmpty`, so while empty it is out of flow; its now-unconditional
            `mb-3` is the same 12px the `space-y-3` gap used to supply, shown only once it holds
            a message. */}
        <StatusRegion
          id="ballot-vote-error"
          message={error ?? ''}
          srOnlyWhenEmpty
          className="mb-3 text-content-status-error"
        />
        <div className="space-y-3">
        {canVote ? (
          <div className="space-y-2">
            {(options || []).map(opt => {
              const isVoted = opt.user_voted;
              const isToggling = votingOptionId === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={(event) => handleToggleVote(opt.id, event.currentTarget)}
                  /* DECISION Phase 88.6-22 (the rule of POSITION, stated in full at
                     FriendInvitePanel.js's latch marker): while a vote is in flight the PRESSED
                     option exposes `aria-disabled` and keeps its place in the focus order, while
                     its SIBLINGS — which nobody is standing on — keep native `disabled`. A
                     natively disabled element leaves the focus order, so gating the pressed
                     option natively strands a keyboard or switch user mid-vote (DR-C).
                     Both halves of the rule are already paid for here: `handleToggleVote` refuses
                     the re-press SYNCHRONOUSLY at its first line (`if (votingOptionId || !canVote)
                     return;`), and the in-flight and gated cues are call-site utilities on a
                     non-`.btn` element, so no `.btn:disabled` wash is involved and the visual
                     result is unchanged. Collapsing this back to one `disabled` is a decision.
                     AMENDED Phase 88.6.1-31 (2026-10-16, T1d): the first-line refusal is now the
                     `voteInFlightRef` REF latch (`if (voteInFlightRef.current || !canVote)
                     return;`), released in `finally`. The state check quoted above read the stale
                     closure on a second press dispatched before a re-render, so two `toggleVote`
                     requests went out (T1d was RED on it) — the house rule's own reason for a ref.
                     `votingOptionId` stays the attribute source; the attribute split is unchanged. */
                  disabled={!!votingOptionId && !isToggling}
                  aria-disabled={isToggling ? 'true' : undefined}
                  aria-describedby={error ? 'ballot-vote-error' : undefined}
                  className={`w-full text-left px-4 py-3 rounded-card border-2 transition-colors text-sm cursor-pointer focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2
                    ${isVoted
                      ? 'border-accent bg-surface-accent-subtle text-content-primary'
                      : 'border-line bg-surface-card text-content-primary hover:bg-surface-hover hover:border-line-strong'
                    }
                    ${isToggling ? 'opacity-70' : ''}
                    ${votingOptionId && !isToggling ? 'opacity-50 cursor-not-allowed' : ''}
                  `}
                >
                  <div className="flex items-center justify-between">
                    <span>{opt.game_name}</span>
                    {isVoted && (
                      /* UI-SPEC §4.5, the badge/ink case: 600 -> 700. 400 was REJECTED — this
                         is a 12px state badge whose whole job is to read as a distinct marker
                         beside the option label, and at 400 it stops registering as one. */
                      <span className="text-content-accent text-xs font-bold">Voted</span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          // POLL-06 (D-BALLOT-07): defense-in-depth gated state.
          // The backend gate at routes/ballot.js:385-394 also rejects
          // votes from non-yes/maybe-RSVPed users; this UI prevents the
          // user from bouncing off a 403 by hiding vote buttons entirely.
          <div role="region" aria-label="Vote gated until RSVP">
            <div className="space-y-2 mb-3">
              {(options || []).map(opt => (
                <div
                  key={opt.id}
                  className="px-4 py-3 rounded-card border border-line bg-surface-elevated text-sm text-content-secondary"
                >
                  {opt.game_name}
                </div>
              ))}
            </div>
            <p className="text-sm text-content-muted italic">
              RSVP Yes or Maybe to vote on the game
            </p>
          </div>
        )}

        {rsvp_deadline && (
          <p className="text-xs text-content-muted mt-2">
            Voting closes {getRelativeTime(rsvp_deadline)}
          </p>
        )}
        </div>
      </div>
    </div>
  );
}
