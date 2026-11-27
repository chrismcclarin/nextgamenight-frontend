// The ring geometry of the app chrome (Phase 89.6-43; outline rule 10, owner pick O-1 B, 2026-11-22).
//
// WHAT. G1: a keyboard ring has rounded corners (at least 4px). G2: a standalone text control keeps
// at least 6px between its own ink and the ring on the left and the right (4px of padding, paid
// back by an equal negative margin so nothing moves, plus the ring's 2px offset). Read with the one
// shared reader, e2e/support/ringGeometry.ts ("export async function readRingRoom("), phone first:
// 375 x 667 at 100% text, then 320 x 568 at 200%, then the desktop list at 1280 x 800.
//
// READ-ONLY. The sweep's write guard (it registers holdWrites) goes on the page before the first
// navigation: e2e/support/largeTextSurfaces/index.ts ("export async function sweepWriteGuard").
// Every non-GET on every URL is held in the browser, the self read is sent on without its timezone
// parameter (the backend's time zone backfill cannot run) and a GET that writes is held and listed.
// Focusing a control sends nothing; no test presses a control that saves. The afterEach asserts no
// write reached the hold and never calls unrouteAll (turning interception off resumes the requests
// the hold is holding: the 88.9-03 leak).
//
// WHERE. Both projects, with no conditional skip: every test sets its own viewport, so the phone
// and journeys projects run it identically. Its rows in scripts/gate-c-floors.manifest.mjs exist so
// a green CI run prints one line per project naming this spec (CI prints nothing per passing test),
// and they move in the commit that adds a test. Signed in (the stored sign-in).
//
// Selectors are role and name only, never Tailwind classes. Messages carry numbers only.
import { test, expect, type Locator, type Page } from '@playwright/test';

import { expectNoApiWrites } from './support/inFlight';
import { expectRingWhole } from './support/largeTextSurfaces/home';
import { sweepWriteGuard, type SweepHold } from './support/largeTextSurfaces/index';
import { readRingRoom } from './support/ringGeometry';
import { setTextMode } from './support/wordLines';

// G1: the house corner (rounded-sm) is 4px. G2: 4px padding + the 2px offset = 6; 0.5px is subpixel slack.
const MIN_RADIUS = 4;
const MIN_SIDE_ROOM = 5.5;

const PX = 0.5;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

// The red run's own reads (CI run 45943313146, FE 2398bbb, its log line "89.6-43 before-read"):
// the brand link's border box and the site name's box at 375 x 667 with 100% text, before the fix.
const BRAND_BOX_375: Box = { x: 16, y: 14.5, width: 189.265625, height: 34 };
const NAME_BOX_375: Box = { x: 60, y: 17.5, width: 145.265625, height: 28 };

let hold: SweepHold | undefined;

test.afterEach(() => {
  expectNoApiWrites(hold);
  expect(hold?.writeGets ?? [], 'a GET that writes was held with no answer').toEqual([]);
  hold = undefined;
});

/** G1 + G2 for one control: what is wrong, as lines (empty when the ring is rounded and roomy). */
async function ringProblems(page: Page, control: Locator, label: string): Promise<string[]> {
  const room = await readRingRoom(page, control, label);
  const problems: string[] = [];
  if (room.radius < MIN_RADIUS) problems.push(`${label}: G1 the ring corner is ${room.radius}px, under ${MIN_RADIUS} (${room.summary})`);
  if (Math.min(room.inkToRing.left, room.inkToRing.right) < MIN_SIDE_ROOM) {
    problems.push(`${label}: G2 ink to ring is ${room.inkToRing.left.toFixed(2)}px left and ${room.inkToRing.right.toFixed(2)}px right, under 6 (${room.summary})`);
  }
  return problems;
}

const boxOf = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height };
  });

const boxText = (box: Box): string => `${box.x},${box.y},${box.width},${box.height}`;

async function openSignedIn(page: Page, path: string, width: number, height: number): Promise<void> {
  hold = await sweepWriteGuard(page, {});
  await page.setViewportSize({ width, height });
  await page.goto(path);
  // The session is known once the header draws its menu button (phone) or its list (desktop).
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Next Game Night' })).toBeVisible({ timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
}

test('G1 + G2 (89.6-43): the brand link and the desktop list links', async ({ page }) => {
  await openSignedIn(page, '/about', 375, 667);
  const nav = page.getByRole('navigation', { name: 'Main' });
  const brand = nav.getByRole('link', { name: 'Next Game Night' });
  await expect(page.getByRole('button', { name: 'Toggle menu', exact: true }), 'the session never became known at 375 wide').toBeVisible({ timeout: 15_000 });

  // Normal-text identity at 375 x 667: the site name sits exactly where it sat before the fix, and
  // the brand link's border box is the old one grown by the paid-back padding (4px a side), so its
  // margin box, and with it every neighbour, is unchanged.
  const brandNow = await boxOf(brand);
  const nameNow = await boxOf(brand.getByText('Next Game Night', { exact: true }));
  const off = (now: Box, was: Box): number =>
    Math.max(Math.abs(now.x - was.x), Math.abs(now.y - was.y), Math.abs(now.width - was.width), Math.abs(now.height - was.height));
  expect(off(nameNow, NAME_BOX_375), `375 x 667, 100% text: the site name moved (now ${boxText(nameNow)}, before ${boxText(NAME_BOX_375)})`).toBeLessThanOrEqual(PX);
  const grown: Box = { x: BRAND_BOX_375.x - 4, y: BRAND_BOX_375.y, width: BRAND_BOX_375.width + 8, height: BRAND_BOX_375.height };
  expect(off(brandNow, grown), `375 x 667, 100% text: the brand link is not its old box grown 4px a side (now ${boxText(brandNow)}, before ${boxText(BRAND_BOX_375)})`).toBeLessThanOrEqual(PX);

  const problems: string[] = [];
  problems.push(...(await ringProblems(page, brand, 'brand link, 375 x 667, 100% text')));
  await expectRingWhole(page, brand, 'brand link, 375 x 667, 100% text');

  await page.setViewportSize({ width: 320, height: 568 });
  await setTextMode(page, '200', 'brand link 320 x 568');
  problems.push(...(await ringProblems(page, brand, 'brand link, 320 x 568, 200% text')));
  await expectRingWhole(page, brand, 'brand link, 320 x 568, 200% text');

  // The desktop list is drawn from md at ordinary text.
  await setTextMode(page, '100', 'desktop list 1280 x 800');
  await page.setViewportSize({ width: 1280, height: 800 });
  const home = nav.getByRole('link', { name: 'Home', exact: true });
  await expect(home, 'the desktop list is not drawn at 1280 x 800 with 100% text').toBeVisible();
  problems.push(...(await ringProblems(page, home, 'Home list link, 1280 x 800, 100% text')));
  await expectRingWhole(page, home, 'Home list link, 1280 x 800, 100% text');

  expect(problems, `G1 + G2: ${problems.length} read(s) outside the rule`).toEqual([]);
});
