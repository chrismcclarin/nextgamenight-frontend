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
import { addWeeks, parseISO, startOfWeek, subWeeks } from 'date-fns';
import {
  resolveInitialHeatmapWeek,
  resolveWeekNav,
  createParticipant,
  withRowIds,
  prepareEventData,
  remapCustomParticipantRef,
} from './eventFormUtils';

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

// ---------------------------------------------------------------------------
// Phase 88.1-01 (D-08 Layer 1) — resolveWeekNav
//
// THE REGRESSION THESE EXIST TO CATCH: the week-nav rule shipped as an inline closure
// inside createEvent's `onWeekChange` prop, so NOTHING exercised it — ROADMAP's own note
// said the existing pins "will NOT catch a broken nav handler". Phase 88.1 swaps the
// calendar under that prop from react-big-calendar to WeekGrid; if the skip rule or the
// clamp is lost in the rewrite, the symptom is either a refetch storm on every day-view
// tap or a backend 400 on an out-of-range weekStart — neither visible to any other test.
//
// Same fixed-clock constants as above, so these never drift with the wall clock:
// TODAY_MONDAY = 2026-07-20, MIN_WEEK = 2026-06-29 (-3w), MAX_WEEK = 2026-10-12 (+12w).
// ---------------------------------------------------------------------------
const nav = (dateStr: string | Date, currentMonday: Date = TODAY_MONDAY) =>
  resolveWeekNav({
    date: typeof dateStr === 'string' ? parseISO(dateStr) : dateStr,
    currentMonday,
    minWeek: MIN_WEEK,
    maxWeek: MAX_WEEK,
  });

describe('resolveWeekNav — moves the anchor to the navigated week', () => {
  it('returns the target week\'s Monday when navigating to a DIFFERENT week', () => {
    // 2026-08-05 is a Wednesday; its Monday is 2026-08-03.
    expect(iso(nav('2026-08-05'))).toBe('2026-08-03');
  });

  it('honours Monday-start: a Sunday resolves to the PRECEDING Monday', () => {
    // 2026-08-09 is a Sunday. With weekStartsOn:1 it belongs to the 2026-08-03 week,
    // NOT the 2026-08-10 one — an off-by-one here shifts the whole heatmap fetch.
    expect(iso(nav('2026-08-09'))).toBe('2026-08-03');
  });

  it('normalises any weekday of the target week to the same Monday', () => {
    const monday = iso(nav('2026-08-03'));
    expect(iso(nav('2026-08-06'))).toBe(monday);
    expect(iso(nav('2026-08-09'))).toBe(monday);
  });
});

describe('resolveWeekNav — same-week no-op (day-view nav must not refetch)', () => {
  it('returns null for a mid-week date inside the current week (the day-view case)', () => {
    // Stepping Tue -> Wed in day view fires onWeekChange with a new DATE but the same
    // WEEK. Re-anchoring here would refire the heatmap fetch on every day tap.
    expect(nav('2026-07-22')).toBeNull();
  });

  it('returns null for the current Monday itself', () => {
    expect(nav(TODAY_MONDAY)).toBeNull();
  });

  it('returns null for the Sunday that closes the current week', () => {
    // 2026-07-26 is the Sunday of the 2026-07-20 week under weekStartsOn:1.
    expect(nav('2026-07-26')).toBeNull();
  });

  it('is relative to the CURRENT anchor, not to today', () => {
    // When the user has already navigated forward, "same week" means the week they are
    // looking at. Navigating back to today's week from there IS a real change.
    const augustMonday = parseISO('2026-08-03');
    expect(nav('2026-08-05', augustMonday)).toBeNull();
    expect(iso(nav('2026-07-22', augustMonday))).toBe(iso(TODAY_MONDAY));
  });
});

