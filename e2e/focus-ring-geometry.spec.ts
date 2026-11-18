import { writeFile } from 'node:fs/promises';

import { test, expect, type Locator, type Page, type Route, type TestInfo } from '@playwright/test';

import { assertTheme, focusByKeyboard, focusRingMeasurement, forceLightMode, haloGroundRatio } from './support/contrast';
import { E2E_FAKE_GAME_ID, E2E_GAME_PATH, routeFakeGameSuccess } from './support/fakeGame';
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
// AMENDED Phase 88.9-52 (A-03): ONE more assertion, for every measured control, house ring or not:
// SOME focus indicator is painted — a box-shadow layer with a spread, or an outline with a width,
// in a colour that is not fully transparent (paintsIndicator below). Whether a focused control
// shows anything at all is WCAG 2.4.7, not a look. An ordinary drop shadow has no spread and does
// not count; the transparent 2px outline that the outline-hidden utility leaves for forced-colours
// mode does not count either. The Friends test proves the check can fail: it strips the indicator
// from one control with an injected style and reads the check as false.
//
// NOTHING IS WRITTEN. Writes are held in the browser (support/inFlight.ts); the friend and request
// rows are made-up rows answered in the browser; no test presses a control that writes. Selecting
// a group in the Invite to Group select sends one read. Focus is given by keyboard modality plus a
// programmatic focus, which presses nothing.
//
// CI ONLY: both projects need the signed-in storage state, which does not exist locally.
//
// Phase 88.9 plan 69 (X61 beyond Friends) adds four surfaces the same remarks named, on the same
// helpers and under the same rule (recorded, and only the house ring asserted): the Home small
// notice's Retry, the event view's group breadcrumb link and its Retry, a name in the RSVP list of
// the game page's upcoming event card and the Plan Game Session Retry (a fifth, the group page's
// Loading group gate Retry, left with that notice in 88.9-52 P1: the page shows its full banner). Each small notice is staged by answering the self-identity read with a 500 in the
// browser (the state the captured frames were in); the game page's upcoming night and its two
// replies are made up and answered in the browser. Nothing is written and no control is pressed.

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
  /** The outline as computed: its style, its width in px and its colour (A-03). */
  outlineStyle: string;
  outlineWidth: number;
  outlineColour: string;
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
      outlineStyle: cs.outlineStyle,
      outlineWidth: parseFloat(cs.outlineWidth) || 0,
      outlineColour: cs.outlineColor,
      layers: layers.filter((l) => l.spread > 0),
      outward,
      halo,
      clippedBy,
      pastStripLine,
    };
  });
}

// A colour that paints nothing: the keyword, a zero FOURTH value in the comma form
// (rgba(0, 0, 0, 0); never the three-value rgb(0, 0, 0), which is opaque black) or a zero alpha in
// the slash form (oklch(0.5 0.1 20 / 0), color(srgb 0 0 0 / 0)).
function isTransparent(colour: string): boolean {
  const c = colour.trim().toLowerCase();
  return c === 'transparent' || /^rgba\([^,]+,[^,]+,[^,]+,\s*0(\.0+)?\s*\)$/.test(c) || /\/\s*0(\.0+)?%?\s*\)$/.test(c);
}

