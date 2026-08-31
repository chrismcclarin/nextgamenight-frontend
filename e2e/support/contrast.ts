import { expect, type Locator, type Page } from '@playwright/test';

import { blend, contrastRatio, deltaLStar, lStar, parseHex } from '../../src/lib/wcag';

/**
 * Phase 88.3 plan 01 — the Playwright half of the contrast toolkit (Gate C, plan 12).
 *
 * WHY IT LIVES UNDER `e2e/support/` AND NOT NEXT TO THE SPECS. Same reason as its only
 * sibling, `diagnostics.ts:14-20`: Playwright's default `testMatch` collects only files whose
 * basename ends in `.spec` or `.test`, so a module named `contrast.ts` is importable without
 * ever being enumerated as a suite. `npx playwright test --list` is the proof — the case
 * count must not move when this file lands. (Measured for this plan: 131 tests in 16 files
 * before, 131 tests in 16 files after.)
 *
 * SECURITY (threat T-88.3-01) — the standing rule for probe modules, restated verbatim in
 * intent from `diagnostics.ts:32-35`. This module reads COLOURS and element TAG/CLASS NAMES
 * only. No cookies, no storage, no headers, no `.auth/` content ever enters a returned
 * object or an attachment. Anything a probe returns can end up in a Playwright artifact that
 * GitHub Actions retains, so the returned shape is the security boundary, not the caller.
 *
 * ---------------------------------------------------------------------------------------
 * DECISION Phase 88.3 (OQ-2): the maths is reached by a RELATIVE path, not the `@/` alias.
 * ---------------------------------------------------------------------------------------
 * CHOSEN: a relative import of `src/lib/wcag` two directories up.
 *
 * REJECTED: the tsconfig path-alias form of the same import — `@/` followed by `lib/wcag`.
 * (Written apart on purpose: the acceptance gate for this plan greps that alias token and
 * requires ZERO occurrences in this file, so spelling it whole here would red the gate that
 * exists to keep it out. Do not "tidy" the two halves back together.)
 *
 * WHY. No file under `e2e/` imports from `src/` today — `grep -rn "from '@/" e2e/` and
 * `from '../src` both returned nothing before this plan, so Playwright's RUNTIME resolution
 * of tsconfig `paths` has zero precedent in this repo. `88.3-RESEARCH.md` A1 records the
 * "Playwright 1.60 honours tsconfig paths" claim as ASSUMED, at LOW confidence, and notes
 * that the only place it could be disproved is CI. That is the failure shape this repo keeps
 * paying for: a thing that compiles under `tsc` and fails to resolve in the browser runner,
 * discovered by a red CI run rather than locally. A relative path removes the dependency
 * entirely rather than betting on it, and `src/lib/wcag.ts` is deliberately import-free so
 * Playwright's transpiler never pulls a transitive module behind it.
 *
 * Switching this to the alias is a decision, not a cleanup — and it is one that cannot be
 * verified on a laptop.
 */

export { blend, contrastRatio, deltaLStar, lStar, parseHex };

/** One rung of the background walk. Colours and identity only — see the SECURITY note. */
export interface GroundLevel {
  tagName: string;
  /** `class` attribute, with SVG's `SVGAnimatedString` normalised to a string. */
  className: string;
  /** The raw computed `background-color`, exactly as Chromium returned it. */
  backgroundColor: string;
  /** True when the computed alpha is 0 — i.e. this rung paints nothing. */
  transparent: boolean;
}

export interface GroundResolution {
  /**
   * The computed `background-color` of the first rung that actually paints, as the raw
   * browser string (`rgb(...)` / `rgba(...)`). `null` when the whole chain was transparent.
   */
  color: string | null;
  /** Index into `levels` of the rung that resolved, or `-1` if none did. */
  resolvedAt: number;
  /** Tag of the element the walk terminated on, for diagnosis. */
  terminatedAt: string;
  /** Why the walk stopped — `body`, `fixed`, `resolved`, or `root`. */
  stoppedBecause: 'body' | 'fixed' | 'resolved' | 'root';
  levels: GroundLevel[];
}

