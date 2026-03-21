/**
 * Calendar utility functions.
 *
 * Extracted from EventCalendar.js and groupHomePage/page.js
 * where these were duplicated inline.
 *
 * All functions are pure (no React state) and handle null input gracefully.
 */

/**
 * Get calendar grid cells for a given month.
 * Returns array of Date objects with null padding for days before month start.
 *
 * @param {Date} date - Any date within the target month
 * @returns {(Date|null)[]} Array of dates (nulls for empty leading cells)
 */
export function getDaysInMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();

  const days = [];

  // Add empty cells for days before the first day of the month
  for (let i = 0; i < startingDayOfWeek; i++) {
    days.push(null);
  }

  // Add all days of the month
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(new Date(year, month, day));
  }

  return days;
}

/**
 * Filter events that fall on a specific date (local timezone comparison).
 * Compares YYYY-MM-DD strings to handle timezone edge cases.
 *
 * @param {Date} date - The target date to match
 * @param {Array} events - Array of event objects with start_date property
 * @returns {Array} Events matching the given date
 */
export function getEventsForDate(date, events) {
  if (!date) return [];
  // Get date in local timezone (YYYY-MM-DD)
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateStr = `${year}-${month}-${day}`;

  return events.filter(event => {
    if (!event.start_date) return false;
    // Convert event date to local date string
    const eventDate = new Date(event.start_date);
    const eventYear = eventDate.getFullYear();
    const eventMonth = String(eventDate.getMonth() + 1).padStart(2, '0');
    const eventDay = String(eventDate.getDate()).padStart(2, '0');
    const eventDateStr = `${eventYear}-${eventMonth}-${eventDay}`;
    return eventDateStr === dateStr;
  });
}

/**
 * Check if a date is today.
 *
 * @param {Date|null} date - Date to check
 * @returns {boolean} True if date is today
 */
export function isToday(date) {
  if (!date) return false;
  const today = new Date();
  return date.toDateString() === today.toDateString();
}
