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

// Phase 88.5 (SPEC Req 3 / D-06 / OWNER RULING 2a) adds a second layer to that: the
// live/future test itself is now ONE exported predicate (`isLiveUpcoming`, composed from
// the status-only `hasLiveStatus`) that BOTH selectors call, and a sibling selector
// (`selectNextUpcoming`) for the hero card. The pins below assert the two selectors
// cannot disagree with the predicate — or with each other — about any single event.

import { describe, it, expect } from 'vitest';
import {
  hasLiveStatus,
  isLiveUpcoming,
  selectNextUpcoming,
  selectUpcomingWithin7Days,
} from './upcomingEvents';

/** A fixed "now": 2026-08-22T12:00:00Z. Its +7d boundary is 2026-08-29T12:00:00Z. */
const NOW = new Date('2026-08-22T12:00:00.000Z');
const NOW_MS = NOW.getTime();
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

  it('EXCLUDES an unparseable start_date (OWNER RULING O1a — Phase 88.5 flipped the shipped passthrough)', () => {
    // THIS PIN WAS FLIPPED, not written fresh. It used to assert the opposite ("keeps an
    // unparseable start_date"), pinning the shipped behaviour where `new Date('not a
    // date').getTime()` is NaN, every NaN comparison is false, and such an event fell
    // through BOTH bounds and was KEPT.
    //
    // Phase 88.5 OWNER RULING O1a excludes unparseable dates EVERYWHERE: both selectors
    // now route their live/future test through `isLiveUpcoming`, which drops NaN
    // explicitly. The reason is this phase's own defect standard — the phone pill COUNTED
    // NaN-dated events that the sheet silently DROPPED, so the number disagreed with the
    // list. Changing this back is a behaviour decision, not a cleanup.
    expect(ids(selectUpcomingWithin7Days([ev('bad-date', 'not a date')], NOW))).toEqual([]);
  });
});

describe('hasLiveStatus — the status-only predicate (OWNER RULING 2a)', () => {
  // Exported so plan 88.5-08's happening-now classification reuses THIS test rather than
  // writing a second inline copy of the status check.
  const at = '2026-08-24T19:00:00.000Z';

  it('is true for scheduled', () => {
    expect(hasLiveStatus(ev('a', at, 'scheduled'))).toBe(true);
  });

  it('is true for in_progress', () => {
    expect(hasLiveStatus(ev('a', at, 'in_progress'))).toBe(true);
  });

  it('is true for a defaulted (missing) status', () => {
    expect(hasLiveStatus(ev('a', at))).toBe(true);
  });

  it('is true for a null or empty status (both default to scheduled)', () => {
    expect(hasLiveStatus(ev('a', at, null))).toBe(true);
    expect(hasLiveStatus(ev('a', at, ''))).toBe(true);
  });

  it('is false for cancelled', () => {
    expect(hasLiveStatus(ev('a', at, 'cancelled'))).toBe(false);
  });

  it('is false for completed', () => {
    expect(hasLiveStatus(ev('a', at, 'completed'))).toBe(false);
  });

  it('does not read the date at all — an unparseable start_date is still live by STATUS', () => {
    // hasLiveStatus is the status half only. The NaN exclusion lives in isLiveUpcoming;
    // keeping the split explicit is what lets 88.5-08 ask the status question on its own.
    expect(hasLiveStatus(ev('bad-date', 'not a date', 'scheduled'))).toBe(true);
  });
});

describe('isLiveUpcoming — the ONE live/future test both selectors call', () => {
  it('is true for a live event in the future', () => {
    expect(isLiveUpcoming(ev('a', '2026-08-25T18:30:00.000Z'), NOW_MS)).toBe(true);
  });

  it('rejects a cancelled event DIRECTLY (not only through a selector)', () => {
    expect(isLiveUpcoming(ev('a', '2026-08-25T18:30:00.000Z', 'cancelled'), NOW_MS)).toBe(false);
  });

  it('rejects an in_progress event whose start has already passed (started is not upcoming)', () => {
    expect(isLiveUpcoming(ev('a', '2026-08-22T11:00:00.000Z', 'in_progress'), NOW_MS)).toBe(false);
  });

  it('rejects an event starting EXACTLY at now (lower bound is exclusive)', () => {
    expect(isLiveUpcoming(ev('at-now', NOW.toISOString()), NOW_MS)).toBe(false);
  });

  it('rejects an unparseable start_date (OWNER RULING O1a)', () => {
    expect(isLiveUpcoming(ev('bad-date', 'not a date'), NOW_MS)).toBe(false);
  });

  it('has NO upper bound of its own — an event 10 days out is still live and upcoming', () => {
    expect(isLiveUpcoming(ev('far', '2026-09-01T12:00:00.000Z'), NOW_MS)).toBe(true);
  });
});

