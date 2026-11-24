import { test, expect, type Locator, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import postcss, { type AcceptedPlugin } from 'postcss';
import tailwindcss from '@tailwindcss/postcss';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { X } from 'lucide-react';
import { Button } from '../src/components/ui/Button';
import { Icon } from '../src/components/ui/Icon';
import {
  THIRTY_LETTER_WORD,
  expectLargeTextCell,
  expectPageZoomUsable,
  readLargeTextCell,
  readPageZoomCell,
  setTextMode,
  type PageZoomRead,
  type TextMode,
} from './support/wordLines';

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

// ---------------------------------------------------------------------------------------------
// O-M4 Fixed+ (owner pick, 2026-11-22: "The box stays 44px, and the icon inside grows with the
// text up to 32px"). Two halves: normal text is pixel-identical to the lozenge as shipped, and at
// enlarged text the boxes hold their normal-text size while the icon follows the text to 32px.
// ---------------------------------------------------------------------------------------------

interface ProbeBox {
  width: number;
  height: number;
  /** The first element child's left and top edge, measured from the control's own box. */
  childLeft: number;
  childTop: number;
  childWidth: number;
  childHeight: number;
}

/** The box of the one control under a probe wrapper, and where its first element child sits in it. */
async function probeBox(page: Page, probe: string): Promise<ProbeBox> {
  return page.locator(`[data-probe="${probe}"] button`).evaluate((el) => {
    const r = el.getBoundingClientRect();
    const child = el.firstElementChild;
    if (!child) throw new Error('the probed control has no element child');
    const c = child.getBoundingClientRect();
    return { width: r.width, height: r.height, childLeft: c.left - r.left, childTop: c.top - r.top, childWidth: c.width, childHeight: c.height };
  });
}

/** A probe wrapper: a block of its own, so two probes never share a line. The lt- name is not styled by the app. */
function probe(name: string, control: React.ReactElement): React.ReactElement {
  return React.createElement('div', { key: name, 'data-probe': name, className: 'lt-probe' }, control);
}

const PX_TOLERANCE = 0.5;

/** The two child shapes the three shipped size icon sites hold. */
const ICON_CHILD_SHAPES: ReadonlyArray<{ name: string; site: string; children: () => React.ReactNode[] }> = [
  {
    // src/app/components/FeedbackForm.js and src/app/components/PendingMemberBanner.js: a text glyph.
    name: 'glyph',
    site: 'FeedbackForm Remove, PendingMemberBanner Dismiss',
    children: () => [React.createElement('span', { key: 'g', 'aria-hidden': 'true', className: 'text-lg leading-none' }, '\u00d7')],
  },
  {
    // src/components/ui/BottomSheet.tsx: a 1.25rem lucide X and an sr-only name.
    name: 'svg',
    site: 'BottomSheet close',
    children: () => [
      React.createElement(X, { key: 'x', className: 'h-5 w-5', 'aria-hidden': true }),
      React.createElement('span', { key: 's', className: 'sr-only' }, 'Close'),
    ],
  },
];

test('O-M4 normal text (89.6-06): the icon lozenge is pixel-identical to the N1 lozenge as shipped', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  const measured: Array<{ cell: string; shape: string; site: string; subject: ProbeBox; reference: ProbeBox }> = [];
  for (const size of [
    { width: 375, height: 667 },
    { width: 1280, height: 800 },
  ]) {
    for (const shape of ICON_CHILD_SHAPES) {
      const tag = `O-M4 normal text ${size.width} ${shape.name}`;
      await renderPrimitive(
        page,
        { ...size, theme: 'light', mode: '100' },
        React.createElement(
          React.Fragment,
          null,
          // The subject: the real Button, as the three shipped sites write it.
          probe('subject', React.createElement(Button, { variant: 'ghost', size: 'icon', 'aria-label': 'Close' }, ...shape.children())),
          // The reference: the N1 lozenge as shipped at FE 8a446dc, the as-built recipe. A raw
          // button carrying .btn and the two rem floors, the classes size icon emitted then.
          probe('reference', React.createElement('button', { type: 'button', 'aria-label': 'Close', className: 'btn min-h-11 min-w-11' }, ...shape.children())),
        ),
        tag,
      );
      measured.push({ cell: `${size.width}`, shape: shape.name, site: shape.site, subject: await probeBox(page, 'subject'), reference: await probeBox(page, 'reference') });
    }
  }
  // Attached BEFORE asserting.
  await testInfo.attach('boxes', { body: JSON.stringify(measured, null, 2), contentType: 'application/json' });
  expect(measured.length, 'two widths by two child shapes were to be measured').toBe(4);
  for (const m of measured) {
    const tag = `O-M4 normal text ${m.cell} ${m.shape} (${m.site})`;
    for (const side of ['width', 'height', 'childLeft', 'childTop', 'childWidth', 'childHeight'] as const) {
      expect(
        Math.abs(m.subject[side] - m.reference[side]),
        `${tag}: ${side} differs from the lozenge as shipped (Button ${m.subject[side]}px, as shipped ${m.reference[side]}px). Normal text must not change: fix the rule, never the reference`,
      ).toBeLessThanOrEqual(PX_TOLERANCE);
    }
    // Non-vacuity: the reference really is the 44px-floored lozenge, and the svg one is 52 wide.
    expect(Math.abs(m.reference.height - 44), `${tag}: the as-shipped lozenge is not 44px tall`).toBeLessThanOrEqual(PX_TOLERANCE);
    if (m.shape === 'svg') expect(Math.abs(m.reference.width - 52), `${tag}: the as-shipped svg lozenge is not 52px wide`).toBeLessThanOrEqual(PX_TOLERANCE);
  }
  expect(requests, 'O-M4 normal text: the page made a request').toEqual([]);
});

