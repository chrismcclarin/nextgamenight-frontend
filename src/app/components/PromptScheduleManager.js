'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { promptSettingsAPI } from '../../lib/api';
import { promptKeys } from '../../lib/queryKeys/promptKeys';
import {
  promptSettingsSchema,
  softFailPromptQueryFn,
  EMPTY_PROMPT_SETTINGS,
} from '../../lib/schemas/prompts';
import ScheduleForm from './ScheduleForm';
import ScheduleList from './ScheduleList';
import { Modal } from './Modal';
import {
  useFetchErrorState,
  getFetchErrorMessage,
} from '../../components/ui/useFetchErrorState';
import {
  FetchErrorBanner,
  RefreshFailedNotice,
  RetainedContentFocusGuard,
  useRetainedContent,
} from '../../components/ui/FetchErrorBanner';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';
import { toast } from 'sonner';
import { logger, errCtx } from '@/lib/logger';

/**
 * PromptScheduleManager - Main container for schedule management
 * Renders the schedule list and create/edit form (list-only as of Phase 81 CHKIN-04;
 * the unused calendar view was removed).
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object (for members, games)
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' (controls permissions)
 * @param {Function} props.onClose - Optional callback to close manager
 * @param {string} props.variant - 'modal' (default) or 'inline' rendering mode
 */
