'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, API_BASE_URL } from '../../lib/api';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import SafeImage from './SafeImage';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { toast } from 'sonner';

// Default profile picture options
const DEFAULT_PROFILE_PICTURES = [
  { name: 'Dice', url: '🎲' },
  { name: 'Cards', url: '🃏' },
  { name: 'Trophy', url: '🏆' },
  { name: 'Game', url: '🎮' },
  { name: 'Puzzle', url: '🧩' },
  { name: 'Star', url: '⭐' },
  { name: 'Fire', url: '🔥' },
  { name: 'Rocket', url: '🚀' },
];

// Default background color options
const DEFAULT_BACKGROUND_COLORS = [
  { name: 'Charcoal', value: '#1e1e2e' },
  { name: 'Slate', value: '#1e293b' },
  { name: 'Navy', value: '#172554' },
  { name: 'Indigo', value: '#1e1b4b' },
  { name: 'Forest', value: '#14332a' },
  { name: 'Wine', value: '#3b1030' },
  { name: 'Espresso', value: '#2c1f14' },
  { name: 'Storm', value: '#27272a' },
];

export default function GroupSettings({ group, user, onClose, onUpdate, userRole, onGroupDeleted, onOpenManageMembers }) {
  const router = useRouter();
  const [profilePictureUrl, setProfilePictureUrl] = useState(group.profile_picture_url || '');
  const [backgroundColor, setBackgroundColor] = useState(group.background_color || '#ffffff');
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(group.background_image_url || '');
  const [customPictureUrl, setCustomPictureUrl] = useState('');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting] = useState(false);

  // Plan 69-04 Leave Group state
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState('');

  // Plan 69-04: derive isOnlyMember from a one-time members fetch.
  // The Group object passed to GroupSettings doesn't reliably include
  // member_count (only /invite-preview returns it), and Users[] varies
  // by callsite. Fetching once on mount keeps the gate accurate without
  // requiring callers to plumb member counts down.
  const [memberCount, setMemberCount] = useState(null);
  useEffect(() => {
    let cancelled = false;
    if (!group?.id) return;
    (async () => {
      try {
        const members = await groupsAPI.getGroupMembers(group.id);
        if (!cancelled && Array.isArray(members)) {
          setMemberCount(members.length);
        }
      } catch (e) {
        // If the fetch fails, fall back to "unknown" — leave button stays
        // visible for non-owners (the backend's /leave endpoint is the
        // ultimate source of truth and will reject last-member-leaves with
        // its own error if that case ever materializes).
        if (!cancelled) setMemberCount(null);
      }
    })();
    return () => { cancelled = true; };
  }, [group?.id]);

  const isOnlyMember = memberCount !== null && memberCount <= 1;

  // Phase 88.2 / SPEC-REQ-5, D-06: the delete blast radius comes from the
  // dedicated owner-only endpoint and is fetched WHEN THE DANGER ZONE RENDERS,
  // not when the owner clicks — so the numbers are already on screen before the
  // decision is made, with no spinner in the middle of a destructive flow.
  //
  // The counts are NEVER derived on the client (not from getGroupMembers, not
  // from an event list). A client-side count risks stating a number that is
  // simply false — telling the owner "4 events" while deleting 37 — at the exact
  // moment accuracy matters most. The server counts; we render what it says.
  const [deletionImpact, setDeletionImpact] = useState(null);
  useEffect(() => {
    let cancelled = false;
    // Only the owner ever sees the Danger Zone, so only the owner fetches. A
    // non-owner request would 403 anyway (the endpoint is owner-gated
    // server-side) — this keeps us from asking.
    if (userRole === 'owner' && group?.id) {
      (async () => {
        try {
          const impact = await groupsAPI.getDeletionImpact(group.id);
          if (!cancelled) setDeletionImpact(impact);
        } catch (e) {
          // Degrade to copy WITHOUT the numbers — never to a disabled delete
          // button. The backend is the authority on whether a delete may
          // proceed, and SPEC-REQ-6 forbids this phase adding any new gate. The
          // recoverability sentence still renders unconditionally below.
          if (!cancelled) setDeletionImpact(null);
        }
      })();
    }
    return () => { cancelled = true; };
    // PRIMITIVES ONLY in the dep array, matching the members effect above.
    // `group` is an object prop: depending on it re-fires this effect on any
    // parent re-render that rebuilds the object, re-issuing the request over and
    // over on a destructive-decision surface. `group?.id` is the identity that
    // actually matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [group?.id, userRole]);

  // The window is a fixed 30 by the phase's constraints and is not per-group
  // configurable, so this fallback carries no accuracy risk — unlike the counts,
  // the constant cannot disagree with the server. It exists so the recoverability
  // claim still renders when the impact fetch fails.
  const recoveryDays = deletionImpact?.recovery_window_days ?? 30;

  // Code-review M-5 (owner-approved 2026-07-27): the recovery promise must be
  // attributed to the OTHER members — the deleter is deliberately sent no email
  // (SPEC-REQ-8), so "you have 30 days to change your mind" was false, and for
  // a sole-member group flatly so (nobody receives a link at all). Prefer the
  // server's member count; fall back to the roster fetch; when both are unknown
  // the multi-member wording renders (accurate for the typical group).
  const knownMemberCount = deletionImpact?.member_count ?? memberCount;
  const isSoleMemberDelete = knownMemberCount !== null && knownMemberCount <= 1;

  const handleSave = async () => {
    if (!user?.sub) return;
    
    try {
      setSaving(true);
      const settings = {
        profile_picture_url: profilePictureUrl || null,
        background_color: backgroundColor,
        background_image_url: backgroundImageUrl || null,
      };
      
      await groupsAPI.updateGroupSettings(group.id, settings);
      if (onUpdate) onUpdate();
      if (onClose) onClose();
    } catch (error) {
      console.error('Error updating group settings:', error);
      toast.error('Failed to update group settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDefaultPicture = (emoji) => {
    setProfilePictureUrl(emoji);
    setCustomPictureUrl('');
  };

  const handleSelectDefaultColor = (color) => {
    setBackgroundColor(color);
    setBackgroundImageUrl('');
    setCustomBackgroundUrl('');
  };

  const handleUseCustomPicture = () => {
    if (customPictureUrl.trim()) {
      setProfilePictureUrl(customPictureUrl.trim());
    }
  };

  const handleUseCustomBackground = () => {
    if (customBackgroundUrl.trim()) {
      setBackgroundImageUrl(customBackgroundUrl.trim());
      setBackgroundColor('#ffffff'); // Reset color when using image
    }
  };

  const handleLeaveGroup = async () => {
    if (!user?.sub || !group?.id) return;
    try {
      setLeaving(true);
      setLeaveError('');
      await groupsAPI.leaveGroup(group.id);
      if (onClose) onClose();
      // Plan 69-04: redirect to `/` (the canonical home route hosting Plan
      // 69-03's removedFrom banner) — NOT `/userHome` (no such route exists,
      // see app/page.js → UserHomePage).
      router.push('/');
    } catch (err) {
      setLeaveError(err.message || 'Failed to leave group. Please try again.');
    } finally {
      setLeaving(false);
    }
  };

  const handleDeleteGroup = async () => {
    if (!user?.sub || !group) return;
    
    // Triple check: user must type the exact group name
    if (deleteConfirmText !== group.name) {
      toast.error(`Please type the exact group name "${group.name}" to confirm deletion.`);
      return;
    }
    
    // Phase 88.2 / SPEC-REQ-7: the string changed, the gate did not. See the
    // DECISION marker in the Danger Zone render. M-5: recovery is attributed to
    // the other members (the deleter gets no email), and a sole-member group is
    // told plainly the delete is final.
    const confirmMessage = isSoleMemberDelete
      ? `You're the only member — nobody is emailed a recovery link, so deleting this group is final. It is hidden straight away and erased after ${recoveryDays} days. Delete this group?`
      : `This hides the group from every member straight away, and emails them a link to take it over. If nobody brings it back within ${recoveryDays} days, it is erased. Delete this group?`;
    if (!confirm(confirmMessage)) {
      return;
    }
    
    try {
      setDeleting(true);
      await groupsAPI.deleteGroup(group.id);
      
      // Close modal and navigate away
      if (onClose) onClose();
      if (onGroupDeleted) {
        onGroupDeleted();
      } else {
        // Navigate to home if no callback provided
        router.push('/');
      }
    } catch (error) {
      console.error('Error deleting group:', error);
      toast.error(error.message || 'Failed to delete group. Please try again.');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }} onClick={onClose}>
      <div className="modal-content max-w-2xl w-full mx-4 p-6 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-2xl font-bold text-content-primary">Customize Group</h2>
          <button
            onClick={onClose}
            className="text-content-muted hover:text-content-primary text-2xl"
          >
            ×
          </button>
        </div>

        {/* Profile Picture Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Profile Picture</h3>
          
          {/* Current Selection Preview */}
          <div className="mb-4 p-4 border border-line rounded-lg bg-surface-page">
            <div className="text-center">
              <div className="inline-block w-20 h-20 rounded-full bg-surface-card-hover flex items-center justify-center text-4xl mb-2">
                {profilePictureUrl ? (
                  profilePictureUrl.startsWith('http') || profilePictureUrl.startsWith('/') ? (
                    <SafeImage
                      src={profilePictureUrl}
                      alt="Profile"
                      fallbackIcon="👥"
                      className="w-20 h-20 rounded-full object-cover"
                    />
                  ) : (
                    <span>{profilePictureUrl}</span>
                  )
                ) : (
                  <span className="text-content-muted">No picture</span>
                )}
              </div>
              <p className="text-sm text-content-secondary">Current selection</p>
            </div>
          </div>

          {/* Default Options */}
          <div className="mb-4">
            <p className="text-sm text-content-secondary mb-2">Choose a default icon:</p>
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_PROFILE_PICTURES.map((pic, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectDefaultPicture(pic.url)}
                  className={`p-4 border-2 rounded-lg text-3xl hover:bg-surface-card-hover transition-colors ${
                    profilePictureUrl === pic.url ? 'border-accent bg-surface-card-hover' : 'border-line'
                  }`}
                  title={pic.name}
                >
                  {pic.url}
                </button>
              ))}
            </div>
          </div>

          {/* Custom URL */}
          <div>
            <p className="text-sm text-content-secondary mb-2">Or enter a custom image URL:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customPictureUrl}
                onChange={(e) => setCustomPictureUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1 p-2 border border-line rounded-sm text-content-primary bg-surface-input"
              />
              <button
                onClick={handleUseCustomPicture}
                className="btn btn-primary"
              >
                Use
              </button>
            </div>
          </div>
        </div>

        {/* Background Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Background</h3>
          
          {/* Current Selection Preview */}
          <div className="mb-4 p-4 border rounded-lg" style={{
            backgroundColor: backgroundColor,
            ...safeBgImageStyle(backgroundImageUrl),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: '100px'
          }}>
            <p className="text-sm text-content-secondary text-center">Preview</p>
          </div>

          {/* Default Colors */}
          <div className="mb-4">
            <p className="text-sm text-content-secondary mb-2">Choose a default color:</p>
            <div className="grid grid-cols-4 gap-2">
              {DEFAULT_BACKGROUND_COLORS.map((color, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectDefaultColor(color.value)}
                  className={`p-4 border-2 rounded-lg hover:opacity-80 transition-opacity ${
                    backgroundColor === color.value && !backgroundImageUrl ? 'border-accent ring-2 ring-focus-ring' : 'border-line'
                  }`}
                  style={{ backgroundColor: color.value }}
                  title={color.name}
                />
              ))}
            </div>
          </div>

          {/* Custom Background URL */}
          <div>
            <p className="text-sm text-content-secondary mb-2">Or enter a custom background image URL:</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customBackgroundUrl}
                onChange={(e) => setCustomBackgroundUrl(e.target.value)}
                placeholder="https://example.com/background.jpg"
                className="flex-1 p-2 border border-line rounded-sm text-content-primary bg-surface-input"
              />
              <button
                onClick={handleUseCustomBackground}
                className="btn btn-primary"
              >
                Use
              </button>
            </div>
          </div>
        </div>

        {/* Prompt Schedules Section (read-only) */}
        <div className="mb-6 pt-6 border-t border-line">
          <PromptScheduleReadOnly
            groupId={group.id}
            groupPageUrl={`/groupHomePage?id=${group.id}`}
          />
        </div>

        {/* Leave Group Section (Plan 69-04, GROUP-04) — role-aware gating.
            Active members only; pending users can't leave (they accept/decline). */}
        {userRole && userRole !== 'pending' && (
          <div className="mb-6 pt-6 border-t border-line">
            <h3 className="text-lg font-semibold text-content-primary mb-3">Leave Group</h3>
            {userRole === 'owner' && !isOnlyMember && (
              <div className="space-y-3">
                <p className="text-sm text-content-secondary">
                  You are the owner. Transfer ownership to another member before you can leave.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => onOpenManageMembers?.()}
                  disabled={!onOpenManageMembers}
                >
                  Open Manage Members to transfer
                </button>
              </div>
            )}
            {userRole === 'owner' && isOnlyMember && (
              <p className="text-sm text-content-secondary">
                You&apos;re the only member — use Delete Group below to remove the group entirely.
              </p>
            )}
            {userRole !== 'owner' && isOnlyMember && (
              <p className="text-sm text-content-secondary">
                You&apos;re the only member — use Delete Group below to remove the group entirely.
              </p>
            )}
            {userRole !== 'owner' && !isOnlyMember && (
              <>
                {!showLeaveConfirm ? (
                  <button
                    type="button"
                    className="btn btn-danger"
                    onClick={() => setShowLeaveConfirm(true)}
                  >
                    Leave Group
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm text-content-primary">
                      Leave <strong>{group?.name}</strong>? You will lose access to events, library, and member-only content.
                    </p>
                    {leaveError && (
                      <p className="text-sm text-status-error">{leaveError}</p>
                    )}
                    <div className="flex gap-3">
                      <button
                        type="button"
                        className="btn btn-secondary"
                        disabled={leaving}
                        onClick={() => { setShowLeaveConfirm(false); setLeaveError(''); }}
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger"
                        disabled={leaving}
                        onClick={handleLeaveGroup}
                      >
                        {leaving ? 'Leaving…' : 'Confirm Leave'}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Delete Group Section - Owner Only */}
        {userRole === 'owner' && (
          <div className="mb-6 pt-6 border-t border-red-200">
            <h3 className="text-lg font-semibold text-red-600 mb-3">Danger Zone</h3>

            {/* Phase 88.2 / SPEC-REQ-5: three short beats — blast radius,
                recoverability, the better path — rather than one wall of text,
                because this reads on a 375px phone first.

                Only the NUMBERS are conditional on the impact fetch. The
                recoverability sentence and the emailed-offer clause render
                unconditionally: recovery_window_days arrives in the same response
                as the counts, so gating the whole block on the fetch would leave a
                degraded owner told neither that the delete is final nor that it is
                recoverable — the worst of both, at the moment of decision. */}
            <div className="space-y-2 mb-4 text-sm text-content-secondary">
              {deletionImpact ? (
                <p>
                  Deleting hides this group from everyone straight away. All{' '}
                  <strong className="text-content-primary">{deletionImpact.member_count}</strong> members lose
                  access to its <strong className="text-content-primary">{deletionImpact.event_count}</strong>{' '}
                  events, reviews and history — not just you.
                </p>
              ) : (
                <p>
                  Deleting hides this group from everyone straight away. Every member loses access to its
                  events, reviews and history — not just you.
                </p>
              )}
              {isSoleMemberDelete ? (
                <p>
                  You&apos;re the only member, so there is no one to email a recovery link to — deleting this
                  group is final. Everything is erased at the end of the{' '}
                  <strong className="text-content-primary">{recoveryDays}-day</strong> window.
                </p>
              ) : (
                <p>
                  Every other member is emailed a link to take over the group and bring it all back — they
                  have <strong className="text-content-primary">{recoveryDays} days</strong> before it is
                  erased. You won&apos;t get one of those emails, so if you change your mind, ask another
                  member to use theirs.
                </p>
              )}
              <p>
                If you just want to step away, transfer ownership instead — the group keeps running for
                everyone else.
              </p>
            </div>

            {/* SPEC-REQ-5: the better path gets its own affordance, before the
                destructive one. Same idiom as the Leave Group transfer button
                above; both go dark if a call site forgets the prop. */}
            <button
              type="button"
              className="btn btn-secondary w-full sm:w-auto min-h-[44px] mb-4"
              onClick={() => onOpenManageMembers?.()}
              disabled={!onOpenManageMembers}
            >
              Transfer ownership instead
            </button>

            {!showDeleteConfirm ? (
              <button
                onClick={() => setShowDeleteConfirm(true)}
                className="btn btn-danger w-full sm:w-auto min-h-[44px]"
              >
                Delete Group
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-content-secondary">
                  To confirm deletion, please type the group name: <span className="font-bold text-content-primary">{group.name}</span>
                </p>
                <input
                  type="text"
                  value={deleteConfirmText}
                  onChange={(e) => setDeleteConfirmText(e.target.value)}
                  placeholder="Type group name to confirm"
                  className="w-full p-2 min-h-[44px] border border-red-300 rounded-sm text-content-primary bg-surface-input focus:outline-hidden focus:ring-2 focus:ring-red-500"
                />
                {/* Stacked on a phone, inline from sm: up — two side-by-side
                    targets at 375px are cramped, and one of them is destructive. */}
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={() => {
                      setShowDeleteConfirm(false);
                      setDeleteConfirmText('');
                    }}
                    className="btn btn-secondary w-full sm:w-auto min-h-[44px]"
                  >
                    Cancel
                  </button>
                  {/* DECISION Phase 88.2 SPEC-REQ-6: the type-the-group-name gate
                      below and the native browser confirmation in handleDeleteGroup
                      are both PRESERVED, behaviorally unchanged. The owner chose
                      disclosure over refusal — this phase adds information (the real
                      counts, the real recovery window) and an alternative (transfer),
                      and deliberately adds NO friction. Chosen OVER two rejected
                      alternatives: adding an extra acknowledgement step for
                      many-member groups, and dropping the browser confirmation now
                      that the delete is reversible. Phase 88 Req 11 owns the
                      redesigned dialog component; this phase only corrects the copy
                      and adds the counts on the existing markup so the app is not
                      lying in the meantime. Removing either gate, or adding a new
                      one, re-litigates an accepted-forever decision recorded in
                      88.2-SPEC.md § Boundaries — that is a decision, not a cleanup. */}
                  <button
                    onClick={handleDeleteGroup}
                    disabled={deleting || deleteConfirmText !== group.name}
                    className="btn btn-danger w-full sm:w-auto min-h-[44px]"
                  >
                    {deleting ? 'Deleting...' : 'Delete Group'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="btn btn-secondary"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="btn btn-primary"
          >
            {saving ? 'Saving...' : 'Save Changes'}
          </button>
        </div>
      </div>

    </div>
  );
}

