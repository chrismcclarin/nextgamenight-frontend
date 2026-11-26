// The per-surface large-text sweep (Phase 89.6-08, SPEC R4).
//
// WHAT. One test per surface row of e2e/support/largeTextSurfaces/index.ts ("WHAT A ROW IS"),
// plus one always-run test that checks the row list and writes it down. An enforced row is reached
// on the real app and read in every cell of the lane by plan 89.6-02's one page read
// (readLargeTextCell, and readPageZoomCell at the two page-zoom widths). A pending row is listed
// and skipped with the plan that owns it. The sweep is the instrument: it fixes nothing.
//
// READ-ONLY. Every page a test opens gets sweepWriteGuard before its first navigation: every
// non-GET on every URL is held in the browser, the self read is sent on without its timezone
// parameter, and a GET that writes is answered by the row or held. The test ends with
// expectNoApiWrites on each page's hold, and fails when it opened a page with no guard.
//
// HOW 200% IS PRODUCED. setTextMode: '200' is a style tag on the root (it can be set and left on
// the same page); 'font32' is Chromium's default font size set to 32px, which is one-way on a
// page, so each font32 cell runs on a fresh page of the same context.
//
// EXCEPTIONS. The five texts of e2e/support/largeTextExceptions.ts ("DECISION Phase 89.6-08 (exceptions): the cut check skips exactly five texts")
// are skipped by the cut check, and nothing else is. Inside the three surfaces another phase owns,
// split, held and spilling words are cleared too (spill by orchestrator ruling D12, plan 89.6-16)
// and written into the cell's record as cleared.
//
// SIDEWAYS (R16, 2026-11-26). Every box that scrolls sideways inside the row's root is listed in
// the cell's record, and fails the cell when one item in it is wider than its window, but for the
// excepted grids and the QR code: e2e/support/wordLines.ts ("DECISION Phase 89.6 R16 (sideways boxes)").
// At the two page-zoom cells a sideways scroll of the page, of a dialog box or of such a box is
// printed (in the record, and as an L2 line in the CI log) and does not fail the cell, by the
// owner's ruling: e2e/support/wordLines.ts ("DECISION Phase 89.6 R16 (L2)").
//
// RESULTS. The row test writes test-results/large-text-sweep/results/<row id>.json (every cell
// with its verdict and read, and the row's wall time) BEFORE it asserts, and the row-list test
// writes rows.json there. scripts/large-text-sweep-coverage.mjs reads that folder in CI and says
// which rows are pending, and which cell of an enforced row is missing or failed.
//
// DECISION Phase 89.6-08 (sweep): one test per surface row runs every cell of the lane on one
// reached page (zoom cells at normal text first, then the 320 normal-text cell R16 added, then the 200% style-tag cells, then the font32
// cell on a fresh page in the same context, which registers its own sweepWriteGuard before its
// first navigation, re-runs reach, and ends with its own expectNoApiWrites; holdWrites routes one
// page only, so the fresh page needs its own guard), chosen OVER one test per row and cell (about
// 400 signed-in navigations would not fit the e2e job) and OVER a spec per surface (the checks
// and the guard would be copied). Pending rows stay listed and skipped, so the --list count never
// moves when a row turns on; the executed count rises through the coverage script, not a typed
// floor. Changing this is a decision, not a cleanup.
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';
import { expectNoApiWrites, settleAnimations } from './support/inFlight';
import { EXCEPTIONS, readCellUnderExceptions, readPageZoomCellUnderExceptions, type ClearedBySurface } from './support/largeTextExceptions';
import {
  ALL_ROWS,
  CENSUS_IDS,
  EMPTY_STATES,
  FULL_CELLS,
  PR_CELLS,
  WRITE_GETS,
  WRITE_GET_HANDLERS,
  laneOf,
  sweepWriteGuard,
  type SurfaceRow,
  type SweepCell,
  type SweepHold,
} from './support/largeTextSurfaces/index';
import {
  SIDEWAYS_BOX_EXCEPTIONS,
  expectLargeTextCell,
  expectPageZoomUsable,
  readLargeTextCell,
  setTextMode,
  sidewaysRecorded,
  type LargeTextCellRead,
  type PageZoomRead,
} from './support/wordLines';

test.skip(({ isMobile }) => isMobile, 'the sweep sets its own viewport per cell and runs once, in the journeys project');

// Every row is read-only under its own guard and writes only its own results file, so the rows
// spread over the workers instead of running one after another.
test.describe.configure({ mode: 'parallel' });

const RAW_MODE = process.env.LARGE_TEXT_SWEEP_MODE ?? '';
if (RAW_MODE !== '' && RAW_MODE !== 'pr' && RAW_MODE !== 'full') {
  throw new Error('LARGE_TEXT_SWEEP_MODE must be pr or full');
}
const MODE: 'pr' | 'full' = RAW_MODE === 'full' ? 'full' : 'pr';
const RESULTS_DIR = process.env.LARGE_TEXT_SWEEP_RESULTS ?? join('test-results', 'large-text-sweep', 'results');
// The PR lane on every push; the full lane only when ci.yml's large-text-full dispatch input says so.
const LANE: readonly SweepCell[] = laneOf(MODE);

