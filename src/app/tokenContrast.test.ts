/**
 * Gate A — the token-layer WCAG gate for Phase 88.3 (Reqs 1-8).
 *
 * It reads `globals.css`, isolates each theme block by BRACE DEPTH, resolves every `var()`
 * chain down to a literal inside the correct block, and asserts the floors this phase
 * claims. One bare `it(` per floor group, so a red run names the requirement.
 *
 * ---------------------------------------------------------------------------------------
 * DECISION Phase 88.3-05 (D-06): this gate reads the DECLARED token layer, not rendered
 * pixels — chosen OVER relying only on the Playwright contrast probe (Gate C).
 * ---------------------------------------------------------------------------------------
 * CHOSEN: a vitest suite in the fast `quality` lane (`ci.yml:65`, `npx vitest run`). It
 * reds on a laptop in seconds, which is what gives the ~211 call-site edits in plans 06-11
 * a signal that needs no browser, no build, no database and no CI round trip.
 *
 * REJECTED: leaving the phase's ratios to the in-browser probe alone. That probe is
 * CI-only in practice — `.auth/user.json` is produced by the `setup` Playwright project
 * against real Auth0 and the e2e lane takes ~10 minutes to report — so a token typo would
 * be found ten minutes and one push after it was written, not two seconds after.
 *
 * BOTH gates exist and they import the SAME maths (`src/lib/wcag.ts`, which
 * `e2e/support/contrast.ts` re-exports), so they can never disagree about a ratio. What
 * this gate CANNOT see is stated in the `<verification>` block of `88.3-05-PLAN.md` and
 * repeated in the "what this does not claim" note below: a cascade problem, an inline
 * `style` override, a composited ground, or a class string Tailwind never emitted.
 *
 * Deleting this suite in favour of the browser probe is a decision, not a cleanup.
 *
 * WHAT THIS DOES NOT CLAIM
 * ------------------------
 * That the app RENDERS these values. It claims the token layer DECLARES them. Gate B
 * (plans 06-11) covers the call sites and Gate C (plan 12) measures the rendered pixels.
 * `88.3-UI-SPEC.md` §5.11 row 50 (`LandingPage.js:31`'s `bg-white/20` over the hero) is
 * not computable from tokens at all and stays open until plan 12 measures it (OI-7).
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { blend, contrastRatio, deltaLStar, lStar, parseHex } from '../lib/wcag';

const GLOBALS = path.join(__dirname, 'globals.css');

/** The stylesheet as authored — comments intact, because two block anchors ARE comments. */
const RAW = fs.readFileSync(GLOBALS, 'utf8');

/**
 * The same bytes with every `/* ... *\/` region replaced by equal-length whitespace.
 *
 * Equal-length matters: every index is identical between `RAW` and `MASKED`, so an anchor
 * located in `RAW` (a header comment) can drive a brace walk in `MASKED`. Masking is what
 * keeps a `{` or a `--color-…:` inside a 40-line DECISION marker out of the parse — and
 * `globals.css` is ~60% comment by line count, so that is not a hypothetical.
 */
const MASKED = RAW.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));

/** Thrown instead of returning `''` — see the anti-vacuity note on test 0b. */
class TokenContrastParseError extends Error {
  constructor(message: string) {
    super(`tokenContrast Gate A parse failure — ${message}`);
    this.name = 'TokenContrastParseError';
  }
}

type BlockName = 'palette' | 'light' | 'dark' | 'theme' | 'bridge';
type Theme = 'light' | 'dark';

/**
 * Every `:root {` that opens a block, by index.
 *
 * `globals.css` has THREE of them — the design palette, the light semantic block, and the
 * shadcn bridge — so a bare `:root {` search is AMBIGUOUS for all three, and the FIRST one
 * a naive search finds is the PALETTE, not light. Nothing below anchors on `:root` directly.
 */
