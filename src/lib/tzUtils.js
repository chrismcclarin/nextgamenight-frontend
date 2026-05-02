// src/lib/tzUtils.js
//
// Single source of truth for frontend UTC <-> wall-clock conversions.
// Phase 62 Plan 01 / Task 2.
//
// Wraps date-fns-tz (^2.0.1) — do NOT hand-roll TZ math, do NOT add another lib.
// Output format of `formatWithTzAbbr` is intentionally consistent with the
// backend email helper (`emailService.formatEventTime12h`) so that the same
// UTC instant + IANA TZ produces the same wall-clock string everywhere.
//
// Browser-TZ fallback policy: this module FALLS BACK TO 'UTC' when the
// caller passes null/empty timeZone. It NEVER reaches into
// `Intl.DateTimeFormat().resolvedOptions().timeZone`. That decision belongs
// to the caller (see TimezoneProvider).

import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

/**
 * Convert a UTC Date or ISO string to wall-clock components in the given IANA TZ.
 *
 * Used by Plan 02 to populate the edit form's <input type="datetime-local">
 * from a stored UTC start_date in the viewer's profile TZ.
 *
 * @param {Date|string|null|undefined} utcDate - UTC instant (Date or ISO string).
 * @param {string|null|undefined} timeZone - IANA TZ name (e.g. 'America/Denver').
 *                                           Falls back to UTC if null/empty.
 * @returns {{ year: number, month: number, day: number, hours: number, minutes: number } | null}
 *          Wall-clock parts as numbers (month is 1-12, NOT 0-11).
 *          Returns null for null/undefined input.
 *
 * @example
 *   utcToWallClock('2026-06-15T01:30:00Z', 'America/Denver')
 *   // → { year: 2026, month: 6, day: 14, hours: 19, minutes: 30 }
 *   //   (June 14, 7:30 PM MDT — the same physical moment as 1:30 AM UTC June 15)
 */
export function utcToWallClock(utcDate, timeZone) {
  if (utcDate === null || utcDate === undefined || utcDate === '') return null;
  const d = utcDate instanceof Date ? utcDate : new Date(utcDate);
  if (Number.isNaN(d.getTime())) return null;

  const tz = timeZone && String(timeZone).trim() ? timeZone : 'UTC';

  // 'yyyy-MM-dd-HH-mm' is unambiguous and trivially parseable.
  const formatted = formatInTimeZone(d, tz, 'yyyy-MM-dd-HH-mm');
  const [yyyy, mm, dd, hh, min] = formatted.split('-');
  return {
    year: Number(yyyy),
    month: Number(mm),
    day: Number(dd),
    hours: Number(hh),
    minutes: Number(min),
  };
}

/**
 * Convert a "YYYY-MM-DDTHH:mm" wall-clock string + IANA TZ to a UTC Date.
 *
 * Used by Plan 02 on save: form value (datetime-local) + viewer's profile TZ
 * → UTC ISO instant for the backend.
 *
 * @param {string|null|undefined} wallClockString - "YYYY-MM-DDTHH:mm" or
 *                                                  "YYYY-MM-DDTHH:mm:ss".
 * @param {string|null|undefined} timeZone - IANA TZ. Falls back to UTC if null/empty.
 * @returns {Date|null} UTC Date, or null for null/empty/invalid input.
 *
 * @example
 *   wallClockToUtc('2026-06-15T19:30', 'America/Denver').toISOString()
 *   // → '2026-06-16T01:30:00.000Z' (7:30 PM MDT = 1:30 AM UTC next day)
 */
export function wallClockToUtc(wallClockString, timeZone) {
  if (wallClockString === null || wallClockString === undefined || wallClockString === '') {
    return null;
  }
  const tz = timeZone && String(timeZone).trim() ? timeZone : 'UTC';
  const utc = zonedTimeToUtc(wallClockString, tz);
  if (Number.isNaN(utc.getTime())) return null;
  return utc;
}

/**
 * Format a UTC date in the given TZ with a 12-hour wall-clock and TZ abbreviation.
 *
 * Default format mirrors backend `emailService.formatEventTime12h` output
 * ("h:mm a zzz" → "7:30 PM MDT") so frontend cards/details and the email
 * layer stay visually consistent.
 *
 * @param {Date|string|null|undefined} date - UTC instant.
 * @param {string|null|undefined} timeZone - IANA TZ. Falls back to UTC if null/empty.
 * @param {string} [formatStr='h:mm a zzz'] - date-fns-tz format token string.
 * @returns {string} Formatted string, or '' for null/invalid input.
 *
 * @example
 *   formatWithTzAbbr(new Date('2026-06-15T01:30:00Z'), 'America/Denver')
 *   // → '7:30 PM MDT'
 *   formatWithTzAbbr(new Date('2026-06-15T01:30:00Z'), null)
 *   // → '1:30 AM UTC'
 */
export function formatWithTzAbbr(date, timeZone, formatStr = 'h:mm a zzz') {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const tz = timeZone && String(timeZone).trim() ? timeZone : 'UTC';
  return formatInTimeZone(d, tz, formatStr);
}

// -----------------------------------------------------------------------------
// Round-trip & cross-TZ examples (no Jest in frontend; documented here for
// Plan 02 manual verification per CONTEXT.md):
//
//   1. wallClockToUtc('2026-06-15T19:30', 'America/Denver').toISOString()
//      → '2026-06-16T01:30:00.000Z' (DST in effect: MDT = UTC-6)
//
//   2. wallClockToUtc('2026-01-15T19:30', 'America/Denver').toISOString()
//      → '2026-01-16T02:30:00.000Z' (no DST: MST = UTC-7)
//
//   3. const wc = wallClockToUtc('2026-06-15T19:30', 'America/Denver');
//      utcToWallClock(wc, 'America/Denver')
//      → { year: 2026, month: 6, day: 15, hours: 19, minutes: 30 }
//      (round-trip is lossless for an unambiguous wall-clock)
//
//   4. const utc = new Date('2026-06-15T01:30:00Z');
//      utcToWallClock(utc, 'America/Denver')   // → { ..., hours: 19, minutes: 30 }  (June 14, 7:30 PM MDT)
//      utcToWallClock(utc, 'America/Los_Angeles') // → { ..., hours: 18, minutes: 30 } (June 14, 6:30 PM PDT)
//      // Same UTC moment, wall-clocks 1 hour apart — viewer-anchor working as designed.
//
//   5. formatWithTzAbbr(new Date('2026-06-15T01:30:00Z'), 'America/Denver')
//      → '7:30 PM MDT' (DST → MDT) — but on 2026-01-15: '6:30 PM MST' (no DST)
//
//   6. formatWithTzAbbr(new Date('2026-06-15T01:30:00Z'), null)
//      → '1:30 AM UTC' (null timeZone falls back to UTC, NOT browser TZ)
// -----------------------------------------------------------------------------
