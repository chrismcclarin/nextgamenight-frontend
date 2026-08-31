// src/lib/colourDistance.ts
//
// CIELAB + CIEDE2000 perceptual DISTANCE and OKLab/OKLCH — the ONE place this repo computes
// either of them. Pure maths: no React, no `next/`, and the only import is `parseHex` from
// `./wcag`, which owns every hex/rgb() parse in this tree.
//
// ---------------------------------------------------------------------------------------
// DECISION Phase 88.3.1 (D-02): hand-written maths + a verbatim BE port, pinned by ONE
// shared numeric fixture vector.
// ---------------------------------------------------------------------------------------
// CHOSEN: ~110 hand-written lines sitting beside `wcag.ts`, with a verbatim CommonJS port at
// BE `utils/colourDistance.js` (plan 88.3.1-04) — same variable names, same order of
// operations — and the SAME four `(hexA, hexB) -> ΔE2000` rows asserted independently in both
// repos (`src/lib/colourDistance.test.ts` here, `tests/unit/colourDistance.test.js` there).
// Neither repo can import the other, so a shared fixture is the only mechanism that can make
// a divergence red a test.
//
// REJECTED, alternative 1 — an npm colour library (`culori` / `chroma-js` / `colorjs.io`).
// It would put a runtime dependency inside a PRODUCTION MIGRATION PATH (the plan 88.3.1-05
// remap rewrites `Groups.background_color` permanently) for maths this repo has already
// verified against 15 independent data points — every figure in `88.3.1-UI-SPEC.md` §2.2/§4.2
// re-derived and matched (`88.3.1-RESEARCH.md` `## The Palette, Independently Verified`,
// `## Package Legitimacy Audit`). A supply-chain surface bought nothing measurable.
//
// REJECTED, alternative 2 — two independent implementations, one per repo, with no shared
// fixture. CIEDE2000 has several published forms with known sign/quadrant traps, and a
// third-decimal divergence is not cosmetic here: it flips `Storm #27272a` between `blue`
// (15.56) and `teal` (16.21) — a margin of 0.65 — and `legacy orange #fff3e0` between
// `orange` (11.29) and `amber` (12.01) — a margin of 0.72. Both flips would ship as a green
// suite on both sides and a wrong permanent migration row.
//
// Changing this is a decision, not a cleanup.
//
// ---------------------------------------------------------------------------------------
// THE TWO TRAPS THIS IMPLEMENTATION HAS TO GET RIGHT (RESEARCH Pitfall 5).
// ---------------------------------------------------------------------------------------
//  1. The MEAN HUE `hbp`. When |h1p - h2p| > 180° the mean is NOT (h1p + h2p) / 2 — the pair
//     straddles the 0/360 seam and the correct mean is (h1p + h2p ± 360) / 2, choosing the
//     sign on whether the raw sum is under 360. Getting this wrong moves `T`, `dTheta` and
//     therefore `Rt`, and it only shows up on colours near red — which is where four of the
//     eight presets sit. It also breaks SYMMETRY first, which is why the test asserts it.
//  2. The SIGN of the `Rt` rotation term. `Rt = -sin(2·dTheta)·Rc` — negative. A positive
//     `Rt` still returns plausible numbers everywhere and only misorders near-blue pairs,
//     which is exactly the `Storm -> blue vs teal` row.
//
// ---------------------------------------------------------------------------------------
// WHAT LIVES HERE AND WHAT DOES NOT.
// ---------------------------------------------------------------------------------------
// `wcag.ts` owns `parseHex`, `relativeLuminance`, `contrastRatio`, `lStar`, `deltaLStar` and
// `blend`, and it keeps owning them. This module imports the parser and re-implements NONE of
// them. In particular there is deliberately NO exported lightness here: `toLab` computes an L
// component internally because the CIEDE2000 formula needs it, but it is module-private and a
// caller that wants perceptual lightness imports `lStar` from `./wcag` (`src/lib/wcag.ts:214`).
// `oklch().L` is a DIFFERENT scale (0-1, OKLab) and is not a substitute for CIE L* (0-100) —
// plan 88.3.1-05's dark/light branch is written in L*, and swapping in `oklch().L` would
// compare a 0-1 number against a threshold of 50 and take the dark arm for every colour.
//
// TOTALITY CONTRACT (threat T-88.3.1-01, ASVS V5): every exported function is TOTAL. A
// malformed, null, non-string or hostile input returns `null` and never throws — these
// functions are handed arbitrary `Groups.background_color` values. `null` must never be
// coerced to 0 by a caller: 0 reads as "a perfect match" and would mis-remap a row.
//
// LINEARIZATION NOTE: the sRGB knee below is 0.04045, the value in IEC 61966-2-1. `wcag.ts`
// uses 0.03928 because that is the constant WCAG 2.x publishes and a contrast gate must
// reproduce WCAG's own arithmetic. The two differ by ~1e-5 in luminance, far below the 2dp
// the fixtures assert; they are separate on purpose and neither should be "converged" onto
// the other.
//
// NO RAW HEX LIVES IN THIS FILE, by design — maths only, so it does NOT belong on
// `rawColorValues.test.ts`'s `HEX_EXEMPT` map. Colour fixtures live in
// `colourDistance.test.ts`.
import { parseHex } from './wcag';

