/**
 * Cascade-order and focus-ring-home gate for Phase 88.6 (plans 05-06, UI-SPEC §12 A-2 / A-6).
 *
 * WHY THIS SUITE EXISTS
 * ---------------------
 * Two of this phase's load-bearing properties are SILENT when broken: nothing throws, nothing
 * fails to build, and no other suite reds.
 *
 *  1. SOURCE ORDER in `globals.css`. `.btn`, `.btn-sm` and `.btn-compact` all sit at specificity
 *     (0,1,0), so on any element carrying two of them the LATER rule wins. This repo has already
 *     shipped that regression twice (87.8 DEC-2 / DEC-3), and CI — not review — found the
 *     `.btn-compact` stepper deformation (e2e/touch-targets.spec.ts ("the steppers are square BY DESIGN"), dispatch run
 *     33137056149).
 *  2. THE FOCUS RING'S HOME. A CSS `outline` rule and a Tailwind `ring-*` box-shadow are
 *     different properties; neither suppresses the other. Ship both and two rings paint. Ship
 *     neither and every `.btn` in the app loses its keyboard indicator (WCAG 2.4.7, Level A).
 *
 * EVERY SCAN IN HERE IS COMMENT-STRIPPED, AND THAT IS NOT A DETAIL
 * ---------------------------------------------------------------
 * `globals.css`'s own marker prose contains the very selectors this file orders, and it contains
 * the literal `.btn:focus-visible` (in src/app/globals.css as read 2026-09-15) plus the house ring
 * string. A raw `indexOf` therefore reads a COMMENT and passes vacuously — and, for
 * the ring gate, reports the globals side TRUE under ARM A, redding a correct implementation.
 * `withoutComments` (src/test-utils/sourceScan.ts ("export function withoutComments(")) blanks comments while preserving every
 * offset, so line numbers in any failure message stay real. Assertion 1 is a negative control on
 * the stripper itself: a stripper that silently returned the whole file could not pass it.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  HOUSE_RING_TOKEN,
  UNPREFIXED_HALO_TOKEN,
  lineAt,
  sourceFiles,
  stringChunks,
  withoutComments,
} from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const GLOBALS = path.join(__dirname, 'globals.css');

const readGlobals = (): string => fs.readFileSync(GLOBALS, 'utf8');
const read = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const strip = (s: string): string => withoutComments(s);
const countOf = (haystack: string, needle: string): number =>
  haystack.split(needle).length - 1;

/* ==========================================================================================
   DECISION Phase 88.6-05 (A-2) — the focus ring's home, recorded as a CONSTANT so that
   switching arms is one line plus the rule/utilities, never a rewrite of this suite.

   ARM A is what shipped: the ring is expressed ONCE, in `Button.tsx`'s cva base, and NO global
   `.btn:focus-visible` rule is authored. Owner ruling 2026-09-15.

   ARM B — one global `.btn:focus-visible { outline: 2px solid var(--ring) }` rule with the cva
   utilities and the nine per-site strings deleted — is REJECTED. It would be a SECOND expression
   of one decision for every element that is already a `Button`, and an unlayered global rule
   cannot be overridden per call site the way `cn()`'s last-wins lets the cva base be.

   The arm is also recorded as the greppable token `A-2-ARM: A` in `88.6-05-SUMMARY.md`; plans 18,
   27, 31 and 32 branch on it.
   ========================================================================================== */
// The `as` is load-bearing, not decoration: with a plain annotation TypeScript narrows a `const`
// to its literal initializer and then reports every `A2_ARM === 'B'` branch below as TS2367
// "no overlap" — i.e. `npm run typecheck` would refuse to compile the arm this suite exists to be
// switchable to. Flipping this one character plus the rule/utilities IS the arm switch.
const A2_ARM = 'A' as 'A' | 'B';

/** The house ring: the two-tone focus-ring utility (owner pick O-1 = B, 2026-11-22; plan 89.6-12's utility). */
// AMENDED Phase 89.6-13: was the UI-SPEC §5.7 box-shadow string (ring-2 plus ring-focus-ring);
// owner pick O-1 = B replaced it with the utility. The arm logic below is unchanged.
const HOUSE_RING = 'focus-visible:focus-ring';
/** The full house string the `.btn` family wears (Button.tsx's one ring line). */
const HOUSE_RING_FULL = 'focus:outline-hidden focus-visible:focus-ring';
/** Any ring at all, the token the anti-deletion floor counts: a substring, so it also counts the inset utility. */
const ANY_RING = 'focus-visible:focus-ring';

/**
 * The CLOSED, ENUMERATED `.btn`-family ring holders — TEN of them, re-derived against the live
 * tree 2026-09-15.
 *
 * KEYED ON FILE PATH PLUS A LITERAL SUBSTRING. Never on a line number (plans 18, 27, 31 and 32
 * migrate these sites, so every number moves) and NEVER on a `btn` regex. A `btn` word-boundary
 * regex is wrong in two measured ways:
 *
 *   - it matches `rounded-btn`, which sweeps `Input.tsx`'s shared `controlClass` and
 *     `SelectField.tsx`'s `DEFAULT_SELECT_CLASS` into the set ARM B would have to EMPTY — i.e.
 *     straight into the mass WCAG 2.4.7 failure this gate exists to prevent. Assertion 5 pins
 *     that trap so the shortcut cannot be reintroduced as a "simplification";
 *   - four of the ten carry `btn` on a PRECEDING line (the three `groupHomePage/page.js` sites and
 *     `Button.tsx`, whose `'btn',` is a separate array element), so no per-line `btn` match finds
 *     them at all.
 *
 * `anchor` identifies the ELEMENT, not the ring: several of these files also hold NON-`.btn`
 * controls wearing the same house string (`CalendarMonthView.js` has a text link and two calendar
 * chips, `EventDayModal.js` a `rounded-sm` trigger, `FeedbackButton.js` a menu row,
 * `groupHomePage/page.js` a Home link), so a file-level count of the ring literal over-counts the
 * `.btn` family. `window` is how far past the anchor the ring may sit — these are multi-fragment
 * concatenated class strings, not single lines.
 */
