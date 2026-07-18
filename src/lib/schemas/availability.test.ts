// Availability schema identity-field contract test (87.4 Plan 10, PR-2 / D-03).
//
// SPEC Req 7 + T-874-10-VALID: after the BE availability emission flip (Plans
// 08/09) is live, the FE identity field on the availability schemas is tightened
// from a loose `z.string()` to `z.uuid()`. This runtime `safeParse` coverage
// pins the tightening:
//
//   POSITIVE — a UUID user_id parses (success === true); an entry with the
//              identity field OMITTED also parses (Plan 08 drops a member entry
//              on a roster-map miss rather than emitting null, so identity fields
//              are valid UUIDs when present and simply absent otherwise).
//   NEGATIVE — a sub-shaped user_id ('auth0|...') FAILS `.uuid()` (ASVS V5), and
//              a null user_id FAILS too (null is not a valid UUID; the schema
//              rejects it rather than tolerating it via `.nullable()`, matching
//              Plan 08's drop-on-map-miss rule — a null identity is a contract
//              violation, never a wire value).
//
// This is PR-2 (after the BE flip is live), never PR-1: tightening before the
// emissions are UUID would hard-fail live parsing (87.3 D-07 sequencing).
import { describe, it, expect } from 'vitest';
import {
  AvailabilitySchema,
  AvailabilityListSchema,
  AvailabilityPatternSchema,
} from './availability';

// Properly-formed UUIDs (valid RFC version+variant nibbles) — z.uuid() enforces
// both, so all-same-digit placeholders would false-fail the positive cases.
const UUID = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const UUID_B = 'a1b2c3d4-1111-42d2-8333-444455556666';
const SUB = 'auth0|abc123';

describe('AvailabilitySchema.user_id — z.uuid() identity tightening (87.4-10 PR-2)', () => {
  it('parses a payload whose user_id is a valid UUID', () => {
    const result = AvailabilitySchema.safeParse({ user_id: UUID, group_id: 'g1' });
    expect(result.success).toBe(true);
  });

  it('parses a payload with the user_id OMITTED (Plan 08 drop-on-map-miss shape)', () => {
    const result = AvailabilitySchema.safeParse({ group_id: 'g1' });
    expect(result.success).toBe(true);
  });

  it('REJECTS a sub-shaped user_id (auth0|...)', () => {
    const result = AvailabilitySchema.safeParse({ user_id: SUB, group_id: 'g1' });
    expect(result.success).toBe(false);
  });

  it('REJECTS a null user_id (no .nullable() on the identity field)', () => {
    const result = AvailabilitySchema.safeParse({ user_id: null, group_id: 'g1' });
    expect(result.success).toBe(false);
  });
});

describe('AvailabilityListSchema — rows validate their user_id as UUID', () => {
  it('parses a list whose rows all carry UUID user_ids', () => {
    const result = AvailabilityListSchema.safeParse([
      { user_id: UUID, group_id: 'g1' },
      { user_id: UUID_B, group_id: 'g1' },
    ]);
    expect(result.success).toBe(true);
  });

  it('REJECTS a list containing a sub-shaped user_id row', () => {
    const result = AvailabilityListSchema.safeParse([
      { user_id: UUID, group_id: 'g1' },
      { user_id: SUB, group_id: 'g1' },
    ]);
    expect(result.success).toBe(false);
  });
});

// 87.4 review PR2-M4 (branch b): the z.uuid() tighten stays OFF the runtime-
// parsed AvailabilityPatternSchema by design — validatedQueryFn hard-throws on
// parse failure, so an identity field there would let one bad id drop the whole
// /userProfile patterns payload (Phase 86-03 never-throw drift rule). These pin
// that a top-level user_id on a pattern row — UUID *or* legacy sub-shaped — is
// STRIPPED, never a throw. If this suite starts failing because user_id was
// added to the schema, re-read the SCOPE comment in availability.ts first.
describe('AvailabilityPatternSchema — top-level user_id is stripped, never validated (PR2-M4)', () => {
  const baseRow = {
    id: 42,
    type: 'recurring_pattern',
    pattern_data: { dayOfWeek: 2, startTime: '18:00', endTime: '21:00' },
  };

  it('parses a pattern row carrying a UUID user_id and STRIPS it (no schema field)', () => {
    const result = AvailabilityPatternSchema.safeParse({ ...baseRow, user_id: UUID });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('user_id');
    }
  });

  it('does NOT throw on a sub-shaped user_id (soft-tolerant: stripped, not validated)', () => {
    const result = AvailabilityPatternSchema.safeParse({ ...baseRow, user_id: SUB });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('user_id');
    }
  });
});
