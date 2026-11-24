#!/usr/bin/env node
/**
 * Large-text sweep coverage (Phase 89.6-08, SPEC R4).
 *
 * Usage: node scripts/large-text-sweep-coverage.mjs [--results <dir>] [--mode pr|full] [--close]
 *        node scripts/large-text-sweep-coverage.mjs --self-test
 *   --results    the folder e2e/large-text-sweep.spec.ts wrote (default test-results/large-text-sweep/results)
 *   --mode       the lane that was run: pr (7 cells, the default) or full (18 cells)
 *   --close      the phase-close run: a pending row and an open empty state are failures too
 *   --self-test  plants eleven faults in folders under the system temp folder; exits 0 only when
 *                each is caught (takes no other flag)
 *   anything else exits 1, so a mistyped invocation reds instead of passing
 *
 * WHAT IT CHECKS. The sweep spec writes rows.json (every surface row with its owner and status,
 * and the cells of the lane it ran) and one file per enforced row, named by the row id, holding
 * every cell that row was read in with its verdict. This script holds rows against results:
 *   pending: <id> until <owner>   a row no plan has turned on yet (printed, failed only with --close)
 *   missing: <id> <cell>          an enforced row has no result for a cell of the lane
 *   failed: <id> <cell>           an enforced row's cell did not hold the checks
 *   empty-state open: <row> (<census> "<state>") until <owner>
 *                                 an empty state the census names that no ENFORCED row holds
 *                                 (SPEC AC-4 includes each surface's empty state); printed, and
 *                                 failed only with --close. It never says pending:, so a plan's
 *                                 own "no pending line" check is not tripped by it.
 * First the lane (lane: <mode>, <n> cells, and what rows.json says it ran);
 * then the counts, each enforced row's time and their sum, and a last line RESULT: PASS or
 * RESULT: FAIL (exit 0 or 1). In pr mode a sum above 900 s is a failure too: the first plan
 * whose row pushes the sweep over its budget sees it in its own run.
 *
 * WHY A SCRIPT AND NOT A TYPED FLOOR. A plan turns a row on by editing its own surface module;
 * what this script expects rises with that edit, so no floor number, registry row or ci.yml line
 * moves when a row turns on (fourteen plans would otherwise edit one file in one wave).
 *
 * Builtins only and JSON only: the e2e job's Node cannot read TypeScript, so the cell lists are
 * written here too and the spec's rows.json must name exactly the mode's list.
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const cells = (sizes, themes, mode, zoom = false) =>
  sizes.flatMap(([width, height]) => themes.map((theme) => `${width}x${height}-${theme}-${mode}${zoom ? '-zoom' : ''}`));

/** The PR lane: equal to PR_CELLS in e2e/support/largeTextSurfaces/index.ts. */
const PR_CELL_IDS = [
  '215x466-dark-100-zoom',
  '187x333-dark-100-zoom',
  '320x568-dark-200',
  '375x667-dark-200',
  '768x1024-dark-200',
  '375x667-light-200',
  '768x1024-dark-font32',
];

/** The full lane: three sizes x two themes x 100% and 200%, 768 font32 in both themes, the two page-zoom widths in both themes. */
const MATRIX_SIZES = [[320, 568], [375, 667], [768, 1024]];
const THEMES = ['dark', 'light'];
const FULL_CELL_IDS = [
  ...cells([[215, 466], [187, 333]], THEMES, '100', true),
  ...cells(MATRIX_SIZES, THEMES, '100'),
  ...cells(MATRIX_SIZES, THEMES, '200'),
  ...cells([[768, 1024]], THEMES, 'font32'),
];