type RingSite = { file: string; label: string; anchor: string; window: number };

const BTN_FAMILY_RING_SITES: RingSite[] = [
  {
    file: 'components/ui/Button.tsx',
    label: 'the `Button` cva base (the primitive side of the XOR)',
    anchor: "'btn',",
    // Deliberately wide. `withoutComments` BLANKS comments in place rather than deleting them
    // (so offsets and line numbers survive), which means the `DECISION Phase 88.6-05 (A-2)`
    // marker sitting between `'btn',` and the ring line still occupies its full width in the
    // stripped text. A window sized to the CODE alone would red on a correct tree the moment
    // anyone documents this base — which is exactly what this plan did.
    window: 3000,
  },
  {
    file: 'app/components/CalendarMonthView.js',
    label: 'month-view empty-state CTA (1 of 2)',
    anchor: 'btn btn-primary focus:outline-hidden',
    window: 120,
  },
  {
    file: 'app/components/CalendarMonthView.js',
    label: 'month-view empty-state CTA (2 of 2)',
    anchor: 'btn btn-primary focus:outline-hidden',
    window: 120,
  },
  {
    file: 'app/components/EventCalendar.js',
    label: 'calendar toolbar secondary action',
    anchor: 'btn btn-secondary text-sm focus:outline-hidden',
    window: 120,
  },
  {
    file: 'app/components/EventDayModal.js',
    label: 'day-modal Share-Game-QR accent action (plan 27 migrates it, wave 7)',
    anchor: 'mt-2 btn btn-accent font-semibold',
    window: 220,
  },
  {
    file: 'app/components/FeedbackButton.js',
    label: 'floating feedback FAB',
    anchor: 'btn btn-primary rounded-full shadow-lg',
    window: 200,
  },
  {
    file: 'app/gameDetail/page.js',
    label: 'gameDetail Share-Game-QR accent action (plan 18 migrates it, wave 7)',
    anchor: 'btn btn-accent font-semibold text-xs px-3 py-1.5',
    window: 240,
  },
  {
    file: 'app/groupHomePage/page.js',
    label: 'Manage Members',
    // RE-ANCHORED by plan 88.6-21 task 2 (wave 7, 2026-09-16), and the reason is specific to
    // THIS entry rather than general tidying. Every other entry here anchors on a class string
    // that DEPARTS when its site migrates, which is what makes "anchor absent => already
    // migrated => skip" the right rule. This one anchored on
    // `text-content-primary bg-white/80 ring-1 ring-line-control dark:ring-0 ` — the 88.3-16
    // owner-ruled wash and ring, which SURVIVES the migration by design (ruling 2 of
    // 2026-08-27, marker at src/app/groupHomePage/page.js ("DECISION Phase 88.3-16 (owner ruling 2, research-checked 2026-08-27)")). So after a CORRECT migration the
    // anchor was still found while the per-site ring was correctly gone, and assertion 4 red on
    // a tree that had done exactly what ARM A asks. Re-anchored onto the `.btn` class string the
    // migration really does delete. The entry STAYS in the list (the list is pinned at ten and
    // shrinking it is a decision); it is now inert, like every other migrated site's.
    anchor: 'btn px-4 py-2 md:px-6 md:py-3 font-semibold text-sm md:text-base whitespace-nowrap ',
    window: 320,
  },
  {
    file: 'app/groupHomePage/page.js',
    label: 'Plan Game Session',
    anchor: 'btn btn-primary px-4 py-2 md:px-6 md:py-3 font-semibold shadow-theme-lg hover:shadow-xl ',
    window: 320,
  },
  {
    file: 'app/groupHomePage/page.js',
    label: 'Create Event',
    anchor: "'rounded-btn transition-all shadow-theme-lg '",
    window: 320,
  },
];

/** Distinct files in the closed list — the exclusion set for the anti-deletion floor. */
const CLOSED_FILES = new Set(BTN_FAMILY_RING_SITES.map((s) => s.file));

/**
 * The anti-deletion floor, measured 2026-09-15 on the executor's OWN comment-stripped scan
 * (`node` over `sourceFiles('src')` + `withoutComments`, the same two helpers this suite imports):
 *
 *     tree-wide  : 262 `focus-visible:ring-` occurrences across 45 files
 *     outside the closed list: 208 occurrences across 38 files
 *
 * Correction to the plan's stated census, recorded here so the next reader does not inherit it:
 * the plan's "95 occurrences across 46 non-test files" is a count of LINES (`grep -rn … | wc -l`),
 * not occurrences — a single class string carries the token three times. The 46-vs-45 file gap is
 * `DangerZoneDeleteAccount.tsx`, whose only `focus-visible:ring-` is comment prose and therefore
 * correctly absent from a stripped scan.
 *
 * The floors are deliberately SLACK against those measurements. Phase 88.6 legitimately retires
 * per-site ring strings as sites migrate onto `Button`, so a tight floor would red on correct
 * later plans. What it must catch is the ARM B mistake SHAPE — a mass deletion of the ~200
 * occurrences that are each their own control's SOLE focus indicator. A drop to anywhere near
 * zero reds hard.
 */
