// src/lib/schemas/availability.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js availabilityAPI (L608),
// availabilityFormAPI (L694), promptSettingsAPI (L758), promptAPI (L793),
// suggestionAPI (L840) / suggestionsAPI (L934).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';

// Preference for a time slot (mirrors AvailabilityForm.js zod usage).
export const PreferenceSchema = z.enum(['preferred', 'if-need-be']);
export type Preference = z.infer<typeof PreferenceSchema>;

export const TimeSlotSchema = z.object({
  slotId: z.string(),
  preference: PreferenceSchema,
});
export type TimeSlot = z.infer<typeof TimeSlotSchema>;

// availabilityAPI (L608) — a user's recurring/submitted availability.
export const AvailabilitySchema = z.object({
  user_id: z.string().optional(),
  group_id: z.string().optional(),
  time_slots: z.array(TimeSlotSchema).optional(),
  is_unavailable: z.boolean().optional(),
});
export type Availability = z.infer<typeof AvailabilitySchema>;

export const AvailabilityListSchema = z.array(AvailabilitySchema);
export type AvailabilityList = z.infer<typeof AvailabilityListSchema>;

// availabilityAPI.getUserPatterns (GET /availability/user/:id/patterns) — a
// user's EDITABLE recurring schedules + specific overrides, rendered on
// /userProfile (PRIM-03, Phase 86-03). This is the parse-before-cache schema
// (validatedQueryFn): `id`/`type`/`pattern_data` are always consumed → required
// (their removal FAILS the parse → QueryCache.onError → Sentry). Fields that
// vary by `type` (recurring vs override) stay optional. `pattern_data` is
// `.passthrough()` so additive BE keys inside it survive; unknown TOP-LEVEL BE
// keys (user_id/created_at/…) are safely stripped — never a throw.
export const AvailabilityPatternDataSchema = z
  .object({
    dayOfWeek: z.number().optional(), // recurring
    startTime: z.string().optional(),
    endTime: z.string().optional(),
    date: z.string().optional(), // specific override
  })
  .passthrough();
export type AvailabilityPatternData = z.infer<typeof AvailabilityPatternDataSchema>;

export const AvailabilityPatternSchema = z.object({
  id: z.union([z.string(), z.number()]), // React key + deleteAvailability(id)
  type: z.string(), // 'recurring_pattern' | 'specific_override' (filter discriminator)
  pattern_data: AvailabilityPatternDataSchema,
  start_date: z.string().nullable().optional(), // recurring
  end_date: z.string().nullable().optional(),
  is_available: z.boolean().optional(), // specific override
});
export type AvailabilityPattern = z.infer<typeof AvailabilityPatternSchema>;

export const AvailabilityPatternListSchema = z.array(AvailabilityPatternSchema);
export type AvailabilityPatternList = z.infer<typeof AvailabilityPatternListSchema>;

// availabilityFormAPI (L694) — token-scoped availability form payload.
export const AvailabilityFormSchema = z.object({
  token: z.string().optional(),
  group_id: z.string().optional(),
  group_name: z.string().nullable().optional(),
  time_slots: z.array(TimeSlotSchema).optional(),
  is_unavailable: z.boolean().optional(),
});
export type AvailabilityForm = z.infer<typeof AvailabilityFormSchema>;

// promptSettingsAPI (L758) — per-group prompt cadence settings.
export const PromptSettingsSchema = z.object({
  group_id: z.string().optional(),
  enabled: z.boolean().optional(),
  cadence: z.string().nullable().optional(),
  day_of_week: z.number().nullable().optional(),
});
export type PromptSettings = z.infer<typeof PromptSettingsSchema>;

// promptAPI (L793) — an availability prompt/nudge.
export const PromptSchema = z.object({
  id: z.string().optional(),
  group_id: z.string().optional(),
  status: z.string().nullable().optional(),
  sent_at: z.string().nullable().optional(),
});
export type Prompt = z.infer<typeof PromptSchema>;

// suggestionAPI (L840) / suggestionsAPI (L934) — suggested meeting slots.
export const SuggestionSchema = z.object({
  slotId: z.string().optional(),
  start: z.string().optional(), // UTC ISO instant
  available_count: z.number().optional(),
  total_members: z.number().optional(),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

export const SuggestionListSchema = z.array(SuggestionSchema);
export type SuggestionList = z.infer<typeof SuggestionListSchema>;