function writeResult(name: string, body: unknown): string {
  mkdirSync(RESULTS_DIR, { recursive: true });
  const text = JSON.stringify(body, null, 2);
  writeFileSync(join(RESULTS_DIR, name), text);
  return text;
}

interface CellRecord {
  cell: string;
  verdict: 'pass' | 'fail';
  /** The root font size and the window width the cell was read at. */
  fontSize: string;
  window: number;
  read: LargeTextCellRead | PageZoomRead;
  /** The split, held and spill entries inside a surface another phase owns (SPEC A3 (2) to (4); spill by ruling D12); absent when there are none. */
  cleared?: ClearedBySurface;
  /** The first line of what failed, when the verdict is fail. */
  why?: string;
}

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/**
 * Wait until the page's size and text stop changing from one frame to the next. With clock 'held'
 * (a row whose reach leaves the page clock paused) each step advances the paused clock instead.
 */
// DECISION Phase 89.6-25 (held-clock): an opt-in held settle, chosen OVER waiting on animation
// frames for every row (a paused page clock fires none, so the settle never returns: measured in
// the row-list test's held-clock control), OVER a test seam inside FeedbackForm (a production change
// made only for a test) and OVER wrapping the page's setTimeout (a hack). Each step advances the
// paused clock by two 32ms frames (page.clock.runFor runs the frame callbacks and the timers due)
// and then lets 32ms of real rendering pass (layout observers ride the browser's own frames, which
// the clock does not hold). Rows without clock: 'held' take the frame branch exactly as before.
// Orchestrator ruling D10 (plan 25, D11). Changing this is a decision, not a cleanup.
async function settleLayout(page: Page, root: Locator, clock: 'frames' | 'held' = 'frames'): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleAnimations(root);
  if (clock === 'held') {
    const snapshot = () => page.evaluate(() => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}:${document.body.innerText.length}`);
    let before = await snapshot();
    for (let tries = 0; tries < 30; tries += 1) {
      await page.clock.runFor(32);
      await page.waitForTimeout(32);
      const now = await snapshot();
      if (now === before) return;
      before = now;
    }
    return;
  }
  await page.evaluate(async () => {
    const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const snapshot = () => `${document.documentElement.scrollWidth}x${document.documentElement.scrollHeight}:${document.body.innerText.length}`;
    let before = snapshot();
    for (let tries = 0; tries < 30; tries += 1) {
      await frame();
      await frame();
      const now = snapshot();
      if (now === before) return;
      before = now;
    }
  });
}

/** The root font size a style-tag cell's text mode gives the page. */
const STYLE_TAG_ROOT: Record<'100' | '200', string> = { '100': '16px', '200': '32px' };

/**
 * Size a reached page for one cell: the window first, then the text mode, which is set unless the
 * page already shows it (its root font size is the cell's).
 */
// DECISION Phase 89.6 R15 (O03 flake): a style-tag cell whose text size the page already shows leaves
// it on, chosen OVER calling setTextMode again for every cell, as the sweep did. setTextMode
// swaps a style-tag mode in two round trips (it removes the tag, then adds the new one), so a repeated
// 200% passed through normal text for a moment. At the 768 x 1024 200% cell the window is already 768
// wide when that happens; at normal text the phone menu button is not drawn there, the strip's rem
// height shrinks, and the header closes the menu, which is correct product behaviour:
// src/app/Header.js ("DECISION Phase 88.9-52 (R4 S2): an open menu closes")
// Focus then goes back to the menu button, out of the bell, and the bell closes too: O03 waited on a
// missing Notifications region whenever a frame landed between the two round trips (CI runs
// 45786993394 and 45798602999; reproduced locally, signed out, in the R15 record:
// planning:.planning/phases/89.6-large-text-200-method-test-ci-coverage-audit-inserted-2026-1/execute/R15-O03-FLAKE-RECORD.md ("Measurement")).
// Also chosen OVER re-opening the row in each cell (it would hide a text size no cell asks for, which
// closes O01's and O02's menu too). The page itself is asked, chosen OVER a record of the last mode
// the sweep set: a row's extras may change the mode inside a cell and leave the next cell to set it
// again (D07 reads normal text inside its 320 cell:
// e2e/support/largeTextSurfaces/dialogs.ts ("normal-text pass")
// and a record would have left its 375 and 768 cells at normal text: CI run 45805337924). A font32
// cell always calls setTextMode, whose own repeat is a no-op. Every cell still checks the root font
// size it was read at (expectCell). Changing this is a decision, not a cleanup.
async function sizeForCell(target: Page, cell: SweepCell, tag: string): Promise<void> {
  await target.setViewportSize({ width: cell.width, height: cell.height });
  if (cell.mode !== 'font32') {
    const root = await target.evaluate(() => getComputedStyle(document.documentElement).fontSize);
    if (root === STYLE_TAG_ROOT[cell.mode]) return;
  }
  await setTextMode(target, cell.mode, tag);
}

/** The check one cell must hold: the lighter A8 check at a page-zoom width, else the five checks. */
function expectCell(record: CellRecord, cell: SweepCell, tag: string): void {
  expect(record.window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
  // A cell read at the wrong text size measures nothing: 16px at normal text, 32px at 200% and font32.
  expect(record.fontSize, `${tag}: the root font size is not the cell's`).toBe(cell.mode === '100' ? '16px' : '32px');
  if (cell.zoom) expectPageZoomUsable(record.read as PageZoomRead, tag);
  else expectLargeTextCell(record.read as LargeTextCellRead, tag);
}

