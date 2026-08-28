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
    //
    // AMENDED 88.3-18 (owner ruling 1c, 2026-08-28): the page moved warm-100 -> warm-200, so this
    // ladder now PUBLISHES as 10.40 with a raw delta of 10.4083 (cr 1.3056). The 4.0 FLOOR is
    // unchanged and the published/raw drift warning above is unchanged — it just got wider.
    // DISCLOSED: 10.40 lands at Material 3's container-highest (filled-card) tier, the top of the
    // whole measured peer range, and M3 ships zero border there while we also carry a 2.31:1
    // `--color-border` (owner ruling 1a-bis, "A, keep"). See the `--color-bg-page` marker.
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
    //
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): card-hover is now the MINTED `--warm-250` `#dbd1c7`
    // (L* 84.3726), sitting ΔL* 5.2191 below the warm-200 page (L* 89.5917). It had to move —
    // ruling 1c took warm-200 for the PAGE, so leaving it would make this row's `!= page`
    // assertion AND its L* ordering both false, and would be a real render defect at
    // `GroupLibrary.js:149-153` (card-hover skeleton bars inside a bg-surface-page parent) and
    // `CalendarMonthView.js:224-226` (today's cell would be byte-identical to an empty one).
    // The rejected alternative warm-300 measures accent-text 4.4440 on it, an AA failure.
    expect(
      lStarOf(cardHover, 'card-hover'),
      `Req 1 — card-hover (${cardHover}, L* ${lStarOf(cardHover, 'x').toFixed(2)}) must sit BELOW the page (${page}, L* ${lStarOf(page, 'x').toFixed(2)})`,
    ).toBeLessThan(lStarOf(page, 'page'));
  });

  it('3. Req 1 — light bg-hover and bg-sunken resolve and sit between the page and the card', () => {
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): the page L* is now 89.5917 (was 95.0232), so this
    // band WIDENED — warm-50 (L* 97.6527) sits ΔL* 8.0610 above the page instead of 2.63. The
    // ladder holds with more room, not less. Values, not the assertion, moved.
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

  it('7. Req 2 — the light --color-border is a HAIRLINE, inside the amended 1.40-2.40 band', () => {
    // A BAND, not a floor: `--color-border` is a container separator, not a control edge.
    // Promoting it above the band is the RETIRED 235-site hairlines-to-`border-strong`
    // migration (plan 04 amendment 1) — a decision, not a cleanup.
    //
    // AMENDED Phase 88.3-14 (owner ruling 1a, 2026-08-27). The FLOOR is unchanged at 1.40. The
    // CEILING moved 1.80 -> 2.40 because the band, not the token, was what was wrong: the
    // 2026-08-25 survey read the "densest peers" at ~1.4:1, and the 2026-08-27 re-check
    // (`.planning/research/LIGHT-MODE-CARD-DEPTH-PHONE-SURVEY-2026-08-27.md` §4) measured the
    // shipped resting-card range at 1.25-2.17 (M3 outlined 1.62-1.70, Radix sand-8 1.92, Airbnb
    // border-muted 2.17) — and the owner could not see the old value on a physical phone (Req 12
    // UAT test 2). The token now ships warm-400 at 2.31 / 2.04.
    //
    // THE UPPER BOUND IS THE POINT. Do not delete it and do not raise it to 3.0: it is the only
    // thing keeping `--color-border` out of the control-edge class, which is
    // `--color-border-strong`'s job (test 8, >= 3.0). Moving it is a decision, not a cleanup.
    //
    // AMENDED 88.3-18 (rulings 1c + 1a-bis, 2026-08-28). The BAND IS UNCHANGED at 1.40-2.40 and the
    // TOKEN IS UNCHANGED at warm-400 — owner ruling 1a-bis, "A, keep". Only the page-side ground
    // moved: warm-400 now reads 2.3096 vs the white card (UNCHANGED, the card did not slide) and
    // 1.7690 vs the new warm-200 page (was 2.0384). Both still inside the band.
    // WHY warm-300 WAS NOT A LEGAL OPTION at this ground, so nobody re-proposes it as a tidy-up:
    // it measures 1.2220 vs the warm-200 page — BELOW this row's own 1.40 floor — so it would red
    // here and at Gate C's CARD_BORDER_MIN, and it would make `--color-border` byte-equal to BOTH
    // `--color-border-control` and `--color-btn-secondary-hover` (both warm-300).
    expectRatio('light', '--color-border', '--color-bg-card', 1.4, 'Req 2 / §5.11 row 7');
    expectRatioBelow('light', '--color-border', '--color-bg-card', 2.4, 'Req 2 / §5.11 row 7');
    expectRatio('light', '--color-border', '--color-bg-page', 1.4, 'Req 2 / §5.11 row 8');
    expectRatioBelow('light', '--color-border', '--color-bg-page', 2.4, 'Req 2 / §5.11 row 8');
  });

  it('8. Req 2 — --color-border-strong clears 3:1 on the page in BOTH themes', () => {
    // `border-strong` IS the control-boundary token, so it carries the 1.4.11 floor.
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28) — ⚠ DISCLOSED THINNING. The token did not move but
    // its ground did: on the new warm-200 page it reads 3.1496, down from 3.6292, against this
    // row's 3.0 floor. Margin 0.15. It PASSES; the shrunken headroom is recorded here rather than
    // discovered by a future editor nudging warm-500 or moving the page again.
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
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): the message below quotes the PRE-ruling figures.
    // `--color-bg-card-hover` is now the minted `--warm-250`, so pointing the legacy `.card` hover
    // back at it would be a ΔL* 15.6274 wash from the white card (was 10.4) — a HEAVIER pill-weight
    // jump, same rejection. `--color-bg-hover` (warm-50) gives ΔL* 2.35, the "S3 press" look chosen.
    expect(card, 'Req 1 / D-02 — `@utility card`\'s &:hover must NOT use var(--color-bg-card-hover); after D-01 that is warm-200 and after 88.3-18 the minted warm-250 — a pill-weight ΔL* 15.63 wash from the card').not.toMatch(/background-color:\s*var\(--color-bg-card-hover\)/);
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
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28), re-measured amber-800 on the moved grounds:
    // card 7.0900 (unchanged) · page 5.4306 (was 6.2577) · card-hover 4.7121 (was 5.4306) ·
    // sunken 6.6884 (unchanged). ROW 13 IS THE TIGHTEST AND IT IS LOAD-BEARING: 4.7121 against a
    // 4.5 floor is a 0.21 margin, and it is the single row that disqualified warm-300 as the
    // card-hover value (4.4440) and forced `--warm-250` to be minted. Live pairings that depend on
    // it: GroupGamesList.js:372, ManageMembers.js:342, CalendarMonthView.js:228.
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
    // AMENDED 88.3-18 (ruling 1c): light amber-900 now reads 9.0722 on the card (unchanged) and
    // 6.9489 on the new warm-200 page (was 8.0072). Both clear with room.
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
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): on the new warm-200 page the three `-border`
    // values read 5.4615 / 6.3651 / 5.2476 (success / error / warning), down from
    // 6.2932 / 7.3345 / 6.0468. All still clear the 3.0 floor with margin. The card side is
    // unchanged at 7.1303 / 8.3101 / 6.8511 — the card did not slide.
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
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): purple-700 now reads card 7.7948 (unchanged),
    // page 5.9704 (was 6.8797), today tint 6.2589 (unchanged), accent fill 3.6294 (unchanged).
    // NOTE FOR A FUTURE READER: 3.6294 is against `--color-accent` (amber-500). It is NOT the
    // figure for the ring on the 88.3-18 `.btn-accent` fill (amber-700), which measures 1.5522 —
    // that button carries `ring-offset-2`, so its visible ring renders on the surrounding card
    // ground (7.7948), not on the fill. See the `.btn-accent` marker in globals.css.
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
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): muted moved warm-550 -> warm-600 and `--warm-550`
    // was retired. THIS ROW IS WHY THE MOVE WAS FORCED — warm-550 measures 4.1460 on the new
    // warm-200 page, which would RED this assertion. At warm-600: card 6.5790 (was 5.4129),
    // page 5.0392 (was 4.7774), sunken 6.2063 (was 5.1062). Secondary had to move to warm-700
    // first so warm-600 was free (see test 29 and the `--color-text-muted` marker).
    expectRatio('light', '--color-text-muted', '--color-bg-card', 4.5, 'Req 8 / §5.11 row 39');
    expectRatio('light', '--color-text-muted', '--color-bg-page', 4.5, 'Req 8 / §5.11 row 40');
    expectRatio('light', '--color-text-muted', '--color-bg-sunken', 4.5, 'Req 8 / §5.11 row 41');
  });

  it('29. Req 8 — muted stays visibly distinct from secondary and from border-strong', () => {
    // warm-600 would clear every ground but collapses muted INTO secondary, destroying a
    // two-level text hierarchy the app uses everywhere. warm-500 stays `border-strong`.
    //
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): the comment above is HISTORY. Muted IS warm-600
    // now — it stopped colliding because secondary moved warm-600 -> warm-700 in the same commit,
    // exactly so this row keeps its meaning. The hierarchy WIDENED: ΔL* muted<->secondary 12.7109
    // (was 5.2857) and muted<->border-strong 12.9240 (was 7.6383), both against a 4.0 floor.
    // AMENDING THIS 4.0 FLOOR WAS THE REJECTED ALTERNATIVE to moving secondary: no value on the
    // warm-550 -> warm-600 segment satisfies test 28 (>= 4.5 on the page) AND this row at once, so
    // lowering the floor here would have shipped a near-collapsed muted/secondary pair. That is the
    // degradation this row exists to prevent, not a band correction.
    const muted = resolve('light', '--color-text-muted');
    const secondary = resolve('light', '--color-text-secondary');
    expect(muted, `Req 8 / §5.11 row 42 — light muted (${muted}) must not collapse into secondary (${secondary})`).not.toBe(secondary);
    expectDelta('light', '--color-text-muted', '--color-text-secondary', 4.0, 'Req 8 / §5.11 row 42');
    expectDelta('light', '--color-text-muted', '--color-border-strong', 4.0, 'Req 8 / §5.9.1');
  });

  it('30. Req 8 / §5.9.1 residual — light muted on the warm-250 card-hover ground is BELOW 4.5', () => {
    // ⚠️ DISCLOSED RESIDUAL, ASSERTED RATHER THAN HIDDEN. No value on this ramp clears
    // 4.5:1 on warm-200 AND stays distinct from secondary. SPEC Req 8's acceptance is
    // page + card only, so this sits outside its floor — but it is real.
    //
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): the residual is PRESERVED IN SHAPE across the
    // ground move, not closed. The card-hover ground is now the minted warm-250 and muted is
    // warm-600: muted 4.1460 -> 4.3725 (still under the 4.5 ceiling this row asserts) and the
    // prescribed replacement secondary 5.0392 -> 6.9620 (better). Both figures below are amended.
    //
    // THE PHASE RULE, and it is the thing to read here: on a `bg-surface-card-hover`
    // (warm-250) pill / badge / chip, use `text-content-secondary` (6.9620 ✓), NEVER
    // `text-content-muted` (4.3725 ✗). Carried to `.planning/deferred/phase-88.6.md` with
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

  // ===================================================================================
  // Phase 88.3-14 — owner rulings 2 and 3, closed at the token layer after the Req 12
  // phone UAT. APPENDED, never renumbered: rows 32-41 are new coverage, not a re-cut of
  // Reqs 1-8. Every band below comes from a 2026-08-27 survey of shipped design systems
  // (`.planning/research/LIGHT-MODE-SECONDARY-BUTTONS-SURVEY-2026-08-27.md`), not from a
  // floor someone assumed.
  // ===================================================================================

  it('32. 88.3-14 / ruling 2 — the secondary fill is NOT its ground (the defect that started the ruling)', () => {
    // An EQUALITY assertion, not a ratio, because the defect was byte-equality: light
    // `--color-btn-secondary-bg` was `var(--warm-100)`, the same value as `--color-bg-page`,
    // so on a page the button had no fill at all. The survey's headline finding is that a
    // fill differing from its ground is the primary "this is a button" cue and that OUR
    // 1.00:1 case was the only one in 13 systems.
    //
    // ⚠️ AMENDED 88.3-18 (ruling 1c, 2026-08-28) — READ BEFORE "FIXING" ANYTHING HERE. The fill is
    // `var(--warm-100)` AGAIN, and that is NOT a reverted fix. THE DEFECT WAS THE EQUALITY WITH THE
    // PAGE, NOT THE HEX — and ruling 1c moved `--color-bg-page` to warm-200, vacating warm-100. The
    // page-side cue is preserved bit-for-bit at 1.1523. THIS ROW IS THE THING THAT STILL GUARDS IT.
    // Restoring warm-200 here would red this row, because warm-200 IS the page now.
    const fill = resolve('light', '--color-btn-secondary-bg');
    const page = resolve('light', '--color-bg-page');
    const card = resolve('light', '--color-bg-card');
    expect(fill, `88.3-14 ruling 2 — light --color-btn-secondary-bg (${fill}) must NOT be byte-equal to --color-bg-page (${page}); that equality IS the UAT defect`).not.toBe(page);
    expect(fill, `88.3-14 ruling 2 — light --color-btn-secondary-bg (${fill}) must NOT be byte-equal to --color-bg-card (${card})`).not.toBe(card);
  });

  it('33. 88.3-18 / ruling 1c — the DISCLOSED third ground is CLOSED: the fill and bg-card-hover can no longer be equal, and the cue INVERTED', () => {
    // ⚠️ THIS ROW IS A REWRITE, NOT A DELETION. It previously pinned a 88.3-14 DISCLOSURE: light
    // `--color-btn-secondary-bg` was BYTE-EQUAL to `--color-bg-card-hover` (both warm-200), so on a
    // card-hover ground the fill contributed NOTHING (1.0000) and the 1.2220 ring was the sole cue.
    // Census 2026-08-27 found 7 of the 19 non-test files carrying `btn-secondary` also carry
    // `bg-surface-card-hover` (FriendInvitePanel, GroupSettings, ManageMembers, NotificationBell,
    // friends/page, gameDetail/page, userProfile/page), so it was a real surface, not a corner case.
    //
    // THAT EQUALITY IS NOW STRUCTURALLY IMPOSSIBLE, which is why the row asserts the CLOSURE rather
    // than being dropped. The two feasible windows are DISJOINT: the fill is bounded ABOVE by test
    // 34's 1.40 card ceiling, and card-hover is bounded BELOW by test 14 row 13's 4.5 accent-text
    // floor. Ruling 1c put the fill on warm-100 and card-hover on the minted warm-250; no value
    // satisfies both constraints at once, so the disclosure cannot be restored at any hex.
    //
    // THE CUE INVERTED AND GOT STRONGER — that is the substance being pinned, measured 2026-08-28:
    //   fill on a card-hover ground  1.0000 -> 1.3280   (was invisible, now carries the separation)
    //   ring on a card-hover ground  1.2220 -> 1.0603   (was the sole cue, now contributes little)
    // A future edit that moves either token reds this row and forces a re-decision.
    //
    // THERE IS NO 88.6 DEFERRAL TO CLOSE FOR THIS — verified 2026-08-28: `phase-88.6.md` carries no
    // third-ground entry (its only `btn-secondary-bg` mentions record the warm-100 -> warm-200 fill
    // move). This disclosure only ever lived in TWO places, this row and the `.btn-secondary` marker
    // in `globals.css`, and the closure is recorded in both and ONLY in both. Do not add a line to
    // `phase-88.6.md` and do not write a pointer to one here.
    const fill = resolve('light', '--color-btn-secondary-bg');
    const cardHover = resolve('light', '--color-bg-card-hover');
    expect(fill, `88.3-18 ruling 1c — the CLOSED third ground: light --color-btn-secondary-bg (${fill}) must NO LONGER be byte-equal to --color-bg-card-hover (${cardHover}); the 88.3-14 disclosure is dissolved, not deleted`).not.toBe(cardHover);
    // The fill must actually carry that ground now, not merely differ from it.
    expectRatio('light', '--color-btn-secondary-bg', '--color-bg-card-hover', 1.05, '88.3-18 ruling 1c / the fill now reads on the third ground (1.3280)');
  });

  it('34. 88.3-14 / ruling 2 — the fill sits inside the shipped fill-vs-ground band', () => {
    // Survey band, observed across 13 systems: 1.06-1.29:1. Our page value (1.15) sits mid-band.
    // Our CARD value (1.31) is the deliberate TOP-OF-RANGE pick — ~0.02 above M3 tonal's 1.29 —
    // and it is the price of ONE fill instead of a fill that branches on its parent surface.
    // The ceiling is 1.40 so that "top of range" cannot quietly become "a new tier".
    //
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28). The BAND IS UNCHANGED. Measured at the new warm-100
    // fill: vs the warm-200 page 1.1523 — bit-for-bit the shipped page-side figure, so ruling 2's
    // cue is preserved exactly — and vs the white card 1.1330 (was 1.3056), which moves INTO the
    // 1.06-1.29 survey band the old value sat 0.02 above. Flatter on a card, identical on the page.
    // THE 1.40 CARD CEILING IS WHY THE FILL MOVED **UP** RATHER THAN DOWN: the white card does not
    // slide, so the obvious one-step-down warm-300 measures 1.5954 here and would red this row.
    // Raising the ceiling to fit it is a band change that leaves the surveyed range entirely, and
    // this row's own comment reserves that for a named decision with a fresh survey.
    expectRatio('light', '--color-btn-secondary-bg', '--color-bg-page', 1.05, '88.3-14 ruling 2 / fill band');
    expectRatioBelow('light', '--color-btn-secondary-bg', '--color-bg-page', 1.4, '88.3-14 ruling 2 / fill band');
    expectRatio('light', '--color-btn-secondary-bg', '--color-bg-card', 1.05, '88.3-14 ruling 2 / fill band');
    expectRatioBelow('light', '--color-btn-secondary-bg', '--color-bg-card', 1.4, '88.3-14 ruling 2 / fill band');
  });

  it('35. 88.3-14 / ruling 2 — the ring sits inside the shipped neutral-border band, WITH an upper bound', () => {
    // ⚠️ THE UPPER BOUND IS THE POINT OF THIS ROW. Of 13 shipped design systems, ZERO put a
    // >=3:1 neutral border on a neutral fill, and the whole neutral band is 1.20-1.57 (Geist
    // 1.20 ... Radix surface 1.57; Radix's "strong" step 1.92). A future editor "strengthening"
    // this ring to `--color-border-strong` (warm-500 — 3.15:1 on this fill) MUST go red here and
    // change the band as a named decision. Deleting or raising this ceiling re-creates the
    // input-box look the survey rejects. `--color-border-strong` keeps the 3:1 tier (test 8);
    // it is for INPUT boxes, where the box is the affordance.
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28): the BAND and the RING TOKEN are unchanged (warm-300
    // HELD). Only the fill beneath it moved, so the ring now reads 1.4081 on it (was 1.2220) —
    // mid-band rather than at the floor, i.e. this pairing got BETTER. warm-500 on the new fill
    // would read 3.36, still far above the ceiling, so the rejection above is unaffected.
    expectRatio('light', '--color-border-control', '--color-btn-secondary-bg', 1.2, '88.3-14 ruling 2 / ring band');
    expectRatioBelow('light', '--color-border-control', '--color-btn-secondary-bg', 1.6, '88.3-14 ruling 2 / ring band (upper bound is deliberate)');
  });

  it('36. 88.3-14 / ruling 2 — the ring reads on BOTH grounds the button sits on', () => {
    // AMENDED 88.3-18 (ruling 1c, 2026-08-28). `--color-border-control` DELIBERATELY DID NOT MOVE.
    // Re-measured: vs the new warm-200 page 1.2220 (was 1.4081); vs the white card 1.5954
    // (UNCHANGED — the card did not slide).
    //
    // ⚠️ DISCLOSURE — THE ONE PLACE THIS PHASE'S OWN "a 0.05 margin is not a margin" RULE IS
    // KNOWINGLY NOT MET. The page pairing now sits at 1.2220 against this row's 1.20 floor: a
    // margin of 0.022, down from 0.21. It is the thinnest margin anything in this phase carries.
    // It is HELD anyway because every alternative reds something shipped — warm-400 measures 2.3096
    // against the CARD ceiling on the line below (2.00), and anything lighter leaves the survey
    // band. A future editor nudging warm-300 by a unit reds here; that is intended. Stated plainly
    // because the `.btn-secondary` marker rejects three candidate values by invoking that very
    // rule, and it must not read as a rule applied to everything except our own held value.
    expectRatio('light', '--color-border-control', '--color-bg-page', 1.2, '88.3-14 ruling 2 / ring vs page');
    expectRatioBelow('light', '--color-border-control', '--color-bg-page', 2.0, '88.3-14 ruling 2 / ring vs page');
    expectRatio('light', '--color-border-control', '--color-bg-card', 1.2, '88.3-14 ruling 2 / ring vs card');
    expectRatioBelow('light', '--color-border-control', '--color-bg-card', 2.0, '88.3-14 ruling 2 / ring vs card');
  });

  it('37. 88.3-14 / ruling 2 — the label still clears 4.5:1 on the darker fill', () => {
    // Moving a fill is exactly how a passing label quietly stops passing. warm-800 on warm-200
    // measures 11.51, so there is enormous headroom — but the assertion is what keeps it true.
    // AMENDED 88.3-18 (ruling 1c): the fill is warm-100 now and warm-800 on it measures 13.2669 —
    // more headroom, same assertion. The row earns its keep precisely because the fill moved twice.
    expectRatio('light', '--color-btn-secondary-text', '--color-btn-secondary-bg', 4.5, '88.3-14 ruling 2 / label on fill');
  });

  it('38. 88.3-14 / ruling 2 — hover is a real step, and its ring moves with it', () => {
    const fill = resolve('light', '--color-btn-secondary-bg');
    const hover = resolve('light', '--color-btn-secondary-hover');
    expect(hover, `88.3-14 ruling 2 — light --color-btn-secondary-hover (${hover}) must differ from the resting fill (${fill}); leaving hover at warm-200 after the fill moved there would make hover indistinguishable from rest`).not.toBe(fill);
    expectRatio('light', '--color-border-control-hover', '--color-btn-secondary-hover', 1.2, '88.3-14 ruling 2 / hover ring on hover fill');
  });

  it('39. 88.3-14 / ruling 2 — dark is INERT: both control-edge tokens are `transparent` and the dark trio is byte-unchanged', () => {
    // `resolveRaw`, NOT `resolve`: `resolve()` accepts only `none`, `rgb(a)` or a hex and THROWS
    // TokenContrastParseError on anything else, so calling it on `transparent` would be a throw
    // rather than a readable failure. A transparent colour has no meaningful ratio; the
    // assertion is on the declared text.
    for (const prop of ['--color-border-control', '--color-border-control-hover']) {
      const raw = resolveRaw('dark', prop);
      expect(raw, `88.3-14 ruling 2 — dark ${prop} is "${raw}"; ruling 2 is LIGHT-ONLY, so dark must stay transparent. Declared rather than omitted so the 1px border is unconditional and the theme toggle shifts no layout`).toBe('transparent');
    }
    // ...and the dark `.btn-secondary` trio did not move while the light one did.
    expect(resolve('dark', '--color-btn-secondary-bg'), '88.3-14 — dark --color-btn-secondary-bg must still be purple-800').toBe(resolve('dark', '--purple-800'));
    expect(resolve('dark', '--color-btn-secondary-hover'), '88.3-14 — dark --color-btn-secondary-hover must still be purple-700').toBe(resolve('dark', '--purple-700'));
    expect(resolve('dark', '--color-btn-secondary-text'), '88.3-14 — dark --color-btn-secondary-text must still be warm-200').toBe(resolve('dark', '--warm-200'));
  });

  it('40. 88.3-14 — the four new `@theme inline` bridge keys exist', () => {
    // Without these keys Tailwind emits no utility and plan 88.3-16 has nothing to write into
    // JSX. Same shape as test 14's bridge assertion, and this is the LOAD-BEARING proof that
    // the bridges are real — a raw `grep -c` in globals.css would also count the comment lines
    // the DECISION markers deliberately contain.
    const theme = blockOf('theme');
    for (const key of [
      '--color-line-control',
      '--color-line-control-hover',
      '--color-surface-accent-subtle-strong',
      '--color-content-accent-strong',
    ]) {
      expect(theme, `88.3-14 — \`@theme inline\` must expose ${key} or no utility is generated for it`).toMatch(
        new RegExp(`${key}[ \\t]*:`),
      );
    }
  });

  it('41. 88.3-14 / ruling 3 — the accent-circle-strong pair clears its floors in light and is byte-identical in dark', () => {
    // 4.5 AND the 3.0 graphical floor: the invite / empty-state circle glyph is a non-text
    // graphical object under 1.4.11 (same shape as test 15), but amber-900 on amber-200
    // measures 7.28 so it clears body-copy contrast too — assert both, so a future re-tint that
    // drops below 4.5 while staying above 3.0 is still visible as a change.
    expectRatio('light', '--color-accent-text-strong', '--color-bg-accent-subtle-strong', 4.5, '88.3-14 ruling 3 / glyph on the darker circle');
    expectRatio('light', '--color-accent-text-strong', '--color-bg-accent-subtle-strong', 3.0, '88.3-14 ruling 3 / 1.4.11 graphical floor');
    // Dark must not move. A byte-EQUALITY against the SHARED counterparts, not a ratio: a
    // future dark-mode edit to one token and not the other reds here rather than silently
    // splitting the two circles apart in dark only.
    expect(resolve('dark', '--color-bg-accent-subtle-strong'), '88.3-14 ruling 3 — dark --color-bg-accent-subtle-strong must be byte-identical to the shared --color-bg-accent-subtle; ruling 3 is LIGHT-ONLY').toBe(resolve('dark', '--color-bg-accent-subtle'));
    expect(resolve('dark', '--color-accent-text-strong'), '88.3-14 ruling 3 — dark --color-accent-text-strong must be byte-identical to the shared --color-accent-text; ruling 3 is LIGHT-ONLY').toBe(resolve('dark', '--color-accent-text'));
    // ...and the SHARED light token was NOT re-pointed. That re-point is the alternative the
    // `--color-bg-accent-subtle` DECISION marker rejected on a ~13-consumer census; this pair
    // exists precisely so that rejection survives.
    expect(resolve('light', '--color-bg-accent-subtle'), '88.3-14 ruling 3 — light --color-bg-accent-subtle must still be amber-100; re-pointing it to amber-200 repaints ~13 unrelated consumers and is the REJECTED alternative').toBe(resolve('light', '--amber-100'));
  });

  // ===================================================================================
  // Phase 88.3-18 — owner ruling 1c (the page one step darker). APPENDED, never renumbered.
  // Rows 42-44 are NEW coverage for the palette arc this plan ships: `--warm-550` retires and
  // `--warm-250` is minted in the same commit, and two token names deliberately share one hex.
  // Exactly ONE pre-existing row CHANGED (test 33, rewritten to its closure); these three are
  // ADDITIONS, so that claim stays true. The cog's eight tint pairings are deliberately NOT a
  // Gate A row — they live in plan 18's ledger F and the `grouplist.js` marker only.
  // ===================================================================================

  it('42. 88.3-18 / ruling 1c — `--warm-550` is RETIRED and light muted resolves to the warm-600 literal', () => {
    // The retirement half of the mint-and-retire arc, asserted so a future "restore the ramp step"
    // pass reds. `--warm-550` was minted by Phase 88.3 for `--color-text-muted` and had no other
    // consumer; ruling 1c moved the page to warm-200, where warm-550 measures 4.1460 — below test
    // 28's 4.5 floor — so muted moved to warm-600 and the step had nothing left to hold.
    // Asserted via the RESOLVER's own throw contract rather than a text grep: `globals.css` is ~60%
    // comment and the amended markers necessarily NAME `--warm-550` in prose, so a grep would count
    // the history and report a live orphan. `resolve` reads declarations only.
    expect(
      () => resolve('light', '--warm-550'),
      '88.3-18 ruling 1c — `--warm-550` must be RETIRED from the palette; resolving it should THROW. If this row reds, the step was restored — that is a decision, not a cleanup, and it needs the `--color-text-muted` marker read first',
    ).toThrow(TokenContrastParseError);
    expect(
      resolve('light', '--color-text-muted'),
      '88.3-18 ruling 1c — light --color-text-muted must resolve to the warm-600 literal',
    ).toBe(resolve('light', '--warm-600'));
  });

  it('43. 88.3-18 / ruling 1c — `--warm-250` is MINTED, carries card-hover, and sits strictly between warm-200 and warm-300', () => {
    // The mint half. `--warm-250` `#dbd1c7` is the 70% point on warm-200 -> warm-300 and its SOLE
    // consumer is `--color-bg-card-hover`. The L* ordering is asserted rather than the hex, so a
    // future re-tint inside the feasible window (t ∈ [0.60, 0.92]) does not churn this row — but a
    // collapse back onto either neighbour does red it. warm-200 IS the page (byte-equality, a real
    // render defect at GroupLibrary.js:149-153 and CalendarMonthView.js:224-226); warm-300 drops
    // accent-text to 4.4440 and reds test 14's row 13.
    const mint = resolve('light', '--warm-250');
    expect(mint, '88.3-18 ruling 1c — `--warm-250` must be declared in the palette').toMatch(/^#[0-9a-f]{6}$/i);
    expect(
      resolve('light', '--color-bg-card-hover'),
      '88.3-18 ruling 1c — light --color-bg-card-hover must resolve THROUGH the minted --warm-250',
    ).toBe(mint);
    const l250 = lStarOf(mint, '--warm-250');
    const l200 = lStarOf(resolve('light', '--warm-200'), '--warm-200');
    const l300 = lStarOf(resolve('light', '--warm-300'), '--warm-300');
    expect(l250, `88.3-18 ruling 1c — --warm-250 (L* ${l250.toFixed(4)}) must sit BELOW --warm-200 (L* ${l200.toFixed(4)}); collapsing it onto warm-200 makes card-hover byte-equal to the page`).toBeLessThan(l200);
    expect(l250, `88.3-18 ruling 1c — --warm-250 (L* ${l250.toFixed(4)}) must sit ABOVE --warm-300 (L* ${l300.toFixed(4)}); at warm-300 accent-text drops to 4.4440 and test 14 reds`).toBeGreaterThan(l300);
  });

  it('44. 88.3-18 / ruling 1c — the two DISCLOSED cross-name hex duplications, asserted rather than deduplicated', () => {
    // ⚠️ PINNED DISCLOSURE (plan 18 ledger I5), the same idiom `--color-accent-text-strong` carries.
    // After ruling 1c two pairs of names land on one hex each. That is the price of keeping two
    // JOBS named apart, not a duplication to be tidied — but it is asserted so that an edit to one
    // side reds instead of silently splitting them, and so a "deduplicate these" pass has to be a
    // named decision. `--color-btn-secondary-bg` == `--color-badge-member-bg` (both warm-100) and
    // `--color-text-secondary` == `--color-badge-member-text` (both warm-700).
    expect(
      resolve('light', '--color-btn-secondary-bg'),
      '88.3-18 ruling 1c — DISCLOSED: light --color-btn-secondary-bg and --color-badge-member-bg are both warm-100 on purpose. If this reds, one of them moved — decide, do not deduplicate',
    ).toBe(resolve('light', '--color-badge-member-bg'));
    expect(
      resolve('light', '--color-text-secondary'),
      '88.3-18 ruling 1c — DISCLOSED: light --color-text-secondary and --color-badge-member-text are both warm-700 on purpose. If this reds, one of them moved — decide, do not deduplicate',
    ).toBe(resolve('light', '--color-badge-member-text'));
  });

  // ===================================================================================
  // Phase 88.3-18 — the amber Share Game QR button (owner ruling on Req 12 UAT test 4 / 11c(c))
  // ===================================================================================

  it('45. 88.3-18 — the `--color-btn-accent-*` family resolves in both themes, is theme-EQUAL, and its label clears 4.5', () => {
    // Theme-equality is asserted, not assumed: the Create-Event button this treatment matches
    // carries ONE inline amber in both themes, so the accent CTA is theme-invariant BY DESIGN. A
    // future "dark needs its own amber" edit reds here rather than silently splitting the two CTAs
    // apart in one theme. Same idiom as test 41's dark byte-equalities.
    for (const key of ['--color-btn-accent-bg', '--color-btn-accent-hover', '--color-btn-accent-text']) {
      const light = resolve('light', key);
      const dark = resolve('dark', key);
      expect(light, `88.3-18 — light ${key} resolved to "${light}"`).toMatch(/^#[0-9a-f]{6}$/i);
      expect(dark, `88.3-18 — ${key} must be BYTE-EQUAL across themes; the accent CTA is theme-invariant by design (the Create-Event button it matches uses one amber in both)`).toBe(light);
    }
    expectRatio('light', '--color-btn-accent-text', '--color-btn-accent-bg', 4.5, '88.3-18 / white on amber-700 (5.0216)');
    expectRatio('light', '--color-btn-accent-text', '--color-btn-accent-hover', 4.5, '88.3-18 / white on amber-800 hover (7.0900)');
    expectRatio('dark', '--color-btn-accent-text', '--color-btn-accent-bg', 4.5, '88.3-18 / white on amber-700 (dark arm, identical)');
  });

  it('46. 88.3-18 — the `.btn-accent` RULE exists exactly once and is UNLAYERED', () => {
    // A token pin alone does not hold a treatment: a rule declared inside `@layer` would be beaten
    // by `.btn { border: none }` and its siblings the same way a border utility is, so "the tokens
    // resolve" would read as coverage while nothing was painted.
    //
    // ⚠️ COMMENTS ARE STRIPPED BEFORE COUNTING, and that is load-bearing. The `DECISION Phase
    // 88.3-18` marker at that rule NAMES `.btn-accent` in prose several times, so an unfiltered
    // count self-invalidates the moment the marker lands (the project's grep-gate hygiene rule —
    // the same trap `darkChromeLegibility.test.ts`'s header documents at a 10/1/2-vs-7/0/1 census).
    const hits = [...MASKED.matchAll(/\.btn-accent[ \t]*\{/g)];
    expect(
      hits.length,
      `88.3-18 — expected exactly ONE \`.btn-accent {\` declaration in globals.css (comments stripped), found ${hits.length}`,
    ).toBe(1);
    // Brace depth 0 at the rule == top level == unlayered.
    const before = MASKED.slice(0, hits[0].index);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(
      depth,
      `88.3-18 — \`.btn-accent\` is nested at brace depth ${depth}; it MUST be unlayered (depth 0), beside \`.btn-primary\`. The \`@utility card\` guardrail names \`.btn\` and \`.btn-*\` as blocks that must stay unlayered`,
    ).toBe(0);
    // ...and it must read the tokens rather than carrying a literal.
    const rule = RAW.slice(RAW.indexOf('.btn-accent {'));
    expect(rule.slice(0, 200), '88.3-18 — `.btn-accent` must read var(--color-btn-accent-bg), not an amber literal').toContain('var(--color-btn-accent-bg)');
  });

  it('47. 88.3-18 — BOTH Share Game QR buttons carry `btn-accent` with no inline colour (source scan on the BUTTON\'S OWN SLICE)', () => {
    // WHY A SOURCE SCAN AND NOT ONLY TOKEN PINS: a future edit back to `btn btn-secondary`, or a
    // second inline `var(--amber-700)` literal — precisely the alternative the `.btn-accent` marker
    // REJECTS — passes every token assertion above without reddening anything. Every other
    // treatment this phase shipped is backed by a house source scan; this one would have had none.
    //
    // A PIN THAT READ ONLY THE MODAL COULD NOT SEE THE TWIN, which is how the divergence would have
    // survived every gate. Both files are read.
    //
    // ⚠️ THE NEGATIVE ASSERTIONS ARE SCOPED TO THE BUTTON'S SLICE ON PURPOSE — a file-level version
    // reds on day one. `EventDayModal.js:239` already carries
    // `backgroundColor: groupBgImage ? 'rgba(255, 255, 255, 0.85)' : 'transparent'` — the
    // group-background-image wash on the event row, verified 2026-08-28, unrelated to this button
    // and out of scope by construction. A file-wide "no backgroundColor literal" pin would fail
    // against that line, and the predictable reaction is to weaken or delete the pin — leaving the
    // thing it exists for with no mechanical backing at all. Do NOT "fix" `:239`; it is not ours.
    const SITES = [
      { rel: 'components/EventDayModal.js', file: path.join(__dirname, 'components', 'EventDayModal.js') },
      { rel: 'gameDetail/page.js', file: path.join(__dirname, 'gameDetail', 'page.js') },
    ];
    for (const { rel, file } of SITES) {
      const src = fs.readFileSync(file, 'utf8');

      // Cut the button's own JSX out first: find the title, walk BACK to the nearest preceding
      // `<button`, walk FORWARD to the next `</button>`.
      const titleIdx = src.indexOf('title="Share Game QR"');
      expect(titleIdx, `88.3-18 — no \`title="Share Game QR"\` found in ${rel}; the LOCATOR is broken, not the treatment. This must fail loudly rather than pass on an empty slice`).toBeGreaterThan(-1);
      const openIdx = src.lastIndexOf('<button', titleIdx);
      expect(openIdx, `88.3-18 — no \`<button\` precedes \`title="Share Game QR"\` in ${rel}; LOCATOR failure`).toBeGreaterThan(-1);
      const closeIdx = src.indexOf('</button>', titleIdx);
      expect(closeIdx, `88.3-18 — no \`</button>\` follows \`title="Share Game QR"\` in ${rel}; LOCATOR failure`).toBeGreaterThan(-1);
      const rawSlice = src.slice(openIdx, closeIdx);
      expect(rawSlice.length, `88.3-18 — the Share Game QR button slice in ${rel} came back empty; a zero-length slice would make every assertion below pass vacuously`).toBeGreaterThan(50);

      // ⚠️ COMMENTS ARE STRIPPED, for the same reason test 46 strips them — and this one is not
      // hypothetical, it RED on first run. The `DECISION Phase 88.3-18` marker that sits INSIDE
      // this button's opening tag necessarily quotes the strings the negatives forbid: it names
      // `btn-secondary` as the value replaced and quotes the owner saying "make it amber". An
      // unfiltered slice therefore fails against the very marker that explains the treatment, and
      // the predictable reaction is to weaken the pin. Both JSX `{/* … */}` comments and bare
      // `/* … */` attribute comments are removed; the ASSERTIONS then read only rendered code.
      const slice = rawSlice.replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');

      expect(slice, `88.3-18 — the Share Game QR button in ${rel} must carry \`btn btn-accent\` (owner: "Lets make it amber, like the create event button")`).toContain('btn btn-accent');
      expect(slice, `88.3-18 — the Share Game QR button in ${rel} must NOT carry \`btn-secondary\`; reverting it is a decision, not a cleanup`).not.toContain('btn-secondary');
      expect(slice, `88.3-18 — the Share Game QR button in ${rel} must NOT carry an inline \`backgroundColor\`; the amber lives ONCE in the \`.btn-accent\` rule`).not.toContain('backgroundColor');
      expect(slice, `88.3-18 — the Share Game QR button in ${rel} must NOT name an amber literal inline`).not.toContain('amber');
      expect(slice, `88.3-18 — the Share Game QR button in ${rel} must carry the house focus-visible ring string, like the Create-Event button it copies`).toContain('focus-visible:ring-focus-ring');
      expect(slice, `88.3-18 — the Share Game QR button's decorative icon in ${rel} must be hidden from AT; the visible label already names the control`).toContain('aria-hidden="true"');

      // File-level: exactly one `btn btn-accent` per file, so a THIRD untreated copy of this
      // control cannot appear alongside the treated one.
      const count = (src.match(/btn btn-accent/g) ?? []).length;
      expect(count, `88.3-18 — expected exactly ONE \`btn btn-accent\` in ${rel}, found ${count}. A second copy of this control must take the same treatment, not a new one`).toBe(1);
    }
  });
});
