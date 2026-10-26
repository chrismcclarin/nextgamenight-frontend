#!/usr/bin/env node
/**
 * ANCHOR-CITE CHECK — Phase 88.6.2, plan 03 (SPEC R3 Target a, CONTEXT D-11).
 *
 * A cite in living source names its target by the repo-root path, one space and ONE
 * double-quoted snippet in parentheses, for example
 *   src/lib/logger.ts ("Sentry.captureMessage(msg")
 * and the snippet must occur EXACTLY ONCE in that target. This script walks every
 * js, jsx, ts, tsx, mjs, cjs and css file under src and e2e, finds every such cite,
 * resolves its path from the repo root and counts the snippet in the target.
 *
 * DECISION Phase 88.6.2-03 (D-07): one rule, every anchor a double-quoted snippet
 * occurring exactly once in its target, chosen OVER DECISION-id anchors that pass at
 * "at least one hit". The owner's question settled it: "why we don't want a unique
 * code every time?". An anchor landing on eight places cannot catch a cite that has
 * drifted onto the wrong one, and the at-least-one exception was convenience, not
 * correctness. Changing this is a decision, not a cleanup.
 *
 * DECISION Phase 88.6.2-03 (PC-9): the older cite idioms are NOT matched, chosen OVER a
 * checker that reds them all on day one. The backtick anchor idiom (a file:line followed by
 * the word anchor and a backticked token), backtick-wrapped path cites and still-correct
 * file:line cites each convert to the anchor form when their file is next touched (owner
 * ruling B); the line-cite ratchet keeps their count falling meanwhile. The one cite already
 * in the new shape, with a bare filename, was converted in this checker's own commit, so the
 * tree was red before that commit and green after it.
 *
 * DECISION Phase 88.6.2-03 (A7): planning: is skipped exactly like backend: and node_modules:,
 * chosen OVER resolving parent-repo paths, because CI checks out the FE repo alone and such a
 * path can never resolve there. Skips are counted on the counts line, so a growth is visible.
 * A backend: path is the BACKEND REPO-ROOT path, shape-checked to start Sonnet/ or .github/
 * (nothing is opened), chosen OVER Sonnet-relative paths, which hide a prefix the reader must
 * re-add before git show can find the file. An unknown prefix is no prefix: its path is checked.
 *
 * DECISION Phase 88.6.2-03 (grammar): five choices, each over a named alternative.
 *   1. A same-file cite is written this file ("snippet") and its snippet occurs exactly twice
 *      in that file, chosen OVER a bare parenthesised quote, because about 130 prose quotes in
 *      70 files already have that shape and could not be told apart from a cite; and OVER
 *      direction words such as above or below, which go stale when code moves, the very rot
 *      anchors exist to cure.
 *   2. Every occurrence is counted, overlapping ones included, chosen OVER grep -cF's count of
 *      matching LINES: a snippet twice on one line is still two places. grep -cF stays the
 *      quick hand check.
 *   3. Targets carry one of a CLOSED list of extensions (TARGET_EXTS), chosen OVER any
 *      extension, because prose such as PAGE_STATES.ERROR or "at 2.17" would read as paths.
 *   4. Raw text is scanned, comments and strings alike, chosen OVER a comment-only scan: that
 *      needs a lexer, a lexer copy is what the shared-module rule in src/test-utils/sourceScan.ts
 *      forbids, and the shared lexer is a ts module plain node cannot import on CI's Node 20.
 *      A cite inside a string is still read and followed by people.
 *   5. Forbidden targets are decided before any file-system call and never opened: a segment
 *      starting .env, an .auth or .git segment, a leading node_modules segment, a path outside
 *      the root, and (by an lstat walk from the root down, before any read) a symbolic link at
 *      any segment. Chosen OVER realpath-then-recheck, which still opens a path the link chose.
 *      Consequence guarded: env and session files are never read by any route, including a
 *      tool Claude runs.
 *
 * USAGE (from the FE checkout root, Node 20 or later):
 *   node scripts/anchor-cite-check.mjs              walk src + e2e of this checkout
 *   node scripts/anchor-cite-check.mjs --root DIR   walk src + e2e of DIR instead
 *
 * OUTPUT CONTRACT (stdout):
 *   VIOLATION FILE:LINE KIND: DETAIL      one per violation, sorted by file then line
 *   anchor-cite-check: walked N files | cites N: checked N (cross-file N, same-file N),
 *     skipped N (backend N, node_modules N, planning N) | violations N   (one line)
 *   EMPTY: 0 checkable cites (walked N files)    when nothing was checked (fails)
 *   RESULT: PASS | RESULT: FAIL                  always the last line
 * Errors and usage go to stderr. Exit 0 only on RESULT: PASS; every other path,
 * an exception included, exits 1. The script writes nothing inside the checkout.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const TARGET_EXTS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'mts', 'cts', 'css', 'json', 'md', 'yml', 'yaml', 'sh', 'html', 'svg', 'txt'];
const WALK_DIRS = ['src', 'e2e'];
const WALK_EXTS = ['js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs', 'css'];
const KINDS = ['malformed', 'backtick', 'line-cite-snippet', 'block-comment-end', 'forbidden-target', 'outside-root', 'unresolved', 'self-path', 'count', 'wrapped'];

const PREFIXES = ['backend:', 'node_modules:', 'planning:'];
const BACKEND_ROOTS = ['Sonnet/', '.github/'];

const USAGE = 'usage: node scripts/anchor-cite-check.mjs [--root <dir> | --self-test]';
const PATH_CHAR = 'A-Za-z0-9_@.\\[\\]\\/-';
// Longest extension first, so ts never shadows tsx inside the alternation.
const EXT_ALT = [...TARGET_EXTS].sort((a, b) => b.length - a.length).join('|');
// A path-led cite: a maximal run of path characters ending in a TARGET_EXTS extension,
// then exactly one space and the opener. Lowercase extensions only, so prose such as
// PAGE_STATES.ERROR or "at 2.17" never reads as a path.
const PATH_CITE_RE = new RegExp(`(?<![${PATH_CHAR}])([${PATH_CHAR}]+\\.(?:${EXT_ALT})) \\("`, 'g');
// A same-file cite: the two-word lead, never glued to a word on its left.
const SAME_FILE_RE = /(?<![A-Za-z0-9_])[Tt]his file \("/g;
// The tails the wrapped scan looks for at the end of a line.
const PATH_TAIL_RE = new RegExp(`(?<![${PATH_CHAR}])[${PATH_CHAR}]+\\.(?:${EXT_ALT})$`);
const SAME_FILE_TAIL_RE = /(?<![A-Za-z0-9_])[Tt]his file$/;
// The comment leaders the wrapped scan strips from the next line: JSX, block, line, star.
const LEADER_RE = /^(?:\{\/\*+|\/\*+|\/\/+|\*+)\s*/;
// A snippet that is itself a file:line string (D-06).
const LINE_CITE_RE = new RegExp(`\\.(?:${EXT_ALT}):[0-9]`);

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function walk(root) {
  const present = WALK_DIRS.filter((d) => {
    try {
      return fs.lstatSync(path.join(root, d)).isDirectory();
    } catch {
      return false;
    }
  });
  if (present.length === 0) throw new Error(`neither ${WALK_DIRS.join(' nor ')} exists under ${root}`);
  const out = [];
  const visit = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const e of entries) {
      const abs = path.join(dir, e.name);
      // Dirent types come from lstat: a symlinked directory or file is neither, so it is not walked.
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git') continue;
        visit(abs);
      } else if (e.isFile()) {
        const ext = e.name.includes('.') ? e.name.slice(e.name.lastIndexOf('.') + 1) : '';
        if (WALK_EXTS.includes(ext)) out.push(toPosix(path.relative(root, abs)));
      }
    }
  };
  for (const d of present) visit(path.join(root, d));
  return out;
}