// A-03: does the focused control paint ANY focus indicator? A box-shadow layer with a spread (the
// layers readRing keeps, inset or not) or an outline with a width, in a colour that shows. A layer
// whose colour could not be read is taken as showing.
function paintsIndicator(read: RingRead): boolean {
  const shadow = read.layers.some((layer) => !isTransparent(layer.colour));
  const outline = read.outlineStyle !== 'none' && read.outlineWidth > 0 && !isTransparent(read.outlineColour);
  return shadow || outline;
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
  expect
    .soft(
      paintsIndicator(read),
      `${where}: no focus indicator is painted (box-shadow: ${read.boxShadow}; outline: ${read.outlineWidth}px ${read.outlineStyle} ${read.outlineColour})`,
    )
    .toBe(true);
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

// ---- Plan 88.9-69: the four surfaces outside Friends ----

// Seeded fixtures minted by the backend's scripts/e2e-fixtures.js in CI (the padding-budget idiom).
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '1';
const E2E_EVENT_DETAIL_PATH = process.env.E2E_EVENT_DETAIL_PATH ?? `/gameDetail?event_id=1&group_id=${E2E_GROUP_ID}`;
const GROUP_EVENTS_PATH = new RegExp(`^/api/events/group/${E2E_GROUP_ID}$`);

// The self-identity read: GET /api/users/<one segment> (the read e2e/support/viewerRsvp.ts passes through).
const isIdentityRead = (url: URL) => /\/api\/users\/[^/]+$/.test(url.pathname);

// A made-up upcoming night of the fake custom game, with two made-up replies. Every id is synthetic.
const RING_NIGHT_ID = '0e2e0000-0000-4000-8000-000000000069';
const RING_REPLY_NAME = 'E2E Ring Reply';
const RING_REPLIES = {
  rsvps: [
    {
      id: '0e2e0000-0000-4000-8000-0000000069c1',
      status: 'yes',
      note: null,
      user_id: '0e2e0000-0000-4000-8000-0000000069d1',
      User: { id: '0e2e0000-0000-4000-8000-0000000069d1', username: RING_REPLY_NAME },
    },
    {
      id: '0e2e0000-0000-4000-8000-0000000069c2',
      status: 'maybe',
      note: null,
      user_id: '0e2e0000-0000-4000-8000-0000000069d2',
      User: { id: '0e2e0000-0000-4000-8000-0000000069d2', username: 'E2E Ring Maybe' },
    },
  ],
  summary: { yes: 1, maybe: 1, no: 0 },
};
const DAY_MS = 24 * 60 * 60 * 1000;

// An answer made up in the browser names the asking origin, so it is readable whether the page
// reaches the API on its own origin or on the backend's.
function allowOrigin(route: Route): Record<string, string> {
  const origin = route.request().headers()['origin'];
  return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' } : {};
}

// Answers the self-identity read with a 500 while `failing()` holds; every other request, and every
// request once it stops holding, falls back unchanged. With no identity a page shows the shared
// small notice ("Some personal controls are unavailable.") with its Retry. No write follows.
async function failIdentityRead(page: Page, failing: () => boolean = () => true): Promise<void> {
  await page.route(isIdentityRead, async (route) => {
    if (route.request().method() !== 'GET' || !failing()) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'e2e forced failure (88.9-69 X61)' }, headers: allowOrigin(route) });
  });
}

