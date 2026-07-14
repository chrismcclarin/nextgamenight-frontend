/**
 * Identity contract test (Phase 87.3 — PR-B nested tighten + plan-10 flat
 * fast-follow; Req 5, D-04, D-07).
 *
 * The runtime `safeParse` coverage for the identity schemas (`users.ts` /
 * `groups.ts` / `events.ts` shipped type-only in Phase 82; PR-B added the
 * nested-id coverage, plan 10 completes the flat-field coverage).
 *
 * What it pins:
 *   POSITIVE — real POST-PR-C wire shapes parse (`success === true`):
 *              nested user `id` = UUID, and every FLAT user-reference field
 *              (`user_id`, `requester_id`, `addressee_id`) carries the
 *              Users.id UUID (or is dropped/null per surface).
 *   NEGATIVE — a sub-shaped string ('auth0|...') FAILS parse in BOTH the
 *              `.uuid()`-tightened NESTED id fields (PR-B) AND every FLAT
 *              identity field (plan 10 — this completes Req 5, ASVS V5).
 *
 * SCOPE (D-07 complete): PR-C removed the Auth0 sub from every in-scope wire
 * field (BE merge 428f3f2, wire-sweep.test.js guards it server-side), so the
 * flat fields are now tightened to `z.uuid()` — the rollout window where they
 * carried the sub is CLOSED. Post-PR-C wire truth per surface:
 *   - friendships:  toFriendshipWire — flat requester_id/addressee_id = the
 *                   Users.id UUID (equal to nested Requester.id/Addressee.id);
 *                   nested includes emit ['id','username'] only (no user_id).
 *   - /friendships/search: response is { id, username } ONLY — the flat sub
 *                   user_id was DROPPED (BE-12, the sole sanctioned drop).
 *   - rosters:      groups.js aliases user_id = member.id (UUID); include
 *                   selects ['id','username'] (sub column no longer selected).
 *   - rsvp/brings:  flat user_id = nested User.id (UUID); nested User include
 *                   emits ['id','username'] only.
 *   - /users/:id:   toSelfWire aliases user_id = id (UUID) on the self row.
 *   - participants: events.js formatEventWithCustomParticipants — user_id is
 *                   the UUID for group members, null for custom participants.
 *
 * Fixtures are authored field-for-field from the route res.json(...) source of
 * truth at the merged PR-C state (periodictabletopbackend_v2/Sonnet/routes/).
 * NOTE: this sandbox has no live bearer token / network, so the bodies below
 * are authored from the route source (the authoritative shape), not a live
 * capture — the same deviation documented for prompts.contract.test.ts.
 */
import { describe, it, expect } from 'vitest';
import { UserSchema, FriendshipSchema } from './users';
import { GroupMemberSchema } from './groups';
import {
  RsvpSchema,
  EventBringSchema,
  EventParticipationSchema,
} from './events';

// The sub shape BOTH the nested and (post-plan-10) flat tightens must reject.
const SUB = 'auth0|abc123';
// Valid Users.id UUIDs (post-cutover identity values, nested AND flat).
const U1 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const U2 = 'a1b2c3d4-1111-42d2-8333-444455556666';
const U3 = 'b2c3d4e5-2222-4333-9444-555566667777';
const EVENT_ID = 'c3d4e5f6-3333-4444-5555-666677778888';
const GAME_ID = 'd4e5f6a7-4444-5555-6666-777788889999';

// ---------------------------------------------------------------------------
// Real-shape fixtures (post-PR-C: nested id = UUID AND flat *_id = UUID)
// ---------------------------------------------------------------------------

// friendships.js: toFriendshipWire output + Requester/Addressee USER_INCLUDES
// (['id','username'] — the sub user_id is no longer included). Flat
// requester_id/addressee_id CARRY the Users.id UUID (Req 2 carry-UUID lock).
export const CAPTURED_FRIENDSHIP_BODY = {
  id: '9f8e7d6c-5b4a-3210-fedc-ba9876543210', // friendship row PK
  requester_id: U1, // flat = Requester.id UUID (PR-C)
  addressee_id: U2, // flat = Addressee.id UUID (PR-C)
  status: 'accepted' as const,
  Requester: { id: U1, username: 'alice' },
  Addressee: { id: U2, username: 'bob' },
};

