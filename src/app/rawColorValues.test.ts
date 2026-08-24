/**
 * Req 2 (DES-01) repo-wide guard: colour values live in `globals.css`'s `@theme` block and
 * reach components as tokens. A raw hex literal or a hand-rolled black `boxShadow` in a
 * component is a colour that cannot follow the theme, and Phase 88 spent three plans
 * (88-22, 88-26, 88-27) removing them.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT THE GREP THE PLAN SPECIFIED
 * ------------------------------------------------------------
 * `88-29-PLAN.md` Task 1 asks for two `ci.yml` grep gates: raw hex with a four-file
 * exemption list, and inline `boxShadow` containing `rgba(0,0,0`. Both were run against
 * this tree before being trusted (the discipline DEF-88-21-01 established), and both fail
 * the phase's gate-authoring standard. MEASURED, not reasoned:
 *
 *  1. THE PLAN'S EXEMPTION LIST IS INCOMPLETE — it names `globals.css`, `DieLogo.js`,
 *     `global-error.tsx` and `colorUtils.js`. The widened 3-or-6-digit pattern (DEF-88-22-2)
 *     over `src` returns hex in NINE more files. Three of them are real, permanent
 *     exemptions the plan text does not mention at all (`GroupSettings.js`'s eight stored
 *     presets; the Google brand mark in `userProfile/page.js` AND `LandingPage.js`). A gate
 *     armed on the plan's list is red on a correct tree — DEF-88-27-01's shape.
 *  2. THE OTHER SIX ARE COMMENTS — `availabilityColor.ts`, `Switch.tsx`, `Banner.tsx`,
 *     `gameDetail/page.js`, `FriendInvitePanel.js`, `ClickableMemberName.js` each carry a
 *     DECISION marker that QUOTES a hex value in order to record a decision about it. Four
 *     of the six are block-comment CONTINUATION lines that do not begin with `*` or `//`,
 *     so ci.yml's anchored comment filter does not drop them. Comment blindness is the
 *     defect recorded in DEF-88-25-02 (twice), DEF-88-27-01 and DEF-88-28-01.
 *  3. THE `rgba(0,0,0` GREP IS RED ON A CORRECT TREE AND ON THE WRONG POPULATION.
 *     `grep -rnE 'rgba\(0, *0, *0'` over `src` returns 19 lines today. ZERO are a
 *     `boxShadow`. Eighteen are `textShadow` / `WebkitTextStroke` / `borderColor` on the
 *     calendar tiles, which 88-22 deliberately preserved, plus `colorUtils.js`'s shadow
 *     constants. The nineteenth is `groupHomePage/page.js:453` — a DECISION comment whose
 *     text is literally *"would still pass 88-29's zero-`rgba(0,0,0` gate while looking
 *     wrong"*. A grep for that token is red on the comment warning about it.
 *
 * That is a gate whose population is not the plan's population — DEF-88-28-01's fourth
 * predictor — layered on comment blindness. The scan below reads code with comments blanked
 * and matches `boxShadow` PROPERTIES rather than the substring, so it can tell an inline
 * black drop shadow from an intentionally-preserved text shadow.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * It scans `.js/.jsx/.ts/.tsx` under `src/`. `globals.css` is deliberately out of scope: it
 * is the token SOURCE and hex is where it belongs (test 6 pins that it still holds them, so
 * a future "cleanup" of the theme block cannot pass unnoticed).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const GLOBALS = path.join(__dirname, 'globals.css');

const rel = (file: string): string => path.relative(SRC, file);

/**
 * Files permitted to carry a raw hex value, each with the reason it is permitted.
 *
 * A bare allowlist loses the reasoning, which is exactly what D-27 forbids, so the reason
 * is DATA here rather than a comment — test 3 asserts every entry still has one, and test 4
 * asserts every entry is still EARNED (an exempt file with no hex left must be removed from
 * this list, or the exemption silently covers a file that could regain one for free).
 */
const HEX_EXEMPT: Record<string, string> = {
  'lib/colorUtils.js':
    'D-27: contrast COMPUTATION, not styling. These values are inputs to a WCAG contrast ' +
    'algorithm that picks a text colour against an arbitrary user-chosen group background. ' +
    'A token cannot be read back as a number at runtime, so tokenising them removes the ' +
    'computation rather than theming it.',
  'app/components/DieLogo.js':
    'Logo art. The die mark is a fixed illustration with its own palette; it does not ' +
    'follow the theme in either direction, by design.',
  'app/global-error.tsx':
    'Renders OUTSIDE the app shell. Next.js global-error replaces the root layout, so no ' +
    'stylesheet, no theme variables and no Tailwind are loaded — inline hex is the only ' +
    'thing that can paint it. Marker at the site (88-09 D-20 / DEF-88-22-2).',
  'app/components/GroupSettings.js':
    'The eight group background-colour PRESETS are DATA, not styling: each value is ' +
    'persisted to `Groups.background_color` and rendered by whoever reads that column. ' +
    'A theme token would change what is written to the database.',
  'app/userProfile/page.js':
    'Google BRAND ART — the four fills of the Google "G" mark. 88-22 registered this ' +
    'exemption and 88-19 tagged each fill `TODO(88-29)` so it could not be confused with a ' +
    'miss; the marker at the site states the correct 88-29 outcome is "exempt, brand art". ' +
    "Tokenising them would repaint Google's mark per theme, which their brand terms forbid.",
  'app/components/LandingPage.js':
    'The identical Google "G" brand mark as `userProfile/page.js`, and the site the ' +
    "userProfile marker points at for the fuller rationale. Same exemption, same reason.",
};

