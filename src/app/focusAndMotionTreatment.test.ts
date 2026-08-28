/**
 * Req 4 (DES-03 / UI-SPEC §7.2) repo-wide guard: a keyboard user sees a ring, a pointer user
 * does not, and every control that already had pointer press-feedback has the keyboard
 * counterpart.
 *
 * WHAT WENT WRONG ONCE AND MUST NOT AGAIN
 * --------------------------------------
 * Two separate defects, both shipped for years:
 *
 *  1. A bare `focus:` styling variant fires on POINTER and PROGRAMMATIC focus as well as
 *     keyboard focus. So every `focus:ring-*` site put a ring on the control the moment it
 *     was clicked — visual noise that reads as a stuck selection — while `focus-visible:`
 *     exists precisely to scope the ring to the keyboard. Measured before this plan:
 *     `focus-visible` appeared in exactly 3 files repo-wide against 8 bare-`focus:` visible
 *     treatments in 6 files.
 *  2. 87.8-08 shipped `active:opacity-75` press feedback at 42 non-`.btn` tappables and
 *     deferred the keyboard counterpart to this phase (`87.8-08-SUMMARY.md`, and
 *     `.planning/deferred/phase-88.md`). Until 88-28 those 42 controls gave a pointer user
 *     feedback on every tap and a keyboard user nothing at all.
 *
 * `focus:outline-hidden` is DELIBERATELY still allowed and is NOT a defect. It suppresses the
 * UA outline while keeping a transparent one for forced-colors mode; v4's `outline-none`
 * removes it outright, which is why the SPEC was corrected in 88-02 and why nothing here
 * should "fix" `outline-hidden` back to `outline-none`.
 *
 * WHY THIS DOES NOT USE THE PLAN'S GREP — MEASURED, NOT ASSERTED
 * -------------------------------------------------------------
 * 88-28's Task 1 gate is
 *     grep -rnE 'focus:(ring|border|bg|text)' src --include='*.js' --include='*.jsx' --include='*.tsx'
 * It is directionally right (unlike the eleven recorded before it, it is NOT red on the
 * converged tree, and it DOES catch a violation planted inside a `${...}` branch — probes A
 * and D). But it has two false-negative classes, both measured against this tree:
 *
 *  - PROBE B — it enumerates four utility families, so it is blind to every OTHER visible
 *    focus treatment. Planting `focus:shadow-lg focus:opacity-100 focus:outline-2
 *    focus:outline-red-500` on `PendingMemberBanner.js` left the gate GREEN. `focus:outline-2`
 *    is the sharp one: it is one character away from the `focus:outline-hidden` the contract
 *    allows, and it is a visible pointer-firing outline.
 *  - PROBE C — its `--include` list omits `*.ts`. A bare `focus:ring-2` appended to
 *    `src/components/ui/useFetchErrorState.ts` left the gate GREEN. No `.ts` file carries a
 *    `focus:` token today, so this is a detector blindness rather than a live defect — but
 *    `src/components/ui/` is where this phase's primitives live and several are `.ts`/`.tsx`.
 *
 * The scan below inverts the grep: it is an ALLOW-LIST (only `outline-hidden` may follow a
 * bare `focus:`), so an unlisted utility fails BY DEFAULT rather than being invisible. That
 * is the same inversion DEF-88-25-02 was forced into for the raw-message property, for the
 * same reason.
 *
 * WHY A SOURCE SCAN AND NOT A RENDER TEST
 * --------------------------------------
 * Same reasoning as `borderExplicitness.test.ts`, `tintTreatment.test.ts` and
 * `fetchErrorTreatment.test.ts`: the property is "every interactive control in the app",
 * spread across 21+ files behind modals, role gates, magic-link routes and error branches
 * that no single render reaches. A per-surface pin also goes green forever the moment
 * surface N+1 lands.
 *
 * NOTE ON DUPLICATION: `stringChunks` below is a third copy of the lexer in
 * `borderExplicitness.test.ts` / `tintTreatment.test.ts`. Importing it would re-register
 * those files' suites in this file's context. Extracting all three into a shared test helper
 * is a candidate for 88-29's gate-hygiene pass; deliberately not done here, mid-sweep.
 */
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const SRC = path.resolve(__dirname, '..');

