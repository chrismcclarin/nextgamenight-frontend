import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
  getBrightness,
  getContrastColor,
  getEventTileTextColor,
  getTextStyle,
  getSubtitleStyle,
  isDarkBackground,
  isUnsetBackgroundColor,
  lightTintGroupBackgroundColor,
  resolveGroupBackgroundColor,
  SUBTEXT_MUTED_ON_LIGHT,
} from './colorUtils';
import { contrastRatio, lStar } from './wcag';

/**
 * Phase 88-22 / D-28. The defect these lock down: a group with no background
 * colour resolved to literal white and got it applied as an INLINE background,
 * which beats the themed `bg-surface-*` class — so the card rendered white
 * inside the dark UI and its muted secondary line became nearly invisible.
 *
 * The contract is therefore two-sided:
 *   1. no group colour  -> no inline background at all (theme wins), and text
 *      comes from `var(--color-content-*)` tokens;
 *   2. a real group colour -> the brightness algorithm is untouched, including
 *      the two tiers that are unreachable with today's all-dark presets (D-29).
 */

const UNSET_VALUES = [null, undefined, '', '#ffffff', '#FFFFFF', '#fff', '#FFF', '  #ffffff  '];

describe('isUnsetBackgroundColor', () => {
  it.each(UNSET_VALUES)('treats %p as unset', (value) => {
    expect(isUnsetBackgroundColor(value)).toBe(true);
  });

  it.each(['#1e1e2e', '#172554', '#14332a', '#fffffe'])('treats %p as a real colour', (value) => {
    expect(isUnsetBackgroundColor(value)).toBe(false);
  });

  it('does not throw on a non-string', () => {
    // The cast is the point: the contract says string, the guard exists anyway
    // because this value comes off an API response.
    expect(isUnsetBackgroundColor(42 as unknown as string)).toBe(true);
  });
});

describe('resolveGroupBackgroundColor', () => {
  it.each(UNSET_VALUES)('returns null for %p so the themed class wins', (value) => {
    expect(resolveGroupBackgroundColor(value)).toBeNull();
  });

  it('passes a real group colour through untouched', () => {
    expect(resolveGroupBackgroundColor('#3b1030')).toBe('#3b1030');
  });
});

describe('getTextStyle — no group colour (D-28)', () => {
  it.each(UNSET_VALUES)('returns a content token, never literal white, for %p', (value) => {
    const style = getTextStyle(false, value);
    expect(style.color).toBe('var(--color-content-primary)');
    expect(style.textShadow).toBe('none');
    expect(style.WebkitTextStroke).toBeUndefined();
  });

  it('still uses the outlined white treatment behind a background image', () => {
    const style = getTextStyle(true, null);
    expect(style.color).toBe('#ffffff');
    expect(style.WebkitTextStroke).toBeTruthy();
  });
});

describe('getSubtitleStyle — no group colour (D-28, the half that was missed)', () => {
  it.each(UNSET_VALUES)('returns the secondary content token for %p', (value) => {
    const style = getSubtitleStyle(false, value);
    expect(style.color).toBe('var(--color-content-secondary)');
    expect(style.textShadow).toBe('none');
  });
});

describe('getEventTileTextColor — no group colour', () => {
  it.each(UNSET_VALUES)('returns the primary content token for %p', (value) => {
    expect(getEventTileTextColor(value)).toBe('var(--color-content-primary)');
  });

  it('still returns tile blue on a light colour and white on a dark one', () => {
    expect(getEventTileTextColor('#e5e7eb')).toBe('#1e40af');
    expect(getEventTileTextColor('#1e1e2e')).toBe('#ffffff');
  });
});

