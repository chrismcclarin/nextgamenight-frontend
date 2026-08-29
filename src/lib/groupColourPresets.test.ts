/**
 * Phase 88.3.1 plan 03 — the palette's floors, pinned.
 *
 * `88.3.1-UI-SPEC.md` §10.1 is a table of machine-checkable assertions and this file is that
 * table, executed. Every number the phase decided from — the ΔE2000 minima, the OKLCH hue gaps,
 * the two L* bands, the 104-cell contrast matrix, the 8:1 card ink and its 85% rung — is either
 * asserted here or is not asserted anywhere.
 *
 * WHY IT EXISTS. The palette this set replaces measured ΔE2000 **1.62** apart in light mode —
 * sub-JND, which is why the owner could not tell three of the eight swatches apart on his phone
 * (88.3 UAT test 9a, the finding that created this phase). Nothing in the repo noticed, because
 * nothing measured it. That is the failure mode this file exists to make impossible: a future
 * edit that quietly closes two presets back up reds here.
 *
 * FLOORS, NOT ACTUALS (`88.3.1-RESEARCH.md` Pitfall 6). Every quantity is asserted as a FLOOR or
 * a RANGE with the measured actual recorded in a comment beside it. A `toBe(10.48)` would red on
 * a fourth-decimal difference in someone's constants and the "fix" would look like relaxing the
 * guard. The one deliberate exception is test 14, which pins measured values in BOTH directions
 * on purpose — see its own header.
 *
 * Fixture hex (the poles, the page, the swatch boundary) lives in this `.test.` file rather than
 * in `groupColourPresets.ts`, in the idiom `wcag.test.ts:19-23` established: a `.test.` file is
 * already outside `rawColorValues.test.ts`'s scanned population (`src/test-utils/sourceScan.ts`
 * `sourceFiles`), and these values are measurement inputs, not palette data.
 *
 * This file is registered in `.github/workflows/ci.yml`'s `drift-gate-registry` step with a
 * floor of 12 `it(` blocks (AMENDMENT Z, plan 88.3.1-01). That loop counts `^\s*(it|test)\(`
 * only — an `it.each(` block does NOT count toward the floor, which is why every block below is
 * a plain `it(`.
 */
import { describe, expect, it } from 'vitest';

import { getBrightness } from './colorUtils';
import { deltaE2000, oklch } from './colourDistance';
import { GROUP_COLOUR_PRESETS, PRESET_IDS, presetByName } from './groupColourPresets';
import { lStar } from './wcag';

type Theme = 'light' | 'dark';
type Preset = (typeof GROUP_COLOUR_PRESETS)[number];

const THEMES: readonly Theme[] = ['light', 'dark'];

/** The theme's GROUND — the band (dark) or the surface (light). */
const ground = (preset: Preset, theme: Theme): string =>
  theme === 'light' ? preset.light : preset.dark;

/** Every unordered pair of presets. 8 choose 2 = 28; test 0 proves the loop really makes 28. */
function presetPairs(): { a: Preset; b: Preset; label: string }[] {
  const out: { a: Preset; b: Preset; label: string }[] = [];
  for (let i = 0; i < GROUP_COLOUR_PRESETS.length; i += 1) {
    for (let j = i + 1; j < GROUP_COLOUR_PRESETS.length; j += 1) {
      const a = GROUP_COLOUR_PRESETS[i];
      const b = GROUP_COLOUR_PRESETS[j];
      out.push({ a, b, label: `${a.name}/${b.name}` });
    }
  }
  return out;
}

/** ΔE2000, with `null` turned into a LOUD failure rather than a silent `NaN` comparison. */
function distance(a: string, b: string): number {
  const d = deltaE2000(a, b);
  if (d === null) throw new Error(`deltaE2000 returned null for ${a} vs ${b} — unparseable hex`);
  return d;
}

/** CIE L*, same treatment. */
function lightness(hex: string): number {
  const l = lStar(hex);
  if (l === null) throw new Error(`lStar returned null for ${hex}`);
  return l;
}

/** The eight OKLCH hues for a theme, in table order. */
function hues(theme: Theme): number[] {
  return GROUP_COLOUR_PRESETS.map((preset) => {
    const value = oklch(ground(preset, theme));
    if (value === null) throw new Error(`oklch returned null for ${ground(preset, theme)}`);
    return value.h;
  });
}

/**
 * Gaps between adjacent hues ROUND THE WHEEL, including the wrap-around gap.
 *
 * A naive sorted-diff produces seven gaps and misses the largest/smallest pair entirely, which
 * is the pair most likely to be the binding one. It would also pass vacuously if the set ever
 * collapsed onto one side of the wheel.
 */
