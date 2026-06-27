// src/lib/datetime.ts
//
// Single typed home for all frontend date/time formatting and UTC <-> wall-clock
// conversion. Phase 84 PRIM-05 (D-01/D-02) folds the two prior layers into one:
//
//   1. tzUtils.ts  — UTC <-> wall-clock TZ math (date-fns-tz v2). The function
//      bodies were MOVED here VERBATIM (byte-identical logic, no re-derivation)
//      so the pinned `tzUtils.test.ts` units stay green by construction.
//      `tzUtils.ts` now re-exports from this module for backward-compat.
//   2. dateUtils.js — casual date/time/duration formatters. Ported here as
//      typed equivalents with byte-for-byte identical output (pinned by
//      `datetime.test.ts`). `dateUtils.js` now re-exports from this module.
//
// date-fns-tz is pinned at v2 — use the v2 names (`formatInTimeZone`,
// `zonedTimeToUtc`) ONLY; do NOT migrate to the v3 conversion API. The v4 bump
// is Phase 90.
//
// Browser-TZ fallback policy (unchanged from tzUtils): this module FALLS BACK
// TO 'UTC' when the caller passes null/empty timeZone. It NEVER reaches into
// `Intl.DateTimeFormat().resolvedOptions().timeZone`. That decision belongs to
// the caller (see TimezoneProvider).

import { formatInTimeZone, zonedTimeToUtc } from 'date-fns-tz';

// ============================================================================
// UTC <-> wall-clock TZ math (moved verbatim from tzUtils.ts — DO NOT re-derive)
// ============================================================================

/** Wall-clock parts as numbers (month is 1-12, NOT 0-11). */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hours: number;
  minutes: number;
}

/**
 * Convert a UTC Date or ISO string to wall-clock components in the given IANA TZ.
 *
 * @param utcDate - UTC instant (Date or ISO string).
 * @param timeZone - IANA TZ name (e.g. 'America/Denver'). Falls back to UTC if null/empty.
 * @returns Wall-clock parts as numbers (month is 1-12, NOT 0-11), or null for null/undefined input.
 *
 * @example
 *   utcToWallClock('2026-06-15T01:30:00Z', 'America/Denver')
 *   // → { year: 2026, month: 6, day: 14, hours: 19, minutes: 30 }
 */
export function utcToWallClock(
  utcDate: Date | string | null | undefined,
  timeZone: string | null | undefined
): WallClock | null {
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
 * @param wallClockString - "YYYY-MM-DDTHH:mm" or "YYYY-MM-DDTHH:mm:ss".
 * @param timeZone - IANA TZ. Falls back to UTC if null/empty.
 * @returns UTC Date, or null for null/empty/invalid input.
 *
 * @example
 *   wallClockToUtc('2026-06-15T19:30', 'America/Denver').toISOString()
 *   // → '2026-06-16T01:30:00.000Z'
 */
export function wallClockToUtc(
  wallClockString: string | null | undefined,
  timeZone: string | null | undefined
): Date | null {
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
 * ("h:mm a zzz" → "7:30 PM MDT") so frontend cards/details and the email layer
 * stay visually consistent.
 *
 * @param date - UTC instant.
 * @param timeZone - IANA TZ. Falls back to UTC if null/empty.
 * @param formatStr - date-fns-tz format token string (default 'h:mm a zzz').
 * @returns Formatted string, or '' for null/invalid input.
 *
 * @example
 *   formatWithTzAbbr(new Date('2026-06-15T01:30:00Z'), 'America/Denver')
 *   // → '7:30 PM MDT'
 */
export function formatWithTzAbbr(
  date: Date | string | null | undefined,
  timeZone: string | null | undefined,
  formatStr: string = 'h:mm a zzz'
): string {
  if (date === null || date === undefined || date === '') return '';
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return '';

  const tz = timeZone && String(timeZone).trim() ? timeZone : 'UTC';
  return formatInTimeZone(d, tz, formatStr);
}

// ============================================================================
// Casual date/time/duration formatters (ported verbatim from dateUtils.js)
//
// Implements locked casual format decisions:
// - Date: "Mar 20" for current year, "Mar 20, 2026" for different year
// - Time: "7:00 PM" (12-hour format)
// - No relative dates (no "Today", "Tomorrow")
//
// Output is pinned BYTE-FOR-BYTE by datetime.test.ts against the legacy
// dateUtils output for a fixed Date + tz. All functions handle null/invalid
// input gracefully.
// ============================================================================

/**
 * Format a date in casual style.
 * Current year: "Mar 20". Different year: "Mar 20, 2026".
 * When timezone is provided, appends abbreviation (e.g., "Mar 20 EDT").
 * Returns 'Never' for null/undefined input.
 */
export function formatDate(
  date: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!date) return 'Never';

  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid date';

    const currentYear = new Date().getFullYear();

    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    if (timezone) {
      options.timeZone = timezone;
      options.timeZoneName = 'short';
    }

    // Check year in the target timezone
    const dateYear = timezone
      ? parseInt(
          new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: timezone }).format(d),
          10
        )
      : d.getFullYear();

    if (dateYear !== currentYear) {
      options.year = 'numeric';
    }

    return d.toLocaleDateString('en-US', options);
  } catch {
    return 'Invalid date';
  }
}

