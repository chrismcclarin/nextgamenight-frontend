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
// 87.4 Plan 10 (PR-2 / D-03): `user_id` is the caller's Users.id UUID post the
// BE emission flip (Plans 08/09), so it is tightened from a loose `z.string()`
// to `z.uuid()` — rejecting sub-shaped ids AND null (no `.nullable()`, matching
// Plan 08's drop-on-map-miss rule: identity fields are valid UUIDs when present
// and absent otherwise, never null on the wire). `.optional()` still permits a
// genuinely-omitted field (dropped entry). This tighten lands in PR-2 AFTER the
// BE flip is live (87.3 D-07 sequencing) so it cannot hard-fail live parsing.
export const AvailabilitySchema = z.object({
  user_id: z.uuid().optional(),
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
  // Nullable in the DB (UserAvailability.is_available allowNull) — recurring_pattern
  // rows serialize it as `null` (the column exists, value is null), NOT omitted. Must
  // be `.nullable()` or the parse throws on every recurring row (schema-drift, 86-03).
  is_available: z.boolean().nullable().optional(), // specific override
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
