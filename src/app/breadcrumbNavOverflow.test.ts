/**
 * Phase 88.6 close-out (owner device check 2026-09-30, UAT3-D1) — breadcrumb pills must cap at
 * their container so a long unbroken name wraps instead of widening the page.
 *
 * WHY THIS GATE EXISTS
 * --------------------
 * Every breadcrumb `<nav>` is an `inline-block` pill (shrink-to-fit, so it hugs its text). An
 * inline-block with no max-width grows to fit its longest word, so `overflow-wrap: break-word` on
 * the crumb inside it can NEVER fire — the box is always wide enough. Plan 88.6-21 added
 * `wrap-break-word` to the groupHomePage crumb and the owner's 40-character group name still ran
 * off the right edge of a 375px screen. The fix is `max-w-full` on the pill (now the box is capped
 * and the word must break) plus `wrap-break-word` on the nav itself (overflow-wrap inherits, so
 * every crumb and link inside is covered — groupPlanning's group link ALSO carries
 * `max-w-[200px] truncate`, so it truncates rather than wraps, by design).
 *
 * DETECTION RULE (code review round 6, 2026-09-30): EVERY `<nav` opening tag in non-test source is
 * read whole (`readOpeningTag`, quote- and brace-aware), and is a breadcrumb when its `aria-label`
 * is "Breadcrumb" in ANY attribute position and ANY quoting (`"…"`, `'…'`, `{'…'}`).
 * AMENDED Phase 88.6.1-45 (R7-M2/M9, HEADER-NAV-LANDMARK-RULING): every nav must carry a name
 * (aria-label or aria-labelledby); only Breadcrumb-labelled navs enter the roster (pinned by SITE
 * FILE, not a bare count) and the overflow-token check; every other nav must be on NAMED_NAVS,
 * matched by file AND by its label resolved from the tag (a literal in any quoting, or a same-file
 * string constant). Chosen OVER the old every-nav-is-a-breadcrumb rule, which forbade the
 * primary-navigation landmark the app lacked (WCAG 1.3.1 / 2.4.1), and OVER exempting
 * non-breadcrumb navs wholesale, which would let an unnamed or a second "Main" landmark through.
 * So a sixth RAW nav-tag breadcrumb, a reordered attribute, a swapped site, an unnamed nav or an
 * unlisted named nav all fail loudly instead of slipping past the overflow fix.
 * NOT COVERED: a Breadcrumb component, an element given the navigation role, a nav created
 * without JSX, or a props spread on a nav tag is invisible to a scan anchored on the literal tag.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readOpeningTag, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const NAV_OPEN = /<nav(?=[\s>])/g;
const BREADCRUMB_LABEL = /aria-label\s*=\s*(?:"Breadcrumb"|'Breadcrumb'|\{\s*['"`]Breadcrumb['"`]\s*\})/;
const REQUIRED = ['inline-block', 'max-w-full', 'wrap-break-word'];

/** The breadcrumb navs at FE 98bd003 (2026-09-30), by site file. Adding or moving one is a decision: update this. */
const EXPECTED_SITES = [
  'app/gameDetail/page.js',
  'app/gameDetail/page.js',
  'app/groupHomePage/page.js',
  'app/groupPlanning/page.js',
  'app/userProfile/page.js',
];

/**
 * The non-breadcrumb navs, by site file and RESOLVED label — HEADER-NAV-LANDMARK-RULING 88.6.1,
 * copy row H5. Adding one is a decision: update this.
 */
const NAMED_NAVS: { file: string; label: string }[] = [{ file: 'app/Header.js', label: 'Main' }];

const NAMED = /aria-label(?:ledby)?\s*=/;
const LITERAL_LABEL = /aria-label\s*=\s*(?:"([^"]*)"|'([^']*)'|\{\s*(['"`])([^'"`]*)\3\s*\})/;
const IDENTIFIER_LABEL = /aria-label\s*=\s*\{\s*([A-Za-z_$][\w$]*)\s*\}/;

type Nav = {
  file: string;
  site: string;
  className: string | null;
  isBreadcrumb: boolean;
  labelled: boolean;
  label: string | null;
};