/**
 * Format a time in 12-hour format: "7:00 PM".
 * Handles both ISO date strings (extracts time) and "HH:MM" time strings
 * (24h to 12h conversion, matching ScheduleList pattern).
 * When timezone is provided, appends abbreviation (e.g., "7:00 PM EDT").
 * Returns empty string for null/undefined input.
 */
export function formatTime(
  dateOrTimeString: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!dateOrTimeString) return '';

  try {
    // Handle "HH:MM" time-only strings (e.g., "14:30", "09:00")
    if (typeof dateOrTimeString === 'string' && /^\d{1,2}:\d{2}$/.test(dateOrTimeString)) {
      const [hours, minutes] = dateOrTimeString.split(':');
      const h = parseInt(hours, 10);
      const ampm = h >= 12 ? 'PM' : 'AM';
      const displayHour = h % 12 || 12;
      const base = `${displayHour}:${minutes} ${ampm}`;

      // Append timezone abbreviation if provided
      if (timezone) {
        try {
          const abbr = new Intl.DateTimeFormat('en-US', {
            timeZone: timezone,
            timeZoneName: 'short',
          })
            .formatToParts(new Date())
            .find((p) => p.type === 'timeZoneName')?.value;
          return abbr ? `${base} ${abbr}` : base;
        } catch {
          return base;
        }
      }
      return base;
    }

    // Handle ISO date strings and Date objects
    const d = new Date(dateOrTimeString);
    if (isNaN(d.getTime())) return '';

    const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
    if (timezone) {
      options.timeZone = timezone;
      options.timeZoneName = 'short';
    }

    return d.toLocaleTimeString('en-US', options);
  } catch {
    return '';
  }
}

/**
 * Format a date and time combined.
 * Current year: "Mar 20, 7:00 PM". Different year: "Mar 20, 2026, 7:00 PM".
 * When timezone is provided, appends abbreviation (e.g., "Mar 20, 7:00 PM EDT").
 * Returns empty string for null/undefined input.
 */
export function formatDateTime(
  date: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!date) return '';

  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    const currentYear = new Date().getFullYear();

    const options: Intl.DateTimeFormatOptions = {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    };
    if (timezone) {
      options.timeZone = timezone;
      options.timeZoneName = 'short';
    }

    // Check year in the target timezone
    const dateYear = timezone
      ? parseInt(
          new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: timezone }).format(d),
          10
        )
      : d.getFullYear();

    if (dateYear !== currentYear) {
      options.year = 'numeric';
    }

    return d.toLocaleString('en-US', options);
  } catch {
    return '';
  }
}

/**
 * Format a long-form header date: "Saturday, May 10, 2026".
 *
 * Consolidates the bespoke `toLocaleDateString('en-US', {weekday:'long',
 * year:'numeric', month:'long', day:'numeric'})` header calls that previously
 * lived inline in EventDayModal (no timezone) and gameDetail (optional
 * timezone). Output is pinned BYTE-FOR-BYTE by datetime.test.ts against those
 * legacy raw calls so the swap is provably output-preserving.
 *
 * When `timezone` is provided, the date is rendered in that IANA TZ; otherwise
 * it renders in the runtime's local TZ (matching the legacy no-timezone call).
 * Returns '' for null/invalid input.
 */
export function formatLongDate(
  date: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!date) return '';

  const d = date instanceof Date ? date : new Date(date);
  if (isNaN(d.getTime())) return '';

  const options: Intl.DateTimeFormatOptions = {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  };
  if (timezone) {
    options.timeZone = timezone;
  }

  return d.toLocaleDateString('en-US', options);
}

/**
 * Format a Date as a local-calendar "YYYY-MM-DD" string.
 *
 * Use this to populate `<input type="date">` defaults and any payload field
 * meant to encode the user's local calendar day. Do NOT use
 * `new Date().toISOString().split('T')[0]` for this -- that converts local
 * time to UTC first, so a user in PDT clicking the form at local 22:00 sees
 * TOMORROW's date prefilled (UTC has already rolled over). The save-side
 * pipeline then persists the wrong day and the heatmap silently drops the
 * override (HEAT-02 expansion 4).
 *
 * @param date - Date to format (defaults to "now")
 * @returns YYYY-MM-DD in local calendar terms
 */
export function toLocalDateString(date: Date = new Date()): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Format a duration in minutes to human-readable form.
 * Examples: "45 min", "1.5 hrs", "2 hrs", "1 hour".
 * Returns empty string for 0/null/undefined input.
 */
export function formatDuration(minutes: number | null | undefined): string {
  if (!minutes || minutes === 0) return '';

  if (minutes < 60) {
    return `${minutes} min`;
  }

  const hours = minutes / 60;

  // Whole number of hours
  if (hours % 1 === 0) {
    return `${hours} ${hours === 1 ? 'hour' : 'hrs'}`;
  }

  // Fractional hours
  return `${hours.toFixed(1)} hrs`;
}