/**
 * Walk from `anchor` up through its ancestors and return the first element that actually
 * paints a background, together with the full chain that was walked.
 *
 * WHY A WALK AT ALL. `getComputedStyle(el).backgroundColor` returns `rgba(0, 0, 0, 0)` for a
 * transparent element — NOT the colour a user sees through it. A naive read on a transparent
 * element would measure text against black and report a confidently wrong ratio.
 *
 * Structurally the same shape as the shipped `measurePaddingChain`
 * (`e2e/padding-budget.spec.ts:108-140`), and deliberately so — its three properties are
 * copied in intent, not just in style:
 *   - the `document.body` STOP, so the walk terminates;
 *   - the `position: fixed` BREAK (`DECISION Phase 87.8-12` at `:129`). A fixed element's
 *     containing block is the viewport, so an in-flow ancestor underneath a modal overlay is
 *     not what the user sees behind the modal. A modal's ground is the fixed box, not
 *     `<body>`. Walking past it measures a surface that is not on screen at that point;
 *   - the SVG `className` normalisation (`:135-136`), because SVG elements expose
 *     `className` as an `SVGAnimatedString` and `String(...)` of one is useless in a report.
 *
 * The chain is returned alongside the answer because the breakdown is what makes a red run
 * self-diagnosing without a re-run (`padding-budget.spec.ts:172-192`). It is NOT optional
 * output — do not trim it to just the colour.
 *
 * READ-ONLY: no scroll, no click, no style write. A probe that changed the page would
 * measure a state the assertion never saw.
 */
export async function resolveGroundColor(anchor: Locator): Promise<GroundResolution> {
  return anchor.evaluate((start: Element): GroundResolution => {
    // Re-declared inside the callback: this function is serialised into the browser and
    // cannot close over module scope (the constraint `diagnostics.ts` records).
    const alphaOf = (color: string): number => {
      const match = /^rgba?\(\s*([^)]*)\)$/i.exec(color.trim());
      if (!match) return color.trim().toLowerCase() === 'transparent' ? 0 : 1;
      const parts = match[1]
        .replace(/\//g, ' ')
        .split(/[\s,]+/)
        .filter((part) => part.length > 0);
      if (parts.length < 4) return 1;
      const alpha = Number(parts[3].endsWith('%') ? Number(parts[3].slice(0, -1)) / 100 : parts[3]);
      return Number.isFinite(alpha) ? alpha : 1;
    };

    const levels: GroundLevel[] = [];
    let node: Element | null = start;
    let outermost: Element = start;
    let resolvedAt = -1;
    let color: string | null = null;
    let stoppedBecause: GroundResolution['stoppedBecause'] = 'root';

    while (node) {
      const style = getComputedStyle(node);
      const backgroundColor = style.backgroundColor;
      const transparent = alphaOf(backgroundColor) === 0;
      levels.push({
        tagName: node.tagName.toLowerCase(),
        // SVG elements expose className as SVGAnimatedString — normalise.
        className:
          typeof node.className === 'string' ? node.className : String(node.getAttribute('class') ?? ''),
        backgroundColor,
        transparent,
      });
      outermost = node;

      if (!transparent) {
        resolvedAt = levels.length - 1;
        color = backgroundColor;
        stoppedBecause = 'resolved';
        break;
      }
      if (node === document.body) {
        stoppedBecause = 'body';
        break;
      }
      if (style.position === 'fixed') {
        stoppedBecause = 'fixed';
        break;
      }
      node = node.parentElement;
    }

    return {
      color,
      resolvedAt,
      terminatedAt: outermost.tagName.toLowerCase(),
      stoppedBecause,
      levels,
    };
  });
}

/** Render one rung the way `padding-budget.spec.ts:172-192` renders a padding level. */
function renderLevel(level: GroundLevel, index: number, resolvedAt: number): string {
  const marker = index === resolvedAt ? ' <== resolved ground' : '';
  return `  <${level.tagName}${level.className ? ` class="${level.className}"` : ''}> background-color=${level.backgroundColor}${level.transparent ? ' (transparent)' : ''}${marker}`;
}

/**
 * Failure message: which surface, what ground was resolved, and the full walked chain.
 *
 * Same contract as `describeChain` (`padding-budget.spec.ts:172-192`) — a contrast failure
 * that says only "expected 4.2 to be at least 4.5" cannot be acted on, because the argument
 * is always about WHICH ground was measured.
 */
export function describeGround(label: string, ground: GroundResolution): string {
  const breakdown = ground.levels.map((level, index) => renderLevel(level, index, ground.resolvedAt)).join('\n');
  return (
    `${label}: resolved ground = ${ground.color ?? 'NONE (the entire chain is transparent)'}\n` +
    `  walk stopped at <${ground.terminatedAt}> because: ${ground.stoppedBecause}\n` +
    `Ancestor chain, innermost first:\n${breakdown}`
  );
}

