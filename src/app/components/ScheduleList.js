'use client';

import { useState } from 'react';
import { formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import KebabMenu from './KebabMenu';

// Day of week helper
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * ScheduleList - Displays schedules in a list format with actions
 *
 * @param {Object} props
 * @param {Array} props.schedules - Array of schedule objects
 * @param {Function} props.onEdit - Callback when edit clicked (passes schedule)
 * @param {Function} props.onToggle - Callback when pause/resume clicked (passes schedule_id)
 * @param {Function} props.onDelete - Callback when delete clicked (passes schedule_id)
 * @param {Array} props.games - Array of games for displaying game names
 */
export default function ScheduleList({ schedules = [], onEdit, onToggle, onDelete, games = [] }) {
  const { timezone } = useTimezone();
  const [deleteConfirm, setDeleteConfirm] = useState(null); // schedule_id to confirm deletion

  const handleDeleteClick = (schedule) => {
    setDeleteConfirm(schedule.id);
  };

  const handleConfirmDelete = (scheduleId) => {
    onDelete?.(scheduleId);
    setDeleteConfirm(null);
  };

  const handleCancelDelete = () => {
    setDeleteConfirm(null);
  };

  // Empty state
  if (!schedules || schedules.length === 0) {
    return (
      <div className="text-center py-12 text-content-muted">
        <p className="text-lg">No schedules yet. Create one to start sending automated prompts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schedules.map((schedule) => {
        const dayName = DAYS[schedule.schedule_day_of_week] || 'Unknown';
        const timeFormatted = formatTime(schedule.schedule_time, timezone);
        const game = games.find(g => g.id === schedule.game_id);
        const gameName = game?.name || 'Game TBD';
        const isActive = schedule.is_active;
        const scheduleName = schedule.template_name || `${dayName} ${timeFormatted}`;

        return (
          <div
            key={schedule.id}
            className="border border-line rounded-card p-4 hover:shadow-theme-md transition-shadow bg-surface-card"
          >
            <div className="flex items-start justify-between">
              {/* Left: Schedule info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-content-primary">{scheduleName}</h3>
                  {/* Status badge */}
                  {isActive ? (
                    <span className="px-2 py-1 text-xs font-medium bg-status-success/10 text-status-success rounded-full">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-medium bg-status-warning/10 text-status-warning rounded-full">
                      Paused
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-sm text-content-secondary">
                  <p>
                    <span className="font-medium">When:</span> {dayName} at {timeFormatted}
                  </p>
                  <p>
                    <span className="font-medium">Game:</span> {gameName}
                  </p>
                  {schedule.min_participants && (
                    <p>
                      <span className="font-medium">Min players:</span> {schedule.min_participants}
                    </p>
                  )}
                  {schedule.default_deadline_hours && (
                    <p>
                      <span className="font-medium">Response window:</span> {schedule.default_deadline_hours} hours
                    </p>
                  )}
                </div>
              </div>

              {/* Right: Actions — desktop inline buttons (≥768px) */}
              <div className="hidden md:flex items-start gap-2 ml-4">
                {/* Edit button */}
                <button
                  onClick={() => onEdit?.(schedule)}
                  className="btn btn-primary px-3 py-1.5 text-sm"
                  title="Edit schedule"
                >
                  Edit
                </button>

                {/* Pause/Resume toggle */}
                <button
                  onClick={() => onToggle?.(schedule.id)}
                  className={`px-3 py-1.5 text-sm rounded-btn transition-colors ${
                    isActive
                      ? 'bg-status-warning/10 text-status-warning hover:bg-status-warning/20'
                      : 'bg-status-success/10 text-status-success hover:bg-status-success/20'
                  }`}
                  title={isActive ? 'Pause schedule' : 'Resume schedule'}
                >
                  {isActive ? 'Pause' : 'Resume'}
                </button>

                {/* Delete button */}
                <button
                  onClick={() => handleDeleteClick(schedule)}
                  className="btn btn-danger px-3 py-1.5 text-sm"
                  title="Delete schedule"
                >
                  Delete
                </button>
              </div>

              {/* Mobile (<768px): collapse Edit/Pause/Delete into a single
                  ⋮ kebab so the row never overflows on narrow viewports.
                  Delete here opens the same in-row confirm dialog the
                  desktop button uses (handleDeleteClick) — no two-tap on
                  Schedule Delete per CONTEXT (only member Remove gets two-tap). */}
              <div className="md:hidden ml-4">
                <KebabMenu
                  ariaLabel="Schedule actions"
                  items={[
                    {
                      label: 'Edit',
                      onClick: () => onEdit?.(schedule),
                    },
                    {
                      label: isActive ? 'Pause' : 'Resume',
                      onClick: () => onToggle?.(schedule.id),
                    },
                    {
                      label: 'Delete',
                      onClick: () => handleDeleteClick(schedule),
                      danger: true,
                    },
                  ]}
                />
              </div>
            </div>

            {/* Delete Confirmation Dialog */}
            {deleteConfirm === schedule.id && (
              <div className="mt-4 p-4 bg-status-error/10 border border-status-error/30 rounded-card">
                <p className="text-status-error font-medium mb-3">
                  Delete {scheduleName}? This will stop sending prompts.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmDelete(schedule.id)}
                    className="btn btn-danger text-sm"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="btn btn-secondary text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
