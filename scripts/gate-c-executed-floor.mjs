#!/usr/bin/env node
/**
 * Gate C EXECUTED-COUNT FLOOR — Phase 88.3-cr, finding CR-09.
 *
 * DECISION Phase 88.3-cr (CR-09, code-adversarial-review 2026-08-27): Gate C is
 * verified by COUNTING WHAT RAN, chosen OVER trusting the Playwright exit code.
 *
 * WHY. Every Gate C test in `e2e/contrast.spec.ts` sits behind
 * `test.skip(({ isMobile }) => !isMobile)`, so it executes only in the `phone`
 * project. Playwright exits 0 on a run that SKIPPED everything, and nothing in
 * the pipeline consumed the skipped count — live run 33138624128 reported
 * "85 passed, 72 skipped" with no consumer. Three one-line edits each turn the
 * whole gate into a no-op while the job stays green:
 *   - dropping `--project=phone` from ci.yml's run line,
 *   - removing `isMobile: true` from the phone project in playwright.config.ts,
 *   - inverting the skip predicate in the spec.
 * The first is pinned by the lockstep tests in `src/lib/ci-grep-gate.fixture.test.ts`
 * and the second and third were pinned by NOTHING. This script closes all three at
 * the only place they converge: the number of tests that actually executed.
 *
 * This is the Playwright analogue of ci.yml's vitest drift-gate registry, which
 * exists because "a test file can be DELETED and vitest stays green".
 *
 * REJECTED: giving `e2e/contrast.spec.ts` a row in that vitest registry (the
 * review's other suggestion). It is invalidated by a recorded decision — the
 * registry counts `it(`/`test(` inside vitest `.test.ts` files under `src/`, and
 * `src/lib/ci-grep-gate.fixture.test.ts` says in prose that a Playwright spec
 * deliberately gets no row for exactly that reason, covering FILE EXISTENCE with
 * its own `existsSync` test instead. Existence was never the hole; execution was.
 *
 * REJECTED: asserting a total across the whole run. That is DEF-88-28-01's
 * threshold-on-a-superset defect — another spec growing would mask this one going
 * to zero. The floor is per-file and per-project.
 *
 * THE FLOOR IS MEASURED, NOT QUOTED. `npx playwright test --list --project=phone`
 * reported 13 tests in `e2e/contrast.spec.ts` on 2026-08-27. The code review that
 * raised CR-09 said 16; that figure is wrong and must not be propagated. Adding a
 * Gate C test is never a red build; removing one is, which is the intended
 * asymmetry.
 *
 * RAISED 13 -> 15, Phase 88.3.1-W (AMENDMENT W), MEASURED 2026-08-30: the same
 * command now reports 15, the two new tests being the preset-only ground pins (one
 * per theme). Raising it in the same commit that adds them is deliberate and is
 * itself an AMENDMENT W concern — a floor left at 13 would let both new tests be
 * deleted with the gate still green, which is the SAME "gate that cannot red"
 * failure the amendment exists to close. `src/lib/ci-grep-gate.fixture.test.ts`
 * pins the other direction (floor <= declared), so the pair cannot drift apart.
 */
import { readFileSync, existsSync } from 'node:fs';

const REPORT = process.argv[2] ?? 'playwright-results.json';
const SPEC = 'e2e/contrast.spec.ts';
const PROJECT = 'phone';
const FLOOR = 15;

if (!existsSync(REPORT)) {
  console.error(
    `::error::Gate C floor: no Playwright JSON report at ${REPORT}. The 'json' reporter was ` +
      `removed from playwright.config.ts, or its outputFile moved. That reporter is what makes ` +
      `Gate C's execution countable — restore it, do not delete this step.`,
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (err) {
  console.error(`::error::Gate C floor: ${REPORT} is not valid JSON (${err.message}).`);
  process.exit(1);
}

/** Playwright nests suites arbitrarily deep; specs can hang off any level. */
const specsIn = (suite) => [
  ...(suite.specs ?? []),
  ...(suite.suites ?? []).flatMap(specsIn),
];
const allSpecs = (report.suites ?? []).flatMap(specsIn);

if (allSpecs.length === 0) {
  console.error(
    `::error::Gate C floor: ${REPORT} contains no specs at all. The report shape changed ` +
      `(Playwright major upgrade?) — this reader must be updated, not removed.`,
  );
  process.exit(1);
}

// `file` is reported relative to the config rootDir; match on the suffix so a
// rootDir change does not silently zero the count.
const gateCSpecs = allSpecs.filter((s) => (s.file ?? '').endsWith('contrast.spec.ts'));

let passed = 0;
let skipped = 0;
let other = 0;
for (const spec of gateCSpecs) {
  for (const t of spec.tests ?? []) {
    if (t.projectName !== PROJECT) continue;
    // 'expected' = passed. 'flaky' = passed on retry, which still EXECUTED and
    // ended green; the job's own exit code owns the flakiness question.
    if (t.status === 'expected' || t.status === 'flaky') passed += 1;
    else if (t.status === 'skipped') skipped += 1;
    else other += 1;
  }
}

console.log(
  `Gate C (${SPEC}, project '${PROJECT}'): ${passed} passed, ${skipped} skipped, ${other} other ` +
    `(floor ${FLOOR}).`,
);

if (passed < FLOOR) {
  console.error(
    `::error::Gate C DISARMED: only ${passed} tests from ${SPEC} passed in the '${PROJECT}' ` +
      `project; the floor is ${FLOOR} (${skipped} were skipped). Playwright exits 0 on a run ` +
      `that skipped everything, so the green checkmark above means nothing on its own. Check, ` +
      `in this order: (1) ci.yml's run line still passes --project=phone; (2) the 'phone' ` +
      `project in playwright.config.ts still sets isMobile: true; (3) contrast.spec.ts's ` +
      `test.skip(({ isMobile }) => !isMobile) predicate is not inverted. If Gate C tests were ` +
      `deliberately REMOVED, lower FLOOR in this script in the same commit and record why — do ` +
      `not delete this step.`,
  );
  process.exit(1);
}