describe('the brightness algorithm is untouched (D-29)', () => {
  it('computes the W3C weighted brightness', () => {
    expect(getBrightness('#000000')).toBe(0);
    expect(getBrightness('#ffffff')).toBe(255);
    // (255*299 + 0 + 0) / 1000
    expect(getBrightness('#ff0000')).toBeCloseTo(76.245, 3);
  });

  it('returns the light default for unusable input', () => {
    expect(getBrightness('nope')).toBe(255);
    expect(getBrightness(null)).toBe(255);
  });

  it('keeps both currently-unreachable light tiers alive', () => {
    // brightness > 180 tier: subtle light outline
    expect(getSubtitleStyle(false, '#f3f4f6').color).toBe('#374151');
    // 128 < brightness <= 180 tier: the softer medium-light shade
    expect(getSubtitleStyle(false, '#9ca3af').color).toBe('#4b5563');
    // dark tier
    expect(getSubtitleStyle(false, '#1e1e2e').color).toBe('rgba(255, 255, 255, 0.95)');
  });

  it('keeps the three title tiers distinct', () => {
    expect(getTextStyle(false, '#f3f4f6').textShadow).toContain('-1px -1px 2px rgba(255, 255, 255, 0.8)');
    expect(getTextStyle(false, '#9ca3af').textShadow).toBe('1px 1px 3px rgba(255, 255, 255, 0.9)');
    expect(getTextStyle(false, '#1e1e2e').color).toBe('#ffffff');
  });

  it('getContrastColor is unchanged for real colours', () => {
    expect(getContrastColor('#f3f4f6')).toBe('#1f2937');
    expect(getContrastColor('#1e1e2e')).toBe('#ffffff');
  });
});


/* ---------------------------------------------------------------------------
 * Phase 88.3 (D-08/D-09, Req 9) — the light-mode group tint.
 *
 * The presets are read OUT OF `GroupSettings.js` rather than restated here, on
 * purpose. A restated copy drifts silently: the whole point of the
 * `isDarkBackground(preset) === true` pin below is that a future preset edit
 * must red THIS file, and it can only do that if this file reads the shipped
 * array.
 * ------------------------------------------------------------------------- */

const PRESET_SOURCE = fs.readFileSync(
  path.resolve(__dirname, '../app/components/GroupSettings.js'),
  'utf8',
);

