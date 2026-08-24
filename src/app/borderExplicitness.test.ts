/**
 * Req 16 (DES-02 / D-35) repo-wide guard: no border in the app depends on the
 * base-layer shim for its colour.
 *
 * WHAT THE SHIM IS AND WHY THIS IS A VISIBLE DEFECT, NOT A TIDY-UP
 * ---------------------------------------------------------------
 * `globals.css` carries a v3-compatibility rule in `@layer base` that paints
 * `border-color: var(--color-gray-200)` on every element. Tailwind v4's preflight
 * dropped v3's default border colour, and that rule puts it back. It is NOT
 * theme-aware: it paints `#e5e7eb`, which measures 11.19:1 against the dark page
 * where the neutral token would be 1.78:1. Every element that names a border WIDTH
 * without a border COLOUR is therefore drawing a near-white hairline in dark mode.
 *
 * ORDER IS LOAD-BEARING, AND THIS FILE IS THE PRECONDITION
 * -------------------------------------------------------
 * Plan 88-31 deletes that base rule. It may only do so once every site names its own
 * colour — the reverse order re-runs the exact v4 default-change regression the rule
 * exists to repair, across the whole app at once. This test is what makes the
 * deletion safe to perform and safe to keep: after 88-31 the shim is gone, so a new
 * uncoloured border stops being "a wrong shade" and becomes `currentColor`, i.e. a
 * border painted in the element's TEXT colour. Nothing else in the suite would catch
 * that, because it renders — it just renders wrong.
 *
 * THE SHIM IS NOW ACTUALLY GONE (88-31), AND THE TRIGGER WAS WIDENED TO MATCH
 * --------------------------------------------------------------------------
 * DECISION Phase 88-31 (DEF-88-27-02): this scan fires on a bare border token OR an
 * uncoloured border WIDTH utility — chosen OVER keeping the original `bare`-only trigger.
 * 88-26 wrote the trigger as `kinds.includes('bare')`, so `border-2` / `border-t-4` /
 * `border-b-[3px]` were structurally invisible to it even though they depend on the shim
 * IDENTICALLY. That was a tolerable gap while the shim existed (an uncoloured width
 * utility merely painted the wrong shade). It stops being tolerable the moment the shim
 * is deleted in this same plan, because from then on the same class list paints
 * `currentColor`. Measured before widening: 10 chunks in the tree carry a width utility
 * with no colour — 2 are `border-0` (now classified `zero`, see below) and the other 8
 * are paired on every runtime branch, each verified by READING the site, and each
 * enumerated in `PAIRED_ELSEWHERE` with the mechanism that supplies the colour. So the
 * widening finds no live defect; it closes the detector so a NEW one cannot land.
 *
 * `border-0` is classified `zero`, not `width`, and does not trigger. A zero-width border
 * paints nothing, so it has no colour dependency in either direction. Folding it into
 * `width` would have forced two allow-list entries for sites that are not exposed —
 * exemptions that would then sit there widening the hole for a future real defect in the
 * same file, which is the staleness test 2 exists to prevent. Test 5a pins the split.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST
 * ----------------------------------------------
 * Same reasoning as `cardPaddingIdiom.test.ts` and `components/controlSizeFloor.test.tsx`:
 * the property is "every bordered element in the app", spread across 20 files behind
 * modals, role gates, error branches and fetch states that no single render reaches.
 * A per-surface pin also goes green forever the moment surface N+1 is added.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP — MEASURED, NOT ASSERTED
 * -----------------------------------------------------------
 * 88-26's own verify gate is
 *     grep -rnE 'className=[^>]*(^|[ "])border( |")' src …
 * and it is defective in both directions. Run against the pre-work tree it matched
 * **157 lines, 110 of which already carried an explicit border colour** — it needs
 * only a quote or space on each side of `border`, which `className="border
 * border-line"` satisfies. It is therefore RED on the fully converged tree as well as
 * the broken one, which distinguishes nothing (the DEF-88-24-04 shape). It also
 * MISSED 5 of the 43 real sites: it has no `border-[tblrxy]` alternation, so
 * `border-b` was invisible; it anchors on `className=` on the same line, so a ternary
 * branch inside a template literal was invisible; and it never sees a class string
 * that is not written beside a `className=` at all, so `Banner.tsx`'s `cva` base was
 * invisible. That is the tenth defective grep gate recorded in this phase.
 *
 * The scanner below strips comments (88-25's gate went red on a DECISION marker it
 * had just written), reads string literals at ANY nesting depth including inside
 * `${…}` interpolations, and tokenises the class list so `rounded-border-ish` names
 * can never match. Tests 3-5 pin those three capabilities directly, so none of them
 * can silently regress into the grep's blindness.
 *
 * THE PROPERTY IS INVERTED ON PURPOSE (an ALLOW-LIST, per DEF-88-25-02)
 * --------------------------------------------------------------------
 * A bare `border` beside a ternary whose every branch names a colour is CORRECT, and
 * no scanner can tell that from reading one chunk. Rather than sink-match and hope,
 * every such site is enumerated below with the reason it is paired, and anything not
 * on the list fails by default. Test 2 asserts the list is not stale.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/** Tailwind border utilities that set something OTHER than a colour. */