// AMENDED Phase 89.6-13: after the ring codemod each control carries ONE utility token where it
// carried three or four box-shadow tokens, so the occurrence count fell by construction. The two
// floors are re-measured on the utility and held at 72% of the live count, the ratio the old floor
// sat at (150 of 208). Measured 2026-11-24 at the commit that ran the codemod:
//     outside the closed list: 116 occurrences across 50 files
// (floor(0.72 x 116) = 83, floor(0.72 x 50) = 36). Measured by setting each floor to 99999 for one run.
const RING_FLOOR_OCCURRENCES = 83;
const RING_FLOOR_FILES = 36;

/* ==========================================================================================
   CASCADE HELPERS — everything below operates on COMMENT-STRIPPED `globals.css`.
   ========================================================================================== */

/** The `[start, end)` half-open range of the `{ … }` block opening at `open`. */
function blockRange(src: string, open: number): { start: number; end: number } {
  const start = src.indexOf('{', open);
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1;
    else if (src[i] === '}') {
      depth -= 1;
      if (depth === 0) return { start, end: i + 1 };
    }
  }
  return { start, end: src.length };
}

/**
 * Every author `@layer <name> { … }` block, by NAME and byte range.
 *
 * Deliberately matches only the BLOCK form: `@layer theme, base, components, utilities;` (the
 * ORDER declaration Tailwind's own `index.css` ships) has no `{` and is not a containing block.
 */
function layerBlocks(css: string): { name: string; start: number; end: number }[] {
  const out: { name: string; start: number; end: number }[] = [];
  const re = /@layer\s+([A-Za-z0-9_-]+)\s*\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(css)) !== null) {
    const { start, end } = blockRange(css, m.index);
    out.push({ name: m[1], start, end });
  }
  return out;
}

/** The name of the innermost `@layer` containing `offset`, or `null` when it is unlayered. */
function layerAt(css: string, offset: number): string | null {
  const hit = layerBlocks(css)
    .filter((l) => offset > l.start && offset < l.end)
    .sort((a, b) => b.start - a.start)[0];
  return hit ? hit.name : null;
}

/**
 * Brace nesting depth at `offset`. A TOP-LEVEL rule is depth 0; a rule inside `@media`, `@layer`
 * or `@supports` is deeper. `layerAt` alone cannot tell those apart — `@media (width < 48rem) {
 * .btn { min-height: 2.75rem } }` is unlayered too, and it is a `.btn {` block.
 */
function depthAt(css: string, offset: number): number {
  let depth = 0;
  for (let i = 0; i < offset; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') depth -= 1;
  }
  return depth;
}

