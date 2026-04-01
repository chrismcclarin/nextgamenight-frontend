/**
 * Date and time formatting utilities.
 *
 * Implements locked casual format decisions:
 * - Date: "Mar 20" for current year, "Mar 20, 2026" for different year
 * - Time: "7:00 PM" (12-hour format)
 * - No relative dates (no "Today", "Tomorrow")
 *
 * All functions handle null/invalid input gracefully.
 */

/**
 * Format a date in casual style.
 * Current year: "Mar 20". Different year: "Mar 20, 2026".
 * When timezone is provided, appends abbreviation (e.g., "Mar 20 EDT").
 * Returns 'Never' for null/undefined input.
 *
 * @param {string|Date} date - Date string or Date object
 * @param {string} [timezone] - Optional IANA timezone (e.g., 'America/New_York')
 * @returns {string} Formatted date string
 */
export function formatDate(date, timezone) {
  if (!date) return 'Never';

  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return 'Invalid date';

    const currentYear = new Date().getFullYear();

    const options = { month: 'short', day: 'numeric' };
    if (timezone) {
      options.timeZone = timezone;
      options.timeZoneName = 'short';
    }

    // Check year in the target timezone
    const dateYear = timezone
      ? parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: timezone }).format(d), 10)
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
 *
 * @param {string|Date} dateOrTimeString - ISO date string, Date object, or "HH:MM" time string
 * @param {string} [timezone] - Optional IANA timezone (e.g., 'America/New_York')
 * @returns {string} Formatted time string (e.g., "7:00 PM" or "7:00 PM EDT")
 */
export function formatTime(dateOrTimeString, timezone) {
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
          const abbr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, timeZoneName: 'short' })
            .formatToParts(new Date())
            .find(p => p.type === 'timeZoneName')?.value;
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

    const options = { hour: 'numeric', minute: '2-digit' };
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
 *
 * @param {string|Date} date - Date string or Date object
 * @param {string} [timezone] - Optional IANA timezone (e.g., 'America/New_York')
 * @returns {string} Formatted date-time string
 */
export function formatDateTime(date, timezone) {
  if (!date) return '';

  try {
    const d = new Date(date);
    if (isNaN(d.getTime())) return '';

    const currentYear = new Date().getFullYear();

    const options = {
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
      ? parseInt(new Intl.DateTimeFormat('en-US', { year: 'numeric', timeZone: timezone }).format(d), 10)
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
 * Format a duration in minutes to human-readable form.
 * Examples: "45 min", "1.5 hrs", "2 hrs", "1 hour".
 * Returns empty string for 0/null/undefined input.
 *
 * @param {number} minutes - Duration in minutes
 * @returns {string} Human-readable duration
 */
export function formatDuration(minutes) {
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
