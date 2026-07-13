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
//   `user_id` — the Auth0 string sub (NOT a UUID). Stays a bare z.string() through
//               the rollout window; its .uuid() tighten is the plan-10 fast-follow
//               AFTER PR-C removes the sub from the flat wire field (D-07).
export const UserSchema = z.object({
  id: z.uuid().optional(),
  user_id: z.string(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  profile_picture_url: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  sms_enabled: z.boolean().optional(),
  // Real wire fields (models/User.js): `phone` (E.164, withContactInfo scope
  // only) + `phone_verified`. The former `phone_number` field existed on no
  // route — removed as part of the PRB-H3 wire-truth pass.
  phone: z.string().nullable().optional(),
  phone_verified: z.boolean().optional(),
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
  // D-07: flat requester_id / addressee_id still carry the Auth0 sub via the
  // BE toFriendshipWire shim until PR-C — leave them bare z.string() this PR.
  requester_id: z.string().optional(),
  addressee_id: z.string().optional(),
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
