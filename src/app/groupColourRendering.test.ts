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

// Plan 88.3.1-09: imported so test 21's fixture is CHECKED against the shipped table
// rather than transcribed from it. A source-scan file importing production data is the
// exception here, not the rule — it is safe because the assertion is "my fixture still
// matches yours", which is exactly the drift a transcribed hex hides.
import { GROUP_COLOUR_PRESETS } from '../lib/groupColourPresets';
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
const RENDER_SITES: { file: string; nullBranch: string[] }[] = [
  { file: 'app/components/grouplist.js', nullBranch: ['bg-surface-card hover:bg-surface-hover'] },
  // AMENDED plan 88.3-16: a per-file SET, not a single string, because this file
  // has TWO tint-forked tiles whose null branches legitimately DIFFER. The full
  // tile's is empty (its shipped D-28 null semantics, above); the COMPACT tile's
  // is its shipped `bg-surface-card-hover` — changing that would be a visual
  // change on a surface the owner has not been asked about. The second entry
  // carries its `hover:` class VERBATIM because plan 16 forks hover INSIDE the
  // ternary (`.hover\:bg-surface-elevated:hover` at (0,2,0) would otherwise beat
  // the tint background at (0,1,0) and strip a tinted tile's colour under the
  // pointer). That is also why the cross-expression negative in test 3 was NOT
  // weakened to strip variant prefixes: the whole ternary — hover class included
  // — is removed from `rest` before the `bg-surface-` check runs, so nothing
  // needed loosening. A gate weakened to admit a shape is worse than the shape.
  {
    file: 'app/components/CalendarMonthView.js',
    nullBranch: ['', 'bg-surface-card-hover hover:bg-surface-elevated'],
  },
  { file: 'app/components/CalendarListView.js', nullBranch: ['bg-surface-card'] },
  { file: 'app/components/EventDayModal.js', nullBranch: ['bg-surface-card'] },
  { file: SEED, nullBranch: ['bg-surface-card'] },
];

const TINT = 'lightTintGroupBackgroundColor';
/** THE resolver (plan 88.3.1-06). Also a RENDER transform — same rule as the tint. */
const RESOLVER = 'resolveGroupGround';
/** The shared preset table (plan 88.3.1-03), which is where the raw hexes live now. */
const TABLE = 'lib/groupColourPresets.ts';
const LIGHT_GROUND = '--group-ground-light';

/** Why an ink in a payload is the same defect class as a tint in a payload. */
const INK_BOOM =
  'UI-SPEC 4.1: the inks and their muted rungs are RESOLVED on the frontend from the ' +
  'stored id, exactly like the grounds. They are never persisted and never sent. A ' +
  'payload built from one destroys the group identity the id exists to carry, and it ' +
  'cannot be recovered from the rendered value.';

/**
 * The eight `dark` / `light` grounds, byte-pinned.
 *
 * RE-POINTED plan 88.3.1-07 from the eight near-black `DEFAULT_BACKGROUND_COLORS`
 * hexes that used to live in `GroupSettings.js`. They are asserted against
 * `lib/groupColourPresets.ts` now, because that is where the table moved — and the
 * point of the assertion is unchanged: these values are CROSS-STACK data, persisted
 * by id and validated by the backend, so a silent edit here is a silent edit to what
 * every existing coloured group renders as.
 */
const PRESET_GROUNDS: [string, string, string][] = [
  ['red', '#52151c', '#ffd3d4'],
  ['orange', '#422200', '#ffd6b1'],
  ['amber', '#322b00', '#e7e0aa'],
  ['green', '#004511', '#bde9c2'],
  ['teal', '#003538', '#94edf0'],
  ['blue', '#00274d', '#c4e1ff'],
  ['violet', '#33255a', '#dfd9ff'],
  ['rose', '#3e133c', '#fdd1f8'],
];

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

/**
 * Every JSX OPENING TAG in a file, with its raw attribute text.
 *
 * Added Phase 88.3-17 for the focusable-needs-a-ring scan (DEF-88.3-13-04). A grep
 * cannot do this job for the same three reasons the rest of this phase's guards are
 * scanners: every `className` in this repo sits on a different line from its opening
 * tag (grep is line-based), attribute values contain `{...}` groups with nested
 * literals and `>` characters, and the tokens involved are quoted inside DECISION
 * markers all over these files (hence `withoutComments` on every caller).
 *
 * Walks attributes with the same `literalEnd` / `braceEnd` pair the rest of this file
 * uses, so a `>` inside `onClick={() => f(a > b)}` or inside a string does not end the
 * tag early.
 */
function openTags(src: string): { line: number; tag: string; attrs: string }[] {
  const out: { line: number; tag: string; attrs: string }[] = [];
  for (const m of src.matchAll(/<([A-Za-z][A-Za-z0-9_.]*)/g)) {
    const from = m.index ?? 0;
    let i = from + m[0].length;
    const attrStart = i;
    let end = -1;
    while (i < src.length) {
      const ch = src[i];
      if (ch === '"' || ch === "\'" || ch === '`') {
        i = literalEnd(src, i) + 1;
        continue;
      }
      if (ch === '{') {
        i = braceEnd(src, i) + 1;
        continue;
      }
      if (ch === '>') {
        end = i;
        break;
      }
      i += 1;
    }
    if (end < 0) continue;
    out.push({ line: lineAt(src, from), tag: m[1], attrs: src.slice(attrStart, end) });
  }
  return out;
}

/**
 * The group-page RENDER TREE, per owner ruling A (2026-08-27).
 *
 * The owner's UAT test 8c finding was PAGE-WIDE — "when tabbing around the screen like
 * this it's a blue circle, which is readable on some items, and not readable on others"
 * — so a scan scoped to `CalendarMonthView.js` would close DEF-88.3-13-04 on a narrower
 * surface than it was reported on. These are the five files the group page actually
 * mounts.
 *
 * The FLOOR is the anti-vacuity half, counted on 2026-08-27 against the shipped tree.
 * Without it, a refactor that moved every focusable out of these files into a new
 * component would shrink the scanned population to zero and stay green forever, which
 * is the failure mode this phase's gate ledger records fifteen times.
 */
const RING_SCAN_FILES: { file: string; floor: number }[] = [
  { file: 'app/groupHomePage/page.js', floor: 7 },
  { file: 'app/components/EventCalendar.js', floor: 1 },
  { file: 'app/components/CalendarMonthView.js', floor: 5 },
  { file: 'app/components/CalendarListView.js', floor: 2 },
  { file: 'app/components/GroupGamesList.js', floor: 8 },
];

/**
 * Tags whose ring comes from the PRIMITIVE'S OWN base class, not from a utility at the
 * call site. Asserted once against the primitive itself in test 22 rather than requiring
 * a redundant `focus-visible:ring-*` at every usage — a call-site requirement here would
 * be duplicated styling that can drift out of step with the primitive.
 *
 * This is an EXEMPTION, recorded as a decision so it reads as one rather than as a hole:
 * adding a name to this set removes real coverage and must be paid for by a matching
 * assertion against that primitive's base class.
 */
const RING_BEARING_PRIMITIVES = new Set(['Button', 'SelectControl', 'KebabMenu']);

