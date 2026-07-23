/**
 * FE↔BE CONTRACT test for a REAL consumed endpoint (T-84-06) — NOT a generic
 * schema-parse smoke test. This is the FOUNDATION rule every later-wave
 * validatedQueryFn migration inherits (documented at the top of validatedQueryFn.ts):
 *
 *   Adopting validatedQueryFn on a NEW endpoint REQUIRES a *.contract.test.ts that
 *     (1) targets that ACTUAL consumed endpoint's schema (not a generic shape),
 *     (2) parses a CAPTURED real BE response through a `.passthrough()` schema,
 *     (3) asserts the UI-CONSUMED fields are present + correctly typed AND that
 *         removing/renaming a consumed field FAILS the parse.
 *   "parse does not throw" alone is NOT sufficient.
 *
 * Schema under contract: GameSchema (Game rows) — consumed today by the
 *   search-all `local` results (GameComboInput) and the lists/games group game
 *   cards. UI-consumed fields: id + name (React keys / card titles, REQUIRED),
 *   plus image_url / min_players / max_players / playing_time (rendered when present).
 *
 * History (87.5 review SW-02): this test's original subject endpoint,
 *   GET /api/games (gamesAPI.getGames), was DELETED as a dead route — zero product
 *   callers; the "rendered as game cards" claim had gone stale as consumers moved
 *   to search-all / for-event / lists-games. The captured payload below remains a
 *   valid real-BE Game[] shape (the rows other endpoints still serve), so the
 *   contract assertions keep guarding GameSchema drift unchanged.
 *
 * Payload: src/lib/__fixtures__/games.captured.json — captured VERBATIM from a live
 *   GET https://api.nextgamenight.app/api/games (first 3 records, unedited, pre-
 *   deletion). It carries BE keys absent from GameSchema (weight, is_custom, theme,
 *   url, createdAt, updatedAt) — exercising the `.passthrough()` additive-tolerance case.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { GameSchema } from '@/lib/schemas/shared';
import capturedGames from '@/lib/__fixtures__/games.captured.json';

// Pin the consumed endpoint's schema as a `.passthrough()` variant: unknown BE
// keys are tolerated, but the consumed fields stay required. Do NOT mutate the
// shared.ts export — build the passthrough variant here.
const GameSchemaPassthrough = GameSchema.passthrough();
const GameListSchemaPassthrough = z.array(GameSchemaPassthrough);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('GameSchema contract (real captured Game[] payload; original GET /games endpoint deleted in 87.5 SW-02)', () => {
  it('parses the captured real BE payload and pins UI-consumed fields + types', () => {
    const parsed = GameListSchemaPassthrough.parse(capturedGames);
    expect(parsed.length).toBeGreaterThan(0);

    const game = parsed[0];
    // REQUIRED consumed fields — React key + card title.
    expect(typeof game.id).toBe('string');
    expect(typeof game.name).toBe('string');

    // Numeric fields, asserted as numbers WHERE PRESENT in the captured payload.
    for (const field of ['min_players', 'max_players', 'playing_time'] as const) {
      if (game[field] != null) expect(typeof game[field]).toBe('number');
    }
    // image_url is a rendered field; when present it must be a string.
    if (game.image_url != null) expect(typeof game.image_url).toBe('string');
  });

  it('tolerates additive BE keys (passthrough): an unknown new field still parses', () => {
    const additive = clone(capturedGames) as Record<string, unknown>[];
    additive[0].newBackendField = 1;
    expect(() => GameListSchemaPassthrough.parse(additive)).not.toThrow();
    // The captured payload already proves passthrough: it carries BE-only keys
    // (weight/is_custom/theme/url/createdAt/updatedAt) not declared in GameSchema.
    const parsed = GameListSchemaPassthrough.parse(capturedGames) as Record<string, unknown>[];
    expect(parsed[0]).toHaveProperty('createdAt');
  });

  it('FAILS when a CONSUMED field is REMOVED (drift detection, not "does not throw")', () => {
    const dropped = clone(capturedGames) as Record<string, unknown>[];
    delete dropped[0].name;
    expect(() => GameListSchemaPassthrough.parse(dropped)).toThrow(z.ZodError);
  });

  it('FAILS when a CONSUMED field is RENAMED (id → gameId, name → title)', () => {
    const renamedName = clone(capturedGames) as Record<string, unknown>[];
    renamedName[0].title = renamedName[0].name;
    delete renamedName[0].name;
    expect(() => GameListSchemaPassthrough.parse(renamedName)).toThrow(z.ZodError);

    const renamedId = clone(capturedGames) as Record<string, unknown>[];
    renamedId[0].gameId = renamedId[0].id;
    delete renamedId[0].id;
    expect(() => GameListSchemaPassthrough.parse(renamedId)).toThrow(z.ZodError);
  });

  it('FAILS when a CONSUMED field has the WRONG type (name → number)', () => {
    const wrongType = clone(capturedGames) as Record<string, unknown>[];
    wrongType[0].name = 12345;
    expect(() => GameListSchemaPassthrough.parse(wrongType)).toThrow(z.ZodError);
  });
});
