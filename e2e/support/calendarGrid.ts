import { expect, type Page } from '@playwright/test';

import { getDaysInMonth } from '../../src/lib/calendarUtils';

// DECISION Phase 88.9-25 (CS-05 e2e): the adjacent-month reads take the grid's geometry from the
// app's own getDaysInMonth, by relative path (the D-OQ-2 precedent, cited next; the calendar
// module itself has no imports):
// e2e/support/contrast.ts ("CHOSEN: a relative import of")
// chosen OVER restating the grid arithmetic in each spec — the
// restated fixed count is what broke when CS-05 trimmed the grid. A month ending on a Saturday has
// no trailing day under CS-05, so a read that needs N trailing days walks forward to the first
// month that has them; leading previous-month days are NOT a fallback, because on the full grid
// they are past days and take the past arm, not the adjacent arm being measured.

export const MONTH_LABELS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

export interface TrailingTarget {
  /** The month the read happens in. */
  year: number;
  month: number;
  /** How many Next presses from the current month reach it (0 = the current month). */
  steps: number;
  /** Its grid's cell count under CS-05: 28, 35 or 42. */
  cellCount: number;
  /** How many next-month days finish its last week. */
  trailing: number;
  /** The month those trailing days belong to. */
  nextYear: number;
  nextMonth: number;
  /** The grid heading text for the target month, such as "December 2026". */
  label: string;
}

/**
 * The first month, from now's month forward (at most 11 steps), whose grid ends with at least
 * minTrailing next-month days. Computed over 2026-2075 the walk is at most 3 steps for 4 days
 * and at most 2 for 3 days.
 */
export function monthWithTrailingDays(now: Date, minTrailing: number): TrailingTarget {
  for (let steps = 0; steps < 12; steps += 1) {
    const first = new Date(now.getFullYear(), now.getMonth() + steps, 1);
    const year = first.getFullYear();
    const month = first.getMonth();
    const cells = getDaysInMonth(first);
    let lastCurrent = -1;
    cells.forEach((c, i) => { if (c.isCurrentMonth) lastCurrent = i; });
    const trailing = cells.length - 1 - lastCurrent;
    if (trailing >= minTrailing) {
      const next = new Date(year, month + 1, 1);
      return {
        year,
        month,
        steps,
        cellCount: cells.length,
        trailing,
        nextYear: next.getFullYear(),
        nextMonth: next.getMonth(),
        label: `${MONTH_LABELS[month]} ${year}`,
      };
    }
  }
  throw new Error(
    `calendarGrid: no month within 12 of ${MONTH_LABELS[now.getMonth()]} ${now.getFullYear()} ends with ${minTrailing} trailing next-month days`,
  );
}

/**
 * Presses the grid's own forward control `steps` times, asserting after each press that the
 * heading names the next month. Exactly one forward control must exist: a second match is a
 * LOCATOR failure, never a wrong click.
 */
export async function advanceMonths(page: Page, from: { year: number; month: number }, steps: number): Promise<void> {
  for (let i = 1; i <= steps; i += 1) {
    // DECISION Phase 88.9-25 (nav name): the forward control is matched by its shipped name and by the name N1 gives it (plan 88.9-28, UI-SPEC copy row "Next month"), chosen OVER the exact shipped name, which would red this walk the day N1 lands.
    const forward = page.getByRole('button', { name: /^Next( →| month)$/ });
    await expect(forward, `calendarGrid: expected exactly one month Next control (step ${i} of ${steps})`).toHaveCount(1);
    await forward.click();
    const reached = new Date(from.year, from.month + i, 1);
    const label = `${MONTH_LABELS[reached.getMonth()]} ${reached.getFullYear()}`;
    await expect(
      page.getByRole('heading', { name: label, exact: true }).first(),
      `calendarGrid: the grid heading did not move to ${label} after Next (step ${i} of ${steps})`,
    ).toBeVisible({ timeout: 15_000 });
  }
}
