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
import * as Sentry from '@sentry/nextjs';

// ============================================================================
// Browser timezone detection (moved verbatim from TimezoneProvider.js)
//
// This is the single home for browser IANA-TZ detection + validation. Only the
// caller (TimezoneProvider) decides policy (profile TZ canonical, browser TZ
// fallback) — this helper just reports what the browser claims, or null.
// It NEVER mutates profile state. Safe to call client-side only (it reads the
// browser's resolved timezone); on the server `Intl.DateTimeFormat()` resolves
// to the host TZ, which callers should not rely on.
// ============================================================================

/**
 * Detects the browser's IANA timezone and validates it.
 * Returns the detected timezone string, or null if invalid/unavailable.
 * Emits a Sentry breadcrumb (not an error) on detection failure so production
 * can observe how often the browser API returns empty or throws.
 */
export function detectBrowserTimezone(): string | null {
  try {
    const detected = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!detected) {
      // Phase 78 / TZ-01: production signal that the browser API returned empty.
      Sentry.addBreadcrumb({
        category: 'timezone.detection-failure',
        message: 'Intl.DateTimeFormat returned empty timeZone',
        level: 'info',
        data: { detection_failure: true, reason: 'empty' },
      });
      return null;
    }
    // Validate by attempting to create a formatter with it
    Intl.DateTimeFormat(undefined, { timeZone: detected });
    return detected;
  } catch (err) {
    // Phase 78 / TZ-01: production signal that the browser threw during
    // detection or validation (rare — typically a polyfill / sandbox issue).
    Sentry.addBreadcrumb({
      category: 'timezone.detection-failure',
      message: 'Intl.DateTimeFormat threw during detection or validation',
      level: 'info',
      data: { detection_failure: true, reason: (err as Error)?.message || 'unknown' },
    });
    return null;
  }
}

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

/**
 * The calendar legend's zone name: the reader's zone without a season ('Pacific Time', never
 * 'PST' in January and 'PDT' in March), from the browser's own formatter (Intl.DateTimeFormat with
 * timeZoneName 'longGeneric', en-US like the rest of the app's zone labels).
 *
 * Owner ruling W1 (Phase 89.6, 2026-11-22 10:53 PM Pacific, 'W1) yes'): both calendar legends (the
 * month view and the list view) read 'Times shown in <season-free zone name>'; event rows keep their
 * own abbreviation. FALLBACK: an engine without the longGeneric option keeps today's abbreviation
 * label, formatWithTzAbbr(date, timezone, 'zzz'); so does a zone whose generic name is only an offset
 * (UTC reads 'UTC', not 'GMT+00:00').
 *
 * @param date - the instant the legend stands beside (the month on screen, or now).
 * @param timezone - the reader's IANA zone.
 * @returns the zone name, the abbreviation on an engine without the option, or null for a missing,
 *   blank or invalid zone (never the host's zone: a bare formatter would name it while the rows
 *   render in UTC).
 */
export function formatTzLegend(date: Date, timezone: string | null | undefined): string | null {
  if (timezone === null || timezone === undefined || !String(timezone).trim()) return null;
  // The zone on its own first: an invalid zone and an unsupported option both throw RangeError, so
  // they are told apart here, and formatWithTzAbbr (which also throws on an invalid zone) is never
  // reached with one.
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
  } catch {
    return null;
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      timeZoneName: 'longGeneric' as Intl.DateTimeFormatOptions['timeZoneName'],
    });
    const resolved = formatter.resolvedOptions() as Intl.ResolvedDateTimeFormatOptions & { timeZoneName?: string };
    const part = formatter.formatToParts(date).find((p) => p.type === 'timeZoneName')?.value;
    // DECISION Phase 89.6-40 (W1-offset): a zone with no generic name (UTC) is given an offset
    // ('GMT+00:00' in Chromium, 'GMT' in WebKit), not a name; the abbreviation ('UTC', today's
    // label) is kept for it, chosen OVER printing the offset, which reads worse and differs by
    // browser. Every named zone ('Pacific Time') is unaffected.
    if (resolved.timeZoneName === 'longGeneric' && part && !/^GMT(?:[+-]\d|$)/.test(part)) return part;
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return formatWithTzAbbr(date, timezone, 'zzz');
}