/** Every offset at which `needle` occurs. */
function offsetsOf(src: string, needle: string): number[] {
  const out: number[] = [];
  for (let i = src.indexOf(needle); i >= 0; i = src.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** Every app source file whose COMMENT-STRIPPED text still carries a ring. */
function strippedRingScan(): { file: string; count: number }[] {
  return sourceFiles(SRC)
    .map((abs) => ({
      file: path.relative(SRC, abs),
      count: countOf(strip(fs.readFileSync(abs, 'utf8')), ANY_RING),
    }))
    .filter((e) => e.count > 0);
}

describe('Phase 88.6 — the focus ring has exactly one home (UI-SPEC §12 A-2)', () => {
  it('1. the comment stripper is doing real work: offsets preserved, globals prose blanked', () => {
    const raw = readGlobals();
    const stripped = strip(raw);

    // Blanking, not deleting — every reported line number in this suite stays real.
    expect(
      stripped.length,
      '`withoutComments` must blank comments in place; a stripper that SHORTENS the text makes ' +
        'every line number this suite could report wrong.',
    ).toBe(raw.length);

    // NEGATIVE CONTROL on the stripper. `globals.css` carries `focus-visible` prose in its marker
    // blocks (8 raw occurrences as read 2026-09-15, incl. the literal `.btn:focus-visible`). If the
    // stripper silently returned the whole file, this comparison could not hold.
    const rawRing = countOf(raw, 'focus-visible');
    const strippedRing = countOf(stripped, 'focus-visible');
    expect(
      rawRing,
      'globals.css should still carry `focus-visible` COMMENT prose (the 88.3-18 marker block). ' +
        'If this is 0 the negative control below is vacuous and the marker was deleted.',
    ).toBeGreaterThan(0);
    expect(
      strippedRing,
      `The stripper left ${strippedRing} of ${rawRing} \`focus-visible\` occurrences in globals.css. ` +
        'Under ARM A every one of them is comment prose, so the stripped count must be 0 — a ' +
        'non-zero count here means either the stripper is a passthrough or a real rule was authored.',
    ).toBe(A2_ARM === 'B' ? 1 : 0);

    // The arm-specific SELECTOR control, stated separately so a failure names the right thing.
    const selectors = countOf(stripped, ':focus-visible');
    expect(
      selectors,
      `ARM ${A2_ARM}: comment-stripped globals.css must declare ` +
        `${A2_ARM === 'B' ? 'exactly ONE `.btn:focus-visible` rule' : 'ZERO `:focus-visible` selectors'}, ` +
        `found ${selectors}.`,
    ).toBe(A2_ARM === 'B' ? 1 : 0);
  });

  it('2. exactly ONE of the two ring MECHANISMS is present — both-present and both-absent each red', () => {
    const globalsSide = strip(readGlobals()).includes('.btn:focus-visible');
    const primitiveSide = strip(read('components/ui/Button.tsx')).includes(HOUSE_RING);

    const present = Number(globalsSide) + Number(primitiveSide);
    expect(
      present,
      `ARM ${A2_ARM}: exactly one ring mechanism must exist for the \`.btn\` family. ` +
        `globals.css \`.btn:focus-visible\` rule: ${globalsSide}; \`Button.tsx\` cva ring: ${primitiveSide}. ` +
        'BOTH present means a global outline rule beside the focus-ring utility: two mechanisms ' +
        'for one decision, and an unlayered global rule cannot be overridden per call site. BOTH ' +
        'absent is a mass WCAG 2.4.7 (Level A) failure across every `.btn` in the app.',
    ).toBe(1);
  });

  it('3. the arm actually taken is the one that is present (positive, per arm)', () => {
    const globals = strip(readGlobals());
    const button = strip(read('components/ui/Button.tsx'));

    if (A2_ARM === 'A') {
      expect(
        button.includes(HOUSE_RING_FULL),
        'ARM A: `Button.tsx`\'s cva base must literally carry the UI-SPEC §5.7 house ring string ' +
          `\`${HOUSE_RING_FULL}\`. Under ARM A this is the ONLY expression of the ring for the ` +
          '`.btn` family, so losing it is a mass keyboard-a11y regression with nothing else red.',
      ).toBe(true);
      expect(
        globals.includes('.btn:focus-visible'),
        'ARM A: no global `.btn:focus-visible` rule may be authored — it would be a SECOND ' +
          'expression of one decision for every element that is already a `Button`.',
      ).toBe(false);
    } else {
      expect(
        globals.includes('.btn:focus-visible'),
        'ARM B: exactly one global `.btn:focus-visible` rule must exist in globals.css.',
      ).toBe(true);
      expect(
        globals.includes('var(--ring)'),
        'ARM B: the rule must read `var(--ring)`, never `--color-focus-ring`. That shape is ' +
          'recorded REJECTED at src/app/Header.js ("Rejected — overriding") — `--ring: var(--color-focus-ring)` is declared ' +
          'on `:root` (src/app/globals.css ("--ring: var(--color-focus-ring);")) so its `var()` is substituted THERE, which makes a ' +
          '`--color-focus-ring` override INERT inside the two `[--ring:var(--amber-400)]` header ' +
          'subtrees, where the inherited root purple-700 measures 1.93:1 / 1.78:1 ' +
          '(src/app/globals.css ("SECOND FINDING, new here because nothing upstream had it")) — below WCAG 1.4.11\'s 3:1 floor.',
      ).toBe(true);
      expect(
        countOf(button, ANY_RING),
        'ARM B: `Button.tsx`\'s cva utilities must be DELETED in the same commit as the rule, or ' +
          'every `<Button>` paints two rings.',
      ).toBe(0);
      for (const site of BTN_FAMILY_RING_SITES.filter((s) => s.file !== 'components/ui/Button.tsx')) {
        const src = strip(read(site.file));
        const at = src.indexOf(site.anchor);
        if (at < 0) continue; // already migrated away — nothing to double up
        const slice = src.slice(at, at + site.anchor.length + site.window);
        expect(
          slice.includes(ANY_RING),
          `ARM B: the per-site ring at ${site.file} (${site.label}) must be deleted in the SAME ` +
            'commit as the global rule, or this element paints two rings.',
        ).toBe(false);
      }
    }
  });

  it('4. the closed list is TEN `.btn`-family holders, and under ARM A none of them is left ringless', () => {
    expect(
      BTN_FAMILY_RING_SITES.length,
      'The closed list is the ten `.btn`-family ring holders re-derived 2026-09-15. Growing or ' +
        'shrinking it is a decision (it changes what ARM B would have to empty), not a cleanup.',
    ).toBe(10);

    if (A2_ARM !== 'A') return;

    // Under ARM A the nine per-site strings are TRANSITIONAL: they delete as their sites migrate
    // onto `Button` in plans 18/27/31/32, so pinning them PRESENT would red on a correct later
    // plan. What must never happen is the half-migration — the legacy class string kept and the
    // ring dropped, which leaves a `.btn` element with no keyboard indicator at all and nothing
    // red. So the assertion is conditional: anchor present => ring present.
    for (const site of BTN_FAMILY_RING_SITES) {
      const src = strip(read(site.file));
      const at = src.indexOf(site.anchor);
      if (at < 0) continue; // migrated; the primitive supplies the ring
      const slice = src.slice(at, at + site.anchor.length + site.window);
      expect(
        slice.includes(HOUSE_RING),
        `ARM A: ${site.file} (${site.label}) still carries its legacy anchor \`${site.anchor}\` but ` +
          `no \`${HOUSE_RING}\` within ${site.window} chars of it. Either migrate the site to ` +
          '`<Button>` (which supplies the ring from the cva base) or keep the house string — ' +
          'dropping the ring while keeping the class string is a silent WCAG 2.4.7 failure.',
      ).toBe(true);
    }
  });

  it('5. the `rounded-btn` trap: a `btn` regex would sweep two non-`.btn` controls into the set', () => {
    // This assertion is documentation with teeth. If someone later "simplifies" the closed list
    // into a `/\bbtn\b/` scan, these two files enter the set — and under ARM B they would then be
    // EMPTIED, deleting the sole focus indicator from every Input, Textarea, SelectControl and
    // SelectField in the app.
    for (const trap of ['components/ui/Input.tsx', 'app/components/form/SelectField.tsx']) {
      const src = strip(read(trap));
      expect(
        src.includes('rounded-btn'),
        `${trap} is expected to carry \`rounded-btn\` — it is what makes a \`\\bbtn\\b\` regex ` +
          'match a control that is not in the `.btn` family.',
      ).toBe(true);
      expect(
        src.includes(HOUSE_RING),
        `${trap} is expected to carry the house ring as its OWN sole focus indicator.`,
      ).toBe(true);
      expect(
        CLOSED_FILES.has(trap),
        `${trap} must NOT be in the closed \`.btn\`-family list — it is a \`rounded-btn\` false ` +
          'positive, not a `.btn` element.',
      ).toBe(false);
    }
  });

  it('6. anti-deletion floor: the ~200 non-`.btn` rings outside the closed list are not swept away', () => {
    const scan = strippedRingScan();
    const outside = scan.filter((e) => !CLOSED_FILES.has(e.file));
    const occurrences = outside.reduce((n, e) => n + e.count, 0);

    expect(
      occurrences,
      `Only ${occurrences} \`${ANY_RING}\` occurrences remain OUTSIDE the closed ` +
        `\`.btn\`-family list (floor ${RING_FLOOR_OCCURRENCES}, 72% of the count measured at the codemod). ` +
        'Each utility is its own control\'s SOLE focus indicator: an Input, a Tab, a Switch, a KebabMenu trigger. ' +
        'A drop to near zero is the ARM B mistake shape: emptying a `btn`-regex-derived set ' +
        'instead of the enumerated ten.',
    ).toBeGreaterThanOrEqual(RING_FLOOR_OCCURRENCES);

    expect(
      outside.length,
      `Only ${outside.length} files outside the closed list still carry the utility (floor ` +
        `${RING_FLOOR_FILES}). See the occurrence floor above for why this is a floor and not an equality.`,
    ).toBeGreaterThanOrEqual(RING_FLOOR_FILES);
  });
});

describe('Phase 88.6 — `globals.css` cascade order and layering (W19 / D-09 A-6 / D10)', () => {
  /**
   * The `.btn` rule that carries the 44px floor, located by its CONTENT: the `.btn {` block at the
   * start of a line, holding `min-height: 2.75rem;` before its closing brace. Pinning the content
   * means this anchor reds if the floor is ever moved or renamed, instead of silently re-anchoring
   * onto another rule and passing.
   * AMENDED Phase 89.6-06 (CI-04, owner pick DT-1 = 44, 2026-11-23): this anchor was PHONE_FLOOR,
   * the `@media (width < 48rem)` block that held the D-36 phone-only floor. The floor now applies at
   * every width and lives in the `.btn` rule itself, so the anchor follows it.
   */
  const BTN_FLOOR = /^\.btn\s*\{[^}]*min-height:\s*2\.75rem;[^}]*\}/m;

  it('7. the ruled source order holds in BOTH directions, on comment-stripped source', () => {
    const css = strip(readGlobals());

    const floor = css.match(BTN_FLOOR);
    expect(
      floor,
      'The .btn floor (min-height 2.75rem in the .btn block, every width, 89.6-06 CI-04) was not ' +
        'found in comment-stripped globals.css. Every ordering assertion below is anchored on it, ' +
        'so this reds FIRST rather than letting them re-anchor somewhere meaningless.',
    ).not.toBeNull();
    const floorAt = floor!.index as number;

    const smAt = css.indexOf('.btn-sm {');
    expect(smAt, '`.btn-sm {` must exist in comment-stripped globals.css.').toBeGreaterThan(-1);

    expect(
      smAt,
      '`.btn-sm` must be authored AFTER the `.btn` rule that holds the floor.',
    ).toBeGreaterThan(floorAt);

    // AMENDED Phase 88.9-52 (R4 C2, owner 2026-11-18): the second direction this test pinned
    // (.btn-sm BEFORE .btn-compact, owner ruling 2026-09-09 AC-9, written after CI found the
    // stepper deformation at e2e/touch-targets.spec.ts ("the steppers are square BY DESIGN"),
    // dispatch run 33137056149) has no second rule left to order against: the .btn-compact
    // opt-out is RETIRED with its only two wearers, the BrowseMoreModal steppers, now 44x44
    // squares. What is pinned instead is that the rule stays gone: a .btn-compact rule that
    // came back would silently take the phone floor off whatever wore it.
    expect(
      css.indexOf('.btn-compact'),
      'A `.btn-compact` rule is back in comment-stripped globals.css. The opt-out from the phone ' +
        'floor was retired by 88.9-52 R4 C2 (owner 2026-11-18): the two steppers that wore it are ' +
        '44x44 squares now. Re-adding a sub-44 opt-out is a decision, not a cleanup.',
    ).toBe(-1);
  });

  it('8. `.btn-sm` and `.btn-fuse-bottom` sit outside every `@layer` — they must beat utilities (`.btn-compact` retired, 88.9-52 R4 C2)', () => {
    const css = strip(readGlobals());
    for (const sel of ['.btn-sm {']) {
      const at = css.indexOf(sel);
      expect(at, `\`${sel}\` must exist in comment-stripped globals.css.`).toBeGreaterThan(-1);
      const layer = layerAt(css, at);
      expect(
        layer,
        `\`${sel}\` is inside \`@layer ${layer}\`. Both rules must stay UNLAYERED: an unlayered ` +
          'author rule beats every `@layer utilities` rule regardless of specificity, which is what ' +
          'makes the opt-out work at all. Layering either re-breaks it with no build error — the ' +
          'exact cascade defect 87.8 DEC-2/DEC-3 hit twice on this same pair.',
      ).toBeNull();
    }

    // 88.9-36 G2a: the phone-only attached-disclosure modifier must stay unlayered, after
    // .btn-sm (AMENDED 88.9-52 R4 C2: this read .btn-compact, retired; .btn-sm is the last
    // (0,1,0) .btn-family rule before it), inside the 40rem media block, or the unlayered .btn border-radius wins and the
    // open Show Filters & Sort toggle keeps its rounded bottom corners with no build error. The
    // index is asserted first: an absent selector would make the layer check pass vacuously.
    const fuseAt = css.indexOf('.btn-fuse-bottom {');
    expect(fuseAt, '`.btn-fuse-bottom {` must exist in comment-stripped globals.css.').toBeGreaterThan(-1);
    expect(
      fuseAt,
      '`.btn-fuse-bottom` must be authored AFTER `.btn-sm` (and so after `.btn`): both are ' +
        '(0,1,0), so it wins the border-radius tie only on source order.',
    ).toBeGreaterThan(css.indexOf('.btn-sm {'));
    expect(layerAt(css, fuseAt), '`.btn-fuse-bottom` must stay UNLAYERED.').toBeNull();
    expect(depthAt(css, fuseAt), '`.btn-fuse-bottom` must sit directly inside ONE block (its media query).').toBe(1);
    const mediaAt = css.lastIndexOf('@media', fuseAt);
    expect(
      css.slice(mediaAt, fuseAt).startsWith('@media (width < 40rem)'),
      'the block holding `.btn-fuse-bottom` must be `@media (width < 40rem)` (Tailwind sm, phone only).',
    ).toBe(true);
    const body = css.slice(fuseAt, css.indexOf('}', fuseAt));
    expect(body).toMatch(/border-bottom-left-radius:\s*0;/);
    expect(body).toMatch(/border-bottom-right-radius:\s*0;/);
  });

  it('9. ANTI-VACUITY FLOOR: the unlayered `.btn` block still carries its own geometry', () => {
    // If a future edit ever layers `.btn` itself, assertions 7 and 8 become meaningless — the
    // whole ordering question only matters between unlayered rules. This reds first, and names why.
    const css = strip(readGlobals());
    const unlayered = offsetsOf(css, '.btn {').filter(
      (at) => layerAt(css, at) === null && depthAt(css, at) === 0
    );
    expect(
      unlayered.length,
      'Exactly ONE unlayered `.btn {` block must exist. Zero means the class was layered (D-30 ' +
        'forbids it: every size/padding/font utility on every `.btn` element would come alive at ' +
        'once). More than one means the block was split and the ordering pins above are ambiguous.',
    ).toBe(1);

    const { start, end } = blockRange(css, unlayered[0]);
    const body = css.slice(start, end);
    for (const decl of [
      'display:',
      'gap:',
      'border-radius:',
      'font-weight:',
      'font-size:',
      'padding:',
      'transition:',
      'cursor:',
    ]) {
      expect(
        body.includes(decl),
        `The unlayered \`.btn\` block no longer declares \`${decl}\`. W19 moves exactly ONE ` +
          'declaration (`border: none`) into `@layer components`; everything else stays here, ' +
          'byte-identical to its shipped value.',
      ).toBe(true);
    }
  });

  it('10. W19: the `border: none` reset is in `@layer components`, by NAME', () => {
    const css = strip(readGlobals());

    // It must NOT be back in the unlayered block.
    const unlayered = offsetsOf(css, '.btn {').filter(
      (at) => layerAt(css, at) === null && depthAt(css, at) === 0
    );
    const { start, end } = blockRange(css, unlayered[0]);
    expect(
      css.slice(start, end).includes('border:'),
      'The unlayered `.btn` block declares a `border` again. W19 moved that reset into ' +
        '`@layer components` precisely so an `@layer utilities` `border-*` utility can beat it; ' +
        'an unlayered reset beats every utility regardless of specificity and the two gameDetail ' +
        'row actions plan 18 migrates (src/app/gameDetail/page.js ("This control and the two-tap Remove below are the only")) lose their ' +
        'visible 1px border with nothing red.',
    ).toBe(false);

    // It must be in a layer, and the NAME is the load-bearing half.
    const layered = offsetsOf(css, '.btn {').filter((at) => layerAt(css, at) !== null);
    const resets = layered.filter((at) => {
      const r = blockRange(css, at);
      return css.slice(r.start, r.end).includes('border:');
    });
    expect(
      resets.length,
      'Exactly one LAYERED `.btn { border: … }` reset must exist (W19).',
    ).toBe(1);

    const name = layerAt(css, resets[0]);
    expect(
      name,
      `The \`.btn\` border reset is in \`@layer ${name}\`. It must be \`components\`. The layer ` +
        "ORDER is declared by `@import 'tailwindcss' source(none)` at " + 'src/app/globals.css ("source(none);"), which ' +
        'pulls in upstream\'s `@layer theme, base, components, utilities;` (line 1 of ' +
        '`node_modules/tailwindcss/index.css`) — only a layer that PRECEDES `utilities` loses to a ' +
        '`border-*` utility. Dropping this reset into the pre-existing `@layer utilities` block in ' +
        'this file would put it in the SAME layer as those utilities and LATER in source order, ' +
        'defeating W19 with nothing red anywhere. That is why this pins the NAME and not merely ' +
        '"inside an `@layer`".',
    ).toBe('components');
  });

  it('11. D10: the `enabled-hover` variant excludes ARIA-disabled, native-disabled AND no-hover pointers', () => {
    const css = strip(readGlobals());
    const at = css.indexOf('@custom-variant enabled-hover');
    expect(
      at,
      '`@custom-variant enabled-hover` must be declared in globals.css beside the shipped `dark` ' +
        'variant. Plan 06 (wave 4) bakes it into the `Button` cva base, so every gated control in ' +
        'the phase inherits whatever this one declaration says.',
    ).toBeGreaterThan(-1);
    const { start, end } = blockRange(css, at);
    const body = css.slice(start, end);

    // THREE SEPARATE assertions on purpose. A variant that drops exactly one of these compiles
    // clean and is indistinguishable from a correct one until a gated control visibly lifts under
    // the pointer — so `npm run build` proves only that the variant is well-FORMED, never that it
    // is right. The four shipped rules this reproduces were re-read 2026-09-15.
    const REPRODUCES =
      'It reproduces the gating the four shipped rules already perform: ' +
      "`.btn-primary:hover:not(:disabled):not([aria-disabled='true'])` and its `.btn-accent`, " +
      '`.btn-secondary` and `.btn-danger` twins (src/app/globals.css as read ' +
      '2026-09-15). Dropping a clause here silently re-introduces a hover lift on gated controls — ' +
      'the exact state the DR-C marker block removed.';

    expect(
      /:not\(\[aria-disabled/.test(body),
      `\`enabled-hover\` must negate the ARIA disabled state. ${REPRODUCES}`,
    ).toBe(true);
    expect(
      /:not\(:disabled\)/.test(body),
      `\`enabled-hover\` must negate the NATIVE disabled state. ${REPRODUCES}`,
    ).toBe(true);
    expect(
      /@media\s*\(\s*hover:\s*hover\s*\)/.test(body),
      `\`enabled-hover\` must be scoped to hover-capable pointers. ${REPRODUCES}`,
    ).toBe(true);
  });
});

// Phase 89.6 one ring (owner pick O-1 = B, 2026-11-22: "Two-colour ring, 2px: a thin inner band
// plus a darker outer ring; passes all 96").
//
// WHAT TEST 12 PINS: no comment-stripped string chunk in src draws a box-shadow focus ring or a
// halo. Any token whose variant chain ends with focus-visible: (peer- and group- leads, and any
// variants before them, included) followed by ring or ring-<anything> is the old ring family:
// ring-2, ring-inset, ring-offset-*, ring-focus-ring, ring-ring. An unprefixed
// ring-offset-<colour> paints at rest and is gone too. Every keyboard ring is the two-tone
// utility (focus-visible:focus-ring, focus-visible:focus-ring-inset or
// peer-focus-visible:focus-ring), and a population floor of utility chunks keeps the read from
// passing on an empty tree. Tokens are judged WHOLE, never as substrings.
//
// WHAT IT CANNOT JUDGE: where the ring lands. Clipping by an ancestor, the ring's geometry and
// its radius are plan 89.6-31's measurements; the colours are the C40 pins in tokenContrast and
// focusRingUtility's compile reads.
//
// AMENDED Phase 89.6-13: the 88.9 halo contract (owner option (a)) is retired by owner pick
// O-1 = B, 2026-11-22; the two-tone ring needs no per-ground halo. Its census test
// (haloCensus.test.ts) and baseline (scripts/baselines/button-halos.json) were deleted in the same
// commit, and the shared halo reads went with them.
// AMENDED Phase 89.6-38 (host-ground): the hostGround.ts allowance is removed with the file; test 12
// judges every src file.
//
// Test helpers hold the old tokens as DATA (the reject list in src/test-utils/focusRingAssert.ts),
// so the helper directory is outside the read. sourceFiles already skips it centrally (DECISION
// Phase 88.6-44 (T-88.6-124) in src/test-utils/sourceScan.ts); the constant names the same
// exclusion the ring codemod (scripts/ring-codemod.mjs) makes, so the two reads cannot drift.
const TEST_HELPER_DIR = 'test-utils';
// An unprefixed ring-offset-<colour> allowed only here: a tutorial demo highlight, not a ring.
const HALO_EXCEPTIONS = new Set([path.join('app', 'components', 'tutorial', 'simulated', 'ScheduleDemo.js')]);
// POPULATION FLOOR, 72% of the utility chunks measured 2026-11-24 at the commit that ran the
// codemod: 137 chunks (floor(0.72 x 137) = 98), read by setting this floor to 99999 for one run.
const ONE_RING_POPULATION_FLOOR = 98;
/** A whole token in the old box-shadow ring family on a focus-visible chain. */
const OLD_RING_FAMILY = /(?:^|:)(?:peer-|group-)?focus-visible:ring(?:-\S*)?$/;

/** The offences one chunk's tokens carry under the one-ring rule. */
function oneRingOffences(tokens: string[], haloExempt: boolean): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (OLD_RING_FAMILY.test(t)) out.push(`old ring token ${t}`);
    else if (!haloExempt && UNPREFIXED_HALO_TOKEN.test(t)) out.push(`unprefixed halo ${t}`);
  }
  return out;
}

