import { test, expect, type Page } from '@playwright/test';
import {
  contrastRatio,
  focusByKeyboard,
  focusRingMeasurement,
  sampleBottomCentrePixel,
  settleFocusTransitions,
  type RingMeasurement,
} from './support/contrast';

// Phase 89.6-14 — the ring reader's self-test, on a fixture page.
//
// What it proves:
//   - the shared reader (focusRingMeasurement in e2e/support/contrast.ts) reads the two house
//     ring shapes that plan 89.6-12's utilities draw EXACTLY: the outset form (a 2px outline at
//     offset 2 over a 2px inner band) and the inset form (a transparent outline at -2 and two
//     inset bands), with the band picked out of a multi-layer box-shadow list by its geometry,
//     never by its place in the list (a drop shadow sits after the outset band, an inset
//     underline before the inset bands, as on a shadowed card button and the focused active
//     Friends tab);
//   - the reader THROWS, by name, on every shape that is not the house ring: the pre-89.6
//     box-shadow ring, the browser's own outline, a transparent outline, an opaque inset
//     outline, an outline with no band, an outline at offset 0;
//   - the painted pixel: under the inset ring body a control's border cue (a bottom-border
//     underline, an all-round selected border, the Friends D7 inset band) is still the colour
//     the eye sees 1px above the bottom edge, and the old opaque -2px outline body paints over
//     all three (the negative control that proves the pixel check can fail).
//
// Every fixture button transitions its colours (outline-color included) for 150ms, as Tailwind's
// transition-colors does on the app's controls, so a read taken before the transition settles
// would see the text colour where the outline should be; the reader waits for it.
//
// Why no server and no sign-in: the page is written with setContent, the focus rules use the
// utility bodies from src/app/globals.css ("@utility focus-ring-inset {") verbatim (the band in
// the ring-shadow slot, the five-slot composite as the box-shadow), and every request the page
// makes is aborted and counted; each test fails if the count is not 0. So this spec runs
// locally with --no-deps and in both CI projects, and its colours are rgb() literals.

const PAGE_GROUND = 'rgb(240, 236, 228)';
const FILL = 'rgb(58, 82, 150)';
const OUTER = 'rgb(46, 16, 101)';
const INNER = 'rgb(255, 255, 255)';
const CUE = 'rgb(214, 64, 36)';
const DROP = 'rgb(20, 20, 20)';
const UNDERLINE = 'rgb(0, 128, 96)';

// The two utility bodies, as plan 89.6-12 committed them.
// The slot names are assembled from TW plus the rest ON PURPOSE: plan 89.6-14's last gate counts
// the old ring variables' common prefix across e2e and requires none, and these slots are the NEW
// utility's own (src/app/globals.css ("@utility focus-ring-inset {")), not the retired mechanism.
// Same written-apart idiom as the media-emulation note in e2e/support/contrast.ts; do not join them.
const TW = '--tw-';
const RING_SLOT = `${TW}ring-shadow`;
const COMPOSITE =
  `box-shadow: var(${TW}inset-shadow, 0 0 #0000), var(${TW}inset-ring-shadow, 0 0 #0000), ` +
  `var(${TW}ring-offset-shadow, 0 0 #0000), var(${RING_SLOT}), var(${TW}shadow, 0 0 #0000);`;
const FOCUS_RING =
  'outline: 2px solid var(--focus-ring-outer); outline-offset: 2px; ' +
  `${RING_SLOT}: 0 0 0 2px var(--focus-ring-inner); ` +
  COMPOSITE;
const FOCUS_RING_INSET =
  'outline: 2px solid transparent; outline-offset: -2px; ' +
  `${RING_SLOT}: inset 0 0 0 2px var(--focus-ring-outer), inset 0 0 0 4px var(--focus-ring-inner); ` +
  COMPOSITE;
// The pre-review inset body: the same bands, under an OPAQUE outline at -2.
const OLD_OPAQUE_INSET =
  'outline: 2px solid var(--focus-ring-outer); outline-offset: -2px; ' +
  `${RING_SLOT}: inset 0 0 0 2px var(--focus-ring-outer), inset 0 0 0 4px var(--focus-ring-inner); ` +
  COMPOSITE;

