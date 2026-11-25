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
  parseDateOnly,
  dateOnlyDayStart,
  dateOnlyDayEnd,
  formatTzLegend,
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

// 88.9-52 round 4 (R4-A2): a date-only value ('2026-11-27', a DATEONLY column or an override's
// pattern_data.date) names a calendar day, not an instant. new Date('2026-11-27') reads it as UTC
// midnight, so west of UTC the old formatDate printed the day before (the capture saw Nov 26 on
// Profile in Pacific). Each test sets the process zone itself, so it is red on the old code on any
// host (CI runs in UTC, where the old code happened to be right).
describe('date-only values keep their own calendar day in every zone (R4-A2)', () => {
  const HOST_TZ = process.env.TZ;
  const inZone = (zone: string, run: () => void) => {
    process.env.TZ = zone;
    try {
      run();
    } finally {
      if (HOST_TZ === undefined) delete process.env.TZ;
      else process.env.TZ = HOST_TZ;
    }
  };

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-06-15T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('formatDate shows a date-only string as its own day west of UTC, east of UTC and in UTC', () => {
    for (const zone of ['America/Los_Angeles', 'Pacific/Kiritimati', 'UTC']) {
      inZone(zone, () => {
        expect(formatDate('2026-11-27'), zone).toBe('Nov 27');
        expect(formatDate('2026-01-01'), zone).toBe('Jan 1');
        expect(formatDate('2026-12-31'), zone).toBe('Dec 31');
        // The year rule reads the day's own year: 1 Jan of another year never borrows this one.
        expect(formatDate('2027-01-01'), zone).toBe('Jan 1, 2027');
        expect(formatDate('2025-12-31'), zone).toBe('Dec 31, 2025');
      });
    }
  });

  it('formatDate ignores the viewer zone for a date-only string: no shift and no zone letters', () => {
    inZone('America/Los_Angeles', () => {
      expect(formatDate('2026-11-27', 'America/New_York')).toBe('Nov 27');
      expect(formatDate('2026-11-27', 'Pacific/Kiritimati')).toBe('Nov 27');
    });
  });

  it('formatDate still reads an instant in the zone it is given (unchanged)', () => {
    inZone('America/Los_Angeles', () => {
      expect(formatDate(SAME_YEAR, TZ)).toBe('Jun 14, EDT');
      expect(formatDate('2026-11-27T02:00:00Z', TZ)).toBe('Nov 26, EST');
    });
  });

  it('parseDateOnly gives local midnight of that day, and null for anything that is not a real YYYY-MM-DD', () => {
    inZone('America/Los_Angeles', () => {
      const day = parseDateOnly('2026-11-27');
      expect(day && [day.getFullYear(), day.getMonth(), day.getDate(), day.getHours()]).toEqual([2026, 10, 27, 0]);
    });
    for (const bad of ['2026-02-31', '2026-13-01', '2026-11-27T00:00:00Z', '26-11-27', '', null, undefined, 20261127]) {
      expect(parseDateOnly(bad), String(bad)).toBeNull();
    }
  });

  it('dateOnlyDayStart / dateOnlyDayEnd bound the day in the viewer zone, or in the local zone when none is given', () => {
    inZone('America/Los_Angeles', () => {
      expect(dateOnlyDayStart('2026-11-27', 'America/New_York')?.toISOString()).toBe('2026-11-27T05:00:00.000Z');
      expect(dateOnlyDayEnd('2026-11-27', 'America/New_York')?.toISOString()).toBe('2026-11-28T04:59:59.999Z');
      expect(dateOnlyDayStart('2026-11-27', null)?.toISOString()).toBe('2026-11-27T08:00:00.000Z');
      expect(dateOnlyDayEnd('2026-11-27', null)?.toISOString()).toBe('2026-11-28T07:59:59.999Z');
      expect(dateOnlyDayStart('not a date', 'UTC')).toBeNull();
      expect(dateOnlyDayEnd('', 'UTC')).toBeNull();
    });
  });
});

// Phase 89.6-40 W1 (owner ruling 2026-11-22 10:53 PM Pacific, 'W1) yes'): both calendar legends
// name the zone without a season, from the browser's formatter (timeZoneName longGeneric); an
// engine without the option keeps today's abbreviation label.
describe('formatTzLegend', () => {
  const MARCH = new Date('2031-03-15T12:00:00Z');
  const JANUARY = new Date('2031-01-15T12:00:00Z');

  it('names the zone without a season: Pacific Time in March and in January, Eastern Time for New York', () => {
    expect(formatTzLegend(MARCH, 'America/Los_Angeles')).toBe('Pacific Time');
    expect(formatTzLegend(JANUARY, 'America/Los_Angeles')).toBe('Pacific Time');
    expect(formatTzLegend(MARCH, 'America/New_York')).toBe('Eastern Time');
  });

  it('keeps the abbreviation label when the engine has no longGeneric zone name', () => {
    const original = Intl.DateTimeFormat;
    // A constructor (never an arrow: it is called with new) that refuses only the longGeneric option.
    const Stub = function (this: unknown, locales?: string | string[], options?: Intl.DateTimeFormatOptions) {
      if (options?.timeZoneName === ('longGeneric' as Intl.DateTimeFormatOptions['timeZoneName'])) {
        throw new RangeError('Value longGeneric out of range for Intl.DateTimeFormat options property timeZoneName');
      }
      return new original(locales, options);
    } as unknown as typeof Intl.DateTimeFormat;
    Object.assign(Stub, { supportedLocalesOf: original.supportedLocalesOf, prototype: original.prototype });
    Intl.DateTimeFormat = Stub;
    try {
      expect(formatTzLegend(MARCH, 'America/Los_Angeles')).toBe(formatWithTzAbbr(MARCH, 'America/Los_Angeles', 'zzz'));
      expect(formatTzLegend(MARCH, 'America/Los_Angeles')).toBe('PDT');
    } finally {
      Intl.DateTimeFormat = original;
    }
  });

  // A zone with no generic name (UTC) gets an offset from the formatter ('GMT+00:00' in Chromium
  // and Node, 'GMT' in WebKit), not a name: the abbreviation ('UTC') reads better and is today's.
  it('keeps the abbreviation for a zone whose generic name is only an offset (UTC stays UTC)', () => {
    expect(formatTzLegend(MARCH, 'UTC')).toBe('UTC');
  });

  it('returns null for a missing, blank or invalid zone (never the host zone)', () => {
    expect(formatTzLegend(MARCH, null)).toBeNull();
    expect(formatTzLegend(MARCH, '')).toBeNull();
    expect(formatTzLegend(MARCH, 'Not/A_Zone')).toBeNull();
  });
});
