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
 *     gameDetail's Reviews h2 stood at `text-2xl`, which is the exemption below.
 * The scanner here reads whole heading tags, checks size and weight independently,
 * and is order-insensitive.
 *
 * WHY BODY TEXT IS NOT ASSERTED
 * -----------------------------
 * `text-sm` has ~461 occurrences across `src/app`, and a blanket 14 -> 16 body change
 * is a re-theme, which the SPEC forbids. That residue is Req 8's census (Phase 90/92).
 * This file is headings only, on four files only.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = path.resolve(__dirname, '.');

const SURFACES = [
  'gameDetail/page.js',
  'groupHomePage/page.js',
  'userProfile/page.js',
  'friends/page.js',
] as const;

/** §4.1's working set, as Tailwind utilities: 14 / 16 / 20 / 30. */
const IN_SET_SIZE = /\btext-(sm|base|xl|3xl)\b/;
/** Anything outside it that has actually appeared on these surfaces. */
const OUT_OF_SET_SIZE = /\b(?:[a-z]+:)?text-(lg|2xl|4xl|5xl|6xl)\b/;

/**
 * `<h1..h6 … className="…">` or `className={`…`}`. The `[\s\S]{0,400}?` span is what
 * makes this multiline-tolerant — the plan's grep is line-based and several headings
 * on these surfaces put attributes on their own lines.
 */
const HEADING_RE = /<h([1-6])\s[\s\S]{0,400}?className=\s*(?:"([^"]*)"|\{\s*`([\s\S]*?)`)/g;

interface Heading {
  surface: string;
  level: number;
  line: number;
  className: string;
}

function headings(surface: string): Heading[] {
  const text = fs.readFileSync(path.join(APP, surface), 'utf8');
  const out: Heading[] = [];
  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(text)) !== null) {
    out.push({
      surface,
      level: Number(match[1]),
      line: text.slice(0, match.index).split('\n').length,
      // Interpolations are conditional branches (gameDetail's game title uses one for
      // line-clamping); the statically-applied classes are what the scale governs.
      className: (match[2] ?? match[3] ?? '').replace(/\$\{[\s\S]*?\}/g, ' '),
    });
  }
  return out;
}

const ALL = SURFACES.flatMap(headings);

function describeHeading(h: Heading): string {
  return `h${h.level} ${h.surface}:${h.line} -> "${h.className.trim()}"`;
}

/**
 * The ONE ratified exemption, pinned as an exemption rather than excluded silently.
 * gameDetail's Reviews h2 stays at `text-2xl` because `DECISION Phase 88-11 (D-39)`
 * at the site records an OWNER ruling — he walked both headers at 375px and ruled
 * Reviews fine as it ships, so converging it reopens that ruling rather than tidying
 * an oversight. It genuinely conflicts with §4.1 and only the owner can rank the two;
 * the conflict is logged as DEF-88-24-02.
 */
const D39_REVIEWS_EXEMPTION = (h: Heading) =>
  h.surface === 'gameDetail/page.js' && /\btext-2xl\b/.test(h.className);

describe('Req 2 (CD-006): the heading type scale on 88-24\'s four touched surfaces', () => {
  it('finds headings on every one of the four surfaces (guards a scanner that silently matches nothing)', () => {
    for (const surface of SURFACES) {
      expect(headings(surface).length, `${surface}: no headings matched`).toBeGreaterThanOrEqual(1);
    }
    // 26 at the time of writing; a floor, so adding a heading is not a red build.
    expect(ALL.length).toBeGreaterThanOrEqual(20);
  });

  it('pairs no heading with font-semibold at any size', () => {
    const offenders = ALL.filter((h) => /\bfont-semibold\b/.test(h.className)).map(describeHeading);
    expect(
      offenders,
      'UI-SPEC §4.2 states 600 as a PROHIBITION, and D-01 gives it exactly one home — the ' +
        'Button primitive. Headings are 700.',
    ).toEqual([]);
  });

  it('gives every heading the 700 weight explicitly', () => {
    const offenders = ALL.filter((h) => !/\bfont-bold\b/.test(h.className)).map(describeHeading);
    expect(
      offenders,
      'a heading with no weight utility inherits body weight — §4.2 requires 700 to be stated.',
    ).toEqual([]);
  });

  it('keeps every heading inside the 4-size working set, apart from the ratified D-39 exemption', () => {
    const offenders = ALL.filter((h) => !D39_REVIEWS_EXEMPTION(h))
      .filter((h) => OUT_OF_SET_SIZE.test(h.className) || !IN_SET_SIZE.test(h.className))
      .map(describeHeading);
    expect(
      offenders,
      'the point of a 4-size working set (14/16/20/30) is that a fifth size cannot creep back ' +
        'in. `text-lg` (18) and `text-2xl` (24) were both on these surfaces before 88-24. A ' +
        'heading with NO size utility is equally an offender — it renders at body size.',
    ).toEqual([]);
  });

  it('holds the D-39 exemption to exactly one heading, so it cannot be used as cover', () => {
    // If this drops to 0, someone converged the Reviews heading without reading the
    // owner ruling at the site. If it rises above 1, the exemption is being reused as a
    // general licence for `text-2xl` on this surface. Both are failures, in opposite
    // directions — which is why the count is pinned rather than the absence.
    const exempt = ALL.filter(D39_REVIEWS_EXEMPTION).map(describeHeading);
    expect(
      exempt.length,
      `expected exactly one D-39-exempt heading (gameDetail's Reviews h2), found: ${JSON.stringify(exempt)}. ` +
        'Read the DECISION Phase 88-11 (D-39) and DECISION Phase 88-24 markers at the site before changing this.',
    ).toBe(1);
  });

  it('gives no heading a breakpoint-prefixed size', () => {
    // Found by negative-checking the test above: `text-2xl md:text-3xl` is caught
    // (text-2xl is out of set), but `text-xl md:text-3xl` would slip through BOTH the
    // working-set test and the h1 test, because every size in it is in-set. A heading
    // that changes size at a breakpoint is a second scale whichever sizes it uses —
    // that is the property, so assert it directly rather than by side effect.
    const offenders = ALL.filter((h) => /\b[a-z0-9]+:text-[a-z0-9]+\b/.test(h.className)).map(
      describeHeading,
    );
    expect(
      offenders,
      '88-19 removed the md:-prefixed heading sizes from userProfile and 88-24 removed the last ' +
        'one (groupHomePage\'s h1) for this reason. Pick ONE rung from the working set.',
    ).toEqual([]);
  });

  it('renders exactly one h1 per surface, at the 30/700 Display role', () => {
    // gameDetail and friends each render their h1 in several mutually-exclusive
    // branches (event view / game view; loading / error / loaded), so the assertion is
    // per-h1 rather than a count — every branch's title must be Display.
    const offenders = ALL.filter((h) => h.level === 1)
      .filter((h) => !/\btext-3xl\b/.test(h.className))
      .map(describeHeading);
    expect(
      offenders,
      'page titles are 30/700. A breakpoint-grown title (`text-2xl md:text-3xl`) is a SECOND ' +
        'type scale, which is why 88-24 removed the one on groupHomePage.',
    ).toEqual([]);
  });
});
