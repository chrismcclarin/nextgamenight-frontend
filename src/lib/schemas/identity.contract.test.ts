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
 * ENFORCEMENT NOTE (plan-10 review #4/#11): these tightens bite at TEST time
 * only — api.ts casts responses without runtime safeParse. The LIVE guards for
 * wire drift are the BE-side wire-sweep.test.js and the cross-repo e2e
 * backend-ref dispatch gate (phase runbook). Runtime enforcement arrives with
 * the validatedQueryFn migration (see its FOUNDATION RULE).
 *
 * Fixtures are authored field-for-field from the route res.json(...) source of
 * truth at the merged PR-C state (periodictabletopbackend_v2/Sonnet/routes/).
 * NOTE: this sandbox has no live bearer token / network, so the bodies below
 * are authored from the route source (the authoritative shape), not a live
 * capture — the same deviation documented for prompts.contract.test.ts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { withoutComments } from '../../test-utils/sourceScan';
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

// Phase 88.8 plan 08 put `picture_url` on twelve backend projections behind one
// frozen constant (PUBLIC_USER_ATTRS, utils/publicUserAttrs.js:69). A stored
// value is a Google avatar URL capped at the column width (varchar(255)); a
// password-connection login and a name-only participant both carry null.
const AVATAR = 'https://lh3.googleusercontent.com/a/AAcHTtestavatar=s96-c';

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
  // Both nested includes ride routes/friendships.js:36/:41, widened by plan 08.
  // One carries a stored avatar and one carries null on purpose — a
  // password-connection login has no vendor `picture` claim, and BOTH states
  // must be a real wire shape here, not a hypothetical.
  Requester: { id: U1, username: 'alice', picture_url: AVATAR },
  Addressee: { id: U2, username: 'bob', picture_url: null },
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
  // Phase 88.8 plan 08: routes/groups.js:414 (and :240 for the nested
  // group.Users[] rows on GET /groups/user/:user_id) widened to
  // PUBLIC_USER_ATTRS. Reaches BOTH roster branches — the member branch raw,
  // the game-only branch through stripMemberPII, whose fail-closed allow-list
  // now names picture_url.
  picture_url: AVATAR,
  UserGroup: { role: 'owner' as const, joined_at: '2026-07-01T00:00:00.000Z' },
};

