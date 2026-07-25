// Regression pins for resolveInitialHeatmapWeek (bugfix 2026-07-25).
//
// THE BUG THIS EXISTS TO CATCH: opening create-event by tapping a day on the group
// calendar rendered NO availability tint, for any week other than the current one.
// `calendarInitialDate` followed `prefillDate` to the tapped day's week while the heatmap
// anchor was unconditionally `null` ("today's Monday"), so the calendar and the fetch
// disagreed. `heatmapLookup` is date-keyed, so a different week matched zero slots and
// every cell rendered untinted. `onWeekChange` fires only on user navigation, never on
// mount, so it did not self-correct until the user clicked Next/Prev.
//
// The old behavior would pass any test that only exercised the no-prefill path — which is
// exactly why it shipped. The first test below is the one that would have failed.

import { describe, it, expect } from 'vitest';
import { addWeeks, startOfWeek, subWeeks } from 'date-fns';
import { resolveInitialHeatmapWeek } from './eventFormUtils';

// A fixed "today" so the pins never drift with the wall clock.
// 2026-07-25 is a Saturday; its Monday is 2026-07-20.
const TODAY_MONDAY = startOfWeek(new Date(Date.UTC(2026, 6, 25, 12, 0, 0)), { weekStartsOn: 1 });
const MIN_WEEK = subWeeks(TODAY_MONDAY, 3);
const MAX_WEEK = addWeeks(TODAY_MONDAY, 12);

const resolve = (prefillDate: string | null, promptId: string | null = null) =>
  resolveInitialHeatmapWeek({ prefillDate, promptId, minWeek: MIN_WEEK, maxWeek: MAX_WEEK });

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('resolveInitialHeatmapWeek — the day-tap blank-heatmap regression', () => {
  it('anchors to the PREFILL week, not today, when the tapped day is in a future week', () => {
    // 2026-08-05 is a Wednesday; its Monday is 2026-08-03 — three weeks after TODAY_MONDAY.
    // Pre-fix this returned null (today's Monday) and the tint went blank.
    expect(iso(resolve('2026-08-05'))).toBe('2026-08-03');
  });

  it('anchors to the PREFILL week when the tapped day is in a past week', () => {
    // 2026-07-08 is a Wednesday; its Monday is 2026-07-06 — two weeks before TODAY_MONDAY,
    // still inside the -3 week floor.
    expect(iso(resolve('2026-07-08'))).toBe('2026-07-06');
  });

  it('returns the tapped day\'s own Monday when the tap is already in the current week', () => {
    // The accidental pass case: pre-fix this "worked" because both anchors agreed,
    // which is why the owner saw correct tinting on the current week only.
    expect(iso(resolve('2026-07-23'))).toBe(iso(TODAY_MONDAY));
  });

  it('normalises any weekday in the week to that week\'s Monday', () => {
    // Monday, Wednesday and Sunday of the same week must all collapse to one anchor.
    const monday = iso(resolve('2026-08-03'));
    expect(iso(resolve('2026-08-05'))).toBe(monday);
    expect(iso(resolve('2026-08-09'))).toBe(monday); // Sunday — weekStartsOn:1 boundary
  });
});

describe('resolveInitialHeatmapWeek — clamping (must not send an out-of-range weekStart)', () => {
  it('falls back to null when the tapped week is before the -3 week floor', () => {
    // Backend rejects out-of-range weeks; a failed fetch is worse than a missing tint.
    expect(resolve('2026-01-14')).toBeNull();
  });

  it('falls back to null when the tapped week is after the +12 week ceiling', () => {
    expect(resolve('2027-06-02')).toBeNull();
  });

  it('accepts the exact boundary weeks', () => {
    expect(iso(resolve(iso(MIN_WEEK)!))).toBe(iso(MIN_WEEK));
    expect(iso(resolve(iso(MAX_WEEK)!))).toBe(iso(MAX_WEEK));
  });
});

describe('resolveInitialHeatmapWeek — paths that must keep returning null', () => {
  it('returns null with no prefillDate (the plain "add new game event" path)', () => {
    // This is the path that always worked; it must keep working.
    expect(resolve(null)).toBeNull();
  });

  it('returns null when promptId is set, even with a prefillDate', () => {
    // The poll path anchors to the prompt's own weekStart and the fetch effect returns
    // early without reading this anchor. Seeding it here must not disturb that.
    expect(resolve('2026-08-05', 'prompt-123')).toBeNull();
  });

  it('returns null when both are absent', () => {
    expect(resolve(null, null)).toBeNull();
  });
});
