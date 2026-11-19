// X50 (Phase 88.9-65) — the one score display formatter.
//
// Owner, 2026-11-13: "we have decimals after all the numbers and I don't think they need
// decimals. If we remove it and there is a score with decimals, could they add it? If so, I think
// we just remove them." The backend stores a score with two decimals and returns it as text
// (57.00); the session chip printed that text and the edit form seeded it into the Score box.
// formatScore drops the zeros nobody typed and keeps every digit somebody did.
import { describe, expect, it } from 'vitest';

import { formatScore } from './formatScore';

describe('formatScore (88.9-65, X50)', () => {
  it('X50 (88.9-65): formatScore drops trailing zeros: 57.00 -> 57, 57.50 -> 57.5, 57.25 -> 57.25, -3.00 -> -3, 0.00 -> 0, 100 -> 100, 57.5 (number) -> 57.5', () => {
    expect(formatScore('57.00')).toBe('57');
    expect(formatScore('57.50')).toBe('57.5');
    expect(formatScore('57.25')).toBe('57.25');
    expect(formatScore('-3.00')).toBe('-3');
    expect(formatScore('0.00')).toBe('0');
    // An integer keeps its own zeros: only a FRACTION's trailing zeros go.
    expect(formatScore('100')).toBe('100');
    expect(formatScore('100.00')).toBe('100');
    expect(formatScore(57.5)).toBe('57.5');
    expect(formatScore(100)).toBe('100');
    expect(formatScore(0)).toBe('0');
    // A bare trailing point goes with its zeros, and surrounding blanks are not part of a score.
    expect(formatScore('57.')).toBe('57');
    expect(formatScore(' 57.50 ')).toBe('57.5');
    // No binary round trip: a long decimal string is returned digit for digit.
    expect(formatScore('12345678.90')).toBe('12345678.9');
    // A zero is never printed with a sign.
    expect(formatScore('-0.00')).toBe('0');
  });

  it('X50 (88.9-65): null, undefined, blank and NaN return null; a non-decimal string returns trimmed', () => {
    expect(formatScore(null)).toBeNull();
    expect(formatScore(undefined)).toBeNull();
    expect(formatScore('')).toBeNull();
    expect(formatScore('   ')).toBeNull();
    expect(formatScore(Number.NaN)).toBeNull();
    expect(formatScore(Number.POSITIVE_INFINITY)).toBeNull();
    // Anything that is not an optional minus, digits and an optional fraction shows as received.
    expect(formatScore(' won ')).toBe('won');
    expect(formatScore('1e3')).toBe('1e3');
    expect(formatScore('5.5.0')).toBe('5.5.0');
    // Other types are not scores.
    expect(formatScore(true)).toBeNull();
    expect(formatScore({})).toBeNull();
  });
});
