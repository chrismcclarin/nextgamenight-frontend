#!/usr/bin/env node
/**
 * scripts/line-cite-census.mjs
 *
 * Phase 88.6.2 plan 04 (SPEC R3 Target b, CONTEXT D-01, D-02). The census half of the
 * line-cite ratchet; src/app/citeRatchet.test.ts is the gate half. Both import the one matcher
 * in scripts/lib/line-cite-matcher.mjs (SPEC A2).
 *
 * WHAT IT GUARDS
 * --------------
 * Line cites (the shape name.ext:N) in living FE source rot silently when code moves. Owner
 * ruling B converts the still-correct ones to the anchor form when their file is next touched;
 * until then the count of line cites per file may not rise. This script measures every walked
 * file under src and e2e and compares each with its own entry in scripts/baselines/line-cites.json.
 *
 * WHY ONE-WAY
 * -----------
 * DECISION Phase 88.6.2-04 (D-02): write mode only LOWERS a count (a rename pair or a named
 * --allow excepted), chosen OVER the exact-both-ways rosters of
 * planning:.planning/codebase/FE-TESTING-CONVENTIONS.md ("C-7 — exemption rosters"). SPEC R3
 * rules the count one-way, and an exact baseline would turn every cite conversion into a
 * baseline refresh; .github/workflows/ci.yml ("gate people routinely refresh to make green")
 * calls that kind of gate worse than none. The cost, named: between refreshes a file may regrow
 * up to its baseline. The counts line shows that slack (baseline cites minus cites), plan
 * 88.6.2-30 tightens it at phase close, and any later PR that lowers a count may run
 * --write-baseline to close it again. Changing this is a decision, not a cleanup.
 *
 * WHY NOT
 * -------
 * A vitest snapshot (CONTEXT D-01's rejected option): `vitest -u` rewrites raises as readily as
 * falls, so the refresh that makes it green is the same refresh that disarms it. A CI bash total
 * (the other rejected option): a net count hides a rise in one file behind a fall in another.
 * The comparison here is per file, never a total.
 *
 * USAGE (from the FE root; node builtins only, Node 20 or later)
 *   node scripts/line-cite-census.mjs                         assert: RISE lines, counts line, RESULT
 *   node scripts/line-cite-census.mjs --self-test             the matcher's case table
 *   node scripts/line-cite-census.mjs --write-baseline --init write the FIRST baseline (refuses if one exists)
 *   node scripts/line-cite-census.mjs --write-baseline        lower-only refresh: LOWERED / REMOVED / RENAMED
 *   node scripts/line-cite-census.mjs --write-baseline --allow <path>   a deliberate raise, printed loudly
 *   node scripts/line-cite-census.mjs --write-baseline --dry-run [--allow <path>]...   the same, never writes
 *
 *   A PR that lowers a count may run --write-baseline to close the slack it left. A PR that renames
 *   a cite-bearing file runs it too: the new path is accepted as a rename pair only when a baseline
 *   path with an equal or higher count is no longer a walked file. Every write mode refuses a
 *   counted path git does not track, and a baseline whose digest does not match its counts. Gates
 *   and verifiers use --dry-run; a gate never calls the real write mode.
 *
 * OUTPUT CONTRACT
 *   counts line: line-cite-census: walked N files | files with cites N | cites N |
 *                baseline files N | baseline cites N | rises N   (one line)
 *   assert:      RISE <path> baseline <b> measured <m> (sorted), DIGEST MISMATCH <expected> != <found>,
 *                last line RESULT: PASS (exit 0) or RESULT: FAIL (exit 1)
 *   self-test:   PASS <id> | FAIL <id>: <detail> per case, last line self-test: PASS <n> of <n>
 *                or self-test: FAIL <passed> of <ran> (declared <count>)
 *   errors:      line-cite-census: ERROR <message> on stderr, exit 1
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  SELF_TEST_CASE_COUNT,
  digestCounts,
  findRises,
  measureTree,
  parseBaseline,
  planBaselineWrite,
  runSelfTest,
  serializeBaseline,
} from './lib/line-cite-matcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_REL = 'scripts/baselines/line-cites.json';
const BASELINE = path.join(ROOT, 'scripts', 'baselines', 'line-cites.json');
const USAGE =
  'usage: node scripts/line-cite-census.mjs [--self-test | --write-baseline [--init | [--dry-run] [--allow <path>...]]]';

class UsageError extends Error {}

/** @param {Record<string, number>} counts */
const sum = (counts) => Object.values(counts).reduce((a, b) => a + b, 0);

function countsLine(m, baselineCounts, rises) {
  return (
    `line-cite-census: walked ${m.walked.length} files | files with cites ${Object.keys(m.counts).length} | ` +
    `cites ${m.total} | baseline files ${Object.keys(baselineCounts).length} | ` +
    `baseline cites ${sum(baselineCounts)} | rises ${rises.length}`
  );
}

function readBaseline() {
  if (!fs.existsSync(BASELINE)) {
    throw new Error(`baseline missing: ${BASELINE_REL} (the first one is written by --write-baseline --init)`);
  }
  return parseBaseline(fs.readFileSync(BASELINE, 'utf8'));
}

