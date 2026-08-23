// Pins for the phone strip's per-day roll-up (Phase 88.1 plan 12).
//
// The load-bearing pin is the third one: the fixture is chosen so MAX, SUM and MEAN are three
// DIFFERENT numbers, so an implementation that quietly sums or averages goes red instead of
// coincidentally agreeing. UI-SPEC prescribes MAX; see the DECISION marker in dayAggregate.ts.

import { describe, expect, it } from 'vitest';
import { maxAvailabilityPerDay, type DayAggregateSlot } from './dayAggregate';

/** Build the scheduler's `${localDate}_${localHour}` -> slot map from a compact fixture. */
const lookupOf = (entries: Array<[string, number, number]>) =>
  new Map<string, DayAggregateSlot>(
    entries.map(([date, hour, availableCount]) => [`${date}_${hour}`, { availableCount }])
  );

const MON = '2026-07-20';
const TUE = '2026-07-21';
const WED = '2026-07-22';

describe('maxAvailabilityPerDay', () => {
  it('returns the peak when a day has exactly one populated slot', () => {
    const lookup = lookupOf([[MON, 19, 3]]);
    expect(maxAvailabilityPerDay(lookup, [MON])).toEqual([3]);
  });

  it('returns 0 for a day with no entries at all', () => {
    const lookup = lookupOf([[MON, 19, 3]]);
    expect(maxAvailabilityPerDay(lookup, [TUE])).toEqual([0]);
  });

  it('returns the MAXIMUM — never the sum (6) and never the mean (2)', () => {
    // 1 / 4 / 1 is chosen so all three candidate aggregations differ: max 4, sum 6, mean 2.
    const lookup = lookupOf([
      [MON, 11, 1],
      [MON, 19, 4],
      [MON, 21, 1],
    ]);
    const [peak] = maxAvailabilityPerDay(lookup, [MON]);
    expect(peak).toBe(4);
    expect(peak).not.toBe(6);
    expect(peak).not.toBe(2);
  });

  it('preserves the INPUT date order, not the lookup insertion order', () => {
    const lookup = lookupOf([
      [WED, 20, 5],
      [MON, 20, 1],
      [TUE, 20, 3],
    ]);
    expect(maxAvailabilityPerDay(lookup, [MON, TUE, WED])).toEqual([1, 3, 5]);
    expect(maxAvailabilityPerDay(lookup, [WED, TUE, MON])).toEqual([5, 3, 1]);
  });

  it('does not throw when some requested days are missing from the lookup', () => {
    const lookup = lookupOf([[TUE, 20, 2]]);
    expect(() => maxAvailabilityPerDay(lookup, [MON, TUE, WED])).not.toThrow();
    expect(maxAvailabilityPerDay(lookup, [MON, TUE, WED])).toEqual([0, 2, 0]);
  });

  it('treats an empty lookup and an empty date list as zero-length/zero-valued, not as errors', () => {
    expect(maxAvailabilityPerDay(new Map(), [MON, TUE])).toEqual([0, 0]);
    expect(maxAvailabilityPerDay(lookupOf([[MON, 19, 3]]), [])).toEqual([]);
  });

  it('tolerates a slot with no availableCount field (treated as 0, not NaN)', () => {
    const lookup = new Map<string, DayAggregateSlot>([
      [`${MON}_19`, {}],
      [`${MON}_20`, { availableCount: 2 }],
    ]);
    expect(maxAvailabilityPerDay(lookup, [MON])).toEqual([2]);
  });
});