/**
 * The ONLY utility permitted behind a bare `focus:` variant. Everything else is a visible
 * treatment and belongs on `focus-visible:`. Adding an entry here is a decision, not a
 * cleanup — it widens the set of styles a MOUSE user sees on click.
 */
const ALLOWED_BARE_FOCUS = new Set(['outline-hidden']);

// DECISION Phase 88-29 (gate hygiene): `stringChunks` moved to
// `src/test-utils/sourceScan.ts` and IMPORTED here, chosen OVER keeping a per-suite copy.
// `tintTreatment.test.ts` itself nominated this extraction for 88-29; by then there were
// THREE byte-identical copies (verified by brace-balanced pairwise diff before the move)
// and this plan needed two more. Five copies of a scanner is four places a correctness fix
// can be forgotten — the exact drift shape the Phase 88 gate ledger records fourteen times.
// The lexer could not be imported from a sibling TEST file: a test module's body registers
// its own `describe` blocks, so that import would run another suite in this file's context.
// Re-inlining a private copy here is a decision, not a cleanup.

/**
 * Split a Tailwind token into its variant chain and utility, respecting `[...]` (so
 * `data-[state=open]:bg-x` yields one variant, not two, and `md:focus:ring-2` yields two).
 */
export function splitToken(token: string): { variants: string[]; utility: string } {
  const variants: string[] = [];
  let start = 0;
  let bracket = 0;
  for (let i = 0; i < token.length; i += 1) {
    const c = token[i];
    if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
    else if (c === ':' && bracket === 0) {
      variants.push(token.slice(start, i));
      start = i + 1;
    }
  }
  return { variants, utility: token.slice(start).replace(/^!/, '') };
}

/**
 * A bare-`focus:` VISIBLE treatment: the token's variant chain contains the exact variant
 * `focus` (never `focus-visible`, `focus-within`, `group-focus`, `peer-focus`) and its
 * utility is not on the allow-list.
 */
export function isBareFocusVisibleTreatment(token: string): boolean {
  const { variants, utility } = splitToken(token);
  if (!variants.includes('focus')) return false;
  return !ALLOWED_BARE_FOCUS.has(utility);
}

/**
 * Whole `className` values, brace-matched, so a pairing check sees the ENTIRE expression.
 *
 * A chunk-level check would not do: `AvailabilityGrid.js`'s paint-mode toggle carries
 * `active:opacity-75` inside a `${disabled ? … : …}` branch while its ring sits in the outer
 * static chunk — two different chunks, one control. Matching the attribute is the only level
 * at which "this control has both" is a well-posed question.
 */
export function classNameValues(src: string): { line: number; text: string }[] {
  const out: { line: number; text: string }[] = [];
  for (const m of src.matchAll(/className\s*=\s*/g)) {
    let i = m.index! + m[0].length;
    const line = src.slice(0, m.index!).split('\n').length;
    if (src[i] === '"' || src[i] === "'") {
      const q = src[i];
      const end = src.indexOf(q, i + 1);
      if (end < 0) continue;
      out.push({ line, text: src.slice(i + 1, end) });
    } else if (src[i] === '{') {
      let depth = 0;
      const start = i;
      for (; i < src.length; i += 1) {
        const c = src[i];
        if (c === '{') depth += 1;
        else if (c === '}') {
          depth -= 1;
          if (depth === 0) break;
        } else if (c === '"' || c === "'" || c === '`') {
          const qq = c;
          i += 1;
          while (i < src.length && src[i] !== qq) {
            if (src[i] === '\\') i += 1;
            i += 1;
          }
        }
      }
      out.push({ line, text: src.slice(start, i + 1) });
    }
  }
  return out;
}

