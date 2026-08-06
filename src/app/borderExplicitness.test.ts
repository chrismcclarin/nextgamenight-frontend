/**
 * Req 16 (DES-02 / D-35) repo-wide guard: no border in the app depends on the
 * base-layer shim for its colour.
 *
 * WHAT THE SHIM IS AND WHY THIS IS A VISIBLE DEFECT, NOT A TIDY-UP
 * ---------------------------------------------------------------
 * `globals.css` carries a v3-compatibility rule in `@layer base` that paints
 * `border-color: var(--color-gray-200)` on every element. Tailwind v4's preflight
 * dropped v3's default border colour, and that rule puts it back. It is NOT
 * theme-aware: it paints `#e5e7eb`, which measures 11.19:1 against the dark page
 * where the neutral token would be 1.78:1. Every element that names a border WIDTH
 * without a border COLOUR is therefore drawing a near-white hairline in dark mode.
 *
 * ORDER IS LOAD-BEARING, AND THIS FILE IS THE PRECONDITION
 * -------------------------------------------------------
 * Plan 88-31 deletes that base rule. It may only do so once every site names its own
 * colour — the reverse order re-runs the exact v4 default-change regression the rule
 * exists to repair, across the whole app at once. This test is what makes the
 * deletion safe to perform and safe to keep: after 88-31 the shim is gone, so a new
 * uncoloured border stops being "a wrong shade" and becomes `currentColor`, i.e. a
 * border painted in the element's TEXT colour. Nothing else in the suite would catch
 * that, because it renders — it just renders wrong.
 *
 * WHY THIS IS A SOURCE SCAN AND NOT A RENDER TEST
 * ----------------------------------------------
 * Same reasoning as `cardPaddingIdiom.test.ts` and `components/controlSizeFloor.test.tsx`:
 * the property is "every bordered element in the app", spread across 20 files behind
 * modals, role gates, error branches and fetch states that no single render reaches.
 * A per-surface pin also goes green forever the moment surface N+1 is added.
 *
 * WHY IT DOES NOT USE THE PLAN'S GREP — MEASURED, NOT ASSERTED
 * -----------------------------------------------------------
 * 88-26's own verify gate is
 *     grep -rnE 'className=[^>]*(^|[ "])border( |")' src …
 * and it is defective in both directions. Run against the pre-work tree it matched
 * **157 lines, 110 of which already carried an explicit border colour** — it needs
 * only a quote or space on each side of `border`, which `className="border
 * border-line"` satisfies. It is therefore RED on the fully converged tree as well as
 * the broken one, which distinguishes nothing (the DEF-88-24-04 shape). It also
 * MISSED 5 of the 43 real sites: it has no `border-[tblrxy]` alternation, so
 * `border-b` was invisible; it anchors on `className=` on the same line, so a ternary
 * branch inside a template literal was invisible; and it never sees a class string
 * that is not written beside a `className=` at all, so `Banner.tsx`'s `cva` base was
 * invisible. That is the tenth defective grep gate recorded in this phase.
 *
 * The scanner below strips comments (88-25's gate went red on a DECISION marker it
 * had just written), reads string literals at ANY nesting depth including inside
 * `${…}` interpolations, and tokenises the class list so `rounded-border-ish` names
 * can never match. Tests 3-5 pin those three capabilities directly, so none of them
 * can silently regress into the grep's blindness.
 *
 * THE PROPERTY IS INVERTED ON PURPOSE (an ALLOW-LIST, per DEF-88-25-02)
 * --------------------------------------------------------------------
 * A bare `border` beside a ternary whose every branch names a colour is CORRECT, and
 * no scanner can tell that from reading one chunk. Rather than sink-match and hope,
 * every such site is enumerated below with the reason it is paired, and anything not
 * on the list fails by default. Test 2 asserts the list is not stale.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const SRC = path.resolve(__dirname, '..');

/** Tailwind border utilities that set something OTHER than a colour. */
const BORDER_STYLE_KEYWORDS = new Set([
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'none',
  'collapse',
  'separate',
]);

type BorderKind = 'bare' | 'width' | 'style' | 'color' | null;

/**
 * Classify one class token. `bare` means "sets a border width and names no colour",
 * i.e. the shape that falls through to the shim.
 */
