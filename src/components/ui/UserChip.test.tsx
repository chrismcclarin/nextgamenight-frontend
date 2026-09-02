// Pins for initialsOf (Phase 88.5, RESEARCH B-3 / D-10).
//
// WHAT THESE EXIST TO CATCH: the member chip stack (plan 88.5-06) and UserChip's own
// avatar fallback derive their initials from this ONE function. Before Phase 88.5 it was
// module-private, so the chips would have had to fork it — a second definition that can
// drift. Two behaviours are new here and are pinned so they are not "tidied" away:
//
//   1. a SINGLE-token label yields TWO characters ('boardgamer' -> 'BO'), because most
//      usernames in this app are one token and a lone 'B' reads as noise in a chip;
//   2. a null/undefined label returns '?' instead of throwing — the crash path a caller
//      hits for a member with neither a username nor an email to pass in.

import { describe, it, expect } from 'vitest';
import { initialsOf } from './UserChip';

describe('initialsOf — multi-token labels (unchanged behaviour)', () => {
  it('returns the first letter of each of the first two tokens', () => {
    expect(initialsOf('Mary Kay')).toBe('MK');
  });

  it('still uses only the first two tokens of a longer name', () => {
    expect(initialsOf('Mary Kay Jones')).toBe('MK');
  });

  it('uppercases lowercase input', () => {
    expect(initialsOf('mary kay')).toBe('MK');
  });

  it('collapses runs of whitespace rather than counting them as tokens', () => {
    expect(initialsOf('  Mary   Kay  ')).toBe('MK');
  });
});

describe('initialsOf — single-token labels (D-10, NEW in Phase 88.5)', () => {
  it("returns the first TWO characters of a single token ('boardgamer' -> 'BO')", () => {
    // Before Phase 88.5 this returned 'B'. The change is deliberate: single-token
    // usernames are the common case here and one letter reads as noise in a chip.
    expect(initialsOf('boardgamer')).toBe('BO');
  });

  it('uppercases both characters', () => {
    expect(initialsOf('ab')).toBe('AB');
  });

  it("yields ONE character for a one-character token ('b' -> 'B', not 'B?' or padding)", () => {
    expect(initialsOf('b')).toBe('B');
  });
});

describe('initialsOf — missing and empty labels never throw', () => {
  it('returns ? for an empty string', () => {
    expect(initialsOf('')).toBe('?');
  });

  it('returns ? for a whitespace-only string', () => {
    expect(initialsOf('   ')).toBe('?');
  });

  it('returns ? for null without throwing', () => {
    expect(() => initialsOf(null)).not.toThrow();
    expect(initialsOf(null)).toBe('?');
  });

  it('returns ? for undefined without throwing', () => {
    expect(() => initialsOf(undefined)).not.toThrow();
    expect(initialsOf(undefined)).toBe('?');
  });
});
