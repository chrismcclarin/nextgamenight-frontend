// Regression pins for availabilityColor.ts (C-009).
// Pins the EXACT class-string outputs of the two VERBATIM-extracted functions at
// every boundary. Assumption A5: do NOT assert a converged scheme — PRIM-01
// (Phase 84) converges them; these tests are the net it refactors against.
import {
  CALENDAR_WASH_RAMP,
  calendarWashColor,
  intensityColor,
  mergedCellColor,
  preferenceColor,
} from './availabilityColor';

describe('availabilityColor — intensityColor (yellow→orange→red intensity)', () => {
  // maxPossible = totalMembers * 1.5 = 7.5; percentage = (count + pref*0.5)/7.5 * 100
  it('returns the empty-cell classes when participantCount is 0', () => {
    expect(intensityColor(0, 0, 5)).toBe('bg-surface-elevated border-line');
  });

  it('maps <=25% to yellow-200', () => {
    // 1/7.5 = 13.3%
    expect(intensityColor(1, 0, 5)).toBe('bg-yellow-200 border-yellow-400');
  });

  it('maps the exact 25% boundary to yellow-200', () => {
    // 1.875/7.5 = 25%
    expect(intensityColor(1, 1.75, 5)).toBe('bg-yellow-200 border-yellow-400');
  });

  it('maps >25% and <=50% to yellow-400', () => {
    // 3/7.5 = 40%
    expect(intensityColor(3, 0, 5)).toBe('bg-yellow-400 border-yellow-500');
  });

  it('maps the exact 50% boundary to yellow-400', () => {
    // 3.75/7.5 = 50%
    expect(intensityColor(3, 1.5, 5)).toBe('bg-yellow-400 border-yellow-500');
  });

  it('maps >50% and <=75% to orange-400', () => {
    // 4/7.5 = 53.3%
    expect(intensityColor(4, 0, 5)).toBe('bg-orange-400 border-orange-500');
  });

  it('maps the exact 75% boundary to orange-400', () => {
    // 5.625/7.5 = 75%
    expect(intensityColor(5, 1.25, 5)).toBe('bg-orange-400 border-orange-500');
  });

  it('maps >75% to red-500', () => {
    // 6/7.5 = 80%
    expect(intensityColor(6, 0, 5)).toBe('bg-red-500 border-red-600');
  });
});

describe('availabilityColor — mergedCellColor (green availability gradient)', () => {
  it('returns the empty-cell classes when availableCount is 0', () => {
    expect(mergedCellColor(0, 5)).toBe('bg-surface-elevated text-content-muted');
  });

  it('returns the empty-cell classes when totalMembers is 0', () => {
    expect(mergedCellColor(3, 0)).toBe('bg-surface-elevated text-content-muted');
  });

  it('maps ratio <=0.2 to green-100', () => {
    // 1/5 = 0.2
    expect(mergedCellColor(1, 5)).toBe('bg-green-100 text-green-800');
  });

  it('maps ratio >0.2 and <=0.4 to green-200', () => {
    // 2/5 = 0.4
    expect(mergedCellColor(2, 5)).toBe('bg-green-200 text-green-800');
  });

  it('maps ratio >0.4 and <=0.6 to green-300', () => {
    // 3/5 = 0.6
    expect(mergedCellColor(3, 5)).toBe('bg-green-300 text-green-900');
  });

  it('maps ratio >0.6 and <=0.8 to green-400', () => {
    // 4/5 = 0.8
    expect(mergedCellColor(4, 5)).toBe('bg-green-400 text-green-900');
  });

  it('maps ratio >0.8 to green-500', () => {
    // 5/5 = 1.0
    expect(mergedCellColor(5, 5)).toBe('bg-green-500 text-white');
  });
});

