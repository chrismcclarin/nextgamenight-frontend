// src/lib/schemas/groups.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js groupsAPI (L110) + invitesAPI (L855).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';

// Membership role within a group (UserGroup.role: owner/admin/member; plus pending).
export const GroupRoleSchema = z.enum(['owner', 'admin', 'member', 'pending']);
export type GroupRole = z.infer<typeof GroupRoleSchema>;

export const GroupSchema = z.object({
  group_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  profile_picture_url: z.string().nullable().optional(),
  background_url: z.string().nullable().optional(),
  created_at: z.string().optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupListSchema = z.array(GroupSchema);
export type GroupList = z.infer<typeof GroupListSchema>;

// A member row as returned by GET /groups/:id/users.
export const GroupMemberSchema = z.object({
  user_id: z.string(),
  username: z.string().nullable().optional(),
  email: z.string().nullable().optional(),
  role: GroupRoleSchema.nullable().optional(),
  profile_picture_url: z.string().nullable().optional(),
});
export type GroupMember = z.infer<typeof GroupMemberSchema>;

export const GroupMemberListSchema = z.array(GroupMemberSchema);
export type GroupMemberList = z.infer<typeof GroupMemberListSchema>;

// Public invite-preview payload (GET /groups/invite-preview/:token).
export const GroupInvitePreviewSchema = z.object({
  group_id: z.string().optional(),
  name: z.string().optional(),
  member_count: z.number().optional(),
  profile_picture_url: z.string().nullable().optional(),
});
export type GroupInvitePreview = z.infer<typeof GroupInvitePreviewSchema>;

// invitesAPI (L855) — pending invites surfaced to a user.
export const InviteSchema = z.object({
  id: z.string(),
  group_id: z.string().optional(),
  group_name: z.string().optional(),
  invited_by: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  created_at: z.string().optional(),
});
export type Invite = z.infer<typeof InviteSchema>;

export const InviteListSchema = z.array(InviteSchema);
export type InviteList = z.infer<typeof InviteListSchema>;