// friendships.js GET /search: attributes ['id','username'] ONLY — the flat sub
// user_id was DROPPED at PR-C (BE-12, the sole sanctioned drop of the phase).
export const CAPTURED_FRIEND_SEARCH_BODY = {
  id: U2,
  username: 'bob',
};

// groups.js: GET /:group_id/users roster member — include attributes
// ['id','username'] + through attributes ['role','joined_at'], then the
// post-query alias map sets user_id = member.id (UUID). Role rides NESTED
// under UserGroup; no flat role and no email (BSEC-01) on the wire.
export const CAPTURED_ROSTER_MEMBER_BODY = {
  id: U1, // nested UUID compare target (member.id === selfUuid)
  user_id: U1, // flat = the SAME Users.id UUID (PR-C roster alias)
  username: 'alice',
  UserGroup: { role: 'owner' as const, joined_at: '2026-07-01T00:00:00.000Z' },
};

// users.js: /users/:user_id + every self-write echo ride toSelfWire, which
// aliases user_id = id — the self row's flat user_id is the caller's own UUID.
export const CAPTURED_SELF_BODY = {
  id: U1,
  user_id: U1, // toSelfWire alias (PR-C): flat user_id === id (UUID)
  username: 'alice',
};

// rsvp.js: event RSVP list item — EventRsvp.toJSON() (PK `id`) + nested User
// include ['id','username'] + flat user_id = User.id (UUID; the sub shim and
// the user_uuid surrogate are both gone from the wire).
export const CAPTURED_RSVP_BODY = {
  id: '11111111-2222-3333-4444-555555555555', // EventRsvp row PK
  event_id: EVENT_ID,
  user_id: U1, // flat = nested User.id UUID (PR-C)
  status: 'yes' as const,
  note: null,
  reminder_sent_at: null,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  User: { id: U1, username: 'alice' },
};

// eventBrings.js: brings list item — EventBring.toJSON() (PK `id`) + nested
// User ['id','username'] / Game includes + flat user_id = User.id (UUID). The
// Game include has no alias, so the wire key is CAPITALIZED (BringSummary
// reads bring.Game?.name).
export const CAPTURED_BRING_BODY = {
  id: '22222222-3333-4444-5555-666666666666', // EventBring row PK
  event_id: EVENT_ID,
  user_id: U3, // flat = nested User.id UUID (PR-C)
  game_id: GAME_ID,
  createdAt: '2026-07-01T00:00:00.000Z',
  updatedAt: '2026-07-01T00:00:00.000Z',
  User: { id: U3, username: 'carol' },
  Game: { id: GAME_ID, name: 'Catan', thumbnail_url: null },
};

// ---------------------------------------------------------------------------
// Fixture/route lockstep: the exact key sets each route emits, re-derived from
// the route source at the merged PR-C state. Top-level keys are unchanged from
// the pre-PR-C wire (names stable, Req 2); the NESTED User includes shrank to
// ['id','username'] — pinned separately below so a fixture inventing a nested
// user_id (or a route regressing one back onto the wire model) fails here
// BEFORE a schema could green-light the wrong shape.
// ---------------------------------------------------------------------------
const ROUTE_EMITTED_KEYS = {
  roster: ['id', 'user_id', 'username', 'UserGroup'],
  rsvp: ['id', 'event_id', 'user_id', 'status', 'note', 'reminder_sent_at', 'createdAt', 'updatedAt', 'User'],
  bring: ['id', 'event_id', 'user_id', 'game_id', 'createdAt', 'updatedAt', 'User', 'Game'],
  // Nested User include shape shared by friendships/rsvp/brings post-PR-C.
  nestedUser: ['id', 'username'],
  friendSearch: ['id', 'username'],
} as const;

// events.js formatEventWithCustomParticipants: participant roster — flat
// user_id is the UUID (ep.User?.id) for group members and null for custom
// participants; there is no nested User object on the participant row.
export const CAPTURED_PARTICIPANT_BODY = {
  user_id: U1, // Users.id UUID (post-cutover end-state)
  username: 'alice',
};

export const CAPTURED_CUSTOM_PARTICIPANT_BODY = {
  user_id: null, // custom (name-only) participants carry an explicit null
  username: 'drop-in dave',
};

