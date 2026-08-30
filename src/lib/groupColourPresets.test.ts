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
 * a RANGE with the measured actual recorded in a comment beside it. A `toBe` pinned to an exact 10.48 would red on
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

import {
  getBrightness,
  SUBTEXT_MUTED_ON_DARK,
  SUBTEXT_MUTED_ON_LIGHT,
  SUBTEXT_ON_LIGHT,
  TEXT_ON_DARK,
  TEXT_ON_LIGHT,
} from './colorUtils';
import { deltaE2000, oklch } from './colourDistance';
import { GROUP_COLOUR_PRESETS, PRESET_IDS, presetByName } from './groupColourPresets';
import { blend, contrastRatio, lStar, parseHex } from './wcag';

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

// ============================================================================================
// UI-SPEC §10.1 tests 8-10, plus 13-16 (AMENDMENTS A and B).
//
// Everything below MEASURES rather than greps, so the fixtures are the poles themselves.
// Provenance convention: `wcag.test.ts:25-52` — every literal carries the file and line it is
// declared at, because a pole that silently moves would make this whole matrix measure the
// wrong thing while staying green.
//
// Four poles are IMPORTED from `colorUtils.js` rather than restated, because they are exported
// and importing them is what keeps the matrix honest when one of them moves. The rest are
// restated: `SUBTITLE_DARK_BG` and `TILE_TEXT_LIGHT_BG` are module-private, and a CSS custom
// property cannot be imported into vitest at all.
// ============================================================================================

/** WCAG contrast, with `null` turned into a loud failure rather than a silent `NaN`. */
function contrast(fg: string, bg: string): number {
  const c = contrastRatio(fg, bg);
  if (c === null) throw new Error(`contrastRatio returned null for ${fg} on ${bg}`);
  return c;
}

/** `blend` with the same discipline — the ONE alpha compositor (PATTERNS "Don't hand-roll"). */
function composite(fg: string, alpha: number, bg: string): string {
  const out = blend(fg, alpha, bg);
  if (out === null) throw new Error(`blend returned null for ${fg} @${alpha} over ${bg}`);
  return out;
}

/**
 * Composite a shipped `rgba(255, 255, 255, a)` pole over an opaque ground.
 *
 * The alpha is PARSED OUT OF THE SHIPPED LITERAL rather than hand-copied, so if someone edits
 * `colorUtils.js:67` or `:116` this measures the new value instead of a stale one. Measuring
 * `rgba(255,255,255,0.7)` as if it were opaque white would pass vacuously at a ratio it does
 * not have — that is the whole reason this helper exists.
 */
function compositeWhiteRgba(pole: string, bg: string): string {
  const m = /^rgba\(\s*255\s*,\s*255\s*,\s*255\s*,\s*([0-9.]+)\s*\)$/.exec(pole);
  if (m === null) throw new Error(`not a white rgba pole: ${pole}`);
  return composite('#ffffff', Number(m[1]), bg);
}

// --- The seven LIGHT-surface poles (UI-SPEC §2.4, first table) ------------------------------
// Imported, because they are exported and must not be restated:
//   TEXT_ON_LIGHT          `#1f2937`  colorUtils.js:61,91,103  (= TITLE_DARK / CONTRAST_DARK)
//   SUBTEXT_MUTED_ON_LIGHT `#374151`  colorUtils.js:65,88,106  (= SUBTITLE_VERY_LIGHT_BG)
//   SUBTEXT_ON_LIGHT       `#4b5563`  colorUtils.js:66,105     (= SUBTITLE_MEDIUM_LIGHT_BG)
/** `TILE_TEXT_LIGHT_BG`, `colorUtils.js:70` — module-private, so restated. */
const TILE_TEXT_LIGHT_BG = '#1e40af';
/** token `--color-text-primary` light, `globals.css:864` -> `--warm-900:643`. */
const CONTENT_PRIMARY_LIGHT = '#1a1614';
/** token `--color-text-secondary` light, `globals.css:887` -> `--warm-700:641`. */
const CONTENT_SECONDARY_LIGHT = '#4a3d32';
/** token `--color-text-muted` light, `globals.css:940` -> `--warm-600:640`. THE BINDING ROW. */
const CONTENT_MUTED_LIGHT = '#6b5a4c';

// --- The six DARK-band poles (UI-SPEC §2.4, second table) -----------------------------------
// Imported: TEXT_ON_DARK `#ffffff` (colorUtils.js:62,92,104) and SUBTEXT_MUTED_ON_DARK
// `rgba(255,255,255,0.7)` (colorUtils.js:116).
/** `SUBTITLE_DARK_BG`, `colorUtils.js:67` — module-private, so restated byte-for-byte. */
const SUBTITLE_DARK_BG = 'rgba(255, 255, 255, 0.95)';
/** token `--color-text-primary` dark, `globals.css:1545` -> `--warm-50:608`. */
const CONTENT_PRIMARY_DARK = '#faf8f5';
/** token `--color-text-secondary` dark, `globals.css:1546` -> `--warm-300:632`. */
const CONTENT_SECONDARY_DARK = '#d6cbc0';
/** token `--color-text-muted` dark, `globals.css:1547` -> `--warm-400:633`. THE SECOND ROW. */
const CONTENT_MUTED_DARK = '#b8a898';

