import { test, expect, type Locator, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import postcss, { type AcceptedPlugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  MODAL_BODY_CLASS,
  MODAL_CLOSE_CLASS,
  MODAL_FOOTER_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_SHELL_CLASS,
  MODAL_TITLE_CLASS,
  SIZE_CLASS,
} from '../src/app/components/Modal';
import { Icon, iconTextSize } from '../src/components/ui/Icon';
import { readShell, shellProblems, type ShellGeometry } from './support/largeTextSurfaces/dialogShell';
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
// THE DIALOG SHELL (Phase 89.6-10). The sixth block is not a class set in globals.css: it is the
// house Modal's shell, rendered from the class strings src/app/components/Modal.tsx exports and
// the real close icon. Its harness holds tokens in double curly braces, which BLOCK_OPTIONS fills,
// and each cell also reads the shell's own geometry (the close box, its icon, the buttons, the
// title) and attaches it as shell-geometry.
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
const BLOCKS = ['bb-row', 'bb-cluster', 'bb-media', 'bb-columns', 'bb-frame', 'dialog-shell'] as const;
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

/** What a block may add to the shared cell test. A block with no entry is a class set in globals.css. */
interface BlockOptions {
  /** Fills the tokens of one harness case before it is rendered. */
  fill: (section: string, file: string) => string;
  /** The block's own read of the rendered case: what it measured (attached) and what is wrong with it. */
  extras: (page: Page, mode: TextMode, tag: string) => Promise<{ geometry: unknown; problems: string[] }>;
  /** The name the geometry is attached under. */
  attachment: string;
  /** false: the two 768 / 200% renders are not compared box by box. */
  compareModes: boolean;
  /** The class tokens the compiled stylesheet must hold a rule for, in place of a rule named after the block. */
  ruleTokens: () => string[];
}

const tokensOf = (value: string): string[] => value.split(/\s+/).filter(Boolean);

/** The real close icon of the Modal header: the Icon call of src/app/components/Modal.tsx ("size={20} strokeWidth={2} followText"), rendered on the server side of this process. */
const closeIconMarkup = (): string => renderToStaticMarkup(createElement(Icon, { name: 'X', size: 20, strokeWidth: 2, followText: true }));

/** The tokens of the dialog-shell harness and the shipped string each stands for. */
const shellTokens = (): Record<string, string> => ({
  MODAL_SHELL_CLASS,
  MODAL_HEADER_CLASS,
  MODAL_TITLE_CLASS,
  MODAL_CLOSE_CLASS,
  MODAL_BODY_CLASS,
  MODAL_FOOTER_CLASS,
  SIZE_DEFAULT: SIZE_CLASS.default,
  CLOSE_ICON: closeIconMarkup(),
});

// DECISION Phase 89.6-10 (dialog-shell-block): the shell block renders the exported Modal.tsx
// strings, chosen OVER a harness copy (it passes while Modal.tsx drifts), and it skips the
// cross-mode box comparison because the shell's width and padding switch on the md media query,
// which the default-font-32 mode moves on purpose (research M1); both modes still pass the five
// checks. Changing this is a decision, not a cleanup.
const BLOCK_OPTIONS: Partial<Record<(typeof BLOCKS)[number], BlockOptions>> = {
  'dialog-shell': {
    fill: (section, file) => {
      const tokens = shellTokens();
      for (const [name, value] of Object.entries(tokens)) {
        if (typeof value !== 'string' || value.trim() === '') throw new Error(`${file}: the shell token ${name} has no value, so the case would render without a shipped string`);
      }
      if (!tokens.CLOSE_ICON.includes(`width:${iconTextSize(20)}`)) throw new Error(`${file}: the close icon markup does not carry the size that follows the text (${tokens.CLOSE_ICON})`);
      const filled = section.replace(/\{\{([A-Z_0-9]+)\}\}/g, (whole, name: string) => tokens[name] ?? whole);
      if (filled.includes('{{')) throw new Error(`${file}: a token was left unfilled (${filled.match(/\{\{[^}]*\}\}/)?.[0] ?? 'an open brace pair'})`);
      return filled;
    },
    extras: async (page, mode, tag) => {
      const dialogs = page.locator('[data-frame] [role="dialog"]');
      const count = await dialogs.count();
      const geometry: ShellGeometry[] = [];
      const problems: string[] = count > 0 ? [] : [`${tag}: the case holds no dialog shell`];
      for (let at = 0; at < count; at += 1) {
        const read = await readShell(dialogs.nth(at));
        geometry.push(read);
        if (!read.footer) problems.push(`${tag} shell ${at}: the shell holds no footer (a direct child with a top border)`);
        if (read.buttons.filter((button) => button.part === 'footer').length === 0) problems.push(`${tag} shell ${at}: the footer holds no button`);
        problems.push(...shellProblems(read, mode, `${tag} shell ${at}`));
      }
      // BP-5 (Phase 89.6-11): on the short phone at 200% text the tall shell scrolls as one page.
      // From its top, its twelfth list item is scrolled into view by the nearest edge and must
      // keep room under it for a focus ring: the shell's scroll padding. A footer button cannot
      // show this (the footer's own padding already leaves room at the end of the scroll).
      const size = page.viewportSize();
      const tall = page.locator('[data-frame] [data-shell="tall"]');
      if (/ ordinary$/.test(tag) && (await tall.count()) !== 1) problems.push(`${tag}: the ordinary case must hold exactly one tall shell (data-shell="tall")`);
      if (mode !== '200' || size?.width !== 320 || size.height !== 568 || (await tall.count()) !== 1) return { geometry, problems };
      const bp5 = await tall.evaluate((el) => {
        const before = { top: el.scrollTop, x: window.scrollX, y: window.scrollY };
        el.scrollTop = 0;
        const item = el.querySelectorAll('li')[11];
        if (!item) return null;
        const belowFoldBy = item.getBoundingClientRect().bottom - el.getBoundingClientRect().bottom;
        item.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const read = {
          belowFoldBy,
          room: el.getBoundingClientRect().bottom - item.getBoundingClientRect().bottom,
          scrolledTo: el.scrollTop,
          scrollPaddingBottom: getComputedStyle(el).scrollPaddingBottom,
          borderBottom: getComputedStyle(el).borderBottomWidth,
        };
        el.scrollTop = before.top;
        window.scrollTo(before.x, before.y);
        return read;
      });
      if (!bp5) problems.push(`${tag}: BP-5: the tall shell holds no twelfth list item`);
      else {
        if (bp5.belowFoldBy <= 0 || bp5.scrolledTo <= 0) problems.push(`${tag}: BP-5: the twelfth list item was not below the fold of the tall shell, so nothing is proved (${JSON.stringify(bp5)})`);
        if (bp5.room < 4) problems.push(`${tag}: BP-5: scrolled into view by the nearest edge, the twelfth list item has ${Math.round(bp5.room * 100) / 100}px under it inside the dialog, expected at least 4px of scroll padding (${JSON.stringify(bp5)})`);
      }
      return { geometry: { shells: geometry, bp5 }, problems };
    },
    attachment: 'shell-geometry',
    compareModes: false,
    ruleTokens: () => [MODAL_SHELL_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, MODAL_CLOSE_CLASS, MODAL_BODY_CLASS, MODAL_FOOTER_CLASS, SIZE_CLASS.default].flatMap(tokensOf),
  },
};

test.beforeAll(async () => {
  // The entry is a string, not a file: it imports the real stylesheet and adds the harness folder
  // to the sources Tailwind scans. The from path only anchors the two relative paths.
  // Modal.tsx is a source too (Phase 89.6-10): the dialog-shell block renders the class strings it
  // exports, so every class in them must be in the stylesheet.
  const entry = '@import "../../../src/app/globals.css";\n@source "./*.html";\n@source "../../../src/app/components/Modal.tsx";\n';
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
function expectBlockRule(block: (typeof BLOCKS)[number], tag: string): void {
  const options = BLOCK_OPTIONS[block];
  if (!options) {
    expect(new RegExp(`\\.${block}\\s*\\{`).test(compiledCss), `${tag}: the compiled stylesheet holds no .${block} rule, so this cell rendered without the block`).toBe(true);
    return;
  }
  // A block rendered from exported class strings has no rule of its own name: every token of
  // those strings must have a rule instead (a utility is written with its special characters escaped).
  const missing = options.ruleTokens().filter((token) => !compiledCss.includes(`.${token.replace(/[^a-zA-Z0-9_-]/g, '\\$&')}`));
  expect(missing, `${tag}: the compiled stylesheet holds no rule for these class tokens of ${block}, so this cell rendered without them`).toEqual([]);
}

/** One case of a block's harness, cut and, for a block with tokens, filled. */
function caseOf(block: (typeof BLOCKS)[number], harness: string, name: string): string {
  const file = `${block}.html`;
  const cut = sectionOf(harness, name, file);
  const options = BLOCK_OPTIONS[block];
  return options ? options.fill(cut, file) : cut;
}

for (const block of BLOCKS) {
  for (const cell of CELLS) {
    if (cell.set === 'pagezoom') {
      const zoomName = `${block} page zoom ${cell.width} ${cell.theme}`;
      test(`${zoomName} (89.6-02, SPEC A8): the four content cases lose no content or function`, async ({ page }, testInfo) => {
        const requests = await countRequests(page);
        const harness = harnessOf(block);
        const reads: Array<{ case: string; window: number; read: PageZoomRead }> = [];
        const options = BLOCK_OPTIONS[block];
        const extras: Record<string, { geometry: unknown; problems: string[] }> = {};
        for (const name of CASES) {
          await renderSection(page, cell, caseOf(block, harness, name), `${zoomName} ${name}`);
          const window = await page.evaluate(() => document.documentElement.clientWidth);
          reads.push({ case: name, window, read: await readPageZoomCell(frameOf(page)) });
          if (options) extras[name] = await options.extras(page, cell.mode, `${zoomName} ${name}`);
        }
        // Attached BEFORE asserting: what is only recorded at these widths lives here.
        await testInfo.attach('cell-read', { body: JSON.stringify(reads, null, 2), contentType: 'application/json' });
        if (options) await testInfo.attach(options.attachment, { body: JSON.stringify(extras, null, 2), contentType: 'application/json' });
        for (const { case: name, window, read } of reads) {
          const tag = `${zoomName} ${name}`;
          expect(window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
          expectPageZoomUsable(read, tag);
          if (options) expect(extras[name].problems, `${tag}: the block's own read found problems`).toEqual([]);
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
      const options = BLOCK_OPTIONS[block];
      const extras: Record<string, { geometry: unknown; problems: string[] }> = {};
      for (const name of CASES) {
        await renderSection(page, cell, caseOf(block, harness, name), `${cellName} ${name}`);
        reads.push({ case: name, read: await readLargeTextCell(frameOf(page)) });
        styleTagBoxes[name] = await blockBoxesOf(page);
        if (options) extras[name] = await options.extras(page, cell.mode, `${cellName} ${name}`);
      }
      // Attached BEFORE asserting, so a red cell still leaves its four reads behind.
      await testInfo.attach('cell-read', { body: JSON.stringify(reads, null, 2), contentType: 'application/json' });
      if (options) await testInfo.attach(options.attachment, { body: JSON.stringify(extras, null, 2), contentType: 'application/json' });
      for (const { case: name, read } of reads) {
        const tag = `${cellName} ${name}`;
        expect(read.window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
        expectLargeTextCell(read, tag);
        if (options) expect(extras[name].problems, `${tag}: the block's own read found problems`).toEqual([]);
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
        const font32Extras: Record<string, { geometry: unknown; problems: string[] }> = {};
        for (const name of CASES) {
          // setTextMode is a no-op on this page after the first case: font32 is a page setting.
          await renderSection(second, { ...cell, mode: 'font32' }, caseOf(block, harness, name), `${cellName} font32 ${name}`);
          font32Reads.push({ case: name, read: await readLargeTextCell(frameOf(second)) });
          font32Boxes[name] = await blockBoxesOf(second);
          if (options) font32Extras[name] = await options.extras(second, 'font32', `${cellName} font32 ${name}`);
        }
        await testInfo.attach('mode-boxes', { body: JSON.stringify({ styleTag: styleTagBoxes, font32: font32Boxes, font32Reads }, null, 2), contentType: 'application/json' });
        if (options) await testInfo.attach(`${options.attachment}-font32`, { body: JSON.stringify(font32Extras, null, 2), contentType: 'application/json' });
        for (const { case: name, read } of font32Reads) {
          const tag = `${cellName} font32 ${name}`;
          expectLargeTextCell(read, tag);
          if (options) expect(font32Extras[name].problems, `${tag}: the block's own read found problems`).toEqual([]);
          // A block whose layout switches on a media query is not compared box by box: see its entry in BLOCK_OPTIONS.
          if (options && !options.compareModes) continue;
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

// Orchestrator ruling D29 (plan 89.6-40), a change to this file's instrument: an SVG text is
// measured at its DRAWN size (its font size times its screen scale), never at its font size in user
// units, which an icon's viewBox scales: the landing logo's letter, 15 units in an 80px icon of a
// 40-unit viewBox, is drawn at 30px and was read as shrunk in every 200% cell.
test('check: shrunk, SVG text (89.6-40, D29): an SVG text drawn above the floor through its viewBox scale is not shrunk, and one drawn below it still is', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const read = await readLargeTextCell(await renderTwin(page, 'cut-svg'));
  await testInfo.attach('twin-read', { body: JSON.stringify(read, null, 2), contentType: 'application/json' });
  const shrunk = read.cut.filter((entry) => entry.startsWith('shrunk: '));
  expect(shrunk.filter((entry) => entry === 'shrunk: "B"'), `a letter drawn at 30px through a viewBox scale reads as shrunk (${JSON.stringify(read.cut)})`).toEqual([]);
  expect(shrunk.filter((entry) => entry === 'shrunk: "T"').length, `a letter drawn at 15px no longer reads as shrunk (${JSON.stringify(read.cut)})`).toBe(1);
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
//   wide   the word is wider than its whole room, or it only wraps where the browser breaks
//          anyway (measured: a hyphen, a soft hyphen and a dash are such places). Written down,
//          never failed.
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

test('check: split in a table row (89.6-02, R3 repair; R6): reports a name squeezed by a fixed cell, with a row element, without one, with no cell of its own, and with the fixed cell first', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const row = await splitCase(page, 'split-table-row');
  const cells = await splitCase(page, 'split-table-cells');
  const bareRow = await splitCase(page, 'split-table-bare-row');
  const cellLast = await splitCase(page, 'split-table-cell-last');
  await testInfo.attach('twin-read', { body: JSON.stringify({ row, cells, bareRow, cellLast }, null, 2), contentType: 'application/json' });
  expectReported(cellLast, 'a name in a table cell after a fixed cell that holds a box of fixed width');
  const secondRow = await splitCase(page, 'split-table-second-row');
  await testInfo.attach('twin-read-second-row', { body: JSON.stringify({ secondRow }, null, 2), contentType: 'application/json' });
  expectReported(secondRow, 'a name in the second of three table rows, beside a fixed column');
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

test('check: split, T1 filled (89.6-16, D14): a word in a padded card inside a positioned box that fills its relative parent is wide, not held by the positioned box', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const filled = await splitCase(page, 'split-positioned-fills-parent');
  // The shape, measured after the read: the positioned box is as wide as its parent's padding box, and the word is
  // wider than the card's content but not than the frame's.
  const shape = await page.evaluate(() => {
    const contentOf = (el: Element) => {
      const cs = getComputedStyle(el);
      return el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    };
    const column = document.querySelector('.lt-column') as HTMLElement;
    const list = document.querySelector('.lt-list') as HTMLElement;
    const card = document.querySelector('.lt-card') as HTMLElement;
    const name = document.querySelector('.lt-name') as HTMLElement;
    const frame = document.querySelector('[data-frame]') as HTMLElement;
    name.style.whiteSpace = 'nowrap';
    name.style.width = 'max-content';
    return { column: column.clientWidth, list: list.getBoundingClientRect().width, card: contentOf(card), word: name.getBoundingClientRect().width, frame: contentOf(frame) };
  });
  await testInfo.attach('twin-read', { body: JSON.stringify({ filled, shape }, null, 2), contentType: 'application/json' });
  expect(Math.abs(shape.list - shape.column), `the positioned box does not fill its parent: the harness is not the shape it says (${JSON.stringify(shape)})`).toBeLessThanOrEqual(0.5);
  expect(shape.word, `the word fits the card: the harness is not the shape it says (${JSON.stringify(shape)})`).toBeGreaterThan(shape.card + 0.5);
  expect(shape.word, `the word is wider than the frame: the harness is not the shape it says (${JSON.stringify(shape)})`).toBeLessThan(shape.frame - 0.5);
  expectWide(filled, 'a word in a card with 70px of side padding, inside an absolute inset-0 box that fills its relative parent');
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

test('check: split, T7 (89.6-02, R6): a row that cannot be stacked (its direction, or the alignment of the item that holds the word, is important inside a cascade layer) is said so in the split list, not guessed at', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const row = await splitCase(page, 'split-important-row');
  const direction = await page.locator('.lt-row').evaluate((el) => getComputedStyle(el).flexDirection);
  const item = await splitCase(page, 'split-important-item');
  const sibling = await splitCase(page, 'split-important-sibling');
  await testInfo.attach('twin-read', { body: JSON.stringify({ row, direction, item, sibling }, null, 2), contentType: 'application/json' });
  // The item that holds the word could not be stretched: nothing is measured, and the item is named.
  expect(item.broken, 'the item case does not squeeze its short word, so the harness is not the shape it says').toContain('Weekend');
  expect(entriesFor(item.read.split, 'Weekend').join(' | '), `a word whose own item could not be stretched is not reported as COULD NOT STACK (${JSON.stringify(item.read)})`).toContain('COULD NOT STACK div.lt-name');
  expect(item.read.wide, 'a word that could not be measured reads as wide').toEqual([]);
  // The same alignment on the box beside the words stops nothing: the short word is measured and reported.
  expectReported(sibling, 'a short word squeezed beside a box whose own alignment is important');
  expect(entriesFor(sibling.read.split, 'Weekend').join(' | '), `a word was not measured because a box beside its item could not be stretched (${JSON.stringify(sibling.read)})`).toContain('whole on one line');
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
    const first = new CSSStyleSheet();
    first.replaceSync('.lt-own-first { color: red; }');
    const second = new CSSStyleSheet();
    second.replaceSync('.lt-own-second { color: blue; }');
    document.adoptedStyleSheets = [first, second];
    const scroller = document.querySelector('.lt-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const sideways = document.querySelector('.lt-xscroller');
    if (sideways) sideways.scrollLeft = sideways.scrollWidth;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const stateOf = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.lt-scroller');
      const sideways = document.querySelector('.lt-xscroller');
      return {
        boxes: Array.from(document.querySelectorAll('body, body *')).map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName} ${r.left} ${r.top} ${r.width} ${r.height}`;
        }),
        windowScroll: [window.scrollX, window.scrollY],
        scrollerScroll: scroller ? [scroller.scrollLeft, scroller.scrollTop] : null,
        sidewaysScroll: sideways ? [sideways.scrollLeft, sideways.scrollTop] : null,
        sheets: document.adoptedStyleSheets.map((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText).join(' ')),
      };
    });
  const before = await stateOf();
  const read = await readLargeTextCell(frame);
  const after = await stateOf();
  const again = await readLargeTextCell(frame);
  await testInfo.attach('twin-read', { body: JSON.stringify({ read, before, after }, null, 2), contentType: 'application/json' });
  // The read did change the page for a moment: every squeezed name was stacked and found whole.
  expect(entriesFor(read.split, 'Weekend').length, `the read stacked nothing, so there was nothing to put back (${JSON.stringify(read)})`).toBe(3);
  expect(before.windowScroll[1], 'the page is not scrolled down: the harness is not the shape it says').toBeGreaterThan(0);
  expect(before.scrollerScroll?.[1] ?? 0, 'the scrolling box is not scrolled down: the harness is not the shape it says').toBeGreaterThan(0);
  expect(before.sidewaysScroll?.[0] ?? 0, 'the sideways box is not scrolled sideways: the harness is not the shape it says').toBeGreaterThan(0);
  expect(before.sheets, 'the page does not hold its own two adopted stylesheets in order: the test did not set them').toEqual(['.lt-own-first { color: red; }', '.lt-own-second { color: blue; }']);
  expect(after.sheets, "the adopted stylesheet list is not what it was: the read's temporary sheet is still in it, a sheet of the page is gone, or their order changed").toEqual(before.sheets);
  expect(after.sidewaysScroll, "the sideways box's scroll offset moved").toEqual(before.sidewaysScroll);
  expect(after.windowScroll, 'the page scroll offset moved').toEqual(before.windowScroll);
  expect(after.scrollerScroll, "the scrolling box's scroll offset moved").toEqual(before.scrollerScroll);
  expect(after.boxes, 'a box moved or changed size: the layout was not put back').toEqual(before.boxes);
  expect(again, 'a second read of the same page differs from the first').toEqual(read);
  // The order of the page's own sheets, on a page where the read adopts its sheet exactly ONCE (one
  // word, whole when its columns stack): on the page above the sheet list is put back an even
  // number of times, and a list put back reversed each time would come out in order again.
  const once = await renderTwin(page, 'split-multicol');
  const sheetOrder = () => page.evaluate(() => document.adoptedStyleSheets.map((sheet) => Array.from(sheet.cssRules).map((rule) => rule.cssText).join(' ')));
  await page.evaluate(() => {
    const first = new CSSStyleSheet();
    first.replaceSync('.lt-own-first { color: red; }');
    const second = new CSSStyleSheet();
    second.replaceSync('.lt-own-second { color: blue; }');
    document.adoptedStyleSheets = [first, second];
  });
  const onceRead = await readLargeTextCell(once);
  expect(onceRead.split.length, `the one-word page did not stack exactly one word (${JSON.stringify(onceRead)})`).toBe(1);
  expect(await sheetOrder(), "the page's two adopted stylesheets are not in their order after a read that adopted its sheet once").toEqual(['.lt-own-first { color: red; }', '.lt-own-second { color: blue; }']);
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
  expect(entriesFor(paragraph.read.wide, 'auto-close').join(' | '), 'the word is not written down as wrapping where the browser breaks anyway').toContain('wraps only where the browser breaks anyway');
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

// T14 since the owner's ruling on question D, 2026-11-25 ("a": a break at a hyphen is fine; R12): a
// word whose every break falls where the browser breaks anyway is ordinary wrapping, WHETHER OR NOT
// stacking the rows above it would make it whole. Before the ruling this test said "reports" and
// expected split. The words broken by force inside a hyphenated name (letter-stacked, or broken
// inside one of its halves) are still split or held: the cases of the two tests on places the
// browser breaks anyway and on a forced break that leaves the line count as it was.
test('check: split, T14 (89.6-02, R6; owner ruling R12): a hyphenated heading that wraps only at its hyphen because a box beside it squeezes it is ordinary wrapping, and so is a dialog title whose long name wraps only at its hyphen beside a close-sized box', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const NAME = 'Featherstonehaugh-Cholmondeley';
  const heading = await splitCase(page, 'split-hyphen-squeezed');
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  const dialogRead = await readLargeTextCell(await renderTwin(page, 'split-hyphen-dialog-title', { width: 768, height: 1024, theme: 'dark', mode: '200' }));
  const dialog: SplitCase = { read: dialogRead, broken: await brokenWordsOf(page.locator('.lt-name')) };
  const dialogLines = await linesOf(page.locator('.lt-name'));
  const dialogSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ heading, sizerBroken, dialog, dialogLines, dialogSizer }, null, 2), contentType: 'application/json' });
  expect(sizerBroken, 'the sizing line breaks its word: the row is not that line plus 60px wide').toEqual([]);
  expectWide(heading, 'a hyphenated heading beside a 60px box, in a row 60px wider than the heading has', 'Check-ins');
  expect(entriesFor(heading.read.wide, 'Check-ins').join(' | '), 'the heading is not written down as ordinary wrapping').toContain('ordinary wrapping');
  expect(dialogSizer, 'the sizing line of the dialog title breaks its word: the room is not that line plus 52px wide').toEqual([]);
  expect(dialog.broken, 'the long name is not the one word on more than one line: the harness is not the shape it says').toEqual([NAME]);
  expect(dialogLines[NAME], 'the long name is not on two lines (wrapped at its hyphen only): the harness is not the shape it says').toBe(2);
  expectWide(dialog, 'a long hyphenated name in a dialog title beside a close-sized box, whole if the close stacked', NAME);
  expect(entriesFor(dialog.read.wide, NAME).join(' | '), 'the long name is not written down as ordinary wrapping').toContain('ordinary wrapping');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a width of 0 that shares a row (89.6-02, R6, unsettled in the research): the word of a w-0 flex-1 item reads as held by that width, pinned as built', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const item = await splitCase(page, 'split-zero-width-share');
  await testInfo.attach('twin-read', { body: JSON.stringify({ item }, null, 2), contentType: 'application/json' });
  expectHeld(item, 'a word in an item whose width of 0 exists only to share its row', 'width 0px');
  expect(requests, 'the page made a request').toEqual([]);
});

// ---- the repair cases (after scoped check 1 of R6) ----

test('check: split, a full-bleed row (89.6-02, R6 repair): reports a name squeezed in a row pulled into its card padding by a negative side margin, with and without its own padding', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const bleed = await splitCase(page, 'split-full-bleed');
  const margin = await page.locator('.lt-row').evaluate((el) => Number.parseFloat(getComputedStyle(el).marginLeft));
  const padded = await splitCase(page, 'split-full-bleed-padded');
  await testInfo.attach('twin-read', { body: JSON.stringify({ bleed, margin, padded }, null, 2), contentType: 'application/json' });
  expect(margin, 'the row has no negative side margin: the harness is not the shape it says').toBeLessThan(0);
  expectReported(bleed, 'a name squeezed in a full-bleed row, whole once stacked and starting inside the card padding');
  expect(entriesFor(bleed.read.split, 'Weekend').join(' | '), 'the name in the full-bleed row was not measured as whole when stacked').toContain('whole on one line');
  expectReported(padded, 'a name squeezed in a full-bleed row that puts its own side padding back');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a sideways scroller (89.6-02, R6 repair): reports two squeezed names in a box that scrolls sideways, one past its first screen, and the verdict is the same at two scroll offsets', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const frame = await renderTwin(page, 'split-sideways-scroller');
  const broken = await brokenWordsOf(page.locator('.lt-wide'));
  const scroller = page.locator('.lt-xscroller');
  const atStart = await readLargeTextCell(frame);
  const offsets = await scroller.evaluate((el) => {
    el.scrollLeft = 300;
    return { scrollLeft: el.scrollLeft, max: el.scrollWidth - el.clientWidth };
  });
  const scrolled = await readLargeTextCell(frame);
  const after = await scroller.evaluate((el) => el.scrollLeft);
  await testInfo.attach('twin-read', { body: JSON.stringify({ broken, atStart, offsets, scrolled, after }, null, 2), contentType: 'application/json' });
  expect(broken, 'the case does not squeeze both names, so the harness is not the shape it says').toEqual(['Weekend', 'Warriors']);
  expect(offsets.scrollLeft, 'the box did not scroll sideways to 300: the harness is not the shape it says').toBe(300);
  for (const [read, when] of [
    [atStart, 'at scroll offset 0'],
    [scrolled, 'at scroll offset 300'],
  ] as const) {
    for (const word of ['Weekend', 'Warriors']) {
      expect(entriesFor(read.split, word).join(' | '), `${word} ${when}: not measured as whole when its row stacks (${JSON.stringify(read)})`).toContain('whole on one line');
    }
    expect(read.held, `${when}: a word reads as held`).toEqual([]);
    expect(read.wide, `${when}: a word reads as wide`).toEqual([]);
  }
  expect(scrolled.split, 'the split list differs between the two scroll offsets').toEqual(atStart.split);
  expect(after, 'the read moved the sideways scroll offset').toBe(300);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, places the browser breaks anyway (89.6-02, R6 repair): a wrap at a soft hyphen or an en dash is ordinary wrapping, a slash pair is broken by force and held by its box, a hyphenated word letter-stacked by its row is reported, and a word whose forced breaks cannot be switched off is said so', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const SOFT = 'Week­enders';
  const DASH = 'Mon–Friday';
  const SLASH = 'Mon/Friday';
  const natural = await splitCase(page, 'split-natural-breaks', '.lt-card');
  const stacked = await splitCase(page, 'split-hyphen-letter-stacked');
  const sizerBroken = await brokenWordsOf(page.locator('.lt-sizer'));
  const important = await splitCase(page, 'split-important-wrap');
  await testInfo.attach('twin-read', { body: JSON.stringify({ natural, stacked, sizerBroken, important }, null, 2), contentType: 'application/json' });
  expect(natural.broken, 'the three words are not each on more than one line: the harness is not the shape it says').toEqual([SOFT, DASH, SLASH]);
  expect(natural.read.split, `a wrap at a place the browser breaks anyway reads as split (${JSON.stringify(natural.read)})`).toEqual([]);
  // Measured, not listed: Chromium does not break after a slash between two words, so that pair
  // is broken by force, no line of its 150px box would hold it, and the box holds it.
  expect(natural.read.held.length, `only the slash pair is to read as held (${JSON.stringify(natural.read)})`).toBe(1);
  expect(entriesFor(natural.read.held, SLASH).join(' | '), `the slash pair is not held by its fixed box (${JSON.stringify(natural.read)})`).toContain('width 150px');
  for (const word of [SOFT, DASH]) {
    expect(entriesFor(natural.read.wide, word).join(' | '), `${JSON.stringify(word)} is not written down as ordinary wrapping (${JSON.stringify(natural.read)})`).toContain('ordinary wrapping');
  }
  // A hyphenated word broken inside itself by a box beside it: stacked, only the wrap at its hyphen is left.
  expect(sizerBroken, 'the sizing line breaks a word: the row is not as wide as its sizing line').toEqual([]);
  expectReported(stacked, 'a hyphenated word letter-stacked by a box beside it', 'auto-close');
  expect(entriesFor(stacked.read.split, 'auto-close').join(' | '), 'the word is not reported as losing its forced breaks when its row stacks').toContain('ordinary wrap');
  // The same shape with a hyphenated word wider than its whole room: wide, whatever its row does.
  const tooWide = await splitCase(page, 'split-hyphen-wide-letter-stacked');
  await testInfo.attach('twin-read-too-wide', { body: JSON.stringify({ tooWide }, null, 2), contentType: 'application/json' });
  expectWide(tooWide, 'a hyphenated word wider than the whole frame, letter-stacked by a box beside it', 'Weekenders-Weekenders');
  expect(entriesFor(tooWide.read.wide, 'Weekenders-Weekenders').join(' | '), 'the word is not written down as wider than its whole room').toContain('wider than its whole room');
  // A word whose wrapping is important inside a cascade layer: its natural break points cannot be measured.
  expect(important.broken, 'the case does not break its word, so the harness is not the shape it says').toContain('Weekenders');
  expect(entriesFor(important.read.split, 'Weekenders').join(' | '), `a word whose forced breaks could not be switched off is not reported as COULD NOT UNWRAP (${JSON.stringify(important.read)})`).toContain('COULD NOT UNWRAP');
  expect(important.read.wide, 'a word that could not be measured reads as wide').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a forced break (89.6-02, R6 repair): a word wider than the content of its fixed label is held whatever stands before it, and a crumb glued to its separator is reported the same way for a real separator and for one drawn by ::before', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const label = await splitCase(page, 'split-icon-label');
  const span = await splitCase(page, 'split-glued-crumb');
  const before = await splitCase(page, 'split-crumb-before');
  const drawn = await page.locator('.lt-name').evaluate((el) => getComputedStyle(el, '::before').content);
  await testInfo.attach('twin-read', { body: JSON.stringify({ label, span, before, drawn }, null, 2), contentType: 'application/json' });
  expectHeld(label, 'a word wider than the content of a 170px label, an icon positioned in the label padding', 'width 170px', 'Weekenders');
  expect(drawn, 'the crumb draws no separator before itself: the harness is not the shape it says').toContain('>');
  expectReported(span, 'a crumb glued to a separator that is an element');
  expectReported(before, 'a crumb glued to a separator drawn by its own ::before');
  expect(entriesFor(before.read.split, 'Weekend'), 'the two crumbs are not reported the same way').toEqual(entriesFor(span.read.split, 'Weekend'));
  const pair = await splitCase(page, 'split-crumb-padded-pair');
  await testInfo.attach('twin-read-pair', { body: JSON.stringify({ pair }, null, 2), contentType: 'application/json' });
  expectReported(pair, 'a glued crumb that is the first of two words in an inline box padded after the second');
  expect(entriesFor(pair.read.split, 'Weekend').join(' | '), 'the first word of the padded pair is not reported as glued').toContain('glued');
  expect(requests, 'the page made a request').toEqual([]);
});

/** Make the page let a stylesheet be adopted and refuse to let one go: every temporary sheet of a read stays on. */
async function refuseSheetRelease(page: Page): Promise<void> {
  await page.evaluate(() => {
    const own = Object.getOwnPropertyDescriptor(Document.prototype, 'adoptedStyleSheets');
    if (!own?.get || !own.set) throw new Error('Document.prototype.adoptedStyleSheets is not an accessor');
    const { get, set } = own;
    Object.defineProperty(document, 'adoptedStyleSheets', {
      configurable: true,
      get: () => get.call(document),
      set: (list: CSSStyleSheet[]) => {
        if (list.length >= (get.call(document) as CSSStyleSheet[]).length) set.call(document, list);
      },
    });
  });
}

test('check: split, a page that is not put back (89.6-02, R6 repair): when the page refuses the put-back of the stylesheet list or of a scroll offset, the read says NOT RESTORED for the sheets, the layout and the scroll', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const frame = await renderTwin(page, 'split-bad');
  await refuseSheetRelease(page);
  const stuck = await readLargeTextCell(frame);
  // The page refuses a scroll offset written back to its scrolling box.
  const second = await renderTwin(page, 'split-put-back');
  await page.evaluate(() => {
    const scroller = document.querySelector('.lt-scroller');
    const own = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
    if (!scroller || !own?.get) throw new Error('no scrolling box, or Element.prototype.scrollTop is not an accessor');
    const { get } = own;
    scroller.scrollTop = scroller.scrollHeight;
    Object.defineProperty(scroller, 'scrollTop', { configurable: true, get: () => get.call(scroller), set: () => undefined });
  });
  const unscrolled = await readLargeTextCell(second);
  await testInfo.attach('twin-read', { body: JSON.stringify({ stuck, unscrolled }, null, 2), contentType: 'application/json' });
  const said = (read: LargeTextCellRead) => read.split.filter((entry) => entry.startsWith('NOT RESTORED')).join(' | ');
  expect(said(stuck), `a stylesheet list that kept the read's sheet was not reported (${JSON.stringify(stuck)})`).toContain('adopted stylesheets after the read');
  expect(said(stuck), `a layout left stacked was not reported (${JSON.stringify(stuck)})`).toContain('the layout differs after the read');
  expect(said(unscrolled), `a scroll offset that was not put back was not reported (${JSON.stringify(unscrolled)})`).toContain('a scroll offset moved during the read');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a throw part-way (89.6-02, R6 repair): when the read throws while a row is stacked, the stack, the scroll offsets and its measuring span are released all the same', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const frame = await renderTwin(page, 'split-put-back');
  await page.evaluate(() => {
    const scroller = document.querySelector('.lt-scroller');
    if (scroller) scroller.scrollTop = scroller.scrollHeight;
    const sideways = document.querySelector('.lt-xscroller');
    if (sideways) sideways.scrollLeft = sideways.scrollWidth;
    window.scrollTo(0, document.documentElement.scrollHeight);
  });
  const stateOf = () =>
    page.evaluate(() => {
      const scroller = document.querySelector('.lt-scroller');
      const sideways = document.querySelector('.lt-xscroller');
      return {
        boxes: Array.from(document.querySelectorAll('body, body *')).map((el) => {
          const r = el.getBoundingClientRect();
          return `${el.tagName} ${r.left} ${r.top} ${r.width} ${r.height}`;
        }),
        bodyChildren: document.body.children.length,
        windowScroll: [window.scrollX, window.scrollY],
        scrollerScroll: scroller ? [scroller.scrollLeft, scroller.scrollTop] : null,
        sidewaysScroll: sideways ? [sideways.scrollLeft, sideways.scrollTop] : null,
        sheets: document.adoptedStyleSheets.length,
      };
    });
  const clean = await readLargeTextCell(frame);
  const before = await stateOf();
  // The first time a word's box is asked for while a temporary sheet is adopted, the page throws.
  await page.evaluate(() => {
    const native = Range.prototype.getBoundingClientRect;
    let armed = true;
    Range.prototype.getBoundingClientRect = function getBoundingClientRect(this: Range) {
      if (armed && document.adoptedStyleSheets.length > 0) {
        armed = false;
        throw new Error('lt forced throw');
      }
      return native.call(this);
    };
  });
  await expect(readLargeTextCell(frame), 'the read did not throw: nothing was forced part-way').rejects.toThrow('lt forced throw');
  const after = await stateOf();
  const again = await readLargeTextCell(frame);
  await testInfo.attach('twin-read', { body: JSON.stringify({ clean, before, after, again }, null, 2), contentType: 'application/json' });
  expect(before.windowScroll[1], 'the page is not scrolled down: the harness is not the shape it says').toBeGreaterThan(0);
  expect(after.sheets, "the read's temporary sheet is still adopted after the throw").toBe(before.sheets);
  expect(after.bodyChildren, "the read's measuring span is still in the page after the throw").toBe(before.bodyChildren);
  expect(after.windowScroll, 'the page scroll offset was not put back after the throw').toEqual(before.windowScroll);
  expect(after.scrollerScroll, "the scrolling box's scroll offset was not put back after the throw").toEqual(before.scrollerScroll);
  expect(before.sidewaysScroll?.[0] ?? 0, 'the sideways box is not scrolled sideways: the harness is not the shape it says').toBeGreaterThan(0);
  expect(after.sidewaysScroll, "the sideways box's scroll offset was not put back after the throw").toEqual(before.sidewaysScroll);
  expect(after.boxes, 'a box moved or changed size: the layout was not put back after the throw').toEqual(before.boxes);
  expect(again, 'a read after the throw differs from the read before it').toEqual(clean);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, text that may break anywhere (89.6-02; R6): a word broken inside bb-breakable is not read by the split check', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const breakable = await splitCase(page, 'split-breakable');
  await testInfo.attach('twin-read', { body: JSON.stringify({ breakable }, null, 2), contentType: 'application/json' });
  expect(breakable.broken, 'the case does not break its name, so the harness is not the shape it says').toContain('Weekend');
  expect(breakable.read.split, 'a word inside bb-breakable reads as split').toEqual([]);
  expect(breakable.read.held, 'a word inside bb-breakable reads as held').toEqual([]);
  expect(breakable.read.wide, 'a word inside bb-breakable is written down as wide').toEqual([]);
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

// ---- the last batch (orchestrator change R9, after the final scoped check of R6) ----

/** How many lines each word under one element is drawn on. */
async function linesOf(locator: Locator): Promise<Record<string, number>> {
  const read = await readWordLines(locator);
  return Object.fromEntries(read.words.map((w) => [w.word, w.lines]));
}

test('check: split, a full-bleed row inside a plain wrapper (89.6-02, R9): reports a name squeezed in a row pulled into its card padding through a wrapper with no edge of its own, and a row pulled out of its card altogether is still not room', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const wrapped = await splitCase(page, 'split-full-bleed-wrapped');
  const wrappedShape = await page.locator('.lt-plain').evaluate((el) => {
    const own = getComputedStyle(el);
    const row = el.firstElementChild ? getComputedStyle(el.firstElementChild) : null;
    return { edge: Number.parseFloat(own.paddingLeft) + Number.parseFloat(own.borderLeftWidth), rowMargin: row ? Number.parseFloat(row.marginLeft) : 0 };
  });
  const spill = await splitCase(page, 'split-full-bleed-spill');
  const spillShape = await page.locator('.lt-row').evaluate((el) => {
    const card = el.closest('.lt-card');
    const cs = card ? getComputedStyle(card) : null;
    return { rowLeft: el.getBoundingClientRect().left, cardLeft: card ? card.getBoundingClientRect().left : 0, cardPadding: cs ? Number.parseFloat(cs.paddingLeft) : 0, cardBorder: cs ? Number.parseFloat(cs.borderLeftWidth) : -1 };
  });
  const bordered = await splitCase(page, 'split-full-bleed-bordered-wrapper');
  const borderedShape = await page.locator('.lt-bordered').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { padding: Number.parseFloat(cs.paddingLeft), border: Number.parseFloat(cs.borderLeftWidth), rowLeft: el.firstElementChild ? el.firstElementChild.getBoundingClientRect().left : 0, left: el.getBoundingClientRect().left };
  });
  await testInfo.attach('twin-read', { body: JSON.stringify({ wrapped, wrappedShape, spill, spillShape, bordered, borderedShape }, null, 2), contentType: 'application/json' });
  expect(wrappedShape.edge, 'the wrapper has padding or a border of its own: the harness is not the shape it says').toBe(0);
  expect(wrappedShape.rowMargin, 'the row has no negative side margin: the harness is not the shape it says').toBeLessThan(0);
  expectReported(wrapped, 'a name squeezed in a full-bleed row that sits in a plain wrapper inside its card');
  expect(entriesFor(wrapped.read.split, 'Weekend').join(' | '), 'the name in the wrapped full-bleed row was not measured as whole when stacked').toContain('whole on one line');
  // An edge stops the carried widening: padding alone (the card), and a border alone (a wrapper).
  expect(spillShape.rowLeft, 'the row does not start left of its card: the harness is not the shape it says').toBeLessThan(spillShape.cardLeft);
  expect(spillShape.cardPadding, 'the card has no side padding: the harness is not the shape it says').toBeGreaterThan(0);
  expect(spillShape.cardBorder, 'the card has a side border: the case does not show padding alone stopping the widening').toBe(0);
  expectWide(spill, 'a name in a row pulled out of its card by a margin twice the card padding');
  expect(borderedShape.border, 'the wrapper has no side border: the harness is not the shape it says').toBeGreaterThan(0);
  expect(borderedShape.padding, 'the wrapper has side padding: the case does not show a border alone stopping the widening').toBe(0);
  expect(borderedShape.rowLeft, 'the row does not start left of its bordered wrapper: the harness is not the shape it says').toBeLessThan(borderedShape.left);
  expectWide(bordered, 'a name in a row pulled out of a wrapper that has a border of its own');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a forced break that leaves the line count as it was (89.6-02, R9): a hyphenated or dashed name broken inside its first part is reported when stacking leaves only the wrap at its hyphen, and is held by a box of its own width, whether or not it is on more lines than its natural wrap', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const HYPHEN = 'Weekend-Go';
  const DASH = 'Weekend\u2013Go';
  const same = await splitCase(page, 'split-hyphen-forced-same-count');
  const sameLines = await linesOf(page.locator('.lt-name'));
  const sameSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  const more = await splitCase(page, 'split-hyphen-forced-more-lines');
  const moreLines = await linesOf(page.locator('.lt-name'));
  const dash = await splitCase(page, 'split-dash-forced-same-count');
  const dashLines = await linesOf(page.locator('.lt-name'));
  const dashSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  const held = await splitCase(page, 'split-hyphen-held-same-count', '.lt-frame');
  const heldLines = await linesOf(page.locator('.lt-frame'));
  // The same page with wrapping of its own on body, which the measuring span sits in, and none of it on the case.
  await page.evaluate(() => {
    document.body.style.wordBreak = 'break-all';
    document.body.style.setProperty('line-break', 'anywhere');
    const section = document.querySelector('section');
    section?.style.setProperty('word-break', 'normal');
    section?.style.setProperty('line-break', 'auto');
  });
  const bodyWraps = await page.evaluate(() => {
    const cs = getComputedStyle(document.body);
    return { wordBreak: cs.wordBreak, lineBreak: cs.lineBreak };
  });
  const underBodyWrapping = await readLargeTextCell(frameOf(page));
  const SHY = 'Week\u00ADend';
  const refused = await splitCase(page, 'split-soft-hyphen-refused');
  const refusedShape = await page.locator('.lt-name').evaluate((el) => {
    // Where the name breaks: the letters drawn before the first one on another line.
    const node = el.firstChild as Text;
    const tops: Array<{ letter: string; top: number }> = [];
    for (let at = 0; at < node.length; at += 1) {
      const range = document.createRange();
      range.setStart(node, at);
      range.setEnd(node, at + 1);
      const drawn = Array.from(range.getClientRects()).find((r) => r.width > 0 && r.height > 0);
      if (drawn) tops.push({ letter: node.data[at], top: Math.round(drawn.top) });
    }
    return { hyphens: getComputedStyle(el).hyphens, text: el.textContent, firstLine: tops.filter((t) => t.top === tops[0].top).map((t) => t.letter).join('') };
  });
  const SHY_HYPHEN = 'Week\u00ADend-Go';
  const notTaken = await splitCase(page, 'split-soft-hyphen-not-taken');
  const notTakenSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  const notTakenLines = await linesOf(page.locator('.lt-name'));
  await testInfo.attach('twin-read', {
    body: JSON.stringify({ same, sameLines, sameSizer, more, moreLines, dash, dashLines, dashSizer, held, heldLines, bodyWraps, underBodyWrapping, refused, refusedShape, notTaken, notTakenSizer, notTakenLines }, null, 2),
    contentType: 'application/json',
  });
  // Squeezed beside a box: on two lines as drawn (broken inside "Weekend") and on two lines once stacked (at the hyphen).
  expect(sameSizer, 'the sizing line breaks its word: the row is not as wide as that line').toEqual([]);
  expect(sameLines[HYPHEN], 'the hyphenated name is not on two lines as drawn: the case does not show a forced break that leaves the line count as it was').toBe(2);
  expectReported(same, 'a hyphenated name broken inside its first part by a box beside it, on as many lines as its natural wrap', HYPHEN);
  expect(entriesFor(same.read.split, HYPHEN).join(' | '), 'the name is not reported as losing its forced breaks when its row stacks').toContain('its forced breaks go');
  expect(moreLines[HYPHEN], 'the hyphenated name beside the wider box is not on more than two lines: the harness is not the shape it says').toBeGreaterThan(2);
  expectReported(more, 'the same name beside a wider box, on more lines than its natural wrap', HYPHEN);
  expect(entriesFor(more.read.split, HYPHEN).join(' | '), 'the name beside the wider box is not reported as losing its forced breaks when its row stacks').toContain('its forced breaks go');
  expect(dashSizer, 'the sizing line of the dashed name breaks its word: the row is not as wide as that line').toEqual([]);
  expect(dashLines[DASH], 'the dashed name is not on two lines as drawn: the case does not show a forced break that leaves the line count as it was').toBe(2);
  expectReported(dash, 'a name with an en dash broken inside its first part by a box beside it', DASH);
  expect(entriesFor(dash.read.split, DASH).join(' | '), 'the dashed name is not reported as losing its forced breaks when its row stacks').toContain('its forced breaks go');
  // In a box of its own width, with nothing to stack: held, with a hyphen and without one.
  expect(heldLines['Weekend-Go'], 'the hyphenated name in the narrow box is not on two lines as drawn: the case does not show a forced break that leaves the line count as it was').toBe(2);
  expect(held.broken, 'the two names in the narrow boxes and the 30-letter word are not all broken: the harness is not the shape it says').toEqual(['Weekend-Go', 'WeekendGo', THIRTY_LETTER_WORD]);
  expect(held.read.split, `a name held by a box of its own width reads as split (${JSON.stringify(held.read)})`).toEqual([]);
  for (const word of ['Weekend-Go', 'WeekendGo']) {
    expect(entriesFor(held.read.wide, word), `${word}, broken inside its first part, reads as wide (${JSON.stringify(held.read)})`).toEqual([]);
    expect(entriesFor(held.read.held, word).join(' | '), `${word} is not held by its sizing box (${JSON.stringify(held.read)})`).toContain('held narrow by div.lt-fit');
  }
  // The 30-letter word is judged after the measuring span was laid out with no room: its width is still measured on one line.
  expect(entriesFor(held.read.wide, THIRTY_LETTER_WORD).join(' | '), `the 30-letter word after the two names is not written down as wider than its whole room (${JSON.stringify(held.read)})`).toContain('is wider than its whole room');
  // The places the browser breaks anyway are measured with none of the page's own wrapping.
  expect(bodyWraps, 'body does not wrap anywhere: the harness is not the shape it says').toEqual({ wordBreak: 'break-all', lineBreak: 'anywhere' });
  expect(underBodyWrapping, 'the read differs when body, where the measuring span sits, has wrapping of its own').toEqual(held.read);
  // A soft hyphen the page refuses is no place the browser breaks at anyway.
  expect(refusedShape, 'the name is not broken one letter after a soft hyphen that hyphens: none refuses, with no hyphen drawn: the harness is not the shape it says').toEqual({ hyphens: 'none', text: SHY, firstLine: 'Weeke' });
  expectHeld(refused, 'a name broken by force one letter after a soft hyphen that hyphens: none refuses', 'held narrow by div.lt-fit', SHY);
  // A soft hyphen the line did not break at draws nothing, and is on no line.
  expect(notTakenSizer, 'the sizing line of the name with a soft hyphen and a hyphen breaks its word: the box is not as wide as that line').toEqual([]);
  expect(notTakenLines[SHY_HYPHEN], 'the name with a soft hyphen and a hyphen is not on two lines: the harness is not the shape it says').toBe(2);
  expectWide(notTaken, 'a name that wraps at its hyphen and leaves its soft hyphen unused', SHY_HYPHEN);
  expect(entriesFor(notTaken.read.wide, SHY_HYPHEN).join(' | '), 'the name is not written down as ordinary wrapping').toContain('ordinary wrapping');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, line-break anywhere (89.6-02, R9): text that may break between any two letters by line-break is measured with that switched off: held by a box narrower than its word, reported when a line of its block would hold it, and said so when it cannot be switched off', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const narrow = await splitCase(page, 'split-line-break-anywhere');
  const narrowStyle = await page.locator('.lt-name').evaluate((el) => getComputedStyle(el).lineBreak);
  const fits = await splitCase(page, 'split-line-break-anywhere-fits');
  const fitsSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  const important = await splitCase(page, 'split-important-line-break');
  await testInfo.attach('twin-read', { body: JSON.stringify({ narrow, narrowStyle, fits, fitsSizer, important }, null, 2), contentType: 'application/json' });
  expect(narrowStyle, 'the name does not compute to line-break: anywhere: the harness is not the shape it says').toBe('anywhere');
  expectHeld(narrow, 'a word under line-break: anywhere in a 100px box', 'width 100px', 'Weekenders');
  expect(fitsSizer, 'the sizing line breaks a word: the box is not as wide as that line').toEqual([]);
  expectReported(fits, 'a word under line-break: anywhere whose last letter drops alone although a line of its block would hold the word');
  expect(entriesFor(fits.read.split, 'Weekend').join(' | '), 'the word is not reported as one a line of its own block would hold').toContain('a line of its own block would hold it');
  expect(important.broken, 'the case does not break its word, so the harness is not the shape it says').toContain('Weekenders');
  expect(entriesFor(important.read.split, 'Weekenders').join(' | '), `a word whose line-break could not be switched off is not reported as COULD NOT UNWRAP (${JSON.stringify(important.read)})`).toContain('COULD NOT UNWRAP');
  expect(important.read.held, 'a word that could not be measured reads as held').toEqual([]);
  expect(important.read.wide, 'a word that could not be measured reads as wide').toEqual([]);
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, a read that failed under the page-zoom read (89.6-02, R9): a word that could not be measured and a page that was not put back FAIL a page-zoom cell, and a split that was measured is only recorded there', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  // The page-zoom read is the same page read with a lighter expectation. These twins break their
  // word at 320 / 200%, so they are read there: what is proven is what the expectation does.
  const measured = await readPageZoomCell(await renderTwin(page, 'split-bad'));
  const noStack = await readPageZoomCell(await renderTwin(page, 'split-important-row'));
  const noUnwrap = await readPageZoomCell(await renderTwin(page, 'split-important-wrap'));
  const frame = await renderTwin(page, 'split-bad');
  await refuseSheetRelease(page);
  const stuck = await readPageZoomCell(frame);
  await testInfo.attach('twin-read', { body: JSON.stringify({ measured, noStack, noUnwrap, stuck }, null, 2), contentType: 'application/json' });
  expect(measured.lost, `the measured twin lost content, so it cannot show what a recorded split alone does (${JSON.stringify(measured)})`).toEqual([]);
  expect(measured.recorded.join(' | '), 'the measured twin records no split').toContain('split: "Weekend"');
  expect(() => expectPageZoomUsable(measured, 'the measured twin'), 'a page-zoom cell whose only finding is a measured split failed').not.toThrow();
  for (const [read, token, what] of [
    [noStack, 'COULD NOT STACK', 'a row that could not be stacked'],
    [noUnwrap, 'COULD NOT UNWRAP', 'a word whose forced breaks could not be switched off'],
    [stuck, 'NOT RESTORED', 'a page that was not put back'],
  ] as const) {
    expect(read.lost, `${what}: the twin lost content, so it cannot show what ${token} alone does (${JSON.stringify(read)})`).toEqual([]);
    expect(read.recorded.join(' | '), `${what}: the read does not say ${token} (${JSON.stringify(read)})`).toContain(token);
    expect(() => expectPageZoomUsable(read, what), `${what}: a page-zoom cell whose read says ${token} passed`).toThrow('the read could not measure a word, or could not put the page back');
  }
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, the glued test needs the word on one line (89.6-02, R9): a hyphenated name under break-all that is still on two lines with its forced breaks off, each of them fitting its box, is held by the box and not called glued, and a break-all word that a line of its block would hold is reported', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const WORD = 'Weekend-Go';
  const found = await splitCase(page, 'split-break-all-two-lines-free');
  const sizer = await brokenWordsOf(page.locator('.lt-sizer'));
  // The same word with word-break put back to normal, as the read's own second look does: where it sits then.
  const free = await page.locator('.lt-name').evaluate((el) => {
    const name = el as HTMLElement;
    name.style.wordBreak = 'normal';
    const range = document.createRange();
    range.selectNodeContents(name);
    const rects = Array.from(range.getClientRects()).filter((r) => r.width > 0);
    const read = { lines: new Set(rects.map((r) => Math.round(r.top))).size, width: range.getBoundingClientRect().width, room: name.clientWidth };
    name.style.wordBreak = '';
    return read;
  });
  await testInfo.attach('twin-read', { body: JSON.stringify({ found, sizer, free }, null, 2), contentType: 'application/json' });
  expect(sizer, 'the sizing line breaks its word: the box is not as wide as that line').toEqual([]);
  expect(free.lines, 'with word-break normal the name is not on two lines: the case does not show a word still wrapped with its forced breaks off').toBe(2);
  expect(free.width, 'with word-break normal the name is wider than its box: the case does not show a measured width that fits').toBeLessThanOrEqual(free.room + 0.5);
  expectHeld(found, 'a hyphenated name under break-all in a box as wide as its sizing line', 'held narrow by div.lt-fit', WORD);
  // The other side of the same test: a break-all word that IS on one line with its forced breaks off, on a line that holds it.
  const fits = await splitCase(page, 'split-break-all-fits');
  const fitsSizer = await brokenWordsOf(page.locator('.lt-sizer'));
  const fitsStyle = await page.locator('.lt-name').evaluate((el) => getComputedStyle(el).wordBreak);
  await testInfo.attach('twin-read-fits', { body: JSON.stringify({ fits, fitsSizer, fitsStyle }, null, 2), contentType: 'application/json' });
  expect(fitsStyle, 'the name does not compute to word-break: break-all: the harness is not the shape it says').toBe('break-all');
  expect(fitsSizer, 'the sizing line breaks a word: the box is not as wide as that line').toEqual([]);
  expectReported(fits, 'a word under break-all whose last letter drops alone although a line of its block would hold the word');
  expect(entriesFor(fits.read.split, 'Weekend').join(' | '), 'the word is not reported as one a line of its own block would hold').toContain('a line of its own block would hold it');
  expect(requests, 'the page made a request').toEqual([]);
});

test('check: split, the half pixel of wider than its room (89.6-02, R9): a word a quarter of a pixel wider than its marked room is not written down as wider than its whole room, and one three quarters of a pixel wider is', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const frame = await renderTwin(page, 'split-wide-boundary');
  const name = page.locator('.lt-name');
  const natural = (await readWordLines(name)).words[0].natural;
  /** Make the marked room `over` px narrower than the word, by its own left padding: the room the read computes is its client width less its padding. */
  const readAt = async (over: number) => {
    const shape = await page.locator('.lt-room').evaluate(
      (el, want) => {
        const room = el as HTMLElement;
        const width = Math.ceil(want.natural) + 20;
        room.style.boxSizing = 'border-box';
        room.style.width = `${width}px`;
        room.style.paddingLeft = `${width - (want.natural - want.over)}px`;
        const cs = getComputedStyle(room);
        return { clientWidth: room.clientWidth, paddingLeft: Number.parseFloat(cs.paddingLeft), room: room.clientWidth - Number.parseFloat(cs.paddingLeft) - Number.parseFloat(cs.paddingRight) };
      },
      { natural, over },
    );
    return { over, shape, by: natural - shape.room, broken: await brokenWordsOf(name), read: await readLargeTextCell(frame) };
  };
  const quarter = await readAt(0.25);
  const threeQuarters = await readAt(0.75);
  await testInfo.attach('twin-read', { body: JSON.stringify({ natural, quarter, threeQuarters }, null, 2), contentType: 'application/json' });
  const WIDER = 'is wider than its whole room';
  const entries = (read: LargeTextCellRead) => [...entriesFor(read.split, 'Weekend'), ...entriesFor(read.held, 'Weekend'), ...entriesFor(read.wide, 'Weekend')];
  expect(quarter.by, 'the room is not about a quarter of a pixel narrower than the word: the harness is not the shape it says').toBeGreaterThan(0.1);
  expect(quarter.by, 'the room is not about a quarter of a pixel narrower than the word: the harness is not the shape it says').toBeLessThan(0.4);
  expect(quarter.broken, 'the word a quarter of a pixel wider than its room is not broken, so no verdict is due').toEqual(['Weekend']);
  expect(entries(quarter.read).length, `the word a quarter of a pixel over is not in exactly one list (${JSON.stringify(quarter.read)})`).toBe(1);
  expect(entries(quarter.read).join(' | '), `a word a quarter of a pixel wider than its room is written down as wider than its whole room (${JSON.stringify(quarter.read)})`).not.toContain(WIDER);
  expect(threeQuarters.by, 'the room is not about three quarters of a pixel narrower than the word: the harness is not the shape it says').toBeGreaterThan(0.6);
  expect(threeQuarters.by, 'the room is not about three quarters of a pixel narrower than the word: the harness is not the shape it says').toBeLessThan(0.9);
  expect(threeQuarters.broken, 'the word three quarters of a pixel wider than its room is not broken, so no verdict is due').toEqual(['Weekend']);
  expect(entriesFor(threeQuarters.read.wide, 'Weekend').join(' | '), `a word three quarters of a pixel wider than its room is not written down as wider than its whole room (${JSON.stringify(threeQuarters.read)})`).toContain(WIDER);
  expect(threeQuarters.read.split, `a word three quarters of a pixel wider than its room reads as split (${JSON.stringify(threeQuarters.read)})`).toEqual([]);
  expect(threeQuarters.read.held, `a word three quarters of a pixel wider than its room reads as held (${JSON.stringify(threeQuarters.read)})`).toEqual([]);
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

// R13 (orchestrator decision D20, 2026-11-25): the spill box search stops at the nearest box whose
// overflow-x is not visible. Content past a box that scrolls or clips sideways is clipped by it, and
// reachable by scrolling: it paints nowhere outside the card around it. The availability grid's day
// headers read as spilling up to 972px at 768 / 200% because the search climbed past such a box.
test('check: spill, a scroll container (89.6-02, R13): a word scrolled away in a box that scrolls sideways, or clipped by one that hides, inside a filled card is not spill, and the same word painting out of the card with no such box between still is', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const scrolled = await readLargeTextCell(await renderTwin(page, 'spill-scrolled-away'));
  const shape = await page.locator('.lt-xscroller').evaluateAll((els) =>
    els.map((el) => {
      const card = el.closest('.lt-card')?.getBoundingClientRect();
      const words = Array.from(el.querySelectorAll('span')).map((s) => s.getBoundingClientRect());
      return { overflowX: getComputedStyle(el).overflowX, sunPastCard: card ? Math.round(words[2].right - card.right) : null };
    }),
  );
  const open = await readLargeTextCell(await renderTwin(page, 'spill-no-scroll-box'));
  await testInfo.attach('twin-read', { body: JSON.stringify({ scrolled, shape, open }, null, 2), contentType: 'application/json' });
  expect(shape.map((s) => s.overflowX), 'the two boxes are not one that scrolls and one that hides sideways: the harness is not the shape it says').toEqual(['auto', 'hidden']);
  for (const s of shape) expect(s.sunPastCard, `"Sun" is not past the card's right edge in the ${s.overflowX} box: the harness is not the shape it says`).toBeGreaterThan(1);
  expect(scrolled.spill, `a word scrolled away or clipped inside its card reads as spill (${JSON.stringify(scrolled)})`).toEqual([]);
  expect(open.spill.join(' | '), `a word painting out of its filled card with no scroll box between does not read as spill (${JSON.stringify(open)})`).toContain('"Sun" spills');
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
  // 89.6-19 (orchestrator ruling D17): an inline link that wraps over two lines is two line
  // fragments, not one box. Its one bounding box spans both full lines and covers the link beside
  // it although no letter of either is under the other; that is not an overlap. Two inline links
  // where the second is shifted back over the first still are. Each fragment counts only where it
  // is drawn: a link scrolled out of a scrolling body lies over the button under it and draws nothing there.
  const linksFrame = await renderTwin(page, 'zoom-links', ZOOM_CHECK_CELL);
  const links = await readPageZoomCell(linksFrame);
  const scrolledUnder = await linksFrame.evaluate((frame) => {
    const link = frame.querySelector('.lt-links-scroll a')!.getBoundingClientRect();
    const below = Array.from(frame.querySelectorAll('button')).find((b) => b.textContent === 'Below')!.getBoundingClientRect();
    return link.bottom > below.top + 1 && link.top < below.bottom - 1;
  });
  expect(scrolledUnder, 'the staging is off: the scrolled link was to lie over the button under its scrolling body').toBe(true);
  const fragments = await linksFrame.locator('a').evaluateAll((anchors) =>
    anchors.map((a) => ({
      text: a.textContent,
      box: (({ left, top, right, bottom }) => ({ left, top, right, bottom }))(a.getBoundingClientRect()),
      lines: Array.from(a.getClientRects()).map(({ left, top, right, bottom }) => ({ left, top, right, bottom })),
    })),
  );
  await testInfo.attach('twin-read-links', { body: JSON.stringify({ links, fragments }, null, 2), contentType: 'application/json' });
  expect(fragments[1].lines.length, 'the staging is off: the second breadcrumb link was to wrap over two lines').toBe(2);
  expect(links.lost.join(' | '), 'the two links shifted over each other are not in lost').toContain('overlap: a "Ticket" and a "Azul"');
  expect(
    links.lost.filter((entry) => entry.includes('Weekend Warriors')),
    'a link that wraps over two lines reads as overlapping the link beside it although no letter of either is under the other',
  ).toEqual([]);
  expect(
    links.lost.filter((entry) => entry.includes('Scrolled link')),
    'a link scrolled out of its scrolling body reads as overlapping the button under that body, where it draws nothing',
  ).toEqual([]);
  expect(links.lost, 'the inline-links twin lost something other than the shifted pair').toEqual(['overlap: a "Ticket" and a "Azul"']);
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
