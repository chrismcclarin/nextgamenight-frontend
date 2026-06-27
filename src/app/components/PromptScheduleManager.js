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
  // Admin-only manager surface → gated on Boolean(groupId) && Boolean(isAdmin).
  const { data, isPending } = useQuery({
    queryKey: promptKeys.settings(groupId),
    queryFn: softFailPromptQueryFn(
      promptSettingsSchema,
      `/groups/${groupId}/prompt-settings`,
      promptKeys.settings(groupId),
      EMPTY_PROMPT_SETTINGS,
    ),
    enabled: Boolean(groupId) && Boolean(isAdmin),
  });

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
        <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-btn">
          <p className="text-status-error text-sm">{error}</p>
        </div>
      )}

      {/* Create button (owner/admin only) */}
      {canManageSchedules && !showForm && !loading && (
        <button
          onClick={handleCreate}
          className="mb-4 btn btn-primary"
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
      ) : (
        // List view (the only view as of Phase 81 CHKIN-04)
        <ScheduleList
          schedules={schedules}
          games={games}
          onEdit={canManageSchedules ? handleEdit : null}
          onToggle={canManageSchedules ? handleToggle : null}
          onDelete={canManageSchedules ? handleDelete : null}
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
      <div className="bg-surface-card rounded-card border border-line">
        {/* Header without close button */}
        <div className="flex justify-between items-center p-4 pb-3 border-b border-line">
          <h3 className="text-lg font-semibold text-content-primary">Recurring Check-ins</h3>
        </div>
        {/* Content */}
        <div className="p-4 pt-3">
          {renderContent()}
        </div>
      </div>
    );
  }

  // Modal variant (default): full-screen backdrop with centered card
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content max-w-4xl w-full mx-4 max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* Header - pinned above scrollable content */}
        <div className="modal-header p-6 pb-4 border-b border-line flex-shrink-0">
          <h2 className="text-2xl font-bold text-content-primary">Recurring Check-ins</h2>

          {/* Close button */}
          {onClose && (
            <button
              onClick={onClose}
              className="text-content-muted hover:text-content-primary text-2xl"
              type="button"
            >
              &times;
            </button>
          )}
        </div>

        {/* Scrollable content area */}
        <div className="p-6 pt-4 overflow-y-auto flex-1">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