/** `--color-border-strong` light, `globals.css:1136` -> `--warm-500:634`. Test 15's boundary. */
const BORDER_STRONG_LIGHT = '#8c7a6a';
/** `--color-border-strong` DARK, `globals.css:1570` -> `--purple-500:568`. Test 15b's boundary. */
const BORDER_STRONG_DARK = '#6b7fa3';
/** `--color-bg-page` light, `globals.css:708` -> `--warm-200:610`. */
const BG_PAGE_LIGHT = '#e8e0d8';
/** `--color-bg-card` light, `globals.css:709`. */
const BG_CARD_LIGHT = '#ffffff';
/** `--color-bg-page` dark, `globals.css:1504` -> `--purple-950:584`. */
const BG_PAGE_DARK = '#161d29';
/** `--color-bg-card` dark, `globals.css:1505` -> `--purple-900:583`. */
const BG_CARD_DARK = '#232d3e';
/** `--color-border` light, `globals.css:1129` -> `--warm-400:633`. The boundary it REPLACED. */
const BORDER_LIGHT = '#b8a898';

/** SPEC Req 3: a hard 4.5:1 on a group-coloured ground, with NO 3:1 large-text allowance. */
const TEXT_FLOOR = 4.5;

describe('text contrast on all 16 grounds — SPEC Req 3 (UI-SPEC §10.1 test 8)', () => {
  it('8. every plain pole clears 4.5:1 on every ground it can meet — 56 light + 48 dark pairings', () => {
    /*
     * THE TWO BINDING ROWS, and they pull in OPPOSITE directions (UI-SPEC §2.4):
     *
     *   light `content-muted` `#6b5a4c` on `orange` `#ffd6b1` = **4.8576:1**, 8.0% of margin.
     *     Any future LOWERING of the light band eats this. Measured sweep: L* 88.4 -> 4.86,
     *     87.0 -> 4.69, 86.0 -> 4.56, 85.5 -> 4.49 FAILS. Roughly 3 L* of headroom, no more.
     *
     *   dark `content-muted` `#b8a898` on `green` `#004511` = **4.8902:1**, 8.7% of margin.
     *     Any future LIFT of the dark green band eats this. 4.39 (FAIL) at L* 27.7.
     *
     * So the light band cannot go down and the dark green band cannot go up. Re-run UI-SPEC
     * §2.4 in full before touching either — the other one is not slack you can spend.
     */
    const lightPoles: { name: string; hex: string }[] = [
      { name: 'TEXT_ON_LIGHT (colorUtils.js:61)', hex: TEXT_ON_LIGHT },
      { name: 'SUBTEXT_MUTED_ON_LIGHT (colorUtils.js:88)', hex: SUBTEXT_MUTED_ON_LIGHT },
      { name: 'SUBTEXT_ON_LIGHT (colorUtils.js:66)', hex: SUBTEXT_ON_LIGHT },
      { name: 'TILE_TEXT_LIGHT_BG (colorUtils.js:70)', hex: TILE_TEXT_LIGHT_BG },
      { name: 'content-primary light (globals.css:864)', hex: CONTENT_PRIMARY_LIGHT },
      { name: 'content-secondary light (globals.css:887)', hex: CONTENT_SECONDARY_LIGHT },
      { name: 'content-muted light (globals.css:940)', hex: CONTENT_MUTED_LIGHT },
    ];
    // The imported poles really are the values UI-SPEC §2.4 measured. If one moves, the matrix
    // below is measuring something else and this line says so first.
    expect([TEXT_ON_LIGHT, SUBTEXT_MUTED_ON_LIGHT, SUBTEXT_ON_LIGHT, TEXT_ON_DARK]).toEqual([
      '#1f2937',
      '#374151',
      '#4b5563',
      '#ffffff',
    ]);
    expect(SUBTEXT_MUTED_ON_DARK).toEqual('rgba(255, 255, 255, 0.7)');

    const lightRows: { row: string; ratio: number }[] = [];
    for (const pole of lightPoles) {
      for (const preset of GROUP_COLOUR_PRESETS) {
        lightRows.push({
          row: `${pole.name} on ${preset.name} light`,
          ratio: contrast(pole.hex, preset.light),
        });
      }
    }
    // ANTI-VACUITY: 7 poles x 8 surfaces. A filter bug that silently dropped a pole would leave
    // a green suite measuring less than it claims.
    expect(lightRows).toHaveLength(56);

    const darkRows: { row: string; ratio: number }[] = [];
    for (const preset of GROUP_COLOUR_PRESETS) {
      // The two `rgba(255,255,255,a)` poles are COMPOSITED over the band before measuring.
      // Uncomposited they measure as opaque white and pass at a ratio they do not have.
      const opaquePoles: { name: string; hex: string }[] = [
        { name: 'TEXT_ON_DARK (colorUtils.js:62)', hex: TEXT_ON_DARK },
        { name: 'SUBTITLE_DARK_BG @0.95 (colorUtils.js:67)', hex: compositeWhiteRgba(SUBTITLE_DARK_BG, preset.dark) },
        { name: 'SUBTEXT_MUTED_ON_DARK @0.7 (colorUtils.js:116)', hex: compositeWhiteRgba(SUBTEXT_MUTED_ON_DARK, preset.dark) },
        { name: 'content-primary dark (globals.css:1545)', hex: CONTENT_PRIMARY_DARK },
        { name: 'content-secondary dark (globals.css:1546)', hex: CONTENT_SECONDARY_DARK },
        { name: 'content-muted dark (globals.css:1547)', hex: CONTENT_MUTED_DARK },
      ];
      for (const pole of opaquePoles) {
        darkRows.push({
          row: `${pole.name} on ${preset.name} dark`,
          ratio: contrast(pole.hex, preset.dark),
        });
      }
    }
    // ANTI-VACUITY: 6 poles x 8 bands. 56 + 48 = the 104 pairings SPEC Req 3 covers.
    expect(darkRows).toHaveLength(48);

    for (const { row, ratio } of [...lightRows, ...darkRows]) {
      expect(ratio, `${row} is only ${ratio.toFixed(4)}:1`).toBeGreaterThanOrEqual(TEXT_FLOOR);
    }

    // `composite` is a null-checking WRAPPER over `./wcag`'s `blend`, not a second compositor
    // (PATTERNS "Don't hand-roll" — there is exactly one alpha compositor in this tree).
    expect(composite('#ffffff', 0.7, '#00274d')).toEqual(blend('#ffffff', 0.7, '#00274d'));

    // The compositing really happened: 70% white on a dark band is nowhere near opaque white's
    // reading. Without this, a broken `compositeWhiteRgba` would just measure white and pass.
    const uncomposited = contrast('#ffffff', GROUP_COLOUR_PRESETS[3].dark);
    const composited = contrast(compositeWhiteRgba(SUBTEXT_MUTED_ON_DARK, GROUP_COLOUR_PRESETS[3].dark), GROUP_COLOUR_PRESETS[3].dark);
    expect(composited).toBeLessThan(uncomposited - 2);

    // The two binding rows, named at the assertion with the direction each moves.
    const bindingLight = contrast(CONTENT_MUTED_LIGHT, GROUP_COLOUR_PRESETS[1].light); // orange
    const bindingDark = contrast(CONTENT_MUTED_DARK, GROUP_COLOUR_PRESETS[3].dark); // green
    expect(bindingLight).toBeGreaterThanOrEqual(4.85); // actual 4.8576 — LOWERING the light band eats this
    expect(bindingLight).toBeLessThanOrEqual(4.87);
    expect(bindingDark).toBeGreaterThanOrEqual(4.88); // actual 4.8902 — LIFTING dark green eats this
    expect(bindingDark).toBeLessThanOrEqual(4.90);
  });
});