/**
 * Vacuity-guard message, in the `vacuityMessage` style
 * (`padding-budget.spec.ts:186-192` / `tailwind-v4-styles.spec.ts:139-143`).
 *
 * Two ways a contrast assertion goes vacuous, and neither is a CSS failure:
 *   1. NOTHING RESOLVED — every rung was transparent, so there is no ground to measure
 *      against and any ratio computed here would be against a colour nobody painted;
 *   2. A ONE-RUNG CHAIN — the locator landed on `<body>` itself or on a detached node, so
 *      the "ancestor walk" never walked.
 * Both mean the ANCHOR is wrong. Fix the locator; do not touch the tokens.
 */
export function vacuityGround(label: string, ground: GroundResolution): string {
  return (
    `${label}: the background walk produced ${ground.levels.length} rung(s) and resolved ` +
    `${ground.color === null ? 'NO opaque ground' : `a ground at rung ${ground.resolvedAt}`} ` +
    `(stopped because: ${ground.stoppedBecause}). Fewer than 2 rungs, or no resolved ground, means ` +
    `the locator did not find the intended element — it may have landed on <body> itself or on a ` +
    `detached node — so every contrast assertion below would be vacuous. This is a failure of the ` +
    `LOCATOR, not of the colour tokens: fix the anchor, do not touch globals.css.`
  );
}

/* =========================================================================================
 * Phase 88.3 plan 12 — the rendered half (Gate C).
 *
 * Everything below this line is what `e2e/contrast.spec.ts` needs in order to force a
 * theme, prove it landed, resolve a REAL ground and turn a computed-style string into a
 * number. It lives here rather than in the spec so the spec stays a list of surfaces and
 * floors.
 *
 * SECURITY, restated because this half returns more than the half above (threat
 * T-88.3-56, the standing rule from `diagnostics.ts:32-35`): every shape returned from
 * this module carries COLOURS and element TAG/CLASS NAMES only. No cookies, no storage
 * contents, no headers, no `.auth/` content, no URLs. What a probe returns is the security
 * boundary — a Playwright attachment is retained by GitHub Actions, so a field added here
 * is a field published there.
 *
 * -----------------------------------------------------------------------------------------
 * DECISION Phase 88.3 (Req 11): this gate asserts RATIOS and DELTA-L*, never a hex.
 * -----------------------------------------------------------------------------------------
 * CHOSEN: floor discipline. Every assertion in Gate C compares a MEASURED ratio or a
 * measured lightness delta against the SPEC's floor. No assertion pins a colour value.
 *
 * REJECTED: pinning the computed colour strings themselves, and screenshot baselines.
 *
 * WHY. It is the same goal `tailwind-v4-styles.spec.ts:37-40` had when it banned pinned
 * pixel values: a future re-tint that still clears its floor must not churn this file. A
 * ratio IS a value — that is the narrow exception being taken here, and it is taken
 * deliberately rather than by omission — but it is the value the requirement is written
 * in, so an assertion on it can only fail when the requirement fails. A hex assertion
 * fails whenever anyone changes a colour, including changes that improve it.
 * Screenshot baselines were already ruled out for this reason by 87.7 D-12, and Req 12's
 * owner phone UAT owns "does it look right"; this file owns "does it clear the floor".
 *
 * Turning any floor below into an equality, or adding a hex literal, is a decision, not a
 * cleanup.
 *
 * -----------------------------------------------------------------------------------------
 * AMENDED Phase 88.3.1-W (AMENDMENT W / PLAN-REVIEW Defect 5, owner-ruled "fix it"
 * 2026-08-30). The block above is kept VERBATIM and still governs every other assertion in
 * Gate C. This amendment carves out exactly one narrow class, and names its boundary.
 * -----------------------------------------------------------------------------------------
 * WHAT IS CARVED OUT: the two AMENDMENT W tests in `contrast.spec.ts` ("the PRESET's own
 * values are what render") assert GROUND IDENTITY — the rendered ground of
 * `E2E_PRESET_ONLY_GROUP_ID` must EQUAL the `blue` preset's `light` / `dark` value. That is
 * an equality on a colour, which the block above forbids by default.
 *
 * WHY IT IS TAKEN ANYWAY, on the block's OWN logic rather than against it. Its test is "is
 * this the value the requirement is written in?" — that is why a ratio was allowed as the
 * narrow exception. SPEC Req 4's requirement here is not legibility; it is that the frontend
 * resolves `color_preset` THROUGH `src/lib/groupColourPresets.ts` rather than reading
 * `background_color`. A floor cannot see that difference: a wrong resolver, a stale table
 * or a legacy-hex fallback can all clear any lightness floor while the requirement fails.
 * The value IS the requirement in this one case, so an equality on it can only fail when the
 * requirement fails — which is precisely the block's own standard.
 *
 * AND THE CHURN OBJECTION IS DISSOLVED, NOT ACCEPTED. The expected value is IMPORTED from
 * `src/lib/groupColourPresets.ts` (relative path, same D-OQ-2 reasoning as this file's
 * `wcag` import) and converted with `parseHex`. There is NO hex literal in the spec. A
 * future palette re-tune moves the assertion with the palette and churns nothing — the
 * failure mode the block above was written to prevent cannot occur here.
 *
 * WHAT IS NOT CHANGED, said plainly so this is not read as a general licence: every ratio and
 * every delta-L* assertion in Gate C stays floor-based, including the ones in the very tests
 * this amendment adds a sibling to. Screenshot baselines stay rejected (87.7 D-12). Adding a
 * hex LITERAL anywhere in `contrast.spec.ts` is still forbidden by the block above, and this
 * amendment is not authority for a second equality — a new one needs the same argument made
 * again, in writing.
 * ======================================================================================= */