const PRESETS: { name: string; value: string }[] = (() => {
  const block = PRESET_SOURCE.match(
    /const DEFAULT_BACKGROUND_COLORS = \[([\s\S]*?)\];/,
  );
  if (!block) throw new Error('DEFAULT_BACKGROUND_COLORS not found in GroupSettings.js');
  return [...block[1].matchAll(/\{\s*name:\s*'([^']+)',\s*value:\s*'(#[0-9a-fA-F]{6})'\s*\}/g)].map(
    (m) => ({ name: m[1], value: m[2] }),
  );
})();

/**
 * The owner-ruled tint strength (2026-08-25, plan adversarial review round 2 —
 * amended from 0.87 because at 0.87 the eight presets had converged to pairwise
 * 1.01:1 and were no longer told apart). SPEC Req 9's acceptance floor moved
 * with it, from `L* >= 85` to `L* >= 75`.
 */
const T = 0.7;
const L_STAR_FLOOR = 75;

describe('lightTintGroupBackgroundColor — Phase 88.3 D-09', () => {
  it('reads all eight shipped presets out of GroupSettings.js', () => {
    // anti-vacuity: every per-preset assertion below is an it.each over this list
    expect(PRESETS).toHaveLength(8);
  });

  it.each(UNSET_VALUES)('returns null for %p so the themed surface still wins (D-28)', (value) => {
    expect(lightTintGroupBackgroundColor(value)).toBeNull();
  });

  it.each([
    42 as unknown as string,
    {} as unknown as string,
    [] as unknown as string,
    'not-a-colour',
    '#12',
    '#12345',
    '#1234567',
    '#gggggg',
    'rgb(1,2,3)',
  ])('returns null and does not throw for malformed input %p', (value) => {
    expect(() => lightTintGroupBackgroundColor(value)).not.toThrow();
    expect(lightTintGroupBackgroundColor(value)).toBeNull();
  });

  it.each(PRESETS)('$name tints to a well-formed 6-digit hex', ({ value }) => {
    expect(lightTintGroupBackgroundColor(value)).toMatch(/^#[0-9a-f]{6}$/);
  });

  it.each(PRESETS)(`$name clears the amended SPEC Req 9 floor (L* >= ${L_STAR_FLOOR})`, ({ value }) => {
    const tinted = lightTintGroupBackgroundColor(value);
    expect(lStar(tinted)).toBeGreaterThanOrEqual(L_STAR_FLOOR);
  });

  it.each(PRESETS)('$name lands in getTextStyle’s brightness > 180 tier (D-29 fulfilled)', ({ value }) => {
    // Asserted PER PRESET rather than inferred from the L* floor: at t = 0.70 the
    // margin over 180 is only ~8-11 points (it was ~46-47 at the previously-ruled
    // 0.87), so a preset edit could flip a tile into the dark-text tier without
    // ever breaking the L* assertion above.
    const tinted = lightTintGroupBackgroundColor(value);
    expect(getBrightness(tinted)).toBeGreaterThan(180);
    expect(getTextStyle(false, tinted).color).toBe('#1f2937');
  });

  it.each(PRESETS)('$name keeps the muted pole above 4.5:1 on its own tint (R2-6)', ({ value }) => {
    // #6b7280, the pre-repoint pole, measures 2.5-2.65 here and FAILS.
    const tinted = lightTintGroupBackgroundColor(value);
    expect(contrastRatio(SUBTEXT_MUTED_ON_LIGHT, tinted)).toBeGreaterThanOrEqual(4.5);
  });

  it('re-points the muted-on-light pole to the darker slate (R2-6)', () => {
    expect(SUBTEXT_MUTED_ON_LIGHT).toBe('#374151');
  });

  it('reproduces the owner-ruled t = 0.70 measurement table exactly', () => {
    const measured = Object.fromEntries(
      PRESETS.map(({ name, value }) => [name, lightTintGroupBackgroundColor(value)]),
    );
    expect(measured).toEqual({
      Charcoal: '#bcbcc0',
      Slate: '#bcbfc4',
      Navy: '#b9becc',
      Indigo: '#bcbbc9',
      Forest: '#b9c2bf',
      Wine: '#c4b7c1',
      Espresso: '#c0bcb9',
      Storm: '#bebebf',
    });
  });

  it('asks isUnsetBackgroundColor about the STORED value, never the rendered one (Pitfall 8)', () => {
    // A legacy #fefefe is a REAL colour that happens to tint to exactly white.
    // Re-checking "is unset?" on the rendered ground would strip that group's
    // background entirely — hence the JSDoc rule and this test.
    expect(isUnsetBackgroundColor('#fefefe')).toBe(false);
    expect(lightTintGroupBackgroundColor('#fefefe')).toBe('#ffffff');
    expect(isUnsetBackgroundColor(lightTintGroupBackgroundColor('#fefefe'))).toBe(true);
  });

  it('clamps t into [0, 1] and defaults to the owner-ruled 0.70', () => {
    expect(lightTintGroupBackgroundColor('#000000', -5)).toBe('#000000');
    expect(lightTintGroupBackgroundColor('#000000', 5)).toBe('#ffffff');
    expect(lightTintGroupBackgroundColor('#000000', 0)).toBe('#000000');
    expect(lightTintGroupBackgroundColor('#000000', 1)).toBe('#ffffff');
    expect(lightTintGroupBackgroundColor('#1e1e2e')).toBe(
      lightTintGroupBackgroundColor('#1e1e2e', T),
    );
  });

  it('accepts a hex with or without the leading # and either case', () => {
    expect(lightTintGroupBackgroundColor('1e1e2e')).toBe('#bcbcc0');
    expect(lightTintGroupBackgroundColor('#1E1E2E')).toBe('#bcbcc0');
    expect(lightTintGroupBackgroundColor('  #1e1e2e  ')).toBe('#bcbcc0');
  });
});

describe('every shipped preset is a DARK ground (pins plan 11 Task 2’s light arm)', () => {
  // Plan 11 Task 2 builds a dark-ground text arm for the groupHomePage header on
  // the assumption that every value in DEFAULT_BACKGROUND_COLORS is dark. If a
  // future palette edit ever ships a genuinely light preset, that assumption
  // becomes wrong silently — the header would paint white-on-light. This test is
  // the tripwire: it must go red HERE, in the shared colour module, before plan
  // 11's light-arm code inherits the wrong premise.
  it.each(PRESETS)('$name ($value) is dark, so the dark-ground text arm applies', ({ value }) => {
    expect(isDarkBackground(value)).toBe(true);
  });
});
