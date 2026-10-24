#!/usr/bin/env node
/*
 * comment-only-diff.mjs: the R11 no-behaviour proof for Phase 88.6.2 (SPEC R11,
 * .planning/phases/88.6.2-gates-comments-and-tooling-residuals-from-88-6/88.6.2-SPEC.md
 * ("for every non-test file under")).
 *
 * For every non-test file under src/ that differs between the merge base of <base> and HEAD
 * and the working tree, the before and after versions must yield an identical non-comment
 * token stream, line-break positions included. Every other changed path must sit on the
 * allowlist below. Anything else offends.
 *
 * Usage:     node scripts/comment-only-diff.mjs <base>
 * Exit 0:    every listed path is allowlisted or comment-only (last line RESULT: PASS).
 * Exit 1:    any offending file or any path outside the allowlist (last line RESULT: FAIL),
 *            and also a missing, empty, extra, unknown or dash-leading argument, an
 *            unresolvable base, or any internal error. Fail closed: never exit 0 by accident.
 *
 * Output contract (plan 07's CI step, the phase verifier and plan 30 match these lines):
 *   OFFENDING <path>: <reason>      reason is one of: code change, parse error, walker gap,
 *                                   added, deleted, binary, type change, unsupported
 *                                   extension, unmerged. A code change is followed by a
 *                                   first-difference line, a parse error by the failing
 *                                   side and line, and both by the file's git diff -U0 hunks.
 *   OUTSIDE <path>: <status letter>
 *   comment-only-diff: base <base> merge-base <sha> | listed <n>, allowlisted <n>, outside the
 *     allowlist <n>, checked <n>, comment-only <n>, offending <n>
 *   RESULT: PASS | RESULT: FAIL
 * Errors and usage go to stderr and exit 1.
 *
 * DECISION Phase 88.6.2-02 (D-22): the after side is the WORKING TREE, untracked files
 * included, compared against git merge-base <base> HEAD, chosen OVER the committed-only
 * listing <base>...HEAD that CONTEXT D-22 names. On a clean tree (CI, merge time) the two are
 * identical; the committed-only form would pass a run made before committing vacuously, and
 * later plans of this phase run the check before they commit. Merge-base semantics are kept.
 * Paths are listed with --no-renames, so a rename is a deletion plus an addition and both
 * offend. Parse errors come from the walked SourceFile's parseDiagnostics, chosen OVER
 * ts.transpileModule with reportDiagnostics (D-22's wording): transpileModule throws "Debug
 * Failure. Output generation failed" on src/types/vitest-axe.d.ts and parses the text a
 * second time. If parseDiagnostics is ever not an array (a TypeScript upgrade), the run
 * throws and exits 1. Recorded as SPEC amendment A12. Changing this is a decision, not a
 * cleanup.
 *
 * DECISION Phase 88.6.2-02 (allowlist): the allowlist is SPEC R11's list (e2e/,
 * src/test-utils/, any *.test.* or *.spec.* file, .github/, scripts/, .gitignore,
 * playwright.config.ts, vitest.config.mts) PLUS README.md, chosen OVER the literal list. Plan
 * 88.6.2-27 writes the age decrypt recipe into a new README.md section (RESEARCH PC-8); without
 * the entry the merge-time run fails on a documentation edit. Recorded as SPEC amendment A9.
 * Prefixes end in a slash and root files match exactly, so a near miss such as
 * src/test-utilsX/ is NOT allowlisted. Widening this list is a decision, not a cleanup.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import ts from 'typescript';

const ALLOWLIST_PREFIXES = ['e2e/', 'src/test-utils/', '.github/', 'scripts/'];
const ALLOWLIST_FILES = ['.gitignore', 'playwright.config.ts', 'vitest.config.mts', 'README.md'];
const TEST_FILE_RE = /\.(test|spec)\.[A-Za-z0-9]+$/;
const TS_EXTENSIONS = new Set(['js', 'jsx', 'ts', 'tsx']);
const ENTRY_MAX = 120;
// Built from char codes so the source file holds no raw U+2028/U+2029 (both end a JS line).
const LINE_TERMINATOR_RE = new RegExp('[\\n\\r' + String.fromCharCode(0x2028, 0x2029) + ']');
const USAGE = 'usage: node scripts/comment-only-diff.mjs <base> | --self-test';

// ---------------------------------------------------------------------------------------
// git: argv arrays only, never a shell string; inherited repo-pointing env vars dropped so a
// caller's GIT_DIR can never redirect a run (or a self-test temp repo) at another repo.

function gitEnv() {
  const env = { ...process.env };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  return env;
}

function git(root, args, opts = {}) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: gitEnv(),
    stdio: ['ignore', 'pipe', 'pipe'],
    ...opts,
  });
}

// ---------------------------------------------------------------------------------------
// Token stream (TypeScript leaf walk).

const KIND_NAME = (() => {
  const names = {};
  for (const [name, value] of Object.entries(ts.SyntaxKind)) {
    if (typeof value === 'number' && !(value in names)) names[value] = name;
  }
  return names;
})();

function extOf(p) {
  const base = path.posix.basename(p);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot + 1).toLowerCase();
}

function scriptKindFor(p) {
  const ext = extOf(p);
  if (ext === 'ts') return ts.ScriptKind.TS;
  if (ext === 'tsx') return ts.ScriptKind.TSX;
  if (ext === 'js' || ext === 'jsx') return ts.ScriptKind.JSX;
  throw new Error(`no TypeScript script kind for ${p}`);
}

function isJsDocKind(kind) {
  return kind >= ts.SyntaxKind.FirstJSDocNode && kind <= ts.SyntaxKind.LastJSDocNode;
}

/** Returns { entries: [{ text, line }] } or { parseError: { line, message } }. */
function tsStream(text, p) {
  const sf = ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true, scriptKindFor(p));
  const diags = sf.parseDiagnostics;
  if (!Array.isArray(diags)) {
    throw new Error('SourceFile.parseDiagnostics is not an array (TypeScript API change)');
  }
  if (diags.length > 0) {
    const d = diags[0];
    const line = sf.getLineAndCharacterOfPosition(d.start ?? 0).line + 1;
    return { parseError: { line, message: ts.flattenDiagnosticMessageText(d.messageText, ' ') } };
  }
  const leaves = [];
  (function walk(node) {
    const kids = node.getChildren(sf).filter((c) => !isJsDocKind(c.kind));
    if (kids.length === 0) leaves.push(node);
    else kids.forEach(walk);
  })(sf);
  const entries = [];
  let prevEnd = 0;
  for (const leaf of leaves) {
    const start = leaf.getStart(sf);
    const gap = text.slice(prevEnd, start);
    const nl = LINE_TERMINATOR_RE.test(gap);
    entries.push({
      text: (nl ? 'NL ' : '') + KIND_NAME[leaf.kind] + ':' + text.slice(start, leaf.end),
      line: sf.getLineAndCharacterOfPosition(start).line + 1,
    });
    prevEnd = leaf.end;
  }
  return { entries };
}

