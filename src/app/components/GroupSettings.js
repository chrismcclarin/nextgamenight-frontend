'use client';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { groupsAPI, API_BASE_URL } from '../../lib/api';
import PromptScheduleReadOnly from './PromptScheduleReadOnly';
import SafeImage from './SafeImage';
import { safeBgImageStyle } from '../../lib/safeBgImageStyle';
import {
  resolveGroupGround,
  storedGroupColour,
} from '../../lib/colorUtils';
import { GROUP_COLOUR_PRESETS, PRESET_IDS } from '@/lib/groupColourPresets';
import { logger } from '@/lib/logger';
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
 *
 * ——— AMENDED Phase 88.3.1 (D-04 / D-07, UI-SPEC 7.2). Everything above is KEPT
 * AS HISTORY, deliberately: it is the record of what shipped, and one of its
 * claims is the claim a future reader would otherwise trust.
 *
 * WHAT STILL HOLDS, with four values per preset instead of one. The palette stays
 * RAW hex and D-27's reason is unchanged: the id is PERSISTED to
 * `Groups.color_preset` and validated server-side; the grounds and inks are fed to
 * `getBrightness` and to WCAG contrast maths, which need a NUMBER at runtime; and
 * they are emitted as CSS custom properties per rendered group, i.e. they are the
 * VALUE a token would hold, not a reference to one. A `var(--color-*)` reference
 * can be none of those three things.
 *
 * WHAT CHANGED (i) — WHERE THE TABLE LIVES. It is now `src/lib/groupColourPresets.ts`,
 * because it is DATA with two consumers (this picker and `resolveGroupGround` in
 * `lib/colorUtils.js`) plus an id-only copy on the backend, not one component's
 * private constant. `rawColorValues.test.ts` gained the new module's exemption in
 * plan 88.3.1-03 and LOST this file's in plan 88.3.1-07 — the commit that actually
 * emptied the array — because that list is deliberately non-monotonic (its test 4).
 *
 * WHAT CHANGED (ii) — THE SUPERSEDED CLAIM. The sentence above beginning "The
 * palette being all-dark…" is NO LONGER TRUE and must not be carried forward.
 * Every preset now carries a LIGHT SURFACE (CIE L* 88.2-88.6) as well as a dark
 * band (L* 12-25), and light mode paints the light one. The eight near-black
 * values above measured ΔE2000 1.62 apart once rendered for light mode — sub-JND,
 * which is why the owner could not tell swatches 1/2/3 or 7/8 apart on his phone
 * (88.3 UAT test 9a, the finding that created this phase). The replacement
 * measures 10.48 light / 10.32 dark.
 *
 * REJECTED: keeping the array in this file and hanging a second column off it. The
 * backend validator and the plan-05 migration both need the ids, and a constant
 * inside a React component cannot be the source of truth for a database column.
 * Changing this is a decision, not a cleanup.
 */