// users.js: /users/:user_id + every self-write echo ride toSelfWire, which
// aliases user_id = id — the self row's flat user_id is the caller's own UUID.
// Phase 88.8 plans 02/09/12 (D-36, D-39): GET /users/:user_id loads the caller
// through User.scope('withContactInfo') (routes/users.js:331) and returns
// toSelfWire(user, pendingEmailChange) (:403). That restores `email` and
// `email_changed_at` (both excluded by the model defaultScope) and assigns the
// DERIVED `pending_email_change` UNCONDITIONALLY, so the key is present on all
// four toSelfWire responses — null on the three write echoes.
//
// These three fields are the complete hydration input set for plan 13's email
// section. They are declared on UserSchema so that section reads them off
// SelfIdentity without an `as` cast.
export const CAPTURED_SELF_BODY = {
  id: U1,
  user_id: U1, // toSelfWire alias (PR-C): flat user_id === id (UUID)
  username: 'alice',
  email: 'alice@example.com',
  email_changed_at: '2026-09-01T12:00:00.000Z',
  // projectPendingEmailChange (routes/users.js:986): { address: row.target,
  // expires_at: row.expires_at } — expires_at is a Date server-side and arrives
  // as an ISO string, which is why the schema declares plain strings inside.
  pending_email_change: {
    address: 'alice.new@example.com',
    expires_at: '2026-09-04T13:00:00.000Z',
  },
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
  // routes/rsvp.js:565 (roster) and :523 (write echo) both widened by plan 08.
  // NOTE where the field is NOT: the shaper only writes `json.user_id` at the
  // top level (rsvp.js:530-532), so there is no TOP-LEVEL picture_url on an
  // RSVP row — it rides nested, and the nestedUser key list is what pins it.
  User: { id: U1, username: 'alice', picture_url: AVATAR },
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
  // routes/eventBrings.js:40 widened by plan 08. Same shape note as the RSVP row
  // above: the brings shaper only writes `json.user_id` at the top level
  // (eventBrings.js:52-56), so picture_url exists ONLY nested under User.
  // Null here on purpose — carol is a password-connection login.
  User: { id: U3, username: 'carol', picture_url: null },
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
  roster: ['id', 'user_id', 'username', 'picture_url', 'UserGroup'],
  // Phase 88.8 plan 12, VERIFIED AGAINST SHIPPED CODE, NOT AGAINST PLAN TEXT:
  // the rsvp and bring TOP-LEVEL lists are deliberately UNCHANGED. Plan 12's
  // task text said to add the field to "the roster, RSVP and brings lists"; the
  // shipped serializers do not put it at the top level of either row. Both
  // shapers copy exactly one field up (`json.user_id = json.User?.id` —
  // routes/rsvp.js:530-532, routes/eventBrings.js:52-56) and pass the nested
  // `User` object through toJSON untouched. Adding picture_url here would force
  // a fixture to invent a key the wire does not carry — which is the precise
  // defect this file exists to catch. The field IS pinned for both payloads,
  // one level down, by `nestedUser`.
  rsvp: ['id', 'event_id', 'user_id', 'status', 'note', 'reminder_sent_at', 'createdAt', 'updatedAt', 'User'],
  bring: ['id', 'event_id', 'user_id', 'game_id', 'createdAt', 'updatedAt', 'User', 'Game'],
  // Nested User include shape shared by friendships/rsvp/brings. Post-PR-C it
  // was ['id','username']; Phase 88.8 plan 08 widened all four includes to the
  // shared chip projection PUBLIC_USER_ATTRS (utils/publicUserAttrs.js:69).
  nestedUser: ['id', 'username', 'picture_url'],
  // DECISION Phase 88.8 plan 12 (R10 / T-88.8-61): this line is DELIBERATELY NOT
  // widened, and that is the whole point of it. GET /friendships/search is a
  // LOOKUP — you supply one email address and get the one person behind it —
  // not a roster. Widening it turns an identity oracle into an enumeration
  // surface. This is the FRONTEND half of a two-repo pin; its backend twin is
  // the exact `toEqual(['id','username'])` at
  // periodictabletopbackend_v2/Sonnet/tests/routes/friendships.test.js:615,
  // plus a picture_url-free assertion in that repo's wire sweep. Rejected:
  // "finishing the job" by adding picture_url here for consistency with the
  // four lists above — that would make both repos agree on the wrong thing and
  // silently retire a security pin. If you are here doing a widening sweep,
  // this line is the one you skip.
  friendSearch: ['id', 'username'],
  // Phase 88.8 plan 12 (D-36 / D-39). NOT an exhaustive emission pin, unlike
  // every list above, and the difference is deliberate: toSelfWire is a bare
  // `user.toJSON()` plus two assignments (routes/users.js:100-105), so the self
  // body carries the WHOLE Users row minus the defaultScope exclusions. Pinning
  // that exactly would mean re-listing ~20 columns here and re-editing this file
  // on every unrelated column add. These are the self-identity fields Phase 88.8
  // makes load-bearing, asserted as a SUBSET below — and asserted ABSENT from
  // every other-user list, which is the half that actually protects PII.
  selfIdentityFields: ['id', 'user_id', 'username', 'email', 'email_changed_at', 'pending_email_change'],
  // Fields that must NEVER appear on an OTHER-user payload. The backend half of
  // this pin is plan 08's wire sweep, which asserts all three absent at any
  // depth on all six widened payloads.
  neverOnOtherUsers: ['email', 'phone', 'email_changed_at', 'pending_email_change'],
} as const;

