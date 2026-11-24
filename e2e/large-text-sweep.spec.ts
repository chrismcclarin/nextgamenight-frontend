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
// RESULTS. The row test writes test-results/large-text-sweep/results/<row id>.json (every cell
// with its verdict and read, and the row's wall time) BEFORE it asserts, and the row-list test
// writes rows.json there. scripts/large-text-sweep-coverage.mjs reads that folder in CI and says
// which rows are pending, and which cell of an enforced row is missing or failed.
//
// DECISION Phase 89.6-08 (sweep): one test per surface row runs every cell of the lane on one
// reached page (zoom cells at normal text first, then the 200% style-tag cells, then the font32
// cell on a fresh page in the same context, which registers its own sweepWriteGuard before its
// first navigation, re-runs reach, and ends with its own expectNoApiWrites; holdWrites routes one
// page only, so the fresh page needs its own guard), chosen OVER one test per row and cell (about
// 400 signed-in navigations would not fit the e2e job) and OVER a spec per surface (the checks
// and the guard would be copied). Pending rows stay listed and skipped, so the --list count never
// moves when a row turns on; the executed count rises through the coverage script, not a typed
// floor. Changing this is a decision, not a cleanup.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { assertTheme, forceLightMode } from './support/contrast';
import { expectNoApiWrites, settleAnimations } from './support/inFlight';
import { ALL_ROWS, PR_CELLS, sweepWriteGuard, type SurfaceRow, type SweepCell, type SweepHold } from './support/largeTextSurfaces/index';
import {
  expectLargeTextCell,
  expectPageZoomUsable,
  readLargeTextCell,
  readPageZoomCell,
  setTextMode,
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
const LANE: readonly SweepCell[] = PR_CELLS;

// The exceptions list (SPEC A3 and A10) arrives with the other surface modules; the not-found
// page holds none of those texts.
const EXCEPTION_SELECTORS: readonly string[] = [];

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
  /** The first line of what failed, when the verdict is fail. */
  why?: string;
}

const firstLine = (error: unknown): string => String(error instanceof Error ? error.message : error).split('\n')[0];

/** Wait until the page's size and text stop changing from one frame to the next. */
async function settleLayout(page: Page, root: Locator): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await settleAnimations(root);
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
  const extrasErrors: unknown[] = [];
  let broke: unknown;

  const readCell = async (target: Page, reached: { root: Locator; dialog?: Locator }, cell: SweepCell): Promise<void> => {
    const tag = `${row.id} ${cell.id}`;
    await target.setViewportSize({ width: cell.width, height: cell.height });
    await setTextMode(target, cell.mode, tag);
    await settleLayout(target, reached.root);
    // Immediately before the read: the size and width this cell is really measured at.
    const at = await target.evaluate(() => ({ fontSize: getComputedStyle(document.documentElement).fontSize, window: document.documentElement.clientWidth }));
    const options = { exceptions: EXCEPTION_SELECTORS, dialog: reached.dialog };
    const read = cell.zoom ? await readPageZoomCell(reached.root, options) : await readLargeTextCell(reached.root, options);
    const record: CellRecord = { cell: cell.id, verdict: 'pass', fontSize: at.fontSize, window: at.window, read };
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
        record.why = record.why ?? firstLine(error);
        extrasErrors.push(error);
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
  for (const record of records) {
    const cell = LANE.find((candidate) => candidate.id === record.cell);
    if (cell) expectCell(record, cell, `${row.id} ${cell.id}`);
  }
  if (extrasErrors.length > 0) throw extrasErrors[0];
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

test('sweep rows (89.6-08): every surface row is declared once, with a census id, an owner and a status', () => {
  const ids = ALL_ROWS.map((row) => row.id);
  expect(ids.filter((id, at) => ids.indexOf(id) !== at), 'a row id is declared twice').toEqual([]);
  expect(ALL_ROWS.filter((row) => !/^89\.6-\d\d$/.test(row.owner)).map((row) => row.id), 'a row has no owning plan (89.6-NN)').toEqual([]);
  expect(ALL_ROWS.filter((row) => !/^(R|D|O)\d\d$/.test(row.census)).map((row) => row.id), 'a row has no census id').toEqual([]);
  expect(ALL_ROWS.filter((row) => row.status !== 'pending' && row.status !== 'enforced').map((row) => row.id), 'a row has no status').toEqual([]);
  expect(ALL_ROWS.filter((row) => row.status === 'enforced' && !row.reach).map((row) => row.id), 'an enforced row has no reach').toEqual([]);
  expect(PR_CELLS.length, 'the PR lane is seven cells').toBe(7);
  expect(PR_CELLS.filter((cell) => cell.theme === 'light').map((cell) => cell.id), 'the PR lane holds exactly one light cell').toEqual(['375x667-light-200']);
  expect(new Set(LANE.map((cell) => cell.id)).size, 'a cell id is declared twice').toBe(LANE.length);

  writeResult('rows.json', {
    mode: MODE,
    cells: LANE.map((cell) => cell.id),
    rows: ALL_ROWS.map((row) => ({ id: row.id, census: row.census, kind: row.kind, owner: row.owner, status: row.status, state: row.state })),
  });
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