const BORDER_STYLE_KEYWORDS = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'none',
  'collapse',
  'separate',
]);

type BorderKind = 'bare' | 'width' | 'zero' | 'style' | 'color' | null;

/**
 * Classify one class token.
 *
 * `bare`  — `border`, `border-b`: sets the 1px default width and names no colour.
 * `width` — `border-2`, `border-l-4`, `border-b-[3px]`: a NON-ZERO explicit width, no colour.
 * `zero`  — `border-0`, `border-x-0`: paints nothing, so it has no colour dependency.
 *
 * `bare` and `width` are the two shapes that used to fall through to the shim and now fall
 * through to `currentColor`. `zero` is deliberately neither (DEF-88-27-02).
 */
export function classifyBorderToken(token: string): BorderKind {
  let t = token;
  // Strip variant prefixes (`hover:`, `md:`, `data-[state=open]:`, `group-hover:`).
  for (;;) {
    const m = /^(?:[a-zA-Z0-9_-]+|\[[^\]]*\]|[a-zA-Z0-9_-]+-\[[^\]]*\]):(.*)$/.exec(t);
    if (!m) break;
    t = m[1];
  }
  t = t.replace(/^!+/, '');
  const m = /^border(?:-(t|b|l|r|x|y|s|e))?(?:-(.+))?$/.exec(t);
  if (!m) return null;
  const suffix = m[2];
  if (suffix === undefined) return 'bare';
  if (/^\d+$/.test(suffix) || /^\[[\d.]+(px|rem|em|%)\]$/.test(suffix)) {
    return /^(?:0+|\[0*(?:\.0+)?(?:px|rem|em|%)\])$/.test(suffix) ? 'zero' : 'width';
  }
  if (BORDER_STYLE_KEYWORDS.has(suffix)) return 'style';
  if (suffix.startsWith('spacing')) return null;
  return 'color';
}

// DECISION Phase 88-29 (gate hygiene): `stringChunks` moved to
// `src/test-utils/sourceScan.ts` and IMPORTED here, chosen OVER keeping a per-suite copy.
// `tintTreatment.test.ts` itself nominated this extraction for 88-29; by then there were
// THREE byte-identical copies (verified by brace-balanced pairwise diff before the move)
// and this plan needed two more. Five copies of a scanner is four places a correctness fix
// can be forgotten — the exact drift shape the Phase 88 gate ledger records fourteen times.
// The lexer could not be imported from a sibling TEST file: a test module's body registers
// its own `describe` blocks, so that import would run another suite in this file's context.
// Re-inlining a private copy here is a decision, not a cleanup.

/** Chunks that set a NON-ZERO border width and name no colour. */
export function shimDependentChunks(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    const kinds = text.split(/\s+/).filter(Boolean).map(classifyBorderToken);
    // DEF-88-27-02: `width` joins `bare` here. A `border-2` with no colour depended on the
    // deleted shim exactly as a bare `border` did, and now resolves to `currentColor`.
    if (!kinds.includes('bare') && !kinds.includes('width')) continue;
    if (kinds.includes('color')) continue;
    hits.push({ line: src.slice(0, offset).split('\n').length, text: text.trim() });
  }
  return hits;
}

