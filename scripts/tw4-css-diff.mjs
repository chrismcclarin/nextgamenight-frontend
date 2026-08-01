#!/usr/bin/env node
/**
 * scripts/tw4-css-diff.mjs
 *
 * Phase 87.7 (R2/R3 — Validation Layer 3, the phase's highest-yield check).
 *
 * Compares two EMITTED stylesheets selector-by-selector and reports what the v4 build
 * lost, gained, or changed relative to the v3 baseline. This is the evidence behind every
 * "zero visual change" claim in the phase: a utility that silently stops being emitted
 * (Tailwind v3's `bg-opacity-50` is the worked example — it survives the codemod as source
 * text and emits NO CSS in v4) is invisible to a source grep and invisible to a build, and
 * shows up here as an ONLY-IN-A entry.
 *
 * What it proves: for every (at-rule context, selector) pair present in A, whether B still
 * emits it and whether its declarations still say the same thing. What it does NOT prove:
 * that the resulting pixels match — two different declaration texts can render identically
 * and two identical ones can render differently under a changed cascade layer order. Read
 * the output, do not just count it. This is a REVIEW TOOL, not a gate: it always exits 0
 * and the human reading it is the gate.
 *
 * Usage (relative paths resolve against the FE repo root, not the cwd):
 *   node scripts/tw4-css-diff.mjs <baseline.css> <candidate.css>
 *   node scripts/tw4-css-diff.mjs <baseline.css> <candidate.css> --selector .bg-green-
 *   node scripts/tw4-css-diff.mjs <baseline.css> <candidate.css> --show-dupes
 *
 * DUPLICATE SELECTORS are normal here, not a smell: the baseline is the concatenation of
 * every `.next/static/css/*.css` chunk, and Next emits the shared preflight/component
 * layers into more than one chunk. This phase's own `globals.css` also declares `:root`
 * three separate times. Every such collision is AGGREGATED (see parseStylesheet) and
 * counted in a one-line-per-file WARNING. That line names the first few and states the
 * total; `--show-dupes` names all of them (the full list runs to hundreds of selectors on
 * a concatenated baseline, which is why it is not the default).
 *
 * OUTPUT CONTRACT — the one string later verify steps should grep for:
 *   IDENTITY: no differences
 * printed on its own line if and only if ONLY-IN-A, ONLY-IN-B and CHANGED are all empty,
 * and never printed otherwise. Grep for THAT exact line. Do NOT negated-grep the per-section
 * count lines: their wording is not a contract and will silently start passing if it changes.
 * With `--selector` active the marker speaks only about the FILTERED subset, and the run
 * says so explicitly on the line above it.
 *
 * Parses with regex/hand-rolled scanning, NOT an AST — fragile by design (same disclaimer,
 * and same reasoning, as scripts/generate-ai-map.mjs). If it mis-parses something, harden
 * the scanner; don't reach for postcss unless we hit a real wall. It is only ever pointed at
 * machine-generated build output plus this repo's own globals.css.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve relative inputs against the script's own repo root so the command means the same
// thing from any cwd (mirrors generate-ai-map.mjs) — never process.cwd().
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_ROOT = path.resolve(__dirname, '..');

const CONTEXT_SEP = ' >> ';
const KEY_SEP = ' || ';
const DECL_TRUNCATE = 400;

// ──────────────────────────────────────────────────────────────────────────
// CLI
// ──────────────────────────────────────────────────────────────────────────

function usage(code) {
  console.log('usage: node scripts/tw4-css-diff.mjs <baseline.css> <candidate.css> [--selector <substring>] [--show-dupes]');
  process.exit(code);
}

const argv = process.argv.slice(2);
const positional = [];
let selectorFilter = null;
let showDupes = false;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--show-dupes') {
    showDupes = true;
  } else if (a === '--selector') {
    selectorFilter = argv[++i];
    if (!selectorFilter) usage(2);
  } else if (a.startsWith('--selector=')) {
    selectorFilter = a.slice('--selector='.length);
  } else if (a === '-h' || a === '--help') {
    usage(0);
  } else {
    positional.push(a);
  }
}
if (positional.length !== 2) usage(2);

const resolveInput = (p) => (path.isAbsolute(p) ? p : path.resolve(FRONTEND_ROOT, p));
const fileA = resolveInput(positional[0]);
const fileB = resolveInput(positional[1]);
for (const f of [fileA, fileB]) {
  if (!fs.existsSync(f)) {
    console.error(`::error:: not found: ${f}`);
    process.exit(2);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Parsing
// ──────────────────────────────────────────────────────────────────────────

/** Strip /* … *\/ comments without touching quoted strings. */
function stripComments(css) {
  let out = '';
  let i = 0;
  let quote = null;
  while (i < css.length) {
    const c = css[i];
    if (quote) {
      out += c;
      if (c === '\\') { out += css[i + 1] ?? ''; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; out += c; i++; continue; }
    if (c === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      i = end === -1 ? css.length : end + 2;
      out += ' ';
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

const norm = (s) => s.replace(/\s+/g, ' ').trim();

/** Split a selector list on TOP-LEVEL commas only — `:is(a,b)` / `:not(x,y)` stay whole. */
function splitSelectors(prelude) {
  const parts = [];
  let depth = 0;
  let quote = null;
  let buf = '';
  for (let i = 0; i < prelude.length; i++) {
    const c = prelude[i];
    if (quote) {
      buf += c;
      if (c === '\\') { buf += prelude[i + 1] ?? ''; i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { buf += c + (prelude[i + 1] ?? ''); i++; continue; }
    if (c === '"' || c === "'") { quote = c; buf += c; continue; }
    if (c === '(' || c === '[') depth++;
    if (c === ')' || c === ']') depth--;
    if (c === ',' && depth === 0) { parts.push(norm(buf)); buf = ''; continue; }
    buf += c;
  }
  if (norm(buf)) parts.push(norm(buf));
  return parts.filter(Boolean);
}

/** Index of the `}` matching the `{` at `open`, quote- and escape-aware. */
function matchBrace(css, open) {
  let depth = 0;
  let quote = null;
  for (let i = open; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
  }
  return css.length;
}

/** Does this block body contain a nested rule (i.e. is it an at-rule WRAPPER)? */
function hasNestedRule(body) {
  let quote = null;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quote) {
      if (c === '\\') { i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === '\\') { i++; continue; }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === '{') return true;
  }
  return false;
}

/**
 * Parse a stylesheet into a Map keyed by the PAIR (at-rule context chain, selector).
 *
 * Keying on the selector ALONE is the bug this avoids: `globals.css` declares `:root` in
 * three separate places, and Tailwind's output repeats selectors across `@media` and layer
 * wrappers. A selector-only map lets a later occurrence overwrite an earlier one, hiding
 * real declarations from the comparison entirely.
 *
 * Even with context keying, a TRUE duplicate (same context, same selector — legal CSS) can
 * still occur. Those are AGGREGATED (both declaration texts kept, joined) and reported in a
 * per-file warning; they are never resolved by last-write-wins and never silently dropped.
 */
function parseStylesheet(file) {
  const css = stripComments(fs.readFileSync(file, 'utf8'));
  const entries = new Map(); // key -> { context, selector, decls }
  const dupes = new Set();
  let ruleCount = 0;

  function walk(text, context) {
    let buf = '';
    let i = 0;
    let quote = null;
    while (i < text.length) {
      const c = text[i];
      if (quote) {
        buf += c;
        if (c === '\\') { buf += text[i + 1] ?? ''; i += 2; continue; }
        if (c === quote) quote = null;
        i++;
        continue;
      }
      if (c === '"' || c === "'") { quote = c; buf += c; i++; continue; }
      if (c === '\\') { buf += c + (text[i + 1] ?? ''); i += 2; continue; }

      if (c === ';') {
        // A statement at-rule such as `@charset "utf-8";` or `@import …;`. Recorded as its
        // own entry so its appearance/disappearance is visible in the diff.
        const stmt = norm(buf);
        if (stmt.startsWith('@')) add(context, `${stmt};`, '');
        buf = '';
        i++;
        continue;
      }

      if (c === '{') {
        const close = matchBrace(text, i);
        const body = text.slice(i + 1, close);
        const prelude = norm(buf);
        if (hasNestedRule(body)) {
          // An at-rule WRAPPER (@media / @supports / @layer / @container / @keyframes …).
          // Its own header text becomes part of the context chain for everything inside.
          walk(body, context.concat(prelude));
        } else {
          // A rule. Comma-separated selector lists become one entry EACH, so `.a,.b{x}`
          // yields two entries and a v4 build that keeps only `.a` is visible.
          const decls = norm(body);
          for (const sel of splitSelectors(prelude)) add(context, sel, decls);
          ruleCount++;
        }
        buf = '';
        i = close + 1;
        continue;
      }

      buf += c;
      i++;
    }
  }

  function add(context, selector, decls) {
    const ctx = context.join(CONTEXT_SEP);
    const key = ctx + KEY_SEP + selector;
    const prev = entries.get(key);
    if (prev) {
      dupes.add(selector);
      prev.decls = prev.decls ? `${prev.decls} ${decls}` : decls; // aggregate, never drop
    } else {
      entries.set(key, { context: ctx, selector, decls });
    }
  }

  walk(css, []);
  return { entries, dupes, ruleCount };
}

// ──────────────────────────────────────────────────────────────────────────
// Diff + report
// ──────────────────────────────────────────────────────────────────────────

const A = parseStylesheet(fileA);
const B = parseStylesheet(fileB);

const matchesFilter = (e) =>
  !selectorFilter || e.selector.includes(selectorFilter) || e.context.includes(selectorFilter);

const onlyInA = [];
const onlyInB = [];
const changed = [];

for (const [key, e] of A.entries) {
  if (!matchesFilter(e)) continue;
  const other = B.entries.get(key);
  if (!other) onlyInA.push(e);
  else if (other.decls !== e.decls) changed.push({ ...e, before: e.decls, after: other.decls });
}
for (const [key, e] of B.entries) {
  if (!matchesFilter(e)) continue;
  if (!A.entries.has(key)) onlyInB.push(e);
}

const trunc = (s) => (s.length > DECL_TRUNCATE ? `${s.slice(0, DECL_TRUNCATE)} …[truncated]` : s);
const label = (e) => (e.context ? `[${e.context}] ${e.selector}` : e.selector);

console.log('tw4-css-diff — Phase 87.7 Validation Layer 3 (review tool; always exits 0)');
console.log(`A (baseline):  ${fileA}  — ${A.entries.size} keys / ${A.ruleCount} rules`);
console.log(`B (candidate): ${fileB}  — ${B.entries.size} keys / ${B.ruleCount} rules`);
if (selectorFilter) console.log(`filter:        --selector ${selectorFilter}`);
console.log('');

const DUPE_PREVIEW = 12;
for (const [file, parsed] of [[fileA, A], [fileB, B]]) {
  if (parsed.dupes.size) {
    const all = [...parsed.dupes].sort();
    const shown = showDupes ? all : all.slice(0, DUPE_PREVIEW);
    const more = all.length - shown.length;
    console.log(
      `WARNING ${file}: ${parsed.dupes.size} selector(s) appear more than once in the SAME at-rule context; ` +
      `their declarations were AGGREGATED, not overwritten: ${shown.join(', ')}` +
      (more > 0 ? ` … +${more} more (--show-dupes names every one)` : '')
    );
  }
}
if (A.dupes.size || B.dupes.size) console.log('');

console.log(`ONLY-IN-A (${onlyInA.length})  — present in the baseline, ABSENT from the candidate; the dangerous class`);
for (const e of onlyInA) console.log(`  ${label(e)}\n      { ${trunc(e.decls)} }`);
console.log('');
console.log(`ONLY-IN-B (${onlyInB.length})  — new in the candidate`);
for (const e of onlyInB) console.log(`  ${label(e)}\n      { ${trunc(e.decls)} }`);
console.log('');
console.log(`CHANGED (${changed.length})  — same (context, selector), different declarations`);
for (const e of changed) console.log(`  ${label(e)}\n    - ${trunc(e.before)}\n    + ${trunc(e.after)}`);
console.log('');

if (onlyInA.length === 0 && onlyInB.length === 0 && changed.length === 0) {
  if (selectorFilter) console.log(`(scope: only entries matching --selector ${selectorFilter})`);
  console.log('IDENTITY: no differences');
}

process.exit(0);
