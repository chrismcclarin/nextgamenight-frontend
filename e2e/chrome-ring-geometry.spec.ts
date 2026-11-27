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
// THE DESKTOP ICONS (owner pick DT-2 = 44, 2026-11-23; SPEC A9 item 3, O-M4 Fixed+). The header
// bell and the Theme toggle hold a 44 x 44 box at every text size and their icons follow the text to
// 32px; the bell's count badge follows the same cap. Their sizes are inline min() and calc() values
// that jsdom cannot read, so the two tests at the end of this file are their only computed check.
//
// Selectors are role and name only, never Tailwind classes. Messages carry numbers only.
import { test, expect, type Locator, type Page } from '@playwright/test';

import { expectNoApiWrites } from './support/inFlight';
import { expectRingWhole } from './support/largeTextSurfaces/home';
import { sweepWriteGuard, type SweepHold } from './support/largeTextSurfaces/index';
import { answerPendingInvites, pendingInvite } from './support/pendingInvite';
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

// The desktop list is the header nav's first list; the bell is its Notifications button and the
// Theme toggle is the button of its last item (the phone menu's row copies are in another list).
const desktopList = (page: Page): Locator => page.getByRole('navigation', { name: 'Main' }).locator('ul').first();
const desktopBell = (page: Page): Locator => desktopList(page).getByRole('button', { name: 'Notifications', exact: true });
const desktopTheme = (page: Page): Locator => desktopList(page).locator('li').last().getByRole('button');

interface IconBox {
  box: Box;
  svg: Box;
}

const iconBox = (control: Locator): Promise<IconBox> =>
  control.evaluate((element) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    return { box: rect(element), svg: rect(element.querySelector('svg') as SVGElement) };
  });

/** What is wrong with one desktop icon control: its box is not 44 x 44, or its icon is not the size named. */
function iconProblems(read: IconBox, icon: number, label: string): string[] {
  const problems: string[] = [];
  if (Math.abs(read.box.width - 44) > PX || Math.abs(read.box.height - 44) > PX) problems.push(`${label}: the box is ${read.box.width} x ${read.box.height}, not 44 x 44`);
  if (Math.abs(read.svg.width - icon) > PX || Math.abs(read.svg.height - icon) > PX) problems.push(`${label}: the icon is ${read.svg.width} x ${read.svg.height}, not ${icon}`);
  return problems;
}

test('O-M4 + DT-2 (89.6-43): the desktop bell and Theme hold 44px', async ({ page }) => {
  await openSignedIn(page, '/about', 1280, 800);
  const bell = desktopBell(page);
  const theme = desktopTheme(page);
  await expect(bell, 'the desktop bell is not drawn at 1280 x 800 with 100% text').toBeVisible({ timeout: 15_000 });
  await expect(theme, 'the desktop Theme toggle is not drawn at 1280 x 800 with 100% text').toBeVisible();
  const problems: string[] = [];

  // 100% text: the as-built 24px and 20px icons in 44px boxes, and the header strip still 64px tall.
  problems.push(...iconProblems(await iconBox(bell), 24, 'bell, 1280 x 800, 100% text'));
  problems.push(...iconProblems(await iconBox(theme), 20, 'Theme, 1280 x 800, 100% text'));
  const strip = await page.getByRole('navigation', { name: 'Main' }).evaluate((nav) => (nav.parentElement as HTMLElement).getBoundingClientRect().height);
  if (Math.abs(strip - 64) > PX) problems.push(`1280 x 800, 100% text: the header strip is ${strip}px tall, not 64`);

  // 200% text: the boxes hold, the icons stop at 32px. The desktop list is drawn from 1280 wide.
  await setTextMode(page, '200', 'desktop icons 1280 x 800');
  for (const [width, height] of [[1280, 800], [1400, 900]] as const) {
    await page.setViewportSize({ width, height });
    await expect(bell, `the desktop bell is not drawn at ${width} x ${height} with 200% text`).toBeVisible();
    problems.push(...iconProblems(await iconBox(bell), 32, `bell, ${width} x ${height}, 200% text`));
    problems.push(...iconProblems(await iconBox(theme), 32, `Theme, ${width} x ${height}, 200% text`));
  }

  expect(problems, `desktop icons: ${problems.length} read(s) outside O-M4 Fixed+ at 44px`).toEqual([]);
});

