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
// CLI wrapper: the only place that prints and exits.

function main(argv) {
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