describe('the tinted card ink and its 85% rung (UI-SPEC §10.1 tests 9-10, §2.5)', () => {
  it('9. each preset\'s card ink clears 7.5:1 on its OWN ground, in both themes', () => {
    // The ink is SOLVED to 8.0:1 (hue = the ground's hue, chroma to the gamut ceiling up to
    // 0.10, L solved for the ratio), so the floor here is 7.5 with the actual 8.0030-8.0800
    // recorded rather than asserted. Owner decision 2026-08-28: tinted ink on CARDS, "a touch
    // or two darker"; calendar TILES keep the plain poles above. "Darker" was read as TOWARD
    // THE PLAIN POLE, which in dark mode means LIGHTER — his stated reason was that "the
    // white/dark is easier to read" (UI-SPEC §2.5 assumption 2, and a named line in the Req 10
    // phone script). The peer that ships tinted ink (Notion) fails AA doing it at 2.51-4.20:1
    // on 7 of 9 pairs; we do not, because the ink is solved rather than picked by eye.
    let measured = 0;
    for (const preset of GROUP_COLOUR_PRESETS) {
      for (const [ink, own, theme] of [
        [preset.inkLight, preset.light, 'light'],
        [preset.inkDark, preset.dark, 'dark'],
      ] as const) {
        const ratio = contrast(ink, own);
        expect(ratio, `${preset.name} ${theme} ink ${ink} on ${own}`).toBeGreaterThanOrEqual(7.5);
        measured += 1;
      }
    }
    expect(measured).toBeGreaterThanOrEqual(16); // 8 presets x 2 themes, none skipped
  });

  it('10. the same ink at 85% alpha still clears 4.5:1 — and 0.75 would FAIL', () => {
    // The muted/secondary rung is the SAME ink at 85% alpha over its own ground: one derived
    // value, no ninth hand-tuned hex. It is the "Last Game" date and "Duration:" line — the
    // exact text the owner complained about in 88.3, where it had ~1.6:1.
    // Actual **5.5239-6.2835**; worst violet light at 5.5239, which is 23% above the floor.
    let measured = 0;
    for (const preset of GROUP_COLOUR_PRESETS) {
      for (const [ink, own, theme] of [
        [preset.inkLight, preset.light, 'light'],
        [preset.inkDark, preset.dark, 'dark'],
      ] as const) {
        const ratio = contrast(composite(ink, 0.85, own), own);
        expect(ratio, `${preset.name} ${theme} rung @0.85`).toBeGreaterThanOrEqual(TEXT_FLOOR);
        measured += 1;
      }
    }
    expect(measured).toBeGreaterThanOrEqual(16);

    /*
     * "Do not go below 0.85" as a PASSING TEST rather than as prose.
     *
     * UI-SPEC §2.5's sweep, re-measured on the rev3 grounds: 0.75 -> 4.30:1 (FAILS), 0.80 ->
     * 4.88, **0.85 -> 5.52**, 0.90 -> 6.25. The 85% alpha is the one number to change if the
     * rung ever needs re-tuning, and this is the guard rail under it.
     *
     * At 0.75 ALL EIGHT light rungs fail (4.2992 amber .. 4.4379 red). The dark side still
     * passes at 0.75 (5.14-5.27), which is why the counter-assertion is scoped to light: a
     * "both themes fail" claim would be false and would invite someone to weaken the test.
     */
    const at75Light = GROUP_COLOUR_PRESETS.map((preset) =>
      contrast(composite(preset.inkLight, 0.75, preset.light), preset.light),
    );
    expect(at75Light).toHaveLength(8);
    for (const ratio of at75Light) {
      expect(ratio, `a 0.75 light rung measured ${ratio.toFixed(4)} — it should FAIL 4.5`).toBeLessThan(TEXT_FLOOR);
    }
  });

  it('13. AMENDMENT A (M24): every stored muted rung re-derives byte-for-byte from `blend`', () => {
    /*
     * The rung moved INTO the table (`groupColourPresets.ts`) so that `wcag.ts` never becomes a
     * production dependency of the seven client components that import `colorUtils.js`. The
     * cost of storing a derived value is that the literal and its recipe can silently diverge.
     * This is the test that stops that: the recipe is re-run here, with the SAME `blend`, and
     * the result must equal the stored hex exactly.
     *
     * Recipe: mutedDark = blend(inkDark, 0.85, dark); mutedLight = blend(inkLight, 0.85, light)
     * — `wcag.ts:275`, per-channel `bg + (fg - bg) * alpha`, rounded, source-over in sRGB.
     */
    for (const preset of GROUP_COLOUR_PRESETS) {
      expect(composite(preset.inkDark, 0.85, preset.dark), `${preset.name} mutedDark`).toEqual(preset.mutedDark);
      expect(composite(preset.inkLight, 0.85, preset.light), `${preset.name} mutedLight`).toEqual(preset.mutedLight);
    }
    // `blend` itself is live and not an identity function — otherwise the equality above is
    // vacuous. Called directly here, because it is `blend`'s semantics the recipe cites.
    expect(blend('#000000', 0.5, '#ffffff')).toEqual('#808080');
    for (const preset of GROUP_COLOUR_PRESETS) {
      // The rung must actually MOVE off the ink; an alpha of 1.0 would make test 10 measure
      // test 9 twice and both would stay green.
      expect(composite(preset.inkDark, 0.85, preset.dark)).not.toEqual(preset.inkDark);
      expect(composite(preset.inkLight, 0.85, preset.light)).not.toEqual(preset.inkLight);
    }
    // The published worst rung reproduces exactly: violet light at 5.5239 -> UI-SPEC §2.6's
    // "5.52". That reproduction is the transcription check the amendment asked for.
    const violet = GROUP_COLOUR_PRESETS[6];
    expect(violet.name).toEqual('violet');
    const worstRung = contrast(violet.mutedLight, violet.light);
    expect(worstRung).toBeGreaterThanOrEqual(5.52);
    expect(worstRung).toBeLessThanOrEqual(5.53);
  });
});

