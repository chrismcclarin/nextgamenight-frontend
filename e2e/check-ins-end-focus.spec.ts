import { test, expect, type Locator, type Page, type Route } from '@playwright/test';

import { expectNoApiWrites, holdWrites, settleAnimations, type WriteHold } from './support/inFlight';

/* Phase 88.6.1 plan 29 — the group page's Check-ins list in a real browser, at 375px (`phone`)
   and 1280px (`journeys`).

   WHAT IT PROVES (what jsdom cannot):
   - E1 (H4, Req 5, AC-14): after a check-in is ended from its kebab, focus lands on the Check-ins
     expand control (the `role="button"` header), whose accessible name carries the new count —
     never on `<body>`.
   - E3 (W018, Req 11): with the animation-era height cap and clip deleted from the panel, the page
     gains no horizontal overflow and the panel is neither capped nor clipped.
   - E2 (AC-29 / RF1, plan 88.6.1-75; plan 88.6.1-70 contract C8 d; phone only): when the refresh
     after an End fails, both rows stay under the shared RF1 notice; its Retry is at least 44 x 44
     and fully inside the 375 x 667 viewport where the failure lands (no scroll first), the page
     gains no horizontal overflow, the notice sits above the rows, and a keyboard Retry that
     succeeds lands focus on the Check-ins header.

   IT NEVER WRITES TO THE BACKEND. Both the read (GET open check-ins) and the write (PATCH close)
   are fulfilled by `page.route`; every other method on those two routes goes to
   `route.fallback()`, and the shared write hold (`holdWrites`, registered first so it is the last
   resort) keeps any other write in the browser. The seeded open check-in other specs read is never
   closed.

   CI ONLY: the `phone` and `journeys` projects need `.auth/user.json` and the E2E login secrets,
   which exist only in CI (FE-TESTING-CONVENTIONS C-14).

   NOT HERE: R10's 375px overflow check for typed line breaks is plan 88.6.1-52's all-sites spec,
   so it is not duplicated. */

// Loud guard (precedent e2e/event-scheduler-touch.spec.ts): name the var and its producer, never
// echo the value.
const E2E_GROUP_ID = process.env.E2E_GROUP_ID ?? '';

test.beforeEach(() => {
  expect(
    E2E_GROUP_ID,
    'E2E_GROUP_ID must be set — the CI step that runs scripts/e2e-fixtures.js exports it. Without it this spec opens a group the fixtures do not own.',
  ).toBeTruthy();
});

const CHECK_IN_ANA = {
  id: '00000000-0000-4000-8000-0000000000a1',
  can_close: true,
  custom_message: null,
  Creator: { id: '00000000-0000-4000-8000-0000000000b1', username: 'E2E Ana' },
};
const CHECK_IN_BEN = {
  id: '00000000-0000-4000-8000-0000000000a2',
  can_close: true,
  custom_message: null,
  Creator: { id: '00000000-0000-4000-8000-0000000000b2', username: 'E2E Ben' },
};

// Per-test mutable state for the two route handlers. `getMode` decides what the open check-ins
// GET serves; `afterPatchMode` is the mode the close PATCH switches it to ('fail' answers a 500,
// for E2's failed refresh).
type OpenCheckInsMode = 'both' | 'ben-only' | 'fail';
const routeState = {
  getMode: 'both' as OpenCheckInsMode,
  afterPatchMode: 'ben-only' as OpenCheckInsMode,
  patchCount: 0,
};

async function mockCheckIns(page: Page) {
  routeState.getMode = 'both';
  routeState.afterPatchMode = 'ben-only';
  routeState.patchCount = 0;

  await page.route('**/api/groups/*/prompts/open', async (route: Route) => {
    if (route.request().method() !== 'GET') {
      await route.fallback();
      return;
    }
    if (routeState.getMode === 'fail') {
      await route.fulfill({ status: 500, json: { error: 'Internal server error' } });
      return;
    }
    const prompts = routeState.getMode === 'both' ? [CHECK_IN_ANA, CHECK_IN_BEN] : [CHECK_IN_BEN];
    await route.fulfill({ status: 200, json: { prompts } });
  });

  await page.route('**/api/availability-prompts/*/close', async (route: Route) => {
    if (route.request().method() !== 'PATCH') {
      await route.fallback();
      return;
    }
    routeState.patchCount += 1;
    // After the close, the refetch serves only Ben, as the backend would (E2: it fails instead).
    routeState.getMode = routeState.afterPatchMode;
    await route.fulfill({ status: 200, json: {} });
  });
}

