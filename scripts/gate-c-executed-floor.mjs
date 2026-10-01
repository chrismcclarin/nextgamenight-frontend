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
 *
 * GENERALISED 2026-09-28 (Phase 88.6 plan 55, owner-ruled NEW OWNER ITEM 4). DECISION Phase
 * 88.6-55: optional flags on THIS script, chosen OVER a second floor script — two copies of the
 * same report walk is the duplication the milestone tenet forbids, and they would drift. The
 * flags are `--spec <path>`, `--project <name>`, `--floor <n>` and `--title-prefix <text>`, all
 * after the report path; the second ci.yml step uses them to floor touch-targets.spec.ts's D10
 * arm in the desktop `journeys` project (the mirror of Gate C's hole: that arm skips when
 * `isMobile`). WITH NO FLAGS the behaviour is the Gate C gate above, unchanged — the three
 * constants below stay the defaults on their own lines (the lockstep reads `const FLOOR = N;`),
 * and the `Gate C DISARMED` message is printed only for that default invocation. An unknown
 * flag, a flag with no value, or a non-positive floor exits 1: a mistyped invocation must red,
 * never silently fall back to Gate C's defaults and pass.
 */
import { readFileSync, existsSync } from 'node:fs';

const REPORT = process.argv[2] ?? 'playwright-results.json';
const SPEC = 'e2e/contrast.spec.ts';
const PROJECT = 'phone';
const FLOOR = 15;

// Optional overrides (see the GENERALISED note above). Parsed strictly: fail closed.
const KNOWN_FLAGS = { '--spec': 'spec', '--project': 'project', '--floor': 'floor', '--title-prefix': 'titlePrefix' };
const flags = { spec: SPEC, project: PROJECT, floor: String(FLOOR), titlePrefix: null };
const flagArgs = process.argv.slice(3);
for (let i = 0; i < flagArgs.length; i += 2) {
  const key = flagArgs[i];
  const value = flagArgs[i + 1];
  if (!(key in KNOWN_FLAGS) || value === undefined || value.startsWith('--')) {
    console.error(
      `::error::Executed-count floor: bad argument '${key}'${value === undefined ? ' (no value)' : ''}. ` +
        `Usage: gate-c-executed-floor.mjs <report.json> [--spec <path>] [--project <name>] ` +
        `[--floor <n>] [--title-prefix <text>].`,
    );
    process.exit(1);
  }
  flags[KNOWN_FLAGS[key]] = value;
}
const IS_DEFAULT = flagArgs.length === 0;
const spec = flags.spec;
const project = flags.project;
const floor = Number(flags.floor);
const titlePrefix = flags.titlePrefix;
if (!/^\d+$/.test(flags.floor) || floor <= 0) {
  console.error(
    `::error::Executed-count floor: --floor must be a positive integer, got '${flags.floor}'. ` +
      `A floor of 0 passes a run that skipped everything.`,
  );
  process.exit(1);
}
const LABEL = IS_DEFAULT ? 'Gate C floor' : `Executed-count floor (${spec}, project '${project}')`;

if (!existsSync(REPORT)) {
  console.error(
    `::error::${LABEL}: no Playwright JSON report at ${REPORT}. The 'json' reporter was ` +
      `removed from playwright.config.ts, or its outputFile moved. That reporter is what makes ` +
      `${IS_DEFAULT ? "Gate C's" : "this gate's"} execution countable — restore it, do not delete this step.`,
  );
  process.exit(1);
}

let report;
try {
  report = JSON.parse(readFileSync(REPORT, 'utf8'));
} catch (err) {
  console.error(`::error::${LABEL}: ${REPORT} is not valid JSON (${err.message}).`);
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
    `::error::${LABEL}: ${REPORT} contains no specs at all. The report shape changed ` +
      `(Playwright major upgrade?) — this reader must be updated, not removed.`,
  );
  process.exit(1);
}

// `file` is reported relative to the config rootDir; match on the suffix so a
// rootDir change does not silently zero the count. The suffix is the chosen spec's
// BASENAME (`contrast.spec.ts` by default, exactly the literal this line used before
// it was generalised). `title` on a JSON-report spec is the test's own title, without
// its describe path, so `--title-prefix D10` selects the `test('D10…` declarations.
const specBase = spec.split('/').pop();
const gateCSpecs = allSpecs.filter(
  (s) =>
    (s.file ?? '').endsWith(specBase) &&
    (titlePrefix === null || (s.title ?? '').startsWith(titlePrefix)),
);

let passed = 0;
let skipped = 0;
let other = 0;
for (const spec of gateCSpecs) {
  for (const t of spec.tests ?? []) {
    if (t.projectName !== project) continue;
    // 'expected' = passed. 'flaky' = passed on retry, which still EXECUTED and
    // ended green; the job's own exit code owns the flakiness question.
    if (t.status === 'expected' || t.status === 'flaky') passed += 1;
    else if (t.status === 'skipped') skipped += 1;
    else other += 1;
  }
}

const selection = titlePrefix === null ? spec : `${spec}, titles starting '${titlePrefix}'`;
console.log(
  `${IS_DEFAULT ? 'Gate C' : 'Executed-count floor'} (${selection}, project '${project}'): ` +
    `${passed} passed, ${skipped} skipped, ${other} other (floor ${floor}).`,
);

if (passed < floor && !IS_DEFAULT) {
  console.error(
    `::error::Executed-count floor DISARMED: only ${passed} tests from ${selection} passed in ` +
      `the '${project}' project; the floor is ${floor} (${skipped} were skipped). Playwright ` +
      `exits 0 on a run that skipped everything, so the green checkmark above means nothing on ` +
      `its own. Check, in this order: (1) ci.yml's Playwright run line still passes ` +
      `--project=${project}; (2) that project's isMobile setting in playwright.config.ts; (3) the ` +
      `spec's test.skip(({ isMobile }) => …) predicate; (4) the test titles still start with the ` +
      `--title-prefix. Do NOT lower --floor to make this pass — if tests were deliberately ` +
      `REMOVED, lower it in the same commit and record why; never delete this step.`,
  );
  process.exit(1);
}

// The default invocation. `floor` (not the FLOOR constant) so a flagged run that MET its own
// floor never falls through to Gate C's 15 — for the default invocation the two are equal.
if (IS_DEFAULT && passed < floor) {
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
