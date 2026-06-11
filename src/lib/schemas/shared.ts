// src/lib/schemas/shared.ts
//
// Phase 82 (TS-02 / D-09): cross-domain primitives + the API error-envelope shape.
// Zod v4 (4.3.6 already installed). Schemas are for TYPING (z.infer) this phase;
// runtime .parse() validation is not required (only the inferred types are consumed).
//
// Folds the non-domain groupings per 82-PATTERNS.md: gamesAPI, userGamesAPI,
// listsAPI, gameReviewsAPI, feedbackAPI.

import { z } from 'zod';

// -----------------------------------------------------------------------------
// API error envelope (D-07 seam). MUST carry BOTH the current `error`/`errors[]`
// shape AND the future `code`/`message`/`details` fields so the Phase 85 BAPI-01
// envelope swap is non-breaking. VERBATIM from 82-RESEARCH.md Pattern 3.
// -----------------------------------------------------------------------------
export const ApiErrorBodySchema = z.object({
  code: z.string().optional(), // present once BAPI-01 ships
  message: z.string().optional(),
  error: z.string().optional(), // current backend shape
  details: z.unknown().optional(),
  errors: z
    .array(
      z.object({
        field: z.string().optional(),
        message: z.string().optional(),
        msg: z.string().optional(),
      })
    )
    .optional(),
});
export type ApiErrorBody = z.infer<typeof ApiErrorBodySchema>;

// -----------------------------------------------------------------------------
// Common primitives reused across domains.
// -----------------------------------------------------------------------------
export const MessageResponseSchema = z.object({
  message: z.string().optional(),
  success: z.boolean().optional(),
});
export type MessageResponse = z.infer<typeof MessageResponseSchema>;

export const InviteTokenSchema = z.object({
  token: z.string(),
  expires_at: z.string().nullable().optional(),
});
export type InviteToken = z.infer<typeof InviteTokenSchema>;

// -----------------------------------------------------------------------------
// Games (gamesAPI L428) — BGG-sourced game records.
// -----------------------------------------------------------------------------
export const GameSchema = z.object({
  id: z.string(),
  bgg_id: z.number().nullable().optional(),
  name: z.string(),
  description: z.string().nullable().optional(),
  image_url: z.string().nullable().optional(),
  thumbnail_url: z.string().nullable().optional(),
  min_players: z.number().nullable().optional(),
  max_players: z.number().nullable().optional(),
  playing_time: z.number().nullable().optional(),
  year_published: z.number().nullable().optional(),
});
export type Game = z.infer<typeof GameSchema>;
export const GameListSchema = z.array(GameSchema);
export type GameList = z.infer<typeof GameListSchema>;

// -----------------------------------------------------------------------------
// User games (userGamesAPI L479) — a user's owned/wishlist game records.
// -----------------------------------------------------------------------------
export const UserGameSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  game_id: z.string(),
  status: z.string().nullable().optional(), // owned / wishlist / etc.
  game: GameSchema.optional(),
});
export type UserGame = z.infer<typeof UserGameSchema>;
export const UserGameListSchema = z.array(UserGameSchema);
export type UserGameList = z.infer<typeof UserGameListSchema>;

// -----------------------------------------------------------------------------
// Lists (listsAPI L507) — user-curated game lists.
// -----------------------------------------------------------------------------
export const ListSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  name: z.string(),
  description: z.string().nullable().optional(),
  game_ids: z.array(z.string()).optional(),
});
export type GameList_ = z.infer<typeof ListSchema>;
export const ListsSchema = z.array(ListSchema);
export type Lists = z.infer<typeof ListsSchema>;

// -----------------------------------------------------------------------------
// Game reviews (gameReviewsAPI L536).
// -----------------------------------------------------------------------------
export const GameReviewSchema = z.object({
  id: z.string(),
  user_id: z.string(),
  game_id: z.string(),
  rating: z.number().nullable().optional(),
  review: z.string().nullable().optional(),
  created_at: z.string().optional(),
});
export type GameReview = z.infer<typeof GameReviewSchema>;
export const GameReviewListSchema = z.array(GameReviewSchema);
export type GameReviewList = z.infer<typeof GameReviewListSchema>;

// -----------------------------------------------------------------------------
// Feedback (feedbackAPI L573) — public feedback submissions.
// -----------------------------------------------------------------------------
export const FeedbackResponseSchema = z.object({
  id: z.string().optional(),
  message: z.string().optional(),
  success: z.boolean().optional(),
});
export type FeedbackResponse = z.infer<typeof FeedbackResponseSchema>;
