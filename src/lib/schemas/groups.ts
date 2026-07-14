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

// A member row as returned by GET /groups/:id/users (roster include attributes
// ['id', 'username'] + through attributes ['role', 'joined_at'], then the PR-C
// post-query alias map sets user_id = member.id).
//   `id`        — the member's Users.id UUID. Phase 87.3 PR-B (D-04): this is the
//                 permanent is-me compare target (`member.id === selfUuid`),
//                 tightened to z.uuid(). Optional to tolerate an absent association.
//   `user_id`   — post-PR-C (plan 10, D-07 complete): the SAME Users.id UUID as
//                 `id` (roster alias — field name stable, sub value gone),
//                 tightened to z.uuid().
//   `UserGroup` — role/joined_at ride the join-table include, NESTED — never flat
//                 (consumers read member.UserGroup?.role). Null on game-only rows
//                 (stripMemberPII preserves the explicit null as the signal); no
//                 email on the wire (BSEC-01 removed it from the roster).
export const GroupMemberSchema = z.object({
  id: z.uuid().optional(),
  user_id: z.uuid(),
  username: z.string().nullable().optional(),
  UserGroup: z
    .object({
      role: GroupRoleSchema.nullable().optional(),
      joined_at: z.string().nullable().optional(),
    })
    .nullable()
    .optional(),
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