describe('availabilityColor — calendarWashColor (translucent calendar variant, 88-23)', () => {
  // Pins the DERIVED alphas, not just the shape. If the derivation in availabilityColor.ts is
  // touched, these five strings are what has to be re-argued -- they are the owner-ruled output
  // of plan 88-23 Task 1 (option-a: keep the wash), and the calendar legend renders from the
  // same array, so a change here changes what the legend claims too.
  it('derives exactly five wash steps, lightest to darkest', () => {
    expect(CALENDAR_WASH_RAMP).toEqual([
      'rgba(34, 197, 94, 0.15)',
      'rgba(34, 197, 94, 0.21)',
      'rgba(34, 197, 94, 0.29)',
      'rgba(34, 197, 94, 0.42)',
      'rgba(34, 197, 94, 0.55)',
    ]);
  });

  it('stays translucent at the darkest step so event blocks read through it', () => {
    // The whole point of option-a over consuming the opaque mergedCellColor.
    expect(CALENDAR_WASH_RAMP[CALENDAR_WASH_RAMP.length - 1]).not.toMatch(/,\s*1\)$/);
  });

  it('returns undefined (no background at all) when availableCount is 0', () => {
    expect(calendarWashColor(0, 5)).toBeUndefined();
  });

  it('returns undefined (no background at all) when totalMembers is 0', () => {
    expect(calendarWashColor(3, 0)).toBeUndefined();
  });

  it('maps ratio <=0.2 to the lightest wash', () => {
    // 1/5 = 0.2
    expect(calendarWashColor(1, 5)).toBe('rgba(34, 197, 94, 0.15)');
  });

  it('maps ratio >0.2 and <=0.4 to the second wash step', () => {
    // 2/5 = 0.4
    expect(calendarWashColor(2, 5)).toBe('rgba(34, 197, 94, 0.21)');
  });

  it('maps ratio >0.4 and <=0.6 to the third wash step', () => {
    // 3/5 = 0.6
    expect(calendarWashColor(3, 5)).toBe('rgba(34, 197, 94, 0.29)');
  });

  it('maps ratio >0.6 and <=0.8 to the fourth wash step', () => {
    // 4/5 = 0.8
    expect(calendarWashColor(4, 5)).toBe('rgba(34, 197, 94, 0.42)');
  });

  it('maps ratio >0.8 to the darkest wash step', () => {
    // 5/5 = 1.0
    expect(calendarWashColor(5, 5)).toBe('rgba(34, 197, 94, 0.55)');
  });

  it('shares its thresholds with the canonical mergedCellColor ramp', () => {
    // Same buckets, different opacity -- that is the entire sanctioned divergence.
    const canonical = [1, 2, 3, 4, 5].map((n) => mergedCellColor(n, 5));
    const wash = [1, 2, 3, 4, 5].map((n) => calendarWashColor(n, 5));
    expect(new Set(canonical).size).toBe(5);
    expect(wash).toEqual([...CALENDAR_WASH_RAMP]);
  });
});

describe('availabilityColor — preferenceColor (write-cell preference enum, D-05)', () => {
  // Byte-identical to the UI-SPEC locked write-grid class table. Lifted VERBATIM
  // from TimeSlotCell.js getBackgroundColor (lines 23-29); the disabled branch
  // returns the FULL UI-SPEC string so opacity/cursor live in one place.
  it("maps 'preferred' to green-300", () => {
    expect(preferenceColor('preferred')).toBe('bg-green-300');
  });

  it("maps 'if-need-be' to yellow-300", () => {
    expect(preferenceColor('if-need-be')).toBe('bg-yellow-300');
  });

  it('maps null (unselected) to the elevated/hover empty-cell classes', () => {
    expect(preferenceColor(null)).toBe('bg-surface-elevated hover:bg-surface-card-hover');
  });

  it('returns the full disabled string (opacity + cursor) regardless of preference', () => {
    expect(preferenceColor('preferred', true)).toBe(
      'bg-surface-elevated opacity-50 cursor-not-allowed'
    );
    expect(preferenceColor(null, true)).toBe(
      'bg-surface-elevated opacity-50 cursor-not-allowed'
    );
  });
});
