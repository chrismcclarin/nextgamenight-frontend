'use client';

import { useState } from 'react';
import { formatTime } from '../../lib/dateUtils';
import { useTimezone } from '../components/TimezoneProvider';
import KebabMenu from './KebabMenu';
import { EmptyState } from '../../components/ui/EmptyState';
import { Button } from '../../components/ui/Button';
import { Heading } from '../../components/ui/Heading';

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
 * @param {Function} [props.onCreate] - Callback for the empty state's "Create a
 *   schedule" CTA (Req 6). Null/absent for anyone who cannot manage schedules —
 *   the gating stays at the call site, exactly like onEdit/onToggle/onDelete.
 */
export default function ScheduleList({ schedules = [], onEdit, onToggle, onDelete, games = [], onCreate }) {
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

  // Empty state (Req 6 / UI-SPEC 9.2). This branch is "nothing here yet" ONLY —
  // a failed settings fetch renders the shared error treatment in the parent
  // (PromptScheduleManager) and never reaches this component.
  if (!schedules || schedules.length === 0) {
    return (
      <EmptyState
        icon="CalendarClock"
        heading="No schedules yet"
        body="Set one up and we'll ask the group when they're free, so you don't have to."
        action={
          onCreate ? (
            /* 44px carried per-CTA, matching the 87.8 D-13/D-14 marker on the parent's
               "+ New Schedule" button — same action, so the same touch target. */
            <Button variant="primary" className="min-h-11" onClick={onCreate}>
              Create a schedule
            </Button>
          ) : undefined
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      {schedules.map((schedule) => {
        const dayName = DAYS[schedule.schedule_day_of_week] || 'Unknown';
        // Use the schedule's own configured timezone for display, not the
        // viewer's profile TZ. Otherwise different group members see
        // different times for the same schedule, which is confusing.
        // Falls back to viewer's profile TZ only if the schedule has no TZ
        // (legacy data) — that path resolves to 'UTC' on the user's first
        // render and shows "GMT" if hit, but normal schedules created via
        // the form always have schedule_timezone set.
        const timeFormatted = formatTime(schedule.schedule_time, schedule.schedule_timezone || timezone);
        const game = games.find(g => g.id === schedule.game_id);
        const gameName = game?.name || 'Game TBD';
        const isActive = schedule.is_active;
        const scheduleName = schedule.template_name || `${dayName} ${timeFormatted}`;

        return (
          <div
            key={schedule.id}
            className="border border-line rounded-card surface-flat-phone-divided md:p-4 hover:shadow-theme-md transition-shadow bg-surface-card"
          >
            <div className="flex items-start justify-between">
              {/* Left: Schedule info */}
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <Heading level={3} size="heading" className="text-content-primary">
                    {scheduleName}
                  </Heading>
                  {/* Status badge.

                      DECISION Phase 88.6-32 (§4.5, the pill/chip-ink row): these two take
                      **700**, not 400. 400 was REJECTED — a 12px label inside a tinted pill
                      needs the weight to hold against its own fill, which is the same reason
                      §4.5 gives for `UpcomingCountPill.tsx` and `MemberChipStack.tsx`. The
                      500 they carried is a prohibition outside the `Button` label (§4.2). */}
                  {isActive ? (
                    <span className="px-2 py-1 text-xs font-bold bg-status-success-subtle text-content-status-success rounded-full">
                      Active
                    </span>
                  ) : (
                    <span className="px-2 py-1 text-xs font-bold bg-status-warning-subtle text-content-status-warning rounded-full">
                      Paused
                    </span>
                  )}
                </div>

                <div className="space-y-1 text-sm text-content-secondary">
                  <p>
                    <span className="text-content-primary">When:</span> {dayName} at {timeFormatted}
                  </p>
                  <p>
                    <span className="text-content-primary">Game:</span> {gameName}
                  </p>
                  {schedule.min_participants && (
                    <p>
                      <span className="text-content-primary">Min players:</span> {schedule.min_participants}
                    </p>
                  )}
                  {schedule.default_deadline_hours && (
                    <p>
                      <span className="text-content-primary">Response window:</span> {(() => {
                        const days = Math.round(schedule.default_deadline_hours / 24);
                        if (days < 1) return 'Less than 1 day';
                        return `${days} day${days === 1 ? '' : 's'}`;
                      })()}
                    </p>
                  )}
                </div>
              </div>

              {/* Right: Actions — desktop inline buttons (≥768px) */}
              <div className="hidden md:flex items-start gap-2 ml-4">
                {/* Edit button */}
                <Button
                  variant="primary"
                  size="default"
                  onClick={() => onEdit?.(schedule)}
                  title="Edit schedule"
                >
                  Edit
                </Button>

                {/* Pause/Resume toggle */}
                <button
                  onClick={() => onToggle?.(schedule.id)}
                  className={`px-3 py-1.5 text-sm rounded-btn transition-colors ${
                    isActive
                      ? 'bg-status-warning-subtle text-content-status-warning hover:bg-status-warning-subtle-hover'
                      : 'bg-status-success-subtle text-content-status-success hover:bg-status-success-subtle-hover'
                  }`}
                  title={isActive ? 'Pause schedule' : 'Resume schedule'}
                >
                  {isActive ? 'Pause' : 'Resume'}
                </button>

                {/* Delete button */}
                <Button
                  variant="danger"
                  size="default"
                  onClick={() => handleDeleteClick(schedule)}
                  title="Delete schedule"
                >
                  Delete
                </Button>
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
              <div className="mt-4 p-3 md:p-4 bg-status-error-subtle border border-status-error rounded-card">
                {/* §4.5 emphasis outcome: 400 + a colour token. `font-medium` (500) is deleted
                    rather than promoted to 700 — this is body prose inside an already-tinted
                    error box, not hierarchy, and it already carries its colour token. */}
                <p className="text-content-status-error mb-3">
                  Delete {scheduleName}? This will stop sending prompts.
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="danger"
                    size="default"
                    onClick={() => handleConfirmDelete(schedule.id)}
                  >
                    Confirm Delete
                  </Button>
                  <Button
                    variant="secondary"
                    size="default"
                    onClick={handleCancelDelete}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
