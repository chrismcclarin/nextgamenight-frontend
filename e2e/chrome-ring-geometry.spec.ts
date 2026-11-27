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

/** The vertical offset of a control's text centre from its box centre, px (positive: the text sits low). */
const textCentreOffset = (control: Locator): Promise<number> =>
  control.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return text.top + text.height / 2 - (box.top + box.height / 2);
  });

const FOOTER_LINKS = ['About', 'Privacy', 'Terms'] as const;

/** One footer in one cell: G1 + G2 at every text control, Report bug centred, the BGG link on the house ring. */
async function footerProblems(page: Page, signedIn: boolean, at: string): Promise<string[]> {
  const footer = page.getByRole('contentinfo');
  const who = signedIn ? 'signed in' : 'signed out';
  const problems: string[] = [];
  for (const name of FOOTER_LINKS) {
    const link = footer.getByRole('link', { name, exact: true });
    await expect(link, `${name} (${who}, ${at}): no such footer link`).toBeVisible({ timeout: 15_000 });
    problems.push(...(await ringProblems(page, link, `${name} (${who}, ${at})`)));
  }
  // The BGG link wears the house ring: the reader throws on the browser's own outline.
  const bgg = footer.getByRole('link', { name: 'Powered by BoardGameGeek' });
  // The mark is the link's only ink: read it once the picture has loaded.
  await expect
    .poll(() => bgg.locator('img').evaluate((img) => (img as HTMLImageElement).complete && (img as HTMLImageElement).naturalWidth > 0), { timeout: 15_000, message: `BGG link (${who}, ${at}): the mark never loaded` })
    .toBe(true);
  try {
    const room = await readRingRoom(page, bgg, `BGG link (${who}, ${at})`);
    if (room.radius < MIN_RADIUS) problems.push(`BGG link (${who}, ${at}): G1 the ring corner is ${room.radius}px, under ${MIN_RADIUS}`);
  } catch (error) {
    problems.push(String(error instanceof Error ? error.message : error).split('\n')[0]);
  }
  if (!signedIn) return problems;
  const report = footer.getByRole('button', { name: /^Report bug/ });
  await expect(report, `Report bug (${at}): no such footer button`).toBeVisible({ timeout: 15_000 });
  problems.push(...(await ringProblems(page, report, `Report bug (${at})`)));
  const offset = await textCentreOffset(report);
  if (Math.abs(offset) > 1) problems.push(`Report bug (${at}): its text centre is ${offset.toFixed(2)}px off its box centre, over 1`);
  return problems;
}

test('G1 + G2 (89.6-43): the footer controls', async ({ page, browser, baseURL }) => {
  await openSignedIn(page, '/about', 375, 667);
  const problems: string[] = [];
  problems.push(...(await footerProblems(page, true, '375 x 667, 100% text')));
  await page.setViewportSize({ width: 320, height: 568 });
  await setTextMode(page, '200', 'footer 320 x 568');
  problems.push(...(await footerProblems(page, true, '320 x 568, 200% text')));

  // Signed out: the public footer (the same three links and the BGG link, no Report bug). A page
  // with no session sends no API write; the guard goes on it all the same.
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, baseURL, viewport: { width: 375, height: 667 }, colorScheme: 'dark' });
  try {
    const anon = await context.newPage();
    const anonHold = await sweepWriteGuard(anon, {});
    await anon.goto('/about');
    await anon.evaluate(() => document.fonts.ready.then(() => undefined));
    problems.push(...(await footerProblems(anon, false, '375 x 667, 100% text')));
    await anon.setViewportSize({ width: 320, height: 568 });
    await setTextMode(anon, '200', 'public footer 320 x 568');
    problems.push(...(await footerProblems(anon, false, '320 x 568, 200% text')));
    expectNoApiWrites(anonHold);
    expect(anonHold.writeGets, 'signed out: a GET that writes was held with no answer').toEqual([]);
  } finally {
    await context.close();
  }

  expect(problems, `footer G1 + G2: ${problems.length} read(s) outside the rule`).toEqual([]);
});

// The staged failures of e2e/error-recovery-floor.spec.ts ("const IDENTITY_GET ="), answered in the
// browser: the identity read (the compact notice on Home) and the schedules list (the full banner on
// /userProfile). A spec file cannot import another, so the two patterns are repeated here.
const IDENTITY_GET = /\/users\/[^/?]*%7C[^/?]*(\?|$)/i;
const PATTERNS_GET = /\/availability\/user\/[^/]+\/patterns/;

test("G1 + G2 (89.6-43): the error banner's controls", async ({ page }) => {
  hold = await sweepWriteGuard(page, {});
  // Registered after the guard, so they answer first. GET only; anything else goes back to the hold.
  let failIdentity = true;
  await page.route(IDENTITY_GET, async (route) => {
    if (route.request().method() !== 'GET' || !failIdentity) {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
  });
  await page.route(PATTERNS_GET, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
  });
  const problems: string[] = [];
  const read = async (control: Locator, label: string) => {
    problems.push(...(await ringProblems(page, control, label)));
    await expectRingWhole(page, control, label);
  };

  // The compact notice's Retry, on Home (at phone width the one drawn copy is the group list's).
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/');
  const retry = page.getByRole('button', { name: /^Retry( ?, retrying)?$/ });
  await expect(retry, 'the compact notice never rendered on Home').toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await read(retry, 'compact Retry, 375 x 667, 100% text');
  await page.setViewportSize({ width: 320, height: 568 });
  await setTextMode(page, '200', 'compact Retry 320 x 568');
  await read(retry, 'compact Retry, 320 x 568, 200% text');

  // The full banner on /userProfile: Try again, then Report this once a retry has failed too (the
  // retry is a GET, answered 500 in the browser like the first read).
  failIdentity = false;
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('/userProfile');
  const tryAgain = page.getByRole('button', { name: /^Try again( ?, retrying)?$/ });
  await expect(tryAgain, 'the full banner never rendered on /userProfile').toHaveCount(1, { timeout: 15_000 });
  const report = page.getByRole('button', { name: 'Report this' });
  await tryAgain.focus();
  await page.keyboard.press('Enter');
  await expect(report, 'Report this did not appear after a failed Try again').toHaveCount(1, { timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Try again' })).toHaveCount(1, { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await read(tryAgain, 'Try again, 375 x 667, 100% text');
  await read(report, 'Report this, 375 x 667, 100% text');
  await page.setViewportSize({ width: 320, height: 568 });
  await setTextMode(page, '200', 'full banner 320 x 568');
  await read(tryAgain, 'Try again, 320 x 568, 200% text');
  await read(report, 'Report this, 320 x 568, 200% text');

  expect(problems, `banner G1 + G2: ${problems.length} read(s) outside the rule`).toEqual([]);
});
