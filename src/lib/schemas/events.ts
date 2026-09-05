// src/lib/schemas/events.ts
//
// Phase 82 (TS-02 / D-09). Domain source: api.js eventsAPI (L220), rsvpAPI (L296),
// rsvpPublicAPI (L318), eventBringsAPI (L329), ballotAPI (L961).
// Zod v4. Typing only (z.infer) — no runtime .parse() this phase.

import { z } from 'zod';
import { GameSchema } from './shared';

// Nested User include shared by the rsvp/bring list responses (and, on the
// frontend, structurally identical to the friendships Requester/Addressee
// includes — those are typed via UserSchema in users.ts, not by this schema).
// Post-PR-C (87.3 plan 09) the Sequelize include attributes were
// ['id', 'username'] — the sub `user_id` was stripped from every nested User
// include (Req 1). Phase 88.8 plan 08 widened all four of them to the shared
// chip projection PUBLIC_USER_ATTRS = ['id', 'username', 'picture_url']
// (periodictabletopbackend_v2/Sonnet/utils/publicUserAttrs.js:69; call sites
// routes/rsvp.js:523/:565, routes/eventBrings.js:40, routes/friendships.js:36/:41).
//   `id` — the Users.id UUID. Phase 87.3 PR-B (D-04): the permanent is-me
//          compare target (`rsvp.User.id === selfUuid`), tightened to z.uuid().
//          Optional to tolerate an absent User association.
//   `picture_url` — see the canonical decision block immediately below. THIS is
//          the one place the reasoning is written out; the three other
//          declarations of this field (EventParticipationSchema below,
//          groups.ts GroupMemberSchema, users.ts UserSchema) point back here.
/*
 * DECISION Phase 88.8 plan 12 (SPEC R11 as amended by A6 and A10, CONTEXT
 * D-25): `picture_url` is declared as a PLAIN `z.string()` — chosen OVER
 * `z.url()`, which was the obvious option and is the wrong one.
 *
 * WHY NOT A URL VALIDATOR. Validation lives at the single backend WRITE point
 * (Phase 88.8 plan 04: https scheme only, length-capped to the column, which is
 * `DataTypes.STRING` = varchar(255) at models/User.js:137-141). T-88.8-41's own
 * rationale is "one validation point beats two that can disagree". A frontend
 * URL check that ever disagreed with an already-stored value would turn ONE
 * member's avatar into a ZodError on the WHOLE roster parse — and
 * src/lib/queryClient.ts:105,:110 classifies a ZodError as NEVER-RETRY, so that
 * roster would simply never load. One bad row must not cost the whole list.
 *
 * WHY NULLABLE: the backend stores null for password-connection logins (no
 * vendor `picture` claim), and routes/events.js:47 emits an EXPLICIT null for
 * name-only (custom) participants.
 * WHY OPTIONAL: only twelve backend projections were widened; the same schemas
 * still type payloads from surfaces that were deliberately NOT widened.
 *
 * WHY THE DECLARATION EXISTS AT ALL — read this before "tidying" it away.
 * These schemas are TYPING-ONLY today (see the file header, and the identical
 * headers in groups.ts and users.ts). Nothing runtime-parses them, so an
 * undeclared key is NOT stripped at runtime — it simply does not exist to
 * TypeScript. The declaration is what (a) lets a typed consumer read
 * `picture_url` without an `as` cast and (b) lets identity.contract.test.ts —
 * the ONE place these schemas are parsed — pin the wire shape. It becomes
 * load-bearing at RUNTIME only if one of these endpoints is ever migrated to
 * `validatedQueryFn`, whose `schema.parse` drops undeclared keys; adopting it
 * carries the contract-test obligation in the FOUNDATION RULE at
 * src/lib/validatedQueryFn.ts:13-24.
 *
 * Do NOT write "this schema layer strips unknown keys" anywhere near here. It
 * is false today, and it would teach the next reader that a parse guard exists
 * where none does.
 */
export const NestedUserIdentitySchema = z.object({
  id: z.uuid().optional(),
  username: z.string().nullable().optional(),
  picture_url: z.string().nullable().optional(),
});
export type NestedUserIdentity = z.infer<typeof NestedUserIdentitySchema>;

// RSVP status (yes/no/maybe).
export const RsvpStatusSchema = z.enum(['yes', 'no', 'maybe']);
export type RsvpStatus = z.infer<typeof RsvpStatusSchema>;

// EventParticipation row (events.js formatEventWithCustomParticipants).
// `user_id` is the participant's Users.id UUID for group members and an
// explicit null for custom (name-only) participants — never the Auth0 sub
// (87.3 plan 10 tighten; the events participant path was already UUID-native).
// `.nullish()`: the BE derives the member arm via `ep.User?.id`, so an absent
// User association DROPS the key (undefined ≠ null) — the same absent-
// association state the nested includes tolerate with `.optional()`.
// `picture_url` — Phase 88.8 plan 12; the canonical reasoning for this field is
// the DECISION block above NestedUserIdentitySchema. NOTE the contrast with
// `user_id` directly above: on THIS row the key is ALWAYS present. The
// serializer writes `picture_url: ep.User?.picture_url ?? null` for members
// (routes/events.js:25) and a hand-written `picture_url: null` for custom
// participants (:47), so absence never occurs here — `.optional()` is tolerance
// for older cached payloads, NOT a signal that the backend sometimes drops it.
export const EventParticipationSchema = z.object({
  user_id: z.uuid().nullish(),
  username: z.string().nullable().optional(),
  picture_url: z.string().nullable().optional(),
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
  // `.optional()`: the wire value is derived via `json.User?.id`, so an absent
  // User association drops the key — mirror the nested `User.id` tolerance.
  user_id: z.uuid().optional(),
  status: RsvpStatusSchema,
  note: z.string().nullable().optional(),
  // D-04: nested User.id is the UUID compare target (tightened via z.uuid()).
  User: NestedUserIdentitySchema.optional(),
});
export type Rsvp = z.infer<typeof RsvpSchema>;

export const RsvpListSchema = z.array(RsvpSchema);
export type RsvpList = z.infer<typeof RsvpListSchema>;

// rsvpAPI (L668) — GET /rsvp/event/:event_id response wrapper.
// The route ALWAYS returns both keys and always all three counts: it seeds
// `const summary = { yes: 0, maybe: 0, no: 0 }` then increments
// (periodictabletopbackend_v2/Sonnet/routes/rsvp.js:519-524) and returns
// `{ rsvps: shapedRsvps, summary }` (:536) — so nothing here is `.optional()`.
export const RsvpEventResponseSchema = z.object({
  rsvps: RsvpListSchema,
  summary: z.object({
    yes: z.number(),
    maybe: z.number(),
    no: z.number(),
  }),
});
export type RsvpEventResponse = z.infer<typeof RsvpEventResponseSchema>;

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
  // `.optional()`: derived via `json.User?.id` — absent association drops the
  // key; mirror the nested `User.id` tolerance.
  user_id: z.uuid().optional(),
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