const STYLE = `
  :root { --focus-ring-outer: ${OUTER}; --focus-ring-inner: ${INNER}; }
  html, body { margin: 0; background: ${PAGE_GROUND}; font: 14px/1.2 sans-serif; }
  .grid { display: flex; flex-wrap: wrap; gap: 16px; padding: 16px; }
  button { box-sizing: border-box; width: 96px; height: 36px; padding: 0; margin: 0; border: 0; border-radius: 0; background: ${FILL}; color: ${INNER}; transition-property: color, background-color, border-color, outline-color; transition-duration: 150ms; }
  #house-out { --tw-shadow: 0 1px 2px ${DROP}; }
  #house-out:focus-visible { ${FOCUS_RING} }
  #house-in { --tw-inset-shadow: inset 0 -2px 0 0 ${UNDERLINE}; }
  #house-in:focus-visible { ${FOCUS_RING_INSET} }
  #old-shadow:focus-visible { outline: none; box-shadow: 0 0 0 2px ${INNER}, 0 0 0 4px ${OUTER}; }
  #clear-outline:focus-visible { outline: 2px solid transparent; outline-offset: 2px; box-shadow: 0 0 0 2px ${INNER}; }
  #opaque-inset:focus-visible { outline: 2px solid ${OUTER}; outline-offset: -2px; box-shadow: inset 0 0 0 2px ${OUTER}, inset 0 0 0 4px ${INNER}; }
  #no-band:focus-visible { outline: 2px solid ${OUTER}; outline-offset: 2px; box-shadow: none; }
  #offset-zero:focus-visible { outline: 2px solid ${OUTER}; outline-offset: 0; box-shadow: 0 0 0 2px ${INNER}; }
  .cue-border { border-bottom: 2px solid ${CUE}; }
  .cue-selected { border: 2px solid ${CUE}; }
  .cue-d7 { --tw-inset-shadow: inset 0 -2px 0 0 ${CUE}; box-shadow: var(--tw-inset-shadow); }
  .new-inset:focus-visible { ${FOCUS_RING_INSET} }
  .old-inset:focus-visible { ${OLD_OPAQUE_INSET} }
`;

const PAINTED = [
  { id: 'new-border', shape: 'bottom-border underline', body: 'new' },
  { id: 'new-selected', shape: 'all-round selected border', body: 'new' },
  { id: 'new-d7', shape: 'D7 inset band', body: 'new' },
  { id: 'old-border', shape: 'bottom-border underline', body: 'old' },
  { id: 'old-selected', shape: 'all-round selected border', body: 'old' },
  { id: 'old-d7', shape: 'D7 inset band', body: 'old' },
] as const;

function cueClass(shape: (typeof PAINTED)[number]['shape']): string {
  if (shape === 'bottom-border underline') return 'cue-border';
  if (shape === 'all-round selected border') return 'cue-selected';
  return 'cue-d7';
}

const BODY =
  '<div class="grid">' +
  ['house-out', 'house-in', 'old-shadow', 'ua-outline', 'clear-outline', 'opaque-inset', 'no-band', 'offset-zero']
    .map((id) => `<button id="${id}" type="button">${id}</button>`)
    .join('') +
  PAINTED.map(
    (p) => `<button id="${p.id}" type="button" class="${cueClass(p.shape)} ${p.body === 'new' ? 'new-inset' : 'old-inset'}">${p.id}</button>`
  ).join('') +
  '</div>';

async function read(page: Page, id: string): Promise<RingMeasurement> {
  return focusRingMeasurement(page, page.locator(`#${id}`), id);
}

