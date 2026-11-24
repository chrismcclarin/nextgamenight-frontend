import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AcceptedPlugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {
  expectLargeTextCell,
  expectPageZoomUsable,
  readLargeTextCell,
  readPageZoomCell,
  setTextMode,
  readWordLines,
  type LargeTextCellRead,
  type PageZoomRead,
  type TextMode,
} from './support/wordLines';

// Phase 89.6-02 (SPEC R3, R4, R6): the large-text building blocks, RENDERED, in every matrix cell.
//
// WHAT. Each building block (a shared CSS class set in src/app/globals.css) is rendered from a
// static harness page in the 12 matrix cells: 320, 375 and 768 wide, light and dark, text at 100%
// and at 200%. Every cell renders the block's four content cases (ordinary, empty, one 30-letter
// word, a name with an emoji) and reads each with the large-text checks of the one shared read,
// e2e/support/wordLines.ts ("DECISION Phase 89.6-02 (checks)"). A test is one block in one cell;
// it attaches its four reads and then asserts them.
//
// PAGE ZOOM (SPEC A8). Four more cells per block, 215 and 187 wide at normal text, light and dark:
// a 430-wide and a 375-wide phone at 200% page zoom. They take the lighter read of
// e2e/support/wordLines.ts ("DECISION Phase 89.6-02 (A8)"): only lost content or function fails;
// sideways scroll, splits and spills seen there are written into the attachment.
//
// HELD-OUT CELLS. Each block is also rendered one pixel either side of the matrix widths (319,
// 374, 767, 769, at 100% and 200%) and at 150% text at the three matrix widths: backstops, so a
// block cannot pass only at the exact widths it was tuned on.
//
// THE SECOND 200% MODE. The style tag doubles every rem in a rule and in a container query, but a
// rem in a MEDIA query keeps the initial size, so at 768 the style tag still matches the 48rem
// breakpoint that a person's own 32px default font size turns off. The two 768 / 200% cells are
// therefore rendered a second time on a fresh page in font32 mode, which sets Chromium's default
// font size, and every block box must be equal in both renders: a block must not depend on which
// mode made the text large. The mode test at the end proves the second mode is the real setting.
//
// NEGATIVE CONTROLS. One test per check renders a bad twin, which the check must report, and its
// good twin, which it must not: a read that cannot fail would pass every broken layout after it.
//
// HOW 200% IS PRODUCED. A style tag sets the root font size to 200%, so every rem doubles, as
// e2e/month-nav-row.spec.ts ("HOW 200% IS PRODUCED") explains. Browser zoom is not used.
//
// READ-ONLY. No navigation, no session, no server. The page is filled with setContent; every
// request the page makes is aborted and counted, and every test asserts that the count is 0.
//
// PROJECT. journeys only. Each test sets its own viewport, so a second project would run the
// same cells twice.
//
// DECISION Phase 89.6-02 (harness): the matrix renders static harness pages with setContent and
// compiles src/app/globals.css itself through @tailwindcss/postcss in beforeAll, chosen OVER
// reading .next/static/css (the bundler may move it; Phase 90), OVER a dev-only route (CI runs
// next start) and OVER a page in public/ (it cannot know the hashed stylesheet name). Text renders
// in Tailwind preflight's sans stack, OVER the app's Plus Jakarta Sans (next/font downloads it at
// build time; the checks compare boxes inside one render). Changing this is a decision, not a
// cleanup.

test.skip(({ isMobile }) => isMobile, 'the matrix sets its own viewport per cell and runs once, in the journeys project');
test.use({ storageState: { cookies: [], origins: [] } });

const HARNESS_DIR = resolve(__dirname, 'support/large-text-harness');

/** The building blocks under test; each has a harness file of the same name. Later plans append. */
const BLOCKS = ['bb-row', 'bb-cluster', 'bb-media', 'bb-columns', 'bb-frame'] as const;
/** The four content cases every block is rendered with, each a section of the harness file. */
const CASES = ['ordinary', 'empty', 'word30', 'emoji'] as const;