// --- Colour-vision-deficiency simulation, for tests 14 and 16 --------------------------------
//
// Machado, Oliveira & Fernandes (2009) matrices at severity 1.0, applied in LINEAR RGB —
// applying them in gamma space is the common error and produces different numbers. Method and
// its validation: `.planning/research/COLOUR-VISION-DEFICIENCY-AUDIT-2026-08-29.md`,
// reproducible via `.planning/research/scripts/cvd-audit.js`.
//
// The transfer functions are re-implemented here rather than imported because `wcag.ts` does
// not export a linear-RGB round trip and this is the only consumer. `deltaE2000` and
// `contrastRatio` are still the repo's own (AMENDMENT Y allows a `.test.` file to import them).

const CVD_MATRICES: Record<string, readonly (readonly number[])[]> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};
const CVD_TYPES = ['protanopia', 'deuteranopia', 'tritanopia'] as const;

const toLinear = (channel: number): number => {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};
const toChannel = (linear: number): number => {
  const v = linear <= 0.0031308 ? linear * 12.92 : 1.055 * linear ** (1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(v * 255)));
};

/** Simulate `hex` as seen with `type` dichromacy. Returns an opaque `#rrggbb`. */
function simulate(hex: string, type: (typeof CVD_TYPES)[number]): string {
  const rgb = parseHex(hex);
  if (rgb === null) throw new Error(`simulate: unparseable hex ${hex}`);
  const linear = rgb.map(toLinear);
  return (
    '#' +
    CVD_MATRICES[type]
      .map((row) => row[0] * linear[0] + row[1] * linear[1] + row[2] * linear[2])
      .map((v) => toChannel(Math.max(0, Math.min(1, v))).toString(16).padStart(2, '0'))
      .join('')
  );
}