test('O-M4 enlarged text (89.6-06): icon boxes hold their normal-text size while the icon follows text to 32px', async ({ page }, testInfo) => {
  const requests = await countRequests(page);
  /** The same child in both sizes: the house icon, 20px at normal text, following the text. */
  const controls = () =>
    React.createElement(
      React.Fragment,
      null,
      probe('icon', React.createElement(Button, { variant: 'ghost', size: 'icon', 'aria-label': 'Close' }, React.createElement(Icon, { name: 'X', size: 20, followText: true }))),
      probe('iconSquare', React.createElement(Button, { variant: 'ghost', size: 'iconSquare', 'aria-label': 'Next month' }, React.createElement(Icon, { name: 'X', size: 20, followText: true }))),
    );
  const ENLARGED: ReadonlyArray<{ width: number; height: number; mode: TextMode; svg: number }> = [
    { width: 320, height: 568, mode: '150', svg: 30 },
    { width: 320, height: 568, mode: '200', svg: 32 },
    { width: 375, height: 667, mode: '150', svg: 30 },
    { width: 375, height: 667, mode: '200', svg: 32 },
  ];
  const measured: Array<{ cell: string; svg: number; icon: ProbeBox; iconSquare: ProbeBox; followMarkers: number }> = [];
  for (const cell of ENLARGED) {
    const tag = `O-M4 enlarged ${cell.width} ${cell.mode}`;
    const frame = await renderPrimitive(page, { width: cell.width, height: cell.height, theme: 'light', mode: cell.mode }, controls(), tag);
    measured.push({
      cell: `${cell.width} / ${cell.mode}`,
      svg: cell.svg,
      icon: await probeBox(page, 'icon'),
      iconSquare: await probeBox(page, 'iconSquare'),
      followMarkers: await frame.locator('svg[data-follow-text]').count(),
    });
  }
  // The fifth cell: 215 wide at normal text, a 430-wide phone at 200% page zoom (SPEC A8).
  const zoomFrame = await renderPrimitive(page, { width: 215, height: 466, theme: 'light', mode: '100' }, controls(), 'O-M4 page zoom 215');
  const zoom: PageZoomRead = await readPageZoomCell(zoomFrame);
  const zoomBoxes = { icon: await probeBox(page, 'icon'), iconSquare: await probeBox(page, 'iconSquare') };
  // Attached BEFORE asserting, so a red run still leaves every box behind.
  await testInfo.attach('boxes', { body: JSON.stringify({ enlarged: measured, pageZoom215: { read: zoom, boxes: zoomBoxes } }, null, 2), contentType: 'application/json' });

  expect(measured.length, 'four enlarged cells were to be measured').toBe(4);
  for (const m of measured) {
    const tag = `O-M4 enlarged ${m.cell}`;
    const near = (got: number, want: number, what: string) =>
      expect(Math.abs(got - want), `${tag}: ${what} is ${got}px, not ${want}px`).toBeLessThanOrEqual(PX_TOLERANCE);
    expect(m.followMarkers, `${tag}: both icons were to carry data-follow-text`).toBe(2);
    near(m.icon.width, 52, 'the size icon box width');
    near(m.icon.height, 44, 'the size icon box height');
    near(m.iconSquare.width, 44, 'the size iconSquare box width');
    near(m.iconSquare.height, 44, 'the size iconSquare box height');
    near(m.icon.childWidth, m.svg, 'the icon in the size icon box (width)');
    near(m.icon.childHeight, m.svg, 'the icon in the size icon box (height)');
    near(m.iconSquare.childWidth, m.svg, 'the icon in the size iconSquare box (width)');
    near(m.iconSquare.childHeight, m.svg, 'the icon in the size iconSquare box (height)');
  }
  expectPageZoomUsable(zoom, 'O-M4 page zoom 215');
  expect(requests, 'O-M4 enlarged text: the page made a request').toEqual([]);
});
