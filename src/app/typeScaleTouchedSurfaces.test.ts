/**
 * Req 2 / CD-006 (DES-02): the heading type scale on the four surfaces plan 88-24
 * touched — gameDetail, groupHomePage, userProfile, friends.
 *
 * UI-SPEC §4.1 fixes a 4-size working set (14/16/20/30) and §4.2 states TWO weights,
 * 400 body and 700 headings, with 600 as a PROHIBITION rather than a preference —
 * D-01 gives 600 exactly one home, the `Button` primitive. So a heading here must
 * carry an explicit in-set size and `font-bold`, and may never carry `font-semibold`.
 *
 * WHY A SOURCE SCAN
 * -----------------
 * Copied deliberately from the pin 88-19 wrote for userProfile
 * (`userProfile/page.test.tsx` → `describe('userProfile type scale (Req 2)')`), for
 * its stated reason: several of these headings live behind a tab, a role gate, a
 * fetch state or a toggle, and a pin that only sees the mounted half goes green
 * while the other half drifts. `groupHomePage/page.js` additionally has no page-level
 * suite at all, so a render pin could not reach it without inventing one.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP
 * -----------------------------------
 * 88-24's Task 3 verify gate is
 *     ! grep -nE "text-(lg|xl|2xl|3xl)[^"]*font-semibold" <the four files>
 * and it caught 1 of 3 real violation shapes when probed against a fixture:
 *   - MISSES `className="font-semibold text-lg"` — it requires the size to be written
 *     BEFORE the weight, and nothing enforces that order;
 *   - MISSES `className="text-2xl font-bold"` — a size outside the working set with a
 *     correct weight is invisible to a pattern that only looks for the size+600 PAIR.
 *     This is not hypothetical: the gate reported GATE-OK on this tree while
 *     gameDetail's Reviews h2 stood at `text-2xl` — which was, at the time, a ratified
 *     exemption (DEF-88-24-02). The owner converged that heading on 2026-08-05, so
 *     there is no longer any exemption on these four surfaces; the grep's blindness to
 *     the shape is unchanged, which is why this file still does not use it.
 * The scanner here reads whole heading tags, checks size and weight independently,
 * and is order-insensitive.
 *
 * WHY BODY TEXT IS NOT ASSERTED
 * -----------------------------
 * `text-sm` has ~461 occurrences across `src/app`, and a blanket 14 -> 16 body change
 * is a re-theme, which the SPEC forbids. That residue is Req 8's census (Phase 90/92).
 * This file is headings only, on four files only.
 *
 * AMENDED Phase 88-29 (DEF-88-19-03) — everything above is KEPT AS 88-24'S CHARTER and is
 * still accurate for the four pages. One FIFTH surface joined the list:
 * `components/ui/ErrorFallback.tsx`, a primitive this phase created and fanned out to nine
 * error boundaries, whose `<h1>` shipped at `text-xl font-semibold`. 88-29 arms the phase's
 * drift gates, and a type gate that reported clean over a §4.2 violation inside the phase's
 * own primitive is the vacuous-gate shape the whole plan exists to stop. The 30/700 Display
 * assertion is scoped to `PAGE_SURFACES` for that reason — see the amendment on it.
 *
 * "Headings only" still holds. The 57-heading / 35-file residual census (DEF-88-24-03)
 * remains 88-31's; this is one file, added because 88-29 fixed it.
 *
 * ============================================================================
 * AMENDED Phase 88.6-11 — WIDENED FROM FIVE SURFACES TO ALL OF `src/`
 * ============================================================================
 * Everything above is KEPT as the 88-24 / 88-29 charter and is still accurate. What
 * changed: this suite is the gate that measures the largest sweep in Phase 88.6 (135 raw
 * headings across 43 files), and at five surfaces it could not see the tree it was about
 * to measure. Four scanner defects were fixed in the same pass, because each of them
 * moves the count and fixing them one at a time produces an intermediate state where a
 * number is wrong for two reasons at once:
 *
 *  1. COMMENTS WERE COUNTED. `headings()` read raw source. `not-found.tsx:22,25,26` and
 *     `userProfile/page.js:1434,1439` carry heading tags inside prose. Now read through
 *     `withoutComments` (`src/test-utils/sourceScan.ts`).
 *  2. ARBITRARY VALUES WERE INVISIBLE. Neither size regex had a `text-[…]` clause, so
 *     `grouplist.js:455`'s `text-[1.1rem]` and the sub-12px fold's 30 sites read as
 *     "no size utility at all" or as nothing.
 *  3. PROP-RENDERED LEVELS WERE INVISIBLE. A heading level passed as a prop
 *     (`headingLevel="h5"`) renders a real `<h5>` no source scan for `<hN>` can see —
 *     and once Phase 88.6 migrates ~135 headings onto the `<Heading>` primitive there
 *     are no raw tags left, so P4's before==after level pin would be trivially true and
 *     would pass over a real level change.
 *  4. CLASS-LESS HEADINGS WERE SKIPPED. `HEADING_RE` required `className=`.
 *     `global-error.tsx:66` is a class-less `<h1>` — a PERMANENT roster entry, not a
 *     blind spot.
 *
 * Defects 1 and 4 are COUPLED: dropping the `className=` guard is what makes a bare
 * heading tag in prose match, so comment stripping is what keeps the raw census at 135
 * rather than 151. Fixing either alone produces a wrong number.
 *
 * THE KEY SPACE — ONE, canonical, and load-bearing
 * ------------------------------------------------
 * Every scanned file, `PAGE_SURFACES`, `REVIEWS_HEADING` and every exemption roster key
 * is a `src/`-relative POSIX path (`app/gameDetail/page.js`,
 * `components/ui/ErrorFallback.tsx`). Before this widening the scanner keyed headings by
 * an APP-relative surface string and both predicates compared against it. Widening the
 * enumeration to a different key space without converting them would silently empty
 * both — the Display filter would match nothing and its assertion would pass over zero
 * subjects. The `src/`-relative form is also the form `ExemptionRoster` documents
 * (`src/test-utils/exemption.ts:83-87`), so rosters and scanner results join directly.
 *
 * BUILD ONCE (AC-11, owner ruling 2026-09-09)
 * -------------------------------------------
 * The tree is enumerated, read and comment-stripped EXACTLY ONCE at module scope, and
 * every assertion consumes that one constant. The shipped idiom in all three reference
 * suites is build-once (`controlSizeFloor.test.tsx:172`, `nativeDialogs.test.ts:115-117`,
 * and this file's own `const ALL = …` before the widening). Moving the walk inside the
 * assertions would cost ~10 full reads of a 192-file tree per run. Adding a cache to
 * `src/test-utils/sourceScan.ts` to get the same effect is FORBIDDEN this phase (AC-12,
 * `88.6-PLAN-REVIEW-work/RULINGS.md`, "no shared-module cache this phase"), so the hoist
 * is the only sanctioned mechanism.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  assertExactCounts,
  assertRosterShape,
  type ExemptionRoster,
} from '../test-utils/exemption';
import { lineAt, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/** Absolute path -> the ONE canonical key space: `src/`-relative, POSIX separators. */
function keyOf(absolute: string): string {
  return path.relative(SRC, absolute).split(path.sep).join('/');
}

/**
 * The four PAGE surfaces 88-24 touched. Kept as its own list because one assertion below
 * — the 30/700 Display h1 — is a rule about PAGE TITLES specifically and must not reach a
 * primitive. See the amendment on that test.
 *
 * AMENDED Phase 88.6-11: re-expressed in the canonical `src/`-relative key space in the
 * same edit that widened the enumeration. See "THE KEY SPACE" in the file docblock.
 */
const PAGE_SURFACES = [
  'app/gameDetail/page.js',
  'app/groupHomePage/page.js',
  'app/userProfile/page.js',
  'app/friends/page.js',
] as const;

/**
 * The five NAMED surfaces this suite covered before Phase 88.6-11 widened it.
 *
 * AMENDED Phase 88.6-11: this list is NOT dead after the widening. One assertion — the
 * per-surface at-least-one heading floor — deliberately keeps its per-surface half here.
 * See the comment at that assertion for why pointing it at the whole tree turns it into
 * "every one of the 192 enumerated files contains a heading", which is red on day one.
 */
const NAMED_SURFACES = [
  ...PAGE_SURFACES,
  // AMENDED Phase 88-29 (DEF-88-19-03), original four KEPT AS THE 88-24 CHARTER above:
  // a FIFTH surface, and deliberately not one of 88-24's pages. `ErrorFallback` is a
  // primitive THIS phase created (88-04) and 88-09 fanned out to nine error boundaries,
  // and its `<h1>` shipped as `text-xl font-semibold` — a §4.2 prohibition living in more
  // places than any single page. DEF-88-19-03 routed it to 88-29 precisely because a type
  // gate armed without it would report clean over the phase's own contract being broken.
  //
  // This is NOT the start of DEF-88-24-03's 57-heading residual census (35 files, several
  // needing per-site decisions — marketing display type, the four legal-page `text-4xl`
  // titles, the `text-sm font-semibold` eyebrow labels). That stays 88-31's. This one file
  // is here because 88-29 fixed it, and a fix with no pin is a fix that comes undone.
  'components/ui/ErrorFallback.tsx',
] as const;

/**
 * §4.1's working set, as Tailwind utilities: 14 / 16 / 20 / 30.
 *
 * DO NOT ADD `xs` HERE. These assertions are HEADING-scoped, and admitting `text-xs`
 * would legalize the two live `text-xs` `<h4>`s at `app/components/CalendarListView.js:609`
 * and `:646` — the exact sites UI-SPEC §1.2 row V-5 (`88.6-UI-SPEC.md:111`, "h4 12px →
 * 14px") exists to move UP. 12px is the tree-wide FLOOR (task 2's sub-12px arbitrary-value
 * fold enforces it) and the `caption` rung lives on NON-heading elements only — UI-SPEC
 * §4.6 (`88.6-UI-SPEC.md:383`) states "No `caption` size — after §4.4 no heading renders at
 * 12px". Adding a rung here is the "the set is missing a size" edit; it is not.
 *
 * It also does not match an ARBITRARY value: an arbitrary size is by definition off the
 * rung set, so `text-[10px]` is an offender on both arms. `IN_SET_SIZE.test('text-[10px]')`
 * is asserted false below.
 */
const IN_SET_SIZE = /\btext-(?:sm|base|xl|3xl)\b/;

/**
 * Defect 2 (Phase 88.6-11). Anchored on the LITERAL `text-[`, deliberately: a looser
 * arbitrary-value clause false-positives `app/groupHomePage/page.js:668`'s
 * `[text-shadow:var(--t-shadow-l)]` (and its `dark:` twin, and the two
 * `[-webkit-text-stroke:…]` utilities beside them) into `OUT_OF_SET_SIZE`, reddening a
 * page title that is already on the 30/700 rung.
 */
const ARBITRARY_SIZE = /\btext-\[[^\]\s]*\]/;

/** Anything outside the working set. Includes `xs` (12) per the note on `IN_SET_SIZE`. */
const OUT_OF_SET_SIZE = new RegExp(
  `\\b(?:[a-z0-9-]+:)?text-(?:xs|lg|2xl|4xl|5xl|6xl|7xl|8xl|9xl)\\b|${ARBITRARY_SIZE.source}`,
);

