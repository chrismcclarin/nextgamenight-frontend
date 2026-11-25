#!/usr/bin/env node
/*
 * ring-codemod.mjs: Phase 89.6 plan 13, owner pick O-1 = B (2026-11-22, "Two-colour ring, 2px: a
 * thin inner band plus a darker outer ring; passes all 96"). Rewrites every box-shadow keyboard
 * ring written as Tailwind class tokens inside a string literal into the two-tone focus-ring
 * utility (src/app/globals.css, plan 89.6-12), and deletes the per-ground halo tokens that only
 * existed for the old ring.
 *
 * The rule, per string literal (a string, a no-substitution template, or one piece of a template),
 * on whitespace-split tokens with the spacing kept:
 *   - The ring family of a variant chain is any token whose chain ends with focus-visible: (with an
 *     optional peer- or group- lead, and any run of other variants before it, such as dark:, md: or
 *     max-sm:) followed by ring-2, ring-focus-ring, ring-ring, ring-inset or ring-offset-<digit>.
 *     A literal holding that chain's ring-inset gets ONE <chain>focus-ring-inset, otherwise ONE
 *     <chain>focus-ring, written where the chain's first family token stood; every other family
 *     token of that chain is deleted.
 *   - Every <chain>ring-offset-<colour> (colour = not a digit) is a halo and is deleted.
 *   - An unprefixed ring-offset-<colour> is deleted only in a literal that held a converted ring
 *     (a decorative unprefixed ring-2 ring-offset-2 with no focus prefix is never touched).
 *   - Spacing left doubled by a deletion collapses. A literal is written only when its raw text
 *     equals its cooked text (an escape would be rewritten wrongly), otherwise it is reported.
 *   - A JSX className attribute whose string empties is removed; any other literal that empties is
 *     a blocking hand site.
 *
 * Files: git ls-files src, non-test .js .jsx .ts .tsx only, minus
 *   - (until plan 89.6-38) the host-ground halo map, whose consumers that plan owned; AMENDED
 *     Phase 89.6-38 (host-ground): the map's file is deleted and test 12's allowance with it, so
 *     no single file is excluded any more.
 *   - everything under src/test-utils/: test helpers hold old ring tokens as DATA (the reject list
 *     in focusRingAssert.ts); a --write would turn that list into the new utility and make the
 *     helper reject correct rings, and --check would never exit 0. The helper is hand-edited.
 *
 * Modes:
 *   node scripts/ring-codemod.mjs                 report (default), exit 0
 *   node scripts/ring-codemod.mjs --write [paths] rewrite the files (no paths = the whole list)
 *   node scripts/ring-codemod.mjs --check         exit 1 while any rewrite would happen or any
 *                                                 BLOCKING hand site remains (split family,
 *                                                 raw-text mismatch, emptied non-JSX literal)
 *   node scripts/ring-codemod.mjs --check --strict  also exit 1 while an identical-arms
 *                                                 conditional or a stacked-ring site remains
 *   node scripts/ring-codemod.mjs --self-test     in-memory cases, prints self-test: <n> passed
 *
 * Report lines: ring strings, per-form counts, halo tokens, then one would rewrite (or rewrote)
 * line per file and one line per hand site: split family, identical arms, emptied literal,
 * checkbox skip, raw-text mismatch, stacked ring, plus informational cross-literal ring lines (a
 * JSX Button, Tabs* or Input call site whose className passes a ring form other than the
 * primitive base's: the strict check reads one literal at a time and cannot see a base-plus-call-
 * site stack) and no-offset lines (a ring written with no offset, now drawn 2px outside; plan
 * 89.6-31 measures each).
 *
 * DECISION Phase 89.6-13 (codemod): token rewrite inside string literals over a TypeScript AST,
 * OVER a regex over file text (comments quote the old tokens as history and must keep them) and
 * OVER hand edits at 61 files (the run is one reviewable report). Checkbox inputs are skipped
 * under the written exception DECISION Phase 89.6-12 (O-1b). Changing this is a decision, not a
 * cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

// A reader that stops early (head) must not crash the run; the exit code stays the run's own.
process.stdout.on('error', (e) => {
  if (e.code !== 'EPIPE') throw e;
});
const say = (line) => process.stdout.write(`${line}\n`);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Files skipped on purpose, each with its reason (see the header).
// Empty since plan 89.6-38 deleted the one file it held (the host-ground halo map).
export const EXCLUDED_FILES = new Map();
export const EXCLUDED_PREFIXES = new Map([
  ['src/test-utils/', 'test helpers hold old ring tokens as data'],
]);

/** The file list from `git ls-files src` output (newline-separated repo-relative paths). */
export function buildFileList(lsOutput) {
  return lsOutput
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((p) => /\.(js|jsx|ts|tsx)$/.test(p))
    .filter((p) => !/\.(test|spec)\./.test(p))
    .filter((p) => !EXCLUDED_FILES.has(p))
    .filter((p) => ![...EXCLUDED_PREFIXES.keys()].some((pre) => p.startsWith(pre)));
}