describe('Phase 89.6 — one keyboard ring (owner pick O-1 = B)', () => {
  it('12. 89.6 one ring (O-1 B): no box-shadow focus ring and no halo remains in src; every ring is the two-tone utility', () => {
    // Negative controls: a planted old ring and a planted halo are each flagged, and the utility is not.
    expect(oneRingOffences(['p-2', 'focus-visible:ring-2'], false)).toEqual(['old ring token focus-visible:ring-2']);
    expect(oneRingOffences(['x', 'focus-visible:ring-offset-surface-card'], false)).toEqual([
      'old ring token focus-visible:ring-offset-surface-card',
    ]);
    expect(oneRingOffences(['md:peer-focus-visible:ring-inset'], false)).toHaveLength(1);
    expect(oneRingOffences(['focus-visible:focus-ring', 'focus-visible:focus-ring-inset'], false)).toEqual([]);
    expect(HOUSE_RING_TOKEN.test('peer-focus-visible:focus-ring')).toBe(true);
    expect(HOUSE_RING_TOKEN.test('focus-visible:ring-focus-ring')).toBe(false);

    let population = 0;
    const offenders: string[] = [];
    for (const abs of sourceFiles(SRC)) {
      const rel = path.relative(SRC, abs);
      if (rel.split(path.sep)[0] === TEST_HELPER_DIR) continue;
      const src = fs.readFileSync(abs, 'utf8');
      for (const c of stringChunks(src)) {
        const tokens = c.text.split(/\s+/).filter(Boolean);
        for (const o of oneRingOffences(tokens, HALO_EXCEPTIONS.has(rel))) {
          offenders.push(`${rel}:${lineAt(src, c.offset)} ${o}`);
        }
        if (tokens.some((tok) => HOUSE_RING_TOKEN.test(tok))) population += 1;
      }
    }

    expect(
      offenders,
      'A box-shadow focus ring or a halo is back in src. Every keyboard ring is the two-tone ' +
        'utility (see the comment above this test); run node scripts/ring-codemod.mjs --write:\n' +
        offenders.join('\n'),
    ).toEqual([]);
    expect(
      population,
      `Only ${population} chunks carry the focus-ring utility (floor ${ONE_RING_POPULATION_FLOOR}). A ` +
        'drop means controls lost their only keyboard indicator, or the read stopped seeing rings.',
    ).toBeGreaterThanOrEqual(ONE_RING_POPULATION_FLOOR);
  });
});

