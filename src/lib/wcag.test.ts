import { describe, expect, it } from 'vitest';

import { getBrightness } from './colorUtils';
import { blend, contrastRatio, deltaLStar, lStar, parseHex, relativeLuminance } from './wcag';

/**
 * Phase 88.3 plan 01 — the receipts.
 *
 * `88.3-UI-SPEC.md` section 5.11 is a 50-row measured contrast ledger, and EVERY floor the
 * phase asserts downstream (Gate A in plan 05, Gate C in plan 12) is read off it. The ledger
 * is only as trustworthy as the calculator that produced it, and its own "validation
 * receipts" paragraph is explicit that the calculator had to reproduce a set of previously
 * published figures exactly before any new number was trusted.
 *
 * This suite is that check, mechanised. A drift in the sRGB transfer function or in the
 * luminance coefficients would shift every floor in the ledger by a little, silently, and
 * nothing else in the repo would notice. It reds HERE instead.
 *
 * Fixture hex lives in this file rather than in `wcag.ts` on purpose: `wcag.ts` holds maths
 * only and therefore must NOT go on `rawColorValues.test.ts`'s `HEX_EXEMPT` map, while a
 * `.test.` file is already outside that scan's population (`src/test-utils/sourceScan.ts`
 * `sourceFiles`).
 */

/** The ledger prints ratios to 2dp. "Rounds to X" is the claim, so assert exactly that. */
const round2 = (value: number | null): number | null =>
  value === null ? null : Number(value.toFixed(2));

/** The ledger prints L-star to 1dp (UI-SPEC section 5.1 table, `:190-196`). */
const round1 = (value: number | null): number | null =>
  value === null ? null : Number(value.toFixed(1));

// --- Palette fixtures, each with its UI-SPEC provenance ---------------------------------
const WHITE = '#ffffff'; // --color-bg-card, both the light card and the ledger's L* 100 datum
const WARM_100 = '#f5f0ea'; // --color-bg-page (Req 1's NEW value)
const WARM_50 = '#faf8f5'; // --color-bg-hover / --color-bg-sunken (and Req 1's OLD page value)
const WARM_200 = '#e8e0d8'; // --color-bg-card-hover
const AMBER_800 = '#92400e'; // --color-accent-text (light)
const AMBER_500 = '#f59e0b'; // --color-accent (fill)
const PURPLE_700 = '#42536e'; // the focus ring that WON (CONTEXT D-05)
const PURPLE_600 = '#536889'; // the focus ring that was REJECTED (CONTEXT D-05)
const GREEN_800 = '#166534'; // status success text, light
const GREEN_TINT = '#dcf1e4'; // status success tint ground, light
const NAVY_TINT_087 = '#e1e3e9'; // Navy preset `#172554` rendered at t = 0.87 (UI-SPEC 5.10.2)
const BLACK = '#000000'; // the groupHomePage dim's overlay colour (UI-SPEC 5.10.3)

describe('contrastRatio — the published validation receipts (UI-SPEC section 5.11)', () => {
  it('row 11: accent-text amber-800 on the white card is 7.09', () => {
    expect(round2(contrastRatio(AMBER_800, WHITE))).toBe(7.09);
  });

  it('row 37: focus ring purple-700 on the amber-500 accent fill is 3.63 — the tightest ring pair', () => {
    // 3.63 clears the 3.0 non-text floor. This is the row that decided D-05.
    expect(round2(contrastRatio(PURPLE_700, AMBER_500))).toBe(3.63);
    expect(contrastRatio(PURPLE_700, AMBER_500)).toBeGreaterThanOrEqual(3.0);
  });

  it('CONTEXT D-05: purple-600 on the same fill is 2.64 — why the lighter ring was rejected', () => {
    expect(round2(contrastRatio(PURPLE_600, AMBER_500))).toBe(2.64);
    // The whole point of the rejection: it does NOT clear 3.0.
    expect(contrastRatio(PURPLE_600, AMBER_500)).toBeLessThan(3.0);
  });

  it('rows 22-33: light success text on its own tint is 6.03', () => {
    expect(round2(contrastRatio(GREEN_800, GREEN_TINT))).toBe(6.03);
  });

  it('is symmetric in its arguments — the ratio has no foreground/background order', () => {
    expect(contrastRatio(AMBER_800, WHITE)).toBe(contrastRatio(WHITE, AMBER_800));
  });

  it('is exactly 1 for a colour against itself and 21 for black on white', () => {
    expect(contrastRatio(WHITE, WHITE)).toBeCloseTo(1, 10);
    expect(contrastRatio(BLACK, WHITE)).toBeCloseTo(21, 10);
  });
});