function hueGapsRoundTheWheel(theme: Theme): number[] {
  const sorted = [...hues(theme)].sort((a, b) => a - b);
  return sorted.map((h, i) => (i === 0 ? h + 360 - sorted[sorted.length - 1] : h - sorted[i - 1]));
}

// --- Fixtures, each with its provenance (the `wcag.test.ts:25-52` convention) ---------------

/**
 * `--color-bg-page` light, `globals.css:708` (warm-200). Measured L* **89.59**.
 * Test 6 compares the light band against this on purpose — see the note there.
 */
const PAGE_LIGHT = '#e8e0d8';

describe('the eight-preset palette — shape and identity (UI-SPEC §10.1 tests 1-2)', () => {
  it('0. ANTI-VACUITY: the pair loop really produces 28 comparisons per theme, and none is null', () => {
    // Without this, a filter bug that dropped presets, or a `deltaE2000` that returned `null`
    // and got coerced, would leave tests 3 and 4 green while measuring nothing. This is the
    // same guard `groupColourRendering.test.ts` test 0 exists for.
    const pairs = presetPairs();
    expect(pairs).toHaveLength(28); // 8 choose 2
    expect(new Set(pairs.map((p) => p.label)).size).toBeGreaterThanOrEqual(28);

    for (const theme of THEMES) {
      const measured = pairs.map(({ a, b }) => deltaE2000(ground(a, theme), ground(b, theme)));
      expect(measured).toHaveLength(28);
      expect(measured.filter((d) => typeof d === 'number' && Number.isFinite(d))).toHaveLength(28);
    }

    // ...and the distance function is not dead: an identical pair is 0, a far pair is large.
    expect(distance('#ffffff', '#ffffff')).toBeLessThan(0.0001);
    expect(distance('#ffffff', '#000000')).toBeGreaterThan(50);
  });

  it('1. there are exactly eight presets, in the load-bearing UI-SPEC §2.2 order', () => {
    expect(GROUP_COLOUR_PRESETS).toHaveLength(8);
    // The order IS a decision: it is the picker's `grid-cols-4` reading order (warm -> cool
    // round the hue wheel) AND the tie-break order for the migration's nearest-preset rule
    // (CONTEXT D-02, plan 88.3.1-05). Re-sorting the array re-decides a database migration.
    expect(GROUP_COLOUR_PRESETS.map((p) => p.name).join(',')).toEqual(
      'red,orange,amber,green,teal,blue,violet,rose',
    );
    // PRESET_IDS is DERIVED from the table, never retyped — this proves it has not been
    // hand-edited into disagreement with the source of truth.
    expect([...PRESET_IDS]).toEqual(GROUP_COLOUR_PRESETS.map((p) => p.name));
    // The backend's `GROUP_COLOUR_PRESET_IDS` (`utils/groupColourPresets.js`, plan 88.3.1-02)
    // asserts this exact string in its own suite. The two repos cannot import each other, so
    // asserting the same order on both sides is the only mechanism that catches a divergence.
  });

  it('2. every preset is well formed: eight lowercase ids, six lowercase 6-digit hexes each', () => {
    const HEX = /^#[0-9a-f]{6}$/;
    for (const preset of GROUP_COLOUR_PRESETS) {
      expect(preset.name).toMatch(/^[a-z]+$/);
      expect(preset.label.length).toBeGreaterThanOrEqual(3);
      // The label is what the picker renders and (plan 88.3.1-07 AMENDMENT G2) what is printed
      // UNDER each swatch — so it must be a real word, not the id echoed back in lower case.
      expect(preset.label).toEqual(preset.name[0].toUpperCase() + preset.name.slice(1));
      for (const value of [
        preset.dark,
        preset.light,
        preset.inkDark,
        preset.inkLight,
        preset.mutedDark,
        preset.mutedLight,
      ]) {
        expect(value).toMatch(HEX);
      }
    }
    // Ids are unique — a duplicate would make one preset unreachable through `presetByName`
    // and silently unstorable.
    expect(new Set(GROUP_COLOUR_PRESETS.map((p) => p.name)).size).toBeGreaterThanOrEqual(8);
    // ...and every id really resolves, so the Map was built from the same array it indexes.
    for (const preset of GROUP_COLOUR_PRESETS) {
      expect(presetByName(preset.name)).toEqual(preset);
    }
  });
});