function lineStarts(text) {
  const starts = [0];
  for (let i = 0; i < text.length; i += 1) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return starts;
}

function lineOf(starts, index) {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// Reads the snippet after the opener. One snippet, closed on the same line, never empty,
// and never holding a double quote: the first double quote after the opener must be the close.
function readSnippet(text, open) {
  const nl = text.indexOf('\n', open);
  const lineEnd = nl === -1 ? text.length : nl;
  const q = text.indexOf('"', open);
  if (q === -1 || q >= lineEnd) {
    return { snippet: null, end: lineEnd, problem: 'no closing quote and parenthesis on the line', raw: text.slice(open, lineEnd) };
  }
  if (text[q + 1] !== ')') {
    return { snippet: null, end: q + 1, problem: 'a double quote before the close (one snippet per cite, and a snippet never holds a double quote)', raw: text.slice(open, lineEnd) };
  }
  if (q === open) return { snippet: null, end: q + 2, problem: 'empty snippet', raw: '' };
  return { snippet: text.slice(open, q), end: q + 2, problem: null, raw: text.slice(open, q) };
}

function findCites(text, rel) {
  const starts = lineStarts(text);
  const cites = [];
  const push = (form, index, openLen, citePath) => {
    const open = index + openLen;
    let start = index;
    let prefix = null;
    if (form === 'cross') {
      for (const p of PREFIXES) {
        const at = index - p.length;
        if (at >= 0 && text.slice(at, index) === p && (at === 0 || !/[A-Za-z0-9_]/.test(text[at - 1]))) {
          prefix = p;
          start = at;
          break;
        }
      }
    }
    const s = readSnippet(text, open);
    const ls = starts[lineOf(starts, index) - 1];
    const nl = text.indexOf('\n', ls);
    cites.push({
      file: rel,
      line: lineOf(starts, index),
      form,
      path: citePath,
      prefix,
      snippet: s.snippet,
      problem: s.problem,
      raw: s.raw,
      before: start > 0 ? text[start - 1] : '',
      after: s.problem === null ? text[s.end] ?? '' : '',
      lineText: text.slice(ls, nl === -1 ? text.length : nl),
    });
  };
  PATH_CITE_RE.lastIndex = 0;
  for (let m = PATH_CITE_RE.exec(text); m !== null; m = PATH_CITE_RE.exec(text)) push('cross', m.index, m[0].length, m[1]);
  SAME_FILE_RE.lastIndex = 0;
  for (let m = SAME_FILE_RE.exec(text); m !== null; m = SAME_FILE_RE.exec(text)) push('same', m.index, m[0].length, null);
  return cites;
}

// A cite split across two lines: a line ending in a path token (or the same-file lead) whose
// next line opens with the opener after its comment leader. It is a violation, not a cite.
function findWrapped(text, rel) {
  const out = [];
  const lines = text.split('\n');
  for (let i = 0; i + 1 < lines.length; i += 1) {
    const tail = lines[i].trimEnd();
    const m = tail.match(PATH_TAIL_RE) || tail.match(SAME_FILE_TAIL_RE);
    if (!m) continue;
    const next = lines[i + 1].trimStart().replace(LEADER_RE, '');
    if (next.startsWith('("')) {
      out.push({ file: rel, line: i + 1, kind: 'wrapped', detail: `${m[0]} / ${next.slice(0, 60)}: a cite is split across two lines, keep the path and its snippet on one line` });
    }
  }
  return out;
}

function countOccurrences(text, snippet) {
  if (!snippet) return 0;
  let n = 0;
  for (let i = text.indexOf(snippet); i !== -1; i = text.indexOf(snippet, i + 1)) n += 1;
  return n;
}

function isForbidden(citePath) {
  const segs = citePath.split('/');
  return segs.some((s) => /^\.env/i.test(s) || /^\.(auth|git)$/i.test(s)) || /^node_modules$/i.test(segs[0]);
}

// Resolves a cite path from the root WITHOUT reading any target: exact-case, canonical, inside
// the root, and no symbolic link at any segment (lstat walk, before any read). Returns
// { abs } or { kind, why }.
function resolveExact(root, citePath) {
  if (isForbidden(citePath)) return { kind: 'forbidden-target', why: 'names an env, session, git or node_modules path, which is never opened' };
  const abs = path.resolve(root, citePath);
  const fromRoot = path.relative(root, abs);
  if (fromRoot === '' || fromRoot === '..' || fromRoot.startsWith(`..${path.sep}`) || path.isAbsolute(fromRoot)) {
    return { kind: 'outside-root', why: 'resolves outside the repo root, which is never opened' };
  }
  if (path.posix.normalize(citePath) !== citePath) return { kind: 'unresolved', why: 'the path is not canonical (no ./, ../ or doubled slash)' };
  const segs = citePath.split('/');
  let cur = root;
  for (let i = 0; i < segs.length; i += 1) {
    let names;
    try {
      names = fs.readdirSync(cur);
    } catch {
      return { kind: 'unresolved', why: 'the path does not resolve to a file from the repo root' };
    }
    if (!names.includes(segs[i])) {
      return { kind: 'unresolved', why: `the path does not resolve to a file from the repo root (no exact-case ${segs.slice(0, i + 1).join('/')})` };
    }
    cur = path.join(cur, segs[i]);
    const st = fs.lstatSync(cur);
    if (st.isSymbolicLink()) return { kind: 'forbidden-target', why: `symlink at ${segs.slice(0, i + 1).join('/')}, which is never followed` };
    const last = i === segs.length - 1;
    if (last ? !st.isFile() : !st.isDirectory()) return { kind: 'unresolved', why: 'the path does not resolve to a file from the repo root' };
  }
  return { abs };
}

// The checks every cite gets, in order; the first that fails is the cite's one violation.
function shapeViolation(c) {
  if (c.problem !== null) return { kind: 'malformed', why: c.problem };
  if (c.snippet.includes('`') || c.before === '`' || c.after === '`') return { kind: 'backtick', why: 'a cite carries no backtick, inside or around it (CF-9)' };
  if (LINE_CITE_RE.test(c.snippet)) return { kind: 'line-cite-snippet', why: 'a snippet is never itself a file:line string (D-06)' };
  if (c.snippet.includes('*/') && !c.lineText.trim().startsWith('//')) {
    return { kind: 'block-comment-end', why: 'the block-comment end may appear in a snippet only on a // comment line (CF-9)' };
  }
  return null;
}

function checkTree(root) {
  const files = walk(root);
  const counts = { walked: files.length, cites: 0, checked: 0, crossFile: 0, sameFile: 0, skipped: 0, backend: 0, nodeModules: 0, planning: 0, violations: 0 };
  const violations = [];
  const PREFIX_KEY = { 'backend:': 'backend', 'node_modules:': 'nodeModules', 'planning:': 'planning' };
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    violations.push(...findWrapped(text, rel));
    for (const c of findCites(text, rel)) {
      counts.cites += 1;
      const lead = c.form === 'same' ? 'this file' : `${c.prefix ?? ''}${c.path}`;
      const shown = c.problem === null ? `${lead} ("${c.snippet}")` : `${lead} ("${c.raw.slice(0, 60)}`;
      let v = shapeViolation(c);
      if (!v && c.prefix) {
        if (c.prefix === 'backend:' && !BACKEND_ROOTS.some((r) => c.path.startsWith(r))) {
          v = { kind: 'malformed', why: `backend: takes the backend repo-root path (it starts ${BACKEND_ROOTS.join(' or ')})` };
        } else {
          // Skipped by prefix: nothing is resolved, nothing is opened (A7).
          counts.skipped += 1;
          counts[PREFIX_KEY[c.prefix]] += 1;
          continue;
        }
      }
      counts.checked += 1;
      if (c.form === 'same') counts.sameFile += 1;
      else counts.crossFile += 1;
      if (!v && c.form === 'same') {
        const n = countOccurrences(text, c.snippet);
        if (n !== 2) v = { kind: 'count', detail: `("${c.snippet}") occurs ${n} times in ${rel}, expected 2` };
      } else if (!v) {
        const r = resolveExact(root, c.path);
        if (r.kind) v = r;
        else if (toPosix(path.relative(root, r.abs)) === rel) v = { kind: 'self-path', why: 'the target is the citing file, write this file ("snippet") instead' };
        else {
          const n = countOccurrences(fs.readFileSync(r.abs, 'utf8'), c.snippet);
          if (n !== 1) v = { kind: 'count', detail: `("${c.snippet}") occurs ${n} times in ${c.path}, expected 1` };
        }
      }
      if (v) violations.push({ file: rel, line: c.line, kind: v.kind, detail: v.detail ?? `${shown}: ${v.why}` });
    }
  }
  violations.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : a.line - b.line));
  counts.violations = violations.length;
  const lines = violations.map((v) => `VIOLATION ${v.file}:${v.line} ${v.kind}: ${v.detail}`);
  lines.push(
    `anchor-cite-check: walked ${counts.walked} files | cites ${counts.cites}: checked ${counts.checked} ` +
      `(cross-file ${counts.crossFile}, same-file ${counts.sameFile}), skipped ${counts.skipped} ` +
      `(backend ${counts.backend}, node_modules ${counts.nodeModules}, planning ${counts.planning}) | violations ${counts.violations}`,
  );
  const empty = counts.checked === 0;
  if (empty) lines.push(`EMPTY: 0 checkable cites (walked ${counts.walked} files)`);
  const code = empty || violations.length > 0 ? 1 : 0;
  lines.push(code === 0 ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { code, lines, counts, violations, empty };
}