/** A colour normalised out of whatever Chromium serialised, plus the raw string. */
export interface NormalisedColor {
  /** Exactly what `getComputedStyle` returned, kept for failure messages. */
  raw: string;
  /**
   * The opaque channels as `rgb(r, g, b)` — a form `src/lib/wcag.ts`'s `parseHex` accepts.
   * `null` when the raw value is not a colour at all (e.g. a `box-shadow` string).
   */
  css: string | null;
  /** 0-1. `null` when `css` is `null`. */
  alpha: number | null;
}

/** One rung of the ground walk, with its colour normalised. */
export interface ProbeLevel extends GroundLevel {
  color: NormalisedColor;
}

export interface ElementProbe {
  /** Requested properties (longhand or custom property), normalised where they are colours. */
  computed: Record<string, NormalisedColor>;
  levels: ProbeLevel[];
  resolvedAt: number;
  /** Index of the first FULLY OPAQUE rung, or -1 when the walk never found one. */
  opaqueAt: number;
  terminatedAt: string;
  stoppedBecause: GroundResolution['stoppedBecause'];
}

/**
 * ONE browser-side probe, used by every read in this module.
 *
 * WHY ONE FUNCTION AND NOT SEVERAL. A Playwright `evaluate` callback is serialised into
 * the page and cannot close over module scope (the constraint `diagnostics.ts` records),
 * so any helper it needs must be re-declared inside it. Three separate probes would mean
 * three copies of the colour normaliser — and the plan requires the SAME normalisation at
 * every call site, because a ratio computed from a differently-parsed string is a number
 * nobody can defend. One probe, one normaliser.
 *
 * NORMALISATION, and why it is a canvas round-trip rather than a regex. Tailwind v4
 * compiles `color-mix()`-based utilities (including slash-opacity on a theme colour), and
 * Chromium is free to serialise the computed result as `oklab(...)`, `oklch(...)` or
 * `color(srgb ...)` rather than `rgba(...)`. `parseHex` understands hex and `rgb()/rgba()`
 * only — by design; it is the token-layer parser. Painting the value into a 1x1 canvas and
 * reading `getImageData` converts ANY CSS colour Chromium can parse into sRGB channels
 * plus alpha, uniformly, with no format list to keep in sync. `CSS.supports('color', v)`
 * runs FIRST because an invalid or empty value would otherwise leave `fillStyle` at its
 * default black and silently produce a confident, wrong number.
 *
 * READ-ONLY: no scroll, no click, no style write.
 */
