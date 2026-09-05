// src/lib/schemas/users.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js usersAPI (L341),
// friendshipsAPI (L894), magicAuthAPI (L672), googleCalendarAPI (L592).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';

// User record.
//   `id`      — the internal Users.id UUID. Phase 87.3 PR-B (D-04): this NESTED
//               id is the permanent is-me compare target, tightened to z.uuid().
//               Optional because a nested include may omit it when the User
//               association is absent (see prompts.contract.test.ts member edge).
//   `user_id` — post-PR-C (87.3 plan 10, D-07 fast-follow) this carries the SAME
//               Users.id UUID as `id` where emitted (toSelfWire alias on self
//               reads/write echoes) — the Auth0 sub never crosses the wire.
//               OPTIONAL because PR-C stripped it from every NESTED User include
//               (friendships Requester/Addressee, rsvp/brings User) and dropped
//               it from /friendships/search (BE-12) — those surfaces emit
//               [id, username] only.
export const UserSchema = z.object({
  id: z.uuid().optional(),
  user_id: z.uuid().optional(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  // `picture_url` — Phase 88.8 plan 12. The stored avatar URL (models/User.js:137,
  // `DataTypes.STRING` = varchar(255)). Declared here because THIS schema types
  // the friendships nested Requester/Addressee rows too: FriendshipSchema below
  // embeds UserSchema rather than declaring its own nested user, and plan 08
  // widened routes/friendships.js:36/:41 to the shared chip projection.
  // Plain string, nullable, optional — the canonical reasoning (why NOT z.url(),
  // and why the declaration matters when nothing runtime-parses these schemas)
  // is the DECISION block above NestedUserIdentitySchema in events.ts. Read it
  // before changing the shape here.
  //
  // The former `profile_picture_url` field declared at this position was DELETED
  // in the same edit: it is a **Group** column (models/Group.js:28), never a User
  // column, and no user route ever emitted it. Same defect and same remedy as the
  // `phone_number` removal noted below, and the same three-phantom class plan 08
  // cleared out of the backend PII allow-list. Every surviving
  // `profile_picture_url` read in this repo is off a group/Group object; if you
  // are looking for a person's avatar, this is the field.
  picture_url: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  sms_enabled: z.boolean().optional(),
  // Real wire fields (models/User.js): `phone` (E.164, withContactInfo scope
  // only) + `phone_verified`. The former `phone_number` field existed on no
  // route — removed as part of the PRB-H3 wire-truth pass.
  phone: z.string().nullable().optional(),
  phone_verified: z.boolean().optional(),
  // ── SELF-READ-ONLY fields (Phase 88.8 plan 12; D-36, D-39) ─────────────────
  // Both reach the wire ONLY through GET /users/:user_id, which loads the caller
  // through `User.scope('withContactInfo')` (routes/users.js:331) and returns
  // `toSelfWire(user, pendingEmailChange)` (:403) — exactly like `email` above.
  // They are absent from every OTHER-user payload, and plan 08's wire sweep
  // asserts `email_changed_at` absent (recursively) on all six widened payloads.
  // Declaring them here is what lets plan 13's section read all three of its
  // hydration inputs off `SelfIdentity` without an `as` cast: `SelfIdentity` is
  // `User & {...}` (src/lib/hooks/useSelfIdentity.ts:60) and `patchSelfCache`
  // takes `Partial<SelfIdentity>` (src/lib/hooks/selfIdentityCache.ts:32-35).
  // `email` is ALREADY declared above and is deliberately not duplicated.
  //
  // `email_changed_at` — plan 02's Users column (D-36). EXCLUDED by the model
  // defaultScope and restored by withContactInfo (models/User.js:196). Declared
  // as a PLAIN string, not a date type: it crosses as a serialised ISO timestamp
  // and the A10 lesson applies — one unexpected value must not fail the whole
  // parse.
  email_changed_at: z.string().nullable().optional(),
  // `pending_email_change` — plan 09's DERIVED toSelfWire field (D-39), not a
  // column: `{ address: row.target, expires_at: row.expires_at }` or null
  // (routes/users.js:103, projectPendingEmailChange at :986). Plain strings
  // inside for the same A10 reason (`expires_at` is a Date server-side and
  // arrives as an ISO string). Plan 09 assigns the key UNCONDITIONALLY, so it is
  // present on ALL FOUR toSelfWire responses — value `null` on the three write
  // echoes — and a consumer never has to distinguish absent from null.
  // `.optional()` here is belt-and-braces for older cached payloads, NOT a
  // signal that the key is sometimes missing.
  pending_email_change: z
    .object({
      address: z.string(),
      expires_at: z.string(),
    })
    .nullable()
    .optional(),
  // `orphaned_at` also crosses on the self wire (it is not in the defaultScope
  // exclude list) and is DELIBERATELY left undeclared: it is operational state
  // that is never non-null on a row that can log in (models/User.js:193-195), so
  // no frontend consumer has any use for it. Recorded rather than left silent so
  // the next wire-truth sweep does not read the omission as an oversight.
  // ──────────────────────────────────────────────────────────────────────────
  tutorial_version: z.number().optional(),
  notification_preferences: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const UserListSchema = z.array(UserSchema);
export type UserList = z.infer<typeof UserListSchema>;

// friendshipsAPI (L894) — friend relationships + requests.
export const FriendshipStatusSchema = z.enum(['pending', 'accepted', 'blocked']);
export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

export const FriendshipSchema = z.object({
  id: z.string(), // the friendship row's own PK (not a user-identity field)
  // Post-PR-C (D-07 complete): toFriendshipWire emits the flat requester_id /
  // addressee_id as the Users.id UUIDs (equal to the nested Requester.id /
  // Addressee.id) — tightened to z.uuid() by the plan-10 fast-follow.
  requester_id: z.uuid().optional(),
  addressee_id: z.uuid().optional(),
  status: FriendshipStatusSchema.nullable().optional(),
  friend: UserSchema.optional(),
  // D-04: the nested Requester/Addressee User rows carry the UUID `id` (the
  // permanent is-me compare target, tightened via UserSchema.id → z.uuid()).
  Requester: UserSchema.optional(),
  Addressee: UserSchema.optional(),
});
export type Friendship = z.infer<typeof FriendshipSchema>;

export const FriendshipListSchema = z.array(FriendshipSchema);
export type FriendshipList = z.infer<typeof FriendshipListSchema>;

// magicAuthAPI (L672) — passwordless/magic-link auth results.
// NOTE (87.3 plan 10): deliberately NOT tightened — the magic-auth/availability
// family is the phase's named 87.4-deferred exclusion (wire-sweep allowlist);
// the validate response emits no user_id at all today.
export const MagicAuthResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  token: z.string().nullable().optional(),
  user_id: z.string().nullable().optional(),
});
export type MagicAuthResponse = z.infer<typeof MagicAuthResponseSchema>;

// googleCalendarAPI (L592) — Google Calendar connection status + sync.
export const GoogleCalendarStatusSchema = z.object({
  connected: z.boolean().optional(),
  email: z.string().nullable().optional(),
  sync_enabled: z.boolean().optional(),
});
export type GoogleCalendarStatus = z.infer<typeof GoogleCalendarStatusSchema>;
