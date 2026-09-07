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
  // Phase 88.3.1 (CONTEXT D-01): the group's colour, as the wire carries it.
  // TWO fields, both optional and both nullable, because all four combinations
  // are legitimate: preset only (post-cutover), hex only (legacy / custom),
  // both (the expand window and the e2e fixture), neither ("no colour", D-06).
  //   color_preset     — one of the eight preset ids; the frontend resolves it
  //                      to a ground. Preset WINS over the hex for rendering.
  //   background_color — a legacy or custom #rrggbb. Still a supported path,
  //                      not deprecated. Note '#ffffff' means UNSET here for
  //                      historical reasons (models/Group.js's defaultValue) —
  //                      see isUnsetBackgroundColor in src/lib/colorUtils.js.
  // Declared here because the group-colour accessor makes both load-bearing on
  // six render surfaces; an undeclared field is a real gap, not untidiness.
  color_preset: z.string().nullable().optional(),
  background_color: z.string().nullable().optional(),
  created_at: z.string().optional(),
});
export type Group = z.infer<typeof GroupSchema>;

export const GroupListSchema = z.array(GroupSchema);
export type GroupList = z.infer<typeof GroupListSchema>;

// A member row as returned by GET /groups/:id/users, and — the same shape — the
// nested `group.Users[]` rows on GET /groups/user/:user_id. Roster include
// attributes were ['id', 'username']; Phase 88.8 plan 08 widened BOTH includes
// to the shared chip projection PUBLIC_USER_ATTRS =
// ['id', 'username', 'picture_url'] (routes/groups.js:240 and :414), plus
// through attributes ['role', 'joined_at'], then the PR-C post-query alias map
// sets user_id = member.id.
//   `id`        — the member's Users.id UUID. Phase 87.3 PR-B (D-04): this is the
//                 permanent is-me compare target (`member.id === selfUuid`),
//                 tightened to z.uuid(). Optional to tolerate an absent association.
//   `user_id`   — post-PR-C (plan 10, D-07 complete): the SAME Users.id UUID as
//                 `id` (roster alias — field name stable, sub value gone),
//                 tightened to z.uuid().
//   `picture_url` — Phase 88.8 plan 12. Plain string, nullable, optional; the
//                 canonical reasoning (why NOT z.url(), and why declaring it
//                 matters when nothing runtime-parses these schemas) is the
//                 DECISION block above NestedUserIdentitySchema in events.ts.
//                 Read that before changing the shape here. It reaches BOTH
//                 roster branches: the member branch raw, the game-only branch
//                 through stripMemberPII, whose fail-closed allow-list plan 08
//                 corrected in the same commit.
//   `UserGroup` — role/joined_at ride the join-table include, NESTED — never flat
//                 (consumers read member.UserGroup?.role). Null on game-only rows
//                 (stripMemberPII preserves the explicit null as the signal); no
//                 email on the wire (BSEC-01 removed it from the roster).
export const GroupMemberSchema = z.object({
  id: z.uuid().optional(),
  user_id: z.uuid(),
  username: z.string().nullable().optional(),
  picture_url: z.string().nullable().optional(),
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
