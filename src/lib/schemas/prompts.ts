/**
 * Runtime Zod schemas for the PromptSchedule subsystem (PRIM-07 / D-12).
 *
 * These are a FAITHFUL, PERMISSIVE mirror of the REAL backend res.json bodies —
 * authored from the route source of truth, NOT guessed from the untyped api.ts
 * calls:
 *   - prompt-settings:  periodictabletopbackend_v2/Sonnet/routes/groupPromptSettings.js
 *                       `res.json({...})` ~line 141 (member-visible: requires ACTIVE
 *                       MEMBERSHIP, not admin).
 *   - open-prompts:     periodictabletopbackend_v2/Sonnet/routes/availabilityPrompt.js
 *                       `res.json({ prompts: decorated })` ~line 585 (each item is a
 *                       spread `p.toJSON()` PLUS the computed `can_close` auth field;
 *                       `created_by_user_id` is stripped server-side).
 *
 * Design rules (84 threat register T-84-06 / T-84-07):
 *   - FIELD-LEVEL tolerance (M5): optional fields carry `.catch(...)` and nested
 *     objects `.passthrough()`, so ONE malformed optional field degrades only that
 *     field — it never blanks the whole surface. Optional collections default to
 *     `[]`, preserving the components' existing `settings.schedules || []` resilience.
 *   - The computed `can_close` authorization decision MUST survive parsing (T-84-07);
 *     it fails SAFE to `false` (hide the close control) rather than throwing.
 *   - `.passthrough()` everywhere so additive/unknown future keys survive rather
 *     than being stripped or rejected — benign drift must never blank the trio.
 *
 * Forward-compatible with the Phase-85 `{ code, message, details? }` envelope
 * (shape only). These schemas feed the soft-fail query fns the trio components use.
 */
import { z } from 'zod';
import * as Sentry from '@sentry/nextjs';
import { apiFetch } from '@/lib/api';

// -----------------------------------------------------------------------------
// prompt-settings (GET /groups/:id/prompt-settings)
// -----------------------------------------------------------------------------

// A single recurring-schedule object (template_config.schedules[] / schedules[]).
// Every JSONB field is nullable+optional with a field-level `.catch` so a single
// bad value degrades to a sane default instead of failing the parent parse.
export const promptScheduleSchema = z
  .object({
    id: z.string().nullable().optional(),
    // ReadOnly renders `s.name`; the model column is `template_name`. Accept both.
    name: z.string().nullable().optional(),
    template_name: z.string().nullable().optional(),
    schedule_day_of_week: z.number().nullable().optional().catch(null),
    schedule_time: z.string().nullable().optional().catch(null),
    schedule_timezone: z.string().nullable().optional().catch(null),
    game_id: z.string().nullable().optional().catch(null),
    default_deadline_hours: z.number().nullable().optional().catch(null),
    default_token_expiry_hours: z.number().nullable().optional().catch(null),
    min_participants: z.number().nullable().optional().catch(null),
    selected_member_ids: z.array(z.string()).optional().catch([]),
    is_active: z.boolean().nullable().optional().catch(null),
    created_at: z.string().nullable().optional(),
    updated_at: z.string().nullable().optional(),
    deleted_at: z.string().nullable().optional(),
  })
  .passthrough();
export type PromptSchedule = z.infer<typeof promptScheduleSchema>;

export const promptSettingsGameSchema = z
  .object({
    id: z.string().nullable().optional(),
    name: z.string().nullable().optional(),
    image_url: z.string().nullable().optional(),
    min_players: z.number().nullable().optional(),
    max_players: z.number().nullable().optional(),
  })
  .passthrough();

export const promptSettingsMemberSchema = z
  .object({
    // `id` comes from `ug.User?.id` — OPTIONAL (the User association may be absent).
    id: z.string().optional(),
    user_id: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
    display_name: z.string().nullable().optional(),
  })
  .passthrough();

export const promptSettingsSchema = z
  .object({
    // `settings?.id || null` — nullable; fail-safe to null on weird values.
    id: z.string().nullable().catch(null),
    group_id: z.string().nullable().optional(),
    schedule_timezone: z.string().nullable().optional(),
    default_deadline_hours: z.number().nullable().optional(),
    default_token_expiry_hours: z.number().nullable().optional(),
    is_active: z.boolean().nullable().optional(),
    template_config: z
      .object({
        schedules: z.array(promptScheduleSchema).optional().catch([]),
      })
      .passthrough()
      .nullable()
      .optional(),
    // Optional collections default to [] (field-level tolerance) so one bad item
    // never blanks the surface.
    schedules: z.array(promptScheduleSchema).optional().default([]).catch([]),
    games: z.array(promptSettingsGameSchema).optional().default([]).catch([]),
    members: z.array(promptSettingsMemberSchema).optional().default([]).catch([]),
  })
  .passthrough();
export type PromptSettings = z.infer<typeof promptSettingsSchema>;

// -----------------------------------------------------------------------------
// open-prompts (GET /groups/:id/prompts/open)
// -----------------------------------------------------------------------------

