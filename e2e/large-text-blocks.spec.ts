import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AcceptedPlugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import {
  THIRTY_LETTER_WORD,
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
// The split check has many more tests (orchestrator fix R3, its repair batch, and orchestrator
// change R6, which replaced its method): its rule has parts, and each part has a case that goes
// red when that part alone is taken out. The last tests pin the harness cut.
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

/**
 * One section of a harness file, by its data-case attribute; `file` names the harness in an error.
 *
 * DECISION Phase 89.6-05 (section-cut), orchestrator fix R3, 2026-11-24: a case is cut at the
 * FIRST closing section tag, and a case that nests a section element THROWS, chosen OVER the
 * silent cut it was (the case rendered only as far as the inner element's end and every cell
 * passed on half a page: plan 89.6-05 met it with two column sections) and OVER a cut that
 * balances nested tags (a parser in a test helper, for a shape a div serves as well). Making the
 * match greedy instead joins every case after this one into it. Tag names are read in any letter
 * case, and HTML comments are taken out before the cut (so the case handed back holds none): a
 * comment that names a section tag is not markup, and it once ended a case or read as a nested
 * section. Changing this is a decision, not a cleanup.
 */
function sectionOf(harness: string, name: string, file: string): string {
  const markup = harness.replace(/<!--[\s\S]*?-->/g, '');
  const match = markup.match(new RegExp(`<section data-case="${name}"[^>]*>[\\s\\S]*?</section>`, 'i'));
  if (!match) throw new Error(`${file}: the harness has no section with data-case="${name}"`);
  if ((match[0].match(/<section\b/gi) ?? []).length > 1) {
    throw new Error(`${file}: the case "${name}" nests a section element. A case is cut at the first closing section tag, so only part of it would render: use a div.`);
  }
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
          await renderSection(page, cell, sectionOf(harness, name, `${block}.html`), `${zoomName} ${name}`);
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
        await renderSection(page, cell, sectionOf(harness, name, `${block}.html`), `${cellName} ${name}`);
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
          await renderSection(second, { ...cell, mode: 'font32' }, sectionOf(harness, name, `${block}.html`), `${cellName} font32 ${name}`);
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
  await renderSection(page, cell, sectionOf(harnessOf('checks'), name, 'checks.html'), `check twin ${name}`);
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

// THE SPLIT CONTROLS (plan 89.6-02; orchestrator fix R3 and its repair batch; replaced by
// orchestrator change R6; all 2026-11-24). For a word drawn on more than one line the read stacks
// the side-by-side containers between the word and its bound for a moment, reads the word again
// and puts the page back: e2e/support/wordLines.ts ("DECISION Phase 89.6-02 (split-row)").
// The word then lands in ONE of three lists, and each part of the rule has a case here that goes
// red when that part alone is taken out.
//
//   split  a defect: the word would be whole if its rows stacked, or it is glued to what precedes
//          it on its line. Fails the cell.
//   held   a box with a width of its own (or a positioned box) holds the word narrow, and the
//          entry names that box. Fails the cell by default, and the owner's ruling is pending:
//          e2e/support/wordLines.ts ("DECISION Phase 89.6-02 (held-policy)").
//   wide   the word is wider than its whole room, or it only wraps at its own hyphen. Written
//          down, never failed.
//
// WHAT A CASE PROVES. Every case first proves, with the older whole-word read, that its word
// really is broken: a list that names no word proves nothing about a word that never broke. The
// good twin of a pair holds a 30-letter word for that reason. The T-numbers in the titles are the
// twin list of the research behind R6.

/** The words under one element that are drawn on more than one line. */
async function brokenWordsOf(locator: Locator): Promise<string[]> {
  const read = await readWordLines(locator);
  return read.words.filter((w) => w.lines > 1).map((w) => w.word);
}

interface SplitCase {
  read: LargeTextCellRead;
  /** The words under the case's scope (its name, .lt-name, unless another is given) that are drawn on more than one line. */
  broken: string[];
}

/** Render one split case, read it, and say which words under `scope` are broken. */
async function splitCase(page: Page, name: string, scope = '.lt-name'): Promise<SplitCase> {
  const read = await readLargeTextCell(await renderTwin(page, name));
  return { read, broken: await brokenWordsOf(page.locator(scope)) };
}

/** The entries of one list that are about `word`: every entry of the three lists starts with its word in double quotes. */
function entriesFor(list: readonly string[], word: string): string[] {
  return list.filter((entry) => entry.startsWith(`"${word}" `));
}

/** A bad case: its word is broken (the harness is the shape it says) and the read puts it in the split list and in no other. */
function expectReported(found: SplitCase, what: string, word = 'Weekend'): void {
  const line = JSON.stringify(found.read);
  expect(found.broken, `${what}: the case does not break ${word}, so the harness is not the shape it says`).toContain(word);
  expect(entriesFor(found.read.split, word).length, `${what}: ${word} did not read as split (${line})`).toBeGreaterThan(0);
  expect(entriesFor(found.read.held, word), `${what}: ${word} also reads as held (${line})`).toEqual([]);
  expect(entriesFor(found.read.wide, word), `${what}: ${word} also reads as wide (${line})`).toEqual([]);
}

/** A held case: its word is broken, nothing is split, and the held list names the word (and the holder, when one is given). */
function expectHeld(found: SplitCase, what: string, holder?: string, word = 'Weekend'): void {
  const line = JSON.stringify(found.read);
  expect(found.broken, `${what}: the case does not break ${word}, so the harness is not the shape it says`).toContain(word);
  expect(found.read.split, `${what}: reads as split (${line})`).toEqual([]);
  const held = entriesFor(found.read.held, word);
  expect(held.length, `${what}: ${word} is not in the held list (${line})`).toBeGreaterThan(0);
  if (holder) expect(held.join(' | '), `${what}: the held entry does not name its holder by "${holder}" (${line})`).toContain(holder);
}

/** A wide case: its word is broken and may be: nothing is split, nothing is held, and the wide list names the word. */
function expectWide(found: SplitCase, what: string, word = 'Weekend'): void {
  const line = JSON.stringify(found.read);
  expect(found.broken, `${what}: the case does not break ${word}, so the harness is not the shape it says`).toContain(word);
  expect(found.read.split, `${what}: reads as split (${line})`).toEqual([]);
  expect(found.read.held, `${what}: reads as held (${line})`).toEqual([]);
  expect(entriesFor(found.read.wide, word).length, `${what}: ${word} is not in the wide list (${line})`).toBeGreaterThan(0);
}

test('check: split (89.6-02): reports its bad twin and passes its good twin, whose 30-letter word breaks and may', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await splitCase(page, 'split-bad');
  const good = await splitCase(page, 'split-good');
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, good }, null, 2), contentType: 'application/json' });
  expectReported(bad, 'the bad twin (a name that may shrink to nothing beside a fixed button)');
  expect(entriesFor(bad.read.wide, THIRTY_LETTER_WORD).length, 'the bad twin: its 30-letter word is not written down as wide').toBeGreaterThan(0);
  expect(good.broken, 'the good twin (the same content in bb-row) breaks a word that fits its row, or does not break its 30-letter word').toEqual([THIRTY_LETTER_WORD]);
  expectWide(good, 'the good twin (the same content in bb-row)', THIRTY_LETTER_WORD);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split through a wrapper (89.6-02, R3): reports its bad twins (a flex row, a grid, a row that is the root of the read) and passes its good twin, whose 30-letter word breaks and may', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bad = await splitCase(page, 'split-wrapper-bad');
  const grid = await splitCase(page, 'split-grid-wrapper');
  const rootRow = await splitCase(page, 'split-root-row');
  const good = await splitCase(page, 'split-wrapper-good');
  await testInfo.attach('twin-read', { body: JSON.stringify({ bad, grid, rootRow, good }, null, 2), contentType: 'application/json' });
  expectReported(bad, 'the bad twin (a name in a paragraph inside the item that may shrink to nothing)');
  expectReported(grid, 'the grid case (a name in a paragraph inside the grid column that may shrink to nothing)');
  expectReported(rootRow, 'the root case (the row that squeezes the name is the root of the read itself)');
  expect(good.broken, 'the good twin (the same content in bb-row) breaks a word that fits its row, or does not break its 30-letter word').toEqual([THIRTY_LETTER_WORD]);
  expectWide(good, 'the good twin (the same content in bb-row)', THIRTY_LETTER_WORD);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split past a column container (89.6-02, R3): reports a name squeezed in a column of lines inside the item that may shrink', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const column = await splitCase(page, 'split-column-wrapper');
  await testInfo.attach('twin-read', { body: JSON.stringify({ column }, null, 2), contentType: 'application/json' });
  expectReported(column, 'a name in a column of lines inside the wrapper that may shrink');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, nothing to stack (89.6-02, R3; R6): a plain narrow block holds its word by its own width, and an unmarked row above the root of the read is not stacked', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const block = await splitCase(page, 'split-block-only');
  const aboveRoot = await splitCase(page, 'split-above-root');
  await testInfo.attach('twin-read', { body: JSON.stringify({ block, aboveRoot }, null, 2), contentType: 'application/json' });
  expectHeld(block, 'a word in a plain narrow block with nothing beside it, in a card that has room for the word', 'width 64px');
  expectWide(aboveRoot, 'a word wider than the root of the read, with an unmarked row above that root');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a marked bound (89.6-02, R3 repair; R6): a data-room mark is the bound wherever it is: under a wider row it keeps that row from being stacked, and above the root of the read it is used and the squeeze is reported', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const marked = await splitCase(page, 'split-marked-row');
  const aboveRoot = await splitCase(page, 'split-mark-above-root');
  await testInfo.attach('twin-read', { body: JSON.stringify({ marked, aboveRoot }, null, 2), contentType: 'application/json' });
  expectWide(marked, 'a word wider than the box named with data-room, with a wider row above the mark');
  expectReported(aboveRoot, 'a name squeezed inside the root of the read, the row marked with data-room above that root');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split in an inner row (89.6-02, R3 repair): reports a name squeezed in a row inside the item that may shrink, and in a link that is that item', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const inner = await splitCase(page, 'split-inner-row');
  const link = await splitCase(page, 'split-link-item');
  await testInfo.attach('twin-read', { body: JSON.stringify({ inner, link }, null, 2), contentType: 'application/json' });
  expectReported(inner, 'a name in a row of its own, three levels under the row that squeezes it');
  expectReported(link, 'a name in a row of its own inside a link that is the item that may shrink');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split in a table row (89.6-02, R3 repair): reports a name squeezed by a fixed cell, with a row element, without one, and with no cell of its own', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const row = await splitCase(page, 'split-table-row');
  const cells = await splitCase(page, 'split-table-cells');
  const bareRow = await splitCase(page, 'split-table-bare-row');
  await testInfo.attach('twin-read', { body: JSON.stringify({ row, cells, bareRow }, null, 2), contentType: 'application/json' });
  expectReported(row, 'a name in a table cell beside a fixed cell');
  expectReported(cells, 'a name in a table cell beside a fixed cell, the two cells directly in the table');
  expectReported(bareRow, 'a name directly in a table row beside a fixed cell');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, no row to stack (89.6-02, R3 repair; R6): a word in a fixed card in a column, and in a one-column grid, is held by the card and not split; under a root that is a column it is wide', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const column = await splitCase(page, 'split-column-card');
  const grid = await splitCase(page, 'split-grid-card');
  const rootColumn = await splitCase(page, 'split-root-column');
  await testInfo.attach('twin-read', { body: JSON.stringify({ column, grid, rootColumn }, null, 2), contentType: 'application/json' });
  expectHeld(column, 'a word in a fixed card, the card in a column with nothing beside it', 'width 64px');
  expectHeld(grid, 'a word in a fixed card, the card in a grid of one column', 'width 64px');
  expectWide(rootColumn, 'a word wider than the root of the read, the root a column that is an item of a wider row');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split room (89.6-02, R3): a word that fits its row but not the row less its pill padding and border is not split, and padding on an element with no box of its own is no edge', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'split-padded-good'));
  const pill = await readWordLines(page.locator('.lt-pill'), page.locator('.lt-pill-row'));
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  // Two bad forms: 12rem of padding on a display: contents element, and on an inline box around
  // the name's paragraph. Neither narrows the name, so stacking the row makes it whole and the squeeze is reported.
  const contents = await splitCase(page, 'split-contents-edge');
  const inlineAncestor = await splitCase(page, 'split-inline-ancestor-edge');
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, pill, sizerBroken, contents, inlineAncestor }, null, 2), contentType: 'application/json' });
  expectReported(contents, 'a squeezed name under a padded display: contents element');
  expectReported(inlineAncestor, 'a squeezed name whose paragraph sits in a padded inline box');
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
  expect(entriesFor(read.held, 'Weekend').join(' | '), `the word in the pill is not held by the sizing box, which is narrower than the card (${JSON.stringify(read)})`).toContain('fit-content');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split room, margins (89.6-02, R3 repair; R6): a word wider than its row less the margins around it is not split, and a narrow item pushed aside by an automatic margin is held by its own width', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'split-margin-good'));
  const item = await readWordLines(page.locator('.lt-pill'), page.locator('.lt-pill-row'));
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  const auto = await splitCase(page, 'split-auto-margin');
  const autoMargin = await page.locator('.lt-narrow').evaluate((el) => Number.parseFloat(getComputedStyle(el).marginLeft));
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, item, sizerBroken, auto, autoMargin }, null, 2), contentType: 'application/json' });
  const word = item.words[0];
  // The row's content width: the item has no padding and no border, so the older read's room is the row itself.
  const rowWidth = item.rowRoom ?? Number.NaN;
  expect(sizerBroken, 'the sizing line breaks its word: the box is not the word plus 36px wide').toEqual([]);
  expect(word.natural, `the row does not hold the word: the harness is not the shape it says (${JSON.stringify(item)})`).toBeLessThanOrEqual(rowWidth + 0.5);
  expect(word.natural, `the row less the item's 40px of margin holds the word: the harness is not the shape it says (${JSON.stringify(item)})`).toBeGreaterThan(rowWidth - 40 + 0.5);
  expect(word.lines, 'the word in the item is not broken: the harness is not the shape it says').toBeGreaterThan(1);
  expect(read.split, 'a word wider than its row less the margins of its own item reads as split').toEqual([]);
  expect(entriesFor(read.held, 'Weekend').join(' | '), `the word in the item is not held by the sizing box, which is narrower than the card (${JSON.stringify(read)})`).toContain('fit-content');
  // The automatic margin is the free space of its row (a used value of many px), not an edge and
  // not a width: stacked, the item is still as narrow as its own width, so the word is held by it.
  // Amended by R6: the read as built before it measured the word against the row and called it split.
  expect(autoMargin, 'the automatic margin took no free space: the harness is not the shape it says').toBeGreaterThan(100);
  expectHeld(auto, 'a word broken in a narrow item pushed to the end of its row by an automatic margin', 'width 64px');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split room, inline box (89.6-02, R3 repair): a word that fits its line but not with the padding and border of its own inline box is not split', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'split-inline-pill-good'));
  const pill = await readWordLines(page.locator('.lt-pill'), page.locator('.lt-line'));
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, pill, sizerBroken }, null, 2), contentType: 'application/json' });
  const word = pill.words[0];
  const roomInBox = pill.rowRoom ?? Number.NaN;
  expect(sizerBroken, 'the sizing line breaks its word: the paragraph is not the word plus 36px wide').toEqual([]);
  expect(word.natural, `the line does not hold the bare word: the harness is not the shape it says (${JSON.stringify(pill)})`).toBeLessThanOrEqual(roomInBox + 40);
  expect(word.natural, `the line holds the word in its box: the harness is not the shape it says (${JSON.stringify(pill)})`).toBeGreaterThan(roomInBox + 0.5);
  expect(word.lines, 'the word in the inline box is not broken: the harness is not the shape it says').toBeGreaterThan(1);
  expect(read.split, 'a word wider than its line less the padding and border of its own inline box reads as split').toEqual([]);
  expect(entriesFor(read.held, 'Weekend').join(' | '), `the word in the inline box is not held by the sizing box, which is narrower than the card (${JSON.stringify(read)})`).toContain('fit-content');
  expect(requests, 'the page made a request').toEqual([]);
});

