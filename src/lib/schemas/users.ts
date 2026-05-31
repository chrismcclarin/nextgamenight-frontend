// src/lib/schemas/users.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js usersAPI (L341),
// friendshipsAPI (L894), magicAuthAPI (L672), googleCalendarAPI (L592).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';

// User record. user_id is the Auth0 string identifier (NOT a UUID) per CLAUDE.md.
export const UserSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  profile_picture_url: z.string().nullable().optional(),
  timezone: z.string().nullable().optional(),
  sms_enabled: z.boolean().optional(),
  phone_number: z.string().nullable().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const UserListSchema = z.array(UserSchema);
export type UserList = z.infer<typeof UserListSchema>;

// friendshipsAPI (L894) — friend relationships + requests.
export const FriendshipStatusSchema = z.enum(['pending', 'accepted', 'blocked']);
export type FriendshipStatus = z.infer<typeof FriendshipStatusSchema>;

export const FriendshipSchema = z.object({
  id: z.string(),
  requester_id: z.string().optional(),
  addressee_id: z.string().optional(),
  status: FriendshipStatusSchema.nullable().optional(),
  friend: UserSchema.optional(),
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
