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
    // Top level only: the reduced-motion block carries a second rule on this selector
    // (88.9-CR m5, pinned by test 2b), which sits at brace depth 1 inside the media query.
    const dangerPress = rulesFor('.btn-danger:active' + NOT).filter((r) => r.depth === 0);
    expect(press.length, 'the .btn press rule occurs once').toBe(1);
    expect(hover.length, 'the .btn-danger hover rule occurs once').toBe(1);
    expect(/(^|[;\s])opacity\s*:/.test(hover[0].body), 'the .btn-danger hover rule still dims with opacity').toBe(false);
    expect(declIn(hover[0].body, 'background-color'), 'hover background-color').toBe('var(--color-btn-danger-hover)');

    expect(dangerPress.length, 'the top-level .btn-danger press rule occurs exactly once').toBe(1);
    // 88.9-CR scoped check: the unfiltered count is pinned too, so a third copy of this selector in
    // any other block (a .dark or @layer override of the press background) is a decision, not a drift.
    expect(rulesFor('.btn-danger:active' + NOT).length, 'the .btn-danger press selector occurs exactly twice file-wide (top level + the reduced-motion exception)').toBe(2);
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

  it('2b. 88.9-CR m5 — under prefers-reduced-motion the .btn-danger press still steps in 0s, declared after the 100ms wildcard', () => {
    // The wildcard sets transition-duration 100ms !important on every element; an unlayered
    // !important beats the press rule's plain 0s, so without an exception reduced-motion users
    // got a 100ms ease on the M4a press step instead of the ruled instant step. 0s is less
    // motion, not more. The exception must sit INSIDE the media block and AFTER the wildcard.
    const NOT = ":not(:disabled):not([aria-disabled='true'])";
    const mediaAt = uniqueMaskedMatch(/@media \(prefers-reduced-motion: reduce\) \{/g);
    expect(mediaAt, 'the reduced-motion media block occurs exactly once').toBeGreaterThanOrEqual(0);
    const media = braceBody(mediaAt);
    expect(media, 'the reduced-motion media block isolates').not.toBeNull();
    const m = media as { body: string; start: number; end: number };
    const wildcardAt = m.body.indexOf('transition-duration: 100ms !important;');
    expect(wildcardAt, 'the wildcard transition-duration 100ms !important line').toBeGreaterThanOrEqual(0);
    const inside = rulesFor('.btn-danger:active' + NOT).filter((r) => r.start > m.start && r.start < m.end);
    expect(inside.length, 'the .btn-danger press rule inside the reduced-motion block').toBe(1);
    expect(
      declIn(inside[0].body, 'transition-duration'),
      'reduced-motion press transition-duration',
    ).toBe('0s !important');
    expect(
      inside[0].start - m.start > wildcardAt,
      'the press exception is declared after the wildcard transition-duration line',
    ).toBe(true);
  });

  it('3. 88.9 M1 — the heatmap count reads the warm-900 count token on every green fill in BOTH themes', () => {
    // Owner pick M1b (88.9-PICKS-A-MINI.json, 2026-11-01). SOURCE arm first, so a pre-fix red
    // names the defect: the per-cell count span must carry the token class, not the green-900 one.
    const heatmap = withoutComments(
      fs.readFileSync(path.join(__dirname, 'components', 'EventHeatmapBackground.js'), 'utf8'),
    );
    const oldClass = heatmap.split('text-green-900').length - 1;
    const tokenClass = heatmap.split('text-content-heatmap-count').length - 1;
    expect(
      { oldClass, tokenClass },
      'EventHeatmapBackground.js count ink: text-green-900 x' + oldClass + ', text-content-heatmap-count x' + tokenClass + ' (want 0 and 1)',
    ).toEqual({ oldClass: 0, tokenClass: 1 });

    // TOKEN arm: declared byte-equal in both theme blocks, bridged in @theme inline.
    const lightDecl = declIn(blockText('light'), '--color-text-heatmap-count');
    const darkDecl = declIn(blockText('dark'), '--color-text-heatmap-count');
    expect(lightDecl, '[light] --color-text-heatmap-count is declared in the light :root block').not.toBeNull();
    expect(darkDecl, '[dark] --color-text-heatmap-count is declared in the .dark block').not.toBeNull();
    expect(darkDecl, 'the count ink is byte-equal in both theme blocks').toBe(lightDecl);
    expect(themeInlineDecl('--color-content-heatmap-count'), '@theme inline key --color-content-heatmap-count').toBe(
      'var(--color-text-heatmap-count)',
    );

    // The grounds are the five merged green fills, declared once in the plain @theme block, so the
    // same ground in both themes (the count renders only when count > 0, never on the empty cell).
    const GROUNDS = ['--color-green-100', '--color-green-200', '--color-green-300', '--color-green-400', '--color-green-500'];
    let ran = 0;
    for (const theme of THEMES) {
      const ink = resolveHex(theme, '--color-text-heatmap-count');
      expect(ink, '[' + theme + '] --color-text-heatmap-count resolves to a hex').not.toBeNull();
      for (const ground of GROUNDS) {
        const fill = themeBlockDecl(ground);
        expect(fill, '[' + theme + '] ' + ground + ' is declared in the @theme block').not.toBeNull();
        const r = ratio(ink as string, fill as string);
        expect(r, '[' + theme + '] count ink ' + ink + ' on ' + ground + ' (' + fill + ') = ' + r.toFixed(4) + ':1').toBeGreaterThanOrEqual(4.5);
        ran += 1;
      }
    }
    expect(ran, 'anti-vacuity: 5 grounds x 2 themes measured').toBe(10);
  });

  it('4. 88.9 M2 — the scheduler badge over the committed selection reads white on the selection fill in BOTH themes', () => {
    // Owner pick M2a (88.9-PICKS-A-MINI.json, 2026-11-01). TOKEN arm: CONFIRM-ONLY, both resolve
    // today (white on --color-btn-primary-bg, 5.6617 in both themes). The SOURCE arm below is the
    // discriminating one: the badge must switch to the button-text ink while isSelected.
    for (const theme of THEMES) {
      const ink = resolveHex(theme, '--color-btn-primary-text');
      const fill = resolveHex(theme, '--color-btn-primary-bg');
      expect(ink, '[' + theme + '] --color-btn-primary-text resolves to a hex').not.toBeNull();
      expect(fill, '[' + theme + '] --color-btn-primary-bg resolves to a hex').not.toBeNull();
      const r = ratio(ink as string, fill as string);
      expect(r, '[' + theme + '] badge ink ' + ink + ' on the selection fill ' + fill + ' = ' + r.toFixed(4) + ':1').toBeGreaterThanOrEqual(4.5);
    }

    // SOURCE arm: one className ternary of two literal class strings (never an interpolated
    // class, and never an inline colour, which would beat the class).
    const scheduler = withoutComments(
      fs.readFileSync(path.join(__dirname, 'components', 'EventScheduler.tsx'), 'utf8'),
    );
    const fragment = "isSelected ? 'text-xs text-btn-primary-text' : 'text-xs text-content-primary'";
    const hits = scheduler.split(fragment).length - 1;
    expect(hits, 'EventScheduler.tsx badge className ternary occurrences (want exactly 1)').toBe(1);
  });

  it('5. 88.9 M5 — the current timezone option carries an aria-hidden check glyph and the word current in the option accessible name (M5a)', () => {
    // Owner pick M5a (88.9-PICKS-A-MINI.json, 2026-11-01). SOURCE arm only: the glyph carries no
    // ink class and inherits the aria-current span's ink, so M5a adds no contrast pair; the
    // rendered ink at rest and highlighted is read by plan 88.9-03's Gate C A6e + O1b pins.
    const page = withoutComments(
      fs.readFileSync(path.join(__dirname, 'userProfile', 'page.js'), 'utf8'),
    );
    const combobox = withoutComments(
      fs.readFileSync(path.join(__dirname, '..', 'components', 'ui', 'Combobox.tsx'), 'utf8'),
    );
    const count = (src: string, needle: string): number => src.split(needle).length - 1;

    // page.js writes the glyph as its JS escape (ASCII-only source), so the needle holds the
    // six characters backslash, u, 2, 7, 1, 3; the name tail ends at the closing template
    // quote, written here as an escape so this file stays free of that character.
    const glyph = '<span aria-hidden="true" className="mr-1">{' + "'\\u2713'" + '}</span>';
    const nameProp = 'ariaLabel: tz.value === timezone';
    const nameTail = ', current\u0060';
    expect(count(page, glyph), 'page.js aria-hidden check glyph span occurrences (want exactly 1)').toBe(1);
    expect(count(page, nameProp), 'page.js ariaLabel property on the current zone (want exactly 1)').toBe(1);
    expect(count(page, nameTail), 'page.js accessible-name tail ending in current (want exactly 1)').toBe(1);
    expect(count(combobox, 'aria-label={item.ariaLabel}'), 'Combobox.tsx option-row aria-label wiring (want exactly 1)').toBe(1);
    expect(count(combobox, 'ariaLabel?: string;'), 'Combobox.tsx ComboboxItem.ariaLabel field (want exactly 1)').toBe(1);

    // The M5 prohibitions, read inside the timezoneItems block: never an sr-only span in the
    // label, never visible (current) text after the name (M5b, offered, not picked).
    const start = page.indexOf('const timezoneItems = useMemo');
    expect(start, 'anti-vacuity: the timezoneItems block opens in page.js').toBeGreaterThan(-1);
    const end = page.indexOf('onSelect: () => handleTimezoneSelect(tz.value),', start);
    expect(end, 'anti-vacuity: the timezoneItems block reaches its onSelect').toBeGreaterThan(start);
    const block = page.slice(start, end);
    expect(count(block, glyph), 'anti-vacuity: the glyph span sits inside the timezoneItems block').toBe(1);
    expect(count(block, 'sr-only'), 'timezoneItems block sr-only occurrences (want 0)').toBe(0);
    expect(count(block, '(current)'), 'timezoneItems block visible (current) text occurrences (want 0)').toBe(0);
  });

  it('6. 88.9 R-C5 — the GroupGamesList rating number and the two gameDetail review star lines carry the DEC-2 rating ink in both themes, the stars are one role=img leaf each, and the shipped raw yellow rating inks are gone', () => {
    // Owner ruling R-C5 (88.9-RULINGS.md, 2026-11-10) on plan 88.9-44's DEC-2 ink. The class pair is
    // counted in CODE only: the R-C5 markers name the ink in prose, so the comment-stripped count is
    // exact. The ink's ratios on the card are pinned by plan 88.9-44's GameSuggestionCard reads.
    const groupGames = withoutComments(
      fs.readFileSync(path.join(__dirname, 'components', 'GroupGamesList.js'), 'utf8'),
    );
    const gameDetail = withoutComments(
      fs.readFileSync(path.join(__dirname, 'gameDetail', 'page.js'), 'utf8'),
    );
    const suggestion = withoutComments(
      fs.readFileSync(path.join(__dirname, 'components', 'GameSuggestionCard.js'), 'utf8'),
    );
    const count = (src: string, needle: string): number => src.split(needle).length - 1;
    const PAIR = 'text-yellow-800 dark:text-yellow-500';
    const USER_STARS = '{renderStars(userReview.rating)}';
    const REVIEW_STARS = '{renderStars(review.rating)}';

    expect(count(groupGames, 'Rating: <span className='), 'anti-vacuity: the GroupGamesList rating span is present').toBe(1);
    expect(count(gameDetail, USER_STARS), 'anti-vacuity: the user review stars are present').toBe(1);
    expect(count(gameDetail, REVIEW_STARS), 'anti-vacuity: the other reviews stars are present').toBe(1);

    expect(count(groupGames, PAIR), 'GroupGamesList.js ruled rating ink occurrences in code (want 1)').toBe(1);
    expect(count(gameDetail, PAIR), 'gameDetail/page.js ruled rating ink occurrences in code (want 2)').toBe(2);
    expect(count(suggestion, PAIR), 'GameSuggestionCard.js ruled rating ink occurrences in code (want 1)').toBe(1);
    expect(count(groupGames, 'text-yellow-600'), 'GroupGamesList.js old rating ink occurrences (want 0)').toBe(0);
    expect(count(gameDetail, 'text-yellow-600'), 'gameDetail/page.js old rating ink occurrences (want 0)').toBe(0);
    expect(count(suggestion, 'text-yellow-600'), 'GameSuggestionCard.js old rating ink occurrences (want 0)').toBe(0);
    // Anchored on the opening quote: the ruled string also contains the old class start.
    expect(count(gameDetail, '"text-yellow-500 text-xl'), 'gameDetail/page.js old star line class start (want 0)').toBe(0);

    // The leaf: role img, its label opening with Rated, wrapping the stars; no sr-only sibling.
    const LEAF_OPEN = '<span role="img" aria-label={' + '\u0060' + 'Rated ';
    expect(count(gameDetail, LEAF_OPEN), 'gameDetail/page.js role=img Rated leaves (want 2)').toBe(2);
    for (const stars of [USER_STARS, REVIEW_STARS]) {
      const at = gameDetail.indexOf(stars);
      const open = gameDetail.lastIndexOf(LEAF_OPEN, at);
      expect(open, 'a Rated leaf opens before ' + stars).toBeGreaterThan(-1);
      expect(gameDetail.slice(open, at).includes('</span>'), 'the leaf is still open at ' + stars).toBe(false);
      expect(gameDetail.slice(at + stars.length).trimStart().startsWith('</span>'), 'the leaf closes right after ' + stars).toBe(true);
    }
    expect(count(gameDetail, 'sr-only">Rated'), 'gameDetail/page.js sr-only Rated siblings (want 0)').toBe(0);
  });
});
