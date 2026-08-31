// src/lib/wcag.ts
//
// WCAG 2.x sRGB relative luminance, contrast ratio, and CIE L-star (D65) — the ONE place
// this repo computes any of them. Pure maths: no React, no `next/`, no imports at all.
//
// ---------------------------------------------------------------------------------------
// DECISION Phase 88.3 (D-06/D-07): ONE shared module, imported by BOTH gates.
// ---------------------------------------------------------------------------------------
// CHOSEN: a single `src/lib/wcag.ts` that the vitest token-layer gate (Gate A) imports
// directly and the Playwright contrast probe (Gate C) reaches through
// `e2e/support/contrast.ts`, which re-exports it.
//
// REJECTED: duplicating the ~30 lines of transfer function + coefficients inside
// `e2e/support/contrast.ts` so each side owns its own copy. That was rejected because
// `src/test-utils/sourceScan.ts:25-37` is this repo's own written record of what a
// duplicated helper costs — six divergent copies of one source scanner, six places a fix
// had to land, and the divergence is invisible until the two disagree. Two gates that
// disagree about a ratio is strictly worse than either gate alone: the phase would be
// unable to say which number is the real one.
//
// Collapsing this back into two copies is a decision, not a cleanup.
//
// ---------------------------------------------------------------------------------------
// DECISION Phase 88.3 (D-06/D-07): THERE ARE THREE COLOUR FORMULAS IN THIS REPO AND THEY
// ARE NOT INTERCHANGEABLE. Do not converge them.
// ---------------------------------------------------------------------------------------
//   1. THIS FILE — WCAG 2.x relative luminance (piecewise sRGB transfer function, then
//      0.2126 R + 0.7152 G + 0.0722 B) plus CIE L-star. Used ONLY to measure design-token
//      contrast against WCAG floors. It has no runtime render path.
//
//   2. `src/lib/colorUtils.js:142-159` (`getBrightness`) — the W3C 299/587/114 PERCEIVED
//      BRIGHTNESS formula. Its 128 and 180 tier thresholds are calibrated to THAT formula's
//      output scale, which is a different scale from this one. It is the live tier predicate
//      that picks title/subtitle text colour over a USER-CHOSEN group colour, and the
//      D-27/D-29 marker at `colorUtils.js:33-38` already says "do NOT collapse the algorithm
//      or delete the two lighter tiers". Phase 88.3 makes those tiers load-bearing for the
//      first time: every light-mode rendered group tint lands at W3C brightness 188-191 —
//      the previously-unreachable `brightness > 180` branch, cleared by only ~8-11 points.
//      (AMENDED by CR-03, 88.3-cr, 2026-08-27: this line said 226-227, which was the figure
//      at the earlier t = 0.87 and carried a ~46-point margin. The owner ruled t = 0.70 on
//      2026-08-25 and the tints moved with it. A reader trusting 226-227 could conclude the
//      180 threshold was nowhere near live and "safely" nudge it. The authoritative figures
//      are the amended D-09 marker at `colorUtils.js` and the per-preset
//      `getBrightness(tint(preset)) > 180` assertions in `colorUtils.test.ts`.)
//      Swapping `getBrightness` for
//      `relativeLuminance` here would silently re-tier every group in the database — a
//      user's header text would flip pole with no code review noticing.
//
//   3. `src/lib/availabilityColor.ts:169-172` (`luma`) — Rec. 709 luma on raw 0-255
//      channels, with NO transfer function at all. It exists to derive the five availability
//      wash alphas from the canonical green ramp's own perceptual spacing. Replacing it with
//      WCAG luminance would re-derive all five shipped alphas.
//
// Replacing `colorUtils`'s brightness formula or `availabilityColor`'s luma with the maths
// in this file is a decision, not a cleanup. `88.3-UI-SPEC.md` section 9.7 states the same
// rule for the gate author. `wcag.test.ts` pins the separation mechanically, so a future
// "unify the colour maths" pass reds instead of shipping.
//
// AMENDED Phase 88.3.1 (D-02, 2026-08-29): THE CENSUS ABOVE IS NOW FOUR, NOT THREE. The
// original three entries are kept verbatim as history — nothing in them changed — and this
// paragraph adds the fourth:
//
//   4. `src/lib/colourDistance.ts` — CIELAB + CIEDE2000 + OKLab/OKLCH. It measures perceptual
//      DISTANCE between two colours (and hue separation), which is a different question from
//      every entry above: 1-3 all answer "how legible is this ink on this ground", and 4
//      answers "would a person see these two grounds as different colours at all". It exists
//      because SPEC Req 2's ΔE2000 >= 5 floor, SPEC Req 1's >= 30° hue-gap floor and CONTEXT
//      D-02's nearest-preset remap all need it, and a contrast ratio cannot express any of
//      them — two backgrounds can sit at an identical contrast ratio against the same ink and
//      be indistinguishable from each other.
//
//      It is NOT a contrast formula and must not be converged onto 1-3, in either direction:
//      substituting ΔE2000 for a contrast ratio would silently drop every WCAG floor this
//      phase and 88.3 asserted, and substituting a contrast ratio for ΔE2000 would let two
//      presets that no user can tell apart pass the distinctness gate. `colourDistance.ts`
//      imports `parseHex` FROM this file and deliberately exports no lightness of its own —
//      `lStar` below stays the single lightness implementation in this tree, and
//      `oklch().L` (0-1, OKLab) is a different scale that is not a substitute for it.
//
//      Converging entry 4 onto entries 1-3 is a decision, not a cleanup.
//
// ---------------------------------------------------------------------------------------
// TOTALITY CONTRACT (threat T-88.3-02, ASVS V5).
// ---------------------------------------------------------------------------------------
// Every exported function is TOTAL: null, undefined, a non-string, an empty string or any
// malformed colour returns a defined value (`null`) and NEVER throws. This mirrors
// `getBrightness`'s shipped contract at `colorUtils.js:142-159` (invalid input returns 255,
// never throws). `parseHex` is handed arbitrary `Groups.background_color` values from the
// database in plan 10, where a throw would take down a render.
//
// ROUNDING IS THE CALLER'S JOB. Ratios and L-star values are returned unrounded on purpose:
// assertions compare against floors, and a ratio rounded inside this module would let a
// 4.4999 read as a passing 4.5.
//
// NO RAW HEX LIVES IN THIS FILE, by design — it holds maths only, so it does NOT belong on
// `rawColorValues.test.ts`'s `HEX_EXEMPT` map. Colour fixtures live in `wcag.test.ts`.