export default function PromptScheduleManager({ groupId, group, userRole, onClose, variant = 'modal' }) {
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  // POLL-03: bump on every Create open so React fully remounts ScheduleForm
  // and react-hook-form's defaultValues block re-evaluates from scratch
  // (template_name='' rather than the prior dirty value).
  const [createOpenCounter, setCreateOpenCounter] = useState(0);
  // Req 4 (88.6.1-30): the per-schedule toggle latch (a ref, refused synchronously) and its
  // render mirror (the pressed control reads unavailable). See the Pause/Resume marker below.
  const toggleLatchRef = useRef(new Set());
  const [togglingIds, setTogglingIds] = useState({});

  // The inline section heading (88.6.1-30, D-05): ScheduleList's Confirm Delete target. Null in the
  // modal shape, which renders no inline heading; plan 04's floor then finds the dialog title.
  const headingRef = useRef(null);

  const queryClient = useQueryClient();
  const isAdmin = ['owner', 'admin'].includes(userRole);

  // Phase 84 (PRIM-07 / D-12): settings (schedules + games + members) via useQuery
  // on the shared promptKeys factory so it dedups with the rest of the trio.
  // The API only requires active membership (backend isActiveMember gate); the
  // Boolean(isAdmin) gate below is a deliberate FE/product choice (admin-only
  // manager surface), NOT an API constraint.
  const settingsQuery = useQuery({
    queryKey: promptKeys.settings(groupId),
    queryFn: softFailPromptQueryFn(
      promptSettingsSchema,
      () => promptSettingsAPI.getGroupPromptSettings(groupId),
      promptKeys.settings(groupId),
      EMPTY_PROMPT_SETTINGS,
    ),
    enabled: Boolean(groupId) && Boolean(isAdmin),
  });

  const { data, isPending } = settingsQuery;
  // C3 (plan 70): has-loaded is DATA PRESENCE, never a count (owner ruling Y: a list that loaded
  // empty is retained content too).
  const hasSettingsData = data !== undefined;
  /* DECISION Phase 88-18 (Req 6 / T-88-18-01): a HARD settings-fetch failure renders the shared
     fetch-error treatment here rather than being handed to ScheduleList as an empty array.
     `softFailPromptQueryFn` soft-fails only a PARSE failure to EMPTY_PROMPT_SETTINGS; a network
     or 4xx/5xx rejection leaves `data` undefined, and `schedules` fell through to ScheduleList's
     "No schedules yet" — telling an admin their group had no schedules when the request had
     simply failed. Do not re-merge the two branches.
     ——— AMENDED Phase 88.6.1-30 (AC-29 / RF1), the reasoning above KEPT AS HISTORY: a failed
     REFRESH over schedules that did load keeps them, rendered under plan 70's RF1 notice (see
     `DECISION Phase 88.6.1-30 (AC-29 / RF1)` above the content ternary below). That is not a
     re-merge: a failure with nothing cached still renders the banner, and the empty state still
     shows only when a successful fetch said empty. */
  const settingsErrorState = useFetchErrorState(settingsQuery);
  // C10 (plan 70): false on an access or gone answer, and on every failure after it until the
  // next success; kept with this query's cache entry, so it outlives a remount.
  const hasRetainedSettings = useRetainedContent(hasSettingsData, settingsErrorState, { queryKey: promptKeys.settings(groupId) });
  const failedWithNothingCached = settingsErrorState.showError && !hasRetainedSettings;

  const loading = isPending;
  const schedules = data?.schedules || [];
  const games = data?.games || [];
  const members = data?.members || [];

  // Post-write cache invalidation replaces the old loadData() refetch — keeps
  // the settings list fresh after a direct-API mutation (A1/A4).
  const invalidateSettings = () =>
    queryClient.invalidateQueries({ queryKey: promptKeys.settings(groupId) });

  // Handler: Create new schedule
  const handleCreate = () => {
    setEditingSchedule(null);
    // POLL-03: bump the remount key so ScheduleForm's useForm hook
    // re-initializes defaultValues (template_name='', etc.) on every
    // fresh Create open — even if the prior open was cancelled mid-edit.
    setCreateOpenCounter((c) => c + 1);
    setShowForm(true);
  };

  // Handler: Edit existing schedule
  const handleEdit = (schedule) => {
    setEditingSchedule(schedule);
    setShowForm(true);
  };

  // Handler: Toggle schedule active status (pause/resume)
  /* DECISION Phase 88.6.1-30 (Req 4, Pause/Resume): a per-schedule REF latch refuses a second
     toggle of the same schedule while the first toggle and its refresh are in flight, and the
     pressed control reads unavailable (`togglingIds` -> ScheduleList) — because the toggle
     endpoint FLIPS state, so a double press undoes itself. BOTH controls are gated: the desktop
     Pause/Resume button, and (#183) the phone menu's Pause/Resume item through KebabMenu's
     shipped per-item `ariaDisabled` flag, matching plan 29's End item; the phone is the primary
     surface, and a reopened menu offering a live-looking Pause while the first toggle works tells
     assistive tech nothing. On the menu path the once-only request count comes from KebabMenu's
     own handler refusal (`KebabMenu.js`, anchor `if (item.ariaDisabled) return;`), which runs
     before the item's handler; the host latch itself is pinned by the desktop double click (M2) —
     a menu-path test stays green with the latch deleted (plan 29's #34 lesson).
     REJECTED: the native disabling attribute (it drops the pressed control's focus — the rule of
     POSITION, `FriendInvitePanel.js`, anchor `DECISION Phase 88.6-22 (R3 #149`); one latch for
     all schedules (it refuses an unrelated row); the state flag as the latch (a second
     synchronous press dispatches before the state lands — the same marker's ref-not-state
     reason). Changing this is a decision, not a cleanup. */
  const handleToggle = async (scheduleId) => {
    if (toggleLatchRef.current.has(scheduleId)) return;
    toggleLatchRef.current.add(scheduleId);
    setTogglingIds((prev) => ({ ...prev, [scheduleId]: true }));
    try {
      await promptSettingsAPI.toggleSchedule(groupId, scheduleId);
      await invalidateSettings(); // Refresh to get updated status
    } catch (err) {
      logger.info('Error toggling schedule:', errCtx(err));
      toast.error(
        getFetchErrorMessage(err, {
          fallback: "We couldn't update the schedule. Please try again.",
        })
      );
    } finally {
      toggleLatchRef.current.delete(scheduleId);
      setTogglingIds((prev) => {
        const next = { ...prev };
        delete next[scheduleId];
        return next;
      });
    }
  };

  // Handler: Delete schedule
  const handleDelete = async (scheduleId) => {
    try {
      await promptSettingsAPI.deleteSchedule(groupId, scheduleId);
      await invalidateSettings(); // Refresh to remove deleted schedule
    } catch (err) {
      logger.info('Error deleting schedule:', errCtx(err));
      /* DECISION Phase 88.6-15 (AC-8, owner ruling 2026-09-09 arm 2): this DELETE-failure toast
         is STICKY (`duration: Infinity`), chosen OVER the ~4s house default the toggle path a
         few lines above deliberately keeps. WHY: the throw skips `invalidateSettings()`, so the
         row the user just tried to delete stays on screen — a missed 4s notice therefore reads
         as SUCCESS. Dismissal costs no new user-visible string: the single `<Toaster>` at
         `src/app/layout.js` is already `closeButton`. A Toaster-level duration is REJECTED
         (88-UI-SPEC §6.2 OI-5 / D-12 keeps every existing toast as-is), and so is making the
         toggle path sticky too — the toggle is non-destructive and its row updates on retry.
         Restoring the house default here is a decision, not a cleanup. */
      toast.error(
        getFetchErrorMessage(err, {
          fallback: "We couldn't delete the schedule. Please try again.",
        }),
        { duration: Infinity }
      );
    }
  };

  // Handler: Form success (create or update)
  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingSchedule(null);
    invalidateSettings(); // Refresh to show new/updated schedule
  };

  // Handler: Form cancel
  const handleFormCancel = () => {
    setShowForm(false);
    setEditingSchedule(null);
  };

  // Check if user has permission to create/edit
  const canManageSchedules = ['owner', 'admin'].includes(userRole);

  // Shared content rendered in both modal and inline variants
  const renderContent = () => (
    <>
      {/* C12 (a), plan 70: FIRST child of this fragment, outside the + New Schedule gate and the
          content ternary, so it stays mounted when an access answer withdraws the list, in both
          variants (the modal shape's ref is null and the guard falls to the dialog title). */}
      <RetainedContentFocusGuard retained={hasRetainedSettings} focusTarget={headingRef} />
      {/* DECISION Phase 88.6-15 (R1 / UI-SPEC §6.2, `88.6-UI-SPEC.md` anchor "Announcement: exactly one live region per failure"): the `{error && …}` block that used
          to open this fragment is DELETED rather than rewired to the mutation failures, and its
          `useState(null)` with it. It was DEAD: `setError` had exactly one occurrence in this
          file — its own declaration — so the block could never render. The LOAD failure is
          already owned by `useFetchErrorState(settingsQuery)` → `<FetchErrorBanner>` below,
          under the `DECISION Phase 88-18` marker, and the MUTATION failures now route to
          `toast.error` in the two handlers above. A SECOND `<FetchErrorBanner>` on this surface
          is PROHIBITED (exactly one live region per failure), which is the alternative this
          deletion rejects. Re-introducing an inline error box here is a decision, not a
          cleanup. */}

      {/* Create button (owner/admin only).
          DECISION Phase 88-18 (Req 6): SUPPRESSED while the empty state is showing, chosen OVER
          rendering both — ScheduleList's EmptyState carries the same create action a few lines
          below, and two identical primary buttons a finger-width apart is noise on a phone. It
          stays visible while loading and while erroring, so the action never vanishes mid-render.
          Restoring the unconditional render is a decision, not a cleanup.
          ——— AMENDED Phase 88.6.1-30, the reasoning above KEPT AS HISTORY: the sentence "It stays
          visible while loading and while erroring" was false from the day it was written — the
          condition it sits above, introduced in the same commit (`0185593`), has hidden the button while
          loading and on every failure. What the code does now: hidden while loading; hidden on a
          failure with nothing cached (`failedWithNothingCached`: a failed first load, or an
          access or gone answer); VISIBLE above a retained populated list and its RF1 notice;
          hidden beside the empty state (the suppression this marker exists for). Making it
          visible while loading is NOT taken here: that changes a state this plan does not own. */}
      {canManageSchedules && !showForm && !loading && !failedWithNothingCached && schedules.length > 0 && (
        /* DECISION Phase 87.8 (D-13/D-14/AF-2): per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor — rejected because it would silently distort ~15 shipped compact/icon `.btn` sites (AF-2); 44px chosen OVER Material's 48dp, consciously declined (D-14). Global `.btn` sizing stays with Phase 88 (DEF-1) — a decision, not an oversight. No `min-w-11`: wide text button, 141px measured.  ——— AMENDED Phase 88-28 (D-36), original reasoning above KEPT AS HISTORY: the global-floor question this marker parks with Phase 88 (DEF-1) IS NOW ANSWERED, and the answer is a SPLIT, not a yes or a no. TAKEN: a PHONE-ONLY floor — unlayered `.btn { min-height: 2.75rem }` inside `@media (width < 48rem)` in globals.css, with an unlayered `.btn-compact` opt-out authored AFTER it (so it wins) and applied to the two `w-8 h-8` steppers in `BrowseMoreModal.js`. That opt-out is precisely what the "would distort ~15 compact/icon sites" objection above bought: the objection was correct, and it shaped the fix rather than blocking it. STILL REJECTED: the ALL-VIEWPORT floor, for that same reason. CONSEQUENCE, and the reason this line must not be tidied away: desktop `.btn` still renders ~37px and will until the Button-primitive migration reaches it (residual census, plan 88-31). So this per-CTA `min-h-11` is NOT made redundant by the global rule — below `md` the two agree, at `md`+ this is the ONLY thing holding the CTA at 44px. Deleting it because "there is a floor now" would silently shrink this control on desktop. That is a decision, not a cleanup.  ——— AMENDED Phase 88.6 (D-09), original reasoning above KEPT AS HISTORY: the desktop half is now ANSWERED, and again by a split. TAKEN: `min-h-11` on the `Button` primitive's cva base (`src/components/ui/Button.tsx`), which reaches every viewport width. STILL REJECTED: the ALL-VIEWPORT floor on the `.btn` CLASS — `globals.css`'s `@media (width < 48rem)` rule is unwidened (`globals.css`, anchors: the `.btn` selector inside `@media (width < 48rem)` and its `min-height: 2.75rem` declaration, reasoning in the comment directly above that rule), because square-by-design controls wear `.btn` and a class-level floor would deform them. That is why both halves of this marker are still literally true: the rejection is about a rule on the CLASS; the new floor is on the PRIMITIVE, which only opted-in elements get. CONSEQUENCE: this per-CTA `min-h-11` becomes redundant ONLY once this element is a `<Button>`. Until this file's own migration sweep lands, deleting it still shrinks this control on desktop. When the sweep does land, dropping it is correct and is part of that commit — not a separate cleanup, and not something to do from here. */
        <Button
          variant="primary"
          onClick={handleCreate}
          className="mb-4"
        >
          + New Schedule
        </Button>
      )}

      {/* Content */}
      {/* DECISION Phase 88.6.1-30 (AC-29 / RF1): when a refresh fails over schedules that DID load,
          the list stays and plan 70's shared RefreshFailedNotice sits above it (copy row RF1,
          owner ruling 2026-10-05, D-47; the orchestrator's consistency decision that every
          retained-content site uses it) — above the empty state too when the list loaded EMPTY
          (owner ruling Y, 2026-10-05). The full banner shows only when nothing is retained: a
          failed first load, or an access or gone answer (C10). Retention is keyed on data
          presence and derived ONLY through plan 70's useRetainedContent. A successful Retry
          lands focus on the section heading (D-05).
          REJECTED: (a) the FULL banner above the retained list (this plan's earlier-lap choice,
          the D-09a / D-41 shape) — its title says the schedules could not be loaded above
          schedules that did load; (b) the compact banner — its two sentences (COMPACT_NOTICE, and
          plan 21's COMPACT_NOTICE_AFTER_FAILED_RETRY) are about personal controls and false here;
          (c) the old exclusive ternary that hid the list behind the banner; (d) a count-keyed
          retention (r3 #14: a successful empty would blank, and ruling Y retains it); (e) data
          presence alone as `retained`, or a code list of this file's own (C10: one predicate,
          plan 70's, behind one hook); (f) focus code of this file's own for a withdrawn list —
          plan 70's RetainedContentFocusGuard, first in this fragment, owns it (C12; D-04).
          Per state there is exactly ONE failure surface (contract C6), so the 88.6-15 (R1) rule
          above — one live region per failure — holds.
          Changing this is a decision, not a cleanup. */}
      {showForm ? (
        // Show form for create/edit. The `key` includes editingSchedule.id
        // (stable across edit) and createOpenCounter (bumps on each Create
        // open) so React fully remounts ScheduleForm whenever the user
        // starts a fresh Create — defaultValues re-evaluate, template_name
        // resets to '', and the autogen useEffect runs from scratch.
        <ScheduleForm
          key={editingSchedule ? `edit-${editingSchedule.id}` : `create-${createOpenCounter}`}
          groupId={groupId}
          existingSchedule={editingSchedule}
          games={games}
          members={members}
          onSuccess={handleFormSuccess}
          onCancel={handleFormCancel}
        />
      ) : loading ? (
        // Loading state
        <div className="text-center py-12">
          <p className="text-content-muted">Loading schedules...</p>
        </div>
      ) : failedWithNothingCached ? (
        <FetchErrorBanner
          state={settingsErrorState}
          title="We couldn't load your schedules"
          reportContext="Recurring availability schedules (group planning)"
        />
      ) : (
        <>
          <RefreshFailedNotice
            state={settingsErrorState}
            retained={hasRetainedSettings}
            focusTarget={headingRef}
            className="mb-4"
          />
          {/* List view (the only view as of Phase 81 CHKIN-04) */}
          <ScheduleList
            schedules={schedules}
            games={games}
            onEdit={canManageSchedules ? handleEdit : null}
            onToggle={canManageSchedules ? handleToggle : null}
            onDelete={canManageSchedules ? handleDelete : null}
            onCreate={canManageSchedules ? handleCreate : null}
            focusFallbackRef={headingRef}
            togglingIds={togglingIds}
          />
        </>
      )}

      {/* Permission notice for members */}
      {!canManageSchedules && !loading && (
        <div className="mt-4 p-3 bg-surface-sunken border border-line-accent rounded-btn">
          <p className="text-content-accent text-base">
            You are viewing schedules as a member. Only group owners and admins can create or edit schedules.
          </p>
        </div>
      )}
    </>
  );

  // Inline variant: no modal backdrop, rendered directly in page flow
  if (variant === 'inline') {
    return (
      <div className="bg-surface-card rounded-card border border-line surface-flat-phone">
        {/* Header without close button */}
        <div className="flex justify-between items-center p-4 pb-3 border-b border-line">
          <Heading ref={headingRef} level={3} size="heading" className="text-content-primary">
            Recurring Check-ins
          </Heading>
        </div>
        {/* Content */}
        {/* DECISION Phase 87.8 (D-02/D-03): this `p-4 pt-3` was the FIFTH unconditional padding level of the groupPlanning chain — invisible to every upstream artifact (CONTEXT and UI-SPEC both missed it; only RESEARCH C-2's JSX trace found it), because PromptScheduleSection.js is a zero-padding intermediary that made the chain longer than it looked. Do not "restore" a bare `p-4` here as an obvious oversight. Padding is `pt-3 md:px-4 md:pb-4` — NOT `md:p-4` — chosen deliberately: today's `p-4 pt-3` computes desktop padding-top 12px (same-layer `pt-3` wins over the shorthand), and `md:p-4` would sort AFTER the unprefixed `pt-3` at >=768px and silently bump padding-top to 16px; leaving padding-top out of the md layer preserves 12px at every width by construction, not by emission order. */}
        <div className="pt-3 md:px-4 md:pb-4">
          {renderContent()}
        </div>
      </div>
    );
  }

  // Modal variant (default): hosted on the shared <Modal> (size="lg" == the
  // legacy max-w-4xl; the 90vh cap is the primitive's own default).
  /* DECISION Phase 88-17 (Req 9 / Req 4): the bespoke backdrop, the
     `onClick={onClose}` + `stopPropagation` pair and the NAMELESS `&times;`
     button are gone rather than ported. That glyph was one of the two nameless
     close buttons SPEC Req 4 names: it carried neither text nor `aria-label`
     (not even a `title`), so screen readers announced "button". <Modal.Header>
     supplies a close affordance with a real `aria-label="Close"`, so no close
     glyph survives here to need one.

     The header drops from `text-2xl` (24px) to the dialog-title contract
     (20px/700, UI-SPEC §4.2) because it is now a DialogTitle — chosen OVER
     passing `text-2xl` through `<Modal.Header className>`, which would make
     this the one dialog in the fleet with an off-contract title for no reason
     other than matching its own pre-migration size. Restoring 24px here is a
     decision, not a cleanup.

     `onClose` is OPTIONAL in this component's prop contract while <Modal>'s is
     mandatory, so the old `{onClose && ...}` guard survives as `onClose?.()`
     rather than being dropped. Passing `onClose` straight through would throw a
     TypeError on Esc for a caller that omitted it — pre-migration that same
     caller simply got an overlay that could not be dismissed. Removing the
     optional call re-introduces that crash path. */
  return (
    <Modal open onClose={() => onClose?.()} size="lg">
      <Modal.Header>Recurring Check-ins</Modal.Header>
      <Modal.Body className="pt-4 md:pt-4">
        {renderContent()}
      </Modal.Body>
    </Modal>
  );
}