/** The aria-label of one opening tag: a literal, or a same-file string constant; null otherwise. */
function resolveLabel(tag: string, src: string): string | null {
  const lit = LITERAL_LABEL.exec(tag);
  if (lit) return lit[1] ?? lit[2] ?? lit[4] ?? null;
  const ident = IDENTIFIER_LABEL.exec(tag);
  if (!ident) return null;
  const decl = new RegExp(`\\bconst\\s+${ident[1]}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(src);
  return decl ? (decl[1] ?? decl[2] ?? null) : null;
}

/** Every nav opening tag in one source file (pure: fixture sources go through the same path). */
function navsIn(rel: string, rawSource: string): Nav[] {
  const src = withoutComments(rawSource);
  const out: Nav[] = [];
  for (const m of src.matchAll(NAV_OPEN)) {
    const at = m.index ?? 0;
    const tag = readOpeningTag(src, at) ?? '';
    const cls = /className="([^"]*)"/.exec(tag);
    out.push({
      file: rel,
      site: `${rel}:${src.slice(0, at).split('\n').length}`,
      className: cls ? cls[1] : null,
      isBreadcrumb: BREADCRUMB_LABEL.test(tag),
      labelled: NAMED.test(tag),
      label: resolveLabel(tag, src),
    });
  }
  return out;
}

function allNavs(): Nav[] {
  return sourceFiles(SRC)
    .flatMap((file) => navsIn(path.relative(SRC, file), fs.readFileSync(file, 'utf8')))
    .sort((a, b) => a.site.localeCompare(b.site));
}

/** True when a nav is on NAMED_NAVS by site file AND resolved label. */
function isNamedNav(nav: Nav): boolean {
  return NAMED_NAVS.some((n) => n.file === nav.file && n.label === nav.label);
}

describe('breadcrumb pills cap at their container (UAT3-D1, 2026-09-30)', () => {
  const navs = allNavs();
  const crumbs = navs.filter((n) => n.isBreadcrumb);

  it('the roster of breadcrumb navs is exactly the known sites (by file)', () => {
    expect(crumbs.map((n) => n.file)).toEqual(EXPECTED_SITES);
  });

  it('every nav in the tree carries a name (aria-label or aria-labelledby) — an unnamed nav cannot hide from the rosters', () => {
    expect(navs.filter((n) => !n.labelled).map((n) => n.site)).toEqual([]);
  });

  it('every breadcrumb nav has a literal className that is an inline-block pill capped by max-w-full with wrap-break-word', () => {
    const failing = crumbs
      .filter((n) => n.className === null || !REQUIRED.every((token) => n.className!.split(/\s+/).includes(token)))
      .map((n) => `${n.site} — ${n.className === null ? '(non-literal className)' : `"${n.className}"`}`);
    expect(failing).toEqual([]);
  });

  it('the non-breadcrumb navs, by site file and resolved label, are exactly NAMED_NAVS (HEADER-NAV-LANDMARK-RULING 88.6.1)', () => {
    expect(navs.filter((n) => !n.isBreadcrumb).map((n) => ({ file: n.file, label: n.label }))).toEqual(NAMED_NAVS);
  });

  it('each arm of the rule catches its planted violation (fixture sources through navsIn)', () => {
    const one = (src: string) => {
      const found = navsIn('app/Header.js', src);
      expect(found).toHaveLength(1);
      return found[0];
    };

    // An unnamed nav fails the name rule.
    expect(one('const A = () => <nav className="x">a</nav>;').labelled).toBe(false);

    // A nav named "Secondary", even in the allow-listed file, is off the allow-list.
    const secondary = one('const A = () => <nav aria-label="Secondary">a</nav>;');
    expect(secondary).toMatchObject({ labelled: true, isBreadcrumb: false, label: 'Secondary' });
    expect(isNamedNav(secondary)).toBe(false);

    // A nav named only by aria-labelledby is named, but its label does not resolve: off the list.
    const byRef = one('const A = () => <nav aria-labelledby="h">a</nav>;');
    expect(byRef).toMatchObject({ labelled: true, isBreadcrumb: false, label: null });
    expect(isNamedNav(byRef)).toBe(false);

    // A same-file string constant resolves; that is how Header names its landmark.
    const viaConst = one("const L = 'Main';\nconst A = () => <nav aria-label={L}>a</nav>;");
    expect(viaConst).toMatchObject({ labelled: true, isBreadcrumb: false, label: 'Main' });
    expect(isNamedNav(viaConst)).toBe(true);
    // ...and only from the allow-listed file.
    expect(isNamedNav({ ...viaConst, file: 'app/Other.js' })).toBe(false);

    // A braced string literal is a breadcrumb.
    expect(one("const A = () => <nav aria-label={'Breadcrumb'}>a</nav>;").isBreadcrumb).toBe(true);

    // A nav that exists only inside a JSX block comment does not count.
    expect(navsIn('app/Header.js', 'const A = () => <div>{/* <nav aria-label="Main"> */}</div>;')).toEqual([]);
  });
});