/** An sRGB triple, each channel 0-255 (integer). */
export type Rgb = [number, number, number];

/** WCAG 2.x sRGB transfer-function knee. */
const SRGB_KNEE = 0.03928;

/** WCAG 2.x luminance coefficients (sRGB / Rec. 709 primaries, D65 white). */
const LUMINANCE_R = 0.2126;
const LUMINANCE_G = 0.7152;
const LUMINANCE_B = 0.0722;

/** CIE epsilon (216/24389) and kappa (24389/27) — the exact rational forms, not 0.008856/903.3. */
const CIE_EPSILON = 216 / 24389;
const CIE_KAPPA = 24389 / 27;

/** WCAG's flare constant, added to both luminances before the ratio. */
const CONTRAST_FLARE = 0.05;

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i;
const HEX_FULL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i;

/**
 * `rgb()` / `rgba()` in the legacy comma form Chromium's `getComputedStyle` emits
 * (`rgb(255, 255, 255)`, `rgba(0, 0, 0, 0)`), plus the modern space-separated form with an
 * optional `/ alpha`. Alpha is parsed and discarded: callers that need compositing use
 * `blend`, which takes the ground explicitly rather than guessing it.
 */
const RGB_FUNC = /^rgba?\(\s*([^)]*)\)$/i;

/**
 * Clamp to an integer channel in 0-255. Non-finite input yields **NaN**, so that `parseHex`
 * / `parseRgbFunc` reject the colour via `rgb.some(Number.isNaN)`.
 *
 * DECISION Phase 88.3-cr (CR-04, 2026-08-27): the NaN is the contract, not an oversight —
 * this docstring used to promise `0`. Someone "fixing" the code to match would turn a
 * malformed channel into a silent black, so `rgb(x, 0, 0)` would parse as an accepted
 * colour and every contrast reading taken against it would be wrong-but-plausible.
 * The COMMENT was the defect; the code is correct.
 */
function toChannel(value: number): number {
  if (!Number.isFinite(value)) return Number.NaN;
  return Math.min(255, Math.max(0, Math.round(value)));
}

/**
 * Parse a colour string into an sRGB triple.
 *
 * Accepts `#rgb`, `#rrggbb`, `rgb(r, g, b)` and `rgba(r, g, b, a)` (the last two are what
 * Chromium's computed style returns, which Gate C reads directly). Case-insensitive,
 * surrounding whitespace tolerated.
 *
 * Returns `null` for everything else, including `null`, `undefined` and non-strings.
 * Never throws.
 */
