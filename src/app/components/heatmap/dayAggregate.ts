// src/app/components/heatmap/dayAggregate.ts
//
// Pure per-day roll-up over the scheduler's per-slot heatmap lookup (Phase 88.1 plan 12, D-03).
//
// The phone week strip (`SchedulerWeekStrip`) shows ONE number per day where the desktop grid
// shows 28. This is the function that collapses them, and it is deliberately pure and separate
// from the component for the same reason `eventFormUtils.js` exists: the rule is the thing worth
// pinning, and a rule welded into a render body cannot be unit-tested without mounting a modal.
//
// Input shape is the scheduler's own `heatmapLookup` (`EventScheduler.tsx`): a Map keyed
// `${localDateStr}_${localHour}` — LOCAL date and LOCAL hour, already converted from the UTC
// wire — whose values carry `availableCount`. This function does not re-do that conversion and
// must not: doing it in two places is how the two copies drift.

/** The only field of a heatmap slot this roll-up reads. */
export interface DayAggregateSlot {
  availableCount?: number;
}

/*
 * DECISION Phase 88.1-12 (UI-SPEC "S2 phone strip cell", PRESCRIBED): the per-day aggregate is the
 * MAX over the day's slots, chosen OVER a MEAN and OVER an evening-window roll-up.
 *
 * WHY MAX: the strip's whole stated purpose is answering "which evening is green" (CONTEXT D-03).
 * A mean dilutes a single strongly-available evening with an empty morning and can INVERT that
 * answer — a day with 4-of-4 free at 8pm and nobody free all afternoon means the group can play
 * that day, and a mean renders it paler than a day where everyone is half-available and nobody can
 * actually meet. A sum is worse still: it scales with how many slots happen to carry data, so it
 * ranks days by data density rather than by availability.
 *
 * WHY NOT an evening-window roll-up (max over, say, 18:00-23:00): it would encode a house rule
 * about when game night happens into a presentation helper, and the grid below the strip already
 * spans 10:00-23:59 for the people whose group plays on a Sunday afternoon.
 *
 * OWNER CONFIRMATION IS PENDING, by design: the Req 7 walkthrough (plan 88.1-15) carries a
 * one-line confirm on MAX-vs-mean. This marker exists so that if he prefers something else, the
 * next reader can see this was a considered default rather than an accident — changing it is a
 * decision, not a cleanup, and it changes what the strip MEANS, not just what it looks like.
 */

/**
 * Roll a per-slot availability lookup up to one number per day: the day's PEAK `availableCount`.
 *
 * @param heatmapLookup - the scheduler's `${localDateStr}_${localHour}` -> slot map
 * @param dates - the displayed week's local date strings ('YYYY-MM-DD'), in display order
 * @returns one peak count per entry of `dates`, in the SAME order; 0 for a day with no slots
 */
export function maxAvailabilityPerDay(
  heatmapLookup: ReadonlyMap<string, DayAggregateSlot | undefined>,
  dates: readonly string[]
): number[] {
  // One pass over the lookup builds date -> peak; then the requested dates are read off it. Doing
  // it this way (rather than scanning the lookup once per date) keeps this O(slots + days) and
  // means an unusually long `dates` list cannot turn into quadratic work.
  const peaks = Array.from(heatmapLookup.entries()).reduce((acc, [key, slot]) => {
    // The hour suffix is appended last, so split on the LAST separator — a date string never
    // contains '_', but splitting on the first one would break if the key format ever grows a
    // prefix, and this costs nothing.
    const sep = key.lastIndexOf('_');
    if (sep <= 0) return acc; // malformed key: not a day, never a throw
    const date = key.slice(0, sep);
    const count = slot?.availableCount ?? 0;
    const current = acc.get(date) ?? 0;
    if (count > current) acc.set(date, count);
    else if (!acc.has(date)) acc.set(date, current);
    return acc;
  }, new Map<string, number>());

  return dates.map((date) => peaks.get(date) ?? 0);
}