// ---------------------------------------------------------------------------------------------
// Self-test: every case is a throwaway tree written under os.tmpdir() (prefix anchor-selftest-),
// checked with the same checkTree the CLI runs, then removed. Nothing is written in the checkout.
// Foo names a citing file, Bar a target. A case with setup() gets the root <tmp>/root, so a
// sibling <tmp>/outside can hold what a symlink points at.
// ---------------------------------------------------------------------------------------------
const SELF_TEST_CASE_COUNT = 22;
const SELF_TEST_CASES = [
  {
    name: 'cross-once',
    files: { 'src/Foo.js': '// see src/Bar.js ("alpha beta")\n', 'src/Bar.js': "const s = 'alpha beta';\n" },
    expect: { code: 0, kinds: [], empty: false, counts: { cites: 1, checked: 1, crossFile: 1 } },
  },
  {
    name: 'cross-twice-lines',
    files: { 'src/Foo.js': '// see src/Bar.js ("alpha")\n', 'src/Bar.js': 'alpha\nalpha\n' },
    expect: { code: 1, kinds: ['count'], empty: false },
  },
  {
    name: 'cross-twice-one-line',
    files: { 'src/Foo.js': '// see src/Bar.js ("alpha")\n', 'src/Bar.js': 'alpha alpha\n' },
    expect: { code: 1, kinds: ['count'], empty: false },
  },
  {
    name: 'cross-absent',
    files: { 'src/Foo.js': '// see src/Bar.js ("alpha")\n', 'src/Bar.js': 'const s = 1;\n' },
    expect: { code: 1, kinds: ['count'], empty: false },
  },
  {
    name: 'bare-filename',
    files: { 'src/Foo.js': '// see Bar.js ("alpha")\n', 'src/lib/Bar.js': 'alpha\n' },
    expect: { code: 1, kinds: ['unresolved'], empty: false },
  },
  {
    name: 'wrong-case-and-dot',
    files: {
      'src/Foo.js': '// see src/baz/Bar.js ("alpha")\n// see src/./Baz/Bar.js ("alpha")\n',
      'src/Baz/Bar.js': 'alpha\n',
    },
    expect: { code: 1, kinds: ['unresolved', 'unresolved'], empty: false },
  },
  {
    name: 'outside-root',
    files: { 'src/Foo.js': '// see ../Bar.js ("alpha")\n' },
    expect: { code: 1, kinds: ['outside-root'], empty: false },
  },
  {
    name: 'same-file-ok',
    files: { 'src/Foo.js': "const g = 'gamma delta';\n// see this file (\"gamma delta\")\n" },
    expect: { code: 0, kinds: [], empty: false, counts: { cites: 1, checked: 1, crossFile: 0, sameFile: 1 } },
  },
  {
    name: 'same-file-thrice',
    files: { 'src/Foo.js': "const g = 'gamma delta';\n// see this file (\"gamma delta\")\nconst h = 'gamma delta';\n" },
    expect: { code: 1, kinds: ['count'], empty: false },
  },
  {
    name: 'self-path',
    files: { 'src/Foo.js': '// see src/Foo.js ("gamma")\nconst gamma = 1;\n' },
    expect: { code: 1, kinds: ['self-path'], empty: false },
  },
  {
    name: 'prefixes-skipped',
    files: {
      'src/Foo.js':
        '// backend:Sonnet/models/Bar.js ("one")\n// node_modules:pkg/Bar.js ("two")\n' +
        '// planning:.planning/Bar.md ("three")\n// see src/Bar.js ("alpha beta")\n',
      'src/Bar.js': "const s = 'alpha beta';\n",
    },
    expect: { code: 0, kinds: [], empty: false, counts: { cites: 4, checked: 1, skipped: 3, backend: 1, nodeModules: 1, planning: 1 } },
  },
  {
    name: 'only-skipped',
    files: {
      'src/Foo.js':
        '// backend:Sonnet/models/Bar.js ("one")\n// node_modules:pkg/Bar.js ("two")\n// planning:.planning/Bar.md ("three")\n',
    },
    expect: { code: 1, kinds: [], empty: true, counts: { cites: 3, checked: 0, skipped: 3 } },
  },
  {
    name: 'empty-tree',
    files: { 'src/Foo.js': 'const x = 1;\n' },
    expect: { code: 1, kinds: [], empty: true, counts: { cites: 0 } },
  },
  {
    // None of the three targets exists on disk: unresolved here would mean it was looked up.
    name: 'forbidden-target',
    files: { 'src/Foo.js': '// see .auth/Bar.json ("a")\n// see node_modules/pkg/Bar.js ("b")\n// see .env.Bar.json ("c")\n' },
    expect: { code: 1, kinds: ['forbidden-target', 'forbidden-target', 'forbidden-target'], empty: false },
  },
  {
    name: 'line-cite-snippet',
    files: { 'src/Foo.js': '// see src/Bar.js ("Foo.tsx:12")\n', 'src/Bar.js': 'Foo.tsx:12\n' },
    expect: { code: 1, kinds: ['line-cite-snippet'], empty: false },
  },
  {
    name: 'backtick',
    files: { 'src/Foo.js': '// see src/Bar.js ("al`pha")\n// see `src/Bar.js ("alpha")`\n', 'src/Bar.js': 'al`pha x\nalpha\n' },
    expect: { code: 1, kinds: ['backtick', 'backtick'], empty: false },
  },
  {
    // Only the block-comment line fails; the // line may hold the block-comment end (D-09 ii).
    name: 'block-comment-end',
    files: { 'src/Foo.js': ' * see src/Bar.js ("x */ y")\n// see src/Bar.js ("p */ q")\n', 'src/Bar.js': 'x */ y\np */ q\n' },
    expect: { code: 1, kinds: ['block-comment-end'], empty: false },
  },
  {
    name: 'malformed',
    files: {
      'src/Foo.js':
        '// see src/Bar.js ("alpha\n// see src/Bar.js ("alpha" and "beta")\n// see src/Bar.js ("")\n// backend:routes/Bar.js ("four")\n',
      'src/Bar.js': 'alpha\n',
    },
    expect: { code: 1, kinds: ['malformed', 'malformed', 'malformed', 'malformed'], empty: false },
  },
  {
    name: 'wrapped',
    files: { 'src/Foo.js': '// pinned by src/Bar.js\n// ("alpha beta")\n', 'src/Bar.js': 'alpha beta\n' },
    expect: { code: 1, kinds: ['wrapped'], empty: true, counts: { cites: 0 } },
  },
  {
    // None of the five shapes is a cite, and json is not walked (PC-9).
    name: 'ignored-shapes',
    files: {
      'src/Foo.js':
        '// see src/Bar.js ("alpha beta")\n// the label ("Save")\n// PAGE_STATES.ERROR ("x")\n// at 2.17 ("y")\n' +
        '// src/Foo.tsx:12 anchor `token`\n// see `src/Bar.js` ("alpha beta")\n',
      'src/Foo.json': 'see src/Baz.js ("zzz")\n',
      'src/Bar.js': "const s = 'alpha beta';\n",
    },
    expect: { code: 0, kinds: [], empty: false, counts: { cites: 1 } },
  },
  {
    name: 'walk-and-segments',
    files: {
      'src/Foo.css': '/* see src/Bar.js ("alpha one") */\n',
      'src/Foo.tsx': '// see src/app/[token]/Bar.js ("alpha two")\n',
      'e2e/Foo.ts': '// see src/Bar.js ("alpha three")\n',
      'src/Bar.js': "a = 'alpha one'; b = 'alpha three';\n",
      'src/app/[token]/Bar.js': "c = 'alpha two';\n",
    },
    expect: { code: 0, kinds: [], empty: false, counts: { checked: 3, crossFile: 3 } },
  },
  {
    // Count or code 0 here would mean the link was followed out of the root.
    name: 'symlink-target',
    files: { 'src/Foo.js': '// see src/x.json ("alpha")\n' },
    setup(tmp, root) {
      fs.mkdirSync(path.join(tmp, 'outside'), { recursive: true });
      fs.writeFileSync(path.join(tmp, 'outside', 'secret.txt'), 'alpha\n');
      fs.symlinkSync(path.join(tmp, 'outside', 'secret.txt'), path.join(root, 'src', 'x.json'));
    },
    expect: { code: 1, kinds: ['forbidden-target'], empty: false },
  },
];