// The Check-ins header: its accessible name starts with "Check-ins" and continues with the badge.
const checkInsHeader = (page: Page) => page.getByRole('button', { name: /^check-ins/i });
const checkInTriggers = (page: Page) =>
  page.getByRole('button', { name: 'Check-in actions', exact: true });

// Copy row RF1 / D-47: plan 88.6.1-70's REFRESH_FAILED_NOTICE, written once in this spec.
const RF1 = "Couldn't refresh. Showing what loaded earlier.";

let hold: WriteHold | undefined;
test.beforeEach(async ({ page }) => {
  // The hold FIRST, before any mock and before navigation, so it is the last resort.
  hold = await holdWrites(page);
});
test.afterEach(async ({ page }) => {
  expectNoApiWrites(hold);
  hold = undefined;
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

// Two-tap End on the first check-in's kebab (KebabMenu restores focus to its trigger after the
// item runs). Returns that trigger.
async function endFirstCheckIn(page: Page): Promise<Locator> {
  const trigger = checkInTriggers(page).first();
  await trigger.click();
  const listId = await trigger.getAttribute('aria-controls');
  expect(listId, 'the kebab names its open list through aria-controls').toBeTruthy();
  const list = page.locator(`[id="${listId}"]`);
  await list.getByRole('button', { name: 'End check-in' }).click();
  await list.getByRole('button', { name: 'Tap again to end' }).click();
  return trigger;
}

// C8 (d), measured where the failure lands: the Retry box is at least 44 x 44 and FULLY inside the
// viewport, both axes. Soft assertions, so a run reports each half on its own. Every message carries
// the measured numbers and the word STOP: a failure here goes to the owner for a mockup, never to an
// ad-hoc restyle, and never to a scroll added before the measurement (plan 88.6.1-70 contract C8 d).
function expectRetryFullyInViewport(
  box: { x: number; y: number; width: number; height: number },
  viewport: { width: number; height: number },
): void {
  const right = box.x + box.width;
  const bottom = box.y + box.height;
  expect.soft(box.width, `STOP: Retry measured ${box.width}px wide (floor 44)`).toBeGreaterThanOrEqual(44);
  expect.soft(box.height, `STOP: Retry measured ${box.height}px tall (floor 44)`).toBeGreaterThanOrEqual(44);
  expect.soft(box.x, `STOP: Retry left edge ${box.x}px, right edge ${right}px, viewport width ${viewport.width}px`).toBeGreaterThanOrEqual(0);
  expect.soft(right, `STOP: Retry left edge ${box.x}px, right edge ${right}px, viewport width ${viewport.width}px`).toBeLessThanOrEqual(viewport.width);
  expect.soft(box.y, `STOP: Retry top ${box.y}px, bottom ${bottom}px, viewport height ${viewport.height}px`).toBeGreaterThanOrEqual(0);
  expect.soft(bottom, `STOP: Retry top ${box.y}px, bottom ${bottom}px, viewport height ${viewport.height}px`).toBeLessThanOrEqual(viewport.height);
}

test('E1: ending a check-in hands focus to the Check-ins header, which announces the new count (H4)', async ({ page }) => {
  await mockCheckIns(page);
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);

  // The section mounts expanded (defaultExpanded on the planning page); the header is a toggle,
  // so it is never clicked here.
  await expect(checkInTriggers(page)).toHaveCount(2);

  await endFirstCheckIn(page);

  const header = checkInsHeader(page);
  await expect(header).toBeFocused();
  await expect(header).toHaveAccessibleName(/1 open poll$/);
  await expect(checkInTriggers(page)).toHaveCount(1);
  expect(routeState.patchCount).toBe(1);
});

test('E2, AC-29 / RF1: a failed refresh keeps the check-ins under the RF1 notice at 375px', async ({ page, isMobile }) => {
  test.skip(!isMobile, 'the 375px layout arm is phone-only');
  await mockCheckIns(page);
  routeState.afterPatchMode = 'fail';
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
  await expect(checkInTriggers(page)).toHaveCount(2);

  // 1. Two-tap End on the first row; the refresh that follows answers 500.
  const triggerA = await endFirstCheckIn(page);

  // 2. Within 10 s (the app retries a 5xx once): the Check-ins panel holds the notice's Retry, and
  //    the Retry's row carries the RF1 sentence.
  const header = checkInsHeader(page);
  const panelId = await header.getAttribute('aria-controls');
  expect(panelId, 'the header names its panel through aria-controls').toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  const retry = panel.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeVisible({ timeout: 10_000 });
  const noticeRow = retry.locator('..');
  await expect(noticeRow).toContainText(RF1);

  // 3. The rows stayed, so focus stayed on the trigger; the full banner never shows.
  await expect(page.getByText("We couldn't load the check-ins")).toHaveCount(0);
  await expect(checkInTriggers(page)).toHaveCount(2);
  await expect(triggerA).toBeFocused();

  // 4. Layout (C8 d), where the failure lands: NOTHING scrolls the page or the Retry first.
  await settleAnimations(panel);
  const viewport = page.viewportSize();
  expect(viewport, 'the phone project sets a viewport').not.toBeNull();
  const retryBox = await retry.boundingBox();
  expect(retryBox, 'Retry has a box').not.toBeNull();
  expectRetryFullyInViewport(retryBox!, viewport!);
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect.soft(scrollWidth, `STOP: the page scrolls sideways (${scrollWidth}px over ${clientWidth}px)`).toBeLessThanOrEqual(clientWidth);
  const rowBox = await noticeRow.boundingBox();
  // The first check-in row is the one the End taps were on (E2E Ana).
  const firstRowBox = await panel.getByRole('listitem').filter({ hasText: 'Started by E2E Ana' }).boundingBox();
  expect(rowBox, 'the notice row has a box').not.toBeNull();
  expect(firstRowBox, 'the first check-in row has a box').not.toBeNull();
  expect.soft(
    rowBox!.y + rowBox!.height,
    `STOP: the notice row ends at ${rowBox!.y + rowBox!.height}px; the first check-in begins at ${firstRowBox!.y}px`,
  ).toBeLessThanOrEqual(firstRowBox!.y);

  // 5. A keyboard Retry that succeeds: one row left, the notice gone, focus on the Check-ins header.
  routeState.getMode = 'ben-only';
  await retry.focus();
  await page.keyboard.press('Enter');
  await expect(checkInTriggers(page)).toHaveCount(1);
  await expect(panel.getByRole('button', { name: 'Retry', exact: true })).toHaveCount(0);
  await expect(header).toBeFocused();

  // 6. Exactly the one close write, fulfilled in the browser.
  expect(routeState.patchCount).toBe(1);
});

test('E3: the expanded Check-ins panel is neither capped nor clipped, and adds no horizontal overflow (W018)', async ({ page }) => {
  await mockCheckIns(page);
  await page.goto(`/groupPlanning?group_id=${E2E_GROUP_ID}`);
  await expect(checkInTriggers(page)).toHaveCount(2);

  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(scrollWidth, 'the page must not scroll horizontally').toBeLessThanOrEqual(clientWidth);

  const panelId = await checkInsHeader(page).getAttribute('aria-controls');
  expect(panelId, 'the header names its panel through aria-controls').toBeTruthy();
  const panel = page.locator(`[id="${panelId}"]`);
  await expect(panel).toBeVisible();
  const style = await panel.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { maxHeight: cs.maxHeight, overflowY: cs.overflowY };
  });
  expect(style.maxHeight).toBe('none');
  expect(style.overflowY).toBe('visible');
});
