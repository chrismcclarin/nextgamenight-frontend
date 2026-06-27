/**
 * Contract test (A3) — honors the 84-04 FOUNDATION rule for the TWO endpoints
 * migrated to a runtime schema THIS phase: each ships a committed test that runs
 * the ACTUAL safeParse against a captured real BE body, executed by the FE Vitest
 * runner (there is NO jest in the frontend).
 *
 * Fixtures are faithful to the route source of truth:
 *   - prompt-settings: groupPromptSettings.js `res.json({...})` ~line 141
 *   - open-prompts:    availabilityPrompt.js `res.json({ prompts: decorated })` ~line 585
 *     (each item = spread `p.toJSON()` PLUS computed `can_close`; `created_by_user_id`
 *     stripped server-side).
 *
 * NOTE: this sandbox has no live bearer token / network, so the bodies below are
 * authored field-for-field from the route `res.json(...)` source (the authoritative
 * shape), not copied from a live devtools capture. They mirror the real wire shape
 * the routes emit. (Documented as a deviation in 84-09-SUMMARY.md.)
 *
 * The fixtures are exported so the GAP12-14 tests reuse them (mutating copies for
 * the negative cases) rather than inventing new shapes.
 */
import { describe, it, expect } from 'vitest';
import { promptSettingsSchema, openPromptsSchema } from './prompts';

// Captured GET /groups/:id/prompt-settings body (groupPromptSettings.js ~141).
export const CAPTURED_PROMPT_SETTINGS_BODY = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  group_id: 'a1b2c3d4-1111-2222-3333-444455556666',
  schedule_timezone: 'America/New_York',
  default_deadline_hours: 72,
  default_token_expiry_hours: 168,
  is_active: true,
  template_config: {
    schedules: [
      {
        id: 'sch-0001-aaaa-bbbb-cccc-000000000001',
        schedule_day_of_week: 5,
        schedule_time: '18:00',
        schedule_timezone: 'America/New_York',
        game_id: null,
        template_name: 'Friday Game Night',
        default_deadline_hours: 72,
        default_token_expiry_hours: 168,
        min_participants: null,
        selected_member_ids: [],
        is_active: true,
        created_at: '2026-06-01T12:00:00.000Z',
        updated_at: '2026-06-01T12:00:00.000Z',
      },
    ],
  },
  schedules: [
    {
      id: 'sch-0001-aaaa-bbbb-cccc-000000000001',
      schedule_day_of_week: 5,
      schedule_time: '18:00',
      schedule_timezone: 'America/New_York',
      game_id: null,
      template_name: 'Friday Game Night',
      default_deadline_hours: 72,
      default_token_expiry_hours: 168,
      min_participants: null,
      selected_member_ids: [],
      is_active: true,
      created_at: '2026-06-01T12:00:00.000Z',
      updated_at: '2026-06-01T12:00:00.000Z',
    },
  ],
  games: [
    {
      id: 'game-1111-2222-3333-444444444444',
      name: 'Catan',
      image_url: 'https://example.com/catan.png',
      min_players: 3,
      max_players: 4,
    },
  ],
  // `id` here comes from `ug.User?.id` — present when the association resolved.
  members: [
    {
      id: 'usr-aaaa-bbbb-cccc-000000000001',
      user_id: 'auth0|abc123',
      username: 'alice',
      display_name: 'alice',
    },
    {
      // Edge: User association absent → `id` omitted (ug.User?.id is undefined).
      user_id: 'auth0|def456',
      username: 'bob',
      display_name: 'bob',
    },
  ],
};

// Captured GET /groups/:id/prompts/open body (availabilityPrompt.js ~585).
export const CAPTURED_OPEN_PROMPTS_BODY = {
  prompts: [
    {
      // Auto-prompt: has GroupPromptSetting alias, Creator null, can_close true.
      id: 'prm-aaaa-1111-2222-3333-000000000001',
      group_id: 'a1b2c3d4-1111-2222-3333-444455556666',
      game_id: null,
      prompt_date: '2026-06-20T18:00:00.000Z',
      deadline: '2026-06-23T18:00:00.000Z',
      status: 'active',
      week_identifier: '2026-W25',
      created_by_settings_id: 'sch-0001-aaaa-bbbb-cccc-000000000001',
      custom_message: null,
      blind_voting_enabled: false,
      auto_schedule_enabled: false,
      createdAt: '2026-06-20T18:00:00.000Z',
      updatedAt: '2026-06-20T18:00:00.000Z',
      Creator: null,
      GroupPromptSetting: {
        id: 'sch-0001-aaaa-bbbb-cccc-000000000001',
        template_name: 'Friday Game Night',
      },
      can_close: true,
    },
    {
      // Manual poll: Creator present, GroupPromptSetting null, can_close false.
      id: 'prm-bbbb-1111-2222-3333-000000000002',
      group_id: 'a1b2c3d4-1111-2222-3333-444455556666',
      game_id: 'game-1111-2222-3333-444444444444',
      prompt_date: '2026-06-21T18:00:00.000Z',
      deadline: '2026-06-24T18:00:00.000Z',
      status: 'pending',
      week_identifier: '2026-W25',
      created_by_settings_id: null,
      custom_message: 'Who is in for Catan?',
      blind_voting_enabled: false,
      auto_schedule_enabled: false,
      createdAt: '2026-06-21T18:00:00.000Z',
      updatedAt: '2026-06-21T18:00:00.000Z',
      Creator: { id: 'usr-aaaa-bbbb-cccc-000000000001', username: 'alice' },
      GroupPromptSetting: null,
      can_close: false,
    },
  ],
};

describe('prompts.ts contract — real-body safeParse (84-04 foundation rule)', () => {
  it('parses the captured prompt-settings body (success === true)', () => {
    const result = promptSettingsSchema.safeParse(CAPTURED_PROMPT_SETTINGS_BODY);
    expect(result.success).toBe(true);
  });

  it('parses the captured open-prompts body (success === true)', () => {
    const result = openPromptsSchema.safeParse(CAPTURED_OPEN_PROMPTS_BODY);
    expect(result.success).toBe(true);
  });

  it('retains can_close (boolean) on every open-prompt item', () => {
    const result = openPromptsSchema.safeParse(CAPTURED_OPEN_PROMPTS_BODY);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.prompts.length).toBeGreaterThan(0);
    for (const p of result.data.prompts) {
      expect(typeof p.can_close).toBe('boolean');
    }
    // The real auth values survive (auto-prompt true, manual false here).
    expect(result.data.prompts[0].can_close).toBe(true);
    expect(result.data.prompts[1].can_close).toBe(false);
  });

  it('retains the singular GroupPromptSetting alias on items that have it', () => {
    const result = openPromptsSchema.safeParse(CAPTURED_OPEN_PROMPTS_BODY);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const auto = result.data.prompts[0];
    expect(auto.GroupPromptSetting).toBeTruthy();
    expect(auto.GroupPromptSetting?.template_name).toBe('Friday Game Night');
  });

  it('preserves prompt-settings schedules + members[].id optionality', () => {
    const result = promptSettingsSchema.safeParse(CAPTURED_PROMPT_SETTINGS_BODY);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.schedules.length).toBe(1);
    // Member with absent User association parses with `id` undefined, not dropped.
    expect(result.data.members.length).toBe(2);
    expect(result.data.members[1].id).toBeUndefined();
    expect(result.data.members[1].username).toBe('bob');
  });
});
