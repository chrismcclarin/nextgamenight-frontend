/**
 * SPEC Req 9 (Phase 88.1) drift guard: react-big-calendar stays gone, and the prose that
 * deliberately still names it stays enumerated.
 *
 * WHY THIS FILE EXISTS RATHER THAN A GREP IN A SUMMARY
 * ---------------------------------------------------
 * SPEC Req 9's stated acceptance was:
 *
 *     grep -rn 'react-big-calendar\|rbc-' src package.json   ->  0 hits
 *
 * That gate CANNOT PASS, and bending the code to make it pass would destroy real information.
 * The SPEC carries an "AMENDED 2026-08-22 (plan 88.1-16)" note recording the supersession; this
 * file is the executable half of it. Two mentions are load-bearing on purpose:
 *
 *   - `lib/availabilityColor.ts` — the `DECISION Phase 88-23 DES-02` block explains WHY the
 *     calendar wash is TRANSLUCENT by naming what it was painted behind: react-big-calendar's
 *     gridlines and event blocks. Delete the word and the rejected alternative (opaque
 *     `bg-green-100..500`) loses its reason, and that file's own banner says re-unifying the
 *     ramps is "a design decision, not a convenience."
 *   - `borderExplicitness.test.ts:405-408` — the `.rbc-time-content > * + * > *` fixture is the
 *     REGRESSION PIN for a real first-run false positive in the border-rule parser. That
 *     selector ends in `*`, so an "any `*` anywhere" predicate flagged it; the predicate was
 *     tightened rather than the rule allow-listed. Renaming the fixture silently weakens the
 *     pin, because a renamed selector no longer exercises the shape that broke it.
 *
 * A third category showed up during execution and is the reason the allow-list is a FILE SET
 * rather than a two-item list: Phase 88.1's own plans wrote migration prose into eleven more
 * files ("this phase swaps react-big-calendar for WeekGrid", "the shipped `.rbc-today` this
 * replaces was purple"). That prose is the record of the migration. It is allow-listed, not
 * erased — but it is ENUMERATED, so it cannot quietly grow back into a live dependency.
 *
 * WHY EXECUTABLE. Phase 88's own ledger records ELEVEN defective grep gates (see
 * `tintTreatment.test.ts:20-40` for the eleventh, and DEF-88-21-01 / DEF-88-24-04 /
 * DEF-88-25-02 / DEF-88-27-01 / DEF-88-28-01). A gate that lives only in a SUMMARY is a gate
 * nobody runs. Every assertion below was NEGATIVE-CHECKED at execution time by planting the
 * violation it forbids and watching it redden; the plants are recorded in `88.1-16-SUMMARY.md`.
 *
 * ONE OF THOSE NEGATIVE CHECKS FOUND A DEFECT IN THE PLAN'S OWN GATE, recorded here because it
 * is the reason test 1 is shaped the way it is: the plan's acceptance grep was
 *     from 'react-big-calendar' | require('react-big-calendar') | react-big-calendar/lib
 * over `src package.json`. Re-adding `"react-big-calendar": "^1.12.1"` to package.json's
 * dependencies produced ZERO HITS from that pattern — none of its three alternatives matches a
 * bare manifest key. The dependency could have returned to the manifest with the gate still
 * reporting green. Test 1 therefore checks the MANIFEST STRUCTURALLY (parsed dependency
 * sections) rather than by pattern, which is a property no regex on package.json can drift on.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { withoutComments } from '../test-utils/sourceScan';

const ROOT = path.join(__dirname, '..', '..');
const SRC = path.join(ROOT, 'src');

const PKG = 'react-big-calendar';
/** Matches the dependency name OR any `.rbc-*` / `rbc-*` class fragment. */
const MENTION = /react-big-calendar|rbc-/;

/**
 * Every file under `src/`, including tests and `.css` — deliberately WIDER than
 * `sourceFiles()` from `test-utils/sourceScan`, which excludes `*.test.*` and non-JS
 * extensions. Both exclusions would be fatal here: most surviving prose lives in test files,
 * and `globals.css` is the single most important file to scan.
 */
function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...allFiles(full));
    else out.push(full);
  }
  return out;
}

/** Strip `/* *\/` comments from CSS, preserving newlines so line numbers survive. */
function cssWithoutComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

function bare(file: string, src: string): string {
  return /\.css$/.test(file) ? cssWithoutComments(src) : withoutComments(src);
}