export async function probeElement(anchor: Locator, props: string[] = ['color']): Promise<ElementProbe> {
  return anchor.evaluate((start: Element, wanted: string[]): ElementProbe => {
    // Re-declared inside the callback — see the WHY note above.
    const normalise = (value: string): NormalisedColor => {
      const raw = value ?? '';
      const trimmed = raw.trim();
      if (trimmed.length === 0 || !CSS.supports('color', trimmed)) {
        return { raw, css: null, alpha: null };
      }
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return { raw, css: null, alpha: null };
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = trimmed;
      ctx.fillRect(0, 0, 1, 1);
      const data = ctx.getImageData(0, 0, 1, 1).data;
      return {
        raw,
        css: `rgb(${data[0]}, ${data[1]}, ${data[2]})`,
        alpha: data[3] / 255,
      };
    };

    const style = getComputedStyle(start);
    const computed: Record<string, NormalisedColor> = {};
    for (const prop of wanted) {
      computed[prop] = normalise(
        prop.startsWith('--') ? style.getPropertyValue(prop) : style.getPropertyValue(prop)
      );
    }

    const levels: ProbeLevel[] = [];
    let node: Element | null = start;
    let outermost: Element = start;
    let resolvedAt = -1;
    let opaqueAt = -1;
    let stoppedBecause: GroundResolution['stoppedBecause'] = 'root';

    while (node) {
      const nodeStyle = getComputedStyle(node);
      const color = normalise(nodeStyle.backgroundColor);
      const alpha = color.alpha ?? 0;
      levels.push({
        tagName: node.tagName.toLowerCase(),
        // SVG elements expose className as SVGAnimatedString — normalise.
        className:
          typeof node.className === 'string' ? node.className : String(node.getAttribute('class') ?? ''),
        backgroundColor: color.raw,
        transparent: alpha === 0,
        color,
      });
      outermost = node;

      if (alpha > 0 && resolvedAt === -1) resolvedAt = levels.length - 1;
      if (alpha === 1) {
        opaqueAt = levels.length - 1;
        stoppedBecause = 'resolved';
        break;
      }
      if (node === document.body) {
        stoppedBecause = 'body';
        break;
      }
      // Same `position: fixed` BREAK as `resolveGroundColor` above and
      // `measurePaddingChain` (`padding-budget.spec.ts:129`): a fixed element's containing
      // block is the viewport, so an in-flow ancestor underneath a modal is not what the
      // user sees behind the modal.
      if (nodeStyle.position === 'fixed') {
        stoppedBecause = 'fixed';
        break;
      }
      node = node.parentElement;
    }

    return {
      computed,
      levels,
      resolvedAt,
      opaqueAt,
      terminatedAt: outermost.tagName.toLowerCase(),
      stoppedBecause,
    };
  }, props);
}

/** The `GroundResolution` shape `describeGround` / `vacuityGround` above already speak. */
export function groundResolutionOf(probe: ElementProbe): GroundResolution {
  return {
    color: probe.resolvedAt >= 0 ? probe.levels[probe.resolvedAt].backgroundColor : null,
    resolvedAt: probe.resolvedAt,
    terminatedAt: probe.terminatedAt,
    stoppedBecause: probe.stoppedBecause,
    levels: probe.levels.map(({ tagName, className, backgroundColor, transparent }) => ({
      tagName,
      className,
      backgroundColor,
      transparent,
    })),
  };
}

/**
 * The ground a human actually sees, as an OPAQUE `rgb(...)` string.
 *
 * WHY IT COMPOSITES rather than returning the first painting rung. `resolveGroundColor`
 * above stops at the first rung with a non-zero alpha, which is the right answer for the
 * common case and the WRONG one for a translucent wash — `LandingPage.js:31`'s
 * `bg-white/20` over the hero is exactly that, and it is UI-SPEC §11 OI-7, "the one value
 * not computable from tokens". A ratio computed against `rgba(255,255,255,0.2)` would be a
 * ratio against a colour nobody painted. So the walk continues to the first FULLY opaque
 * rung and blends the translucent rungs back down onto it, outermost first, with the same
 * `blend` the token gate uses.
 *
 * `from` selects the innermost rung to composite. `0` (the default) INCLUDES the element's
 * own background, which is what a text colour sits on. `1` EXCLUDES it — the ground just
 * OUTSIDE the element's border box, which is where a non-inset focus ring is painted. That
 * distinction is not cosmetic: see `focusRingMeasurement`.
 *
 * Returns `null` when the chain never reached an opaque rung — the caller must fail loudly
 * rather than pick a number (see `vacuityGround`).
 */