// DECISION Phase 88-31 (DEF-88-29-01): `sourceFiles` is IMPORTED from
// `src/test-utils/sourceScan.ts`, chosen OVER keeping this suite's private copy.
//
// 88-29 extracted `stringChunks` and deliberately left `sourceFiles` alone, because its six
// copies had visibly different SIGNATURES — `(dir)` vs `(dir, out = [])` vs `(dir, acc = [])`
// — and converging them from the plan whose job was arming gates would have been an
// unannounced behaviour change to six shipped, negative-checked suites. This is the residual
// pass that entry named as the owner, and the convergence was MEASURED before it was made,
// not assumed from reading:
//   - four copies (this one's family) were semantically identical to the canonical one;
//   - `cardPaddingIdiom`'s carried an extra `node_modules` skip, and there are ZERO
//     `node_modules` directories under `src/` (measured), so it was dead;
//   - `controlSizeFloor`'s excluded `.test.` but NOT `.spec.`, and there are ZERO `.spec.`
//     files under `src/` (measured), so its set was identical too. Its root is `src/`, the
//     same as everyone else's — the "different root" in the deferral was a misreading.
// So all six enumerated the same files, and this is a verbatim move rather than a behaviour
// change. Each suite's own anti-vacuity floor (`files.length > 100`) still holds afterwards.
//
// Re-inlining a private copy here is a decision, not a cleanup: six copies of a directory
// walker is five places a correctness fix — a new extension, a newly-excluded directory — can
// be forgotten, which is the drift shape the Phase 88 gate ledger records fifteen times, one
// layer down.