/**
 * THE ALLOW-LIST. Every `src/` file permitted to mention react-big-calendar or `rbc-` IN PROSE,
 * with the reason. Adding a file here is a decision that should be argued in a phase doc; a file
 * appearing here that no longer mentions it is a DANGLING CITATION and must be removed — plan
 * 88.1-16 spent a whole task fixing fourteen of those, so the gate fails in BOTH directions.
 *
 * Verified exhaustive 2026-08-24 against the tree at that commit: 13 files, 26 hits (down from
 * the pre-phase 67 hits — the CSS restyle block and the dead localizer accounted for most of
 * them; the FILE count rose because this phase's own plans wrote migration prose).
 */
const PROSE_ALLOW_LIST: Record<string, string> = {
  // --- the two the SPEC amendment names explicitly ---
  'src/lib/availabilityColor.ts':
    'DECISION 88-23 DES-02: names RBC gridlines/event blocks to justify the TRANSLUCENT wash ' +
    'over opaque bg-green-100..500. Erasing the word erases the rejected alternative\'s reason. ' +
    'The second hit records that the return type (a CSS colour string, not Tailwind classes) ' +
    'survived the swap to WeekGrid unchanged.',
  'src/app/borderExplicitness.test.ts':
    'The `.rbc-time-content > * + * > *` FIXTURE is the regression pin for the first-run false ' +
    'positive that forced `universalBorderColourRules` to be tightened. Byte-identical or the ' +
    'pin is weaker than it reads. Pinned separately by test 4 below.',

  // --- migration prose written by Phase 88.1's own plans ---
  'src/app/globals.css':
    'The 88.1-16 DECISION marker where the layered vendor @import was, carrying forward the ' +
    'MEASURED `layer(base)` rule for the next third-party stylesheet; the amended ' +
    '"MUST STAY unlayered" list; and two @import-ordering markers whose named import went.',
  'src/app/components/EventScheduler.tsx':
    'The today-marker DECISION cites the shipped `.rbc-today` (PURPLE, a cool tint) to explain ' +
    'why moving the hue to amber under a translucent green wash is not the same change.',
  'src/app/components/EventScheduler.test.tsx':
    'Header records that these pins were written against the RBC version FIRST so the rebuild ' +
    'had something to be measured against. That ordering is the file\'s whole justification.',
  'src/app/components/createEvent.integration.test.tsx':
    'Exists precisely because a stub cannot prove the wiring; records the RBC 1.12.1 `Selection` ' +
    'probe and that it must stay green UNEDITED across the swap.',
  'src/app/components/createEvent.js':
    'Two notes on props that were inert under RBC and stayed inert under WeekGrid.',
  'src/app/components/createEvent.participants.test.tsx':
    'Records that the mock\'s justification CHANGED (heavy dependency -> heavy to mount) rather ' +
    'than lapsing when the dependency went.',
  'src/app/components/heatmap/usePaintGesture.ts':
    'Records that mouse drag-select came free from RBC and had to be rebuilt — the reason this ' +
    'hook exists at all.',
  'src/app/components/heatmap/usePaintGesture.test.ts':
    'Pins the PAIR-not-per-cell semantics that RBC\'s onSelectSlot supplied.',
  'src/app/groupHomePage/page.js':
    'CAL-05 comment, rewritten to describe the REBUILT day view (a `days` prop value, SPEC ' +
    'Req 2) while recording what it used to be.',
  'src/lib/eventFormUtils.js':
    'Records that the calendar beneath the prop was swapped RBC -> WeekGrid.',
  'src/lib/eventFormUtils.test.ts':
    'Same swap note, on the suite that guards the skip rule across it.',

  // --- this file ---
  'src/app/reactBigCalendarRemoval.test.ts':
    'The gate itself necessarily names what it forbids.',
};

/** The fixture string, byte-identical. Any edit here must be a deliberate, argued change. */
const BORDER_FIXTURE =
  '.rbc-time-content > * + * > * { border-left-color: var(--color-border); }';