// <variants...><peer-|group-|>focus-visible:<utility>
const CHAIN = String.raw`((?:[^\s:]+:)*?(?:peer-|group-)?focus-visible:)`;
const FAMILY_RE = new RegExp(`^${CHAIN}(ring-2|ring-focus-ring|ring-ring|ring-inset|ring-offset-\\d+)$`);
const HALO_RE = new RegExp(`^${CHAIN}ring-offset-(?!\\d)[a-z][a-z0-9-]*$`);
const UNPREFIXED_HALO_RE = /^ring-offset-(?!\d)[a-z][a-z0-9-]*$/;
const UTILITY_RE = /^(?:[^\s:]+:)*?(?:peer-|group-)?focus-visible:focus-ring(-inset)?$/;
// A token whose utility is ring-2, ring-inset or ring-offset-* under no focus-visible chain.
const STACK_RE = /^((?:[^\s:]+:)*)(ring-2|ring-inset|ring-offset-[a-z0-9-]+)$/;

/** Rewrite one literal's cooked text. Returns { text, groups, halos, unprefixedHalos }. */
export function rewriteText(text) {
  const parts = text.split(/(\s+)/);
  const chains = new Map(); // chain -> { first: index, inset, offset }
  const remove = new Set();
  let halos = 0;
  for (let i = 0; i < parts.length; i += 2) {
    const tok = parts[i];
    if (!tok) continue;
    const fam = FAMILY_RE.exec(tok);
    if (fam) {
      const [, chain, util] = fam;
      if (!chains.has(chain)) chains.set(chain, { first: i, inset: false, offset: null });
      const c = chains.get(chain);
      if (util === 'ring-inset') c.inset = true;
      const off = /^ring-offset-(\d+)$/.exec(util);
      if (off) c.offset = off[1];
      if (i !== c.first) remove.add(i);
      continue;
    }
    if (HALO_RE.test(tok)) {
      remove.add(i);
      halos += 1;
    }
  }
  let unprefixedHalos = 0;
  if (chains.size > 0) {
    for (let i = 0; i < parts.length; i += 2) {
      if (parts[i] && UNPREFIXED_HALO_RE.test(parts[i])) {
        remove.add(i);
        unprefixedHalos += 1;
      }
    }
  }
  const groups = [];
  for (const [chain, c] of chains) {
    parts[c.first] = `${chain}focus-ring${c.inset ? '-inset' : ''}`;
    const form = chain.startsWith('peer-')
      ? 'peer'
      : c.inset
        ? 'inset'
        : c.offset === null
          ? 'no offset'
          : `offset-${c.offset}`;
    groups.push({ chain, form });
  }
  if (remove.size === 0) return { text: parts.join(''), groups, halos, unprefixedHalos };
  // Delete tokens, collapsing the whitespace on either side into one run.
  const out = [...parts];
  for (const i of [...remove].sort((a, b) => b - a)) {
    const before = i - 1 >= 0 ? i - 1 : null;
    const after = i + 1 < out.length ? i + 1 : null;
    if (before !== null && after !== null) {
      // keep the run that holds a newline, else the first
      const keep = !out[before].includes('\n') && out[after].includes('\n') ? out[after] : out[before];
      out.splice(before, 3, keep);
    } else if (after !== null) {
      out.splice(i, 2);
    } else if (before !== null) {
      out.splice(before, 2);
    } else {
      out.splice(i, 1, '');
    }
  }
  return { text: out.join(''), groups, halos, unprefixedHalos };
}

