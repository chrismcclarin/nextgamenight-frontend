import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { test, expect, type Page } from '@playwright/test';

import { E2E_GROUP_ID } from './support/groupSettings';
import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';
import { expectLargeTextCell, expectPageZoomUsable, readLargeTextCell, readPageZoomCell, setTextMode, type PageZoomRead } from './support/wordLines';

// Phase 88.9 plan 66 (X64, X70a, X70b; owner 2026-11-14) — the screen a signed-out person lands on
// when they come back from sign-in without signing in, on the four pages that show it, measured
// in a real browser in BOTH projects (375 and 1280).
//
// THE DEFECTS. Plan Game Session showed the banner edge to edge with no side gutter (X64). Profile
// showed it at the top of the page column where the owner wants it centred (X70a). Friends showed
// an older "please log in" prompt instead of the shared banner (X70b). The group page had the
// centred column but a 24px gutter on a phone.
//
// THE RULE MEASURED HERE. All four pages put the banner in ONE frame (the element marked
// data-slot page-frame): 16px from each screen edge on a phone; at desktop width the frame is
// 576px wide with equal space on both sides; and at both widths it is centred top to bottom in
// the full-height column around it. Sign in is on screen and the page does not scroll sideways.
// AMENDED Phase 88.9-52 (A-04 / A-38): each of the four screens also carries exactly ONE level-1
// heading, the page's name, which only screen readers get (the frame's srHeading). It is read
// here by role, so a screen that loses it, or gains a second one, fails.
//
// HOW THE SCREEN IS REACHED. Signed out (an empty storage state), and the page's once-only
// redirect latch is set before any page script runs, so the page shows its banner instead of
// navigating to the sign-in provider. The latch key's prefix is read from the hook's source file
// (the module imports React, so it cannot be imported here); if the constant is ever renamed this
// file throws at load instead of silently testing a redirect.
//
// NOTHING IS WRITTEN: writes are held in the browser, and no control is pressed.

const HOOK_FILE = resolve(__dirname, '../src/lib/hooks/useSignInRedirect.ts');
const prefixMatch = readFileSync(HOOK_FILE, 'utf8').match(/const SIGN_IN_LATCH_PREFIX = '([^']+)';/);
if (!prefixMatch) {
  throw new Error('signed-out-banner-frame.spec.ts: SIGN_IN_LATCH_PREFIX was not found in src/lib/hooks/useSignInRedirect.ts');
}
const LATCH_PREFIX = prefixMatch[1];

test.use({ storageState: { cookies: [], origins: [] } });

interface FrameRead {
  frame: { left: number; right: number; top: number; bottom: number; width: number };
  parent: { top: number; bottom: number };
  clientWidth: number;
  scrollWidth: number;
  /** FL-07 (89.6-23): the tag of the frame's outer box's parent, main's box, and the page's height against the window's. */
  outerParent: string;
  main: { top: number; bottom: number };
  scrollHeight: number;
  innerHeight: number;
}

