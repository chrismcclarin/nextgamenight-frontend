'use client';

import { useState, useEffect } from 'react';
import { promptSettingsAPI } from '../../lib/api';
import ScheduleForm from './ScheduleForm';
import ScheduleList from './ScheduleList';
import ScheduleCalendar from './ScheduleCalendar';

/**
 * PromptScheduleManager - Main container for schedule management
 * Orchestrates list/calendar views and form state
 *
 * @param {Object} props
 * @param {string} props.groupId - Group UUID
 * @param {Object} props.group - Full group object (for members, games)
 * @param {string} props.userRole - 'owner' | 'admin' | 'member' (controls permissions)
 * @param {Function} props.onClose - Optional callback to close manager
 * @param {string} props.variant - 'modal' (default) or 'inline' rendering mode
 */
export default function PromptScheduleManager({ groupId, group, userRole, onClose, variant = 'modal' }) {
  const [schedules, setSchedules] = useState([]);
  const [games, setGames] = useState([]);
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [view, setView] = useState('list'); // 'list' | 'calendar'
  const [showForm, setShowForm] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState(null);

  // Load data on mount
  useEffect(() => {
    loadData();
  }, [groupId]);

  const loadData = async () => {
    setLoading(true);
    setError(null);

    try {
      // Load prompt settings which includes schedules, games, and members
      const settings = await promptSettingsAPI.getGroupPromptSettings(groupId);

      setSchedules(settings.schedules || []);
      setGames(settings.games || []);
      setMembers(settings.members || []);
    } catch (err) {
      console.error('Error loading schedules:', err);
      setError(err.message || 'Failed to load schedules. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Handler: Create new schedule
  const handleCreate = () => {
    setEditingSchedule(null);
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
      await loadData(); // Refresh to get updated status
    } catch (err) {
      console.error('Error toggling schedule:', err);
      alert('Failed to toggle schedule. Please try again.');
    }
  };

  // Handler: Delete schedule
  const handleDelete = async (scheduleId) => {
    try {
      await promptSettingsAPI.deleteSchedule(groupId, scheduleId);
      await loadData(); // Refresh to remove deleted schedule
    } catch (err) {
      console.error('Error deleting schedule:', err);
      alert('Failed to delete schedule. Please try again.');
    }
  };

  // Handler: Form success (create or update)
  const handleFormSuccess = () => {
    setShowForm(false);
    setEditingSchedule(null);
    loadData(); // Refresh to show new/updated schedule
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
        // Show form for create/edit
        <ScheduleForm
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
      ) : view === 'list' ? (
        // List view
        <ScheduleList
          schedules={schedules}
          games={games}
          onEdit={canManageSchedules ? handleEdit : null}
          onToggle={canManageSchedules ? handleToggle : null}
          onDelete={canManageSchedules ? handleDelete : null}
        />
      ) : (
        // Calendar view
        <ScheduleCalendar
          schedules={schedules}
          onSelectEvent={canManageSchedules ? handleEdit : null}
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

  // View toggle buttons shared between variants
  const renderViewToggle = () => (
    <>
      {!showForm && (
        <>
          <button
            onClick={() => setView('list')}
            className={`px-4 py-2 rounded-btn transition-colors ${
              view === 'list'
                ? 'bg-btn-primary text-btn-primary-text'
                : 'bg-surface-card-hover text-content-secondary hover:text-content-primary'
            }`}
          >
            List
          </button>
          <button
            onClick={() => setView('calendar')}
            className={`px-4 py-2 rounded-btn transition-colors ${
              view === 'calendar'
                ? 'bg-btn-primary text-btn-primary-text'
                : 'bg-surface-card-hover text-content-secondary hover:text-content-primary'
            }`}
          >
            Calendar
          </button>
        </>
      )}
    </>
  );

  // Inline variant: no modal backdrop, rendered directly in page flow
  if (variant === 'inline') {
    return (
      <div className="bg-surface-card rounded-card border border-line">
        {/* Header without close button */}
        <div className="flex justify-between items-center p-4 pb-3 border-b border-line">
          <h3 className="text-lg font-semibold text-content-primary">Prompt Schedules</h3>
          <div className="flex items-center gap-2">
            {renderViewToggle()}
          </div>
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
          <h2 className="text-2xl font-bold text-content-primary">Prompt Schedules</h2>

          <div className="flex items-center gap-2">
            {renderViewToggle()}

            {/* Close button */}
            {onClose && (
              <button
                onClick={onClose}
                className="text-content-muted hover:text-content-primary text-2xl ml-2"
                type="button"
              >
                &times;
              </button>
            )}
          </div>
        </div>

        {/* Scrollable content area */}
        <div className="p-6 pt-4 overflow-y-auto flex-1">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