export function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  if (input.length === 0) return null;

  const short = HEX_SHORT.exec(input);
  if (short) {
    return [
      parseInt(short[1] + short[1], 16),
      parseInt(short[2] + short[2], 16),
      parseInt(short[3] + short[3], 16),
    ];
  }

  const full = HEX_FULL.exec(input);
  if (full) {
    return [parseInt(full[1], 16), parseInt(full[2], 16), parseInt(full[3], 16)];
  }

  const func = RGB_FUNC.exec(input);
  if (func) {
    // Both separator conventions: `r, g, b, a` and `r g b / a`.
    const parts = func[1]
      .replace(/\//g, ' ')
      .split(/[\s,]+/)
      .filter((part) => part.length > 0);
    if (parts.length < 3) return null;
    // Percentage channels are NOT supported — declared rather than silently mis-parsed.
    if (parts.slice(0, 3).some((part) => part.endsWith('%'))) return null;
    const rgb: Rgb = [toChannel(Number(parts[0])), toChannel(Number(parts[1])), toChannel(Number(parts[2]))];
    if (rgb.some((channel) => Number.isNaN(channel))) return null;
    return rgb;
  }

  return null;
}

/** The WCAG 2.x sRGB transfer function, applied to one 0-255 channel. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= SRGB_KNEE ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * WCAG 2.x sRGB relative luminance, 0 (black) to 1 (white).
 *
 * NOT the same quantity as `colorUtils.js`'s `getBrightness` and NOT the same as
 * `availabilityColor.ts`'s `luma` — see the three-formula DECISION in the header.
 *
 * `null` in (unparseable) means `null` out. Never throws.
 */
export function relativeLuminance(value: unknown): number | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  return (
    LUMINANCE_R * linearize(rgb[0]) + LUMINANCE_G * linearize(rgb[1]) + LUMINANCE_B * linearize(rgb[2])
  );
}

/**
 * WCAG 2.x contrast ratio: `(Lmax + 0.05) / (Lmin + 0.05)`, so 1 (identical) to 21
 * (black on white). Order of arguments does not matter.
 *
 * Returns `null` if EITHER input fails to parse — a caller must not be handed a plausible
 * number computed against a colour that was never understood.
 */
export function contrastRatio(a: unknown, b: unknown): number | null {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  if (la === null || lb === null) return null;
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + CONTRAST_FLARE) / (darker + CONTRAST_FLARE);
}

/**
 * CIE L-star (D65), 0 (black) to 100 (white) — perceptual lightness.
 *
 * Yn is 1 because the WCAG luminance coefficients above already sum to 1 against the D65
 * white point, so `relativeLuminance('#ffffff')` is exactly the reference white's Y.
 *
 * This is the quantity the phase's surface-separation requirement (Req 1) is written in:
 * two backgrounds can pass every contrast floor and still be indistinguishable, and only a
 * lightness delta says so.
 */
export function lStar(value: unknown): number | null {
  const y = relativeLuminance(value);
  if (y === null) return null;
  return y > CIE_EPSILON ? 116 * y ** (1 / 3) - 16 : CIE_KAPPA * y;
}

/** Absolute difference in CIE L-star between two colours. `null` if either fails to parse. */
export function deltaLStar(a: unknown, b: unknown): number | null {
  const la = lStar(a);
  const lb = lStar(b);
  if (la === null || lb === null) return null;
  return Math.abs(la - lb);
}

/** Format an sRGB triple as lowercase `#rrggbb`. */
function toHex(rgb: Rgb): string {
  return (
    '#' +
    rgb
      .map((channel) => Math.min(255, Math.max(0, Math.round(channel))).toString(16).padStart(2, '0'))
      .join('')
  );
}

/**
 * Composite `fg` at `alpha` over an opaque `bg`, returning the resulting opaque `#rrggbb`.
 *
 * Source-over in sRGB SPACE, not linear space, because that is what a browser does for a
 * non-`color-mix` alpha composite — the point of this helper is to predict what Chromium
 * will actually paint, so the gate and the browser agree.
 *
 * Needed wherever the design layer stacks a translucent colour on an opaque one and the
 * ledger has to measure the RESULT: `--color-bg-overlay`, and the `groupHomePage` 15% black
 * dim over a rendered group tint (`88.3-UI-SPEC.md` section 5.10.3).
 *
 * `alpha` is clamped to [0, 1]; a non-finite alpha, or either colour failing to parse,
 * returns `null`. Never throws.
 */
export function blend(fg: unknown, alpha: number, bg: unknown): string | null {
  const foreground = parseHex(fg);
  const background = parseHex(bg);
  if (!foreground || !background) return null;
  if (typeof alpha !== 'number' || !Number.isFinite(alpha)) return null;
  const a = Math.min(1, Math.max(0, alpha));
  return toHex([
    Math.round(background[0] + (foreground[0] - background[0]) * a),
    Math.round(background[1] + (foreground[1] - background[1]) * a),
    Math.round(background[2] + (foreground[2] - background[2]) * a),
  ]);
}