describe('selectNextUpcoming — the hero selector (SPEC Req 3 / D-06)', () => {
  it('returns the single soonest live future event', () => {
    const list = [
      ev('third', '2026-08-28T09:00:00.000Z'),
      ev('first', '2026-08-22T20:00:00.000Z'),
      ev('second', '2026-08-25T09:00:00.000Z'),
    ];
    expect(selectNextUpcoming(list, NOW)?.id).toBe('first');
  });

  it('returns null for an empty list', () => {
    expect(selectNextUpcoming([], NOW)).toBeNull();
  });

  it('returns null for null input', () => {
    expect(selectNextUpcoming(null, NOW)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(selectNextUpcoming(undefined, NOW)).toBeNull();
  });

  it('returns null when every event is past or not live', () => {
    const list = [
      ev('past', '2026-08-21T12:00:00.000Z'),
      ev('cancelled', '2026-08-25T09:00:00.000Z', 'cancelled'),
    ];
    expect(selectNextUpcoming(list, NOW)).toBeNull();
  });

  it('excludes an event starting EXACTLY at now (lower bound exclusive, matching the sibling)', () => {
    expect(selectNextUpcoming([ev('at-now', NOW.toISOString())], NOW)).toBeNull();
  });

  it('RETURNS an event 10 days out — there is no 7-day cap (the difference from the sibling)', () => {
    // This is the whole reason the hero cannot reuse selectUpcomingWithin7Days: that one
    // makes the hero vanish for an event the "Later" list below still names.
    const far = ev('far', '2026-09-01T12:00:00.000Z');
    expect(selectNextUpcoming([far], NOW)?.id).toBe('far');
    expect(ids(selectUpcomingWithin7Days([far], NOW))).toEqual([]);
  });

  it('never returns an unparseable start_date, even as the only candidate', () => {
    expect(selectNextUpcoming([ev('bad-date', 'not a date')], NOW)).toBeNull();
  });

  it('never returns an unparseable start_date, even when it appears FIRST in the array', () => {
    const list = [ev('bad-date', 'not a date'), ev('good', '2026-08-25T09:00:00.000Z')];
    expect(selectNextUpcoming(list, NOW)?.id).toBe('good');
  });

  it('does not mutate the caller list (the page owner passes its raw state array)', () => {
    const list = [
      ev('third', '2026-08-28T09:00:00.000Z'),
      ev('first', '2026-08-22T20:00:00.000Z'),
    ];
    selectNextUpcoming(list, NOW);
    expect(ids(list)).toEqual(['third', 'first']);
  });
});

describe('the two selectors and the predicate cannot disagree (SPEC Req 3)', () => {
  // "Two definitions that can disagree is a defect" — this is that constraint in
  // mechanical form. One shared fixture, one clock, three consumers of one predicate.
  const fixture = [
    ev('past', '2026-08-21T12:00:00.000Z'),
    ev('at-now', NOW.toISOString()),
    ev('soon', '2026-08-23T19:00:00.000Z'),
    ev('cancelled', '2026-08-24T19:00:00.000Z', 'cancelled'),
    ev('in-progress-future', '2026-08-25T19:00:00.000Z', 'in_progress'),
    ev('boundary', SEVEN_DAYS_LATER_ISO),
    ev('far', '2026-09-05T19:00:00.000Z'),
    ev('bad-date', 'not a date'),
  ];

  it('everything the 7-day selector returns is also isLiveUpcoming', () => {
    for (const e of selectUpcomingWithin7Days(fixture, NOW)) {
      expect(isLiveUpcoming(e, NOW_MS)).toBe(true);
    }
  });

  it('anything isLiveUpcoming rejects is returned by NEITHER selector', () => {
    const rejected = fixture.filter((e) => !isLiveUpcoming(e, NOW_MS)).map((e) => e.id);
    expect(rejected).toEqual(['past', 'at-now', 'cancelled', 'bad-date']);

    const within = ids(selectUpcomingWithin7Days(fixture, NOW));
    for (const id of rejected) expect(within).not.toContain(id);
    expect(rejected).not.toContain(selectNextUpcoming(fixture, NOW)?.id);
  });

  it('selectNextUpcoming returns the same event as selectUpcomingWithin7Days[0] when that array is non-empty', () => {
    const within = selectUpcomingWithin7Days(fixture, NOW);
    expect(within.length).toBeGreaterThan(0);
    expect(selectNextUpcoming(fixture, NOW)?.id).toBe(within[0].id);
  });

  it('and still agrees when the only live event is beyond the 7-day window (sibling empty, hero not)', () => {
    const beyond = [ev('far', '2026-09-05T19:00:00.000Z'), ev('bad-date', 'not a date')];
    expect(selectUpcomingWithin7Days(beyond, NOW)).toEqual([]);
    expect(selectNextUpcoming(beyond, NOW)?.id).toBe('far');
  });
});
