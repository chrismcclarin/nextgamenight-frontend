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
 * every crumb and link inside is covered). This suite pins both tokens on EVERY breadcrumb nav and
 * pins the roster count, so a sixth breadcrumb cannot ship without them.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { readOpeningTag, sourceFiles, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const NAV_OPEN = /<nav\s+aria-label="Breadcrumb"/g;
const REQUIRED = ['inline-block', 'max-w-full', 'wrap-break-word'];

/** The five breadcrumb navs at FE bd29fc1 (2026-09-30). Adding one is a decision: update this. */
const EXPECTED_NAVS = 5;

function breadcrumbNavs(): { site: string; className: string }[] {
  const out: { site: string; className: string }[] = [];
  for (const file of sourceFiles(SRC)) {
    const rel = path.relative(SRC, file);
    const src = withoutComments(fs.readFileSync(file, 'utf8'));
    for (const m of src.matchAll(NAV_OPEN)) {
      const tag = readOpeningTag(src, m.index ?? 0) ?? '';
      const cls = /className="([^"]*)"/.exec(tag)?.[1] ?? '';
      out.push({ site: `${rel}:${src.slice(0, m.index ?? 0).split('\n').length}`, className: cls });
    }
  }
  return out.sort((a, b) => a.site.localeCompare(b.site));
}

describe('breadcrumb pills cap at their container (UAT3-D1, 2026-09-30)', () => {
  const navs = breadcrumbNavs();

  it('the roster of breadcrumb navs is the one this gate knows', () => {
    expect(navs.map((n) => n.site)).toHaveLength(EXPECTED_NAVS);
  });

  it('every breadcrumb nav is an inline-block pill capped by max-w-full with wrap-break-word', () => {
    const failing = navs
      .filter((n) => !REQUIRED.every((token) => n.className.split(/\s+/).includes(token)))
      .map((n) => `${n.site} — "${n.className}"`);
    expect(failing).toEqual([]);
  });
});
