'use client';

import { useState, useEffect } from 'react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { promptSettingsAPI } from '../../lib/api';

// Day of week options for dropdown
const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

// Token expiry options per PROMPT-05 requirement
const TOKEN_EXPIRY_OPTIONS = [
  { value: 24, label: '24 hours (1 day)' },
  { value: 72, label: '72 hours (3 days)' },
  { value: 168, label: '168 hours (7 days)' },
];

// Zod validation schema for schedule form
const scheduleSchema = z.object({
  schedule_day_of_week: z.number().min(0).max(6),
  schedule_time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  schedule_timezone: z.string().min(1, 'Timezone is required'),
  default_deadline_hours: z.number().min(1, 'Minimum 1 hour').max(336, 'Maximum 336 hours (2 weeks)'),
  default_token_expiry_hours: z.number().min(24).max(168),
  game_id: z.string().uuid().nullable().optional(),
  template_name: z.string().optional(),
  min_participants: z.number().min(1).nullable().optional(),
  selected_member_ids: z.array(z.string()).default([]),
});

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

  // Detect user's timezone using Intl API
  const userTimezone = typeof window !== 'undefined'
    ? Intl.DateTimeFormat().resolvedOptions().timeZone
    : 'UTC';

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
    defaultValues: existingSchedule || {
      schedule_day_of_week: 1, // Monday
      schedule_time: '09:00',
      schedule_timezone: userTimezone,
      default_deadline_hours: 72,
      default_token_expiry_hours: 168,
      game_id: null,
      template_name: '',
      min_participants: null,
      selected_member_ids: members.map(m => m.user_id || m.id),
    },
  });

  // Watch values for auto-generating template name
  const watchedGameId = watch('game_id');
  const watchedDayOfWeek = watch('schedule_day_of_week');
  const watchedTime = watch('schedule_time');
  const watchedTemplateName = watch('template_name');

  // Auto-generate template name when fields change (only if template_name is empty)
  useEffect(() => {
    if (!watchedTemplateName && !isEditMode) {
      const selectedGame = games.find(g => g.id === watchedGameId);
      const gameName = selectedGame?.name || 'Game TBD';
      const dayName = DAYS_OF_WEEK.find(d => d.value === watchedDayOfWeek)?.label || '';
      const autoName = `${gameName} - ${dayName} ${watchedTime}`;
      // Don't set if user has typed something
      setValue('template_name', autoName, { shouldValidate: false });
    }
  }, [watchedGameId, watchedDayOfWeek, watchedTime, games, setValue, watchedTemplateName, isEditMode]);

  // Handle "Select All" for members
  const handleSelectAllMembers = (checked) => {
    if (checked) {
      setValue('selected_member_ids', members.map(m => m.user_id || m.id));
    } else {
      setValue('selected_member_ids', []);
    }
  };

  // Form submission handler
  const onSubmit = async (data) => {
    setServerError(null);
    // Normalize game_id: empty string -> null
    const normalizedData = {
      ...data,
      game_id: data.game_id || null,
    };

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

  // Get watched selected_member_ids for "Select All" checkbox state
  const selectedMemberIds = watch('selected_member_ids') || [];
  const allMembersSelected = members.length > 0 && selectedMemberIds.length === members.length;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center" style={{ zIndex: 100 }}>
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex justify-between items-center mb-6">
          <h2 className="text-2xl font-bold text-gray-900">
            {isEditMode ? 'Edit Schedule' : 'Create Schedule'}
          </h2>
          {onCancel && (
            <button
              onClick={onCancel}
              className="text-gray-500 hover:text-gray-700 text-2xl"
              type="button"
            >
              &times;
            </button>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)}>
          {/* Day of Week */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Day of Week
            </label>
            <select
              {...register('schedule_day_of_week', { valueAsNumber: true })}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {DAYS_OF_WEEK.map((day) => (
                <option key={day.value} value={day.value}>
                  {day.label}
                </option>
              ))}
            </select>
            {errors.schedule_day_of_week && (
              <p className="text-red-500 text-sm mt-1">{errors.schedule_day_of_week.message}</p>
            )}
          </div>

          {/* Time */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Time
            </label>
            <input
              type="time"
              {...register('schedule_time')}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {errors.schedule_time && (
              <p className="text-red-500 text-sm mt-1">{errors.schedule_time.message}</p>
            )}
          </div>

          {/* Timezone */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Timezone
            </label>
            <input
              type="text"
              {...register('schedule_timezone')}
              placeholder="America/New_York"
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              IANA timezone format (detected: {userTimezone})
            </p>
            {errors.schedule_timezone && (
              <p className="text-red-500 text-sm mt-1">{errors.schedule_timezone.message}</p>
            )}
          </div>

          {/* Response Deadline */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Response Deadline (hours)
            </label>
            <input
              type="number"
              {...register('default_deadline_hours', { valueAsNumber: true })}
              min={1}
              max={336}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              How long members have to respond after prompt is sent (1-336 hours)
            </p>
            {errors.default_deadline_hours && (
              <p className="text-red-500 text-sm mt-1">{errors.default_deadline_hours.message}</p>
            )}
          </div>

          {/* Token Expiry */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Magic Link Expiry
            </label>
            <select
              {...register('default_token_expiry_hours', { valueAsNumber: true })}
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {TOKEN_EXPIRY_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-gray-500 mt-1">
              How long the one-click response link remains valid
            </p>
            {errors.default_token_expiry_hours && (
              <p className="text-red-500 text-sm mt-1">{errors.default_token_expiry_hours.message}</p>
            )}
          </div>

          {/* Game Selection */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Game
            </label>
            <div className="flex items-center gap-2">
              <select
                {...register('game_id')}
                className="flex-1 p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Game TBD</option>
                {games.map((game) => (
                  <option key={game.id} value={game.id}>
                    {game.name}
                  </option>
                ))}
              </select>
              {watchedGameId && (
                <button
                  type="button"
                  onClick={() => setValue('game_id', '', { shouldValidate: true })}
                  className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors"
                  title="Clear game selection"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              )}
            </div>
            {errors.game_id && (
              <p className="text-red-500 text-sm mt-1">{errors.game_id.message}</p>
            )}
          </div>

          {/* Min Participants */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
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
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Override the game&apos;s minimum player count for scheduling
            </p>
            {errors.min_participants && (
              <p className="text-red-500 text-sm mt-1">{errors.min_participants.message}</p>
            )}
          </div>

          {/* Template Name */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Template Name
            </label>
            <input
              type="text"
              {...register('template_name')}
              placeholder="Auto-generated from settings"
              className="w-full p-2 border border-gray-300 rounded-lg text-gray-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <p className="text-xs text-gray-500 mt-1">
              Name for this schedule template (auto-generated if left blank)
            </p>
            {errors.template_name && (
              <p className="text-red-500 text-sm mt-1">{errors.template_name.message}</p>
            )}
          </div>

          {/* Member Selection */}
          {members.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Send to Members
              </label>
              <div className="border border-gray-200 rounded-lg p-3 max-h-48 overflow-y-auto">
                {/* Select All */}
                <label className="flex items-center mb-2 pb-2 border-b border-gray-200">
                  <input
                    type="checkbox"
                    checked={allMembersSelected}
                    onChange={(e) => handleSelectAllMembers(e.target.checked)}
                    className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                  />
                  <span className="font-medium text-gray-700">Select All</span>
                </label>

                {/* Individual members */}
                {members.map((member) => (
                  <Controller
                    key={member.user_id || member.id}
                    name="selected_member_ids"
                    control={control}
                    render={({ field }) => (
                      <label className="flex items-center py-1">
                        <input
                          type="checkbox"
                          checked={field.value?.includes(member.user_id || member.id)}
                          onChange={(e) => {
                            const memberId = member.user_id || member.id;
                            const newValue = e.target.checked
                              ? [...(field.value || []), memberId]
                              : (field.value || []).filter(id => id !== memberId);
                            field.onChange(newValue);
                          }}
                          className="mr-2 h-4 w-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500"
                        />
                        <span className="text-gray-700">
                          {member.display_name || member.username || member.email || member.user_id}
                        </span>
                      </label>
                    )}
                  />
                ))}
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Selected: {selectedMemberIds.length} of {members.length} members
              </p>
              {errors.selected_member_ids && (
                <p className="text-red-500 text-sm mt-1">{errors.selected_member_ids.message}</p>
              )}
            </div>
          )}

          {/* Server Error */}
          {serverError && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{serverError}</p>
            </div>
          )}

          {/* Root Error (from setError) */}
          {errors.root && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <p className="text-red-700 text-sm">{errors.root.message}</p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
            {onCancel && (
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
            )}
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
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
