// Golden-string output pins for the consolidated datetime.ts module
// (Phase 84 PRIM-05, GAP11). These assert that the ported `dateUtils`
// formatters and the new `formatLongDate` header formatter produce output
// BYTE-FOR-BYTE identical to the legacy implementation for a fixed Date + IANA
// timezone — so "rendered date/time output unchanged" is gated by test, not by
// build/grep. The TZ-math units (utcToWallClock/wallClockToUtc/formatWithTzAbbr)
// are pinned separately in tzUtils.test.ts and stay green by construction
// (their bodies were moved into datetime.ts verbatim).
//
// globals: true — describe/it/expect/vi are ambient (no import needed).
import {
  formatDate,
  formatTime,
  formatDateTime,
  formatLongDate,
  toLocalDateString,
  formatDuration,
} from './datetime';

const TZ = 'America/New_York';

// A same-year instant: 2026-06-15T01:30:00Z = 2026-06-14 21:30 EDT.
const SAME_YEAR = new Date('2026-06-15T01:30:00Z');
// A different-year instant: 2020-03-10T01:30:00Z = 2020-03-09 21:30 EDT.
const DIFF_YEAR = new Date('2020-03-10T01:30:00Z');

describe('datetime — golden-string output pins (legacy dateUtils parity)', () => {
  beforeAll(() => {
    // Freeze "now" so the current-year branch in formatDate/formatDateTime is
    // deterministic (currentYear === 2026) regardless of when the suite runs.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  describe('formatDate', () => {
    it('omits the year for a current-year date (with tz abbreviation)', () => {
      expect(formatDate(SAME_YEAR, TZ)).toBe('Jun 14, EDT');
    });

    it('includes the year for a different-year date', () => {
      expect(formatDate(DIFF_YEAR, TZ)).toBe('Mar 9, 2020, EDT');
    });

    it("returns 'Never' for null input", () => {
      expect(formatDate(null)).toBe('Never');
    });
  });

  describe('formatTime', () => {
    it('formats an ISO instant in 12-hour form with tz abbreviation', () => {
      expect(formatTime(SAME_YEAR, TZ)).toBe('9:30 PM EDT');
    });

    it('converts a 24h "HH:MM" string to 12-hour form (no tz)', () => {
      expect(formatTime('14:30')).toBe('2:30 PM');
    });

    it('appends the tz abbreviation to a "HH:MM" string when given a tz', () => {
      expect(formatTime('14:30', TZ)).toBe('2:30 PM EDT');
    });

    it('returns empty string for null input', () => {
      expect(formatTime(null)).toBe('');
    });
  });

  describe('formatDateTime', () => {
    it('omits the year for a current-year date', () => {
      expect(formatDateTime(SAME_YEAR, TZ)).toBe('Jun 14, 9:30 PM EDT');
    });

    it('includes the year for a different-year date', () => {
      expect(formatDateTime(DIFF_YEAR, TZ)).toBe('Mar 9, 2020, 9:30 PM EDT');
    });

    it('returns empty string for null input', () => {
      expect(formatDateTime(null)).toBe('');
    });
  });

  describe('formatLongDate (header formatter — EventDayModal / gameDetail pins)', () => {
    it('reproduces the bespoke tz-aware gameDetail header byte-for-byte', () => {
      // Legacy gameDetail/page.js:947 raw call output, frozen as a literal.
      expect(formatLongDate(DIFF_YEAR, TZ)).toBe('Monday, March 9, 2020');
    });

    it('matches the bespoke no-tz EventDayModal header call exactly', () => {
      // EventDayModal:53 used no timeZone, so the output renders in the local
      // runtime TZ. Assert formatLongDate reproduces that exact raw call so the
      // Task 2 swap is provably output-preserving regardless of runner TZ.
      const raw = DIFF_YEAR.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
      expect(formatLongDate(DIFF_YEAR)).toBe(raw);
    });

    it('returns empty string for null/invalid input', () => {
      expect(formatLongDate(null)).toBe('');
      expect(formatLongDate('not-a-date')).toBe('');
    });
  });

  describe('toLocalDateString (HEAT-02 local-calendar semantics)', () => {
    it('formats local calendar components as YYYY-MM-DD (no UTC conversion)', () => {
      // Constructed from local components so the assertion is TZ-independent —
      // this is the high-risk port: UTC conversion here would regress HEAT-02.
      const local = new Date(2026, 5, 15); // June 15 2026, local midnight
      expect(toLocalDateString(local)).toBe('2026-06-15');
    });

    it('zero-pads single-digit month and day', () => {
      const local = new Date(2026, 0, 5); // Jan 5 2026
      expect(toLocalDateString(local)).toBe('2026-01-05');
    });
  });

  describe('formatDuration', () => {
    it('renders sub-hour durations in minutes', () => {
      expect(formatDuration(45)).toBe('45 min');
    });

    it('renders a single whole hour as "1 hour"', () => {
      expect(formatDuration(60)).toBe('1 hour');
    });

    it('renders fractional hours with one decimal', () => {
      expect(formatDuration(90)).toBe('1.5 hrs');
    });

    it('renders multiple whole hours as "N hrs"', () => {
      expect(formatDuration(120)).toBe('2 hrs');
    });

    it('returns empty string for 0/null input', () => {
      expect(formatDuration(0)).toBe('');
      expect(formatDuration(null)).toBe('');
    });
  });
});
