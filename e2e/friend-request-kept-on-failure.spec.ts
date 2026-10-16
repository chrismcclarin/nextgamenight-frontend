import { test, expect, type Page } from '@playwright/test';

// Phase 88.6.1 plan 66 (Req 11, SPEC Prohibition 2; D-54 remove on confirm): a failed Accept or
// Decline on the Friends page keeps the friend request on screen, seen on a phone at 375 x 667.
//
// WHAT THIS CHECKS THAT JSDOM CANNOT. The jsdom suite
// (`src/app/components/FriendshipStatusProvider.requestActions.test.tsx`, RA-1..RA-12) proves the
// provider's list contract with the provider alone. This spec runs the REAL provider at the app
// root under the REAL Friends page in a real browser: the row stays visible while the request is
// in flight (so the page's existing in-flight label can paint), stays after a 500, sits inside the
// 375px viewport, and the provider's one reconcile read goes out.
//
// NOT RUN LOCALLY. The `phone` project depends on the `setup` project, which drives Auth0 Universal
// Login with credentials that are deliberately absent locally, and there is no `.auth/user.json`
// in the tree (C-14 in .planning/codebase/FE-TESTING-CONVENTIONS.md). Typecheck and listing are
// the only local proof; the CI e2e job is the proof.
//
// SYNTHETIC DATA, NOTHING WRITTEN. Every friend-request read and write this spec makes is answered
// by `page.route` inside the test browser: the received-list GET is fulfilled with one made-up
// request whose id does not exist server-side, and the accept / decline POSTs are FULFILLED with a
// 500 and never continued, so nothing reaches the shared CI database and no fixture changes.

const REQUEST_ID = 'e2e-friend-request-kept';
const REQUESTER_NAME = 'E2E Requester';
const FAKE_REQUEST = {
  id: REQUEST_ID,
  status: 'pending',
  Requester: { id: '00000000-0000-4000-8000-0000000e2e66', username: REQUESTER_NAME },
};

interface Counters {
  receivedGets: number;
}

// The provider's received-list read is `friendshipsAPI.getReceivedRequests` ->
// GET `/friendships?status=pending&direction=received` (src/lib/api.ts), reached through the BFF
// proxy. Registered BEFORE `page.goto` so the first load is answered too.
async function answerReceivedList(page: Page, counters: Counters) {
  await page.route(
    (url) => url.pathname.endsWith('/friendships') && url.searchParams.get('direction') === 'received',
    async (route) => {
      if (route.request().method() !== 'GET') {
        await route.continue();
        return;
      }
      counters.receivedGets += 1;
      await route.fulfill({ status: 200, json: [FAKE_REQUEST] });
    },
  );
}

async function openRequestsTab(page: Page) {
  await page.goto('/friends');
  // The page's identity gate renders first, so the tab can take a while to appear.
  const tab = page.getByRole('button', { name: /^Requests/ });
  await expect(tab).toBeVisible({ timeout: 15_000 });
  await tab.click();
  await expect(page.getByText(REQUESTER_NAME, { exact: true }).filter({ visible: true })).toBeVisible();
}

async function expectRowInsideViewport(page: Page) {
  const name = page.getByText(REQUESTER_NAME, { exact: true }).filter({ visible: true });
  await expect(name).toBeVisible();
  const viewport = page.viewportSize();
  expect(viewport, 'the phone project must define a viewport').not.toBeNull();
  const box = await name.boundingBox();
  expect(box, 'the requester name has no layout box').not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
}

test.describe('friend request kept on failure — phone (375)', () => {
  // Runs ONLY in the `phone` project: both `journeys` and `phone` collect every e2e spec, so this
  // is a runtime skip, not a collection filter (the feedback-stacking.spec.ts idiom).
  test.skip(({ isMobile }) => !isMobile, 'D-54 at 375px: this spec measures the PHONE viewport only');

  test('friend request kept on failure — a held then failed Accept keeps the row, in view, ready to retry', async ({ page }) => {
    const counters: Counters = { receivedGets: 0 };
    let acceptPosts = 0;
    let releaseAccept!: () => void;
    const acceptHeld = new Promise<void>((resolve) => {
      releaseAccept = resolve;
    });
    await answerReceivedList(page, counters);
    await page.route(
      (url) => url.pathname.endsWith(`/friendships/${REQUEST_ID}/accept`),
      async (route) => {
        acceptPosts += 1;
        await acceptHeld;
        await route.fulfill({ status: 500, json: {} });
      },
    );

    await openRequestsTab(page);
    const readsBeforeTap = counters.receivedGets;

    await page.getByRole('button', { name: 'Accept', exact: true }).filter({ visible: true }).click();

    // While the accept is held: the row is still there, so the page's in-flight label paints.
    await expect(page.getByRole('button', { name: 'Accepting...', exact: true })).toBeVisible();
    await expect(page.getByText(REQUESTER_NAME, { exact: true }).filter({ visible: true })).toBeVisible();

    releaseAccept();

    // Positive settle: the provider's one reconcile read went out after the 500.
    await expect.poll(() => counters.receivedGets).toBeGreaterThan(readsBeforeTap);
    await expect(page.getByRole('button', { name: 'Accept', exact: true }).filter({ visible: true })).toBeVisible();
    await expectRowInsideViewport(page);
    expect(acceptPosts).toBe(1);
  });

  test('friend request kept on failure — a failed Decline keeps the row, in view, ready to retry', async ({ page }) => {
    const counters: Counters = { receivedGets: 0 };
    let declinePosts = 0;
    await answerReceivedList(page, counters);
    await page.route(
      (url) => url.pathname.endsWith(`/friendships/${REQUEST_ID}/decline`),
      async (route) => {
        declinePosts += 1;
        await route.fulfill({ status: 500, json: {} });
      },
    );

    await openRequestsTab(page);
    const readsBeforeTap = counters.receivedGets;

    await page.getByRole('button', { name: 'Decline', exact: true }).filter({ visible: true }).click();

    // Positive settle: the provider's one reconcile read went out after the 500. (No assertion on
    // the in-flight Decline label: plan 88.6.1-40 owns that page's labels.)
    await expect.poll(() => counters.receivedGets).toBeGreaterThan(readsBeforeTap);
    await expect(page.getByRole('button', { name: 'Decline', exact: true }).filter({ visible: true })).toBeVisible();
    await expectRowInsideViewport(page);
    expect(declinePosts).toBe(1);
  });
});
