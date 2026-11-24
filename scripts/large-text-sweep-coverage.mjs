#!/usr/bin/env node
/**
 * Large-text sweep coverage (Phase 89.6-08, SPEC R4).
 *
 * Usage: node scripts/large-text-sweep-coverage.mjs [--results <dir>] [--mode pr|full] [--close]
 *   --results  the folder e2e/large-text-sweep.spec.ts wrote (default test-results/large-text-sweep/results)
 *   --mode     the lane that was run: pr (7 cells, the default) or full (18 cells)
 *   --close    the phase-close run: a pending row is a failure too
 *   anything else exits 1, so a mistyped invocation reds instead of passing
 *
 * WHAT IT CHECKS. The sweep spec writes rows.json (every surface row with its owner and status,
 * and the cells of the lane it ran) and one file per enforced row, named by the row id, holding
 * every cell that row was read in with its verdict. This script holds rows against results:
 *   pending: <id> until <owner>   a row no plan has turned on yet (printed, failed only with --close)
 *   missing: <id> <cell>          an enforced row has no result for a cell of the lane
 *   failed: <id> <cell>           an enforced row's cell did not hold the checks
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
import { existsSync, readFileSync } from 'node:fs';
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

  for (const [id, ms] of times) lines.push(`time: ${id} ${seconds(ms)}s`);
  const sum = seconds(times.reduce((total, [, ms]) => total + ms, 0));
  lines.push(`sweep time (sum of rows): ${sum}s`);
  const overBudget = mode === 'pr' && sum > BUDGET_SECONDS;
  if (overBudget) {
    lines.push(`over budget: ${sum}s, the pr-mode budget is ${BUDGET_SECONDS}s (two CI workers make that about 7.5 minutes inside the 30-minute e2e job)`);
  }

  const ok = bad === 0 && missing === 0 && failed === 0 && !overBudget && !(close && pending.length > 0);
  lines.push(ok ? 'RESULT: PASS' : 'RESULT: FAIL');
  return { lines, ok };
}

function main(argv) {
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
