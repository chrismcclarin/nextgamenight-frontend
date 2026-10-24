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
  runSelfTest,
  serializeBaseline,
} from './lib/line-cite-matcher.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_REL = 'scripts/baselines/line-cites.json';
const BASELINE = path.join(ROOT, 'scripts', 'baselines', 'line-cites.json');
const USAGE = 'usage: node scripts/line-cite-census.mjs [--self-test | --write-baseline [--init]]';

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

function main(argv) {
  if (argv.length === 0) return assertMode();
  if (argv.length === 1 && argv[0] === '--self-test') return selfTestMode();
  if (argv.length === 2 && argv[0] === '--write-baseline' && argv[1] === '--init') return initMode();
  throw new UsageError(USAGE);
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (err) {
  if (err instanceof UsageError) console.error(err.message);
  else console.error(`line-cite-census: ERROR ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
}