describe('focus treatment (Req 4 / UI-SPEC §7.2)', () => {
  const files = sourceFiles(SRC);

  it('finds a representative sample of the app, so the sweep is not scanning an empty set', () => {
    // `.ts` is in the walk on purpose — the plan's grep omitted it (probe C).
    expect(files.length).toBeGreaterThan(100);
    expect(files.some((f) => f.endsWith('.ts'))).toBe(true);
    const focusVisibleTokens = files.flatMap((f) =>
      stringChunks(fs.readFileSync(f, 'utf8'))
        .flatMap((c) => c.text.split(/\s+/))
        .filter((t) => t.includes('focus-visible:')),
    );
    expect(focusVisibleTokens.length).toBeGreaterThan(50);
  });

  it('1. no source file styles a VISIBLE treatment behind a bare `focus:` variant', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { offset, text } of stringChunks(src)) {
        for (const token of text.split(/\s+/).filter(Boolean)) {
          if (isBareFocusVisibleTreatment(token)) {
            const line = src.slice(0, offset).split('\n').length;
            offenders.push(`${path.relative(SRC, file)}:${line} ${token}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. every `active:opacity-75` press site has a `focus-visible:` pairing on the same control', () => {
    const offenders: string[] = [];
    let paired = 0;
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const { line, text } of classNameValues(src)) {
        if (!text.includes('active:opacity-75')) continue;
        if (text.includes('focus-visible:')) {
          paired += 1;
          continue;
        }
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
    // Anti-vacuity: without this, deleting every `active:opacity-75` in the app would make
    // the assertion above pass. 87.8-08 censused 42 non-comment sites; a drop below 40 means
    // the press idiom itself is being removed, which is a decision, not a refactor.
    expect(paired).toBeGreaterThanOrEqual(40);
  });

  it('3. the three pre-88-28 compliant files still carry their `focus-visible` rings', () => {
    for (const rel of [
      'app/components/Modal.tsx',
      'app/components/StarRatingPicker.js',
      'components/ui/ErrorFallback.tsx',
    ]) {
      expect(fs.readFileSync(path.join(SRC, rel), 'utf8')).toContain('focus-visible:ring-2');
    }
  });

  it('4. the six ui/ primitives ring on keyboard focus only', () => {
    for (const rel of [
      'components/ui/Button.tsx',
      'components/ui/Input.tsx',
      'components/ui/Switch.tsx',
      'components/ui/Tabs.tsx',
      'components/ui/dialog.tsx',
      'app/components/form/SelectField.tsx',
    ]) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      expect(src, rel).toContain('focus-visible:ring-2');
    }
  });

  it('5. the parser tells an allowed bare `focus:` from a visible one, and from `focus-visible:`', () => {
    // the allowed one — forced-colors affordance, NOT a defect
    expect(isBareFocusVisibleTreatment('focus:outline-hidden')).toBe(false);
    // the four families the plan's grep DOES see
    expect(isBareFocusVisibleTreatment('focus:ring-2')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:border-focus-ring')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:bg-red-500')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:text-white')).toBe(true);
    // PROBE B — the families it does NOT see. These are why this test exists.
    expect(isBareFocusVisibleTreatment('focus:shadow-lg')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:opacity-100')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:outline-2')).toBe(true);
    expect(isBareFocusVisibleTreatment('focus:outline-red-500')).toBe(true);
    // stacked variants still resolve to the bare `focus` variant
    expect(isBareFocusVisibleTreatment('md:focus:ring-2')).toBe(true);
    expect(isBareFocusVisibleTreatment('dark:focus:ring-2')).toBe(true);
    expect(isBareFocusVisibleTreatment('data-[state=open]:focus:ring-2')).toBe(true);
    // the correct forms, and the near-miss variants that must NOT be flagged
    expect(isBareFocusVisibleTreatment('focus-visible:ring-2')).toBe(false);
    expect(isBareFocusVisibleTreatment('focus-within:ring-2')).toBe(false);
    expect(isBareFocusVisibleTreatment('group-focus:ring-2')).toBe(false);
    expect(isBareFocusVisibleTreatment('peer-focus:ring-2')).toBe(false);
    // `data-[state=open]:` must count as ONE variant, not two
    expect(splitToken('data-[state=open]:bg-x').variants).toEqual(['data-[state=open]']);
  });

  it('6. the className reader spans a whole expression, not one chunk', () => {
    // (motion assertions live in their own describe below — see `reducedMotionBlock`)
    // the AvailabilityGrid shape: press token inside a `${...}` branch, ring in the outer
    // static chunk. A chunk-level check reports a false positive here.
    const fixture = [
      'const x = (',
      '  <button',
      '    className={`',
      '      px-3 focus:outline-hidden focus-visible:ring-2',
      "      ${disabled ? 'opacity-50' : 'active:opacity-75'}",
      '    `}',
      '  />',
      ');',
    ].join('\n');
    const values = classNameValues(fixture);
    expect(values).toHaveLength(1);
    expect(values[0].text).toContain('active:opacity-75');
    expect(values[0].text).toContain('focus-visible:ring-2');
  });
});

/**
 * ---------------------------------------------------------------------------------------
 * Req 4 / UI-SPEC §7.1 — the reduced-motion contract.
 *
 * WHY THIS DOES NOT USE THE PLAN'S GATE — MEASURED, NOT ASSERTED
 * -------------------------------------------------------------
 * 88-28's Task 2 gate is
 *     grep -q "prefers-reduced-motion" globals.css && ! grep -nE "animation: *none *!important" globals.css
 * Probed against this tree, five plants:
 *
 *   A  `animation: none !important` planted            -> RED   (correct)
 *   B  `animation-name: none !important` planted       -> GREEN (FALSE NEGATIVE)
 *   C  `animation:none!important` (no spaces)          -> RED   (correct)
 *   D  `animation-play-state: paused !important`       -> GREEN (FALSE NEGATIVE)
 *   E  whole block deleted                             -> RED   (correct)
 *
 * B and D are not edge cases — they are the two failures the contract exists to prevent,
 * written a different way. B removes the animation exactly as the forbidden declaration does,
 * so `animationend` stops firing and Radix `Presence` leaves exit-animating dialogs mounted.
 * D freezes all 29 spinners, which is §7.1's named "reads as a hung app" defect. A gate that
 * matches ONE spelling of a semantic property is a string check, not a property check.
 *
 * The gate ALSO went red, before this suite existed, on the DECISION marker in `globals.css`
 * that documents why the declaration is forbidden — the comment-blindness recorded at
 * DEF-88-25-02 and again for 88-26. Following 88-11's convention, that marker now DESCRIBES
 * the forbidden declaration instead of quoting it, because it is net-new text. A prior
 * phase's marker would have been left alone.
 *
 * The parse below reads the block's DECLARATIONS rather than grepping its text, so all four
 * kill spellings and the strobe case fail by construction.
 */
type Decl = { prop: string; value: string; important: boolean };

/** The `@media (prefers-reduced-motion: reduce)` block's rules, or null if absent. */
export function reducedMotionBlock(
  css: string,
): { selector: string; decls: Decl[] }[] | null {
  const at = css.search(/@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/);
  if (at < 0) return null;
  const open = css.indexOf('{', at);
  let depth = 0;
  let end = open;
  for (; end < css.length; end += 1) {
    if (css[end] === '{') depth += 1;
    else if (css[end] === '}') {
      depth -= 1;
      if (depth === 0) break;
    }
  }
  // strip comments so a marker's prose can never be parsed as a declaration
  const body = css.slice(open + 1, end).replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: { selector: string; decls: Decl[] }[] = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body))) {
    const decls: Decl[] = [];
    for (const raw of m[2].split(';')) {
      const idx = raw.indexOf(':');
      if (idx < 0) continue;
      const prop = raw.slice(0, idx).trim();
      let value = raw.slice(idx + 1).trim();
      const important = /!\s*important$/.test(value);
      value = value.replace(/!\s*important$/, '').trim();
      if (prop) decls.push({ prop, value, important });
    }
    rules.push({ selector: m[1].trim().replace(/\s+/g, ' '), decls });
  }
  return rules;
}

