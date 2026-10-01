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
 * is "Breadcrumb" in ANY attribute position and ANY quoting (`"…"`, `'…'`, `{'…'}`). The roster is
 * pinned by SITE FILE (not a bare count), and every `<nav` in the tree must be on it — so a sixth
 * breadcrumb, a reordered attribute, a swapped site, or an unlabelled nav all fail loudly instead
 * of slipping past the overflow fix.
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

type Nav = { file: string; site: string; className: string | null; isBreadcrumb: boolean };

function allNavs(): Nav[] {
  const out: Nav[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(NAV_OPEN)) {
      const at = m.index ?? 0;
      const tag = readOpeningTag(src, at) ?? '';
      const cls = /className="([^"]*)"/.exec(tag);
      out.push({
        file: rel,
        site: `${rel}:${src.slice(0, at).split('\n').length}`,
        className: cls ? cls[1] : null,
        isBreadcrumb: BREADCRUMB_LABEL.test(tag),
      });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

describe('breadcrumb pills cap at their container (UAT3-D1, 2026-09-30)', () => {
  const navs = allNavs();
  const crumbs = navs.filter((n) => n.isBreadcrumb);

  it('the roster of breadcrumb navs is exactly the known sites (by file)', () => {
    expect(crumbs.map((n) => n.file)).toEqual(EXPECTED_SITES);
  });

  it('every <nav> in the tree is a labelled breadcrumb (an unlabelled nav cannot hide from the roster)', () => {
    expect(navs.filter((n) => !n.isBreadcrumb).map((n) => n.site)).toEqual([]);
  });

  it('every breadcrumb nav has a literal className that is an inline-block pill capped by max-w-full with wrap-break-word', () => {
    const failing = crumbs
      .filter((n) => n.className === null || !REQUIRED.every((token) => n.className!.split(/\s+/).includes(token)))
      .map((n) => `${n.site} — ${n.className === null ? '(non-literal className)' : `"${n.className}"`}`);
    expect(failing).toEqual([]);
  });
});