const BUDGET_SECONDS = 900;
const seconds = (ms) => Math.round(ms / 100) / 10;

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Hold the rows against the results in one folder. Returns every printed line and the verdict. */
function check(dir, { mode = 'pr', close = false } = {}) {
  const lines = [];
  const fail = (line) => {
    lines.push(line);
    lines.push('RESULT: FAIL');
    return { lines, ok: false };
  };
  const expected = mode === 'full' ? FULL_CELL_IDS : PR_CELL_IDS;

  const manifestFile = join(dir, 'rows.json');
  if (!existsSync(manifestFile)) return fail('missing: rows.json');
  const manifest = readJson(manifestFile);
  if (!manifest || !Array.isArray(manifest.rows) || !Array.isArray(manifest.cells)) return fail('missing: rows.json (unreadable, or no rows and cells lists)');

  // The lane by name, so a green log says which cells were held (CI prints no line per passing test).
  lines.push(`lane: ${mode}, ${expected.length} cells (rows.json: mode ${manifest.mode}, ${manifest.cells.length} cells)`);

  let bad = 0;
  const listed = [...manifest.cells].sort().join(' ');
  if (listed !== [...expected].sort().join(' ')) {
    lines.push(`cells: rows.json lists ${manifest.cells.length} cells, and the ${mode} lane is ${expected.length} (${expected.join(', ')})`);
    bad += 1;
  }

  const seen = new Set();
  for (const row of manifest.rows) {
    const id = typeof row?.id === 'string' && row.id !== '' ? row.id : '(no id)';
    if (id === '(no id)') {
      lines.push('bad row: a row has no id');
      bad += 1;
    }
    if (seen.has(id)) {
      lines.push(`bad row: ${id} is declared twice`);
      bad += 1;
    }
    seen.add(id);
    if (typeof row?.owner !== 'string' || !/^89\.6-\d\d$/.test(row.owner)) {
      lines.push(`bad row: ${id} has no owning plan`);
      bad += 1;
    }
    if (row?.status !== 'pending' && row?.status !== 'enforced') {
      lines.push(`bad row: ${id} has no status`);
      bad += 1;
    }
  }

  if (!Array.isArray(manifest.emptyStates)) return fail('missing: emptyStates (rows.json holds no emptyStates list)');

  const enforced = manifest.rows.filter((row) => row?.status === 'enforced');
  const pending = manifest.rows.filter((row) => row?.status === 'pending');
  let missing = 0;
  let failed = 0;
  const times = [];
  for (const row of pending) lines.push(`pending: ${row.id} until ${row.owner}`);
  for (const row of enforced) {
    const result = readJson(join(dir, `${row.id}.json`));
    const read = new Map((Array.isArray(result?.cells) ? result.cells : []).map((entry) => [entry?.cell, entry?.verdict]));
    for (const cell of expected) {
      if (!read.has(cell)) {
        lines.push(`missing: ${row.id} ${cell}`);
        missing += 1;
      } else if (read.get(cell) !== 'pass') {
        lines.push(`failed: ${row.id} ${cell}`);
        failed += 1;
      }
    }
    times.push([row.id, typeof result?.ms === 'number' ? result.ms : 0]);
  }

  lines.push(`rows: ${manifest.rows.length}`);
  lines.push(`enforced: ${enforced.length}`);
  lines.push(`pending: ${pending.length}`);
  lines.push(`missing: ${missing}`);
  lines.push(`failed: ${failed}`);

  // An empty state is held only by an enforced row: its own row, or the row named in shownBy.
  const enforcedIds = new Set(enforced.map((row) => row.id));
  const open = manifest.emptyStates.filter((entry) => !enforcedIds.has(entry?.row) && !enforcedIds.has(entry?.shownBy));
  for (const entry of open) lines.push(`empty-state open: ${entry?.row} (${entry?.census} "${entry?.state}") until ${entry?.owner}`);
  lines.push(`empty-state parity: ${open.length}`);

  for (const [id, ms] of times) lines.push(`time: ${id} ${seconds(ms)}s`);
  const sum = seconds(times.reduce((total, [, ms]) => total + ms, 0));
  lines.push(`sweep time (sum of rows): ${sum}s`);
  const overBudget = mode === 'pr' && sum > BUDGET_SECONDS;
  if (overBudget) {
    lines.push(`over budget: ${sum}s, the pr-mode budget is ${BUDGET_SECONDS}s (two CI workers make that about 7.5 minutes inside the 30-minute e2e job)`);
  }

  const ok = bad === 0 && missing === 0 && failed === 0 && !overBudget && !(close && pending.length > 0) && !(close && open.length > 0);
  lines.push(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { lines, ok };
}

/** Plant eleven faults, each in its own results folder; true only when every one is caught. */
function selfTest() {
  const base = mkdtempSync(join(tmpdir(), 'large-text-sweep-coverage-'));
  const passCell = (cell) => ({ cell, verdict: 'pass' });
  const rowsFile = (over = {}) => ({
    mode: 'pr',
    cells: PR_CELL_IDS,
    rows: [
      { id: 'R17', census: 'R17', kind: 'route', owner: '89.6-08', status: 'enforced' },
      { id: 'R02', census: 'R02', kind: 'route', owner: '89.6-23', status: 'pending' },
    ],
    emptyStates: [{ census: 'R17', state: 'nothing here', row: 'R17', owner: '89.6-08' }],
    ...over,
  });
  const resultFile = (cellIds = PR_CELL_IDS, over = {}) => ({ id: 'R17', mode: 'pr', ms: 2000, cells: cellIds.map(passCell), ...over });
  let made = 0;
  const folder = (files) => {
    const dir = join(base, String((made += 1)));
    mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) writeFileSync(join(dir, name), JSON.stringify(body));
    return dir;
  };
  const allEnforced = [
    { id: 'R17', census: 'R17', kind: 'route', owner: '89.6-08', status: 'enforced' },
  ];
  // name, the results folder, the options, the expected verdict, a line the output must hold
  const cases = [
    ['no rows.json', folder({ 'R17.json': resultFile() }), {}, false, /^missing: rows\.json$/],
    ['an enforced row with no results file', folder({ 'rows.json': rowsFile() }), {}, false, /^missing: R17 320x568-dark-200$/],
    ['an enforced row missing one cell', folder({ 'rows.json': rowsFile(), 'R17.json': resultFile(PR_CELL_IDS.filter((id) => id !== '375x667-light-200')) }), {}, false, /^missing: R17 375x667-light-200$/],
    ['a failed cell', folder({ 'rows.json': rowsFile(), 'R17.json': resultFile(PR_CELL_IDS, { cells: PR_CELL_IDS.map((cell) => ({ cell, verdict: cell === '320x568-dark-200' ? 'fail' : 'pass' })) }) }), {}, false, /^failed: R17 320x568-dark-200$/],
    ['a pending row under --close', folder({ 'rows.json': rowsFile(), 'R17.json': resultFile() }), { close: true }, false, /^pending: R02 until 89\.6-23$/],
    ['a row with no owner', folder({ 'rows.json': rowsFile({ rows: [...allEnforced, { id: 'R02', census: 'R02', kind: 'route', status: 'pending' }] }), 'R17.json': resultFile() }), {}, false, /^bad row: R02 has no owning plan$/],
    ['a duplicate id', folder({ 'rows.json': rowsFile({ rows: [...allEnforced, ...allEnforced] }), 'R17.json': resultFile() }), {}, false, /^bad row: R17 is declared twice$/],
    ['a full-mode run whose rows.json lists the 7 PR cells', folder({ 'rows.json': rowsFile({ mode: 'full' }), 'R17.json': resultFile() }), { mode: 'full' }, false, /^cells: rows\.json lists 7 cells, and the full lane is 18 /],
    ['a pr-mode run whose rows take 901 s', folder({ 'rows.json': rowsFile(), 'R17.json': resultFile(PR_CELL_IDS, { ms: 901_000 }) }), {}, false, /^over budget: 901s, /],
    ['an empty state no enforced row holds, under --close', folder({ 'rows.json': rowsFile({ rows: allEnforced, emptyStates: [{ census: 'R01', state: 'No groups yet', row: 'R01-empty', owner: '89.6-16', shownBy: 'R01' }] }), 'R17.json': resultFile() }), { close: true }, false, /^empty-state open: R01-empty \(R01 "No groups yet"\) until 89\.6-16$/],
    ['a clean folder, its one empty state held by an enforced row, under --close', folder({ 'rows.json': rowsFile({ rows: allEnforced }), 'R17.json': resultFile() }), { close: true }, true, /^empty-state parity: 0$/],
  ];
  let held = 0;
  for (const [name, dir, options, expectOk, expectLine] of cases) {
    const { lines, ok } = check(dir, options);
    const last = lines[lines.length - 1];
    const good = ok === expectOk && last === (expectOk ? 'RESULT: PASS' : 'RESULT: FAIL') && lines.some((line) => expectLine.test(line));
    if (good) held += 1;
    console.log(`${good ? (expectOk ? 'passes' : 'caught') : 'NOT CAUGHT'}: ${name}${good ? '' : ` (got ${last}; ${lines.join(' | ')})`}`);
  }
  rmSync(base, { recursive: true, force: true });
  console.log(`self-test: ${held} of ${cases.length}`);
  return held === cases.length && cases.length === 11 ? 0 : 1;
}

function main(argv) {
  if (argv.length === 1 && argv[0] === '--self-test') return selfTest();
  const options = { results: join('test-results', 'large-text-sweep', 'results'), mode: 'pr', close: false };
  for (let at = 0; at < argv.length; at += 1) {
    const flag = argv[at];
    if (flag === '--close') options.close = true;
    else if (flag === '--results' && argv[at + 1] !== undefined) options.results = argv[(at += 1)];
    else if (flag === '--mode' && (argv[at + 1] === 'pr' || argv[at + 1] === 'full')) options.mode = argv[(at += 1)];
    else {
      console.error(`large-text-sweep-coverage: bad argument '${flag}'${argv[at + 1] === undefined ? '' : ` ${argv[at + 1]}`}. Usage: [--results <dir>] [--mode pr|full] [--close]`);
      return 1;
    }
  }
  const { lines, ok } = check(options.results, options);
  for (const line of lines) console.log(line);
  return ok ? 0 : 1;
}

process.exit(main(process.argv.slice(2)));