// events.js formatEventWithCustomParticipants: participant roster — flat
// user_id is the UUID (ep.User?.id) for group members and null for custom
// participants; there is no nested User object on the participant row.
export const CAPTURED_PARTICIPANT_BODY = {
  user_id: U1, // Users.id UUID (post-cutover end-state)
  username: 'alice',
  // Phase 88.8 plan 08: the serializer HAND-COPIES onto a fresh object, so the
  // five widened EventParticipation -> User includes change nothing on the wire
  // without this line. `picture_url: ep.User?.picture_url ?? null`
  // (routes/events.js:25) — the `?? null` means the key is ALWAYS present here.
  picture_url: AVATAR,
};

export const CAPTURED_CUSTOM_PARTICIPANT_BODY = {
  user_id: null, // custom (name-only) participants carry an explicit null
  username: 'drop-in dave',
  // An EXPLICIT null, not an omitted key (routes/events.js:47). A name-only row
  // has no user behind it, so there is no avatar — but an absent key and a null
  // key are DIFFERENT on the wire and this file exists to pin exactly that kind
  // of difference. Removing this line to "simplify the fixture" un-pins it.
  picture_url: null,
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

  it('absent-User-association rows parse: flat user_id key DROPPED (derived via User?.id) is tolerated', () => {
    // The BE computes every flat user_id from the optional nested association
    // (`json.User?.id`) — an orphaned row drops the key entirely. The flat arm
    // mirrors the nested `.optional()` tolerance (plan-10 review #1/#10/#12).
    const { user_id: _u, User: _U, ...rsvpOrphan } = CAPTURED_RSVP_BODY;
    expect(RsvpSchema.safeParse(rsvpOrphan).success).toBe(true);
    const { user_id: _b, User: _BU, ...bringOrphan } = CAPTURED_BRING_BODY;
    expect(EventBringSchema.safeParse(bringOrphan).success).toBe(true);
    const { user_id: _p, ...participantOrphan } = CAPTURED_PARTICIPANT_BODY;
    expect(EventParticipationSchema.safeParse(participantOrphan).success).toBe(true);
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

  it('nested User includes emit [id, username, picture_url] — no sub user_id (PR-C), plus the 88.8 chip field', () => {
    const nested = [...ROUTE_EMITTED_KEYS.nestedUser].sort();
    expect(Object.keys(CAPTURED_FRIENDSHIP_BODY.Requester).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_FRIENDSHIP_BODY.Addressee).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_RSVP_BODY.User).sort()).toEqual(nested);
    expect(Object.keys(CAPTURED_BRING_BODY.User).sort()).toEqual(nested);
  });

  it('friend-search fixture contains only the keys GET /friendships/search emits', () => {
    expect(Object.keys(CAPTURED_FRIEND_SEARCH_BODY).sort()).toEqual([...ROUTE_EMITTED_KEYS.friendSearch].sort());
  });

  it('friend search stayed NARROW: no picture_url, even though every sibling include gained one', () => {
    // The frontend half of the R10 / T-88.8-61 pin. Non-vacuous by construction:
    // the four sibling nested-include fixtures above DO carry picture_url, so
    // this is a real difference between two live shapes, not an assertion about
    // a field nobody emits anywhere.
    expect(ROUTE_EMITTED_KEYS.nestedUser).toContain('picture_url');
    expect(ROUTE_EMITTED_KEYS.friendSearch).not.toContain('picture_url');
    expect(Object.keys(CAPTURED_FRIEND_SEARCH_BODY)).not.toContain('picture_url');
  });

  it('participant rows carry picture_url; the name-only row carries an EXPLICIT null, not an absent key', () => {
    // routes/events.js:25 (`?? null`) and :47 (hand-written null).
    expect(Object.keys(CAPTURED_PARTICIPANT_BODY)).toContain('picture_url');
    expect(Object.keys(CAPTURED_CUSTOM_PARTICIPANT_BODY)).toContain('picture_url');
    expect(CAPTURED_CUSTOM_PARTICIPANT_BODY.picture_url).toBeNull();
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

// ---------------------------------------------------------------------------
// Phase 88.8 plan 12 — the avatar declaration (SPEC R11 as amended by A6/A10,
// CONTEXT D-25) and the two self-read-only email-change fields (D-36 / D-39).
//
// THE RISK THIS BLOCK ADDRESSES, stated plainly so it is not "simplified" away:
// `safeParse` succeeds whether or not a field is declared — Zod's default
// object mode silently DROPS an undeclared key rather than erroring. So
// `expect(r.success).toBe(true)` proves nothing at all about the declaration.
// Only a POST-PARSE presence check distinguishes "declared" from "silently
// stripped". Every positive assertion below therefore reads `r.data.<field>`,
// never just `r.success`.
// ---------------------------------------------------------------------------
describe('identity contract — picture_url survives parsing on every widened payload (88.8 R11)', () => {
  it('roster member: picture_url is DECLARED, not stripped', () => {
    const r = GroupMemberSchema.safeParse(CAPTURED_ROSTER_MEMBER_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.picture_url).toBe(AVATAR);
  });

  it('nested User (rsvp + brings): picture_url is DECLARED, not stripped — string AND null', () => {
    const rsvp = RsvpSchema.safeParse(CAPTURED_RSVP_BODY);
    expect(rsvp.success).toBe(true);
    if (!rsvp.success) return;
    expect(rsvp.data.User?.picture_url).toBe(AVATAR);

    const bring = EventBringSchema.safeParse(CAPTURED_BRING_BODY);
    expect(bring.success).toBe(true);
    if (!bring.success) return;
    // A stored null must SURVIVE as null, not collapse to undefined — that is
    // the difference between "no avatar" and "this schema dropped the key".
    expect(bring.data.User).toHaveProperty('picture_url');
    expect(bring.data.User?.picture_url).toBeNull();
  });

  it('friendship Requester/Addressee: picture_url is DECLARED via the embedded UserSchema', () => {
    // FriendshipSchema embeds UserSchema for its nested user slots rather than
    // declaring its own — confirmed by reading users.ts, not assumed. That is
    // why users.ts needed the declaration and why there is no separate friend
    // schema to edit.
    const r = FriendshipSchema.safeParse(CAPTURED_FRIENDSHIP_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.Requester?.picture_url).toBe(AVATAR);
    expect(r.data.Addressee).toHaveProperty('picture_url');
    expect(r.data.Addressee?.picture_url).toBeNull();
  });

  it('event participant: picture_url is DECLARED, not stripped — member AND name-only row', () => {
    const member = EventParticipationSchema.safeParse(CAPTURED_PARTICIPANT_BODY);
    expect(member.success).toBe(true);
    if (!member.success) return;
    expect(member.data.picture_url).toBe(AVATAR);

    const custom = EventParticipationSchema.safeParse(CAPTURED_CUSTOM_PARTICIPANT_BODY);
    expect(custom.success).toBe(true);
    if (!custom.success) return;
    expect(custom.data).toHaveProperty('picture_url');
    expect(custom.data.picture_url).toBeNull();
  });

  it('all three states parse: value, explicit null, and key absent entirely', () => {
    // `.nullable().optional()` exercised in every state it claims to accept.
    for (const value of [AVATAR, null]) {
      expect(GroupMemberSchema.safeParse({ ...CAPTURED_ROSTER_MEMBER_BODY, picture_url: value }).success).toBe(true);
      expect(EventParticipationSchema.safeParse({ ...CAPTURED_PARTICIPANT_BODY, picture_url: value }).success).toBe(true);
    }
    const { picture_url: _r, ...rosterNoAvatar } = CAPTURED_ROSTER_MEMBER_BODY;
    expect(GroupMemberSchema.safeParse(rosterNoAvatar).success).toBe(true);
    const { picture_url: _p, ...participantNoAvatar } = CAPTURED_PARTICIPANT_BODY;
    expect(EventParticipationSchema.safeParse(participantNoAvatar).success).toBe(true);
    const { picture_url: _n, ...nestedNoAvatar } = CAPTURED_RSVP_BODY.User;
    expect(RsvpSchema.safeParse({ ...CAPTURED_RSVP_BODY, User: nestedNoAvatar }).success).toBe(true);
  });

  it('picture_url is a PLAIN string, NOT z.url() — a malformed stored value must not fail the roster', () => {
    // SPEC A10 / T-88.8-60. Validation lives at the single backend WRITE point
    // (plan 04). If this schema validated the URL shape too, ONE member's bad
    // stored value would ZodError the WHOLE roster parse — and queryClient.ts's
    // shouldRetry classifies a ZodError as never-retry, so that roster would
    // never load. Rejected: z.url() here, which reads stricter and is worse.
    // This test is what makes tightening it to z.url() a RED, not a silent
    // behaviour change discovered in production.
    const malformed = { ...CAPTURED_ROSTER_MEMBER_BODY, picture_url: 'not-a-url' };
    expect(GroupMemberSchema.safeParse(malformed).success).toBe(true);
    const nested = { ...CAPTURED_RSVP_BODY, User: { ...CAPTURED_RSVP_BODY.User, picture_url: 'not-a-url' } };
    expect(RsvpSchema.safeParse(nested).success).toBe(true);
  });
});

describe('identity contract — self-read-only email-change fields (88.8 D-36 / D-39)', () => {
  it('self body: email, email_changed_at and pending_email_change all SURVIVE parsing', () => {
    // Plan 13 reads all three off SelfIdentity (= User & {...}). If any one were
    // undeclared it would be invisible to TypeScript and that section could not
    // compile without an `as` cast.
    const r = UserSchema.safeParse(CAPTURED_SELF_BODY);
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.email).toBe(CAPTURED_SELF_BODY.email);
    expect(r.data.email_changed_at).toBe(CAPTURED_SELF_BODY.email_changed_at);
    expect(r.data.pending_email_change?.address).toBe('alice.new@example.com');
    expect(r.data.pending_email_change?.expires_at).toBe('2026-09-04T13:00:00.000Z');
  });

  it('self body: null and populated variants of both fields parse', () => {
    // The three write echoes serialise pending_email_change: null (D-39), and a
    // user who has never changed their address has email_changed_at: null.
    const nulls = UserSchema.safeParse({
      ...CAPTURED_SELF_BODY,
      email_changed_at: null,
      pending_email_change: null,
    });
    expect(nulls.success).toBe(true);
    if (!nulls.success) return;
    expect(nulls.data).toHaveProperty('email_changed_at');
    expect(nulls.data.email_changed_at).toBeNull();
    expect(nulls.data.pending_email_change).toBeNull();

    // Absent entirely — an older cached payload minted before plan 09 shipped.
    const { email_changed_at: _e, pending_email_change: _p, ...bare } = CAPTURED_SELF_BODY;
    expect(UserSchema.safeParse(bare).success).toBe(true);
  });

  it('pending_email_change carries PLAIN strings inside — a Date-shaped expires_at is not required', () => {
    // A10 again, one level down: expires_at is a Date server-side and arrives
    // as an ISO string. Declaring a date type here would make one odd stored
    // value fail the whole self read, which is the user's own profile page.
    const r = UserSchema.safeParse({
      ...CAPTURED_SELF_BODY,
      pending_email_change: { address: 'x@y.z', expires_at: 'whenever' },
    });
    expect(r.success).toBe(true);
  });

  it('self fixture carries every field the 88.8 self-identity pin names', () => {
    // A SUBSET pin, deliberately — see the note on selfIdentityFields.
    const keys = Object.keys(CAPTURED_SELF_BODY);
    for (const field of ROUTE_EMITTED_KEYS.selfIdentityFields) {
      expect(keys).toContain(field);
    }
  });

  it('NO other-user payload carries email, phone, email_changed_at or pending_email_change', () => {
    // The frontend half of plan 08's wire sweep. Checked recursively: a
    // top-level check would miss exactly the nested User includes where these
    // leak. Non-vacuous — the self fixture above DOES carry three of the four.
    const collectKeys = (v: unknown, acc: string[] = []): string[] => {
      if (Array.isArray(v)) {
        v.forEach((x) => collectKeys(x, acc));
      } else if (v && typeof v === 'object') {
        for (const [k, inner] of Object.entries(v)) {
          acc.push(k);
          collectKeys(inner, acc);
        }
      }
      return acc;
    };
    const otherUserBodies: Record<string, unknown> = {
      friendship: CAPTURED_FRIENDSHIP_BODY,
      friendSearch: CAPTURED_FRIEND_SEARCH_BODY,
      roster: CAPTURED_ROSTER_MEMBER_BODY,
      rsvp: CAPTURED_RSVP_BODY,
      bring: CAPTURED_BRING_BODY,
      participant: CAPTURED_PARTICIPANT_BODY,
      customParticipant: CAPTURED_CUSTOM_PARTICIPANT_BODY,
    };
    for (const [name, body] of Object.entries(otherUserBodies)) {
      const keys = collectKeys(body);
      expect(keys.length).toBeGreaterThan(0); // anti-vacuity: the walk found something
      for (const forbidden of ROUTE_EMITTED_KEYS.neverOnOtherUsers) {
        expect({ name, forbidden, present: keys.includes(forbidden) }).toEqual({
          name,
          forbidden,
          present: false,
        });
      }
    }
    // And the self body DOES carry three of them — proving the check above is
    // discriminating, not just asserting that nothing anywhere has these keys.
    const selfKeys = collectKeys(CAPTURED_SELF_BODY);
    expect(selfKeys).toContain('email');
    expect(selfKeys).toContain('email_changed_at');
    expect(selfKeys).toContain('pending_email_change');
  });
});

describe('identity contract — the phantom avatar field is gone from users.ts (88.8 plan 12)', () => {
  // A SOURCE scan, run through the shared `withoutComments` helper rather than
  // over raw file text. That matters here specifically: the deletion is recorded
  // in a DECISION comment that NAMES the retired field, so a raw grep for
  // `profile_picture_url` in this file returns hits from the very prose
  // explaining its removal — a false failure. The same defect in reverse (prose
  // satisfying a presence gate) is what plan 11 caught in its own suite.
  const USERS_SCHEMA = path.resolve(__dirname, 'users.ts');

  it('users.ts declares picture_url and NOT profile_picture_url (comment-stripped)', () => {
    const code = withoutComments(fs.readFileSync(USERS_SCHEMA, 'utf8'));
    // Anti-vacuity FIRST: if the stripper ever blanked the whole file, or the
    // path drifted, this positive assertion fails before the negative one can
    // pass for the wrong reason.
    expect(code).toContain('picture_url: z.string().nullable().optional()');
    // profile_picture_url is a Group column (models/Group.js:28), never a User
    // column, and no user route ever emitted it. Re-adding it to UserSchema is
    // a regression, not a restoration; every legitimate read of that name in
    // this repo is off a group/Group object.
    expect(code).not.toContain('profile_picture_url');
  });

  it('no schema declares a second address field (SPEC A12)', () => {
    // A12 withdrew the two-address design along with the columns behind it.
    // Comment-stripped so a note explaining the withdrawal cannot fail the gate.
    for (const file of ['users.ts', 'groups.ts', 'events.ts']) {
      const code = withoutComments(fs.readFileSync(path.resolve(__dirname, file), 'utf8'));
      for (const banned of ['notification_email', 'secondary_email', 'contact_email', 'alt_email']) {
        expect({ file, banned, found: code.includes(banned) }).toEqual({ file, banned, found: false });
      }
    }
  });
});
