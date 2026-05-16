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
  { value: 24, label: '1 day' },
  { value: 72, label: '3 days' },
  { value: 168, label: '7 days' },
];

// Response deadline options per CHKIN-01.
// Storage stays in hours; dropdown exposes whole-day buckets only so the
// stored value can never exceed the 168h magic-link TTL.
export const DEADLINE_DAY_OPTIONS = [
  { value: 24, label: '1 day' },
  { value: 48, label: '2 days' },
  { value: 72, label: '3 days' },
  { value: 96, label: '4 days' },
  { value: 120, label: '5 days' },
  { value: 144, label: '6 days' },
  { value: 168, label: '7 days' },
];

// Zod validation schema for schedule form
export const scheduleSchema = z.object({
  schedule_day_of_week: z.number().min(0).max(6),
  schedule_time: z.string().regex(/^\d{2}:\d{2}$/, 'Time must be HH:MM format'),
  schedule_timezone: z.string().min(1, 'Timezone is required'),
  default_deadline_hours: z.number().min(24, 'Minimum 1 day').max(168, 'Maximum 7 days'),
  default_token_expiry_hours: z.number().min(24).max(168),
  game_id: z.string().uuid().nullable().optional(),
  template_name: z.string().optional(),
  min_participants: z.number().min(1).nullable().optional(),
  selected_member_ids: z.array(z.string()).default([]),
});
