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

const USAGE = 'usage: node scripts/anchor-cite-check.mjs [--root <dir> | --self-test]';
const PATH_CHAR = 'A-Za-z0-9_@.\\[\\]\\/-';
// Longest extension first, so ts never shadows tsx inside the alternation.
const EXT_ALT = [...TARGET_EXTS].sort((a, b) => b.length - a.length).join('|');
const PATH_CITE_RE = new RegExp(`(?<![${PATH_CHAR}])([${PATH_CHAR}]+\\.(?:${EXT_ALT})) \\("`, 'g');

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

function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) if (text.charCodeAt(i) === 10) line += 1;
  return line;
}

function findCites(text, rel) {
  const cites = [];
  PATH_CITE_RE.lastIndex = 0;
  let m;
  while ((m = PATH_CITE_RE.exec(text)) !== null) {
    const open = m.index + m[0].length;
    const close = text.indexOf('")', open);
    const nl = text.indexOf('\n', open);
    const snippet = close === -1 || (nl !== -1 && close > nl) ? null : text.slice(open, close);
    cites.push({ file: rel, line: lineAt(text, m.index), kind: 'cross', path: m[1], snippet });
  }
  return cites;
}

function countOccurrences(text, snippet) {
  if (!snippet) return 0;
  let n = 0;
  for (let i = text.indexOf(snippet); i !== -1; i = text.indexOf(snippet, i + 1)) n += 1;
  return n;
}

function resolveExact(root, rel) {
  const abs = path.resolve(root, rel);
  try {
    return fs.statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

function checkTree(root) {
  const files = walk(root);
  const counts = { walked: files.length, cites: 0, checked: 0, crossFile: 0, sameFile: 0, skipped: 0, backend: 0, nodeModules: 0, planning: 0, violations: 0 };
  const violations = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const c of findCites(text, rel)) {
      counts.cites += 1;
      counts.checked += 1;
      counts.crossFile += 1;
      const shown = `${c.path} ("${c.snippet ?? ''}")`;
      const abs = resolveExact(root, c.path);
      if (!abs) {
        violations.push({ file: rel, line: c.line, kind: 'unresolved', detail: `${shown}: the path does not resolve to a file from the repo root` });
        continue;
      }
      const n = countOccurrences(fs.readFileSync(abs, 'utf8'), c.snippet);
      if (n !== 1) violations.push({ file: rel, line: c.line, kind: 'count', detail: `("${c.snippet ?? ''}") occurs ${n} times in ${c.path}, expected 1` });
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