/** ms for a CSS time value; NaN if unparseable. */
export function timeMs(value: string): number {
  const m = /^([\d.]+)(ms|s)$/.exec(value.trim());
  if (!m) return NaN;
  return m[2] === 's' ? parseFloat(m[1]) * 1000 : parseFloat(m[1]);
}

describe('reduced-motion contract (Req 4 / UI-SPEC §7.1)', () => {
  const css = fs.readFileSync(path.join(__dirname, 'globals.css'), 'utf8');
  const rules = reducedMotionBlock(css);

  it('1. globals.css has a `prefers-reduced-motion: reduce` block with real rules in it', () => {
    expect(rules).not.toBeNull();
    expect(rules!.length).toBeGreaterThanOrEqual(3);
  });

  it('2. nothing in the block KILLS animation — the four spellings, not one literal', () => {
    const kills: string[] = [];
    for (const { selector, decls } of rules!) {
      for (const { prop, value } of decls) {
        const v = value.toLowerCase();
        // shorthand or name set to none: `animationend` stops firing (Radix Presence)
        if ((prop === 'animation' || prop === 'animation-name') && /\bnone\b/.test(v)) {
          kills.push(`${selector} { ${prop}: ${value} }`);
        }
        // frozen, not slowed: §7.1's "a frozen spinner reads as a hung app"
        if (prop === 'animation-play-state' && v === 'paused') {
          kills.push(`${selector} { ${prop}: ${value} }`);
        }
        // zero iterations never runs and never ends
        if (prop === 'animation-iteration-count' && Number(v) === 0) {
          kills.push(`${selector} { ${prop}: ${value} }`);
        }
      }
    }
    expect(kills).toEqual([]);
  });

  it('3. the block CUTS: the wildcard reduces durations to <=100ms and never to zero', () => {
    const wildcard = rules!.filter((r) => /^\*/.test(r.selector));
    expect(wildcard.length).toBeGreaterThan(0);
    const durations = wildcard.flatMap((r) =>
      r.decls.filter((d) => d.prop === 'transition-duration' || d.prop === 'animation-duration'),
    );
    expect(durations.length).toBe(2);
    for (const d of durations) {
      expect(d.important, `${d.prop} must be !important to beat a layered utility`).toBe(true);
      const ms = timeMs(d.value);
      expect(ms).toBeGreaterThan(0); // 0ms is a kill wearing a cut's clothes
      expect(ms).toBeLessThanOrEqual(100);
    }
  });

  it('4. spinners are EXEMPTED and slowed, never sped into a strobe', () => {
    const spin = rules!.find((r) => r.selector.includes('.animate-spin'));
    expect(spin, '.animate-spin must be exempted from the wildcard cut').toBeDefined();
    const dur = spin!.decls.find((d) => d.prop === 'animation-duration');
    expect(dur?.important).toBe(true);
    // Tailwind's default is 1s. Anything faster is a strobe for the exact users who asked
    // for less motion; the wildcard alone would have made it 100ms, i.e. 10 turns a second.
    expect(timeMs(dur!.value)).toBeGreaterThanOrEqual(1000);
  });

  it('5. no `transform: none` — it would throw every centred dialog off-screen', () => {
    const offenders = rules!
      .flatMap((r) => r.decls.map((d) => ({ ...d, selector: r.selector })))
      .filter((d) => d.prop === 'transform' && /\bnone\b/.test(d.value.toLowerCase()));
    expect(offenders).toEqual([]);
    // the reason, pinned: dialog centring is a static transform, not motion
    expect(fs.readFileSync(path.join(SRC, 'components/ui/dialog.tsx'), 'utf8')).toContain(
      'translate-x-[-50%]',
    );
  });

  it('6. the block is UNLAYERED — an important declaration inside a layer loses to one outside', () => {
    const at = css.search(/@media\s*\(\s*prefers-reduced-motion/);
    let depth = 0;
    let layered = false;
    for (let i = 0; i < at; i += 1) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
    }
    layered = depth > 0;
    expect(layered, 'the block must sit at top level, not inside @layer').toBe(false);
  });

  it('7. the parser reads declarations, not prose, and tells a cut from every kill', () => {
    const probe = (body: string) =>
      reducedMotionBlock(`@media (prefers-reduced-motion: reduce){${body}}`)!;
    // a comment naming the forbidden declaration must NOT be parsed as one (the exact
    // false positive that made the plan's grep red on this repo's own marker)
    expect(probe('/* never animation: none !important */ *{animation-duration:100ms!important}'))
      .toEqual([{ selector: '*', decls: [{ prop: 'animation-duration', value: '100ms', important: true }] }]);
    // every kill spelling is recognised as a declaration
    expect(probe('*{animation-name:none!important}')[0].decls[0].prop).toBe('animation-name');
    expect(probe('*{animation-play-state:paused!important}')[0].decls[0].value).toBe('paused');
    // and `!important` is read off the value, not left glued to it
    expect(probe('*{animation-duration:.1s !important}')[0].decls[0]).toEqual({
      prop: 'animation-duration',
      value: '.1s',
      important: true,
    });
    expect(timeMs('1.5s')).toBe(1500);
    expect(timeMs('100ms')).toBe(100);
  });
});

