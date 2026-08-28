/**
 * Phase 88.3 Req 9 / D-08 / D-09 — the group-colour RENDERING gate.
 *
 * THE ONE THING THIS FILE EXISTS FOR
 * ----------------------------------
 * A group's stored hex is its IDENTITY; the light tint is its RENDERING. Six
 * call sites moved from `resolveGroupBackgroundColor` to
 * `lightTintGroupBackgroundColor` in this phase. A SEVENTH call site —
 * `GroupSettings.js`'s `useState(resolveGroupBackgroundColor(group.background_color))`
 * — must NOT, because it seeds the form state that `handleSave` persists as
 * `background_color`. Routing it through the tint writes the RENDERED tint into
 * the database and permanently destroys the group's identity colour: the
 * original hex is not recoverable from the tint, and every subsequent save
 * would tint the tint.
 *
 * That is a data-destruction path (ASVS V1/V7), and the mitigation is NOT
 * review attention — it is test 1 below, which was demonstrated red by actually
 * routing the seed through the tint (receipt in `88.3-10-SUMMARY.md`).
 *
 * THE SECOND THING: THE CASCADE-ORDER DEFECT
 * ------------------------------------------
 * The tint reaches the DOM as a pair of CSS custom properties, and the theme
 * fork lives in the cascade — `bg-[var(--group-ground-light)]
 * dark:bg-[var(--group-ground)]` — never in a `useTheme` read (the shipped
 * `DECISION Phase 88.1 (plan 15, Req 8)` at `EventScheduler.tsx` rejected the
 * hook for exactly this problem: no hydration fork, no theme-flash window).
 *
 * The trap is that those classes cannot COEXIST with a themed `bg-surface-*`
 * class in the same className. Compiled against this project's own
 * `@custom-variant dark` on tailwindcss@4.3.3, `@layer utilities` emits:
 *
 *   .bg-\[var\(--group-ground-light\)\]        line 1426
 *   .bg-surface-card                           line 1543
 *   .bg-surface-hover                          line 1558
 *   .hover\:bg-surface-hover:hover             line 2347
 *   .dark\:bg-\[var\(--group-ground\)\]        line 2894
 *
 * Same property, same specificity — SOURCE ORDER wins. So a className carrying
 * both renders the white card surface in light mode for every coloured group,
 * and only the `dark:` arm works. Today's inline `style` background hid this
 * (an inline style beats any class); the moment the mechanism became a class it
 * stopped being hidden. Test 3 pins mutual exclusion, and was likewise
 * demonstrated red by stacking the two back together.
 *
 * WHY A SOURCE SCAN AND NOT A GREP
 * --------------------------------
 * Every className in this repo spans lines, and this phase's own DECISION
 * markers necessarily QUOTE the tokens they forbid. A line-based, comment-blind
 * grep fails in both directions here — the failure recorded in DEF-88-25-02,
 * DEF-88-27-01 and DEF-88-28-01. Everything below reads code with comments
 * blanked (`withoutComments`) and matches whole className / style expressions.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { contrastRatio } from '../lib/wcag';
import { lineAt, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');
const raw = (rel: string): string => fs.readFileSync(path.join(SRC, rel), 'utf8');
const code = (rel: string): string => withoutComments(raw(rel));

const SEED = 'app/components/GroupSettings.js';

/**
 * Plan 11's surface: the group-home identity HEADER. It is not a member of
 * `RENDER_SITES` above on purpose — its no-colour branch is `bg-surface-elevated`
 * rather than `bg-surface-card` (88-22's decision, which this phase does NOT
 * reverse), and it is the only site where the ground fork also drives three
 * interactive controls and a title/subtitle treatment.
 */
const HEADER = 'app/groupHomePage/page.js';

/**
 * The five render-site files, each with the themed surface class its NO-COLOUR
 * branch must carry.
 *
 * `CalendarMonthView.js`'s expected branch is EMPTY, and that is data rather
 * than an oversight: an uncoloured month tile has no ground of its own and sits
 * directly on the themed month cell (its shipped D-28 semantics). Giving it a
 * card surface to make this table uniform would be a visual change, not a
 * consistency fix. The other four already carried `bg-surface-card` before this
 * phase and keep it.
 */
const RENDER_SITES: { file: string; nullBranch: string }[] = [
  { file: 'app/components/grouplist.js', nullBranch: 'bg-surface-card hover:bg-surface-hover' },
  { file: 'app/components/CalendarMonthView.js', nullBranch: '' },
  { file: 'app/components/CalendarListView.js', nullBranch: 'bg-surface-card' },
  { file: 'app/components/EventDayModal.js', nullBranch: 'bg-surface-card' },
  { file: SEED, nullBranch: 'bg-surface-card' },
];

