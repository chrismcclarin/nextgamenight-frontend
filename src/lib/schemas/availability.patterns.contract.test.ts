/**
 * FE↔BE CONTRACT test for GET /api/availability/user/:id/patterns
 * (availabilityAPI.getUserPatterns → AvailabilityPattern[], rendered on
 * /userProfile). This is the FOUNDATION rule every validatedQueryFn migration
 * inherits (validatedQueryFn.ts): a NEW endpoint adopting validatedQueryFn
 * REQUIRES a *.contract.test that
 *   (1) targets the ACTUAL consumed endpoint's schema,
 *   (2) parses a representative BE body through a `.passthrough()` schema,
 *   (3) asserts UI-CONSUMED fields are present + typed AND that removing/renaming
 *       a consumed field FAILS the parse ("parse does not throw" is not enough).
 *
 * UI-consumed fields (userProfile/page.js render):
 *   REQUIRED on every record: `id` (React key + deleteAvailability), `type`
 *   (recurring_pattern|specific_override filter), `pattern_data`.
 *   recurring: pattern_data.{dayOfWeek,startTime,endTime} + start_date/end_date.
 *   specific : pattern_data.{date,startTime,endTime} + is_available.
 *
 * Payload note: NEXTGN has no live-capture harness in this environment, so the
 * fixture below is reconstructed from the consuming render code + the Sequelize
 * UserAvailability shape (id/type/pattern_data + BE-only user_id/created_at/
 * updated_at additive keys). It exercises the SAME drift-detection contract as a
 * captured payload; swap in a verbatim live capture when one is available.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { AvailabilityPatternSchema } from './availability';

// Representative BE body — carries BE-only additive keys (user_id/created_at/
// updated_at) to exercise top-level additive tolerance.
export const CAPTURED_USER_PATTERNS_BODY: unknown[] = [
  {
    id: 'a1b2c3d4-0000-4000-8000-000000000001',
    type: 'recurring_pattern',
    pattern_data: { dayOfWeek: 3, startTime: '18:00', endTime: '22:00', timezone: 'UTC' },
    start_date: '2026-01-01',
    end_date: '2026-12-31',
    // Sequelize serializes the nullable is_available column as `null` (present,
    // not omitted) on recurring rows — the real drift that broke /userProfile.
    is_available: null,
    timezone: 'UTC',
    user_id: 'auth0|abc123',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 42,
    type: 'specific_override',
    pattern_data: { date: '2026-07-04', startTime: '12:00', endTime: '20:00' },
    is_available: false,
    user_id: 'auth0|abc123',
    created_at: '2026-02-01T00:00:00.000Z',
    updated_at: '2026-02-01T00:00:00.000Z',
  },
];

// Passthrough variant pins the consumed fields required while tolerating (and
// preserving) additive BE keys — do NOT mutate the shared export.
const PatternPassthrough = AvailabilityPatternSchema.passthrough();
const PatternListPassthrough = z.array(PatternPassthrough);

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('GET /availability/user/:id/patterns contract', () => {
  it('parses the representative BE payload and pins UI-consumed fields + types', () => {
    const parsed = PatternListPassthrough.parse(CAPTURED_USER_PATTERNS_BODY);
    expect(parsed.length).toBe(2);

    const [recurring, override] = parsed;

    // Always-consumed fields.
    for (const rec of parsed) {
      expect(['string', 'number']).toContain(typeof rec.id);
      expect(typeof rec.type).toBe('string');
      expect(typeof rec.pattern_data).toBe('object');
    }

    // recurring — day + time window + date range.
    expect(recurring.type).toBe('recurring_pattern');
    expect(typeof recurring.pattern_data.dayOfWeek).toBe('number');
    expect(typeof recurring.pattern_data.startTime).toBe('string');
    expect(typeof recurring.start_date).toBe('string');
    // Drift guard (86-03 regression): recurring rows carry is_available === null;
    // the schema MUST accept present-and-null, not only omitted/undefined.
    expect(recurring.is_available).toBeNull();

    // specific override — date + availability flag.
    expect(override.type).toBe('specific_override');
    expect(typeof override.pattern_data.date).toBe('string');
    expect(typeof override.is_available).toBe('boolean');
  });

  it('tolerates + preserves additive BE keys (passthrough)', () => {
    const additive = clone(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    additive[0].newBackendField = 1;
    expect(() => PatternListPassthrough.parse(additive)).not.toThrow();
    const parsed = PatternListPassthrough.parse(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    expect(parsed[0]).toHaveProperty('created_at'); // additive BE key survived
  });

  it('FAILS when a CONSUMED field is REMOVED (drift, not "does not throw")', () => {
    const noType = clone(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    delete noType[0].type;
    expect(() => PatternListPassthrough.parse(noType)).toThrow(z.ZodError);

    const noPatternData = clone(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    delete noPatternData[0].pattern_data;
    expect(() => PatternListPassthrough.parse(noPatternData)).toThrow(z.ZodError);
  });

  it('FAILS when a CONSUMED field is RENAMED (id → availability_id, type → kind)', () => {
    const renamedId = clone(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    renamedId[0].availability_id = renamedId[0].id;
    delete renamedId[0].id;
    expect(() => PatternListPassthrough.parse(renamedId)).toThrow(z.ZodError);

    const renamedType = clone(CAPTURED_USER_PATTERNS_BODY) as Record<string, unknown>[];
    renamedType[0].kind = renamedType[0].type;
    delete renamedType[0].type;
    expect(() => PatternListPassthrough.parse(renamedType)).toThrow(z.ZodError);
  });
});