/**
 * ---------------------------------------------------------------------------------------
 * Req 4 / UI-SPEC §7.3 — accessible names on icon-only controls.
 *
 * §7.3 is a GENERAL RULE, not a list: "every icon-only interactive control MUST carry an
 * accessible name". SPEC Req 4 enumerated two `&times;` buttons (createEvent, PromptScheduleManager)
 * as INSTANCES of it — both had already been removed by the 88-16/88-17 Modal migrations by the
 * time this plan ran, so a checklist keyed to those two names would have gone green over a repo
 * that still had an unnamed control in it. It did: the sweep below found
 * `BallotOptionsEditor.js`'s remove-option button, whose only name was a `title`, and §7.3 says
 * a bare `title` does not count (not reliably exposed by screen readers, invisible on touch).
 *
 * So this is written as the RULE, applied to the whole repo, rather than as the SPEC's two
 * names. It is the same reason the border/tint/type guards in this directory are sweeps.
 */
describe('accessible names on icon-only controls (Req 4 / UI-SPEC §7.3)', () => {
  const files = sourceFiles(SRC);

  /** End of the opening tag at `i`, respecting `{...}` in attribute values. */
  function tagEnd(src: string, i: number): number {
    let depth = 0;
    for (let j = i; j < src.length; j += 1) {
      const c = src[j];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) return j;
    }
    return -1;
  }

  /** Interactive elements whose rendered text is empty or a lone glyph, with no ARIA name. */
  function unnamedIconOnlyControls(src: string, tag: string): number[] {
    const GLYPHS = new Set(['&times;', '×', '✕', '✖', '+', '−', '⏳', '›', '‹', '▲', '▼']);
    const out: number[] = [];
    for (const m of src.matchAll(new RegExp(`<${tag}\\b`, 'g'))) {
      const end = tagEnd(src, m.index!);
      if (end < 0) continue;
      // Comments are stripped from the ATTRIBUTES too, not just the body. Found the hard way:
      // this scanner first read the word `aria-label` out of the DECISION marker sitting
      // between BallotOptionsEditor's attributes and declared the control named. Deleting the
      // real `aria-label` then left the sweep GREEN — a false negative caused by the comment
      // that documents the rule. Third instance of comment-blindness in this plan alone (the
      // Req 4 verify gate and the merge pin in `keyboardOperability.test.tsx` are the others).
      const attrs = src.slice(m.index!, end).replace(/\/\*[\s\S]*?\*\//g, '');
      if (/aria-label|aria-labelledby/.test(attrs)) continue;
      // non-<button> tags only count when they are actually interactive
      if (tag !== 'button' && !/role="button"|onClick/.test(attrs)) continue;
      const close = src.indexOf(`</${tag}>`, end);
      if (close < 0) continue;
      let body = src.slice(end + 1, close);
      body = body.replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, ''); // JSX comments
      body = body.replace(/<svg\b[\s\S]*?<\/svg>/g, ''); // the glyph is decorative
      body = body.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
      if (body === '' || GLYPHS.has(body)) out.push(src.slice(0, m.index!).split('\n').length);
    }
    return out;
  }

  it('1. no `<button>` in the repo is icon-only-and-nameless', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const line of unnamedIconOnlyControls(src, 'button')) {
        offenders.push(`${path.relative(SRC, file)}:${line}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('2. nor any `DialogClose` / interactive `a` / `span` / `div`', () => {
    const offenders: string[] = [];
    for (const file of files) {
      const src = fs.readFileSync(file, 'utf8');
      for (const tag of ['DialogClose', 'a', 'span', 'div']) {
        for (const line of unnamedIconOnlyControls(src, tag)) {
          offenders.push(`${path.relative(SRC, file)}:${line} <${tag}>`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('3. a bare `title` does not satisfy the rule — the scanner ignores it', () => {
    // the exact shape 88-28 found and fixed in BallotOptionsEditor
    const withTitleOnly = '<button type="button" title="Remove option">&times;</button>';
    expect(unnamedIconOnlyControls(withTitleOnly, 'button')).toEqual([1]);
    const withAriaLabel = '<button type="button" aria-label="Remove option" title="Remove option">&times;</button>';
    expect(unnamedIconOnlyControls(withAriaLabel, 'button')).toEqual([]);
    // an svg-only button with no name is the other half of the rule
    expect(
      unnamedIconOnlyControls('<button onClick={x}><svg viewBox="0 0 1 1"/></button>', 'button'),
    ).toEqual([1]);
    // a button with real text is not icon-only and is left alone
    expect(unnamedIconOnlyControls('<button onClick={x}>Remove</button>', 'button')).toEqual([]);
    // ANTI-VACUITY: a `{...}` in an attribute must not end the tag early
    expect(
      unnamedIconOnlyControls('<button onClick={() => f({a: 1})} aria-label="x">&times;</button>', 'button'),
    ).toEqual([]);
    // ANTI-VACUITY: a COMMENT mentioning aria-label must not count as one. This is the exact
    // false negative this scanner shipped in its first draft.
    expect(
      unnamedIconOnlyControls(
        '<button /* the aria-label is the accessible name */ title="Remove">&times;</button>',
        'button',
      ),
    ).toEqual([1]);
  });

  it('4. the two `&times;` buttons SPEC Req 4 enumerated really are gone, not just renamed', () => {
    // recorded so a future reader does not go looking for them: 88-16/88-17's Modal
    // migrations removed both, and each file carries a marker saying so.
    for (const rel of ['app/components/createEvent.js', 'app/components/PromptScheduleManager.js']) {
      const src = fs.readFileSync(path.join(SRC, rel), 'utf8');
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      expect(code, `${rel} still renders a glyph close button`).not.toMatch(/&times;|>\s*×\s*</);
    }
  });
});

/**
 * Feedback-modal focus restoration — the source-level half of DEF-88.3-12-01.
 *
 * WHY THIS EXISTS AT ALL. The behavioural gate for this is
 * `e2e/feedback-stacking.spec.ts`, and per `88.3-VALIDATION.md` caveat 4 the `e2e` job
 * cannot execute on a laptop by design — its auth state is produced against real Auth0.
 * A regression this specific (a caller stops handing the provider an invoker; someone
 * "simplifies" the guarded `preventDefault()` back to an unconditional one) would then
 * only surface on CI, which is a slow loop for a one-line edit. These are cheap source
 * pins in front of that.
 *
 * WHAT THEY PIN, and the reverse pin that stops the easy cheat: the row hands the
 * provider an override, `Header` supplies the hamburger toggle's ref, the provider
 * focuses BEFORE it prevents the default and only prevents when the focus landed — and
 * `Header`'s `inert` guard (R3-D) is still there, exactly once. That last one is the
 * point: the cheapest way to make the e2e assertion green was always to delete `inert`,
 * and this suite reds if anyone does.
 */
describe('feedback-modal focus restoration (DEF-88.3-12-01 / owner ruling 6, 2026-08-27)', () => {
  const codeOf = (rel: string) => withoutComments(fs.readFileSync(path.join(SRC, rel), 'utf8'));

  it('1. the row variant hands the provider an invoker OVERRIDE, and the FAB path is untouched', () => {
    const src = codeOf('app/components/FeedbackButton.js');
    // the prop exists on the signature and is used at the row's open() call
    expect(src, 'FeedbackButton must accept an optional invokerRef prop').toMatch(
      /function FeedbackButton\(\{[^}]*invokerRef[^}]*\}\)/,
    );
    expect(
      src,
      'the ROW variant must call open(invokerRef?.current ?? e.currentTarget) — an inert element cannot take focus, so the row cannot be its own restore target',
    ).toContain('open(invokerRef?.current ?? e.currentTarget)');
    // ...and the FAB still passes nothing, so its behaviour is unchanged BY CONSTRUCTION
    expect(
      src,
      'the FAB must still call open(e.currentTarget) — the desktop entry point restores to itself and this change must not reach it',
    ).toContain('open(e.currentTarget)');
  });

  it('2. Header wires the hamburger toggle as the row\'s invoker, and R3-D `inert` is intact', () => {
    const src = codeOf('app/Header.js');
    const wires = src.match(/invokerRef=\{triggerRef\}/g) ?? [];
    expect(
      wires.length,
      'Header must pass invokerRef={triggerRef} to the nav-row FeedbackButton exactly once',
    ).toBe(1);
    // REVERSE PIN (owner ruling 6: R3-D stays). The cheap way to make the e2e focus
    // assertion pass was always to drop `inert` from the closed panel — that would put
    // the menu rows back in the tab order, which is the defect R3-D was added to fix.
    const inertGuards = src.match(/inert=\{mobileMenuOpen \? undefined : ''\}/g) ?? [];
    expect(
      inertGuards.length,
      "Header's closed mobile menu must still carry inert={mobileMenuOpen ? undefined : ''} (R3-D) — removing it is how this focus fix gets faked",
    ).toBe(1);
    // and the toggle it restores to is a real, ref'd, named control
    expect(src).toContain('ref={triggerRef}');
    expect(src).toContain('aria-label="Toggle menu"');
  });

  it('3. the provider FOCUSES first and only then prevents the default, guarded on where focus landed', () => {
    const src = codeOf('app/components/FeedbackModalProvider.tsx');
    const focusAt = src.indexOf('invoker.focus()');
    const preventAt = src.indexOf('event.preventDefault()');
    expect(focusAt, 'the provider must still restore focus to the invoker').toBeGreaterThan(-1);
    expect(preventAt, 'the provider must still be able to suppress Radix default focus').toBeGreaterThan(-1);
    expect(
      focusAt,
      'invoker.focus() must run BEFORE event.preventDefault() — the toggle is md:hidden, so if the viewport crossed 768px while the modal was open the focus is a no-op and an already-fired preventDefault() strands focus on <body> (T-88.3-80)',
    ).toBeLessThan(preventAt);
    expect(
      src,
      'preventDefault() must be guarded on document.activeElement === invoker, so a failed restore falls back to Radix instead of <body>',
    ).toContain('document.activeElement === invoker');
  });
});