function selfTest() {
  const lines = [];
  let passed = 0;
  let ran = 0;
  for (const tc of SELF_TEST_CASES) {
    ran += 1;
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'anchor-selftest-'));
    try {
      const root = tc.setup ? path.join(tmp, 'root') : tmp;
      for (const [rel, body] of Object.entries(tc.files)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, body);
      }
      if (tc.setup) tc.setup(tmp, root);
      const r = checkTree(root);
      const got = { code: r.code, kinds: r.violations.map((v) => v.kind).sort(), empty: r.empty };
      const want = { code: tc.expect.code, kinds: [...tc.expect.kinds].sort(), empty: tc.expect.empty };
      for (const k of Object.keys(tc.expect.counts ?? {})) {
        got[k] = r.counts[k];
        want[k] = tc.expect.counts[k];
      }
      const g = JSON.stringify(got);
      const w = JSON.stringify(want);
      if (g === w) {
        passed += 1;
        lines.push(`PASS ${tc.name}`);
      } else {
        lines.push(`FAIL ${tc.name}: expected ${w}, got ${g}`);
      }
    } catch (err) {
      lines.push(`FAIL ${tc.name}: expected a result, got ERROR ${err && err.message ? err.message : String(err)}`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  const uncovered = KINDS.filter((k) => !SELF_TEST_CASES.some((tc) => tc.expect.kinds.includes(k)));
  if (uncovered.length > 0) lines.push(`FAIL kind-coverage: expected every kind in some case, got none for ${uncovered.join(', ')}`);
  const ok = uncovered.length === 0 && passed === ran && ran === SELF_TEST_CASE_COUNT && SELF_TEST_CASES.length === SELF_TEST_CASE_COUNT;
  lines.push(ok ? `self-test: PASS ${passed} of ${ran}` : `self-test: FAIL ${passed} of ${ran} (declared ${SELF_TEST_CASE_COUNT})`);
  return { code: ok ? 0 : 1, lines };
}

function main(argv) {
  let root;
  if (argv.length === 0) {
    root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  } else if (argv.length === 1 && argv[0] === '--self-test') {
    const st = selfTest();
    process.stdout.write(`${st.lines.join('\n')}\n`);
    return st.code;
  } else if (argv.length === 2 && argv[0] === '--root' && argv[1] && !argv[1].startsWith('-')) {
    root = path.resolve(argv[1]);
    let isDir = false;
    try {
      isDir = fs.statSync(root).isDirectory();
    } catch {
      isDir = false;
    }
    if (!isDir) {
      process.stderr.write(`anchor-cite-check: ERROR --root is not a directory: ${argv[1]}\n${USAGE}\n`);
      return 1;
    }
  } else {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const result = checkTree(root);
  process.stdout.write(`${result.lines.join('\n')}\n`);
  return result.code;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  process.stderr.write(`anchor-cite-check: ERROR ${err && err.message ? err.message : String(err)}\n`);
  process.exitCode = 1;
}