function hasFamily(text) {
  return text.split(/\s+/).some((t) => FAMILY_RE.test(t));
}
function familyChains(text) {
  const s = new Set();
  for (const t of text.split(/\s+/)) {
    const m = FAMILY_RE.exec(t);
    if (m) s.add(m[1]);
  }
  return s;
}
function ringForm(text) {
  // the utility forms a literal carries after the rewrite
  const forms = new Set();
  for (const t of text.split(/\s+/)) {
    const m = UTILITY_RE.exec(t);
    if (m) forms.add(m[1] ? 'inset' : 'outset');
  }
  return forms;
}
function stackedTokens(text) {
  const toks = text.split(/\s+/).filter(Boolean);
  if (!toks.some((t) => UTILITY_RE.test(t))) return [];
  return toks.filter((t) => {
    const m = STACK_RE.exec(t);
    return m && !/(?:^|:)(?:peer-|group-)?focus-visible:$/.test(m[1]);
  });
}

// The base ring form of each primitive whose call sites pass className through cn().
const PRIMITIVE_BASE = new Map([
  ['Button', 'outset'],
  ['Input', 'outset'],
  ['TabsTrigger', 'inset'],
  ['TabsContent', 'outset'],
  ['TabsList', 'none'],
  ['Tabs', 'none'],
]);

function literalSpan(node, sf) {
  const start = node.getStart(sf);
  const k = node.kind;
  if (k === ts.SyntaxKind.StringLiteral) return [start + 1, node.end - 1];
  if (k === ts.SyntaxKind.NoSubstitutionTemplateLiteral || k === ts.SyntaxKind.TemplateTail)
    return [start + 1, node.end - 1];
  return [start + 1, node.end - 2]; // TemplateHead / TemplateMiddle end with ${
}
function isLiteral(node) {
  const k = node.kind;
  return (
    k === ts.SyntaxKind.StringLiteral ||
    k === ts.SyntaxKind.NoSubstitutionTemplateLiteral ||
    k === ts.SyntaxKind.TemplateHead ||
    k === ts.SyntaxKind.TemplateMiddle ||
    k === ts.SyntaxKind.TemplateTail
  );
}
function cooked(node) {
  return node.text;
}
function jsxTagName(opening) {
  return opening.tagName.getText();
}
function jsxAttr(opening, name) {
  return opening.attributes.properties.find((p) => ts.isJsxAttribute(p) && p.name.getText() === name);
}
/** Walk up to the JSX className attribute this literal sits in, if any. */
function classNameAttrOf(node) {
  let n = node.parent;
  while (n) {
    if (ts.isJsxAttribute(n)) return n.name.getText() === 'className' ? n : null;
    if (ts.isJsxElement(n) || ts.isJsxSelfClosingElement(n) || ts.isJsxOpeningElement(n)) return null;
    if (ts.isFunctionLike(n) || ts.isSourceFile(n)) return null;
    n = n.parent;
  }
  return null;
}
function isCheckboxOpening(opening) {
  if (jsxTagName(opening) !== 'input') return false;
  const t = jsxAttr(opening, 'type');
  if (!t || !t.initializer) return false;
  const init = t.initializer;
  const lit = ts.isStringLiteral(init)
    ? init
    : ts.isJsxExpression(init) && init.expression && ts.isStringLiteralLike(init.expression)
      ? init.expression
      : null;
  return !!lit && lit.text === 'checkbox';
}
/** A className attribute is "whole" when its value is one literal: removable if it empties. */
function attrIsSingleLiteral(attr, lit) {
  const init = attr.initializer;
  if (!init) return false;
  if (init === lit) return true;
  return ts.isJsxExpression(init) && init.expression === lit;
}

