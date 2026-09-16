/**
 * Req 1 (DES-01) repo-wide guard: no text-entry form control may render below 16px,
 * because mobile Safari focus-zooms the whole page when one is tapped.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST
 * -----------------------------------------------
 * The property is "every control in the app", and there is no single render that
 * reaches all of them — they live behind modals, tabs, role gates and fetch states
 * across 20+ surfaces. A per-surface render pin would also go green forever the
 * moment a 21st surface is added, which is the failure mode 88-19 called out for
 * named-control pins. So this walks the source instead.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP
 * -----------------------------------
 * 88-21's own verify gate is
 *     grep -rnE "<(input|select|textarea)[^>]*text-(xs|sm)" src
 * and it is VACUOUS: `grep` is line-based and `[^>]*` cannot cross a newline, but
 * every control in this repo writes its `className` on a different line from the
 * opening tag. Measured against the untouched pre-88-21 tree, that pattern matched
 * ZERO of the 14 controls that were actually carrying `text-sm` at the time. It
 * passes whether or not the work was done, so it can never fail and never protected
 * anything. The scanner below balances braces to read the whole opening tag.
 *
 * WHY IT ALSO SCANS `<Input>` / `<Textarea>` / `<SelectControl>` CALL SITES
 * ------------------------------------------------------------------------
 * A first cut of this file scanned raw DOM tags only, and its own negative check
 * exposed the hole: `<Input className="text-sm" />` renders at 14px and the raw-tag
 * scan cannot see it, because after adoption the control is a component. The
 * primitive is not self-defending here — it composes via `cn()`, i.e. `twMerge`,
 * where the CALLER's `text-sm` beats the primitive's own `text-base`. So the more
 * of the app that adopts the primitive, the blinder a raw-tag-only scan gets. Both
 * shapes are checked.
 *
 * AMENDED Phase 88.6-12 (AC-2 / R5) — the paragraph below is KEPT AS HISTORY and its
 * conclusion no longer holds. It used to read, in full:
 *
 *   "Deliberately NOT asserted here: the 44px touch-target floor. That is a separate
 *    requirement, it is explicitly gated on a call-site census (88-SPEC.md:111 — 'never
 *    a blanket rule with no census'), and DEF-88-20-01 owns it. Adding a height
 *    assertion to this file would smuggle that decision in."
 *
 * The census that sentence was waiting on EXISTS now — Phase 88.6's 120-site `.btn`
 * census — and DEF-88-25-01 routes the floor here. So the second `describe` below asserts
 * three geometry floors. Nothing was smuggled: each one names the census or the D-13
 * pattern that authorises it, and the two that are not yet met carry a counted, owned
 * `ExemptionRoster` entry rather than a softened threshold.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../../test-utils/exemption';
import { readOpeningTag, sourceFiles } from '../../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '../..');

/** `<input type>` values that are not text entry — iOS does not focus-zoom these. */
const NON_TEXT_INPUT_TYPES = new Set([
  'checkbox', 'radio', 'range', 'file', 'color',
  'button', 'submit', 'reset', 'image', 'hidden',
]);

/** Class constants that carry `text-base` at their own definition site. */
const FLOORED_CLASS_CONSTANTS = /\b(controlClass|DEFAULT_SELECT_CLASS)\b/;

const SUB_16 = /(?<![\w:-])text-(xs|sm)(?![\w-])/;
const AT_LEAST_16 = /(?<![\w:-])text-(base|lg|xl)(?![\w-])/;
/** A breakpoint-prefixed size is never a fix: `md:` is the range phones sit BELOW. */
const BREAKPOINT_SIZE = /\b(sm|md|lg|xl|2xl):text-(base|lg|xl)/;

/** Blank out comments and string bodies, preserving byte offsets so lines stay right. */
function stripComments(text: string): string {
  const out = text.split('');
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '"' || c === "'" || c === '`') {
      i += 1;
      while (i < text.length && text[i] !== c) {
        if (text[i] === '\\') i += 1;
        i += 1;
      }
      i += 1;
    } else if (text.startsWith('//', i)) {
      while (i < text.length && text[i] !== '\n') out[i++] = ' ';
    } else if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2);
      const stop = end === -1 ? text.length : end + 2;
      for (let k = i; k < stop; k += 1) if (out[k] !== '\n') out[k] = ' ';
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

// `readOpeningTag` was RELOCATED to `src/test-utils/sourceScan.ts` by Phase 88.6-09 and is
// imported above. It is the same brace-balanced reader this file has always used, plus a
// length bound; the walk that suite adds is its second caller, and a second COPY of a
// scanner is the drift the Phase 88 gate ledger records fifteen times.