type Theme = 'light' | 'dark';
interface Cell {
  /** matrix: the 12 cells, all five checks. pagezoom: SPEC A8's widths, the lighter read. heldout: the backstop widths and 150% text, all five checks. */
  set: 'matrix' | 'pagezoom' | 'heldout';
  width: number;
  height: number;
  theme: Theme;
  mode: TextMode;
}

const MATRIX_SIZES = [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
  { width: 768, height: 1024 },
] as const;
const THEMES: readonly Theme[] = ['light', 'dark'];

/** Half the 932 and 667 viewport heights of the two phones; scrolling down is allowed there. */
const PAGE_ZOOM_SIZES = [
  { width: 215, height: 466 },
  { width: 187, height: 333 },
] as const;

/** One pixel either side of the matrix widths (320 has no narrower neighbour worth a second cell: 319 is it). */
const HELD_OUT_EDGES = [
  { width: 319, height: 568 },
  { width: 374, height: 667 },
  { width: 767, height: 1024 },
  { width: 769, height: 1024 },
] as const;

/**
 * The 12 matrix cells (320 first, then 375, then 768; each light then dark; each 100 then 200),
 * then the 4 page-zoom cells (215, then 187; each light then dark; normal text), then the 11
 * held-out cells, light only (319, 374, 767 and 769 at 100 and 200; then 320, 375 and 768 at 150).
 */
const CELLS: Cell[] = [
  ...MATRIX_SIZES.flatMap((size) =>
    THEMES.flatMap((theme) => (['100', '200'] as const).map((mode): Cell => ({ set: 'matrix', ...size, theme, mode }))),
  ),
  ...PAGE_ZOOM_SIZES.flatMap((size) => THEMES.map((theme): Cell => ({ set: 'pagezoom', ...size, theme, mode: '100' }))),
  ...HELD_OUT_EDGES.flatMap((size) => (['100', '200'] as const).map((mode): Cell => ({ set: 'heldout', ...size, theme: 'light', mode }))),
  ...MATRIX_SIZES.map((size): Cell => ({ set: 'heldout', ...size, theme: 'light', mode: '150' })),
];

/**
 * The boxes that must be equal in the two 200% modes: the frame and every element under it whose
 * class list holds a token starting bb-, so a new block or a new part of one is compared without
 * being named here (Phase 89.6-05; the list of bb-row parts this replaced named two of them).
 */
const BLOCK_BOX_SCOPE = '[data-frame], [data-frame] *';

/** src/app/globals.css as the app ships it, plus the utilities the harness pages use. */
let compiledCss = '';

test.beforeAll(async () => {
  // The entry is a string, not a file: it imports the real stylesheet and adds the harness folder
  // to the sources Tailwind scans. The from path only anchors the two relative paths.
  const entry = '@import "../../../src/app/globals.css";\n@source "./*.html";\n';
  // The cast: @tailwindcss/postcss is typed against its own nested copy of postcss, so its plugin
  // type and this file's postcss differ by name only. postcss.config.js loads the same plugin.
  const plugin = tailwindcss() as unknown as AcceptedPlugin;
  const result = await postcss([plugin]).process(entry, { from: resolve(HARNESS_DIR, 'large-text-entry.css') });
  compiledCss = result.css;
  expect(compiledCss, 'the compile did not produce the app stylesheet (no .btn rule)').toContain('.btn {');
  expect(compiledCss, 'the compile did not produce the app stylesheet (no components layer)').toContain('@layer components');
  // Proof that @source reached the harness folder: this utility is used by the modes harness only.
  expect(compiledCss, 'the compile did not scan the harness folder (no container-query probe class)').toContain('max-\\[24rem\\]\\:hidden');
});

/** The harness file of a block. */
function harnessOf(block: string): string {
  return readFileSync(resolve(HARNESS_DIR, `${block}.html`), 'utf8');
}