// ---- the measured cases (orchestrator change R6): one test per twin of the research's list ----

test('check: split, T1 (89.6-02, R6): a word in a pop-up of fixed width is held by the pop-up and is not split, in a row and under an anchor that offers it less than its width', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const inRow = await splitCase(page, 'split-popup-fixed');
  const paddedAnchor = await splitCase(page, 'split-popup-padded-anchor');
  await testInfo.attach('twin-read', { body: JSON.stringify({ inRow, paddedAnchor }, null, 2), contentType: 'application/json' });
  expectHeld(inRow, 'a word in a 100px pop-up hanging in a row that has room for it', 'position absolute');
  expectHeld(paddedAnchor, 'a word in a 100px pop-up whose anchor offers it less than 100px', 'position absolute');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T2 (89.6-02, R6): reports the middle word of a padded inline box, which has a line of its own with no padding once its row stacks', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const middle = await splitCase(page, 'split-inline-middle');
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ middle, sizerBroken }, null, 2), contentType: 'application/json' });
  expect(sizerBroken, 'the sizing line breaks its word: the row is not the word plus 36px wide').toEqual([]);
  expectReported(middle, 'the middle word of an inline box with 40px of side padding, in a row 36px wider than the word');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T3 (89.6-02, R6): a word in a label of fixed width in a row is held by the label and is not split', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const label = await splitCase(page, 'split-fixed-label');
  await testInfo.attach('twin-read', { body: JSON.stringify({ label }, null, 2), contentType: 'application/json' });
  expectHeld(label, 'a word in a 56px label beside a value, in a row that has room for it', 'width 56px');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T4 (89.6-02, R6): reports a word broken in one of two text columns that one column would hold whole', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const columns = await splitCase(page, 'split-multicol');
  await testInfo.attach('twin-read', { body: JSON.stringify({ columns }, null, 2), contentType: 'application/json' });
  expectReported(columns, 'a word in two-column text');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T5 (89.6-02, R6): reports a name squeezed in the first track of a root that is a subgrid', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const subgrid = await splitCase(page, 'split-subgrid-root');
  const columns = await page.locator('[data-frame]').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  await testInfo.attach('twin-read', { body: JSON.stringify({ subgrid, columns }, null, 2), contentType: 'application/json' });
  expect(columns, 'the root is not a subgrid: the harness is not the shape it says').toMatch(/^subgrid/);
  expectReported(subgrid, 'a name in the 3rem track of a root that is a two-track subgrid');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T6 (89.6-02, R6): a label in a button of fixed width is held by the button, and a 30-letter label in a chip is wide; neither is whole by spilling out of its control', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const button = await splitCase(page, 'split-centred-button');
  const chip = await splitCase(page, 'split-chip-wide');
  await testInfo.attach('twin-read', { body: JSON.stringify({ button, chip }, null, 2), contentType: 'application/json' });
  expectHeld(button, 'a label in a 64px button that centres it, in a row that has room for the word', 'width 64px');
  expectWide(chip, 'a 30-letter label in a 96px chip that centres it', THIRTY_LETTER_WORD);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T7 (89.6-02, R6): a row that cannot be stacked (its direction is important inside a cascade layer) is said so in the split list, not guessed at', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const row = await splitCase(page, 'split-important-row');
  const direction = await page.locator('.lt-row').evaluate((el) => getComputedStyle(el).flexDirection);
  await testInfo.attach('twin-read', { body: JSON.stringify({ row, direction }, null, 2), contentType: 'application/json' });
  expect(direction, 'the row is not a row: the harness is not the shape it says').toBe('row');
  expect(row.broken, 'the case does not squeeze its name, so the harness is not the shape it says').toContain('Weekend');
  expect(entriesFor(row.read.split, 'Weekend').join(' | '), `a word whose row could not be stacked is not reported as COULD NOT STACK (${JSON.stringify(row.read)})`).toContain('COULD NOT STACK');
  expect(row.read.held, 'a word that could not be measured reads as held').toEqual([]);
  expect(row.read.wide, 'a word that could not be measured reads as wide').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T8 (89.6-02, R6): the read leaves the page as it found it: every box, both scroll offsets and the adopted stylesheet list', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const frame = await renderTwin(page, 'split-put-back');
  // The page gets a stylesheet of its own in the adopted list, and both scrollers go to their end.
  await page.evaluate(() => {
    const own = new CSSStyleSheet();
    own.replaceSync('.lt-own-sheet { color: red; }');
    document.adoptedStyleSheets = [own];
    const scroller = document.querySelector('.lt-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const stateOf = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.lt-scroller');
      return {
        boxes: Array.from(document.querySelectorAll('body, body *')).map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName} ${r.left} ${r.top} ${r.width} ${r.height}`;
        }),
        windowScroll: [window.scrollX, window.scrollY],
        scrollerScroll: scroller ? [scroller.scrollLeft, scroller.scrollTop] : null,
        sheets: document.adoptedStyleSheets.map((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText).join(' ')),
      };
    });
  const before = await stateOf();
  const read = await readLargeTextCell(frame);
  const after = await stateOf();
  const again = await readLargeTextCell(frame);
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, before, after }, null, 2), contentType: 'application/json' });
  // The read did change the page for a moment: every squeezed name was stacked and found whole.
  expect(entriesFor(read.split, 'Weekend').length, `the read stacked nothing, so there was nothing to put back (${JSON.stringify(read)})`).toBe(4);
  expect(before.windowScroll[1], 'the page is not scrolled down: the harness is not the shape it says').toBeGreaterThan(0);
  expect(before.scrollerScroll?.[1] ?? 0, 'the scrolling box is not scrolled down: the harness is not the shape it says').toBeGreaterThan(0);
  expect(before.sheets, 'the page does not hold its own adopted stylesheet: the test did not set it').toEqual(['.lt-own-sheet { color: red; }']);
  expect(after.sheets, "the adopted stylesheet list is not what it was: the read's temporary sheet is still in it, or the page's own sheet is gone").toEqual(before.sheets);
  expect(after.windowScroll, 'the page scroll offset moved').toEqual(before.windowScroll);
  expect(after.scrollerScroll, "the scrolling box's scroll offset moved").toEqual(before.scrollerScroll);
  expect(after.boxes, 'a box moved or changed size: the layout was not put back').toEqual(before.boxes);
  expect(again, 'a second read of the same page differs from the first').toEqual(read);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T9 (89.6-02, R6): a one-column grid whose column list carries line names is not a row: a fixed card in it is held, and between a squeezed name and its row it is not counted', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const card = await splitCase(page, 'split-grid-named-lines');
  const columns = await page.locator('.lt-page').evaluate((el) => getComputedStyle(el).gridTemplateColumns);
  const inRow = await splitCase(page, 'split-grid-named-lines-in-row');
  await testInfo.attach('twin-read', { body: JSON.stringify({ card, columns, inRow }, null, 2), contentType: 'application/json' });
  expect(columns, 'the computed column list carries no line name: the harness is not the shape it says').toContain('[full-start]');
  expectHeld(card, 'a word in a fixed card in a one-column grid with line names', 'width 64px');
  expectReported(inRow, 'a name squeezed in a row, a one-column grid with line names between the two');
  expect(entriesFor(inRow.read.split, 'Weekend').join(' | '), 'the one-column grid with line names was counted as a second row').toContain('when 1 row stacks');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T10 (89.6-02, R6): reports a short word squeezed in a centred row item that also holds a 30-letter word, which is wide', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const item = await splitCase(page, 'split-centred-item-wide-word');
  await testInfo.attach('twin-read', { body: JSON.stringify({ item }, null, 2), contentType: 'application/json' });
  expect(item.broken, 'the case does not break its 30-letter word, so the harness is not the shape it says').toContain(THIRTY_LETTER_WORD);
  expectReported(item, 'a short word under a 30-letter heading, in a centred item squeezed by a fixed box');
  expect(entriesFor(item.read.wide, THIRTY_LETTER_WORD).length, `the 30-letter heading is not written down as wide (${JSON.stringify(item.read)})`).toBeGreaterThan(0);
  expect(item.read.held, 'a word of the centred item reads as held').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T11 (89.6-02, R6): reports a breadcrumb crumb glued to its separator, broken although a line of its own would hold it', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const crumb = await splitCase(page, 'split-glued-crumb');
  await testInfo.attach('twin-read', { body: JSON.stringify({ crumb }, null, 2), contentType: 'application/json' });
  expectReported(crumb, 'a crumb with no place to wrap between it and its separator');
  expect(entriesFor(crumb.read.split, 'Weekend').join(' | '), 'the crumb is not reported as glued').toContain('glued');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T12 (89.6-02, R6): a hyphenated word that wraps at its own hyphen in a paragraph is ordinary wrapping: written down, not split', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const paragraph = await splitCase(page, 'split-hyphen-wrap');
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ paragraph, sizerBroken }, null, 2), contentType: 'application/json' });
  expect(sizerBroken, 'the sizing line breaks a word: the paragraph is not as wide as its sizing line').toEqual([]);
  expect(paragraph.broken, 'the hyphenated word is not the one word on two lines: the harness is not the shape it says').toEqual(['auto-close']);
  expectWide(paragraph, 'a hyphenated word wrapped after its hyphen, in a paragraph with nothing beside it', 'auto-close');
  expect(entriesFor(paragraph.read.wide, 'auto-close').join(' | '), 'the word is not written down as wrapping at its hyphen').toContain('hyphen');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T13 (89.6-02, R6): a word wider than the content of its padded row is wide, as a grid item spanning the row and as an item that would be whole only by spilling into the padding', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const spanning = await splitCase(page, 'split-spanning-grid-wide');
  const spilling = await splitCase(page, 'split-spill-into-padding');
  await testInfo.attach('twin-read', { body: JSON.stringify({ spanning, spilling }, null, 2), contentType: 'application/json' });
  expectWide(spanning, 'a word in a grid item that spans both columns of a row with 70px of side padding');
  expectWide(spilling, 'a word in a fit-content item of a row with 70px of side padding');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, T14 (89.6-02, R6): reports a hyphenated heading that wraps at its hyphen only because a box beside it squeezes it', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const heading = await splitCase(page, 'split-hyphen-squeezed');
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ heading, sizerBroken }, null, 2), contentType: 'application/json' });
  expect(sizerBroken, 'the sizing line breaks its word: the row is not that line plus 60px wide').toEqual([]);
  expectReported(heading, 'a hyphenated heading beside a 60px box, in a row 60px wider than the heading has', 'Check-ins');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a width of 0 that shares a row (89.6-02, R6, unsettled in the research): the word of a w-0 flex-1 item reads as held by that width, pinned as built', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const item = await splitCase(page, 'split-zero-width-share');
  await testInfo.attach('twin-read', { body: JSON.stringify({ item }, null, 2), contentType: 'application/json' });
  expectHeld(item, 'a word in an item whose width of 0 exists only to share its row', 'width 0px');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, the held policy (89.6-02, R6): a held word fails the cell with a message of its own, and a wide word does not fail it', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const held = await readLargeTextCell(await renderTwin(page, 'split-fixed-label'));
  const wide = await readLargeTextCell(await renderTwin(page, 'split-spanning-grid-wide'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ held, wide }, null, 2), contentType: 'application/json' });
  expect(held.split, `the held twin reads as split, so it cannot show what a held word alone does (${JSON.stringify(held)})`).toEqual([]);
  expect(entriesFor(held.held, 'Weekend').length, `the held twin holds no held word (${JSON.stringify(held)})`).toBeGreaterThan(0);
  expect(() => expectLargeTextCell(held, 'the held twin'), 'a cell with a held word passed').toThrow('a box with a width of its own');
  expect(wide.split, `the wide twin reads as split (${JSON.stringify(wide)})`).toEqual([]);
  expect(wide.held, `the wide twin reads as held (${JSON.stringify(wide)})`).toEqual([]);
  expect(entriesFor(wide.wide, 'Weekend').length, `the wide twin holds no wide word (${JSON.stringify(wide)})`).toBeGreaterThan(0);
  expect(() => expectLargeTextCell(wide, 'the wide twin'), 'a cell whose only broken word is wide failed').not.toThrow();
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
// The harness cut: a content case that nests a section element must fail loudly, not render half.
// ---------------------------------------------------------------------------------------------

test('harness (89.6-05, R3): a content case that nests a section throws, naming the file and the case', () => {
  const nested = '<section data-case="word30"><main data-frame><section class="lt-col">One</section><div class="lt-col">Two</div></main></section>';
  expect(() => sectionOf(nested, 'word30', 'doctored.html'), 'a case that nests a section was cut at the inner closing tag without a word').toThrow(
    'doctored.html: the case "word30" nests a section element',
  );
  // The same case with a div in place of the inner section is handed back whole.
  const flat = nested.replace('<section class="lt-col">One</section>', '<div class="lt-col">One</div>');
  expect(sectionOf(flat, 'word30', 'doctored.html')).toBe(flat);
});

test('harness (89.6-05, R3 repair): the cut reads tag names in any letter case and never reads inside an HTML comment', () => {
  // An inner section whose opening tag is in capitals is still a nested section.
  const capitals = '<section data-case="word30"><main data-frame><SECTION class="lt-col">One</section><div class="lt-col">Two</div></main></section>';
  expect(() => sectionOf(capitals, 'word30', 'doctored.html'), 'an inner section written in capitals was cut at its closing tag without a word').toThrow(
    'doctored.html: the case "word30" nests a section element',
  );
  // A closing tag in capitals still ends the case.
  expect(sectionOf('<section data-case="a"><p>One</p></SECTION><p>after</p>', 'a', 'doctored.html')).toBe('<section data-case="a"><p>One</p></SECTION>');
  // A comment that names a closing tag does not end the case, and one that names an opening tag is not a nested section.
  const closingInComment = '<section data-case="a"><p>One</p><!-- not the end: </section> --><p>Two</p></section>';
  expect(sectionOf(closingInComment, 'a', 'doctored.html'), 'a comment that names a closing section tag cut the case short').toBe('<section data-case="a"><p>One</p><p>Two</p></section>');
  const openingInComment = '<section data-case="a"><!-- a <section> would nest --><p>One</p></section>';
  expect(sectionOf(openingInComment, 'a', 'doctored.html'), 'a comment that names an opening section tag was taken for a nested section').toBe('<section data-case="a"><p>One</p></section>');
});

// ---------------------------------------------------------------------------------------------
// The mode probe: the second 200% mode is the real browser setting, and the first can be left.
// ---------------------------------------------------------------------------------------------

test("mode (89.6-02): Chromium's default font 32 turns the 48rem media query off at 768 while a rem container query reads the same as the style tag", async ({ page }) => {
  const requests = await countRequests(page);
  const tag = 'mode probe';
  const section = sectionOf(harnessOf('modes'), 'modes', 'modes.html');
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