async function runRow(page: Page, row: SurfaceRow, testInfo: TestInfo): Promise<void> {
  const started = Date.now();
  const reach = row.reach;
  if (!reach) throw new Error(`${row.id} is enforced and has no reach`);

  // Every page this test opens after its first, and every page that was given the guard.
  const opened: Page[] = [];
  const guarded = new Set<Page>();
  const holds: SweepHold[] = [];
  page.context().on('page', (other) => opened.push(other));
  const guard = async (target: Page): Promise<void> => {
    guarded.add(target);
    holds.push(await sweepWriteGuard(target, row));
  };

  const records: CellRecord[] = [];
  let broke: unknown;

  const readCell = async (target: Page, reached: { root: Locator; dialog?: Locator }, cell: SweepCell): Promise<void> => {
    const tag = `${row.id} ${cell.id}`;
    await sizeForCell(target, cell, tag);
    await settleLayout(target, reached.root, row.clock ?? 'frames');
    // A dialog's own box eases to its new height after a viewport change (its height cap is in
    // dvh and the box carries a max-height transition), and the root of a dialog row may sit
    // INSIDE that box, where the wait above does not look. So the box itself is settled too.
    // Added by Phase 89.6-10: CI run 45476434216 read three dialog shell rows mid-ease at
    // 187 x 333 (the header "starts above the page") on the first attempt and passed on the retry.
    if (reached.dialog) await settleAnimations(reached.dialog);
    // Immediately before the read: the size and width this cell is really measured at.
    const at = await target.evaluate(() => ({ fontSize: getComputedStyle(document.documentElement).fontSize, window: document.documentElement.clientWidth }));
    // A page-zoom cell only records split and held words, so only the cut exceptions matter there.
    const matrix = cell.zoom ? null : await readCellUnderExceptions(reached.root, { dialog: reached.dialog });
    const zoom = matrix ? null : await readPageZoomCellUnderExceptions(reached.root, { dialog: reached.dialog });
    const read = matrix ? matrix.read : zoom!.read;
    // Owner ruling L2: at a page-zoom cell a sideways scroll is printed, here for the CI log (the record holds it too), not failed.
    const sideways = zoom ? sidewaysRecorded(zoom.read) : [];
    if (sideways.length > 0) process.stdout.write(`L2 recorded, not failed: ${tag}: ${sideways.join(' | ')}\n`);
    const record: CellRecord = { cell: cell.id, verdict: 'pass', fontSize: at.fontSize, window: at.window, read };
    if (matrix && matrix.cleared.split.length + matrix.cleared.held.length + matrix.cleared.spill.length > 0) record.cleared = matrix.cleared;
    if (zoom && zoom.cleared.length > 0) record.cleared = { split: [], held: [], spill: [], lost: zoom.cleared };
    try {
      expectCell(record, cell, tag);
    } catch (error) {
      record.verdict = 'fail';
      record.why = firstLine(error);
    }
    if (row.extras) {
      try {
        await row.extras(target, cell);
      } catch (error) {
        record.verdict = 'fail';
        record.why = record.why ?? `${tag}: ${firstLine(error)}`;
      }
    }
    records.push(record);
  };

  // One reached page per theme and kind of text mode: the page is given its guard and its theme
  // BEFORE its first navigation (the theme is an init script, read by the next document).
  const reachAndRead = async (target: Page, theme: 'light' | 'dark', cells: readonly SweepCell[]): Promise<void> => {
    await target.emulateMedia({ colorScheme: theme });
    await target.setViewportSize(row.reachAt ?? { width: cells[0].width, height: cells[0].height });
    const reached = await reach(target);
    await assertTheme(target, theme);
    for (const cell of cells) await readCell(target, reached, cell);
  };

  try {
    await guard(page);
    const styleTagCells = (theme: 'light' | 'dark') => LANE.filter((cell) => cell.mode !== 'font32' && cell.theme === theme);
    const font32Cells = (theme: 'light' | 'dark') => LANE.filter((cell) => cell.mode === 'font32' && cell.theme === theme);

    // Dark first (the journeys scheme). The stored sign-in may carry a theme, and local storage is
    // shared by every page of the context, so each page writes its own theme before it loads.
    const darkWriter = await page.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
    if (styleTagCells('dark').length > 0) await reachAndRead(page, 'dark', styleTagCells('dark'));
    await darkWriter.dispose();
    if (styleTagCells('light').length > 0) {
      // One theme writer per page at a time: the order of two init scripts is not defined. The
      // reach runs again under the same guard (its routes outlive a navigation); a reload drops
      // the style tag and closes a reached dialog, so the cell sets its text mode again.
      await forceLightMode(page);
      await reachAndRead(page, 'light', styleTagCells('light'));
    }

    // font32 is one-way on a page: one fresh page per theme, guarded before its first navigation.
    for (const theme of ['dark', 'light'] as const) {
      const cells = font32Cells(theme);
      if (cells.length === 0) continue;
      const fresh = await page.context().newPage();
      await guard(fresh);
      if (theme === 'light') await forceLightMode(fresh);
      else await fresh.addInitScript(() => window.localStorage.setItem('theme', 'dark'));
      await reachAndRead(fresh, theme, cells);
      await fresh.close();
    }
  } catch (error) {
    broke = error;
  }

  // Written and attached BEFORE anything is asserted: the coverage script and a reader of a red
  // run both need every cell that was read.
  const result = writeResult(`${row.id}.json`, {
    id: row.id,
    census: row.census,
    owner: row.owner,
    mode: MODE,
    ms: Date.now() - started,
    cells: records,
    ...(broke === undefined ? {} : { broke: firstLine(broke) }),
  });
  await testInfo.attach(`${row.id}-cells`, { body: result, contentType: 'application/json' });

  if (broke !== undefined) throw broke;
  // Every failing cell in ONE assertion, each with its tag and its whole read: a red CI log then
  // names them all (the failure artifacts leave CI encrypted, so the log is what a plan can read).
  const failedCells = records.filter((record) => record.verdict === 'fail');
  expect(
    failedCells.map((record) => record.why),
    `${row.id}: ${failedCells.length} of ${records.length} cells did not hold the large-text checks`,
  ).toEqual([]);
  expect(records.map((record) => record.cell).sort(), `${row.id}: not every cell of the ${MODE} lane was read`).toEqual(LANE.map((cell) => cell.id).sort());
  for (const hold of holds) {
    expectNoApiWrites(hold);
    expect(hold.writeGets, `${row.id}: a GET that writes was held with no answer; give the row an answers entry for it`).toEqual([]);
  }
  expect(
    opened.filter((other) => !guarded.has(other)).map((other) => other.url()),
    'a sweep test opened a page with no write guard',
  ).toEqual([]);
}

