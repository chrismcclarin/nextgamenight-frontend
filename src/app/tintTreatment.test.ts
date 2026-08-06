/**
 * Req 17 (DES-02 / D-32 / D-33) repo-wide guard: soft tints are opaque per-theme tokens,
 * never re-added `/N` opacity modifiers, and never silently overpainted.
 *
 * WHAT WENT WRONG ONCE AND MUST NOT AGAIN
 * --------------------------------------
 * 136 tint tokens across 35 files were `/N` opacity modifiers on `var()`-backed semantic
 * colours. On Tailwind v3 that combination generates NO CLASS AT ALL, so ~136 places a
 * designer had asked for a soft tint rendered nothing for years. v4 does generate them, and
 * it emits TWO branches: a fallback that DROPS the alpha (painting a SOLID status-coloured
 * block) and a `color-mix()` branch that keeps it. 87.7 D-18 therefore stripped the whole
 * token rather than let v4 start rendering it, and Phase 88 designed the real treatment as
 * hand-picked OPAQUE `-subtle` tokens per theme.
 *
 * So `bg-status-error/10` is not merely "the old way". Re-adding one reverses the shipped
 * `DECISION Phase 87.7 D-18` markers and reintroduces a browser-dependent solid-block defect
 * on whichever browsers lack `color-mix()`. That is the property test 1 pins.
 *
 * WHY THIS DOES NOT USE THE PLAN'S GREP — MEASURED, NOT ASSERTED
 * -------------------------------------------------------------
 * 88-27's verify gate is
 *     ! grep -rnE "(bg|border|text)-(status-)?(success|error|warning|green|red|amber)-[0-9]{2,3}/[0-9]+" src …
 * and it is defective in BOTH directions. Measured on this tree:
 *
 *  - FALSE POSITIVES — it is RED on the converged tree and can never be green. Its
 *    `-[0-9]{2,3}/` clause matches raw-palette SHADE numbers, so `dark:bg-amber-900/20`
 *    matches. All 7 lines it reports are §5 sites of the 87.7 census — the 27 raw-colour
 *    standard-step tokens that render correctly today and that the census explicitly says
 *    MUST NOT be touched. Its entire signal is sites it is forbidden to act on.
 *  - FALSE NEGATIVES — it cannot see the thing it exists to detect. Re-adding
 *    `bg-status-error/10 border border-status-error/30` to `StartPollModal.js` produced
 *    BYTE-IDENTICAL gate output. The regex requires a 2-3 digit shade immediately before the
 *    slash, and a project semantic token (`status-error`, `accent`, `content-link`) has none.
 *    **It is structurally incapable of matching 133 of the 136 census rows.**
 *
 * That is the eleventh defective grep gate recorded in Phase 88 (after 88-26's, DEF-88-24-04
 * and DEF-88-25-02). The scanner below derives its colour-name set FROM `globals.css` rather
 * than hard-coding one, so it cannot drift as tokens are added.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST
 * --------------------------------------
 * Same reasoning as `borderExplicitness.test.ts`, `fetchErrorTreatment.test.ts` and
 * `cardPaddingIdiom.test.ts`: the property is "every tinted surface in the app", spread over
 * 35 files behind modals, role gates, magic-link routes and error branches that no single
 * render reaches — and a per-surface pin goes green forever the moment surface N+1 lands.
 *
 * NOTE ON DUPLICATION: the chunk lexer below is a second copy of the one in
 * `borderExplicitness.test.ts`. Importing it would re-register that file's suites in this
 * file's context. Extracting both into a shared test helper is a candidate for 88-29's
 * gate-hygiene pass; it is deliberately not done here, mid-sweep.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stringChunks } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const GLOBALS = path.join(__dirname, 'globals.css');

/** Utility prefixes that take a COLOUR (87.7-OPACITY-CENSUS §1.3's list). */
const COLOR_UTILITIES = [
  'bg',
  'text',
  'border',
  'ring',
  'ring-offset',
  'divide',
  'outline',
  'decoration',
  'shadow',
  'accent',
  'caret',
  'fill',
  'stroke',
  'placeholder',
  'from',
  'via',
  'to',
];