const TINT = 'lightTintGroupBackgroundColor';
const LIGHT_GROUND = '--group-ground-light';

// ---------------------------------------------------------------------------
// Expression extraction. `stringChunks` is per STRING LITERAL, which is exactly
// the wrong granularity for the cascade defect: a stacked
// `cn('… bg-surface-card …', tinted && 'bg-[var(--group-ground-light)] …')`
// puts the two classes in two different chunks and would sail through a
// per-chunk "not both in one chunk" check while still stacking them at runtime.
// So these read the WHOLE className / style expression, braces and all.
// ---------------------------------------------------------------------------

/** End offset of the string/template literal opening at `start`. */
function literalEnd(src: string, start: number): number {
  const q = src[start];
  let i = start + 1;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (q === '`' && ch === '$' && src[i + 1] === '{') {
      let depth = 1;
      i += 2;
      while (i < src.length && depth > 0) {
        const c2 = src[i];
        if (c2 === '"' || c2 === "'" || c2 === '`') {
          i = literalEnd(src, i) + 1;
          continue;
        }
        if (c2 === '{') depth += 1;
        else if (c2 === '}') depth -= 1;
        i += 1;
      }
      continue;
    }
    if (ch === q) return i;
    // An unterminated quote must not swallow the file — same rule sourceScan uses.
    if (q !== '`' && ch === '\n') return i - 1;
    i += 1;
  }
  return src.length - 1;
}

/** End offset of the `{ … }` group opening at `start`, skipping literals. */
function braceEnd(src: string, start: number): number {
  let depth = 0;
  for (let i = start; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      i = literalEnd(src, i);
      continue;
    }
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return src.length - 1;
}

/** Every `attr=…` value expression in a file, as `{ start, end, text }`. */
function attrExprs(src: string, attr: string): { start: number; end: number; text: string }[] {
  const out: { start: number; end: number; text: string }[] = [];
  for (const m of src.matchAll(new RegExp(`${attr}\\s*=\\s*`, 'g'))) {
    const i = (m.index ?? 0) + m[0].length;
    const c = src[i];
    let end: number;
    if (c === '"' || c === "'" || c === '`') end = literalEnd(src, i);
    else if (c === '{') end = braceEnd(src, i);
    else continue;
    out.push({ start: i, end, text: src.slice(i, end + 1) });
  }
  return out;
}

/** Body of a function declared as `const <name> = …` or `function <name>(`. */
function functionBody(src: string, name: string): string {
  const decl = new RegExp(`(?:const|let|function)\\s+${name}\\b`);
  const m = src.match(decl);
  if (!m) return '';
  const open = src.indexOf('{', (m.index ?? 0) + m[0].length);
  if (open < 0) return '';
  return src.slice(open, braceEnd(src, open) + 1);
}

