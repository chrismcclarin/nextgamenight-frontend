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
  formatWithTzAbbr,
  withYearOutsideCurrent,
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
      // Legacy src/app/gameDetail/page.js raw call output, frozen as a literal.
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

// 88.9-61 (X29 years; owner 2026-11-14 "Yes" for the Next game night card): the ONE year rule
// behind every date heading. It returns a date-fns PATTERN, so each caller keeps its own shape
// (long month on the list's day headers, short month on the hero) and only the year is shared.
describe('withYearOutsideCurrent — the one year rule for date headings', () => {
  it("X29 (88.9): withYearOutsideCurrent adds ', yyyy' only outside the viewer's current year (both directions; New Year's Eve in two zones; bad zone → UTC)", () => {
    const PATTERN = 'EEEE, MMMM d';
    const now = new Date('2026-09-04T18:00:00.000Z');

    // Same year: the pattern comes back untouched.
    expect(withYearOutsideCurrent(PATTERN, new Date('2026-12-01T18:00:00.000Z'), TZ, now)).toBe(PATTERN);
    // Both directions outside it.
    expect(withYearOutsideCurrent(PATTERN, new Date('2025-03-15T23:00:00.000Z'), TZ, now)).toBe('EEEE, MMMM d, yyyy');
    expect(withYearOutsideCurrent(PATTERN, new Date('2027-01-09T00:00:00.000Z'), TZ, now)).toBe('EEEE, MMMM d, yyyy');
    // The pattern is whatever the caller passed (the hero's short month), and it formats as a year.
    const lastYear = new Date('2025-03-15T23:00:00.000Z');
    expect(formatWithTzAbbr(lastYear, TZ, withYearOutsideCurrent('EEEE, MMM d', lastYear, TZ, now))).toBe(
      'Saturday, Mar 15, 2025',
    );

    // New Year's Eve, two zones, one instant: 2027-01-01T03:00Z is still Dec 31, 2026 in New York
    // (same year as a December 2026 now) and already Jan 1, 2027 in London (a different year).
    const eve = new Date('2027-01-01T03:00:00.000Z');
    const december = new Date('2026-12-20T17:00:00.000Z');
    expect(withYearOutsideCurrent(PATTERN, eve, 'America/New_York', december)).toBe(PATTERN);
    expect(withYearOutsideCurrent(PATTERN, eve, 'Europe/London', december)).toBe('EEEE, MMMM d, yyyy');
    // ...and the viewer's NOW is read in the zone too: at that instant a New Yorker is in 2026 and
    // a Londoner in 2027, so a January 2027 night is next year for one and this year for the other.
    const january = new Date('2027-01-09T12:00:00.000Z');
    expect(withYearOutsideCurrent(PATTERN, january, 'America/New_York', eve)).toBe('EEEE, MMMM d, yyyy');
    expect(withYearOutsideCurrent(PATTERN, january, 'Europe/London', eve)).toBe(PATTERN);

    // A malformed zone falls back to UTC rather than throwing, and a null zone is UTC already.
    expect(withYearOutsideCurrent(PATTERN, eve, 'Not/AZone', december)).toBe('EEEE, MMMM d, yyyy');
    expect(withYearOutsideCurrent(PATTERN, eve, null, december)).toBe('EEEE, MMMM d, yyyy');
    expect(withYearOutsideCurrent(PATTERN, new Date('2026-12-31T23:00:00.000Z'), 'Not/AZone', december)).toBe(PATTERN);

    // The default now is the real clock: a night a hundred years out always carries its year.
    expect(withYearOutsideCurrent(PATTERN, new Date('2126-06-01T12:00:00.000Z'), TZ)).toBe('EEEE, MMMM d, yyyy');
  });
});