export default function GroupSettings({ group, user, onClose, onUpdate, userRole, onGroupDeleted, onOpenManageMembers }) {
  const router = useRouter();
  const [profilePictureUrl, setProfilePictureUrl] = useState(group.profile_picture_url || '');
  // '' means "no colour chosen", which is a real state: models/Group.js still
  // DEFAULTS the column to white, so most groups arrive carrying white without
  // anyone having picked it. Seeding the picker with that value made every save
  // re-persist it, which is what manufactured the D-28 white cards in the first
  // place. resolveGroupBackgroundColor treats stored white as unset.
  /*
   * DECISION Phase 88.3 (D-09 / Pitfall 7): this line stays
   * `resolveGroupBackgroundColor`. It is NOT an oversight that the phase which
   * moved every OTHER `resolveGroupBackgroundColor` call onto
   * `lightTintGroupBackgroundColor` left this one alone. THIS MARKER IS A
   * SECURITY CONTROL, NOT DOCUMENTATION.
   *
   * WHY, in plain words: this seeds the FORM STATE, and `handleSave` below
   * persists that same state as `background_color`. Route it through the tint
   * and the very next save writes the RENDERED tint into
   * `Groups.background_color` — permanently destroying the group's identity
   * colour, irreversibly, because the original hex cannot be recovered from the
   * tint. Every subsequent save would tint the tint.
   *
   * REJECTED: a blanket "replace every `resolveGroupBackgroundColor` call"
   * sweep, which is exactly the shape of change that would do it. The tint is a
   * RENDERING transform; the stored hex is the group's IDENTITY. The two render
   * sites in this file (the preview and the eight picker swatches) DO take the
   * tint — they paint, they do not persist.
   *
   * Pinned by `src/app/groupColourRendering.test.ts` test 1, which was
   * demonstrated red by routing this line through the tint. Changing it is a
   * decision, not a cleanup.
   *
   * ——— AMENDED Phase 88.3.1 (AMENDMENT E / D-01). Everything above is KEPT AS
   * HISTORY and the control it describes is UNCHANGED — only the accessor moved.
   *
   * THE RULE IS THE SAME: this line reads a STORED value and never a RENDERED
   * one. What changed is that there are now TWO stored columns. Plan 88.3.1-05
   * migrates groups to `color_preset = '<id>'` with `background_color = NULL`, so
   * a seed that read the legacy column alone would open this picker showing NO
   * colour for a migrated group — and saving any unrelated setting would then send
   * both columns null and WIPE that group's colour. That is the same
   * data-destruction class the marker above was written against, arriving through
   * a different door.
   *
   * `storedGroupColour(group)` (`lib/colorUtils.js`) is the one accessor all seven
   * sites ask: `color_preset ?? background_color`, trimmed. `??` and NOT `||`,
   * deliberately — the backend validator still accepts `''` and whitespace, so
   * `||` would silently mask a stored empty string as "no colour" instead of
   * letting it surface. It is a pure COLUMN CHOICE: it reads, it does not
   * transform, and it is not the resolver.
   *
   * STILL REJECTED, verbatim and for the same reason: routing this line through
   * `lightTintGroupBackgroundColor`, and equally through `resolveGroupGround`.
   * Both are RENDERING transforms and their output must never approach form
   * state. The preview and the eight swatches below DO call the resolver — they
   * paint, they do not persist. Tests 1 and 2 were RE-POINTED to this seed in
   * plan 88.3.1-07 and demonstrated red against it. A decision, not a cleanup.
   */
  const [backgroundColor, setBackgroundColor] = useState(storedGroupColour(group) || '');
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

  // The live preview is a RENDER site: it goes through THE resolver, so it shows
  // exactly what the card will paint — the preset's light surface in light mode,
  // its dark band in dark mode. T-88.3-43's "both grounds or neither" gate is no
  // longer hand-written here: `resolveGroupGround` returns an object carrying both
  // or `null`, never half a pair, so the ternaries below gate on the object.
  const previewGround = resolveGroupGround(backgroundColor);

  const handleSave = async () => {
    if (!user?.sub) return;
    
    try {
      setSaving(true);
      /*
       * The two colour columns are MUTUALLY EXCLUSIVE (CONTEXT D-01, UI-SPEC
       * 4.1). Which one carries the value is derived from the form state, and
       * `PRESET_IDS` — the shared table's derived id list, the same source the
       * backend's allowlist is copied from — is what decides. Deliberately NOT a
       * hand-rolled hex regex (a second, drifting definition of "is this a
       * preset") and deliberately NOT `resolveGroupGround`: the resolver is a
       * RENDER transform and its output must never approach a payload. That is
       * the whole subject of the security-control marker on the seed above.
       *
       * null, not '' — the validator accepts both, but null is what "no colour"
       * means and it keeps the column from re-acquiring white.
       */
      const chosenPreset = PRESET_IDS.includes(backgroundColor) ? backgroundColor : null;
      const settings = {
        profile_picture_url: profilePictureUrl || null,
        color_preset: chosenPreset,
        background_color: chosenPreset ? null : backgroundColor || null,
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
      logger.error('Error updating group settings', error);
      toast.error('Failed to update group settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const handleSelectDefaultPicture = (emoji) => {
    setProfilePictureUrl(emoji);
    setCustomPictureUrl('');
  };

  /*
   * DECISION Phase 88.3.1 (D-06): TAPPING THE ALREADY-SELECTED SWATCH CLEARS IT.
   * Owner, verbatim: "if you tap the color again, it de-selects and you go back
   * to default color."
   *
   * Eight swatches stay eight, no extra chrome is added, and `aria-pressed` —
   * which has declared these buttons a TOGGLE since 88.3 — becomes honest, because
   * until now the toggle only went one way. It also makes the cleared state
   * REACHABLE: CONTEXT D-01's "both columns null" was a save shape the UI had no
   * path to, i.e. a dead branch.
   *
   * The image fields are cleared on BOTH arms, deliberately. On the SELECT arm
   * that is the shipped behaviour (a colour replaces an image). On the CLEAR arm
   * it is the new decision, and the reason is that the live preview is the
   * contract: "no colour" that still showed a background image would be a preview
   * that does not match what the user just asked for.
   *
   * REJECTED — a ninth "None" swatch: SPEC Req 1 says EXACTLY eight.
   * REJECTED — a separate "Clear colour" button: new chrome, and owner ruling
   * R2-2 (marker in the picker below) rejected adding chrome to this picker.
   * Changing this is a decision, not a cleanup.
   */
  const handleSelectDefaultColor = (presetId) => {
    const isSelected = backgroundColor === presetId && !backgroundImageUrl;
    setBackgroundColor(isSelected ? '' : presetId);
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
      logger.error('Error deleting group', error);
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
          {/* The no-colour branch keeps `bg-surface-card` so "no colour chosen"
              previews what the group will actually look like — the themed card,
              not a white rectangle. The has-colour branch takes the TINT, so
              the preview shows what will actually render in light mode.

              DECISION Phase 88.3 (D-09, cascade fix): mutual exclusion via a
              ternary gated on `previewTinted`, chosen OVER keeping
              `bg-surface-card` always present and appending the tint pair —
              compile-verified, `.bg-[var(--group-ground-light)]` emits BEFORE
              `.bg-surface-card` (1426 vs 1543) at equal specificity, so the
              stacked shape renders white in light mode. ALSO REJECTED: gating
              the ground on `backgroundColor` alone (T-88.3-43). A decision, not
              a cleanup. */}
          <div className={`mb-4 p-4 border border-line rounded-lg ${previewGround ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`} style={{
            ...(previewGround && {
              '--group-ground': previewGround.dark,
              '--group-ground-light': previewGround.light,
            }),
            ...safeBgImageStyle(backgroundImageUrl),
            backgroundSize: 'cover',
            backgroundPosition: 'center',
            minHeight: '100px'
          }}>
            <p className="text-sm text-content-secondary text-center">Preview</p>
          </div>

          {/* Default Colors */}
          <div className="mb-4">
            <p id="group-colour-choice" className="text-sm text-content-secondary mb-2">Choose a default color:</p>
            {/* role="group" + aria-labelledby so assistive tech announces these
                eight as a LABELLED set rather than a bare row of buttons — the
                visible <p> above is already the label, it just was not wired to
                them. */}
            <div className="grid grid-cols-4 gap-2 justify-items-center" role="group" aria-labelledby="group-colour-choice">
              {GROUP_COLOUR_PRESETS.map((preset) => {
                /* The swatch is a RENDER site, so it shows the tint: a swatch
                   must preview what you will actually get. The stored value it
                   selects (`handleSelectDefaultColor(color.value)`) is the raw
                   preset, untouched — the tint never reaches form state.

                   DECISION Phase 88.3 (D-09, cascade fix): same mutual-exclusion
                   ternary and same `tinted ? stored : null` ground gating as the
                   other render sites, chosen OVER a stacked className (source
                   order would render the themed surface in light mode) and OVER
                   gating on `color.value` alone (T-88.3-43). A decision, not a
                   cleanup.

                   DECISION Phase 88.3 (R2-2, owner ruling): aria-label +
                   aria-pressed are the FULL accessibility fix here, chosen OVER
                   adding a visible checkmark, disc or text label. The swatch
                   identity is genuinely visible at t = 0.70 — at the
                   previously-ruled 0.87 the eight measured 1.01:1 pairwise and
                   a visible marker would have been mandatory. A decision, not a
                   cleanup.


                   ——— AMENDED Phase 88.3.1 (AMENDMENT G2, owner ruling
                   REVERSED 2026-08-29 after he consulted a colour-blind user).
                   The R2-2 text above is KEPT AS HISTORY, and its measurement
                   expired with this phase: it is anchored to the t = 0.70
                   rendered grounds this phase deletes. THE EIGHT SWATCHES NOW
                   CARRY VISIBLE ONE-WORD LABELS. Owner, verbatim: "I talked with
                   a person who is colorblind. They wished for the colors to have
                   names under them."

                   THE NUMBERS THE LABELS EXIST FOR, from
                   `.planning/research/COLOUR-VISION-DEFICIENCY-AUDIT-2026-08-29.md`:
                   the eight presets measure ΔE2000 10.48 in normal vision but
                   1.04 / 0.73 / 2.38 under protanopia / deuteranopia /
                   tritanopia in light mode (dark: 1.85 / 0.71 / 4.97). The light
                   band is solved to L* 88.2-88.6, so the set's L* spread is 0.35
                   and HUE is the only separating channel — precisely the channel
                   those three conditions take away. `groupColourPresets.test.ts`
                   test 14 pins all six numbers; it is no longer pinning an
                   accepted failure, it is guarding the reason these labels exist.

                   The caption is `aria-hidden` and the button keeps its
                   `aria-label`, so the name is ANNOUNCED EXACTLY ONCE.

                   REJECTED — the stroked-white treatment the same conversation
                   suggested ("white with a black border, because that can be
                   read on any color"). Measured: the caption sits on the CARD,
                   not on the colour, where white is 1.00:1 (it IS the card) and
                   1.26-1.41:1 on the eight light surfaces. That idiom is a
                   perceptual rescue for grounds we CANNOT measure — a user's
                   uploaded photo — and against a KNOWN ground plain
                   `text-content-secondary` beats it outright. Where the friend IS
                   right, this codebase already agrees: `colorUtils.js`'s
                   background-image arm has drawn white-with-a-dark-outline text
                   for exactly that case since before this phase, and
                   `groupInkVars`'s image arm (AMENDMENT 7) protects it.
                   ALSO REJECTED — a check glyph or disc as the CVD mitigation: it
                   says "this one is selected", not "this one is Teal", so it does
                   not address the finding at all.

                   DECISION Phase 88.3-cr (CR-14, code-adversarial-review
                   2026-08-27): SELECTION and FOCUS are now two different
                   affordances, chosen OVER the shipped shape where the SELECTED
                   swatch wore `ring-2 ring-focus-ring` — the app's focus idiom —
                   while the swatch that actually HAD focus showed only the
                   browser default outline. A sighted keyboard user tabbing
                   across the eight saw a permanent "focus ring" on a swatch that
                   was not focused, and no ring on the one that was. Not a WCAG
                   2.4.7 failure (the default outline satisfies it), which is why
                   it is LOW — but it is the app's own vocabulary saying the
                   wrong word.
                     - FOCUS takes the project string, byte-identical to the one
                       the group-page header CTAs and both calendar tiles carry.
                     - SELECTION takes `border-content-primary ring-2
                       ring-content-primary`: a flush, high-contrast frame. Focus
                       stays an OFFSET ring, so the two differ in geometry as
                       well as colour, in both themes.
                   REJECTED — `ring-accent`, the obvious pick and the one the
                   review suggested. MEASURED with `src/lib/wcag.ts` against the
                   rendered t = 0.70 grounds: amber-500 `#f59e0b` scores
                   1.11-1.18:1 against the eight light tints and 2.15:1 against
                   the light card. Both are under WCAG 1.4.11's 3:1 for a state
                   indicator, i.e. a selection ring you cannot see in light mode.
                   The same measurement condemns the OLD `border-accent` — which
                   is exactly why the shipped design needed the focus-ring token
                   to do the visible work, and how the conflation happened.
                   `content-primary` measures 17.97:1 vs the light card,
                   9.32-9.87:1 vs the eight tints, 13.06:1 vs the dark card and
                   12.89-15.47:1 vs the eight raw presets — clear on every
                   ground the swatch can have, in both themes.
                   ALSO REJECTED — distinguishing the two by hue alone. In DARK
                   `--color-focus-ring` is amber-400 and `--color-accent` is
                   amber-500 (1.29:1 apart): an accent selection ring would read
                   as "permanently focused" all over again, one shade off.
                   ALSO REJECTED — a check glyph, which would be the strongest
                   separation available. Owner ruling R2-2 above rejected exactly
                   that, and this finding is not a reason to re-open it: the
                   ruling was about swatch IDENTITY being visible at t = 0.70,
                   and it still is. A decision, not a cleanup. */

                /* DECISION Phase 88.3.1 (D-05): THE SWATCH SHOWS THE CURRENT
                   THEME'S VALUE ONLY — the preset's light surface in light mode,
                   its dark band in dark mode — because that is exactly what the
                   card will render. Owner ruling ("follow recommended"). The
                   mechanism is the shipped one: both custom properties are
                   emitted and the CSS cascade picks, so there is no theme read in
                   JS and no hydration fork.

                   REJECTED — a SPLIT CHIP showing both themes at once: at the
                   44px floor each half is ~22px, the split edge fights the
                   `border-2 ring-2` selection frame, and it reads as "two
                   colours" rather than as one preset.
                   REJECTED — an other-theme DOT in the corner: it collides with
                   owner ruling R2-2 above (no added chrome), and a pale dot on a
                   pale surface is invisible in the theme that needs it.
                   REJECTED — painting the dark band in both themes: it reverses
                   the target of the whole phase and breaks D-09's principle that
                   a swatch must preview what you will actually get.
                   A decision, not a cleanup. */

                /* DECISION Phase 88.3.1 (SPEC Req 7, UI-SPEC 5.1 — swatch
                   geometry). The three classes below are load-bearing and each
                   has a number; without those numbers recorded a future reader
                   deletes them as noise.

                   `max-w-16` (64px) IS REQUIRED. This picker lives inside a
                   `max-w-2xl` Modal — with no cap the desktop grid renders
                   146 x 146px swatches.

                   `aspect-square` IS REQUIRED. A stretched grid item measures
                   72 x 44 at 375px: it clears the touch floor but stops reading
                   as a colour chip.

                   44 IS A FLOOR, NOT A TARGET (CLAUDE.md, Phone-Forward). 64 is
                   the target; `min-w-11 min-h-11` is the line that must never be
                   breached. THE ARITHMETIC at the 375px mobile gate: 4 x 64 +
                   3 x 8 = 280px inside a ~311px grid — 31px spare across the
                   whole ROW, not per gap, which is why the cell wrapper is
                   CENTRED in its ~71.8px column instead of being left to hug the
                   inline start. At 320px (iPhone SE) the cap never binds and each
                   chip renders ~58px, still over the floor. This replaces
                   DEF-88.3-10-01's shipped `p-4`-with-no-content swatch, which
                   measured ~36 x 36.

                   REJECTED — a fixed `w-16 h-16`: it overflows the 320px
                   viewport, the narrowest phone this project measures.
                   REJECTED — the floor classes alone with no cap, which is the
                   146px desktop chip above. A decision, not a cleanup. */

                /* DECISION Phase 88.3.1 (M33 / AMENDMENT D): the RESTING boundary
                   below takes the `-strong` rung of the line token, at THIS ONE
                   SITE. The eight light surfaces sit 1.0277-1.0374:1 from the
                   page — deliberately so (UI-SPEC 2.6) — which means the fill
                   says nothing and the boundary is the only cue that eight
                   tappable controls exist (WCAG 1.4.11 Non-text Contrast). The
                   shared hairline measures 1.7053-1.7214:1 against those eight
                   surfaces, under the 3:1 that `globals.css`'s own marker
                   reserves for CONTROL boundaries; the `-strong` rung measures
                   3.0361-3.0648:1. It passes by 0.036 at its worst (orange),
                   which is why `groupColourPresets.test.ts` test 15 pins BOTH
                   directions — a value change alone would let a future nudge to
                   either token red it silently.

                   REJECTED — moving the shared `--color-border` token, or
                   sweeping the 235 hairline sites with it. `globals.css`'s marker
                   forbids exactly that, and the `-strong` token already exists
                   for this job. A decision, not a cleanup. */
                const swatchGround = resolveGroupGround(preset.name);
                const isSelected = backgroundColor === preset.name && !backgroundImageUrl;
                return (
                  <div key={preset.name} className="flex w-full max-w-16 flex-col items-center gap-1">
                    <button
                      onClick={() => handleSelectDefaultColor(preset.name)}
                      className={`w-full max-w-16 aspect-square min-w-11 min-h-11 border-2 rounded-lg hover:opacity-80 transition-opacity focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 ${
                        isSelected ? 'border-content-primary ring-2 ring-content-primary' : 'border-line-strong'
                      } ${swatchGround ? 'bg-[var(--group-ground-light)] dark:bg-[var(--group-ground)]' : 'bg-surface-card'}`}
                      style={{
                        ...(swatchGround && {
                          '--group-ground': swatchGround.dark,
                          '--group-ground-light': swatchGround.light,
                        }),
                      }}
                      title={preset.label}
                      aria-label={preset.label}
                      aria-pressed={isSelected}
                    />
                    <span aria-hidden="true" className="text-xs text-content-secondary">
                      {preset.label}
                    </span>
                  </div>
                );
              })}
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
                      <p className="text-sm text-content-status-error">{leaveError}</p>
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

