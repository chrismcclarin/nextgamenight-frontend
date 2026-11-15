import { writeFile } from 'node:fs/promises';

import { test, expect, type Locator, type Page, type TestInfo } from '@playwright/test';

import { assertTheme, focusByKeyboard, focusRingMeasurement, forceLightMode, haloGroundRatio } from './support/contrast';
import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

// Phase 88.9 plan 66 (X61, owner remarks at round-2 row N22) — keyboard focus rings as NUMBERS.
//
// THE REMARKS. At the keyboard-ring pictures the owner said the ring sits too close to the text on
// the right of several text controls, too far from one name, runs below the Requests tab and
// crosses the line under it, and asked why some rings have round corners and others square ones.
// This spec does not judge those looks. It records, per focused control, the numbers a ruling
// needs, in both projects (375 and 1280) and both themes:
//   - the control's border box and its ink box (a Range over each painted text node, plus every
//     svg and img inside it), so "too close" and "too far" are a gap in pixels per side;
//   - its border radius, which is what a box-shadow ring follows;
//   - every box-shadow layer the browser painted (spread and colour), the ring's outward reach,
//     and the halo band between control and ring;
//   - for a tab, how far the ring's bottom edge reaches past the top of the strip's bottom line.
// The numbers go to the run as an attachment named ring-geometry and are printed to the job log.
//
// WHAT IT ASSERTS, and only this: the house ring rule. A control that paints an OFFSET ring must
// paint a 4px ring over a 2px halo, the halo must read as the surface under the control (ratio at
// most 1.01, the floor the contrast gate uses), and the ring must not be cut off by an ancestor
// that clips its overflow or by the screen edge. A ring with no offset has no halo and is recorded
// only. Padding, radius and box size are looks: recorded, never asserted, so this spec cannot turn
// an unruled look into a red build.
//
// NOTHING IS WRITTEN. Writes are held in the browser (support/inFlight.ts); the friend and request
// rows are made-up rows answered in the browser; no test presses a control that writes. Selecting
// a group in the Invite to Group select sends one read. Focus is given by keyboard modality plus a
// programmatic focus, which presses nothing.
//
// CI ONLY: both projects need the signed-in storage state, which does not exist locally.

const HALO_EQUAL = 1.01;
const RING_SPREAD = 4;
const HALO_SPREAD = 2;

const RING_FRIEND = { id: 'e2e-friends-x61-f', friend: { id: '88966a61-0000-4000-8000-0000000000d1', username: 'E2E Ring Friend' } };
const RING_REQUEST = {
  id: 'e2e-friends-x61-r',
  status: 'pending',
  Requester: { id: '88966a61-0000-4000-8000-0000000000d2', username: 'E2E Ring Requester' },
};

