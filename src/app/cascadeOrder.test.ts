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
 *     `.btn-compact` stepper deformation (`e2e/touch-targets.spec.ts:428`, dispatch run
 *     33137056149).
 *  2. THE FOCUS RING'S HOME. A CSS `outline` rule and a Tailwind `ring-*` box-shadow are
 *     different properties; neither suppresses the other. Ship both and two rings paint. Ship
 *     neither and every `.btn` in the app loses its keyboard indicator (WCAG 2.4.7, Level A).
 *
 * EVERY SCAN IN HERE IS COMMENT-STRIPPED, AND THAT IS NOT A DETAIL
 * ---------------------------------------------------------------
 * `globals.css`'s own marker prose contains the very selectors this file orders, and it contains
 * the literal `.btn:focus-visible` (at `globals.css:2257` as read 2026-09-15) plus the house ring
 * string (`:2262-2263`). A raw `indexOf` therefore reads a COMMENT and passes vacuously — and, for
 * the ring gate, reports the globals side TRUE under ARM A, redding a correct implementation.
 * `withoutComments` (`src/test-utils/sourceScan.ts:146`) blanks comments while preserving every
 * offset, so line numbers in any failure message stay real. Assertion 1 is a negative control on
 * the stripper itself: a stripper that silently returned the whole file could not pass it.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, withoutComments } from '../test-utils/sourceScan';

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

/** The house ring, verbatim from UI-SPEC §5.7 (itself verbatim from `88-UI-SPEC.md` §7.2). */
const HOUSE_RING = 'focus-visible:ring-2 focus-visible:ring-focus-ring';
/** The full house string, including the offset the `.btn` family wears. */
const HOUSE_RING_FULL =
  'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';
/** Any ring at all — the token the anti-deletion floor counts. */
const ANY_RING = 'focus-visible:ring-';

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
    anchor: 'text-content-primary bg-white/80 ring-1 ring-line-control dark:ring-0 ',
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
const RING_FLOOR_OCCURRENCES = 150;
const RING_FLOOR_FILES = 30;

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
        'BOTH present paints two independent rings (a CSS `outline` and a Tailwind `ring-*` ' +
        'box-shadow are different properties and neither suppresses the other). BOTH absent is a ' +
        'mass WCAG 2.4.7 (Level A) failure across every `.btn` in the app.',
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
          'recorded REJECTED at `Header.js:99-110` — `--ring: var(--color-focus-ring)` is declared ' +
          'on `:root` (globals.css:1824) so its `var()` is substituted THERE, which makes a ' +
          '`--color-focus-ring` override INERT inside the two `[--ring:var(--amber-400)]` header ' +
          'subtrees, where the inherited root purple-700 measures 1.93:1 / 1.78:1 ' +
          '(globals.css:1586-1587) — below WCAG 1.4.11\'s 3:1 floor.',
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
      `Only ${occurrences} \`focus-visible:ring-\` occurrences remain OUTSIDE the closed ` +
        `\`.btn\`-family list (measured 208 across 38 files on 2026-09-15). Each of these is its ` +
        'own control\'s SOLE focus indicator — an Input, a Tab, a Switch, a KebabMenu trigger. ' +
        'A drop to near zero is the ARM B mistake shape: emptying a `btn`-regex-derived set ' +
        'instead of the enumerated ten.',
    ).toBeGreaterThanOrEqual(RING_FLOOR_OCCURRENCES);

    expect(
      outside.length,
      `Only ${outside.length} files outside the closed list still carry a ring (measured 38 on ` +
        '2026-09-15). See the occurrence floor above for why this is a floor and not an equality.',
    ).toBeGreaterThanOrEqual(RING_FLOOR_FILES);
  });
});

describe('Phase 88.6 — `globals.css` cascade order and layering (W19 / D-09 A-6 / D10)', () => {
  /**
   * The `@media (width < 48rem)` block that carries the D-36 phone floor, located by its CONTENT
   * rather than by "the first `@media (width < 48rem)`" — three such blocks exist in this file and
   * the other two are the `.surface-flat-phone` flatten inside `@layer utilities`. Pinning the
   * content also means this anchor reds if the floor rule itself is ever moved or renamed, instead
   * of silently re-anchoring onto an unrelated media query and passing.
   */
  const PHONE_FLOOR = /@media \(width < 48rem\)\s*\{\s*\.btn\s*\{\s*min-height:\s*2\.75rem;/;

  it('7. the ruled source order holds in BOTH directions, on comment-stripped source', () => {
    const css = strip(readGlobals());

    const floor = css.match(PHONE_FLOOR);
    expect(
      floor,
      'The D-36 phone floor `@media (width < 48rem) { .btn { min-height: 2.75rem } }` was not ' +
        'found in comment-stripped globals.css. Every ordering assertion below is anchored on it, ' +
        'so this reds FIRST rather than letting them re-anchor somewhere meaningless.',
    ).not.toBeNull();
    const floorAt = floor!.index as number;

    const smAt = css.indexOf('.btn-sm {');
    const compactAt = css.indexOf('.btn-compact {');
    expect(smAt, '`.btn-sm {` must exist in comment-stripped globals.css.').toBeGreaterThan(-1);
    expect(compactAt, '`.btn-compact {` must exist in comment-stripped globals.css.').toBeGreaterThan(-1);

    expect(
      smAt,
      '`.btn-sm` must be authored AFTER the `@media (width < 48rem)` phone-floor block.',
    ).toBeGreaterThan(floorAt);
    expect(
      compactAt,
      '`.btn-compact` must be authored AFTER the `@media (width < 48rem)` phone-floor block — ' +
        'that is how it wins the tie and keeps its `min-height: 0` opt-out (D-36).',
    ).toBeGreaterThan(floorAt);

    // The ruled direction. There is ONE order; it is not conditional.
    expect(
      compactAt,
      'OWNER RULING 2026-09-09 (AC-9): `.btn-sm` sits BEFORE `.btn-compact`. Both are (0,1,0), so ' +
        'on an element carrying both, LATER source order wins — an after-positioned `.btn-sm` puts ' +
        'back the 8px horizontal padding that `DECISION Phase 88.3-17` removed after CI found the ' +
        'BrowseMoreModal stepper deformation (`e2e/touch-targets.spec.ts:871`, the squareness ' +
        'assertion, re-derived 2026-09-15 — the shipped 88.3-17 marker still cites the stale ' +
        '`:428`; dispatch run ' +
        '33137056149). Flipping this pin is a decision, not a cleanup.',
    ).toBeGreaterThan(smAt);
  });

  it('8. neither `.btn-sm` nor `.btn-compact` is inside an `@layer` — they must beat utilities', () => {
    const css = strip(readGlobals());
    for (const sel of ['.btn-sm {', '.btn-compact {']) {
      const at = css.indexOf(sel);
      const layer = layerAt(css, at);
      expect(
        layer,
        `\`${sel}\` is inside \`@layer ${layer}\`. Both rules must stay UNLAYERED: an unlayered ` +
          'author rule beats every `@layer utilities` rule regardless of specificity, which is what ' +
          'makes the opt-out work at all. Layering either re-breaks it with no build error — the ' +
          'exact cascade defect 87.8 DEC-2/DEC-3 hit twice on this same pair.',
      ).toBeNull();
    }
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
        'row actions plan 18 migrates (`gameDetail/page.js:198-206`, `:1979-1983`) lose their ' +
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
        "ORDER is declared by `@import 'tailwindcss' source(none)` at `globals.css:10`, which " +
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
      '`.btn-secondary` and `.btn-danger` twins (globals.css:2227, :2298, :2448, :2458 as read ' +
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
