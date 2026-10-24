#!/usr/bin/env node
/**
 * no-retry-bump.test.mjs — Phase 88.6.2 plan 07, SPEC prohibition P2 ("P2 MUST NOT retry-bump a flake").
 *
 * WHAT. A flaky end-to-end test is fixed, never hidden by raising the retry count. This node:test
 * file is the mechanical half of P2: it reads a unified diff and names every retry bump in it, and it
 * reads this branch (git merge-base to the working tree, untracked files included) the same way.
 * The config line it guards is playwright.config.ts ("retries: process.env.CI ? 1 : 0,").
 *
 * USAGE
 *   node --test-reporter=tap scripts/no-retry-bump.test.mjs [base]       default mode, base origin/main
 *   GSD_PROHIB_SUBJECT=path/to.diff node --test --test-reporter=tap -- scripts/no-retry-bump.test.mjs
 *
 * MODES
 *   Default (GSD_PROHIB_SUBJECT unset): exactly 5 tests. The violation fixture yields exactly its four
 *   expected findings; the clean fixture yields none and parses to its known shape; the branch diff
 *   adds no bump; playwright.config.ts keeps the merge base's retries line; a malformed diff throws.
 *   A bad base or a git error is thrown INSIDE tests 3 and 4, so it reports as a named failure.
 *   Subject (GSD_PROHIB_SUBJECT set, resolved against the cwd): exactly 2 tests over that diff file.
 *   This is the subject-injection convention of the verifier's prohibition producer, which runs it
 *   red on scripts/fixtures/retry-bump.diff and green on scripts/fixtures/clean.diff.
 *
 * EXIT CODES
 *   0  every test of the mode passed and exactly the mode's test count ran.
 *   1  any test failed, or a number of tests other than the mode's count ran (a VACUITY line on
 *      stderr names both numbers), so an emptied or half-registered file can never read as a pass.
 *
 * Wherever this file's output is read (the # tests, # pass and # fail lines), the run names
 * --test-reporter=tap: Node 24 prints the spec reporter by default, even off a TTY.
 *
 * DECISION Phase 88.6.2-07 (P2): four vectors, chosen OVER the SPEC's two. The SPEC names the config
 * retries line and a .retry( call in e2e. This file also flags a retries option added in an e2e file
 * (test.describe.configure and the like) and a --retries flag added to a workflow command line,
 * because each is the same bump by another door; the SPEC's two are still checked exactly. A changed
 * or removed retries line in a root playwright config is a finding (no escape hatch: a lowering reds
 * too, and is a decision to make visibly). Comment lines, removed e2e lines and a retries line moved
 * unchanged are not findings. Strict side, on purpose: a code line that merely holds the word retries
 * followed by a colon inside a string reds visibly; it never passes silently. A hand-written retry
 * loop is NOT detected (judgment; the code-adversarial review reads for it).
 *
 * DECISION Phase 88.6.2-07 (node-test): node:test, chosen OVER the hand-rolled it and assert runner
 * of the claim-check hook tests. The verifier's prohibition producer reads the TAP summary lines and
 * the names of the failing tests to prove fail-first and a non-vacuous pass; a hand-rolled runner
 * prints neither, so P2 could never green. Node builtins only, Node 20 safe (no fs.globSync, no
 * import.meta.dirname).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const FE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CONFIG_RE = /^playwright[^/]*\.config\.[cm]?[jt]s$/;
export const JS_COMMENT_RE = /^(\/\/|\/\*|\*)/;
export const YAML_COMMENT_RE = /^#/;
export const EXPECTED_BUMP_FINDINGS = Object.freeze([
  { path: 'playwright.config.ts', line: 33, kind: 'config-retries' },
  { path: 'e2e/zz-fixture-flaky.spec.ts', line: 3, kind: 'e2e-retries' },
  { path: 'e2e/zz-fixture-flaky.spec.ts', line: 5, kind: 'e2e-retry-call' },
  { path: '.github/workflows/ci.yml', line: 718, kind: 'cli-retries' },
]);
export const CLEAN_FIXTURE_SHAPE = Object.freeze({ files: 4, added: 9, removed: 4 });
export const DEFAULT_TEST_COUNT = 5;
export const SUBJECT_TEST_COUNT = 2;

const FIXTURES = path.join(FE_ROOT, 'scripts', 'fixtures');
const PATHSPECS = ['e2e', '.github/workflows', 'playwright*.config.*'];
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse a unified diff into [{ path, added: [{ line, text }], removed: [{ line, text }] }].
 * Throws "malformed diff: ..." on any non-blank line before the first file header, a hunk with no
 * path, an unreadable hunk header, or a hunk line with an unknown prefix.
 */