interface Edges {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ShadowLayer {
  inset: boolean;
  spread: number;
  colour: string;
}

interface RingRead {
  label: string;
  focusVisible: boolean;
  box: Edges;
  width: number;
  height: number;
  ink: Edges | null;
  /** Ink edge to the control's own edge, per side (negative: the ink pokes out of the box). */
  inkToBox: Edges | null;
  /** Ink edge to the inner edge of the ring, per side (the box gap plus the halo). */
  inkToRing: Edges | null;
  borderRadius: string;
  boxShadow: string;
  layers: ShadowLayer[];
  /** The largest non-inset spread: how far the ring reaches outside the box. */
  outward: number;
  /** The smaller non-inset spread when two are painted: the halo band. 0 when there is none. */
  halo: number;
  /** The first ancestor (or the screen) that cuts the ring, with how far it is cut per side. */
  clippedBy: { by: string; over: Edges } | null;
  /** Tabs only: the ring's bottom edge minus the top of the strip's bottom line. */
  pastStripLine: number | null;
}

interface RingRecord extends RingRead {
  project: string;
  theme: 'dark' | 'light';
  viewport: number;
  houseRing: boolean;
  haloColour: string | null;
  surface: string | null;
  haloRatio: number | null;
}

// One evaluate per control, after it holds a keyboard focus and its animations have settled.
async function readRing(control: Locator): Promise<RingRead> {
  return control.evaluate((el) => {
    const round = (n: number) => Math.round(n * 100) / 100;
    const cs = getComputedStyle(el);

    // Split on commas outside parentheses: rgb() and oklch() colours carry their own commas.
    const parts: string[] = [];
    let depth = 0;
    let current = '';
    for (const ch of cs.boxShadow) {
      if (ch === '(') depth += 1;
      if (ch === ')') depth -= 1;
      if (ch === ',' && depth === 0) {
        parts.push(current);
        current = '';
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);
    const layers =
      cs.boxShadow === 'none'
        ? []
        : parts.map((part) => {
            const colour = (part.match(/[a-z-]+\([^)]*\)/i) ?? [''])[0];
            // Lengths only: strip the colour function first so its numbers are not read.
            const lengths = Array.from(part.replace(/[a-z-]+\([^)]*\)/gi, ' ').matchAll(/(-?\d*\.?\d+)px/g)).map((m) => Number(m[1]));
            return { inset: /\binset\b/.test(part), spread: lengths[3] ?? 0, colour };
          });
    const outside = layers.filter((l) => !l.inset && l.spread > 0).map((l) => l.spread).sort((a, b) => a - b);
    const outward = outside.length ? outside[outside.length - 1] : 0;
    const halo = outside.length >= 2 ? outside[0] : 0;

    const rect = el.getBoundingClientRect();
    const box = { left: round(rect.left), top: round(rect.top), right: round(rect.right), bottom: round(rect.bottom) };

    // The ink: every painted text node (a Range gives its glyph run, not the element box) and every
    // svg or img. Screen-reader-only text is a clipped 1px box and paints nothing, so it is skipped.
    const inkRects: DOMRect[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!(node.textContent ?? '').trim()) continue;
      const parent = node.parentElement;
      if (!parent) continue;
      const ps = getComputedStyle(parent);
      if (ps.visibility === 'hidden' || ps.display === 'none') continue;
      if (ps.position === 'absolute' && parent.getBoundingClientRect().width <= 1) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) if (r.width > 0 && r.height > 0) inkRects.push(r);
    }
    for (const graphic of Array.from(el.querySelectorAll('svg, img'))) {
      const r = graphic.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) inkRects.push(r);
    }
    const ink = inkRects.length
      ? {
          left: round(Math.min(...inkRects.map((r) => r.left))),
          top: round(Math.min(...inkRects.map((r) => r.top))),
          right: round(Math.max(...inkRects.map((r) => r.right))),
          bottom: round(Math.max(...inkRects.map((r) => r.bottom))),
        }
      : null;
    const inkToBox = ink
      ? {
          left: round(ink.left - box.left),
          top: round(ink.top - box.top),
          right: round(box.right - ink.right),
          bottom: round(box.bottom - ink.bottom),
        }
      : null;
    const inkToRing = inkToBox
      ? {
          left: round(inkToBox.left + halo),
          top: round(inkToBox.top + halo),
          right: round(inkToBox.right + halo),
          bottom: round(inkToBox.bottom + halo),
        }
      : null;

    // Is the ring cut off? An ancestor whose overflow is not visible clips paint at its padding box.
    const ring = { left: rect.left - outward, top: rect.top - outward, right: rect.right + outward, bottom: rect.bottom + outward };
    let clippedBy: { by: string; over: { left: number; top: number; right: number; bottom: number } } | null = null;
    for (let up = el.parentElement; up && up !== document.body && !clippedBy; up = up.parentElement) {
      const us = getComputedStyle(up);
      const clipsX = us.overflowX !== 'visible';
      const clipsY = us.overflowY !== 'visible';
      if (!clipsX && !clipsY) continue;
      const ur = up.getBoundingClientRect();
      const pad = {
        left: ur.left + parseFloat(us.borderLeftWidth),
        top: ur.top + parseFloat(us.borderTopWidth),
        right: ur.right - parseFloat(us.borderRightWidth),
        bottom: ur.bottom - parseFloat(us.borderBottomWidth),
      };
      const over = {
        left: clipsX ? round(Math.max(0, pad.left - ring.left)) : 0,
        top: clipsY ? round(Math.max(0, pad.top - ring.top)) : 0,
        right: clipsX ? round(Math.max(0, ring.right - pad.right)) : 0,
        bottom: clipsY ? round(Math.max(0, ring.bottom - pad.bottom)) : 0,
      };
      if (over.left > 0.5 || over.top > 0.5 || over.right > 0.5 || over.bottom > 0.5) {
        clippedBy = { by: `${up.tagName.toLowerCase()}${up.id ? `#${up.id}` : ''}`, over };
      }
    }
    if (!clippedBy) {
      const over = {
        left: round(Math.max(0, -ring.left)),
        top: 0,
        right: round(Math.max(0, ring.right - document.documentElement.clientWidth)),
        bottom: 0,
      };
      if (over.left > 0.5 || over.right > 0.5) clippedBy = { by: 'the screen edge', over };
    }

    // A tab: the first ancestor that draws a bottom border is the strip; its line starts at the
    // bottom of its padding box.
    let pastStripLine: number | null = null;
    if (el.hasAttribute('aria-current') || el.parentElement?.querySelector('[aria-current]')) {
      for (let up = el.parentElement; up && up !== document.body; up = up.parentElement) {
        const us = getComputedStyle(up);
        const line = parseFloat(us.borderBottomWidth);
        if (line > 0) {
          pastStripLine = round(ring.bottom - (up.getBoundingClientRect().bottom - line));
          break;
        }
      }
    }

    const named = el.getAttribute('aria-label') ?? (el.tagName === 'SELECT' ? '' : (el.textContent ?? '').trim());
    const label = `${el.tagName.toLowerCase()}${el.id ? `#${el.id}` : ''} "${named.replace(/\s+/g, ' ').slice(0, 40)}"`;

    return {
      label,
      focusVisible: el.matches(':focus-visible'),
      box,
      width: round(rect.width),
      height: round(rect.height),
      ink,
      inkToBox,
      inkToRing,
      borderRadius: cs.borderRadius,
      boxShadow: cs.boxShadow,
      layers: layers.filter((l) => l.spread > 0),
      outward,
      halo,
      clippedBy,
      pastStripLine,
    };
  });
}