/** Where each exempted primitive's own ring lives, so the exemption is PAID FOR. */
const PRIMITIVE_RING_SOURCE: Record<string, string> = {
  Button: 'components/ui/Button.tsx',
  SelectControl: 'components/ui/Input.tsx',
  KebabMenu: 'app/components/KebabMenu.js',
};

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

    // (a) the seed still reads a STORED value and never a rendered one.
    //     RE-POINTED plan 88.3.1-07 (AMENDMENT E): the accessor moved from
    //     `resolveGroupBackgroundColor(group.background_color)` to
    //     `storedGroupColour(group)` because there are now TWO stored columns and
    //     reading only the legacy one wipes a migrated group's colour on the next
    //     save. The CONTROL is unchanged — what this line forbids is a RENDER
    //     transform in the seed, and both are named below.
    expect(gs, boom).toMatch(/useState\(\s*storedGroupColour\(group\)/);
    expect(gs, boom).not.toMatch(/useState\(\s*resolveGroupGround\(/);
    expect(gs, boom).not.toMatch(new RegExp(`useState\\(\\s*${TINT}\\(`));

    // (b) no rendered value appears anywhere inside the save handler — not the
    //     tint, not the resolver, not an ink or a muted rung, and not a raw hex
    //     from the table. UI-SPEC 4.1: "the inks are never persisted and never
    //     sent" extends test 1 verbatim.
    const save = functionBody(gs, 'handleSave');
    expect(save.length, 'handleSave not found — this gate has lost its target').toBeGreaterThan(50);
    expect(save, 'handleSave builds the persisted payload').toContain('background_color:');
    expect(save, 'handleSave builds the persisted payload').toContain('color_preset:');
    expect(save, boom).not.toContain(TINT);
    expect(save, boom).not.toContain(RESOLVER);
    for (const field of ['inkDark', 'inkLight', 'mutedDark', 'mutedLight']) {
      expect(save, `${field} reached the save path — ${INK_BOOM}`).not.toContain(field);
    }
    expect(save, `a raw palette hex reached the save path — ${INK_BOOM}`).not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );

    // (c) and nothing rendered is ever pushed back into the form state
    expect(gs, boom).not.toMatch(new RegExp(`setBackgroundColor\\([^)]*${TINT}`));
    expect(gs, boom).not.toMatch(new RegExp(`setBackgroundColor\\([^)]*${RESOLVER}`));
  });

  it('2. the decision lives at the PRODUCTION site, with its rejected half named', () => {
    // A decision recorded only in a test file is invisible to the next person
    // editing the code it governs — that is how a deliberate choice gets
    // "restored" as an oversight two phases later (88.1-CODE-REVIEW.md).
    const src = raw(SEED);
    // RE-POINTED plan 88.3.1-07 (AMENDMENT I). The anchor WAS
    // `useState(\n    resolveGroupBackgroundColor(group.background_color)`; AMENDMENT E
    // rewrites exactly that line, so keeping the old anchor would be unsatisfiable, and
    // deleting this test is not on the table — it is the only guard that the marker
    // explaining WHY the seed is not a render transform still sits at the seed.
    const at = src.indexOf('useState(storedGroupColour(group)');
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
    // The accessor changed, so the marker had to be AMENDED rather than carried
    // forward — a marker whose stated mechanism no longer matches the line under it
    // is worse than no marker, because the next reader trusts it.
    expect(above, 'the seed marker was carried forward unamended past AMENDMENT E').toMatch(
      /AMENDED Phase 88\.3\.1/,
    );
    expect(above, 'the amended marker does not name the resolver as still-rejected').toMatch(
      /resolveGroupGround/,
    );
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
        expect(
          nullBranch,
          `${file}: unexpected no-colour branch '${m![1]}' — legal branches are ` +
            nullBranch.map((b) => `'${b}'`).join(' | '),
        ).toContain(m![1]);

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
    /*
     * RE-POINTED plan 88.3.1-08. Plan 07 left this at 3 while the population was
     * ALSO 3-and-falling; plan 08 moved grouplist, CalendarListView and
     * EventDayModal onto the resolver, so the measured population on this tree is
     * now exactly 3 — `CalendarMonthView.js`, `groupHomePage/page.js`, and
     * `resolveGroupGround`'s own internal legacy-hex arm in `lib/colorUtils.js`.
     *
     * DROPPED TO ITS FINAL VALUE, 1, ON PURPOSE. Plan 88.3.1-09 is CHARTERED to
     * move the two remaining render sites, at which point the tint survives only
     * as that one internal call — and 1 is precisely what test 1 needs in order
     * not to be vacuous, which is the entire job of this counter. Leaving the
     * floor at the current population would red plan 09 for doing what it was
     * planned to do, and a gate that fires on planned work gets weakened under
     * pressure rather than trusted.
     *
     * THE GATE IS NOT WEAKENED OVERALL: what must not shrink has MOVED to the two
     * counters below. As the tint count falls the resolver count and the ink count
     * must rise, or the render sites have quietly stopped resolving a ground or
     * stopped inking one.
     *
     * ARRIVED, plan 88.3.1-09 (2026-08-29). All six consumers have moved and the
     * measured population is now exactly **1** — `resolveGroupGround`'s own
     * internal legacy-hex arm in `lib/colorUtils.js`, and nothing else in `src/`.
     * The floor and the population agree for the first time since plan 07; this is
     * the FINAL value and there is no further planned movement, so a future drop
     * to 0 means the compatibility path itself was deleted and test 1 has gone
     * vacuous. All three numbers in this test are now final and deliberate.
     */
    expect(calls, 'the tint has stopped being called at all — test 1 would be vacuous')
      .toBeGreaterThanOrEqual(1);

    /**
     * Non-declaration call sites of `name` across the whole source tree, comments
     * blanked — the same counting rule the tint uses above, hoisted because plan 08
     * added a second and a third counter that must obey it identically.
     */
    const callsTo = (name: string): number => {
      let n = 0;
      for (const file of sourceFiles(SRC)) {
        const src = withoutComments(fs.readFileSync(file, 'utf8'));
        for (const m of src.matchAll(new RegExp(`${name}\\s*\\(`, 'g'))) {
          const before = src.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
          if (/function\s*$/.test(before)) continue;
          n += 1;
        }
      }
      return n;
    };

    /*
     * RE-POINTED plan 88.3.1-08: 2 -> 5. The two were `GroupSettings.js`'s preview
     * and its swatch map; plan 08 adds grouplist, CalendarListView and
     * EventDayModal, one call each.
     *
     * FINAL VALUE, plan 88.3.1-09 (2026-08-29): 5 -> **7**. SPEC Req 4's "six
     * consumers, one resolver" is now literally true, and 7 is what that counts on
     * this tree — `GroupSettings.js` is ONE consumer with TWO render sites (the
     * live preview and the swatch map), which is the harness's own per-call rule
     * rather than a per-file one. The seven, enumerated so a future drop names
     * itself: GroupSettings x2, grouplist, CalendarListView, EventDayModal,
     * CalendarMonthView (one shared gate feeding BOTH tile variants — a 2 here
     * would mean the hoist was undone), groupHomePage.
     */
    expect(callsTo(RESOLVER), 'a render site stopped going through THE resolver')
      .toBeGreaterThanOrEqual(7);

    /*
     * NEW plan 88.3.1-08. `groupInkVars` had ZERO production callers before this
     * plan — it was declared, unit-tested and unwired, which is exactly the state
     * a source scan should be able to tell apart from "wired". Three now: the three
     * CARD surfaces plan 08 migrated.
     *
     * FINAL VALUE, plan 88.3.1-09 (2026-08-29): 3 -> **6**. It is 6 and not 7
     * because `CalendarMonthView.js` calls the ink function TWICE — once per tile
     * variant — while sharing ONE resolver call, and `GroupSettings.js` calls it
     * not at all (its swatches carry no text at all, owner ruling R2-2, and its
     * preview label is a plain token; UI-SPEC 3.3). The asymmetry with the 7 above
     * is real and is recorded here so nobody "fixes" it into agreement.
     */
    expect(
      callsTo('groupInkVars'),
      'the ink function lost a production caller — a card is emitting a ground with no ink',
    ).toBeGreaterThanOrEqual(6);
  });

  it('6. the preset palette is untouched IN THE SHARED TABLE, and the swatches are named', () => {
    /*
     * RE-POINTED plan 88.3.1-07. The eight values this test used to pin lived in
     * `GroupSettings.js`; they are now `lib/groupColourPresets.ts`'s two-value rows.
     * DECISION 88-22 (D-27) is still CROSS-STACK — the id is persisted and validated
     * by the backend, and the grounds are fed to `getBrightness` and to WCAG maths —
     * so the assertion follows the data rather than being deleted with the array.
     */
    const table = raw(TABLE);
    expect(table, 'the shared table lost its Phase 88.3.1 decision marker').toMatch(
      /DECISION Phase 88\.3\.1/,
    );
    for (const [name, dark, light] of PRESET_GROUNDS) {
      expect(table, `preset ${name} lost its dark band`).toContain(`dark: '${dark}'`);
      expect(table, `preset ${name} lost its light surface`).toContain(`light: '${light}'`);
    }

    // The picker READS that table — it does not keep a copy. A second copy is how
    // the migration's tie-break order and the picker's reading order drift apart.
    const gs = code(SEED);
    expect(gs, 'the picker no longer reads the shared table').toContain('GROUP_COLOUR_PRESETS');
    expect(gs, 'a private palette array came back into the component').not.toMatch(
      /#[0-9a-fA-F]{3,8}\b/,
    );

    // D-27's marker stays at this site and its expired claim is superseded IN PLACE,
    // with the original kept — see the AMENDED block. A future reader who finds only
    // the original would believe the palette is still all-dark.
    const src = raw(SEED);
    expect(src).toMatch(/DECISION Phase 88-22 \(D-27/);
    expect(src, 'the D-27 header was carried forward unamended').toMatch(
      /AMENDED Phase 88\.3\.1/,
    );

    // owner ruling R2-2, as AMENDED by G2: aria-label + aria-pressed remain the
    // machine-readable half, and the visible one-word caption is the colour-vision
    // half. `aria-pressed` now compares against the preset ID, and D-06's toggle-off
    // is what makes it honest in both directions.
    expect(gs).toContain('aria-label={preset.label}');
    expect(gs).toMatch(/aria-pressed=\{isSelected\}/);
    expect(gs).toMatch(
      /const isSelected = backgroundColor === preset\.name && !backgroundImageUrl;/,
    );
  });

  it('7. text drawn on a tinted ground forks with it, and never inline', () => {
    // The defect: `isDarkBackground` was asked about the STORED hex, and every
    // shipped preset is dark, so the branch never flipped — near-white text with
    // a black shadow and stroke, painted onto a pale tint in light mode.
    /*
     * RE-CHECKED plan 88.3.1-08 and DELIBERATELY UNCHANGED. Plan 08 moved three of
     * these four files onto the resolver and gave two of them a new ink channel,
     * so every number here was re-counted against the tree rather than assumed:
     * grouplist 1, CalendarListView 3, EventDayModal 2 — all still at or above
     * their floors.
     *
     * WHY THE NEW INK DID NOT MOVE THEM. `--group-ink*` is a SEPARATE channel from
     * `--t-*` (plan 06 minted it precisely so the two could coexist — see the
     * REJECTED note on `groupInkVars`), and the two Req 8 sites carry it as
     * `dark:[color:var(--group-ink-muted,var(--t-color))]`, which does not contain
     * the literal `dark:[color:var(--t-color)]` this regex counts. That is correct:
     * `--t-*` is still the ground-derived FALLBACK on the legacy and
     * background-image arms, so these floors must keep guarding it. The new
     * channel gets its own positive assertion in test 27 rather than being folded
     * in here, because a counter that admits both shapes could no longer tell a
     * site that kept its fallback from one that dropped it.
     */
    const floors: Record<string, number> = {
      'app/components/grouplist.js': 1,
      // 1 -> 2 (plan 88.3-16): the COMPACT tile now forks its text colour too,
      // on the same wrapper that carries its ground fork.
      'app/components/CalendarMonthView.js': 2,
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

      // CR-02 (88.3-cr): the text treatment must be fed the TINT-GATED values.
      // `groupHomePage/page.js` gates both the ground and the text style on the
      // tint succeeding; these four files gated only the ground, so a stored
      // value that `resolveGroupBackgroundColor` passes but the tint rejects
      // dropped the card to the themed surface while the text was still
      // computed against the malformed string (`getBrightness` -> 255, i.e. the
      // light-ground pole on a DARK card). `tinted || <stored hex>` is the
      // greppable shape of that asymmetry — the LIGHT arm reaching past a
      // failed tint for the raw hex. It must not come back.
      expect(src, `${file}: a light arm falls back to the stored hex past a failed tint`)
        .not.toMatch(/tinted\s*\|\|/);

      // CR-01 (88.3-cr): a stroke value must be a LITERAL. `tileTextTreatment`'s
      // image branch assigned `groupBgImage` — a URL — to `WebkitTextStroke`.
      // Inline that was merely dropped, but once the helper was hoisted the
      // value rode `--t-stroke` into `[-webkit-text-stroke:var(--t-stroke)]`,
      // where it is invalid at computed-value time and resets the property to
      // `none`. A custom property will carry ANY token, so nothing upstream
      // rejects it; this assertion is the only thing that would.
      // `[^,\n]` would cut an `rgba(0, 0, 0, 0.9)` literal in half — take the line.
      for (const m of src.matchAll(/WebkitTextStroke\s*:\s*(.+)$/gm)) {
        expect(m[1], `${file}: WebkitTextStroke assigned an image/url value`).not.toMatch(
          /Image|url\(/i,
        );
        expect(m[1], `${file}: WebkitTextStroke is not a string literal`).toMatch(/'[^']*'/);
      }
    }
  });

  it('8. EVERY tint-forked clickable div is keyboard-operable (R3-C)', () => {
    // Both were `<div onClick>` with no keyboard path, while the IDENTICAL
    // interaction one file over (CalendarListView's EventRow) has been
    // reachable all along. Located by the element that carries the ground fork,
    // not by a line number this plan's own edits already moved.
    //
    // AMENDED plan 88.3-16: this used to anchor with `.find()` on the FIRST
    // tint-carrying className in each file, and that is precisely how the
    // compact month tile went a whole phase with no keyboard path and no tint
    // while this test stayed green — the full tile answered for both. It now
    // loops EVERY tint-forked className, and the per-file FLOOR below is the
    // thing that would have caught the miss: `CalendarMonthView.js` renders TWO
    // tiles, and a refactor that drops one must red rather than pass on the
    // survivor.
    //
    // AMENDED 88.3 code-adversarial-review run 3 (H1, owner ruling (a), 2026-08-28):
    // `EventDayModal.js`'s tinted card CONTAINS a native "Share Game QR" <button>, so
    // the keyboard semantics must NOT sit on the tint-carrying div — with them there,
    // Enter on the nested button bubbled, was preventDefault()ed and navigated instead
    // of opening the QR, and `role="button"` (children-presentational) hid the button
    // from AT. For that file the keyboard target is an INNER title block, and this
    // test asserts the OPPOSITE on the card: it must NOT carry role/onKeyDown (so the
    // hijack shape cannot come back), while the inner target must carry the full set.
    // Behaviour is pinned by EventDayModal.test.tsx; this is the source-shape pin.
    const floors: Record<string, number> = {
      'app/components/CalendarMonthView.js': 2,
      'app/components/EventDayModal.js': 1,
    };
    const KEYBOARD_TARGET_INSIDE = new Set(['app/components/EventDayModal.js']);
    for (const [file, floor] of Object.entries(floors)) {
      const src = code(file);
      const exprs = attrExprs(src, 'className').filter((e) => e.text.includes(LIGHT_GROUND));
      expect(
        exprs.length,
        `${file}: fewer tint-forked elements than this file renders — one of its tiles lost ` +
          'its group ground, which is exactly the regression this floor exists to catch',
      ).toBeGreaterThanOrEqual(floor);

      for (const expr of exprs) {
        const tagStart = src.lastIndexOf('<div', expr.start);
        const tag = src.slice(tagStart, expr.end + 1);
        const at = `${file}:${lineAt(src, expr.start)}`;

        if (KEYBOARD_TARGET_INSIDE.has(file)) {
          expect(tag, `${at}: H1 — the card wraps a native button; role="button" must NOT return to it`).not.toContain('role="button"');
          expect(tag, `${at}: H1 — the card wraps a native button; onKeyDown must NOT return to it`).not.toContain('onKeyDown');
          expect(tag, `${at}: the card keeps its pointer onClick`).toContain('onClick=');
          // The inner keyboard target: one element carrying the whole set, named by the row label.
          // Anchored on the accessible name, not on "the next <div" — the next div is the
          // background wash overlay, and a line-order anchor would silently test that.
          const inner = src.slice(expr.end);
          const nameAt = inner.indexOf('role="button"');
          expect(nameAt, `${at}: no element after the card carries role="button" — the inner keyboard target is gone`).toBeGreaterThan(-1);
          const innerOpen = inner.lastIndexOf('<div', nameAt);
          // The tag's own `>` is the first one AFTER its className attribute — the handler
          // in between contains `=>`, which a naive first-`>` search would stop on.
          const classAt = inner.indexOf('className="', nameAt);
          expect(classAt, `${at}: the inner keyboard target has no className (it needs the focus ring)`).toBeGreaterThan(-1);
          const classEnd = inner.indexOf('"', classAt + 'className="'.length);
          const innerTag = inner.slice(innerOpen, inner.indexOf('>', classEnd) + 1);
          for (const need of ['role="button"', 'tabIndex={0}', 'onKeyDown', 'focus-visible:ring-focus-ring']) {
            expect(innerTag, `${at}: the INNER keyboard target (title block) lost ${need}`).toContain(need);
          }
          // Run-4 H1 (2026-08-28): NO aria-label on the title block — it would replace the
          // content-computed name and silence the start time rendered in the <p>.
          expect(innerTag, `${at}: the inner keyboard target must NOT carry aria-label (it silences the time)`).not.toContain('aria-label=');
          expect(innerTag, `${at}: the inner handler must fire on Enter and Space`).toMatch(/'Enter'[\s\S]*' '/);
          expect(innerTag, `${at}: the inner handler must stopPropagation so the card onClick does not double-fire`).toContain('stopPropagation');
          continue;
        }

        expect(tag, `${at}: the clickable div lost role="button"`).toContain('role="button"');
        expect(tag, `${at}: the clickable div lost tabIndex`).toContain('tabIndex={0}');
        expect(tag, `${at}: the clickable div lost its keyboard handler`).toContain('onKeyDown');
        expect(tag, `${at}: the keyboard handler must fire on Enter and Space`).toMatch(
          /'Enter'[\s\S]*' '/,
        );
        expect(tag, `${at}: the clickable div lost its accessible name`).toContain('aria-label=');
        expect(tag, `${at}: the clickable div lost its focus ring`).toContain(
          'focus-visible:ring-focus-ring',
        );
      }
    }
  });

  it('9. both custom properties are gated on the TINT, never on the stored hex', () => {
    // T-88.3-43. A stored value that fails to tint must withhold BOTH grounds
    // together; gating on the resolver result alone would emit `--group-ground`
    // with no `--group-ground-light`, and light mode would then fall through to
    // whatever the ternary's null branch is while the dark arm still painted.
    const floors: Record<string, number> = {
      // EMPTY as of plan 88.3.1-09, and that is the ARRIVAL rather than a hole.
      // `CalendarMonthView.js` was the last hand-written gate; its entry read
      // "DELIBERATELY STILL 1 after plan 88.3-16 … both tiles read one
      // `const ground = tinted ? groupBgColor : null` gate", and that gate is now
      // a property of `resolveGroupGround`'s return type instead. The file moved
      // to RESOLVED below, where BOTH halves are asserted — it calls the resolver
      // AND has no hand gate beside it — so coverage went UP, not down. The loop
      // below this map is now the whole anti-vacuity half; it scans six files
      // where it scanned four, which is exactly the trade the note below
      // predicted. Do NOT re-add an entry here to "make the map non-empty": that
      // would require a caller to un-do the resolver.
      // RE-POINTED plan 88.3.1-07: `GroupSettings.js` used to be `2` here and is
      // asserted separately below. Its two hand-written gates did not go MISSING —
      // they moved INSIDE `resolveGroupGround`, which returns an object carrying
      // both grounds or `null` and never half a pair. T-88.3-43 stopped being a
      // gate each caller writes and became a property of the return type, so
      // requiring the old shape here would pressure a future reader to un-do the
      // resolver. Plans 88.3.1-08 and 88.3.1-09 move the four files above the same
      // way, and each one drops out of this map as it lands.
      //
      // RE-POINTED plan 88.3.1-08: `grouplist.js`, `CalendarListView.js` and
      // `EventDayModal.js` landed and have moved to RESOLVED below. Only
      // `CalendarMonthView.js` still writes the hand gate; plan 88.3.1-09 empties
      // this map, at which point the loop scans nothing and the RESOLVED block is
      // the whole gate. That is FINE and is not a hole — the loop below is the
      // anti-vacuity half, and it grows by exactly one file each time this one
      // shrinks by one.
    };
    for (const [file, floor] of Object.entries(floors)) {
      const src = code(file);
      const gates = (
        src.match(/\b\w*[Gg]round\w*\s*=\s*\w*[Tt]inted\w*\s*\?\s*[\w.?]+\s*:\s*null\b/g) ?? []
      ).length;
      expect(gates, `${file}: a ground is not gated on its tint succeeding`).toBeGreaterThanOrEqual(
        floor,
      );
    }

    /*
     * The RESOLVED files: every site whose T-88.3-43 gate has become a property of
     * `resolveGroupGround`'s return type. Two halves per file, and the second is
     * the load-bearing one — without it a file could "pass" by calling the resolver
     * AND keeping a hand-written half-pair gate beside it, which is the drift this
     * whole test exists to stop.
     *
     * `calls` is the per-file floor, not a total: the SEED has two render sites
     * (preview + swatch map), the three plan-08 cards have one each.
     *
     * COMPLETED plan 88.3.1-09: `CalendarMonthView.js` and `groupHomePage/page.js`
     * join, and the list is now all six consumers. `CalendarMonthView.js` stays at
     * **1**, deliberately — its two tile variants share ONE resolver call, which is
     * the same hoist its old `floors` entry protected. A 2 there would mean a
     * second, independently-drifting ground had been introduced, so the floor is
     * doing the identical job on the other side of the migration.
     */
    const RESOLVED: { file: string; calls: number }[] = [
      { file: SEED, calls: 2 },
      { file: 'app/components/grouplist.js', calls: 1 },
      { file: 'app/components/CalendarListView.js', calls: 1 },
      { file: 'app/components/EventDayModal.js', calls: 1 },
      { file: 'app/components/CalendarMonthView.js', calls: 1 },
      { file: HEADER, calls: 1 },
    ];
    for (const { file, calls } of RESOLVED) {
      const src = code(file);
      expect(
        (src.match(new RegExp(`${RESOLVER}\\(`, 'g')) ?? []).length,
        `${file}: a render site stopped going through the resolver, so its two grounds ` +
          'can drift apart again',
      ).toBeGreaterThanOrEqual(calls);
      expect(
        src,
        `${file}: a hand-written \`ground = tinted ? … : null\` gate came back beside the resolver`,
      ).not.toMatch(/\b\w*[Gg]round\w*\s*=\s*\w*[Tt]inted\w*\s*\?/);
    }

    // and the pair is always emitted together — EVERY file, the seed included
    for (const file of [...Object.keys(floors), ...RESOLVED.map((r) => r.file)]) {
      for (const expr of attrExprs(code(file), 'style').filter((e) =>
        e.text.includes(LIGHT_GROUND),
      )) {
        expect(expr.text, `${file}: --group-ground-light emitted without its dark twin`).toContain(
          "'--group-ground':",
        );
      }
    }

    /*
     * T-88.3-43 EXTENDED TO THE INK PAIR — new, plan 88.3.1-08.
     *
     * The grounds and the ink are ONE rendering: a card that emits `--group-ground*`
     * with no ink paints Req 8's ground-blind theme colour on a coloured card, and a
     * card that emits ink with no ground paints a preset's ink on the themed surface
     * it was never solved against. Neither is visible to any assertion above,
     * because both halves are individually well-formed.
     *
     * This is asserted on the STYLE EXPRESSION, not on the file, and that is the
     * whole point: co-location in one object literal is what makes the invariant
     * mechanical instead of conventional. It is also why `groupInkVars` is spread
     * beside the grounds rather than at the text element that consumes it — see the
     * DECISION markers at all three sites.
     *
     * DEMONSTRATED RED plan 88.3.1-08: emitting the ink spread with the two ground
     * properties deleted from the same object fails the first branch; deleting the
     * ink spread while keeping the grounds fails the second.
     *
     * COMPLETED plan 88.3.1-09: `CalendarMonthView.js` (tile ink, TWO style
     * expressions — one per variant, both of which must satisfy both branches) and
     * `groupHomePage/page.js` (card ink) join. All five ground-emitting files are
     * now covered; `GroupSettings.js` is absent because its swatches carry no text
     * and its preview label is a plain token, so it emits grounds with no ink BY
     * DESIGN (UI-SPEC 3.3) — adding it would red correctly-shipped code.
     */
    const INK_SITES = [
      'app/components/grouplist.js',
      'app/components/CalendarListView.js',
      'app/components/EventDayModal.js',
      'app/components/CalendarMonthView.js',
      HEADER,
    ] as const;
    for (const file of INK_SITES) {
      const exprs = attrExprs(code(file), 'style');

      const withInk = exprs.filter((e) => e.text.includes('groupInkVars('));
      expect(
        withInk.length,
        `${file}: no style expression emits the group ink — this file's card is back on ` +
          'a ground-blind theme token',
      ).toBeGreaterThanOrEqual(1);
      for (const expr of withInk) {
        expect(
          expr.text,
          `${file}: the ink pair is emitted without \`--group-ground\` in the same object`,
        ).toContain("'--group-ground':");
        expect(
          expr.text,
          `${file}: the ink pair is emitted without \`--group-ground-light\` in the same object`,
        ).toContain("'--group-ground-light':");
      }

      for (const expr of exprs.filter((e) => e.text.includes(LIGHT_GROUND))) {
        expect(
          expr.text,
          `${file}: a ground pair is emitted with no \`groupInkVars\` beside it — the card ` +
            'renders coloured while its text keeps a pole chosen by "has a colour" (SPEC Req 8)',
        ).toContain('groupInkVars(');
      }
    }

    /*
     * And the ink function is asked for a SURFACE and an IMAGE FLAG at every call.
     * `hasBackgroundImage` is only compile-enforced for `.ts` callers (`checkJs` is
     * off) and all three of these are `.js`, where omitting it degrades silently to
     * `false` — the UNSAFE direction, painting a preset's tinted ink over a user's
     * photograph. Plan 06 AMENDMENT 7 made returning `{}` the protection; this is
     * what makes the callers actually reach it.
     */
    for (const file of INK_SITES) {
      const src = code(file);
      for (const m of src.matchAll(/groupInkVars\(/g)) {
        const call = src.slice(m.index ?? 0, braceEnd(src, src.indexOf('{', m.index ?? 0)) + 1);
        expect(call, `${file}: a groupInkVars call names no surface`).toMatch(/surface\s*:/);

        const flag = call.match(/hasBackgroundImage\s*:\s*([A-Za-z_$][\w$]*)/);
        expect(
          flag,
          `${file}: a groupInkVars call omits hasBackgroundImage (or inlines an expression ` +
            'this scan cannot trace). Omitted, it defaults to false — the UNSAFE direction, ' +
            "painting a preset's tinted ink over a user's photograph.",
        ).not.toBeNull();

        /*
         * …and the flag it names must be the VALIDATED one. The chain asserted is
         * `hasBackgroundImage: F` -> `const F = !!X` -> `const X = safeBgImageStyle(…)`,
         * which is name-agnostic: it follows the derivation rather than pinning an
         * identifier, so a rename cannot quietly turn this green while a raw URL
         * string is being passed. `safeBgImageStyle` drops relative/invalid URLs
         * (FSEC-03, wave-12 owner ruling at grouplist.js), so a rejected URL paints
         * no image at all — that card IS a plain coloured card and must get its ink.
         */
        const derived = src.match(new RegExp(`const\\s+${flag![1]}\\s*=\\s*!!\\s*([\\w$]+)`));
        expect(
          derived,
          `${file}: \`${flag![1]}\` is not derived as \`!!<style>\` — trace it, or it may be ` +
            'the raw background_image_url string',
        ).not.toBeNull();
        expect(
          src,
          `${file}: \`${derived![1]}\` does not come from safeBgImageStyle — the image flag ` +
            'must be the VALIDATED style, never the raw URL (FSEC-03)',
        ).toMatch(new RegExp(`const\\s+${derived![1]}\\s*=\\s*safeBgImageStyle\\(`));
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

  it('11. repo-wide: no save payload is ever built from a RENDERED value', () => {
    // The narrow version of test 1, widened past GroupSettings.js so a future
    // surface that learns to write either colour column inherits the control.
    //
    // WIDENED plan 88.3.1-07 in two directions: to the NEW column (`color_preset:`,
    // which is now the authoritative one) and to the resolver and the ink fields
    // (UI-SPEC 4.1 — the inks resolve on the frontend from the id and must never be
    // sent). Both are the same defect class as the tint: a rendered value written to
    // the column that carries the group's identity, unrecoverably.
    const FORBIDDEN = [TINT, RESOLVER, 'inkDark', 'inkLight', 'mutedDark', 'mutedLight'];
    for (const file of sourceFiles(SRC)) {
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const column of ['background_color', 'color_preset']) {
        for (const rendered of FORBIDDEN) {
          expect(
            src,
            `${path.relative(SRC, file)}: a ${column} payload is being built from ` +
              `${rendered}. ${INK_BOOM}`,
          ).not.toMatch(new RegExp(`${column}:\\s*[^,\\n]*${rendered}`));
        }
      }
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
    /*
     * RE-POINTED plan 88.3.1-09, TINT -> RESOLVER. This line used to assert that the
     * header called `lightTintGroupBackgroundColor` directly. It no longer does, and
     * that is the migration rather than a regression: the tint moved INSIDE
     * `resolveGroupGround`, which is now the single place that answers "what ground
     * does this stored value paint" for all six consumers (SPEC Req 4). The property
     * this line has always been protecting — the header derives its ground from the
     * stored value through the shared path, never from a hardcoded or theme value —
     * is unchanged, and test 5's counter is what stops the resolver itself from
     * quietly losing this caller. NOT weakened: `TINT` is still asserted by test 5
     * (the compatibility path must keep exactly one live call) and the header's own
     * ground is now additionally covered by test 9's RESOLVED half, which also
     * forbids a hand-written half-pair gate beside the call.
     */
    expect(src, 'the header ground no longer comes from THE resolver').toContain(RESOLVER);
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

  it('20. BOTH month tiles carry the ground fork, and only the tinted one carries the tint colour', () => {
    const file = 'app/components/CalendarMonthView.js';
    const src = code(file);

    // Keyed on the variant split still existing: a future refactor that collapses
    // the two tiles into one must red here rather than silently drop a rendering.
    expect(src, `${file}: the compact/full variant split is gone`).toContain(
      "variant === 'compact'",
    );

    const forked = attrExprs(src, 'className').filter((e) => e.text.includes(LIGHT_GROUND));
    expect(forked.length, `${file}: expected BOTH tiles to carry the ground fork`).toBe(2);

    // (a) THE TEXT-COLOUR FORK MOVES IN LOCKSTEP WITH THE BACKGROUND FORK.
    // The compact tile's null branch is its shipped `text-content-accent`
    // (amber-800). `getEventTileTextColor` resolves an uncoloured group to
    // warm-900, so carrying the tint colour unconditionally — the way the full
    // tile can, because its null branch is empty (D-28) — would silently
    // recolour the UNCOLOURED tile's title. That is a visual change on a surface
    // the owner has not been asked about.
    const compact = forked.find((e) => e.text.includes('bg-surface-card-hover'));
    expect(compact, `${file}: the compact tile's ground fork was not found`).toBeDefined();
    const nullArm = compact!.text.match(/\?\s*'\[color:var\(--t-color-l\)\][^']*'\s*:\s*'([^']*)'/);
    expect(
      nullArm,
      `${file}: the compact tile's TEXT colour is not forked on the same ternary shape as its ground`,
    ).not.toBeNull();
    expect(nullArm![1], `${file}: the uncoloured compact tile lost text-content-accent`).toContain(
      'text-content-accent',
    );
    expect(
      nullArm![1],
      `${file}: the uncoloured compact tile took the TINT colour — it must not`,
    ).not.toContain('[color:var(--t-color');

    // (b) NO BARE `[color:` UTILITY OUTSIDE THE COLOUR TERNARY on either tile.
    // Two equal-specificity `color` declarations in one className stack and the
    // later-emitted one silently wins — the same cascade trap the ground fork
    // exists to avoid.
    for (const expr of forked) {
      const stripped = expr.text
        .replace(/\?\s*'\[color:var\(--t-color-l\)\][^']*'\s*:\s*'[^']*'/g, '')
        .replace(/\[color:var\(--t-color-l\)\]\s*dark:\[color:var\(--t-color\)\]/g, '');
      expect(
        stripped,
        `${file}: a bare [color:…] utility sits outside the colour ternary and will stack`,
      ).not.toMatch(/\[color:/);
    }

    // (c) THE COMPACT TILE'S ACCESSIBLE NAME CARRIES ITS RSVP COUNTS. On a
    // `role="button"` element `aria-label` REPLACES the subtree name, so copying
    // the full tile's `aria-label={tileLabel}` would silence the RsvpCount child
    // ("3Y 1M 2N") — the one thing this variant renders and the full tile does
    // not — for every screen-reader user on the group page.
    const tagStart = src.lastIndexOf('<div', compact!.start);
    const compactTag = src.slice(tagStart, compact!.end + 1);
    expect(
      compactTag,
      `${file}: the compact tile's aria-label no longer references the RSVP summary`,
    ).toMatch(/aria-label=\{[^}]*rsvpLabel/);
    expect(src, `${file}: the RSVP label expression is gone`).toMatch(/const rsvpLabel\s*=/);
    /*
     * …and the tooltip stays the SHORT form.
     *
     * RE-POINTED plan 88.3.1-09, from `src.slice(compact.end, +500)` to the tile's
     * WHOLE opening tag via `openTags`. The 500-character window was a heuristic that
     * measured the wrong thing: `withoutComments` blanks comments to spaces but
     * PRESERVES their length, so adding a DECISION marker inside the tile's `style`
     * object pushed `title=` past the window and reddened this assertion while the
     * attribute was still present and correct. A gate that fires on documentation is
     * a gate that gets deleted. `openTags` walks attributes with the same
     * `literalEnd` / `braceEnd` pair the rest of this file uses, so it reads the
     * exact tag rather than a guess at its length — STRICTER than the window, because
     * the attribute must now be on THIS tag rather than merely nearby.
     */
    const compactOpen = openTags(src).find(
      (t) => t.attrs.includes('bg-surface-card-hover') && t.attrs.includes(LIGHT_GROUND),
    );
    expect(compactOpen, `${file}: the compact tile's opening tag was not found`).toBeDefined();
    expect(
      compactOpen!.attrs,
      `${file}: the compact tile lost title={tileLabel} — the visual tooltip stays the short form`,
    ).toContain('title={tileLabel}');

    /*
     * (a2) BOTH TILES EMIT TILE-SURFACE INK — new, plan 88.3.1-09.
     *
     * SPEC Req 4 / UI-SPEC 3.4: card-vs-tile is ONE ARGUMENT to one function, never a
     * second implementation. Asserting `surface: 'tile'` HERE, on the two tiles, is
     * what makes the split real: the generic "exactly one implementation" scan (test
     * 29) proves no second copy exists, and this proves the surviving one is actually
     * being asked for the tile family at the two tile sites. Without it a refactor
     * could hand these tiles `surface: 'card'` — the preset's chromatic 8.00-8.08:1
     * ink at `text-xs` in a ~49px cell — and every other gate in this file would stay
     * green, because that is a legal call.
     *
     * PLAIN, not tinted, is an OWNER RULING: "when it's small like that, you need the
     * text to be more distinct" (UI-SPEC 3.3). Changing it is a decision, not a
     * cleanup.
     */
    const inkCalls = [...src.matchAll(/groupInkVars\(/g)];
    expect(
      inkCalls.length,
      `${file}: expected BOTH tile variants to call the ONE ink function`,
    ).toBe(2);
    for (const m of inkCalls) {
      const call = src.slice(m.index ?? 0, braceEnd(src, src.indexOf('{', m.index ?? 0)) + 1);
      expect(
        call,
        `${file}: a month tile asks for a surface other than 'tile' — it would take the ` +
          "card's chromatic ink at text-xs, against the owner's ruling (UI-SPEC 3.3)",
      ).toMatch(/surface\s*:\s*'tile'/);
    }

    /*
     * (a3) …AND THE TILE'S `color` STILL COMES FROM `--t-color*`, NOT `--group-ink*`.
     *
     * This looks like unfinished wiring and is not, so it is pinned rather than left
     * to be "tidied". `groupInkVars`'s tile muted rungs are THEME-keyed constants
     * (`SUBTEXT_MUTED_ON_DARK` on the `dark:` arm, always). A past-date tile that
     * consumed them would ask for 70%-white in dark mode on a legacy LIGHT stored hex
     * — the ~1.1:1 defect SPEC Req 8 exists to close and that test 28 below asserts
     * is closed. The past-date pole must be chosen PER ARM from the ground actually
     * painted in that arm, which only JS can do; UI-SPEC 3.5 therefore locates this
     * site's Req 8 fix at `tileTextVars` in the component, not in the ink function.
     */
    for (const expr of forked) {
      expect(
        expr.text,
        `${file}: a month tile started consuming --group-ink* for its text colour — that ` +
          'silently re-opens Req 8 on past dates (see UI-SPEC 3.5)',
      ).not.toContain('--group-ink');
    }

    // (d) NO RAW `url()`. Hoisting put the API-controlled `groupBgImage` in scope
    // for a tile that must not paint it. Every background image in this file goes
    // through the D-06 protocol allowlist (`safeBgImageStyle`), which
    // `src/lib/safeBgImageStyle.test.ts` pins — a raw `url()` would re-open it.
    expect(src, `${file}: a raw url() appeared — it must go through safeBgImageStyle`).not.toMatch(
      /url\(/,
    );
    for (const m of src.matchAll(/backgroundImage/g)) {
      const around = src.slice(Math.max(0, (m.index ?? 0) - 200), (m.index ?? 0) + 200);
      expect(
        around,
        `${file}: a backgroundImage is set outside a safeBgImageStyle() call`,
      ).toContain('safeBgImageStyle(');
    }
  });

  it('21. the compact tile\'s RSVP text clears 4.5:1 on every pinned tint once tinted', () => {
    // T-88.3-79. These three colours are hard-coded in `RsvpCount.js` and pass
    // 4.5:1 only against the compact tile's SHIPPED `bg-surface-card-hover`
    // ground. Once the tile takes `--group-ground-light` they fail on the
    // majority of preset/status pairings, so plan 16 forks them onto the tile's
    // own tint pole via a defaulted `inheritColor` prop. This pins BOTH halves:
    // the wiring, and the number that made it necessary.
    const rsvp = code('app/components/RsvpCount.js');
    expect(rsvp, 'RsvpCount lost its inheritColor opt-in').toMatch(/inheritColor\s*=\s*false/);
    expect(
      rsvp,
      'the compact spans no longer drop their status class when inheritColor is set',
    ).toMatch(/inheritColor \? undefined : token/);
    // the UNTINTED default is byte-unchanged: all three status tokens still here
    for (const token of [
      'text-content-status-success',
      'text-content-status-warning',
      'text-content-status-error',
    ]) {
      expect(rsvp, `the untinted compact tile lost ${token}`).toContain(token);
    }
    // the other call site passes no prop, so it renders exactly as before
    const list = code('app/components/CalendarListView.js');
    expect(list, 'CalendarListView started passing inheritColor — it must not').not.toContain(
      'inheritColor',
    );

    // …and the compact tile passes it keyed on the SAME `tinted` value that
    // gates the title fork, never on a second computation.
    expect(code('app/components/CalendarMonthView.js')).toMatch(/inheritColor=\{!!tinted\}/);

    /*
     * RE-PINNED plan 88.3.1-09: from the eight **t = 0.70 derived tints** to the eight
     * **stored LIGHT SURFACES**.
     *
     * WHY, and it is not a cosmetic swap. This tile's light-mode ground is no longer
     * computed by mixing a near-black preset toward white — Phase 88.3.1 replaced that
     * whole model (withdrawn ruling 4a; the eight old tints measured ΔE2000 **1.62**
     * apart, sub-JND, which is the UAT finding that created this phase). A group now
     * stores a preset id and the FE resolves it to a hand-tuned light surface. Leaving
     * the old hexes here would have kept measuring a ground that nothing paints any
     * more: the assertion would stay green while the shipped pixels went unmeasured,
     * which is the worst failure mode a contrast gate has.
     *
     * The FLOOR is deliberately unchanged at 4.5 and the actual is deliberately NOT
     * asserted — that is `groupColourPresets.test.ts`'s job (UI-SPEC 10.1 tests 8-10),
     * and duplicating a number here would give two places to update and one to forget.
     * Measured on the new surfaces: **6.44-6.50:1**, comfortably up from the 4.5-5.7
     * band the tints gave.
     *
     * The pole is UNCHANGED: `getEventTileTextColor(light surface)` still resolves to
     * `TILE_TEXT_LIGHT_BG`, because every light surface is W3C-brighter than 128
     * (measured 211-227; `groupColourPresets.test.ts` test 11 pins the tier per
     * preset). `#1e40af` being BLUE rather than near-black is a deliberate shipped
     * decision (`colorUtils.js:69-71`, "Intentionally different from
     * getContrastColor"), flagged to the owner as one line at the Req 10 check and
     * NOT changed by this plan. If he picks near-black, this test still passes and the
     * literal below moves with the pole.
     */
    const TILE_POLE = '#1e40af';
    const LIGHT_SURFACES: Record<string, string> = {
      red: '#ffd3d4',
      orange: '#ffd6b1',
      amber: '#e7e0aa',
      green: '#bde9c2',
      teal: '#94edf0',
      blue: '#c4e1ff',
      violet: '#dfd9ff',
      rose: '#fdd1f8',
    };
    // ANTI-VACUITY: eight surfaces, and each must be the hex the shipped table holds.
    // A rename or a re-sort of the palette reds here rather than silently shrinking
    // the population this loop measures.
    expect(Object.keys(LIGHT_SURFACES)).toHaveLength(8);
    for (const [name, hex] of Object.entries(LIGHT_SURFACES)) {
      expect(
        GROUP_COLOUR_PRESETS.find((p) => p.name === name)?.light,
        `the shipped '${name}' light surface no longer matches this test's fixture`,
      ).toBe(hex);
    }
    for (const [name, surface] of Object.entries(LIGHT_SURFACES)) {
      const ratio = contrastRatio(TILE_POLE, surface)!;
      expect(
        Number(ratio.toFixed(2)),
        `compact RSVP text on the ${name} light surface measures ${ratio.toFixed(2)}:1 — ` +
          'needs >= 4.5 (the hard-coded status colours it replaces measured 3.55-4.56 on the ' +
          'superseded tints and FAILED)',
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('22. EVERY focusable in the group-page render tree carries a project focus ring (DEF-88.3-13-04, owner ruling A)', () => {
    // The primitive exemption, PAID FOR rather than asserted. Each exempted tag is
    // COUNTED toward its file's floor (so the exemption cannot be used to shrink the
    // population) and then skipped, on the strength of the primitive's own base class
    // being checked here. Requiring a redundant `focus-visible:ring-*` at every call
    // site instead would be duplicated styling that drifts out of step with the
    // primitive. Adding a name to RING_BEARING_PRIMITIVES removes real coverage and must
    // be paid for by an entry here — that is the deal, and it is a decision, not a hole.
    for (const [tag, rel] of Object.entries(PRIMITIVE_RING_SOURCE)) {
      expect(
        code(rel),
        `<${tag}> is exempted at its call sites only because ${rel} carries the ring in its own base class`,
      ).toContain('focus-visible:ring-');
    }
    expect(
      Object.keys(PRIMITIVE_RING_SOURCE).sort(),
      'every exempted primitive must name where its ring comes from',
    ).toEqual([...RING_BEARING_PRIMITIVES].sort());

    const offenders: string[] = [];
    let scanned = 0;
    for (const { file, floor } of RING_SCAN_FILES) {
      const src = code(file);
      let found = 0;
      for (const { line, tag, attrs } of openTags(src)) {
        const isAnchor = tag === 'a' && /\bhref\s*=/.test(attrs);
        const isFocusable =
          tag === 'button' ||
          tag === 'Link' ||
          isAnchor ||
          RING_BEARING_PRIMITIVES.has(tag) ||
          /\btabIndex=\{0\}/.test(attrs);
        if (!isFocusable) continue;
        found += 1;
        if (RING_BEARING_PRIMITIVES.has(tag)) continue;
        if (!attrs.includes('focus-visible:ring-')) {
          offenders.push(`${file}:${line} <${tag}> has no focus-visible:ring-* class`);
        }
      }
      scanned += found;
      // Anti-vacuity, per file: counted 2026-08-27 on the shipped tree.
      expect(
        found,
        `${file} should expose at least ${floor} focusables — a lower count means the population moved out of this file and the scan above is passing on a shrunken set`,
      ).toBeGreaterThanOrEqual(floor);
    }
    // A browser-default outline is what a MISSING ring paints, and no contrast probe
    // reads that as a failure — which is why this finding survived every gate until a
    // human tabbed the page. This is the positive statement that was missing.
    expect(offenders).toEqual([]);
    // Total anti-vacuity floor: 23 focusables across the five files, counted 2026-08-27
    // (page.js 7, EventCalendar 1, CalendarMonthView 5, CalendarListView 2,
    // GroupGamesList 8 — primitives included).
    expect(scanned, 'the five-file scan must see a real population').toBeGreaterThanOrEqual(23);
  });

  it('23. no clickable bare <div> in the month view is unfocusable, except the day cell owner ruling B accepted', () => {
    const src = code('app/components/CalendarMonthView.js');
    const offenders: string[] = [];
    let allowListed = 0;
    for (const { line, tag, attrs } of openTags(src)) {
      if (tag !== 'div') continue;
      if (!/\bonClick\s*=/.test(attrs)) continue;
      // ALLOW-LISTED BY NAME: the day CELL, identified by the one handler only it calls.
      // Owner ruling B, 2026-08-27: "accept as is" for Phase 88.3 — after plans 16/17 a
      // keyboard user can open an EVENT tile from the month grid but never the DAY modal
      // (which hosts the Share-game-QR button) nor create an event from an empty day.
      // Recorded as accepted-for-now and OWNED BY PHASE 88.6 (DEF-88.3-R1-01, receiving
      // entry `.planning/deferred/phase-88.6.md`, "[a11y] Calendar day CELL has no
      // keyboard path"). Plan 88.3-16 adding no keyboard path to it is deliberate, not a
      // miss. An allow-listed exception with the ruling cited beside it is DISCLOSED; an
      // un-scanned element is a hole. Removing the ruling without removing this entry
      // would leave the gate lying — the entry is the disclosure.
      if (attrs.includes('onDayClick(date, dayEvents)')) {
        allowListed += 1;
        continue;
      }
      if (!/\brole\s*=/.test(attrs) || !/\btabIndex\s*=/.test(attrs)) {
        offenders.push(`CalendarMonthView.js:${line} clickable <div> with no role/tabIndex`);
      }
    }
    expect(offenders).toEqual([]);
    // Vacuity: the allow-listed cell must still BE there. If the day cell is ever given a
    // keyboard path (88.6's job), this reds and the exception gets deleted with its
    // deferred entry — which is the point.
    expect(
      allowListed,
      'the owner-ruling-B day cell must still be present and still be the pointer-only shape this exception describes',
    ).toBe(1);
  });

  it('24. the day-modal row\'s Duration line forks its ink on the tint (88.3 UI-REVIEW fix 1)', () => {
    /*
     * RE-PINNED plan 88.3.1-08, and the ORIGINAL REASON IS UNCHANGED, which is why
     * this test is re-pointed rather than deleted: `text-content-muted` (warm-600)
     * reads 3.4-3.6:1 on the light tints — an AA miss the 2026-08-28 UI audit found
     * — so this line must never sit on a ground-blind theme token on the tinted arm.
     *
     * What changed is the REMEDY. The 88.3 fix forked to `text-content-primary`,
     * which was correct only while every shipped preset was dark. Plan 08 moves the
     * line onto the CARD ink's 85% muted rung, which is stored per preset per theme
     * and selected by the same `dark:` fork that selects the ground — so the pole is
     * a function of the rendered ground by construction (SPEC Req 8, UI-SPEC 3.5).
     * Measured 5.52-6.28:1; that is a REDUCTION from ~9.3:1, taken deliberately for
     * the tinted ink, and still over the 4.5:1 floor.
     *
     * STILL AN EXACT-LITERAL ASSERTION, on purpose. That strictness is why the 88.3
     * shape could not slip away unnoticed, and it is why the `var(…, …)` fallback
     * cannot be quietly dropped either: without it, `--group-ink-muted*` is
     * undefined on the legacy / custom-hex and background-image arms, the
     * declaration is invalid at computed-value time, and `color` inherits the
     * page's ground-blind theme colour — re-opening the exact defect on the arm that
     * is live until BE PR-2's remap runs.
     */
    const src = code('app/components/EventDayModal.js');
    const at = src.indexOf('Duration: {event.duration_minutes}');
    expect(at, 'EventDayModal.js: the Duration line is gone').toBeGreaterThan(-1);
    const open = src.lastIndexOf('<div', at);
    const tag = src.slice(open, src.indexOf('>', open) + 1);
    expect(
      tag,
      'EventDayModal.js: the Duration line must take the card ink muted rung on the tinted arm',
    ).toContain(
      "${tinted ? '[color:var(--group-ink-muted-l,var(--t-color-l))] " +
        "dark:[color:var(--group-ink-muted,var(--t-color))]' : 'text-content-muted'}",
    );
    // the fallback is only reachable if this element actually carries `--t-*`
    expect(
      tag,
      'EventDayModal.js: the Duration line dropped rowSubtitleVars, so its ink fallback ' +
        'resolves to nothing and the text inherits a ground-blind colour',
    ).toContain('style={rowSubtitleVars}');
  });

  it('27. SPEC Req 8 POSITIVELY: the ground-darkness ink sites carry their NEW predicate', () => {
    /*
     * WHY THIS TEST EXISTS. SPEC Req 8's own gate is `grep -n 'LIMIT Phase 88.3-cr'`
     * returning zero across three files. That marker existed exactly ONCE in the
     * whole repo (verified), so a single deletion satisfies it — it can go green on a
     * tree where nothing was fixed and the comment was merely removed. A gate that
     * one deletion satisfies is not coverage; it is a receipt for a deletion.
     *
     * So this asserts the POSITIVE: each Req 8 site carries the predicate that
     * REPLACED the old one. The old predicate asked "does this group have a colour";
     * the new one is the rendered ground itself, via a cascade fork that cannot
     * disagree with the ground because it is selected by the same `dark:` variant.
     */
    const gl = code('app/components/grouplist.js');

    // site 1a — the "Last Game" row
    const rowAt = gl.indexOf('Last Game:');
    expect(rowAt, 'grouplist.js: the Last Game row is gone').toBeGreaterThan(-1);
    const rowOpen = gl.lastIndexOf('<div', rowAt);
    const rowTag = gl.slice(rowOpen, gl.indexOf('>', rowOpen) + 1);
    expect(rowTag, 'grouplist.js: the Last Game row is not on the card ink').toContain(
      'var(--group-ink-l,var(--t-color-l))',
    );
    expect(rowTag, 'grouplist.js: the Last Game row has no dark arm').toContain(
      'dark:[color:var(--group-ink,var(--t-color))]',
    );
    // and the old predicate is GONE, not merely overridden
    expect(
      rowTag,
      'grouplist.js: the Last Game row still forks on a theme token — the pole is chosen ' +
        'by "has a colour" again',
    ).not.toMatch(/tinted\s*\?\s*'text-content-primary'/);

    // site 1b — the 12px date takes the MUTED rung, not the primary ink. This is the
    // exact text the owner complained about in 88.3; it measures 5.52-6.28:1.
    const dateAt = gl.indexOf('formatDate(lastEvent');
    expect(dateAt, 'grouplist.js: the Last Game date is gone').toBeGreaterThan(-1);
    const dateOpen = gl.lastIndexOf('<span', dateAt);
    const dateTag = gl.slice(dateOpen, gl.indexOf('>', dateOpen) + 1);
    expect(dateTag, 'grouplist.js: the date is not on the muted rung of the card ink').toContain(
      'var(--group-ink-muted-l,var(--t-color-l))',
    );
    expect(dateTag, 'grouplist.js: the date has no dark arm').toContain(
      'dark:[color:var(--group-ink-muted,var(--t-color))]',
    );

    // site 2 — EventDayModal's "Duration:" line. Pinned as an exact literal by
    // test 24; asserted here as a MEMBER of the Req 8 set so the three sites are
    // legible as one requirement in one place.
    const edm = code('app/components/EventDayModal.js');
    expect(edm, 'EventDayModal.js: the Duration line is not on the card ink muted rung').toContain(
      'var(--group-ink-muted-l,var(--t-color-l))',
    );
    expect(
      edm,
      'EventDayModal.js: the Duration line still forks on a theme token',
    ).not.toContain("tinted ? 'text-content-primary' : 'text-content-muted'");

    // …and neither file may reintroduce the marker Req 8's own grep looks for.
    for (const src of [gl, edm]) {
      expect(src, 'a LIMIT marker came back at a Req 8 site').not.toContain('LIMIT Phase 88.3-cr');
    }
  });

  /*
   * SITE 3 OF 3 — `CalendarMonthView.js`'s past-date arms, which UI-SPEC 3.5 answers
   * with PLAIN tile ink and a literal ground-darkness predicate rather than with the
   * tinted card ink. It is owned by plan 88.3.1-09, not by plan 08, and the assertion
   * below is RED on this tree by construction.
   *
   * SCOPED RATHER THAN LEFT RED, deliberately. A knowingly-red suite between two
   * plans destroys the signal every later task depends on — "is the suite green?"
   * stops being answerable and the next executor learns to ignore a failure. The
   * requirement is not softened by being scoped: it is written, it is specific, and
   * plan 88.3.1-09 enables it by deleting the `.skip` below — which is a one-token
   * edit that will fail loudly if the work was not actually done.
   */
  // ENABLED plan 88.3.1-09 (the one-token edit plan 08 wrote this scope for). The
  // work it describes landed in this plan's task 1: both past-date arms now key on
  // `isDarkBackground` of the ground painted in that arm.
  describe('Req 8 site 3 — enabled by plan 88.3.1-09', () => {
    it('28. CalendarMonthView past-date ink keys on ground DARKNESS, not on "has a colour"', () => {
      const src = code('app/components/CalendarMonthView.js');
      // The defect shape: the dark arm reaches for the muted-on-dark pole whenever the
      // group HAS a colour. On a legacy LIGHT stored hex in dark mode that is ~1.1:1.
      expect(
        src,
        'CalendarMonthView.js: the past-date pole is still chosen by "has a colour"',
      ).not.toMatch(/groupBgColor\s*\?\s*SUBTEXT_MUTED_ON_DARK/);
      // The remedy named by the register entry and by UI-SPEC 3.5: the predicate the
      // non-past path in this same file already uses.
      expect(
        src,
        'CalendarMonthView.js: no ground-darkness predicate on the past-date arm',
      ).toMatch(/isDarkBackground\([\w.?]+\)\s*\?\s*SUBTEXT_MUTED_ON_DARK\s*:\s*SUBTEXT_MUTED_ON_LIGHT/);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 88.3.1 plan 01, AMENDMENT Y (M28 + M24, owner-ruled 2026-08-29) —
  // the measurement-module BOUNDARY.
  //
  // `src/lib/wcag.ts` and `src/lib/colourDistance.ts` are ~110 lines each of
  // WCAG / CIELAB / CIEDE2000 / OKLab arithmetic that exists ONLY to be
  // measured against by tests. Neither has ever had a production importer:
  // every real import of `wcag.ts` is a `.test.` file (plus `e2e/support/
  // contrast.ts`, which is outside `src/`), and the six `src/app/**` hits are
  // comment citations, not imports.
  //
  // Keeping them in `src/lib/` was the owner's ruling — a test-only maths
  // module beside its consumers is the established house shape here, and
  // moving them would churn every citation for no measured benefit. The guard
  // below is the OTHER half of that ruling: the shape only stays safe while
  // nothing production-side imports them.
  //
  // This phase is where the boundary nearly broke. `src/lib/colorUtils.js` is
  // imported by SEVEN client components and gains its first-ever cross-module
  // import in plan 88.3.1-06; the original plan had it importing `blend` from
  // `./wcag`, which would have pulled the whole contrast module into seven
  // client bundles. That was withdrawn (plan 06 AMENDMENT 2 / plan 03
  // AMENDMENT A) precisely to stop it — but a withdrawal in a plan document is
  // not a mechanism. This is.
  //
  // The ONE sanctioned edge is `colourDistance.ts` -> `wcag.ts` (it imports
  // `parseHex`, rather than shipping a second hex parser). It is asserted
  // POSITIVELY below, so the guard cannot pass by scanning nothing.
  //
  // Test files are excluded from the population on purpose: measuring is what
  // they are FOR, and this very file imports `contrastRatio` from `../lib/wcag`
  // at :58. `sourceFiles` already drops `.test.` / `.spec.` files, which is
  // exactly the production/test line this guard is drawn on.
  // -------------------------------------------------------------------------

  it('29. UI-SPEC 10.1 TEST 12 — exactly ONE ink-resolving implementation, and every caller passes a surface AND the validated image flag', () => {
    /*
     * UI-SPEC 3.4, verbatim on the point this asserts: "one function, one parameter,
     * no second copy". The tinted/plain split is card-vs-tile by ARGUMENT — plan
     * 88.3.1-08 wired four CARD callers and plan 88.3.1-09 wired two TILE ones — and
     * the whole value of that shape evaporates the moment somebody adds a second
     * implementation for "just this one surface". Project tenet, owner's words:
     * duplication is never a peer option.
     *
     * WHY THIS IS NOT A GREP FOR `groupInkVars`. A name grep passes against a copy
     * called `cardInkVars`, which is precisely the outcome §3.4 forbids, so this
     * scans for the BEHAVIOUR instead: a function that EMITS an ink custom property,
     * and (independently) a function that READS the `inkDark` / `inkLight` fields.
     * Two detectors, because they fail independently — a copy that emitted the plain
     * poles only would slip past the second, and a copy that read the fields but
     * handed them back as plain values would slip past the first.
     *
     * DEMONSTRATED RED, plan 88.3.1-09: a second exported function was added to
     * `src/lib/` that read `ground.inkDark` / `ground.inkLight` and returned
     * `{ '--group-ink': … }`; BOTH branches below reddened and named it. Removed
     * afterwards. Receipt in `88.3.1-09-SUMMARY.md`.
     *
     * The scan is comment-blind (`withoutComments`) and skips `.test.` / `.spec.`
     * files via `sourceFiles`, exactly like tests 5, 9 and 25 — every marker in this
     * phase QUOTES the property names it governs, so a comment-blind reader is the
     * only kind that can tell a decision from an implementation.
     */

    /** The nearest ENCLOSING function name for an offset — declaration forms only. */
    const owners = (src: string): { at: number; name: string }[] => {
      const out: { at: number; name: string }[] = [];
      const re =
        /function\s+([A-Za-z_$][\w$]*)\s*\(|(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^;=]{0,160}?\)\s*=>)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) out.push({ at: m.index, name: m[1] ?? m[2] });
      return out;
    };
    const ownerOf = (list: { at: number; name: string }[], at: number): string => {
      let name = '<module scope>';
      for (const o of list) {
        if (o.at > at) break;
        name = o.name;
      }
      return name;
    };

    /** Emits an ink custom property: `'--group-ink…': …` in an object literal. */
    const EMITS_INK = /'--[\w-]*ink[\w-]*'\s*:/g;
    /** Reads the resolver's ink FIELDS — the other half of the same job. */
    const READS_INK_FIELDS = /\.(inkDark|inkLight)\b/g;

    const emitters = new Set<string>();
    const readers = new Set<string>();
    let emitHits = 0;
    let readHits = 0;

    for (const file of sourceFiles(SRC)) {
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      const rel = path.relative(SRC, file);
      const list = owners(src);
      for (const m of src.matchAll(EMITS_INK)) {
        emitters.add(`${rel}#${ownerOf(list, m.index ?? 0)}`);
        emitHits += 1;
      }
      for (const m of src.matchAll(READS_INK_FIELDS)) {
        readers.add(`${rel}#${ownerOf(list, m.index ?? 0)}`);
        readHits += 1;
      }
    }

    // ANTI-VACUITY, both detectors. A scan that finds nothing proves nothing, and
    // the realistic way this test dies is a rename that makes both regexes miss.
    expect(emitHits, 'nothing in src/ emits an ink custom property — this scan is dead')
      .toBeGreaterThanOrEqual(4);
    expect(readHits, 'nothing in src/ reads the resolver ink fields — this scan is dead')
      .toBeGreaterThanOrEqual(2);

    expect(
      [...emitters].sort(),
      'a SECOND function emits an ink custom property. UI-SPEC 3.4: one function, one ' +
        '`surface` parameter, no second copy — a `cardInkVars`/`tileInkVars` pair is the ' +
        'exact outcome that contract forbids.',
    ).toEqual(['lib/colorUtils.js#groupInkVars']);

    /*
     * TWO sanctioned readers, and the SECOND is the PRODUCER rather than a duplicate —
     * recorded as an exemption so it reads as one rather than as a hole.
     *
     *   `resolveGroupGround`  reads `preset.inkDark` / `preset.inkLight` OFF THE TABLE
     *                         and puts them on the object it returns.
     *   `groupInkVars`        reads them OFF THAT OBJECT and turns them into custom
     *                         properties.
     *
     * That is one hop each in a single pipeline, both inside `lib/colorUtils.js`, and
     * neither is an ink-RESOLVING implementation on its own. The exemption is PAID FOR
     * by the emitter assertion above, which is the half that actually forbids a second
     * copy: a duplicate must emit somewhere to be useful, and there is exactly one
     * emitter. What this branch still catches is the realistic evasion the emitter
     * branch cannot see — a `.js` CONSUMER reaching into `ground.inkLight` itself and
     * doing the ink maths at the call site, which would show up here as a third entry
     * in an `app/` file.
     */
    expect(
      [...readers].sort(),
      'a SECOND function reads the resolver\'s `inkDark`/`inkLight` fields. Resolving ink ' +
        'is `groupInkVars`\'s job; a consumer reaching into the resolved object itself is ' +
        'a second implementation wearing a different shape.',
    ).toEqual(['lib/colorUtils.js#groupInkVars', 'lib/colorUtils.js#resolveGroupGround']);

    /*
     * …AND EVERY PRODUCTION CALLER PASSES BOTH OPTIONS — repo-wide, not just at the
     * files test 9 enumerates.
     *
     * `hasBackgroundImage` is only COMPILE-enforced for `.ts` callers (`checkJs` is
     * off) and all six real call sites are `.js`, where omitting it degrades silently
     * to `false` — the UNSAFE direction, painting a preset's tinted ink over a user's
     * photograph. Plan 06 AMENDMENT 7 made returning `{}` the protection; this makes
     * the callers actually reach it. Test 9 asserts the same chain per-file for the
     * five ground-emitting sites; this is the repo-wide superset, so a SEVENTH caller
     * added in a file nobody thought to add to that list cannot skip the check.
     */
    let calls = 0;
    for (const file of sourceFiles(SRC)) {
      const src = withoutComments(fs.readFileSync(file, 'utf8'));
      const rel = path.relative(SRC, file);
      for (const m of src.matchAll(/groupInkVars\s*\(/g)) {
        const before = src.slice(Math.max(0, (m.index ?? 0) - 20), m.index ?? 0);
        if (/function\s*$/.test(before)) continue; // the declaration itself
        const call = src.slice(m.index ?? 0, braceEnd(src, src.indexOf('{', m.index ?? 0)) + 1);
        calls += 1;

        expect(call, `${rel}: a groupInkVars call names no surface`).toMatch(
          /surface\s*:\s*'(card|tile)'/,
        );

        const flag = call.match(/hasBackgroundImage\s*:\s*([A-Za-z_$][\w$]*)/);
        expect(
          flag,
          `${rel}: a groupInkVars call omits hasBackgroundImage (or inlines an expression ` +
            'this scan cannot trace). Omitted, it defaults to false — the UNSAFE direction.',
        ).not.toBeNull();

        const derived = src.match(new RegExp(`const\\s+${flag![1]}\\s*=\\s*!!\\s*([\\w$]+)`));
        expect(
          derived,
          `${rel}: \`${flag![1]}\` is not derived as \`!!<style>\` — trace it, or it may be ` +
            'the raw background_image_url string',
        ).not.toBeNull();
        expect(
          src,
          `${rel}: \`${derived![1]}\` does not come from safeBgImageStyle — the image flag ` +
            'must be the VALIDATED style, never the raw URL (FSEC-03)',
        ).toMatch(new RegExp(`const\\s+${derived![1]}\\s*=\\s*safeBgImageStyle\\(`));
      }
    }
    // The six production callers: grouplist, CalendarListView, EventDayModal,
    // CalendarMonthView x2 (one per tile variant), groupHomePage. Same number test 5
    // floors, asserted here so the two cannot drift apart silently.
    expect(calls, 'the ink function lost a production caller').toBeGreaterThanOrEqual(6);
  });

  it('25. AMENDMENT Y — no production module imports the test-only colour-maths modules', () => {
    /** Every `from '…'` / `require('…')` / `import('…')` module specifier. */
    const specifiers = (src: string): string[] => {
      const out: string[] = [];
      const re = /(?:\bfrom\s*|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;
      let match: RegExpExecArray | null;
      while ((match = re.exec(src)) !== null) out.push(match[1]);
      return out;
    };
    const isMathsModule = (spec: string): boolean =>
      /(^|\/)(wcag|colourDistance)$/.test(spec);

    // The sanctioned edge, asserted first: if this ever stops being true the
    // detector below is scanning for something that no longer exists.
    const SANCTIONED = 'lib/colourDistance.ts';
    expect(
      specifiers(code(SANCTIONED)).filter(isMathsModule),
      'colourDistance.ts no longer imports parseHex from ./wcag — either the boundary moved or a ' +
        'second hex parser was hand-rolled; this guard needs rewriting either way',
    ).toEqual(['./wcag']);

    // Detector liveness on a synthetic line, so a regex that matches nothing
    // cannot masquerade as a clean tree.
    expect(specifiers("import { blend } from './wcag';").filter(isMathsModule)).toEqual(['./wcag']);
    expect(
      specifiers("const { deltaE2000 } = require('../lib/colourDistance');").filter(isMathsModule),
    ).toEqual(['../lib/colourDistance']);

    const population = sourceFiles(SRC);
    // A floor on the scanned population — an empty or collapsed walk is the
    // vacuity mode this whole file's test 0 exists to rule out.
    expect(population.length).toBeGreaterThan(50);
    expect(population.map((f) => path.relative(SRC, f))).toContain('lib/colorUtils.js');

    const offenders: string[] = [];
    for (const file of population) {
      const rel = path.relative(SRC, file);
      if (rel === SANCTIONED) continue; // the one sanctioned edge, pinned above
      for (const spec of specifiers(withoutComments(fs.readFileSync(file, 'utf8')))) {
        if (isMathsModule(spec)) offenders.push(`${rel} imports ${spec}`);
      }
    }
    expect(
      offenders,
      'a production module now imports src/lib/wcag.ts or src/lib/colourDistance.ts. Those are ' +
        'test-only measurement modules (~220 lines of WCAG / CIELAB / CIEDE2000 / OKLab maths) and ' +
        'importing one ships it to the client. If the value is genuinely needed at runtime, ' +
        'TRANSCRIBE the measured literal with its provenance comment — the idiom plan 88.3.1-06 ' +
        'AMENDMENT 2 already chose for the muted rung — rather than pulling in the calculator.',
    ).toEqual([]);
  });

  // -------------------------------------------------------------------------
  // Phase 88.3.1 marker registry.
  //
  // RESEARCH Pitfall 7: these belong HERE, beside tests 2 / 17 / 18, which already
  // assert markers at PRODUCTION sites. `decisionMarkers.test.ts` is scoped to
  // 87.8's phone-floor markers and has no general registry, so putting them there
  // would silently widen that file's contract.
  // -------------------------------------------------------------------------

  it('26. every Phase 88.3.1 decision is recorded at its production site, naming what it rejected', () => {
    /*
     * A decision recorded only in a plan is invisible to the next person editing the
     * code it governs. CLAUDE.md's marker rule is specific about WHY: "what was chosen
     * AND what was rejected — the rejected alternative is the load-bearing part",
     * because `uses two-tap` warns nobody while `two-tap OVER a modal` stops the edit.
     * A marker that names no rejected alternative is the exact failure mode the rule
     * exists to prevent, so it is asserted rather than trusted.
     *
     * The three idioms below are the ones this codebase actually uses for that half.
     * The literal `REJECTED` is required at least ONCE per file; the softer two are
     * accepted on individual markers because two shipped plan-06 markers (`M23`,
     * `AMENDMENT 7`) name their rejected alternative in those words and re-wording a
     * correct marker to satisfy a gate is how gates start shaping prose instead of
     * checking it.
     */
    const NAMES_A_REJECTED_HALF = /REJECTED|chosen OVER|is a decision, not a/;
    const MARKER_SITES = [TABLE, 'lib/colorUtils.js', SEED];

    for (const file of MARKER_SITES) {
      const src = raw(file);
      const hits = [...src.matchAll(/DECISION Phase 88\.3\.1/g)];
      expect(
        hits.length,
        `${file} carries no DECISION Phase 88.3.1 marker — this phase's decisions at ` +
          'this site are invisible to the next reader',
      ).toBeGreaterThanOrEqual(1);

      let literalRejected = 0;
      for (const hit of hits) {
        const start = hit.index ?? 0;
        const close = src.indexOf('*/', start);
        expect(
          close,
          `${file}: a Phase 88.3.1 marker is not inside a block comment, so its extent ` +
            'cannot be read — put it in one',
        ).toBeGreaterThan(start);
        const marker = src.slice(start, close);
        expect(
          marker,
          `${file}: a Phase 88.3.1 marker names no rejected alternative. That is the ` +
            'half a future reader needs — without it the marker reads as description ' +
            'and the decision gets "cleaned up".',
        ).toMatch(NAMES_A_REJECTED_HALF);
        if (marker.includes('REJECTED')) literalRejected += 1;
      }
      expect(
        literalRejected,
        `${file}: not one Phase 88.3.1 marker names a REJECTED alternative in so many words`,
      ).toBeGreaterThanOrEqual(1);
    }

    // Detector liveness: a marker with no rejected half must actually fail the test above.
    expect('DECISION Phase 88.3.1 (X): we do it this way.').not.toMatch(NAMES_A_REJECTED_HALF);

    /*
     * SPEC Req 9's own check. Three claims made by earlier phases expired in this one
     * and had to be superseded IN PLACE rather than carried forward or deleted:
     * D-27's "the palette is all-dark" (`GroupSettings.js`), the seed's
     * "this line stays resolveGroupBackgroundColor" (AMENDMENT E, same file), R2-2's
     * "no visible labels" (AMENDMENT G2, same file), plus two in `colorUtils.js`.
     * Deleting an expired claim loses the history; leaving it loses the reader.
     */
    const amended = ['lib/colorUtils.js', SEED].reduce(
      (n, file) => n + (raw(file).match(/AMENDED Phase 88\.3\.1/g) ?? []).length,
      0,
    );
    expect(
      amended,
      'an expired claim was carried forward or deleted instead of being superseded in place',
    ).toBeGreaterThanOrEqual(3);
  });
});