// The backend's route files: where CI's e2e job checks the backend out, else this machine's layout.
const BACKEND_ROUTE_DIRS = [join('backend', 'Sonnet', 'routes'), join('..', 'periodictabletopbackend_v2', 'Sonnet', 'routes')];
const WRITING_CALL = /\.(?:update|save|create|destroy|bulkCreate|upsert|increment|findOrCreate)\(|\bgenerate\w*Token\(|\bprovisionOrRepair\(/;

/** Every GET handler in the backend's route files that writes, as "<file> <router path>". */
function writingGetHandlers(): string[] {
  const dir = BACKEND_ROUTE_DIRS.find((candidate) => existsSync(candidate));
  if (!dir) throw new Error(`the backend's route files were found at neither ${BACKEND_ROUTE_DIRS.join(' nor ')}`);
  const found: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith('.js')).sort()) {
    // Comments out: block comments keep their line breaks, then line comments (not the // of a URL).
    const code = readFileSync(join(dir, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, ' '))
      .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
    // A handler runs from a column-0 router.get( to the next column-0 router. call.
    const starts = [...code.matchAll(/^router\.\w+\(/gm)].map((match) => ({ at: match.index ?? 0, get: match[0] === 'router.get(' }));
    starts.forEach((start, index) => {
      if (!start.get) return;
      const body = code.slice(start.at, index + 1 < starts.length ? starts[index + 1].at : code.length);
      if (!WRITING_CALL.test(body)) return;
      found.push(`${file} ${body.match(/^router\.get\(\s*(['"`])([^'"`]+)\1/)?.[2] ?? '(no literal path)'}`);
    });
  }
  return found.sort();
}

const occurrences = (hay: string, needle: string): number => hay.split(needle).length - 1;

// One page for the exceptions control: a squeezed word (split) in the open, in the month grid's
// selector and in the description's, and a word held by a 40px box in the open and in the tutorial's.
const squeezed = (word: string) => `<div style="display:flex"><div style="flex:0 0 250px">x</div><div style="min-width:0;overflow-wrap:anywhere">${word}</div></div>`;
const heldBox = (word: string) => `<div style="width:40px;overflow-wrap:anywhere">${word}</div>`;
const EXCEPTIONS_CONTROL =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="margin:0;font:16px/1.4 sans-serif"><main style="width:300px">' +
  squeezed('Weekend') +
  `<div class="grid grid-cols-7">${squeezed('Warriors')}</div>` +
  `<div id="game-description">${squeezed('Tuesday')}</div>` +
  heldBox('Saturday') +
  `<div class="fixed inset-0 z-60">${heldBox('Thursday')}</div>` +
  '</main></body></html>';
// The spill half of the exceptions control (orchestrator ruling D12, plan 89.6-16): a word wider than
// its 30px filled box spills out of it, in the open, in the month grid's selector, and in the two
// cut-only exceptions' (the description's and the header site name's). The second page holds spills
// only, so it shows that a spill alone starts the second read.
const spillBox = (word: string) => `<div style="width:30px;background:#eee">${word}</div>`;
const SPILLS =
  spillBox('Carcassonne') +
  `<div class="grid grid-cols-7">${spillBox('Gloomhaven')}</div>` +
  `<div id="game-description">${spillBox('Wingspan')}</div>` +
  '<nav><a href="/" style="display:block;width:30px"><span class="whitespace-nowrap">Nextgamenight</span></a></nav>';
// The page-zoom clamp control (orchestrator ruling D27, plan 89.6-40): three titles at 215 wide, each
// with more words than its box shows. Alpha is an A3-3 list-row title cut by its OWN two-line clamp
// (the clamp the exception names); Bravo carries the same classes and clamp outside a row button, so
// no exception selector matches it; Charlie is an A3-3 title cut by a 20px parent box, not by itself.
const clampTitle = (word: string) => `<h5 class="font-bold text-base line-clamp-2" style="display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin:0">${word} Jaws of the Lion with every expansion box and the whole long subtitle</h5>`;
const CLAMP_CONTROL =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  '<body style="margin:0;font:16px/1.4 sans-serif"><main style="width:200px">' +
  `<div role="button" tabindex="0">${clampTitle('Alpha')}</div>` +
  clampTitle('Bravo') +
  `<div role="button" tabindex="0"><div style="height:20px;overflow:hidden"><h5 class="font-bold text-base line-clamp-2" style="margin:0">Charlie Jaws of the Lion with every expansion box</h5></div></div>` +
  '</main></body></html>';
const SPILL_CONTROL = (body: string) =>
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>' +
  `<body style="margin:0;font:16px/1.4 sans-serif"><main style="width:300px">${body}</main></body></html>`;
// One page for the held-clock control: a frame callback that makes the page taller, and a
// two-second timer that removes a line, both armed after the clock is paused.
const CLOCK_CONTROL =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"></head>' +
  '<body style="margin:0"><main><p id="thanks">Thank You!</p><div id="grow" style="height:10px"></div></main></body></html>';
const wordsOf = (entries: readonly string[]): string[] => entries.map((entry) => entry.match(/^"([^"]+)"/)?.[1] ?? entry).sort();

test('sweep rows (89.6-08): every surface row is declared once, with a census id, an owner and a status', async ({ page }) => {
  const ids = ALL_ROWS.map((row) => row.id);
  expect(ids.filter((id, at) => ids.indexOf(id) !== at), 'a row id is declared twice').toEqual([]);
  expect(ALL_ROWS.filter((row) => !/^89\.6-\d\d$/.test(row.owner)).map((row) => row.id), 'a row has no owning plan (89.6-NN)').toEqual([]);
  expect(ALL_ROWS.filter((row) => !/^(R|D|O)\d\d$/.test(row.census)).map((row) => row.id), 'a row has no census id').toEqual([]);
  expect(ALL_ROWS.filter((row) => row.status !== 'pending' && row.status !== 'enforced').map((row) => row.id), 'a row has no status').toEqual([]);
  expect(ALL_ROWS.filter((row) => row.status === 'enforced' && !row.reach).map((row) => row.id), 'an enforced row has no reach').toEqual([]);
  // R16 (owner, 2026-11-26: "Add the 320px normal text check."): the lane's third cell is 320 x 568 at normal text, the
  // size WCAG 2.2 SC 1.4.10 Reflow itself tests at (320 CSS pixels wide), which the lane did not have.
  expect(PR_CELLS.map((cell) => cell.id), 'the PR lane is eight cells: the two page-zoom widths, 320 at normal text, three 200% cells in dark, one in light, and font32').toEqual([
    '215x466-dark-100-zoom',
    '187x333-dark-100-zoom',
    '320x568-dark-100',
    '320x568-dark-200',
    '375x667-dark-200',
    '768x1024-dark-200',
    '375x667-light-200',
    '768x1024-dark-font32',
  ]);
  expect(PR_CELLS.filter((cell) => cell.mode === '100' && !cell.zoom).map((cell) => `${cell.width}x${cell.height}`), "the PR lane reads the standard's own size, 320 wide at normal text, with the full checks").toEqual(['320x568']);
  expect(PR_CELLS.filter((cell) => cell.theme === 'light').map((cell) => cell.id), 'the PR lane holds exactly one light cell').toEqual(['375x667-light-200']);
  expect(FULL_CELLS.length, 'the full lane is eighteen cells').toBe(18);
  expect(new Set(FULL_CELLS.map((cell) => cell.id)).size, 'a cell id is declared twice').toBe(FULL_CELLS.length);
  expect(PR_CELLS.filter((cell) => !FULL_CELLS.some((other) => other.id === cell.id)).map((cell) => cell.id), 'a PR-lane cell is missing from the full lane').toEqual([]);
  expect(FULL_CELLS.filter((cell) => cell.theme === 'light').length, 'the full lane reads every cell in both themes').toBe(9);
  expect(LANE.length, 'the lane is the mode\'s').toBe(MODE === 'full' ? 18 : 8);

  // The rows and the census cannot drift apart: a module removed, or a skipped id given a row.
  expect([...new Set(ALL_ROWS.map((row) => row.census))].sort(), 'the census ids of the surface rows differ from CENSUS_IDS').toEqual([...new Set(CENSUS_IDS)].sort());
  expect(CENSUS_IDS.length, 'CENSUS_IDS is 17 routes, 33 in-sweep dialogs and 9 overlays, each once').toBe(59);
  expect(new Set(CENSUS_IDS).size, 'a census id is listed twice').toBe(CENSUS_IDS.length);
  expect(EMPTY_STATES.length, 'the census names twelve empty states for in-sweep surfaces; an entry is never removed').toBeGreaterThanOrEqual(12);
  expect(EMPTY_STATES.filter((entry) => !CENSUS_IDS.includes(entry.census)).map((entry) => entry.row), 'an empty state names a census id outside the sweep').toEqual([]);
  expect(EMPTY_STATES.filter((entry) => !/^89\.6-\d\d$/.test(entry.owner) || entry.row === '' || entry.state === '').map((entry) => entry.row), 'an empty state has no row, state or owner').toEqual([]);

  // The exceptions list: exactly five, each bound to its source.
  expect(EXCEPTIONS.map((entry) => entry.id), 'the exceptions list is exactly SPEC A3 (1) to (4) and A10; a sixth needs a SPEC amendment').toEqual(['A3-1', 'A3-2', 'A3-3', 'A3-4', 'A10']);
  expect(EXCEPTIONS.filter((entry) => entry.clears === 'surface').map((entry) => entry.id), 'split and held words are cleared only inside the three surfaces another phase owns').toEqual(['A3-2', 'A3-3', 'A3-4']);
  for (const entry of EXCEPTIONS) {
    expect(entry.selector.trim(), `${entry.id}: no selector`).not.toBe('');
    const source = readFileSync(entry.source.file, 'utf8');
    for (const snippet of [entry.source.snippet, ...(entry.source.alsoOnce ?? [])]) {
      expect(occurrences(source, snippet), `${entry.id}: its source snippet must occur exactly once in ${entry.source.file}: ${snippet}`).toBe(1);
    }
    if (entry.source.folder) expect(existsSync(entry.source.folder) && statSync(entry.source.folder).isDirectory(), `${entry.id}: ${entry.source.folder} is not a folder`).toBe(true);
  }

  // R16: only the entry that names clamped texts may clear a page-zoom clip, never a container.
  expect(EXCEPTIONS.filter((entry) => entry.ownClamp === true).map((entry) => entry.id), 'only the list-row titles (A3-3) name clamped texts; the month grid and the tutorial are containers').toEqual(['A3-3']);
  expect(EXCEPTIONS.filter((entry) => entry.clears === 'cut').map((entry) => entry.id), 'the cut-only exceptions, each excused its own clamp and never a sideways cut').toEqual(['A3-1', 'A10']);

  // The excepted list of the sideways-box check (R16): exactly these, each with the standard's reason and bound to its source.
  expect(SIDEWAYS_BOX_EXCEPTIONS.map((entry) => entry.id), 'the sideways-box check excepts tables and grids, the three named grids and the QR code, and nothing else').toEqual(['SB-1', 'SB-2', 'SB-3', 'SB-4', 'SB-5']);
  for (const entry of SIDEWAYS_BOX_EXCEPTIONS) {
    expect(entry.selector.trim(), `${entry.id}: no selector`).not.toBe('');
    expect(entry.reason, `${entry.id}: its reason is not one of the standard's excepted kinds`).toMatch(/^(data tables \(not individual cells\)|images required for understanding \(such as maps and diagrams\))/);
    expect(entry.source === undefined, `${entry.id}: only the generic entry (SB-1) has no source`).toBe(entry.id === 'SB-1');
    if (entry.source) expect(occurrences(readFileSync(entry.source.file, 'utf8'), entry.source.snippet), `${entry.id}: its source snippet must occur exactly once in ${entry.source.file}: ${entry.source.snippet}`).toBe(1);
  }

  // The exceptions at work, on a page of this test's own (no request leaves it).
  await page.setViewportSize({ width: 320, height: 568 });
  await page.setContent(EXCEPTIONS_CONTROL);
  const control = page.locator('main');
  const raw = await readLargeTextCell(control);
  expect(wordsOf(raw.split), 'the control page holds three squeezed words').toEqual(['Tuesday', 'Warriors', 'Weekend']);
  expect(wordsOf(raw.held), 'the control page holds two held words').toEqual(['Saturday', 'Thursday']);
  const under = await readCellUnderExceptions(control);
  expect(wordsOf(under.read.split), 'a split word inside the month grid is cleared; one in the open, and one in a cut-only exception, are not').toEqual(['Tuesday', 'Weekend']);
  expect(wordsOf(under.read.held), 'a held word inside the tutorial is cleared; one in the open is not').toEqual(['Saturday']);
  expect({ split: wordsOf(under.cleared.split), held: wordsOf(under.cleared.held) }, 'what the surfaces cleared is written down').toEqual({ split: ['Warriors'], held: ['Thursday'] });
  expect(await page.locator('style').count(), 'the read left its hiding style on the page').toBe(0);

  // Spill too (orchestrator ruling D12): a spill inside the month grid is cleared; one in the open,
  // and one inside a cut-only exception (A3-1, A10), are not. First beside the split and held words
  // above, whose lists must come out exactly as before; then on a page with spills only.
  await page.setContent(EXCEPTIONS_CONTROL.replace('</main>', `${SPILLS}</main>`));
  const rawWithSpill = await readLargeTextCell(control);
  expect(wordsOf(rawWithSpill.spill), 'the control page holds four spilling words').toEqual(['Carcassonne', 'Gloomhaven', 'Nextgamenight', 'Wingspan']);
  const underWithSpill = await readCellUnderExceptions(control);
  expect(wordsOf(underWithSpill.read.spill), 'a spill inside the month grid is cleared; one in the open, and one in a cut-only exception (A3-1, A10), are not').toEqual(['Carcassonne', 'Nextgamenight', 'Wingspan']);
  expect({ split: wordsOf(underWithSpill.read.split), held: wordsOf(underWithSpill.read.held) }, 'clearing spill changed what split and held clear').toEqual({ split: ['Tuesday', 'Weekend'], held: ['Saturday'] });
  expect({ split: wordsOf(underWithSpill.cleared.split), held: wordsOf(underWithSpill.cleared.held), spill: wordsOf(underWithSpill.cleared.spill) }, 'what the surfaces cleared, spill included, is written down').toEqual({
    split: ['Warriors'],
    held: ['Thursday'],
    spill: ['Gloomhaven'],
  });
  await page.setContent(SPILL_CONTROL(SPILLS));
  const spillOnly = await readCellUnderExceptions(control);
  expect({ split: spillOnly.read.split, held: spillOnly.read.held }, 'the spill-only page holds no split or held word').toEqual({ split: [], held: [] });
  expect(wordsOf(spillOnly.read.spill), 'a spill alone does not start the second read: the month-grid spill is not cleared').toEqual(['Carcassonne', 'Nextgamenight', 'Wingspan']);
  expect(wordsOf(spillOnly.cleared.spill), 'the spill-only page did not write down the cleared spill').toEqual(['Gloomhaven']);
  expect(await page.locator('style').count(), 'the spill read left its hiding style on the page').toBe(0);

  // The page-zoom clamp (orchestrator ruling D27): a loss is cleared only when the clipped text and
  // the box that clips it both match one surface exception (the clamp is the exception's own).
  await page.setViewportSize({ width: 215, height: 466 });
  await page.setContent(CLAMP_CONTROL);
  const zoomed = await readPageZoomCellUnderExceptions(control);
  const titled = (entries: readonly string[], word: string) => entries.filter((entry) => entry.includes(`h5 "${word} `));
  expect(titled(zoomed.read.lost, 'Alpha'), 'an A3-3 title clipped by its own clamp at a page-zoom width is not lost').toEqual([]);
  expect(titled(zoomed.cleared, 'Alpha'), 'the A3-3 title clipped by its own clamp is written down as cleared').toEqual([expect.stringContaining('is clipped by its h5')]);
  expect(titled(zoomed.read.lost, 'Bravo'), 'the same clamp outside the exception selector is still lost').toContainEqual(expect.stringContaining('is clipped by its h5'));
  expect(titled(zoomed.read.lost, 'Charlie'), 'an A3-3 title clipped by a parent box is still lost').toContainEqual(expect.stringContaining('is clipped by its div'));
  expect(titled(zoomed.cleared, 'Bravo').concat(titled(zoomed.cleared, 'Charlie')), 'nothing but the own clamp is cleared').toEqual([]);
  await page.setViewportSize({ width: 320, height: 568 });

  // The cell sizing (R15, the DECISION above sizeForCell), on a page of this test's own: the 375 and
  // the 768 200% cells in the lane's order do not take the 200% tag off between them (taking it off
  // put O03's open menu at 768 x 1024 through normal text), and a change of mode still lands.
  await page.setContent(SPILL_CONTROL('<p>Text</p>'));
  await page.evaluate(() => {
    const counter = window as unknown as { styleTagsRemoved: number };
    counter.styleTagsRemoved = 0;
    new MutationObserver((records) => {
      for (const record of records) counter.styleTagsRemoved += Array.from(record.removedNodes).filter((node) => node.nodeName === 'STYLE').length;
    }).observe(document.head, { childList: true });
  });
  const styleTagsRemoved = () => page.evaluate(() => (window as unknown as { styleTagsRemoved: number }).styleTagsRemoved);
  const rootFontSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const laneCell = (id: string): SweepCell => {
    const found = PR_CELLS.find((each) => each.id === id);
    if (!found) throw new Error(`the PR lane has no cell ${id}`);
    return found;
  };
  await sizeForCell(page, laneCell('375x667-dark-200'), 'R15 control 375');
  await sizeForCell(page, laneCell('768x1024-dark-200'), 'R15 control 768');
  expect(await styleTagsRemoved(), 'the 200% tag was taken off between two 200% cells, so the page passed through normal text').toBe(0);
  expect(await rootFontSize(), 'the second 200% cell is not read at 200%').toBe('32px');
  await sizeForCell(page, laneCell('215x466-dark-100-zoom'), 'R15 control 100');
  expect(await rootFontSize(), 'a change of mode from 200% to normal text did not land').toBe('16px');
  // A row's extras may change the mode inside a cell (D07's normal-text pass in its 320 cell); the next
  // 200% cell must still set 200% (CI run 45805337924 read D07's 375 and 768 cells at normal text).
  await sizeForCell(page, laneCell('320x568-dark-200'), 'R15 control 320');
  await setTextMode(page, '100', 'R15 control: an extras pass at normal text');
  await sizeForCell(page, laneCell('375x667-dark-200'), 'R15 control 375 after the extras pass');
  expect(await rootFontSize(), 'the 200% cell after an extras pass at normal text is not read at 200%').toBe('32px');
  await page.setViewportSize({ width: 320, height: 568 });

  // Every backend GET that writes is named, with what the guard does about it.
  const named = WRITE_GET_HANDLERS.map((entry) => `${entry.file} ${entry.path}`).sort();
  expect(writingGetHandlers(), 'the backend GET handlers that write differ from WRITE_GET_HANDLERS: name the new one, with its reason').toEqual(named);
  const unheld = WRITE_GET_HANDLERS.filter((entry) => entry.guard === 'held').filter((entry) => !WRITE_GETS.some((pattern) => pattern.test(entry.path) || pattern.test(`/${entry.file.replace(/\.js$/, '')}${entry.path}`)));
  expect(unheld.map((entry) => `${entry.file} ${entry.path}`), 'a held writing GET is matched by no WRITE_GETS pattern').toEqual([]);

  writeResult('rows.json', {
    mode: MODE,
    cells: LANE.map((cell) => cell.id),
    rows: ALL_ROWS.map((row) => ({ id: row.id, census: row.census, kind: row.kind, owner: row.owner, status: row.status, state: row.state })),
    emptyStates: EMPTY_STATES,
  });

  // The held clock at work (orchestrator ruling D10, plan 89.6-25), on a page of this test's own.
  // A paused page clock fires no animation frame, so the frame settle never returns; a row whose
  // reach leaves the clock paused (clock: 'held') is settled by advancing the paused clock instead,
  // which runs the page's frame callbacks and leaves a two-second timer unfired.
  const clockPage = await page.context().newPage();
  try {
    await clockPage.clock.install();
    await clockPage.setContent(CLOCK_CONTROL);
    const pausedAt = (await clockPage.evaluate(() => Date.now())) + 500;
    await clockPage.clock.pauseAt(pausedAt);
    await clockPage.evaluate(() => {
      setTimeout(() => document.getElementById('thanks')?.remove(), 2000);
      requestAnimationFrame(() => {
        const grow = document.getElementById('grow');
        if (grow) grow.style.height = '900px';
      });
    });
    const clockRoot = clockPage.locator('main');
    const within = async (settle: Promise<void>, ms: number): Promise<'settled' | 'stalled'> => {
      // The losing settle is left waiting on the page; closing the page ends it, so its rejection is dropped.
      settle.catch(() => undefined);
      return Promise.race([settle.then(() => 'settled' as const), new Promise<'stalled'>((resolve) => setTimeout(() => resolve('stalled'), ms))]);
    };
    expect(await within(settleLayout(clockPage, clockRoot), 2_000), 'the frame settle returned under a paused clock: the held settle is not needed').toBe('stalled');
    expect(await within(settleLayout(clockPage, clockRoot, 'held'), 10_000), 'the held settle did not return under a paused clock').toBe('settled');
    const after = await clockPage.evaluate(() => ({
      grow: document.getElementById('grow')?.getBoundingClientRect().height,
      thanks: document.getElementById('thanks') !== null,
      now: Date.now(),
    }));
    expect(after.grow, 'the held settle did not run the page\'s frame callback').toBe(900);
    expect(after.thanks, 'the held settle let the two-second timer run').toBe(true);
    // Two steps of 32ms: the first sees the frame callback's change, the second sees none.
    expect(after.now - pausedAt, 'the held settle advanced the paused clock by other than two steps').toBe(64);
  } finally {
    await clockPage.close();
  }
});

for (const row of ALL_ROWS) {
  const title = `${row.id} (${row.owner}): holds the large-text checks in every ${MODE} cell`;
  if (row.status === 'pending') {
    // No page is opened for a pending row, and nothing is written.
    test(title, () => {
      test.skip(true, `${row.id} pending until ${row.owner}`);
    });
    continue;
  }
  test(title, async ({ page }, testInfo) => {
    test.setTimeout(MODE === 'full' ? 600_000 : 180_000);
    await runRow(page, row, testInfo);
  });
}