// DECISION Phase 88-31 (DEF-88-29-01): `sourceFiles` is IMPORTED from
// `src/test-utils/sourceScan.ts`, chosen OVER keeping this suite's private copy.
//
// 88-29 extracted `stringChunks` and deliberately left `sourceFiles` alone, because its six
// copies had visibly different SIGNATURES — `(dir)` vs `(dir, out = [])` vs `(dir, acc = [])`
// — and converging them from the plan whose job was arming gates would have been an
// unannounced behaviour change to six shipped, negative-checked suites. This is the residual
// pass that entry named as the owner, and the convergence was MEASURED before it was made,
// not assumed from reading:
//   - four copies (this one's family) were semantically identical to the canonical one;
//   - `cardPaddingIdiom`'s carried an extra `node_modules` skip, and there are ZERO
//     `node_modules` directories under `src/` (measured), so it was dead;
//   - `controlSizeFloor`'s excluded `.test.` but NOT `.spec.`, and there are ZERO `.spec.`
//     files under `src/` (measured), so its set was identical too. Its root is `src/`, the
//     same as everyone else's — the "different root" in the deferral was a misreading.
// So all six enumerated the same files, and this is a verbatim move rather than a behaviour
// change. Each suite's own anti-vacuity floor (`files.length > 100`) still holds afterwards.
//
// Re-inlining a private copy here is a decision, not a cleanup: six copies of a directory
// walker is five places a correctness fix — a new extension, a newly-excluded directory — can
// be forgotten, which is the drift shape the Phase 88 gate ledger records fifteen times, one
// layer down.

/**
 * AC-11 (owner ruling 2026-09-09): the tree is enumerated, READ and comment-stripped
 * EXACTLY ONCE, here at module scope, and every assertion in this file consumes this one
 * result rather than re-walking.
 *
 * Phase 88.6-12 HOISTED the read+strip out of `textEntryControls()` (where it had been the
 * single walk this file was already cited for) so that the three geometry arms in the
 * second `describe` could join it instead of adding a second pass. `textEntryControls()`
 * is otherwise unchanged and its four shipped assertions read the same bytes they always
 * did. Adding a cache to `src/test-utils/sourceScan.ts` to get the same effect is
 * FORBIDDEN — AC-12, "no shared-module cache this phase".
 *
 * Measured 2026-09-15: 194 non-test files under `src/`.
 */
const SOURCES: { rel: string; raw: string; scannable: string }[] = sourceFiles(SRC).map(
  (file) => {
    const raw = fs.readFileSync(file, 'utf8');
    return { rel: path.relative(SRC, file), raw, scannable: stripComments(raw) };
  },
);

/** 1-based source line of `offset` within `raw` — the form this file has always used. */
function lineOf(raw: string, offset: number): number {
  return raw.slice(0, offset).split('\n').length;
}

interface Control {
  where: string;
  tag: string;
  inputType: string | null;
  /** True when the element is a primitive (or uses a floored class constant). */
  carriesFloorByConstruction: boolean;
}

