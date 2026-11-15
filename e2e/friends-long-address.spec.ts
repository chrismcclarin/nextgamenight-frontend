import { test, expect, type Locator, type Page } from '@playwright/test';

import { expectNoApiWrites, holdWrites, type WriteHold } from './support/inFlight';

// Phase 88.9 plan 66 (X13-1, owner at the round-2 glance) — a long email or name on the Friends
// page, measured on a phone at 375: the row's action must stay on screen.
//
// THE DEFECT. Each Friends row is a flex row with a text column and an action column. The text
// column could not shrink below its longest unbroken word and the action column could, so a long
// address took the whole row and pushed Send Request, Accept / Decline, the Pending tag or Remove
// past the right edge of the screen.
//
// WHAT EACH TEST DOES. It answers the page's list reads in the browser with ONE made-up row whose
// email (or name, for a friend: the friends payload carries no email) is an unbroken 52-character
// string on the reserved .invalid domain, opens the tab that shows the row, and measures the
// action's box against the viewport. It also measures the long text itself, so a fix that clipped
// the address instead of wrapping it would fail here too.
//
// NOTHING IS WRITTEN. Every write is held in the browser (support/inFlight.ts) and no test presses
// a control that writes: Search sends a GET, which is answered here. The rows are the white cards
// of plan 88.9-58; this spec reads no fill and no hover.
//
// PHONE ONLY, CI ONLY. A 375 layout defect; the journeys project skips it and the floor row in
// scripts/gate-c-floors.manifest.mjs keeps the four tests executed in phone. Both projects need
// the signed-in storage state, which does not exist locally, so typecheck and listing are the
// only local proof.

const LONG_EMAIL = 'x13longaddressfromtheglance@nextgamenighte2e.invalid';
const LONG_NAME = 'X13LongNameWithNoSpacesFromTheRoundTwoGlanceOwnerRow';

const FOUND_PERSON = { id: '88966a13-0000-4000-8000-0000000000c1', username: null, email: LONG_EMAIL };
const RECEIVED_REQUEST = {
  id: 'e2e-friends-x13-received',
  status: 'pending',
  Requester: { id: '88966a13-0000-4000-8000-0000000000c2', username: 'E2E Long Requester', email: LONG_EMAIL },
};
const SENT_REQUEST = {
  id: 'e2e-friends-x13-sent',
  status: 'pending',
  Addressee: { id: '88966a13-0000-4000-8000-0000000000c3', username: null, email: LONG_EMAIL },
};
const LONG_FRIEND = {
  id: 'e2e-friends-x13-friend',
  friend: { id: '88966a13-0000-4000-8000-0000000000c4', username: LONG_NAME },
};

interface Lists {
  accepted?: unknown[];
  received?: unknown[];
  sent?: unknown[];
}

// The three list reads (src/lib/api.ts: status=accepted, direction=received, direction=sent), each
// answered in the browser. A list the test does not name is answered empty, so the page never
// waits on the shared fixture and the found person is never already a friend.
async function answerLists(page: Page, lists: Lists) {
  await page.route(
    (url) => url.pathname.endsWith('/friendships'),
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.fallback();
        return;
      }
      const params = new URL(route.request().url()).searchParams;
      if (params.get('status') === 'accepted') {
        await route.fulfill({ status: 200, json: lists.accepted ?? [] });
        return;
      }
      if (params.get('direction') === 'received') {
        await route.fulfill({ status: 200, json: lists.received ?? [] });
        return;
      }
      if (params.get('direction') === 'sent') {
        await route.fulfill({ status: 200, json: lists.sent ?? [] });
        return;
      }
      await route.fallback();
    },
  );
}

async function boxOf(locator: Locator, what: string) {
  const box = await locator.boundingBox();
  expect(box, `${what} has no layout box`).not.toBeNull();
  return box!;
}