/** A size utility that changes at a breakpoint — `md:text-3xl`, `max-md:text-base`. */
const BREAKPOINT_SIZE = /\b[a-z0-9-]+:text-[a-z0-9[]/;

/** §4.2's two weights. 600 and 500 are prohibitions outside `components/ui/Button.tsx`. */
const OFF_SCALE_WEIGHT = /\bfont-(?:medium|semibold)\b/g;

/**
 * THE THREE KINDS OF SCANNED HEADING — one array, one field, and every assertion states
 * which kinds it applies to.
 *
 *  - `raw`               — an `<hN>` tag written out in the source.
 *  - `heading-primitive` — a `<Heading level={n}>` call site (the Phase 88.6 primitive,
 *                          `src/components/ui/Heading.tsx`, plan 03).
 *  - `prop-seam`         — a component call site passing a LITERAL heading level down
 *                          (`headingLevel="h5"`, `rowHeadingLevel="h6"`).
 *
 * Two values would not be enough: the two non-raw kinds behave OPPOSITELY over the phase.
 * The `prop-seam` population is FIXED at five and stays fixed; the `heading-primitive`
 * population starts at zero and grows with every migrating sweep. A single combined
 * non-raw floor would be green forever, satisfied by the five immovable seams alone —
 * which is exactly the vacuous-gate shape this suite exists to prevent. They are floored
 * SEPARATELY below.
 */
type HeadingKind = 'raw' | 'heading-primitive' | 'prop-seam';

interface Heading {
  /** The canonical `src/`-relative key. */
  surface: string;
  level: number;
  line: number;
  /**
   * The LITERAL className on the heading's own opening tag, `${…}` interpolations
   * blanked. An interpolated constant is invisible here ON PURPOSE — see the
   * `app/groupHomePage/page.js:467-478` DECISION quoted at `readClassName` below.
   *
   * For a `prop-seam` this is the className of the COMPONENT CALL SITE, not of the
   * heading element the component renders internally. It is included rather than
   * blanked because `text-*` INHERITS: a size utility written on the wrapper really
   * does reach the heading. It is empty at all five shipped seams.
   */
  className: string;
  /**
   * The heading's literal inner text, with JSX expressions blanked. Added
   * 2026-08-05 so a pin can name ONE heading ("Reviews") instead of keying on the
   * class it is supposed to be asserting — a predicate that matched on `text-2xl`
   * silently stops matching the moment the heading is converged, which is exactly
   * how the old exemption count could have gone vacuous.
   *
   * AMENDED Phase 88.6-11: the extractor closes on `</Heading>` as well as `</hN>`, so
   * the Reviews pin survives that heading migrating onto the primitive. Empty for a
   * `prop-seam` — the text lives inside the component.
   */
  text: string;
  kind: HeadingKind;
}

/** A level expression the scanner refuses to resolve. See `PROP_SEAM_EXPRESSION`. */
interface SkippedLevel {
  surface: string;
  line: number;
  snippet: string;
}

const RAW_OPEN = /<h([1-6])(?=[\s/>])/g;
const PRIMITIVE_OPEN = /<Heading(?=[\s/>])/g;

/**
 * A LITERAL heading-level prop on a component call site. `=` must follow the prop name
 * with NO whitespace, which is what tells a JSX attribute (`headingLevel="h5"`) apart
 * from a destructured DEFAULT (`headingLevel = 'h4'` at
 * `app/components/CalendarListView.js:849`). A default is not a call site and counting it
 * would double-count every `DateGroup` the file renders.
 */
const PROP_SEAM_LITERAL =
  /\b(headingLevel|rowHeadingLevel)=(?:"(h[1-6])"|'(h[1-6])'|\{\s*['"](h[1-6])['"]\s*\})/g;

/**
 * A NON-LITERAL heading-level prop. SKIPPED BY RULE, and that is a mandate rather than
 * caution — for two verified reasons.
 *
 * First, `EXPECTED_LEVELS` is a per-file per-LEVEL record, so an expression has no
 * representable value: "count it" has nowhere to be written.
 *
 * Second, resolving it produces a WRONG number. `app/components/CalendarListView.js:866`
 * is `headingLevel={rowHeadingLevel}`; resolving it from `EventRow`'s own `'h5'` default
 * (`:889`) would record an h5 while BOTH real call sites pass `rowHeadingLevel="h6"`
 * (`:632`, `:657`) — a level the DOM never renders, double-counted onto a chain whose two
 * ends are already counted.
 *
 * Do not "improve" this into a resolver. Skipped sites are enumerated and asserted, so a
 * new one is visible rather than silent.
 */
const PROP_SEAM_EXPRESSION = /\b(?:headingLevel|rowHeadingLevel)=\{(?!\s*['"])/g;

/** `level={2}` or `level="2"`, anywhere in the opening tag (attribute-order agnostic). */
const LEVEL_LITERAL = /\blevel=\s*(?:\{\s*([1-6])\s*\}|"([1-6])")/;
const LEVEL_PRESENT = /\blevel=/;

/**
 * The className literal. DELIBERATELY literal-only.
 *
 * `app/groupHomePage/page.js:467-478` carries a shipped DECISION that writes eight
 * arbitrary-property utilities out LITERALLY on each element *because* this suite reads
 * the h1's className literal — "an interpolated constant is invisible to both, so hoisting
 * would silently disarm two gates". A matcher that resolved identifiers would void that
 * decision as a side effect. CONSEQUENCE, not bookkeeping.
 */
const CLASSNAME_LITERAL =
  /\bclassName=\s*(?:"([^"]*)"|'([^']*)'|\{\s*`([\s\S]*?)`\s*\})/;

/**
 * Read a JSX opening tag from `<` to its matching `>`, brace-balanced and string-aware.
 *
 * Replaces the shipped `[\s\S]{0,400}?` span, which could not tell a `>` inside an
 * expression attribute from the end of the tag and silently truncated long tags.
 */
function readOpenTag(src: string, start: number): { text: string; end: number } | null {
  let i = start;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') {
      const q = c;
      i += 1;
      while (i < src.length) {
        if (src[i] === '\\') {
          i += 2;
          continue;
        }
        if (src[i] === q) break;
        if (q !== '`' && src[i] === '\n') break;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (c === '{') {
      depth += 1;
    } else if (c === '}') {
      depth -= 1;
    } else if (c === '>' && depth === 0) {
      return { text: src.slice(start, i + 1), end: i + 1 };
    }
    i += 1;
  }
  return null;
}

function readClassName(tag: string): string {
  const m = CLASSNAME_LITERAL.exec(tag);
  // Interpolations are conditional branches (gameDetail's game title uses one for
  // line-clamping); the statically-applied classes are what the scale governs.
  return (m?.[1] ?? m?.[2] ?? m?.[3] ?? '').replace(/\$\{[\s\S]*?\}/g, ' ');
}

function readInnerText(src: string, from: number, closers: string[]): string {
  const window = src.slice(from, from + 1200);
  let best = -1;
  for (const closer of closers) {
    const at = window.indexOf(closer);
    if (at >= 0 && (best < 0 || at < best)) best = at;
  }
  if (best < 0) return '';
  return window
    .slice(0, best)
    .replace(/\{[\s\S]*?\}/g, ' ')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Walk back to the opening `<` of the tag containing `at`, or -1. */
function enclosingTagStart(src: string, at: number): number {
  for (let i = at; i >= 0; i -= 1) {
    if (src[i] === '>') return -1;
    if (src[i] === '<' && /[A-Za-z]/.test(src[i + 1] ?? '')) return i;
  }
  return -1;
}

/**
 * Scan ONE comment-stripped source text for all three kinds of heading.
 *
 * Exported shape note: this takes the STRIPPED text, never raw source. Every caller in
 * this file — including the in-file fixtures — goes through `withoutComments` first.
 */
function scanHeadings(surface: string, stripped: string, skipped: SkippedLevel[]): Heading[] {
  const out: Heading[] = [];

  RAW_OPEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RAW_OPEN.exec(stripped)) !== null) {
    const level = Number(m[1]);
    const tag = readOpenTag(stripped, m.index);
    out.push({
      surface,
      level,
      line: lineAt(stripped, m.index),
      className: tag ? readClassName(tag.text) : '',
      text: readInnerText(stripped, tag?.end ?? m.index, [`</h${level}>`]),
      kind: 'raw',
    });
  }

  PRIMITIVE_OPEN.lastIndex = 0;
  while ((m = PRIMITIVE_OPEN.exec(stripped)) !== null) {
    const tag = readOpenTag(stripped, m.index);
    if (!tag) continue;
    const lit = LEVEL_LITERAL.exec(tag.text);
    if (!lit) {
      if (LEVEL_PRESENT.test(tag.text)) {
        skipped.push({
          surface,
          line: lineAt(stripped, m.index),
          snippet: tag.text.replace(/\s+/g, ' ').slice(0, 120),
        });
      }
      continue;
    }
    const level = Number(lit[1] ?? lit[2]);
    out.push({
      surface,
      level,
      line: lineAt(stripped, m.index),
      className: readClassName(tag.text),
      text: readInnerText(stripped, tag.end, ['</Heading>']),
      kind: 'heading-primitive',
    });
  }

  PROP_SEAM_LITERAL.lastIndex = 0;
  while ((m = PROP_SEAM_LITERAL.exec(stripped)) !== null) {
    const level = Number((m[2] ?? m[3] ?? m[4]).slice(1));
    const open = enclosingTagStart(stripped, m.index);
    const tag = open >= 0 ? readOpenTag(stripped, open) : null;
    out.push({
      surface,
      level,
      line: lineAt(stripped, m.index),
      className: tag ? readClassName(tag.text) : '',
      text: '',
      kind: 'prop-seam',
    });
  }

  PROP_SEAM_EXPRESSION.lastIndex = 0;
  while ((m = PROP_SEAM_EXPRESSION.exec(stripped)) !== null) {
    skipped.push({
      surface,
      line: lineAt(stripped, m.index),
      snippet: stripped.slice(m.index, m.index + 60).replace(/\s+/g, ' '),
    });
  }

  return out.sort((a, b) => a.line - b.line);
}

// ---------------------------------------------------------------------------
// BUILD ONCE (AC-11). Enumerate, read and comment-strip the tree exactly here.
// ---------------------------------------------------------------------------
const FILES = sourceFiles(SRC).map((absolute) => ({
  key: keyOf(absolute),
  stripped: withoutComments(fs.readFileSync(absolute, 'utf8')),
}));

const SKIPPED_LEVELS: SkippedLevel[] = [];
const ALL: readonly Heading[] = FILES.flatMap((f) => scanHeadings(f.key, f.stripped, SKIPPED_LEVELS));

const BY_FILE = new Map<string, Heading[]>();
for (const h of ALL) {
  const bucket = BY_FILE.get(h.surface);
  if (bucket) bucket.push(h);
  else BY_FILE.set(h.surface, [h]);
}
const headings = (surface: string): Heading[] => BY_FILE.get(surface) ?? [];

const RAW = ALL.filter((h) => h.kind === 'raw');

function describeHeading(h: Heading): string {
  return `h${h.level} [${h.kind}] ${h.surface}:${h.line} -> "${h.className.trim()}"`;
}

function countByFile(hs: readonly Heading[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const h of hs) out[h.surface] = (out[h.surface] ?? 0) + 1;
  return out;
}

/**
 * DEF-88-24-02 — THERE IS NO LONGER AN EXEMPTION HERE.
 *
 * 88-24 shipped this file with a `D39_REVIEWS_EXEMPTION` predicate and pinned the
 * exemption at exactly ONE heading, because gameDetail's Reviews h2 stood at
 * `text-2xl` under an owner ruling (`DECISION Phase 88-11 (D-39)`) that genuinely
 * conflicted with §4.1's 4-size working set. That plan refused to break the tie and
 * escalated it as DEF-88-24-02.
 *
 * The owner ruled on 2026-08-05 — "make it match the same size as all other
 * headings" — so the Reviews h2 is now `text-xl font-bold` and the working-set test
 * below runs with NO exemption filter at all.
 *
 * The count pin is replaced rather than deleted, because deleting it would leave the
 * convergence unpinned: the working-set test alone fails if `text-2xl` returns, but
 * nothing would say WHY, and nothing would notice if the Reviews heading were
 * removed from the surface entirely (which would make the working-set test pass
 * vacuously). The replacement below asserts the converged heading positively, by
 * name.
 *
 * AMENDED Phase 88.6-11: re-expressed in the canonical key space, and the assertion now
 * scans the WHOLE TREE rather than one file. Tree-wide plus exactly-one is strictly
 * STRONGER than a one-file scan — it also reds if the heading MOVES surface, which a
 * one-file scan reports as plain absence.
 */
const REVIEWS_HEADING = (h: Heading) =>
  h.surface === 'app/gameDetail/page.js' && /^Reviews\b/.test(h.text.trim());

// ---------------------------------------------------------------------------
// SUPPLY / OVERRIDE / COUNTING — the raw/primitive split.
//
// DECISION Phase 88.6-11: every assertion below declares which `kind`s it applies to,
// chosen OVER exempting `<Heading>` call sites wholesale from this suite. Two reasons the
// wholesale exemption loses. (1) It disarms the OVERRIDE rules once ~135 headings migrate,
// leaving the tree-wide rung gate covering only residual raw tags — a gate 31 plan files
// name in a verify block, quietly reduced to nothing. (2) `cn` last-wins
// (`88.6-03-PLAN.md:79`) makes a caller `text-2xl` on a `<Heading>` a REAL 24px override,
// so a primitive call site is exactly as capable of breaking the scale as a raw tag.
// Changing this back is a decision, not a cleanup.
//
//  - SUPPLY   rules are RAW-ONLY. Plan 03 puts the rung AND the weight inside the
//             primitive (`88.6-03-PLAN.md:152-153`: the cva base is `font-bold`, the
//             `size` variant supplies `text-3xl`/`text-xl`/`text-base`/`text-sm`), so a
//             migrated call site's own className carries neither and would be a NEW
//             offender on two rules while absent from a roster seeded from current
//             violators. Each SUPPLY rule keeps a primitive-side arm so the property is
//             PINNED rather than dropped: plan 03's `Heading.test.tsx` pins it there.
//  - OVERRIDE rules cover ALL THREE kinds, per (2) above.
//  - COUNTING floors cover ALL THREE kinds — pointing them at raw headings only would
//    red them the moment the sweeps land.
// ---------------------------------------------------------------------------

/**
 * The five LITERAL prop seams, enumerated so one appearing or disappearing is visible.
 * Re-measured at this plan's commit.
 */
const EXPECTED_PROP_SEAMS = 5;

/**
 * The `heading-primitive` floor, asserted SEPARATELY from `prop-seam` so neither can be
 * masked by the other.
 *
 * ZERO at plan 11's commit: `src/components/ui/Heading.tsx` did not exist yet (plan 03
 * creates it) and there were zero `<Heading` call sites in `src/`.
 *
 * THE RULE FOR SWEEPS: each migrating sweep RAISES this floor in the same commit as the
 * migration it lands. An unchanged zero after a sweep wave is a RED, not a pass — that is
 * the whole point of flooring it separately from the five immovable seams, which would
 * otherwise satisfy a combined non-raw floor forever.
 *
 * RAISED 0 -> 1 by plan 88.6-15 task 1 and 1 -> 2 by its task 2 (2026-09-16):
 * `PromptScheduleManager.js`'s h3 is the FIRST `<Heading>` call site in the tree and
 * `PromptScheduleReadOnly.js`'s is the second. 88.6-11-SUMMARY "Downstream plan corrections" #2
 * recorded that NO sweep plan's text instructs this raise — the tracer does it anyway, once per
 * migrating commit, and says so here so the ~20 expansion sweeps inherit the habit rather than
 * the omission.
 *
 * RAISED 2 -> 16 by plan 88.6-17 task 2 (2026-09-16): `app/userProfile/page.js`'s FOURTEEN
 * headings all migrated in one commit — the largest single heading cluster in the phase. The
 * raise is +14, the measured number landed, not a round figure: this floor is `>=`, so a raise
 * that undershoots is silently green and buys nothing.
 *
 * RAISED 16 -> 25 by plan 88.6-18 task 2 (2026-09-16): `app/gameDetail/page.js`'s NINE headings,
 * every level preserved (3 h1, 5 h2, 1 h3 — `EXPECTED_LEVELS` is byte-unchanged, which is the
 * P4 half). Two of the nine are the game-title h1s RESEARCH §C.5 corrected: they were NOT
 * size-less, they were already `text-3xl`, so they land at `size="display"` with no size change.
 *
 * RAISED 25 -> 27 by plan 88.6-19 task 2 (2026-09-16): `app/components/ManageMembers.js`'s TWO
 * h3s, both `text-lg` (18) -> `size="heading"` (20) on D-04's closed tie. `EXPECTED_LEVELS`'
 * `{ 3: 2 }` entry for that file is byte-unchanged (P4).
 *
 * RAISED 27 -> 32 by plan 88.6-19 task 3 (2026-09-16): `app/friends/page.js`'s FIVE headings —
 * four h1s in mutually-exclusive early-return branches plus one h2. All four h1s were ALREADY
 * `text-3xl`, so they land at `size="display"` with NO size change; the h2 was already
 * `text-xl` -> `size="heading"`, likewise unchanged. `EXPECTED_LEVELS`' `{ 1: 4, 2: 1 }` entry
 * for that file is byte-unchanged (P4).
 *
 * RAISED 39 -> 46 by plan 88.6-22 task 2 (2026-09-16): SEVEN more — `BallotSection.js`'s six
 * "Game Vote" h3s (one per branch, all `text-sm` -> `size="label"`, no size change) and
 * `BallotOptionsEditor.js`'s single h3 (likewise). Both files' `EXPECTED_LEVELS` entries
 * (`{ 3: 6 }` and `{ 3: 1 }`) are byte-unchanged (P4).
 *
 * RAISED 36 -> 39 by plan 88.6-22 task 1 (2026-09-16): `app/components/FriendInvitePanel.js`'s
 * THREE h3s, all `text-sm` (14) -> `size="label"` (14), the h3@14 "stays" row of D-04's table —
 * no size change at any of them. `EXPECTED_LEVELS`' `{ 3: 3 }` entry for that file is
 * byte-unchanged (P4). The `id="invite-by-email-heading"` on the middle one is carried through:
 * it is the email field's only accessible name via `aria-labelledby`.
 *
 * RAISED 46 -> 56 by plan 88.6-23 task 1 (2026-09-16): TEN more — `invite/game/[token]/page.js`'s
 * SIX h1s (one per mutually-exclusive status branch) and `invite/group/[token]/page.js`'s FOUR.
 * THREE of the ten move size (the two `text-2xl` page titles on the game page and the one on the
 * group page -> `size="display"`, 30); the other SEVEN were already `text-xl` and land on
 * `size="heading"` with NO size change, per D-04's "h1 @ 20 stays 20" row. Both files'
 * `EXPECTED_LEVELS` entries (`{ 1: 6 }` and `{ 1: 4 }`) are byte-unchanged (P4).
 *
 * RAISED 56 -> 63 by plan 88.6-23 task 2 (2026-09-16): SEVEN more —
 * `restore/group/[token]/page.tsx`'s FOUR h1s and `invite/accept/page.js`'s THREE. ONE moves
 * size (restore's `text-2xl` group-name page title -> `size="display"`, 30); the other SIX were
 * already `text-xl` and land on `size="heading"` with NO size change. Both files'
 * `EXPECTED_LEVELS` entries (`{ 1: 4 }` and `{ 1: 3 }`) are byte-unchanged (P4).
 *
 * RAISED 63 -> 66 by plan 88.6-23 task 3 (2026-09-16): THREE more —
 * `availability-form/[token]/page.js`'s three mutually-exclusive h1s. ONE moves size (the READY
 * page title, `text-2xl` -> `size="display"`, 30); the ERROR and SUBMITTED branch headings were
 * already `text-xl` and land on `size="heading"` with no size change. `EXPECTED_LEVELS`' `{ 1: 3 }`
 * entry for that file is byte-unchanged (P4).
 *
 * RAISED 66 -> 69 by plan 88.6-24 task 2 (2026-09-16): THREE more — `rsvp/[token]/page.js`'s three
 * mutually-exclusive h1s. ONE moves size (the confirmation page title, `text-2xl` -> `size="display"`,
 * 30 — a disclosed +6px); the EVENT_PASSED and ERROR branch headings were already `text-xl` and land
 * on `size="heading"` with no size change. `EXPECTED_LEVELS`' `{ 1: 3 }` entry for that file is
 * byte-unchanged (P4).
 */
const EXPECTED_MIN_PRIMITIVES = 69;

/** Anti-vacuity: the enumeration must actually enumerate. Measured 192 at this commit. */
const MIN_ENUMERATED_FILES = 150;

// ---------------------------------------------------------------------------
// FIXTURES — the split is proven HERE, not discovered in wave 8.
// ---------------------------------------------------------------------------
const FIXTURE_COMPLIANT_PRIMITIVE = `
  export const A = () => (
    <Heading level={2} className="text-content-primary">Section</Heading>
  );
`;
const FIXTURE_PRIMITIVE_CALLER_OVERRIDE = `
  export const B = () => (
    <Heading level={2} className="text-2xl text-content-primary">Loud</Heading>
  );
`;
const FIXTURE_PRIMITIVE_PAGE_TITLE_OFF_RUNG = `
  export const C = () => (
    <Heading id="t" level={1} className="text-xl font-bold">Page</Heading>
  );
`;

/**
 * Defects 1 and 4's negative control, in one fixture because the two are COUPLED: the
 * class-less `<h4>` is only reachable once `HEADING_RE`'s `className=` guard is gone, and
 * once it is gone the three heading tags in prose become matches unless comments are
 * stripped. Measured consequence of getting this wrong: the raw `<hN>` census reads 152
 * across 46 files instead of 135 across 43.
 */
const FIXTURE_COMMENTS_AND_CLASSLESS = `
  /* A block comment mentioning <h1> and <h2 className="text-2xl"> should count for nothing. */
  // A line comment mentioning <h3> likewise.
  export const D = () => (
    <div>
      {/* A JSX comment mentioning <h5> */}
      <h4>Class-less, and still a heading</h4>
      <h2 className="text-xl font-bold">Real</h2>
    </div>
  );
`;

function scanFixture(key: string, source: string): Heading[] {
  return scanHeadings(key, withoutComments(source), []);
}

// ---------------------------------------------------------------------------
// ROSTERS — seeded from a live comment-stripped run at this plan's commit.
// ---------------------------------------------------------------------------

/** Headings off the 4-size working set (both arms — see the assertion). */
const RUNG_ROSTER: ExemptionRoster = {
  'app/about/page.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h1:8 text-4xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-23 task 3 (wave 7, 2026-09-16): `app/availability-form/[token]/page.js`
  // carried `sites: 1` (h1:238 `text-2xl`), the READY-branch page title, now
  // `<Heading level={1} size="display">` (30). Its other TWO h1s were already `text-xl` and stay
  // at 20 as `size="heading"` — the ERROR branch ("Link No Longer Valid") and the SUBMITTED
  // confirmation ("Availability Submitted!"), both mutually exclusive with the title and
  // neither a loading branch. Entry DELETED, not zeroed.
  'app/components/BringSummary.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h3:97 no size utility) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/CalendarListView.js': {
    sites: 4,
    why: '4 headings off the 4-size working set (h3:478 text-lg; h3:505 text-lg; h4:607 text-xs; h4:646 text-xs) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/DangerZoneDeleteAccount.tsx': {
    sites: 1,
    why: '1 heading off the 4-size working set (h2:259 text-lg) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/EventCalendar.js': {
    sites: 2,
    why: '2 headings off the 4-size working set (h2:171 text-2xl; h2:192 text-2xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/EventDayModal.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h4:360 no size utility) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/GroupGamesList.js': {
    sites: 3,
    why: '3 headings off the 4-size working set (h3:39 text-lg; h2:271 text-2xl; h2:335 text-2xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/GroupSettings.js': {
    sites: 4,
    why: '4 headings off the 4-size working set (h3:610 text-lg; h3:697 text-lg; h3:1019 text-lg; h3:1091 text-lg) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/LandingPage.js': {
    sites: 1,
    why: 'Phase 88.9 W55 owns the landing hero block: 1 heading off the 4-size working set (h1:15 text-5xl md:text-6xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'owner', date: '2026-09-08', ruling: 'Phase 88.9 W55 owns the landing hero block\'s sizes' },
  },
  // DELETED by plan 88.6-19 task 2 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 2` (h3:434, h3:663 pre-edit, both `text-lg`). Both MIGRATED onto
  // `<Heading level={3} size="heading">`, so the rung is supplied by the primitive and the file
  // leaves this raw-only population entirely rather than decrementing. Deleted, not zeroed.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleManager.js` carried
  // `sites: 1` (h3:213 `text-lg`). That heading MIGRATED onto `<Heading level={3}
  // size="heading">`, so the rung is supplied by the primitive and the file leaves this
  // population entirely rather than decrementing (88.6-11-SUMMARY "Downstream plan
  // corrections" #1). Deleted, not zeroed — the count is exact in both directions.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleReadOnly.js` carried
  // `sites: 1` (h3:46 `text-lg`). Migrated onto `<Heading level={3} size="heading">`, so the
  // rung is the primitive's and the file leaves this population. Deleted, not zeroed.
  'app/components/ResponseDashboard.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h3:154 text-lg) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/ScheduleList.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h3:91 text-lg) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/UpcomingEventsCard.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h3:156 no size utility) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/tutorial/simulated/ProblemSlide.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h2:14 text-2xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/global-error.tsx': {
    sites: 1,
    why: 'a class-less <h1> in the root error boundary, which must not import from src/components/ui/ — it is the last surface standing when the app has crashed',
    owner: { kind: 'decision', marker: 'DECISION Phase 88-09 D-20' },
  },
  'app/goodbye/page.tsx': {
    sites: 2,
    why: '2 headings off the 4-size working set (h1:58 text-4xl; h1:91 text-4xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/groupPlanning/page.js': {
    sites: 2,
    why: '2 headings off the 4-size working set (h1:268 text-2xl md:text-3xl; h3:328 text-lg) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-23 task 1 (wave 7, 2026-09-16): `app/invite/game/[token]/page.js`
  // carried `sites: 2` (h1:238, h1:263 — both `text-2xl`) and
  // `app/invite/group/[token]/page.js` carried `sites: 1` (h1:148 `text-2xl`). All three are
  // `<Heading level={1} size="display">` (30) now — D-04's "h1 @ 24 (page titles)" row — and
  // leave this RAW-only population entirely. The SEVEN OTHER h1s across the two files were
  // already `text-xl` and stay at 20 as `size="heading"` (D-04 row 2, the mutually-exclusive
  // status branches): they were never in this roster because 20 is inside the working set.
  // Entries DELETED, not zeroed.
  'app/privacy/page.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h1:8 text-4xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-23 task 2 (wave 7, 2026-09-16): `app/restore/group/[token]/page.tsx`
  // carried `sites: 1` (h1:455 `text-2xl`), the group-name page title, now
  // `<Heading level={1} size="display">` (30). Its THREE other h1s were already `text-xl` and
  // stay at 20 as `size="heading"` (D-04 row 2). Entry DELETED, not zeroed.
  // DELETED by plan 88.6-24 task 2 (wave 7, 2026-09-16): `app/rsvp/[token]/page.js` carried
  // `sites: 1` (h1:149 `text-2xl`), the RSVP confirmation page title, now
  // `<Heading level={1} size="display">` (30 — a disclosed +6px). Its two OTHER h1s were already
  // `text-xl` and stay at 20 as `size="heading"` (D-04 row 2); the three are mutually exclusive
  // branches (D-06), so the differing sizes are deliberate. Entry DELETED, not zeroed.
  'app/terms/page.js': {
    sites: 1,
    why: '1 heading off the 4-size working set (h1:8 text-4xl) — re-keyed to 30/20/16/14 by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
};

/** Headings carrying the prohibited 600 weight. */
const HEADING_SEMIBOLD_ROSTER: ExemptionRoster = {
  // DELETED by plan 88.6-23 task 3 (wave 7, 2026-09-16): `app/availability-form/[token]/page.js`
  // carried `sites: 2` (h1:182, h1:206 — the ERROR and SUBMITTED branch headings, both
  // `font-semibold`). Both are `<Heading level={1} size="heading">` now and take their 700 from
  // the primitive's `font-bold` base, leaving this RAW-only population. Entry DELETED, not
  // zeroed.
  // DELETED by plan 88.6-22 task 2 (wave 7, 2026-09-16): `BallotOptionsEditor.js` carried
  // `sites: 1` (h3:9) and `BallotSection.js` carried `sites: 6` (h3:109, :147, :175, :192, :220,
  // :238 — six copies of the same "Game Vote" header across six mutually-exclusive branches).
  // All seven are `<Heading level={3} size="label">` now and leave this RAW-only population.
  // h3@14 STAYS at 14 per D-04's table; `size="label"` is `text-sm`. Entries DELETED, not zeroed.
  'app/components/BringSummary.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:97) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/CalendarListView.js': {
    sites: 4,
    why: '4 headings carrying the prohibited 600 weight (h3:478, h3:505, h4:607, h4:646) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/CalendarMonthView.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:193) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/EventDayModal.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h4:360) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-22 task 1 (wave 7, 2026-09-16): `app/components/FriendInvitePanel.js`
  // carried `sites: 3` (h3:315, h3:445, h3:521). All three are `<Heading level={3} size="label">`
  // now, so they leave this RAW-only population entirely rather than moving to 700 in place.
  // h3@14 STAYS at 14 per D-04 — `size="label"` is `text-sm`. Entry DELETED, not zeroed.
  'app/components/GroupGamesList.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:39) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/GroupSettings.js': {
    sites: 4,
    why: '4 headings carrying the prohibited 600 weight (h3:610, h3:697, h3:1019, h3:1091) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-19 task 2 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 2` (h3:434, h3:663 pre-edit, both `font-semibold`). Both migrated onto
  // `<Heading>`, whose cva base is `font-bold`, so the call sites state no weight at all and
  // the file leaves this raw-only population. Deleted, not zeroed.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleManager.js` carried
  // `sites: 1` (h3:213 `font-semibold`). The heading migrated onto `<Heading>`, whose cva base
  // is `font-bold`, so the call site states no weight at all and the file leaves this
  // population. Deleted, not zeroed.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleReadOnly.js` carried
  // `sites: 1` (h3:46 `font-semibold`). Migrated onto `<Heading>`, whose cva base is
  // `font-bold`, so the call site states no weight. Deleted, not zeroed.
  'app/components/ResponseDashboard.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:154) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/RsvpSection.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:162) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/ScheduleList.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:91) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/tutorial/simulated/ProblemSlide.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h2:14) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/groupPlanning/page.js': {
    sites: 1,
    why: '1 heading carrying the prohibited 600 weight (h3:328) — UI-SPEC §4.2 gives 600 exactly one home, the Button primitive; these move to 700 in the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-24 task 2 (wave 7, 2026-09-16): `app/rsvp/[token]/page.js` carried
  // `sites: 2` (h1:190, h1:220 — the EVENT_PASSED and ERROR branch headings, both
  // `font-semibold`). Both are `<Heading level={1} size="heading">` now and take their 700 from
  // the primitive's `font-bold` base, leaving this RAW-only population. Entry DELETED, not zeroed.
};

/** RAW headings that do not state the 700 weight. */
const HEADING_WEIGHT_ROSTER: ExemptionRoster = {
  // DELETED by plan 88.6-23 task 3 (wave 7, 2026-09-16): the same two headings as the
  // heading-semibold roster above. Their 700 now comes from the primitive's `font-bold` base
  // (Heading.tsx:60) rather than a stated utility. Entry DELETED, not zeroed.
  // DELETED by plan 88.6-22 task 2 (wave 7, 2026-09-16): the same seven headings as the
  // heading-semibold roster above. Their 700 now comes from the primitive's `font-bold` base
  // (Heading.tsx:60) rather than a stated utility. Entries DELETED, not zeroed.
  'app/components/BringSummary.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:97 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/CalendarListView.js': {
    sites: 4,
    why: '4 raw headings not stating the 700 weight (h3:478 font-semibold; h3:505 font-semibold; h4:607 font-semibold; h4:646 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/CalendarMonthView.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:193 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/EventDayModal.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h4:360 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-22 task 1 (wave 7, 2026-09-16): same three headings as the
  // heading-semibold roster above. The 700 now comes from the primitive's `font-bold` base
  // (Heading.tsx:60) rather than from a stated utility, and a migrated heading leaves this
  // RAW-only population. Entry DELETED, not zeroed.
  'app/components/GroupGamesList.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:39 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/GroupSettings.js': {
    sites: 4,
    why: '4 raw headings not stating the 700 weight (h3:610 font-semibold; h3:697 font-semibold; h3:1019 font-semibold; h3:1091 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-19 task 2 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 2` (h3:434, h3:663 pre-edit). RAW-ONLY supply rule; neither is a raw `<hN>`
  // tag any more, so the file leaves the population rather than decrementing. The 700 is now
  // supplied by `Heading`'s cva base and pinned in `Heading.test.tsx`. Deleted, not zeroed.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleManager.js` carried
  // `sites: 1` (h3:213). This roster is a RAW-ONLY supply rule; the heading is no longer a raw
  // `<hN>` tag, so the file leaves the population rather than decrementing. The 700 is now
  // supplied by `Heading`'s cva base and pinned in `Heading.test.tsx`. Deleted, not zeroed.
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleReadOnly.js` carried
  // `sites: 1` (h3:46). RAW-ONLY supply rule; the heading is no longer a raw `<hN>` tag, so the
  // file leaves the population rather than decrementing. Deleted, not zeroed.
  'app/components/ResponseDashboard.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:154 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/RsvpSection.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:162 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/ScheduleList.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:91 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/UpcomingEventsCard.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:156 font-medium) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/components/tutorial/simulated/ProblemSlide.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h2:14 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  'app/global-error.tsx': {
    sites: 1,
    why: 'a class-less <h1> in the root error boundary, which must not import from src/components/ui/ — it is the last surface standing when the app has crashed',
    owner: { kind: 'decision', marker: 'DECISION Phase 88-09 D-20' },
  },
  'app/groupPlanning/page.js': {
    sites: 1,
    why: '1 raw heading not stating the 700 weight (h3:328 font-semibold) — §4.2 requires 700 to be stated; closed by the Phase 88.6 sweep that owns this file',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
  // DELETED by plan 88.6-24 task 2 (wave 7, 2026-09-16): the same two headings as the
  // heading-semibold roster above. Their 700 now comes from the primitive's `font-bold` base
  // (Heading.tsx:60) rather than a stated utility. Entry DELETED, not zeroed.
};

/** Headings whose size changes at a breakpoint. */
const BREAKPOINT_ROSTER: ExemptionRoster = {
  'app/components/LandingPage.js': {
    sites: 1,
    why: 'Phase 88.9 W55 owns the landing hero block: 1 heading whose size changes at a breakpoint (h1:15 text-5xl md:text-6xl) — a heading that changes size at a breakpoint is a SECOND scale; pick ONE rung from the working set',
    owner: { kind: 'owner', date: '2026-09-08', ruling: 'Phase 88.9 W55 owns the landing hero block\'s sizes' },
  },
  'app/groupPlanning/page.js': {
    sites: 1,
    why: '1 heading whose size changes at a breakpoint (h1:268 text-2xl md:text-3xl) — a heading that changes size at a breakpoint is a SECOND scale; pick ONE rung from the working set',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3' },
  },
};

/**
 * A heading is on the DISPLAY rung (30/700) if it says so in its own className (raw) or
 * gets it from the primitive's `size` variant without a caller override
 * (`heading-primitive`). The primitive arm is what stops the Display rule being deleted
 * by the migration — the four `PAGE_SURFACES` hold their page titles as raw h1s today and
 * hold ZERO once plans 17, 18, 19 and 21 migrate them, so a raw-only rule reds either way.
 */
const isDisplayRung = (h: Heading) =>
  h.kind === 'heading-primitive'
    ? !OUT_OF_SET_SIZE.test(h.className) && !/\btext-(?:sm|base|xl)\b/.test(h.className)
    : /\btext-3xl\b/.test(h.className);

/** The 20px section-heading rung, in raw form or through the primitive. */
const isSectionRung = (h: Heading) =>
  h.kind === 'heading-primitive'
    ? !OUT_OF_SET_SIZE.test(h.className) && !/\btext-(?:sm|base|3xl)\b/.test(h.className)
    : /\btext-xl\b/.test(h.className);

/** 700, in raw form or from the primitive's cva base (plan 03, `88.6-03-PLAN.md:152`). */
const isBoldWeight = (h: Heading) =>
  h.kind === 'heading-primitive' ? !/\bfont-(?:medium|semibold|normal)\b/.test(h.className) : /\bfont-bold\b/.test(h.className);

describe('Req 2 (CD-006) / SPEC-88.6 R3: the heading type scale across all of `src/`', () => {
  it('enumerates the tree, and every roster in this file has valid provenance', () => {
    // Anti-vacuity. 194 files at this plan's commit; the floor is deliberately slack so
    // adding a component is not a red build, and tight enough that an enumeration that
    // silently walks the wrong root reds.
    expect(
      FILES.length,
      'sourceFiles(SRC) enumerated almost nothing — the scan root is wrong',
    ).toBeGreaterThanOrEqual(MIN_ENUMERATED_FILES);

    expect(assertRosterShape(RUNG_ROSTER)).toEqual([]);
    expect(assertRosterShape(HEADING_SEMIBOLD_ROSTER)).toEqual([]);
    expect(assertRosterShape(HEADING_WEIGHT_ROSTER)).toEqual([]);
    expect(assertRosterShape(BREAKPOINT_ROSTER)).toEqual([]);
  });

  it('finds headings on every one of the five named surfaces, and a tree-wide total floor', () => {
    // SPLIT, Phase 88.6-11, and the per-surface half is held on the NAMED list ON PURPOSE.
    //
    // Pointing this loop at `sourceFiles(SRC)` would assert that every one of the 194
    // enumerated files contains at least one heading — a red on day one, on a gate 31 plan
    // files name in a verify block. The per-surface half is a guard against a scanner that
    // silently matches nothing on a surface it is supposed to cover; the tree-wide half
    // below is the one that grows with the widening. Do not "finish" this widening.
    for (const surface of NAMED_SURFACES) {
      expect(headings(surface).length, `${surface}: no headings matched`).toBeGreaterThanOrEqual(1);
    }
    // COUNTING floor — ALL three kinds. 140 at this plan's commit; a floor, so adding a
    // heading is not a red build.
    expect(ALL.length).toBeGreaterThanOrEqual(20);
  });

  it('floors the prop-seam and heading-primitive buckets SEPARATELY', () => {
    // COUNTING. A single `>= 1` floor over a combined non-raw bucket is green forever —
    // the five immovable seams satisfy it on their own, before and after the migration.
    const seams = ALL.filter((h) => h.kind === 'prop-seam');
    const primitives = ALL.filter((h) => h.kind === 'heading-primitive');

    expect(
      seams.map(describeHeading).sort(),
      'the literal headingLevel/rowHeadingLevel seams are a FIXED population; one appearing ' +
        'or disappearing is a real change, not a rebase',
    ).toHaveLength(EXPECTED_PROP_SEAMS);

    expect(
      primitives.length,
      'each migrating sweep raises EXPECTED_MIN_PRIMITIVES in the same commit as the ' +
        'migration it lands — an unchanged zero after a sweep wave is a RED, not a pass',
    ).toBeGreaterThanOrEqual(EXPECTED_MIN_PRIMITIVES);
  });

  it('skips non-literal level expressions BY RULE, and enumerates the ones it skipped', () => {
    expect(
      SKIPPED_LEVELS.map((s) => `${s.surface}:${s.line}`),
      'a NEW unresolvable level expression must be seen, not absorbed. See PROP_SEAM_EXPRESSION ' +
        'for why resolving them is the wrong answer rather than the harder one.',
    ).toEqual(['app/components/CalendarListView.js:866']);
  });

  it('counts class-less headings and ignores heading tags in comments (defects 1 + 4, coupled)', () => {
    const scanned = scanFixture('fixture/comments.tsx', FIXTURE_COMMENTS_AND_CLASSLESS);
    expect(
      scanned.map((h) => `h${h.level} "${h.className}"`),
      'the four heading tags inside comments must count for nothing, and the class-less <h4> ' +
        'must count for one — `app/global-error.tsx:66` is exactly that shape',
    ).toEqual(['h4 ""', 'h2 "text-xl font-bold"']);
  });

  it('sees arbitrary size values without false-positiving arbitrary PROPERTIES', () => {
    // Defect 2's negative control, both polarities.
    expect(OUT_OF_SET_SIZE.test('text-[10px]')).toBe(true);
    expect(OUT_OF_SET_SIZE.test('text-[1.1rem]')).toBe(true);
    expect(OUT_OF_SET_SIZE.test('text-[9px]')).toBe(true);
    // An arbitrary value is by definition OFF the rung set.
    expect(IN_SET_SIZE.test('text-[10px]')).toBe(false);
    // `app/groupHomePage/page.js:668` — a page title already on the 30/700 rung.
    expect(OUT_OF_SET_SIZE.test('[text-shadow:var(--t-shadow-l)]')).toBe(false);
    expect(OUT_OF_SET_SIZE.test('dark:[text-shadow:var(--t-shadow)]')).toBe(false);
    expect(OUT_OF_SET_SIZE.test('[-webkit-text-stroke:var(--t-stroke-l)]')).toBe(false);
    // The four rungs, and nothing else.
    expect(IN_SET_SIZE.test('text-xs')).toBe(false);
    expect(OUT_OF_SET_SIZE.test('text-xs')).toBe(true);
  });

  it('pairs no heading with font-semibold at any size', () => {
    // OVERRIDE — ALL THREE kinds. `cn` last-wins (`88.6-03-PLAN.md:79`) makes a caller
    // `font-semibold` on a `<Heading>` a real 600 override of the cva base.
    const offenders = ALL.filter((h) => /\bfont-semibold\b/.test(h.className));
    expect(
      assertExactCounts(HEADING_SEMIBOLD_ROSTER, countByFile(offenders)),
      'UI-SPEC §4.2 states 600 as a PROHIBITION, and D-01 gives it exactly one home — the ' +
        `Button primitive. Headings are 700. Offenders: ${JSON.stringify(offenders.map(describeHeading), null, 1)}`,
    ).toEqual([]);
  });

  it('gives every RAW heading the 700 weight explicitly', () => {
    // SUPPLY — RAW ONLY. Plan 03's cva base is `font-bold` (`88.6-03-PLAN.md:152`), so a
    // migrated call site's own className carries no weight and would be a NEW offender on
    // a rule it satisfies through the primitive. PRIMITIVE-SIDE ARM: the property is not
    // dropped, it moves — plan 03's `Heading.test.tsx` pins the base weight, and the
    // fixture below proves a compliant primitive is not flagged here.
    const offenders = RAW.filter((h) => !/\bfont-bold\b/.test(h.className));
    expect(
      assertExactCounts(HEADING_WEIGHT_ROSTER, countByFile(offenders)),
      'a heading with no weight utility inherits body weight — §4.2 requires 700 to be stated. ' +
        `Offenders: ${JSON.stringify(offenders.map(describeHeading), null, 1)}`,
    ).toEqual([]);

    const compliantPrimitive = scanFixture('fixture/compliant.tsx', FIXTURE_COMPLIANT_PRIMITIVE);
    expect(compliantPrimitive.filter((h) => h.kind === 'raw')).toEqual([]);
    expect(compliantPrimitive.map((h) => h.level)).toEqual([2]);
  });

  it('keeps EVERY heading inside the 4-size working set — there are now no exemptions', () => {
    // ONE assertion, TWO arms, TWO buckets. Record that split HERE, or a reader applies
    // one bucket to both arms:
    //   - the OUT-OF-SET arm is an OVERRIDE rule and covers ALL THREE kinds, because a
    //     caller `text-2xl` on a `<Heading>` is a real 24px override;
    //   - the NO-SIZE-UTILITY arm is a SUPPLY rule and is RAW-ONLY, because the primitive's
    //     `size` variant supplies the rung and a migrated call site legitimately carries no
    //     size utility of its own.
    //
    // The `D39_REVIEWS_EXEMPTION` filter that used to sit here is gone, not disabled: the
    // owner converged the one heading it covered on 2026-08-05 (DEF-88-24-02).
    const offenders = ALL.filter(
      (h) =>
        OUT_OF_SET_SIZE.test(h.className) || (h.kind === 'raw' && !IN_SET_SIZE.test(h.className)),
    );
    expect(
      assertExactCounts(RUNG_ROSTER, countByFile(offenders)),
      'the point of a 4-size working set (14/16/20/30) is that a fifth size cannot creep back ' +
        'in. A heading with NO size utility is equally an offender — it renders at body size. ' +
        `Offenders: ${JSON.stringify(offenders.map(describeHeading), null, 1)}`,
    ).toEqual([]);

    // Both polarities of the split, proven here rather than discovered in wave 8.
    const compliant = scanFixture('fixture/compliant.tsx', FIXTURE_COMPLIANT_PRIMITIVE);
    expect(
      compliant.filter((h) => OUT_OF_SET_SIZE.test(h.className) || (h.kind === 'raw' && !IN_SET_SIZE.test(h.className))),
      'a primitive heading that supplies its rung through the `size` variant and carries only a ' +
        'colour utility must NOT be flagged',
    ).toEqual([]);

    const overridden = scanFixture('fixture/override.tsx', FIXTURE_PRIMITIVE_CALLER_OVERRIDE);
    expect(
      overridden.filter((h) => OUT_OF_SET_SIZE.test(h.className)).map((h) => h.level),
      'a caller className carrying an out-of-set size on a `<Heading>` IS a real override',
    ).toEqual([2]);
  });

  it("holds gameDetail's Reviews h2 at the converged 20/700 rung (DEF-88-24-02, owner ruling)", () => {
    // Replaces 88-24's exemption COUNT pin. That pin's job was to stop the D-39
    // exemption being bulldozed by a sweep or reused as cover for a second `text-2xl`;
    // the owner has since reopened D-39 himself and converged the heading, so the
    // property to pin is the converged state.
    //
    // Anti-vacuity, and it is the point of naming the heading rather than its class:
    // find it by TEXT first and assert it exists. If the Reviews heading is renamed,
    // removed, or moved off this surface, this test fails loudly instead of quietly
    // asserting nothing about a heading that is no longer there.
    //
    // AMENDED Phase 88.6-11 — SUPPLY bucket, and scanned TREE-WIDE. Tree-wide plus
    // exactly-one is strictly STRONGER than the one-file scan it replaces: it also reds if
    // the heading MOVES surface, which a one-file scan reports as plain absence. The rung
    // and weight are accepted in the raw form OR through the primitive, because the inner
    // text extractor now closes on `</Heading>` too — without that, a migrated Reviews
    // heading reads as empty inner text, this predicate finds nothing, and the exactly-one
    // floor reds BEFORE the size and weight assertions are reached, quietly deleting the
    // owner's 2026-08-05 convergence instead of carrying it through the migration.
    const found = ALL.filter(REVIEWS_HEADING);
    expect(
      found.length,
      `expected exactly one "Reviews (…)" heading on gameDetail, found: ${JSON.stringify(found.map(describeHeading))}`,
    ).toBe(1);

    const heading = found[0];
    expect(heading.level, 'Reviews is a section heading, a sibling of Game Sessions').toBe(2);
    expect(
      isSectionRung(heading),
      'Owner ruling 2026-08-05 (DEF-88-24-02): "make it match the same size as all other ' +
        'headings." This h2 was `text-2xl` under DECISION Phase 88-11 (D-39); the owner ' +
        'REOPENED that ruling and converged it to the 20/700 section-heading rung every other ' +
        `h2 on this surface uses. Found: ${describeHeading(heading)}`,
    ).toBe(true);
    expect(isBoldWeight(heading), describeHeading(heading)).toBe(true);
  });

  it('gives no heading a breakpoint-prefixed size', () => {
    // OVERRIDE — ALL THREE kinds. Found by negative-checking the working-set test:
    // `text-2xl md:text-3xl` is caught (text-2xl is out of set), but `text-xl md:text-3xl`
    // would slip through BOTH that test and the h1 test, because every size in it is
    // in-set. A heading that changes size at a breakpoint is a second scale whichever
    // sizes it uses — that is the property, so assert it directly rather than by side
    // effect.
    //
    // The roster is SEEDED, not discovered.
    const offenders = ALL.filter((h) => BREAKPOINT_SIZE.test(h.className));
    expect(
      assertExactCounts(BREAKPOINT_ROSTER, countByFile(offenders)),
      '88-19 removed the md:-prefixed heading sizes from userProfile and 88-24 removed the last ' +
        'one (groupHomePage\'s h1) for this reason. Pick ONE rung from the working set. ' +
        `Offenders: ${JSON.stringify(offenders.map(describeHeading), null, 1)}`,
    ).toEqual([]);
  });

  it('renders exactly one h1 per PAGE surface, at the 30/700 Display role', () => {
    // gameDetail and friends each render their h1 in several mutually-exclusive
    // branches (event view / game view; loading / error / loaded), so the assertion is
    // per-h1 rather than a count — every branch's title must be Display.
    //
    // AMENDED Phase 88-29 (DEF-88-19-03): scoped to the four PAGE surfaces, because the
    // fifth surface added above is a PRIMITIVE and its `<h1>` is deliberately not a page
    // title. `ErrorFallback` renders a 20px card heading that happens to be the only
    // heading on a crashed boundary — `<h1>` for the document OUTLINE, 20px for the type
    // ROLE. That is the same split `EmptyState` shipped under DEF-88-09-01, whose marker
    // records why level and size must not be one prop ("coupling them would let a caller
    // silently demote the 404's type by asking for the right outline"). Growing it to
    // `text-3xl` to satisfy this assertion would be that exact demotion in reverse, on
    // nine error boundaries at once. The Display rule is about page titles; keep it there.
    //
    // AMENDED Phase 88.6-11: Phase 88.6 widened this file to all of `src/` and DELIBERATELY
    // did NOT widen this assertion, for the reason above — it is a rule about PAGE TITLES,
    // per-h1 rather than a count, and growing `ErrorFallback.tsx`'s `<h1>` to 30 to satisfy
    // a tree-wide version would be that same demotion in reverse on nine error boundaries
    // at once. This is the single most likely "cleanup" a later widening pass makes; it is
    // a decision, not an oversight. The ONLY changes here are the canonical key space, the
    // examined-count floor, and the primitive arm of `isDisplayRung`.
    const pageTitles = ALL.filter(
      (h) => h.level === 1 && (PAGE_SURFACES as readonly string[]).includes(h.surface),
    );
    // FOUND-COUNT FLOOR: an assertion that filters down to a named set must also assert how
    // many it examined, so a key-space mismatch reds rather than passing over zero subjects.
    expect(
      pageTitles.length,
      'expected at least one page title per PAGE_SURFACE — a key-space mismatch would empty ' +
        'this filter and pass vacuously',
    ).toBeGreaterThanOrEqual(PAGE_SURFACES.length);

    const offenders = pageTitles.filter((h) => !isDisplayRung(h)).map(describeHeading);
    expect(
      offenders,
      'page titles are 30/700. A breakpoint-grown title (`text-2xl md:text-3xl`) is a SECOND ' +
        'type scale, which is why 88-24 removed the one on groupHomePage.',
    ).toEqual([]);

    // Primitive polarity: a page-title h1 rendered through the primitive but pinned off the
    // display rung by its caller IS flagged.
    const offRung = scanFixture('fixture/title.tsx', FIXTURE_PRIMITIVE_PAGE_TITLE_OFF_RUNG);
    expect(offRung.map((h) => h.level), 'an id-bearing `<Heading id=… level={1}>` must be seen — ' +
      'the matcher is attribute-order agnostic').toEqual([1]);
    expect(offRung.filter((h) => !isDisplayRung(h)).length).toBe(1);
  });
});


// ===========================================================================
// P4 — the per-file per-level heading count, before == after.
// ===========================================================================

/**
 * THE CONTRACT for every Phase 88.6 sweep: no heading's semantic LEVEL changes.
 *
 * Seeded by RUNNING the scanner above at this plan's commit — not transcribed from
 * `88.6-CONTEXT.md` D-04, not from `88.6-RESEARCH.md` §B.3. Those are leads. The seed is
 * the measurement: 140 headings across 44 files (h1 44, h2 48, h3 39, h4 5, h5 2, h6 2),
 * over all three `kind`s. The RAW `<hN>` half of that is 135 across 43 files
 * (h1 43, h2 48, h3 39, h4 5, zero literal h5/h6) — two populations, two numbers; one
 * number cannot describe both.
 *
 * EDITING THIS MAP IS A DECISION, NOT A ROUTINE REBASE. A sweep that legitimately changes
 * a heading's level — only an R7 `heading-order` audit fix may — updates the map in the
 * SAME commit, with a comment naming the audit finding. A map edited to absorb an
 * unintended level change is exactly the repudiation T-88.6-25 names.
 *
 * WHICH PLANS MAY INVOKE THAT ESCAPE HATCH is a set DERIVED AT EXECUTION, not a fixed
 * pair. The derivation command is the `//` line immediately below this docblock (it cannot
 * live inside a block comment — the glob contains the comment terminator). Run it, then
 * keep the ones that actually RUN an audit. Members re-measured 2026-09-14: plans
 * 15 (`:556`), 16 (`:525`), 22 (`:569`, `:582`), 44 (`:65`) and 45 (`:83`, `:108`) — FIVE.
 * Plan 46 is NOT one of them (it mentions `heading-order` nowhere and runs no audit), and
 * plan 03 (`:138`) is not either — it only records that such a smoke is NOT wanted in the
 * primitive's own suite. An earlier "plans 45-46" wording granted the hatch to a plan that
 * can never use it while reading, to a plan-44 or plan-22 executor holding a real outline
 * finding, as a prohibition on fixing it. Do not re-break that correction.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS MAP DOES NOT COVER — THREE paths. "before == after" is a LEVEL-POPULATION
 * pin, NOT an outline guarantee.
 * ---------------------------------------------------------------------------
 *
 * 1. COMPONENT-DEFAULT heading levels. The scanner sees only call sites that pass a
 *    LITERAL level prop, so a change to a component's DEFAULT level is a real level change
 *    this map cannot see. Verified cases: `EmptyState`'s `'h3'` default
 *    (`components/ui/EmptyState.tsx:96`, `DECISION Phase 88-18 (DEF-88-09-01)`), relied on
 *    by NINE of its ten call sites — only `app/not-found.tsx:36` passes the prop, so nine
 *    real `<h3>`s in the DOM are counted as zero; `CalendarListView`'s `DateGroup` `'h4'`
 *    default (`:849`) and `EventRow` `'h5'` default (`:889`).
 *
 *    REJECTED: teaching the scanner an in-file `{ component -> default level }` map, with
 *    a fixture asserting a bare `<EmptyState>` counts as one h3. It would close the gap,
 *    but it is the same cross-file resolution plan 09 already declares a blind spot.
 *    Declaring the gap is the cheaper option and this plan takes it.
 *
 * 2. NON-LITERAL level expressions, which the scanner SKIPS by rule.
 *    `app/components/CalendarListView.js:866` (`headingLevel={rowHeadingLevel}`) is the one
 *    live instance. It is uncounted ON PURPOSE: resolving it from `EventRow`'s `'h5'`
 *    default would record an h5 the DOM never renders, while both real call sites pass
 *    `rowHeadingLevel="h6"`. The number would be wrong in this map's own units. Nothing is
 *    lost by skipping it — BOTH of its ends (`:632`, `:657`) are counted as seams — so the
 *    gap is scoped, not open-ended.
 *
 * 3. A MULTISET-PRESERVING LEVEL SWAP. This is a per-file per-level COUNT, so any edit that
 *    preserves the multiset is invisible to it. Swapping an `<h2>` and an `<h3>` inside one
 *    file, or promoting one heading while demoting another in the same file, leaves
 *    `{h2: n, h3: m}` identical while the document OUTLINE changes — which is the property
 *    P4 is read as protecting. The mandated violation fixture does NOT surface this either:
 *    it is "one `<h2>` changed to `<h3>`", which DOES move the counts. The only cover is
 *    R7's `heading-order` audit, and that runs on the enumerated modal surfaces, not on the
 *    43 files this map spans.
 *
 *    REJECTED, on a CONSEQUENCE rather than on bookkeeping: an ORDERED per-file sequence
 *    (`['h1','h2','h3','h3','h2']` rather than a count map) is on the merits the BETTER pin
 *    — each heading already carries its source line, so ordering costs nothing and detects
 *    a swap outright. It is rejected because an ordered pin REDS on a pure JSX REORDER that
 *    changes no level, and 20 sweep plans reorder JSX: it would put a false red in front of
 *    20 executors on a gate 31 plan files name in a verify block. Declaring the gap is the
 *    cheaper correct option.
 */
// Derivation of the audit-running plan set (see the docblock above):
//   grep -ln 'heading-order' .planning/phases/88.6-*/88.6-*-PLAN.md
const EXPECTED_LEVELS: Record<string, Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>>> = {
  'app/about/page.js': { 1: 1, 2: 5 },
  'app/availability-form/[token]/page.js': { 1: 3 },
  'app/components/BallotOptionsEditor.js': { 3: 1 },
  'app/components/BallotSection.js': { 3: 6 },
  'app/components/BringSummary.js': { 3: 1 },
  'app/components/CalendarListView.js': { 3: 2, 4: 2, 5: 2, 6: 2 },
  'app/components/CalendarMonthView.js': { 3: 1 },
  'app/components/DangerZoneDeleteAccount.tsx': { 2: 1 },
  'app/components/EmailAddressSection.tsx': { 2: 3 },
  'app/components/EventCalendar.js': { 2: 2 },
  'app/components/EventDayModal.js': { 4: 1 },
  'app/components/FriendInvitePanel.js': { 3: 3 },
  'app/components/GroupGamesList.js': { 2: 2, 3: 1 },
  'app/components/GroupSettings.js': { 3: 4 },
  'app/components/LandingPage.js': { 1: 1, 2: 1, 3: 3 },
  'app/components/ManageMembers.js': { 3: 2 },
  'app/components/NotificationBell.js': { 3: 1 },
  'app/components/PromptScheduleManager.js': { 3: 1 },
  'app/components/PromptScheduleReadOnly.js': { 3: 1 },
  'app/components/ResponseDashboard.js': { 3: 1 },
  'app/components/RsvpSection.js': { 3: 1 },
  'app/components/ScheduleList.js': { 3: 1 },
  'app/components/UpcomingEventsCard.js': { 3: 1 },
  'app/components/grouplist.js': { 2: 2, 3: 1 },
  'app/components/tutorial/WelcomeSlide.js': { 1: 1 },
  'app/components/tutorial/simulated/AvailabilityPromptDemo.js': { 3: 1 },
  'app/components/tutorial/simulated/ProblemSlide.js': { 2: 1 },
  'app/friends/page.js': { 1: 4, 2: 1 },
  'app/gameDetail/page.js': { 1: 3, 2: 5, 3: 1 },
  'app/global-error.tsx': { 1: 1 },
  'app/goodbye/page.tsx': { 1: 2 },
  'app/groupHomePage/page.js': { 1: 1 },
  'app/groupPlanning/page.js': { 1: 1, 2: 1, 3: 1 },
  'app/invite/accept/page.js': { 1: 3 },
  'app/invite/game/[token]/page.js': { 1: 6 },
  'app/invite/group/[token]/page.js': { 1: 4 },
  'app/not-found.tsx': { 1: 1 },
  'app/privacy/page.js': { 1: 1, 2: 8 },
  'app/restore/group/[token]/page.tsx': { 1: 4 },
  'app/rsvp/[token]/page.js': { 1: 3 },
  'app/terms/page.js': { 1: 1, 2: 8 },
  'app/userProfile/page.js': { 1: 1, 2: 7, 3: 4, 4: 2 },
  'components/ui/ErrorFallback.tsx': { 1: 1 },
};

const LEVELS = [1, 2, 3, 4, 5, 6] as const;

function levelCounts(hs: readonly Heading[]): Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>> {
  const out: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>> = {};
  for (const h of hs) {
    const lvl = h.level as 1 | 2 | 3 | 4 | 5 | 6;
    out[lvl] = (out[lvl] ?? 0) + 1;
  }
  return out;
}

/**
 * The before==after comparison, used by BOTH the tree-wide assertion and the two P4
 * fixtures — one implementation, so the fixtures exercise the real comparison rather than
 * a copy of it.
 */
function compareLevels(
  file: string,
  expected: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>>,
  actual: Partial<Record<1 | 2 | 3 | 4 | 5 | 6, number>>,
): string[] {
  const out: string[] = [];
  for (const lvl of LEVELS) {
    const e = expected[lvl] ?? 0;
    const a = actual[lvl] ?? 0;
    if (e !== a) out.push(`${file} h${lvl}: EXPECTED_LEVELS says ${e}, scanner found ${a}`);
  }
  return out;
}

/** P4's mandated clean fixture. */
const FIXTURE_P4_CLEAN = `
  export const Page = () => (
    <article>
      <h1 className="text-3xl font-bold">Title</h1>
      <h2 className="text-xl font-bold">One</h2>
      <h3 className="text-base font-bold">Detail</h3>
      <h2 className="text-xl font-bold">Two</h2>
    </article>
  );
`;

/** P4's mandated violation fixture: ONE `<h2>` changed to `<h3>`. */
const FIXTURE_P4_VIOLATION = FIXTURE_P4_CLEAN.replace(
  '<h2 className="text-xl font-bold">Two</h2>',
  '<h3 className="text-xl font-bold">Two</h3>',
);

// ===========================================================================
// D-01 — the arbitrary-value size fold.
// ===========================================================================

/**
 * An arbitrary px/rem size value. This is a FILE-LEVEL site scan, not a consumer of the
 * scanned heading set, so task 1's `headings()` comment-stripping fix does NOT reach it —
 * it reads `FILES[].stripped` directly and has its own negative control below. Without
 * that, a commented-out or documented `text-[10px]` becomes a roster entry no sweep can
 * ever decrement.
 */
const ARBITRARY_SIZE_SITE = /\btext-\[(\d+(?:\.\d+)?)(px|rem)\]/g;

/** 12px is the tree-wide FLOOR (UI-SPEC §4.6). 0.75rem at a 16px root is the same 12px. */
const PX_FLOOR = 12;

interface SizeSite {
  surface: string;
  line: number;
  raw: string;
  px: number;
}

function scanArbitrarySizes(surface: string, stripped: string): SizeSite[] {
  const out: SizeSite[] = [];
  ARBITRARY_SIZE_SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = ARBITRARY_SIZE_SITE.exec(stripped)) !== null) {
    out.push({
      surface,
      line: lineAt(stripped, m.index),
      raw: m[0],
      px: m[2] === 'rem' ? Number(m[1]) * 16 : Number(m[1]),
    });
  }
  return out;
}

const ARBITRARY_SIZES: readonly SizeSite[] = FILES.flatMap((f) =>
  scanArbitrarySizes(f.key, f.stripped),
);

/**
 * Seeded from the live COMMENT-STRIPPED run at this plan's commit: 31 arbitrary px/rem
 * size values across 11 files, of which 30 are below the 12px floor (the population D-01
 * folds up) and one is `app/components/grouplist.js:456`'s `text-[1.1rem]` (17.6px, on the
 * h3 whose tag opens at `:455`). The rule scans EVERY arbitrary px/rem value rather than
 * only the sub-12px ones, because an arbitrary value is off the rung set by definition —
 * that is also what makes the 31-site seed exact rather than a 30-site seed with an
 * unowned straggler. Plans 26 and 27 shrink this as the fold lands.
 */
const ARBITRARY_SIZE_ROSTER: ExemptionRoster = {
  'app/components/CalendarMonthView.js': {
    sites: 1,
    why:
      '1 arbitrary size value (text-[10px]@651), 1 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/ClickableMemberName.js': {
    sites: 2,
    why:
      '2 arbitrary size values (text-[10px]@169, text-[10px]@178), 2 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/EventHeatmapBackground.js': {
    sites: 7,
    why:
      '7 arbitrary size values (text-[10px]@224, text-[10px]@240, text-[11px]@280, text-[9px]@291, text-[9px]@298, text-[10px]@306, text-[11px]@316), 7 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/SchedulerWeekStrip.tsx': {
    sites: 2,
    why:
      '2 arbitrary size values (text-[10px]@196, text-[10px]@208), 2 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/UpcomingEventsCard.js': {
    sites: 1,
    why:
      '1 arbitrary size value (text-[10px]@256), 1 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/tutorial/simulated/AvailabilityPromptDemo.js': {
    sites: 1,
    why:
      '1 arbitrary size value (text-[10px]@72), 1 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/tutorial/simulated/CheckInDemo.js': {
    sites: 3,
    why:
      '3 arbitrary size values (text-[10px]@41, text-[10px]@77, text-[10px]@81), 3 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/tutorial/simulated/HeatmapDemo.js': {
    sites: 1,
    why:
      '1 arbitrary size value (text-[10px]@75), 1 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  'app/components/tutorial/simulated/TutorialGrid.js': {
    sites: 2,
    why:
      '2 arbitrary size values (text-[10px]@40, text-[10px]@63), 2 of them below the 12px floor — D-01 folds the sub-12px sites up onto the caption rung; an arbitrary value is off the rung set by definition',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / D-01' },
  },
  // `app/gameDetail/page.js` CLOSED by plan 88.6-18 task 3 (wave 7, 2026-09-16): all TEN
  // `text-[10px]` sites folded UP to `text-xs` (12), D-01's own fold target. Every one of them
  // is a badge or pill label — an ENUMERATED caption role in §4.2 — so 12 is their destination
  // and not a way-station. Entry DELETED rather than zeroed; the roster is exact in both
  // directions. Reflow at 375px was MEASURED rather than assumed — see 88.6-18-SUMMARY.md.
};

/**
 * The sub-12px SUBSET — D-01's actual fold target, asserted so it shrinks visibly.
 *
 * 30 -> 20, plan 88.6-18 task 3 (wave 7, 2026-09-16): `app/gameDetail/page.js`'s TEN
 * `text-[10px]` badge and pill labels folded up onto the caption rung in one commit, and its
 * roster entry was deleted with them. This is an EXACT equality, not a floor, so the shrink is
 * a deliberate edit in the same commit as the fold — which is the point.
 */
const EXPECTED_SUB_FLOOR_SITES = 20;

/** Negative control for the strip on THIS file-level scan. */
const FIXTURE_ARBITRARY_COMMENTS = `
  /* A documented text-[10px] inside a block comment counts for nothing. */
  // And a text-[9px] after a line comment likewise.
  export const E = () => <span className="text-[11px]">real</span>;
`;

describe('SPEC-88.6 P4 + D-01: heading levels are pinned and arbitrary sizes are rostered', () => {
  it('pins the per-file per-level heading count — before == after (P4)', () => {
    const violations: string[] = [];

    for (const [file, expected] of Object.entries(EXPECTED_LEVELS)) {
      const hs = BY_FILE.get(file);
      if (!hs) {
        violations.push(
          `${file} — in EXPECTED_LEVELS but the scanner found NO headings there; a file that ` +
            `disappears from the map is a failure, not a pass`,
        );
        continue;
      }
      violations.push(...compareLevels(file, expected, levelCounts(hs)));
    }
    for (const file of BY_FILE.keys()) {
      if (!(file in EXPECTED_LEVELS)) {
        violations.push(
          `${file} — headings found in a file ABSENT from EXPECTED_LEVELS; a file absent from ` +
            `the map must have zero headings`,
        );
      }
    }

    expect(
      violations,
      'EXPECTED_LEVELS is the CONTRACT: no Phase 88.6 sweep changes a heading LEVEL. If a ' +
        'level genuinely must move, it moves because an R7 heading-order audit found an ' +
        'outline violation — update the map in the SAME commit with a comment naming the ' +
        'finding. Read the constant docblock before editing it.',
    ).toEqual([]);
  });

  it('proves the level comparison can FAIL — both P4 fixtures, both polarities', () => {
    const clean = levelCounts(scanFixture('fixture/p4-clean.tsx', FIXTURE_P4_CLEAN));
    expect(clean, 'the clean fixture is the baseline the violation is measured against').toEqual({
      1: 1,
      2: 2,
      3: 1,
    });

    // check_clean_fixture — the comparison must report NOTHING.
    expect(compareLevels('fixture/p4-clean.tsx', clean, clean)).toEqual([]);

    // check_violation_fixture — one <h2> changed to <h3>; the comparison MUST report it.
    const violated = levelCounts(scanFixture('fixture/p4-violation.tsx', FIXTURE_P4_VIOLATION));
    expect(compareLevels('fixture/p4-violation.tsx', clean, violated)).toEqual([
      'fixture/p4-violation.tsx h2: EXPECTED_LEVELS says 2, scanner found 1',
      'fixture/p4-violation.tsx h3: EXPECTED_LEVELS says 1, scanner found 2',
    ]);
  });

  it('rosters every arbitrary px/rem size value, reading COMMENT-STRIPPED source (D-01)', () => {
    const byFile: Record<string, number> = {};
    for (const s of ARBITRARY_SIZES) byFile[s.surface] = (byFile[s.surface] ?? 0) + 1;

    expect(
      assertExactCounts(ARBITRARY_SIZE_ROSTER, byFile),
      'an arbitrary size value is off the 4-size working set by definition. Sites: ' +
        JSON.stringify(
          ARBITRARY_SIZES.map((s) => `${s.surface}:${s.line} ${s.raw}`),
          null,
          1,
        ),
    ).toEqual([]);

    const belowFloor = ARBITRARY_SIZES.filter((s) => s.px < PX_FLOOR);
    expect(
      belowFloor.length,
      'D-01 folds the sub-12px arbitrary values up onto the caption rung. This number must ' +
        'SHRINK as plans 26 and 27 land; raising it is a new violation, not a rebase.',
    ).toBe(EXPECTED_SUB_FLOOR_SITES);
  });

  it('does not count an arbitrary size value written in a comment (negative control)', () => {
    const scanned = scanArbitrarySizes(
      'fixture/arbitrary-comments.tsx',
      withoutComments(FIXTURE_ARBITRARY_COMMENTS),
    );
    expect(
      scanned.map((s) => s.raw),
      'a documented or commented-out arbitrary value must never become a roster entry no ' +
        'sweep can decrement',
    ).toEqual(['text-[11px]']);
  });
});


// ===========================================================================
// UI-SPEC §4.2 / §4.5 — the 400/700 weight rule, tree-wide.
// ===========================================================================

/**
 * `.btn` sets `font-weight: 600` UNLAYERED (`src/app/globals.css:2200`, inside the `.btn`
 * block opening at `:2194`), and 600 is the Button label's single legitimate home
 * (UI-SPEC §4.1, D-01). So `components/ui/Button.tsx` is EXCLUDED from the weight scan,
 * not exempted.
 *
 * EXCLUSION IS NOT EXEMPTION (`src/test-utils/exemption.ts:36-43`): an exclusion says
 * "this is the DEFINITION of the thing being scanned for" and never expires; an exemption
 * says "this is DEBT that survived", is counted exactly, and is deleted when its last site
 * closes. Filing the cva base as an exemption would give the definition a fossil
 * permission to grow. `Button.tsx` must therefore never appear in `WEIGHT_ROSTER`, and an
 * assertion below holds that.
 *
 * NOTE ON THE CITE: `88.6-11-PLAN.md` cites `globals.css:1961` for this rule. That line
 * moved when plan 05 landed its cascade work; re-derived 2026-09-15, the unlayered
 * `font-weight: 600` is at `:2200`.
 */
const WEIGHT_SCAN_EXCLUSION = 'components/ui/Button.tsx';

/**
 * A file-level site scan over COMMENT-STRIPPED source. NOT OPTIONAL, and not a copy of
 * task 1's fix: `headings()`'s `withoutComments` is scoped to the scanned heading set, and
 * this rule does not route through it. Without stripping, `src/lib/colorUtils.js:634`
 * ("Callers apply `font-semibold` at the text element.") and `:678` ("driving
 * `font-semibold` at `:481`") — both `font-semibold` inside JSDoc block comments in non-test
 * `src/` — become roster entries NO SWEEP CAN EVER DECREMENT, and any later edit to
 * unrelated comment prose moves the count on a gate 31 plan files name in a verify block.
 *
 * MEASURED, both polarities: 340 sites stripped, 346 unstripped. `colorUtils.js` holds
 * ZERO stripped sites and is absent from the roster below, which is the strip working.
 */
const OFF_SCALE_WEIGHT_SITE = /\bfont-(medium|semibold)\b/g;

interface WeightSite {
  surface: string;
  line: number;
  raw: string;
  context: string;
}

function scanWeights(surface: string, stripped: string): WeightSite[] {
  const out: WeightSite[] = [];
  OFF_SCALE_WEIGHT_SITE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = OFF_SCALE_WEIGHT_SITE.exec(stripped)) !== null) {
    out.push({
      surface,
      line: lineAt(stripped, m.index),
      raw: m[0],
      context: stripped.slice(Math.max(0, m.index - 160), m.index + 80).replace(/\s+/g, ' '),
    });
  }
  return out;
}

const WEIGHT_SITES: readonly WeightSite[] = FILES.filter(
  (f) => f.key !== WEIGHT_SCAN_EXCLUSION,
).flatMap((f) => scanWeights(f.key, f.stripped));

/**
 * Every file carrying an off-scale weight, seeded programmatically from a live
 * COMMENT-STRIPPED run at this plan's commit: 340 sites across 76 files (198 `font-medium`,
 * 142 `font-semibold`), which reproduces `88.6-RESEARCH.md` §B.4 exactly. The largest
 * roster in the phase, so it is written from the scanner's own output rather than by hand.
 *
 * Each `why` carries the §4.5 outcome LEAD (hierarchy -> 700, emphasis -> 400 + a colour
 * token, dead-on-a-`.btn` -> delete) and the plans that name the file. The lead is a lead:
 * the owning sweep confirms it per site against UI-SPEC §4.5.
 *
 * Five of these sites are PERMANENT — see `ARMED_STATE_600_ROSTER`. The two files holding
 * them floor at their armed count rather than at zero, and their `why` says so.
 */
const WEIGHT_ROSTER: ExemptionRoster = {
  'app/Header.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-05, 88.6-12, 88.6-13, 88.6-16, 88.6-31, 88.6-34, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-23 task 3 (wave 7, 2026-09-16): `app/availability-form/[token]/page.js`
  // carried `sites: 3`. Resolved per site against UI-SPEC §4.5 — and note that the entry's own
  // outcome LEAD was wrong on one of them, which is why the rule says the owning sweep confirms
  // per site: the lead named "dead on a .btn (delete)" and this file has NO `.btn` element at all
  // (measured 2026-09-16; it is correctly absent from `btnCensus`'s roster).
  //   - the two `font-semibold` h1s (the ERROR and SUBMITTED branch headings) left with the
  //     `<Heading>` migration — HIERARCHY, 700, now supplied by the primitive's base;
  //   - the one `font-medium`, the "Heads up:" lead-in inside the token-expiry warning, took
  //     HIERARCHY (700) rather than emphasis. The emphasis outcome is "400 + a colour token" and
  //     that span carries no colour of its own — the whole sentence is already
  //     `text-content-status-warning` — so 400 would have erased the lead-in distinction rather
  //     than re-carrying it. Recorded at the site as a decision with 400 named as rejected.
  // Entry DELETED, not zeroed.
  'app/components/AutoPromptBehaviorBanner.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plan: 88.6-34.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/AvailabilityForm.js': {
    sites: 6,
    why:
      '6 off-scale weight sites (5 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-07, 88.6-09, 88.6-10, 88.6-13, 88.6-14, 88.6-23, 88.6-24, 88.6-25, 88.6-42, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/AvailabilityGrid.js': {
    sites: 6,
    why:
      '6 off-scale weight sites (6 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-22, 88.6-25.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-22 task 2 (wave 7, 2026-09-16), both files, every site resolved per
  // UI-SPEC §4.5 rather than swept to one outcome:
  //   `BallotOptionsEditor.js` (1) — h3:9's font-semibold left with the `Heading` migration.
  //   `BallotSection.js` (13) — 6 font-semibold on the h3s left with the `Heading` migration;
  //     :116's pseudo-heading went 600 -> 700 with its §4.3 `text-lg` -> `text-xl` pair; :268's
  //     "Voted" badge ink went 600 -> 700 (the badge case, 400 rejected at the site); and the 5
  //     font-medium sites (:150, :160, :195, :205, :256 — two prompt paragraphs and three choice
  //     buttons) took the EMPHASIS outcome, i.e. the utility deleted with the colour token each
  //     already carried doing the work.
  // Entries DELETED, not zeroed.
  'app/components/BringGamePicker.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-10, 88.6-15, 88.6-33, 88.6-39, 88.6-43, 88.6-44.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/BringSummary.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (1 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-33, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/BrowseMoreModal.js': {
    sites: 4,
    why:
      '4 off-scale weight sites (4 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: dead on a .btn (delete); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-04, 88.6-05, 88.6-06, 88.6-10, 88.6-13, 88.6-32, 88.6-33, 88.6-39, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/CalendarListView.js': {
    sites: 8,
    why:
      '8 off-scale weight sites (0 font-medium, 8 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-03, 88.6-05, 88.6-11, 88.6-12, 88.6-17, 88.6-18, 88.6-22, 88.6-27, 88.6-28, 88.6-29, 88.6-36, 88.6-39, 88.6-41, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/CalendarMonthView.js': {
    sites: 7,
    why:
      '7 off-scale weight sites (4 font-medium, 3 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-05, 88.6-09, 88.6-10, 88.6-12, 88.6-27, 88.6-39, 88.6-40, 88.6-41, 88.6-45, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ClickableMemberName.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (1 font-medium, 2 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-10, 88.6-33, 88.6-34, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/DangerZoneDeleteAccount.tsx': {
    sites: 5,
    why:
      '5 off-scale weight sites (4 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-05, 88.6-08, 88.6-10, 88.6-29, 88.6-30, 88.6-42, 88.6-45.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/EventDayModal.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (0 font-medium, 2 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-01, 88.6-05, 88.6-10, 88.6-12, 88.6-18, 88.6-21, 88.6-27, 88.6-34, 88.6-39, 88.6-41, 88.6-42, 88.6-43, 88.6-44, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/EventHeatmapBackground.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (2 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-26.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/EventResultFields.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (3 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-33.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/EventScheduler.tsx': {
    sites: 3,
    why:
      '3 off-scale weight sites (2 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-09, 88.6-26, 88.6-39, 88.6-40, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/FeedbackButton.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (3 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-05, 88.6-10, 88.6-12, 88.6-13, 88.6-15, 88.6-16, 88.6-31, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/FeedbackForm.js': {
    sites: 4,
    why:
      '4 off-scale weight sites (4 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-05, 88.6-10, 88.6-13, 88.6-18, 88.6-22, 88.6-31, 88.6-32, 88.6-33, 88.6-39, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-22 task 1 (wave 7, 2026-09-16): `app/components/FriendInvitePanel.js`
  // carried `sites: 5` — 3 font-semibold on the h3s (:315, :445, :521), which left with the
  // `Heading` migration, and 2 font-medium (:364 the friend name, :412 the bulk-invite result
  // block), both resolved by §4.5's EMPHASIS outcome: the utility is deleted and the distinction
  // is carried by the colour token each site already had. Plan 22 is this file's sweep owner;
  // the other eleven plans listed in the old `why` touch it for tokens, not weights.
  // Entry DELETED, not zeroed.
  'app/components/GameSuggestionCard.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (1 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-33, 88.6-39.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/GroupGamesList.js': {
    sites: 8,
    why:
      '8 off-scale weight sites (4 font-medium, 4 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-03, 88.6-15, 88.6-17, 88.6-32, 88.6-33.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/GroupLibrary.js': {
    sites: 6,
    why:
      '6 off-scale weight sites (6 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-32, 88.6-39, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/GroupSettings.js': {
    sites: 4,
    why:
      '4 off-scale weight sites (0 font-medium, 4 font-semibold). UI-SPEC §4.5 outcome lead: hierarchy (700) — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-08, 88.6-10, 88.6-13, 88.6-15, 88.6-19, 88.6-20, 88.6-21, 88.6-25, 88.6-30, 88.6-43, 88.6-45, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/HeatmapTooltip.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-26, 88.6-34.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/KebabMenu.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. 1 of these is a PERMANENT armed-state 600 (see ARMED_STATE_600_ROSTER), so this entry floors at 1 rather than at zero. Owning plans: 88.6-11, 88.6-12, 88.6-16, 88.6-17, 88.6-18, 88.6-31.',
    owner: { kind: 'decision', marker: 'DECISION Phase 65-02 EVT-08' },
  },
  'app/components/LandingPage.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-01, 88.6-04, 88.6-10, 88.6-11, 88.6-12, 88.6-21, 88.6-34, 88.6-35, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-19 task 2 (wave 7, 2026-09-16): `app/components/ManageMembers.js`
  // carried `sites: 11` (2 font-medium, 9 font-semibold). ZERO remain, so the entry is deleted
  // rather than decremented. Every call is enumerated in `88.6-19-SUMMARY.md`; the shape of the
  // resolution: the two migrating h3s dropped their weight to `Heading`'s `font-bold` base; the
  // five badge/pill inks (role pill, the two amber count pills, the "Pending" pill, the "Owner"
  // pill) took 700 on UI-SPEC §4.5's pill-ink row, with a DECISION marker at `getRoleBadge`
  // recording that 400-plus-colour was rejected because a 12px label in its own fill would then
  // be distinguished by colour alone; the three row primary strings (both member names and the
  // invite email) took 700 as the SUBJECT of their block; and the one emphasis span — the "(You)"
  // self-marker — dropped to 400, which is §4.5's emphasis outcome verbatim ("400 + a colour
  // token"), its `text-content-accent` being that token. None of these generalises: D-03 is a
  // recorded CONSEQUENCE constraint and every row above is a named per-site call.
  'app/components/MemberChipStack.tsx': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-09, 88.6-28.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/MemberSelector.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-33.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/NextGameNightCard.tsx': {
    sites: 3,
    why:
      '3 off-scale weight sites (2 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-11, 88.6-13, 88.6-16, 88.6-17, 88.6-18, 88.6-22, 88.6-27, 88.6-28, 88.6-29, 88.6-30, 88.6-32, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/NotificationBell.js': {
    sites: 5,
    why:
      '5 off-scale weight sites (1 font-medium, 4 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-10, 88.6-31, 88.6-34, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/OpenPollsList.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-07, 88.6-10, 88.6-13, 88.6-14, 88.6-15, 88.6-16, 88.6-19, 88.6-20, 88.6-22, 88.6-25, 88.6-31, 88.6-32, 88.6-33.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ParticipantRow.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-29.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-15 (2026-09-16): `app/components/PromptScheduleManager.js` carried
  // `sites: 1` (0 font-medium, 1 font-semibold). The §4.5 outcome lead was HIERARCHY (700) and
  // that is what landed — not as a `font-bold` utility at the call site, but by migrating the
  // h3 onto `<Heading>`, whose cva base is `font-bold`. Zero off-scale weight sites remain in
  // the file, so the entry is deleted rather than zeroed.
  // DELETED by plan 88.6-15 (2026-09-16), both entries, both outcomes CONFIRMED per site
  // against UI-SPEC §4.5 rather than taken from the lead:
  //   `app/components/PromptScheduleReadOnly.js` (was `sites: 2`) — h3:46 `font-semibold` was
  //   HIERARCHY and landed as 700 by migrating onto `<Heading>` (cva base `font-bold`); the
  //   `:72` link's `font-medium` was EMPHASIS and DELETED with no look delta, because the anchor
  //   already carries `text-content-link` (§4.5's stated emphasis outcome: 400 + a colour token,
  //   and the colour token was already there).
  //   `app/components/PromptScheduleSection.js` (was `sites: 3`) — the `Check-ins` title span
  //   (`font-medium` -> `font-bold`, HIERARCHY: it is the section title) and the TWO header
  //   chips (`font-medium` -> `font-bold`, §4.5's pill/chip row: 400 is rejected for a filled
  //   chip because the fill/ink pairing needs the weight). Markers at both sites.
  // Zero off-scale weight sites remain in either file, so both entries are deleted, not zeroed.
  'app/components/QRCodeModal.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-33, 88.6-34, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ResponseDashboard.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: hierarchy (700) — confirmed per site by the owning sweep. Owning plans: 88.6-13, 88.6-32, 88.6-33, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/RsvpCount.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (3 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-29.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/RsvpSection.js': {
    sites: 7,
    why:
      '7 off-scale weight sites (5 font-medium, 2 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-11, 88.6-22, 88.6-28, 88.6-29, 88.6-30, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ScheduleForm.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-13, 88.6-15, 88.6-32, 88.6-33, 88.6-37, 88.6-39, 88.6-43, 88.6-44, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ScheduleList.js': {
    sites: 8,
    why:
      '8 off-scale weight sites (7 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-16, 88.6-32.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/SchedulerWeekStrip.tsx': {
    sites: 2,
    why:
      '2 off-scale weight sites (1 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-26, 88.6-40.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-22 task 2 (wave 7, 2026-09-16): `app/components/StartPollModal.js`
  // carried `sites: 4` — its four form `<label>`s (:186, :204, :231, :251), all
  // `block text-sm font-medium text-content-primary mb-1`. All four now read `font-normal`,
  // which is the shipped field primitive's own spelling (`FormField.tsx:98`), so the modal
  // converges onto the label treatment the rest of the app already uses rather than onto a
  // deletion. Entry DELETED, not zeroed.
  'app/components/SuggestionCard.js': {
    sites: 3,
    why:
      '3 off-scale weight sites (2 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-02, 88.6-05, 88.6-09, 88.6-13, 88.6-14, 88.6-33, 88.6-39, 88.6-42, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/ThresholdSlider.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-22, 88.6-23, 88.6-25, 88.6-44.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/TimezoneNudgeBanner.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-26, 88.6-39.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/UpcomingCountPill.tsx': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-28.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/UpcomingEventsCard.js': {
    sites: 1,
    why:
      '1 off-scale weight site (1 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: hierarchy (700) — confirmed per site by the owning sweep. Owning plans: 88.6-11, 88.6-28, 88.6-43.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/createEvent.js': {
    sites: 10,
    why:
      '10 off-scale weight sites (10 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-07, 88.6-10, 88.6-13, 88.6-22, 88.6-25, 88.6-37, 88.6-39, 88.6-43, 88.6-44.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // `app/components/grouplist.js` CLOSED by plan 88.6-21 (wave 7, 2026-09-16), all three sites,
  // each resolving to a DIFFERENT §4.5 outcome — which is why the entry could not be closed by
  // one rule:
  //   - the group-name h3's `font-semibold` LEFT with the heading (now
  //     `<Heading level={3} size="heading">`, 700 from the primitive's base);
  //   - the players pill's went 600 -> 700, §4.5's pill-ink row, with a DECISION marker at the
  //     site recording that "400 + a colour token" was rejected because a 12px label in its own
  //     saturated fill needs the weight;
  //   - the card's `cardTextBold` flag went 600 -> 700. That one is a LEGIBILITY device, not
  //     hierarchy: `getTextStyle`'s image branch sets it so a title over an arbitrary photograph
  //     stays readable, so dropping it to 400 would have deleted an affordance rather than
  //     normalising a scale.
  // Entry DELETED rather than zeroed; the roster is exact in both directions.
  'app/components/heatmap/WeekGrid.tsx': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-25, 88.6-26, 88.6-40, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/TutorialOverlay.js': {
    sites: 9,
    why:
      '9 off-scale weight sites (4 font-medium, 5 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/WelcomeSlide.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-10, 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/simulated/AvailabilityPromptDemo.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-12, 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/simulated/CheckInDemo.js': {
    sites: 5,
    why:
      '5 off-scale weight sites (2 font-medium, 3 font-semibold). UI-SPEC §4.5 outcome leads: outcome set by the owning sweep; dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plan: 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/simulated/ProblemSlide.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (0 font-medium, 2 font-semibold). UI-SPEC §4.5 outcome leads: hierarchy (700); outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/simulated/ScheduleDemo.js': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/components/tutorial/simulated/TutorialGrid.js': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-35.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/friends/page.js': {
    // 12 -> 1, plan 88.6-19 task 3, wave 7, 2026-09-16. The ONE survivor is the ARMED-STATE 600
    // on the two-tap remove-friend control, which UI-SPEC §4.5 rules STAYS ("Armed-state 600 on
    // two-tap buttons — Button-owned"). It is the same named carve-out plan 88.6-17 kept five of
    // and plan 88.6-18 kept one of, and it is NOT a licence for 600 anywhere else in this file.
    // Everything else resolved, each call enumerated in `88.6-19-SUMMARY.md`: four row primary
    // strings and the Sent-tab "Pending" pill took 700; the remove control's RESTING weight, the
    // "Request sent" confirmation, the invite-to-group `<label>` and the bulk-invite result box
    // took 400 (each keeps a colour token and, for two of them, a glyph); the tab labels took 400
    // because `font-medium` sat on BOTH the active and inactive arms and carried no distinction
    // at all — the active tab GAINED `aria-current` instead, which is the cue it never had; and
    // the bulk-invite CTA's `font-medium` was dead on a `.btn` and deleted with the migration.
    sites: 1,
    why:
      '1 off-scale weight site: the armed-state 600 on the two-tap remove-friend control. UI-SPEC §4.5 rules this family Button-owned and it STAYS. Owning plans: 88.6-19 (swept), 88.6-46 (closeout).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'app/gameDetail/page.js': {
    // 48 -> 45 (task 2) -> 1 (task 3), plan 88.6-18, wave 7, 2026-09-16. The ONE survivor is
    // the ARMED-STATE 600 on the two-tap Remove control, which UI-SPEC §4.5 rules STAYS:
    // "Armed-state 600 on two-tap buttons — STAYS, Button-owned". It is the same carve-out
    // plan 88.6-17 kept five of on `userProfile/page.js`, and it is a named exception rather
    // than a licence for 600 anywhere else in this file. Everything else resolved to 700
    // (hierarchy) or 400 (emphasis + a colour token, or dead on a `.btn`) — every call is
    // enumerated in `88.6-18-SUMMARY.md`, including the two breadcrumb current-page spans that
    // KEPT 700 and GAINED `aria-current="page"` under R2 #171 (T-88.6-138).
    sites: 1,
    why:
      '1 off-scale weight site: the armed-state 600 on the two-tap participant Remove. UI-SPEC §4.5 rules this family Button-owned and it STAYS. Owning plans: 88.6-18 (swept), 88.6-46 (closeout).',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // `app/groupHomePage/page.js` CLOSED by plan 88.6-21 (wave 7, 2026-09-16), all seven sites:
  //   - the three header CTAs' `font-semibold` left with their migration onto `Button`, where
  //     the 600 label weight comes from `.btn`'s own unlayered `font-weight` and a call-site
  //     weight utility is dead;
  //   - the breadcrumb HOME LINK's `font-medium` DELETED — §4.5's emphasis case, already carried
  //     by `text-content-link`, so 400 + a colour token with no visible delta;
  //   - the breadcrumb CURRENT-PAGE span 600 -> 700 and GAINED `aria-current="page"` (R2 #171 /
  //     T-88.6-138), matching the three breadcrumbs plans 17 and 18 settled;
  //   - the two TAB labels' `font-medium` DELETED. The weight sat on BOTH arms, so it never
  //     carried the active state; that state gained `aria-current` in the same edit, which is a
  //     separate Rule-2 add and not this rule's outcome.
  // Entry DELETED rather than zeroed; the roster is exact in both directions.
  'app/groupPlanning/page.js': {
    sites: 4,
    why:
      '4 off-scale weight sites (2 font-medium, 2 font-semibold). UI-SPEC §4.5 outcome leads: emphasis (400 + a colour token); outcome set by the owning sweep; hierarchy (700) — confirmed per site by the owning sweep. Owning plans: 88.6-15, 88.6-21, 88.6-32, 88.6-39, 88.6-41, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  // DELETED by plan 88.6-23 task 2 (wave 7, 2026-09-16): `app/invite/accept/page.js` carried
  // `sites: 3`, all three §4.5 EMPHASIS (500 -> 400, colour token kept): the "Accepting your
  // invite..." status label (already `text-content-primary`) and the inviter-name and
  // group-name spans inside the invite sentence, whose distinction from the surrounding
  // paragraph is carried by `text-content-primary` against `text-content-secondary` — the
  // weight was never the only cue at either. Entry DELETED, not zeroed.
  // DELETED by plan 88.6-23 task 1 (wave 7, 2026-09-16): `app/invite/game/[token]/page.js`
  // carried `sites: 3` and `app/invite/group/[token]/page.js` carried `sites: 1`. Resolved per
  // site against UI-SPEC §4.5:
  //   - the three LOADING/JOINING status labels (`{label}` on game, `Joining {group}…` on
  //     group) — §4.5 EMPHASIS: the 500 dropped to 400 and each keeps the `text-content-primary`
  //     colour token it already carried. No informational distinction was carried by the weight
  //     (each is the only string in its card), so this is recorded as decorative rather than
  //     asserted safe;
  //   - the game page's TWO `font-semibold` event-name lines in the joined / already-joined
  //     summary block — §4.5 HIERARCHY: 600 -> 700 (`font-bold`). Each IS the subject of its
  //     block, with the event date at 14/muted directly beneath it.
  // Entries DELETED, not zeroed; the roster is exact in both directions.
  // DELETED by plan 88.6-23 task 2 (wave 7, 2026-09-16): `app/restore/group/[token]/page.tsx`
  // carried `sites: 1` — the "Bringing back {group}..." status label, §4.5 EMPHASIS, 500 -> 400
  // with its `text-content-primary` colour token kept. Entry DELETED, not zeroed.
  // DELETED by plan 88.6-24 task 2 (wave 7, 2026-09-16): `app/rsvp/[token]/page.js` carried
  // `sites: 2` — both `font-semibold`, and both were the branch h1s, so both resolved through the
  // `<Heading>` migration rather than through a weight edit. The entry's outcome lead said
  // "hierarchy (700)" and that is what landed, supplied by the primitive's `font-bold` base.
  // The file has NO remaining off-scale weight site (0 font-medium, 0 font-semibold).
  // Entry DELETED, not zeroed.
  // AT ITS FLOOR — 35 -> 28 (task 1) -> 5 (task 3) in plan 88.6-17, 2026-09-16. This entry is NOT
  // on a path to zero and must not be read as pending work: all five survivors are PERMANENT.
  //
  // FOUR are the armed-state 600s carried in ARMED_STATE_600_ROSTER below. The FIFTH is the
  // invisible sizer span inside the collection's two-tap Remove control, which reserves the ARMED
  // label's width at rest so arming does not reflow the game title beside it. That one is a
  // MEASUREMENT, not emphasis: it has to be set in the weight the armed label renders at, and
  // dropping it to 400 under-measures with nothing red, because no gate measures text advance
  // width. It cannot join the armed roster — `isArmedStateSite` reads 160 characters of
  // surrounding source and that window lands inside the className template rather than on the
  // `removeGameGate.isArmed(...)` call four lines above it — so it is counted HERE, which is why
  // this entry floors at FIVE and the armed roster at FOUR. The site carries its own
  // `DECISION Phase 88.6-17` marker stating all of the above.
  'app/userProfile/page.js': {
    sites: 5,
    why:
      'FLOORED at 5, not pending. Four are the armed-state 600s on this file\'s two-tap destructive gates (see ARMED_STATE_600_ROSTER) and the fifth is the invisible armed-label sizer span in the collection Remove control, whose 600 is a width MEASUREMENT of the armed label rather than emphasis — see the `DECISION Phase 88.6-17` marker at that site. The other 30 were converted by plan 88.6-17: emphasis sites to 400 plus a colour token, form labels and matrix header cells to the Label rung\'s 400, the theme toggles\' 600 deleted as dead on a `.btn`, and the TCPA disclosure dispositioned span by span.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88.6-17' },
  },
  'components/ui/Banner.tsx': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plans: 88.6-11, 88.6-13, 88.6-15, 88.6-19, 88.6-20, 88.6-32, 88.6-34, 88.6-36.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'components/ui/ErrorFallback.tsx': {
    sites: 2,
    why:
      '2 off-scale weight sites (2 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: dead on a .btn (delete) — confirmed per site by the owning sweep. Owning plans: 88.6-03, 88.6-11, 88.6-12, 88.6-23, 88.6-36, 88.6-43, 88.6-46.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'components/ui/FetchErrorBanner.tsx': {
    sites: 3,
    why:
      '3 off-scale weight sites (3 font-medium, 0 font-semibold). UI-SPEC §4.5 outcome lead: emphasis (400 + a colour token) — confirmed per site by the owning sweep. Owning plans: 88.6-11, 88.6-13, 88.6-15, 88.6-19, 88.6-20, 88.6-34, 88.6-36.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
  'components/ui/UserChip.tsx': {
    sites: 1,
    why:
      '1 off-scale weight site (0 font-medium, 1 font-semibold). UI-SPEC §4.5 outcome lead: outcome set by the owning sweep — confirmed per site by the owning sweep. Owning plan: 88.6-37.',
    owner: { kind: 'spec', id: 'SPEC-88.6 R3 / AC-3 (UI-SPEC §4.5)' },
  },
};

/**
 * The armed-state 600s, carved out AS A RULE WITH ITS REASON rather than as a blanket
 * exclusion. They are Button-owned emphasis inside a shipped interaction
 * (`useConfirmAction`'s armed state, the Phase 65-02 two-tap destructive-confirm pattern),
 * so they are legitimate 600 and are not debt.
 *
 * A roster entry rather than a scanner EXCLUSION on purpose: an exclusion on
 * `userProfile/page.js` and `KebabMenu.js` would also permit any FUTURE 600 in those two
 * files, which is precisely the fossil permission the exact-count schema exists to stop.
 * Enumerated by file:line, so a sixth armed site is a decision rather than a silent
 * widening.
 */
const ARMED_STATE_600_ROSTER: ExemptionRoster = {
  // CITE CORRECTED by plan 88.6-17 (2026-09-16), and the description with it. Two errors, both
  // bookkeeping rather than gate failures, both recorded rather than silently fixed:
  //
  //  (1) `DECISION Phase 65-02 EVT-08` does NOT live in this file. It is at
  //      `gameDetail/page.js` and `src/components/ui/useConfirmAction.ts`. The marker that
  //      actually sits at an armed site here is `DECISION Phase 88-27 (D-32 bucket D)`, on the
  //      two `deletePatternGate` triggers; the Remove-phone control now also carries its own
  //      `DECISION Phase 88.6-17`. Plan 04's schema only requires the token `DECISION`, so the
  //      wrong cite passed — which is exactly why a cite that cannot be found is worth fixing.
  //  (2) These are NOT all "Button-owned emphasis inside useConfirmAction". The Remove-phone
  //      two-tap is HAND-ROLLED (D-PHONE-01, mirroring `KebabMenu.js`) and is owned by no
  //      primitive. What they have in common is the property worth protecting: each is the ARMED
  //      cue of a two-tap DESTRUCTIVE GATE, and the Remove-phone one gates the sole path to
  //      removing a verified phone number.
  //
  // The line numbers move with every sweep and are deliberately not restated here; the predicate
  // finds them and the failure message prints them.
  'app/userProfile/page.js': {
    sites: 4,
    why:
      'four armed-state 600s, each the ARMED cue of a two-tap DESTRUCTIVE gate: the hand-rolled D-PHONE-01 Remove-phone control (not a useConfirmAction consumer — it is owned by no primitive), the two deletePatternGate triggers, and the collection removeGameGate trigger. Legitimate 600 under D-03, not §4.5 debt. A FIFTH permanent 600 in this file — the invisible armed-label sizer span — is outside this predicate\'s reach and is carried in WEIGHT_ROSTER instead.',
    owner: { kind: 'decision', marker: 'DECISION Phase 88-27 (D-32 bucket D)' },
  },
  'app/components/KebabMenu.js': {
    sites: 1,
    why:
      'the armed-state 600 on the destructive kebab item (:158, `isArmed ? bg-status-error-subtle font-semibold`) — the Phase 65-02 two-tap pattern, and since D-40 the SOLE phone path to destructive row actions',
    owner: { kind: 'decision', marker: 'DECISION Phase 65-02 EVT-08' },
  },
};

/**
 * The armed-state predicate. A `font-semibold` whose surrounding source names the
 * `useConfirmAction` armed state. Deliberately NOT a file-level allowance.
 */
const isArmedStateSite = (s: WeightSite) => /isArmed|Armed\b/.test(s.context);

/** Negative controls for the weight rule — both polarities, plus the strip. */
const FIXTURE_WEIGHT_COMPLIANT = `
  export const F = () => (
    <div>
      <span className="font-bold">seven hundred</span>
      <span className="font-normal">four hundred</span>
    </div>
  );
`;
const FIXTURE_WEIGHT_VIOLATION = `
  export const G = () => <span className="font-medium">five hundred</span>;
`;
const FIXTURE_WEIGHT_COMMENTS = `
  /* A documented font-semibold inside a block comment counts for nothing. */
  // And a font-medium after a line comment likewise.
  export const H = () => <span className="font-semibold">real</span>;
`;

describe('UI-SPEC §4.2 / §4.5: only 400 and 700, tree-wide, outside Button.tsx', () => {
  it('permits only font-normal and font-bold outside Button.tsx', () => {
    const byFile: Record<string, number> = {};
    for (const s of WEIGHT_SITES) byFile[s.surface] = (byFile[s.surface] ?? 0) + 1;

    expect(assertRosterShape(WEIGHT_ROSTER)).toEqual([]);
    expect(assertRosterShape(ARMED_STATE_600_ROSTER)).toEqual([]);

    // EXCLUSION IS NOT EXEMPTION — the definition must never be filed as debt.
    expect(
      Object.keys(WEIGHT_ROSTER).includes(WEIGHT_SCAN_EXCLUSION),
      'Button.tsx is the DEFINITION of where 600 lives; filing it as an exemption would give ' +
        'the definition a fossil permission to grow',
    ).toBe(false);

    expect(
      assertExactCounts(WEIGHT_ROSTER, byFile),
      'UI-SPEC §4.2 states TWO weights, 400 body and 700 headings; 500 and 600 are ' +
        'prohibitions outside the Button label. §4.5 gives the three outcomes: hierarchy -> ' +
        '700, emphasis -> 400 + a colour token, dead-on-a-.btn -> delete.',
    ).toEqual([]);

    // Anti-vacuity: a rule that starts with an empty roster on a tree measured to have 340
    // violations has not actually widened.
    const seeded = Object.values(WEIGHT_ROSTER).reduce((n, e) => n + e.sites, 0);
    expect(seeded, 'the weight roster must not be empty').toBeGreaterThan(0);
    expect(seeded).toBe(WEIGHT_SITES.length);
  });

  it('holds the armed-state 600s as an owned, counted carve-out — not an exclusion', () => {
    const armed: Record<string, number> = {};
    for (const s of WEIGHT_SITES.filter(isArmedStateSite)) {
      armed[s.surface] = (armed[s.surface] ?? 0) + 1;
    }
    expect(
      assertExactCounts(ARMED_STATE_600_ROSTER, armed),
      'a sixth armed-state 600 is a decision, not a rebase. These sites also stay counted in ' +
        'WEIGHT_ROSTER, which is why those two files floor at their armed count rather than ' +
        'at zero — an exclusion would instead permit ANY future 600 in them. ' +
        `Armed sites: ${JSON.stringify(WEIGHT_SITES.filter(isArmedStateSite).map((s) => `${s.surface}:${s.line}`))}`,
    ).toEqual([]);
  });

  it('does not count a weight class written in a comment (negative control)', () => {
    expect(
      scanWeights('fixture/weight-comments.tsx', withoutComments(FIXTURE_WEIGHT_COMMENTS)).map(
        (s) => s.raw,
      ),
      'src/lib/colorUtils.js:634 and :678 are font-semibold inside block comments; seeded raw ' +
        'they become roster entries no sweep can ever decrement',
    ).toEqual(['font-semibold']);
  });

  it('flags font-medium and does not flag font-bold or font-normal (negative controls)', () => {
    expect(
      scanWeights('fixture/compliant.tsx', withoutComments(FIXTURE_WEIGHT_COMPLIANT)),
    ).toEqual([]);
    expect(
      scanWeights('fixture/violation.tsx', withoutComments(FIXTURE_WEIGHT_VIOLATION)).map(
        (s) => s.raw,
      ),
    ).toEqual(['font-medium']);
  });

  it('cross-checks the weight rule against the heading rule — every RAW heading is 700 or rostered', () => {
    // SUPPLY bucket, and RAW-ONLY, which is the load-bearing part of this assertion.
    //
    // A heading migrated onto the `<Heading>` primitive takes its 700 from the cva base
    // (`88.6-03-PLAN.md:152`) rather than from its own className, so a cross-check that also
    // read primitive headings would flag EVERY migrated site. PRIMITIVE-SIDE ARM: the
    // property is pinned rather than dropped — plan 03's `Heading.test.tsx` pins the base
    // weight on the primitive, and the fixture in the "gives every RAW heading the 700
    // weight" block above proves a compliant primitive is not flagged here.
    //
    // It reuses HEADING_WEIGHT_ROSTER rather than seeding a second copy: that roster IS this
    // population (raw headings not stating 700), and two rosters over one population is two
    // places a decrement has to land and one place it can be forgotten.
    const offenders = RAW.filter((h) => !/\bfont-bold\b/.test(h.className));
    expect(
      assertExactCounts(HEADING_WEIGHT_ROSTER, countByFile(offenders)),
      'measured at this commit: 39 raw headings need a weight edit — 37 font-semibold, 1 ' +
        'font-medium (app/components/UpcomingEventsCard.js:156) and 1 carrying no weight ' +
        'utility at all (app/global-error.tsx:66, permanently exempt under DECISION Phase ' +
        '88-09 D-20). The heading sweeps shrink this visibly.',
    ).toEqual([]);

    // The two rules must agree: a raw heading carrying font-medium or font-semibold is a
    // site in BOTH populations. Anything the weight rule sees on a heading, this sees too.
    const headingWeightSites = WEIGHT_SITES.filter((s) =>
      RAW.some((h) => h.surface === s.surface && Math.abs(h.line - s.line) <= 4),
    );
    expect(
      headingWeightSites.every((s) => s.surface in WEIGHT_ROSTER),
      'an off-scale weight sitting on a heading must be rostered by the weight rule as well ' +
        'as by the heading rule',
    ).toBe(true);
  });
});
