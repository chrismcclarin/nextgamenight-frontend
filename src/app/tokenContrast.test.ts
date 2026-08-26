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

import { parseHex } from '../lib/wcag';

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
    const hits = [...MASKED.matchAll(/^\.dark[ \t]*\{/gm)].map((m) => m.index);
    if (hits.length !== 1) {
      throw new TokenContrastParseError(`expected exactly one \`.dark {\` block, found ${hits.length}`);
    }
    body = braceBlock(hits[0], 'dark');
  } else if (name === 'theme') {
    body = braceBlock(uniqueIndex('@theme inline', 'theme'), 'theme');
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
  return braceBlock(uniqueIndex('@utility card', 'utility card'), 'utility card');
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
});