export function parseUnifiedDiff(text) {
  if (typeof text !== 'string') throw new Error('malformed diff: input is not text');
  const files = [];
  let file = null;
  let inHunk = false;
  let oldLine = 0;
  let newLine = 0;
  let minusPath = null;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].replace(/\r$/, '');
    const where = `line ${i + 1}`;
    if (raw.startsWith('diff --git ')) {
      file = { path: null, added: [], removed: [] };
      files.push(file);
      inHunk = false;
      minusPath = null;
      continue;
    }
    if (!file) {
      if (raw.trim() === '') continue;
      throw new Error(`malformed diff: ${where} comes before the first diff --git header: ${raw}`);
    }
    if (raw.startsWith('@@')) {
      const m = HUNK_RE.exec(raw);
      if (!m) throw new Error(`malformed diff: ${where} is an unreadable hunk header: ${raw}`);
      if (!file.path) throw new Error(`malformed diff: ${where} opens a hunk in a file with no path`);
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      if (raw.startsWith('--- ')) {
        const p = raw.slice(4);
        minusPath = p === '/dev/null' ? null : p.replace(/^a\//, '');
        file.path = minusPath;
      } else if (raw.startsWith('+++ ')) {
        const p = raw.slice(4);
        file.path = p === '/dev/null' ? minusPath : p.replace(/^b\//, '');
      }
      continue;
    }
    if (raw === '') continue;
    const sign = raw[0];
    const body = raw.slice(1);
    if (sign === '+') file.added.push({ line: newLine++, text: body });
    else if (sign === '-') file.removed.push({ line: oldLine++, text: body });
    else if (sign === ' ') { oldLine++; newLine++; }
    else if (sign === '\\') continue;
    else throw new Error(`malformed diff: ${where} has an unknown hunk line prefix: ${raw}`);
  }
  return files;
}

function isJsComment(text) {
  return JS_COMMENT_RE.test(text.trim());
}

function isYamlComment(text) {
  return YAML_COMMENT_RE.test(text.trim());
}

