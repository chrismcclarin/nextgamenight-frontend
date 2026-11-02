// 88.9 RULING A mini-page picks, pinned at Gate A (vitest).
//
// The picks record: planning:.planning/phases/88.9-fe-look-decisions-design-phase-mockup-gated-split-from-88-6/88.9-PICKS-A-MINI.json
// The build-contract rows: planning:.planning/phases/88.9-fe-look-decisions-design-phase-mockup-gated-split-from-88-6/88.9-UI-SPEC.md ("| M3b | Both bell count badges")
// and the M4a row beside it in the same document.
//
// This file is SHARED: plan 88.9-01 writes tests 1-2 (M3, M4); plan 88.9-08 appends tests 3-4
// (M1, M2) and plan 88.9-09 test 5 (M5). Those later tests resolve palette tokens (for example
// --warm-900, --purple-600) and plain @theme tokens (--color-green-100..500) through the same
// helpers below: lookupIn, resolveHex and themeBlockDecl. Keep their contracts as they are.
//
// CSS reading follows the tokenContrast helpers, src/app/tokenContrast.test.ts ("function declIn(block: string, prop: string): string | null {"):
// comments are masked with equal-length whitespace, src/app/tokenContrast.test.ts ("const MASKED = RAW.replace("),
// so every index matches the authored text; blocks are isolated by brace depth; the LAST
// declaration of a property wins; var() hops follow the order dark (dark theme only), light
// :root, bridge :root, palette :root. The JS lexer is never run over CSS. A property that is
// absent returns null, and every test asserts not.toBeNull with a message naming the property
// and the theme, so a pre-fix red is an assertion line, not a stack trace.

import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { withoutComments } from '../test-utils/sourceScan';
import { contrastRatio, lStar } from '../lib/wcag';

const RAW = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');
const MASKED = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

type Theme = 'light' | 'dark';
type BlockName = 'palette' | 'light' | 'dark' | 'bridge' | 'themeInline' | 'theme';

