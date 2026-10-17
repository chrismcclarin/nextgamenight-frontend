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
 * Nor is a crumb link rendered by a child component, or a separator drawn by CSS or by an icon
 * component: the body arms below read the literal JSX between the nav's opening and closing tags.
 * AMENDED Phase 88.6.1-55 (D-46 / AC-23 / R7-M7): the scan now reads each breadcrumb's BODY, the
 * comment-stripped source from its opening tag to its closing tag, and requires the house ring on
 * every crumb link (a Link or a raw anchor, whose className must be a literal) and aria-hidden on
 * every separator glyph, with exact totals; min-w-0 joins the overflow tokens. An unreadable body
 * or a non-literal className is a failure, never a skip. Chosen OVER per-page render pins alone
 * (each page keeps its own pin, but a sixth crumb, or a page whose own test was not updated, would
 * slip past) and OVER registering the two megafiles in the whole-file ring scan of
 * groupColourRendering.test.ts (it would demand a ring on every focusable in a 3,000-line file,
 * CT-4). The two counts are a roster on purpose: adding a crumb link or a separator is a decision,
 * and the constants say so. Each arm is shown catching a planted violation by the fixture tests.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, readOpeningTag, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const NAV_OPEN = /<nav(?=[\s>])/g;
const BREADCRUMB_LABEL = /aria-label\s*=\s*(?:"Breadcrumb"|'Breadcrumb'|\{\s*['"`]Breadcrumb['"`]\s*\})/;
const REQUIRED = ['inline-block', 'max-w-full', 'wrap-break-word', 'min-w-0'];
/** The house ring, outset form (DECISION Phase 88.3-17, per-site ring); the inset form is for flush strips and tight boxes, and every breadcrumb uses the outset form (plans 16, 52, 53). */
const RING = ['focus:outline-hidden', 'focus-visible:ring-2', 'focus-visible:ring-focus-ring', 'focus-visible:ring-offset-2'];
/** A crumb link: a Link or a raw anchor opening tag. */
const LINK_OPEN = /<(?:Link|a)(?=[\s>])/g;
/** A separator glyph: the right angle in braces in any quoting, its entities, or the single right-pointing angle character. */
const SEPARATOR_GLYPH = /\{\s*(['"`])>\1\s*\}|&gt;|&rsaquo;|&#8250;|\u203A/g;
/** aria-hidden set to true, in any spelling. */
const ARIA_HIDDEN_TRUE = /aria-hidden\s*=\s*(?:"true"|'true'|\{\s*true\s*\}|\{\s*'true'\s*\})/;
/** The AC-23 / D-46 count of breadcrumb links after plans 16, 52, 53 and 55. Adding a crumb is a decision: update this. */
const EXPECTED_CRUMB_LINKS = 8;
/** The AC-23 / D-46 count of breadcrumb separators after plans 16, 52, 53 and 55 (8 of 8 hidden). Adding one is a decision: update this. */
const EXPECTED_SEPARATORS = 8;
const NAV_CLOSE = /<\/nav\s*>/g;

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
  /** Breadcrumb navs only (empty elsewhere): every link opening tag in the body. */
  links: { site: string; className: string | null }[];
  /** Breadcrumb navs only (empty elsewhere): every separator glyph in the body. */
  separators: { site: string; hidden: boolean }[];
  /** False when the body has no closing tag, or another nav opens before it. */
  bodyReadable: boolean;
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

/** The literal className of one opening tag; null when absent or not a plain string. */
function literalClass(tag: string | null): string | null {
  const cls = tag ? /className="([^"]*)"/.exec(tag) : null;
  return cls ? cls[1] : null;
}

/** The first match of a global pattern at or after `from`, or -1. */
function nextMatch(pattern: RegExp, src: string, from: number): number {
  const re = new RegExp(pattern.source, 'g');
  re.lastIndex = from;
  const m = re.exec(src);
  return m ? m.index : -1;
}

/** One breadcrumb nav's body: its links and separators, or unreadable. `src` is comment-stripped. */
function readBody(rel: string, src: string, at: number): Pick<Nav, 'links' | 'separators' | 'bodyReadable'> {
  const close = nextMatch(NAV_CLOSE, src, at);
  const nextOpen = nextMatch(NAV_OPEN, src, at + 1);
  if (close < 0 || (nextOpen >= 0 && nextOpen < close)) return { links: [], separators: [], bodyReadable: false };
  const body = src.slice(at, close);
  const links = [...body.matchAll(LINK_OPEN)].map((m) => {
    const abs = at + (m.index ?? 0);
    return { site: `${rel}:${lineAt(src, abs)}`, className: literalClass(readOpeningTag(src, abs)) };
  });
  const separators = [...body.matchAll(SEPARATOR_GLYPH)].map((m) => {
    const idx = m.index ?? 0;
    const spanAt = body.lastIndexOf('<span', idx);
    const spanTag = spanAt >= 0 ? readOpeningTag(body, spanAt) : null;
    const hidden =
      spanTag !== null &&
      /^\s*$/.test(body.slice(spanAt + spanTag.length, idx)) &&
      ARIA_HIDDEN_TRUE.test(spanTag);
    return { site: `${rel}:${lineAt(src, at + idx)}`, hidden };
  });
  return { links, separators, bodyReadable: true };
}

/** Every nav opening tag in one source file (pure: fixture sources go through the same path). */
function navsIn(rel: string, rawSource: string): Nav[] {
  const src = withoutComments(rawSource);
  const out: Nav[] = [];
  for (const m of src.matchAll(NAV_OPEN)) {
    const at = m.index ?? 0;
    const tag = readOpeningTag(src, at) ?? '';
    const cls = /className="([^"]*)"/.exec(tag);
    const isBreadcrumb = BREADCRUMB_LABEL.test(tag);
    out.push({
      file: rel,
      site: `${rel}:${src.slice(0, at).split('\n').length}`,
      className: cls ? cls[1] : null,
      isBreadcrumb,
      labelled: NAMED.test(tag),
      label: resolveLabel(tag, src),
      ...(isBreadcrumb ? readBody(rel, src, at) : { links: [], separators: [], bodyReadable: true }),
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

/** Test 3's check, moved verbatim: every breadcrumb nav's literal className carries REQUIRED. */
function overflowFailures(crumbs: Nav[]): string[] {
  return crumbs
    .filter((n) => n.className === null || !REQUIRED.every((token) => n.className!.split(/\s+/).includes(token)))
    .map((n) => `${n.site} — ${n.className === null ? '(non-literal className)' : `"${n.className}"`}`);
}

/** Every crumb link without the full RING (or with a non-literal className), plus every unreadable body. */
function ringFailures(crumbs: Nav[]): string[] {
  const out: string[] = [];
  for (const n of crumbs) {
    if (!n.bodyReadable) {
      out.push(`${n.site} — (unreadable breadcrumb body)`);
      continue;
    }
    for (const link of n.links) {
      if (link.className === null) {
        out.push(`${link.site} — (non-literal className)`);
        continue;
      }
      const tokens = link.className.split(/\s+/);
      const missing = RING.filter((token) => !tokens.includes(token));
      if (missing.length > 0) out.push(`${link.site} — missing ${missing.join(', ')}`);
    }
  }
  return out;
}

/** Every separator glyph that is not directly inside an aria-hidden span, plus every unreadable body. */
function separatorFailures(crumbs: Nav[]): string[] {
  const out: string[] = [];
  for (const n of crumbs) {
    if (!n.bodyReadable) {
      out.push(`${n.site} — (unreadable breadcrumb body)`);
      continue;
    }
    for (const sep of n.separators) if (!sep.hidden) out.push(`${sep.site} — separator not aria-hidden`);
  }
  return out;
}

// Fixture sources for tests 8-10: line 2 is the nav, line 3 the Home link, line 4 the separator.
const RING_CLASS = 'focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2';
const CLEAN = [
  'const A = () => (',
  '  <nav aria-label="Breadcrumb" className="inline-block max-w-full wrap-break-word min-w-0">',
  '    <Link href="/" className="text-content-link ' + RING_CLASS + '">Home</Link>',
  '    <span aria-hidden="true" className="text-content-muted mx-2">{\'>\'}</span>',
  '    <span aria-current="page">Here</span>',
  '  </nav>',
  ');',
];

/** CLEAN with one line (0-based index) replaced. */
function withLine(lines: string[], index: number, line: string): string[] {
  return lines.map((l, i) => (i === index ? line : l));
}

/** The breadcrumb navs of one fixture source. */
function crumbsOf(lines: string[]): Nav[] {
  return navsIn('app/fixture.js', lines.join('\n')).filter((n) => n.isBreadcrumb);
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

  it('every breadcrumb nav has a literal className that is an inline-block pill capped by max-w-full with wrap-break-word and min-w-0', () => {
    expect(overflowFailures(crumbs)).toEqual([]);
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

  it('every breadcrumb link carries the house ring, and the tree holds exactly EXPECTED_CRUMB_LINKS of them, at least one per crumb (D-46 / AC-23)', () => {
    expect(ringFailures(crumbs)).toEqual([]);
    expect(crumbs.reduce((total, n) => total + n.links.length, 0)).toBe(EXPECTED_CRUMB_LINKS);
    expect(crumbs.filter((n) => n.links.length === 0).map((n) => n.site)).toEqual([]);
  });

  it('every breadcrumb separator is aria-hidden, and the tree holds exactly EXPECTED_SEPARATORS of them, at least one per crumb (AC-23 8 of 8)', () => {
    expect(separatorFailures(crumbs)).toEqual([]);
    expect(crumbs.reduce((total, n) => total + n.separators.length, 0)).toBe(EXPECTED_SEPARATORS);
    expect(crumbs.filter((n) => n.separators.length === 0).map((n) => n.site)).toEqual([]);
  });

  it('the ring arm catches each planted violation and passes a clean breadcrumb (fixture sources through navsIn)', () => {
    // Fixture line 2 is the nav, line 3 the Home link, line 4 the separator.
    expect(ringFailures(crumbsOf(CLEAN))).toEqual([]);
    expect(crumbsOf(CLEAN)[0].links).toHaveLength(1);

    // A Link missing one ring token is reported once, naming the token.
    const missingRing2 = withLine(CLEAN, 2, '    <Link href="/" className="text-content-link focus:outline-hidden focus-visible:ring-focus-ring focus-visible:ring-offset-2">Home</Link>');
    expect(ringFailures(crumbsOf(missingRing2))).toEqual(['app/fixture.js:3 — missing focus-visible:ring-2']);

    // A Link whose className is an expression cannot be read, so it fails as non-literal.
    const expression = withLine(CLEAN, 2, '    <Link href="/" className={homeClass}>Home</Link>');
    expect(ringFailures(crumbsOf(expression))).toEqual(['app/fixture.js:3 — (non-literal className)']);

    // A raw anchor without the ring is a crumb link too.
    const rawAnchor = withLine(CLEAN, 2, '    <a href="/" className="text-content-link">Home</a>');
    expect(ringFailures(crumbsOf(rawAnchor))).toEqual([
      'app/fixture.js:3 — missing focus:outline-hidden, focus-visible:ring-2, focus-visible:ring-focus-ring, focus-visible:ring-offset-2',
    ]);

    // A ringless link that exists only inside a JSX block comment does not count.
    const commented = withLine(CLEAN, 2, '    {/* <Link href="/x" className="text-content-link">X</Link> */}');
    expect(ringFailures(crumbsOf(commented))).toEqual([]);
    expect(crumbsOf(commented)[0].links).toEqual([]);

    // A second nav opening before the closing tag makes the body unreadable: a failure, never a skip.
    const nested = withLine(CLEAN, 3, '    <nav aria-label="Inner"><span>x</span></nav>');
    expect(ringFailures(crumbsOf(nested))).toEqual(['app/fixture.js:2 — (unreadable breadcrumb body)']);
    // ...and so is a nav with no closing tag at all.
    const unclosed = CLEAN.filter((line) => !line.includes('</nav>'));
    expect(ringFailures(crumbsOf(unclosed))).toEqual(['app/fixture.js:2 — (unreadable breadcrumb body)']);
  });

  it('the separator arm catches each planted violation and passes a clean breadcrumb (fixture sources through navsIn)', () => {
    expect(separatorFailures(crumbsOf(CLEAN))).toEqual([]);
    expect(crumbsOf(CLEAN)[0].separators).toEqual([{ site: 'app/fixture.js:4', hidden: true }]);

    // A separator span without aria-hidden.
    const exposed = withLine(CLEAN, 3, '    <span className="text-content-muted mx-2">{\'>\'}</span>');
    expect(separatorFailures(crumbsOf(exposed))).toEqual(['app/fixture.js:4 — separator not aria-hidden']);

    // A bare glyph with no span at all.
    const bare = withLine(CLEAN, 3, '    {\'>\'}');
    expect(separatorFailures(crumbsOf(bare))).toEqual(['app/fixture.js:4 — separator not aria-hidden']);

    // An entity glyph in a visible span.
    const entity = withLine(CLEAN, 3, '    <span className="mx-2">&gt;</span>');
    expect(separatorFailures(crumbsOf(entity))).toEqual(['app/fixture.js:4 — separator not aria-hidden']);

    // A glyph after other text inside a hidden span is not the span's direct content.
    const afterText = withLine(CLEAN, 3, '    <span aria-hidden="true">x</span>{\'>\'}');
    expect(separatorFailures(crumbsOf(afterText))).toEqual(['app/fixture.js:4 — separator not aria-hidden']);

    // The braced boolean and a double-quoted glyph both count as hidden.
    const braced = withLine(CLEAN, 3, '    <span aria-hidden={true} className="mx-2">{">"}</span>');
    expect(separatorFailures(crumbsOf(braced))).toEqual([]);
    expect(crumbsOf(braced)[0].separators).toHaveLength(1);

    // An unreadable body fails this arm too, never a skip.
    const unclosed = CLEAN.filter((line) => !line.includes('</nav>'));
    expect(separatorFailures(crumbsOf(unclosed))).toEqual(['app/fixture.js:2 — (unreadable breadcrumb body)']);
  });

  it('the overflow arm catches each planted violation and passes a clean breadcrumb (fixture sources through navsIn)', () => {
    expect(overflowFailures(crumbsOf(CLEAN))).toEqual([]);

    // A nav class without min-w-0.
    const noMinW = withLine(CLEAN, 1, '  <nav aria-label="Breadcrumb" className="inline-block max-w-full wrap-break-word">');
    expect(overflowFailures(crumbsOf(noMinW))).toEqual(['app/fixture.js:2 — "inline-block max-w-full wrap-break-word"']);

    // A nav whose className is an expression.
    const navExpression = withLine(CLEAN, 1, '  <nav aria-label="Breadcrumb" className={navClass}>');
    expect(overflowFailures(crumbsOf(navExpression))).toEqual(['app/fixture.js:2 — (non-literal className)']);
  });
});