// Opens the page signed out with the latch already set, waits for the banner's Sign in, checks the
// screen's one level-1 heading, and reads the frame and the column around it in ONE evaluate.
async function readFrame(page: Page, path: string, heading: string): Promise<FrameRead> {
  await page.addInitScript((prefix) => {
    window.sessionStorage.setItem(prefix + window.location.pathname + window.location.search, '1');
  }, LATCH_PREFIX);
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'), { timeout: 15_000 });

  // 89.6-26 (W2): scoped to main; the header now has a Sign in link too.
  const signIn = page.getByRole('main').getByRole('link', { name: 'Sign in', exact: true });
  await expect(signIn, `${path}: the signed-out banner with Sign in never rendered`).toBeVisible({ timeout: 15_000 });
  const frame = page.locator('[data-slot="page-frame"]');
  await expect(frame, `${path}: the banner is not inside the shared centred frame`).toHaveCount(1);
  await expect(frame.getByRole('link', { name: 'Sign in', exact: true }), `${path}: Sign in is not inside the frame`).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 }), `${path}: the screen must carry exactly one level-1 heading`).toHaveCount(1);
  await expect(
    page.getByRole('heading', { level: 1, name: heading, exact: true }),
    `${path}: the level-1 heading is not "${heading}"`,
  ).toHaveCount(1);

  return frame.evaluate((el) => {
    const box = el.getBoundingClientRect();
    const parent = (el.parentElement as HTMLElement).getBoundingClientRect();
    const outer = el.parentElement as HTMLElement;
    const main = document.querySelector('main')?.getBoundingClientRect();
    return {
      frame: { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width },
      parent: { top: parent.top, bottom: parent.bottom },
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      outerParent: (outer.parentElement as HTMLElement).tagName.toLowerCase(),
      main: { top: main?.top ?? Number.NaN, bottom: main?.bottom ?? Number.NaN },
      scrollHeight: document.documentElement.scrollHeight,
      innerHeight: window.innerHeight,
    };
  });
}