describe('colour-vision deficiency — the measured reason the swatch labels exist', () => {
  it('14. the palette\'s CVD separation is PINNED at its measured values, in both directions', () => {
    /*
     * AMENDMENT B (M32). This test does NOT impose a floor, and that is deliberate.
     *
     * The owner initially ruled NO on visible swatch labels, then REVERSED it the same day
     * after consulting a colour-blind user, who asked for exactly this mitigation: "they wished
     * for the colors to have names under them". Plan 88.3.1-07 (AMENDMENT G2) ships the labels.
     *
     * So this is not an accepted failure being pinned — it is THE MEASURED REASON THE LABELS
     * EXIST. If a future phase re-solves the palette and the separation improves, someone will
     * argue the labels are redundant; if it gets worse, the labels become more load-bearing.
     * Either way the number must be visible and must not move silently. Shape borrowed from
     * Phase 88.3's Gate A test 49: the assertion encodes the CURRENT value and reds if it moves
     * in EITHER direction.
     *
     * THE CAUSE IS STRUCTURAL AND MEASURED, not an oversight. The light band is solved to
     * L* 88.2-88.6 (owner round-3 pick), so the set's L* spread is **0.35** and the closest two
     * are **0.00** apart. Hue is the only separating channel, and CVD is the loss of hue. This
     * is the exact inverse of the principle Okabe-Ito is built on. ΔE2000 and OKLCH hue gaps
     * are normal-vision metrics and structurally cannot see it.
     *
     * DO NOT re-solve the palette onto a lightness ladder to make this "pass". That would
     * re-open a look the owner picked from rendered comparisons and destroy the even-against-
     * the-page property he picked it for. The labels carry the mitigation.
     *
     * Measured 2026-08-29 against `./colourDistance`:
     *   light surfaces  normal 10.48 | protan **1.0361** | deutan **0.7307** | tritan **2.3814**
     *   dark bands      normal 10.32 | protan **1.8508** | deutan **0.7118** | tritan **4.9718**
     * Worst pairs: light protan violet/rose, light deutan blue/violet, light tritan red/orange;
     * dark protan and deutan both orange/amber, dark tritan green/teal.
     */
    const EXPECTED: Record<Theme, Record<string, number>> = {
      light: { protanopia: 1.0361, deuteranopia: 0.7307, tritanopia: 2.3814 },
      dark: { protanopia: 1.8508, deuteranopia: 0.7118, tritanopia: 4.9718 },
    };
    const pairs = presetPairs();
    expect(pairs).toHaveLength(28);

    for (const theme of THEMES) {
      for (const type of CVD_TYPES) {
        const worst = pairs
          .map(({ a, b }) => distance(simulate(ground(a, theme), type), simulate(ground(b, theme), type)))
          .reduce((lo, d) => (d < lo ? d : lo));
        const pinned = EXPECTED[theme][type];
        expect(worst, `${theme}/${type} CVD separation moved to ${worst.toFixed(4)}`).toBeGreaterThanOrEqual(pinned - 0.01);
        expect(worst, `${theme}/${type} CVD separation moved to ${worst.toFixed(4)}`).toBeLessThanOrEqual(pinned + 0.01);
      }
    }

    // The simulator is live: normal vision is unchanged, and dichromacy really collapses a
    // red/green pair. Without this, a `simulate` that returned its input would pin the
    // NORMAL-vision numbers and look identical to a working guard.
    expect(simulate('#808080', 'deuteranopia')).toEqual('#808080');
    expect(distance(simulate('#ff0000', 'deuteranopia'), simulate('#00ff00', 'deuteranopia'))).toBeLessThan(
      distance('#ff0000', '#00ff00'),
    );

    // The structural cause, asserted so it cannot be re-diagnosed as a hue problem: the light
    // band's L* spread is under 0.5, i.e. lightness carries no information at all.
    const lightLs = GROUP_COLOUR_PRESETS.map((p) => lightness(p.light));
    expect(Math.max(...lightLs) - Math.min(...lightLs)).toBeLessThanOrEqual(0.5); // actual 0.35
  });

  it('16. the tinted ink and its rung stay above 4.5:1 under all four vision types', () => {
    /*
     * The owner's colour-blind consultant raised the general case: "The color of the text and
     * the color of the background can be a problem sometimes." For THIS system it was measured
     * on 2026-08-29 and it holds up — WCAG contrast is luminance-based, and luminance largely
     * survives CVD simulation even when hue does not. That is exactly why test 14 fails and
     * this one passes: they measure different channels.
     *
     * All 64 combinations (8 presets x 2 themes x 4 vision types) are walked. Worst plain ink
     * on its own ground: **7.3793** (blue, light, tritanopia). Worst muted rung: **5.3217**
     * (blue, light, tritanopia). Both clear 4.5 everywhere.
     * Source: `.planning/research/scripts/derive-ink-under-cvd.js`.
     */
    let worstInk = Infinity;
    let worstRung = Infinity;
    let cells = 0;
    for (const preset of GROUP_COLOUR_PRESETS) {
      for (const theme of THEMES) {
        const own = ground(preset, theme);
        const inkHex = theme === 'light' ? preset.inkLight : preset.inkDark;
        const rungHex = theme === 'light' ? preset.mutedLight : preset.mutedDark;
        for (const type of [null, ...CVD_TYPES] as const) {
          const seen = (hex: string): string => (type === null ? hex : simulate(hex, type));
          const inkRatio = contrast(seen(inkHex), seen(own));
          const rungRatio = contrast(seen(rungHex), seen(own));
          expect(inkRatio, `${preset.name}/${theme}/${type ?? 'normal'} ink`).toBeGreaterThanOrEqual(TEXT_FLOOR);
          expect(rungRatio, `${preset.name}/${theme}/${type ?? 'normal'} rung`).toBeGreaterThanOrEqual(TEXT_FLOOR);
          worstInk = Math.min(worstInk, inkRatio);
          worstRung = Math.min(worstRung, rungRatio);
          cells += 1;
        }
      }
    }
    // ANTI-VACUITY: 8 presets x 2 themes x 4 vision types.
    expect(cells).toBeGreaterThanOrEqual(64);
    expect(cells).toBeLessThanOrEqual(64);

    // The two worst cells, pinned so a future palette change cannot quietly erode them.
    expect(worstInk).toBeGreaterThanOrEqual(7.37); // actual 7.3793, blue / light / tritanopia
    expect(worstRung).toBeGreaterThanOrEqual(5.32); // actual 5.3217, blue / light / tritanopia
  });
});

