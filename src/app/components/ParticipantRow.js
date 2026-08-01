'use client';
import { useState } from 'react';
import { invitesAPI } from '../../lib/api';

export default function ParticipantRow({ participant, index, groupMembers, onParticipantChange, onToggleParticipant, isAdmin = false, group_id = null }) {
  const [inviteStatus, setInviteStatus] = useState(null); // null | 'sending' | 'sent' | 'error'
  const [inviteError, setInviteError] = useState(null);

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
    <div className="flex items-center gap-4 p-2 border-b">
      <div className="flex-1">
        <label className="text-xs text-content-secondary mb-1 block">Participant Name</label>
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
            <input
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
              className="w-full p-2 border border-line rounded-sm text-content-primary bg-surface-input text-sm"
            />
            {participant.is_guest && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 shrink-0">
                Guest
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <div>
          <label className="text-xs text-content-primary">Score</label>
          <input
            type="number"
            step="0.01"
            value={participant.score || ''}
            onChange={(e) => onParticipantChange(index, 'score', e.target.value)}
            className="w-20 p-1 border border-line rounded-sm text-content-primary bg-surface-input"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-xs text-content-primary">Faction</label>
          <input
            type="text"
            value={participant.faction || ''}
            onChange={(e) => onParticipantChange(index, 'faction', e.target.value)}
            className="w-24 p-1 border border-line rounded-sm text-content-primary bg-surface-input"
            placeholder="Optional"
          />
        </div>

        <div className="flex items-center">
          <input
            type="checkbox"
            checked={participant.is_new_player || false}
            onChange={(e) => onParticipantChange(index, 'is_new_player', e.target.checked)}
            className="mr-1"
          />
          <label className="text-xs text-content-primary">New Player</label>
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
        {participant.is_guest && isAdmin && group_id && (
          <button
            type="button"
            onClick={handleInviteToGroup}
            disabled={inviteStatus === 'sending' || inviteStatus === 'sent'}
            className={`text-xs px-2 py-1 border rounded-sm transition-colors ${
              inviteStatus === 'sent'
                ? 'text-status-success'
                : inviteStatus === 'error'
                  ? 'text-status-error'
                  : 'text-content-link'
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
          className="text-status-error hover:text-status-error text-sm px-2 py-1 border rounded-sm"
          title="Remove participant"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
