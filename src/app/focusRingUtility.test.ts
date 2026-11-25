// @vitest-environment node
// Reason: it compiles the stylesheet and reads source files; it renders nothing and needs no DOM.
//
// Phase 89.6-12 (SPEC R8, owner pick O-1 = B, 2026-11-22): the guard for the two-tone keyboard
// ring utilities, focus-ring and focus-ring-inset, and the runtime properties they read.
//
// WHY A COMPILE READ. When this file was written no source file used either utility yet (plan
// 89.6-13's codemod converts the consumers), and Tailwind emits a utility only where a class uses
// it, so nothing rendered could show it. The ring is the control's sole focus indicator once the
// consumers move onto it, so a broken body would remove keyboard focus everywhere at once and
// throw nothing. This file builds the real stylesheet through the installed engine with EXPLICIT
// candidates (no tree scan) and reads the emitted rules.
//
// EVERY SOURCE READ IS COMMENT-STRIPPED. The DECISION marker above the utilities in globals.css
// names the very properties this file looks for; withoutComments blanks comments and keeps every
// offset.
import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { lineAt, readOpeningTag, sourceFiles, stringChunks, withoutComments } from '../test-utils/sourceScan';

const GLOBALS = path.join(__dirname, 'globals.css');
const raw = fs.readFileSync(GLOBALS, 'utf8');
const css = withoutComments(raw);

// The emitted selectors, as Tailwind 4 writes them (the colon in a variant is escaped).
const SEL_RING = '.focus-visible\\:focus-ring:focus-visible';
const SEL_INSET = '.focus-visible\\:focus-ring-inset:focus-visible';
const SEL_OUTLINE_HIDDEN = '.focus\\:outline-hidden:focus';
const SEL_SHADOW_MD = '.shadow-md';
const SEL_INSET_SHADOW = '.inset-shadow-sm';

type Compiler = { build: (candidates: string[]) => string };
let compilerPromise: Promise<Compiler> | null = null;

/** The real stylesheet through the installed engine, compiled once per run. */
function compiler(): Promise<Compiler> {
  if (!compilerPromise) {
    compilerPromise = (async () => {
      // Resolved from the vitest root (the frontend package dir), the way
      // src/components/ui/Input.test.tsx ("async function buildShippedCss()") loads it.
      const { compile } = await import(
        /* @vite-ignore */ path.join(process.cwd(), 'node_modules/@tailwindcss/node/dist/index.mjs')
      );
      return compile(raw, { base: path.dirname(GLOBALS), onDependency: () => {} });
    })();
  }
  return compilerPromise;
}

async function build(candidates: string[]): Promise<string> {
  return (await compiler()).build(candidates);
}

/** Every index at which a rule with exactly this selector opens in the compiled CSS. */
function ruleOpens(out: string, selector: string): number[] {
  const hits: number[] = [];
  const needle = `${selector} {`;
  for (let i = out.indexOf(needle); i >= 0; i = out.indexOf(needle, i + 1)) {
    // A rule opens at the start of a line (after its indentation), never mid-selector.
    if (/(^|\n)[ \t]*$/.test(out.slice(Math.max(0, i - 40), i))) hits.push(i);
  }
  return hits;
}

/** The rule's own declarations (nested at-rule blocks removed), or a failed assertion. */
function ruleBody(out: string, selector: string): string {
  const opens = ruleOpens(out, selector);
  expect(opens, `the compiled CSS must hold exactly one rule for ${selector}; found ${opens.length}`).toHaveLength(1);
  const brace = out.indexOf('{', opens[0]);
  let depth = 0;
  for (let i = brace; i < out.length; i += 1) {
    if (out[i] === '{') depth += 1;
    else if (out[i] === '}') {
      depth -= 1;
      if (depth === 0) return out.slice(brace + 1, i).replace(/[^\n{}]*\{[^{}]*\}/g, '');
    }
  }
  throw new Error(`the rule for ${selector} never closes`);
}

/** The value of one top-level declaration in a rule body, or null when it is absent. */
function decl(body: string, prop: string): string | null {
  const escaped = prop.replace(/[-]/g, '\\-');
  const m = new RegExp(`(^|[\\s;])${escaped}[ \\t]*:[ \\t]*([^;]+);`).exec(body);
  return m ? m[2].trim() : null;
}