/**
 * Every rule in a stylesheet that sets a border COLOUR on a UNIVERSAL selector — i.e. the
 * shim shape, in any spelling.
 *
 * Written as a property rather than a string match, deliberately. 88-31's plan gate was
 * `! grep "border-color: var(--color-gray-200" globals.css`, which fails twice over: it goes
 * RED on a correct tree the moment a DECISION marker describes what it deleted (the
 * comment-blindness recorded in DEF-88-25-02 / DEF-88-27-01 / DEF-88-28-01, and it did —
 * measured, which is why the marker in `globals.css` describes the declaration instead of
 * quoting it), and it matches exactly ONE spelling, so `border-color:#e5e7eb` or a
 * `border: 1px solid var(--anything)` restoration would sail straight past it.
 *
 * Comments are stripped first; the selector list is split so `*, ::after, ::before` counts
 * on any of its parts; and a SCOPED rule (`.card { border-color: … }`) is never a hit.
 *
 * "Universal" means a part built ONLY from `*` and combinators, or one of preflight's four
 * pseudo-elements. That precision is load-bearing and was forced by a false positive on the
 * first run: `.rbc-time-content > * + * > *` (a react-big-calendar override that legitimately
 * sets `border-left-color`) ends in `*`, so an "any `*` anywhere" predicate flagged it. A
 * guard that reds on a correct tree is the defect this phase recorded fifteen times, so it
 * was tightened rather than allow-listed.
 */
