'use client';

import { useState } from 'react';
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
import { useFetchErrorState } from '../../components/ui/useFetchErrorState';
import { FetchErrorBanner } from '../../components/ui/FetchErrorBanner';

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
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);
  // POLL-03: bump on every Create open so React fully remounts ScheduleForm
  // and react-hook-form's defaultValues block re-evaluates from scratch
  // (template_name='' rather than the prior dirty value).
  const [createOpenCounter, setCreateOpenCounter] = useState(0);

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
  /* DECISION Phase 88-18 (Req 6 / T-88-18-01): a HARD settings-fetch failure renders the shared
     fetch-error treatment here rather than being handed to ScheduleList as an empty array.
     `softFailPromptQueryFn` soft-fails only a PARSE failure to EMPTY_PROMPT_SETTINGS; a network
     or 4xx/5xx rejection leaves `data` undefined, and `schedules` fell through to ScheduleList's
     "No schedules yet" — telling an admin their group had no schedules when the request had
     simply failed. Do not re-merge the two branches. */
  const settingsErrorState = useFetchErrorState(settingsQuery);

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
  const handleToggle = async (scheduleId) => {
    try {
      await promptSettingsAPI.toggleSchedule(groupId, scheduleId);
      await invalidateSettings(); // Refresh to get updated status
    } catch (err) {
      console.error('Error toggling schedule:', err);
      alert('Failed to toggle schedule. Please try again.');
    }
  };

  // Handler: Delete schedule
  const handleDelete = async (scheduleId) => {
    try {
      await promptSettingsAPI.deleteSchedule(groupId, scheduleId);
      await invalidateSettings(); // Refresh to remove deleted schedule
    } catch (err) {
      console.error('Error deleting schedule:', err);
      alert('Failed to delete schedule. Please try again.');
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
      {/* Error message */}
      {error && (
        <div className="mb-4 p-3 bg-status-error-subtle border border-status-error rounded-btn">
          <p className="text-status-error text-sm">{error}</p>
        </div>
      )}

      {/* Create button (owner/admin only).
          DECISION Phase 88-18 (Req 6): SUPPRESSED while the empty state is showing, chosen OVER
          rendering both — ScheduleList's EmptyState carries the same create action a few lines
          below, and two identical primary buttons a finger-width apart is noise on a phone. It
          stays visible while loading and while erroring, so the action never vanishes mid-render.
          Restoring the unconditional render is a decision, not a cleanup. */}
      {canManageSchedules && !showForm && !loading && !settingsErrorState.showError && schedules.length > 0 && (
        /* DECISION Phase 87.8 (D-13/D-14/AF-2): per-CTA `min-h-11` (44px) chosen OVER a global `.btn` min-height floor — rejected because it would silently distort ~15 shipped compact/icon `.btn` sites (AF-2); 44px chosen OVER Material's 48dp, consciously declined (D-14). Global `.btn` sizing stays with Phase 88 (DEF-1) — a decision, not an oversight. No `min-w-11`: wide text button, 141px measured. */
        <button
          onClick={handleCreate}
          className="mb-4 btn btn-primary min-h-11"
        >
          + New Schedule
        </button>
      )}

      {/* Content */}
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
      ) : settingsErrorState.showError ? (
        <FetchErrorBanner
          state={settingsErrorState}
          title="We couldn't load your schedules"
          reportContext="Recurring availability schedules (group planning)"
        />
      ) : (
        // List view (the only view as of Phase 81 CHKIN-04)
        <ScheduleList
          schedules={schedules}
          games={games}
          onEdit={canManageSchedules ? handleEdit : null}
          onToggle={canManageSchedules ? handleToggle : null}
          onDelete={canManageSchedules ? handleDelete : null}
          onCreate={canManageSchedules ? handleCreate : null}
        />
      )}

      {/* Permission notice for members */}
      {!canManageSchedules && !loading && (
        <div className="mt-4 p-3 bg-surface-card-hover border border-line-accent rounded-btn">
          <p className="text-accent text-sm">
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
          <h3 className="text-lg font-semibold text-content-primary">Recurring Check-ins</h3>
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
      <Modal.Body className="pt-4">
        {renderContent()}
      </Modal.Body>
    </Modal>
  );
}