/**
 * The year rule for a date heading: hand back `pattern` as it is when `date` falls in the
 * viewer's current calendar year (read in `timezone`), else the same pattern with the year
 * appended (`, yyyy`). It returns a date-fns PATTERN, not a formatted string, so each caller
 * keeps its own shape (long month on the Calendar list's day headers, short month on the Next
 * game night card) and formats with `formatWithTzAbbr` as before.
 *
 * DECISION Phase 88.9-61 (X29 years; owner 2026-11-14 'Yes' for the Next game night card): ONE
 * rule for every date heading, chosen OVER a per-surface copy; a second year check is a
 * decision, not a cleanup.
 *
 * A malformed IANA zone falls back to UTC for the comparison rather than throwing, the same
 * fallback its callers already apply when they format.
 *
 * @param pattern - date-fns-tz format tokens with no year in them (e.g. 'EEEE, MMMM d').
 * @param date - the instant the heading names.
 * @param timezone - the viewer's IANA zone; null or empty reads UTC.
 * @param now - the viewer's current instant (defaults to the real clock).
 */
export function withYearOutsideCurrent(
  pattern: string,
  date: Date,
  timezone: string | null,
  now: Date = new Date()
): string {
  const yearOf = (instant: Date): string => {
    try {
      return formatWithTzAbbr(instant, timezone, 'yyyy');
    } catch {
      return formatWithTzAbbr(instant, null, 'yyyy');
    }
  };
  return yearOf(date) === yearOf(now) ? pattern : `${pattern}, yyyy`;
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

/* DECISION Phase 88.9-52 (R4-A2, round-3 capture): a DATE-ONLY value (the strict YYYY-MM-DD string a
   DATEONLY column or an override's pattern_data.date carries) is a CALENDAR DAY, not an instant, and
   it is read through parseDateOnly, chosen OVER new Date(value): the engine reads that shape as UTC
   midnight, so west of UTC the day printed one early (an override stored 2026-11-27 showed Nov 26 on
   Profile in Pacific) and a To-date filter dropped its own last day. REJECTED: formatting such a
   value in the viewer's zone (a day has no zone to convert from; it would move again for a viewer
   east or west of the browser) and fixing each call site by hand (three on Profile, two on the game
   page: the next one would repeat it). Handing a date-only string back to new Date is a decision,
   not a cleanup. */
const DATE_ONLY_SHAPE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Read a strict "YYYY-MM-DD" string as that calendar day at LOCAL midnight.
 * Returns null for anything else: another shape, a non-string, or a day that does not exist
 * (2026-02-31), so a caller can fall back to its instant path.
 */
export function parseDateOnly(value: unknown): Date | null {
  if (typeof value !== 'string') return null;
  const m = DATE_ONLY_SHAPE.exec(value);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const d = new Date(year, month - 1, day);
  // The (y, m, d) constructor maps years 0-99 to 1900-1999; set the year outright.
  d.setFullYear(year);
  if (d.getFullYear() !== year || d.getMonth() !== month - 1 || d.getDate() !== day) return null;
  return d;
}

/**
 * The instant a date-only day STARTS (00:00:00.000) in `timezone`, the viewer's IANA zone; with no
 * zone, in the runtime's local zone. Null when `value` is not a real YYYY-MM-DD.
 */
export function dateOnlyDayStart(value: unknown, timezone: string | null | undefined): Date | null {
  const local = parseDateOnly(value);
  if (!local) return null;
  if (!timezone || !String(timezone).trim()) return local;
  return wallClockToUtc(`${value as string}T00:00:00`, timezone);
}

/**
 * The last instant of a date-only day (23:59:59.999) in `timezone`; with no zone, in the runtime's
 * local zone. Null when `value` is not a real YYYY-MM-DD.
 */
export function dateOnlyDayEnd(value: unknown, timezone: string | null | undefined): Date | null {
  const local = parseDateOnly(value);
  if (!local) return null;
  if (!timezone || !String(timezone).trim()) {
    local.setHours(23, 59, 59, 999);
    return local;
  }
  const lastSecond = wallClockToUtc(`${value as string}T23:59:59`, timezone);
  return lastSecond ? new Date(lastSecond.getTime() + 999) : null;
}

/**
 * Format a date in casual style.
 * Current year: "Mar 20". Different year: "Mar 20, 2026".
 * When timezone is provided, appends abbreviation (e.g., "Mar 20 EDT").
 * A date-only string ("2026-03-20") prints its own calendar day in every zone, with no
 * abbreviation: `timezone` is ignored for it (the DECISION Phase 88.9-52 (R4-A2) marker above).
 * Returns 'Never' for null/undefined input.
 */
export function formatDate(
  date: Date | string | null | undefined,
  timezone?: string | null
): string {
  if (!date) return 'Never';

  try {
    const day = parseDateOnly(date);
    if (day) {
      const dayOptions: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
      if (day.getFullYear() !== new Date().getFullYear()) dayOptions.year = 'numeric';
      return day.toLocaleDateString('en-US', dayOptions);
    }

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