describe('lStar / deltaLStar — Req 1 surface separation (UI-SPEC section 5.1, rows 1 and 3)', () => {
  /*
   * READ THIS BEFORE "FIXING" A FAILURE HERE.
   *
   * The UI-SPEC's delta-L-star COLUMN is `100 - L*(rounded to 1dp)`, not a 2dp rounding of
   * the raw delta. Its own table prints warm-100 at L* 95.0 and warm-50 at L* 97.7
   * (`88.3-UI-SPEC.md:190` and `:195`), and 100 - 95.0 = 5.00, 100 - 97.7 = 2.30. The raw
   * deltas are 4.977 and 2.347.
   *
   * Both are pinned below, deliberately: the LEDGER form because that is the number the SPEC
   * publishes and downstream plans quote, and the RAW form because that is what
   * `deltaLStar()` actually returns and what Gate A will compare against a floor. Asserting
   * only the ledger form would hide a real transfer-function drift behind a rounding step;
   * asserting only the raw form would let the ledger and the code drift apart in print.
   *
   * Req 1's floor is delta-L-star >= 4.0, and 4.977 clears it either way — the distinction
   * changes no conclusion in the ledger, only what a test may assert to 2dp.
   */

  it('row 1: the NEW page ground warm-100 separates from the white card by the published 5.00', () => {
    expect(round1(lStar(WHITE))).toBe(100.0);
    expect(round1(lStar(WARM_100))).toBe(95.0);
    expect(round1(lStar(WHITE))! - round1(lStar(WARM_100))!).toBeCloseTo(5.00, 10);
    // ...and the unrounded value the code actually returns.
    expect(deltaLStar(WARM_100, WHITE)).toBeCloseTo(4.977, 3);
    // The floor Req 1 sets, asserted on the raw value.
    expect(deltaLStar(WARM_100, WHITE)).toBeGreaterThanOrEqual(4.0);
  });

  it('row 3: the hover/sunken warm-50 sits at the published 2.30 — distinct, but not a page', () => {
    expect(round1(lStar(WARM_50))).toBe(97.7);
    expect(round1(lStar(WHITE))! - round1(lStar(WARM_50))!).toBeCloseTo(2.30, 10);
    expect(deltaLStar(WARM_50, WHITE)).toBeCloseTo(2.347, 3);
  });

  it('row 2: card-hover warm-200 is the published 10.40 from the card', () => {
    expect(round1(lStar(WARM_200))).toBe(89.6);
    expect(round1(lStar(WHITE))! - round1(lStar(WARM_200))!).toBeCloseTo(10.40, 10);
  });

  it('the three light grounds are ordered card > hover/sunken > page > card-hover', () => {
    expect(lStar(WHITE)!).toBeGreaterThan(lStar(WARM_50)!);
    expect(lStar(WARM_50)!).toBeGreaterThan(lStar(WARM_100)!);
    expect(lStar(WARM_100)!).toBeGreaterThan(lStar(WARM_200)!);
  });

  it('row 43: Navy rendered at t = 0.87 clears the Req 9 floor of L-star >= 85', () => {
    // UI-SPEC section 5.10.2 prints this preset at L* 90.2. (The plan text labelled this
    // fixture "t = 0.70"; the SPEC's own 8-preset table at `:745` puts `#e1e3e9` at t = 0.87.)
    expect(round1(lStar(NAVY_TINT_087))).toBe(90.2);
    expect(lStar(NAVY_TINT_087)).toBeGreaterThanOrEqual(85);
  });

  it('is 0 for a colour against itself and 100 for black against white', () => {
    expect(deltaLStar(WARM_100, WARM_100)).toBe(0);
    expect(deltaLStar(BLACK, WHITE)).toBeCloseTo(100, 10);
  });
});

describe('parseHex — accepted forms', () => {
  it.each([
    ['#fff', [255, 255, 255]],
    ['#FFF', [255, 255, 255]],
    ['#ffffff', [255, 255, 255]],
    ['#FFFFFF', [255, 255, 255]],
    ['  #f5f0ea  ', [245, 240, 234]],
    ['#000000', [0, 0, 0]],
  ] as const)('parses %s', (input, expected) => {
    expect(parseHex(input)).toEqual(expected);
  });

  it.each([
    ['rgb(255, 255, 255)', [255, 255, 255]],
    ['rgba(0, 0, 0, 0)', [0, 0, 0]],
    ['rgba(146, 64, 14, 0.5)', [146, 64, 14]],
    ['RGB(1,2,3)', [1, 2, 3]],
    ['rgb(255 255 255)', [255, 255, 255]],
    ['rgb(255 255 255 / 0.4)', [255, 255, 255]],
  ] as const)('parses the Chromium computed-style form %s', (input, expected) => {
    // Gate C (plan 12) reads `getComputedStyle(...).backgroundColor` straight into this,
    // and Chromium returns the legacy comma form — including `rgba(0, 0, 0, 0)` for a fully
    // transparent element, which is the sentinel the ancestor walk keys on.
    expect(parseHex(input)).toEqual(expected);
  });
});