/** Process one file's text. Returns the new text and the findings. */
export function processSource(rel, text) {
  const kind = rel.endsWith('.ts') ? ts.ScriptKind.TS : ts.ScriptKind.TSX;
  const sf = ts.createSourceFile(rel, text, ts.ScriptTarget.Latest, true, kind);
  const edits = [];
  const f = {
    rings: 0,
    forms: {},
    halos: 0,
    unprefixedHalos: 0,
    split: [],
    identical: [],
    emptied: [],
    checkbox: [],
    rawMismatch: [],
    stacked: [],
    crossLiteral: [],
    noOffset: [],
    removedAttrs: 0,
  };
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const where = (node) => `${rel}:${lineOf(node.getStart(sf))}`;
  const skip = new Set(); // literal nodes not to rewrite (split families)
  const newTextOf = new Map(); // literal node -> rewritten cooked text

  // Pass 1: split families across the pieces of one template (and literals inside its spans).
  const markSplit = (tpl) => {
    const lits = [tpl.head, ...tpl.templateSpans.map((s) => s.literal)];
    const inner = [];
    for (const span of tpl.templateSpans) {
      const visit = (n) => {
        if (ts.isTemplateExpression(n)) return; // nested templates are judged on their own
        if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) inner.push(n);
        ts.forEachChild(n, visit);
      };
      visit(span.expression);
    }
    const pieceChains = lits.map((l) => familyChains(cooked(l)));
    const seen = new Map();
    let split = false;
    for (const s of pieceChains)
      for (const c of s) {
        seen.set(c, (seen.get(c) || 0) + 1);
        if (seen.get(c) > 1) split = true;
      }
    if (!split) {
      for (const l of inner)
        for (const c of familyChains(cooked(l)))
          if (seen.has(c)) split = true;
    }
    if (split) {
      for (const l of [...lits, ...inner]) skip.add(l);
      f.split.push(where(tpl));
    }
  };
  const walk1 = (n) => {
    if (ts.isTemplateExpression(n)) markSplit(n);
    ts.forEachChild(n, walk1);
  };
  walk1(sf);

  // Pass 2: rewrite each literal.
  const walk2 = (n) => {
    if (isLiteral(n) && !skip.has(n) && !ts.isImportDeclaration(n.parent) && !ts.isExportDeclaration(n.parent)) {
      const value = cooked(n);
      const attr = classNameAttrOf(n);
      const opening = attr ? attr.parent.parent : null;
      if (opening && isCheckboxOpening(opening)) {
        const r = rewriteText(value);
        if (r.text !== value) f.checkbox.push(where(n));
      } else {
        const r = rewriteText(value);
        if (r.text !== value) {
          const [s, e] = literalSpan(n, sf);
          const raw = text.slice(s, e);
          if (raw !== value) {
            f.rawMismatch.push(where(n));
          } else {
            f.rings += r.groups.length;
            for (const g of r.groups) {
              f.forms[g.form] = (f.forms[g.form] || 0) + 1;
              if (g.form === 'no offset') f.noOffset.push(`${where(n)} (${value.trim().slice(0, 90)})`);
            }
            f.halos += r.halos;
            f.unprefixedHalos += r.unprefixedHalos;
            newTextOf.set(n, r.text);
            if (r.text.trim() === '') {
              if (attr && attrIsSingleLiteral(attr, n)) {
                edits.push({ start: attr.getFullStart(), end: attr.end, text: '' });
                f.removedAttrs += 1;
              } else {
                f.emptied.push(where(n));
                edits.push({ start: s, end: e, text: r.text });
              }
            } else {
              edits.push({ start: s, end: e, text: r.text });
            }
          }
        }
      }
      // Findings that read the literal as it will stand after the rewrite.
      const after = newTextOf.get(n) ?? value;
      const st = stackedTokens(after);
      if (st.length) f.stacked.push(`${where(n)} (${st.join(' ')})`);
      if (opening && !isCheckboxOpening(opening)) {
        const tag = jsxTagName(opening);
        const base = PRIMITIVE_BASE.get(tag) ?? (tag.startsWith('Tabs') ? 'none' : undefined);
        if (base !== undefined) {
          const forms = ringForm(after);
          const other = [...forms].filter((x) => x !== base);
          if (other.length) f.crossLiteral.push(`${where(n)} <${tag}> passes ${other.join('+')} over base ${base}`);
        }
      }
    }
    ts.forEachChild(n, walk2);
    // A conditional is judged after its arms' own rewrite (children visited above).
    if (ts.isConditionalExpression(n)) {
      const unwrap = (x) => (ts.isParenthesizedExpression(x) ? unwrap(x.expression) : x);
      const a = unwrap(n.whenTrue);
      const b = unwrap(n.whenFalse);
      const litLike = (x) => ts.isStringLiteral(x) || ts.isNoSubstitutionTemplateLiteral(x);
      if (litLike(a) && litLike(b)) {
        const ta = newTextOf.get(a) ?? cooked(a);
        const tb = newTextOf.get(b) ?? cooked(b);
        const ringy = (t) => /focus-ring/.test(t) || hasFamily(t);
        // Two empty arms are what a halo-only conditional leaves after --write: still a hand site.
        if (ta === tb && (ringy(ta) || ta.trim() === '')) f.identical.push(where(n));
      }
    }
  };
  walk2(sf);

  edits.sort((x, y) => y.start - x.start);
  let out = text;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return { text: out, changed: out !== text, findings: f };
}