describe('SPEC Req 9: react-big-calendar removal stays removed (Phase 88.1-16)', () => {
  it('1. the dependency is absent from the manifest and the lockfile', () => {
    // STRUCTURAL, not a pattern — see the header. A regex over package.json missed exactly this.
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const sections = [
      'dependencies',
      'devDependencies',
      'peerDependencies',
      'optionalDependencies',
      'bundleDependencies',
      'bundledDependencies',
    ];
    const found = sections.filter((s) => pkg[s] && Object.keys(pkg[s]).includes(PKG));
    expect(found).toEqual([]);

    // The lockfile is the half that actually decides what `npm ci` installs. Without this,
    // the package returns on the next clean install with the manifest still looking clean.
    const lock = fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8');
    expect(lock).not.toContain(PKG);
  });

  it('2. no file under src/ imports react-big-calendar', () => {
    // Comments are stripped FIRST: this file, and eleven others, legitimately name the package
    // in prose. Comment blindness is what red-lined four earlier Phase 88 gates.
    const offenders: string[] = [];
    for (const file of allFiles(SRC)) {
      if (/\.(js|jsx|ts|tsx|mjs|cjs)$/.test(file) === false) continue;
      const src = fs.readFileSync(file, 'utf8');
      for (const line of bare(file, src).split('\n')) {
        if (new RegExp(`(from|import|require)\\s*\\(?\\s*['"\`]${PKG}`).test(line)) {
          offenders.push(`${path.relative(SRC, file)}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('3. no .rbc-* selector is AUTHORED in any stylesheet', () => {
    // "Authored" is the whole point of the rewritten gate: a `.rbc-*` inside a comment is
    // history, a `.rbc-*` outside one is a rule shipping into the stylesheet.
    const offenders: string[] = [];
    for (const file of allFiles(SRC).filter((f) => /\.css$/.test(f))) {
      const stripped = cssWithoutComments(fs.readFileSync(file, 'utf8'));
      // Also catches an `@import` of the vendor stylesheet, which would re-introduce all of them.
      for (const [i, line] of stripped.split('\n').entries()) {
        if (/\.rbc-|@import[^;]*react-big-calendar/.test(line)) {
          offenders.push(`${path.relative(SRC, file)}:${i + 1} ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('4. the border-parser regression fixture is preserved byte-identical', () => {
    // The ONE place `rbc-` survives outside a comment, and it must: it is a parser unit test,
    // not a style rule. Pinned by exact string so a rename cannot silently weaken it.
    const border = fs.readFileSync(path.join(SRC, 'app/borderExplicitness.test.ts'), 'utf8');
    expect(border).toContain(BORDER_FIXTURE);
  });

  it('5. the prose allow-list is exhaustive and has no dangling entries', () => {
    const actual = new Set<string>();
    for (const file of allFiles(SRC)) {
      if (MENTION.test(fs.readFileSync(file, 'utf8'))) {
        actual.add(path.relative(ROOT, file));
      }
    }
    const allowed = new Set(Object.keys(PROSE_ALLOW_LIST));

    // A NEW file naming the package is the regression this gate exists for.
    const unlisted = [...actual].filter((f) => !allowed.has(f)).sort();
    expect(unlisted, 'unlisted file mentions react-big-calendar — add it to PROSE_ALLOW_LIST with a reason, or remove the mention').toEqual([]);

    // A listed file that no longer mentions it is a DANGLING CITATION. Delete the entry.
    const stale = [...allowed].filter((f) => !actual.has(f)).sort();
    expect(stale, 'allow-list entry no longer mentions react-big-calendar — delete the entry').toEqual([]);
  });

  it('6. every mention that survives comment-stripping is a known fixture', () => {
    // Belt-and-braces over tests 2-4: proves the ONLY non-prose survivor in the whole tree is
    // the border fixture. Anything else means real code is talking about the package again.
    //
    // TWO exemptions, both named rather than pattern-loosened so they stay visible:
    //   - the border fixture (test 4 pins it byte-identical);
    //   - THIS FILE, which names the package in CODE — the `PKG` constant, the `describe` title,
    //     the allow-list reasons and the failure messages — because a gate cannot forbid a string
    //     without containing it. Exempting the whole file is safe precisely because tests 1-3
    //     cover it like any other: it declares no dependency, imports nothing, and is not a
    //     stylesheet. Loosening the REGEX instead would have blinded the check everywhere.
    const SELF = 'src/app/reactBigCalendarRemoval.test.ts';
    const offenders: string[] = [];
    for (const file of allFiles(SRC)) {
      if (!/\.(js|jsx|ts|tsx|mjs|cjs|css)$/.test(file)) continue;
      if (path.relative(ROOT, file) === SELF) continue;
      const stripped = bare(file, fs.readFileSync(file, 'utf8'));
      for (const [i, line] of stripped.split('\n').entries()) {
        if (!MENTION.test(line)) continue;
        if (line.includes(BORDER_FIXTURE)) continue;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1} ${line.trim()}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