export function compositeGround(probe: ElementProbe, from = 0): string | null {
  if (probe.opaqueAt < 0 || from > probe.opaqueAt) return null;
  let result = probe.levels[probe.opaqueAt].color.css;
  if (!result) return null;
  for (let i = probe.opaqueAt - 1; i >= from; i -= 1) {
    const layer = probe.levels[i].color;
    if (!layer.css || layer.alpha === null || layer.alpha === 0) continue;
    const blended = blend(layer.css, layer.alpha, result);
    if (!blended) return null;
    result = blended;
  }
  return result;
}

/**
 * Throw with the RAW computed string when a value did not survive normalisation.
 *
 * The vacuity rule for this gate: a NaN must never reach a ratio, an L* or an alpha
 * comparison, where it could pass or fail for a reason that has nothing to do with the
 * requirement. Every unparsed read stops the test HERE, naming what came back.
 */
function requireColor(label: string, value: NormalisedColor | undefined): string {
  if (!value || value.css === null) {
    throw new Error(
      `${label}: the computed value did not normalise to a colour. Raw computed-style string: ` +
        `${JSON.stringify(value?.raw ?? '(property absent)')}. This is a PROBE failure, not a ` +
        `contrast failure — do not "fix" it by relaxing a floor.`
    );
  }
  return value.css;
}

export interface Measurement {
  ratio: number;
  /** The foreground, opaque, as `rgb(...)`. */
  fg: string;
  /** The composited ground, opaque, as `rgb(...)`. */
  ground: string;
  probe: ElementProbe;
  resolution: GroundResolution;
}

/**
 * Contrast of one computed property against the element's composited ground.
 *
 * `property` defaults to `color`; pass a border longhand (`border-top-color`) or a custom
 * property when the requirement is about something other than text.
 */
export async function ratioAgainstGround(
  anchor: Locator,
  label: string,
  property = 'color'
): Promise<Measurement> {
  const probe = await probeElement(anchor, [property]);
  const fg = requireColor(`${label} — computed ${property}`, probe.computed[property]);
  const ground = compositeGround(probe);
  if (ground === null) {
    throw new Error(
      `${label}: the background walk never reached a fully opaque rung, so there is no ground to ` +
        `measure against.\n${describeGround(label, groundResolutionOf(probe))}`
    );
  }
  const ratio = contrastRatio(fg, ground);
  if (ratio === null) {
    throw new Error(`${label}: could not compute a ratio from fg=${fg} ground=${ground}.`);
  }
  return { ratio, fg, ground, probe, resolution: groundResolutionOf(probe) };
}

/**
 * CIE L* of an element's own DECLARED ground (Req 9's `L* >= 75` floor, SPEC amended
 * 2026-08-25 to a t = 0.70 tint; it was 85).
 *
 * READ THIS BEFORE TRUSTING THE NUMBER: it resolves the ground the same way
 * `resolveGroundColor` does — by walking ANCESTORS. It therefore CANNOT see a
 * dim overlay, and never could: `groupHomePage/page.js`'s dim is an absolutely-positioned
 * SIBLING-ORDER CHILD of the header, not an ancestor of anything. That is not a gap in
 * this helper, it is what the DOM is. The overlay is verified separately and explicitly,
 * in the spec (surfaces 8 and 9), by reading the overlay element's OWN computed
 * `background-color` alpha. Both halves ship; neither substitutes for the other, and
 * calling this "the rendered pixel with the dim applied" would be a false claim.
 */
export async function lStarOfGround(anchor: Locator, label: string): Promise<{ value: number; ground: string; probe: ElementProbe }> {
  const probe = await probeElement(anchor, []);
  const ground = compositeGround(probe);
  if (ground === null) {
    throw new Error(
      `${label}: the background walk never reached a fully opaque rung, so there is no ground ` +
        `lightness to report.\n${describeGround(label, groundResolutionOf(probe))}`
    );
  }
  const value = lStar(ground);
  if (value === null) throw new Error(`${label}: could not compute L* from ground=${ground}.`);
  return { value, ground, probe };
}

