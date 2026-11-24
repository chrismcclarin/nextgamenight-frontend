import { test, expect, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import postcss, { type AcceptedPlugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button } from '../src/components/ui/Button';
import { THIRTY_LETTER_WORD, expectLargeTextCell, readLargeTextCell, setTextMode, type TextMode } from './support/wordLines';

// Phase 89.6-06 (SPEC R3, R4, R10): the shared primitives at large text, RENDERED from the real
// components.
//
// WHAT. The real primitives (Button, Icon) are rendered on the server side of this test process
// and read in Chromium with the large-text checks of the one shared read,
// e2e/support/wordLines.ts ("DECISION Phase 89.6-02 (checks)"). Phone widths first: 320, then 375,
// then the 215 page-zoom width; 1280 only where a rule is about every width.
//
// HOW. react-dom/server's renderToStaticMarkup turns a React element of the real component into
// markup; the page is filled with setContent; src/app/globals.css is compiled in beforeAll exactly
// as e2e/large-text-blocks.spec.ts ("DECISION Phase 89.6-02 (harness)") does, through
// @tailwindcss/postcss, with a source line for each primitive file and for this spec, so every
// class the markup uses is in the stylesheet.
//
// READ-ONLY. No navigation, no session, no server. Every request the page makes is aborted and
// counted, and every test asserts that the count is 0. The storage state is empty.
//
// PROJECT. journeys only: each test sets its own viewport and must run once.
//
// DECISION Phase 89.6-06 (primitives-spec): the primitives are proven by rendering the REAL
// components to static markup inside Playwright, chosen OVER a copy of their class strings in a
// harness page (it would pass while the component drifts) and OVER a signed-in page walk (CI-only,
// and the sweep plans own pages). Changing this is a decision, not a cleanup.

test.skip(
  ({ isMobile }) => isMobile,
  '89.6-06: each test sets its own viewport (320 to 1280) and must run once; the phone project emulates an iPhone SE, whose mobile viewport would lay a setContent page without a viewport meta at 980px, so its cells would not measure what they name',
);
test.use({ storageState: { cookies: [], origins: [] } });

type Theme = 'light' | 'dark';
interface Cell {
  width: number;
  height: number;
  theme: Theme;
  mode: TextMode;
}

/** src/app/globals.css as the app ships it, plus the utilities the primitives and this spec use. */
let compiledCss = '';

test.beforeAll(async () => {
  // The entry is a string, not a file: it imports the real stylesheet and names the files Tailwind
  // scans for class names. The from path only anchors the relative paths.
  const entry =
    '@import "../src/app/globals.css";\n' +
    '@source "../src/components/ui/Button.tsx";\n' +
    '@source "../src/components/ui/Icon.tsx";\n' +
    '@source "../src/components/ui/Spinner.tsx";\n' +
    '@source "./primitives-large-text.spec.ts";\n';
  // The cast: @tailwindcss/postcss is typed against its own nested copy of postcss, so its plugin
  // type and this file's postcss differ by name only. postcss.config.js loads the same plugin.
  const plugin = tailwindcss() as unknown as AcceptedPlugin;
  const result = await postcss([plugin]).process(entry, { from: resolve(__dirname, 'primitives-large-text-entry.css') });
  compiledCss = result.css;
  expect(compiledCss, 'the compile did not produce the app stylesheet (no .btn rule)').toContain('.btn {');
  expect(compiledCss, 'the compile did not produce the building blocks (no .bb-label rule)').toContain('.bb-label {');
  // Proof that the source lines reached the primitive and this spec: one utility from each.
  expect(compiledCss, 'the compile did not scan Button.tsx (no min-h-11 utility)').toContain('.min-h-11');
  expect(compiledCss, 'the compile did not scan this spec (no w-24 utility)').toContain('.w-24');
});

/** Abort and count every request the page makes; a setContent page should make none. */
async function countRequests(page: Page): Promise<string[]> {
  const requests: string[] = [];
  await page.route('**/*', (route) => {
    requests.push(route.request().url());
    return route.abort();
  });
  return requests;
}

/**
 * Render real components in a cell: the element goes through renderToStaticMarkup, the markup sits
 * in the frame the reads use, then the text mode is set. The frame carries an lt- hook name the app
 * never styles and the thin page edge at its phone value.
 */
async function renderPrimitive(page: Page, cell: Cell, element: React.ReactElement, tag: string): Promise<Locator> {
  const markup = renderToStaticMarkup(element);
  await page.emulateMedia({ colorScheme: cell.theme });
  await page.setViewportSize({ width: cell.width, height: cell.height });
  const htmlClass = cell.theme === 'dark' ? ' class="dark"' : '';
  await page.setContent(
    `<!doctype html><html lang="en"${htmlClass}><head><meta charset="utf-8">` +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      `<style>${compiledCss}</style></head><body class="bg-surface-page">` +
      `<main data-frame class="lt-frame px-4 py-4">${markup}</main></body></html>`,
  );
  await setTextMode(page, cell.mode, tag);
  const window = await page.evaluate(() => document.documentElement.clientWidth);
  expect(window, `${tag}: the window is not ${cell.width}px wide`).toBe(cell.width);
  return page.locator('[data-frame]');
}

test('bb-label (89.6-06): a capped Button with a 30-letter word wraps its label inside the control at 320 / 200%', async ({ page }, testInfo) => {
  const tag = 'bb-label 320 light 200';
  const requests = await countRequests(page);
  const frame = await renderPrimitive(
    page,
    { width: 320, height: 568, theme: 'light', mode: '200' },
    React.createElement(Button, { className: 'w-24' }, `Invite ${THIRTY_LETTER_WORD}`),
    tag,
  );
  const read = await readLargeTextCell(frame);
  const button = await frame.locator('button').evaluate((el) => {
    const r = el.getBoundingClientRect();
    const label = el.querySelector('.bb-label');
    return { width: r.width, height: r.height, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth, labelSpans: el.querySelectorAll('.bb-label').length, labelText: label ? label.textContent : null };
  });
  // Attached BEFORE asserting, so a red run still leaves its read behind.
  await testInfo.attach('cell-read', { body: JSON.stringify({ read, button }, null, 2), contentType: 'application/json' });
  expect(read.spill, `${tag}: the label spills out of the Button (${JSON.stringify(read)})`).toEqual([]);
  expect(read.pageSideways, `${tag}: the page scrolls sideways by ${read.pageSideways}px (${JSON.stringify(read)})`).toBeLessThanOrEqual(0);
  expectLargeTextCell(read, tag);
  expect(button.labelSpans, `${tag}: the Button's text is not inside one .bb-label span`).toBe(1);
  expect(button.labelText).toBe(`Invite ${THIRTY_LETTER_WORD}`);
  expect(requests, `${tag}: the page made a request`).toEqual([]);
});
