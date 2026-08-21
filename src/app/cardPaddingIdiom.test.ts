/**
 * Req 2 (DES-02) repo-wide guard: every `.card` call site authors `p-3 md:p-6`, and
 * NONE of them is allowed to lose that utility.
 *
 * WHY THE "NO NAKED CARD" ASSERTION IS THE IMPORTANT ONE
 * -----------------------------------------------------
 * `.card` is a layered `@utility` that declares its own `padding: 1.5rem`
 * (globals.css → `@utility card`). Phase 87.8's D-01 moved it there PRECISELY so a
 * consumer's own padding utility would win the cascade. The consequence, which is
 * the single most dangerous misreading available in Phase 88: deleting a call site's
 * `p-3 md:p-6` does not "clean up" a redundant utility — it silently restores 24px
 * at phone width, DOUBLE the ratified 12px top-level-card rung, on a surface nobody
 * re-measures. SPEC Req 2's own wording ("`.card` padding overrides removed or
 * promoted to explicit card variants"), read literally, instructs exactly that.
 *
 * So this file pins BOTH halves: the utility is present (the trap), and it is the
 * one ratified idiom (the convergence the owner ruled on 2026-08-05, option-a).
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST
 * -----------------------------------------------
 * Same reasoning as `components/controlSizeFloor.test.tsx`: the property is "every
 * card in the app", and no single render reaches 28 call sites spread across modals,
 * tabs, role gates and fetch states. A per-surface render pin would also go green
 * forever the moment a 29th card is added, which is the failure mode 88-19 named for
 * named-node pins. The e2e counterpart (`e2e/padding-budget.spec.ts`) measures the
 * RENDERED result on eight surfaces; this measures the property on all of them.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP
 * -----------------------------------
 * 88-24's own verify gate greps `className=.?"[^"]*\bcard\b'`. It is blind twice over:
 *   1. `\bcard\b` also matches `bg-surface-card`, `rounded-card`, `hover:bg-surface-
 *      card-hover` — 150+ lines of noise that bury the ~28 real sites, so a human
 *      reading its output cannot tell a pass from a miss;
 *   2. it only reads DOUBLE-QUOTED classNames. `GameSuggestionCard.js:20` writes
 *      ``className={`card p-4 md:p-6 …`}`` and was invisible to it — measured, not
 *      reasoned: the pre-88-24 census run with that grep reported 12 `p-4 md:p-6`
 *      sites when there were 13.
 * The scanner below tokenises the class list (so `bg-surface-card` can never match)
 * and reads template-literal and single-quoted classNames as well. Test 2 pins that
 * second capability directly, so the template-literal blindness cannot come back.
 *
 * Deliberately NOT asserted here: page-WRAPPER padding. `gameDetail/page.js`'s page
 * wrapper is a bare `p-6` against `userProfile`'s `p-3 md:p-6`, and that divergence
 * is real — but it is outside the `.card` census the owner ruled on, it is logged in
 * this phase's deferred-items.md, and folding it in here would smuggle an unratified
 * visual change past the ruling.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/** The one ratified idiom: 12px at phone, 24px from `md` up (87.8 D-04 ladder). */
const RATIFIED_IDIOM = 'p-3 md:p-6';

/**
 * `className="…"` | ``className={`…`}`` | `className={'…'}`.
 * The template-literal branch is NOT optional — see the header. `[\s\S]` because a
 * long className is routinely wrapped across lines.
 */
const CLASSNAME_RE = /className=\s*(?:"([^"]*)"|\{\s*`([\s\S]*?)`|\{\s*'([^']*)')/g;

/** Any padding utility, breakpoint-prefixed or not. */
const PADDING_TOKEN = /^(?:sm:|md:|lg:|xl:|2xl:|max-sm:|max-md:)?p-[0-9]/;

interface CardSite {
  file: string;
  line: number;
  /** Just the padding utilities, in source order. */
  padding: string[];
  /** True when the className was written as a template literal. */
  templateLiteral: boolean;
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

function collectCardSites(): CardSite[] {
  const sites: CardSite[] = [];
  for (const file of sourceFiles(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    CLASSNAME_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = CLASSNAME_RE.exec(text)) !== null) {
      const isTemplate = match[2] !== undefined;
      const raw = match[1] ?? match[2] ?? match[3] ?? '';
      // Drop `${…}` interpolations before tokenising: their contents are conditional
      // branches, not statically-applied classes, and a `p-4` inside one is not
      // something this gate can reason about.
      const tokens = raw.replace(/\$\{[\s\S]*?\}/g, ' ').split(/\s+/).filter(Boolean);
      // Exact token match — this is what stops `bg-surface-card` / `rounded-card`
      // from being counted, which is the plan grep's first blindness.
      if (!tokens.includes('card')) continue;
      sites.push({
        file: path.relative(SRC, file),
        line: text.slice(0, match.index).split('\n').length,
        padding: tokens.filter((t) => PADDING_TOKEN.test(t)),
        templateLiteral: isTemplate,
      });
    }
  }
  return sites;
}

describe('Req 2 (DES-02): the `.card` padding idiom, repo-wide', () => {
  const sites = collectCardSites();

  it('finds `.card` call sites to check (guards against a scanner that silently matches nothing)', () => {
    // 28 at the time of writing. A floor, not an equality — new cards are expected,
    // and pinning the exact count would turn every added card into a red build.
    expect(sites.length).toBeGreaterThanOrEqual(25);
  });

  it('reads template-literal classNames, not just double-quoted ones', () => {
    // The plan's grep could not see these, and `GameSuggestionCard.js` was the site it
    // missed. If this ever resolves to zero, the scanner has gone half-blind and the
    // three assertions below are reporting on a subset without saying so.
    const templateSites = sites.filter((s) => s.templateLiteral);
    expect(templateSites.length).toBeGreaterThanOrEqual(1);
  });

  it('has no `.card` site with NO padding utility (the silent-24px trap)', () => {
    const naked = sites.filter((s) => s.padding.length === 0).map((s) => `${s.file}:${s.line}`);
    expect(
      naked,
      'these `.card` sites author no padding utility, so `@utility card`\'s own `padding: 1.5rem` ' +
        'applies and they render 24px at phone — double the ratified 12px rung. Restore ' +
        `\`${RATIFIED_IDIOM}\` at each; do NOT "fix" this by editing the @utility block.`,
    ).toEqual([]);
  });

  it('has every `.card` site on the one ratified idiom', () => {
    const offenders = sites
      .filter((s) => s.padding.join(' ') !== RATIFIED_IDIOM)
      .map((s) => `${s.file}:${s.line} -> "${s.padding.join(' ')}"`);
    expect(
      offenders,
      `every top-level card renders \`${RATIFIED_IDIOM}\` (12px phone / 24px desktop) per the ` +
        'owner ruling of 2026-08-05 (88-24 Task 1, option-a). `p-4 md:p-6` is 4px over the ' +
        'phone rung and bare `p-6` is double it.',
    ).toEqual([]);
  });
});