/** CIE epsilon (216/24389) and kappa (24389/27) — the exact rational forms. */
const CIE_EPSILON = 216 / 24389;
const CIE_KAPPA = 24389 / 27;

/** IEC 61966-2-1 sRGB transfer-function knee (see the LINEARIZATION NOTE above). */
const SRGB_KNEE = 0.04045;

/** D65 white point, the reference white every value in `88.3.1-UI-SPEC.md` was measured against. */
const WHITE_X = 0.95047;
const WHITE_Y = 1.0;
const WHITE_Z = 1.08883;

/** A CIELAB triple: L* 0-100, a* and b* unbounded. */
export type Lab = { L: number; a: number; b: number };

/** An OKLCH triple: L 0-1, C >= 0 (roughly 0-0.4 in sRGB), h in degrees `[0, 360)`. */
export type Oklch = { L: number; C: number; h: number };

/** The IEC 61966-2-1 sRGB transfer function, applied to one 0-255 channel. */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= SRGB_KNEE ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/** Linear sRGB -> CIE XYZ (D65 primaries). */
function toXyz(rgb: readonly [number, number, number]): [number, number, number] {
  const r = linearize(rgb[0]);
  const g = linearize(rgb[1]);
  const b = linearize(rgb[2]);
  return [
    0.4124564 * r + 0.3575761 * g + 0.1804375 * b,
    0.2126729 * r + 0.7151522 * g + 0.0721750 * b,
    0.0193339 * r + 0.1191920 * g + 0.9503041 * b,
  ];
}

/** The CIELAB compression function `f(t)`. */
function labF(t: number): number {
  return t > CIE_EPSILON ? Math.cbrt(t) : (CIE_KAPPA * t + 16) / 116;
}

/**
 * sRGB triple -> CIELAB (D65).
 *
 * Module-private on purpose: the `L` returned here is a second route to a quantity `wcag.ts`
 * already exports as `lStar`, and exporting it would create the duplicate lightness this
 * phase's header rule forbids.
 */