function blocking(f) {
  return f.split.length + f.rawMismatch.length + f.emptied.length;
}
function strictOnly(f) {
  return f.identical.length + f.stacked.length;
}

function runTree(argv) {
  const write = argv.includes('--write');
  const check = argv.includes('--check');
  const strict = argv.includes('--strict');
  const explicit = argv.filter((a) => !a.startsWith('--'));
  const ls = execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' });
  let files = buildFileList(ls);
  if (write && explicit.length) {
    const want = new Set(explicit.map((p) => path.relative(ROOT, path.resolve(process.cwd(), p))));
    files = files.filter((p) => want.has(p));
  }
  const tot = { rings: 0, ringFiles: 0, forms: {}, halos: 0, haloFiles: 0, unprefixed: 0 };
  const lines = { rewrite: [], split: [], identical: [], emptied: [], checkbox: [], raw: [], stacked: [], cross: [], noOffset: [] };
  let block = 0;
  let strictCount = 0;
  let changedCount = 0;
  for (const rel of files) {
    const abs = path.join(ROOT, rel);
    const text = fs.readFileSync(abs, 'utf8');
    const { text: out, changed, findings: f } = processSource(rel, text);
    if (f.rings) tot.ringFiles += 1;
    if (f.halos) tot.haloFiles += 1;
    tot.rings += f.rings;
    tot.halos += f.halos;
    tot.unprefixed += f.unprefixedHalos;
    for (const [k, v] of Object.entries(f.forms)) tot.forms[k] = (tot.forms[k] || 0) + v;
    if (changed) {
      changedCount += 1;
      lines.rewrite.push(`${write ? 'rewrote' : 'would rewrite'}: ${rel}`);
      if (write) fs.writeFileSync(abs, out);
    }
    lines.split.push(...f.split.map((w) => `split family: ${w}`));
    lines.identical.push(...f.identical.map((w) => `identical arms: ${w}`));
    lines.emptied.push(...f.emptied.map((w) => `emptied literal: ${w}`));
    lines.checkbox.push(...f.checkbox.map((w) => `checkbox skip: ${w}`));
    lines.raw.push(...f.rawMismatch.map((w) => `raw-text mismatch: ${w}`));
    lines.stacked.push(...f.stacked.map((w) => `stacked ring: ${w}`));
    lines.cross.push(...f.crossLiteral.map((w) => `cross-literal ring: ${w}`));
    lines.noOffset.push(...f.noOffset.map((w) => `no-offset: ${w}`));
    block += blocking(f);
    strictCount += strictOnly(f);
  }
  const formOrder = ['offset-2', 'inset', 'no offset', 'offset-1', 'offset-0', 'peer'];
  const formKeys = [...new Set([...formOrder, ...Object.keys(tot.forms)])];
  say(`files read: ${files.length}`);
  say(`ring strings: ${tot.rings} in ${tot.ringFiles} files`);
  say(`  by form: ${formKeys.map((k) => `${k} ${tot.forms[k] || 0}`).join(', ')}`);
  say(`halo tokens: ${tot.halos} in ${tot.haloFiles} files (plus ${tot.unprefixed} unprefixed beside a converted ring)`);
  for (const group of Object.values(lines)) for (const l of group) say(l);
  say(
    `summary: ${changedCount} files to ${write ? 'rewritten' : 'rewrite'}, ${block} blocking hand sites, ${strictCount} strict-only sites`,
  );
  if (check) {
    const fail = (!write && changedCount > 0) || block > 0 || (strict && strictCount > 0);
    say(`RESULT: ${fail ? 'FAIL' : 'PASS'}`);
    process.exitCode = fail ? 1 : 0;
  }
}