describe('identity contract — real post-PR-C shapes parse (nested AND flat = UUID)', () => {
  it('friendship: UUID flat requester_id/addressee_id + sub-free nested includes parse', () => {
    const r = FriendshipSchema.safeParse(CAPTURED_FRIENDSHIP_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.Requester?.id).toBe(U1);
    // flat field now carries the SAME UUID as the nested compare target
    expect(r.data.requester_id).toBe(U1);
    expect(r.data.addressee_id).toBe(U2);
  });

  it('friend search result: { id, username } ONLY (BE-12 sub drop) parses via UserSchema', () => {
    // Regression pin for review #11: UserSchema must not REQUIRE a user_id the
    // post-PR-C search response (and nested includes) no longer carry.
    const r = UserSchema.safeParse(CAPTURED_FRIEND_SEARCH_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(U2);
    expect(r.data.user_id).toBeUndefined();
  });

  it('roster member: user_id is the ALIASED member UUID (=== id); role nests under UserGroup', () => {
    const r = GroupMemberSchema.safeParse(CAPTURED_ROSTER_MEMBER_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(U1);
    expect(r.data.user_id).toBe(U1); // alias: flat === nested UUID
    expect(r.data.UserGroup?.role).toBe('owner');
  });

  it('roster member: a game-only row (UserGroup: null) parses', () => {
    const r = GroupMemberSchema.safeParse({ ...CAPTURED_ROSTER_MEMBER_BODY, UserGroup: null });
    expect(r.success).toBe(true);
  });

  it('self row: toSelfWire alias (user_id === id UUID) parses', () => {
    const r = UserSchema.safeParse(CAPTURED_SELF_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.user_id).toBe(r.data.id);
  });

  it('rsvp: row PK id + UUID flat user_id (=== nested User.id) parse', () => {
    const r = RsvpSchema.safeParse(CAPTURED_RSVP_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(CAPTURED_RSVP_BODY.id);
    expect(r.data.User?.id).toBe(U1);
    expect(r.data.user_id).toBe(U1);
  });

  it('bring: row PK id + UUID flat user_id (=== nested User.id) parse', () => {
    const r = EventBringSchema.safeParse(CAPTURED_BRING_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.id).toBe(CAPTURED_BRING_BODY.id);
    expect(r.data.User?.id).toBe(U3);
    expect(r.data.user_id).toBe(U3);
    expect(r.data.Game?.name).toBe('Catan');
  });

  it('event participant: UUID flat user_id parses (events.js end-state)', () => {
    const r = EventParticipationSchema.safeParse(CAPTURED_PARTICIPANT_BODY);
    expect(r.success).toBe(true);
  });

  it('event participant: a custom (name-only) participant with user_id: null parses', () => {
    const r = EventParticipationSchema.safeParse(CAPTURED_CUSTOM_PARTICIPANT_BODY);
    expect(r.success).toBe(true);
  });
});

describe('identity contract — fixtures stay in lockstep with route emissions', () => {
  it('roster fixture contains only keys GET /:group_id/users emits', () => {
    expect(Object.keys(CAPTURED_ROSTER_MEMBER_BODY).sort()).toEqual([...ROUTE_EMITTED_KEYS.roster].sort());
  });

  it('rsvp fixture contains only keys GET /rsvp/event/:event_id emits', () => {
    expect(Object.keys(CAPTURED_RSVP_BODY).sort()).toEqual([...ROUTE_EMITTED_KEYS.rsvp].sort());
  });

  it('bring fixture contains only keys GET /event-brings/event/:event_id emits', () => {
    expect(Object.keys(CAPTURED_BRING_BODY).sort()).toEqual([...ROUTE_EMITTED_KEYS.bring].sort());
  });

  it('nested User includes emit [id, username] ONLY post-PR-C (no sub user_id)', () => {
    const nested = [...ROUTE_EMITTED_KEYS.nestedUser].sort();
    expect(Object.keys(CAPTURED_FRIENDSHIP_BODY.Requester).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_FRIENDSHIP_BODY.Addressee).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_RSVP_BODY.User).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_BRING_BODY.User).sort()).toEqual(nested);
  });

  it('friend-search fixture contains only the keys GET /friendships/search emits', () => {
    expect(Object.keys(CAPTURED_FRIEND_SEARCH_BODY).sort()).toEqual([...ROUTE_EMITTED_KEYS.friendSearch].sort());
  });

  it('rsvp/bring schemas require the row PK the routes emit — invented *_id aliases must fail', () => {
    // Regression pin for the rsvp_id/bring_id defect: a body keyed by the
    // invented alias (no real `id`) must NOT parse.
    const { id: _r, ...rsvpRest } = CAPTURED_RSVP_BODY;
    expect(RsvpSchema.safeParse({ ...rsvpRest, rsvp_id: CAPTURED_RSVP_BODY.id }).success).toBe(false);
    const { id: _b, ...bringRest } = CAPTURED_BRING_BODY;
    expect(EventBringSchema.safeParse({ ...bringRest, bring_id: CAPTURED_BRING_BODY.id }).success).toBe(false);
  });
});