describe('distinctness and hue spacing — SPEC Reqs 1 and 2 (UI-SPEC §10.1 tests 3-5)', () => {
  it('3. all 28 LIGHT-surface pairs are at least ΔE2000 5 apart', () => {
    const pairs = presetPairs();
    const measured = pairs.map(({ a, b, label }) => ({
      label,
      d: distance(a.light, b.light),
    }));
    expect(measured).toHaveLength(28); // anti-vacuity: the floor below must cover all 28

    const worst = measured.reduce((lo, m) => (m.d < lo.d ? m : lo));
    // FLOOR is SPEC Req 2's 5. Actual min **10.4807** (violet/rose), median 27.53, max 48.53 —
    // verified 2026-08-29 against `./colourDistance`, UI-SPEC §2.3. Five closest: violet/rose
    // 10.48, red/rose 12.32, blue/violet 13.70, orange/amber 13.71, amber/green 14.37. The
    // palette this replaced measured 1.62 here, which is sub-JND (88.3 UAT 9a).
    for (const m of measured) {
      expect(m.d, `light ${m.label} is only ΔE2000 ${m.d.toFixed(2)} apart`).toBeGreaterThanOrEqual(5);
    }
    // A second, TIGHTER floor at 2x Req 2, so a change that halves the set's separation reds
    // here rather than sliding quietly down to 5.01.
    expect(worst.d, `closest light pair is ${worst.label}`).toBeGreaterThanOrEqual(10);
  });

  it('4. all 28 DARK-band pairs are at least ΔE2000 5 apart', () => {
    const pairs = presetPairs();
    const measured = pairs.map(({ a, b, label }) => ({ label, d: distance(a.dark, b.dark) }));
    expect(measured).toHaveLength(28);

    const worst = measured.reduce((lo, m) => (m.d < lo.d ? m : lo));
    // Actual min **10.3223** (violet/rose), median 30.03, max 54.50 — UI-SPEC §2.3. Shipped
    // today: 4.66. Five closest: violet/rose 10.32, blue/violet 11.29, orange/amber 13.13,
    // red/orange 16.45, red/rose 16.78.
    for (const m of measured) {
      expect(m.d, `dark ${m.label} is only ΔE2000 ${m.d.toFixed(2)} apart`).toBeGreaterThanOrEqual(5);
    }
    expect(worst.d, `closest dark pair is ${worst.label}`).toBeGreaterThanOrEqual(10);
  });

  it('5. OKLCH hue gaps round the wheel clear 30 degrees in BOTH themes', () => {
    // The gap sequences as measured 2026-08-29 (UI-SPEC §2.3 prints them rounded):
    //   light: 46.7, 47.3, 37.6, 46.6, 50.4, 50.8, 43.3, 37.3  -> min **37.33** (violet->rose)
    //   dark:  48.4, 43.8, 37.9, 46.4, 54.8, 51.3, 40.3, 37.1  -> min **37.11** (violet->rose)
    // The binding minimum across both themes is the DARK one. Earlier revisions of the spec
    // printed these as "35 / 37"; they were recomputed exactly on the shipped hexes, so a test
    // written to "35" cannot fail on a rounding artefact.
    for (const theme of THEMES) {
      const gaps = hueGapsRoundTheWheel(theme);
      // Eight gaps, not seven: the WRAP-AROUND gap is included. A naive sorted-diff misses the
      // largest/smallest pair, which is exactly the pair most likely to be binding.
      expect(gaps).toHaveLength(8);
      // The gaps must close the circle, which is what proves the wrap term is real.
      expect(gaps.reduce((s, g) => s + g, 0)).toBeGreaterThanOrEqual(359.99);
      expect(gaps.reduce((s, g) => s + g, 0)).toBeLessThanOrEqual(360.01);
      for (const gap of gaps) {
        expect(gap, `${theme} hue gap ${gap.toFixed(1)} is under SPEC Req 1's 30 degrees`).toBeGreaterThanOrEqual(30);
      }
    }
  });
});