/**
 * The project's semantic colour names, read out of `globals.css`'s `@theme inline` block
 * rather than hard-coded. These are exactly the names whose theme value is a bare `var(...)`,
 * i.e. the cause-A population: the ones for which v3 generated no `/N` class.
 */
export function semanticColorNames(css: string): Set<string> {
  const start = css.indexOf('@theme inline');
  if (start < 0) throw new Error('globals.css has no `@theme inline` block');
  let depth = 0;
  let i = css.indexOf('{', start);
  const blockStart = i;
  for (; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  const block = css.slice(blockStart, i);
  const names = new Set<string>();
  for (const m of block.matchAll(/--color-([a-z0-9-]+)\s*:/g)) names.add(m[1]);
  return names;
}

/** `hover:bg-status-error/10` -> {util:'bg', color:'status-error', alpha:'10'}; else null. */
export function parseAlphaToken(
  token: string,
  semantic: Set<string>,
): { util: string; color: string; alpha: string } | null {
  // strip variant prefixes (`hover:`, `md:`, `data-[state=open]:`) and `!`
  const bare = token.replace(/^(?:[a-z][a-z0-9-]*(?:\[[^\]]*\])?:)*!?/, '');
  const slash = bare.lastIndexOf('/');
  if (slash < 0) return null;
  const alpha = bare.slice(slash + 1);
  if (!/^\d+$/.test(alpha)) return null;
  const body = bare.slice(0, slash);
  for (const util of COLOR_UTILITIES) {
    for (const side of ['', '-t', '-r', '-b', '-l', '-x', '-y', '-s', '-e']) {
      const prefix = `${util}${side}-`;
      if (!body.startsWith(prefix)) continue;
      const color = body.slice(prefix.length);
      if (semantic.has(color)) return { util, color, alpha };
    }
  }
  return null;
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

/**
 * The resting `-subtle` tints, and why a second resting `bg-*` beside one is a defect.
 *
 * MEASURED in `.next/static/css/*.css` after a real `next build` of this app:
 *   .bg-status-error-subtle    53174
 *   .bg-status-success-subtle  53299
 *   .bg-status-warning-subtle  53428
 *   .bg-surface-accent-subtle  53500
 *   .bg-surface-card           53573
 *   .bg-surface-card-hover     53628
 * Every tint is emitted BEFORE the plain surfaces. Two same-specificity background rules on
 * one element are resolved by stylesheet order, so where both reach an element through a
 * template literal with no `tailwind-merge`, the PLAIN SURFACE WINS and the tint renders
 * nothing — exactly the failure `MergedHeatmapGrid` shipped into before this plan.
 * Variant-prefixed tints (`hover:`) are exempt: the pseudo-class raises specificity.
 */
const RESTING_SUBTLE = /^bg-(status-(success|error|warning)-subtle|surface-accent-subtle)$/;

export function overpaintedTintChunks(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    const resting = text.split(/\s+/).filter((t) => t && !t.includes(':'));
    const tint = resting.filter((t) => RESTING_SUBTLE.test(t));
    const other = resting.filter((t) => t.startsWith('bg-') && !RESTING_SUBTLE.test(t));
    if (tint.length && other.length) {
      hits.push({ line: src.slice(0, offset).split('\n').length, text: text.trim() });
    }
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

describe('D-32/D-33 tint treatment (Req 17)', () => {
  const files = sourceFiles(SRC);
  const css = fs.readFileSync(GLOBALS, 'utf8');
  const semantic = semanticColorNames(css);

  it('finds a representative sample of the app, so the sweep is not scanning an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
    expect(semantic.size).toBeGreaterThan(30);
    expect(semantic.has('status-error')).toBe(true);
    expect(semantic.has('status-error-subtle')).toBe(true);
  });

  it('1. no source file re-adds a `/N` opacity modifier to a project semantic colour', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { offset, text } of stringChunks(src)) {
        for (const token of text.split(/\s+/).filter(Boolean)) {
          if (parseAlphaToken(token, semantic)) {
            const line = src.slice(0, offset).split('\n').length;
            offenders.push(`${path.relative(SRC, file)}:${line} ${token}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. no component source authors a tint with `color-mix()` (D-33 rejected it)', () => {
    const offenders = files
      .filter((f) => fs.readFileSync(f, 'utf8').includes('color-mix('))
      .map((f) => path.relative(SRC, f));
    expect(offenders).toEqual([]);
  });

  it('3. no `-subtle` tint is emitted beside a plain background it would lose to', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const hit of overpaintedTintChunks(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${path.relative(SRC, file)}:${hit.line} ${hit.text}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('4. the three UI-SPEC §10.3 exemplars carry their designed treatment', () => {
    const grid = fs.readFileSync(path.join(SRC, 'app/components/MergedHeatmapGrid.js'), 'utf8');
    // mutually exclusive branches, NOT a static surface with an appended tint
    expect(grid).toMatch(/isTodayDate \? 'bg-surface-accent-subtle' : 'bg-surface-card'/);

    const grouplist = fs.readFileSync(path.join(SRC, 'app/components/grouplist.js'), 'utf8');
    expect(grouplist).toMatch(/bg-\[var\(--color-bg-overlay\)\]/);
    // the image-only gate is part of the contract — a colour-only card must not get a dim
    expect(grouplist).toMatch(/\{bgImage && \(/);

    const member = fs.readFileSync(path.join(SRC, 'app/components/ClickableMemberName.js'), 'utf8');
    expect(member).toMatch(/rounded-full bg-surface-card-hover text-btn-primary/);
  });

  it('5. the parser tells a semantic-token alpha from a raw-palette one and from a fraction', () => {
    // the real defect
    expect(parseAlphaToken('bg-status-error/10', semantic)).toEqual({
      util: 'bg',
      color: 'status-error',
      alpha: '10',
    });
    expect(parseAlphaToken('hover:bg-status-warning/20', semantic)?.color).toBe('status-warning');
    expect(parseAlphaToken('dark:border-l-line/40', semantic)?.color).toBe('line');
    // the 27 raw-colour standard-step sites the 87.7 census says MUST NOT be touched
    expect(parseAlphaToken('dark:bg-amber-900/30', semantic)).toBeNull();
    expect(parseAlphaToken('bg-black/80', semantic)).toBeNull();
    expect(parseAlphaToken('border-white/30', semantic)).toBeNull();
    // fractions and URLs, which the plan's grep and every naive matcher hit
    expect(parseAlphaToken('w-1/2', semantic)).toBeNull();
    expect(parseAlphaToken('translate-y-1/2', semantic)).toBeNull();
    expect(parseAlphaToken('data-[state=open]:slide-in-from-left-1/2', semantic)).toBeNull();
  });

  it('6. the scanner reads tokens inside template interpolations, and ignores comments', () => {
    const interpolated =
      'const x = `p-3 ${cond ? "bg-status-error/10" : "bg-surface-card"}`;';
    const tokens = stringChunks(interpolated).flatMap((c) => c.text.split(/\s+/));
    expect(tokens).toContain('bg-status-error/10');

    const commented =
      '// the old class was bg-status-error/10\n/* and border-status-error/30 */\nconst y = "p-3";';
    const seen = stringChunks(commented).flatMap((c) => c.text.split(/\s+/));
    expect(seen.some((t) => parseAlphaToken(t, semantic))).toBe(false);
  });

  it('7. the 27 protected raw-colour tints still exist — this sweep must not have eaten them', () => {
    const header = fs.readFileSync(path.join(SRC, 'app/Header.js'), 'utf8');
    expect(header).toMatch(/bg-black\/60/);
    const dialog = fs.readFileSync(path.join(SRC, 'components/ui/dialog.tsx'), 'utf8');
    expect(dialog).toMatch(/bg-black\/80/);
  });
});
