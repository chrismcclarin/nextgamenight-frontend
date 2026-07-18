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
import { AvailabilitySchema, AvailabilityListSchema } from './availability';

const UUID = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
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
