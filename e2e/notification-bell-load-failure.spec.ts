import { test, expect, type Locator, type Page } from '@playwright/test';
import { holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

// Phase 88.6.1-80 (N7 / D-47, Req 5, Req 11, D-18, D-08a) — the notification bell's load-failure
// banner in a real browser at 375px (the phone project; at this width the bell is the ROW variant
// inside the hamburger, src/app/Header.js, anchor variant="row" label="Invites").
//
// What this proves:
//   - when the bell's notifications could not be loaded and there is nothing to show, the open
//     panel shows the house full banner titled with copy row N7 instead of the empty line, and it
//     fits the panel and the viewport; Try again and Report this are each at least 44px and apart;
//   - the owner's 2026-10-05 ruling: Report this appears only after a failed Try again (plan
//     88.6.1-69);
//   - the modal-layer rule in the shared dismissal hook: the report form (hosted by
//     FeedbackModalProvider at the layout root, plan 88.6.1-69) opens over a panel that STAYS open;
//     a press inside the form or on its dimmed overlay does not close the panel; one overlay press or
//     one Escape closes one layer, and focus returns to Report this; a second Escape closes the panel
//     with focus on the bell's row, and the hamburger stays open (Header's bail, plan 88.6.1-45);
//   - a successful Try again keeps focus inside the panel, on its heading (plan 88.6.1-70's
//     focusTarget).
//
// Runs in CI only (the e2e job on the phase PR). Locally there is no .auth storageState, so this
// file is typechecked (tsconfig.e2e.json) and listed, never run.
//
// Interception: plan 88.6.1-43's holdWrites net is registered first (it answers the three
// friendship reads with [] in the browser and holds every write unanswered), then one route of
// this spec's own for the invites read, which answers GETs only (500 or []) and hands anything
// else back to the net. The report form is never submitted, so nothing reaches the shared CI
// database.

// Copy row N7 (D-47, owner-ratified 2026-10-05), straight apostrophe (D-32 R8).
const N7 = "Couldn't load your notifications";
const EMPTY_LINE = 'No pending notifications';
const REPORT_DIALOG = 'Report Bug or Suggest Feature';

type InvitesMode = 'fail' | 'empty';

// The three friendship lists answer [] in the browser; every other read goes through untouched.
function answerFriendships(url: URL): unknown {
  if (url.pathname.endsWith('/friendships')) return [];
  return undefined;
}

async function routeInvites(page: Page, mode: () => InvitesMode): Promise<void> {
  await page.route(/\/invites\/pending(\?|$)/, async (route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (mode() === 'fail') {
      await route.fulfill({ status: 500, json: { error: 'e2e forced failure' } });
      return;
    }
    await route.fulfill({ status: 200, json: [] });
  });
}

// The row bell on the phone: open the hamburger, then the Invites row. The region is found with
// includeHidden, because Radix hides the rest of the page from the accessibility tree while the
// report form is open.
async function openBellOnPhone(page: Page): Promise<Locator> {
  const menuButton = page.getByRole('button', { name: 'Toggle menu' });
  await menuButton.click();
  await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
  await page.getByRole('button', { name: 'Invites notifications', exact: true }).click();
  const region = page.getByRole('region', { name: 'Notifications', exact: true, includeHidden: true });
  await expect(region).toBeVisible();
  return region;
}

type Box = { x: number; y: number; width: number; height: number };

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  expect(box, `${what} must have a layout box`).not.toBeNull();
  return box as Box;
}