/** The mutual-exclusion ternary, as it must appear in a className expression. */
const EXCLUSION_TERNARY =
  /\?\s*'bg-\[var\(--group-ground-light\)\][^']*'\s*:\s*'([^']*)'/;

describe('Phase 88.3 Req 9 / D-09 — group-colour rendering', () => {
  it('0. the scan sees the real tree and the detector is not dead', () => {
    // Anti-vacuity, both halves. A gate that scans an empty population, or whose
    // detector cannot fire, is green forever and pins nothing.
    expect(sourceFiles(SRC).length).toBeGreaterThan(100);

    // the detector fires on CODE …
    expect(withoutComments(`const x = ${TINT}(y);`)).toContain(TINT);
    // … and NOT on a comment that merely names the function, which every
    // DECISION marker in this phase necessarily does.
    expect(withoutComments(`// we must never call ${TINT} here\nconst x = 1;`)).not.toContain(TINT);

    // and the render sites really exist
    for (const { file } of RENDER_SITES) {
      expect(fs.existsSync(path.join(SRC, file)), `missing render site ${file}`).toBe(true);
    }
  });

  it('1. THE TINT NEVER REACHES THE SAVE PATH (data-destruction control)', () => {
    const gs = code(SEED);
    const boom =
      'the tint reached the save path — this would write the rendered tint to ' +
      'Groups.background_color and permanently destroy the group’s identity colour, ' +
      'irreversibly (the original hex cannot be recovered from the tint). ' +
      'GroupSettings.js’s form-state seed must stay resolveGroupBackgroundColor. ' +
      'See the DECISION Phase 88.3 (D-09 / Pitfall 7) marker at that line.';

    // (a) the seed itself is still the identity resolver
    expect(gs, boom).toMatch(/useState\(\s*resolveGroupBackgroundColor\(group\.background_color\)/);

    // (b) the tint appears nowhere inside the save handler
    const save = functionBody(gs, 'handleSave');
    expect(save.length, 'handleSave not found — this gate has lost its target').toBeGreaterThan(50);
    expect(save, 'handleSave builds the persisted payload').toContain('background_color:');
    expect(save, boom).not.toContain(TINT);

    // (c) and nothing tinted is ever pushed back into the form state
    expect(gs, boom).not.toMatch(new RegExp(`setBackgroundColor\\([^)]*${TINT}`));
  });

  it('2. the decision lives at the PRODUCTION site, with its rejected half named', () => {
    // A decision recorded only in a test file is invisible to the next person
    // editing the code it governs — that is how a deliberate choice gets
    // "restored" as an oversight two phases later (88.1-CODE-REVIEW.md).
    const src = raw(SEED);
    const at = src.indexOf('useState(\n    resolveGroupBackgroundColor(group.background_color)');
    expect(at, 'the form-state seed moved — re-anchor this assertion').toBeGreaterThan(-1);
    // Un-wrap the block comment before matching: these markers are prose and the
    // load-bearing phrases wrap across `*`-prefixed lines, so a naive regex would
    // report a missing marker that is plainly there.
    const above = src
      .slice(Math.max(0, at - 4000), at)
      .replace(/\n\s*\*?[ \t]*/g, ' ');

    expect(above).toMatch(/DECISION Phase 88\.3/);
    // The load-bearing half is the REJECTED alternative: "stays as it is" warns
    // nobody, "stays, and here is the sweep that would destroy the column" stops
    // the sweep.
    expect(above).toMatch(/REJECTED/);
    expect(above).toMatch(/replace every `resolveGroupBackgroundColor` call/);
    expect(above).toMatch(/is a decision, not a cleanup/);
  });

  it('3. the themed surface class and the tint pair are MUTUALLY EXCLUSIVE', () => {
    // This replaces a weaker "both tokens are present somewhere" check, which was
    // measured INSUFFICIENT: it cannot tell the correct ternary from the two
    // classes stacked in one className, and the stacked shape is precisely the
    // defect (source order makes the themed class win in light mode).
    for (const { file, nullBranch } of RENDER_SITES) {
      const src = code(file);
      const withTint = attrExprs(src, 'className').filter((e) => e.text.includes(LIGHT_GROUND));
      expect(withTint.length, `${file}: no className carries the tint pair`).toBeGreaterThanOrEqual(1);

      for (const expr of withTint) {
        const m = expr.text.match(EXCLUSION_TERNARY);
        expect(
          m,
          `${file}: the tint classes are not in a mutual-exclusion ternary — ` +
            'a stacked themed class wins the light-mode tie and renders every ' +
            'coloured group white',
        ).not.toBeNull();
        expect(m![1], `${file}: unexpected no-colour branch`).toBe(nullBranch);

        // CROSS-EXPRESSION negative, not per-chunk: strip the ternary and NOTHING
        // background-ish may remain anywhere else in the same className.
        const rest = expr.text.replace(m![0], '');
        expect(
          rest,
          `${file}: a bg-surface-* class sits OUTSIDE the ternary, so it is ` +
            'always present and stacks with the tint pair',
        ).not.toMatch(/bg-surface-/);
        expect(rest, `${file}: a stray tint background class outside the ternary`).not.toMatch(
          /bg-\[var\(--group-ground/,
        );
      }

      // the dark arm is the other half of the pair and must ride along
      expect(src, `${file}: missing the dark arm of the ground fork`).toContain(
        'dark:bg-[var(--group-ground)]',
      );
    }
  });

  it('4. no render site reads the theme in JS — the fork stays in the cascade', () => {
    // The shipped DECISION Phase 88.1 (plan 15, Req 8) at EventScheduler.tsx
    // rejected a next-themes read for exactly this problem: "the theme fork now
    // lives in the CSS cascade where it belongs … no hook, no hydration fork,
    // and no theme-flash window." Reaching for useTheme at any of these five
    // sites reverses that decision on five more surfaces.
    for (const { file } of RENDER_SITES) {
      expect(code(file), `${file} reintroduced a JS theme read`).not.toMatch(/\buseTheme\b/);
    }
  });

  it('5. the tint is genuinely wired — test 1 is not zero-by-emptiness', () => {
    let calls = 0;
    for (const file of sourceFiles(SRC)) {
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const m of src.matchAll(new RegExp(`${TINT}\\s*\\(`, 'g'))) {
        // skip the declaration itself
        const before = src.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
        if (/function\s*$/.test(before)) continue;
        calls += 1;
      }
    }
    // floor set below the real count (6 at time of writing: four resolver render
    // sites plus GroupSettings' preview and swatches)
    expect(calls).toBeGreaterThanOrEqual(5);
  });

  it('6. the raw preset palette is untouched, and the swatches are named', () => {
    const src = raw(SEED);
    // DECISION 88-22 (D-27) is CROSS-STACK: these eight values are persisted and
    // validated by the backend's ^#[0-9A-Fa-f]{6}$ rule. The tint is a rendering
    // transform and must never become a stored one.
    expect(src).toMatch(/DECISION Phase 88-22 \(D-27/);
    for (const hex of [
      '#1e1e2e',
      '#1e293b',
      '#172554',
      '#1e1b4b',
      '#14332a',
      '#3b1030',
      '#2c1f14',
      '#27272a',
    ]) {
      expect(src, `preset ${hex} left DEFAULT_BACKGROUND_COLORS`).toContain(`value: '${hex}'`);
    }

    // owner ruling R2-2: the swatch identity is visible at t = 0.70, so
    // aria-label + aria-pressed is the whole accessibility fix — no checkmark.
    const gs = code(SEED);
    expect(gs).toContain('aria-label={color.name}');
    expect(gs).toMatch(
      /aria-pressed=\{backgroundColor === color\.value && !backgroundImageUrl\}/,
    );
  });

  it('7. text drawn on a tinted ground forks with it, and never inline', () => {
    // The defect: `isDarkBackground` was asked about the STORED hex, and every
    // shipped preset is dark, so the branch never flipped — near-white text with
    // a black shadow and stroke, painted onto a pale tint in light mode.
    const floors: Record<string, number> = {
      'app/components/grouplist.js': 1,
      'app/components/CalendarMonthView.js': 1,
      'app/components/CalendarListView.js': 1,
      'app/components/EventDayModal.js': 2,
    };
    for (const [file, floor] of Object.entries(floors)) {
      const src = code(file);
      const forks = (src.match(/dark:\[color:var\(--t-color\)\]/g) ?? []).length;
      expect(forks, `${file}: fewer themed text forks than its ground-gated sites`)
        .toBeGreaterThanOrEqual(floor);

      // the old theme-independent shape must be GONE, not merely overridden
      expect(src, `${file}: an isDark-gated inline colour survived`).not.toMatch(/color:\s*isDark\s*\?/);
      expect(src, `${file}: an isDark-gated inline textShadow survived`).not.toMatch(
        /textShadow:[^}]*\bisDark\b/,
      );

      // An INLINE declaration beats a `dark:` class (the plan-07 inert-override
      // trap), so any element that carries the ground fork must have no inline
      // colour/shadow/stroke at all.
      for (const expr of attrExprs(src, 'style').filter((e) => e.text.includes(LIGHT_GROUND))) {
        expect(expr.text, `${file}: inline color on a tint-forked element`).not.toMatch(
          /(^|[^-\w])color\s*:/,
        );
        expect(expr.text, `${file}: inline textShadow on a tint-forked element`).not.toMatch(
          /(^|[^-\w])textShadow\s*:/,
        );
        expect(expr.text, `${file}: inline WebkitTextStroke on a tint-forked element`).not.toMatch(
          /WebkitTextStroke\s*:/,
        );
      }
    }
  });

  it('8. the two clickable divs this plan touched are keyboard-operable (R3-C)', () => {
    // Both were `<div onClick>` with no keyboard path, while the IDENTICAL
    // interaction one file over (CalendarListView's EventRow) has been
    // reachable all along. Located by the element that carries the ground fork,
    // not by a line number this plan's own edits already moved.
    for (const file of ['app/components/CalendarMonthView.js', 'app/components/EventDayModal.js']) {
      const src = code(file);
      const expr = attrExprs(src, 'className').find((e) => e.text.includes(LIGHT_GROUND));
      expect(expr, `${file}: no tint-forked element to anchor on`).toBeDefined();
      const tagStart = src.lastIndexOf('<div', expr!.start);
      const tag = src.slice(tagStart, expr!.end + 1);

      expect(tag, `${file}: the clickable div lost role="button"`).toContain('role="button"');
      expect(tag, `${file}: the clickable div lost tabIndex`).toContain('tabIndex={0}');
      expect(tag, `${file}: the clickable div lost its keyboard handler`).toContain('onKeyDown');
      expect(tag, `${file}: the keyboard handler must fire on Enter and Space`).toMatch(
        /'Enter'[\s\S]*' '/,
      );
      expect(tag, `${file}: the clickable div lost its accessible name`).toContain('aria-label=');
      expect(tag, `${file}: the clickable div lost its focus ring`).toContain(
        'focus-visible:ring-focus-ring',
      );
    }
  });

  it('9. both custom properties are gated on the TINT, never on the stored hex', () => {
    // T-88.3-43. A stored value that fails to tint must withhold BOTH grounds
    // together; gating on the resolver result alone would emit `--group-ground`
    // with no `--group-ground-light`, and light mode would then fall through to
    // whatever the ternary's null branch is while the dark arm still painted.
    const floors: Record<string, number> = {
      'app/components/grouplist.js': 1,
      'app/components/CalendarMonthView.js': 1,
      'app/components/CalendarListView.js': 1,
      'app/components/EventDayModal.js': 1,
      [SEED]: 2,
    };
    for (const [file, floor] of Object.entries(floors)) {
      const src = code(file);
      const gates = (
        src.match(/\b\w*[Gg]round\w*\s*=\s*\w*[Tt]inted\w*\s*\?\s*[\w.?]+\s*:\s*null\b/g) ?? []
      ).length;
      expect(gates, `${file}: a ground is not gated on its tint succeeding`).toBeGreaterThanOrEqual(
        floor,
      );

      // and the pair is always emitted together
      for (const expr of attrExprs(src, 'style').filter((e) => e.text.includes(LIGHT_GROUND))) {
        expect(expr.text, `${file}: --group-ground-light emitted without its dark twin`).toContain(
          "'--group-ground':",
        );
      }
    }
  });

  it('10. the swatch grid announces as a labelled group', () => {
    const gs = code(SEED);
    expect(gs).toContain('id="group-colour-choice"');
    expect(gs).toContain('role="group"');
    expect(gs).toContain('aria-labelledby="group-colour-choice"');
    // the label and the wrapper must agree, or the wiring is decorative
    const wrapper = attrExprs(gs, 'aria-labelledby')[0];
    expect(wrapper?.text).toContain('group-colour-choice');
  });

  it('11. repo-wide: no save payload is ever built from a tinted value', () => {
    // The narrow version of test 1, widened past GroupSettings.js so a future
    // surface that learns to write `background_color` inherits the control.
    for (const file of sourceFiles(SRC)) {
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      expect(
        src,
        `${path.relative(SRC, file)}: a background_color payload is being built from the tint`,
      ).not.toMatch(new RegExp(`background_color:\\s*[^,\\n]*${TINT}`));
    }
  });

  // -------------------------------------------------------------------------
  // Plan 11 — the HEADER half of Req 9. Bare `it(` only, appended: the ci.yml
  // registry floor is a MINIMUM (10), so growing this file needs no workflow
  // edit, which is what lets plan 11 be its own wave.
  //
  // Everything below reads `groupHomePage/page.js` with comments blanked. That
  // is not optional here: plan 11's own DECISION markers quote `useTheme`,
  // `dark:bg-black/15`, `var(--amber-600)` and `bg-surface-elevated` in order
  // to record why each was rejected, so a raw grep is red on the tree that is
  // CORRECT and the pressure it applies is to delete the explanation.
  // -------------------------------------------------------------------------

  it('12. the header ground is the tint, and the uncoloured header keeps 88-22\'s themed surface', () => {
    const src = code(HEADER);
    expect(src, 'the header ground no longer comes from the tint').toContain(TINT);
    // 88-22 STANDS. A group with NO colour of its own keeps the themed elevated
    // surface — re-pinning a hardcoded dark value here would re-open the exact
    // D-28 white-card bug 88-22 closed, this time in light mode.
    expect(src, 'the uncoloured header lost its 88-22 fallback').toContain('bg-surface-elevated');

    // The mutual-exclusion ternary, same shape plan 10 pins at its five sites.
    const container = attrExprs(src, 'className').find((e) => e.text.includes(LIGHT_GROUND));
    expect(container, 'no className expression carries the light ground').toBeTruthy();
    expect(
      container!.text,
      'the header ground is not a mutual-exclusion ternary — see test 3: `.bg-[var(--group-ground-light)]` ' +
        'emits BEFORE `.bg-surface-elevated` at the same specificity, so a stacked themed class paints a ' +
        'coloured group WHITE in light mode',
    ).toMatch(/\?\s*'bg-\[var\(--group-ground-light\)\][^']*'\s*:\s*'bg-surface-elevated/);

    // …and the two must never share one literal, which is the shape the ternary
    // regex alone cannot rule out.
    for (const chunk of stringChunks(src)) {
      if (!chunk.text.includes(LIGHT_GROUND)) continue;
      expect(
        chunk.text,
        `${HEADER}:${lineAt(src, chunk.offset)}: the themed surface class is stacked with the tint pair`,
      ).not.toMatch(/bg-surface-/);
    }
  });

  it('13. GATE B — the title and subtitle fork through custom properties, not an inline style', () => {
    const src = code(HEADER);
    // An inline `style` CANNOT be forked by a `dark:` class — it outranks every
    // class in both themes. So the fork is only possible if these calls stop
    // being applied directly to the element.
    expect(src, 'the title still applies getTextStyle inline — the light arm would be inert').not.toContain(
      'style={getTextStyle(',
    );
    expect(src, 'the subtitle still applies getSubtitleStyle inline').not.toContain(
      'style={getSubtitleStyle(',
    );

    const title = attrExprs(src, 'className').find((e) => e.text.includes('text-3xl'));
    expect(title, 'the h1 was not found by its text-3xl Display size').toBeTruthy();
    for (const util of [
      '[color:var(--t-color-l)]',
      'dark:[color:var(--t-color)]',
      '[text-shadow:var(--t-shadow-l)]',
      'dark:[text-shadow:var(--t-shadow)]',
      // The STROKE pair is the half that was nearly lost. `getTextStyle`'s
      // image branch returns a `-webkit-text-stroke` unconditionally, and it is
      // what keeps the title readable over an arbitrary photo. Fork only the
      // `dark:` arm and an image-background header silently loses its outline
      // in LIGHT mode — T-88.3-54.
      '[-webkit-text-stroke:var(--t-stroke-l)]',
      'dark:[-webkit-text-stroke:var(--t-stroke)]',
      // The WEIGHT pair, for the other half of T-88.3-54: compile-verified,
      // `.[font-weight:var(--t-weight-l)]` emits AFTER `.font-bold`, so the
      // arbitrary utility wins and its value must restate the base weight
      // rather than say `inherit`.
      '[font-weight:var(--t-weight-l)]',
      'dark:[font-weight:var(--t-weight)]',
    ]) {
      expect(title!.text, `the h1 lost its ${util} utility`).toContain(util);
    }
  });

  it('14. GATE B — the dim is three explicit cases and the 0.15 is never inline', () => {
    const src = code(HEADER);
    const overlay = attrExprs(src, 'className').find((e) => e.text.includes('rgb(0_0_0/0.15)'));
    expect(
      overlay,
      'the coloured-header dark dim is gone, or is no longer a class — UI-SPEC §5.10.3: a 15% black ' +
        'dim costs ~11.5 L* on the t = 0.70 tint and would fail Req 9\'s own rendered-pixel L* >= 75',
    ).toBeTruthy();
    expect(overlay!.text, 'the dim is not guarded on the PARSED tint').toContain('tinted');
    expect(overlay!.text, 'the dim is not excluded on the image case').toContain(
      '!Group?.background_image_url',
    );
    expect(overlay!.text).toContain('dark:bg-[rgb(0_0_0/0.15)]');

    // Never the opacity-slash shorthand. Compile-verified on tailwindcss@4.3.3:
    // `dark:bg-black/15` emits `color-mix(in oklab, var(--color-black) 15%, transparent)`,
    // which Chromium serialises as `color(srgb …)`/`oklab(…)`. Plan 12's probe
    // and every rendered-alpha reading expect a plain `rgba()`.
    expect(src, 'the dim uses the opacity-slash form, which compiles to color-mix()').not.toContain(
      'dark:bg-black/15',
    );

    // Only the IMAGE case keeps an inline backgroundColor. An inline
    // `'transparent'` on the same property would outrank the `dark:` class and
    // silently delete the dark dim in both themes.
    expect(src, 'the photo dim is gone — it is needed in BOTH themes').toContain('rgba(0, 0, 0, 0.4)');
    const style = attrExprs(src, 'style').find((e) => e.text.includes('borderRadius'));
    expect(style, 'the overlay style object was not found').toBeTruthy();
    expect(style!.text, 'an inline 0.15 remains on the overlay').not.toContain('0.15');
    expect(style!.text, "an inline 'transparent' remains on the overlay").not.toContain(
      "'transparent'",
    );
  });

  it('15. the three controls survived the rewrite with their type scale and OI-6 closed', () => {
    const src = code(HEADER);
    expect(src, 'the controls no longer branch on the ground brightness').toContain(
      'isDarkBackground',
    );

    // OI-6, owner-ruled 2026-08-25. White on `--amber-600` measured 3.19:1 and
    // had failed in BOTH themes since before this phase.
    expect(src, 'the amber fill regressed to amber-600 (white 3.19:1)').not.toContain(
      'var(--amber-600)',
    );
    expect((src.match(/var\(--amber-700\)/g) ?? []).length).toBe(1);
    // …and the ratio itself, read out of globals.css rather than restated, so a
    // future palette edit reds here instead of drifting past a copied number.
    // This is the OI-6 half of Gate A's ledger, which plan 05 deliberately left
    // unpinned so that closing OI-6 would land the assertion with the fix.
    const css = fs.readFileSync(path.join(SRC, 'app/globals.css'), 'utf8');
    const amber700 = css.match(/--amber-700:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(amber700, 'globals.css no longer declares --amber-700').toBeTruthy();
    const ratio = contrastRatio('#ffffff', amber700!)!;
    expect(
      Number(ratio.toFixed(2)),
      `white on --amber-700 (${amber700}) measures ${ratio.toFixed(2)}:1 — OI-6 requires >= 4.5`,
    ).toBeGreaterThanOrEqual(4.5);

    // UI-SPEC §4 obligation 1. `typeScaleTouchedSurfaces.test.ts` CANNOT see
    // these — its population is `<h1..h6>` only (RESEARCH C-10) — so the three
    // controls' type scale has no other guard.
    const controls = attrExprs(src, 'className').filter((e) => /'btn[ ']/.test(e.text));
    expect(controls.length, 'the three .btn controls were not found').toBe(3);
    for (const c of controls) {
      expect(c.text, 'a header control lost text-sm').toContain('text-sm');
      expect(c.text, 'a header control lost md:text-base').toContain('md:text-base');
    }

    // The Manage Members blur moved to the dark arm — it only ever did visible
    // work over the translucent wash, which the light arm no longer has.
    expect(src).toContain('dark:backdrop-blur-xs');
    expect(src, 'the 10% white wash is still an inline style, which no dark: class can fork').toContain(
      'dark:bg-white/10',
    );
    // The dark ring is RENDERED-EQUIVALENT to HEAD, via a class fork; the
    // light-arm form must be gone. A plain `ring-white/15` check would match
    // the `dark:`-prefixed form and pass vacuously, so exclude it explicitly.
    expect((src.match(/dark:ring-white\/15/g) ?? []).length).toBe(2);
    expect(
      (src.match(/(^|[^:])ring-white\/15/gm) ?? []).length,
      'a light-arm ring-white/15 survives — it measures 1.28:1 on the t = 0.70 tint',
    ).toBe(0);
  });

  it('16. GATE B — the uncoloured header takes the DARK arm, and all three controls focus visibly', () => {
    const src = code(HEADER);
    // THE null RULE. `getBrightness(null)` returns 255 by contract, so
    // `isDarkBackground(null)` is `false` — a bare `isDarkBackground(ground)`
    // silently sends the app's DEFAULT header (no colour) to the LIGHT arm even
    // in dark theme, where it sits on `bg-surface-elevated` (purple-800), a
    // ground the colour value cannot see. A legacy non-hex colour that the tint
    // cannot parse falls to the same `null` ground and must behave the same.
    // Nothing else in the tree pins this: it is a boolean whose wrong value
    // renders, just badly.
    expect(
      src,
      'the darkArm expression lost its explicit `!ground ||` null rule — T-88.3-53',
    ).toMatch(/!ground\s*\|\|\s*isDarkBackground\(ground\)/);

    // The author focus ring, one per control. `.btn` defines no `focus-visible`
    // style and there is no global one, and every `border-*` utility on a `.btn`
    // is DEAD under the unlayered `.btn { border: none }` — so this ring is the
    // only asserted keyboard-visible affordance these three elements have. The
    // border/ring model itself is Phase 88.6's `Button` migration.
    const controls = attrExprs(src, 'className').filter((e) => /'btn[ ']/.test(e.text));
    expect(controls.length).toBe(3);
    for (const c of controls) {
      expect(c.text, 'a header control has no author focus ring').toContain(
        'focus-visible:ring-focus-ring',
      );
    }

    // and no `useTheme` — the theme half rides the cascade, as it does at plan
    // 10's five sites (the shipped EventScheduler.tsx decision).
    expect(src).not.toContain('useTheme');
  });

  it('17. the two protected markers inside the edited range are still there', () => {
    // Both are markers whose LOSS is invisible to every other gate.
    //
    // `min-h-11`: the marker explains that below `md` the phone-only global
    // floor and this per-CTA class agree, but at `md`+ this class is the ONLY
    // thing holding the CTA at 44px — unlayered `.btn` padding beats the layered
    // px/py utilities, so the control renders ~37px without it. A grep for
    // `min-h-11` alone would not notice the EXPLANATION going, and once the
    // explanation is gone the class reads as redundant with the global floor.
    const marker = raw(HEADER);
    expect(marker, 'the 87.8 D-13/D-14 + 88-28 D-36 min-h-11 marker was edited away').toMatch(
      /this per-CTA `min-h-11` is NOT made redundant/,
    );
    expect(code(HEADER), 'min-h-11 itself is gone from the CTA').toContain('min-h-11');

    // The inline-boxShadow marker records, in its own words, that dropping the
    // white ring "would still pass 88-29's zero-`rgba(0,0,0` gate while looking
    // wrong" — i.e. it states that an existing gate cannot catch its loss.
    expect(marker, 'the Plan-Game-Session inline-boxShadow marker was edited away').toMatch(
      /carried TWO halves/,
    );
  });

  it('18. the D-10 decision lives at the production site with its rejected half named', () => {
    const marker = raw(HEADER).replace(/\n\s*\*?[ \t]*/g, ' ');
    expect(marker).toMatch(/DECISION Phase 88\.3 \(D-10 \/ OI-6\)/);
    // The load-bearing half is what was REJECTED. "branches on darkArm" warns
    // nobody; "over keying off has-no-colour, which is what shipped and is why
    // the control vanished" stops the revert.
    expect(marker, 'the rejected `data-ground` alternative is not named').toMatch(/data-ground/);
    expect(marker, 'the rejected has-no-colour shape is not named').toMatch(/HAS no colour/);
    expect(marker, 'the D-08 header-ground decision lost its marker').toMatch(
      /DECISION Phase 88\.3 \(D-08\/D-09\)/,
    );
    expect(marker).toMatch(/is a decision, not a cleanup/);
  });

  // -------------------------------------------------------------------------
  // Plan 16 — the JSX half of owner ruling 2. Bare `it(`, appended, nothing
  // renumbered (same rule the plan-11 block above follows).
  //
  // WHY THIS EXISTS AT ALL: the two class strings below would otherwise ship
  // behind nothing but a one-off SUMMARY `grep -c`, which runs once. Phase
  // 88.6's `Button` migration touches BOTH of these elements, and a migration
  // that drops `ring-line-control`/`dark:ring-0` from Manage Members, or swaps
  // the cog back to a bare `bg-surface-elevated`, would go green. That is the
  // same "coverage that reads as present because a grep was run once" gap this
  // plan exists to close for the compact month tile (test 8's `.find()` anchor).
  // -------------------------------------------------------------------------

  it('19. the two edgeless controls carry the plan-14 fill + ring treatment (ruling 2)', () => {
    // (a) Manage Members — a `.btn`, so its edge can only be a ring: the
    // unlayered `.btn { border: none }` eats every border utility, while
    // `ring-*` compiles to `box-shadow`. Located the way tests 15/16 locate the
    // header controls (the `'btn '` filter), then narrowed by the label text
    // that follows the className expression — never by a line number.
    const header = code(HEADER);
    const controls = attrExprs(header, 'className').filter((e) => /'btn[ ']/.test(e.text));
    expect(controls.length, 'the three .btn header controls were not found').toBe(3);
    const manage = controls.find((e) => header.slice(e.end, e.end + 400).includes('Manage Members'));
    expect(manage, 'the Manage Members control was not found by its label').toBeDefined();

    for (const util of [
      // the 80% white wash — the boundary on the eight tinted headers
      // (composited-vs-tint 1.634-1.716, measured 2026-08-27 via src/lib/wcag.ts)
      'bg-white/80',
      // the 1px ring — the ONLY cue on the WHITE uncoloured header, where the
      // wash composites to white and contributes nothing (ring-vs-white 1.595)
      'ring-1',
      'ring-line-control',
      // dark stays byte-equivalent to what shipped: no resting ring there
      'dark:ring-0',
    ]) {
      expect(manage!.text, `Manage Members lost its ${util} — Req 12 test 7 reopens`).toContain(
        util,
      );
    }

    // (b) the home-card cog — NOT a `.btn`, so it takes a real border. Located
    // by its aria-label, which follows the className on the same opening tag.
    const gl = code('app/components/grouplist.js');
    const at = gl.indexOf('aria-label="Customize group"');
    expect(at, 'the cog lost its aria-label — re-anchor this assertion').toBeGreaterThan(-1);
    const cog = attrExprs(gl, 'className').filter((e) => e.end < at).pop();
    expect(cog, 'no className expression precedes the cog aria-label').toBeDefined();

    for (const util of ['bg-btn-secondary', 'dark:bg-surface-elevated', 'border border-line-control']) {
      expect(cog!.text, `the cog lost its ${util}`).toContain(util);
    }
    // The dark arm must stay `dark:`-scoped. An un-prefixed `bg-surface-elevated`
    // is #ffffff in light and would emit AFTER `.bg-btn-secondary`, killing the
    // light fill outright — the exact state the owner reported.
    expect(
      cog!.text.match(/(^|[^:])bg-surface-elevated/g) ?? [],
      'the cog has an un-prefixed bg-surface-elevated — the light fill is dead',
    ).toHaveLength(0);

    // (c) THE NEGATIVE, on both. `--color-border-strong` / warm-500 is the
    // >= 3:1 neutral-border substitution the first version of this plan proposed
    // and the shipped-systems survey REJECTED (0 of 13 systems; the shipped
    // neutral-border band is 1.20-1.57 and warm-500 is 2.3x its top). It must not
    // creep back in as a "strengthening" edit.
    for (const [name, expr] of [
      ['Manage Members', manage!.text],
      ['the cog', cog!.text],
    ] as const) {
      expect(expr, `${name} was pointed at the rejected >= 3:1 border token`).not.toMatch(
        /border-line-strong|ring-line-strong/,
      );
    }
  });
});