describe('identity contract — nested id (UUID) rejects a sub-shaped value (Req 5, PR-B)', () => {
  it('UserSchema: a sub-shaped nested id fails parse', () => {
    expect(UserSchema.safeParse({ id: SUB, user_id: U1 }).success).toBe(false);
  });

  it('GroupMemberSchema: a sub-shaped member id fails parse ON THE id PATH', () => {
    const r = GroupMemberSchema.safeParse({ ...CAPTURED_ROSTER_MEMBER_BODY, id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    // The failure must be the uuid tighten itself — not an unrelated fixture
    // mismatch masking as a pass (#25 class).
    expect(r.error.issues.some((i) => i.path.join('.') === 'id')).toBe(true);
  });

  it('FriendshipSchema: a sub-shaped Requester.id fails parse ON THE Requester.id PATH', () => {
    const r = FriendshipSchema.safeParse({ ...CAPTURED_FRIENDSHIP_BODY, Requester: { id: SUB } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'Requester.id')).toBe(true);
  });

  it('RsvpSchema: a sub-shaped nested User.id fails parse ON THE User.id PATH', () => {
    const r = RsvpSchema.safeParse({ ...CAPTURED_RSVP_BODY, User: { id: SUB } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'User.id')).toBe(true);
  });

  it('EventBringSchema: a sub-shaped nested User.id fails parse ON THE User.id PATH', () => {
    const r = EventBringSchema.safeParse({ ...CAPTURED_BRING_BODY, User: { id: SUB } });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'User.id')).toBe(true);
  });
});

describe('identity contract — FLAT identity fields reject a sub-shaped value (Req 5 complete, plan 10)', () => {
  it('FriendshipSchema: a sub-shaped flat requester_id fails parse ON THE requester_id PATH', () => {
    const r = FriendshipSchema.safeParse({ ...CAPTURED_FRIENDSHIP_BODY, requester_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'requester_id')).toBe(true);
  });

  it('FriendshipSchema: a sub-shaped flat addressee_id fails parse ON THE addressee_id PATH', () => {
    const r = FriendshipSchema.safeParse({ ...CAPTURED_FRIENDSHIP_BODY, addressee_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'addressee_id')).toBe(true);
  });

  it('UserSchema: a sub-shaped flat user_id fails parse ON THE user_id PATH', () => {
    const r = UserSchema.safeParse({ ...CAPTURED_SELF_BODY, user_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'user_id')).toBe(true);
  });

  it('GroupMemberSchema: a sub-shaped flat roster user_id fails parse ON THE user_id PATH', () => {
    const r = GroupMemberSchema.safeParse({ ...CAPTURED_ROSTER_MEMBER_BODY, user_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'user_id')).toBe(true);
  });

  it('RsvpSchema: a sub-shaped flat user_id fails parse ON THE user_id PATH', () => {
    const r = RsvpSchema.safeParse({ ...CAPTURED_RSVP_BODY, user_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'user_id')).toBe(true);
  });

  it('EventBringSchema: a sub-shaped flat user_id fails parse ON THE user_id PATH', () => {
    const r = EventBringSchema.safeParse({ ...CAPTURED_BRING_BODY, user_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'user_id')).toBe(true);
  });

  it('EventParticipationSchema: a sub-shaped participant user_id fails parse ON THE user_id PATH', () => {
    const r = EventParticipationSchema.safeParse({ ...CAPTURED_PARTICIPANT_BODY, user_id: SUB });
    expect(r.success).toBe(false);
    if (r.success) return;
    expect(r.error.issues.some((i) => i.path.join('.') === 'user_id')).toBe(true);
  });
});