/** Every retry bump in a parsed diff, as [{ path, line, kind, text }] in diff order. */
export function findRetryBumps(files) {
  const out = [];
  for (const f of files) {
    const p = f.path || '';
    if (CONFIG_RE.test(p)) {
      const isRetries = (l) => !isJsComment(l.text) && /\bretries\b/.test(l.text);
      const added = f.added.filter(isRetries);
      const removed = f.removed.filter(isRetries);
      const removedSet = new Set(removed.map((l) => l.text.trim()));
      const addedSet = new Set(added.map((l) => l.text.trim()));
      const changed = added.filter((l) => !removedSet.has(l.text.trim()));
      for (const l of changed) out.push({ path: p, line: l.line, kind: 'config-retries', text: l.text });
      if (changed.length === 0) {
        for (const l of removed) {
          if (!addedSet.has(l.text.trim())) out.push({ path: p, line: l.line, kind: 'config-retries-removed', text: l.text });
        }
      }
    } else if (p.startsWith('e2e/')) {
      for (const l of f.added) {
        if (isJsComment(l.text)) continue;
        if (/\.retry\s*\(/.test(l.text)) out.push({ path: p, line: l.line, kind: 'e2e-retry-call', text: l.text });
        if (/\bretries\s*:/.test(l.text) || /configure\s*\(\s*\{[^}]*\bretries\b/.test(l.text)) {
          out.push({ path: p, line: l.line, kind: 'e2e-retries', text: l.text });
        }
      }
    } else if (p.startsWith('.github/workflows/')) {
      for (const l of f.added) {
        if (isYamlComment(l.text)) continue;
        if (/--retries\b/.test(l.text)) out.push({ path: p, line: l.line, kind: 'cli-retries', text: l.text });
      }
    }
  }
  return out;
}

function git(args) {
  return execFileSync('git', args, { cwd: FE_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
}

function mergeBaseOf(base) {
  if (typeof base !== 'string' || base === '' || base.startsWith('-')) {
    throw new Error(`bad base ${JSON.stringify(base)}: give a commit-ish that does not start with a dash`);
  }
  try {
    git(['rev-parse', '--verify', '--quiet', `${base}^{commit}`]);
  } catch {
    throw new Error(`bad base ${JSON.stringify(base)}: git rev-parse cannot resolve it to a commit`);
  }
  return git(['merge-base', base, 'HEAD']).trim();
}

/**
 * The branch diff from git merge-base <base> HEAD to the working tree over the guarded paths, plus a
 * synthetic all-added section for every untracked, non-ignored file under the same paths.
 */
export function branchDiffText(base) {
  const mb = mergeBaseOf(base);
  let text = git(['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0', mb, '--', ...PATHSPECS]);
  const untracked = git(['ls-files', '--others', '--exclude-standard', '--', ...PATHSPECS])
    .split('\n')
    .filter(Boolean);
  for (const rel of untracked) {
    const body = fs.readFileSync(path.join(FE_ROOT, rel), 'utf8');
    const lines = body === '' ? [] : body.replace(/\n$/, '').split('\n');
    let section = `diff --git a/${rel} b/${rel}\nnew file mode 100644\n--- /dev/null\n+++ b/${rel}\n`;
    if (lines.length > 0) section += `@@ -0,0 +1,${lines.length} @@\n${lines.map((l) => `+${l}`).join('\n')}\n`;
    text += (text === '' || text.endsWith('\n') ? '' : '\n') + section;
  }
  return text;
}

/** The trimmed, non-comment lines of a file's text that set retries. */
export function retriesLines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => !JS_COMMENT_RE.test(l) && /\bretries\s*:/.test(l));
}

export function formatFindings(list) {
  return list.map((f) => `BUMP ${f.path} line ${f.line} ${f.kind}: ${f.text.trim()}`).join('\n');
}

function project(list) {
  return list.map(({ path: p, line, kind }) => ({ path: p, line, kind }));
}

let ran = 0;
const subject = process.env.GSD_PROHIB_SUBJECT;
const expected = subject !== undefined ? SUBJECT_TEST_COUNT : DEFAULT_TEST_COUNT;

process.on('exit', () => {
  if (ran !== expected) {
    process.exitCode = 1;
    console.error(`VACUITY ran ${ran} expected ${expected}`);
  }
});

if (subject !== undefined) {
  const subjectPath = path.resolve(process.cwd(), subject);

  test('the GSD_PROHIB_SUBJECT diff parses to at least one file with a changed line', () => {
    ran++;
    const files = parseUnifiedDiff(fs.readFileSync(subjectPath, 'utf8'));
    assert.ok(
      files.some((f) => f.added.length + f.removed.length > 0),
      `no file with a changed line in ${subjectPath}`,
    );
  });

  test('the GSD_PROHIB_SUBJECT diff adds no retry bump', () => {
    ran++;
    const found = findRetryBumps(parseUnifiedDiff(fs.readFileSync(subjectPath, 'utf8')));
    assert.equal(found.length, 0, `retry bumps in ${subjectPath}:\n${formatFindings(found)}`);
  });
} else {
  const base = process.argv[2] ?? 'origin/main';

  test('retry-bump.diff is caught: exactly the four expected findings', () => {
    ran++;
    const found = findRetryBumps(parseUnifiedDiff(fs.readFileSync(path.join(FIXTURES, 'retry-bump.diff'), 'utf8')));
    assert.deepEqual(project(found), EXPECTED_BUMP_FINDINGS.map((f) => ({ ...f })), formatFindings(found));
  });

  test('clean.diff yields no finding and parses to 4 files, 9 added and 4 removed lines', () => {
    ran++;
    const files = parseUnifiedDiff(fs.readFileSync(path.join(FIXTURES, 'clean.diff'), 'utf8'));
    const found = findRetryBumps(files);
    assert.equal(found.length, 0, formatFindings(found));
    const shape = {
      files: files.length,
      added: files.reduce((n, f) => n + f.added.length, 0),
      removed: files.reduce((n, f) => n + f.removed.length, 0),
    };
    assert.deepEqual(shape, { ...CLEAN_FIXTURE_SHAPE });
  });

  test('the branch adds no retry bump between git merge-base and the working tree', () => {
    ran++;
    const found = findRetryBumps(parseUnifiedDiff(branchDiffText(base)));
    assert.equal(found.length, 0, `retry bumps on this branch against ${base}:\n${formatFindings(found)}`);
  });

  test('playwright.config.ts keeps the merge base retries line', () => {
    ran++;
    const mb = mergeBaseOf(base);
    const atBase = retriesLines(git(['show', `${mb}:playwright.config.ts`]));
    const inTree = retriesLines(fs.readFileSync(path.join(FE_ROOT, 'playwright.config.ts'), 'utf8'));
    assert.ok(atBase.length > 0, 'the merge base playwright.config.ts has no retries line');
    assert.deepEqual(inTree, atBase, `BUMP playwright.config.ts retries changed: base ${JSON.stringify(atBase)} tree ${JSON.stringify(inTree)}`);
  });

  test('a malformed diff throws instead of reading as clean', () => {
    ran++;
    assert.throws(() => parseUnifiedDiff('this is not a diff\n+  retries: 9,\n'), /^Error: malformed diff: /);
    assert.throws(() => parseUnifiedDiff('diff --git a/x b/x\n@@ -1 +1 @@\n+x\n'), /^Error: malformed diff: /);
  });
}
