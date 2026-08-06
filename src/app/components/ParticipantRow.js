'use client';
import { useId, useState } from 'react';
import { invitesAPI } from '../../lib/api';
import { Input } from '@/components/ui/Input';

export default function ParticipantRow({ participant, index, groupMembers, onParticipantChange, onToggleParticipant, isAdmin = false, group_id = null }) {
  const [inviteStatus, setInviteStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [inviteError, setInviteError] = useState(null);
  /* DECISION Phase 88-21 (DEF-88-10-01): control ids come from `useId`, NOT from the `index`
     prop. Chosen OVER `participant-${index}-score`, which is the obvious shape and is what the
     surrounding code already has in hand. Index-derived ids are only unique WITHIN one list, and
     this row renders in more than one place; two participant lists on a page would mint duplicate
     ids and `htmlFor` would then resolve to whichever control the browser saw first — silently
     mislabelling the second list. Re-deriving these from `index` is a decision, not a cleanup. */
  const rowId = useId();
  const nameId = `${rowId}-name`;
  const scoreId = `${rowId}-score`;
  const factionId = `${rowId}-faction`;
  const newPlayerId = `${rowId}-new-player`;

  const handleInviteToGroup = async () => {
    if (!participant.email || !group_id) return;
    setInviteStatus('sending');
    setInviteError(null);
    try {
      await invitesAPI.sendInvite(group_id, participant.email);
      setInviteStatus('sent');
    } catch (err) {
      setInviteStatus('error');
      setInviteError(err.message || 'Failed to send invite');
    }
  };

  return (
    // 87.8-13 walkthrough F-3: stacked at phone width (name line + wrapping
    // controls line) — the single-row layout's ~350px fixed control cluster
    // forced the whole participant list into horizontal scroll at 375px.
    // sm:+ is the original one-line layout, unchanged.
    //
    // DECISION Phase 88-26 (D-35/D-34): this row divider is the ONE site in the 41-site sweep
    // promoted to the STRONG hairline instead of taking the mechanical `-line` default. Rows
    // here have no background alternation, so this rule is the entire separation between one
    // participant and the next — D-34's "must be SEEN as a separator in isolation" case, and
    // the reason D-34 darkened the strong token rather than the neutral one (darkening the
    // neutral was rejected as a 280-site re-theme). In-repo precedent for the same role:
    // gameDetail/page.js's between-session rule and Header.js's sticky-header underline.
    // Demoting this to the neutral is a decision, not a consistency cleanup.
    <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 p-2 border-b border-line-strong">
      <div className="sm:flex-1">
        {/* Owner refinement 2026-08-04 (on F-3): at phone width "New Player"
            rides the title line (right-aligned) instead of the controls row —
            phone-only twin of the sm:+ checkbox below; same state, so the two
            never disagree. */}
        <div className="flex items-center justify-between mb-1">
          <label htmlFor={nameId} className="text-xs text-content-secondary block">Participant Name</label>
          <label className="flex items-center gap-1 sm:hidden">
            <input
              type="checkbox"
              checked={participant.is_new_player || false}
              onChange={(e) => onParticipantChange(index, 'is_new_player', e.target.checked)}
            />
            <span className="text-xs text-content-primary">New Player</span>
          </label>
        </div>
        {participant.isFromGroup ? (
          // Read-only display for group members
          <div className="p-2 border border-line rounded-sm bg-surface-elevated text-content-primary text-sm flex items-center gap-2">
            {participant.username || `Participant ${index + 1}`}
            {participant.is_guest && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800">
                Guest
              </span>
            )}
          </div>
        ) : (
          // Editable input for custom participants
          <div className="flex items-center gap-2">
            <Input
              id={nameId}
              type="text"
              value={participant.username || ''}
              onChange={(e) => {
                const value = e.target.value;
                // Allow typing any name (group member or custom)
                onParticipantChange(index, 'username', value);

                // Try to find matching group member
                const matchingMember = groupMembers.find(m =>
                  m.username?.toLowerCase() === value.toLowerCase() ||
                  m.email?.toLowerCase() === value.toLowerCase()
                );

                if (matchingMember) {
                  // If it matches a group member, set the user_id and mark as from group
                  onParticipantChange(index, 'user_id', matchingMember.id);
                  // Note: We can't change isFromGroup here, but the user_id will be set
                } else {
                  // If it doesn't match, clear user_id (custom participant)
                  if (participant.user_id) {
                    onParticipantChange(index, 'user_id', '');
                  }
                }
              }}
              placeholder="Type name (group member or custom)"
            />
            {participant.is_guest && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 shrink-0">
                Guest
              </span>
            )}
          </div>
        )}
      </div>

      {/* Owner refinement round 2 (2026-08-04): score trimmed to 4-digit width;
          Faction flexes at phone (absorbs the leftover line width — factions
          range from absent to long names, so it gets whatever room exists);
          items-end aligns the buttons with the input line at phone. Net effect:
          Score + Faction + Remove share ONE line on normal rows — Remove no
          longer strands alone below. sm:+ keeps the original centered flow. */}
      <div className="flex flex-wrap gap-2 items-end sm:items-center">
        <div>
          {/* block at phone: label ABOVE the box (owner round 3) — inline-left
              labels were also silently eating Faction's stretch room. sm:+ keeps
              the original inline-left look. */}
          <label htmlFor={scoreId} className="text-xs text-content-primary block sm:inline">Score</label>
          {/* DECISION Phase 88-21 (Req 1): adopts `Input` for the 16px floor but KEEPS `w-16 p-1`
              as an override, OVER taking the primitive's default `w-full p-2`. Those two values
              are the owner's 2026-08-04 round-2/round-3 phone tuning (score trimmed to 4-digit
              width so Score + Faction + Remove share ONE line at 375px instead of stranding
              Remove below) — see the block comment above this row. Widening them back to the
              primitive default re-breaks that layout; it is a decision, not a cleanup. The
              primitive's `max-md:min-h-11` touch floor IS taken, because that grows the row
              vertically, which the tuning never constrained. */}
          <Input
            id={scoreId}
            type="number"
            step="0.01"
            value={participant.score || ''}
            onChange={(e) => onParticipantChange(index, 'score', e.target.value)}
            className="w-16 p-1"
            placeholder="0"
          />
        </div>

        <div className="flex-1 min-w-24 sm:flex-none">
          <label htmlFor={factionId} className="text-xs text-content-primary block sm:inline">Faction</label>
          <Input
            id={factionId}
            type="text"
            value={participant.faction || ''}
            onChange={(e) => onParticipantChange(index, 'faction', e.target.value)}
            className="w-full sm:w-24 p-1"
            placeholder="Optional"
          />
        </div>

        {/* sm:+ only — the phone twin lives on the title line above. */}
        <div className="hidden sm:flex items-center">
          {/* [Rule 2 - a11y] This label followed the checkbox with no `htmlFor` and did not wrap
              it, so the control shipped with NO accessible name (axe `label`, WCAG 4.1.2 A) — a
              screen reader announced "checkbox, not checked" with no indication of what it does.
              Its phone twin ~90 lines above was always fine because that one WRAPS its input.
              DEF-88-10-01's sweep regex only matches label-BEFORE-control, which is why this
              site is not on its list of 14. */}
          <input
            id={newPlayerId}
            type="checkbox"
            checked={participant.is_new_player || false}
            onChange={(e) => onParticipantChange(index, 'is_new_player', e.target.checked)}
            className="mr-1"
          />
          <label htmlFor={newPlayerId} className="text-xs text-content-primary">New Player</label>
        </div>

        {/* Invite to group button - shown for guest participants when current user is admin/owner */}
        {/*
          DECISION Phase 87.7 D-18 (className-string shape): the branches below used to also carry
          `border-status-*` and `bg-status-*` opacity-modifier tokens. Those were REMOVED, not
          rewritten. On Tailwind v3 a `/N` modifier on a `var()`-backed colour generated no class at
          all, so these branches have always rendered with no tint and no coloured border — removal is
          what reproduces today's rendering. Rejected: (a) dropping the `/N` to keep the base class,
          which paints a SOLID status-coloured block — the exact regression being avoided; (b) making
          the tints work via `color-mix`, which is a deliberate visual change and this phase forbids
          those. The `text-status-*` tokens survive and carry the semantics. Designing the real tints
          is PHASE 88's (it owns the design system); the full 136-site list, with the sites
          deliberately left alone, is in the phase-87.7 planning directory, file
          `87.7-OPACITY-CENSUS.md`. (Path written without a glob on purpose: a `star-slash` inside a
          JSX block comment terminates it.)
          One of exactly two markers for this ~91-line strip — see RsvpSection.js for the
          object-literal shape. Re-adding a tint here is a decision, not a cleanup.
        */}
        {/* ml-auto cluster: [Invite] + Remove wrap TOGETHER as one right-aligned
            unit at phone width (owner refinement round 2 — a guest row's tight
            line was stranding Remove alone below). Remove stays outermost right:
            destructive control at the end of the row, matching the session-row
            Edit/Delete side (owner call 2026-08-04). sm:+ keeps the original flow. */}
        <div className="flex gap-2 ml-auto sm:ml-0">
          {participant.is_guest && isAdmin && group_id && (
            <button
              type="button"
              onClick={handleInviteToGroup}
              disabled={inviteStatus === 'sending' || inviteStatus === 'sent'}
              /* DECISION Phase 88-27 (D-32 buckets A/B/C): the neutral `border-line` STAYS on the
                 base and each branch overrides it, chosen OVER moving the colour onto every branch
                 (which is the other way to satisfy D-35). This is a plain template literal with no
                 tailwind-merge, so stylesheet order decides the winner — MEASURED in a real
                 `next build` of this app, not reasoned: `.border-line` is emitted at offset 35468
                 and `.border-status-success/-error` at 35906/35959, i.e. AFTER, so the branch wins.
                 88-26 hit the mirror image of this at TutorialGrid, where the neutral was emitted
                 LAST and DID overpaint the caller. If that ordering ever flips, this reverts to a
                 bare `border` on the base with a colour on all three branches. */
              className={`text-xs px-2 py-1 border border-line rounded-sm transition-colors ${
                inviteStatus === 'sent'
                  ? 'bg-status-success-subtle border-status-success text-status-success'
                  : inviteStatus === 'error'
                    ? 'bg-status-error-subtle border-status-error hover:bg-status-error-subtle-hover text-status-error'
                    : 'border-line-accent hover:bg-surface-card-hover text-content-link'
              }`}
              title={inviteStatus === 'sent' ? 'Invite sent!' : 'Invite this guest to join the group'}
            >
              {inviteStatus === 'sending' && 'Sending...'}
              {inviteStatus === 'sent' && 'Invite sent!'}
              {inviteStatus === 'error' && 'Retry'}
              {!inviteStatus && 'Invite to group'}
            </button>
          )}
          <button
            type="button"
            onClick={() => onToggleParticipant(index)}
            className="text-status-error hover:text-status-error text-sm px-2 py-1 border border-status-error rounded-sm hover:bg-status-error-subtle"
            title="Remove participant"
          >
            Remove
          </button>
        </div>
      </div>
    </div>
  );
}