/**
 * A CSS hex colour: `#rgb`, `#rgba`, `#rrggbb` or `#rrggbbaa`.
 *
 * The length whitelist is what makes 8-digit hex visible. DEF-88-22-2 widened the plan's
 * original `#[0-9a-fA-F]{6}` to catch 3-digit (which added `global-error.tsx` to the
 * census); a `{3}(...{3})?\b` pattern still MISSES `#rrggbbaa`, because the seventh hex
 * digit is a word character so the `\b` never lands. Matching a run and then checking its
 * length has no such hole.
 */
export function rawHexIn(src: string): { line: number; value: string }[] {
  const code = withoutComments(src);
  const hits: { line: number; value: string }[] = [];
  for (const m of code.matchAll(/#([0-9a-fA-F]+)\b/g)) {
    // An HTML numeric character reference is a `#` followed by digits and is NOT a colour.
    // `GameSuggestionCard.js:58` renders the black star as `&#9733;`, which reads as a
    // valid 4-digit `#rgba` to any pattern that only looks at what FOLLOWS the `#`. This
    // is DEF-88-27-01's first predictor — "a token that must be told from a lookalike" —
    // and it was caught by running the detector before trusting it, not by reasoning
    // about it. (The hex form `&#x2605;` needs no guard: `x` is not a hex digit, so the
    // pattern never matches there at all.)
    if (code[m.index - 1] === '&') continue;
    const digits = m[1];
    if (![3, 4, 6, 8].includes(digits.length)) continue;
    hits.push({ line: lineAt(code, m.index), value: `#${digits}` });
  }
  return hits;
}

/** `rgba(0,0,0,…)`, `rgb(0 0 0…)`, `#000`, `#000000` — the BLACK component only. */
const BLACK = /rgba?\(\s*0\s*[, ]\s*0\s*[, ]\s*0\s*[,)/ ]|#000000\b|#000\b|\bblack\b/;

/**
 * Every inline `boxShadow` property whose VALUE names black, with the whole value
 * expression — including a multi-line ternary — resolved first.
 *
 * Reading the property rather than grepping the token is the difference between this and
 * the plan's gate. `88-22` deliberately preserved `textShadow` and `WebkitTextStroke` in
 * pure black on the calendar tiles (they sit over an arbitrary user-chosen group image,
 * where a themed shadow would stop doing its job), and it split two `boxShadow`s into a
 * `shadow-theme-lg` token plus a surviving `ring-2 ring-white/15`. A substring grep cannot
 * tell those three apart; this can.
 */
export function blackBoxShadows(src: string): { line: number; value: string }[] {
  const code = withoutComments(src);
  const hits: { line: number; value: string }[] = [];
  for (const m of code.matchAll(/\bboxShadow\s*:/g)) {
    // Walk to the end of the value expression: the first `,` or `}` at nesting depth 0.
    let i = m.index + m[0].length;
    let depth = 0;
    const start = i;
    while (i < code.length) {
      const c = code[i];
      if (c === '(' || c === '[' || c === '{') depth += 1;
      else if (c === ')' || c === ']') depth -= 1;
      else if (c === '}') {
        if (depth === 0) break;
        depth -= 1;
      } else if (c === ',' && depth === 0) break;
      else if (c === '"' || c === "'" || c === '`') {
        const q = c;
        i += 1;
        while (i < code.length && code[i] !== q) {
          if (code[i] === '\\') i += 1;
          i += 1;
        }
      }
      i += 1;
    }
    const value = code.slice(start, i);
    if (BLACK.test(value)) {
      hits.push({ line: lineAt(code, m.index), value: value.trim().replace(/\s+/g, ' ') });
    }
  }
  return hits;
}

describe('Req 2 raw colour values — hex literals and inline black shadows', () => {
  const files = sourceFiles(SRC);

  it('0. the sweep is scanning a representative app, not an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
    // ...and the hex detector is not dead: it still finds the values in an EXEMPT file.
    // Without this, "zero offenders" and "the regex went blind" look identical — the
    // vacuity mode DEF-88-10-01's closure had to be checked for explicitly.
    expect(rawHexIn(fs.readFileSync(path.join(SRC, 'lib/colorUtils.js'), 'utf8')).length)
      .toBeGreaterThan(5);
  });

  it('1. no source file outside the exemption list carries a raw hex colour', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const key = rel(file);
      if (key in HEX_EXEMPT) continue;
      for (const hit of rawHexIn(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${key}:${hit.line} ${hit.value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. no component paints an inline `boxShadow` in black (use the shadow-theme-* tokens)', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of blackBoxShadows(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel(file)}:${hit.line} ${hit.value}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('3. every hex exemption carries a stated reason (D-27: a bare allowlist loses the why)', () => {
    for (const [file, reason] of Object.entries(HEX_EXEMPT)) {
      expect(reason.length, `${file} has no stated reason`).toBeGreaterThan(60);
    }
  });

  it('4. no hex exemption is STALE — an exempt file must still exist and still carry hex', () => {
    // Without this the list only ever grows. A file that gets tokenised keeps a standing
    // permission to regain a raw hex for free, and the next reader cannot tell a live
    // exemption from a fossil.
    const stale: string[] = [];
    for (const file of Object.keys(HEX_EXEMPT)) {
      const full = path.join(SRC, file);
      if (!fs.existsSync(full)) {
        stale.push(`${file} — exempt but MISSING (renamed or deleted; update this list)`);
        continue;
      }
      if (rawHexIn(fs.readFileSync(full, 'utf8')).length === 0) {
        stale.push(`${file} — exempt but carries no hex any more; delete the exemption`);
      }
    }
    expect(stale).toEqual([]);
  });

  it('5. the detectors make the discriminations the plan\'s greps could not', () => {
    // 3-digit hex — invisible to the plan's original `{6}` pattern (DEF-88-22-2).
    expect(rawHexIn("const c = '#555';").map((h) => h.value)).toEqual(['#555']);
    // 8-digit hex — invisible to DEF-88-22-2's own widened `{3}([0-9a-fA-F]{3})?\b`.
    expect(rawHexIn("const c = '#1e1e2eff';").map((h) => h.value)).toEqual(['#1e1e2eff']);
    // A DECISION marker quoting a hex value must NOT trip the gate. Both comment shapes,
    // including the block-comment CONTINUATION line that ci.yml's anchored filter misses.
    expect(rawHexIn('// the old value was #1f2937\nconst c = tokens.title;')).toEqual([]);
    expect(
      rawHexIn('/* MEASURED and rejected: it is\n   `#ffffff` in light mode, byte-identical\n*/\nconst c = t;'),
    ).toEqual([]);
    // Not a colour: a CSS id selector fragment length, an anchor, a run of the wrong length.
    expect(rawHexIn("const h = '#12345';")).toEqual([]);
    expect(rawHexIn("const h = '#section';")).toEqual([]);
    // An HTML numeric entity — the live lookalike this detector found on first run
    // (`GameSuggestionCard.js`'s black star). `&#9733;` is a valid 4-digit `#rgba` to
    // anything that only reads forward from the `#`.
    expect(rawHexIn("const star = '&#9733;';")).toEqual([]);
    expect(rawHexIn("const star = '&#x2605;';")).toEqual([]);

    // A black inline shadow is caught even when the value is a MULTI-LINE ternary — the
    // exact shape DEF-88-21-01 proved a line-based grep matches zero of.
    expect(
      blackBoxShadows(
        'const s = {\n  boxShadow: isDark\n    ? "0 2px 4px rgba(0, 0, 0, 0.8)"\n    : "none",\n};',
      ),
    ).toHaveLength(1);
    expect(blackBoxShadows("const s = { boxShadow: '0 2px 4px rgba(0,0,0,.5)' };")).toHaveLength(1);
    // ...and a legitimate WHITE ring half is NOT flagged. 88-22 preserved exactly this at
    // two groupHomePage sites; a `rgba(0,0,0`-substring gate that also ate the ring would
    // have been "fixed" by deleting the ring, which the marker there warns against.
    expect(
      blackBoxShadows("const s = { boxShadow: '0 0 0 2px rgba(255, 255, 255, 0.15)' };"),
    ).toEqual([]);
    // ...and `textShadow` / `WebkitTextStroke`, which 88-22 KEPT black on purpose, are not
    // this gate's population. The plan's grep could not tell them from a boxShadow.
    expect(blackBoxShadows("const s = { textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)' };")).toEqual([]);
    expect(blackBoxShadows("const s = { WebkitTextStroke: '0.5px rgba(0, 0, 0, 0.9)' };")).toEqual([]);
  });

  it('6. `globals.css` still holds the hex the components are forbidden — the theme is the source', () => {
    // The mirror image of test 1, and the reason test 1 is safe to be strict. If a future
    // "cleanup" emptied the theme block, test 1 would still pass (zero hex everywhere is
    // zero offenders) while the app lost its palette.
    const css = fs.readFileSync(GLOBALS, 'utf8');
    expect(css).toContain('@theme');
    const hexInTheme = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hexInTheme.length).toBeGreaterThan(50);
  });
});
