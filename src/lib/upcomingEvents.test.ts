// Pins for selectUpcomingWithin7Days (Phase 88.1-05, Req-11).
//
// WHAT THESE EXIST TO CATCH: the phone bottom bar's count pill (plan 88.1-08) and the
// sheet body both derive from this one predicate. If the window bounds, the status
// filter or the sort order drift here, the bar advertises a number the sheet does not
// show — which is the exact failure PATTERNS §S5 exists to prevent. These pins are also
// the contract the card's extraction was checked against: the shipped inline block at
// `UpcomingEventsCard.js:123-136` behaved EXACTLY this way, boundary-for-boundary.
//
// Every pin runs against a FIXED clock and never reads the wall clock, so nothing here
// drifts with the calendar (the eventFormUtils.test.ts idiom).

import { describe, it, expect } from 'vitest';
import { selectUpcomingWithin7Days } from './upcomingEvents';

/** A fixed "now": 2026-08-22T12:00:00Z. Its +7d boundary is 2026-08-29T12:00:00Z. */
const NOW = new Date('2026-08-22T12:00:00.000Z');
const SEVEN_DAYS_LATER_ISO = '2026-08-29T12:00:00.000Z';

const ev = (id: string, start_date: string, status?: string | null) => ({
  id,
  start_date,
  ...(status === undefined ? {} : { status }),
});

const ids = (events: Array<{ id: string }>) => events.map((e) => e.id);

describe('selectUpcomingWithin7Days — the window', () => {
  it('excludes an event in the past', () => {
    const past = ev('past', '2026-08-21T12:00:00.000Z');
    expect(ids(selectUpcomingWithin7Days([past], NOW))).toEqual([]);
  });

  it('excludes an event starting EXACTLY at now (lower bound is exclusive)', () => {
    // The shipped predicate is `startDate <= now` -> drop. Flipping this to `<` would
    // make an event that is starting right this second "upcoming".
    const atNow = ev('at-now', NOW.toISOString());
    expect(ids(selectUpcomingWithin7Days([atNow], NOW))).toEqual([]);
  });

  it('includes an event inside the window', () => {
    const inside = ev('inside', '2026-08-25T18:30:00.000Z');
    expect(ids(selectUpcomingWithin7Days([inside], NOW))).toEqual(['inside']);
  });

  it('includes an event EXACTLY at the 7-day boundary (upper bound is inclusive)', () => {
    // The shipped predicate drops only `startDate > sevenDaysLater`, so the boundary is in.
    const boundary = ev('boundary', SEVEN_DAYS_LATER_ISO);
    expect(ids(selectUpcomingWithin7Days([boundary], NOW))).toEqual(['boundary']);
  });

  it('excludes an event one millisecond past the 7-day boundary', () => {
    const justPast = ev('just-past', '2026-08-29T12:00:00.001Z');
    expect(ids(selectUpcomingWithin7Days([justPast], NOW))).toEqual([]);
  });
});

describe('selectUpcomingWithin7Days — the status filter', () => {
  const at = '2026-08-24T19:00:00.000Z';

  it('includes scheduled', () => {
    expect(ids(selectUpcomingWithin7Days([ev('a', at, 'scheduled')], NOW))).toEqual(['a']);
  });

  it('includes in_progress', () => {
    expect(ids(selectUpcomingWithin7Days([ev('a', at, 'in_progress')], NOW))).toEqual(['a']);
  });

  it('excludes cancelled and completed', () => {
    const list = [ev('cancelled', at, 'cancelled'), ev('completed', at, 'completed')];
    expect(ids(selectUpcomingWithin7Days(list, NOW))).toEqual([]);
  });

  it('treats a missing status as scheduled', () => {
    expect(ids(selectUpcomingWithin7Days([ev('no-status', at)], NOW))).toEqual(['no-status']);
  });

  it('treats a null/empty status as scheduled', () => {
    const list = [ev('null-status', at, null), ev('empty-status', at, '')];
    expect(ids(selectUpcomingWithin7Days(list, NOW))).toEqual(['null-status', 'empty-status']);
  });
});

describe('selectUpcomingWithin7Days — ordering and input tolerance', () => {
  it('returns results sorted ascending by start date', () => {
    const list = [
      ev('third', '2026-08-28T09:00:00.000Z'),
      ev('first', '2026-08-22T20:00:00.000Z'),
      ev('second', '2026-08-25T09:00:00.000Z'),
    ];
    expect(ids(selectUpcomingWithin7Days(list, NOW))).toEqual(['first', 'second', 'third']);
  });

  it('does not mutate the caller list (the page owner passes its raw state array)', () => {
    const list = [
      ev('third', '2026-08-28T09:00:00.000Z'),
      ev('first', '2026-08-22T20:00:00.000Z'),
    ];
    selectUpcomingWithin7Days(list, NOW);
    expect(ids(list)).toEqual(['third', 'first']);
  });

  it('returns an empty array for null input', () => {
    expect(selectUpcomingWithin7Days(null, NOW)).toEqual([]);
  });

  it('returns an empty array for undefined input', () => {
    expect(selectUpcomingWithin7Days(undefined, NOW)).toEqual([]);
  });

  it('returns an empty array for an empty list', () => {
    expect(selectUpcomingWithin7Days([], NOW)).toEqual([]);
  });

  it('keeps an unparseable start_date — documenting SHIPPED behaviour, not endorsing it', () => {
    // `new Date('not a date').getTime()` is NaN, and every NaN comparison is false, so
    // such an event falls through both bounds. This is exactly what the inline block in
    // UpcomingEventsCard did before the extraction; the pin exists so the transcription
    // is provably faithful. Changing it is a behaviour decision, not a cleanup.
    expect(ids(selectUpcomingWithin7Days([ev('bad-date', 'not a date')], NOW))).toEqual([
      'bad-date',
    ]);
  });
});