describe('resolveWeekNav — clamping (must not send an out-of-range weekStart)', () => {
  it('returns null for a week before the -3 week floor', () => {
    expect(nav('2026-01-14')).toBeNull();
  });

  it('returns null for a week after the +12 week ceiling', () => {
    expect(nav('2027-06-02')).toBeNull();
  });

  it('accepts the exact boundary weeks', () => {
    // Off-by-one on a clamp is the failure mode — both edges must be INSIDE.
    expect(iso(nav(MIN_WEEK))).toBe(iso(MIN_WEEK));
    expect(iso(nav(MAX_WEEK))).toBe(iso(MAX_WEEK));
  });

  it('rejects the weeks immediately outside each boundary', () => {
    expect(nav(subWeeks(MIN_WEEK, 1))).toBeNull();
    expect(nav(addWeeks(MAX_WEEK, 1))).toBeNull();
  });

  it('accepts a mid-week date that resolves INTO a boundary week', () => {
    // 2026-07-05 is the Sunday of the MIN_WEEK (2026-06-29) week.
    expect(iso(nav('2026-07-05'))).toBe(iso(MIN_WEEK));
  });
});

// ---------------------------------------------------------------------------
// Phase 88-33 Task 2 (WI-F2) — draft row identity + winner/picked-by attribution
// ---------------------------------------------------------------------------
describe('withRowIds / createParticipant — stable draft identity', () => {
  it('mints a distinct id per row and leaves existing ids alone', () => {
    const a = createParticipant('', 'Gina', false);
    const b = createParticipant('', 'Gina', false);
    expect(a._rowId).toBeTruthy();
    expect(b._rowId).toBeTruthy();
    // Two guests with the SAME name still get different identities (fork 3).
    expect(a._rowId).not.toBe(b._rowId);

    const [kept, minted] = withRowIds([a, { username: 'Hal' }]);
    expect(kept._rowId).toBe(a._rowId);
    expect(minted._rowId).toBeTruthy();
  });

  it('never leaks the draft id into a submitted payload', () => {
    const prepared = prepareEventData({
      participants: [
        createParticipant('user-1', 'Alice', true),
        createParticipant('', 'Gina', false),
      ],
    });
    expect(JSON.stringify(prepared)).not.toContain('_rowId');
    expect(prepared.custom_participants[0]).not.toHaveProperty('_rowId');
    expect(prepared.participants[0]).not.toHaveProperty('_rowId');
  });
});

describe('remapCustomParticipantRef — attribution survives a removal + undo', () => {
  const rows = (...names: string[]) => names.map((n) => ({ username: n, user_id: '' }));

  it('rebases a custom winner reference after an EARLIER row is removed', () => {
    // Draft: [Gina, Hal, Ivy]; the winner is Ivy at select-position 2.
    const before = rows('Gina', 'Hal', 'Ivy');
    const winner = `custom_2_Ivy`;
    expect(remapCustomParticipantRef(winner, before)).toBe('custom_2_Ivy');

    // Remove Hal — Ivy is now at position 1. Without the rebase the stored
    // value matches no option and the select silently blanks the winner.
    const afterRemove = rows('Gina', 'Ivy');
    const rebased = remapCustomParticipantRef(winner, afterRemove);
    expect(rebased).toBe('custom_1_Ivy');

    // Undo restores Hal at his old index — and the reference comes back too.
    const afterUndo = rows('Gina', 'Hal', 'Ivy');
    expect(remapCustomParticipantRef(rebased, afterUndo)).toBe('custom_2_Ivy');
  });

  it('drops the reference when the referenced person is the one removed', () => {
    expect(remapCustomParticipantRef('custom_1_Hal', rows('Gina', 'Ivy'))).toBeNull();
  });

  it('leaves a real user_id reference untouched', () => {
    expect(remapCustomParticipantRef('user-uuid-1', rows('Gina'))).toBe('user-uuid-1');
    expect(remapCustomParticipantRef(null, rows('Gina'))).toBeNull();
  });

  // ACCEPTED-WITH-REASON (triage A1, owner-ruled 2026-08-20). Duplicates are
  // deliberately allowed (fork 3) and winner/picked-by attribution stays
  // NAME-keyed, so with two same-named guests the re-link matches the FIRST
  // occurrence. This pin exists so a future reader sees a recorded decision
  // rather than a regression. Identity-keyed attribution is future schema work.
  it('DOCUMENTED: with two same-named guests, attribution matches the FIRST occurrence', () => {
    const twoGarys = rows('Gary', 'Hal', 'Gary');
    expect(remapCustomParticipantRef('custom_2_Gary', twoGarys)).toBe('custom_0_Gary');
  });
});