/** One section of a harness file, by its data-case attribute. */
function sectionOf(harness: string, name: string): string {
  const match = harness.match(new RegExp(`<section data-case="${name}"[^>]*>[\\s\\S]*?</section>`));
  if (!match) throw new Error(`the harness has no section with data-case="${name}"`);
  return match[0];
}

/** Abort and count every request the page makes; a setContent page should make none. */
async function countRequests(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  return requests;
}

/** Render one section alone in a cell: colour scheme, viewport, a complete document, then the text mode. */
async function renderSection(page: Page, cell: { width: number; height: number; theme: Theme; mode: TextMode }, section: string, tag: string): Promise<void> {
  await page.emulateMedia({ colorScheme: cell.theme });
  await page.setViewportSize({ width: cell.width, height: cell.height });
  const htmlClass = cell.theme === 'dark' ? ' class="dark"' : '';
  await page.setContent(
    `<!doctype html><html lang="en"${htmlClass}><head><meta charset="utf-8">` +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<style>${compiledCss}</style></head><body class="bg-surface-page">${section}</body></html>`,
  );
  await setTextMode(page, cell.mode, tag);
}

/** The frame every harness section is read under. */
function frameOf(page: Page): Locator {
  return page.locator('[data-frame]');
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The box of every building-block element (a class token starting bb-) at or under the frame, in document order. */
async function blockBoxesOf(page: Page): Promise<Box[]> {
  return page.locator(BLOCK_BOX_SCOPE).evaluateAll((elements) =>
    elements
      .filter((el) => Array.from(el.classList).some((token) => token.startsWith('bb-')))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      }),
  );
}

/**
 * The compiled stylesheet holds a rule for the block. Every test asserts this LAST (Phase 89.6-05):
 * a block with no rules then fails first on the cell read it breaks, by name, and a block whose
 * reads pass with no rules at all still fails here. It is not part of beforeAll, where one missing
 * block would fail every test with the hook's error and hide which cell broke.
 */
function expectBlockRule(block: string, tag: string): void {
  expect(new RegExp(`\\.${block}\\s*\\{`).test(compiledCss), `${tag}: the compiled stylesheet holds no .${block} rule, so this cell rendered without the block`).toBe(true);
}

for (const block of BLOCKS) {
  for (const cell of CELLS) {
    if (cell.set === 'pagezoom') {
      const zoomName = `${block} page zoom ${cell.width} ${cell.theme}`;
      test(`${zoomName} (89.6-02, SPEC A8): the four content cases lose no content or function`, async ({ page }, testInfo) => {
        const requests = await countRequests(page);
        const harness = harnessOf(block);
        const reads: Array<{ case: string; window: number; read: PageZoomRead }> = [];
        for (const name of CASES) {
          await renderSection(page, cell, sectionOf(harness, name), `${zoomName} ${name}`);
          const window = await page.evaluate(() => document.documentElement.clientWidth);
          reads.push({ case: name, window, read: await readPageZoomCell(frameOf(page)) });
        }
        // Attached BEFORE asserting: what is only recorded at these widths lives here.
        await testInfo.attach('cell-read', { body: JSON.stringify(reads, null, 2), contentType: 'application/json' });
        for (const { case: name, window, read } of reads) {
          const tag = `${zoomName} ${name}`;
          expect(window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
          expectPageZoomUsable(read, tag);
        }
        expect(reads.length, `${zoomName}: four content cases were to be read`).toBe(4);
        expect(requests, `${zoomName}: the page made a request`).toEqual([]);
        expectBlockRule(block, zoomName);
      });
      continue;
    }
    const cellName = `${block} ${cell.width} ${cell.theme} ${cell.mode}`;
    test(`${cellName} (89.6-02): the four content cases hold the large-text checks`, async ({ page }, testInfo) => {
      const requests = await countRequests(page);
      const harness = harnessOf(block);
      const reads: Array<{ case: string; read: LargeTextCellRead }> = [];
      const styleTagBoxes: Record<string, Box[]> = {};
      for (const name of CASES) {
        await renderSection(page, cell, sectionOf(harness, name), `${cellName} ${name}`);
        reads.push({ case: name, read: await readLargeTextCell(frameOf(page)) });
        styleTagBoxes[name] = await blockBoxesOf(page);
      }
      // Attached BEFORE asserting, so a red cell still leaves its four reads behind.
      await testInfo.attach('cell-read', { body: JSON.stringify(reads, null, 2), contentType: 'application/json' });
      for (const { case: name, read } of reads) {
        const tag = `${cellName} ${name}`;
        expect(read.window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
        expectLargeTextCell(read, tag);
      }
      expect(reads.length, `${cellName}: four content cases were to be read`).toBe(4);
      expect(requests, `${cellName}: the page made a request`).toEqual([]);

      // The second 200% mode, for the two 768 / 200% matrix cells only: the same four cases on a
      // fresh page in font32, the same checks, and every block box equal to the style-tag render.
      if (cell.set !== 'matrix' || cell.width !== 768 || cell.mode !== '200') {
        expectBlockRule(block, cellName);
        return;
      }
      const second = await page.context().newPage();
      try {
        const secondRequests = await countRequests(second);
        const font32Reads: Array<{ case: string; read: LargeTextCellRead }> = [];
        const font32Boxes: Record<string, Box[]> = {};
        for (const name of CASES) {
          // setTextMode is a no-op on this page after the first case: font32 is a page setting.
          await renderSection(second, { ...cell, mode: 'font32' }, sectionOf(harness, name), `${cellName} font32 ${name}`);
          font32Reads.push({ case: name, read: await readLargeTextCell(frameOf(second)) });
          font32Boxes[name] = await blockBoxesOf(second);
        }
        await testInfo.attach('mode-boxes', { body: JSON.stringify({ styleTag: styleTagBoxes, font32: font32Boxes, font32Reads }, null, 2), contentType: 'application/json' });
        for (const { case: name, read } of font32Reads) {
          const tag = `${cellName} font32 ${name}`;
          expectLargeTextCell(read, tag);
          const want = styleTagBoxes[name];
          const got = font32Boxes[name];
          expect(got.length, `${tag}: the two modes drew a different number of block boxes`).toBe(want.length);
          // The empty case of a block may hold no block element at all (a card with one line of text).
          if (name !== 'empty') expect(got.length, `${tag}: no block box was found to compare`).toBeGreaterThan(0);
          got.forEach((box, i) => {
            for (const side of ['left', 'top', 'width', 'height'] as const) {
              expect(Math.abs(box[side] - want[i][side]), `${tag}: box ${i} differs in ${side} between the modes (style tag ${want[i][side]}px, font32 ${box[side]}px)`).toBeLessThanOrEqual(0.5);
            }
          });
        }
        expect(secondRequests, `${cellName} font32: the page made a request`).toEqual([]);
      } finally {
        await second.close();
      }
      expectBlockRule(block, cellName);
    });
  }
}

// ---------------------------------------------------------------------------------------------
// Negative controls: each check reports its bad twin and passes its good twin. The twins are the
// sections of the checks harness file; all but the page-zoom one render at 320 wide, light, 200%.
// ---------------------------------------------------------------------------------------------

const CHECK_CELL = { width: 320, height: 568, theme: 'light', mode: '200' } as const;
const ZOOM_CHECK_CELL = { width: 215, height: 466, theme: 'light', mode: '100' } as const;

/** Render one twin of the checks harness and hand back the frame to read. */
async function renderTwin(page: Page, name: string, cell: { width: number; height: number; theme: Theme; mode: TextMode } = CHECK_CELL): Promise<Locator> {
  await renderSection(page, cell, sectionOf(harnessOf('checks'), name), `check twin ${name}`);
  return frameOf(page);
}

test('check: sideways (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'sideways-bad'));
  const good = await readLargeTextCell(await renderTwin(page, 'sideways-good'));
  await renderTwin(page, 'sideways-dialog-bad');
  const dialogBad = await readLargeTextCell(frameOf(page), { dialog: page.getByRole('dialog') });
  await renderTwin(page, 'sideways-dialog-good');
  const dialogGood = await readLargeTextCell(frameOf(page), { dialog: page.getByRole('dialog') });
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good, dialogBad, dialogGood }, null, 2), contentType: 'application/json' });
  expect(bad.pageSideways, 'the bad twin (a block 40rem wide) did not read as page sideways scroll').toBeGreaterThan(0);
  expect(good.pageSideways, 'the good twin (the same block capped to the page) reads as page sideways scroll').toBe(0);
  expect(good.dialogSideways, 'no dialog was named, so no dialog read was due').toBeNull();
  expect(dialogBad.dialogSideways, 'the bad dialog twin (a 40rem part in a box that hides it) did not read as sideways scroll in the dialog').toBeGreaterThan(0);
  expect(dialogBad.pageSideways, 'the bad dialog twin hides its wide part, so the page itself must not scroll sideways').toBe(0);
  expect(dialogGood.dialogSideways, 'the good dialog twin reads as sideways scroll in the dialog').toBe(0);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: cut (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'cut-bad'));
  const good = await readLargeTextCell(await renderTwin(page, 'cut-good'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  const kindsReported = (kind: string) => bad.cut.filter((entry) => entry.startsWith(`${kind}: `)).length;
  expect(kindsReported('ellipsis'), `the cut read did not name the ellipsis kind (${JSON.stringify(bad.cut)})`).toBeGreaterThan(0);
  expect(kindsReported('clamp'), `the cut read did not name the clamp kind (${JSON.stringify(bad.cut)})`).toBeGreaterThan(0);
  expect(kindsReported('nowrap'), `the cut read did not name the nowrap kind (${JSON.stringify(bad.cut)})`).toBeGreaterThan(0);
  expect(kindsReported('hidden'), `the cut read did not name the hidden kind (${JSON.stringify(bad.cut)})`).toBeGreaterThan(0);
  expect(kindsReported('shrunk'), `the cut read did not name the shrunk kind (${JSON.stringify(bad.cut)})`).toBeGreaterThan(0);
  expect(good.cut, 'the good twin (the same texts uncapped, and text scrolled out of a scrolling body) reads as cut').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'split-bad'));
  const good = await readLargeTextCell(await renderTwin(page, 'split-good'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  expect(bad.split.length, 'the bad twin (a name that may shrink to nothing beside a fixed button) did not read as split').toBeGreaterThan(0);
  expect(bad.split.join(' | '), 'the split read did not name the squeezed word').toContain('"Weekend"');
  expect(good.split, 'the good twin (the same content in bb-row) reads as split').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

// The split read through wrappers (orchestrator fix R3, 2026-11-24). A word's row is looked for
// past the plain wrappers and column containers above its own box, and its room is that row less
// the padding and border between the two.
// Each test first proves, with the older whole-word read, that its twin's word really is broken
// (or whole): "nothing reported" about a word that never broke would prove nothing.

/** The words under one element that are drawn on more than one line. */
async function brokenWordsOf(locator: Locator): Promise<string[]> {
  const read = await readWordLines(locator);
  return read.words.filter((w) => w.lines > 1).map((w) => w.word);
}

test('check: split through a wrapper (89.6-02, R3): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'split-wrapper-bad'));
  const badBroken = await brokenWordsOf(page.locator('.lt-name'));
  const good = await readLargeTextCell(await renderTwin(page, 'split-wrapper-good'));
  const goodBroken = await brokenWordsOf(page.locator('.lt-name'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, badBroken, good, goodBroken }, null, 2), contentType: 'application/json' });
  expect(badBroken, 'the bad twin does not squeeze its name: the harness is not the shape it says').toContain('Weekend');
  expect(bad.split.join(' | '), 'the bad twin (a name in a paragraph inside the item that may shrink to nothing) did not read as split').toContain('"Weekend"');
  expect(goodBroken, 'the good twin breaks a word of its name: the harness is not the shape it says').toEqual([]);
  expect(good.split, 'the good twin (the same content in bb-row) reads as split').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split through a column container (89.6-02, R3): reports a name squeezed in a column of lines, as the row item and inside a wrapper', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const item = await readLargeTextCell(await renderTwin(page, 'split-column-pass'));
  const itemBroken = await brokenWordsOf(page.locator('.lt-name'));
  const wrapped = await readLargeTextCell(await renderTwin(page, 'split-column-wrapper'));
  const wrappedBroken = await brokenWordsOf(page.locator('.lt-name'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ item, itemBroken, wrapped, wrappedBroken }, null, 2), contentType: 'application/json' });
  expect(itemBroken, 'the first twin does not squeeze its name: the harness is not the shape it says').toContain('Weekend');
  expect(item.split.join(' | '), 'a name in a column of lines that is itself the item that may shrink did not read as split').toContain('"Weekend"');
  expect(wrappedBroken, 'the second twin does not squeeze its name: the harness is not the shape it says').toContain('Weekend');
  expect(wrapped.split.join(' | '), 'a name in a column of lines inside the wrapper that may shrink did not read as split').toContain('"Weekend"');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split in a plain block (89.6-02, R3): a word wider than its block, with no row above it, is not reported', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'split-block-only'));
  const broken = await brokenWordsOf(page.locator('.lt-name'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, broken }, null, 2), contentType: 'application/json' });
  expect(broken, 'the twin does not break its word: the harness is not the shape it says').toContain('Weekend');
  expect(read.split, 'a word wider than its whole row (a plain block, nothing beside it) reads as split').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split room (89.6-02, R3): a word that fits its row but not the row less its pill padding and border is not reported', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'split-padded-good'));
  const pill = await readWordLines(page.locator('.lt-pill'), page.locator('.lt-pill-row'));
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, pill, sizerBroken }, null, 2), contentType: 'application/json' });
  const word = pill.words[0];
  const roomInPill = pill.rowRoom ?? Number.NaN;
  // The twin's geometry, whatever the font: the row holds the word (the pill's 40px of padding and
  // border put back), the pill does not, and taking off the padding alone (32px) or the border
  // alone (8px) would still leave room for it.
  expect(sizerBroken, 'the sizing line breaks its word: the box is not the word plus 36px wide').toEqual([]);
  expect(word.natural, `the row does not hold the word: the harness is not the shape it says (${JSON.stringify(pill)})`).toBeLessThanOrEqual(roomInPill + 40);
  expect(word.natural, `the row less the padding alone does not hold the word (${JSON.stringify(pill)})`).toBeLessThanOrEqual(roomInPill + 8);
  expect(word.natural, `the pill holds the word: the harness is not the shape it says (${JSON.stringify(pill)})`).toBeGreaterThan(roomInPill + 0.5);
  expect(word.lines, 'the word in the pill is not broken: the harness is not the shape it says').toBeGreaterThan(1);
  expect(read.split, 'a word wider than its row less the padding and border of its own pill reads as split').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: spill (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'spill-bad'));
  const good = await readLargeTextCell(await renderTwin(page, 'spill-good'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  expect(bad.spill.length, 'the bad twin (bare text in a fixed button) did not read as spilling out of its button').toBeGreaterThan(0);
  expect(bad.spill.join(' | '), 'the spill read did not name the button').toContain('out of its button');
  expect(good.spill, 'the good twin (the same text in a bb-label) spills out of its button').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: select-fit (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readLargeTextCell(await renderTwin(page, 'select-bad'));
  const good = await readLargeTextCell(await renderTwin(page, 'select-good'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  expect(bad.selectCut.length, 'the bad twin (a select held to a narrow box) did not read as a cut value').toBe(1);
  expect(bad.selectCut[0], 'the select read did not name the chosen option').toContain('"30 minutes before"');
  expect(good.selectCut, 'the good twin (the same select at its own width) reads as a cut value').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: A8 (89.6-02): reports its bad twin and passes its good twin', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await readPageZoomCell(await renderTwin(page, 'zoom-bad', ZOOM_CHECK_CELL));
  const good = await readPageZoomCell(await renderTwin(page, 'zoom-good', ZOOM_CHECK_CELL));
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  const lost = bad.lost.join(' | ');
  expect(lost, 'the two overlapping buttons are not in lost').toContain('overlap: button "Invite" and button "Share"');
  expect(lost, 'the button past the end of the clipped row is not in lost').toContain('unreachable: button "Remove"');
  expect(lost, 'the line of text pulled up over another is not in lost').toContain('overlap: the text of p "Hosted by Bob" and p "Sunday at noon"');
  expect(good.lost, 'the good twin (text below the fold of a scrolling body, a panel wider than the page, two tight lines whose letters do not meet) reads as lost').toEqual([]);
  expect(good.recorded.join(' | '), 'the panel wider than the page was not recorded as page sideways scroll').toContain('the page scrolls sideways by');
  expect(requests, 'the page made a request').toEqual([]);
});

// ---------------------------------------------------------------------------------------------
// The mode probe: the second 200% mode is the real browser setting, and the first can be left.
// ---------------------------------------------------------------------------------------------

test("mode (89.6-02): Chromium's default font 32 turns the 48rem media query off at 768 while a rem container query reads the same as the style tag", async ({ page }) => {
  const requests = await countRequests(page);
  const tag = 'mode probe';
  const section = sectionOf(harnessOf('modes'), 'modes');
  const probes = () =>
    page.evaluate(() => {
      const shown = (name: string) => {
        const el = document.querySelector(`[data-probe="${name}"]`);
        return el ? getComputedStyle(el).display !== 'none' : null;
      };
      return { media: shown('media'), container: shown('container') };
    });
  const rootSize = () => page.evaluate(() => getComputedStyle(document.documentElement).fontSize);
  const modeTags = () => page.locator('style[data-lt-text-mode]').count();

  // The style-tag round trip on one page: a mode can be left, and no stale tag stays behind.
  await renderSection(page, { width: 768, height: 1024, theme: 'light', mode: '200' }, section, tag);
  const roundTrip: Array<[TextMode, string, number]> = [
    ['200', '32px', 1],
    ['100', '16px', 0],
    ['150', '24px', 1],
    ['200', '32px', 1],
    ['100', '16px', 0],
  ];
  for (const [mode, size, tags] of roundTrip) {
    await setTextMode(page, mode, tag);
    expect(await rootSize(), `round trip: the root is not ${size} in mode ${mode}`).toBe(size);
    expect(await modeTags(), `round trip: mode ${mode} left ${tags === 0 ? 'a' : 'more or fewer than one'} text-mode style tag behind`).toBe(tags);
  }

  // At normal text the container (600px) is wider than 24rem (384px): its probe shows.
  expect(await probes(), 'normal text: both probes are shown').toEqual({ media: true, container: true });

  // The style tag: every rem in a rule and in a container query doubles; the media query does not move.
  await setTextMode(page, '200', tag);
  expect(await probes(), 'style tag: the media probe is still shown at 768 (48rem is 768px there) and the container probe is hidden (24rem is 768px)').toEqual({ media: true, container: false });

  // The default font size: the media query moves too (48rem is 1536px), the container query reads the same.
  await setTextMode(page, '100', tag);
  await setTextMode(page, 'font32', tag);
  expect(await rootSize(), 'font32: the root is not 32px').toBe('32px');
  expect(await modeTags(), 'font32: a text-mode style tag is on the page, so the 32px could be the tag and not the setting').toBe(0);
  expect(await probes(), 'font32: the media probe is still displayed at 768, or the container probe reads differently from the style tag').toEqual({ media: false, container: false });

  // font32 is one-way: a second call is a no-op, any other mode throws.
  await setTextMode(page, 'font32', tag);
  expect(await rootSize(), 'font32 twice: the root is not 32px').toBe('32px');
  await expect(setTextMode(page, '100', tag), 'a page was taken out of font32').rejects.toThrow('font32 is one-way: use a fresh page');
  expect(requests, 'the page made a request').toEqual([]);
});
