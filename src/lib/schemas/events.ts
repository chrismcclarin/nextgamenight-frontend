// src/lib/schemas/events.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js eventsAPI (L220), rsvpAPI (L296),
// rsvpPublicAPI (L318), eventBringsAPI (L329), ballotAPI (L961).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';
import { GameSchema } from './shared';

// Nested User include shared by the rsvp/bring list responses. Post-PR-C
// (87.3 plan 09) the Sequelize include attributes are ['id', 'username'] —
// the sub `user_id` was stripped from every nested User include (Req 1).
//   `id` — the Users.id UUID. Phase 87.3 PR-B (D-04): the permanent is-me
//          compare target (`rsvp.User.id === selfUuid`), tightened to z.uuid().
//          Optional to tolerate an absent User association.
export const NestedUserIdentitySchema = z.object({
  id: z.uuid().optional(),
  username: z.string().nullable().optional(),
});
export type NestedUserIdentity = z.infer<typeof NestedUserIdentitySchema>;

// RSVP status (yes/no/maybe).
export const RsvpStatusSchema = z.enum(['yes', 'no', 'maybe']);
export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;

// EventParticipation row (events.js formatEventWithCustomParticipants).
// `user_id` is the participant's Users.id UUID for group members and an
// explicit null for custom (name-only) participants — never the Auth0 sub
// (87.3 plan 10 tighten; the events participant path was already UUID-native).
export const EventParticipationSchema = z.object({
  user_id: z.uuid().nullable(),
  username: z.string().nullable().optional(),
  status: RsvpStatusSchema.nullable().optional(),
});
export type EventParticipation = z.infer<typeof EventParticipationSchema>;

export const EventSchema = z.object({
  event_id: z.string(),
  group_id: z.string().nullable().optional(),
  game_id: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(), // UTC ISO instant
  end_date: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  game: GameSchema.optional(),
  rsvp_summary: z
    .object({
      yes: z.number().optional(),
      no: z.number().optional(),
      maybe: z.number().optional(),
    })
    .optional(),
});
export type Event = z.infer<typeof EventSchema>;

export const EventListSchema = z.array(EventSchema);
export type EventList = z.infer<typeof EventListSchema>;

// Public invite-preview payload (GET /events/invite-preview/:token).
export const EventInvitePreviewSchema = z.object({
  event_id: z.string().optional(),
  title: z.string().nullable().optional(),
  start_date: z.string().nullable().optional(),
  group_name: z.string().nullable().optional(),
});
export type EventInvitePreview = z.infer<typeof EventInvitePreviewSchema>;

// rsvpAPI (L296) — RSVP records + the summary-bearing event RSVP list.
export const RsvpSchema = z.object({
  // EventRsvp row PK — the wire field the FE keys rows by (RsvpSection).
  id: z.string(),
  event_id: z.string(),
  // Post-PR-C (D-07 complete): the flat user_id carries the nested User.id
  // UUID (rsvp.js wire map) — tightened to z.uuid() by the plan-10 fast-follow.
  user_id: z.uuid(),
  status: RsvpStatusSchema,
  note: z.string().nullable().optional(),
  // D-04: nested User.id is the UUID compare target (tightened via z.uuid()).
  User: NestedUserIdentitySchema.optional(),
});
export type Rsvp = z.infer<typeof RsvpSchema>;

export const RsvpListSchema = z.array(RsvpSchema);
export type RsvpList = z.infer<typeof RsvpListSchema>;

// rsvpPublicAPI (L318) — magic-link respond result.
export const RsvpPublicResponseSchema = z.object({
  success: z.boolean().optional(),
  message: z.string().optional(),
  status: RsvpStatusSchema.optional(),
});
export type RsvpPublicResponse = z.infer<typeof RsvpPublicResponseSchema>;

// eventBringsAPI (L329) — who is bringing which games.
export const EventBringSchema = z.object({
  // EventBring row PK.
  id: z.string(),
  event_id: z.string(),
  // Post-PR-C (D-07 complete): the flat user_id carries the nested User.id
  // UUID (eventBrings.js wire map) — tightened to z.uuid() (plan 10).
  user_id: z.uuid(),
  game_id: z.string(),
  // Sequelize `include: [Game]` with no alias — the wire key is capitalized
  // (BringSummary reads `bring.Game?.name`).
  Game: GameSchema.optional(),
  // D-04: nested User.id is the UUID compare target (tightened via z.uuid()).
  User: NestedUserIdentitySchema.optional(),
});
export type EventBring = z.infer<typeof EventBringSchema>;

export const EventBringListSchema = z.array(EventBringSchema);
export type EventBringList = z.infer<typeof EventBringListSchema>;

// ballotAPI (L961) — game-vote ballots for an event.
export const BallotOptionSchema = z.object({
  game_id: z.string(),
  game: GameSchema.optional(),
  votes: z.number().optional(),
});
export type BallotOption = z.infer<typeof BallotOptionSchema>;

export const BallotSchema = z.object({
  event_id: z.string(),
  options: z.array(BallotOptionSchema).optional(),
  my_vote: z.string().nullable().optional(),
});
export type Ballot = z.infer<typeof BallotSchema>;