/**
 * Force LIGHT mode for the whole context, before the app's first paint.
 *
 * `addInitScript`, NOT a post-load `page.evaluate`, and NOT Playwright's media-emulation
 * API. (That API's name is deliberately not spelled here: this plan's acceptance gate greps
 * this file for it and requires ZERO occurrences, so naming it would red the gate that
 * exists to keep it out. Same "written apart on purpose" idiom as the `@/` alias note at the
 * top of this file — do not "tidy" the two halves back together.)
 *   - MEDIA EMULATION cannot switch this app's theme AT ALL. `ThemeProvider.js` passes
 *     `attribute="class"`, `defaultTheme="dark"`, `storageKey="theme"`; `globals.css`
 *     declares ZERO `prefers-color-scheme` rules and the dark variant is a
 *     `@custom-variant dark` class selector. The media query is not wired to anything.
 *   - a post-load `evaluate` is too late. `e2e/auth.setup.ts` calls
 *     `storageState({ path: AUTH_FILE })`, which BAKES localStorage into `.auth/user.json`;
 *     next-themes reads that stored key on mount, so by the time a post-load script ran the
 *     page would already have applied the stored value and painted. An init script runs
 *     before any page script on every navigation, so the write lands first.
 *
 * This is a hope until `assertTheme` proves it — see there.
 */
export async function forceLightMode(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem('theme', 'light');
  });
}

/**
 * Assert the theme BEFORE any style is read. Mandatory, not defensive.
 *
 * Mirrors the D-11 pre-assertion marker at `tailwind-v4-styles.spec.ts:80-88`: a style
 * assertion that ran in the wrong theme is meaningless, and its failure would be
 * misdiagnosed as a colour bug in whichever theme the reader assumed was active. This
 * assertion is also the thing that converts `88.3-RESEARCH.md`'s UNVERIFIED assumption A2
 * — that the init-script write beats the baked `storageState` — from a hope into a red
 * test (threat T-88.3-55).
 */
export async function assertTheme(page: Page, theme: 'light' | 'dark'): Promise<void> {
  const pattern = theme === 'light' ? /light/ : /dark/;
  await expect(
    page.locator('html'),
    `theme pre-assertion: expected <html> to carry the "${theme}" class before any style is read. ` +
      `If this fails, every contrast assertion below would have measured the WRONG THEME.`
  ).toHaveClass(pattern);
}

/**
 * Give an element a REAL keyboard focus, so `:focus-visible` matches.
 *
 * Both halves are load-bearing. `locator.focus()` alone is programmatic focus, and
 * Chromium only matches `:focus-visible` on programmatic focus when the user's most recent
 * interaction was a KEYBOARD one — hence the `Tab` press first, purely to set that
 * modality. Without it the ring rules never apply and `--tw-ring-color` comes back empty,
 * which `requireColor` would (correctly) turn into a probe failure. A bare `:focus`
 * variant would not help: `Button.tsx:62` and `Input.tsx:80` both use `focus-visible:`
 * deliberately, so that pointer and programmatic focus do NOT draw a ring.
 */
export async function focusByKeyboard(page: Page, anchor: Locator): Promise<void> {
  await page.keyboard.press('Tab');
  await anchor.focus();
}

/**
 * The focus ring's colour and its ratio against THE GROUND THE RING IS ACTUALLY DRAWN ON.
 *
 * ---------------------------------------------------------------------------------------
 * DECISION Phase 88.3 (Req 7): the ring is measured against its ADJACENT ground, which is
 * not always the element's own background.
 * ---------------------------------------------------------------------------------------
 * CHOSEN: three cases, decided from the element's own computed ring variables.
 *   - `ring-inset` -> the ring is painted INSIDE the border box, so its ground is the
 *     element's own composited background (`from = 0`).
 *   - a non-zero `ring-offset-width` -> Tailwind paints an offset ring in
 *     `--tw-ring-offset-color` (unset default: white) between the border box and the ring,
 *     so THAT is what the ring sits against — not the element's fill, which the offset
 *     hides.
 *   - otherwise -> the ring is painted immediately outside the border box, on the
 *     ancestor's background (`from = 1`).
 *
 * REJECTED: always measuring against the element's own background.
 *
 * WHY, and it is a measured reason rather than a tidy one. `88.3-SPEC.md:179-182` names
 * "the amber-500 primary button" as Req 7's fourth ground at 3.63:1. The shipped
 * `--color-btn-primary` on this tree is a SLATE BLUE, not amber-500 (the hex is deliberately
 * not written here: this file's acceptance gate greps it for six-digit hex literals and
 * requires zero, so quoting the value would red the gate that keeps colour values out of the
 * probe. Read it from `globals.css`). The light ring `purple-700` measures **1.377:1**
 * against that fill. Asserting that number would red a
 * gate over a ground NOBODY SEES: every `.btn` focus site in this app carries
 * `focus-visible:ring-offset-2`, so a 2px white offset ring sits between the button fill
 * and the coloured ring, and the ring's real neighbour is that white. Measuring the fill
 * would be measuring a colour the ring never touches.
 *
 * Collapsing these three cases back into one is a decision, not a cleanup — and it is one
 * that changes what the numbers MEAN, not merely how they are computed.
 */