describe('the swatch resting boundary — M33 (UI-SPEC §10.1 test 15)', () => {
  it('15. `--color-border-strong` clears 3:1 on every light surface; the old `--color-border` does NOT', () => {
    /*
     * M33: the picker swatch's RESTING boundary. A swatch is a colour-only control, so its own
     * edge is a non-text UI component under WCAG 1.4.11 and needs 3:1 against the fill it
     * surrounds. `--color-border` light (`#b8a898`, warm-400) does not come close on these pale
     * surfaces; `--color-border-strong` (`#8c7a6a`, warm-500) does, with almost nothing to
     * spare.
     *
     * Actuals, measured 2026-08-29 (`.planning/research/scripts/derive-swatch-border.js`):
     *   `#8c7a6a` on the eight light surfaces: **3.0361 - 3.0648** — the floor is met by 1-2%.
     *   `#b8a898` on the same eight:           **1.7053 - 1.7214** — it FAILS everywhere.
     *
     * The counter-assertion is not decoration: it is what documents WHY the boundary changed,
     * as a passing test rather than as prose that a future reader will not find.
     * NOTE the margin. At 3.04 there is no headroom — a light band 1 L* lighter would push
     * `--color-border-strong` under 3:1 too. That is a third constraint on the light band,
     * pulling the same way as §2.4's 4.86 row.
     */
    const NON_TEXT_FLOOR = 3.0;
    const strong = GROUP_COLOUR_PRESETS.map((p) => contrast(BORDER_STRONG_LIGHT, p.light));
    const old = GROUP_COLOUR_PRESETS.map((p) => contrast(BORDER_LIGHT, p.light));
    expect(strong).toHaveLength(8);
    expect(old).toHaveLength(8);

    for (let i = 0; i < 8; i += 1) {
      expect(strong[i], `${GROUP_COLOUR_PRESETS[i].name}: border-strong ${strong[i].toFixed(4)}`).toBeGreaterThanOrEqual(NON_TEXT_FLOOR);
      // ...and the boundary it replaced would fail, which is the reason for the change.
      expect(old[i], `${GROUP_COLOUR_PRESETS[i].name}: the OLD border ${old[i].toFixed(4)} must not pass`).toBeLessThan(NON_TEXT_FLOOR);
      expect(old[i]).toBeLessThanOrEqual(1.73); // actual 1.7053-1.7214 — nowhere near 3:1
    }
    // The margin is thin and the test says so out loud: pinned under 3.07 so a change that
    // eats it reds here instead of shipping an invisible swatch edge.
    expect(Math.max(...strong)).toBeLessThanOrEqual(3.07);
  });
});

describe('the swatch resting boundary in DARK mode — ACCEPTED FAILURE, owner ruling 2026-08-30', () => {
  it('15b. DISCLOSED: `green` reads 2.7912 against its own dark band, under the 3:1 this control invoked', () => {
    /*
     * ACCEPTED FOREVER — owner ruling 2026-08-30, code review 88.3.1 fork F2, option (b).
     *
     * THE FINDING. M33 / AMENDMENT D upgraded this swatch's resting boundary from
     * `border-line` to `border-line-strong` on an explicit WCAG 1.4.11 argument: a swatch is a
     * colour-only control, so its edge needs 3:1 against the fill it surrounds. Test 15 above
     * proves that for LIGHT mode and stops there — `BORDER_STRONG_LIGHT` was, until this test,
     * the only boundary constant in the file. The dark half was never computed. It does not
     * hold: in `.dark`, `--color-border-strong` resolves to `--purple-500` `#6b7fa3`, and
     * against `green`'s dark band `#004511` that is **2.7912**, under the floor the change
     * itself invoked. The swatch carries no text of its own (the caption is a sibling `<span>`,
     * `aria-hidden`), so this edge really is the only in-component cue.
     *
     * WHY IT IS ACCEPTED AND NOT FIXED. The owner ruled (b): leave it, record it. Four
     * alternatives were measured and all four clear the floor — `purple-400` #8a9bba (worst
     * case 4.02), `content-muted` warm-400 (4.89), `purple-300` #b0bdd3 (5.95),
     * `content-secondary` warm-300 (7.08) — so this is a look decision taken with the numbers
     * in hand, not an oversight. One preset, one theme, on a control whose selected state is
     * additionally marked by a `ring-2` and whose accessible name is on the button.
     *
     * WHY THIS IS A TEST AND NOT A PARAGRAPH. House precedent: `--color-text-link` was left
     * under AA by ruling 1c and pinned as a DISCLOSED FAILURE by Gate A tests 48-49 "so it can
     * never be invisible again". Same treatment. This test PASSES on the accepted value and
     * REDS if the number moves in either direction — a drift further down is caught, and so is
     * a silent fix that would leave this record lying.
     *
     * DO NOT "fix" this by moving the token. `--color-border-strong` has 27 class usages across
     * `src`, and `globals.css:1073-1136` records it as the 3:1 control edge and forbids nudging
     * it. Any future fix is a `dark:` variant at the ONE swatch site
     * (`GroupSettings.js`, the resting arm), and it must update this test in the same commit.
     */
    const NON_TEXT_FLOOR = 3.0;
    const dark = GROUP_COLOUR_PRESETS.map((p) => contrast(BORDER_STRONG_DARK, p.dark));
    expect(dark).toHaveLength(8);

    const byName = Object.fromEntries(GROUP_COLOUR_PRESETS.map((p, i) => [p.name, dark[i]]));

    // The accepted failure, pinned to its exact measured value in both directions.
    expect(byName.green).toBeGreaterThan(2.79);
    expect(byName.green).toBeLessThan(2.80);
    expect(byName.green, 'green is the ACCEPTED dark-mode failure').toBeLessThan(NON_TEXT_FLOOR);

    // …and it is the ONLY one. A second preset dropping under 3:1 is NOT covered by the
    // ruling and must red here rather than join the accepted set silently.
    const failing = GROUP_COLOUR_PRESETS.filter((p, i) => dark[i] < NON_TEXT_FLOOR).map((p) => p.name);
    expect(failing, 'only `green` is accepted below 3:1 in dark mode').toEqual(['green']);

    // The other seven, pinned as a band so a palette re-tune that erodes them reds here.
    const rest = GROUP_COLOUR_PRESETS.filter((p) => p.name !== 'green').map((p) => contrast(BORDER_STRONG_DARK, p.dark));
    expect(Math.min(...rest)).toBeGreaterThanOrEqual(3.31); // teal 3.3133, the tightest passer
    expect(Math.max(...rest)).toBeLessThanOrEqual(3.81);    // rose 3.8070
  });
});