const ROOT_OPENS: number[] = [...MASKED.matchAll(/^:root[ \t]*\{/gm)].map((m) => m.index);

/** Locate a literal anchor and prove it is unique — a second occurrence is a silent re-parse. */
function uniqueIndex(needle: string, what: string): number {
  const first = RAW.indexOf(needle);
  if (first < 0) {
    throw new TokenContrastParseError(`anchor for the "${what}" block was not found: ${needle}`);
  }
  if (RAW.indexOf(needle, first + 1) >= 0) {
    throw new TokenContrastParseError(
      `anchor for the "${what}" block is AMBIGUOUS (>=2 occurrences): ${needle}`,
    );
  }
  return first;
}

/**
 * Locate a block OPENER in the MASKED source and prove it is unique.
 *
 * Masked rather than authored, because `@utility card` and `@theme inline` are both named
 * in prose inside this file's own DECISION markers — an anchor searched in the authored
 * text is ambiguous for exactly the reason `parseRegistryEntries` documents at
 * `ci-grep-gate.fixture.test.ts:451-457`: a loose match reads the prose as data.
 */
function uniqueMatch(re: RegExp, what: string): number {
  const hits = [...MASKED.matchAll(re)].map((m) => m.index);
  if (hits.length !== 1) {
    throw new TokenContrastParseError(
      `expected exactly one \`${what}\` block opener in the masked source, found ${hits.length}`,
    );
  }
  return hits[0];
}

/** Brace-depth walk from the `{` at or after `openIdx`, returning the block body. */
function braceBlock(openIdx: number, what: string): string {
  const brace = MASKED.indexOf('{', openIdx);
  if (brace < 0) throw new TokenContrastParseError(`block "${what}" has no opening brace`);
  let depth = 0;
  for (let i = brace; i < MASKED.length; i += 1) {
    if (MASKED[i] === '{') depth += 1;
    else if (MASKED[i] === '}') {
      depth -= 1;
      if (depth === 0) return MASKED.slice(brace + 1, i);
    }
  }
  throw new TokenContrastParseError(`block "${what}" never closes`);
}

const BLOCK_CACHE = new Map<BlockName, string>();

/**
 * One CSS block, isolated by brace depth and anchored on text UNIQUE to it.
 *
 * Anchored on content rather than on a line number or a bare selector, deliberately: plan
 * 03 inserted 144 lines and plan 04 another ~286 into this file mid-phase, so every line
 * cite written before them drifted by 55-90 lines. An anchor that drifts is worse than one
 * that breaks, because it silently parses the wrong block.
 */
function blockOf(name: BlockName): string {
  const cached = BLOCK_CACHE.get(name);
  if (cached !== undefined) return cached;

  let body: string;
  if (name === 'dark') {
    // `.dark {` is the only occurrence in the file — no walk, no ambiguity.
    body = braceBlock(uniqueMatch(/^\.dark[ \t]*\{/gm, '.dark {'), 'dark');
  } else if (name === 'theme') {
    body = braceBlock(uniqueMatch(/^@theme inline[ \t]*\{/gm, '@theme inline {'), 'theme');
  } else if (name === 'bridge') {
    // The bridge is anchored on a declaration INSIDE it, so walk BACKWARD to its `:root {`.
    const anchor = uniqueIndex('--background: var(--color-bg-page)', 'bridge');
    const open = [...ROOT_OPENS].reverse().find((i) => i < anchor);
    if (open === undefined) {
      throw new TokenContrastParseError('the bridge anchor is not inside any `:root {` block');
    }
    body = braceBlock(open, 'bridge');
  } else {
    // Palette and light are anchored on their own section header COMMENT, which precedes
    // the block, so walk FORWARD to the next `:root {`.
    const header =
      name === 'palette'
        ? '/* ===== DESIGN SYSTEM: Palette Primitives ===== */'
        : '/* ===== DESIGN SYSTEM: Semantic Tokens (Light = default) ===== */';
    const anchor = uniqueIndex(header, name);
    const open = ROOT_OPENS.find((i) => i > anchor);
    if (open === undefined) {
      throw new TokenContrastParseError(`no \`:root {\` block follows the "${name}" header comment`);
    }
    body = braceBlock(open, name);
  }

  if (body.trim().length === 0) {
    throw new TokenContrastParseError(`block "${name}" parsed EMPTY — the anchor found nothing`);
  }
  BLOCK_CACHE.set(name, body);
  return body;
}

/** The `@utility card` body — the legacy card idiom, which no JSX sweep can reach (Req 3). */
function utilityCardBlock(): string {
  return braceBlock(uniqueMatch(/^@utility card[ \t]*\{/gm, '@utility card {'), 'utility card');
}

const PROP_SHAPE = /^--[a-z0-9-]+$/i;

/** The LAST declaration of `prop` in `block` (CSS cascade), or `null` if absent. */
function declIn(block: string, prop: string): string | null {
  if (!PROP_SHAPE.test(prop)) {
    throw new TokenContrastParseError(`"${prop}" is not a custom-property name`);
  }
  let last: string | null = null;
  for (const m of block.matchAll(new RegExp(`^[ \\t]*${prop}[ \\t]*:([^;]*);`, 'gm'))) {
    last = m[1].trim();
  }
  return last;
}

/**
 * The four-step lookup, in this EXACT order:
 *   1. `.dark`        — ONLY when theme === 'dark' (there is no separate light-named block,
 *                       so for light this step is a no-op and lookup starts at step 2)
 *   2. light `:root`  — the semantic block
 *   3. bridge `:root` — the shadcn names; this is why `resolve('dark', '--accent-foreground')`
 *                       returns a real hex instead of throwing, since `.dark` never carries it
 *   4. palette        — the literal ramps
 */
function lookup(theme: Theme, prop: string): string | null {
  if (theme === 'dark') {
    const dark = declIn(blockOf('dark'), prop);
    if (dark !== null) return dark;
  }
  for (const block of ['light', 'bridge', 'palette'] as const) {
    const value = declIn(blockOf(block), prop);
    if (value !== null) return value;
  }
  return null;
}

const VAR_REF = /^var\(\s*(--[a-z0-9-]+)\s*\)$/i;
const MAX_HOPS = 12;

/** Follow the `var()` chain for ONE theme to its terminal literal. Throws; never returns `''`. */
function resolveRaw(theme: Theme, prop: string): string {
  let current = prop;
  const trail: string[] = [prop];
  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const value = lookup(theme, current);
    if (value === null) {
      throw new TokenContrastParseError(
        `[${theme}] "${current}" is declared in NONE of .dark / light :root / bridge :root / palette (chain: ${trail.join(' -> ')})`,
      );
    }
    const ref = VAR_REF.exec(value);
    if (!ref) return value;
    trail.push(ref[1]);
    current = ref[1];
  }
  throw new TokenContrastParseError(
    `[${theme}] the var() chain from "${prop}" did not terminate in ${MAX_HOPS} hops (chain: ${trail.join(' -> ')})`,
  );
}

function toHex6(rgb: readonly number[]): string {
  return `#${rgb.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
}

/**
 * `prop` resolved for `theme` to a normalised `#rrggbb`, or the literal `none`.
 *
 * A translucent `rgba(...)` is returned VERBATIM rather than flattened, because flattening
 * would silently discard the alpha that makes it translucent. Callers that need the
 * composited result ask for it explicitly via `resolveOver`.
 *
 * THROWS on an absent property or an unresolvable chain. It never returns `''`, and that
 * is the single most load-bearing line in this file: a resolver that returned empty string
 * would make EVERY floor assertion below pass vacuously (threat T-88.3-15).
 */
function resolve(theme: Theme, prop: string): string {
  const literal = resolveRaw(theme, prop);
  if (literal === 'none') return 'none';
  if (/^rgba?\(/i.test(literal)) return literal;
  const rgb = parseHex(literal);
  if (rgb) return toHex6(rgb);
  throw new TokenContrastParseError(
    `[${theme}] "${prop}" terminates at "${literal}", which is neither a colour nor \`none\``,
  );
}

/** The raw declaration text for a non-colour property (Req 3's shadows), unresolved. */
function resolveShadow(theme: Theme, prop: string): string {
  const value = lookup(theme, prop);
  if (value === null) {
    throw new TokenContrastParseError(`[${theme}] shadow property "${prop}" is not declared anywhere`);
  }
  return value;
}

/**
 * A translucent token composited over an opaque ground, so a scrim can be measured.
 *
 * These are the ONLY composited rows Gate A can compute, and `88.3-UI-SPEC.md` §5.11 marks
 * them. The `groupHomePage` 15% black dim (§5.10.3) and `LandingPage.js:31`'s `bg-white/20`
 * over the hero (row 50, OI-7) are NOT computable here — the first needs a group colour
 * from the database (plan 11), the second needs an in-browser measurement (plan 12).
 */
function resolveOver(theme: Theme, prop: string, ground: string): string {
  const literal = resolve(theme, prop);
  const func = /^rgba?\(\s*([^)]*)\)$/i.exec(literal);
  if (!func) return literal;
  const parts = func[1]
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter((part) => part.length > 0);
  const alpha = parts.length >= 4 ? Number(parts[3]) : 1;
  const composited = blend(literal, alpha, ground);
  if (composited === null) {
    throw new TokenContrastParseError(
      `[${theme}] could not composite "${prop}" (${literal}) at alpha ${alpha} over ${ground}`,
    );
  }
  return composited;
}

function ratioHex(a: string, b: string, what: string): number {
  const value = contrastRatio(a, b);
  if (value === null) throw new TokenContrastParseError(`contrastRatio(${a}, ${b}) is null — ${what}`);
  return value;
}

function deltaHex(a: string, b: string, what: string): number {
  const value = deltaLStar(a, b);
  if (value === null) throw new TokenContrastParseError(`deltaLStar(${a}, ${b}) is null — ${what}`);
  return value;
}

function lStarOf(hex: string, what: string): number {
  const value = lStar(hex);
  if (value === null) throw new TokenContrastParseError(`lStar(${hex}) is null — ${what}`);
  return value;
}

/**
 * Assert `ink` on `ground` clears `floor`, naming the requirement AND both operands in the
 * message — so a red run IS the diagnosis and nobody has to re-run to find out what failed
 * (the `padding-budget.spec.ts:172-192` rule, applied to the token layer).
 *
 * Assertions here compare against FLOORS, never against a hex, so a future re-tint that
 * still clears its floor does not churn this file (`tailwind-v4-styles.spec.ts:37-40`).
 * The two deliberate exceptions are marked at their sites.
 */
function expectRatio(theme: Theme, ink: string, ground: string, floor: number, req: string): number {
  const inkHex = resolve(theme, ink);
  const groundHex = resolve(theme, ground);
  const value = ratioHex(inkHex, groundHex, `${req} ${ink} on ${ground}`);
  expect(
    value,
    `${req} — [${theme}] ${ink} (${inkHex}) on ${ground} (${groundHex}) measures ${value.toFixed(4)}:1, floor ${floor.toFixed(2)}:1`,
  ).toBeGreaterThanOrEqual(floor);
  return value;
}

/** The mirror of `expectRatio` — used for acceptance BANDS and for recorded failures. */
function expectRatioBelow(theme: Theme, ink: string, ground: string, ceiling: number, req: string): number {
  const inkHex = resolve(theme, ink);
  const groundHex = resolve(theme, ground);
  const value = ratioHex(inkHex, groundHex, `${req} ${ink} on ${ground}`);
  expect(
    value,
    `${req} — [${theme}] ${ink} (${inkHex}) on ${ground} (${groundHex}) measures ${value.toFixed(4)}:1, ceiling ${ceiling.toFixed(2)}:1`,
  ).toBeLessThan(ceiling);
  return value;
}

function expectDelta(theme: Theme, a: string, b: string, floor: number, req: string): number {
  const aHex = resolve(theme, a);
  const bHex = resolve(theme, b);
  const value = deltaHex(aHex, bHex, `${req} ${a} vs ${b}`);
  expect(
    value,
    `${req} — [${theme}] ΔL* between ${a} (${aHex}) and ${b} (${bHex}) is ${value.toFixed(4)}, floor ${floor.toFixed(2)}`,
  ).toBeGreaterThanOrEqual(floor);
  return value;
}

/** The three status hue families, by token stem. */
const STATUS_HUES = ['success', 'error', 'warning'] as const;

describe('Phase 88.3 Gate A — token-layer WCAG floors (Reqs 1-8)', () => {
  it('0. the parser is reading real theme blocks, not empty strings', () => {
    const light = resolve('light', '--color-bg-page');
    const dark = resolve('dark', '--color-bg-page');
    expect(light, `anti-vacuity: light --color-bg-page resolved to "${light}"`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    expect(dark, `anti-vacuity: dark --color-bg-page resolved to "${dark}"`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    expect(
      light,
      `anti-vacuity: both themes resolved --color-bg-page to ${light} — the .dark block is not being read`,
    ).not.toBe(dark);
    // ...and the four blocks really are four DIFFERENT blocks, not one found four times.
    const bodies = (['palette', 'light', 'dark', 'bridge'] as const).map((n) => blockOf(n));
    expect(new Set(bodies).size, 'anti-vacuity: blockOf() returned duplicate block bodies').toBe(4);
  });

  it('0b. the resolver throws on an absent property rather than returning empty', () => {
    // The vacuity mode this whole file is built against: `resolve` returning '' would make
    // every contrast assertion below compare '' with '' and pass.
    expect(() => resolve('light', '--color-does-not-exist')).toThrow(TokenContrastParseError);
    expect(() => resolve('dark', '--color-does-not-exist')).toThrow(TokenContrastParseError);
    // A property that exists but is not a colour must also fail loudly, not coerce.
    expect(() => resolve('light', '--theme-transition')).toThrow(TokenContrastParseError);
  });

  it('0c. globals.css still holds the hex the components are forbidden', () => {
    // Mirrors `rawColorValues.test.ts:266-274`. If a future "cleanup" emptied the theme
    // block, every ratio here would resolve to nothing and this file would throw — but
    // stating it as its own assertion means the diagnosis is one line, not a stack trace.
    expect(RAW).toContain('@theme');
    const hex = RAW.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];
    expect(hex.length, `globals.css carries ${hex.length} hex literals, expected > 50`).toBeGreaterThan(
      50,
    );
  });

  it('0d. the bridge :root block resolves for both themes', () => {
    // `--accent-foreground` is declared ONLY in the shadcn bridge block; `.dark` does not
    // carry it. This is the test that catches the two-`:root`-blocks defect: a `blockOf`
    // that anchored on a bare `:root {` would find the PALETTE, `blockOf('light')` would
    // silently miss the bridge, and this resolve would throw.
    const darkAccentFg = resolve('dark', '--accent-foreground');
    expect(darkAccentFg, `bridge lookup: dark --accent-foreground resolved to "${darkAccentFg}"`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    const lightAccentFg = resolve('light', '--accent-foreground');
    expect(lightAccentFg, `bridge lookup: light --accent-foreground resolved to "${lightAccentFg}"`).toMatch(
      /^#[0-9a-f]{6}$/i,
    );
    expect(
      resolve('dark', '--color-bg-page'),
      'bridge lookup must not flatten the two themes onto one value',
    ).not.toBe(resolve('light', '--color-bg-page'));
  });

  // ===================================================================================
  // Req 1 — the light surface ladder (UI-SPEC §5.2, §5.11 rows 1-6)
  // ===================================================================================

  it('1. Req 1 — the light page/card ladder clears ΔL* 4.0', () => {
    // FLOOR IS 4.0, AND IT IS ASSERTED AGAINST RAW HELPER OUTPUT. §5.11 prints ΔL* as
    // `100 − L*(rounded to 1dp)`, so this ladder PUBLISHES as 5.00 while the raw delta is
    // 4.9768. A floor written at ">= 5.00" would red a correct tree — that is the drift
    // plan 01 pinned both forms against and plan 03's SUMMARY handed forward.
    expectDelta('light', '--color-bg-page', '--color-bg-card', 4.0, 'Req 1 / §5.11 row 1');
  });

  it('2. Req 1 — light card-hover is a third value, below the page (§5.2 ladder self-check)', () => {
    const card = resolve('light', '--color-bg-card');
    const page = resolve('light', '--color-bg-page');
    const cardHover = resolve('light', '--color-bg-card-hover');
    expect(cardHover, `Req 1 — light --color-bg-card-hover (${cardHover}) must differ from the card`).not.toBe(card);
    expect(cardHover, `Req 1 — light --color-bg-card-hover (${cardHover}) must differ from the page`).not.toBe(page);
    // Deliberately DARKER than the page: a pill is darker than its surroundings while a
    // hovered card is lighter. Those are opposite directions and D-01 split the token for
    // exactly that reason. Flipping this ordering is a decision, not a cleanup.
    expect(
      lStarOf(cardHover, 'card-hover'),
      `Req 1 — card-hover (${cardHover}, L* ${lStarOf(cardHover, 'x').toFixed(2)}) must sit BELOW the page (${page}, L* ${lStarOf(page, 'x').toFixed(2)})`,
    ).toBeLessThan(lStarOf(page, 'page'));
  });

  it('3. Req 1 — light bg-hover and bg-sunken resolve and sit between the page and the card', () => {
    const lPage = lStarOf(resolve('light', '--color-bg-page'), 'page');
    const lCard = lStarOf(resolve('light', '--color-bg-card'), 'card');
    for (const prop of ['--color-bg-hover', '--color-bg-sunken']) {
      const hex = resolve('light', prop);
      expect(hex, `Req 1 — light ${prop} resolved to "${hex}"`).toMatch(/^#[0-9a-f]{6}$/i);
      const l = lStarOf(hex, prop);
      expect(l, `Req 1 — light ${prop} (${hex}, L* ${l.toFixed(2)}) must sit ABOVE the page (L* ${lPage.toFixed(2)})`).toBeGreaterThan(lPage);
      expect(l, `Req 1 — light ${prop} (${hex}, L* ${l.toFixed(2)}) must sit BELOW the card (L* ${lCard.toFixed(2)})`).toBeLessThan(lCard);
    }
  });

  it('4. Req 1 — dark sunken is a distinct third surface from BOTH the dark card and the dark page', () => {
    // D-03: `#1c2432` is a minted 45% point on purple-950 -> purple-900. The rejected
    // alternative (reuse `--purple-950`) would make a sunken block identical to the page.
    expectDelta('dark', '--color-bg-sunken', '--color-bg-card', 2.0, 'Req 1 / §5.11 row 5');
    expectDelta('dark', '--color-bg-sunken', '--color-bg-page', 2.0, 'Req 1 / §5.11 row 6');
  });

  it('5. Req 1 — dark bg-hover is byte-identical to the dark card-hover value', () => {
    // The claim that makes "dark does not move" true for all 42 swept hover sites.
    const hover = resolve('dark', '--color-bg-hover');
    const cardHover = resolve('dark', '--color-bg-card-hover');
    expect(hover, `Req 1 — dark --color-bg-hover (${hover}) must equal dark --color-bg-card-hover (${cardHover}) so every swept site is byte-identical in dark`).toBe(cardHover);
  });

  it('6. Req 1 — the modal scrim really dims, in both themes (the one composited row Gate A can compute)', () => {
    for (const theme of ['light', 'dark'] as const) {
      const page = resolve(theme, '--color-bg-page');
      const scrim = resolveOver(theme, '--color-bg-overlay', page);
      const delta = deltaHex(scrim, page, 'overlay over page');
      expect(
        delta,
        `Req 1 — [${theme}] --color-bg-overlay composited over --color-bg-page (${page}) gives ${scrim}, ΔL* ${delta.toFixed(4)}; floor 4.00 (one full ladder step)`,
      ).toBeGreaterThanOrEqual(4.0);
    }
  });

  // ===================================================================================
  // Req 2 — borders (UI-SPEC §5.3, §5.11 rows 7-10)
  // ===================================================================================

  it('7. Req 2 — the light --color-border is a HAIRLINE, inside the 1.40-1.80 band', () => {
    // A BAND, not a floor: `--color-border` is a container separator, not a control edge.
    // Promoting it above the band is the RETIRED 235-site hairlines-to-`border-strong`
    // migration (plan 04 amendment 1) — a decision, not a cleanup.
    expectRatio('light', '--color-border', '--color-bg-card', 1.4, 'Req 2 / §5.11 row 7');
    expectRatioBelow('light', '--color-border', '--color-bg-card', 1.8, 'Req 2 / §5.11 row 7');
    expectRatio('light', '--color-border', '--color-bg-page', 1.4, 'Req 2 / §5.11 row 8');
    expectRatioBelow('light', '--color-border', '--color-bg-page', 1.8, 'Req 2 / §5.11 row 8');
  });

  it('8. Req 2 — --color-border-strong clears 3:1 on the page in BOTH themes', () => {
    // `border-strong` IS the control-boundary token, so it carries the 1.4.11 floor.
    expectRatio('light', '--color-border-strong', '--color-bg-page', 3.0, 'Req 2 / §5.11 row 9');
    expectRatio('dark', '--color-border-strong', '--color-bg-page', 3.0, 'Req 2 / §5.11 row 10');
  });

  // ===================================================================================
  // Req 3 — shadows (UI-SPEC §5.4)
  // ===================================================================================

  it('9. Req 3 — --shadow-sm is exactly `none` in both themes', () => {
    for (const theme of ['light', 'dark'] as const) {
      const value = resolveShadow(theme, '--shadow-sm');
      expect(value, `Req 3 — [${theme}] --shadow-sm is "${value}", expected "none" (archetype A: the page tone carries depth, the resting shadow goes away)`).toBe('none');
    }
  });

  it('10. Req 3 — light --shadow-md and --shadow-lg are byte-identical to their pre-phase text', () => {
    // ⚠️ THE ONE PLACE A LITERAL IS CORRECT IN THIS FILE, and the reason is that the
    // assertion IS "this did not change". Both strings are the pre-phase bytes from
    // `git show 956bc34:src/app/globals.css` :674-675. Hover, dropdowns, sheets and modals
    // keep their lift; only `-sm` moved. (The other literal exception is test 12.)
    expect(resolveShadow('light', '--shadow-md'), 'Req 3 — light --shadow-md must be byte-identical to its pre-phase text').toBe('0 4px 6px rgba(120, 80, 40, 0.08)');
    expect(resolveShadow('light', '--shadow-lg'), 'Req 3 — light --shadow-lg must be byte-identical to its pre-phase text').toBe('0 10px 15px rgba(120, 80, 40, 0.10)');
  });

  it('11. Req 3 / OI-2 + D-02 — the legacy `@utility card` rests on -sm and hovers to bg-hover', () => {
    // The 43rd hover site and the only one that lives in CSS rather than a `className`,
    // so the plan-06 JSX sweep can never reach it. Parsed from the MASKED source, so the
    // `-md` mentioned inside the block's own DECISION marker is not read as code.
    const card = utilityCardBlock();
    expect(card, 'Req 3 / OI-2 — `@utility card` must rest on var(--shadow-sm)').toMatch(/box-shadow:\s*var\(--shadow-sm\)/);
    expect(card, 'Req 3 / OI-2 — `@utility card` must NOT rest on var(--shadow-md); that re-splits the two card idioms').not.toMatch(/box-shadow:\s*var\(--shadow-md\)/);
    expect(card, 'Req 1 / D-02 — `@utility card`\'s &:hover must use var(--color-bg-hover)').toMatch(/background-color:\s*var\(--color-bg-hover\)/);
    expect(card, 'Req 1 / D-02 — `@utility card`\'s &:hover must NOT use var(--color-bg-card-hover); after D-01 that is warm-200, a pill-weight ΔL* 10.4 wash').not.toMatch(/background-color:\s*var\(--color-bg-card-hover\)/);
  });

  // ===================================================================================
  // Req 4 — the accent contract (UI-SPEC §5.6, §5.11 rows 11-19)
  // ===================================================================================

  it('12. Req 4 / Pitfall 9 — --accent-foreground still resolves to #161d29 in BOTH themes', () => {
    // ⚠️ THE SECOND AND LAST LITERAL EXCEPTION, same justification as test 10: the claim
    // is "the rename did not move the value". `--color-accent-text` was RENAMED to
    // `--color-on-accent` and the shadcn bridge re-plumbed onto it in the same commit
    // (T-88.3-11); a half-applied rename is what this test catches.
    const light = resolve('light', '--accent-foreground');
    const dark = resolve('dark', '--accent-foreground');
    expect(light, 'Req 4 — light --accent-foreground must still land on purple-950 #161d29 after the rename').toBe('#161d29');
    expect(dark, 'Req 4 — dark --accent-foreground must still land on purple-950 #161d29 after the rename').toBe('#161d29');
    expect(light, 'Req 4 — --accent-foreground is theme-invariant by design').toBe(dark);
    expect(light, 'Req 4 — --accent-foreground must resolve THROUGH --color-on-accent to the palette step').toBe(resolve('light', '--purple-950'));
  });

  it('13. Req 4 — --color-on-accent clears 4.5:1 on the accent fill in both themes', () => {
    expectRatio('light', '--color-on-accent', '--color-accent', 4.5, 'Req 4 / §5.11 row 19');
    expectRatio('dark', '--color-on-accent', '--color-accent', 4.5, 'Req 4 / §5.11 row 19');
  });

  it('14. Req 4 — light accent-text clears 4.5:1 on card, page, card-hover and sunken', () => {
    expectRatio('light', '--color-accent-text', '--color-bg-card', 4.5, 'Req 4 / §5.11 row 11');
    expectRatio('light', '--color-accent-text', '--color-bg-page', 4.5, 'Req 4 / §5.11 row 12');
    expectRatio('light', '--color-accent-text', '--color-bg-card-hover', 4.5, 'Req 4 / §5.11 row 13');
    expectRatio('light', '--color-accent-text', '--color-bg-sunken', 4.5, 'Req 4 / §5.11 row 14');
    // The token is unreachable from a class string without its `@theme inline` key, so the
    // key is part of the requirement, not a detail. `--color-content-accent` is the name
    // plan 08's 20-site sweep migrates TO.
    const theme = blockOf('theme');
    expect(theme, 'Req 4 — `@theme inline` must expose --color-content-accent (the utility plan 08 sweeps to)').toMatch(/--color-content-accent[ \t]*:/);
    expect(theme, 'Req 4 — `@theme inline` must expose --color-content-accent-hover').toMatch(/--color-content-accent-hover[ \t]*:/);
  });

  it('15. Req 4 — light accent-text clears the 3.0 GLYPH floor on bg-accent-subtle', () => {
    // 3.0 not 4.5: §5.11 row 15 is the EmptyState / invite circle glyph, a non-text
    // graphical object under 1.4.11, not body copy.
    expectRatio('light', '--color-accent-text', '--color-bg-accent-subtle', 3.0, 'Req 4 / §5.11 row 15');
  });

  it('16. Req 4 — dark accent-text clears 4.5:1 on the dark card, page and elevated surfaces', () => {
    // Dark is declared at today's `--color-accent` value, so every migrated site is
    // byte-identical in dark. Sharing ONE hex across themes is impossible: amber-800 on
    // the dark card measures 1.95:1.
    expectRatio('dark', '--color-accent-text', '--color-bg-card', 4.5, 'Req 4 / §5.11 row 16');
    expectRatio('dark', '--color-accent-text', '--color-bg-page', 4.5, 'Req 4 / §5.6.2');
    expectRatio('dark', '--color-accent-text', '--color-bg-elevated', 4.5, 'Req 4 / §5.6.2');
    expect(resolve('dark', '--color-accent-text'), 'Req 4 — dark --color-accent-text must equal dark --color-accent so the sweep is a no-op in dark').toBe(resolve('dark', '--color-accent'));
  });

  it('17. Req 4 — accent-text-hover clears 4.5:1 on card and page in BOTH themes', () => {
    // The token exists though the SPEC does not name it: `--color-accent-hover` is
    // amber-400 in both themes and reads 1.67:1 on a white card, so migrating only the
    // RESTING colour would have made hover LESS readable than rest.
    for (const theme of ['light', 'dark'] as const) {
      expectRatio(theme, '--color-accent-text-hover', '--color-bg-card', 4.5, 'Req 4 / §5.11 rows 17-18');
      expectRatio(theme, '--color-accent-text-hover', '--color-bg-page', 4.5, 'Req 4 / §5.11 rows 17-18');
    }
  });

  // ===================================================================================
  // Req 5 — the today tint (UI-SPEC §5.6.3, §5.11 rows 20-21)
  // ===================================================================================

  it('18. Req 5 — the today-tint day number clears 4.5:1 in both themes', () => {
    // The fork is dissolved by the Req 4 value: no tint change, no special-case amber,
    // and the 88-27 D-32 paired-ternary SHAPE at EventScheduler.tsx:998 does not change.
    expectRatio('light', '--color-accent-text', '--color-bg-today-tint', 4.5, 'Req 5 / §5.11 row 20');
    expectRatio('dark', '--color-accent-text', '--color-bg-today-tint', 4.5, 'Req 5 / §5.11 row 21');
  });

  // ===================================================================================
  // Req 6 — status text and borders (UI-SPEC §5.7, §5.11 rows 22-33)
  // ===================================================================================

  it('19. Req 6 — all TWELVE status text cells clear 4.5:1', () => {
    // 3 hues x {plain card, own `-subtle` tint} x 2 themes. §5.11 rows 22-33.
    for (const theme of ['light', 'dark'] as const) {
      for (const hue of STATUS_HUES) {
        expectRatio(theme, `--color-status-${hue}-text`, '--color-bg-card', 4.5, 'Req 6 / §5.7.2 (card)');
        expectRatio(theme, `--color-status-${hue}-text`, `--color-status-${hue}-subtle`, 4.5, 'Req 6 / §5.7.2 (own tint)');
      }
    }
    // ...and the three `@theme inline` keys plan 09's 134-site sweep migrates TO. Without
    // them these values are declared but unreachable from any class string.
    const themeBlock = blockOf('theme');
    for (const hue of STATUS_HUES) {
      expect(themeBlock, `Req 6 — \`@theme inline\` must expose --color-content-status-${hue}`).toMatch(new RegExp(`--color-content-status-${hue}[ \\t]*:`));
    }
  });

  it('20. Req 6 / §5.7.3 — the four PASSING -subtle-hover cells clear 4.5:1', () => {
    // The SPEC's 12-cell table covers RESTING tints only. WCAG does not exempt hover.
    for (const hue of STATUS_HUES) {
      expectRatio('light', `--color-status-${hue}-text`, `--color-status-${hue}-subtle-hover`, 4.5, 'Req 6 / §5.7.3');
    }
    expectRatio('dark', '--color-status-error-text', '--color-status-error-subtle-hover', 4.5, 'Req 6 / §5.7.3');
  });

  it('21. Req 6 / OI-3 — the two dark -subtle-hover cells that do NOT pass, asserted as failing', () => {
    // ⚠️ OI-3 — A RECORDED, OWNER-VISIBLE DEFERRAL, NOT AN OVERSIGHT.
    // dark success `#22c55e` on `#235146` measures 3.94 and dark warning `#f59e0b` on
    // `#554832` measures 4.14. Closing them means moving dark success and warning, which
    // is outside this phase's dark boundary, so they are DEFERRED to the post-88.3 OKLCH
    // recolour with measured candidates already chosen: `#4ade80` green-400 (5.16) and
    // `#fbbf24` amber-400 (5.33). Both hues pass on their RESTING tint (4.66 / 4.95).
    //
    // Asserting the known-bad value rather than omitting the cell is what keeps it honest:
    // if a future phase fixes either hue this test REDS, which forces the deferral record
    // in `.planning/deferred/phase-88.6.md` to be closed rather than quietly forgotten.
    // Deleting this test to make a fix green is a decision, not a cleanup — move the
    // assertion into test 20 and close the deferral in the same commit.
    expectRatioBelow('dark', '--color-status-success-text', '--color-status-success-subtle-hover', 4.5, 'Req 6 / OI-3 (deferred)');
    expectRatioBelow('dark', '--color-status-warning-text', '--color-status-warning-subtle-hover', 4.5, 'Req 6 / OI-3 (deferred)');
  });

  it('22. Req 6 / OI-4 — light status text does not recreate the accent hex collision', () => {
    // `#92400e` amber-800 measures FINE as a light warning (6.05 on its own tint) and was
    // rejected anyway, because it is the same hex as `--color-accent-text` and would
    // recreate OI-4 (`--color-warning` == `--color-accent`) one layer down in a NEW light
    // value. `#854d0e` yellow-800 is measurably equivalent and visually distinct.
    const accent = resolve('light', '--color-accent-text');
    for (const hue of STATUS_HUES) {
      const text = resolve('light', `--color-status-${hue}-text`);
      expect(text, `Req 6 / OI-4 — light --color-status-${hue}-text (${text}) must NOT be the same hex as --color-accent-text (${accent})`).not.toBe(accent);
    }
  });

  it('23. Req 6 / OI-4 — every light status BORDER clears 3:1 on the new page', () => {
    // Req 1 INTRODUCED this failure: the full-strength hues measured 3.11 / 3.01 on the
    // old warm-50 page and 2.91 / 2.81 on warm-100. Per-theme `-border` properties close
    // it in the same phase that opened it.
    for (const hue of STATUS_HUES) {
      expectRatio('light', `--color-status-${hue}-border`, '--color-bg-page', 3.0, 'Req 6 / OI-4 / §5.7.4');
      expectRatio('light', `--color-status-${hue}-border`, '--color-bg-card', 3.0, 'Req 6 / OI-4 / §5.7.4');
    }
  });

  it('24. Req 6 / OI-4 — every dark status BORDER is byte-identical to its dark hue', () => {
    // The structural reason OI-1 Option A was rejected: pointing the theme keys straight
    // at the `-text` tokens would have dragged the dark error border from `#ef4444` to
    // `#fca5a5`. Dark does not move.
    for (const hue of STATUS_HUES) {
      const border = resolve('dark', `--color-status-${hue}-border`);
      const hueValue = resolve('dark', hue === 'success' ? '--color-success' : hue === 'error' ? '--color-error' : '--color-warning');
      expect(border, `Req 6 / OI-4 — dark --color-status-${hue}-border (${border}) must stay byte-identical to the dark hue (${hueValue})`).toBe(hueValue);
    }
  });

  // ===================================================================================
  // Req 7 — the focus ring (UI-SPEC §5.8, §5.11 rows 34-38)
  // ===================================================================================

  it('25. Req 7 — the light focus ring clears 3:1 on page, card, today tint and the accent fill', () => {
    // The fourth ground is what disproved purple-600 (2.64 on the amber-500 fill), the
    // candidate both the SPEC text and `.planning/deferred/phase-88.3.md` recommended.
    expectRatio('light', '--color-focus-ring', '--color-bg-card', 3.0, 'Req 7 / §5.11 row 34');
    expectRatio('light', '--color-focus-ring', '--color-bg-page', 3.0, 'Req 7 / §5.11 row 35');
    expectRatio('light', '--color-focus-ring', '--color-bg-today-tint', 3.0, 'Req 7 / §5.11 row 36');
    expectRatio('light', '--color-focus-ring', '--color-accent', 3.0, 'Req 7 / §5.11 row 37');
  });

  it('26. Req 7 — the dark focus ring is unchanged at --amber-400', () => {
    const ring = resolve('dark', '--color-focus-ring');
    expect(ring, `Req 7 — dark --color-focus-ring (${ring}) must stay on the --amber-400 palette step`).toBe(resolve('dark', '--amber-400'));
    expectRatio('dark', '--color-focus-ring', '--color-bg-page', 3.0, 'Req 7 (dark page)');
    expectRatio('dark', '--color-focus-ring', '--color-bg-card', 3.0, 'Req 7 (dark card)');
  });

  it('27. Req 7 / §5.8.2 — the light ring FAILS on the dark chrome, which is WHY plan 07 scopes it', () => {
    // ⚠️ THIS TEST ASSERTS A FAILURE ON PURPOSE. DO NOT "FIX" IT BY CHANGING THE RING.
    // The header is warm-800 and the nav is purple-900 IN LIGHT MODE — dark chrome in a
    // light app, deliberately (`DESIGN-SYSTEM-REFERENCE-2026.md:59-60`). purple-700 reads
    // 1.93 on the header and 1.78 on the nav, so Req 7 as written would regress keyboard
    // focus on the header, the mobile hamburger and the three menu rows inside it. The fix
    // is plan 07's subtree override to amber-400 (9.00 / 8.30), applied by overriding the
    // RUNTIME property `--color-focus-ring`. Changing the global ring to satisfy both
    // grounds is the decision this test exists to stop; a `dark:` variant is useless here
    // because the ground is dark in BOTH themes.
    for (const ground of ['--color-bg-header', '--color-bg-nav']) {
      expectRatioBelow('light', '--color-focus-ring', ground, 3.0, 'Req 7 / §5.8.2 (recorded failure)');
      expectRatio('light', '--amber-400', ground, 3.0, 'Req 7 / §5.8.2 (the plan-07 override value)');
    }
    expectRatio('light', '--amber-400', '--color-bg-header-hover', 3.0, 'Req 7 / §5.8.2 (the plan-07 override value)');
  });

  // ===================================================================================
  // Req 8 — muted text (UI-SPEC §5.9, §5.11 rows 39-42)
  // ===================================================================================

  it('28. Req 8 — light muted clears 4.5:1 on page, card and sunken', () => {
    expectRatio('light', '--color-text-muted', '--color-bg-card', 4.5, 'Req 8 / §5.11 row 39');
    expectRatio('light', '--color-text-muted', '--color-bg-page', 4.5, 'Req 8 / §5.11 row 40');
    expectRatio('light', '--color-text-muted', '--color-bg-sunken', 4.5, 'Req 8 / §5.11 row 41');
  });

  it('29. Req 8 — muted stays visibly distinct from secondary and from border-strong', () => {
    // warm-600 would clear every ground but collapses muted INTO secondary, destroying a
    // two-level text hierarchy the app uses everywhere. warm-500 stays `border-strong`.
    const muted = resolve('light', '--color-text-muted');
    const secondary = resolve('light', '--color-text-secondary');
    expect(muted, `Req 8 / §5.11 row 42 — light muted (${muted}) must not collapse into secondary (${secondary})`).not.toBe(secondary);
    expectDelta('light', '--color-text-muted', '--color-text-secondary', 4.0, 'Req 8 / §5.11 row 42');
    expectDelta('light', '--color-text-muted', '--color-border-strong', 4.0, 'Req 8 / §5.9.1');
  });

  it('30. Req 8 / §5.9.1 residual — light muted on the warm-200 card-hover ground is BELOW 4.5', () => {
    // ⚠️ DISCLOSED RESIDUAL, ASSERTED RATHER THAN HIDDEN. No value on this ramp clears
    // 4.5:1 on warm-200 AND stays distinct from secondary. SPEC Req 8's acceptance is
    // page + card only, so this sits outside its floor — but it is real.
    //
    // THE PHASE RULE, and it is the thing to read here: on a `bg-surface-card-hover`
    // (warm-200) pill / badge / chip, use `text-content-secondary` (5.04 ✓), NEVER
    // `text-content-muted` (4.15 ✗). Carried to `.planning/deferred/phase-88.6.md` with
    // its site count. If a future phase closes it, this test reds — close the deferral in
    // the same commit rather than deleting the assertion.
    expectRatioBelow('light', '--color-text-muted', '--color-bg-card-hover', 4.5, 'Req 8 / §5.9.1 (disclosed residual)');
    expectRatio('light', '--color-text-secondary', '--color-bg-card-hover', 4.5, 'Req 8 / §5.9.1 (the prescribed replacement)');
  });

  // ===================================================================================
  // The two §5.11 rows outside Reqs 1-8 that are still computable from tokens
  // ===================================================================================

  it('31. §5.11 rows 47 + 49 — the two Req 9 ledger rows that ARE token-computable', () => {
    // Rows 43-46 and 48 need a group colour out of the database (plans 10-11) and row 50
    // needs an in-browser measurement (plan 12, OI-7); these two do not, so they are
    // asserted here rather than left to a gate that runs ten minutes later.
    expectRatio('light', '--color-btn-primary-text', '--color-btn-primary-bg', 4.5, '§5.11 row 47');
    expectRatio('light', '--color-text-primary', '--color-bg-elevated', 4.5, '§5.11 row 49');
  });
});