export function universalBorderColourRules(css: string): string[] {
  const bare = css.replace(/\/\*[\s\S]*?\*\//g, ' ');
  const hits: string[] = [];
  for (const m of bare.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const selector = m[1].trim();
    const body = m[2];
    const isUniversal = selector
      .split(',')
      .map((s) => s.trim())
      .some(
        (s) =>
          (s.includes('*') && /^[*\s>+~]+$/.test(s)) ||
          /^::?(after|before|backdrop|file-selector-button)$/.test(s)
      );
    if (!isUniversal) continue;
    const setsBorderColour =
      /\bborder(-(top|right|bottom|left|block|inline|[tblrxy]))?-color\s*:/.test(body) ||
      /\bborder(-(top|right|bottom|left))?\s*:[^;]*(#|var\(|rgb|hsl|oklch|currentcolor)/i.test(body);
    if (setsBorderColour) hits.push(`${selector} { ${body.trim().slice(0, 80)} }`);
  }
  return hits;
}

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
 * The ONLY sites allowed to carry a bare border-width token with no colour beside it,
 * each because something outside the chunk supplies the colour on EVERY runtime path.
 * Verified by reading, one at a time — not by a pattern.
 *
 * Adding an entry here is a design decision that needs the same reading. Do not add
 * one to make this test green.
 */
const PAIRED_ELSEWHERE: Record<string, string> = {
  // ── bare-token sites (88-26) ──────────────────────────────────────────────
  'app/components/AvailabilityGrid.js':
    'paint-mode ternary: both branches name a colour (green-400 / yellow-400)',
  'app/components/FriendInvitePanel.js':
    'friend-row ternary: all three branches name a colour (line / accent / line)',
  'app/components/GroupGamesList.js':
    'filter-toggle ternary: both branches name a colour (line-accent / line)',
  // REMOVED BY 88-31: the legacy intensity read-grid was exempt here ("dead file besides").
  // Its file, its colour ramp and its cell variant were all deleted by the same plan's
  // dead-code gate, so the exemption had to go with them or test 2 (allow-list staleness)
  // would red on a file that no longer exists. That coupling is deliberate and is exactly
  // what test 2 is for — a deletion cannot leave a widening exemption behind.
  'app/components/ManageMembers.js':
    'role pill: all four roleStyles entries name a colour, and the `||` guarantees a fallback',
  'app/friends/page.js':
    'armed-remove ternary: both branches name a colour (status-error / transparent)',
  'app/gameDetail/page.js':
    'two-tap remove ternary: both branches name a colour (status-error / line)',
  'app/userProfile/page.js':
    'theme buttons and the day-of-week toggles: every branch names a colour (amber-500 / line, btn-primary / line)',

  // ── uncoloured WIDTH-utility sites, added by 88-31 with the DEF-88-27-02 widening ──
  // All eight were read one at a time before being listed. Two shapes: a ternary written
  // beside the utility, and a colour arriving from a lookup or helper the chunk cannot see.
  'app/components/AvailabilityForm.js':
    'unavailable-checkbox `border-2`: both ternary branches name a colour ' +
    '(border-status-error / border-line-strong), and the button it sits in is paired too',
  'app/components/BallotSection.js':
    'vote-option `border-2`: both ternary branches name a colour (border-accent / border-line)',
  'app/components/BringGamePicker.js':
    'bring-checkbox `border-2`: both ternary branches name a colour (border-accent / border-line)',
  'app/components/GroupSettings.js':
    'default-picture and default-colour pickers, two `border-2` grids: each ternary names a ' +
    'colour on both branches (border-accent / border-line)',
  'app/components/RsvpSection.js':
    'active status button `border-2`: the colour comes from `statusConfig[status].activeBorder`, ' +
    'and all three entries (yes/maybe/no) name one. `status` is bounded by the literal ' +
    "['yes','maybe','no'] the buttons map over, so there is no fourth key to miss.",
  'app/components/SuggestionCard.js':
    'score card `border-2`: the colour comes from `getScoreColor()`, whose three returns each ' +
    'name a border colour (line / status-success / status-warning) and which has no fallthrough',
  'app/rsvp/[token]/page.js':
    'success card `border-t-4`: the colour comes from `STATUS_CONFIG[...] || STATUS_CONFIG.yes`, ' +
    'all three entries name one and the `||` guarantees a member',
};

describe('D-35 border explicitness (Req 16)', () => {
  const files = sourceFiles(SRC);

  it('finds a representative sample of the app, so the sweep is not scanning an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('1. no source file leaves a border colour to the base-layer shim', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (rel in PAIRED_ELSEWHERE) continue;
      for (const hit of shimDependentChunks(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}:${hit.line}  ${hit.text.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. the allow-list is not stale — every exempt file still HAS a bare border', () => {
    // Without this, a file could be fixed (or deleted) and its exemption would sit
    // here forever, silently widening the hole for the next edit to that file.
    for (const rel of Object.keys(PAIRED_ELSEWHERE)) {
      const full = path.join(SRC, rel);
      expect(fs.existsSync(full), `${rel} is exempt but does not exist`).toBe(true);
      expect(
        shimDependentChunks(fs.readFileSync(full, 'utf8')).length,
        `${rel} no longer has a bare border — remove its exemption`
      ).toBeGreaterThan(0);
    }
  });

  it('3. the scanner reads ternary branches INSIDE template interpolations', () => {
    // The grep gate's blind spot, and where 3 of this sweep's sites lived.
    const fixture =
      'const a = <div className={`mt-3 p-3 ${ok ? "text-status-success border" : "x"}`} />;';
    expect(shimDependentChunks(fixture).map((h) => h.text)).toContain(
      'text-status-success border'
    );
  });

  it('4. the scanner ignores comments', () => {
    // 88-25's gate went red on a DECISION marker it had just written (DEF-88-25-02).
    // Two prior-phase markers in this repo still quote the token deliberately.
    const fixture = [
      '// the container carried a bare `border` utility with no colour',
      '/* D-35: `border` is explicit here, not left to the shim. */',
      'const a = <div className="border border-line" />;',
    ].join('\n');
    expect(shimDependentChunks(fixture)).toEqual([]);
  });

  it('5. the scanner distinguishes widths, styles and colours from bare tokens', () => {
    expect(classifyBorderToken('border')).toBe('bare');
    expect(classifyBorderToken('border-b')).toBe('bare');
    expect(classifyBorderToken('hover:border-t')).toBe('bare');
    expect(classifyBorderToken('border-2')).toBe('width');
    expect(classifyBorderToken('border-l-4')).toBe('width');
    expect(classifyBorderToken('border-b-[3px]')).toBe('width');
    expect(classifyBorderToken('border-solid')).toBe('style');
    expect(classifyBorderToken('border-line')).toBe('color');
    expect(classifyBorderToken('border-l-status-success')).toBe('color');
    expect(classifyBorderToken('md:border-input')).toBe('color');
    // Not a border utility at all — the `\bcard\b` class of false positive.
    expect(classifyBorderToken('rounded-card')).toBe(null);
    expect(classifyBorderToken('bg-surface-card')).toBe(null);
  });

  it('6. directional borders are in scope (`border-b` with no colour is a violation)', () => {
    // The plan gate has no [tblrxy] alternation, so it missed three real sites.
    const fixture = 'const a = <div className="px-4 py-3 border-b" />;';
    expect(shimDependentChunks(fixture)).toHaveLength(1);
  });

  it('8. an uncoloured border WIDTH utility is a violation (DEF-88-27-02)', () => {
    // The gap this widening closes. Before 88-31 these three were invisible to the scan
    // while depending on the shim identically; after the shim deletion they paint
    // `currentColor`, so they render and therefore hide.
    expect(shimDependentChunks('const a = <div className="rounded-card border-2 p-4" />;')).toHaveLength(1);
    expect(shimDependentChunks('const a = <div className="border-t-4 shadow" />;')).toHaveLength(1);
    expect(shimDependentChunks('const a = <div className="border-b-[3px]" />;')).toHaveLength(1);
    // ...and naming a colour beside it still clears, so this is not a blanket ban on widths.
    expect(shimDependentChunks('const a = <div className="border-2 border-line" />;')).toEqual([]);
  });

  it('9. `border-0` is NOT a violation — a zero width paints nothing', () => {
    // Anti-over-reach guard for test 8. Two shipped sites (`StarRatingPicker.js`'s two
    // half-star hit areas) are `border-0`; folding them into `width` would have bought two
    // allow-list entries for files with no exposure, and an exemption is a standing hole.
    expect(classifyBorderToken('border-0')).toBe('zero');
    expect(classifyBorderToken('border-x-0')).toBe('zero');
    expect(shimDependentChunks('const a = <button className="bg-transparent border-0 p-0" />;')).toEqual([]);
  });

  it('10. the shim itself is GONE from globals.css and cannot come back', () => {
    // Every other assertion in this file guards the CALL SITES. This one guards the
    // STYLESHEET, and without it the widening above is defeatable in one line: re-adding a
    // global border-colour default makes every uncoloured border render plausibly again, so
    // nothing scanning `src/app/**` would notice.
    const css = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    expect(universalBorderColourRules(css)).toEqual([]);
  });

  it('11. test 10 is not vacuous — the same predicate FINDS a restored shim', () => {
    // Without this, a typo in the selector predicate would make test 10 pass forever over a
    // restored shim. The SAME function is used, so the two cannot drift apart.
    const restored = [
      '/* a marker describing the rule must NOT count — DEF-88-25-02 */',
      '/* border-color: var(--color-gray-200, currentcolor); */',
      '@layer base {',
      '  *,',
      '  ::after,',
      '  ::before {',
      '    border-color: var(--color-gray-200, currentcolor);',
      '  }',
      '}',
    ].join('\n');
    expect(universalBorderColourRules(restored)).toHaveLength(1);
    // ...and a comment ALONE is not a hit, which is why the plan's grep gate could not be used.
    expect(
      universalBorderColourRules('/* border-color: var(--color-gray-200, currentcolor); */')
    ).toEqual([]);
    // ...and a SCOPED border colour is not a hit either, or every rule in the file would be.
    expect(universalBorderColourRules('.card { border-color: var(--color-line); }')).toEqual([]);
    // ...including the rbc override that ENDS in `*`, the first-run false positive.
    //
    // DECISION Phase 88.1-16 (SPEC Req 9): this fixture string is RETAINED BYTE-IDENTICAL after
    // react-big-calendar was removed from the tree, chosen OVER renaming it to a neutral
    // selector and OVER deleting it to satisfy Req 9's stated `grep -rn 'rbc-' src` = 0 gate.
    //   - It is not a style rule. It is a PARSER UNIT TEST, and it is the regression pin for a
    //     REAL first-run false positive: `.rbc-time-content > * + * > *` ends in `*`, so the
    //     original "any `*` anywhere" predicate flagged it and reddened a correct tree. See the
    //     history at :175. Renaming the selector stops exercising the shape that broke it, so a
    //     rename silently WEAKENS the pin while leaving it looking green.
    //   - Req 9's gate was therefore rewritten rather than the code bent to fit it. The shipped
    //     gate is three parts — (a) no live import or dependency, (b) no `.rbc-*` selector
    //     AUTHORED in a stylesheet, (c) an enumerated prose allow-list — and it is EXECUTABLE at
    //     `src/app/reactBigCalendarRemoval.test.ts`, which pins this exact string (its test 4)
    //     and lists this file with its reason. The SPEC carries the matching
    //     "AMENDED 2026-08-22 (plan 88.1-16)" note.
    // Deleting or renaming this line is a decision about a regression pin, not a cleanup.
    expect(
      universalBorderColourRules('.rbc-time-content > * + * > * { border-left-color: var(--color-border); }')
    ).toEqual([]);
    // ...but a genuinely unscoped `* > *` IS still caught.
    expect(universalBorderColourRules('* > * { border-color: #e5e7eb; }')).toHaveLength(1);
  });

  it('7. the two shared primitives name their own neutral', () => {
    const banner = fs.readFileSync(path.join(SRC, 'components/ui/Banner.tsx'), 'utf8');
    // The cva base, not a tone variant: success/warning/error only colour the LEFT
    // edge, so without this the other three sides fell through to the shim.
    expect(banner).toMatch(/border border-line border-l-4/);
    expect(banner).toMatch(/info: 'border-l-line'/);

    const grid = fs.readFileSync(
      path.join(SRC, 'app/components/tutorial/simulated/TutorialGrid.js'),
      'utf8'
    );
    expect(grid).toMatch(/border border-line/);
    // `cn` is what lets a caller override the default deterministically; a template
    // literal would leave it to stylesheet order, where the neutral wins.
    expect(grid).toMatch(/className=\{cn\(/);
  });
});