// "Inside the screen": the box's left edge at least 0 and its right edge at most the viewport width.
async function expectInsideViewport(page: Page, locator: Locator, what: string) {
  await expect(locator, `${what} never rendered`).toBeVisible({ timeout: 15_000 });
  const box = await boxOf(locator, what);
  const width = page.viewportSize()?.width ?? 0;
  expect(width, 'the phone project must be 375 wide').toBe(375);
  expect(box.x, `${what} left edge ${box.x}px`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what} right edge ${box.x + box.width}px vs the ${width}px screen`).toBeLessThanOrEqual(width);
}

async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, `the page scrolls sideways: ${scrollWidth}px vs ${innerWidth}px`).toBeLessThanOrEqual(innerWidth);
}

async function openFriends(page: Page) {
  await page.goto('/friends');
  // The identity gate renders first.
  await expect(page.getByLabel("Friend's email address")).toBeVisible({ timeout: 15_000 });
}

test.describe('Friends rows with a long address — phone (375), plan 88.9-66', () => {
  // Runs ONLY in the phone project: both projects collect every spec, so this is a runtime skip.
  test.skip(({ isMobile }) => !isMobile, 'X13-1 is a 375 layout defect: phone project only');

  let hold: WriteHold | undefined;
  test.beforeEach(async ({ page }) => {
    // The hold FIRST, before any answer and before navigation, so it is the last resort.
    hold = await holdWrites(page);
  });
  test.afterEach(async ({ page }) => {
    expectNoApiWrites(hold);
    hold = undefined;
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('X13-1 (88.9): a found person with a long email keeps Send Request inside a 375 screen', async ({ page }) => {
    await answerLists(page, {});
    await page.route(
      (url) => url.pathname.endsWith('/friendships/search'),
      async (route) => {
        if (route.request().method() !== 'GET') {
          await route.fallback();
          return;
        }
        await route.fulfill({ status: 200, json: FOUND_PERSON });
      },
    );
    await openFriends(page);

    const email = page.getByLabel("Friend's email address");
    await email.fill(LONG_EMAIL);
    // Enter in the field submits the search form: a GET, answered above.
    await email.press('Enter');

    const address = page.getByText(LONG_EMAIL, { exact: true });
    await expectInsideViewport(page, address, 'the found address');
    await expectInsideViewport(page, page.getByRole('button', { name: 'Send Request', exact: true }), 'Send Request');
    await expectNoSidewaysScroll(page);
  });

  test('X13-1 (88.9): a friend request from a long email keeps Accept and Decline inside a 375 screen', async ({ page }) => {
    await answerLists(page, { received: [RECEIVED_REQUEST] });
    await openFriends(page);
    await page.getByRole('button', { name: /^Requests(\s*\d+)?$/ }).click();

    const row = page.locator(`[data-request-row="${RECEIVED_REQUEST.id}"]`);
    await expect(row, 'the request row never rendered').toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page, row.getByText(LONG_EMAIL, { exact: true }), 'the requester address');
    await expectInsideViewport(page, row.getByRole('button', { name: 'Accept', exact: true }), 'Accept');
    await expectInsideViewport(page, row.getByRole('button', { name: 'Decline', exact: true }), 'Decline');
    await expectNoSidewaysScroll(page);
  });

  test('X13-1 (88.9): a sent request to a long email keeps its Pending tag inside a 375 screen', async ({ page }) => {
    await answerLists(page, { sent: [SENT_REQUEST] });
    await openFriends(page);
    await page.getByRole('button', { name: /^Sent(\s*\d+)?$/ }).click();

    const address = page.getByText(LONG_EMAIL, { exact: true });
    await expectInsideViewport(page, address, 'the sent-to address');
    await expectInsideViewport(page, page.getByText('Pending', { exact: true }), 'the Pending tag');
    await expectNoSidewaysScroll(page);
  });

  test('X13-1 (88.9): a friend with a long name keeps Remove inside a 375 screen', async ({ page }) => {
    await answerLists(page, { accepted: [LONG_FRIEND] });
    await openFriends(page);

    const row = page.locator(`[data-friend-row="${LONG_FRIEND.id}"]`);
    await expect(row, 'the friend row never rendered').toBeVisible({ timeout: 15_000 });
    await expectInsideViewport(page, row.getByText(LONG_NAME, { exact: true }), 'the friend name');
    await expectInsideViewport(page, row.getByRole('button', { name: `Remove ${LONG_NAME}`, exact: true }), 'Remove');
    await expectNoSidewaysScroll(page);
  });
});
