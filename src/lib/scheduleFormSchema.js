import * as z from 'zod';

// Day of week options for dropdown
export const DAYS_OF_WEEK = [
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
];

// Token expiry options per PROMPT-05 requirement
export const TOKEN_EXPIRY_OPTIONS = [
  { value: 24, label: '24 hours (1 day)' },
  { value: 72, label: '72 hours (3 days)' },
  { value: 168, label: '168 hours (7 days)' },
];

// Zod validation schema for schedule form
export const scheduleSchema = z.object({
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