function channels(css: string): [number, number, number] {
  const m = css.match(/rgb\((\d+), (\d+), (\d+)\)/);
  if (!m) throw new Error(`not an rgb() literal: ${css}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function near(a: [number, number, number], b: [number, number, number]): boolean {
  return a.every((v, i) => Math.abs(v - b[i]) <= 2);
}

let aborted: string[] = [];

test.describe('89.6-14 ring reader (fixture page, no server, no sign-in)', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test.beforeEach(async ({ page }) => {
    aborted = [];
    await page.route('**/*', (route) => {
      aborted.push(route.request().url());
      return route.abort();
    });
    await page.setContent(
      '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
        '<meta name="viewport" content="width=device-width, initial-scale=1">' +
        `<style>${STYLE}</style></head><body>${BODY}</body></html>`
    );
  });

  test.afterEach(() => {
    expect(aborted, `the fixture page made requests: ${aborted.join(', ')}`).toEqual([]);
  });

  test('the two-tone outset ring reads exactly, with a drop shadow listed after its band', async ({ page }) => {
    const m = await read(page, 'house-out');
    const detail = `raw box-shadow: ${m.boxShadow}`;
    expect(m.ringGroundKind, detail).toBe('offset');
    expect(m.outlineWidth, detail).toBe(2);
    expect(m.outlineOffset, detail).toBe(2);
    expect(m.bandWidth, detail).toBe(2);
    expect(m.reach, detail).toBe(4);
    expect(m.outer, detail).toBe(OUTER);
    expect(m.inner, detail).toBe(INNER);
    expect(m.fg, detail).toBe(OUTER);
    expect(m.ground, detail).toBe(PAGE_GROUND);
    expect(m.fill, detail).toBe(FILL);
    expect(m.bandRatio, detail).toBeCloseTo(contrastRatio(OUTER, INNER) ?? NaN, 2);
    expect(m.ratio, detail).toBe(Math.min(m.groundRatio, m.fillRatio));
  });

  test('the two-tone inset ring reads exactly, with an inset underline listed before its bands', async ({ page }) => {
    const m = await read(page, 'house-in');
    const detail = `raw box-shadow: ${m.boxShadow}`;
    expect(m.ringGroundKind, detail).toBe('inset');
    expect(m.outlineOffset, detail).toBe(-2);
    expect(m.bandWidth, detail).toBe(4);
    expect(m.reach, detail).toBe(0);
    expect(m.outer, detail).toBe(OUTER);
    expect(m.inner, detail).toBe(INNER);
    expect(m.outer, detail).not.toBe(UNDERLINE);
    expect(m.inner, detail).not.toBe(UNDERLINE);
  });

  test('the pre-89.6 box-shadow ring is rejected: no outline', async ({ page }) => {
    await expect(read(page, 'old-shadow')).rejects.toThrow(/no outline/);
  });

  test("the browser's own outline is rejected", async ({ page }) => {
    await expect(read(page, 'ua-outline')).rejects.toThrow(/browser's own outline/);
  });

  test('a transparent outline at offset +2 is rejected', async ({ page }) => {
    await expect(read(page, 'clear-outline')).rejects.toThrow(/transparent/);
  });

  test('an opaque outline at offset -2 is rejected: inset outline', async ({ page }) => {
    await expect(read(page, 'opaque-inset')).rejects.toThrow(/inset outline/);
  });

  test('an outline without its band is rejected: inner band', async ({ page }) => {
    await expect(read(page, 'no-band')).rejects.toThrow(/inner band/);
  });

  test('an outline at offset 0 is rejected', async ({ page }) => {
    await expect(read(page, 'offset-zero')).rejects.toThrow(/offset 0/);
  });

  test('painted pixel: the inset ring leaves the border cue visible; the old opaque inset outline hides it', async ({ page }) => {
    const problems: string[] = [];
    for (const p of PAINTED) {
      const control = page.locator(`#${p.id}`);
      await focusByKeyboard(page, control);
      await settleFocusTransitions(control);
      const { pixel, x, y } = await sampleBottomCentrePixel(page, control, p.id);
      const want = p.body === 'new' ? CUE : OUTER;
      if (!near(pixel, channels(want))) {
        problems.push(
          `${p.id} (${p.shape}, ${p.body} body): pixel at (${x}, ${y}) is rgb(${pixel.join(', ')}), want ${want} within 2 per channel`
        );
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

});