export const promptCreatorSchema = z
  .object({
    id: z.string().nullable().optional(),
    username: z.string().nullable().optional(),
  })
  .passthrough();

// Singular `GroupPromptSetting` alias (Sequelize default belongsTo alias). The UI
// consumes `.template_name` for the "From [schedule name]" label — MUST survive.
export const promptGroupSettingAliasSchema = z
  .object({
    id: z.string().nullable().optional(),
    template_name: z.string().nullable().optional(),
  })
  .passthrough();

export const promptItemSchema = z
  .object({
    id: z.string(),
    // COMPUTED server authorization decision (T-84-07): MUST survive parsing.
    // Fails SAFE to `false` (hide close control) rather than throwing the item.
    can_close: z.boolean().catch(false),
    group_id: z.string().nullable().optional(),
    game_id: z.string().nullable().optional(),
    created_by_settings_id: z.string().nullable().optional(),
    deadline: z.string().nullable().optional(),
    prompt_date: z.string().nullable().optional(),
    custom_message: z.string().nullable().optional(),
    status: z.string().nullable().optional(),
    week_identifier: z.string().nullable().optional(),
    // Nullable associations (Sequelize `required:false`); field-level `.catch`
    // so one malformed association degrades to null, not a blanked list.
    Creator: promptCreatorSchema.nullable().optional().catch(null),
    GroupPromptSetting: promptGroupSettingAliasSchema.nullable().optional().catch(null),
  })
  .passthrough();
export type PromptItem = z.infer<typeof promptItemSchema>;

export const openPromptsSchema = z
  .object({
    // ITEM-LEVEL tolerance (matches the field-level tolerance invariant above):
    // a single malformed prompt item is DROPPED, never blanks the whole list +
    // badge. We parse each element through `.nullable().catch(null)` so a bad
    // element degrades to null instead of failing the entire `z.array`, then
    // filter the nulls back out. `id` stays strict — a genuinely id-less item is
    // dropped, not silently rendered with a broken key. NOTE: no array-level
    // `.catch` — a wholly wrong-type `prompts` (e.g. a string) must still fail
    // the top-level parse so the soft-fail layer reports it to Sentry and renders
    // the empty fallback, rather than silently masquerading as "no open polls".
    prompts: z
      .array(promptItemSchema.nullable().catch(null))
      .optional()
      .default([])
      .transform((arr) => arr.filter((p): p is PromptItem => p != null)),
  })
  .passthrough();
export type OpenPrompts = z.infer<typeof openPromptsSchema>;

// -----------------------------------------------------------------------------
// Empty-render fallbacks (prior empty shapes the components already handle).
// -----------------------------------------------------------------------------
export const EMPTY_PROMPT_SETTINGS: PromptSettings = {
  id: null,
  schedules: [],
  games: [],
  members: [],
};
export const EMPTY_OPEN_PROMPTS: OpenPrompts = { prompts: [] };

// -----------------------------------------------------------------------------
// Soft-fail parsing + query fns (T-84-05 / T-84-06).
// -----------------------------------------------------------------------------

function keyTag(part: unknown): string | undefined {
  return typeof part === 'string' ? part : undefined;
}

/**
 * Field-level-tolerant soft-fail parse. The schemas above already absorb single
 * bad OPTIONAL fields (`.catch`) and default optional collections, so safeParse
 * SUCCEEDS for benign drift. A TOP-LEVEL-invalid body (e.g. wrong root type /
 * null) is the only thing that fails — in that case we do NOT throw or enter a
 * blank error state: we tag Sentry with the queryKey ONLY (no body/token, T-84-05)
 * and return `fallback` (the component's prior empty-render shape). PRIM-03
 * (Phase 86) owns the real fetch-error UI; this phase must not regress to
 * blank-on-parse-error.
 */
export function parsePromptsSoftFail<T>(
  schema: z.ZodType<T>,
  body: unknown,
  queryKey: ReadonlyArray<unknown>,
  fallback: T
): T {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  Sentry.captureException(new Error('prompts schema soft-fail'), {
    tags: { entity: keyTag(queryKey[0]), scope: keyTag(queryKey[1]) },
    extra: { zodIssues: result.error.issues.map((i) => ({ path: i.path, code: i.code })) },
  });
  return fallback;
}

/**
 * Thin soft-fail queryFn factory: fetch via the existing `apiFetch` seam, then
 * soft-fail parse (never throw on ZodError). Mirrors `validatedQueryFn` (84-04)
 * but uses safeParse + fallback instead of strict `.parse()` throw, because the
 * prompt trio must degrade rather than blank on benign backend drift.
 */
export function softFailPromptQueryFn<T>(
  schema: z.ZodType<T>,
  url: string,
  queryKey: ReadonlyArray<unknown>,
  fallback: T
) {
  return async (): Promise<T> => {
    const raw = await apiFetch<unknown>(url);
    return parsePromptsSoftFail(schema, raw, queryKey, fallback);
  };
}