/** The stream function for a path, by extension. */
function streamFor(text, p) {
  if (extOf(p) === 'css') return cssStream(text, p);
  return tsStream(text, p);
}

/** First differing index of two entry lists, or null when equal. */
function compareStreams(before, after) {
  const n = Math.max(before.length, after.length);
  for (let i = 0; i < n; i++) {
    const b = before[i];
    const a = after[i];
    if (!b || !a || b.text !== a.text) {
      const flagOnly = Boolean(a && b && a.text.replace(/^NL /, '') === b.text.replace(/^NL /, ''));
      return { index: i, before: b ?? null, after: a ?? null, flagOnly };
    }
  }
  return null;
}

/**
 * Compare two versions of one file. Returns { verdict, ... } where verdict is one of
 * 'equal', 'differ', 'parse error', 'walker gap'. The CLI and the self-test both use this.
 */
function compareTexts(before, after, p) {
  const sb = streamFor(before, p);
  const sa = streamFor(after, p);
  if (sb.parseError || sa.parseError) {
    return { verdict: 'parse error', before: sb.parseError ?? null, after: sa.parseError ?? null };
  }
  if (sb.walkerGap || sa.walkerGap) {
    return { verdict: 'walker gap', before: sb.walkerGap ?? null, after: sa.walkerGap ?? null };
  }
  const diff = compareStreams(sb.entries, sa.entries);
  return diff ? { verdict: 'differ', diff } : { verdict: 'equal' };
}

// ---------------------------------------------------------------------------------------
// Listing and disposition.

/**
 * What to do with one listed path. entry = { path, status, binary }.
 * Returns: allowlisted | outside | compare | added | deleted | type change | unmerged |
 * binary | unsupported extension.
 */