function expectFrameGeometry(read: FrameRead, isMobile: boolean, what: string) {
  const leftGutter = read.frame.left;
  const rightGutter = read.clientWidth - read.frame.right;
  if (isMobile) {
    expect(read.clientWidth, `${what}: the phone project must be 375 wide`).toBe(375);
    expect(Math.abs(leftGutter - 16), `${what}: left gutter ${leftGutter}px, expected 16px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(rightGutter - 16), `${what}: right gutter ${rightGutter}px, expected 16px`).toBeLessThanOrEqual(0.5);
  } else {
    expect(Math.abs(read.frame.width - 576), `${what}: the frame is ${read.frame.width}px wide, expected 576px`).toBeLessThanOrEqual(0.5);
    expect(Math.abs(leftGutter - rightGutter), `${what}: gutters ${leftGutter}px and ${rightGutter}px are not equal`).toBeLessThanOrEqual(1);
  }
  const frameCentre = (read.frame.top + read.frame.bottom) / 2;
  const columnCentre = (read.parent.top + read.parent.bottom) / 2;
  expect(
    Math.abs(frameCentre - columnCentre),
    `${what}: the frame's centre is at ${frameCentre}px, the column's at ${columnCentre}px`,
  ).toBeLessThanOrEqual(1);
  expect(read.scrollWidth, `${what}: the page scrolls sideways: ${read.scrollWidth}px vs ${read.clientWidth}px`).toBeLessThanOrEqual(read.clientWidth);
  // FL-07 (89.6-23, owner pick DT-3 = Move): the frame fills what main leaves between the header and
  // the footer, so its outer box sits directly in main, the banner is centred in main, and a page
  // whose body is one banner does not scroll at normal text.
  expect(read.outerParent, `${what}: the frame's outer box sits in a ${read.outerParent}, not in main`).toBe('main');
  const mainCentre = (read.main.top + read.main.bottom) / 2;
  expect(
    Math.abs(frameCentre - mainCentre),
    `${what}: the frame's centre is at ${frameCentre}px, main's at ${mainCentre}px (between the header and the footer)`,
  ).toBeLessThanOrEqual(1);
  expect(
    read.scrollHeight - read.innerHeight,
    `${what}: the page scrolls: it is ${read.scrollHeight}px tall in a ${read.innerHeight}px window`,
  ).toBeLessThanOrEqual(1);
}

test.describe('the signed-out banner frame (plan 88.9-66: X64, X70)', () => {
  let hold: WriteHold | undefined;
  test.beforeEach(async ({ page }) => {
    hold = await holdWrites(page);
  });
  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('X64 (88.9): Plan Game Session signed out — the banner sits in the centred frame with its gutter', async ({ page, isMobile }) => {
    const read = await readFrame(page, `/groupPlanning?group_id=${E2E_GROUP_ID}`, 'Plan Game Session');
    expectFrameGeometry(read, isMobile, 'Plan Game Session');
  });

  test('X70a (88.9): Profile signed out — the banner sits in the centred frame with its gutter', async ({ page, isMobile }) => {
    const read = await readFrame(page, '/userProfile', 'Profile');
    expectFrameGeometry(read, isMobile, 'Profile');
  });

  test('X70b (88.9): Friends signed out shows the same centred banner with Sign in, never the older prompt', async ({ page, isMobile }) => {
    const read = await readFrame(page, '/friends', 'Friends');
    expectFrameGeometry(read, isMobile, 'Friends');
    await expect(page.getByText('Please log in to view your friends.')).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Log In', exact: true })).toHaveCount(0);
    await expect(page.getByText("Couldn't load your friends", { exact: true })).toBeVisible();
  });

  test('X64 / X70 (88.9): the group page signed out uses the same frame', async ({ page, isMobile }) => {
    const read = await readFrame(page, `/groupHomePage?id=${E2E_GROUP_ID}`, 'Group');
    expectFrameGeometry(read, isMobile, 'the group page');
  });

  // FL-07 (89.6-23, register FL-07; owner pick DT-3 = Move, 2026-11-23: 'Dt-3 : move it so it doesn't
  // scroll at normal text. Change is approved.'). Friends signed out at the two phone sizes, normal
  // text: the page is exactly one window tall (it was 860 against 667 and 761 against 568, the
  // header plus the footer below a screen-tall frame). Both reads are attached before the assert.
  test('FL-07 (89.6-23): no scroll at normal text at 375 x 667 and 320 x 568', async ({ page }, testInfo) => {
    const reads: Array<{ size: string; scrollHeight: number; innerHeight: number; frameTop: number; frameCentre: number; mainCentre: number }> = [];
    for (const size of [
      { width: 375, height: 667 },
      { width: 320, height: 568 },
    ]) {
      await page.setViewportSize(size);
      const read = await readFrame(page, '/friends', 'Friends');
      reads.push({
        size: `${size.width}x${size.height}`,
        scrollHeight: read.scrollHeight,
        innerHeight: read.innerHeight,
        frameTop: read.frame.top,
        frameCentre: (read.frame.top + read.frame.bottom) / 2,
        mainCentre: (read.main.top + read.main.bottom) / 2,
      });
    }
    await testInfo.attach('FL-07-scroll-height', { body: JSON.stringify(reads, null, 2), contentType: 'application/json' });
    for (const read of reads) {
      expect(read.scrollHeight - read.innerHeight, `Friends signed out at ${read.size}: the page is ${read.scrollHeight}px tall in a ${read.innerHeight}px window`).toBeLessThanOrEqual(1);
    }
  });

  // The frame at large text: the five checks at 320 x 568 with 200% text, and the lighter A8 check at
  // the two page-zoom widths with normal text (SPEC A8). The reads are attached before the asserts.
  test('FL-07 (89.6-23): the signed-out banner holds the large-text checks at 320 / 200% and the A8 widths', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 320, height: 568 });
    await readFrame(page, '/friends', 'Friends');
    const frame = page.locator('[data-slot="page-frame"]');
    await setTextMode(page, '200', 'FL-07 320x568-200');
    const large = await readLargeTextCell(frame);
    const zoom: Record<string, PageZoomRead> = {};
    await setTextMode(page, '100', 'FL-07 normal');
    for (const size of [
      { width: 215, height: 466 },
      { width: 187, height: 333 },
    ]) {
      await page.setViewportSize(size);
      zoom[`${size.width}x${size.height}`] = await readPageZoomCell(frame);
    }
    await testInfo.attach('FL-07-large-text', { body: JSON.stringify({ '320x568-200': large, ...zoom }, null, 2), contentType: 'application/json' });
    expectLargeTextCell(large, 'FL-07 320x568-200');
    for (const [size, read] of Object.entries(zoom)) expectPageZoomUsable(read, `FL-07 ${size}-100-zoom`);
  });
});