function toLab(rgb: readonly [number, number, number]): Lab {
  const [X, Y, Z] = toXyz(rgb);
  const fx = labF(X / WHITE_X);
  const fy = labF(Y / WHITE_Y);
  const fz = labF(Z / WHITE_Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/** Ottosson OKLab: linear sRGB -> LMS (M1) -> cube root -> OKLab (M2). */
function toOklab(rgb: readonly [number, number, number]): { L: number; a: number; b: number } {
  const r = linearize(rgb[0]);
  const g = linearize(rgb[1]);
  const b = linearize(rgb[2]);

  const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
  const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
  const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;

  const l_ = Math.cbrt(l);
  const m_ = Math.cbrt(m);
  const s_ = Math.cbrt(s);

  return {
    L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  };
}

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
const toDegrees = (radians: number): number => (radians * 180) / Math.PI;

/**
 * CIEDE2000 perceptual colour difference, `kL = kC = kH = 1`.
 *
 * Sharma, Wu & Dalal (2005), "The CIEDE2000 Color-Difference Formula: Implementation Notes,
 * Supplementary Test Data, and Mathematical Observations" — the formulation whose whole point
 * is the two traps named in the header.
 *
 * Symmetric: `deltaE2000(a, b) === deltaE2000(b, a)`. Identity: `deltaE2000(x, x) === 0`.
 *
 * Returns `null` if EITHER input fails `parseHex` — a caller must never be handed a plausible
 * distance computed against a colour that was never understood. See the totality contract.
 */
export function deltaE2000(a: unknown, b: unknown): number | null {
  const rgbA = parseHex(a);
  const rgbB = parseHex(b);
  if (!rgbA || !rgbB) return null;

  const { L: L1, a: a1, b: b1 } = toLab(rgbA);
  const { L: L2, a: a2, b: b2 } = toLab(rgbB);

  const C1 = Math.hypot(a1, b1);
  const C2 = Math.hypot(a2, b2);
  const cBar = (C1 + C2) / 2;

  // The a* expansion that pulls near-neutral colours away from the grey axis.
  const G = 0.5 * (1 - Math.sqrt(cBar ** 7 / (cBar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1;
  const a2p = (1 + G) * a2;

  const C1p = Math.hypot(a1p, b1);
  const C2p = Math.hypot(a2p, b2);

  // A colour with no chroma has no hue; `atan2(0, 0)` is 0 in JS but the formula wants the
  // hue treated as absent, which the `C1p * C2p === 0` guards below do.
  const h1p = a1p === 0 && b1 === 0 ? 0 : (toDegrees(Math.atan2(b1, a1p)) + 360) % 360;
  const h2p = a2p === 0 && b2 === 0 ? 0 : (toDegrees(Math.atan2(b2, a2p)) + 360) % 360;

  const dLp = L2 - L1;
  const dCp = C2p - C1p;

  let dhp: number;
  if (C1p * C2p === 0) {
    dhp = 0;
  } else {
    dhp = h2p - h1p;
    // TRAP 1, first half: take the SHORT way round the wheel, never the long one.
    if (dhp > 180) dhp -= 360;
    else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin(toRadians(dhp) / 2);

  const lBarP = (L1 + L2) / 2;
  const cBarP = (C1p + C2p) / 2;

  // TRAP 1, second half: the mean hue's quadrant. When the pair straddles the 0/360 seam the
  // arithmetic mean lands on the OPPOSITE side of the wheel from both inputs.
  let hBarP: number;
  if (C1p * C2p === 0) {
    hBarP = h1p + h2p;
  } else if (Math.abs(h1p - h2p) <= 180) {
    hBarP = (h1p + h2p) / 2;
  } else if (h1p + h2p < 360) {
    hBarP = (h1p + h2p + 360) / 2;
  } else {
    hBarP = (h1p + h2p - 360) / 2;
  }

  const T =
    1 -
    0.17 * Math.cos(toRadians(hBarP - 30)) +
    0.24 * Math.cos(toRadians(2 * hBarP)) +
    0.32 * Math.cos(toRadians(3 * hBarP + 6)) -
    0.20 * Math.cos(toRadians(4 * hBarP - 63));

  const dTheta = 30 * Math.exp(-(((hBarP - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(cBarP ** 7 / (cBarP ** 7 + 25 ** 7));

  const Sl = 1 + (0.015 * (lBarP - 50) ** 2) / Math.sqrt(20 + (lBarP - 50) ** 2);
  const Sc = 1 + 0.045 * cBarP;
  const Sh = 1 + 0.015 * cBarP * T;

  // TRAP 2: this term is NEGATIVE. A positive `Rt` returns plausible numbers everywhere and
  // only misorders near-blue pairs — the `Storm -> blue vs teal` row, margin 0.65.
  const Rt = -Math.sin(toRadians(2 * dTheta)) * Rc;

  const termL = dLp / Sl;
  const termC = dCp / Sc;
  const termH = dHp / Sh;

  return Math.sqrt(termL ** 2 + termC ** 2 + termH ** 2 + Rt * termC * termH);
}

/**
 * OKLCH: Ottosson OKLab in polar form.
 *
 * `L` is 0-1 (NOT CIE L*, which is 0-100 and lives in `wcag.ts` as `lStar`), `C` is the
 * chroma `hypot(a, b)`, and `h` is `atan2(b, a)` normalised into `[0, 360)`.
 *
 * The hue of a NEUTRAL is meaningless. `oklch('#f5f5f5')` returns a `C` under 0.005 and an `h`
 * that is numerically defined but carries no perceptual information — SPEC Req 1's >= 30° hue-gap
 * floor applies to the eight chromatic presets, and a caller must check `C` before trusting `h`.
 *
 * Returns `null` on a parse failure, per the totality contract.
 */
export function oklch(value: unknown): Oklch | null {
  const rgb = parseHex(value);
  if (!rgb) return null;
  const { L, a, b } = toOklab(rgb);
  const C = Math.hypot(a, b);
  const h = (toDegrees(Math.atan2(b, a)) + 360) % 360;
  return { L, C, h };
}