describe('coloured-surface separation from the surface BEHIND it — recorded, not gated (F4)', () => {
  it('15c. records how far each ground sits from the page and the card, in both themes', () => {
    /*
     * RECORDED BY OWNER RULING 2026-08-30 (code review 88.3.1 fork F4, option (a)).
     *
     * UI-SPEC 2.6 recorded the light surfaces sitting ~1.03:1 from the page as DELIBERATE, and
     * the plan review used exactly that fact to force the picker swatch onto `-strong`. That
     * reasoning was never carried to the six RENDER consumers, two of which are interactive
     * controls under WCAG 1.4.11: the group card (`grouplist.js`, `role="button"`) and the
     * compact month tile (`CalendarMonthView.js`, `role="button"`). Nothing measured them.
     *
     * This test is a LEDGER, not a floor. It asserts no minimum, because there is no agreed
     * one: neither the outgoing t=0.70 tints nor the shipped bands met 3:1, so this is not a
     * regression — it is a number that had never been written down. Both surfaces additionally
     * carry text that identifies them, which is why it is recorded rather than gated.
     *
     * Its job is to make a future change to the light band VISIBLE here, so the next person to
     * re-tune the palette sees what it does to surface separation instead of discovering it in
     * a walkthrough. If an owner ever sets a floor, it replaces the band assertions below.
     */
    const lightVsPage = GROUP_COLOUR_PRESETS.map((p) => contrast(BG_PAGE_LIGHT, p.light));
    const lightVsCard = GROUP_COLOUR_PRESETS.map((p) => contrast(BG_CARD_LIGHT, p.light));
    const darkVsPage = GROUP_COLOUR_PRESETS.map((p) => contrast(BG_PAGE_DARK, p.dark));
    const darkVsCard = GROUP_COLOUR_PRESETS.map((p) => contrast(BG_CARD_DARK, p.dark));

    // LIGHT — the group card's fill against the warm-200 page it sits on.
    expect(Math.min(...lightVsPage)).toBeCloseTo(1.0277, 3); // rose, the closest
    expect(Math.max(...lightVsPage)).toBeCloseTo(1.0374, 3); // orange, the furthest
    // LIGHT — the compact month tile's fill against its white day cell.
    expect(Math.min(...lightVsCard)).toBeCloseTo(1.3417, 3); // rose
    expect(Math.max(...lightVsCard)).toBeCloseTo(1.3544, 3); // orange

    // DARK — the same two relationships. Wider spread, and the reverse ordering:
    // `green` is the FURTHEST from the dark page (1.4972) and `rose` the closest (1.0977).
    expect(Math.min(...darkVsPage)).toBeCloseTo(1.0977, 3);  // rose
    expect(Math.max(...darkVsPage)).toBeCloseTo(1.4972, 3);  // green
    expect(Math.min(...darkVsCard)).toBeCloseTo(1.0226, 3);  // red
    expect(Math.max(...darkVsCard)).toBeCloseTo(1.2262, 3);  // green

    // The shape that matters if anyone reads only one line: in LIGHT mode every ground is
    // within ~3.7% of the page behind it, and none of the four relationships reaches 3:1.
    for (const set of [lightVsPage, lightVsCard, darkVsPage, darkVsCard]) {
      expect(set).toHaveLength(8);
      expect(Math.max(...set)).toBeLessThan(3.0);
    }
  });
});

/**
 * `--color-border-control` light, `globals.css:1322` -> `--warm-300: #d6cbc0` (`:632`).
 *
 * This is the ring on the three `groupHomePage` header controls' LIGHT arm
 * (`bg-white/80 ring-1 ring-line-control dark:ring-0`, `DECISION Phase 88.3-16`). It is
 * deliberately NOT `BORDER_LIGHT` (warm-400) or `BORDER_STRONG_LIGHT` (warm-500) above:
 * `globals.css:1300-1310` records both control edges as HELD at warm-300 by owner ruling 1c,
 * with the measurement that says why (warm-400 reads 2.3096 on a white card, over Gate A test
 * 36d's 2.00 ceiling).
 */
const CONTROL_RING_LIGHT = '#d6cbc0';