function textEntryControls(): Control[] {
  const found: Control[] = [];
  for (const { rel, raw, scannable } of SOURCES) {
    // Raw DOM tags AND the three primitive components they get adopted onto.
    const opener = /<(input|select|textarea|Input|Textarea|SelectControl)(?=[\s/>])/g;
    let match: RegExpExecArray | null;
    while ((match = opener.exec(scannable)) !== null) {
      const tag = readOpeningTag(scannable, match.index);
      if (!tag) continue;
      const typeMatch = /type=["']([a-z]+)["']/.exec(tag);
      const inputType = typeMatch ? typeMatch[1] : null;
      const isInput = match[1] === 'input' || match[1] === 'Input';
      if (isInput && inputType && NON_TEXT_INPUT_TYPES.has(inputType)) continue;
      // The primitives carry the floor themselves; only a caller override can break it.
      const isPrimitive = /^(Input|Textarea|SelectControl)$/.test(match[1]);
      const line = lineOf(raw, match.index);
      found.push({
        where: `${rel}:${line} <${match[1]}>`,
        tag,
        inputType,
        carriesFloorByConstruction: isPrimitive || FLOORED_CLASS_CONSTANTS.test(tag),
      });
    }
  }
  return found;
}

describe('Req 1 (DES-01): the 16px iOS focus-zoom floor, repo-wide', () => {
  const controls = textEntryControls();

  it('finds text-entry controls to check (guards against a scanner that silently matches nothing)', () => {
    // If a refactor breaks the scanner, every assertion below passes vacuously.
    // This is the exact failure mode of the grep gate this file replaces.
    expect(controls.length).toBeGreaterThan(3);
  });

  it('has no control carrying a sub-16px size', () => {
    const offenders = controls.filter((c) => SUB_16.test(c.tag)).map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('has no control whose only 16px size is behind a breakpoint prefix', () => {
    // `md:` and up is the range phones sit ABOVE the zoom threshold anyway — a
    // breakpoint-prefixed size applies the safe value to desktop and the zooming
    // value to the one viewport that zooms. See the marker in ui/Input.tsx.
    const offenders = controls
      .filter((c) => BREAKPOINT_SIZE.test(c.tag) && !AT_LEAST_16.test(c.tag))
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('has every control take its size explicitly, not by inheritance', () => {
    // An unsized raw control renders at whatever its surface happens to set. That
    // can be correct today and silently drop below 16px when an ancestor changes,
    // so the contract is an explicit size or a primitive that carries one.
    const offenders = controls
      .filter((c) => !AT_LEAST_16.test(c.tag) && !c.carriesFloorByConstruction)
      .map((c) => c.where);
    expect(offenders).toEqual([]);
  });

  it('scans primitive call sites too, not just raw DOM tags', () => {
    // Regression guard on the scanner itself. Once a surface adopts <Input>, a
    // raw-tag-only scan goes blind to it — so if this count ever hits zero, the
    // three assertions above have quietly stopped covering the adopted surfaces.
    const primitiveSites = controls.filter((c) => /<(Input|Textarea|SelectControl)>/.test(c.where));
    expect(primitiveSites.length).toBeGreaterThan(20);
  });
});

// ---------------------------------------------------------------------------------------
// Phase 88.6-12 — the GEOMETRY floors (AC-2 desktop arm + the two D-13-pattern controls)
// ---------------------------------------------------------------------------------------

/**
 * Strip Tailwind variant prefixes and the `!` important marker.
 *
 * A LOCAL copy of `surfaceHoverSweep.test.ts:101`, and that is a constraint rather than a
 * choice: `DECISION Phase 88-29` (quoted in `src/test-utils/sourceScan.ts`'s docblock)
 * rejects "exporting the lexer from one of the test files" because a test module's body
 * registers its `describe` blocks on import, and AC-12 forbids adding anything to the
 * shared module this phase. `.planning/WINDOWS.md` entry 12 already owns the convergence.
 *
 * CORRECTION, recorded rather than propagated: `88.6-09-SUMMARY.md` decision 6 states this
 * constant "is defined in `sourceScan.ts`". Re-measured 2026-09-15 —
 * `grep -rn STRIP_VARIANTS src` returns hits only in `surfaceHoverSweep.test.ts`, never in
 * `sourceScan.ts`. It is a test-file-local const in every copy.
 */
const STRIP_VARIANTS = /^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/;

/** The WCAG 2.2 2.5.8 minimum, and the project's own phone floor, as pixels. */
const MIN_TARGET_24 = 24;
const MIN_TARGET_44 = 44;

/**
 * Resolve a `min-h-*` / `h-*` / `min-w-*` / `w-*` utility to pixels, or `null` when it
 * cannot be resolved from the token alone.
 *
 * `null` is NEVER treated as an offender. `min-h-full`, `min-h-screen`, `min-h-dvh` and the
 * fraction forms all resolve against something this scan cannot see, and flagging them
 * would be a guess — the arms below only ever flag a value they can PROVE is below the
 * floor. Tailwind's numeric scale is 0.25rem per step at the shipped default (16px root),
 * so `min-h-11` is 44px; `-px` is the literal 1px rung.
 */
function utilityPx(token: string, prefixes: string[]): number | null {
  for (const prefix of prefixes) {
    if (!token.startsWith(`${prefix}-`)) continue;
    const value = token.slice(prefix.length + 1);
    if (value === 'px') return 1;
    if (/^\d+(\.\d+)?$/.test(value)) return parseFloat(value) * 4;
    const arbitrary = /^\[(-?\d*\.?\d+)(px|rem|em)\]$/.exec(value);
    if (arbitrary) {
      const n = parseFloat(arbitrary[1]);
      return arbitrary[2] === 'px' ? n : n * 16;
    }
    return null;
  }
  return null;
}

/** Every whitespace-separated token in an opening tag, variant prefixes stripped. */
function tagTokens(tag: string): { raw: string; base: string }[] {
  return tag
    .split(/[\s"'`{}()]+/)
    .filter(Boolean)
    .map((raw) => ({ raw, base: raw.replace(STRIP_VARIANTS, '') }));
}

/** Every element site in `src/` whose opening tag starts with one of `names`. */
function elementSites(names: RegExp): { where: string; rel: string; tag: string }[] {
  const out: { where: string; rel: string; tag: string }[] = [];
  for (const { rel, raw, scannable } of SOURCES) {
    const opener = new RegExp(`<(${names.source})(?=[\\s/>])`, 'g');
    let match: RegExpExecArray | null;
    while ((match = opener.exec(scannable)) !== null) {
      const tag = readOpeningTag(scannable, match.index);
      if (!tag) continue;
      out.push({ where: `${rel}:${lineOf(raw, match.index)}`, rel, tag });
    }
  }
  return out;
}

/**
 * The two D-13-pattern subjects, each rostered until PLAN 40 (wave 8) raises it.
 *
 * READ THIS BEFORE "FIXING" A RED. Neither subject meets its floor at HEAD — the SPEC's
 * W40 line records the measured starting state ("compact month tile ~16-20px and
 * home-card cog ~28px"). The assertions are armed HERE, at wave 5, so that plan 40's fix
 * is measured rather than asserted; the roster is what keeps the wave-5 commit green
 * WITHOUT lowering a floor. `assertExactCounts` runs in BOTH directions, so when plan 40
 * raises a subject its entry must be DELETED or this suite reds on a fossil permission.
 *
 * Lowering the 24px or 44px threshold, or deleting an arm because its subject was hard to
 * find, silently retires an accessibility floor this phase exists to raise. That is a
 * decision, not a cleanup.
 */
const D13_FLOOR_ROSTER: ExemptionRoster = {
  'app/components/CalendarMonthView.js': {
    sites: 1,
    why:
      'The COMPACT month event tile (`aria-label={tileLabel + rsvpLabel}`) is `text-xs p-0.5 ' +
      'rounded-sm` with no minimum dimension — roughly 16-20px tall by its own shipped TARGET ' +
      'SIZE marker in this file. Plan 40 (wave 8) declares the >= 24px floor (WCAG 2.2 2.5.8, ' +
      'D-13 pattern) and its fix must delete this entry.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R5 / W40 — AC-5' },
  },
  'app/components/grouplist.js': {
    sites: 1,
    why:
      'The home-card settings cog (`aria-label="Customize group"`) is `px-3 py-1 text-sm` around ' +
      'a single emoji glyph — ~28px tall by its own shipped TARGET SIZE marker, which records the ' +
      'owner ruling of 2026-08-27 deferring it and names Phase 88.6 as the owner. Plan 40 (wave 8) ' +
      'declares the >= 44px floor at the site (D-13 pattern); its fix must delete this entry.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R5 / W40 — AC-5' },
  },
};

describe('Phase 88.6 AC-2 / R5: the geometry floors, at source level', () => {
  // AC-11: consumes the ONE module-scope `SOURCES` pass above. No second tree walk.
  const buttonSites = elementSites(/Button/);

  it('finds `<Button` call sites to check (anti-vacuity companion for the desktop arm)', () => {
    // Measured 2026-09-15 with THIS scanner: 21 `<Button` element sites across 13 non-test
    // files. (A line-based `grep -rnoE '<Button[ >]'` reports 19 — it cannot see the two sites
    // whose first attribute is on the next line. The scanner's number is the honest one.)
    // The floor is
    // deliberately slack — plans 15-39 migrate ~100 more onto the primitive, and the shape
    // this guard has to catch is a scanner that stopped matching, not a count that moved.
    expect(
      buttonSites.length,
      'the `<Button` scan matched nothing — every desktop-arm assertion below would pass vacuously',
    ).toBeGreaterThan(3);
  });

  it('has no `<Button` call site that takes the 44px floor away at DESKTOP width', () => {
    /*
     * THE CASCADE FACT THIS ARM RESTS ON, stated because the obvious version of it is wrong.
     *
     * There are TWO offender shapes, not one:
     *
     *  (1) a floor-LOWERING `min-h-` UTILITY in the className — `min-h-0`, an arbitrary value
     *      below 44px, or a breakpoint-prefixed `md:min-h-*` that lowers it at desktop. Below
     *      48rem this shape is INERT: `.btn` is unlayered and its `@media (width < 48rem)`
     *      `min-height: 2.75rem` beats every `@layer utilities` rule regardless of specificity
     *      (`globals.css:2666-2674`, re-derived 2026-09-15). So it is a DESKTOP-ONLY hole —
     *      which is exactly why this arm exists and why it is not redundant with the phone one.
     *
     *  (2) an UNLAYERED `min-height`-zeroing CLASS in the same className. Today that is
     *      `.btn-compact { min-height: 0 }` (`globals.css:2727-2728`). This is the load-bearing
     *      half: an unlayered author rule beats EVERY `@layer utilities` rule regardless of
     *      specificity (the shipped cascade statement at `globals.css:2666-2674`), so
     *      `btn-compact` beats the cva base's `min-h-11` UTILITY at every width — phone
     *      included. A `min-h-0` utility cannot do that; a `btn-compact` class can.
     *
     * DO NOT rewrite the comment above into "the floor is unprefixed on the cva base, so the
     * only way to lose it at desktop is a call-site override." That sentence is false about
     * shape (2) and was struck from this plan before it was written.
     *
     * LATENT AT HEAD, on purpose. No live `<Button>` wears `btn-compact`, and the two
     * `BrowseMoreModal` steppers that do are raw `.btn` and are declared exempt (D-36). The
     * value of this arm is that the hole stays closed while plans 17-39 migrate ~100 files.
     */
    const offenders: string[] = [];
    for (const site of buttonSites) {
      for (const { raw, base } of tagTokens(site.tag)) {
        if (base === 'btn-compact') {
          offenders.push(
            `${site.where} — carries \`${raw}\`, an UNLAYERED min-height:0 class that beats the ` +
              '`Button` cva base\'s `min-h-11` utility at EVERY width (globals.css:2727-2728)',
          );
          continue;
        }
        const px = utilityPx(base, ['min-h']);
        if (px !== null && px < MIN_TARGET_44) {
          offenders.push(
            `${site.where} — carries \`${raw}\` (${px}px), which lowers the cva base's 44px floor ` +
              'at desktop widths where `.btn`\'s phone-only media rule does not apply',
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /*
   * HOW THE TWO SUBJECTS BELOW ARE IDENTIFIED, so a later reader can re-find them.
   *
   * Neither is located by a Tailwind class — a class anchor would move under this phase's own
   * sweeps. Both are located by their ACCESSIBLE NAME expression in source, which is the
   * stable handle:
   *
   *  - the compact month event tile: the unique element whose opening tag contains
   *    `aria-label={tileLabel + rsvpLabel}`. Measured 2026-09-15, `grep -rn "tileLabel +
   *    rsvpLabel" src` returns exactly ONE non-test hit (`CalendarMonthView.js:559`), and it
   *    distinguishes the COMPACT tile from the full-variant twin below it, whose label is the
   *    bare `tileLabel`.
   *  - the home-card cog: the unique element whose opening tag contains
   *    `aria-label="Customize group"`. Exactly one non-test hit (`grouplist.js:813`).
   *
   * THE COG SUBJECT WAS RE-DERIVED, NOT TAKEN FROM THE PLAN. `88.6-12-PLAN.md` named
   * `src/app/userHome/UserHomePage.js`; a `Cog|Gear|Settings` grep over that file returns no
   * such control, because the home card is rendered by `<GroupList>` (`UserHomePage.js:373`)
   * and the cog lives in `app/components/grouplist.js`. Recorded in `88.6-12-SUMMARY.md`.
   */
  const NAMED_SUBJECTS = {
    compactMonthTile: {
      anchor: 'aria-label={tileLabel + rsvpLabel}',
      expectedFile: 'app/components/CalendarMonthView.js',
      floor: MIN_TARGET_24,
      dimensions: ['min-h', 'h'] as string[],
      label: 'the COMPACT month event tile',
    },
    homeCardCog: {
      anchor: 'aria-label="Customize group"',
      expectedFile: 'app/components/grouplist.js',
      floor: MIN_TARGET_44,
      dimensions: ['min-h', 'h'] as string[],
      label: 'the home-card settings cog',
    },
  };

  /** Every element in `src/` whose opening tag carries `anchor`. One pass over SOURCES. */
  function sitesCarrying(anchor: string): { where: string; rel: string; tag: string }[] {
    const out: { where: string; rel: string; tag: string }[] = [];
    for (const { rel, raw, scannable } of SOURCES) {
      const opener = /<[A-Za-z][A-Za-z0-9.]*(?=[\s/>])/g;
      let match: RegExpExecArray | null;
      while ((match = opener.exec(scannable)) !== null) {
        const tag = readOpeningTag(scannable, match.index);
        if (!tag || !tag.includes(anchor)) continue;
        out.push({ where: `${rel}:${lineOf(raw, match.index)}`, rel, tag });
      }
    }
    return out;
  }

  const compactTileSites = sitesCarrying(NAMED_SUBJECTS.compactMonthTile.anchor);
  const cogSites = sitesCarrying(NAMED_SUBJECTS.homeCardCog.anchor);

  it('finds the compact month event tile and the home-card cog (anti-vacuity companions)', () => {
    expect(
      compactTileSites.map((s) => s.where),
      `${NAMED_SUBJECTS.compactMonthTile.label} was not located by its accessible-name anchor ` +
        `\`${NAMED_SUBJECTS.compactMonthTile.anchor}\`. Re-find it before touching the floor below — ` +
        'a geometry assertion that matches nothing is the failure shape this repo\'s gate ledger ' +
        'records repeatedly.',
    ).toHaveLength(1);
    expect(
      cogSites.map((s) => s.where),
      `${NAMED_SUBJECTS.homeCardCog.label} was not located by its accessible-name anchor ` +
        `\`${NAMED_SUBJECTS.homeCardCog.anchor}\`. Re-find it before touching the floor below.`,
    ).toHaveLength(1);
    expect(compactTileSites[0].rel).toBe(NAMED_SUBJECTS.compactMonthTile.expectedFile);
    expect(cogSites[0].rel).toBe(NAMED_SUBJECTS.homeCardCog.expectedFile);
  });

  /** Does this tag declare an explicit vertical dimension at or above `floor`? */
  function meetsFloor(tag: string, floor: number, dimensions: string[]): boolean {
    return tagTokens(tag).some(({ base }) => {
      const px = utilityPx(base, dimensions);
      return px !== null && px >= floor;
    });
  }

  it('gates the compact month event tile at >= 24px and the home-card cog at >= 44px (D-13 pattern)', () => {
    /*
     * WHY 24 AND NOT 44 FOR THE TILE. WCAG 2.2 success criterion 2.5.8 (Target Size, Minimum)
     * sets 24x24 CSS px; 2.5.5's 44x44 is AAA. The month grid's DAY CELL (min-h-[80px]) is the
     * large touch surface, and the tile is a secondary target inside it — so 24 is the correct
     * floor for this element and 44 would be the wrong one. The floor is DECLARED at the site
     * under the D-13 pattern, not inherited: the tile is a `role="button"` div, not a `.btn`, so
     * neither `.btn`'s phone media rule nor the `Button` cva base reaches it.
     *
     * NOTHING HERE TOUCHES THE DAY CELL'S KEYBOARD STATUS. That is SPEC R5 / AC-5 and belongs to
     * plan 40; the 88.3 ruling deferring it is recorded in `CalendarMonthView.js` and is not
     * restated or re-derived here.
     *
     * THE COG takes 44 because it is a standalone card-header action with no larger enclosing
     * target — the same D-13 per-site `min-h-11` pattern the eight 87.8 floor markers record.
     * It is not a `.btn`, so D-36's phone floor does not reach it either.
     */
    const measured: Record<string, number> = {};
    const unmet: string[] = [];

    for (const subject of [NAMED_SUBJECTS.compactMonthTile, NAMED_SUBJECTS.homeCardCog]) {
      const sites = subject === NAMED_SUBJECTS.compactMonthTile ? compactTileSites : cogSites;
      for (const site of sites) {
        if (meetsFloor(site.tag, subject.floor, subject.dimensions)) continue;
        measured[site.rel] = (measured[site.rel] ?? 0) + 1;
        unmet.push(
          `${site.where} — ${subject.label} declares no explicit dimension at or above ` +
            `${subject.floor}px (D-13 pattern, WCAG 2.2 2.5.8)`,
        );
      }
    }

    // The roster is the ONLY thing allowed to absorb an unmet floor, and it is counted in both
    // directions. A new unmet subject in an unrostered file reds; a rostered file whose subject
    // was raised also reds, which is what forces plan 40 to delete its entry.
    expect(assertRosterShape(D13_FLOOR_ROSTER)).toEqual([]);
    expect(
      assertExactCounts(D13_FLOOR_ROSTER, measured),
      `unmet floors, for context: ${unmet.join(' | ') || '(none)'}`,
    ).toEqual([]);
  });
});