function disposition(entry) {
  const p = entry.path;
  if (ALLOWLIST_PREFIXES.some((prefix) => p.startsWith(prefix))) return 'allowlisted';
  if (ALLOWLIST_FILES.includes(p)) return 'allowlisted';
  if (TEST_FILE_RE.test(path.posix.basename(p))) return 'allowlisted';
  if (!p.startsWith('src/')) return 'outside';
  switch (entry.status) {
    case 'A': return 'added';
    case 'D': return 'deleted';
    case 'T': return 'type change';
    case 'U': return 'unmerged';
    case 'M': break;
    default: throw new Error(`unexpected git status ${JSON.stringify(entry.status)} for ${p}`);
  }
  if (entry.binary) return 'binary';
  if (TS_EXTENSIONS.has(extOf(p))) return 'compare';
  return 'unsupported extension';
}

function splitZ(out) {
  const parts = out.split('\0');
  if (parts.length && parts[parts.length - 1] === '') parts.pop();
  return parts;
}

/** Working tree (untracked included) against the merge base, renames off. */
function listChanges(root, mergeBase) {
  const byPath = new Map();
  const nameStatus = splitZ(git(root, ['diff', '--name-status', '--no-renames', '-z', mergeBase]));
  if (nameStatus.length % 2 !== 0) throw new Error('git diff --name-status -z output has an odd field count');
  for (let i = 0; i < nameStatus.length; i += 2) {
    const status = nameStatus[i].charAt(0);
    const p = nameStatus[i + 1];
    byPath.set(p, { path: p, status, binary: false });
  }
  for (const rec of splitZ(git(root, ['diff', '--numstat', '--no-renames', '-z', mergeBase]))) {
    const m = /^(\S+)\t(\S+)\t([\s\S]*)$/.exec(rec);
    if (!m) throw new Error(`unparseable numstat record ${JSON.stringify(rec)}`);
    if (m[1] === '-' && m[2] === '-') {
      const e = byPath.get(m[3]);
      if (!e) throw new Error(`numstat lists ${m[3]} but name-status does not`);
      e.binary = true;
    }
  }
  for (const p of splitZ(git(root, ['ls-files', '--others', '--exclude-standard', '-z']))) {
    if (!byPath.has(p)) byPath.set(p, { path: p, status: 'A', binary: false, untracked: true });
  }
  return [...byPath.values()].sort((x, y) => (x.path < y.path ? -1 : x.path > y.path ? 1 : 0));
}

// ---------------------------------------------------------------------------------------
// The check.

function quoteEntry(entry) {
  const q = JSON.stringify(entry.text);
  return q.length > ENTRY_MAX ? q.slice(0, ENTRY_MAX - 3) + '...' : q;
}

function sideText(label, entry) {
  return entry ? `${label} line ${entry.line} ${quoteEntry(entry)}` : `${label} (end of file)`;
}

function hunks(root, mergeBase, p) {
  const out = git(root, ['diff', '--no-color', '--no-ext-diff', '-U0', mergeBase, '--', p]);
  return out.split('\n').filter((l) => l !== '').map((l) => '  ' + l);
}