describe('the header controls\' white wash on the NEW light surfaces — RESEARCH Open Question 1', () => {
  it('16. all sixteen wash/ring readings stay inside the 1.20-1.57 shipped neutral-border band', () => {
    /*
     * WHY THIS TEST EXISTS. The three `groupHomePage` header controls' light arm carries an
     * 80% WHITE WASH plus a 1px ring — the owner's 88.3 Req 12 test 7, verbatim: "I can read
     * the words, but I can't see a button there." That treatment was measured in 88.3 against
     * the eight **t = 0.70 tints** and has NEVER been re-measured against the light surfaces
     * this phase ships, even though UI-SPEC 3.3 puts that header in the CARD bucket so BOTH
     * its ground and its ink move. Neither SPEC nor UI-SPEC re-ran it; RESEARCH flagged it as
     * Open Question 1 rather than assuming it still held. This is the answer.
     *
     * `e2e/contrast.spec.ts:706-716` already asserts AA on these controls' TEXT against the
     * Navy fixture group, so CI catches a text regression. It does NOT catch an EDGE one —
     * a wash that stops separating the control from the ground behind it is invisible to
     * every text-contrast probe in the tree. This test is that catch.
     *
     * THE BASELINE BEING COMPARED AGAINST (88.3, on the superseded t = 0.70 tints, recorded
     * verbatim in the `DECISION Phase 88.3-16` marker at `groupHomePage/page.js`):
     *   wash vs tint  **1.634 (Forest) - 1.716 (Wine)**, Navy 1.660 — "the wash IS the boundary"
     *   ring vs wash  **1.418 - 1.432**
     *
     * MEASURED HERE, on the eight rev3 light surfaces (2026-08-29, this tree's `wcag.ts`):
     *   wash vs ground **1.2605 (teal) - 1.2771 (orange)**  <- fell ~23% from 1.634-1.716
     *   ring vs wash   **1.4969 (teal) - 1.5095 (green)**   <- rose slightly from 1.418-1.432
     *
     * BOTH STAY INSIDE THE 1.20-1.57 SHIPPED NEUTRAL-BORDER BAND, so nothing is broken and
     * nothing is being changed here — but the ROLES SWAPPED, and that is worth a future
     * reader's attention rather than a silent pass. The new light surfaces are lighter in
     * luminance than the old tints, so an 80% white wash over them separates LESS; the ring,
     * which composites against a slightly lighter wash, separates slightly MORE. The 88.3
     * marker's sentence "the wash IS the boundary" was true at 1.66 and is no longer the whole
     * story at 1.27 — the ring now carries as much of the edge as the wash does. That is the
     * shipped Geist / Fluent / Ant / shadcn-outline pattern (white fill + a 1.20-1.53
     * hairline) working as intended, which is exactly why the treatment was BOTH a wash and a
     * ring rather than either alone.
     *
     * THE CONTROL MARKUP IS DELIBERATELY NOT CHANGED. Phase 88.6 owns those controls (the
     * `.btn` -> `Button` migration) and the ROADMAP sequenced 88.3.1 first precisely so 88.6
     * lands on a stable header. If the wash should ever need to persist harder, the recorded
     * step is `bg-white/90` — measured here as a comment, not applied.
     */
    const BAND_FLOOR = 1.2;
    const BAND_CEILING = 1.57;

    let readings = 0;
    const washVsGround: number[] = [];
    const ringVsWash: number[] = [];

    for (const preset of GROUP_COLOUR_PRESETS) {
      const wash = composite('#ffffff', 0.8, preset.light);

      const a = contrast(wash, preset.light);
      expect(
        a,
        `${preset.name}: the 80% white wash measures ${a.toFixed(4)} against its own light ` +
          'surface — the control has lost its boundary against the header ground',
      ).toBeGreaterThanOrEqual(BAND_FLOOR);
      expect(a, `${preset.name}: wash vs ground ${a.toFixed(4)} left the shipped band`).toBeLessThanOrEqual(
        BAND_CEILING,
      );
      washVsGround.push(a);
      readings += 1;

      const b = contrast(CONTROL_RING_LIGHT, wash);
      expect(
        b,
        `${preset.name}: the ring measures ${b.toFixed(4)} on the composited wash — outside ` +
          'the 1.20-1.57 shipped neutral-border band',
      ).toBeGreaterThanOrEqual(BAND_FLOOR);
      expect(b, `${preset.name}: ring vs wash ${b.toFixed(4)} left the shipped band`).toBeLessThanOrEqual(
        BAND_CEILING,
      );
      ringVsWash.push(b);
      readings += 1;
    }

    // ANTI-VACUITY: sixteen readings, not zero, not eight.
    expect(readings, 'the sixteen-reading sweep did not run in full').toBe(16);

    /*
     * The envelopes, pinned tightly so a future palette edit that erodes either cue reds HERE
     * rather than shipping. These are the numbers written into the marker above; if they move,
     * the marker is wrong and must move with them.
     */
    expect(Math.min(...washVsGround)).toBeGreaterThanOrEqual(1.25);
    expect(Math.max(...washVsGround)).toBeLessThanOrEqual(1.29);
    expect(Math.min(...ringVsWash)).toBeGreaterThanOrEqual(1.48);
    expect(Math.max(...ringVsWash)).toBeLessThanOrEqual(1.52);

    /*
     * The LABEL on that composited wash, asserted rather than inherited. `text-content-primary`
     * measures 13.27-13.39:1 on the BARE new surfaces (UI-SPEC 2.4), but the label does not sit
     * on the bare surface — it sits on the wash, which is a different (lighter) ground. Measured
     * **16.86 - 17.00:1**. Cheap to check, and the composited case is the one no other gate in
     * this file covers.
     */
    for (const preset of GROUP_COLOUR_PRESETS) {
      const wash = composite('#ffffff', 0.8, preset.light);
      const text = contrast(CONTENT_PRIMARY_LIGHT, wash);
      expect(text, `${preset.name}: the control label on the wash measures ${text.toFixed(4)}`).toBeGreaterThanOrEqual(
        TEXT_FLOOR,
      );
    }
  });
});