export function classifyBorderToken(token: string): BorderKind {
  let t = token;
  // Strip variant prefixes (`hover:`, `md:`, `data-[state=open]:`, `group-hover:`).
  for (;;) {
    const m = /^(?:[a-zA-Z0-9_-]+|\[[^\]]*\]|[a-zA-Z0-9_-]+-\[[^\]]*\]):(.*)$/.exec(t);
    if (!m) break;
    t = m[1];
  }
  t = t.replace(/^!+/, '');
  const m = /^border(?:-(t|b|l|r|x|y|s|e))?(?:-(.+))?$/.exec(t);
  if (!m) return null;
  const suffix = m[2];
  if (suffix === undefined) return 'bare';
  if (/^\d+$/.test(suffix) || /^\[[\d.]+(px|rem|em|%)\]$/.test(suffix)) return 'width';
  if (BORDER_STYLE_KEYWORDS.has(suffix)) return 'style';
  if (suffix.startsWith('spacing')) return null;
  return 'color';
}

/**
 * Every string-literal / template-static chunk in a source file, at ANY nesting
 * depth, with `//` and block comments removed.
 *
 * The recursion into `${…}` is the load-bearing part: three of this sweep's sites
 * (`friends/page.js`'s bulk-invite result) wrote their `border` inside ternary
 * branches, where a line-anchored pattern cannot reach them.
 */
export function stringChunks(src: string): { offset: number; text: string }[] {
  const out: { offset: number; text: string }[] = [];
  const n = src.length;
  let i = 0;
  while (i < n) {
    const c = src[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      let buf = '';
      while (j < n) {
        if (src[j] === '\\') {
          buf += src.slice(j, j + 2);
          j += 2;
          continue;
        }
        if (src[j] === c || src[j] === '\n') break;
        buf += src[j];
        j += 1;
      }
      out.push({ offset: i, text: buf });
      i = j + 1;
    } else if (c === '`') {
      let j = i + 1;
      let buf = '';
      let bufStart = j;
      while (j < n) {
        if (src[j] === '\\') {
          j += 2;
          continue;
        }
        if (src[j] === '`') break;
        if (src[j] === '$' && src[j + 1] === '{') {
          let depth = 1;
          let k = j + 2;
          const start = k;
          while (k < n && depth > 0) {
            const ch = src[k];
            if (ch === '{') depth += 1;
            else if (ch === '}') depth -= 1;
            else if (ch === '"' || ch === "'" || ch === '`') {
              const q = ch;
              k += 1;
              while (k < n && src[k] !== q) {
                if (src[k] === '\\') k += 1;
                k += 1;
              }
            }
            k += 1;
          }
          out.push({ offset: bufStart, text: buf });
          buf = '';
          for (const inner of stringChunks(src.slice(start, k - 1))) {
            out.push({ offset: start + inner.offset, text: inner.text });
          }
          j = k;
          bufStart = j;
          continue;
        }
        buf += src[j];
        j += 1;
      }
      out.push({ offset: bufStart, text: buf });
      i = j + 1;
    } else if (c === '/' && src[i + 1] === '/') {
      const k = src.indexOf('\n', i);
      i = k < 0 ? n : k;
    } else if (c === '/' && src[i + 1] === '*') {
      const k = src.indexOf('*/', i);
      i = k < 0 ? n : k + 2;
    } else {
      i += 1;
    }
  }
  return out;
}

/** Chunks that set a border width and name no colour. */
export function shimDependentChunks(src: string): { line: number; text: string }[] {
  const hits: { line: number; text: string }[] = [];
  for (const { offset, text } of stringChunks(src)) {
    const kinds = text.split(/\s+/).filter(Boolean).map(classifyBorderToken);
    if (!kinds.includes('bare')) continue;
    if (kinds.includes('color')) continue;
    hits.push({ line: src.slice(0, offset).split('\n').length, text: text.trim() });
  }
  return hits;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (!/\.(js|jsx|ts|tsx)$/.test(entry.name)) continue;
    if (/\.(test|spec)\./.test(entry.name)) continue;
    out.push(full);
  }
  return out;
}

/**
 * The ONLY sites allowed to carry a bare border-width token with no colour beside it,
 * each because something outside the chunk supplies the colour on EVERY runtime path.
 * Verified by reading, one at a time — not by a pattern.
 *
 * Adding an entry here is a design decision that needs the same reading. Do not add
 * one to make this test green.
 */
const PAIRED_ELSEWHERE: Record<string, string> = {
  'app/components/AvailabilityGrid.js':
    'paint-mode ternary: both branches name a colour (green-400 / yellow-400)',
  'app/components/FriendInvitePanel.js':
    'friend-row ternary: all three branches name a colour (line / accent / line)',
  'app/components/GroupGamesList.js':
    'filter-toggle ternary: both branches name a colour (line-accent / line)',
  'app/components/HeatmapGrid.js':
    'ReadCell appends intensityColor(), and ALL FIVE of its branches name a border ' +
    'colour. Adding one here would overpaint the ramp: ReadCell applies the colour ' +
    'string verbatim with no tailwind-merge (its 84-05 byte-identical contract), so ' +
    'stylesheet order would decide and the neutral is emitted last. Dead file besides.',
  'app/components/ManageMembers.js':
    'role pill: all four roleStyles entries name a colour, and the `||` guarantees a fallback',
  'app/friends/page.js':
    'armed-remove ternary: both branches name a colour (status-error / transparent)',
  'app/gameDetail/page.js':
    'two-tap remove ternary: both branches name a colour (status-error / line)',
  'app/userProfile/page.js':
    'theme buttons and the day-of-week toggles: every branch names a colour (amber-500 / line, btn-primary / line)',
};

