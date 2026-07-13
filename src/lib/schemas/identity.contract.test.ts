/**
 * Identity contract test (Phase 87.3, PR-B / Req 5, D-04, D-07).
 *
 * The FIRST runtime `safeParse` coverage the identity schemas have ever had.
 * `users.ts` / `groups.ts` / `events.ts` shipped type-only (z.infer) in Phase 82;
 * this file exercises the actual runtime shape.
 *
 * What it pins:
 *   POSITIVE — real post-cutover wire shapes (nested user `id` = UUID) parse.
 *   NEGATIVE — a sub-shaped string ('auth0|...') in a `.uuid()`-tightened NESTED
 *              id field FAILS parse. This is the whole point of the tighten (Req 5,
 *              ASVS V5): a sub identity value must be rejectable at the nested
 *              compare target.
 *
 * SCOPE (D-07): only the NESTED `id` (UUID) shapes are tightened here. The FLAT
 * wire fields (`user_id`, `requester_id`, `addressee_id`) still carry the Auth0
 * sub through the rollout window — they remain bare `z.string()` until PR-C, and
 * their `.uuid()` tighten is the plan-10 fast-follow. This file must NOT assert a
 * flat field is a UUID.
 *
 * Fixtures are authored field-for-field from the route res.json(...) source of
 * truth (friendships USER_INCLUDES, rsvp/eventBrings includes, groups roster
 * attributes, events formatEventWithCustomParticipants) — see 87.3-RESEARCH.md.
 */
import { describe, it, expect } from 'vitest';
import { UserSchema, FriendshipSchema } from './users';
import { GroupMemberSchema } from './groups';
import { RsvpSchema, EventBringSchema } from './events';

// The sub shape the nested-id tighten must reject (matches the prompts analog literal).
const SUB = 'auth0|abc123';
const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';

describe('identity contract — nested id (UUID) rejects a sub-shaped value (Req 5)', () => {
  it('UserSchema: a sub-shaped nested id fails parse', () => {
    expect(UserSchema.safeParse({ id: SUB, user_id: SUB }).success).toBe(false);
  });

  it('UserSchema: a valid UUID nested id parses', () => {
    expect(UserSchema.safeParse({ id: UUID, user_id: SUB }).success).toBe(true);
  });

  it('GroupMemberSchema: a sub-shaped member id fails parse', () => {
    expect(GroupMemberSchema.safeParse({ id: SUB, user_id: SUB }).success).toBe(false);
  });

  it('FriendshipSchema: a sub-shaped Requester.id fails parse', () => {
    expect(
      FriendshipSchema.safeParse({ id: UUID, Requester: { id: SUB } }).success
    ).toBe(false);
  });

  it('RsvpSchema: a sub-shaped nested User.id fails parse', () => {
    expect(
      RsvpSchema.safeParse({
        rsvp_id: UUID,
        event_id: UUID,
        user_id: SUB,
        status: 'yes',
        User: { id: SUB },
      }).success
    ).toBe(false);
  });

  it('EventBringSchema: a sub-shaped nested User.id fails parse', () => {
    expect(
      EventBringSchema.safeParse({
        bring_id: UUID,
        event_id: UUID,
        user_id: SUB,
        game_id: UUID,
        User: { id: SUB },
      }).success
    ).toBe(false);
  });
});
