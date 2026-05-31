// Regression pins for tzUtils.ts (F-810 TZ-math safety net).
// Encodes the self-documented round-trip / DST / UTC-fallback scenarios so the
// Phase 84 PRIM-05 convergence can refactor against a green net.
// globals: true — describe/it/expect are ambient (no import needed).
import { wallClockToUtc, utcToWallClock, formatWithTzAbbr } from './tzUtils';

describe('tzUtils — wallClockToUtc (wall-clock → UTC)', () => {
  it('applies MDT (DST, UTC-6) for a June Denver wall-clock', () => {
    expect(wallClockToUtc('2026-06-15T19:30', 'America/Denver')?.toISOString()).toBe(
      '2026-06-16T01:30:00.000Z'
    );
  });

  it('applies MST (no DST, UTC-7) for a January Denver wall-clock', () => {
    expect(wallClockToUtc('2026-01-15T19:30', 'America/Denver')?.toISOString()).toBe(
      '2026-01-16T02:30:00.000Z'
    );
  });

  it('applies post-spring-forward MDT for a March 9 wall-clock', () => {
    expect(wallClockToUtc('2026-03-09T07:00', 'America/Denver')?.toISOString()).toBe(
      '2026-03-09T13:00:00.000Z'
    );
  });

  it('falls back to UTC (never browser TZ) on null/empty timeZone', () => {
    expect(wallClockToUtc('2026-06-15T19:30', null)?.toISOString()).toBe(
      '2026-06-15T19:30:00.000Z'
    );
    expect(wallClockToUtc('2026-06-15T19:30', '')?.toISOString()).toBe(
      '2026-06-15T19:30:00.000Z'
    );
  });

  it('returns null for null/empty wall-clock input', () => {
    expect(wallClockToUtc(null, 'America/Denver')).toBeNull();
    expect(wallClockToUtc('', 'America/Denver')).toBeNull();
  });
});

describe('tzUtils — utcToWallClock (UTC → wall-clock parts)', () => {
  it('decomposes a UTC instant into Denver wall-clock parts (month is 1-12)', () => {
    expect(utcToWallClock('2026-06-15T01:30:00Z', 'America/Denver')).toEqual({
      year: 2026,
      month: 6,
      day: 14,
      hours: 19,
      minutes: 30,
    });
  });

  it('renders the same UTC instant one hour earlier in Los Angeles (cross-TZ)', () => {
    expect(utcToWallClock('2026-06-15T01:30:00Z', 'America/Los_Angeles')).toEqual({
      year: 2026,
      month: 6,
      day: 14,
      hours: 18,
      minutes: 30,
    });
  });

  it('is bit-stable across an unchanged-wall-clock round trip', () => {
    const wc = utcToWallClock('2026-06-15T01:30:00Z', 'America/Denver')!;
    const local =
      `${wc.year}-${String(wc.month).padStart(2, '0')}-` +
      `${String(wc.day).padStart(2, '0')}T` +
      `${String(wc.hours).padStart(2, '0')}:${String(wc.minutes).padStart(2, '0')}`;
    expect(local).toBe('2026-06-14T19:30');
    expect(wallClockToUtc(local, 'America/Denver')?.toISOString()).toBe(
      '2026-06-15T01:30:00.000Z'
    );
  });

  it('returns null for null/undefined input', () => {
    expect(utcToWallClock(null, 'America/Denver')).toBeNull();
    expect(utcToWallClock(undefined, 'America/Denver')).toBeNull();
  });
});

describe('tzUtils — formatWithTzAbbr (DST-boundary abbreviations)', () => {
  it('shows MST before the spring-forward jump', () => {
    expect(formatWithTzAbbr('2026-03-08T08:00:00Z', 'America/Denver')).toBe('1:00 AM MST');
  });

  it('shows MDT after the spring-forward jump', () => {
    expect(formatWithTzAbbr('2026-03-08T14:00:00Z', 'America/Denver')).toBe('8:00 AM MDT');
  });

  it('falls back to UTC on null timeZone', () => {
    expect(formatWithTzAbbr('2026-06-15T01:30:00Z', null)).toBe('1:30 AM UTC');
  });

  it('returns empty string for null/invalid input', () => {
    expect(formatWithTzAbbr(null, 'America/Denver')).toBe('');
    expect(formatWithTzAbbr('not-a-date', 'America/Denver')).toBe('');
  });
});