describe('the two deliberate band exceptions — SPEC Req 1 (UI-SPEC §10.1 tests 6-7)', () => {
  it('6. every LIGHT surface sits in L* [88, 89.5] — BELOW the page, on purpose', () => {
    /*
     * INLINE NOTE, copied verbatim from `88.3.1-UI-SPEC.md` §10.1 test 6:
     *
     *   "The light band sits ~1 L* BELOW the page `#e8e0d8` (L* 89.6) BY OWNER DECISION —
     *   CONTEXT D-07 round 3, 2026-08-28: he compared both bands rendered side by side and
     *   picked the lower one, 'the right side has more definition around the background'. The
     *   winning axis was chroma (+21-25% on Red/Blue/Violet), not lightness; page separation
     *   measured 1.03-1.04:1 either way. An earlier revision of this test asserted `[90, 96]`
     *   and `>= 89.6`. Do NOT 'restore' it — that would silently revert an owner decision. See
     *   UI-SPEC §2.1 row 7 and §2.6."
     *
     * The page constant is a named local below rather than an implied 89.6 so the comparison
     * this test makes is VISIBLE: the assertion is `< the page`, and that is the reversal.
     */
    const pageLStar = lightness(PAGE_LIGHT); // measured 89.59
    expect(pageLStar).toBeGreaterThanOrEqual(89.5);
    expect(pageLStar).toBeLessThanOrEqual(89.7);

    // Actual band **88.22-88.57** (UI-SPEC §2.3 prints 88.2-88.6).
    for (const preset of GROUP_COLOUR_PRESETS) {
      const l = lightness(preset.light);
      expect(l, `${preset.name} light L* ${l.toFixed(2)}`).toBeGreaterThanOrEqual(88);
      expect(l, `${preset.name} light L* ${l.toFixed(2)}`).toBeLessThanOrEqual(89.5);
      // The reversed assertion, stated against the page itself.
      expect(l, `${preset.name} light L* ${l.toFixed(2)} is NOT below the page`).toBeLessThan(pageLStar);
    }
  });

  it('7. every DARK band sits in L* [12, 25] — the top widened for `green`, on purpose', () => {
    /*
     * The dark band is 14.5-24.6, WIDER AT THE TOP than SPEC Req 1's "L* ~ 12-20" target.
     * That is owner-directed (UI-SPEC §2.1 row 5, round 2: "make the green a little brighter"),
     * because Green and Teal read too close on swatches and tiles. Green had to CROSS Teal
     * (L* 19.4) rather than stop short of it — measured Green/Teal ΔE2000 as Green climbs is
     * 19.88 at L* 15.7, 19.54 at 20.3, 20.48 at 22.7, 21.24 at 24.6, so the halfway house is
     * the worst point on the curve.
     *
     * WHAT CAPS IT AT 24.6, and it is not the ΔE metric: the dark `content-muted` pole
     * `#b8a898` (`globals.css:1547`) on the green band measures 5.86:1 at L* 19.0, **4.89:1 at
     * 24.6**, 4.51:1 at 27.0 and **4.39:1 — a SPEC Req 3 FAIL — at 27.7**. Test 8 asserts that
     * 4.89 row. Nobody may brighten green further without re-running UI-SPEC §2.4 in full.
     * Do NOT "correct" green back inside 12-20; that silently re-creates the 88.3 complaint.
     */
    const byName = Object.fromEntries(
      GROUP_COLOUR_PRESETS.map((p) => [p.name, lightness(p.dark)]),
    );
    // Actual band **14.49-24.63**.
    for (const preset of GROUP_COLOUR_PRESETS) {
      const l = byName[preset.name];
      expect(l, `${preset.name} dark L* ${l.toFixed(2)}`).toBeGreaterThanOrEqual(12);
      expect(l, `${preset.name} dark L* ${l.toFixed(2)}`).toBeLessThanOrEqual(25);
    }
    // The exception, asserted in its own right: green is the top of the band and it is ABOVE
    // teal. If a future edit puts green back under teal this reds, which is the point.
    expect(byName.green).toBeGreaterThanOrEqual(24);
    expect(byName.green).toBeGreaterThanOrEqual(byName.teal + 4);
    // ...and every OTHER band stays inside 14.5-19.5, so the exception stays a single row.
    for (const preset of GROUP_COLOUR_PRESETS) {
      if (preset.name === 'green') continue;
      expect(byName[preset.name], `${preset.name} dark L*`).toBeLessThanOrEqual(19.5);
    }
  });
});

describe('brightness tiers — the `getTextStyle` fork (UI-SPEC §10.1 test 11)', () => {
  it('11. every light surface is W3C-brighter than 180 and every dark band is 128 or under', () => {
    // `colorUtils.js:403-429` forks on W3C brightness: `> 180` takes the near-black-text tier,
    // `<= 128` takes the white-text tier. Actual **210.7-226.6** light and **31.7-47.2** dark,
    // i.e. margins of 31-47 and 81-96 points, where 88.3's tints cleared 180 by only 8-11.
    //
    // The MIDDLE tier (`128 < brightness <= 180`) is unreachable from this table by
    // construction, and survives for a different reason than D-29 predicted: it is the tier a
    // stored LEGACY/custom hex falls into through the `lightTintGroupBackgroundColor(..., 0.70)`
    // fallback. Keep all three tiers — deleting them is a decision, not a cleanup.
    for (const preset of GROUP_COLOUR_PRESETS) {
      expect(getBrightness(preset.light), `${preset.name} light brightness`).toBeGreaterThan(180);
      expect(getBrightness(preset.dark), `${preset.name} dark brightness`).toBeLessThanOrEqual(128);
    }
    // Anti-vacuity: `getBrightness` is live and ordered, not returning a constant.
    expect(getBrightness('#ffffff')).toBeGreaterThan(getBrightness('#000000'));
  });
});
