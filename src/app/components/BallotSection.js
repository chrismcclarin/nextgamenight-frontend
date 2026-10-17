'use client';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ballotAPI } from '../../lib/api';
import { Heading } from '../../components/ui/Heading';
import { StatusRegion } from '../../components/ui/StatusRegion';
import { useFocusRecovery } from '../../components/ui/useFocusRecovery';
import { logger, errCtx } from '@/lib/logger';

/**
 * BallotSection - Game voting ballot for an event
 */

// Copy row E14 (D-30, ratified 2026-10-04): the heard in-flight name of a pick while it saves.
// ONE template, so the whole ratified string lives in one source line for the AC-33 scan.
function savingPickLabel(gameName) {
  return `${gameName}, saving`;
}

/* DECISION Phase 88.6-22 (R3 #146): the three action-failure messages announce through the
   shared `StatusRegion` primitive, mounted UNCONDITIONALLY and fed an empty string when there is
   no error — chosen OVER the bare conditional `<p>`s that shipped, and OVER a hand-rolled
   `role="status"` div.

   WHY ALWAYS-MOUNTED: a screen reader announces a CHANGE to a live region, not the conditional
   mount of a new one. `{error && <StatusRegion …>}` would pass a presence check and announce
   nothing.

   WHY THE PRIMITIVE and not a div: `88.6-UI-SPEC.md:165` (§2's StatusRegion row) and §14 A-29
   ratify "No new hand-rolled `role=\"status\"` / `aria-live` markup in 88.6" — the three ad-hoc
   sites that survive (`ThresholdSlider.js:57`, `StarRatingPicker.js:95`, `ErrorFallback.tsx:73`)
   are a CLOSED residual. A hand-rolled div also silently drops `aria-atomic="true"`
   (StatusRegion.tsx:42).

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

   VISIBLE-SPACE RULE: `mb-2`/`mb-3` apply ONLY when the region is filled, so the empty region
   adds no space. At the open-ballot branch the region was additionally hoisted OUT of the
   `space-y-3` container, because an always-mounted first child would have given the block below
   it a 12px `margin-top` it does not have today. */
export default function BallotSection({ eventId, eventDate, userRole, userRsvpStatus }) {
  const [ballot, setBallot] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [votingOptionId, setVotingOptionId] = useState(null);
  const [resolvingOptionId, setResolvingOptionId] = useState(null);
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

  const isOrganizer = userRole === 'owner' || userRole === 'admin';
  const canVote = userRsvpStatus === 'yes' || userRsvpStatus === 'maybe';

  const fetchBallot = useCallback(async () => {
    if (!eventId) return;
    try {
      setError(null);
      const data = await ballotAPI.getBallot(eventId);
      setBallot(data);
    } catch (err) {
      setBallot(null);
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    fetchBallot();
  }, [fetchBallot]);

  const handleToggleVote = async (optionId, from) => {
    if (voteInFlightRef.current || !canVote) return;
    voteInFlightRef.current = true;
    const settle = recovery.arm({ preferred: () => winnerCardRef.current, from });
    setVotingOptionId(optionId);
    setError(null);

    setBallot(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        options: prev.options.map(opt =>
          opt.id === optionId
            ? { ...opt, user_voted: !opt.user_voted }
            : opt
        )
      };
    });

    try {
      await ballotAPI.toggleVote(eventId, optionId);
      await fetchBallot();
    } catch (err) {
      logger.info('Error toggling vote:', errCtx(err));
      /* FIXED Phase 88.6-22 (deviation, Rule 1): the `setError` and the rollback refetch were
         in the OPPOSITE order, so this message never reached the user. `fetchBallot` opens with
         `setError(null)` (see it above), which wiped the failure on the very next line — the
         optimistic vote rolled back and the surface reported nothing at all. Found by writing
         the announcement assertion this plan commissions, not by re-reading: the message the
         plan asks to associate and announce was unreachable.
         Restoring the old order is a decision, not a cleanup — the rollback must still happen,
         and it must happen BEFORE the message is set, not after. */
      await fetchBallot();
      setError('Could not save your vote. Please try again.');
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
     settles (about one round trip).
     Changing this is a decision, not a cleanup. */
  const handleResolveTie = async (optionId, from) => {
    if (!isOrganizer || resolveInFlightRef.current) return;
    resolveInFlightRef.current = true;
    setResolvingOptionId(optionId);
    const settle = recovery.arm({ preferred: () => winnerCardRef.current, from });
    setError(null);
    try {
      await ballotAPI.resolveTie(eventId, optionId);
      await fetchBallot();
    } catch (err) {
      logger.info('Error resolving tie:', errCtx(err));
      setError('Could not set the winner. Please try again.');
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
              className={`text-content-status-error${error ? ' mb-2' : ''}`}
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
              className={`text-content-status-error${error ? ' mb-2' : ''}`}
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
        {/* HOISTED OUT of the `space-y-3` container below. An always-mounted first child inside
            it would have given the voting block a 12px `margin-top` it does not have today —
            the empty region must cost no visible space. The `mb-3` it takes when FILLED is the
            same 12px the `space-y-3` gap used to supply. */}
        <StatusRegion
          id="ballot-vote-error"
          message={error ?? ''}
          className={`text-content-status-error${error ? ' mb-3' : ''}`}
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
          // The backend gate at routes/ballot.js:325-348 also rejects
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
