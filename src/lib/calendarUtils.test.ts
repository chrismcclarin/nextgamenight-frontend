// Pins for getDaysInMonth's cell count (Phase 88.9-25, CS-05 / R2-85 / CR2-15).
//
// WHAT THESE EXIST TO CATCH: the owner ruled the month grid's padding row away (CALENDAR-SESSION
// 2026-11-07, "Yeah, we can lose the padding."). The grid now holds only the Sunday-start weeks the
// month touches: 28, 35 or 42 cells. A return to a fixed count (or any other padding rule) turns
// these red. The ruling's own record is the DECISION marker above the trailing loop in
// src/lib/calendarUtils.js ("DECISION Phase 88.9-25 (CS-05").
//
// Every month is built from local-time year / month / day parts and compared the same way, never
// by milliseconds, so a DST change inside a month cannot make two consecutive days look 23 or 25
// hours apart.

import { describe, it, expect } from 'vitest';
import { getDaysInMonth } from './calendarUtils';

type Cell = { date: Date; isCurrentMonth: boolean };

const parts = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()];

describe('getDaysInMonth — whole weeks (88.9 CS-05, R2-85)', () => {
  it('CS-05 (88.9): Feb 2026 = 28, a 5-row month = 35, a 6-row month = 42', () => {
    // February 2026 starts on a Sunday and has 28 days: four whole weeks, no adjacent day.
    const feb: Cell[] = getDaysInMonth(new Date(2026, 1, 15));
    expect(feb.length, 'February 2026 is exactly four weeks').toBe(28);
    expect(feb.every((c) => c.isCurrentMonth), 'every February 2026 cell is a February day').toBe(true);

    // November 2026 starts on a Sunday and has 30 days: five weeks, ending Saturday 5 December.
    const nov: Cell[] = getDaysInMonth(new Date(2026, 10, 9));
    expect(nov.length, 'November 2026 is five weeks').toBe(35);
    expect(parts(nov[0].date), 'November 2026 starts on Sunday 1 November').toEqual([2026, 10, 1]);
    expect(parts(nov[34].date), 'November 2026 ends on Saturday 5 December').toEqual([2026, 11, 5]);
    expect(nov[34].isCurrentMonth, '5 December is an adjacent-month cell').toBe(false);

    // August 2031 starts on a Friday and has 31 days: it touches six weeks.
    const aug: Cell[] = getDaysInMonth(new Date(2031, 7, 1));
    expect(aug.length, 'August 2031 is six weeks').toBe(42);
    expect(parts(aug[0].date), 'August 2031 starts on Sunday 27 July').toEqual([2031, 6, 27]);
  });

  it('CS-05 (88.9): every month 2026-2040 is whole Sunday-start weeks ending in the week that holds its last day', () => {
    let checked = 0;
    for (let year = 2026; year <= 2040; year++) {
      for (let month = 0; month < 12; month++) {
        const label = `${year}-${String(month + 1).padStart(2, '0')}`;
        const cells: Cell[] = getDaysInMonth(new Date(year, month, 1));
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        expect(cells.length % 7, `${label}: whole weeks`).toBe(0);
        expect(cells.length, `${label}: at least four weeks`).toBeGreaterThanOrEqual(28);
        expect(cells.length, `${label}: at most six weeks`).toBeLessThanOrEqual(42);
        expect(cells[0].date.getDay(), `${label}: the first cell is a Sunday`).toBe(0);
        expect(cells[cells.length - 1].date.getDay(), `${label}: the last cell is a Saturday`).toBe(6);
        expect(cells.filter((c) => c.isCurrentMonth).length, `${label}: every day of the month, once`).toBe(daysInMonth);

        // The month's last day sits in the final week, so no row is made only of next-month days.
        const lastIndex = cells.findIndex(
          (c) => c.isCurrentMonth && c.date.getDate() === daysInMonth,
        );
        expect(lastIndex, `${label}: the last day sits in the final seven cells`).toBeGreaterThanOrEqual(cells.length - 7);

        for (let i = 1; i < cells.length; i++) {
          const prev = cells[i - 1].date;
          const expected = new Date(prev.getFullYear(), prev.getMonth(), prev.getDate() + 1);
          expect(parts(cells[i].date), `${label}: cell ${i + 1} follows cell ${i}`).toEqual(parts(expected));
        }
        checked++;
      }
    }
    expect(checked, 'every month 2026-2040').toBe(180);
  });
});
