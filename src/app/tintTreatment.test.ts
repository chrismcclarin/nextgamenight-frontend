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

import { sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

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
 * nothing — exactly the failure the now-deleted `MergedHeatmapGrid` shipped into before Phase 88-27
 * fixed it. (The file itself went in plan 88.1-16; the failure mode it demonstrated has not.)
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
    // AMENDED Phase 88.3-11: the scan reads CODE with comments blanked, not the raw
    // file. It was comment-blind, and this phase's own markers necessarily NAME the
    // function they forbid: `groupHomePage/page.js`'s dim records that Tailwind 4.3
    // compiles `bg-black/15` to a `color-mix(in oklab, …)` the browser serialises as
    // oklab(), which is precisely WHY the bracketed `rgb(0_0_0/0.15)` form was chosen
    // there. A gate that reds on the comment explaining the decision is the exact
    // failure recorded in DEF-88-25-02, DEF-88-27-01 and DEF-88-28-01, and the pressure
    // it applies is to DELETE the explanation. `withoutComments` is the shared primitive
    // 88-29 extracted for this; the property being asserted (no AUTHORED color-mix) is
    // unchanged, and the anti-vacuity pair below pins that the detector still fires.
    expect(withoutComments('const t = "color-mix(in oklab, a, b)";')).toContain('color-mix(');
    expect(withoutComments('// Tailwind compiles this to color-mix(in oklab, …)\nconst t = 1;')).not.toContain(
      'color-mix(',
    );

    const offenders = files
      .filter((f) => withoutComments(fs.readFileSync(f, 'utf8')).includes('color-mix('))
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
    // This exemplar reads `EventScheduler.tsx`, chosen OVER its previous home
    // `MergedHeatmapGrid.js`, because that file and its `MergedHeatmap.js` parent were DELETED in
    // plan 88.1-16. What survived the deletion is the thing worth keeping: the paired-ternary
    // today-tint idiom, carried verbatim in SHAPE to the site this assertion now guards.
    //
    // THE DELETE-OVER-REVIVE DECISION ITSELF NO LONGER LIVES HERE. Until 88.1-21 this comment was
    // its only record, which put a decision about production code somewhere no one reading that
    // code would look. It now lives at `src/lib/availabilityColor.ts` as
    // `DECISION Phase 88.1 (Req 10)`, beside the 88-31 second-ramp deletion. Read it there; the
    // assertion below keeps it there.
    //
    // `EventScheduler.tsx` is the canonical desktop exemplar, chosen OVER `SchedulerWeekStrip.tsx`
    // (which also carries a today ternary): only this site matches the retired exemplar in BOTH
    // halves. The strip's non-today TEXT value is deliberately the muted token, not primary, to
    // hold M-03 parity with its sibling idiom (see the DECISION block at SchedulerWeekStrip.tsx
    // :150-186). Converging the two is a decision, not a consistency fix.
    //
    // KNOWN LIMIT, measured in plan 88.1-13 and repeated here so nobody over-reads this line:
    // test 3 above does NOT catch the interpolated collapse at this site. Its scanner lexes string
    // CHUNKS, and in the collapsed shape the plain surface sits in the template quasi while the
    // tint sits in a separate inner literal — two chunks, one background each, no offender. What
    // actually guards the scheduler against the collapse is the component pin in
    // `EventScheduler.test.tsx` (T-88.1-39). This assertion pins the SHAPE, not the cascade.
    const scheduler = fs.readFileSync(path.join(SRC, 'app/components/EventScheduler.tsx'), 'utf8');
    // mutually exclusive branches, NOT a static surface with an appended tint
    expect(scheduler).toMatch(/today \? 'bg-surface-accent-subtle' : 'bg-surface-card'/);
    // the retired exemplar's own in-file warning was that `isTodayDate` drove the day number's
    // `text-content-accent` too and "the two must agree" — so the PAIR is asserted, not just the surface.
    expect(scheduler).toMatch(/today \? 'text-content-accent' : 'text-content-primary'/);

    const grouplist = fs.readFileSync(path.join(SRC, 'app/components/grouplist.js'), 'utf8');
    expect(grouplist).toMatch(/bg-\[var\(--color-bg-overlay\)\]/);
    // the image-only gate is part of the contract — a colour-only card must not get a dim.
    // Wave-12 follow-up (owner-ruled 2026-08-21): the gate keys on the VALIDATED style
    // (hasBgImage = !!safeBgImageStyle(...)), not the raw string — a truthy-but-invalid
    // URL must not render the dim over no image (the walk's solid-black-card edge).
    expect(grouplist).toMatch(/\{hasBgImage && \(/);
    expect(grouplist).toMatch(/const hasBgImage = !!bgImageStyle/);

    const member = fs.readFileSync(path.join(SRC, 'app/components/ClickableMemberName.js'), 'utf8');
    expect(member).toMatch(/rounded-full bg-surface-card-hover text-btn-primary/);
  });

  it('4b. the Req 10 delete-over-revive decision lives at a PRODUCTION site, not only in this file', () => {
    // Phase 88.1-21 (88.1-CODE-REVIEW.md). A decision recorded only inside a test file is
    // invisible to the next person editing the code it governs — that is how a deliberate delete
    // gets "restored" as an oversight two phases later. This pins the marker to a production
    // module, so moving it back into a test (or dropping it) fails here rather than silently.
    const color = fs.readFileSync(path.join(SRC, 'lib/availabilityColor.ts'), 'utf8');
    expect(color).toMatch(/DECISION Phase 88\.1 \(Req 10\)/);
    // The load-bearing half is the REJECTED alternative — "was deleted" warns nobody,
    // "deleted OVER reviving it" stops a future revive.
    expect(color).toMatch(/chosen OVER reviving/);
    expect(color).toMatch(/MergedHeatmap/);
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

  // -------------------------------------------------------------------------
  // Plan 88.3-16 — owner ruling 3. Appended bare `it(`; nothing above renumbered.
  //
  // WHY IT IS HERE: six of the seven accent-circle sites are hand-rolled JSX that
  // NO test asserts. Only `EmptyState.test.tsx` pins the primitive's class name,
  // so reverting one invite circle to the shared pair reds nothing at all — the
  // swap would rest on a one-off SUMMARY grep. This file already owns the
  // shared-token assertions (test 4 above), so the census negative and the
  // seven-site positive live together rather than drifting apart.
  // -------------------------------------------------------------------------

  it('8. all SEVEN accent circles are on the -strong pair, and the shared token census is untouched', () => {
    const STRONG_BG = 'bg-surface-accent-subtle-strong';
    const STRONG_TEXT = 'text-content-accent-strong';

    // SEVEN CIRCLES IN FIVE FILES — not seven files. Two of the invite screens
    // render the circle twice (a success branch and an error/info branch), so a
    // per-FILE count of 7 is unsatisfiable on this tree and a `-l | wc -l` of 7
    // could only be reached by inventing sites. Counts are therefore per file,
    // and the TOTAL is the seven the owner's ruling covers.
    //
    // The primitive is listed apart from the hand-rolled four because its glyph
    // comes from `Icon`, which already defaults to aria-hidden (Icon.tsx) — it
    // needs no decorative marking and must not be given one here.
    const PER_FILE: Record<string, number> = {
      'app/invite/accept/page.js': 1,
      'app/invite/group/[token]/page.js': 2,
      'app/invite/game/[token]/page.js': 2,
      'app/restore/group/[token]/page.tsx': 1,
      'components/ui/EmptyState.tsx': 1,
    };
    const SEVEN = Object.keys(PER_FILE);

    const code = (rel: string) => withoutComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));

    // (a) FILE COUNT, mechanically. `grep -rc` prints per-file counts, not a
    // total, and this plan set deliberately adds token mentions in a DECISION
    // marker and in `EmptyState.test.tsx` — so the count is taken over CODE
    // (comments blanked) in non-test source files, which is what the tree will
    // actually render. An executor must never "fix" a count by deleting a marker.
    const carriers = sourceFiles(SRC).filter((f) => {
      if (/\.test\.[jt]sx?$/.test(f)) return false;
      return withoutComments(fs.readFileSync(f, 'utf8')).includes(STRONG_BG);
    });
    expect(
      carriers.map((f) => path.relative(SRC, f)).sort(),
      'the seven accent-circle sites did not move together — the owner ruled the pair moves as a pair',
    ).toEqual([...SEVEN].sort());

    // (b) the per-file occurrence counts, their total, and the PAIR moving together.
    let total = 0;
    for (const rel of SEVEN) {
      const src = code(rel);
      const hits = (src.match(new RegExp(STRONG_BG, 'g')) ?? []).length;
      expect(hits, `${rel}: wrong number of circle classNames carrying ${STRONG_BG}`).toBe(
        PER_FILE[rel],
      );
      total += hits;

      for (const chunk of stringChunks(src).filter((c) => c.text.includes(STRONG_BG))) {
        expect(chunk.text, `${rel}: an accent circle lost its rounded-full`).toContain(
          'rounded-full',
        );
      }

      // the glyph colour rides with the ground. Moving only the ground drops the
      // pair from 6.37:1 to 5.69:1; together it measures 7.28:1.
      let from = 0;
      for (let i = 0; i < hits; i += 1) {
        const at = src.indexOf(STRONG_BG, from);
        expect(
          src.slice(at, at + 800),
          `${rel}: a circle moved to the -strong ground but its glyph did not — both halves or neither`,
        ).toContain(STRONG_TEXT);
        from = at + 1;
      }
    }
    expect(total, 'the owner ruled on SEVEN circles; a different number is here').toBe(7);

    // (c) the six hand-rolled <svg> glyphs are marked decorative. A bare inline
    // SVG announces as "image"/"graphic" with no name on some screen readers,
    // which is an inconsistency with our OWN `Icon` primitive rather than a new
    // standard. Expected per file: accept 1, invite/group 2, invite/game 2,
    // restore 1 — baseline was 0 in all four (verified 2026-08-27).
    const EXPECTED_DECORATIVE: Record<string, number> = {
      'app/invite/accept/page.js': 1,
      'app/invite/group/[token]/page.js': 2,
      'app/invite/game/[token]/page.js': 2,
      'app/restore/group/[token]/page.tsx': 1,
    };
    for (const [rel, n] of Object.entries(EXPECTED_DECORATIVE)) {
      const src = code(rel);
      const glyphs = (
        src.match(new RegExp(`<svg className="w-8 h-8 ${STRONG_TEXT}"[^>]*`, 'g')) ?? []
      );
      expect(glyphs.length, `${rel}: expected ${n} accent-circle glyph(s)`).toBe(n);
      for (const g of glyphs) {
        expect(g, `${rel}: a decorative accent-circle <svg> lost aria-hidden`).toContain(
          'aria-hidden="true"',
        );
        expect(g, `${rel}: a decorative accent-circle <svg> lost focusable="false"`).toContain(
          'focusable="false"',
        );
      }
    }

    // (d) THE STANDING NEGATIVE — the ~13-consumer census of the SHARED token is
    // untouched. Plan 14 minted a separate pair precisely so the census rejection
    // recorded at `--color-bg-accent-subtle` in globals.css survives; a later
    // "consistency" sweep that drags these four onto the -strong pair would
    // repaint surfaces nobody asked about.
    for (const rel of [
      'app/components/BallotSection.js',
      'app/components/PendingMemberBanner.js',
      'app/components/ManageMembers.js',
      'app/components/EventScheduler.tsx',
    ]) {
      const src = code(rel);
      expect(src, `${rel}: lost the SHARED bg-surface-accent-subtle`).toMatch(
        /bg-surface-accent-subtle(?!-strong)/,
      );
      expect(
        src,
        `${rel}: a shared-token consumer was dragged onto the -strong pair — the ~13-consumer ` +
          'census rejection at --color-bg-accent-subtle is deliberate',
      ).not.toContain(STRONG_BG);
    }
  });
});
