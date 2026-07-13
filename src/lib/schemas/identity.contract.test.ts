/**
 * Identity contract test (Phase 87.3, PR-B / Req 5, D-04, D-07).
 *
 * The FIRST runtime `safeParse` coverage the identity schemas have ever had.
 * `users.ts` / `groups.ts` / `events.ts` shipped type-only (z.infer) in Phase 82;
 * this file exercises the actual runtime shape.
 *
 * What it pins:
 *   POSITIVE — real post-cutover wire shapes (nested user `id` = UUID) parse
 *              (`success === true`).
 *   NEGATIVE — a sub-shaped string ('auth0|...') in a `.uuid()`-tightened NESTED
 *              id field FAILS parse (`success === false`). This is the whole point
 *              of the tighten (Req 5, ASVS V5): a sub identity value must be
 *              rejectable at the nested compare target.
 *
 * SCOPE (D-07): only the NESTED `id` (UUID) shapes are tightened here. The FLAT
 * wire fields (`user_id`, `requester_id`, `addressee_id`) still carry the Auth0
 * sub through the rollout window — they remain bare `z.string()` until PR-C, and
 * their `.uuid()` tighten is the plan-10 fast-follow. This file therefore does NOT
 * assert any flat field is a UUID; the positive fixtures deliberately keep the
 * flat fields sub-shaped to prove they still parse (rollout-window safe).
 *
 * Fixtures are authored field-for-field from the route res.json(...) source of
 * truth (see 87.3-RESEARCH.md "Verified Current-State Inventory"):
 *   - friendship:  friendships.js USER_INCLUDES + toFriendshipWire
 *   - roster:      groups.js roster attributes ['id','username','user_id']
 *   - rsvp:        rsvp.js list include ['id','username','user_id'] + wire shim
 *   - bring:       eventBrings.js list include + wire shim
 *   - participant: events.js formatEventWithCustomParticipants (user_id = User.id UUID)
 *
 * NOTE: this sandbox has no live bearer token / network, so the bodies below are
 * authored from the route source (the authoritative shape), not a live capture —
 * the same deviation documented for prompts.contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { UserSchema, FriendshipSchema } from './users';
import { GroupMemberSchema } from './groups';
import {
  RsvpSchema,
  EventBringSchema,
  EventParticipationSchema,
} from './events';

// The sub shape the nested-id tighten must reject (matches the prompts analog literal).
const SUB = 'auth0|abc123';
// Valid Users.id UUIDs (post-cutover nested id values).
const U1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const U2 = 'a1b2c3d4-1111-42d2-8333-444455556666';
const U3 = 'b2c3d4e5-2222-4333-9444-555566667777';
const EVENT_ID = 'c3d4e5f6-3333-4444-5555-666677778888';
const GAME_ID = 'd4e5f6a7-4444-5555-6666-777788889999';

// ---------------------------------------------------------------------------
// Real-shape fixtures (nested id = UUID; flat *_id = sub, per D-07 window)
// ---------------------------------------------------------------------------

// friendships.js: toFriendshipWire output + Requester/Addressee USER_INCLUDES.
export const CAPTURED_FRIENDSHIP_BODY = {
  id: '9f8e7d6c-5b4a-3210-fedc-ba9876543210', // friendship row PK
  requester_id: SUB, // flat: still the sub via shim (D-07)
  addressee_id: 'auth0|def456', // flat: still the sub via shim (D-07)
  status: 'accepted' as const,
  Requester: { id: U1, username: 'alice', user_id: SUB },
  Addressee: { id: U2, username: 'bob', user_id: 'auth0|def456' },
};

// groups.js: GET /:group_id/users roster member (attributes ['id','username','user_id']).
export const CAPTURED_ROSTER_MEMBER_BODY = {
  id: U1, // nested UUID compare target (member.id === selfUuid)
  user_id: SUB, // flat: still the sub (D-07)
  username: 'alice',
  role: 'owner' as const,
};

// rsvp.js: event RSVP list item (nested User include + user_id wire shim).
export const CAPTURED_RSVP_BODY = {
  rsvp_id: '11111111-2222-3333-4444-555555555555',
  event_id: EVENT_ID,
  user_id: SUB, // flat: still the sub via shim (D-07)
  status: 'yes' as const,
  note: null,
  User: { id: U1, username: 'alice', user_id: SUB },
};

// eventBrings.js: brings list item (nested User include + user_id wire shim).
export const CAPTURED_BRING_BODY = {
  bring_id: '22222222-3333-4444-5555-666666666666',
  event_id: EVENT_ID,
  user_id: SUB, // flat: still the sub via shim (D-07)
  game_id: GAME_ID,
  User: { id: U3, username: 'carol', user_id: SUB },
  game: { id: GAME_ID, name: 'Catan' },
};

// events.js formatEventWithCustomParticipants: participant roster — flat user_id
// is ALREADY the UUID (User.id) here, and there is no nested User object.
export const CAPTURED_PARTICIPANT_BODY = {
  user_id: U1, // already a UUID string — parses fine as a bare z.string()
  username: 'alice',
};

describe('identity contract — real-shape fixtures parse (nested id = UUID)', () => {
  it('friendship: Requester/Addressee nested id (UUID) + sub flat fields parse', () => {
    const r = FriendshipSchema.safeParse(CAPTURED_FRIENDSHIP_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.Requester?.id).toBe(U1);
    // flat field still carries the sub through the window (D-07)
    expect(r.data.requester_id).toBe(SUB);
  });

  it('roster member: nested id (UUID) parses; flat user_id stays a sub', () => {
    const r = GroupMemberSchema.safeParse(CAPTURED_ROSTER_MEMBER_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(U1);
    expect(r.data.user_id).toBe(SUB);
  });

  it('rsvp: nested User.id (UUID) parses; flat user_id stays a sub', () => {
    const r = RsvpSchema.safeParse(CAPTURED_RSVP_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.User?.id).toBe(U1);
    expect(r.data.user_id).toBe(SUB);
  });

  it('bring: nested User.id (UUID) parses; flat user_id stays a sub', () => {
    const r = EventBringSchema.safeParse(CAPTURED_BRING_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.User?.id).toBe(U3);
    expect(r.data.user_id).toBe(SUB);
  });

  it('event participant: already-UUID flat user_id parses (events.js end-state)', () => {
    const r = EventParticipationSchema.safeParse(CAPTURED_PARTICIPANT_BODY);
    expect(r.success).toBe(true);
  });

  it('UserSchema: a canonical self record with a UUID id parses', () => {
    const r = UserSchema.safeParse({ id: U1, user_id: SUB, username: 'alice' });
    expect(r.success).toBe(true);
  });
});

describe('identity contract — nested id (UUID) rejects a sub-shaped value (Req 5)', () => {
  it('UserSchema: a sub-shaped nested id fails parse', () => {
    expect(UserSchema.safeParse({ id: SUB, user_id: SUB }).success).toBe(false);
  });

  it('GroupMemberSchema: a sub-shaped member id fails parse', () => {
    const bad = { ...CAPTURED_ROSTER_MEMBER_BODY, id: SUB };
    expect(GroupMemberSchema.safeParse(bad).success).toBe(false);
  });

  it('FriendshipSchema: a sub-shaped Requester.id fails parse', () => {
    const bad = { ...CAPTURED_FRIENDSHIP_BODY, Requester: { id: SUB } };
    expect(FriendshipSchema.safeParse(bad).success).toBe(false);
  });

  it('RsvpSchema: a sub-shaped nested User.id fails parse', () => {
    const bad = { ...CAPTURED_RSVP_BODY, User: { id: SUB } };
    expect(RsvpSchema.safeParse(bad).success).toBe(false);
  });

  it('EventBringSchema: a sub-shaped nested User.id fails parse', () => {
    const bad = { ...CAPTURED_BRING_BODY, User: { id: SUB } };
    expect(EventBringSchema.safeParse(bad).success).toBe(false);
  });
});