/** Runs the check. Returns { code, lines, counts }; never prints, never exits. Throws on error. */
function runCheck({ root, base }) {
  let baseSha;
  try {
    baseSha = git(root, ['rev-parse', '--verify', '--quiet', `${base}^{commit}`]).trim();
  } catch {
    baseSha = '';
  }
  if (!/^[0-9a-f]{40,64}$/.test(baseSha)) throw new Error(`cannot resolve base ${base}`);
  const mergeBase = git(root, ['merge-base', baseSha, 'HEAD']).trim();
  if (!/^[0-9a-f]{40,64}$/.test(mergeBase)) throw new Error(`no merge base between ${base} and HEAD`);

  const lines = [];
  const counts = { listed: 0, allowlisted: 0, outside: 0, checked: 0, commentOnly: 0, offending: 0 };
  const entries = listChanges(root, mergeBase);
  counts.listed = entries.length;
  for (const entry of entries) {
    const d = disposition(entry);
    if (d === 'allowlisted') { counts.allowlisted++; continue; }
    if (d === 'outside') { counts.outside++; lines.push(`OUTSIDE ${entry.path}: ${entry.status}`); continue; }
    if (d !== 'compare') { counts.offending++; lines.push(`OFFENDING ${entry.path}: ${d}`); continue; }
    counts.checked++;
    const before = git(root, ['show', `${mergeBase}:${entry.path}`]);
    const after = fs.readFileSync(path.join(root, entry.path), 'utf8');
    const r = compareTexts(before, after, entry.path);
    if (r.verdict === 'equal') { counts.commentOnly++; continue; }
    counts.offending++;
    if (r.verdict === 'differ') {
      lines.push(`OFFENDING ${entry.path}: code change`);
      lines.push(
        `  first difference: token ${r.diff.index}, ${sideText('before', r.diff.before)}, ${sideText('after', r.diff.after)}` +
          (r.diff.flagOnly ? ' (line-break-before flag only)' : ''),
      );
    } else {
      lines.push(`OFFENDING ${entry.path}: ${r.verdict}`);
      for (const side of ['before', 'after']) {
        if (r[side]) lines.push(`  ${side} line ${r[side].line}: ${r[side].message}`);
      }
    }
    lines.push(...hunks(root, mergeBase, entry.path));
  }
  if (counts.listed !== counts.allowlisted + counts.outside + counts.commentOnly + counts.offending) {
    throw new Error(`count invariant broken: ${JSON.stringify(counts)}`);
  }
  lines.push(
    `comment-only-diff: base ${base} merge-base ${mergeBase.slice(0, 12)} | listed ${counts.listed}, ` +
      `allowlisted ${counts.allowlisted}, outside the allowlist ${counts.outside}, checked ${counts.checked}, ` +
      `comment-only ${counts.commentOnly}, offending ${counts.offending}`,
  );
  const code = counts.offending > 0 || counts.outside > 0 ? 1 : 0;
  lines.push(code === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { code, lines, counts };
}

// ---------------------------------------------------------------------------------------
// Self-test: every case runs through the SAME functions the CLI uses (compareTexts, which
// dispatches to tsStream or cssStream, and disposition). No fixture files: the cases are
// in-script strings, following scripts/tw4-hazard-grep.sh ("DECISION Phase 87.7 (R4): the
// negative control is the built-in").

const SELF_TEST_CASE_COUNT = 66;

const C = (group, name, file, before, after, expect) => ({
  group,
  name,
  expect,
  run: () => compareTexts(before, after, file).verdict,
});

const IN_MEMORY_CASES = [
  // code/: every one must differ.
  C('code', 'let vs const', 'x.ts', 'const a = 1;', 'let a = 1;', 'differ'),
  C('code', 'x++ vs x--', 'x.ts', 'x++;', 'x--;', 'differ'),
  C('code', '!a vs -a', 'x.ts', 'f(!a);', 'f(-a);', 'differ'),
  C('code', 'regex literal tail', 'x.ts', "s.replace(/\\//g, ' ').split(',');", "s.replace(/\\//g, ' ').split(';');", 'differ'),
  C('code', 'ASI', 'x.ts', 'function f(){ return /*\n*/ 1 }', 'function f(){ return /* */ 1 }', 'differ'),
  C('code', 'string whitespace', 'x.ts', "const a = 'a b';", "const a = 'a  b';", 'differ'),
  C('code', 'jsx url text', 'x.tsx', 'const x = <a>see http://a.com/x</a>;', 'const x = <a>see http://a.com/y</a>;', 'differ'),
  C('code', 'jsx text that looks like a line comment', 'x.tsx', 'const x = <p>\n  // old\n</p>;', 'const x = <p>\n  // new\n</p>;', 'differ'),
  C('code', 'jsx text leading whitespace', 'x.tsx', 'const x = <p>  real</p>;', 'const x = <p> real</p>;', 'differ'),
  C('code', 'jsx comment between two text lines', 'x.tsx', 'const x = <p>\n  a\n  b\n</p>;', 'const x = <p>\n  a\n  {/* c */}\n  b\n</p>;', 'differ'),
  C('code', 'jsx empty container gets an expression', 'x.tsx', 'const x = <p>{/* c */}</p>;', 'const x = <p>{y}</p>;', 'differ'),
  C('code', 'template expression code edit', 'x.ts', 'const t = `${a}b`;', 'const t = `${c}b`;', 'differ'),
  C('code', 'jsx attribute value', 'x.tsx', 'const x = <a b={1}/>;', 'const x = <a b={2}/>;', 'differ'),
  // a postfix ++ (no line break before it) against the same ++ after a line break inside a
  // comment, which ASI turns into a prefix ++ on the next line.
  C('code', 'postfix ++ after a newline', 'x.ts', 'a /* */ ++\nb;', 'a /*\n*/ ++\nb;', 'differ'),
  // the line-break flag's known fail-safe (D-22): a rewrapped inline block comment offends.
  C('code', 'inline block comment rewrapped across lines', 'x.ts', 'foo(a, /* x y */ b);', 'foo(a, /* x\ny */ b);', 'differ'),

  // comment/: every one must compare equal.
  C('comment', 'line and block comment edit', 'x.ts', '// a\nconst a = 1; /* x */', '// bb\n// cc\nconst a = 1; /* yyy */', 'equal'),
  C('comment', 'jsx comment edit', 'x.tsx', 'const x = <p>{/* o */}hi</p>;', 'const x = <p>{/* new */}hi</p>;', 'equal'),
  C('comment', 'template expression comment edit', 'x.ts', 'const t = `${a /* c */}b`;', 'const t = `${a /* dd */}b`;', 'equal'),
  C('comment', 'jsdoc rewrite in a .js file', 'x.js', '/** @param a old */\nfunction f(a){}', '/** @param a new words\n * more */\nfunction f(a){}', 'equal'),
  C('comment', 'jsx comment added between elements', 'x.tsx', 'const x = <div>\n  <span/>\n</div>;', 'const x = <div>\n  <span/>\n  {/* c */}\n</div>;', 'equal'),
  C('comment', 'jsx comment added inline before text', 'x.tsx', 'const x = <p>hi</p>;', 'const x = <p>{/* c */}hi</p>;', 'equal'),
  C('comment', 'jsx comment rewrapped to two lines', 'x.tsx', 'const x = <div>\n  {/* aa bb */}\n  <span/>\n</div>;', 'const x = <div>\n  {/* aa\n  bb */}\n  <span/>\n</div>;', 'equal'),
  C('comment', 'leading docblock removed', 'x.ts', '/** doc */\nimport a from "a";', 'import a from "a";', 'equal'),
  C('comment', 'jsx comment added in a .js file', 'x.js', 'const x = <div>\n  <span/>\n</div>;', 'const x = <div>\n  <span/>\n  {/* c */}\n</div>;', 'equal'),
  C('comment', 'jsx comment added after the last text line', 'x.tsx', 'const x = <p>\n  a\n</p>;', 'const x = <p>\n  a\n  {/* c */}\n</p>;', 'equal'),
  C('comment', 'comment inside a jsx attribute expression', 'x.tsx', 'const x = <a b={1}/>;', 'const x = <a b={/* c */ 1}/>;', 'equal'),
  C('comment', 'multi-line jsx comment deleted in a .jsx file', 'x.jsx', 'const x = <div>\n  {/*\n    one\n    two\n  */}\n  <span/>\n</div>;', 'const x = <div>\n  <span/>\n</div>;', 'equal'),
  C('comment', 'jsx comment deleted between adjacent text', 'x.tsx', 'const x = <p>a{/* c */}b</p>;', 'const x = <p>ab</p>;', 'equal'),

  // css/: comment edits equal, real edits differ.
  C('css', 'comment in a value', 'x.css', 'a{color:red /* x */}', 'a{color:red /* yyy */}', 'equal'),
  C('css', 'comment in a selector', 'x.css', 'a /* x */ b{c:d}', 'a /* yy */ b{c:d}', 'equal'),
  C('css', 'comment in at-rule params', 'x.css', '@media /* x */ (width < 48rem){a{b:c}}', '@media /* yy */ (width < 48rem){a{b:c}}', 'equal'),
  C('css', 'blank line inserted', 'x.css', 'a{\n  b:c;\n  d:e;\n}\nf{g:h}', 'a{\n  b:c;\n\n\n  d:e;\n}\n\n\nf{g:h}', 'equal'),
  C('css', 'comment in a selector deleted', 'x.css', 'a /* x */ b{c:d}', 'a b{c:d}', 'equal'),
  C('css', 'comment mid-value deleted', 'x.css', 'a{margin:1px /* x */ 2px}', 'a{margin:1px 2px}', 'equal'),
  C('css', 'comment before a semicolon deleted', 'x.css', 'a{color:red /* c */;}', 'a{color:red;}', 'equal'),
  C('css', 'rule moved inside another', 'x.css', 'a{x:1} b{y:2}', 'a{x:1; b{y:2}}', 'differ'),
  C('css', 'important added', 'x.css', 'a{x:1}', 'a{x:1 !important}', 'differ'),
  C('css', 'value edit', 'x.css', 'a{x:1}', 'a{x:2}', 'differ'),
  C('css', 'at-rule gains a block', 'x.css', '@layer base;', '@layer base {}', 'differ'),
  C('css', 'quoted string whitespace edit', 'x.css', 'a{content:"a b"}', 'a{content:"a  b"}', 'differ'),

  // parse/: a parse error on either side fails the file.
  C('parse', 'broken .ts', 'x.ts', 'const a = 1;', 'const = 1;', 'parse error'),
  C('parse', 'broken .tsx', 'x.tsx', 'const x = <p/>;', 'const x = <p>;', 'parse error'),
  C('parse', 'broken .js', 'x.js', 'function f() {}', 'function( {', 'parse error'),
  C('parse', 'broken .css', 'x.css', 'a{color:red}', 'a{color:red', 'parse error'),
];

// classify/: disposition rows on hypothetical paths (none of these files need to exist).
const CLASSIFY_ROWS = [
  ['src/app/a.js', 'M', false, 'compare'],
  ['src/app/a.test.tsx', 'M', false, 'allowlisted'],
  ['src/test-utils/sourceScan.ts', 'M', false, 'allowlisted'],
  ['src/test-utilsX/a.ts', 'M', false, 'compare', 'near-miss src/test-utilsX/a.ts'],
  ['e2e/a.spec.ts', 'A', false, 'allowlisted'],
  ['e2eX/a.ts', 'M', false, 'outside'],
  ['scripts/x.mjs', 'A', false, 'allowlisted'],
  ['.github/workflows/ci.yml', 'M', false, 'allowlisted'],
  ['.gitignore', 'M', false, 'allowlisted'],
  ['playwright.config.ts', 'M', false, 'allowlisted'],
  ['vitest.config.mts', 'M', false, 'allowlisted'],
  ['README.md', 'M', false, 'allowlisted'],
  ['package.json', 'M', false, 'outside'],
  ['next.config.js', 'M', false, 'outside'],
  ['sentry.client.config.js', 'M', false, 'outside'],
  ['docs/X.md', 'M', false, 'outside'],
  ['src/app/new.tsx', 'A', false, 'added'],
  ['src/app/old.js', 'D', false, 'deleted'],
  ['src/app/favicon.ico', 'M', true, 'binary'],
  ['src/lib/__fixtures__/games.captured.json', 'M', false, 'unsupported extension'],
  ['src/app/a.js', 'T', false, 'type change'],
  ['src/app/x.test.js.bak', 'M', false, 'unsupported extension', 'near-miss src/app/x.test.js.bak'],
];

const CLASSIFY_CASES = CLASSIFY_ROWS.map(([p, status, binary, expect, name]) => ({
  group: 'classify',
  name: name ?? `${p} ${status}${binary ? ' binary' : ''}`,
  expect,
  run: () => disposition({ path: p, status, binary }),
}));

function selfTest() {
  const cases = [...IN_MEMORY_CASES, ...CLASSIFY_CASES];
  const lines = [];
  let passed = 0;
  for (const c of cases) {
    const id = `${c.group}/${c.name}`;
    try {
      const got = c.run();
      if (got === c.expect) {
        passed++;
        lines.push(`PASS ${id}`);
      } else {
        lines.push(`FAIL ${id}: expected ${c.expect}, got ${got}`);
      }
    } catch (err) {
      lines.push(`FAIL ${id}: threw ${err && err.message ? err.message : String(err)}`);
    }
  }
  const ran = cases.length;
  const ok = passed === ran && ran === SELF_TEST_CASE_COUNT;
  lines.push(
    ok
      ? `self-test: PASS ${passed} of ${ran}`
      : `self-test: FAIL ${passed} of ${ran} (declared ${SELF_TEST_CASE_COUNT})`,
  );
  return { code: ok ? 0 : 1, lines };
}

// ---------------------------------------------------------------------------------------
// CLI wrapper: the only place that prints and exits.

function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') {
    const { code, lines } = selfTest();
    process.stdout.write(lines.join('\n') + '\n');
    return code;
  }
  if (argv.length !== 1 || argv[0] === '' || argv[0].startsWith('-')) {
    process.stderr.write(USAGE + '\n');
    return 1;
  }
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = git(scriptDir, ['rev-parse', '--show-toplevel']).trim();
  const { code, lines } = runCheck({ root, base: argv[0] });
  process.stdout.write(lines.join('\n') + '\n');
  return code;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`comment-only-diff: ERROR ${err && err.message ? err.message : String(err)}\n`);
  process.exitCode = 1;
}