// Measures every visible small-notice Retry on the page. A page can mount the notice more than
// once at a width (Home at 1280: the Your Groups panel and the desktop column beside it), so each
// one is measured and the caller is told whether it sat inside the Your Groups panel, which is the
// one ancestor carrying the phone-flat surface class.
async function measureVisibleRetries(ctx: Context, surface: string, nameMount?: (inGroupsPanel: boolean) => string): Promise<boolean[]> {
  const { page, theme } = ctx;
  const retries = page.getByRole('button', { name: 'Retry', exact: true }).filter({ visible: true });
  await expect(retries.first(), `X61 (${theme}): ${surface}: the small notice with Retry never rendered`).toBeVisible({ timeout: 30_000 });
  const total = await retries.count();
  const mounts: boolean[] = [];
  for (let i = 0; i < total; i += 1) {
    const retry = retries.nth(i);
    const inGroupsPanel = await retry.evaluate((el) => el.closest('[class*="surface-flat-phone"]') !== null);
    mounts.push(inGroupsPanel);
    const mount = nameMount ? `, ${nameMount(inGroupsPanel)}` : total > 1 ? `, ${i + 1} of ${total}` : '';
    await measure(ctx, retry, `${surface}: the Retry${mount}`, true);
  }
  return mounts;
}

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
      // AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred): the Friends tabs paint their ring
      // INSIDE the tab, so the Requests tab is no longer held to the offset house ring here (it was
      // measured with mustBeHouse true). It is still recorded and still must paint an indicator;
      // what R11 ruled is asserted just below. The marker is at
      // src/app/friends/page.js ("AMENDED Phase 88.9-52 (R11, owner 2026-11-17: Centred").
      const requestsTab = page.getByRole('button', { name: /^Requests(\s*\d+)?$/ });
      await measure(ctx, requestsTab, 'the Requests tab', false);
      // Still focused: measure() leaves the focus where it put it.
      const tabRing = await readRing(requestsTab);
      const tabWhere = `the Requests tab (${theme}, ${testInfo.project.name})`;
      expect
        .soft(
          tabRing.layers.some((layer) => layer.inset && layer.spread === 2 && !isTransparent(layer.colour)),
          `${tabWhere}: no 2px inset ring is painted (box-shadow: ${tabRing.boxShadow})`,
        )
        .toBe(true);
      expect.soft(tabRing.outward, `${tabWhere}: the ring reaches ${tabRing.outward}px outside the tab; R11 puts it inside`).toBe(0);
      expect
        .soft(tabRing.pastStripLine, `${tabWhere}: the ring crosses the strip line by ${tabRing.pastStripLine}px`)
        .toBeLessThanOrEqual(0.5);
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
      const decline = requestRow.getByRole('button', { name: 'Decline', exact: true });
      await measure(ctx, decline, 'Decline on its row', true);

      // A-03 control: the "some indicator is painted" check can fail. With the ring and the outline
      // stripped from this one focused control by an injected style, the check reads false; with the
      // style removed it reads true again. Nothing is pressed.
      const stripped = await page.addStyleTag({
        content: `[data-request-row="${RING_REQUEST.id}"] button:focus-visible { box-shadow: none !important; outline: none !important; }`,
      });
      await focusByKeyboard(page, decline);
      await settleAnimations(decline);
      expect(paintsIndicator(await readRing(decline)), `X61 (${theme}): the indicator check still passed on a control with no ring and no outline`).toBe(false);
      await stripped.evaluate((el) => el.parentNode?.removeChild(el));
      await settleAnimations(decline);
      expect(paintsIndicator(await readRing(decline)), `X61 (${theme}): the indicator check did not recover once the injected style left`).toBe(true);
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

  test('X61 (88.9-69): Home — the Your Groups Retry records its ring against its ink', async ({ page, isMobile }, testInfo) => {
    const records: RingRecord[] = [];
    await failIdentityRead(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, '/', theme);
      const mounts = await measureVisibleRetries(ctx, 'Home', (inGroupsPanel) =>
        inGroupsPanel ? 'the Your Groups notice' : 'the desktop column notice',
      );
      if (isMobile) {
        // At 375 the one visible notice is the Your Groups one; the desktop column is not shown.
        expect(mounts, `X61 (${theme}): Home at 375 shows one small notice, in Your Groups`).toEqual([true]);
      } else {
        // At 1280 the desktop column beside the calendar shows its own copy of the notice.
        expect(mounts, `X61 (${theme}): Home at 1280 never showed the desktop column notice`).toContain(false);
      }
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9-69): event view — the group breadcrumb and the Retry record their rings against their ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    // Two loads per theme. With no identity the page cannot tell the viewer is a member and shows
    // the group's name as plain text, not a link; so the breadcrumb link is read on a normal load
    // and the Retry on a load whose identity read fails.
    let failing = false;
    await failIdentityRead(page, () => failing);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      failing = false;
      await openInTheme(page, E2E_EVENT_DETAIL_PATH, theme);
      const crumb = page.getByRole('navigation', { name: 'Breadcrumb' }).locator('a[href^="/groupHomePage"]');
      await expect(crumb, `X61 (${theme}): the event view never rendered its group breadcrumb link`).toBeVisible({ timeout: 20_000 });
      await expect(crumb).toHaveCount(1);
      await measure(ctx, crumb, 'event view: the group breadcrumb link', true);

      failing = true;
      await openInTheme(page, E2E_EVENT_DETAIL_PATH, theme);
      await measureVisibleRetries(ctx, 'event view');
    }
    await publish(testInfo, records);
  });

  test("X61 (88.9-69): game page — a name in the upcoming event card's RSVP list records its ring against its ink", async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await routeFakeGameSuccess(page);
    // The group's events read answers one made-up night a week ahead, so the game page shows one
    // upcoming event card; its RSVP list read answers two made-up replies.
    await page.route('**/api/events/group/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && GROUP_EVENTS_PATH.test(new URL(request.url()).pathname)) {
        await route.fulfill({
          json: [
            {
              id: RING_NIGHT_ID,
              game_id: E2E_FAKE_GAME_ID,
              group_id: E2E_GROUP_ID,
              start_date: new Date(Date.now() + 7 * DAY_MS).toISOString(),
              duration_minutes: 90,
              status: 'scheduled',
              comments: 'E2E staged night (88.9-69 X61)',
              EventParticipations: [],
            },
          ],
          headers: allowOrigin(route),
        });
        return;
      }
      await route.fallback();
    });
    await page.route('**/api/rsvp/event/**', async (route) => {
      const request = route.request();
      if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith(`/rsvp/event/${RING_NIGHT_ID}`)) {
        await route.fulfill({ json: RING_REPLIES, headers: allowOrigin(route) });
        return;
      }
      await route.fallback();
    });

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, E2E_GAME_PATH, theme);
      // The name is a control (role button, named by the name alone) once the viewer's identity and
      // friendships have loaded; until then it is plain text, which this wait outlasts.
      const name = page.getByRole('main').getByRole('button', { name: RING_REPLY_NAME, exact: true });
      await expect(name, `X61 (${theme}): the staged reply's name never became a control in the upcoming event card`).toBeVisible({
        timeout: 30_000,
      });
      await expect(name).toHaveCount(1);
      await measure(ctx, name, "game page: a name in the upcoming event card's RSVP list", true);
    }
    await publish(testInfo, records);
  });

  test('X61 (88.9-69): Plan Game Session — the Retry records its ring against its ink', async ({ page }, testInfo) => {
    const records: RingRecord[] = [];
    await failIdentityRead(page);

    for (const theme of THEMES) {
      const ctx: Context = { page, testInfo, theme, records };
      await openInTheme(page, `/groupPlanning?group_id=${E2E_GROUP_ID}`, theme);
      await measureVisibleRetries(ctx, 'Plan Game Session');
    }
    await publish(testInfo, records);
  });
});
