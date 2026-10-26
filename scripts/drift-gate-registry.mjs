#!/usr/bin/env node
/**
 * Drift-gate registry runner — Phase 88.6.2-26 (SPEC R6, CONTEXT D-12..D-15).
 *
 * Usage: node scripts/drift-gate-registry.mjs [--self-test]
 *   no argument  check the tree: self-check, then the floor loop, then one exit
 *   --self-test  the hermetic case table (resolver + pass/fail logic); touches no tree file
 *   anything else exits 1, so a mistyped invocation reds instead of passing
 *
 * WHAT IT CHECKS. The rows live in scripts/drift-gate-registry.manifest.mjs and nowhere else.
 *   1. self-check: the manifest is well formed; the shared helper exists; at least one file
 *      imports it; every file under src and e2e that imports it is a gates row (with a floor)
 *      or a helperOnly row (with a reason); every listed path exists; no notGates file imports it.
 *   2. floor loop: every gates row still carries at least its floor of it( / test( lines,
 *      counted with COUNT_RE, the same regex the old ci.yml loop used.
 * Every problem is collected; the exit happens once, at the end, so one red never hides another.
 *
 * WHAT IT DOES NOT CLAIM. It does not judge whether the assertions inside a suite are the right
 * ones; each suite carries its own anti-vacuity guards. It proves presence, registration and a
 * floor, which is what a deleted or gutted file breaks.
 *
 * Builtins only (node:fs, node:path, node:url) and no import.meta.dirname, fs.globSync or
 * recursive readdirSync: the required CI job runs it with no npm ci, and it must also run on
 * the oldest local Node this project uses (v21.1.0).
 */
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as MANIFEST from './drift-gate-registry.manifest.mjs';

