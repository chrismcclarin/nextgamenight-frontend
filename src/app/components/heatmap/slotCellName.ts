// src/app/components/heatmap/slotCellName.ts
//
// The ONE screen-reader name template for a cell of Create Event's two availability grids (Phase
// 88.6.1 plan 24): the scheduler (`EventScheduler.tsx`, the visual time picker) and the manual-
// entry heatmap behind it (`EventHeatmapBackground.js`). Both render the shared `ReadCell`, and
// both now name each cell here.
//
// Pure, no React, no `'use client'` - the `dayAggregate.ts` precedent in this directory. The
// caller passes a Date whose LOCAL wall-clock parts are the day and time its own column header and
// hour label print; this module formats those parts and nothing else. It never converts a zone.

import { format } from 'date-fns';

/** Day part of the name, e.g. "Monday, October 5". */
export const SLOT_CELL_DAY_FORMAT = 'EEEE, MMMM d';
/** Time part of the name, e.g. "10:00 AM". */
export const SLOT_CELL_TIME_FORMAT = 'h:mm a';

/*
 * DECISION Phase 88.6.1-24 (D-12 / D-34, copy row C1): a cell with availability is named
 * "Monday, October 5 at 10:00 AM, 1 of 4 available"; a cell without any keeps the plain
 * "Monday, October 5 at 11:00 AM".
 *
 * CHOSEN - ONE template for both Create Event grids (the scheduler and the manual-entry heatmap),
 * each caller passing a Date whose LOCAL parts are the wall clock its own labels print.
 * REJECTED:
 *   (a) a copy of the template in each grid - the duplication tenet; two copies are how Create
 *       Event would drift into two name shapes, which is the reason the owner took D-34;
 *   (b) formatting inside `ReadCell` - the shared cell would have to know each container's time
 *       model (the same reason DECISION Phase 88.6.1-17 gives for WriteCell's name override), and
 *       EventHeatmapBackground's own marker keeps ReadCell unedited;
 *   (c) a central copy register - D-30 places surface strings at the surface, and this module sits
 *       beside the one cell both grids render;
 *   (d) the check-in grid as a third caller - plan 88.6.1-17's rejected option (g): that grid holds
 *       a fixed time of day and names cells by its own row label, copy row A2.
 *
 * Empty cells get no count because C1's ratified note names them plainly, and an empty cell
 * carries no availability wash (the zero arm of `mergedCellColor` returns the neutral surface), so
 * dropping "0 of N available" creates no colour-only encoding. A count with a zero total is not
 * special-cased: the tooltip prints the same two numbers.
 *
 * Changing this is a decision, not a cleanup.
 */
export function slotCellName(
  slotStart: Date,
  availableCount: number,
  totalMembers: number
): string {
  const day = format(slotStart, SLOT_CELL_DAY_FORMAT);
  const time = format(slotStart, SLOT_CELL_TIME_FORMAT);
  const plain = `${day} at ${time}`;
  if (availableCount > 0) {
    return `${plain}, ${availableCount} of ${totalMembers} available`;
  }
  return plain;
}
