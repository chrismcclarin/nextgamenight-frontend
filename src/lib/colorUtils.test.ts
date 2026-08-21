import { describe, it, expect } from 'vitest';
import {
  getBrightness,
  getContrastColor,
  getEventTileTextColor,
  getTextStyle,
  getSubtitleStyle,
  isUnsetBackgroundColor,
  resolveGroupBackgroundColor,
} from './colorUtils';

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