/** The set of tracked paths under src and e2e. A git failure throws (ERROR). */
function trackedPaths() {
  const out = execFileSync('git', ['-C', ROOT, 'ls-files', '-z', '--', 'src', 'e2e'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return new Set(out.split('\0').filter(Boolean));
}

/** REFUSED lines for every counted path git does not track (a plant is never baked in). */
function untrackedRefusals(counts, baselineCounts) {
  const tracked = trackedPaths();
  return Object.keys(counts)
    .filter((p) => !tracked.has(p))
    .map((p) => `REFUSED ${p} ${baselineCounts[p] ?? 0} -> ${counts[p]}: untracked (git ls-files does not list it)`);
}

function assertMode() {
  const m = measureTree(ROOT);
  const baseline = readBaseline();
  const rises = findRises(m.counts, baseline.counts);
  let fail = rises.length > 0;
  for (const r of rises) console.log(`RISE ${r.path} baseline ${r.baseline} measured ${r.measured}`);
  const expected = digestCounts(baseline.counts);
  if (expected !== baseline.digest) {
    console.log(`DIGEST MISMATCH ${expected} != ${baseline.digest}`);
    fail = true;
  }
  console.log(countsLine(m, baseline.counts, rises));
  console.log(fail ? 'RESULT: FAIL' : 'RESULT: PASS');
  return fail ? 1 : 0;
}

function selfTestMode() {
  const r = runSelfTest();
  for (const line of r.lines) console.log(line);
  if (r.failed.length === 0 && r.ran === SELF_TEST_CASE_COUNT) {
    console.log(`self-test: PASS ${r.passed} of ${r.ran}`);
    return 0;
  }
  console.log(`self-test: FAIL ${r.passed} of ${r.ran} (declared ${SELF_TEST_CASE_COUNT})`);
  return 1;
}

function initMode() {
  if (fs.existsSync(BASELINE)) {
    throw new Error(`${BASELINE_REL} exists; --init writes only the first baseline (use --write-baseline)`);
  }
  const m = measureTree(ROOT);
  const refused = untrackedRefusals(m.counts, {});
  if (refused.length > 0) {
    for (const line of refused) console.log(line);
    console.log('RESULT: FAIL');
    return 1;
  }
  fs.mkdirSync(path.dirname(BASELINE), { recursive: true });
  fs.writeFileSync(BASELINE, serializeBaseline(m.counts));
  const files = Object.keys(m.counts).length;
  const loud = `!!! INIT: baseline created: ${files} files, ${m.total} cites !!!`;
  console.log(loud);
  console.error(loud);
  console.log(`WROTE ${BASELINE_REL} (${files} files, ${m.total} cites)`);
  return 0;
}

/**
 * --write-baseline [--dry-run] [--allow <path>]...: all or nothing. Any REFUSED line prints the
 * lines and RESULT: FAIL and writes nothing; otherwise UNCHANGED, WROTE, or (dry run) WOULD WRITE.
 */
function writeMode({ dryRun, allow }) {
  if (!fs.existsSync(BASELINE)) {
    throw new Error(`baseline missing: ${BASELINE_REL}; the first baseline is written by --write-baseline --init`);
  }
  const currentText = fs.readFileSync(BASELINE, 'utf8');
  const baseline = parseBaseline(currentText);
  // A baseline whose digest no longer matches its counts was edited by hand. Writing from it
  // would launder that edit (a hand-raised count reads as "equal" and is kept with a fresh
  // digest), so the write refuses until the file is restored from git.
  const expected = digestCounts(baseline.counts);
  if (expected !== baseline.digest) {
    throw new Error(
      `DIGEST MISMATCH ${expected} != ${baseline.digest}: ${BASELINE_REL} was edited by hand; restore it from git first`,
    );
  }
  const m = measureTree(ROOT);
  const plan = planBaselineWrite(m, baseline.counts, allow);
  const lines = [...untrackedRefusals(m.counts, baseline.counts), ...plan.lines].sort();
  for (const line of lines) {
    console.log(line);
    if (line.startsWith('!!! RAISE ALLOWED')) console.error(line);
  }
  if (lines.some((l) => l.startsWith('REFUSED '))) {
    console.log('RESULT: FAIL');
    return 1;
  }
  const nextText = serializeBaseline(plan.next);
  const files = Object.keys(plan.next).length;
  const cites = sum(plan.next);
  if (nextText === currentText) {
    console.log(`UNCHANGED ${BASELINE_REL}`);
    return 0;
  }
  if (dryRun) {
    console.log(`WOULD WRITE ${BASELINE_REL} (${files} files, ${cites} cites)`);
    return 0;
  }
  fs.writeFileSync(BASELINE, nextText);
  console.log(`WROTE ${BASELINE_REL} (${files} files, ${cites} cites)`);
  return 0;
}

/** Strict argv: anything not in the usage line is a usage error. */
function main(argv) {
  if (argv.length === 0) return assertMode();
  if (argv.length === 1 && argv[0] === '--self-test') return selfTestMode();
  if (argv[0] !== '--write-baseline') throw new UsageError(USAGE);
  let init = false;
  let dryRun = false;
  /** @type {string[]} */
  const allow = [];
  for (let i = 1; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--init' && !init) init = true;
    else if (a === '--dry-run' && !dryRun) dryRun = true;
    else if (a === '--allow' && i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
      allow.push(argv[i + 1]);
      i += 1;
    } else throw new UsageError(USAGE);
  }
  if (init) {
    if (dryRun || allow.length > 0) throw new UsageError(USAGE);
    return initMode();
  }
  return writeMode({ dryRun, allow });
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) console.error(err.message);
  else console.error(`line-cite-census: ERROR ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