export async function focusRingMeasurement(
  page: Page,
  anchor: Locator,
  label: string
): Promise<Measurement & { boxShadow: string; ringGroundKind: 'inset' | 'offset' | 'outside' }> {
  await focusByKeyboard(page, anchor);
  const probe = await probeElement(anchor, [
    '--tw-ring-color',
    '--tw-ring-inset',
    '--tw-ring-offset-width',
    '--tw-ring-offset-color',
    'box-shadow',
  ]);
  const ring = requireColor(
    `${label} — focus ring (--tw-ring-color; empty means the element never matched :focus-visible)`,
    probe.computed['--tw-ring-color']
  );

  const inset = (probe.computed['--tw-ring-inset']?.raw ?? '').trim() === 'inset';
  const offsetWidth = Number.parseFloat(probe.computed['--tw-ring-offset-width']?.raw ?? '0') || 0;

  let ground: string | null;
  let ringGroundKind: 'inset' | 'offset' | 'outside';
  if (inset) {
    ringGroundKind = 'inset';
    ground = compositeGround(probe, 0);
  } else if (offsetWidth > 0) {
    ringGroundKind = 'offset';
    const offset = probe.computed['--tw-ring-offset-color'];
    const offsetCss = requireColor(`${label} — ring offset colour`, offset);
    const behind = compositeGround(probe, 1) ?? compositeGround(probe, 0);
    // The offset ring can itself be translucent; blend it onto whatever is behind it.
    ground = offset?.alpha === 1 || behind === null ? offsetCss : blend(offsetCss, offset?.alpha ?? 1, behind);
  } else {
    ringGroundKind = 'outside';
    // A non-inset, zero-offset ring is a box-shadow drawn just OUTSIDE the border box, so it
    // overlaps the PARENT's background, not the element's own fill. `compositeGround(probe, 1)`
    // gives that whenever the element itself is transparent — but when the element PAINTS (the
    // `Input` primitive carries `bg-surface-input`, `Input.tsx:74`), the walk already stopped on
    // the element's own rung and there is nothing above index 0 to composite. Probing the parent
    // is the only way to see what the ring actually sits on. Falling back to `compositeGround(probe, 0)`
    // here would silently report the ring's contrast against the fill it is drawn OUTSIDE OF.
    const outside = compositeGround(probe, 1);
    ground = outside ?? compositeGround(await probeElement(anchor.locator('xpath=..'), []), 0);
  }

  if (ground === null) {
    throw new Error(
      `${label}: no opaque ground under the focus ring (kind=${ringGroundKind}).\n` +
        describeGround(label, groundResolutionOf(probe))
    );
  }
  const ratio = contrastRatio(ring, ground);
  if (ratio === null) throw new Error(`${label}: could not compute a ring ratio from ${ring} on ${ground}.`);
  return {
    ratio,
    fg: ring,
    ground,
    probe,
    resolution: groundResolutionOf(probe),
    boxShadow: probe.computed['box-shadow']?.raw ?? '',
    ringGroundKind,
  };
}

/** Failure message for a ratio floor: the two colours AND the ground chain that produced them. */
export function describeRatio(label: string, floor: number, m: Measurement): string {
  return (
    `${label}: measured ${m.ratio.toFixed(3)}:1 against a floor of ${floor}:1 ` +
    `(foreground ${m.fg} on composited ground ${m.ground}).\n` +
    describeGround(label, m.resolution)
  );
}

/** Failure message for a delta-L* floor between two resolved grounds. */
export function describeDelta(label: string, floor: number, a: string, b: string, measured: number): string {
  return (
    `${label}: measured delta-L* ${measured.toFixed(2)} against a floor of ${floor} ` +
    `(${a} vs ${b}). Two surfaces can clear every contrast floor and still be ` +
    `indistinguishable; only a lightness delta says so (SPEC Req 1).`
  );
}