function selfTest() {
  const cases = [];
  const rw = (s) => rewriteText(s).text;
  const eq = (name, got, want) => cases.push([name, got === want, `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`]);
  const ok = (name, cond, msg = '') => cases.push([name, !!cond, msg]);

  // 1 the verbatim Button line
  eq(
    '1 Button line',
    rw('focus:outline-hidden focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card'),
    'focus:outline-hidden focus-visible:focus-ring',
  );
  // 2 inset
  eq('2 inset', rw('focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring'), 'focus-visible:focus-ring-inset');
  // 3 Modal close, no offset
  eq('3 no offset', rw('p-2 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring'), 'p-2 focus:outline-hidden focus-visible:focus-ring');
  // 4 offset-1 and offset-0
  eq('4a offset-1', rw('focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-1 x'), 'focus-visible:focus-ring x');
  eq('4b offset-0 inset', rw('w-full focus-visible:ring-inset focus-visible:ring-offset-0'), 'w-full focus-visible:focus-ring-inset');
  eq('4c offset-0', rw('focus-visible:ring-2 focus-visible:ring-offset-0'), 'focus-visible:focus-ring');
  // 5 peer
  eq(
    '5 peer',
    rw('peer-focus-visible:ring-2 peer-focus-visible:ring-focus-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-card'),
    'peer-focus-visible:focus-ring',
  );
  // 6 halo-only Button className attribute removed
  {
    const r = processSource('a.tsx', 'const a = <Button className="focus-visible:ring-offset-surface-page">Go</Button>;\n');
    eq('6 halo-only attr removed', r.text, 'const a = <Button>Go</Button>;\n');
  }
  // 7 dark: halo deleted
  eq('7 dark halo', rw('px-2 dark:focus-visible:ring-offset-surface-page py-1'), 'px-2 py-1');
  // 8 unprefixed halo beside a converted ring; decorative ring untouched
  eq(
    '8a unprefixed halo',
    rw('ring-offset-background focus:outline-hidden focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2'),
    'focus:outline-hidden focus-visible:focus-ring',
  );
  eq('8b decorative', rw('ring-2 ring-blue-500 ring-offset-2 ring-offset-surface-card'), 'ring-2 ring-blue-500 ring-offset-2 ring-offset-surface-card');
  // 9 checkbox skipped and reported
  {
    const src = 'const a = <input type="checkbox" className="h-4 w-4 focus-visible:ring-2 focus-visible:ring-focus-ring" />;\n';
    const r = processSource('a.jsx', src);
    ok('9 checkbox skipped', r.text === src && r.findings.checkbox.length === 1, JSON.stringify(r.findings.checkbox));
  }
  // 10 split across template pieces
  {
    const src = 'const c = `focus-visible:ring-2 ${x} focus-visible:ring-offset-2`;\n';
    const r = processSource('a.ts', src);
    ok('10 split family', r.text === src && r.findings.split.length === 1, JSON.stringify(r.findings));
  }
  // 11 comment untouched
  {
    const src = '// focus-visible:ring-2 focus-visible:ring-focus-ring\nconst a = 1;\n';
    const r = processSource('a.ts', src);
    ok('11 comment untouched', r.text === src && !r.changed);
  }
  // 12 identical arms reported
  {
    const src =
      "const c = on ? 'a focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-card' : 'a focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-page';\n";
    const r = processSource('a.ts', src);
    ok('12 identical arms', r.findings.identical.length === 1, JSON.stringify(r.findings.identical));
    const emptied = processSource('a.ts', "const c = 'x' + (t ? ' focus-visible:ring-offset-surface-page' : ' focus-visible:ring-offset-surface-card');\n");
    ok('12b halo-only arms emptied, then reported as identical', emptied.findings.identical.length === 1, JSON.stringify(emptied.findings));
    ok('12c and still reported after the write', processSource('a.ts', emptied.text).findings.identical.length === 1);
  }
  // 13 raw text differs from cooked text
  {
    const src = "const c = 'focus-visible:ring-2\\u0020focus-visible:ring-focus-ring';\n";
    const r = processSource('a.ts', src);
    ok('13 raw mismatch', r.text === src && r.findings.rawMismatch.length === 1, JSON.stringify(r.findings.rawMismatch));
  }
  // 14 stacked ring reported
  {
    const src = "const c = 'ring-2 ring-chip-rim focus-visible:ring-2 focus-visible:ring-offset-2';\n";
    const r = processSource('a.ts', src);
    ok('14 stacked ring', r.findings.stacked.length === 1 && strictOnly(r.findings) === 1, JSON.stringify(r.findings.stacked));
    const src2 = "const c = 'hover:ring-inset focus-visible:focus-ring-inset';\n";
    ok('14b stacked under a non-focus variant', processSource('a.ts', src2).findings.stacked.length === 1);
  }
  // 15 file list
  {
    const list = buildFileList(
      'src/test-utils/focusRingAssert.ts\nsrc/components/ui/Button.tsx\nsrc/components/ui/Button.test.tsx\nsrc/app/globals.css\n',
    );
    ok('15 file list', list.length === 1 && list[0] === 'src/components/ui/Button.tsx', JSON.stringify(list));
  }
  // 16 Button call site passing the inset form
  {
    const r = processSource('a.tsx', 'const a = <Button className="focus-visible:ring-2 focus-visible:ring-inset">Go</Button>;\n');
    ok(
      '16 cross-literal',
      r.text === 'const a = <Button className="focus-visible:focus-ring-inset">Go</Button>;\n' && r.findings.crossLiteral.length === 1,
      JSON.stringify([r.text, r.findings.crossLiteral]),
    );
  }
  // 17 breakpoint-led halo deleted; its attribute removed
  {
    eq('17a md halo', rw('flex md:focus-visible:ring-offset-surface-page'), 'flex');
    const r = processSource('a.tsx', 'const a = <Button\n  variant="ghost"\n  className="md:focus-visible:ring-offset-surface-page"\n>Go</Button>;\n');
    eq('17b md attr removed', r.text, 'const a = <Button\n  variant="ghost"\n>Go</Button>;\n');
  }
  // extras: an emptied non-JSX literal blocks; the rewrite is idempotent
  {
    const r = processSource('a.ts', "const c = cn('x', 'focus-visible:ring-offset-surface-card');\n");
    ok('18 emptied non-JSX literal blocks', r.findings.emptied.length === 1 && blocking(r.findings) === 1);
    const once = rw('a focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus-ring b');
    eq('19 idempotent', rw(once), once);
  }

  let pass = 0;
  for (const [name, good, msg] of cases) {
    if (good) pass += 1;
    else say(`FAIL ${name}: ${msg}`);
  }
  say(`self-test: ${pass} passed${pass === cases.length ? '' : `, ${cases.length - pass} failed`}`);
  process.exitCode = pass === cases.length ? 0 : 1;
}

// Run only when invoked as a script, so the self-test helpers can be imported.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  if (argv.includes('--self-test')) selfTest();
  else runTree(argv);
}
