// Pins for the phone strip's per-day roll-up (Phase 88.1 plan 12).
//
// The load-bearing pin is the third one: the fixture is chosen so MAX, SUM and MEAN are three
// DIFFERENT numbers, so an implementation that quietly sums or averages goes red instead of
// coincidentally agreeing. UI-SPEC prescribes MAX; see the DECISION marker in dayAggregate.ts.

import { describe, expect, it } from 'vitest';
import { maxAvailabilityPerDay, peakHourForDay, type DayAggregateSlot } from './dayAggregate';

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

// -------------------------------------------------------------------------------------------
// Plan 88.1-18 (SPEC Req 13): the DAY-VIEW landing rule.
//
// Same non-vacuity idiom as the block above — every fixture is chosen so a WRONG rule produces a
// DIFFERENT number, and the wrong answers are asserted against explicitly. Two cases carry the
// requirement: the TIE (earliest hour wins, matching `createEvent.js:114-119`) and NO DATA (null,
// which the caller turns into "do not scroll" — the owner's 2026-08-24 ruling, chosen over falling
// back to the week peak). `0` is a legitimate hour, so `null` is asserted as `null`, never falsy.
// -------------------------------------------------------------------------------------------
describe('peakHourForDay', () => {
  it('returns the hour of a day with exactly one populated slot', () => {
    const lookup = lookupOf([[MON, 19, 3]]);
    expect(peakHourForDay(lookup, MON)).toBe(19);
  });

  it('returns the hour of the MAXIMUM count — not the earliest populated hour, not the latest', () => {
    // 1 / 4 / 1 at 11 / 19 / 21: a "first populated hour" rule answers 11 and a "last" rule 21.
    const lookup = lookupOf([
      [MON, 11, 1],
      [MON, 19, 4],
      [MON, 21, 1],
    ]);
    const peak = peakHourForDay(lookup, MON);
    expect(peak).toBe(19);
    expect(peak).not.toBe(11);
    expect(peak).not.toBe(21);
  });

  it('breaks a TIE to the EARLIEST hour (parity with createEvent.js:114-119)', () => {
    const lookup = lookupOf([
      [MON, 13, 4],
      [MON, 20, 4],
    ]);
    const peak = peakHourForDay(lookup, MON);
    expect(peak).toBe(13);
    expect(peak).not.toBe(20);
  });

  it('returns null for a day absent from the lookup entirely', () => {
    const lookup = lookupOf([[MON, 19, 3]]);
    expect(peakHourForDay(lookup, TUE)).toBeNull();
  });

  it('returns null — not 0 — when the day is present but every count is 0', () => {
    // `0` is a real hour and would be a real landing (midnight, clamped to the top of the grid by
    // the caller). Returning it here would be indistinguishable from "peak at 00:00".
    const lookup = lookupOf([
      [MON, 11, 0],
      [MON, 19, 0],
    ]);
    const peak = peakHourForDay(lookup, MON);
    expect(peak).toBeNull();
    expect(peak).not.toBe(0);
  });

  it('treats a slot with no availableCount field as 0, never NaN', () => {
    const lookup = new Map<string, DayAggregateSlot>([
      [`${MON}_19`, {}],
      [`${MON}_20`, { availableCount: 2 }],
    ]);
    expect(peakHourForDay(lookup, MON)).toBe(20);

    // …and a day made entirely of field-less slots is no-data, not hour-NaN.
    const empties = new Map<string, DayAggregateSlot>([
      [`${TUE}_11`, {}],
      [`${TUE}_12`, {}],
    ]);
    expect(peakHourForDay(empties, TUE)).toBeNull();
  });

  it('never lets another day in the same lookup leak into the answer', () => {
    // TUE carries the lookup-wide maximum; asking for MON must not see it.
    const lookup = lookupOf([
      [MON, 13, 2],
      [TUE, 20, 9],
      [WED, 11, 7],
    ]);
    const peak = peakHourForDay(lookup, MON);
    expect(peak).toBe(13);
    expect(peak).not.toBe(20);
    expect(peak).not.toBe(11);
    // The sibling days still answer for themselves.
    expect(peakHourForDay(lookup, TUE)).toBe(20);
    expect(peakHourForDay(lookup, WED)).toBe(11);
  });

  it('returns an hour outside the grid window honestly — clamping is the caller\'s job', () => {
    // The scheduler grid starts at 10:00. This function reports 3; `EventScheduler` clamps.
    const lookup = lookupOf([[MON, 3, 5]]);
    expect(peakHourForDay(lookup, MON)).toBe(3);
  });

  it('ignores malformed keys instead of throwing (sibling behaviour)', () => {
    const lookup = new Map<string, DayAggregateSlot>([
      ['nonsense', { availableCount: 9 }],
      [`_5`, { availableCount: 9 }],
      [`${MON}_14`, { availableCount: 1 }],
    ]);
    expect(() => peakHourForDay(lookup, MON)).not.toThrow();
    expect(peakHourForDay(lookup, MON)).toBe(14);
  });

  it('tolerates an empty lookup', () => {
    expect(peakHourForDay(new Map(), MON)).toBeNull();
  });
});
