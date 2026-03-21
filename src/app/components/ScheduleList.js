'use client';

import { useState } from 'react';
import { formatTime } from '../../lib/dateUtils';

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
      <div className="text-center py-12 text-gray-500">
        <p className="text-lg">No schedules yet. Create one to start sending automated prompts.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {schedules.map((schedule) => {
        const dayName = DAYS[schedule.schedule_day_of_week] || 'Unknown';
        const timeFormatted = formatTime(schedule.schedule_time);
        const game = games.find(g => g.id === schedule.game_id);
        const gameName = game?.name || 'Game TBD';
        const isActive = schedule.is_active;
        const scheduleName = schedule.template_name || `${dayName} ${timeFormatted}`;

        return (
          <div
            key={schedule.id}
            className="border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow bg-white"
          >
            <div className="flex items-start justify-between">
              {/* Left: Schedule info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="text-lg font-semibold text-gray-900">{scheduleName}</h3>
                  {/* Status badge */}
                  {isActive ? (
                    <span className="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-medium bg-yellow-100 text-yellow-800 rounded-full">
                      Paused
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-sm text-gray-600">
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

              {/* Right: Actions */}
              <div className="flex items-start gap-2 ml-4">
                {/* Edit button */}
                <button
                  onClick={() => onEdit?.(schedule)}
                  className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                  title="Edit schedule"
                >
                  Edit
                </button>

                {/* Pause/Resume toggle */}
                <button
                  onClick={() => onToggle?.(schedule.id)}
                  className={`px-3 py-1.5 text-sm rounded transition-colors ${
                    isActive
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                  }`}
                  title={isActive ? 'Pause schedule' : 'Resume schedule'}
                >
                  {isActive ? 'Pause' : 'Resume'}
                </button>

                {/* Delete button */}
                <button
                  onClick={() => handleDeleteClick(schedule)}
                  className="px-3 py-1.5 text-sm bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                  title="Delete schedule"
                >
                  Delete
                </button>
              </div>
            </div>

            {/* Delete Confirmation Dialog */}
            {deleteConfirm === schedule.id && (
              <div className="mt-4 p-4 bg-red-50 border border-red-200 rounded-lg">
                <p className="text-red-900 font-medium mb-3">
                  Delete {scheduleName}? This will stop sending prompts.
                </p>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleConfirmDelete(schedule.id)}
                    className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 text-sm"
                  >
                    Confirm Delete
                  </button>
                  <button
                    onClick={handleCancelDelete}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 text-sm"
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
