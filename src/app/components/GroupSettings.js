'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, API_BASE_URL } from '../../lib/api';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import SafeImage from './SafeImage';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import { resolveGroupBackgroundColor } from '../../lib/colorUtils';
import { toast } from 'sonner';
// Relative (not `@/`) so this `.js` component resolves under vitest, matching
// the sibling ManageMembers.js adopter.
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useConfirmAction } from '../../components/ui/useConfirmAction';
import { Modal } from './Modal';
import { Input } from '../../components/ui/Input';

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

/*
 * Default background color options.
 *
 * DECISION Phase 88-22 (D-27, Req 2): these eight values stay RAW, chosen OVER
 * converting them to semantic tokens like every other component file.
 *
 * WHY. They are not styling — they are the product's curated palette DATA. Each
 * one is PERSISTED to `Groups.background_color` and later fed back through the
 * brightness algorithm in lib/colorUtils.js to compute text contrast. A
 * `var(--color-*)` reference cannot be stored in a database column, cannot be
 * parsed by `getBrightness`, and would fail the backend's `^#[0-9A-Fa-f]{6}$`
 * validator (middleware/validators.js). The palette being all-dark is
 * deliberate — this app is dark-first (88-CONTEXT), not drift.
 *
 * CONSEQUENCE for Req 2's grep gate (plan 88-29): this file needs a SCOPED
 * allowlist entry naming this array, not a bare one. Converting these is a
 * decision — and a cross-stack one — not a cleanup.
 */
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
  // '' means "no colour chosen", which is a real state: models/Group.js still
  // DEFAULTS the column to white, so most groups arrive carrying white without
  // anyone having picked it. Seeding the picker with that value made every save
  // re-persist it, which is what manufactured the D-28 white cards in the first
  // place. resolveGroupBackgroundColor treats stored white as unset.
  const [backgroundColor, setBackgroundColor] = useState(
    resolveGroupBackgroundColor(group.background_color) || ''
  );
  const [backgroundImageUrl, setBackgroundImageUrl] = useState(group.background_image_url || '');
  const [customPictureUrl, setCustomPictureUrl] = useState('');
  const [customBackgroundUrl, setCustomBackgroundUrl] = useState('');
  const [saving, setSaving] = useState(false);

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
        // null, not '' — the validator accepts both, but null is what "no
        // colour" means and keeps the column from re-acquiring white.
        background_color: backgroundColor || null,
        background_image_url: backgroundImageUrl || null,
      };
      
      await groupsAPI.updateGroupSettings(group.id, settings);
      // Req 12 receipt (UI-SPEC §6.2). ORDER IS LOAD-BEARING, same reason as
      // D-13's create-event redirect: fire the toast BEFORE onClose() unmounts
      // this surface. Sonner outlives the unmount; the reverse order eats it.
      toast.success('Settings saved');
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
      setBackgroundColor(''); // Clear the colour when using an image
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

  // Phase 88.2 / SPEC-REQ-7 copy, carried verbatim in MEANING out of the retired
  // native prompt string and into the dialog body. M-5 still holds: recovery is
  // attributed to the OTHER members (the deleter is emailed nothing), and a
  // sole-member group is told plainly that the delete is final. The trailing
  // "Delete this group?" that the old string carried now lives in the dialog
  // TITLE — asking it twice in one dialog reads as a stutter.
  const deleteDialogBody = isSoleMemberDelete ? (
    <p>
      You&apos;re the only member — nobody is emailed a recovery link, so deleting this group is
      final. It is hidden straight away and erased after {recoveryDays} days.
    </p>
  ) : (
    <p>
      This hides the group from every member straight away, and emails them a link to take it over.
      If nobody brings it back within {recoveryDays} days, it is erased.
    </p>
  );

  // D-06 blocker panel, fed by the pre-flight ALREADY fetched above — there is
  // deliberately no second `getDeletionImpact` call for the dialog. Renders only
  // when the fetch succeeded; the degraded path still gets the body copy, which
  // is the half that carries the recoverability claim.
  const deleteImpactPanel = deletionImpact ? (
    <p className="text-sm text-content-secondary">
      <strong className="text-content-primary">{deletionImpact.member_count}</strong> members lose
      access to <strong className="text-content-primary">{deletionImpact.event_count}</strong>{' '}
      events, reviews and history.
    </p>
  ) : null;

  const performDeleteGroup = async () => {
    if (!user?.sub || !group) return;
    try {
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
      // Re-thrown so useConfirmAction keeps the gate OPEN on failure (its
      // contract): closing it would leave the owner looking at a Danger Zone
      // with no indication the group is still there.
      throw error;
    }
  };

  /* DECISION Phase 88-13 (D-04, supersedes the stacking half of 88.2 SPEC-REQ-6).
     THIS MARKER REPLACES, AND PRESERVES THE HISTORY OF, the `DECISION Phase 88.2
     SPEC-REQ-6` marker that stood on the old inline delete block.

     WHAT 88.2 RECORDED (kept, because it is still the reasoning that governs this
     surface): the owner chose disclosure over refusal. 88.2 added information —
     the real member/event counts, the real recovery window — and an alternative
     (transfer ownership), and deliberately added NO friction. It rejected two
     alternatives by name: an extra acknowledgement step for many-member groups,
     and "dropping the browser confirmation now that the delete is reversible".
     It then handed the redesigned dialog component to "Phase 88 Req 11".

     WHAT PHASE 88 DECIDED, AND WHY IT IS NOT AN OVERRIDE: Req 11 / D-04 IS that
     handed-off redesign, and it is the later decision. Reading 88.2's second
     rejected alternative literally would forbid the very work it delegated, so
     the reading taken here — owner-ratified through plan review — is the one that
     preserves its INTENT: 88.2 refused to leave this surface with LESS friction
     than it shipped with. So the type-the-group-name gate SURVIVES at full
     strength, now expressed through the shared `typed` tier: the commit control
     stays disabled until an exact match on the group name (D-05, per-object —
     muscle memory cannot carry anyone through it), and the pre-flight counts sit
     above the input. What DIED is only the second, stacked native browser prompt
     that sat behind it: a repeat question that added no information and trained
     reflexive dismissal (D-04). TOTAL FRICTION IS UNCHANGED; what changed is that
     the one remaining gate is styled, focus-trapping and screen-reader-reachable
     instead of a native prompt no assistive-tech user could be given context in.

     STILL ACCEPTED-FOREVER, untouched by this phase: no NEW gate is added, and
     `blocked` is never passed to ConfirmDialog — the backend stays the authority
     on whether a delete may proceed, exactly as 88.2's degraded path requires.

     Weakening the typed gate, re-stacking a second prompt behind it, or adding a
     refusal gate re-litigates 88.2-SPEC.md § Boundaries. That is a decision, not
     a cleanup. */
  const deleteGate = useConfirmAction({
    tier: 'typed',
    title: `Delete ${group.name}?`,
    body: deleteDialogBody,
    confirmLabel: 'Delete',
    expectedPhrase: group.name,
    onConfirm: performDeleteGroup,
  });

  return (
    <>
      {/* DECISION Phase 88-13 (Req 9): hosted on the shared <Modal>, and the old
          hand-rolled `zIndex: 100` is NOT re-created as a bespoke z-index class on
          the Radix content — same call ManageMembers.js and FriendInvitePanel made
          in 88-12/88-15.

          RESOLVED STACKING (verified, not assumed): the `zIndex: 100` existed so this
          surface painted above the group page's other overlays. Radix portals every
          dialog to the END of <body>, so a later-mounted dialog paints above an
          earlier one by DOM order alone — this component mounts only when opened FROM
          the group page, and the delete confirmation mounts later still, so the
          intended order holds with no z-index anywhere. The rejected alternative was
          porting `zIndex: 100` onto <Modal> via className: it re-introduces a bespoke
          tier the rest of the fleet does not have, for an ordering the portal already
          guarantees, and a hand-set tier is exactly what starts a z-index arms race.

          The backdrop onClick + stopPropagation pair is likewise gone rather than
          ported — it existed only to stop the overlay's own close firing through the
          card, which Radix's outside-interaction handling makes moot. Re-adding
          either is a decision, not a cleanup. */}
      <Modal open onClose={onClose} className="max-w-2xl">
        <Modal.Header>Customize Group</Modal.Header>
        <Modal.Body>

        {/* Profile Picture Section */}
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-content-primary mb-3">Profile Picture</h3>
          
          {/* Current Selection Preview */}
          <div className="mb-4 p-4 border border-line rounded-lg bg-surface-page">
            <div className="text-center">
              {/* 87.8-13 walkthrough F-4: inline-flex (was inline-block + flex — two
                  competing display utilities; the centering never applied) and
                  overflow-hidden so nothing can spill the circle. */}
              {/* DECISION Phase 88.3 (OI-5): this disc STAYS on `bg-surface-card-hover`
                  and was deliberately excluded from the sunken adoption, chosen OVER
                  converging it with the five nested blocks that took `bg-surface-sunken`.
                  It is an avatar PLACEHOLDER DISC, not a nested block: it must read as a
                  filled shape against its container, and on warm-50 sunken it would be
                  ΔL* 2.3 from the surrounding card and near-invisible, where warm-200
                  gives ΔL* 10.4 and is MORE visible. Phase 88.6's broader sunken adoption
                  across the 176 `bg-surface-card` sites must not re-add it. That is a
                  decision, not a cleanup. */}
              <div className="inline-flex w-20 h-20 rounded-full bg-surface-card-hover items-center justify-center text-4xl mb-2 overflow-hidden">
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
                  // text-xs: the container's text-4xl is for emoji icons — the
                  // fallback label must not inherit it (F-4).
                  <span className="text-content-muted text-xs">No picture</span>
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
                  className={`p-4 border-2 rounded-lg text-3xl hover:bg-surface-hover transition-colors ${
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
            {/* 88-33 Task 8 (fork 5): real <label htmlFor> + id/name (census class A). */}
            <label htmlFor="group-picture-url" className="block text-sm text-content-secondary mb-2">Or enter a custom image URL:</label>
            <div className="flex gap-2">
              <Input
                id="group-picture-url"
                name="group-picture-url"
                type="text"
                value={customPictureUrl}
                onChange={(e) => setCustomPictureUrl(e.target.value)}
                placeholder="https://example.com/image.jpg"
                className="flex-1"
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
          {/* bg-surface-card so "no colour chosen" previews what the group will
              actually look like — the themed card, not a white rectangle. */}
          <div className="mb-4 p-4 border border-line rounded-lg bg-surface-card" style={{
            ...(backgroundColor && { backgroundColor }),
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
            {/* 88-33 Task 8 (fork 5): real <label htmlFor> + id/name (census class A). */}
            <label htmlFor="group-background-url" className="block text-sm text-content-secondary mb-2">Or enter a custom background image URL:</label>
            <div className="flex gap-2">
              <Input
                id="group-background-url"
                name="group-background-url"
                type="text"
                value={customBackgroundUrl}
                onChange={(e) => setCustomBackgroundUrl(e.target.value)}
                placeholder="https://example.com/background.jpg"
                className="flex-1"
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
              className="btn btn-secondary w-full sm:w-auto min-h-11 mb-4"
              onClick={() => onOpenManageMembers?.()}
              disabled={!onOpenManageMembers}
            >
              Transfer ownership instead
            </button>

            {/* One affordance, one gate. The typed confirmation and its Cancel
                now live in <ConfirmDialog> (see the DECISION marker above
                `deleteGate`); this button only opens it. */}
            <button
              type="button"
              onClick={() => deleteGate.trigger()}
              disabled={deleteGate.pending}
              className="btn btn-danger w-full sm:w-auto min-h-11"
            >
              {deleteGate.pending ? 'Deleting...' : 'Delete Group'}
            </button>
          </div>
        )}

        </Modal.Body>
        <Modal.Footer>
          <Modal.Action variant="secondary" onClick={onClose}>
            Cancel
          </Modal.Action>
          <Modal.Action variant="primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save Changes'}
          </Modal.Action>
        </Modal.Footer>
      </Modal>

      {/* Siblings of the Modal, not children: the confirmation is its own dialog
          and must mount AFTER this one to stack above it. Mounted unconditionally
          rather than inside the Danger Zone's conditional — a live region that
          mounts with the gate announces nothing (`statusNode`'s contract in
          useConfirmAction). Silent on the `typed` tier today; still mounted so a
          retier stays a one-word edit. */}
      <ConfirmDialog {...deleteGate.dialogProps} blockerPanel={deleteImpactPanel} />
      {deleteGate.statusNode}
    </>
  );
}