// DECISION Phase 88.9-58 (X20, owner at N09, 2026-11-11: yes hide it): the page floor is the one
// main element, focused only by script when the control that held focus has left the page
// (src/components/ui/focusPageFloor.ts ("a look question for Phase 88.9, not this module's")). It is never a Tab stop,
// so the browser outline it drew after keyboard use framed the whole page and pointed at nothing a
// key can operate. The outline is hidden ON THE ELEMENT, with the house focus:outline-hidden,
// chosen OVER a rule in globals.css: a global reset would be the first focus selector in that file
// (the ARM A pin above holds it at zero) and would reach heading floors, which keep their ring.
// outline-hidden over outline none, because the hidden form keeps an outline in forced-colors.
// If main ever becomes a Tab stop, this pin and the utility must go together.
describe('Phase 88.9 — the page floor shows no browser outline (X20)', () => {
  it('13. X20 (88.9): the page floor main hides the browser outline with the house focus:outline-hidden, is never a Tab stop, and globals.css still declares no focus-visible selector', () => {
    const mains: string[] = [];
    for (const file of sourceFiles(SRC)) {
      const text = strip(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/<main\b[^>]*>/g)) mains.push(`${path.relative(SRC, file)} ${m[0]}`);
    }
    expect(mains.length, `the page floor is the ONE main element in src; found:\n${mains.join('\n')}`).toBe(1);
    const [only] = mains;
    expect(only.startsWith('app/layout.js '), `the one main element must be the root layout's; found ${only}`).toBe(true);

    const className = /className="([^"]*)"/.exec(only);
    expect(className, 'the main element must carry a literal className').not.toBeNull();
    const tokens = (className as RegExpExecArray)[1].split(/\s+/).filter(Boolean);
    expect(
      tokens,
      'X20 (88.9) — main must hide the browser outline with the house focus:outline-hidden. It takes focus only by script ' +
        '(the page floor) and is never a Tab stop, so the outline framed the whole page (owner 2026-11-11: yes hide it).',
    ).toContain('focus:outline-hidden');
    expect(tokens, 'X20 (88.9) — outline-hidden, never outline-none: the hidden form keeps an outline in forced-colors').not.toContain('focus:outline-none');
    expect(tokens, 'main keeps its layout class').toContain('flex-1');
    expect(
      /tabindex/i.test(only),
      'X20 (88.9) — main must never author a tabindex: as a Tab stop it would need a visible focus indicator (WCAG 2.4.7), and this pin would be hiding it.',
    ).toBe(false);

    const globals = strip(readGlobals());
    expect(
      countOf(globals, ':focus-visible'),
      'ARM A re-asserted: globals.css declares no focus-visible selector. The page-floor outline is hidden on the element, never by a global rule.',
    ).toBe(0);
  });
});
