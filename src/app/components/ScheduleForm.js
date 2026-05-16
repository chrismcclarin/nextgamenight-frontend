'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useUser } from '@auth0/nextjs-auth0/client';
import { promptSettingsAPI } from '../../lib/api';
import { DAYS_OF_WEEK, TOKEN_EXPIRY_OPTIONS, DEADLINE_DAY_OPTIONS, scheduleSchema } from '../../lib/scheduleFormSchema';
import MemberSelector from './MemberSelector';
import GameComboInput from './GameComboInput';

/**
 * ScheduleForm - Form component for creating/editing prompt schedules
 *
 * @param {Object} props
 * @param {string} props.groupId - Required group UUID for API calls
 * @param {Object} props.existingSchedule - Optional schedule object for edit mode (null = create)
 * @param {Array} props.games - Optional array of games for game selector dropdown
 * @param {Array} props.members - Optional array of group members for recipient selection
 * @param {Function} props.onSuccess - Optional callback after successful save
 * @param {Function} props.onCancel - Optional callback for cancel button
 */
export default function ScheduleForm({
  groupId,
  existingSchedule = null,
  games = [],
  members = [],
  onSuccess,
  onCancel,
}) {
  const [serverError, setServerError] = useState(null);
  const isEditMode = !!existingSchedule;
  const { user: authUser } = useUser();

  // Detect user's timezone using Intl API
  const userTimezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

  // Bucket legacy default_deadline_hours into a valid DEADLINE_DAY_OPTIONS value
  // for edit-mode display. Round UP to the nearest day so users don't silently
  // lose response window; floor at 1 day (24h), cap at 7 days (168h).
  // The stored DB value is preserved until the user explicitly saves — this
  // only affects what the dropdown displays on load. (CHKIN-01 SC#5)
  const bucketDeadline = (hours) => {
    if (typeof hours !== 'number' || !Number.isFinite(hours)) return 72;
    return Math.min(168, Math.max(24, Math.ceil(hours / 24) * 24));
  };

  // Initialize form with React Hook Form + Zod
  const {
    register,
    handleSubmit,
    control,
    watch,
    setValue,
    setError,
    reset,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(scheduleSchema),
    defaultValues: existingSchedule
      ? {
          ...existingSchedule,
          default_deadline_hours: bucketDeadline(existingSchedule.default_deadline_hours),
          // Seed transient game_name for GameComboInput controlled value.
          // Prefer the joined Game.name if the parent passed it; fall back to
          // the games[] lookup for older callsites that don't include it.
          game_name:
            existingSchedule.Game?.name ||
            games.find(g => g.id === existingSchedule.game_id)?.name ||
            '',
        }
      : {
          schedule_day_of_week: 1, // Monday
          schedule_time: '09:00',
          schedule_timezone: userTimezone,
          default_deadline_hours: 72,
          default_token_expiry_hours: 168,
          game_id: null,
          game_name: '',
          template_name: '',
          min_participants: null,
          selected_member_ids: members.map(m => m.user_id || m.id),
        },
  });

  // Watch values for auto-generating template name
  const watchedGameId = watch('game_id');
  const watchedGameName = watch('game_name');
  const watchedDayOfWeek = watch('schedule_day_of_week');
  const watchedTime = watch('schedule_time');
  const watchedTemplateName = watch('template_name');

  // Auto-generate template name when fields change (only if template_name is empty)
  useEffect(() => {
    if (!watchedTemplateName && !isEditMode) {
      const gameName = watchedGameName || 'Game TBD';
      const dayName = DAYS_OF_WEEK.find(d => d.value === watchedDayOfWeek)?.label || '';
      const autoName = `${gameName} - ${dayName} ${watchedTime}`;
      // Don't set if user has typed something
      setValue('template_name', autoName, { shouldValidate: false });
    }
  }, [watchedGameName, watchedDayOfWeek, watchedTime, setValue, watchedTemplateName, isEditMode]);

  // Form submission handler
  const onSubmit = async (data) => {
    setServerError(null);
    // Normalize game_id: empty string -> null
    const normalizedData = {
      ...data,
      game_id: data.game_id || null,
    };
    // Strip transient UI-only field — backend doesn't expect it.
    delete normalizedData.game_name;

    try {
      if (isEditMode) {
        await promptSettingsAPI.updateSchedule(groupId, existingSchedule.id, normalizedData);
      } else {
        await promptSettingsAPI.createSchedule(groupId, normalizedData);
      }
      onSuccess?.();
    } catch (error) {
      console.error('Error saving schedule:', error);
      setServerError(error.message || 'Failed to save schedule. Please try again.');
      setError('root', { message: error.message });
    }
  };

  // Clone template into form (for template reuse - will be used by parent component)
  const cloneTemplate = (template) => {
    reset(template, {
      keepErrors: false,
      keepDirty: false,
      keepTouched: false,
      keepIsValid: false,
    });
  };

  // Get watched selected_member_ids for MemberSelector
  const selectedMemberIds = watch('selected_member_ids') || [];

  return (
    <div className="modal-overlay" style={{ zIndex: 100 }}
         onClick={onCancel}>
      <div className="modal-content p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
           onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="modal-header mb-6">
          <h2 className="text-2xl font-bold text-content-primary">
            {isEditMode ? 'Edit Schedule' : 'Create Schedule'}
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-content-muted hover:text-content-primary text-2xl"
              type="button"
            >
              &times;
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Day of Week */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Day of Week
            </label>
            <select
              {...register('schedule_day_of_week', { valueAsNumber: true })}
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
            {errors.schedule_day_of_week && (
              <p className="text-status-error text-sm mt-1">{errors.schedule_day_of_week.message}</p>
            )}
          </div>

          {/* Time */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Time
            </label>
            <input
              type="time"
              {...register('schedule_time')}
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            {errors.schedule_time && (
              <p className="text-status-error text-sm mt-1">{errors.schedule_time.message}</p>
            )}
          </div>

          {/* Timezone */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Timezone
            </label>
            <input
              type="text"
              {...register('schedule_timezone')}
              placeholder="America/New_York"
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <p className="text-xs text-content-muted mt-1">
              IANA timezone format (detected: {userTimezone})
            </p>
            {errors.schedule_timezone && (
              <p className="text-status-error text-sm mt-1">{errors.schedule_timezone.message}</p>
            )}
          </div>

          {/* Response Deadline */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Response Deadline
            </label>
            <select
              {...register('default_deadline_hours', { valueAsNumber: true })}
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {DEADLINE_DAY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-content-muted mt-1">
              How long members have to respond (1-7 days)
            </p>
            {errors.default_deadline_hours && (
              <p className="text-status-error text-sm mt-1">{errors.default_deadline_hours.message}</p>
            )}
          </div>

          {/* Token Expiry */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Magic Link Expiry
            </label>
            <select
              {...register('default_token_expiry_hours', { valueAsNumber: true })}
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              {TOKEN_EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-content-muted mt-1">
              How long the one-click response link remains valid
            </p>
            {errors.default_token_expiry_hours && (
              <p className="text-status-error text-sm mt-1">{errors.default_token_expiry_hours.message}</p>
            )}
          </div>

          {/* Game Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Game
            </label>
            <GameComboInput
              value={{ game_id: watchedGameId, game_name: watchedGameName }}
              onChange={({ game_id, game_name }) => {
                setValue('game_id', game_id || '', { shouldValidate: true });
                setValue('game_name', game_name || '', { shouldValidate: false });
              }}
              groupId={groupId}
              userId={authUser?.sub}
              placeholder="Search for a game or type a name (leave blank for Game TBD)"
            />
            <p className="text-xs text-content-muted mt-1">
              Leave blank to keep the schedule as &quot;Game TBD&quot;.
            </p>
            {errors.game_id && (
              <p className="text-status-error text-sm mt-1">{errors.game_id.message}</p>
            )}
          </div>

          {/* Min Participants */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Minimum Participants (optional)
            </label>
            <input
              type="number"
              {...register('min_participants', {
                valueAsNumber: true,
                setValueAs: v => v === '' ? null : parseInt(v, 10)
              })}
              min={1}
              placeholder="Leave blank to use game minimum"
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <p className="text-xs text-content-muted mt-1">
              Override the game&apos;s minimum player count for scheduling
            </p>
            {errors.min_participants && (
              <p className="text-status-error text-sm mt-1">{errors.min_participants.message}</p>
            )}
          </div>

          {/* Template Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-content-secondary mb-1">
              Template Name
            </label>
            <input
              type="text"
              {...register('template_name')}
              placeholder="Auto-generated from settings"
              className="w-full p-2 border border-line rounded-btn text-content-primary bg-surface-input focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <p className="text-xs text-content-muted mt-1">
              Name for this schedule template (auto-generated if left blank)
            </p>
            {errors.template_name && (
              <p className="text-status-error text-sm mt-1">{errors.template_name.message}</p>
            )}
          </div>

          {/* Member Selection */}
          {members.length > 0 && (
            <div className="border-t border-line pt-4 mt-4" />
          )}
          {members.length > 0 && (
            <MemberSelector
              members={members}
              control={control}
              selectedMemberIds={selectedMemberIds}
              onSelectAllMembers={(checked) => {
                if (checked) {
                  setValue('selected_member_ids', members.map(m => m.user_id || m.id));
                } else {
                  setValue('selected_member_ids', []);
                }
              }}
              error={errors.selected_member_ids?.message}
            />
          )}

          {/* Server Error */}
          {serverError && (
            <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-btn">
              <p className="text-status-error text-sm">{serverError}</p>
            </div>
          )}

          {/* Root Error (from setError) */}
          {errors.root && (
            <div className="mb-4 p-3 bg-status-error/10 border border-status-error/30 rounded-btn">
              <p className="text-status-error text-sm">{errors.root.message}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-line">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="btn btn-secondary"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="btn btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting
                ? 'Saving...'
                : isEditMode
                  ? 'Update Schedule'
                  : 'Create Schedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Export cloneTemplate helper for parent components
ScheduleForm.cloneTemplate = (form, template) => {
  form.reset(template, {
    keepErrors: false,
    keepDirty: false,
    keepTouched: false,
    keepIsValid: false,
  });
};