interface Context {
  page: Page;
  testInfo: TestInfo;
  theme: 'dark' | 'light';
  records: RingRecord[];
}

// Focus one control by keyboard, record it, and hold it to the house ring rule when it paints an
// offset ring. `mustBeHouse` names the controls this spec was written about: for those, painting
// no offset ring at all is itself a failure, so the test cannot pass by measuring nothing.
async function measure(ctx: Context, control: Locator, what: string, mustBeHouse: boolean): Promise<void> {
  const { page, testInfo, theme, records } = ctx;
  await focusByKeyboard(page, control);
  await settleAnimations(control);
  const read = await readRing(control);
  const where = `${what} (${theme}, ${testInfo.project.name})`;

  const houseRing = read.halo > 0;
  let haloColour: string | null = null;
  let surface: string | null = null;
  let haloRatio: number | null = null;
  if (houseRing) {
    const m = await focusRingMeasurement(page, control, where);
    const h = await haloGroundRatio(m, control);
    haloColour = h.halo;
    surface = h.behind;
    haloRatio = Math.round(h.ratio * 1000) / 1000;
  }
  const record: RingRecord = {
    ...read,
    label: `${what}: ${read.label}`,
    project: testInfo.project.name,
    theme,
    viewport: page.viewportSize()?.width ?? 0,
    houseRing,
    haloColour,
    surface,
    haloRatio,
  };
  records.push(record);

  expect.soft(read.focusVisible, `${where}: the control never matched :focus-visible`).toBe(true);
  if (mustBeHouse) {
    expect.soft(houseRing, `${where}: no offset ring is painted (box-shadow: ${read.boxShadow})`).toBe(true);
  }
  if (!houseRing) return;
  expect.soft(read.outward, `${where}: the ring reaches ${read.outward}px outside the control, the house ring ${RING_SPREAD}px`).toBe(RING_SPREAD);
  expect.soft(read.halo, `${where}: the halo band is ${read.halo}px, the house ring ${HALO_SPREAD}px`).toBe(HALO_SPREAD);
  expect
    .soft(
      haloRatio,
      `${where}: the halo ${haloColour} measured ${haloRatio}:1 against the surface under the control ${surface}; ` +
        `the house ring's halo must equal the surface (at most ${HALO_EQUAL}:1)`,
    )
    .toBeLessThanOrEqual(HALO_EQUAL);
  expect
    .soft(
      read.clippedBy,
      `${where}: the ring is cut off by ${read.clippedBy?.by} (per side: ${JSON.stringify(read.clippedBy?.over)})`,
    )
    .toBeNull();
}