function intersects(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

function expectWithin(inner: Box, outer: Box, what: string): void {
  expect(inner.x, `${what} starts inside`).toBeGreaterThanOrEqual(outer.x);
  expect(inner.x + inner.width, `${what} ends inside`).toBeLessThanOrEqual(outer.x + outer.width + 0.5);
}

// The bell's flow sends no write: the net's catches are listed by method and path only.
function expectNoBellWriteInNet(hold: WriteHold): void {
  const held = hold.held.map((request) => `${request.method} ${new URL(request.url).pathname}`);
  test.info().annotations.push({ type: 'held-writes', description: held.join(', ') || 'none' });
  expect(held.filter((entry) => /\/(invites|friendships|feedback)/.test(entry))).toEqual([]);
}

test.describe('notification bell load failure — phone (375)', () => {
  // Runs ONLY in the phone project (both journeys and phone glob every e2e/*.spec.ts).
  test.skip(({ isMobile }) => !isMobile, 'the phone bell is the row variant inside the hamburger');

  test.afterEach(async ({ page }) => {
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('notification bell load failure — phone: the N7 banner fits, Report this comes after a failed Try again, and the report form closes one layer at a time', async ({ page }) => {
    const mode: InvitesMode = 'fail';
    const hold = await holdWrites(page, { answerGet: answerFriendships });
    await routeInvites(page, () => mode);
    await page.goto('/');
    const region = await openBellOnPhone(page);

    await expect(region.getByText(N7, { exact: true })).toBeVisible();
    const tryAgain = region.getByRole('button', { name: 'Try again', exact: true });
    const reportThis = region.getByRole('button', { name: 'Report this', exact: true });
    await expect(tryAgain).toBeVisible();
    await expect(reportThis).toHaveCount(0);
    await expect(region.getByText(EMPTY_LINE, { exact: true })).toHaveCount(0);

    // A failed Try again brings Report this; the banner stays mounted, so focus stays on Try again.
    await tryAgain.focus();
    await page.keyboard.press('Enter');
    await expect(reportThis).toHaveCount(1, { timeout: 15_000 });
    await expect(tryAgain).toBeFocused();

    // Geometry at 375: both link-buttons at least 44px and apart; the banner inside the panel and
    // the viewport; no sideways scroll.
    await settleAnimations(region);
    const viewport = page.viewportSize();
    expect(viewport, 'the phone project must define a viewport').not.toBeNull();
    const tryBox = await boxOf(tryAgain, 'Try again');
    const reportBox = await boxOf(reportThis, 'Report this');
    expect(tryBox.height).toBeGreaterThanOrEqual(44);
    expect(tryBox.width).toBeGreaterThanOrEqual(44);
    expect(reportBox.height).toBeGreaterThanOrEqual(44);
    expect(reportBox.width).toBeGreaterThanOrEqual(44);
    expect(intersects(tryBox, reportBox), 'Try again and Report this must not overlap').toBe(false);
    const regionBox = await boxOf(region, 'the panel');
    const alertBox = await boxOf(region.getByRole('alert').filter({ hasText: N7 }), 'the banner');
    const page375: Box = { x: 0, y: 0, width: viewport!.width, height: viewport!.height };
    for (const [box, what] of [
      [tryBox, 'Try again'],
      [reportBox, 'Report this'],
      [alertBox, 'the banner'],
    ] as const) {
      expectWithin(box, page375, `${what} (viewport)`);
      expectWithin(box, regionBox, `${what} (panel)`);
    }
    const scroll = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.innerWidth);

    // Report this opens the form over a panel that stays open; a press inside the form keeps it.
    await reportThis.click();
    const dialog = page.getByRole('dialog', { name: REPORT_DIALOG });
    await expect(dialog).toBeVisible();
    await expect(region).toBeVisible();
    await dialog.getByRole('textbox', { name: 'Subject' }).click();
    await expect(region).toBeVisible();

    // One press on the dimmed overlay closes the form alone; focus returns to Report this.
    await settleAnimations(dialog);
    const dialogBox = await boxOf(dialog, 'the report form');
    expect(intersects({ x: 6, y: 6, width: 1, height: 1 }, dialogBox), 'the overlay point lies outside the form').toBe(false);
    await page.mouse.click(6, 6);
    await expect(dialog).toHaveCount(0);
    await expect(region).toBeVisible();
    await expect(reportThis).toBeFocused();

    // One Escape closes the form alone; focus returns to Report this; the hamburger stays open.
    await reportThis.click();
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(region).toBeVisible();
    await expect(reportThis).toBeFocused();
    const menuButton = page.getByRole('button', { name: 'Toggle menu' });
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');

    // A second Escape closes the panel; focus on the bell's row; the hamburger still open (D-08a).
    await page.keyboard.press('Escape');
    await expect(region).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Invites notifications', exact: true })).toBeFocused();
    await expect(menuButton).toHaveAttribute('aria-expanded', 'true');
    expectNoBellWriteInNet(hold);
  });

  test('notification bell load failure — phone: a successful Try again shows the empty line and keeps focus inside the panel, on its heading', async ({ page }) => {
    let mode: InvitesMode = 'fail';
    const hold = await holdWrites(page, { answerGet: answerFriendships });
    await routeInvites(page, () => mode);
    await page.goto('/');
    const region = await openBellOnPhone(page);
    await expect(region.getByText(N7, { exact: true })).toBeVisible();

    mode = 'empty';
    const tryAgain = region.getByRole('button', { name: 'Try again', exact: true });
    await tryAgain.focus();
    await page.keyboard.press('Enter');
    await expect(region.getByText(EMPTY_LINE, { exact: true })).toBeVisible();
    await expect(region.getByRole('heading', { name: 'Notifications', exact: true })).toBeFocused();
    await expect(region).toBeVisible();
    expectNoBellWriteInNet(hold);
  });
});