describe('D-35 border explicitness (Req 16)', () => {
  const files = sourceFiles(SRC);

  it('finds a representative sample of the app, so the sweep is not scanning an empty set', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('1. no source file leaves a border colour to the base-layer shim', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const rel = path.relative(SRC, file);
      if (rel in PAIRED_ELSEWHERE) continue;
      for (const hit of shimDependentChunks(fs.readFileSync(file, 'utf8'))) {
        offenders.push(`${rel}:${hit.line}  ${hit.text.slice(0, 120)}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. the allow-list is not stale — every exempt file still HAS a bare border', () => {
    // Without this, a file could be fixed (or deleted) and its exemption would sit
    // here forever, silently widening the hole for the next edit to that file.
    for (const rel of Object.keys(PAIRED_ELSEWHERE)) {
      const full = path.join(SRC, rel);
      expect(fs.existsSync(full), `${rel} is exempt but does not exist`).toBe(true);
      expect(
        shimDependentChunks(fs.readFileSync(full, 'utf8')).length,
        `${rel} no longer has a bare border — remove its exemption`
      ).toBeGreaterThan(0);
    }
  });

  it('3. the scanner reads ternary branches INSIDE template interpolations', () => {
    // The grep gate's blind spot, and where 3 of this sweep's sites lived.
    const fixture =
      'const a = <div className={`mt-3 p-3 ${ok ? "text-status-success border" : "x"}`} />;';
    expect(shimDependentChunks(fixture).map((h) => h.text)).toContain(
      'text-status-success border'
    );
  });

  it('4. the scanner ignores comments', () => {
    // 88-25's gate went red on a DECISION marker it had just written (DEF-88-25-02).
    // Two prior-phase markers in this repo still quote the token deliberately.
    const fixture = [
      '// the container carried a bare `border` utility with no colour',
      '/* D-35: `border` is explicit here, not left to the shim. */',
      'const a = <div className="border border-line" />;',
    ].join('\n');
    expect(shimDependentChunks(fixture)).toEqual([]);
  });

  it('5. the scanner distinguishes widths, styles and colours from bare tokens', () => {
    expect(classifyBorderToken('border')).toBe('bare');
    expect(classifyBorderToken('border-b')).toBe('bare');
    expect(classifyBorderToken('hover:border-t')).toBe('bare');
    expect(classifyBorderToken('border-2')).toBe('width');
    expect(classifyBorderToken('border-l-4')).toBe('width');
    expect(classifyBorderToken('border-solid')).toBe('style');
    expect(classifyBorderToken('border-line')).toBe('color');
    expect(classifyBorderToken('border-l-status-success')).toBe('color');
    expect(classifyBorderToken('md:border-input')).toBe('color');
    // Not a border utility at all — the `\bcard\b` class of false positive.
    expect(classifyBorderToken('rounded-card')).toBe(null);
    expect(classifyBorderToken('bg-surface-card')).toBe(null);
  });

  it('6. directional borders are in scope (`border-b` with no colour is a violation)', () => {
    // The plan gate has no [tblrxy] alternation, so it missed three real sites.
    const fixture = 'const a = <div className="px-4 py-3 border-b" />;';
    expect(shimDependentChunks(fixture)).toHaveLength(1);
  });

  it('7. the two shared primitives name their own neutral', () => {
    const banner = fs.readFileSync(path.join(SRC, 'components/ui/Banner.tsx'), 'utf8');
    // The cva base, not a tone variant: success/warning/error only colour the LEFT
    // edge, so without this the other three sides fell through to the shim.
    expect(banner).toMatch(/border border-line border-l-4/);
    expect(banner).toMatch(/info: 'border-l-line'/);

    const grid = fs.readFileSync(
      path.join(SRC, 'app/components/tutorial/simulated/TutorialGrid.js'),
      'utf8'
    );
    expect(grid).toMatch(/border border-line/);
    // `cn` is what lets a caller override the default deterministically; a template
    // literal would leave it to stylesheet order, where the neutral wins.
    expect(grid).toMatch(/className=\{cn\(/);
  });
});
