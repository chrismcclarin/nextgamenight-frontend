// Phase 88.9 plan 59 (owner fix rows 52-X5 a / c): the page-width SOURCE pins.
//
// X5a (owner at the 88.9-51 glance, 2026-11-11: can we make it closer to 1600?): the header nav,
// both footer strips and the home body are ONE box, capped at 100rem (1600px). The four class
// strings are pinned as whole literals, so a cap that moves on one of them alone reds here.
// X5c (owner, same glance: it looks better at 1280): the game view (two roots), the group page and
// the planning page keep the 7xl (1280px) body under that wider header, and each page says so in
// its own DECISION marker, so a later reader does not widen them to match the header.
// X5b + X12 (owner, 2026-11-11: A, lets make the groups wider; W2 is good): the home groups column
// is a clamp that narrows on small windows, and the group list's three roots (identity shell,
// loading, main) carry no width cap of their own, so the list fills whatever the column gives.
//
// WHAT THIS IS NOT: a rendered proof. The widths a browser paints are read in
// e2e/page-width.spec.ts ("X5a (88.9): at 1280, 1440, 1600 and 1920"); this file only holds the
// class strings and the markers in place between CI runs.
//
// HOW IT READS: class strings are counted on the comment-stripped source (a marker may quote the
// old cap in words without tripping a count); the markers are counted on the raw source. Named
// files only, no tree scan, so this file is a helperOnly row in the drift-gate registry.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutComments } from '../test-utils/sourceScan';

const raw = (rel: string): string => readFileSync(resolve(process.cwd(), rel), 'utf8');
const code = (rel: string): string => withoutComments(raw(rel));

/** How many times the literal occurs in the text. */
function count(text: string, literal: string): number {
  return text.split(literal).length - 1;
}

/** The className attributes (double-quoted literals) that hold the given class run. */
function classNamesHolding(text: string, run: string): number {
  const attrs = text.match(/className="[^"]*"/g) ?? [];
  return attrs.filter((attr) => attr.includes(run)).length;
}

const HEADER = 'src/app/Header.js';
const FOOTER = 'src/app/components/Footer.js';
const HOME = 'src/app/userHome/UserHomePage.js';
const GAME = 'src/app/gameDetail/page.js';
const GROUP = 'src/app/groupHomePage/page.js';
const PLANNING = 'src/app/groupPlanning/page.js';
const GROUP_LIST = 'src/app/components/grouplist.js';

const WIDE_CAP = 'max-w-[100rem]';
const READING_CAP = 'max-w-7xl';
const X5C_MARKER = 'DECISION Phase 88.9-59 (X5c';

describe('page width — X5 (88.9-59)', () => {
  it('X5a (88.9): the header nav, both footer strips and the home body cap at max-w-[100rem] (1600) and none keeps max-w-7xl', () => {
    const header = code(HEADER);
    const footer = code(FOOTER);
    const home = code(HOME);

    expect(count(header, 'w-full max-w-[100rem] mx-auto px-4 h-full'), 'the header nav class string').toBe(1);
    expect(count(footer, 'max-w-[100rem] mx-auto px-4 py-4'), 'the two footer strips').toBe(2);
    expect(
      count(home, 'user-home-container max-w-[100rem] mx-auto w-full p-edge-page md:p-edge-wide md:pb-6'),
      'the home body class string',
    ).toBe(1);

    // The four sites carry the same cap literal and nothing else in these files does.
    expect(count(header, WIDE_CAP), 'header: 1600 caps').toBe(1);
    expect(count(footer, WIDE_CAP), 'footer: 1600 caps').toBe(2);
    expect(count(home, WIDE_CAP), 'home: 1600 caps').toBe(1);

    for (const [name, text] of [['header', header], ['footer', footer], ['home', home]] as const) {
      expect(count(text, READING_CAP), `${name}: a 1280 cap left behind`).toBe(0);
    }
  });

  it('X5c (88.9): the game (two roots), group and planning bodies keep max-w-7xl mx-auto under the 1600 header, each page carrying its DECISION Phase 88.9-59 (X5c marker', () => {
    const pages = [
      { name: 'game', rel: GAME, roots: 2 },
      { name: 'group', rel: GROUP, roots: 1 },
      { name: 'planning', rel: PLANNING, roots: 1 },
    ];
    for (const { name, rel, roots } of pages) {
      const text = code(rel);
      expect(classNamesHolding(text, 'max-w-7xl mx-auto'), `${name}: 1280 body roots`).toBe(roots);
      expect(count(text, WIDE_CAP), `${name}: a 1600 cap on a reading page`).toBe(0);
      expect(count(raw(rel), X5C_MARKER), `${name}: the X5c marker`).toBe(1);
    }
  });

  it('X5b + X12 (88.9, rem form 89.6-16): the home column is md:[--bb-col:clamp(20rem,42vw,28.75rem)] and no grouplist root keeps a 400px cap', () => {
    const home = code(HOME);
    // AMENDED 89.6-16 (home-columns): the column is a bb-columns item whose basis is the rem clamp,
    // identical to the px clamp at normal text; the px basis literal is gone.
    expect(count(home, 'md:[--bb-col:clamp(20rem,42vw,28.75rem)]'), 'the rem clamp column literal').toBe(1);
    expect(count(home, 'md:flex-[0_0_clamp(320px,42vw,460px)]'), 'the px clamp basis left behind').toBe(0);
    expect(count(home, 'md:flex-[0_0_460px]'), 'the fixed 460 basis').toBe(0);

    const list = code(GROUP_LIST);
    // Each of the three roots is a className that BEGINS with the uncapped run.
    expect(
      count(list, 'className="w-full bg-surface-page rounded-card surface-flat-phone'),
      'grouplist roots that begin w-full with no cap',
    ).toBe(3);
    expect(count(list, '[400px]'), 'a 400px cap left in grouplist').toBe(0);
    expect(count(list, 'max-md:max-w-full'), 'the phone override of the removed cap').toBe(0);
  });
});
