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
 *
 * Returns whole Sunday-start weeks — 28, 35 or 42 cells, only the weeks the
 * month touches (CS-05, plan 88.9-25) — covering:
 *   - Trailing days of the previous month (leading cells)
 *   - Every day of the target month (`isCurrentMonth: true`)
 *   - The next month's days that finish the last week (trailing cells)
 *
 * Phase 64-02 (CAL-01): adjacent-month days are exposed (not null padding)
 * so callers can render them with muted styling and still display events
 * that fall on those dates.
 *
 * @param {Date} date - Any date within the target month
 * @returns {Array<{date: Date, isCurrentMonth: boolean}>} a 28-, 35- or 42-cell grid
 */
export function getDaysInMonth(date) {
  const year = date.getFullYear();
  const month = date.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const daysInMonth = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay(); // 0 = Sunday

  const cells = [];

  // Leading cells: trailing days of the previous month
  if (startingDayOfWeek > 0) {
    const prevMonthLastDay = new Date(year, month, 0).getDate();
    const prevMonthYear = month === 0 ? year - 1 : year;
    const prevMonthIndex = month === 0 ? 11 : month - 1;
    for (let i = startingDayOfWeek - 1; i >= 0; i--) {
      const day = prevMonthLastDay - i;
      cells.push({
        date: new Date(prevMonthYear, prevMonthIndex, day),
        isCurrentMonth: false,
      });
    }
  }

  // Middle cells: every day of the target month
  for (let day = 1; day <= daysInMonth; day++) {
    cells.push({
      date: new Date(year, month, day),
      isCurrentMonth: true,
    });
  }

  // Trailing cells: the next month's leading days, added only to finish the
  // last week that holds a day of this month (none when the month ends on a
  // Saturday).
  const nextMonthYear = month === 11 ? year + 1 : year;
  const nextMonthIndex = month === 11 ? 0 : month + 1;
  let nextDay = 1;
  // DECISION Phase 88.9-25 (CS-05, owner chat 2026-11-07 "Yeah, we can lose the padding.",
  // CALENDAR-SESSION; R2-85, CR2-15): the grid pads only to the end of the last week that holds a
  // day of the month — 28, 35 or 42 cells — chosen OVER the fixed six-week grid of 42, whose stable
  // height cost five-week months a whole row of next-month padding (84px of the compact grid at
  // 375). Accepted consequence: the card's height follows the month. Going back to a fixed count is
  // a decision, not a cleanup.
  while (cells.length % 7 !== 0) {
    cells.push({
      date: new Date(nextMonthYear, nextMonthIndex, nextDay),
      isCurrentMonth: false,
    });
    nextDay++;
  }

  return cells;
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