describe('totality contract (threat T-88.3-02) — garbage in, null out, never a throw', () => {
  const GARBAGE = [null, undefined, 42, '', '   ', 'not-a-colour', '#12', '#gggggg', '#12345', 'rgb(1, 2)', {}, []];

  it.each(GARBAGE)('parseHex(%p) returns null', (value) => {
    expect(parseHex(value)).toBeNull();
  });

  it.each(GARBAGE)('parseHex(%p) does not throw', (value) => {
    expect(() => parseHex(value)).not.toThrow();
  });

  it.each(GARBAGE)('relativeLuminance(%p) / lStar(%p) return null and do not throw', (value) => {
    expect(relativeLuminance(value)).toBeNull();
    expect(lStar(value)).toBeNull();
    expect(() => lStar(value)).not.toThrow();
  });

  it('contrastRatio returns null if EITHER side fails to parse — never a plausible wrong number', () => {
    expect(contrastRatio('#fff', null)).toBeNull();
    expect(contrastRatio(null, '#fff')).toBeNull();
    expect(contrastRatio(null, null)).toBeNull();
    expect(deltaLStar('#fff', 'not-a-colour')).toBeNull();
  });

  it('blend returns null on unparseable colours or a non-finite alpha', () => {
    expect(blend(null, 0.15, WHITE)).toBeNull();
    expect(blend(BLACK, 0.15, 'nope')).toBeNull();
    expect(blend(BLACK, Number.NaN, WHITE)).toBeNull();
  });
});

describe('blend — the composited ledger rows', () => {
  it('the groupHomePage 15% black dim darkens the rendered Navy tint (UI-SPEC section 5.10.3)', () => {
    const dimmed = blend(BLACK, 0.15, NAVY_TINT_087);
    expect(dimmed).not.toBeNull();
    expect(lStar(dimmed)!).toBeLessThan(lStar(NAVY_TINT_087)!);
  });

  it('alpha 0 leaves the ground untouched and alpha 1 replaces it', () => {
    expect(blend(BLACK, 0, NAVY_TINT_087)).toBe(NAVY_TINT_087);
    expect(blend(BLACK, 1, NAVY_TINT_087)).toBe(BLACK);
  });

  it('clamps alpha outside [0, 1] rather than extrapolating past the two colours', () => {
    expect(blend(BLACK, -3, NAVY_TINT_087)).toBe(NAVY_TINT_087);
    expect(blend(BLACK, 42, NAVY_TINT_087)).toBe(BLACK);
  });

  it('returns lowercase #rrggbb that round-trips through parseHex', () => {
    const dimmed = blend(BLACK, 0.15, NAVY_TINT_087)!;
    expect(dimmed).toMatch(/^#[0-9a-f]{6}$/);
    expect(parseHex(dimmed)).not.toBeNull();
  });
});

describe('THE THREE FORMULAS ARE NOT INTERCHANGEABLE — the mechanical guard, not a comment', () => {
  /*
   * The comment in `wcag.ts`'s header says a future "unify the colour maths" cleanup would
   * silently re-tier every user-chosen group colour. A comment cannot fail a build. This can.
   *
   * `colorUtils.js:142-159` is the W3C 299/587/114 PERCEIVED BRIGHTNESS formula on a 0-255
   * scale, and its 128/180 tier thresholds are calibrated to that scale (D-27/D-29,
   * `colorUtils.js:33-38`). WCAG relative luminance is a 0-1 quantity computed through a
   * gamma transfer function. Normalising one onto the other's range does NOT make them
   * agree, and this test is the proof.
   */
  const MID_WARM = '#8c7a6a';

  it('relativeLuminance is not getBrightness/255 in disguise', () => {
    const wcag = relativeLuminance(MID_WARM)!;
    const w3c = getBrightness(MID_WARM) / 255;
    expect(wcag).not.toBeCloseTo(w3c, 2);
    // Direction matters too: the gamma transfer function pulls midtones DOWN relative to
    // the linear 299/587/114 average, so a "unify" pass would systematically over-report
    // how light a mid group colour is.
    expect(wcag).toBeLessThan(w3c);
  });

  it('the two formulas disagree across the whole mid range, not at one lucky sample', () => {
    const samples = ['#8c7a6a', '#7f7f7f', '#4a6fa5', '#a0522d', '#556b2f'];
    for (const sample of samples) {
      expect(relativeLuminance(sample)!).not.toBeCloseTo(getBrightness(sample) / 255, 2);
    }
  });

  it('agreement at the two poles is expected and is NOT evidence they are the same formula', () => {
    // Both formulas are pinned to 0 at black and 1 (255) at white by construction. A future
    // reader spot-checking only white would wrongly conclude they are interchangeable.
    expect(relativeLuminance(WHITE)).toBeCloseTo(getBrightness(WHITE) / 255, 6);
    expect(relativeLuminance(BLACK)).toBeCloseTo(getBrightness(BLACK) / 255, 6);
  });
});
