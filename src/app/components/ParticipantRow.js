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
        <label className="text-xs text-gray-700 mb-1 block">Participant Name</label>
        {participant.isFromGroup ? (
          // Read-only display for group members
          <div className="p-2 border rounded bg-gray-50 text-gray-900 text-sm flex items-center gap-2">
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
                  onParticipantChange(index, 'auth0_user_id', matchingMember.user_id);
                  // Note: We can't change isFromGroup here, but the user_id will be set
                } else {
                  // If it doesn't match, clear user_id (custom participant)
                  if (participant.user_id) {
                    onParticipantChange(index, 'user_id', '');
                    onParticipantChange(index, 'auth0_user_id', '');
                  }
                }
              }}
              placeholder="Type name (group member or custom)"
              className="w-full p-2 border rounded text-gray-900 bg-white text-sm"
            />
            {participant.is_guest && (
              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-orange-100 text-orange-800 flex-shrink-0">
                Guest
              </span>
            )}
          </div>
        )}
      </div>

      <div className="flex gap-2 items-center">
        <div>
          <label className="text-xs text-gray-900">Score</label>
          <input
            type="number"
            step="0.01"
            value={participant.score || ''}
            onChange={(e) => onParticipantChange(index, 'score', e.target.value)}
            className="w-20 p-1 border rounded text-gray-900 bg-white"
            placeholder="0"
          />
        </div>

        <div>
          <label className="text-xs text-gray-900">Faction</label>
          <input
            type="text"
            value={participant.faction || ''}
            onChange={(e) => onParticipantChange(index, 'faction', e.target.value)}
            className="w-24 p-1 border rounded text-gray-900 bg-white"
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
          <label className="text-xs text-gray-900">New Player</label>
        </div>

        {/* Invite to group button - shown for guest participants when current user is admin/owner */}
        {participant.is_guest && isAdmin && group_id && (
          <button
            type="button"
            onClick={handleInviteToGroup}
            disabled={inviteStatus === 'sending' || inviteStatus === 'sent'}
            className={`text-xs px-2 py-1 border rounded transition-colors ${
              inviteStatus === 'sent'
                ? 'text-emerald-600 border-emerald-300 bg-emerald-50'
                : inviteStatus === 'error'
                  ? 'text-red-600 border-red-300 bg-red-50 hover:bg-red-100'
                  : 'text-blue-600 border-blue-300 hover:bg-blue-50'
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
          className="text-red-500 hover:text-red-700 text-sm px-2 py-1 border border-red-300 rounded hover:bg-red-50"
          title="Remove participant"
        >
          Remove
        </button>
      </div>
    </div>
  );
}