// The numbers leave the run two ways: the attachment (kept with the test's output) and one line
// per control in the job log, which is where a green run's numbers can be read from.
async function publish(testInfo: TestInfo, records: RingRecord[]): Promise<void> {
  expect(records.length, 'no control was measured, so there is nothing to record').toBeGreaterThan(0);
  const file = testInfo.outputPath('ring-geometry.json');
  await writeFile(file, JSON.stringify(records, null, 1));
  await testInfo.attach('ring-geometry', { path: file, contentType: 'application/json' });
  for (const r of records) {
    const line = {
      project: r.project,
      theme: r.theme,
      viewport: r.viewport,
      what: r.label,
      size: [r.width, r.height],
      radius: r.borderRadius,
      ring: r.outward,
      halo: r.halo,
      haloRatio: r.haloRatio,
      inkToBox: r.inkToBox,
      inkToRing: r.inkToRing,
      pastStripLine: r.pastStripLine,
      clippedBy: r.clippedBy,
    };
    // eslint-disable-next-line no-console -- the measured ring numbers are this spec's product; plan 88.9-66's table reads them out of the CI log
    console.log(`[88.9-66 X61 ring] ${JSON.stringify(line)}`);
  }
}

const isFriendshipList = (url: URL, key: 'status' | 'direction', value: string) =>
  url.pathname.endsWith('/friendships') && url.searchParams.get(key) === value;

// One made-up friend and one made-up request, answered in the browser.
async function answerFriendsLists(page: Page) {
  await page.route(
    (url) => isFriendshipList(url, 'status', 'accepted') || isFriendshipList(url, 'direction', 'received'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const received = new URL(route.request().url()).searchParams.get('direction') === 'received';
      await route.fulfill({ status: 200, json: received ? [RING_REQUEST] : [RING_FRIEND] });
    },
  );
}

function brandLink(page: Page): Locator {
  // The logo's own label joins the link's accessible name, so the name is matched by a pattern.
  return page.getByRole('navigation', { name: 'Main', exact: true }).getByRole('link', { name: /Next Game Night/ });
}

async function openInTheme(page: Page, path: string, theme: 'dark' | 'light') {
  if (theme === 'light') await forceLightMode(page);
  await page.goto(path);
  await assertTheme(page, theme);
}

const THEMES = ['dark', 'light'] as const;

