import type { Locator } from '@playwright/test';

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