export const FE_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const SCAN_ROOTS = ['src', 'e2e'];
export const SOURCE_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
// Byte-equivalent to the retired ci.yml loop's grep -cE '^[[:space:]]*(it|test)\(' for these
// files (no form feeds or vertical tabs in the tree), and to the fixture test's own counter.
export const COUNT_RE = /^[ \t]*(it|test)\(/gm;
export const SELF_TEST_CASE_COUNT = 28;

const MANIFEST_FILE = 'scripts/drift-gate-registry.manifest.mjs';
const LIST_KEYS = ['gates', 'helperOnly', 'helpers', 'notGates'];
const PASS_LINE = 'Drift-gate registry passed — every source-scan guard is present, registered and armed.';

/**
 * Every module specifier the text names after `from`, `import(`, `require(`, or a side-effect
 * `import '…'`. A regex over the raw text, deliberately: this is not a copy of the comment lexer
 * (DECISION Phase 88-29, one lexer), and the runner cannot load TypeScript without npm ci. A
 * specifier quoted inside a comment is therefore read as an import. That error is strict-side:
 * it can only ever ADD an importer, which the self-check then asks to be registered.
 */
export function extractSpecifiers(text) {
  const out = [];
  const patterns = [
    /\bfrom\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\brequire\s*\(\s*(['"])([^'"\n]+)\1/g,
    /\bimport\s+(['"])([^'"\n]+)\1/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) out.push(m[2]);
  }
  return out;
}

/**
 * Resolve one specifier written in `fromRel` (a repo-relative POSIX path) to a repo-relative
 * POSIX file path, or null. `./` and `../` resolve against the importer's directory; `@/` is the
 * tsconfig alias for `src/`; a bare package resolves to null. Candidates, in order: the path as
 * written, then `.ts`, `.tsx`, `/index.ts`, `/index.tsx`, and for a `.js`/`.jsx`/`.mjs`
 * specifier its TypeScript counterpart. The result is compared EXACTLY with each helper path by
 * the caller, never as a substring, so `sourceScanner` or `lib/sourceScan` never match.
 */
export function resolveSpecifier(fromRel, specifier, isFile) {
  let base;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    base = posix.join(posix.dirname(fromRel), specifier);
  } else if (specifier.startsWith('@/')) {
    base = posix.join('src', specifier.slice(2));
  } else {
    return null;
  }
  base = posix.normalize(base);
  if (base.startsWith('../') || base === '..') return null;
  const candidates = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`, `${base}/index.tsx`];
  const ext = base.match(/\.(js|jsx|mjs)$/);
  if (ext) {
    const stem = base.slice(0, -ext[0].length);
    if (ext[1] === 'js') candidates.push(`${stem}.ts`, `${stem}.tsx`);
    if (ext[1] === 'jsx') candidates.push(`${stem}.tsx`);
    if (ext[1] === 'mjs') candidates.push(`${stem}.mts`);
  }
  for (const c of candidates) {
    if (isFile(c)) return c;
  }
  return null;
}

/** Repo-relative POSIX paths of every source file under `relDir`, skipping dot entries and node_modules. */
export function walk(relDir) {
  const out = [];
  const abs = join(FE_ROOT, relDir);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const rel = posix.join(relDir, entry.name);
    if (entry.isDirectory()) out.push(...walk(rel));
    else if (entry.isFile() && SOURCE_EXT.some((e) => entry.name.endsWith(e))) out.push(rel);
  }
  return out;
}

function isTreeFile(rel) {
  const abs = join(FE_ROOT, rel);
  return existsSync(abs) && statSync(abs).isFile();
}

/** Every file under SCAN_ROOTS whose specifiers resolve to one of `helpers`, sorted. */
export function findImporters(helpers = MANIFEST.helpers) {
  const helperSet = new Set(helpers);
  const importers = [];
  for (const root of SCAN_ROOTS) {
    for (const rel of walk(root)) {
      if (helperSet.has(rel)) continue;
      const text = readFileSync(join(FE_ROOT, rel), 'utf8');
      const hit = extractSpecifiers(text).some((s) => helperSet.has(resolveSpecifier(rel, s, isTreeFile)));
      if (hit) importers.push(rel);
    }
  }
  return importers.sort();
}

function badPath(file) {
  return (
    typeof file !== 'string' ||
    !(file.startsWith('src/') || file.startsWith('e2e/')) ||
    file.split('/').includes('..') ||
    file.includes('\\')
  );
}

/** Shape errors in the manifest, as ::error:: lines. */
function manifestErrors(manifest) {
  const errs = [];
  const say = (msg) => errs.push(`::error::Drift-gate manifest: ${msg}`);
  for (const key of Object.keys(manifest)) {
    if (!LIST_KEYS.includes(key)) say(`unknown export '${key}' in ${MANIFEST_FILE}; the lists are ${LIST_KEYS.join(', ')}.`);
  }
  for (const key of LIST_KEYS) {
    if (!Array.isArray(manifest[key])) say(`'${key}' must be an array.`);
  }
  if (errs.length) return errs;
  const seen = new Map();
  const note = (file, list) => {
    if (seen.has(file)) say(`${file} is listed twice (${seen.get(file)} and ${list}); a file belongs to exactly one list.`);
    else seen.set(file, list);
  };
  const rowCheck = (list, row, keys) => {
    if (row === null || typeof row !== 'object' || Array.isArray(row)) {
      say(`a ${list} row is not an object: ${JSON.stringify(row)}.`);
      return false;
    }
    const extra = Object.keys(row).filter((k) => !keys.includes(k));
    if (extra.length) say(`${list} row ${JSON.stringify(row.file)} has unknown key(s) ${extra.join(', ')}; the keys are ${keys.join(', ')}.`);
    if (badPath(row.file)) say(`${list} row ${JSON.stringify(row.file)}: file must be a repo-relative path under src/ or e2e/, with no '..' and no backslash.`);
    if (typeof row.why !== 'string' || row.why.trim().length < 20) say(`${list} row ${JSON.stringify(row.file)}: why must say why in at least 20 characters.`);
    return true;
  };
  for (const row of manifest.gates) {
    if (!rowCheck('gates', row, ['file', 'min', 'why'])) continue;
    if (!Number.isInteger(row.min) || row.min < 1) say(`gates row ${JSON.stringify(row.file)}: min must be an integer >= 1, got ${JSON.stringify(row.min)}. A floor of 0 passes a gutted file.`);
    if (typeof row.file === 'string') note(row.file, 'gates');
  }
  for (const list of ['helperOnly', 'notGates']) {
    for (const row of manifest[list]) {
      if (!rowCheck(list, row, ['file', 'why'])) continue;
      if (typeof row.file === 'string') note(row.file, list);
    }
  }
  if (manifest.helpers.length === 0) say(`'helpers' is empty; it names the shared scanner the importer check resolves to.`);
  for (const h of manifest.helpers) {
    if (badPath(h)) say(`helpers entry ${JSON.stringify(h)} must be a repo-relative path under src/ or e2e/.`);
    else note(h, 'helpers');
  }
  return errs;
}

// DECISION Phase 88.6.2-26 (D-13): importers SUBSET-OF the manifest, chosen OVER equality both ways — at FE 995023d 17 importers were unregistered and 11 registered suites import nothing (they guard by assertion), so equality was red on day one and would force deleting real guards; the deletion guard is the existence check over every listed path.
/**
 * Returns the self-check's error lines; never prints, never exits.
 * `exists(path) → boolean` is injected so the self-test runs on a virtual tree.
 */
export function selfCheck(manifest, importers, exists) {
  const errs = manifestErrors(manifest);
  if (LIST_KEYS.some((k) => !Array.isArray(manifest[k]))) return errs;
  const helperLabel = manifest.helpers.join(', ') || '(no helper)';
  for (const h of manifest.helpers) {
    if (typeof h === 'string' && !exists(h)) {
      errs.push(`::error::Drift-gate manifest: helper MISSING ${h} — the shared scanner was renamed or deleted, so no importer can be found. Point 'helpers' at its new path.`);
    }
  }
  if (importers.length === 0) {
    errs.push(`::error::Drift-gate manifest: ZERO importers — the resolver is broken; this check never passes vacuously.`);
  }
  const registered = new Set([...manifest.gates, ...manifest.helperOnly].map((r) => r && r.file));
  const notGates = new Set(manifest.notGates.map((r) => r && r.file));
  for (const imp of importers) {
    if (registered.has(imp)) continue;
    if (notGates.has(imp)) {
      errs.push(`::error::Drift-gate manifest: ${imp} is in notGates but imports ${helperLabel} — it is now a scan user; move it to gates (with a floor) or helperOnly (with a reason).`);
      continue;
    }
    errs.push(`::error::Drift gate UNREGISTERED: ${imp} imports ${helperLabel} but is not in ${MANIFEST_FILE} — add a gates row with a floor (it asserts over a scan) or a helperOnly row with a reason. Do not delete the import to make this pass.`);
  }
  for (const list of ['gates', 'helperOnly', 'notGates']) {
    for (const row of manifest[list]) {
      if (!row || typeof row.file !== 'string' || badPath(row.file)) continue;
      if (!exists(row.file)) {
        errs.push(`::error::Drift gate MISSING: ${row.file} — a guard was deleted or renamed. Restore it, or delete its row in ${MANIFEST_FILE} and record the decision in the phase's deferred-items ledger. Do not silently drop the row.`);
      }
    }
  }
  return errs;
}

/**
 * Returns the floor loop's error lines; never prints, never exits. `countOf(path)` returns the
 * file's COUNT_RE count, or null when the file is absent (the self-check already reported it).
 */
export function floorLoop(gates, countOf) {
  const errs = [];
  for (const row of Array.isArray(gates) ? gates : []) {
    if (!row || typeof row.file !== 'string' || !Number.isInteger(row.min)) continue;
    const n = countOf(row.file);
    if (n === null || n === undefined) continue;
    if (n < row.min) {
      errs.push(`::error::Drift gate GUTTED: ${row.file} has ${n} assertions, expected at least ${row.min}. Assertions were removed from a drift guard.`);
    }
  }
  return errs;
}

/** The whole check as data: { code, lines }. main prints the lines and exits with code. */
export function run(manifest, importers, exists, countOf) {
  const lines = [];
  const scErrs = selfCheck(manifest, importers, exists);
  const lists = LIST_KEYS.every((k) => Array.isArray(manifest[k]));
  if (scErrs.length === 0) {
    const listed = manifest.gates.length + manifest.helperOnly.length + manifest.notGates.length + manifest.helpers.length;
    lines.push(
      `self-check: ${importers.length} importers of ${manifest.helpers.join(', ')}, all registered ` +
        `(${manifest.gates.length} gates, ${manifest.helperOnly.length} helper-only); ${listed} listed paths exist`,
    );
  } else {
    lines.push(`self-check: FAILED — ${scErrs.length} problem(s)`);
    lines.push(...scErrs);
  }
  const flErrs = floorLoop(lists ? manifest.gates : [], countOf);
  const g = lists ? manifest.gates.length : 0;
  if (flErrs.length === 0) lines.push(`floor loop: ${g} gates, every count at or above its floor`);
  else {
    lines.push(`floor loop: FAILED — ${flErrs.length} of ${g} gates below floor`);
    lines.push(...flErrs);
  }
  const problems = scErrs.length + flErrs.length;
  lines.push(problems === 0 ? PASS_LINE : `Drift-gate registry FAILED — ${problems} problem(s) above.`);
  return { code: problems === 0 ? 0 : 1, lines };
}

/** The hermetic case table. Returns { passed, ran, report }. */
export function runSelfTest() {
  const cases = [];
  const add = (name, fn) => cases.push({ name, fn });

  // RESOLVER (1-14) over a virtual file set.
  const VFS = new Set(['src/test-utils/sourceScan.ts', 'src/lib/other.ts']);
  const HELPER = 'src/test-utils/sourceScan.ts';
  const vIsFile = (p) => VFS.has(p);
  const hits = (from, text) => extractSpecifiers(text).some((s) => resolveSpecifier(from, s, vIsFile) === HELPER);
  const R = [
    ['HIT ../ from src/app', 'src/app/a.test.ts', "import { sourceFiles } from '../test-utils/sourceScan';", true],
    ['HIT ../../ from src/app/components', 'src/app/components/b.test.tsx', "import { withoutComments } from '../../test-utils/sourceScan';", true],
    ['HIT ./ from src/test-utils', 'src/test-utils/c.test.ts', "import { sourceFiles } from './sourceScan';", true],
    ['HIT @/ alias', 'src/lib/hooks/d.test.ts', "import { sourceFiles } from '@/test-utils/sourceScan';", true],
    ['HIT multi-line import, from on its own line', 'src/app/a.test.ts', "import {\n  lineAt,\n  sourceFiles,\n}\nfrom\n  '../test-utils/sourceScan';", true],
    ['HIT export { x } from (re-export)', 'src/app/a.test.ts', "export { withoutComments } from '../test-utils/sourceScan';", true],
    ['HIT await import()', 'src/app/a.test.ts', "const m = await import('../test-utils/sourceScan');", true],
    ['HIT require()', 'src/app/a.test.ts', "const m = require('../test-utils/sourceScan');", true],
    ['HIT explicit .ts specifier', 'src/app/a.test.ts', "import { sourceFiles } from '../test-utils/sourceScan.ts';", true],
    ['HIT .js specifier resolves to the .ts file', 'src/app/a.test.ts', "import { sourceFiles } from '../test-utils/sourceScan.js';", true],
    ['MISS ../test-utils/sourceScanner', 'src/app/a.test.ts', "import { x } from '../test-utils/sourceScanner';", false],
    ['MISS ../lib/sourceScan', 'src/app/a.test.ts', "import { x } from '../lib/sourceScan';", false],
    ['MISS a non-import string', 'src/app/a.test.ts', "const p = '../test-utils/sourceScan';", false],
    ['MISS the bare package sourceScan', 'src/app/a.test.ts', "import { x } from 'sourceScan';", false],
  ];
  for (const [name, from, text, want] of R) {
    add(`resolver: ${name}`, () => hits(from, text) === want);
  }

  // LOGIC (15-28) on a synthetic manifest.
  const W = 'a reason that is at least twenty characters';
  const base = () => ({
    gates: [{ file: 'src/app/a.test.ts', min: 2, why: W }],
    helperOnly: [{ file: 'src/app/b.test.ts', why: W }],
    helpers: ['src/test-utils/sourceScan.ts'],
    notGates: [{ file: 'src/app/c.test.ts', why: W }],
  });
  const allExist = () => true;
  const IMP = ['src/app/a.test.ts', 'src/app/b.test.ts'];
  const only = (errs, needle) => errs.length === 1 && errs[0].includes(needle);
  const manifestErr = (m) => {
    const e = selfCheck(m, IMP, allExist);
    return e.length >= 1 && e.every((l) => l.startsWith('::error::Drift-gate manifest:'));
  };
  add('selfCheck GREEN on the base set', () => selfCheck(base(), IMP, allExist).length === 0);
  add('an unregistered importer is UNREGISTERED', () => {
    const e = selfCheck(base(), [...IMP, 'src/app/d.test.ts'], allExist);
    return e.length === 1 && e.filter((l) => l.includes('UNREGISTERED: src/app/d.test.ts')).length === 1;
  });
  add('a missing gates file is MISSING', () =>
    only(selfCheck(base(), IMP, (p) => p !== 'src/app/a.test.ts'), 'MISSING: src/app/a.test.ts'));
  add('a missing helper is helper MISSING', () =>
    only(selfCheck(base(), IMP, (p) => p !== 'src/test-utils/sourceScan.ts'), 'helper MISSING'));
  add('zero importers is an error', () => only(selfCheck(base(), [], allExist), 'ZERO importers'));
  add('a notGates file that imports the helper is named', () => {
    const e = selfCheck(base(), [...IMP, 'src/app/c.test.ts'], allExist);
    return e.length === 1 && e[0].includes('src/app/c.test.ts is in notGates');
  });
  add('a file in gates AND helperOnly is a manifest error', () => {
    const m = base();
    m.helperOnly.push({ file: 'src/app/a.test.ts', why: W });
    return manifestErr(m);
  });
  add('a gates row with an extra floor key is a manifest error', () => {
    const m = base();
    m.gates[0].floor = 2;
    return manifestErr(m);
  });
  add('min 0 is a manifest error', () => {
    const m = base();
    m.gates[0].min = 0;
    return manifestErr(m);
  });
  add('a 5-char why is a manifest error', () => {
    const m = base();
    m.gates[0].why = 'short';
    return manifestErr(m);
  });
  add('floorLoop: count below min is GUTTED', () => only(floorLoop(base().gates, () => 1), 'GUTTED'));
  add('floorLoop: count equal to min passes', () => floorLoop(base().gates, () => 2).length === 0);
  add('run on the GREEN set: code 0, pass line last', () => {
    const r = run(base(), IMP, allExist, () => 2);
    return r.code === 0 && r.lines[r.lines.length - 1] === PASS_LINE && r.lines[0].startsWith('self-check: ');
  });
  add('run with a gutted gate: code 1, FAILED line last', () => {
    const r = run(base(), IMP, allExist, () => 1);
    return r.code === 1 && r.lines[r.lines.length - 1] === 'Drift-gate registry FAILED — 1 problem(s) above.';
  });

  const report = [];
  let passed = 0;
  cases.forEach((c, i) => {
    let ok = false;
    try {
      ok = c.fn() === true;
    } catch (err) {
      ok = false;
      report.push(`#   threw: ${err.message}`);
    }
    if (ok) passed += 1;
    report.push(`${ok ? 'ok' : 'not ok'} ${i + 1} - ${c.name}`);
  });
  return { passed, ran: cases.length, report };
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') {
    const { passed, ran, report } = runSelfTest();
    for (const l of report) console.log(l);
    if (passed === ran && ran === SELF_TEST_CASE_COUNT) {
      console.log(`self-test: PASS ${passed} of ${ran}`);
      process.exit(0);
    }
    console.log(`self-test: FAIL ${passed} of ${ran} passed (expected ${SELF_TEST_CASE_COUNT} cases, all passing)`);
    process.exit(1);
  }
  if (argv.length !== 0) {
    console.error(`::error::drift-gate-registry: unknown argument(s) ${argv.join(' ')}. Usage: node scripts/drift-gate-registry.mjs [--self-test].`);
    process.exit(1);
  }
  const manifest = { ...MANIFEST };
  const helpers = Array.isArray(manifest.helpers) ? manifest.helpers.filter((h) => typeof h === 'string') : [];
  const importers = findImporters(helpers);
  const exists = (p) => existsSync(join(FE_ROOT, p));
  const countOf = (p) => {
    const abs = join(FE_ROOT, p);
    if (!existsSync(abs)) return null;
    return (readFileSync(abs, 'utf8').match(COUNT_RE) ?? []).length;
  };
  const { code, lines } = run(manifest, importers, exists, countOf);
  for (const l of lines) console.log(l);
  process.exit(code);
}

// Run only when executed directly (node scripts/drift-gate-registry.mjs), never on import. Both
// sides go through realpathSync so a symlinked or differently-cased checkout path still matches.
const SELF = realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === SELF) {
  main(process.argv.slice(2));
}
