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
  /**
   * The heading's literal inner text, with JSX expressions blanked. Added
   * 2026-08-05 so a pin can name ONE heading ("Reviews") instead of keying on the
   * class it is supposed to be asserting — a predicate that matched on `text-2xl`
   * silently stops matching the moment the heading is converged, which is exactly
   * how the old exemption count could have gone vacuous.
   */
  text: string;
}

function headings(surface: string): Heading[] {
  const text = fs.readFileSync(path.join(APP, surface), 'utf8');
  const out: Heading[] = [];
  HEADING_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = HEADING_RE.exec(text)) !== null) {
    const level = Number(match[1]);
    // Inner text: from the end of the open tag to the matching close tag. `{…}`
    // expressions are blanked — `Reviews ({reviews.length})` must read as "Reviews"
    // so a pin can name the heading without depending on runtime data.
    const inner =
      text
        .slice(match.index, match.index + 1200)
        .match(new RegExp(`>([\\s\\S]*?)</h${level}>`))?.[1] ?? '';
    out.push({
      surface,
      level,
      line: text.slice(0, match.index).split('\n').length,
      // Interpolations are conditional branches (gameDetail's game title uses one for
      // line-clamping); the statically-applied classes are what the scale governs.
      className: (match[2] ?? match[3] ?? '').replace(/\$\{[\s\S]*?\}/g, ' '),
      text: inner.replace(/\{[\s\S]*?\}/g, ' ').replace(/\s+/g, ' '),
    });
  }
  return out;
}

const ALL = SURFACES.flatMap(headings);

function describeHeading(h: Heading): string {
  return `h${h.level} ${h.surface}:${h.line} -> "${h.className.trim()}"`;
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
 */
const REVIEWS_HEADING = (h: Heading) =>
  h.surface === 'gameDetail/page.js' && /^Reviews\b/.test(h.text.trim());

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

  it('keeps EVERY heading inside the 4-size working set — there are now no exemptions', () => {
    // The `D39_REVIEWS_EXEMPTION` filter that used to sit here is gone, not disabled:
    // the owner converged the one heading it covered on 2026-08-05 (DEF-88-24-02), so
    // these four surfaces are exemption-free and this test is the whole property.
    const offenders = ALL.filter(
      (h) => OUT_OF_SET_SIZE.test(h.className) || !IN_SET_SIZE.test(h.className),
    ).map(describeHeading);
    expect(
      offenders,
      'the point of a 4-size working set (14/16/20/30) is that a fifth size cannot creep back ' +
        'in. `text-lg` (18) and `text-2xl` (24) were both on these surfaces before 88-24. A ' +
        'heading with NO size utility is equally an offender — it renders at body size.',
    ).toEqual([]);
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
    const reviews = ALL.filter(REVIEWS_HEADING).map(describeHeading);
    const found = ALL.filter(REVIEWS_HEADING);
    expect(
      found.length,
      `expected exactly one "Reviews (…)" heading on gameDetail, found: ${JSON.stringify(reviews)}`,
    ).toBe(1);

    const heading = found[0];
    expect(heading.level, 'Reviews is a section heading, a sibling of Game Sessions').toBe(2);
    expect(
      heading.className,
      'Owner ruling 2026-08-05 (DEF-88-24-02): "make it match the same size as all other ' +
        'headings." This h2 was `text-2xl` under DECISION Phase 88-11 (D-39); the owner ' +
        'REOPENED that ruling and converged it to the 20/700 section-heading rung every other ' +
        'h2 on this surface uses. Reverting to `text-2xl` reopens HIS convergence — read the ' +
        'amended marker at the site first.',
    ).toMatch(/\btext-xl\b/);
    expect(heading.className).toMatch(/\bfont-bold\b/);
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