test.describe('focus ring geometry, measured (plan 88.9-66, X61)', () => {
  let hold: WriteHold | undefined;
  test.beforeEach(async ({ page }) => {
    hold = await holdWrites(page);
  });
  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('X61 (88.9): Friends — the header logo, the Requests tab, Search and every visible control record their ring against their ink', async ({
    page,
  }, testInfo) => {
    const records: RingRecord[] = [];
    await answerFriendsLists(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/friends', theme);
      const email = page.getByLabel("Friend's email address");
      await expect(email, `X61 (${theme}): the Add Friend card never rendered`).toBeVisible({ timeout: 15_000 });
      const friendRow = page.locator(`[data-friend-row="${RING_FRIEND.id}"]`);
      await expect(friendRow, `X61 (${theme}): the friend row never rendered`).toBeVisible({ timeout: 15_000 });

      // Search is natively disabled while the field is empty; an address in the field enables it.
      // Nothing is submitted.
      await email.fill('ring@nextgamenighte2e.invalid');
      // The friend's checkbox is natively disabled until a group is chosen. Choosing one sends one
      // read. A signed-in person who administers no group has no select; the row controls are
      // still measured.
      const groupSelect = page.getByRole('combobox', { name: /invite to group/i });
      if ((await groupSelect.count()) > 0) {
        const membersLoaded = page.waitForResponse(
          (response) => /\/groups\/[^/]+\/users/.test(response.url()) && response.request().method() === 'GET',
        );
        await groupSelect.selectOption({ index: 1 });
        await membersLoaded;
      }

      await measure(ctx, brandLink(page), 'the header logo', true);
      await measure(ctx, page.getByRole('button', { name: /^Requests(\s*\d+)?$/ }), 'the Requests tab', true);
      await measure(ctx, page.getByRole('button', { name: 'Search', exact: true }), 'Search', true);

      // Every other visible, enabled control in the page body, in document order.
      const controls = page.locator('main').locator('a[href], button, input, select, textarea, [role="button"], [tabindex="0"]');
      const total = await controls.count();
      let measured = 0;
      for (let i = 0; i < total; i += 1) {
        const control = controls.nth(i);
        if (!(await control.isVisible())) continue;
        // Natively disabled controls cannot take focus. A control gated with aria-disabled can, and is measured.
        if (await control.evaluate((el) => (el as HTMLButtonElement).disabled === true)) continue;
        const name = (await control.getAttribute('aria-label')) ?? (await control.innerText().catch(() => ''));
        if (/^Search$|^Requests(\s*\d+)?$/.test(name.trim())) continue;
        await measure(ctx, control, 'Friends control', false);
        measured += 1;
      }
      expect(measured, `X61 (${theme}): only ${measured} other Friends controls were measured`).toBeGreaterThanOrEqual(4);

      // The request row's controls sit on the Requests tab. Opening a tab writes nothing.
      await page.getByRole('button', { name: /^Requests(\s*\d+)?$/ }).click();
      const requestRow = page.locator(`[data-request-row="${RING_REQUEST.id}"]`);
      await expect(requestRow, `X61 (${theme}): the request row never rendered`).toBeVisible({ timeout: 15_000 });
      await measure(ctx, requestRow.getByRole('button', { name: 'Accept', exact: true }), 'Accept on its row', true);
      await measure(ctx, requestRow.getByRole('button', { name: 'Decline', exact: true }), 'Decline on its row', true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9): the shared Retry records its ring against its ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await answerFriendsLists(page);
    // The groups read feeds only the Invite to Group bar. Failing it shows the small notice with
    // the shared Retry above an intact friends list (the captured frame's state), with no write.
    await page.route(
      (url) => /\/groups\/user\/[^/]+$/.test(url.pathname),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 500, json: {} });
      },
    );

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/friends', theme);
      const retry = page.locator('main').getByRole('button', { name: 'Retry', exact: true });
      await expect(retry, `X61 (${theme}): the small notice with Retry never rendered`).toBeVisible({ timeout: 30_000 });
      await expect(retry).toHaveCount(1);
      await measure(ctx, retry, 'the shared Retry', true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9): Home — the group card title records its ring against its name', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/', theme);
      const cards = page.getByTestId('group-card');
      await expect(cards.first(), `X61 (${theme}): no group card rendered`).toBeVisible({ timeout: 15_000 });
      const fixtureCard = cards.filter({ has: page.getByText('Weekend Warriors', { exact: true }) }).filter({ visible: true });
      await expect(fixtureCard).toHaveCount(1);
      // The title is a button named by the group name alone.
      const title = fixtureCard.getByRole('button', { name: 'Weekend Warriors', exact: true });
      await expect(title).toHaveCount(1);
      await measure(ctx, title, 'the group card title', true);
    }
    await publish(testInfo, records);
  });
});