interface BadgeRead {
  /** The bell svg. */
  s: Box;
  /** The count badge. */
  b: Box;
  fontSize: number;
  /** The share of the bell svg's box the badge covers. */
  cover: number;
}

const badgeRead = (bell: Locator): Promise<BadgeRead> =>
  bell.evaluate((element) => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    const badge = element.querySelector('span[aria-hidden="true"]') as HTMLElement;
    const s = rect(element.querySelector('svg') as SVGElement);
    const b = rect(badge);
    const overlapX = Math.max(0, Math.min(s.x + s.width, b.x + b.width) - Math.max(s.x, b.x));
    const overlapY = Math.max(0, Math.min(s.y + s.height, b.y + b.height) - Math.max(s.y, b.y));
    return { s, b, fontSize: Number.parseFloat(getComputedStyle(badge).fontSize), cover: (overlapX * overlapY) / (s.width * s.height) };
  });

test("badge (89.6-43): the count badge follows the bell's cap and leaves the bell visible", async ({ page }, testInfo) => {
  // One pending invite, answered in the browser inside the write guard, so the badge reads 1.
  hold = await sweepWriteGuard(page, { answers: answerPendingInvites([pendingInvite('e2e-badge-cap-invite', 'E2E Badge Cap')]) });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/about');
  const bell = desktopBell(page);
  await expect(bell, 'the desktop bell is not drawn at 1280 x 800').toBeVisible({ timeout: 15_000 });
  const badge = bell.locator('span[aria-hidden="true"]');
  await expect(badge, 'the count badge is not drawn with one pending invite').toHaveText('1', { timeout: 15_000 });
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  const problems: string[] = [];

  // 100% text, the normal-text identity: 20 x 20, centred on the icon's top-right corner, a 12px digit.
  const normal = await badgeRead(bell);
  await testInfo.attach('badge-1280x800-100.json', { body: JSON.stringify(normal, null, 1), contentType: 'application/json' });
  if (Math.abs(normal.b.width - 20) > PX || Math.abs(normal.b.height - 20) > PX) problems.push(`100% text: the badge is ${normal.b.width} x ${normal.b.height}, not 20 x 20`);
  const dx = normal.b.x + normal.b.width / 2 - (normal.s.x + normal.s.width);
  const dy = normal.b.y + normal.b.height / 2 - normal.s.y;
  if (Math.abs(dx) > PX || Math.abs(dy) > PX) problems.push(`100% text: the badge centre is ${dx.toFixed(2)}px, ${dy.toFixed(2)}px off the icon's top-right corner`);
  if (Math.abs(normal.fontSize - 12) > PX) problems.push(`100% text: the digit is ${normal.fontSize}px, not 12`);

  // 200% text: 5/6 of the 32px icon, at most 35% of the bell covered, the centre in the bell's
  // top-right quadrant or outside it, a 16px digit.
  await setTextMode(page, '200', 'badge 1280 x 800');
  await expect(bell, 'the desktop bell is not drawn at 1280 x 800 with 200% text').toBeVisible();
  const large = await badgeRead(bell);
  await testInfo.attach('badge-1280x800-200.json', { body: JSON.stringify(large, null, 1), contentType: 'application/json' });
  const want = (32 * 5) / 6;
  if (Math.abs(large.b.width - want) > PX || Math.abs(large.b.height - want) > PX) problems.push(`200% text: the badge is ${large.b.width.toFixed(2)} x ${large.b.height.toFixed(2)}, not ${want.toFixed(1)} x ${want.toFixed(1)}`);
  if (large.cover > 0.35) problems.push(`200% text: the badge covers ${(large.cover * 100).toFixed(1)}% of the bell, over 35%`);
  const centreX = large.b.x + large.b.width / 2;
  const centreY = large.b.y + large.b.height / 2;
  if (centreX < large.s.x + large.s.width / 2 || centreY > large.s.y + large.s.height / 2) {
    problems.push(`200% text: the badge centre (${centreX.toFixed(1)}, ${centreY.toFixed(1)}) is not in the bell's top-right quadrant or outside it`);
  }
  if (Math.abs(large.fontSize - 16) > PX) problems.push(`200% text: the digit is ${large.fontSize}px, not 16`);

  expect(problems, `count badge: ${problems.length} read(s) outside the cap`).toEqual([]);
});