/** The ordered --tw-* slot names a box-shadow value reads (fallbacks ignored). */
function slotNames(value: string | null): string[] {
  return value ? [...value.matchAll(/var\(\s*(--tw-[a-z-]+)/g)].map((m) => m[1]) : [];
}

describe('Phase 89.6-12 — the two-tone focus-ring utilities (owner pick O-1 = B)', () => {
  it('1. focus-ring compiles to the outline shorthand plus the inner band', async () => {
    const body = ruleBody(await build(['focus-visible:focus-ring']), SEL_RING);
    expect(decl(body, 'outline'), 'focus-ring: the outer ring is the outline shorthand').toBe(
      '2px solid var(--focus-ring-outer)',
    );
    expect(decl(body, 'outline-offset'), 'focus-ring: the outer ring sits 2px off the control').toBe('2px');
    expect(decl(body, '--tw-ring-shadow'), 'focus-ring: the inner band rides the ring slot').toBe(
      '0 0 0 2px var(--focus-ring-inner)',
    );
  });

  it('2. focus-ring-inset compiles to a transparent inset outline and two inset bands', async () => {
    const body = ruleBody(await build(['focus-visible:focus-ring-inset']), SEL_INSET);
    const outline = decl(body, 'outline');
    // The transparent outline is the forced-colours ring: box-shadow is forced to none there and
    // the outline colour is replaced by a system colour.
    expect(outline, 'focus-ring-inset: the outline is transparent').toBe('2px solid transparent');
    // An opaque inset outline paints above borders and box-shadows and hid the selected cues
    // (the active-tab underline, the Friends tab band, the RSVP selected border) while focused.
    expect(
      outline ?? '',
      'focus-ring-inset: the outline must not paint in --focus-ring-outer (it would cover the control border cue)',
    ).not.toContain('--focus-ring-outer');
    expect(decl(body, 'outline-offset'), 'focus-ring-inset: the outline sits 2px inside').toBe('-2px');
    expect(
      decl(body, '--tw-ring-shadow'),
      'focus-ring-inset: both bands are inset shadows, the outer listed first so it paints over the inner band',
    ).toBe('inset 0 0 0 2px var(--focus-ring-outer), inset 0 0 0 4px var(--focus-ring-inner)');
  });

  it('3. both focus-visible ring utilities are emitted after focus:outline-hidden', async () => {
    const out = await build(['focus:outline-hidden', 'focus-visible:focus-ring', 'focus-visible:focus-ring-inset']);
    const hidden = ruleOpens(out, SEL_OUTLINE_HIDDEN);
    const ring = ruleOpens(out, SEL_RING);
    const inset = ruleOpens(out, SEL_INSET);
    expect(hidden, 'focus:outline-hidden must be emitted once').toHaveLength(1);
    expect(ring, 'focus-visible:focus-ring must be emitted once').toHaveLength(1);
    expect(inset, 'focus-visible:focus-ring-inset must be emitted once').toHaveLength(1);
    // Equal specificity, so source order decides: the ring must come after outline-hidden or the
    // outline-hidden rule removes the outer ring (and the inset form's forced-colours ring, which
    // rests on its transparent outline alone).
    expect(ring[0], 'focus-visible:focus-ring must be emitted after focus:outline-hidden').toBeGreaterThan(hidden[0]);
    expect(inset[0], 'focus-visible:focus-ring-inset must be emitted after focus:outline-hidden').toBeGreaterThan(
      hidden[0],
    );
    // An element can carry both forms after plan 89.6-13: CalendarListView's section header passes
    // the inset form to a Button whose base holds the outset one, at
    // src/app/components/CalendarListView.js ("DECISION Phase 88.9-61 (X25a, page 10a").
    // cn() cannot see that the two custom utilities conflict, so the inset ring that decision chose
    // wins only by this emission order.
    expect(inset[0], 'focus-visible:focus-ring-inset must be emitted after focus-visible:focus-ring').toBeGreaterThan(
      ring[0],
    );
  });

  it('4. the utilities read runtime properties, never an @theme key', () => {
    const lightHeader = raw.indexOf('/* ===== DESIGN SYSTEM: Semantic Tokens (Light = default) ===== */');
    expect(lightHeader, 'the light semantic block header comment must exist').toBeGreaterThanOrEqual(0);
    const lightOpen = css.slice(lightHeader).search(/^:root[ \t]*\{/m);
    expect(lightOpen, 'a :root block must follow the light semantic header').toBeGreaterThanOrEqual(0);
    const darkOpens = [...css.matchAll(/^\.dark[ \t]*\{/gm)].map((m) => m.index);
    expect(darkOpens, 'exactly one .dark block').toHaveLength(1);
    const light = blockAt(lightHeader + lightOpen);
    const dark = blockAt(darkOpens[0]);
    const themes = [...css.matchAll(/^@theme\b[^{]*\{/gm)].map((m) => blockAt(m.index));
    expect(themes.length, 'the @theme blocks must be found').toBeGreaterThan(0);
    for (const prop of ['--focus-ring-outer', '--focus-ring-inner']) {
      const declared = new RegExp(`^[ \\t]*${prop}[ \\t]*:`, 'm');
      expect(declared.test(light), `${prop} must be declared in the light :root block`).toBe(true);
      expect(declared.test(dark), `${prop} must be declared in the .dark block`).toBe(true);
      for (const theme of themes) {
        expect(declared.test(theme), `${prop} must not be an @theme key`).toBe(false);
      }
    }
    for (const name of ['focus-ring', 'focus-ring-inset']) {
      const opens = [...css.matchAll(new RegExp(`^@utility ${name}[ \\t]*\\{`, 'gm'))].map((m) => m.index);
      expect(opens, `exactly one @utility ${name} block`).toHaveLength(1);
      const body = blockAt(opens[0]);
      // The CONSEQUENCE marker at the light focus-ring line in globals.css: an override of the
      // theme key is inert in the header, because the theme key resolves its var() on :root.
      expect(body, `@utility ${name} must not read --color-focus-ring`).not.toContain('--color-focus-ring');
      expect(/var\(\s*--ring\s*[,)]/.test(body), `@utility ${name} must not read --ring`).toBe(false);
    }
  });

  it("5. both ring utilities compose every Tailwind shadow slot, so an element's own inset or drop shadow survives focus", async () => {
    const out = await build(['shadow-md', 'inset-shadow-sm', 'focus-visible:focus-ring', 'focus-visible:focus-ring-inset']);
    // The slot list is read from the build, never typed here, so a Tailwind upgrade that changes
    // the composite moves the expectation with it.
    const reference = slotNames(decl(ruleBody(out, SEL_SHADOW_MD), 'box-shadow'));
    const insetShadow = slotNames(decl(ruleBody(out, SEL_INSET_SHADOW), 'box-shadow'));
    expect(reference.length, 'shadow-md must read at least one --tw-* slot').toBeGreaterThan(0);
    expect(insetShadow, `inset-shadow-sm slots [${insetShadow.join(', ')}] vs shadow-md [${reference.join(', ')}]`).toEqual(
      reference,
    );
    for (const [name, selector] of [
      ['focus-ring', SEL_RING],
      ['focus-ring-inset', SEL_INSET],
    ] as const) {
      const got = slotNames(decl(ruleBody(out, selector), 'box-shadow'));
      expect(
        got,
        `${name} box-shadow slots [${got.join(', ')}] must equal the shadow-md composite [${reference.join(', ')}] in order`,
      ).toEqual(reference);
    }
  });

  it('6. both header sites keep the old ring scope beside the new pair until plan 89.6-13', () => {
    // The header chrome is dark in both themes, so it scopes the pair to amber-400 outside and
    // purple-950 inside. The old ring scope stays beside it: removing it now would recolour the
    // rings no plan has converted yet. Plan 89.6-13 converts the consumers and removes it.
    const header = fs.readFileSync(path.join(__dirname, 'Header.js'), 'utf8');
    const sites = stringChunks(header).filter((chunk) => chunk.text.includes('[--ring:var(--amber-400)]'));
    expect(sites, 'Header.js: expected exactly two class strings carrying the old ring scope').toHaveLength(2);
    for (const site of sites) {
      const line = lineAt(header, site.offset);
      expect(site.text, `Header.js line ${line}: the new outer scope must sit beside the old one`).toContain(
        '[--focus-ring-outer:var(--amber-400)]',
      );
      expect(site.text, `Header.js line ${line}: the new inner scope must sit beside the old one`).toContain(
        '[--focus-ring-inner:var(--purple-950)]',
      );
    }
  });

  it('7. native checkboxes take the accent from one base rule', () => {
    // Owner pick O-1b = c: the browser's own checkbox, ticked in our colour. One rule on checkbox
    // inputs in the base layer, so an accent utility at a call site still wins over it.
    const layerOpens = [...css.matchAll(/^@layer base[ \t]*\{/gm)].map((m) => m.index);
    expect(layerOpens.length, 'globals.css must hold an @layer base block').toBeGreaterThan(0);
    const rules = layerOpens.flatMap((open) => {
      const base = blockAt(open);
      return [...base.matchAll(/(^|[\s}])input\[type=(['"]?)checkbox\2\][ \t]*\{([^}]*)\}/g)].map((m) => m[3]);
    });
    expect(rules, 'the base layer must hold exactly one rule for checkbox inputs').toHaveLength(1);
    expect(decl(rules[0], 'accent-color'), 'the checkbox base rule paints the accent token').toBe(
      'var(--color-checkbox-accent)',
    );
    const everywhere = [...css.matchAll(/accent-color[ \t]*:[ \t]*var\(--color-checkbox-accent\)/g)];
    expect(everywhere, 'the accent token is applied by that one rule only').toHaveLength(1);
  });

  it('8. written exception: the app-ringed checkboxes carry no ring', () => {
    // WRITTEN EXCEPTION to the one-ring rule (DECISION Phase 89.6-12 (O-1b) in globals.css; owner
    // pick O-1b = c, 2026-11-22: 'remove the extra ring the app adds on the invite panel so the
    // browser's rounded ring shows there'): a native checkbox keeps the browser's own rounded focus
    // ring and carries no app ring class. Plan 89.6-13's ring codemod skips checkbox inputs and must
    // keep this green.
    //
    // An outline-hidden or outline-none on a checkbox is an offender too: it would remove the only
    // focus indicator the box has. An accent utility stays allowed (AvailabilityGrid's toggle).
    const srcRoot = path.join(__dirname, '..');
    const offenders: string[] = [];
    let population = 0;
    for (const file of sourceFiles(srcRoot)) {
      const text = withoutComments(fs.readFileSync(file, 'utf8'));
      for (const m of text.matchAll(/<input\b/g)) {
        const tag = readOpeningTag(text, m.index);
        if (!tag || !/\btype=(?:"checkbox"|'checkbox'|\{\s*['"]checkbox['"]\s*\})/.test(tag)) continue;
        population += 1;
        const where = `${path.relative(path.join(srcRoot, '..'), file)}:${lineAt(text, m.index)}`;
        for (const token of classTokens(tag)) {
          const utility = token.replace(/^!/, '').split(':').pop() ?? '';
          if (/^(ring|focus-ring)(-|$)/.test(utility) || /^outline-(hidden|none)$/.test(utility)) {
            offenders.push(`${where} ${token}`);
          }
        }
      }
    }
    // A population floor, so the scan cannot pass on an empty list (ten checkbox inputs at FE b10aede).
    expect(population, 'the scan must find at least ten checkbox inputs in src').toBeGreaterThanOrEqual(10);
    expect(offenders, `checkbox inputs carrying an app ring or a hidden outline:\n${offenders.join('\n')}`).toEqual([]);
  });

  it('9. every focus-ring candidate src uses compiles', async () => {
    // Phase 89.6-13 (owner pick O-1 = B): the ring codemod moved every keyboard ring onto the two
    // utilities, under whatever variant chain the old ring carried (focus-visible:, peer-, md: ...).
    // Tailwind emits a candidate only when its variant chain resolves, so a chain the engine
    // cannot build would leave that control with no ring and nothing red. This reads every
    // distinct whole token in src whose utility is focus-ring or focus-ring-inset, builds them,
    // and asserts each one emitted a rule.
    const srcRoot = path.join(__dirname, '..');
    const candidates = new Set<string>();
    for (const file of sourceFiles(srcRoot)) {
      for (const chunk of stringChunks(fs.readFileSync(file, 'utf8'))) {
        for (const token of chunk.text.split(/\s+/)) {
          const utility = token.replace(/^!/, '').split(':').pop() ?? '';
          if (token.includes(':') && (utility === 'focus-ring' || utility === 'focus-ring-inset')) candidates.add(token);
        }
      }
    }
    expect(candidates.size, `at least three distinct focus-ring candidates in src; found ${[...candidates].join(', ')}`).toBeGreaterThanOrEqual(3);
    const out = await build([...candidates, 'focus-visible:focus-rung']);
    // Negative control: a misspelt candidate emits nothing, so the per-candidate read can fail.
    expect(out.includes('.focus-visible\\:focus-rung'), 'a misspelt candidate must emit no rule').toBe(false);
    const missing = [...candidates].filter((c) => !out.includes(`.${c.replace(/:/g, '\\:')}`));
    expect(missing, `focus-ring candidates in src that emit no rule:\n${missing.join('\n')}`).toEqual([]);
  });
});

/** Every class token in an opening tag's className value (a string or a template literal). */
function classTokens(tag: string): string[] {
  const at = tag.search(/\bclassName=/);
  if (at < 0) return [];
  let i = tag.indexOf('=', at) + 1;
  let value: string;
  if (tag[i] === '"' || tag[i] === "'") {
    const end = tag.indexOf(tag[i], i + 1);
    value = tag.slice(i, end + 1);
  } else if (tag[i] === '{') {
    let depth = 0;
    const start = i;
    for (; i < tag.length; i += 1) {
      if (tag[i] === '{') depth += 1;
      else if (tag[i] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    value = tag.slice(start, i + 1);
  } else {
    return [];
  }
  return stringChunks(value).flatMap((chunk) => chunk.text.split(/\s+/).filter((t) => t.length > 0));
}

/** The body of the block whose opening brace is at or after offset, read from the stripped CSS. */
function blockAt(offset: number): string {
  const brace = css.indexOf('{', offset);
  let depth = 0;
  for (let i = brace; i < css.length; i += 1) {
    if (css[i] === '{') depth += 1;
    else if (css[i] === '}') {
      depth -= 1;
      if (depth === 0) return css.slice(brace + 1, i);
    }
  }
  throw new Error(`the block at offset ${offset} never closes`);
}