// Every top-level :root opener, by index (the file has three: palette, light, bridge).
const ROOT_OPENS: number[] = [...MASKED.matchAll(/^:root[ \t]*\{/gm)].map((m) => m.index ?? -1);

function uniqueRawIndex(needle: string): number {
  const first = RAW.indexOf(needle);
  if (first < 0 || RAW.indexOf(needle, first + 1) >= 0) return -1;
  return first;
}

function uniqueMaskedMatch(re: RegExp): number {
  const hits = [...MASKED.matchAll(re)].map((m) => m.index ?? -1);
  return hits.length === 1 ? hits[0] : -1;
}

// The body between the first brace at or after openIdx and its matching close, or null.
function braceBody(openIdx: number): { body: string; start: number; end: number } | null {
  if (openIdx < 0) return null;
  const brace = MASKED.indexOf('{', openIdx);
  if (brace < 0) return null;
  let depth = 0;
  for (let i = brace; i < MASKED.length; i += 1) {
    if (MASKED[i] === '{') depth += 1;
    else if (MASKED[i] === '}') {
      depth -= 1;
      if (depth === 0) return { body: MASKED.slice(brace + 1, i), start: brace + 1, end: i };
    }
  }
  return null;
}

function blockText(name: BlockName): string {
  let open = -1;
  if (name === 'dark') open = uniqueMaskedMatch(/^\.dark[ \t]*\{/gm);
  else if (name === 'themeInline') open = uniqueMaskedMatch(/^@theme inline[ \t]*\{/gm);
  else if (name === 'theme') open = uniqueMaskedMatch(/^@theme[ \t]*\{/gm);
  else if (name === 'bridge') {
    const anchor = uniqueRawIndex('--background: var(--color-bg-page)');
    open = anchor < 0 ? -1 : ([...ROOT_OPENS].reverse().find((i) => i < anchor) ?? -1);
  } else {
    const header =
      name === 'palette'
        ? '/* ===== DESIGN SYSTEM: Palette Primitives ===== */'
        : '/* ===== DESIGN SYSTEM: Semantic Tokens (Light = default) ===== */';
    const anchor = uniqueRawIndex(header);
    open = anchor < 0 ? -1 : (ROOT_OPENS.find((i) => i > anchor) ?? -1);
  }
  const found = braceBody(open);
  if (found === null || found.body.trim() === '') {
    throw new Error('miniPicks: the ' + name + ' block could not be isolated');
  }
  return found.body;
}

// The LAST declaration of prop in a block, or null.
function declIn(block: string, prop: string): string | null {
  let last: string | null = null;
  for (const m of block.matchAll(new RegExp('^[ \\t]*' + prop + '[ \\t]*:([^;]*);', 'gm'))) {
    last = m[1].trim();
  }
  return last;
}

// One lookup step for a theme: dark first (dark only), then light, bridge, palette.
function lookupIn(theme: Theme, prop: string): string | null {
  const order: BlockName[] = theme === 'dark' ? ['dark', 'light', 'bridge', 'palette'] : ['light', 'bridge', 'palette'];
  for (const name of order) {
    const value = declIn(blockText(name), prop);
    if (value !== null) return value;
  }
  return null;
}

// A declaration of the plain @theme block (not @theme inline), unresolved, or null.
function themeBlockDecl(prop: string): string | null {
  return declIn(blockText('theme'), prop);
}

// A declaration of the @theme inline block, unresolved, or null.
function themeInlineDecl(prop: string): string | null {
  return declIn(blockText('themeInline'), prop);
}

// Follow var() hops to a literal and return it as a lowercase hex, or null when any hop is
// absent or the literal is not a hex.
function resolveHex(theme: Theme, prop: string): string | null {
  let current = prop;
  for (let hop = 0; hop <= 12; hop += 1) {
    const value = lookupIn(theme, current);
    if (value === null) return null;
    const ref = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i.exec(value);
    if (!ref) return /^#[0-9a-f]{3,8}$/i.test(value) ? value.toLowerCase() : null;
    current = ref[1];
  }
  return null;
}

// Every rule whose exact selector text is followed by a space and an opening brace.
function rulesFor(selector: string): { body: string; start: number; depth: number }[] {
  const needle = selector + ' {';
  const out: { body: string; start: number; depth: number }[] = [];
  for (let at = MASKED.indexOf(needle); at >= 0; at = MASKED.indexOf(needle, at + 1)) {
    let depth = 0;
    for (let i = 0; i < at; i += 1) {
      if (MASKED[i] === '{') depth += 1;
      else if (MASKED[i] === '}') depth -= 1;
    }
    const found = braceBody(at);
    if (found) out.push({ body: found.body, start: at, depth });
  }
  return out;
}

function ratio(a: string, b: string): number {
  const r = contrastRatio(a, b);
  if (r === null) throw new Error('miniPicks: no contrast ratio for ' + a + ' on ' + b);
  return r;
}

const THEMES: Theme[] = ['light', 'dark'];

describe('88.9 RULING A mini-page picks', () => {
  it('1. 88.9 M3 — both NotificationBell count badges fill with the declared badge token and the white digit clears 4.5:1 in BOTH themes', () => {
    const bell = withoutComments(
      fs.readFileSync(path.join(__dirname, 'components', 'NotificationBell.js'), 'utf8'),
    );
    expect(bell.includes('bg-red-500'), 'NotificationBell.js still carries a raw bg-red-500 class').toBe(false);
    const classes = [...bell.matchAll(/className="([^"]*)"/g)].map((m) => m[1]);
    const badges = classes.filter((c) => c.split(/\s+/).includes('bg-badge-count'));
    expect(badges.length, 'className strings carrying bg-badge-count').toBe(2);
    for (const c of badges) {
      expect(c.split(/\s+/).includes('text-white'), 'badge class without text-white: ' + c).toBe(true);
    }

    expect(themeInlineDecl('--color-badge-count'), '@theme inline key --color-badge-count').toBe(
      'var(--color-badge-count-bg)',
    );

    const fills: Record<Theme, string | null> = { light: null, dark: null };
    for (const theme of THEMES) {
      const fill = resolveHex(theme, '--color-badge-count-bg');
      expect(fill, '[' + theme + '] --color-badge-count-bg resolves to a hex').not.toBeNull();
      const r = ratio('#ffffff', fill as string);
      expect(r, '[' + theme + '] white digit on ' + fill + ' = ' + r.toFixed(4) + ':1 (#ffffff on ' + fill + ')').toBeGreaterThanOrEqual(4.5);
      fills[theme] = fill;
    }
    expect(fills.dark, 'the badge fill is byte-equal in both themes').toBe(fills.light);
  });

  it('2. 88.9 M4 — the .btn-danger hover and press step the fill through declared tokens and the white label clears 4.5:1 on each in BOTH themes', () => {
    const NOT = ":not(:disabled):not([aria-disabled='true'])";
    const press = rulesFor('.btn:active' + NOT);
    const hover = rulesFor('.btn-danger:hover' + NOT);
    const dangerPress = rulesFor('.btn-danger:active' + NOT);
    expect(press.length, 'the .btn press rule occurs once').toBe(1);
    expect(hover.length, 'the .btn-danger hover rule occurs once').toBe(1);
    expect(/(^|[;\s])opacity\s*:/.test(hover[0].body), 'the .btn-danger hover rule still dims with opacity').toBe(false);
    expect(declIn(hover[0].body, 'background-color'), 'hover background-color').toBe('var(--color-btn-danger-hover)');

    expect(dangerPress.length, 'the .btn-danger press rule occurs exactly once').toBe(1);
    const dp = dangerPress[0];
    expect(declIn(dp.body, 'background-color'), 'press background-color').toBe('var(--color-btn-danger-active)');
    expect(declIn(dp.body, 'opacity'), 'press opacity').toBe('1');
    expect(declIn(dp.body, 'transition-duration'), 'press transition-duration').toBe('0s');
    expect(dp.depth, 'the danger press rule sits at brace depth 0 (top level, unlayered)').toBe(0);
    expect(dp.start > press[0].start, 'the danger press rule follows the .btn press rule').toBe(true);
    expect(dp.start > hover[0].start, 'the danger press rule follows the danger hover rule').toBe(true);

    for (const theme of THEMES) {
      const rest = resolveHex(theme, '--color-error');
      const hov = resolveHex(theme, '--color-btn-danger-hover');
      const act = resolveHex(theme, '--color-btn-danger-active');
      expect(rest, '[' + theme + '] --color-error resolves to a hex').not.toBeNull();
      expect(hov, '[' + theme + '] --color-btn-danger-hover resolves to a hex').not.toBeNull();
      expect(act, '[' + theme + '] --color-btn-danger-active resolves to a hex').not.toBeNull();
      const rh = ratio('#ffffff', hov as string);
      const ra = ratio('#ffffff', act as string);
      expect(rh, '[' + theme + '] hover: white label = ' + rh.toFixed(4) + ':1 (#ffffff on ' + hov + ')').toBeGreaterThanOrEqual(4.5);
      expect(ra, '[' + theme + '] press: white label = ' + ra.toFixed(4) + ':1 (#ffffff on ' + act + ')').toBeGreaterThanOrEqual(4.5);
      const lRest = lStar(rest) as number;
      const lHov = lStar(hov) as number;
      const lAct = lStar(act) as number;
      expect(lHov < lRest, '[' + theme + '] hover ' + hov + ' is darker than rest ' + rest).toBe(true);
      expect(lAct < lHov, '[' + theme + '] press ' + act + ' is darker than hover ' + hov).toBe(true);
    }
  });
});
